/**
 * AI Agent 接入 - 后台管理路由（P4 · 管理员鉴权）
 * 挂在 /api/agent/v1，全部走 authenticateAdminToken（管理员 JWT）
 *
 * 端点：
 *   GET    /admin/agents              列出全部 Agent（含 active key 数与前缀、档位）
 *   POST   /admin/agents              创建 Agent（返回明文 API Key 仅一次；可选 pushTier）
 *   DELETE /admin/agents/:id          永久删除 Agent（级联清 Key/会话 + 踢在线连接，不可恢复）
 *   POST   /admin/agents/:id/tier     修改 Agent 推送档（在线连接即时生效）
 *   POST   /admin/agents/:id/disable  停用 Agent（吊销全部 Key + 全部 session）
 *   POST   /admin/agents/:id/enable   启用 Agent
 *   GET    /admin/config              读取全部配置（含聊天归档）
 *   PUT    /admin/config              批量更新配置（含聊天归档）
 *   POST   /admin/archive/run-now     立即触发归档（手动测试用）
 */

const express = require('express');
const router = express.Router();

const { authenticateAdminToken, logAdminAction } = require('../../middleware/adminAuth');
const agentManager = require('../../agent/agentManager');
const agentSessionManager = require('../../agent/agentSessionManager');
const agentConfigService = require('../../agent/agentConfigService');

router.use(authenticateAdminToken);

// ==================== GET /admin/agents ====================

router.get('/admin/agents', async (req, res) => {
  try {
    const agents = await agentManager.listAgents();
    const cfg = await agentConfigService.getConfig();
    res.json({
      success: true,
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        status: a.status,
        homeWorldUrl: a.home_world_url,
        avatarConfig: a.avatar_config,
        canTeleport: a.can_teleport,
        // 档位：库里的原始值 + 解析后的生效档（inherit 回落到全局默认档）
        pushTier: a.push_tier || 'inherit',
        effectivePushTier: agentManager.resolvePushTier(a.push_tier, cfg.pushDefault),
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        activeKeyCount: parseInt(a.active_key_count, 10) || 0,
        lastKeyPrefix: a.last_key_prefix || null,
        lastKeyCreatedAt: a.last_key_created_at || null
      }))
    });
  } catch (error) {
    console.error('[Agent admin] 列出失败:', error);
    res.status(500).json({ error: '列出 Agent 失败' });
  }
});

// ==================== POST /admin/agents ====================

router.post('/admin/agents', async (req, res) => {
  try {
    const { name, description, homeWorldUrl, avatarConfig, pushTier } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: '名称至少 2 字符' });
    }
    const { agent, apiKey } = await agentManager.createAgent({
      name: name.trim(),
      description,
      homeWorldUrl,
      avatarConfig,
      pushTier    // inherit | eco | standard | realtime（非法值由 normalizePushTier 兜底为 inherit）
    });
    await logAdminAction(req.adminUser.id, 'create', 'agent', agent.id, { name: agent.name, pushTier: agent.push_tier }, req.ip);
    // createAgent 返回的 apiKey 是 { key, keyPrefix } 对象（仅含明文 key），统一整形为字符串
    const key = typeof apiKey === 'string' ? apiKey : apiKey.key;
    res.json({
      success: true,
      agent: { id: agent.id, name: agent.name, status: agent.status, pushTier: agent.push_tier, createdAt: agent.created_at },
      apiKey: key,           // 明文 API Key 仅此一次返回
      apiKeyPrefix: key.slice(0, 16)
    });
  } catch (error) {
    console.error('[Agent admin] 创建失败:', error);
    if (error.message && error.message.includes('已存在')) {
      return res.status(409).json({ error: error.message });
    }
    res.status(500).json({ error: '创建 Agent 失败' });
  }
});

// ==================== DELETE /admin/agents/:id（永久删除，不可恢复）====================

