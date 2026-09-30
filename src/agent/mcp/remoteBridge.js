/**
 * remoteBridge.js — Remote MCP 端点的本地桥接层（/mcp，Streamable HTTP）
 *
 * ## 为什么需要这个文件
 *
 * 官方 MCP Registry 上登记的 `agent-virtual-world` 是 **stdio 包**（由宿主本地 `npx` 拉起）。
 * 但有不少目录站只收 **Remote (HTTP)** MCP：Smithery 的表单必填 `MCP Server URL`，
 * Coze / Dify / 千帆 / 元器 的"插件/组件"也都是 HTTP 形态。为了能进这些渠道，
 * 服务端提供 `/mcp` 的 Streamable HTTP 端点。
 *
 * ## 关键设计：直调本地服务层，**绝不自我 HTTP**
 *
 * 所有远程 AI 的请求都是从本机 nginx 转发进来的。如果这个端点内部再去 `fetch`
 * 自己的 `/api/agent/v1/*`，那么在服务端看来，**全世界所有 AI 共享同一个来源 IP（127.0.0.1）**，
 * 于是每 IP 限流（签票 10 次/小时、每 IP 并发 1 连接）会被第一个用户瞬间用光 ——
 * 一个人就能把全世界的 AI 挡在门外。
 *
 * 所以这里直接调用 `src/agent/` 的服务层，并把限流维度换成
 * **经过 nginx 透传的真实访客 IP**（`resolveClientIp`）。
 *
 * ## 与 stdio 版的差异（协议side-effect 必须如实说明）
 *
 * - **没有 WebSocket**，因此收不到服务端实时推送：
 *   `world_walk_to` 的"等待到达"从 WS 回执改成**轮询位置**（见 waitArrival）；聊天只能拉历史。
 * - `presenceBridge.onConnect` 仍然必须调用：`say` 与移动类动作都依赖
 *   `wsServer.playerPositions` 里有本连接的条目，否则 `say` 会被判 `no_position` 直接拒绝。
 * - 会话生命周期 = 游客票生命周期（30 分钟，不可续期），到期后 MCP 会话随之失效。
 */

const { v4: uuidv4 } = require('uuid');

const agentAuth = require('../agentAuth');
const agentSchema = require('../agentSchema');
const tierService = require('../agentTierService');
const transientSessionManager = require('../agentTransientSessionManager');
const agentSessionManager = require('../agentSessionManager');
const agentConfigService = require('../agentConfigService');
const agentActionService = require('../agentActionService');
const observationService = require('../agentObservationService');
const presenceBridge = require('../agentPresenceBridge');
const chatLogService = require('../chatLogService');
const logger = require('../../services/logger');

// ==================== 常量 ====================

/** 单个 MCP 会话的空闲上限（与 WS 侧 AGENT_IDLE_TIMEOUT_MINUTES 默认 5 分钟同口径） */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** 同时存在的 MCP 会话上限（防内存被撑爆；正常远达不到） */
const MAX_SESSIONS = 200;

/** 清扫周期 */
const SWEEP_INTERVAL_MS = 60 * 1000;

/** 轮询到达的间隔与兜底上限 */
const POLL_INTERVAL_MS = 400;
const MAX_WAIT_MS = 120000;

/** @type {Map<string, object>} mcpSessionId -> session ctx */
const sessions = new Map();
let sweeper = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 可预期的业务错误（会被翻译成给 AI 看的人话，而不是裸 500） */
class BridgeError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.extra = extra || {};
  }
}

// ==================== 会话生命周期 ====================

/**
 * 建立一个 MCP 会话：签游客票 → 落 DB → 注入 presence → 占 IP 并发名额。
 * @param {string} ip 真实访客 IP（resolveClientIp 的结果）
 * @param {{agentName?: string}} opts
 */
