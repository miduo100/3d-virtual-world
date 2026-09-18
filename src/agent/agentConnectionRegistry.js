/**
 * Agent 连接注册表（第一轮真人联测缺陷 B，2026-09-18）
 *
 * 问题（用户实测）：同一 API Key 开两条连接时——
 *   ① observe 的 entities 会出现同 id 两条（一条真实位置 animMode=idle，一条 animMode:null 停在出生点）；
 *   ② 两条连接各自以 10Hz 广播 POSITION_UPDATE，真人端同一个 avatar 被两个位置源来回拉扯，
 *      观感是"移动的时候原地徘徊"（前端按 characterId 只画一个 avatar，所以不是"两个角色"）。
 *      audit 日志里同一 agentId 反复 ws_connected / ws_idle_timeout 是该现象的另一佐证。
 *
 * 策略（服务端单点解决，人类侧 public/js/websocket.js 一行不改）：**新连接顶掉旧连接**。
 *   - 并发上限由 system_config `agent_max_connections_per_agent` 决定（默认 1，范围 1~10）；
 *   - 注册后保证"该 Agent 的连接数 == 上限"：按需关闭最旧的连接（close 4004
 *     REPLACED_BY_NEW_CONNECTION，2s 后 terminate 兜底防无响应客户端继续广播位置）；
 *     注意上限被**调低**后再有新连接时，会一次关闭多条以满足上限；
 *   - 被顶掉的连接在 agentWsServer.handleClose 里走**静默清理**：只删 playerPositions 表项、
 *     不广播 PLAYER_LEFT——同一 characterId 的新连接已接管，广播会让真人端 avatar 闪断。
 *
 * 依赖注入（init）避免与 agentWsServer 循环 require；未 init 时注册/注销仍可用，
 * 只是不触发"关闭旧连接"的副作用（单测友好）。
 */

// ==================== 状态 ====================

const byAgent = new Map();   // agentId -> [{ connectionId, at }]
const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 10;

let deps = { states: null, cancelAction: null, audit: null };

// ==================== 依赖注入 ====================

/**
 * @param injected { states: Map<connectionId, state>, cancelAction: (connectionId)=>void, audit: (event,data)=>void }
 */
function init(injected) {
  deps = Object.assign({ states: null, cancelAction: null, audit: null }, injected || {});
}

// ==================== 注册 / 注销 ====================

/**
 * 注册新连接；超出上限时顶掉最旧的连接（同步触发关闭，不等待 close 事件）。
 * @returns { replaced: string[], limit: number }
 */
function register(agentId, connectionId, limit) {
  const key = String(agentId);
  const max = clampLimit(limit);
  const list = (byAgent.get(key) || []).filter(e => e.connectionId !== connectionId);
  const replaced = [];
  while (list.length >= max) {
    const oldest = list.shift();
    if (oldest) replaced.push(oldest.connectionId);
  }
  list.push({ connectionId, at: Date.now() });
  byAgent.set(key, list);
  replaced.forEach(oldId => evict(key, oldId, connectionId));
  return { replaced, limit: max };
}

/**
 * 注销连接（WS close 时调用）。agentId 缺失时按 connectionId 全表兜底查找，避免残留。
 */
function unregister(agentId, connectionId) {
  const key = agentId === undefined || agentId === null ? null : String(agentId);
  if (key && byAgent.has(key)) {
    const list = (byAgent.get(key) || []).filter(e => e.connectionId !== connectionId);
    if (list.length === 0) byAgent.delete(key); else byAgent.set(key, list);
    return;
  }
  for (const [k, list] of byAgent.entries()) {
    const next = list.filter(e => e.connectionId !== connectionId);
    if (next.length !== list.length) {
      if (next.length === 0) byAgent.delete(k); else byAgent.set(k, next);
      return;
    }
  }
}

function isRegistered(agentId, connectionId) {
  const list = byAgent.get(String(agentId)) || [];
  return list.some(e => e.connectionId === connectionId);
}

function countForAgent(agentId) {
  return (byAgent.get(String(agentId)) || []).length;
}

/** 诊断用：全部注册项快照 */
function listAll() {
  const out = [];
  for (const [agentId, list] of byAgent.entries()) {
    list.forEach(e => out.push({ agentId, connectionId: e.connectionId, at: e.at }));
  }
  return out;
}

/** 测试用：清空注册表 */
function _reset() { byAgent.clear(); }

// ==================== 内部 ====================

function clampLimit(limit) {
  const n = parseInt(limit, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * 顶掉一条旧连接：标记 close 语义 + 立即取消其移动任务 + 4004 关闭 + 2s terminate 兜底 + 审计。
 * 状态标记 replacedBy 有两个作用：
 *   ① handleClose 据此走静默清理（不广播 PLAYER_LEFT）；
 *   ② handleMessage 据此忽略该连接的后续消息（防其在关闭握手期间重新启动移动，再次变成第二个位置源）。
 */
function evict(agentId, oldConnectionId, newConnectionId) {
  const states = deps.states;
  const state = states && states.get ? states.get(oldConnectionId) : null;
  if (state) {
    state.replacedBy = newConnectionId;
    try { if (deps.cancelAction) deps.cancelAction(oldConnectionId); } catch (e) { /* non-fatal */ }
    try { state.ws.close(4004, 'REPLACED_BY_NEW_CONNECTION'); } catch (e) { /* ignore */ }
    const t = setTimeout(() => { try { state.ws.terminate(); } catch (e) { /* ignore */ } }, 2000);
    if (t.unref) t.unref();
  }
  if (deps.audit) {
    try { deps.audit('ws_replaced', { agentId, oldConnectionId, newConnectionId }); } catch (e) { /* ignore */ }
  }
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  init,
  register,
  unregister,
  isRegistered,
  countForAgent,
  listAll,
  _reset
};