router.delete('/admin/agents/:id', async (req, res) => {
  try {
    const agentId = req.params.id;
    const agent = await agentManager.getAgentById(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent 不存在' });

    // 级联：agent_api_keys / agent_sessions 均 ON DELETE CASCADE；先吊销 Key 防删除瞬间旧 Key 仍可用
    await agentManager.revokeAllKeys(agentId);
    try { await agentSessionManager.revokeAllSessions(agentId); } catch (e) { /* 会话表可能无行 */ }
    await agentManager.deleteAgent(agentId);

    // 踢掉在线连接（惰性 require 避免加载期循环依赖）
    let kicked = 0;
    try {
      kicked = require('../../websocket/agentWsServer').kickAgent(agentId, 'agent deleted');
    } catch (e) { /* 未启动 Agent WS 时忽略 */ }

    await logAdminAction(req.adminUser.id, 'delete', 'agent', agentId, { name: agent.name, kicked }, req.ip);
    res.json({ success: true, deleted: agent.name, kicked });
  } catch (error) {
    console.error('[Agent admin] 删除失败:', error);
    res.status(500).json({ error: '删除 Agent 失败' });
  }
});

// ==================== POST /admin/agents/:id/tier（修改推送档，在线即时生效）====================

router.post('/admin/agents/:id/tier', async (req, res) => {
  try {
    const agentId = req.params.id;
    const { pushTier } = req.body || {};
    const agent = await agentManager.getAgentById(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent 不存在' });

    const updated = await agentManager.setAgentPushTier(agentId, pushTier);

    // 在线连接即时生效：inherit 换算为当前全局默认档后再下发
    let effective = updated.push_tier;
    if (effective === 'inherit') {
      const cfg = await agentConfigService.getConfig();
      effective = cfg.pushDefault;
    }
    let applied = 0;
    try {
      applied = require('../../websocket/agentWsServer').applyAgentTier(agentId, effective);
    } catch (e) { /* 未启动 Agent WS 时忽略 */ }

    await logAdminAction(req.adminUser.id, 'set-tier', 'agent', agentId,
      { name: updated.name, pushTier: updated.push_tier, effective, applied }, req.ip);
    res.json({ success: true, pushTier: updated.push_tier, effectivePushTier: effective, applied });
  } catch (error) {
    console.error('[Agent admin] 改档失败:', error);
    res.status(500).json({ error: '修改档位失败' });
  }
});

// ==================== POST /admin/agents/:id/disable ====================

router.post('/admin/agents/:id/disable', async (req, res) => {
  try {
    const agentId = req.params.id;
    const agent = await agentManager.getAgentById(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent 不存在' });

    await agentManager.setAgentStatus(agentId, 'disabled');
    await agentManager.revokeAllKeys(agentId);
    await agentSessionManager.revokeAllSessions(agentId);
    await logAdminAction(req.adminUser.id, 'disable', 'agent', agentId, { name: agent.name }, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[Agent admin] 停用失败:', error);
    res.status(500).json({ error: '停用 Agent 失败' });
  }
});

// ==================== POST /admin/agents/:id/enable ====================

router.post('/admin/agents/:id/enable', async (req, res) => {
  try {
    const agentId = req.params.id;
    const agent = await agentManager.getAgentById(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent 不存在' });

    await agentManager.setAgentStatus(agentId, 'active');
    await logAdminAction(req.adminUser.id, 'enable', 'agent', agentId, { name: agent.name }, req.ip);
    // 注意：启用不自动恢复 Key，管理员需手动新建 Key（避免误启用即恢复旧 Key）
    res.json({ success: true, note: '启用成功，但未自动恢复 API Key（管理员需手动新建）' });
  } catch (error) {
    console.error('[Agent admin] 启用失败:', error);
    res.status(500).json({ error: '启用 Agent 失败' });
  }
});

// ==================== POST /admin/agents/:id/regenerate-key ====================

router.post('/admin/agents/:id/regenerate-key', async (req, res) => {
  try {
    const agentId = req.params.id;
    const agent = await agentManager.getAgentById(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent 不存在' });

    // 撤销旧 Key + 创建新 Key
    await agentManager.revokeAllKeys(agentId);
    const { key } = await agentManager.createApiKey(agentId);
    await logAdminAction(req.adminUser.id, 'regenerate-key', 'agent', agentId, { name: agent.name }, req.ip);
    res.json({
      success: true,
      apiKey: key,        // 明文仅此一次
      apiKeyPrefix: key.slice(0, 16)
    });
  } catch (error) {
    console.error('[Agent admin] 重发 Key 失败:', error);
    res.status(500).json({ error: '重发 API Key 失败' });
  }
});

// ==================== GET /admin/config ====================

router.get('/admin/config', async (req, res) => {
  try {
    const cfg = await agentConfigService.getConfig();
    const raw = await agentConfigService.getRawConfig();
    // 单独读敏感字段（解密后返回，仅管理员可读）
    const s3AccessKey = await agentConfigService.getSensitiveValue('chat_log_s3_access_key');
    const s3SecretKey = await agentConfigService.getSensitiveValue('chat_log_s3_secret_key');
    res.json({
      success: true,
      config: {
        agentEnabled: cfg.agentEnabled,
        pushDefault: cfg.pushDefault,
        voiceRelay: cfg.voiceRelay,
        maxAgents: cfg.maxAgents,
        // 缺陷 B：单 Agent 并发连接上限（1~10，默认 1）
        maxConnectionsPerAgent: cfg.maxConnectionsPerAgent,
        // 缺陷 C 配套：Agent 移动速度上限 m/s（默认 9，与真人一致）
        maxSpeed: cfg.maxSpeed,
        // 缺陷 D：Key Agent observe 采样率（次/秒，默认 1）
        observeRateKey: cfg.observeRateKey,
        chatLogEnabled: cfg.chatLogEnabled,
        chatLogRetentionDays: cfg.chatLogRetentionDays,
        chatLogRemoteEnabled: cfg.chatLogRemoteEnabled,
        chatLogRemoteProvider: cfg.chatLogRemoteProvider,
        chatLogUploadHour: cfg.chatLogUploadHour,
        // 原始键值（不含敏感）
        chatLogS3Endpoint: raw.chat_log_s3_endpoint || '',
        chatLogS3Bucket: raw.chat_log_s3_bucket || '',
        chatLogS3Prefix: raw.chat_log_s3_prefix || 'chat-archive',
        // 敏感字段（解密后返回）
        chatLogS3AccessKey: s3AccessKey || '',
        chatLogS3SecretKey: s3SecretKey || ''
      }
    });
  } catch (error) {
    console.error('[Agent admin] 配置读取失败:', error);
    res.status(500).json({ error: '配置读取失败' });
  }
});

// ==================== PUT /admin/config ====================

router.put('/admin/config', async (req, res) => {
  try {
    const body = req.body || {};
    // 客户端校验：仅允许白名单键 + 值域校验
    const allowedKeys = [
      'agent_enabled', 'agent_push_default', 'agent_voice_relay', 'max_agents',
      'agent_max_connections_per_agent', 'agent_max_speed', 'agent_follow_speed', 'agent_observe_rate_key',
      'chat_log_enabled', 'chat_log_retention_days', 'chat_log_remote_enabled',
      'chat_log_remote_provider', 'chat_log_s3_endpoint', 'chat_log_s3_bucket',
      'chat_log_s3_prefix', 'chat_log_s3_access_key', 'chat_log_s3_secret_key', 'chat_log_upload_hour'
    ];
    const pushDefaults = ['eco', 'standard', 'realtime'];
    const providers = ['none', 's3', 'baidu'];

    for (const [key, value] of Object.entries(body)) {
      if (!allowedKeys.includes(key)) continue;
      // 值域校验
      if (key === 'agent_push_default' && !pushDefaults.includes(value)) continue;
      if (key === 'chat_log_remote_provider' && !providers.includes(value)) continue;
      if (key === 'chat_log_retention_days') {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n) || n < 1 || n > 365) continue;
      }
      if (key === 'chat_log_upload_hour') {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n) || n < 0 || n > 23) continue;
      }
      if (key === 'max_agents') {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n) || n < 1 || n > 500) continue;
      }
      if (key === 'agent_max_connections_per_agent') {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n) || n < 1 || n > 10) continue;
      }
      if (key === 'agent_max_speed' || key === 'agent_follow_speed') {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 1 || n > 20) continue;
      }
      if (key === 'agent_observe_rate_key') {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n) || n < 1 || n > 10) continue;
      }
      // 布尔键规范化
      if (['agent_enabled', 'agent_voice_relay', 'chat_log_enabled', 'chat_log_remote_enabled'].includes(key)) {
        await agentConfigService.setConfigValue(key, value === true || value === 'true' ? 'true' : 'false');
      } else {
        await agentConfigService.setConfigValue(key, value);
      }
    }
    await logAdminAction(req.adminUser.id, 'update-config', 'agent', null, { keys: Object.keys(body) }, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[Agent admin] 配置更新失败:', error);
    res.status(500).json({ error: '配置更新失败' });
  }
});

// ==================== POST /admin/archive/run-now ====================

router.post('/admin/archive/run-now', async (req, res) => {
  try {
    // 惰性加载避免循环依赖
    const chatArchiveService = require('../../services/chatArchiveService');
    const day = req.body && req.body.day;  // ISO 日期字符串 YYYY-MM-DD，可选
    const result = await chatArchiveService.runArchiveNow(day);
    res.json({ success: true, result });
  } catch (error) {
    console.error('[Agent admin] 手动归档失败:', error);
    res.status(500).json({ error: '手动归档失败', message: error.message });
  }
});

module.exports = router;
