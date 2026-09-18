/**
 * AI Agent 接入 - 协议常量与参数校验（P1）
 * 独立于用户体系，Agent 主键为合成 ID `agent:<uuid>`（红线：防与真人 UUID 撞键）
 */

// ==================== 协议常量 ====================

const AGENT_ID_PREFIX = 'agent:';                 // 合成 ID 前缀
const API_KEY_PREFIX = 'agk_live_';               // API Key 前缀
const API_KEY_RANDOM_BYTES = 32;                  // 32B 随机 → 64 hex 字符
const API_KEY_PREFIX_DISPLAY_LEN = 16;            // key_prefix 保留长度（后台识别）

const SESSION_TTL_SECONDS = 15 * 60;              // Agent JWT 有效期 15min
const SESSION_RATE_LIMIT_PER_MIN = 10;            // POST /session 每 IP 上限（红线11）

// P5: Agent 跨世界联邦传送 handoff token 有效期（红线 e：≤5 分钟）
const AGENT_TELEPORT_TOKEN_TTL_SECONDS = 5 * 60;   // 5min
// transient session 在目标世界的有效期（与普通 Agent JWT 一致 15min，可续期）
const AGENT_TRANSIENT_SESSION_TTL_SECONDS = SESSION_TTL_SECONDS;
// nonce 清理保留期（已过期 token 的 nonce 无意义，保留 7 天供审计）
const NONCE_RETENTION_DAYS = 7;

const JWT_PAYLOAD_PRINCIPAL = 'agent';            // principalType，与用户 JWT 严格区分

// ==================== 游客级 scope 白名单（红线2）====================
// Agent 与人共用一套准则：允许 observe/move/rotate/jump/say/interact
// 禁止 teleport / set_position / 背包 / 资料 / 商城 —— 权限集里根本没有，收到即拒
const AGENT_SCOPES = [
  'observe',
  'move',
  'rotate',
  'jump',
  'say',
  'interact'
];

// 永远不允许出现在 scope 中的动作（防御性校验用）
const FORBIDDEN_SCOPES = [
  'teleport',
  'set_position',
  'inventory',
  'profile',
  'shop'
];

// ==================== 基础校验 ====================

/**
 * 校验 API Key 格式（不校验有效性）
 */
function isValidApiKeyFormat(key) {
  if (typeof key !== 'string') return false;
  return key.startsWith(API_KEY_PREFIX) && /^[a-f0-9]{64}$/.test(key.slice(API_KEY_PREFIX.length));
}

/**
 * 校验 Agent 名称
 */
function isValidAgentName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 100;
}

/**
 * 从 Authorization header 提取 Bearer token
 */
function extractBearerToken(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  const token = parts[1].trim();
  return token || null;
}

/**
 * 生成合成 ID：agent:<uuid>
 */
function buildAgentId(uuid) {
  return AGENT_ID_PREFIX + uuid;
}

/**
 * 从合成 ID 还原裸 uuid
 */
function stripAgentIdPrefix(agentId) {
  if (typeof agentId === 'string' && agentId.startsWith(AGENT_ID_PREFIX)) {
    return agentId.slice(AGENT_ID_PREFIX.length);
  }
  return agentId;
}

module.exports = {
  AGENT_ID_PREFIX,
  API_KEY_PREFIX,
  API_KEY_RANDOM_BYTES,
  API_KEY_PREFIX_DISPLAY_LEN,
  SESSION_TTL_SECONDS,
  SESSION_RATE_LIMIT_PER_MIN,
  JWT_PAYLOAD_PRINCIPAL,
  AGENT_TELEPORT_TOKEN_TTL_SECONDS,
  AGENT_TRANSIENT_SESSION_TTL_SECONDS,
  NONCE_RETENTION_DAYS,
  AGENT_SCOPES,
  FORBIDDEN_SCOPES,
  isValidApiKeyFormat,
  isValidAgentName,
  extractBearerToken,
  buildAgentId,
  stripAgentIdPrefix
};
