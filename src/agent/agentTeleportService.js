/**
 * AI Agent 接入 - 跨世界联邦传送服务（P5 核心）
 *
 * 红线遵守（逐条落实）：
 *   a. federation.js / federationSystem.js 黑名单零追加：本模块只读调用
 *      federationSystem 的 trustedWorlds / worldId / worldName / worldUrl / privateKey / publicKey；
 *      不调用 generateTeleportToken / verifyTeleportToken（人类口径含 email/role）。
 *   b. 现有人类传送链路一行不动：Agent 传送全部走本模块 + routes/agentFederation.js。
 *   c. principalType:'agent' + transient session：handoff token payload 用 agentId/avatarConfig/
 *      homeWorld，不含 email/userId；接收端建 transient session（agent_transient_sessions 表），
 *      不创建本地 user/character 记录。
 *   d. nonce 一次性消费：token_usage 表，INSERT ON CONFLICT 原子消费，重放被拒。
 *   e. handoff token ≤5min + iss/aud 校验：RS256 签名 iss=源worldId aud=目标worldId；
 *      agentId/avatarConfig/homeWorld 完整传递。
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');
const {
  AGENT_TELEPORT_TOKEN_TTL_SECONDS,
  JWT_PAYLOAD_PRINCIPAL
} = require('./agentSchema');
const transientSessionManager = require('./agentTransientSessionManager');
const agentAuth = require('./agentAuth');
const agentManager = require('./agentManager');

// ==================== federationSystem 单例（懒加载） ====================

/**
 * federationSystem 单例在 routes/federation.js 内部异步初始化（initFederation），
 * 模块加载时可能尚未赋值，故每次调用时 require + getFederationSystem 拿当前值。
 * 这是只读访问，不追加任何代码到 federationSystem.js（红线 a）。
 */
function getFederationSystem() {
  // require 缓存返回同一实例，getFederationSystem() 返回闭包变量 federationSystem
  return require('../routes/federation').getFederationSystem();
}

// ==================== handoff token 签发（源世界，Agent 发起传送） ====================

/**
 * Agent 发起跨世界联邦传送
 * @param {object} agent   - agents 表行（需含 can_teleport/avatar_config/home_world_url）
 * @param {string} targetWorldId - 目标世界 ID（须在本世界 trustedWorlds 中）
 * @param {object} context - { position?, customData? }
 * @returns {Promise<{handoffToken, nonce, targetWorldUrl, targetWorldName, expiresAt}>}
 *
 * 红线：
 *   - agent.can_teleport 必须为 true（红线 3 字段，管理员显式开启）
 *   - 不调用 federationSystem.generateTeleportToken（人类口径含 email/role）
 *   - payload 含 principalType:'agent' + agentId + avatarConfig + homeWorld（红线 c/e）
 */
async function prepareTeleport(agent, targetWorldId, context = {}) {
  const fed = getFederationSystem();
  if (!fed) {
    throw new Error('联邦系统未初始化');
  }

  // 红线 3：can_teleport 必须显式开启（默认 false）
  if (!agent || agent.can_teleport !== true) {
    const err = new Error('Agent 未获授权使用联邦传送（can_teleport=false）');
    err.code = 'AGENT_TELEPORT_NOT_PERMITTED';
    throw err;
  }

  // 目标世界须在 trustedWorlds（红线 a：只读调用）
  const targetWorld = fed.trustedWorlds.get(targetWorldId);
  if (!targetWorld) {
    const err = new Error(`未信任的目标世界: ${targetWorldId}`);
    err.code = 'TARGET_WORLD_NOT_TRUSTED';
    throw err;
  }

  // 签发前先落 nonce（INSERT ON CONFLICT DO NOTHING 原子占用）
  // 若 nonce 已存在（极小概率 16B 随机撞），重签一次
  const nonce = crypto.randomBytes(16).toString('hex');
  const nonceInserted = await tryInsertNonce({
    nonce,
    principalType: JWT_PAYLOAD_PRINCIPAL,
    subjectId: agent.id,
    sourceWorldId: fed.worldId,
    targetWorldId
  });
  if (!nonceInserted) {
    // 重签一次（16B 随机撞概率 ~2^-128，正常不会到这里）
    const nonce2 = crypto.randomBytes(16).toString('hex');
    const ok2 = await tryInsertNonce({
      nonce: nonce2,
      principalType: JWT_PAYLOAD_PRINCIPAL,
      subjectId: agent.id,
      sourceWorldId: fed.worldId,
      targetWorldId
    });
    if (!ok2) throw new Error('nonce 占用失败（极小概率重试仍撞，请重试）');
    return buildHandoff(agent, fed, targetWorld, nonce2, context);
  }

  return buildHandoff(agent, fed, targetWorld, nonce, context);
}

