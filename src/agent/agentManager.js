/**
 * AI Agent 接入 - Agent 主体管理（P1）
 * agents / agent_api_keys 表 CRUD。
 * Agent 的创建/删除属管理操作，P1 阶段无后台 UI，由 scripts/agent_create_test.js
 * （测试）调用；P3 后台卡片接入时可复用本模块。
 */

const { query } = require('../database/db');
const agentAuth = require('./agentAuth');
const {
  isValidAgentName,
  AGENT_PUSH_TIERS,
  AGENT_PUSH_TIER_INHERIT
} = require('./agentSchema');

// ==================== Agent 主体 ====================

/**
 * 档位规范化：非法值一律兜底为 inherit（跟随全局默认档）
 */
function normalizePushTier(tier) {
  const v = String(tier === undefined || tier === null ? '' : tier).trim();
  return (v === AGENT_PUSH_TIER_INHERIT || AGENT_PUSH_TIERS.includes(v)) ? v : AGENT_PUSH_TIER_INHERIT;
}

/**
 * 解析生效档位：inherit 时回落到全局默认档
 */
function resolvePushTier(agentPushTier, globalDefault) {
  const v = String(agentPushTier || AGENT_PUSH_TIER_INHERIT);
  return v === AGENT_PUSH_TIER_INHERIT ? (globalDefault || 'eco') : v;
}

/**
 * 创建 Agent（同名拒绝）
 * avatarConfig: { glbUrl, animUrls, weaponConfig, boneMapConfig, weaponSocketConfig, calibrationConfig }
 * pushTier: inherit | eco | standard | realtime（默认 inherit = 跟随全局默认档）
 * 返回 { agent, apiKey(明文，仅此一次) }
 */
async function createAgent({ name, description, homeWorldUrl, avatarConfig, pushTier }) {
  if (!isValidAgentName(name)) {
    throw new Error('Agent 名称须为 2-100 字符');
  }

  const exists = await query('SELECT id FROM agents WHERE name = $1', [name.trim()]);
  if (exists.rows.length > 0) {
    throw new Error(`Agent 已存在: ${name}`);
  }

  const result = await query(
    `INSERT INTO agents (name, description, home_world_url, avatar_config, push_tier)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      name.trim(),
      description || null,
      homeWorldUrl || null,
      JSON.stringify(avatarConfig || {}),
      normalizePushTier(pushTier)
    ]
  );
  const agent = result.rows[0];

  // 创建即发一把 API Key
  const apiKey = await createApiKey(agent.id);
  return { agent, apiKey };
}

/**
 * 按 UUID 查询 Agent
 */
async function getAgentById(agentId) {
  const result = await query('SELECT * FROM agents WHERE id = $1', [agentId]);
  return result.rows[0] || null;
}

/**
 * 按名称查询 Agent
 */
async function getAgentByName(name) {
  const result = await query('SELECT * FROM agents WHERE name = $1', [name]);
  return result.rows[0] || null;
}

/**
 * 列出全部 Agent（管理后台用 · P4）
 * 返回 [{ id, name, description, status, home_world_url, avatar_config, can_teleport,
 *         created_at, updated_at, active_key_count, last_key_prefix, last_key_created_at }]
 */
async function listAgents() {
  const result = await query(
    `SELECT a.*,
       (SELECT COUNT(*) FROM agent_api_keys k
          WHERE k.agent_id = a.id AND k.status = 'active') AS active_key_count,
       (SELECT k.key_prefix FROM agent_api_keys k
          WHERE k.agent_id = a.id ORDER BY k.created_at DESC LIMIT 1) AS last_key_prefix,
       (SELECT k.created_at FROM agent_api_keys k
          WHERE k.agent_id = a.id ORDER BY k.created_at DESC LIMIT 1) AS last_key_created_at
     FROM agents a
     ORDER BY a.created_at DESC`
  );
  return result.rows;
}

/**
 * 更新 Agent 状态（active | disabled）
 */
async function setAgentStatus(agentId, status) {
  if (!['active', 'disabled'].includes(status)) {
    throw new Error('非法状态');
  }
  const result = await query(
    `UPDATE agents SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [agentId, status]
  );
  return result.rows[0] || null;
}

