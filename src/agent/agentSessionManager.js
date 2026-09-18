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
  revokeSession,
  revokeAllSessions,
  cleanupExpiredSessions
};