async function buildHandoff(agent, fed, targetWorld, nonce, context) {
  // 红线 c/e：payload principalType:'agent' + agentId + avatarConfig + homeWorld
  // 红线 e：iss=源worldId aud=targetWorldId ≤5min
  const avatarConfig = agentManager.shapeAvatar(agent);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    principalType: JWT_PAYLOAD_PRINCIPAL,
    agentId: agent.id,
    agentName: agent.name,
    avatarConfig,
    homeWorldUrl: agent.home_world_url || fed.worldUrl,
    sourceWorldId: fed.worldId,
    sourceWorldName: fed.worldName,
    sourceWorldUrl: fed.worldUrl,
    targetWorldId: targetWorld.worldId,
    context: {
      position: context.position || { x: 0, y: 0, z: 0 },
      customData: context.customData || {}
    },
    iat: now,
    exp: now + AGENT_TELEPORT_TOKEN_TTL_SECONDS,
    nonce
  };

  // RS256 签名（红线 a：只读 federationSystem.privateKey，不追加代码）
  const handoffToken = jwt.sign(payload, fed.privateKey, {
    algorithm: 'RS256',
    issuer: fed.worldId,
    audience: targetWorld.worldId
  });

  const expiresAt = new Date((now + AGENT_TELEPORT_TOKEN_TTL_SECONDS) * 1000).toISOString();

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    scope: 'agent-teleport',
    event: 'prepare_handoff',
    agent: agent.name,
    agentId: agent.id,
    sourceWorld: fed.worldId,
    targetWorld: targetWorld.worldId,
    nonce,
    expiresAt
  }));

  return {
    handoffToken,
    nonce,
    targetWorldUrl: targetWorld.worldUrl,
    targetWorldName: targetWorld.worldName,
    targetWorldId: targetWorld.worldId,
    expiresAt
  };
}

// ==================== handoff token 验证（目标世界接收） ====================

/**
 * 目标世界接收 Agent 联邦传送
 * @param {string} handoffToken - 源世界签发的 RS256 handoff token
 * @returns {Promise<{ok, agentProfile?, transientSession?, transientJwt?, error?}>}
 *
 * 流程：
 *   1. 解码拿 iss → trustedWorlds 拿源世界 publicKey（红线 a 只读）
 *   2. RS256 验签 + iss/aud 校验（红线 e）
 *   3. 校验 principalType === 'agent'（红线 c）
 *   4. nonce 一次性消费（红线 d）：INSERT ON CONFLICT DO NOTHING；
 *      若已消费 → 拒。注意：nonce 在签发时已落库，这里用"目标世界 token_usage 表"
 *      再消费一次——但源世界和目标世界是不同数据库！
 *      实际语义：源世界签发时落 nonce 防源世界重放；目标世界接收时也落 nonce
 *      防目标世界重放（同一 token 不能被两个目标世界接收，也不能被同一目标世界接收两次）。
 *   5. 创建 transient session（agent_transient_sessions 表，红线 c 不建 user/character）
 *   6. 签发目标世界的 transient Agent JWT（isTransient:true，agentWsServer 识别走 transient 路径）
 */
