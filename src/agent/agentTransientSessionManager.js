/**
 * AI Agent 接入 - 跨世界 transient 会话管理（P5）
 * 独立于 agent_sessions 表（后者 agent_id 有外键约束 agents(id)，
 * 跨世界 Agent 在本地无 agents 行，无法复用）。
 *
 * 红线 c：transient session 不创建本地 user/character 记录；
 * 本表过期自动清理，不持久化 Agent 主体。
 * 红线 e：handoff token ≤5min，但目标世界签发的 transient Agent JWT 15min（可续期/重连）。
 */

const { query } = require('../database/db');
const {
  AGENT_TRANSIENT_SESSION_TTL_SECONDS,
  GUEST_SOURCE_WORLD_MARK,
  AGENT_TIER_GUEST,
  AGENT_TIER_KEY
} = require('./agentSchema');

// ==================== 创建 ====================

/**
 * 创建 transient session（acceptTeleport 验证 handoff token 后调用）
 * @param {object} params
 *   jti, sourceWorldId, sourceWorldName, sourceWorldUrl,
 *   agentId (合成 ID agent:<uuid>), agentName, avatarConfig (object),
 *   homeWorldUrl, initialPosition ({x,y,z}), expiresAt (ISO)
 */
async function createTransientSession(params) {
  const expiresAt = params.expiresAt || new Date(Date.now() + AGENT_TRANSIENT_SESSION_TTL_SECONDS * 1000).toISOString();
  const result = await query(
    `INSERT INTO agent_transient_sessions
       (jti, source_world_id, source_world_name, source_world_url,
        agent_id, agent_name, avatar_config, home_world_url,
        initial_position, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      params.jti,
      params.sourceWorldId,
      params.sourceWorldName || null,
      params.sourceWorldUrl || null,
      params.agentId,
      params.agentName,
      JSON.stringify(params.avatarConfig || {}),
      params.homeWorldUrl || null,
      JSON.stringify(params.initialPosition || { x: 0, y: 0, z: 0 }),
      expiresAt
    ]
  );
  return result.rows[0];
}

/**
 * P8：创建游客会话（拉模式）
 * 复用 agent_transient_sessions（无 agents 外键），以 source_world_id = 'guest-pull' 标记。
 * 不创建 agents 行、不创建 user/character —— 游客刷新即得新身份，零残留。
 */
async function createGuestSession({ jti, agentId, agentName, expiresAt }) {
  const result = await query(
    `INSERT INTO agent_transient_sessions
       (jti, source_world_id, agent_id, agent_name, avatar_config, initial_position, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      jti,
      GUEST_SOURCE_WORLD_MARK,
      agentId,
      agentName,
      JSON.stringify({}),
      JSON.stringify({ x: 0, y: 0, z: 0 }),
      expiresAt
    ]
  );
  return result.rows[0];
}

// ==================== 校验 ====================

/**
 * 按 jti 校验 transient session 是否有效
 * 返回 { ok, session, error }
 * session 行附带 isTransient:true 标记，供 agentWsServer 鉴权分支识别
 */
async function verifyTransientSession(jti) {
  if (!jti) return { ok: false, error: 'missing_jti' };
  const result = await query('SELECT * FROM agent_transient_sessions WHERE jti = $1', [jti]);
  if (result.rows.length === 0) {
    return { ok: false, error: 'session_not_found' };
  }
  const session = result.rows[0];

  if (session.status === 'revoked') {
    return { ok: false, session: { ...session, isTransient: true }, error: 'session_revoked' };
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await markExpired(session.id);
    return { ok: false, session: { ...session, isTransient: true }, error: 'session_expired' };
  }
  return { ok: true, session: { ...session, isTransient: true } };
}

/**
 * 刷新 last_seen
 */
async function touchTransientSession(sessionId) {
  try {
    await query('UPDATE agent_transient_sessions SET last_seen = NOW() WHERE id = $1', [sessionId]);
  } catch (e) { /* non-fatal */ }
}

/**
 * 更新 Agent 当前位置（移动服务每帧调用，断线重连恢复）
 */
async function updateTransientPosition(sessionId, position) {
  try {
    await query(
      'UPDATE agent_transient_sessions SET current_position = $1, last_seen = NOW() WHERE id = $2',
      [JSON.stringify(position), sessionId]
    );
  } catch (e) { /* non-fatal */ }
}

// ==================== 吊销 ====================

async function revokeTransientSession(jti) {
  const result = await query(
    `UPDATE agent_transient_sessions SET status = 'revoked', revoked_at = NOW()
     WHERE jti = $1 AND status = 'active'
     RETURNING *`,
    [jti]
  );
  return result.rows[0] || null;
}

/**
 * 吊销某 Agent 全部活跃 transient session（Agent 在源世界被禁用时，目标世界无法感知；
 * 此函数供管理员手动清理用）
 */
async function revokeAllTransientSessions(agentId) {
  const result = await query(
    `UPDATE agent_transient_sessions SET status = 'revoked', revoked_at = NOW()
     WHERE agent_id = $1 AND status = 'active'`,
    [agentId]
  );
  return result.rowCount;
}

// ==================== 维护 ====================

async function markExpired(sessionId) {
  try {
    await query(`UPDATE agent_transient_sessions SET status = 'expired' WHERE id = $1 AND status = 'active'`, [sessionId]);
  } catch (e) { /* non-fatal */ }
}

/**
 * 清理过期 transient session 行（保留 7 天内记录供审计）
 */
async function cleanupExpiredTransientSessions() {
  const result = await query(
    `DELETE FROM agent_transient_sessions WHERE expires_at < NOW() - INTERVAL '7 days'`
  );
  return result.rowCount;
}

// ==================== 诊断 ====================

/**
 * 从 transient session 行构造 agent profile（供 agentWsServer 鉴权后用）
 * 字段口径与 agentManager.getAgentById 返回一致
 */
function buildAgentProfile(session) {
  if (!session) return null;
  const avatarConfig = typeof session.avatar_config === 'string'
    ? safeParse(session.avatar_config) : session.avatar_config;
  // P8：source_world_id = 'guest-pull' 的会话是游客拉模式（无 Key 公开签票）
  const isGuest = session.source_world_id === GUEST_SOURCE_WORLD_MARK;
  return {
    id: session.agent_id,                  // 合成 ID agent:<uuid>
    name: session.agent_name,
    status: 'active',                       // transient session 存在即视为 active
    description: null,
    avatar_config: avatarConfig || {},
    can_teleport: false,                    // 红线：transient session 不允许链式传送
    home_world_url: session.home_world_url,
    _transient: true,                       // 标记，供日志/审计区分
    _guest: isGuest,                        // P8：游客拉模式标记
    _tier: isGuest ? AGENT_TIER_GUEST : AGENT_TIER_KEY,
    _sourceWorldId: session.source_world_id,
    _sourceWorldName: session.source_world_name
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

module.exports = {
  createTransientSession,
  createGuestSession,
  verifyTransientSession,
  touchTransientSession,
  updateTransientPosition,
  revokeTransientSession,
  revokeAllTransientSessions,
  cleanupExpiredTransientSessions,
  buildAgentProfile
};
