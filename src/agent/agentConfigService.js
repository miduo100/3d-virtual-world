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
  agent_push_default: { value: 'eco', description: 'Agent 推送默认档（eco|standard|realtime，位置流一并由此决定）' },
  agent_voice_relay: { value: 'false', description: '语音是否中继给 Agent（默认关）' },
  max_agents: { value: '50', description: '全局并发 Agent 上限' },
  // 第一轮联测缺陷 B：同一 Agent 允许的并发 WS 连接数（默认 1；超出时新连接顶掉最旧连接）
  agent_max_connections_per_agent: { value: '1', description: '单个 Agent 并发连接上限（1~10，超出时新连接顶掉旧连接）' },
  // 第一轮联测缺陷 C 配套：Agent 移动速度上限（m/s）。真人约 9 m/s（player.js 0.15/帧 @60fps），
  // 默认与真人对齐；用户实测"Agent 速度应与真人一致"（原固定 5 m/s 会被正常走路/奔跑的真人越拉越远）
  agent_max_speed: { value: '9', description: 'Agent 移动速度上限 m/s（1~20，默认 9 与真人一致）' },
  // 第一轮联测缺陷 D：Key Agent 的 observe 采样率（次/秒）。默认 1 = 与修复前完全一致；
  // 调高可让客户端闭环跟随更稳（游客档固定 1 次/2 秒，不受此键影响）
  agent_observe_rate_key: { value: '1', description: 'Key Agent observe 采样率（次/秒，1~10，默认 1）' },
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
 * 返回 { agentEnabled, pushDefault, voiceRelay, maxAgents }
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
  // 缓存处理：**必须就地更新**而不是简单置 null——
  // 移动速度 / observe 采样率等热路径用 peekConfig() 同步读取 60s 缓存，若只置 null，
  // 在下一次 getConfig() 之前 peekConfig() 会回落默认值，表现为"后台改了要等几十秒才生效"
  // （缺陷 D 验收 D2 实测踩到）。敏感键不写缓存（保持从 DB 解密读取）。
  if (cache && cache.values && !isSensitive) {
    cache.values[key] = strVal;
    cache.loadedAt = Date.now();
  } else {
    cache = null;
  }
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
    voiceRelay: String(v.agent_voice_relay) === 'true',
    maxAgents: parseInt(v.max_agents, 10) || 50,
    // 缺陷 B：单 Agent 并发连接上限（1~10）
    maxConnectionsPerAgent: Math.min(10, Math.max(1, parseInt(v.agent_max_connections_per_agent, 10) || 1)),
    // 缺陷 C 配套：移动速度上限（1~20 m/s）
    maxSpeed: Math.min(20, Math.max(1, Number(v.agent_max_speed) || 9)),
    // 缺陷 D：Key Agent observe 采样率（1~10 次/秒，默认 1）
    observeRateKey: Math.min(10, Math.max(1, parseInt(v.agent_observe_rate_key, 10) || 1)),
    // 聊天记录与归档配置（P4）
    chatLogEnabled: String(v.chat_log_enabled) === 'true',
    chatLogRetentionDays: Math.min(365, Math.max(1, parseInt(v.chat_log_retention_days, 10) || 7)),
    chatLogRemoteEnabled: String(v.chat_log_remote_enabled) === 'true',
    chatLogRemoteProvider: v.chat_log_remote_provider || 'none',
    chatLogUploadHour: Math.min(23, Math.max(0, parseInt(v.chat_log_upload_hour, 10) || 3))
  };
}

/**
 * 同步读取缓存配置（热路径用：移动/跟随每 tick 取速度上限，不能每 tick 查库）
 * 缓存未热时返回 null，调用方回落默认值；WS 连接建立时已 await getConfig() 预热。
 */
function peekConfig() {
  return cache ? shapeValues(cache.values) : null;
}

module.exports = {
  AGENT_CONFIG_DEFAULTS,
  SENSITIVE_KEYS,
  ensureDefaultConfig,
  getConfig,
  getRawConfig,
  setConfigValue,
  getSensitiveValue,
  peekConfig
};