/**
 * 修改 Agent 推送档（inherit | eco | standard | realtime）
 * 注意：只改库，在线连接由调用方经 agentWsServer.applyAgentTier 即时生效
 */
async function setAgentPushTier(agentId, pushTier) {
  const result = await query(
    `UPDATE agents SET push_tier = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [agentId, normalizePushTier(pushTier)]
  );
  return result.rows[0] || null;
}

/**
 * 永久删除 Agent（不可恢复）
 * agent_api_keys / agent_sessions 均有 ON DELETE CASCADE，删行即级联清理 Key 与会话；
 * 在线 WS 连接由调用方经 agentWsServer.kickAgent 主动踢出（本模块不持有连接状态）。
 * 返回被删除的 agent（不存在返回 null）
 */
async function deleteAgent(agentId) {
  const agent = await getAgentById(agentId);
  if (!agent) return null;

  // 先吊销 Key：防止删除的瞬间仍有请求凭旧 Key 通过鉴权
  await revokeAllKeys(agentId);
  await query('DELETE FROM agents WHERE id = $1', [agentId]);
  return agent;
}

// ==================== API Key ====================

/**
 * 为 Agent 创建新 API Key（明文仅返回一次）
 */
async function createApiKey(agentId, expiresAt = null) {
  const { key, keyHash, keyPrefix } = agentAuth.generateApiKey();
  await query(
    `INSERT INTO agent_api_keys (agent_id, key_hash, key_prefix, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [agentId, keyHash, keyPrefix, expiresAt]
  );
  return { key, keyPrefix };
}

/**
 * 撤销 Agent 全部 API Key
 */
async function revokeAllKeys(agentId) {
  await query(
    `UPDATE agent_api_keys SET status = 'revoked', revoked_at = NOW()
     WHERE agent_id = $1 AND status = 'active'`,
    [agentId]
  );
}

/**
 * 按 API Key 明文查找 Agent（遍历 active key 的 bcrypt hash 比对——
 * P1 阶段 Agent 数量级极小，逐条比对可接受；规模化后再引入 key_prefix 预筛）
 * 返回 { agent, keyRow } 或 null
 */
async function findAgentByApiKey(key) {
  const result = await query(
    `SELECT k.*, a.id AS agent_id, a.name AS agent_name, a.status AS agent_status,
            a.description AS agent_description, a.avatar_config, a.can_teleport
     FROM agent_api_keys k
     JOIN agents a ON a.id = k.agent_id
     WHERE k.status = 'active'
     ORDER BY k.created_at DESC`
  );
  for (const row of result.rows) {
    if (agentAuth.verifyApiKey(key, row.key_hash)) {
      const agent = {
        id: row.agent_id,
        name: row.agent_name,
        status: row.agent_status,
        description: row.agent_description,
        avatar_config: row.avatar_config,
        can_teleport: row.can_teleport
      };
      return { agent, keyRow: row };
    }
  }
  return null;
}

/**
 * Avatar 配置整形（对外输出统一口径）
 */
function shapeAvatar(agent) {
  const raw = agent && agent.avatar_config;
  if (!raw) return {};
  const cfg = typeof raw === 'string' ? safeParse(raw) : raw;
  return cfg || {};
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

module.exports = {
  createAgent,
  getAgentById,
  getAgentByName,
  listAgents,
  setAgentStatus,
  setAgentPushTier,
  deleteAgent,
  normalizePushTier,
  resolvePushTier,
  createApiKey,
  revokeAllKeys,
  findAgentByApiKey,
  shapeAvatar
};
