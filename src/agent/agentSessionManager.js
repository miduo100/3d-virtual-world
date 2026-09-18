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
  revokeSession,
  revokeAllSessions,
  cleanupExpiredSessions
};
