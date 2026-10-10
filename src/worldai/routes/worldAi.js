/**
 * World AI 路由（/api/world-ai）
 * Phase 2a · 队列项 1（config / credentials / key 换发）+ 队列项 2（config/test-llm 三档探活 · GET /usage）
 *
 * 鉴权设计：
 * - 管理端点（config / credentials / test-llm / usage）全部 authenticateAdminToken；
 * - POST /auth/exchange 是 Key 换 token 的使用路径，鉴权凭证明文 Key 本身（waik_*），
 *   不需要管理员 token，故注册在 router.use(authenticateAdminToken) 之前。
 *
 * ★ 队列项 2 的两条纪律：
 *   1) 探活的真实调用全部收敛在 llm/llmProbe.js（成本纪律：max_tokens=1~32、阶梯命中即停）；
 *   2) 上游账户问题一律翻译成结构化诊断返回（200 + ok:false），**绝不 500、绝不空白**。
 */
const express = require('express');
const router = express.Router();
const { authenticateAdminToken, logAdminAction } = require('../../middleware/adminAuth');
const worldAiConfig = require('../config');
const worldAiAuth = require('../auth/worldAiAuth');
const llmProbe = require('../llm/llmProbe');
const worldAiUsage = require('../usage');

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

// ── Runtime（Phase 2b · P1-7/8/9）：子路由继承本层管理员鉴权；init() 做崩溃恢复（幂等）──
const worldAiRuntimeRoutes = require('./worldAiRuntime');
const worldAiRuntime = require('../runtime/worldAiRuntime');
router.use('/runtime', worldAiRuntimeRoutes);
worldAiRuntime.init();

// ── Planning（Phase 3 · P2-1~P2-9）：目标 / 规划 / 审批 ──
router.use('/', require('./worldAiPlan'));

// ── Ops（Phase 4 · P3-1~P3-14）：工具账本 / tool 审批 / 感知（快照·事件·分析·记忆）──
router.use('/', require('./worldAiOps'));

// ── Build（Phase 5 · P4-1~P4-17）：spec 预览 / 实体六段 / Steward ──
router.use('/', require('./worldAiBuild'));

// ── Gameplay（Phase 6 · P5-1~P5-14）：任务领取/评估 + 活动生命周期 + 钱包管理面 ──
router.use('/gameplay', require('./worldAiGameplay'));

// ── Mission（Phase 7b · §I.6）：长期使命（状态机/里程碑/周计划/月报/月度预算）──
router.use('/', require('./worldAiMission'));

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

// POST /api/world-ai/config/test-llm  —— P1-2 三档探活（连通 / 窗口实测 / 能力）
// body: { provider_id?, model?, purpose?, stages?: ['connect','window','capability'] }
// 返回：{ success:true, result:{ ok, stages:{...}, contextWindowTokens, diagnosis, hint } }
// ★ 上游账户问题也返回 200（ok:false + 结构化诊断），绝不 500。
router.post('/config/test-llm', async (req, res) => {
  const body = req.body || {};
  try {
    const result = await llmProbe.probe({
      providerId: body.provider_id || body.providerId || null,
      model: body.model || null,
      purpose: body.purpose || 'plan',
      stages: Array.isArray(body.stages) ? body.stages : null,
      ladder: Array.isArray(body.ladder) ? body.ladder : null,
    });
    try {
      await logAdminAction(req.adminUser.id, 'world_ai_test_llm', 'ai_providers',
        result.providerId ? String(result.providerId) : 'route',
        JSON.stringify({ ok: result.ok, stages: result.stagesRun, window: result.contextWindowTokens, code: result.diagnosis && result.diagnosis.code }), req.ip);
    } catch (e) { /* 审计失败不阻断 */ }
    // 无论探活是否成功都给 200：结果体里带 ok 与诊断，前端据此渲染，不出现"500 空白"
    res.json({ success: true, result });
  } catch (e) {
    // 只可能是程序级错误（例如参数类型不对）；上游问题已在上面被结构化，不会走到这
    console.error('[world-ai] 探活执行异常:', e && e.message);
    res.status(500).json({ success: false, error: '探活执行异常: ' + String(e && e.message).slice(0, 200), code: 'PROBE_INTERNAL' });
  }
});

// GET /api/world-ai/usage —— 用量与健康度（聚合 ai_call_log，只读）
router.get('/usage', async (req, res) => {
  try {
    const usage = await worldAiUsage.getUsage({ days: req.query.days });
    res.json({ success: true, usage });
  } catch (e) {
    console.error('[world-ai] 用量统计失败:', e.message);
    res.status(500).json({ error: '用量统计失败' });
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
