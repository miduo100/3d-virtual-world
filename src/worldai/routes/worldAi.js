/**
 * World AI 路由（/api/world-ai）
 * Phase 2a · 队列项 1 —— config / credentials / key 换发。
 * P1-2（config/test-llm 三档探活）与 GET /usage 属队列项 2，本文件暂不实现。
 *
 * 鉴权设计：
 * - 管理端点（config / credentials）全部 authenticateAdminToken；
 * - POST /auth/exchange 是 Key 换 token 的使用路径，鉴权凭证明文 Key 本身（waik_*），
 *   不需要管理员 token，故注册在 router.use(authenticateAdminToken) 之前。
 */
const express = require('express');
const router = express.Router();
const { authenticateAdminToken, logAdminAction } = require('../../middleware/adminAuth');
const worldAiConfig = require('../config');
const worldAiAuth = require('../auth/worldAiAuth');

/** 丢给前端前删掉敏感列 */
function publicConfig(row) {
  if (!row) return null;
  const { id, world_id, enabled, provider_id, model, system_prompt, temperature, max_tokens,
    allowed_scopes, allowed_regions, risk_policy, autonomy, provider_map,
    context_window_tokens, budget, schedule, runtime_state,
    last_heartbeat_at, last_error, created_at, updated_at } = row;
  return { id, worldId: world_id, enabled, providerId: provider_id, model, systemPrompt: system_prompt,
    temperature, maxTokens: max_tokens, allowedScopes: allowed_scopes || [], allowedRegions: allowed_regions || [],
    riskPolicy: risk_policy, autonomy, providerMap: provider_map || {},
    contextWindowTokens: context_window_tokens, budget, schedule, runtimeState: runtime_state,
    lastHeartbeatAt: last_heartbeat_at, lastError: last_error, createdAt: created_at, updatedAt: updated_at };
}

// ── Key → 内部 JWT（使用路径；凭证 Key 即身份）──────────────────────────
router.post('/auth/exchange', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const key = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : (req.body && req.body.key);
    const result = await worldAiAuth.exchangeKeyForToken(key);
    res.json({ success: true, ...result });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error('[world-ai] exchange 失败:', e.message);
    res.status(500).json({ error: '凭证换发失败' });
  }
});

// ── 以下全部管理员 ──────────────────────────────────────────────────────
router.use(authenticateAdminToken);

// GET /api/world-ai/config
router.get('/config', async (req, res) => {
  try {
    const row = await worldAiConfig.getConfig();
    res.json({ success: true, config: publicConfig(row) });
  } catch (e) {
    console.error('[world-ai] 读取配置失败:', e.message);
    res.status(500).json({ error: '读取配置失败' });
  }
});

// PUT /api/world-ai/config
router.put('/config', async (req, res) => {
  try {
    const before = publicConfig(await worldAiConfig.getConfig());
    const row = await worldAiConfig.updateConfig(req.body || {});
    try {
      await logAdminAction(req.adminUser.id, 'world_ai_config_update', 'world_ai_configs',
        String(row.id), JSON.stringify({ fields: Object.keys(req.body || {}), before: { enabled: before.enabled, autonomy: before.autonomy } }), req.ip);
    } catch (e) { /* 审计失败不阻断 */ }
    res.json({ success: true, config: publicConfig(row) });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error('[world-ai] 更新配置失败:', e.message);
    res.status(500).json({ error: '更新配置失败' });
  }
});

// GET /api/world-ai/credentials
router.get('/credentials', async (req, res) => {
  try {
    const list = await worldAiAuth.listCredentials();
    res.json({ success: true, credentials: list });
  } catch (e) {
    console.error('[world-ai] 凭证列表失败:', e.message);
    res.status(500).json({ error: '读取凭证失败' });
  }
});

// POST /api/world-ai/credentials  { name, scopes[] }
router.post('/credentials', async (req, res) => {
  try {
    const { name, scopes } = req.body || {};
    const { credential, key, rejected } = await worldAiAuth.createCredential({
      name, scopes, createdBy: req.adminUser.username,
    });
    try {
      await logAdminAction(req.adminUser.id, 'world_ai_credential_create', 'world_ai_credentials',
        String(credential.id), JSON.stringify({ name: credential.name, scopes: credential.scopes, rejected }), req.ip);
    } catch (e) { /* ignore */ }
    // 明文 Key 只此一次
    res.json({ success: true, key, rejectedScopes: rejected, credential: sanitizeCredential(credential) });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error('[world-ai] 创建凭证失败:', e.message);
    res.status(500).json({ error: '创建凭证失败' });
  }
});

// POST /api/world-ai/credentials/:id/rotate
router.post('/credentials/:id/rotate', async (req, res) => {
  try {
    const { credential, key } = await worldAiAuth.rotateCredential(req.params.id);
    try {
      await logAdminAction(req.adminUser.id, 'world_ai_credential_rotate', 'world_ai_credentials',
        String(credential.id), '', req.ip);
    } catch (e) { /* ignore */ }
    res.json({ success: true, key, credential: sanitizeCredential(credential) });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error('[world-ai] 轮换凭证失败:', e.message);
    res.status(500).json({ error: '轮换凭证失败' });
  }
});

// POST /api/world-ai/credentials/:id/pause | /resume
router.post('/credentials/:id/:action(pause|resume)', async (req, res) => {
  try {
    const status = req.params.action === 'pause' ? 'paused' : 'active';
    const credential = await worldAiAuth.setStatus(req.params.id, status);
    try {
      await logAdminAction(req.adminUser.id, 'world_ai_credential_' + status, 'world_ai_credentials',
        String(credential.id), '', req.ip);
    } catch (e) { /* ignore */ }
    res.json({ success: true, credential: sanitizeCredential(credential) });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error('[world-ai] 变更凭证状态失败:', e.message);
    res.status(500).json({ error: '变更凭证状态失败' });
  }
});

// DELETE /api/world-ai/credentials/:id  → 吊销（保留审计行）
router.delete('/credentials/:id', async (req, res) => {
  try {
    const credential = await worldAiAuth.setStatus(req.params.id, 'revoked');
    try {
      await logAdminAction(req.adminUser.id, 'world_ai_credential_revoke', 'world_ai_credentials',
        String(credential.id), '', req.ip);
    } catch (e) { /* ignore */ }
    res.json({ success: true, credential: sanitizeCredential(credential) });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error('[world-ai] 吊销凭证失败:', e.message);
    res.status(500).json({ error: '吊销凭证失败' });
  }
});

function sanitizeCredential(row) {
  return {
    id: row.id, name: row.name, keyPrefix: row.key_prefix, scopes: row.scopes || [],
    status: row.status, expiresAt: row.expires_at, lastUsedAt: row.last_used_at,
    usageCount: row.usage_count, revokedAt: row.revoked_at, createdAt: row.created_at,
  };
}

module.exports = router;
