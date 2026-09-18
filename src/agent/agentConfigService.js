/**
 * AI Agent 接入 - 配置服务（P1）
 * system_config 读写 + 60s 缓存（红线6：后台改动 60s 内热跟进，不重启）。
 * 参考先例：voiceRelay 的 ensureDefaultConfig 模式（ON CONFLICT DO NOTHING 自动插默认行，
 * 后台"系统配置"自动出现）。
 */

const { query } = require('../database/db');

// ==================== 配置键定义（5.3 节）====================

// 5.3 节 Agent 接入配置
const AGENT_CONFIG_DEFAULTS = {
  agent_enabled: { value: 'false', description: 'Agent 接入总开关（默认关，上线手动开）' },
  agent_push_default: { value: 'eco', description: 'Agent 推送默认档（eco|standard|realtime）' },
  agent_movement_push: { value: 'batched', description: '位置流策略（off|batched|realtime）' },
  agent_voice_relay: { value: 'false', description: '语音是否中继给 Agent（默认关）' },
  max_agents: { value: '50', description: '全局并发 Agent 上限' },
  // 5.5 节 聊天记录与归档配置（P4）
  chat_log_enabled: { value: 'true', description: '聊天记录总开关（关后停止写入 world_chat_log）' },
  chat_log_retention_days: { value: '7', description: '本地保留天数（1~365），到期清除已成功归档的本地行' },
  chat_log_remote_enabled: { value: 'false', description: '远端归档开关（默认关）' },
  chat_log_remote_provider: { value: 'none', description: '归档目的地（none|s3|baidu[预留]）' },
  chat_log_s3_endpoint: { value: '', description: 'S3 兼容 endpoint（覆盖 OSS/COS/MinIO）' },
  chat_log_s3_bucket: { value: '', description: 'S3 bucket 名' },
  chat_log_s3_prefix: { value: 'chat-archive', description: 'S3 key 前缀（默认 chat-archive/YYYY/MM/DD.jsonl.gz）' },
  chat_log_s3_access_key: { value: '', description: 'S3 access key（密钥加密存储，见 setSensitiveConfigValue）' },
  chat_log_s3_secret_key: { value: '', description: 'S3 secret key（密钥加密存储，见 setSensitiveConfigValue）' },
  chat_log_upload_hour: { value: '3', description: '每日归档时刻（0~23，默认凌晨 3 点）' }
};

// 敏感键集合（写入时打 is_sensitive 标记，读出时解密）
const SENSITIVE_KEYS = new Set(['chat_log_s3_access_key', 'chat_log_s3_secret_key']);

const CACHE_TTL_MS = 60 * 1000;

// ==================== 缓存 ====================

let cache = null;          // { values: {key: value}, loadedAt: number }

/**
 * 确保默认配置行存在（幂等，启动时调用一次）
 */
async function ensureDefaultConfig() {
  for (const [key, def] of Object.entries(AGENT_CONFIG_DEFAULTS)) {
    try {
      await query(
        `INSERT INTO system_config (config_key, config_value, description, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (config_key) DO NOTHING`,
        [key, def.value, def.description]
      );
    } catch (e) {
      console.warn(`[AgentConfig] 默认配置写入失败 ${key}:`, e.message);
    }
  }
}

/**
 * 读取全部 Agent 配置（60s 缓存）
 * 返回 { agentEnabled, pushDefault, movementPush, voiceRelay, maxAgents }
 */
async function getConfig(force = false) {
  const now = Date.now();
  if (!force && cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return shapeValues(cache.values);
  }

  const values = {};
  try {
    const result = await query(
      `SELECT config_key, config_value FROM system_config WHERE config_key = ANY($1)`,
      [Object.keys(AGENT_CONFIG_DEFAULTS)]
    );
    for (const row of result.rows) {
      values[row.config_key] = row.config_value;
    }
    // 数据库缺行时回退默认值
    for (const [key, def] of Object.entries(AGENT_CONFIG_DEFAULTS)) {
      if (values[key] === undefined) values[key] = def.value;
    }
    cache = { values, loadedAt: now };
  } catch (e) {
    console.warn('[AgentConfig] 配置读取失败，使用默认值:', e.message);
    const fallback = {};
    for (const [key, def] of Object.entries(AGENT_CONFIG_DEFAULTS)) fallback[key] = def.value;
    cache = { values: fallback, loadedAt: now };
  }
  return shapeValues(cache.values);
}