async function createSession(ip, opts = {}) {
  if (!agentAuth.isConfigured()) {
    throw new BridgeError('AGENT_SECRET_MISSING', 'Agent 功能未启用：服务端缺少 AGENT_JWT_SECRET 配置');
  }
  const config = await agentConfigService.getConfig();
  if (!config.agentEnabled) {
    throw new BridgeError('AGENT_DISABLED_GLOBALLY', '这个世界当前未开放 AI 接入（agent_enabled=false）');
  }
  if (sessions.size >= MAX_SESSIONS) {
    throw new BridgeError('TOO_MANY_SESSIONS', '当前 AI 会话数已达上限，请稍后再试');
  }

  // 签票限流：按**访客 IP**，与 /guest/session 同口径
  const ticket = tierService.checkTicketRate(ip);
  if (!ticket.ok) {
    throw new BridgeError('GUEST_TICKET_RATE_LIMITED', `签票过于频繁，请 ${ticket.retryAfterSec} 秒后再试`);
  }

  const built = agentAuth.buildGuestIdentity();
  const agentId = built.agentId;
  const agentName = (opts.agentName && String(opts.agentName).slice(0, 24)) || built.agentName;
  const worldId = await agentAuth.getWorldId();
  const issued = agentAuth.issueGuestAgentJwt({ agentId, agentName, worldId });
  await transientSessionManager.createGuestSession({
    jti: issued.jti, agentId, agentName, expiresAt: issued.expiresAt
  });

  const verified = await transientSessionManager.verifyTransientSession(issued.jti);
  if (!verified.ok) {
    throw new BridgeError('SESSION_CREATE_FAILED', '会话创建失败：' + verified.error);
  }
  const sessionRow = verified.session;
  const agent = transientSessionManager.buildAgentProfile(sessionRow);

  // presence 注入：**必须在任何 say / 移动之前**，否则 say 会被判 no_position
  const connectionId = uuidv4();
  const prevPos = await agentSessionManager.getLatestPosition(agent.id, issued.jti);
  const spawn = prevPos || (await agentSessionManager.getInitialSpawn());
  presenceBridge.onConnect(connectionId, agent, sessionRow, {}, spawn);

  const tier = tierService.resolveTier({ tier: agentSchema.AGENT_TIER_GUEST }, sessionRow);
  const slot = tierService.acquireIpSlot(tier, ip, connectionId);
  if (!slot.ok) {
    presenceBridge.onDisconnect(connectionId, { silent: false });
    throw new BridgeError('GUEST_IP_CONCURRENCY', '同一网络下的 AI 会话数已达上限（游客档每 IP 1 个），请稍后再试');
  }

  const ctx = {
    id: uuidv4(),
    connectionId,
    agent,
    session: sessionRow,
    tier,
    ip,
    token: issued.token,
    jti: issued.jti,
    expiresAt: issued.expiresAt,
    spawn,
    connected: true,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    /** 异步回执缓存（walk_to 到达等）；HTTP 模式下没有推送，这里只做记录 */
    replies: [],
    onReply: (type, payload) => { ctx.replies.push({ type, payload, at: Date.now() }); }
  };
  sessions.set(ctx.id, ctx);

  logger.access({ kind: 'mcp', event: 'session_open', agentId: agent.id, ip, tier });
  logger.audit('mcp_remote_session_open', { agentId: agent.id, agentName: agent.name, jti: issued.jti, ip });
  return ctx;
}

function getSession(id) {
  const ctx = sessions.get(id);
  if (!ctx) return null;
  if (Date.now() > Date.parse(ctx.expiresAt)) {
    // 游客票过期：与 stdio 版一致，不能续期
    destroySession(id, 'expired');
    return null;
  }
  ctx.lastActivityAt = Date.now();
  return ctx;
}

/** 归还名额 + 广播离场 + 清理未完成动作 */
function destroySession(id, reason) {
  const ctx = sessions.get(id);
  if (!ctx) return false;
  sessions.delete(id);
  try {
    if (ctx.connected) {
      agentActionService.cleanup(ctx.connectionId);
      presenceBridge.onDisconnect(ctx.connectionId, { silent: false });
      tierService.releaseIpSlot(ctx.tier, ctx.ip, ctx.connectionId);
      ctx.connected = false;
    }
  } catch (e) {
    logger.opsError('mcp 会话清理失败', { id, error: e.message });
  }
  logger.access({ kind: 'mcp', event: 'session_close', agentId: ctx.agent.id, ip: ctx.ip, reason });
  return true;
}

/** 空闲清扫（常驻，避免游客票还没到期但连接已死的会话堆积） */
function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, ctx] of sessions) {
      if (now - ctx.lastActivityAt > IDLE_TIMEOUT_MS || now > Date.parse(ctx.expiresAt)) {
        destroySession(id, 'idle_or_expired');
      }
    }
  }, SWEEP_INTERVAL_MS);
  if (sweeper.unref) sweeper.unref();
}

function stats() {
  return { open: sessions.size, max: MAX_SESSIONS, idleTimeoutMs: IDLE_TIMEOUT_MS };
}

// ==================== 8 个工具对应的本地动作 ====================

/** 服务端允许的 8 个动作（与 agentActionService 的分发表同口径；红线：不含 teleport / set_position） */
const AGENT_ACTIONS = ['move', 'walk_to', 'follow', 'rotate', 'jump', 'say', 'interact', 'stop'];