async function acceptTeleport(handoffToken) {
  const fed = getFederationSystem();
  if (!fed) {
    return { ok: false, error: '联邦系统未初始化' };
  }

  // 1. 解码拿 iss（不验签，先拿 iss 找 publicKey）
  const decoded = jwt.decode(handoffToken, { complete: true });
  if (!decoded || !decoded.payload) {
    return { ok: false, error: '无效的 handoff token 格式', code: 'BAD_TOKEN' };
  }
  const payload = decoded.payload;
  const sourceWorldId = payload.iss;
  const sourceWorld = fed.trustedWorlds.get(sourceWorldId);
  if (!sourceWorld) {
    return { ok: false, error: `未信任的源世界: ${sourceWorldId}`, code: 'SOURCE_WORLD_NOT_TRUSTED' };
  }

  // 2. RS256 验签 + iss/aud 校验（红线 e）
  let verified;
  try {
    verified = jwt.verify(handoffToken, sourceWorld.publicKey, {
      algorithms: ['RS256'],
      issuer: sourceWorldId,
      audience: fed.worldId
    });
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'HANDOFF_TOKEN_EXPIRED' : 'HANDOFF_TOKEN_INVALID';
    return { ok: false, error: err.message, code };
  }

  // 3. 校验 principalType（红线 c）
  if (verified.principalType !== JWT_PAYLOAD_PRINCIPAL) {
    return { ok: false, error: 'principalType 不是 agent，拒绝接收', code: 'NOT_AGENT_HANDOFF' };
  }

  // 4. nonce 一次性消费（红线 d）
  //    签发时源世界已落 nonce；此处目标世界再消费一次，防同一 token 被本世界重复接收
  const nonceConsumed = await tryInsertNonce({
    nonce: verified.nonce,
    principalType: JWT_PAYLOAD_PRINCIPAL,
    subjectId: verified.agentId,
    sourceWorldId: verified.sourceWorldId,
    targetWorldId: fed.worldId
  });
  if (!nonceConsumed) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      scope: 'agent-teleport',
      event: 'nonce_replay_rejected',
      nonce: verified.nonce,
      agentId: verified.agentId,
      sourceWorld: verified.sourceWorldId
    }));
    return { ok: false, error: 'handoff token nonce 已被消费（重放攻击或重复接收）', code: 'NONCE_REPLAY' };
  }

  // 5. 创建 transient session（红线 c：不建本地 user/character）
  const transientJwt = agentAuth.issueTransientAgentJwt({
    agentId: verified.agentId,
    agentName: verified.agentName,
    worldId: fed.worldId
  });

  const transientSession = await transientSessionManager.createTransientSession({
    jti: transientJwt.jti,
    sourceWorldId: verified.sourceWorldId,
    sourceWorldName: verified.sourceWorldName,
    sourceWorldUrl: verified.sourceWorldUrl,
    agentId: verified.agentId,
    agentName: verified.agentName,
    avatarConfig: verified.avatarConfig || {},
    homeWorldUrl: verified.homeWorldUrl,
    initialPosition: verified.context && verified.context.position,
    expiresAt: transientJwt.expiresAt
  });

  // 6. 构造 agent profile（供调用方/审计用，agentWsServer 鉴权时从 transient session 重建）
  const agentProfile = transientSessionManager.buildAgentProfile(transientSession);

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    scope: 'agent-teleport',
    event: 'accept_handoff',
    agent: verified.agentName,
    agentId: verified.agentId,
    sourceWorld: verified.sourceWorldId,
    targetWorld: fed.worldId,
    jti: transientJwt.jti,
    nonce: verified.nonce
  }));

  return {
    ok: true,
    agentProfile,
    transientSession,
    transientJwt: transientJwt.token,
    transientJti: transientJwt.jti,
    transientExpiresAt: transientJwt.expiresAt,
    agentId: verified.agentId,
    agentName: verified.agentName,
    avatarConfig: verified.avatarConfig,
    homeWorldUrl: verified.homeWorldUrl,
    sourceWorld: {
      id: verified.sourceWorldId,
      name: verified.sourceWorldName,
      url: verified.sourceWorldUrl
    }
  };
}

// ==================== nonce 原子消费 ====================

/**
 * 原子插入 nonce：INSERT ON CONFLICT DO NOTHING
 * 返回 true 表示新插入（消费成功），false 表示已存在（重放）
 */
async function tryInsertNonce({ nonce, principalType, subjectId, sourceWorldId, targetWorldId }) {
  try {
    const result = await query(
      `INSERT INTO token_usage (nonce, principal_type, subject_id, source_world_id, target_world_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (nonce) DO NOTHING
       RETURNING nonce`,
      [nonce, principalType, subjectId || null, sourceWorldId || null, targetWorldId || null]
    );
    return result.rows.length > 0;
  } catch (e) {
    console.error('[AgentTeleport] nonce 插入失败:', e.message);
    return false;
  }
}

// ==================== 维护 ====================

/**
 * 清理过期 nonce（保留 7 天供审计，之后清除）
 */
async function cleanupExpiredNonces() {
  try {
    const result = await query(
      `DELETE FROM token_usage WHERE used_at < NOW() - INTERVAL '7 days'`
    );
    return result.rowCount;
  } catch (e) {
    console.error('[AgentTeleport] nonce 清理失败:', e.message);
    return 0;
  }
}

/**
 * 清理过期 transient session（委托给 transientSessionManager）
 */
async function cleanupExpiredTransientSessions() {
  return await transientSessionManager.cleanupExpiredTransientSessions();
}

// ==================== 诊断 ====================

/**
 * 检查 nonce 是否已被消费（诊断用，不消费）
 */
async function isNonceConsumed(nonce) {
  const result = await query('SELECT 1 FROM token_usage WHERE nonce = $1', [nonce]);
  return result.rows.length > 0;
}

module.exports = {
  prepareTeleport,
  acceptTeleport,
  tryInsertNonce,
  isNonceConsumed,
  cleanupExpiredNonces,
  cleanupExpiredTransientSessions
};