/**
 * 原始键值读取（管理/诊断用）
 */
async function getRawConfig(force = false) {
  await getConfig(force);
  return { ...cache.values, _cacheAgeMs: Date.now() - cache.loadedAt };
}

/**
 * 写单个配置键（管理后台用），写后失效缓存
 * 敏感键（access_key/secret_key）走加密存储：is_sensitive=true + configService.encrypt
 */
async function setConfigValue(key, value) {
  if (!Object.prototype.hasOwnProperty.call(AGENT_CONFIG_DEFAULTS, key)) {
    throw new Error(`未知 Agent 配置键: ${key}`);
  }
  const strVal = String(value);
  const isSensitive = SENSITIVE_KEYS.has(key);
  if (isSensitive) {
    // 加密存储：用 configService.encrypt，写 is_sensitive=true
    const configService = require('../services/configService');
    const encrypted = configService.encrypt(strVal);
    await query(
      `INSERT INTO system_config (config_key, config_value, description, is_sensitive, updated_at)
       VALUES ($1, $2, $3, TRUE, NOW())
       ON CONFLICT (config_key) DO UPDATE SET config_value = $2, is_sensitive = TRUE, updated_at = NOW()`,
      [key, encrypted, AGENT_CONFIG_DEFAULTS[key].description]
    );
  } else {
    await query(
      `INSERT INTO system_config (config_key, config_value, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (config_key) DO UPDATE SET config_value = $2, updated_at = NOW()`,
      [key, strVal, AGENT_CONFIG_DEFAULTS[key].description]
    );
  }
  cache = null; // 失效缓存，下次读取重新加载
}

/**
 * 读取敏感配置（解密后返回明文）；非敏感键直接返回原值
 */
async function getSensitiveValue(key) {
  if (!SENSITIVE_KEYS.has(key)) {
    const cfg = await getConfig();
    return cfg[camelize(key)] ?? null;
  }
  const result = await query('SELECT config_value, is_sensitive FROM system_config WHERE config_key = $1', [key]);
  if (result.rows.length === 0) return '';
  const row = result.rows[0];
  if (!row.is_sensitive) return row.config_value || '';
  const configService = require('../services/configService');
  try { return configService.decrypt(row.config_value); } catch (e) { return ''; }
}

function camelize(key) {
  // chat_log_s3_endpoint → chatLogS3Endpoint
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function shapeValues(v) {
  return {
    agentEnabled: String(v.agent_enabled) === 'true',
    pushDefault: v.agent_push_default || 'eco',
    movementPush: v.agent_movement_push || 'batched',
    voiceRelay: String(v.agent_voice_relay) === 'true',
    maxAgents: parseInt(v.max_agents, 10) || 50,
    // 聊天记录与归档配置（P4）
    chatLogEnabled: String(v.chat_log_enabled) === 'true',
    chatLogRetentionDays: Math.min(365, Math.max(1, parseInt(v.chat_log_retention_days, 10) || 7)),
    chatLogRemoteEnabled: String(v.chat_log_remote_enabled) === 'true',
    chatLogRemoteProvider: v.chat_log_remote_provider || 'none',
    chatLogUploadHour: Math.min(23, Math.max(0, parseInt(v.chat_log_upload_hour, 10) || 3))
  };
}

module.exports = {
  AGENT_CONFIG_DEFAULTS,
  SENSITIVE_KEYS,
  ensureDefaultConfig,
  getConfig,
  getRawConfig,
  setConfigValue,
  getSensitiveValue
};
