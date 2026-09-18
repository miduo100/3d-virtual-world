/**
 * AI Agent 接入 - tier 服务（P8 拉/推双模式）
 *
 * 核心洞察：上线初期真正的风险是"没人来"而非"滥用"。把门禁倒过来——
 * 稀缺的不是进门资格，而是**服务器主动推流的成本**。
 * 拉模式（请求-响应）天然自限流：不请求服务器零开销，请求频率被限频钳死，
 * 滥用最坏情况有上界。API Key 的价值重新定义为"实时推流特权"而非进门凭证。
 *
 * 两条红线（P8 新增）：
 *   1) 游客 Agent 永不获得推流（SUBSCRIBE 一律拒绝，订阅集合恒为空 → 无 CHAT/位置流）
 *   2) 游客 Agent 永不获得 30m 以上观察半径
 *
 * 本模块只做"判定与限流"，不持有连接状态（连接级并发由调用方按需 acquire/release）。
 */

const {
  AGENT_TIER_KEY,
  AGENT_TIER_GUEST,
  GUEST_OBSERVE_MAX_RADIUS,
  KEY_OBSERVE_MAX_RADIUS,
  GUEST_TICKET_PER_IP_PER_HOUR,
  GUEST_MAX_CONNECTIONS_PER_IP,
  TIER_ACTION_RATES
} = require('./agentSchema');

// ==================== 内存限流表（进程内，重启清空；足够廉价的防滥用底线）====================

const ticketWindow = new Map();     // ip -> [ts]            签票
const actionWindow = new Map();     // `${agentId}:${action}` -> [ts]
const ipSlots = new Map();          // ip -> Set(connectionId)  游客并发连接

function prune(list, now, windowMs) {
  return list.filter(ts => now - ts < windowMs);
}

function sweep(map, windowMs) {
  const now = Date.now();
  for (const [k, v] of map.entries()) {
    if (v instanceof Set) { if (v.size === 0) map.delete(k); continue; }
    const alive = prune(v, now, windowMs);
    if (alive.length === 0) map.delete(k); else map.set(k, alive);
  }
}

let sweeperStarted = false;
function startSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  setInterval(() => {
    sweep(ticketWindow, 60 * 60 * 1000);
    sweep(actionWindow, 10 * 1000);
    sweep(ipSlots, 0);
  }, 5 * 60 * 1000).unref();
}
startSweeper();

// ==================== tier 判定 ====================

/**
 * 解析 tier：JWT payload 优先（签发时确定），缺省按会话类型兜底。
 * guest-pull 的会话一定落在 agent_transient_sessions（无外键表）。
 */
function resolveTier(jwtPayload, session) {
  if (jwtPayload && jwtPayload.tier === AGENT_TIER_GUEST) return AGENT_TIER_GUEST;
  if (jwtPayload && jwtPayload.tier === AGENT_TIER_KEY) return AGENT_TIER_KEY;
  return (session && session.isTransient) ? AGENT_TIER_GUEST : AGENT_TIER_KEY;
}

function isGuest(tier) { return tier === AGENT_TIER_GUEST; }

/** tier 能力描述（GET /me 与 /capabilities 展示用） */
function describeTier(tier) {
  if (isGuest(tier)) {
    return {
      tier: AGENT_TIER_GUEST,
      mode: 'pull',
      pushAllowed: false,          // 红线 1：永不推流
      observeMaxRadius: GUEST_OBSERVE_MAX_RADIUS,   // 红线 2
      maxConnectionsPerIp: GUEST_MAX_CONNECTIONS_PER_IP,
      actionRates: TIER_ACTION_RATES[AGENT_TIER_GUEST],
      upgradeHint: '需要实时推流 / 更大观察半径 / 跨世界联邦，请联系管理员申请 API Key 转正'
    };
  }
  return {
    tier: AGENT_TIER_KEY,
    mode: 'push',
    pushAllowed: true,
    observeMaxRadius: KEY_OBSERVE_MAX_RADIUS,
    maxConnectionsPerIp: null,
    actionRates: null,
    upgradeHint: null
  };
}

// ==================== 观察半径钳制 ====================

function clampObserveRadius(tier, requested) {
  const max = isGuest(tier) ? GUEST_OBSERVE_MAX_RADIUS : KEY_OBSERVE_MAX_RADIUS;
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return max;
  return Math.min(max, n);
}

// ==================== 签票限流（每 IP 每小时）====================

function checkTicketRate(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const list = prune(ticketWindow.get(ip) || [], now, windowMs);
  if (list.length >= GUEST_TICKET_PER_IP_PER_HOUR) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000));
    return { ok: false, retryAfterSec, remaining: 0 };
  }
  list.push(now);
  ticketWindow.set(ip, list);
  return { ok: true, remaining: GUEST_TICKET_PER_IP_PER_HOUR - list.length };
}

// ==================== 动作限频（仅游客；Key Agent 直接放行）====================

function checkActionRate(tier, agentId, action) {
  const rules = TIER_ACTION_RATES[tier];
  if (!rules) return { ok: true };
  const rule = rules[action];
  if (!rule) return { ok: true };
  const [maxCount, windowMs] = rule;
  const key = `${agentId}:${action}`;
  const now = Date.now();
  const list = prune(actionWindow.get(key) || [], now, windowMs);
  if (list.length >= maxCount) {
    return {
      ok: false,
      retryAfterMs: Math.max(1, windowMs - (now - list[0])),
      limit: `${maxCount}次/${windowMs}ms`
    };
  }
  list.push(now);
  actionWindow.set(key, list);
  return { ok: true, remaining: maxCount - list.length };
}

// ==================== 每 IP 并发连接（仅游客）====================

function acquireIpSlot(tier, ip, connectionId) {
  if (!isGuest(tier)) return { ok: true };
  const set = ipSlots.get(ip) || new Set();
  if (set.size >= GUEST_MAX_CONNECTIONS_PER_IP && !set.has(connectionId)) {
    return { ok: false, code: 'GUEST_IP_CONCURRENCY', limit: GUEST_MAX_CONNECTIONS_PER_IP };
  }
  set.add(connectionId);
  ipSlots.set(ip, set);
  return { ok: true };
}

function releaseIpSlot(tier, ip, connectionId) {
  if (!isGuest(tier)) return;
  const set = ipSlots.get(ip);
  if (!set) return;
  set.delete(connectionId);
  if (set.size === 0) ipSlots.delete(ip);
}

function ipSlotCount(ip) {
  const set = ipSlots.get(ip);
  return set ? set.size : 0;
}

module.exports = {
  AGENT_TIER_KEY,
  AGENT_TIER_GUEST,
  resolveTier,
  isGuest,
  describeTier,
  clampObserveRadius,
  checkTicketRate,
  checkActionRate,
  acquireIpSlot,
  releaseIpSlot,
  ipSlotCount
};