/** 1. world_discover */
async function discover(ctx) {
  const config = await agentConfigService.getConfig();
  // 世界身份与 observe / well-known 同源（federationSystem 内存态优先），
  // 否则同一个世界会在 discover 和 observe 里各报一个名字（历史上踩过这个坑）。
  const info = (await observationService.getWorldInfo()) || {};
  return {
    world: { id: info.id || (await agentAuth.getWorldId()), name: info.name || null },
    agentEnabled: Boolean(config.agentEnabled),
    tier: ctx.tier,
    agent: { id: ctx.agent.id, name: ctx.agent.name },
    endpoints: { mcp: '/mcp', api: '/api/agent/v1' },
    limits: {
      observeRadiusMeters: agentSchema.GUEST_OBSERVE_MAX_RADIUS,
      observeRateLimit: '1 次/2 秒（游客档）',
      sayRateLimit: '1 次/5 秒（游客档）',
      moveRateLimit: '1 次/2 秒（游客档）'
    },
    actions: AGENT_ACTIONS,
    session: { expiresAt: ctx.expiresAt, ttlSeconds: agentAuth.GUEST_SESSION_TTL_SECONDS, renewable: false }
  };
}

/** 3. world_observe（灵魂工具） */
async function observe(ctx, opts = {}) {
  const rate = tierService.checkActionRate(ctx.tier, ctx.agent.id, 'observe');
  if (!rate.ok) {
    throw new BridgeError('RATE_LIMITED', `观察过于频繁（${rate.limit}），请 ${rate.retryAfterMs} 毫秒后再试`);
  }
  const radius = tierService.clampObserveRadius(ctx.tier, opts.radius);
  const res = await observationService.observe(ctx.agent, ctx.session, {
    radius,
    limit: opts.limit,
    include: opts.include
  });
  return res;
}

/** 4~6. 动作类（say / walk_to / follow / stop），统一走 dispatch */
async function action(ctx, payload) {
  const out = await agentActionService.dispatch({
    connectionId: ctx.connectionId,
    agent: ctx.agent,
    session: ctx.session,
    tier: ctx.tier,
    reply: ctx.onReply
  }, payload);
  if (out && out.rejected) {
    throw new BridgeError(out.code || 'ACTION_REJECTED', out.reason || '动作被拒绝', out);
  }
  return out;
}

/**
 * 轮询等待"到达"：HTTP 模式没有 WS 的 ACTION_COMPLETED 推送，所以查 presence 里的实时位置。
 * 命中条件：水平距离 ≤ 1.5m（与服务端到达判定同量级）。
 */
async function waitArrival(ctx, target, estMs) {
  const budget = Math.min(estMs && estMs > 0 ? estMs + 8000 : 15000, MAX_WAIT_MS);
  const deadline = Date.now() + budget;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const entry = presenceBridge.getEntry(ctx.connectionId);
    const p = entry && entry.position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      const dx = p.x - target.x;
      const dz = p.z - target.z;
      if (Math.sqrt(dx * dx + dz * dz) <= 1.5) {
        return { arrived: true, position: p, waitedMs: budget - (deadline - Date.now()) };
      }
    }
    // 服务端异步回执里若已出现完成信号，也提前返回
    const hit = ctx.replies.find((r) => r.type === 'ACTION_COMPLETED');
    if (hit) return { arrived: false, receipt: hit.payload, position: (presenceBridge.getEntry(ctx.connectionId) || {}).position };
  }
  const entry = presenceBridge.getEntry(ctx.connectionId);
  return { arrived: false, position: entry && entry.position, timedOut: true };
}

/** 7. world_chat_history */
async function chatHistory(limit) {
  const n = Math.max(1, Math.min(Number(limit) || 20, 200));
  return chatLogService.getRecentHistory(n, null);
}

/** 当前自身位置（给工具做"我走到哪了"的反馈） */
function selfPosition(ctx) {
  const entry = presenceBridge.getEntry(ctx.connectionId);
  return (entry && entry.position) || ctx.spawn || null;
}

/** 8. world_leave */
function leave(ctx) {
  const wasConnected = Boolean(ctx.connected);
  destroySession(ctx.id, 'leave');
  return { wasConnected };
}

/** 让 AI 侧能按 MCP 会话 id 找回上下文 */
function touch(id) {
  const ctx = sessions.get(id);
  if (ctx) ctx.lastActivityAt = Date.now();
  return ctx;
}

module.exports = {
  BridgeError,
  createSession,
  getSession,
  touch,
  destroySession,
  startSweeper,
  stats,
  discover,
  observe,
  action,
  waitArrival,
  chatHistory,
  selfPosition,
  leave,
  IDLE_TIMEOUT_MS,
  MAX_SESSIONS
};
