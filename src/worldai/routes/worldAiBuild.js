/**
 * worldAiBuild —— Phase 5 路由（/api/world-ai/build/*）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 经 worldAi.js 子路由挂载 → 继承管理员鉴权（server.js 零改动，Phase 2b/3/4 先例）。
 *   POST /build/preview          spec 干跑（编译+预算+策略，不写任何表）
 *   GET  /build/entities/:id     完整实体六段（P4-14）
 *   GET  /build/steward          管家状态（enabled 默认 false）
 *   POST /build/steward          创建/复用管家（明文 Key 仅创建时一次；总闸开着才允许）
 *   PUT  /build/steward/enabled  开关（body {enabled:boolean}）
 */
const express = require('express');
const router = express.Router();
const { logAdminAction } = require('../../middleware/adminAuth');
const builderRuntime = require('../builder/builderRuntime');
const entityAssembler = require('../builder/entityAssembler');
const steward = require('../steward/stewardService');
const { query } = require('../../database/db');

// POST /build/preview  { spec }
router.post('/build/preview', async (req, res) => {
  try {
    const r = await builderRuntime.preview({ spec: (req.body && req.body.spec) || {} });
    res.json({ success: true, preview: r });
  } catch (e) {
    console.error('[world-ai-build] preview 失败:', e.message);
    res.status(500).json({ error: '预览失败: ' + String(e.message).slice(0, 200) });
  }
});

// GET /build/entities/:id  —— visual/physical/interactions/npcRefs/gameplay/data 六段
router.get('/build/entities/:id', async (req, res) => {
  try {
    const worldAiConfig = require('../config');
    const worldId = await worldAiConfig.getWorldId();
    const entity = await entityAssembler.getEntity(worldId, req.params.id);
    if (!entity) return res.status(404).json({ error: '实体不存在' });
    res.json({ success: true, entity });
  } catch (e) {
    res.status(500).json({ error: '实体查询失败: ' + String(e.message).slice(0, 200) });
  }
});

// GET /build/steward
router.get('/build/steward', async (req, res) => {
  try {
    res.json({ success: true, steward: await steward.status() });
  } catch (e) {
    res.status(500).json({ error: '管家状态查询失败: ' + String(e.message).slice(0, 200) });
  }
});

// POST /build/steward  { avatarConfig? }
router.post('/build/steward', async (req, res) => {
  try {
    const r = await steward.ensureSteward({ avatarConfig: (req.body && req.body.avatarConfig) || {} });
    if (!r.ok) return res.status(400).json({ success: false, code: r.code, reason: r.reason });
    try {
      await logAdminAction(req.adminUser.id, 'world_ai_steward_create', 'agents',
        String(r.agent.id), JSON.stringify({ created: r.created }), req.ip);
    } catch (e) { /* 审计失败不阻断 */ }
    res.json({
      success: true, created: r.created,
      agent: { id: r.agent.id, name: r.agent.name, status: r.agent.status },
      apiKey: r.apiKey || null,   // 明文 Key 仅创建时一次
    });
  } catch (e) {
    res.status(500).json({ error: '管家创建失败: ' + String(e.message).slice(0, 200) });
  }
});

// PUT /build/steward/enabled  { enabled }
router.put('/build/steward/enabled', async (req, res) => {
  try {
    const enabled = await steward.setEnabled(!!(req.body && req.body.enabled));
    try {
      await logAdminAction(req.adminUser.id, 'world_ai_steward_toggle', 'system_config',
        'world_ai_steward_enabled', JSON.stringify({ enabled }), req.ip);
    } catch (e) { /* ignore */ }
    res.json({ success: true, enabled });
  } catch (e) {
    res.status(500).json({ error: '开关失败: ' + String(e.message).slice(0, 200) });
  }
});

// GET /build/executions/:planStepId —— 账本幂等速查（验收用轻端点）
router.get('/build/executions/by-plan-step/:id', async (req, res) => {
  try {
    const r = await query(`SELECT id, tool_name, status, result, error FROM world_tool_executions WHERE plan_step_id = $1 ORDER BY created_at DESC LIMIT 5`, [String(req.params.id)]);
    res.json({ success: true, executions: r.rows });
  } catch (e) {
    res.status(500).json({ error: '查询失败: ' + String(e.message).slice(0, 200) });
  }
});

module.exports = router;
