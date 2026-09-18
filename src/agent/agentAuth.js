/**
 * AI Agent 接入 - 认证模块（P1）
 * API Key：agk_live_ + 32B 随机（只存 bcrypt hash）
 * Agent JWT：独立密钥 AGENT_JWT_SECRET（未配置时拒绝 Agent 功能，不与用户 JWT 混用）
 * payload: { sub: agentId, principalType: 'agent', worldId, scopes, iat, exp, jti }
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');
const {
  API_KEY_PREFIX,
  API_KEY_RANDOM_BYTES,
  API_KEY_PREFIX_DISPLAY_LEN,
  SESSION_TTL_SECONDS,
  AGENT_TRANSIENT_SESSION_TTL_SECONDS,
  JWT_PAYLOAD_PRINCIPAL
} = require('./agentSchema');

const BCRYPT_ROUNDS = 10;

// ==================== 密钥配置 ====================

function getSecret() {
  return process.env.AGENT_JWT_SECRET || null;
}

/**
 * AGENT_JWT_SECRET 是否已配置（未配置时全部 Agent 接口拒绝，启动时告警）
 */
function isConfigured() {
  return Boolean(getSecret() && getSecret().length >= 16);
}

// ==================== API Key ====================

/**
 * 生成新 API Key（明文只在创建时返回一次）
 * 返回 { key, keyHash, keyPrefix }
 */
function generateApiKey() {
  const random = crypto.randomBytes(API_KEY_RANDOM_BYTES).toString('hex');
  const key = API_KEY_PREFIX + random;               // agk_live_<64 hex>
  const keyPrefix = key.slice(0, API_KEY_PREFIX_DISPLAY_LEN);
  const keyHash = bcrypt.hashSync(key, BCRYPT_ROUNDS);
  return { key, keyHash, keyPrefix };
}

/**
 * 校验 API Key 明文与 hash
 */
function verifyApiKey(key, keyHash) {
  try {
    return bcrypt.compareSync(key, keyHash);
  } catch (e) {
    return false;
  }
}

// ==================== Agent JWT ====================

/**
 * 签发短期 Agent JWT（15min，jti 唯一）
 * 返回 { token, jti, expiresAt(ISO), payload }
 */
function issueAgentJwt(agent, scopes, worldId) {
  if (!isConfigured()) {
    throw new Error('AGENT_JWT_SECRET not configured');
  }
  const jti = uuidv4();
  const payload = {
    sub: agent.id,                    // agents 表 UUID
    name: agent.name,
    principalType: JWT_PAYLOAD_PRINCIPAL,
    worldId: worldId || null,
    scopes: scopes || []
  };
  const token = jwt.sign(payload, getSecret(), {
    expiresIn: SESSION_TTL_SECONDS,
    jwtid: jti
  });
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  return { token, jti, expiresAt, payload };
}

/**
 * 校验 Agent JWT（仅验签与格式，session 状态由 agentSessionManager 检查）
 * 返回 { ok, payload, error }
 *
 * 注意：transient Agent JWT（P5 跨世界）与本世界 Agent JWT 共用 AGENT_JWT_SECRET 验签；
 * 区分靠 payload.isTransient 字段，session 校验时 agentSessionManager 会查对应表。
 */
function verifyAgentJwt(token) {
  if (!isConfigured()) {
    return { ok: false, error: 'agent_secret_not_configured' };
  }
  try {
    const payload = jwt.verify(token, getSecret());
    if (payload.principalType !== JWT_PAYLOAD_PRINCIPAL) {
      return { ok: false, error: 'not_agent_token' };
    }
    return { ok: true, payload };
  } catch (err) {
    if (err.name === 'TokenExpiredError') return { ok: false, error: 'token_expired' };
    if (err.name === 'JsonWebTokenError') return { ok: false, error: 'invalid_token' };
    return { ok: false, error: 'token_verify_failed' };
  }
}

// ==================== Transient Agent JWT（P5 跨世界联邦传送）====================

/**
 * 签发目标世界的 transient Agent JWT（acceptTeleport 验证 handoff token 后调用）
 * 与普通 Agent JWT 区别：
 *   - payload.isTransient = true（agentWsServer 鉴权时识别走 transient session 路径）
 *   - sub = 源世界 agentId（本地无 agents 行，agentManager.getAgentById 会返回 null）
 *   - 不挂载 scopes（transient session 用游客准则隐式约束，scope 系统照常工作）
 *   - TTL 与普通 session 一致（15min，可续期/重连）
 * 返回 { token, jti, expiresAt(ISO), payload }
 */
function issueTransientAgentJwt({ agentId, agentName, worldId }) {
  if (!isConfigured()) {
    throw new Error('AGENT_JWT_SECRET not configured');
  }
  const jti = uuidv4();
  const payload = {
    sub: agentId,                    // 源世界 Agent 合成 ID（agent:<uuid>）
    name: agentName,
    principalType: JWT_PAYLOAD_PRINCIPAL,
    worldId: worldId || null,
    isTransient: true,               // P5 标记：agentWsServer 识别走 transient session 路径
    scopes: []                        // transient session 不显式发 scope，行为层用游客准则
  };
  const token = jwt.sign(payload, getSecret(), {
    expiresIn: AGENT_TRANSIENT_SESSION_TTL_SECONDS,
    jwtid: jti
  });
  const expiresAt = new Date(Date.now() + AGENT_TRANSIENT_SESSION_TTL_SECONDS * 1000).toISOString();
  return { token, jti, expiresAt, payload };
}

// ==================== 世界身份 ====================

let worldIdCache = null;

/**
 * 读取本世界 ID（world_config.federation_config JSON），缓存 60s
 */
async function getWorldId() {
  if (worldIdCache && Date.now() - worldIdCache.at < 60000) {
    return worldIdCache.value;
  }
  try {
    const result = await query(`SELECT value FROM world_config WHERE key = 'federation_config'`);
    let value = null;
    if (result.rows.length > 0) {
      const cfg = JSON.parse(result.rows[0].value);
      value = cfg.worldId || null;
    }
    worldIdCache = { value, at: Date.now() };
    return value;
  } catch (e) {
    return null;
  }
}

module.exports = {
  isConfigured,
  generateApiKey,
  verifyApiKey,
  issueAgentJwt,
  issueTransientAgentJwt,
  verifyAgentJwt,
  getWorldId,
  SESSION_TTL_SECONDS
};
