/**
 * AI Agent 接入 - 会话管理（P1）
 * Agent JWT 每次签发落一行 agent_sessions（jti 唯一）；
 * 校验时以 DB 行为权威（jti 被吊销/过期即拒），JWT 本体验签只是第一道门。
 */

const { query } = require('../database/db');
const { SESSION_TTL_SECONDS } = require('./agentSchema');
const transientSessionManager = require('./agentTransientSessionManager');

// ==================== 签发 ====================

/**
 * 记录新会话（issueAgentJwt 之后调用）
 */
async function createSession({ agentId, jti, worldId, expiresAt }) {
  const result = await query(
    `INSERT INTO agent_sessions (agent_id, world_id, jti, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [agentId, worldId || null, jti, expiresAt]
  );
  return result.rows[0];
}

// ==================== 校验 ====================

/**
 * 校验 jti 对应会话是否有效
 * 返回 { ok, session, error }
 *
 * P5 扩展：若 jti 在 agent_sessions 表未命中，回落到 agent_transient_sessions 表
 * （跨世界 transient session，agentWsServer 鉴权时通过 session.isTransient 区分）
 */
async function verifySession(jti) {
  if (!jti) return { ok: false, error: 'missing_jti' };

  // 先查本世界普通 session
  const result = await query('SELECT * FROM agent_sessions WHERE jti = $1', [jti]);
  if (result.rows.length > 0) {
    const session = result.rows[0];
    if (session.status === 'revoked') {
      return { ok: false, session: { ...session, isTransient: false }, error: 'session_revoked' };
    }
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await markExpired(session.id);
      return { ok: false, session: { ...session, isTransient: false }, error: 'session_expired' };
    }
    return { ok: true, session: { ...session, isTransient: false } };
  }

  // P5 回落：transient session（跨世界）
  return await transientSessionManager.verifyTransientSession(jti);
}

/**
 * 刷新 last_seen（认证通过时调用，失败静默）
 * P5 扩展：transient session 走 transientSessionManager.touchTransientSession
 */
async function touchSession(sessionId, isTransient) {
  try {
    if (isTransient) {
      await transientSessionManager.touchTransientSession(sessionId);
      return;
    }
    await query('UPDATE agent_sessions SET last_seen = NOW() WHERE id = $1', [sessionId]);
  } catch (e) { /* non-fatal */ }
}

/**
 * 取该 Agent 最近一次落库的位置（用于"新会话继承位置"，缺陷 J）
 *
 * 背景：Agent 重连时通常要重新 POST /session（新 jti），新会话的 current_position 为空，
 * presenceBridge 便退回 (0,0,0) 当出生点 → 重连即瞬移回原点（真人看到 AI 突然消失又出现在原点）。
 * 这里让新连接继承该 Agent 上一次有效位置，实现"重连续位"。
 * 排除当前 jti；只认 current_position 非空且未吊销的行。
 */
async function getLatestPosition(agentId, excludeJti) {
  if (!agentId) return null;
  try {
    const result = await query(
      `SELECT current_position FROM agent_sessions
       WHERE agent_id = $1 AND current_position IS NOT NULL
         AND status <> 'revoked' AND ($2::text IS NULL OR jti <> $2)
       ORDER BY COALESCE(last_seen, issued_at) DESC LIMIT 1`,
      [agentId, excludeJti || null]
    );
    if (result.rows.length === 0) return null;
    const p = result.rows[0].current_position;
    const obj = typeof p === 'string' ? safeParse(p) : p;
    if (obj && Number.isFinite(obj.x) && Number.isFinite(obj.z)) {
      return { x: obj.x, y: Number.isFinite(obj.y) ? obj.y : 0, z: obj.z };
    }
  } catch (e) { /* non-fatal */ }
  return null;
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

/**
 * 更新 Agent 当前位置（移动服务每帧调用，失败静默）
 * 用于断线重连时从该位置恢复（agentMovementService publishPosition 时同步）
 * P5 扩展：transient session 走 transientSessionManager.updateTransientPosition
 */
async function updatePosition(sessionId, position, isTransient) {
  try {
    if (isTransient) {
      await transientSessionManager.updateTransientPosition(sessionId, position);
      return;
    }
    await query(
      'UPDATE agent_sessions SET current_position = $1, last_seen = NOW() WHERE id = $2',
      [JSON.stringify(position), sessionId]
    );
  } catch (e) { /* non-fatal */ }
}

// ==================== 吊销 ====================

/**
 * 按 jti 吊销会话
 */
async function revokeSession(jti) {
  const result = await query(
    `UPDATE agent_sessions SET status = 'revoked', revoked_at = NOW()
     WHERE jti = $1 AND status = 'active'
     RETURNING *`,
    [jti]
  );
  return result.rows[0] || null;
}

/**
 * 吊销某 Agent 全部活跃会话（Agent 被禁用时调用）
 */
async function revokeAllSessions(agentId) {
  const result = await query(
    `UPDATE agent_sessions SET status = 'revoked', revoked_at = NOW()
     WHERE agent_id = $1 AND status = 'active'`,
    [agentId]
  );
  return result.rowCount;
}

// ==================== 世界出生点（#3：让 AI 与真人落在同一区域）====================

/**
 * 世界出生点（真人进世界用的那个点，由后台"出生点"对象写入 system_config）。
 *
 * 背景（AI 访客体检 [5-5]）：原先 AI 无历史位置时兜底 `(0,0,0)`，而真人出生点是
 * `system_config('world_spawn_point')`（线上实测 `{x:-26.32, y:9.59, z:12.56}`），
 * 两者相距 **31.22m —— 恰好超出 30m 的 observe 半径与 30m 的说话气泡半径**：
 * AI 进世界第一眼 `observe` 是"附近 0 个人"，`say` 一句回执还是 `delivered:true`
 * 但真人听不见 → AI 判定"这是个空世界"（而且它自查不出来）。
 *
 * ⚠️ **不做缓存**：出生点在后台随时可改，而真人前端是"每次进世界都请求一次
 * `GET /api/world/spawn-point`"（`public/js/world.js` 的 loadAndAddSpawnPoint）——
 * 用户明确要求"出生点改到哪里，AI 就要跟到哪里"。AI 只在**新建连接**时读一次，频率极低，
 * 直接查库即可，保证与真人**同频**。（首版加了 60s 缓存，会让改完出生点之后的 AI 最多晚 1 分钟才跟上。）
 *
 * 配置缺失 / 非法时，返回与**真人前端完全相同的默认值** `{x:0, y:0.05, z:0}`
 * （真人侧两处都是这个默认值：`public/js/world.js` 的 `spawnConfig` 初值与
 * `routes/world.js` 的 `GET /spawn-point` 兜底）。首版在这里返回 null、调用方再兜 `(0,0,0)`，
 * 与真人不一致。
 *
 * y 直接用配置值：真人也从这个点进来，前端对 Agent 有既有的贴地逻辑会自行修正。
 */
const DEFAULT_SPAWN = { x: 0, y: 0.05, z: 0 };

async function getWorldSpawnPoint() {
  try {
    const r = await query(
      `SELECT config_value FROM system_config WHERE config_key = 'world_spawn_point'`
    );
    if (r.rows.length > 0 && r.rows[0].config_value != null) {
      const raw = r.rows[0].config_value;
      const cfg = (typeof raw === 'object') ? raw : safeParse(raw);
      const p = cfg && cfg.position ? cfg.position : null;
      const x = p ? Number(p.x) : NaN;
      const z = p ? Number(p.z) : NaN;
      if (Number.isFinite(x) && Number.isFinite(z)) {
        const y = Number(p.y);
        return { x, y: Number.isFinite(y) ? y : DEFAULT_SPAWN.y, z };
      }
    }
  } catch (e) { /* non-fatal：DB 不可用 → 用默认值，仍然与真人一致 */ }
  return { ...DEFAULT_SPAWN };
}

/**
 * 在出生点周围 ≤radius 米内取一个随机点（圆盘内均匀分布）。
 * 为什么需要：出生点若完全一致，**多个 AI 同时进世界会重叠在同一点**
 * （Agent 之间本就没有避让机制，属已知遗留）。
 */
function randomizeSpawn(spawn, radius = 3) {
  if (!spawn) return spawn;
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.sqrt(Math.random()) * radius;
  return {
    x: Number((spawn.x + Math.cos(angle) * dist).toFixed(2)),
    y: spawn.y,
    z: Number((spawn.z + Math.sin(angle) * dist).toFixed(2))
  };
}

/**
 * 新连接"没有历史位置"时使用的出生点 = 世界出生点 + ≤3m 随机偏移。
 * 调用方（agentWsServer）的兜底链：getLatestPosition() → 本函数 → (0,0,0)
 */
async function getInitialSpawn(jitterRadius = 3) {
  const base = await getWorldSpawnPoint();
  // getWorldSpawnPoint 现在恒返回一个点（配置缺失时是默认值），因此这里不会返回 null；
  // randomizeSpawn 内部仍保留 null 保护，调用方也保留最后一层兜底，互不耦合。
  return randomizeSpawn(base, jitterRadius);
}

// ==================== 维护 ====================

async function markExpired(sessionId) {
  try {
    await query(`UPDATE agent_sessions SET status = 'expired' WHERE id = $1 AND status = 'active'`, [sessionId]);
  } catch (e) { /* non-fatal */ }
}

/**
 * 清理过期会话行（保留 7 天内记录供审计）
 */
async function cleanupExpiredSessions() {
  const result = await query(
    `DELETE FROM agent_sessions WHERE expires_at < NOW() - INTERVAL '7 days'`
  );
  return result.rowCount;
}

module.exports = {
  SESSION_TTL_SECONDS,
  createSession,
  verifySession,
  touchSession,
  updatePosition,
  getLatestPosition,
  // #3 AI 出生点对齐真人区域（getInitialSpawn = 世界出生点 + ≤3m 随机偏移）
  getWorldSpawnPoint,
  randomizeSpawn,
  getInitialSpawn,
  revokeSession,
  revokeAllSessions,
  cleanupExpiredSessions
};
