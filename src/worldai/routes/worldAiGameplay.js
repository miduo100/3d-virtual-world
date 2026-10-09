/**
 * World AI Gameplay 路由（/api/world-ai/gameplay/*）
 * AI World Brain · Phase 6 · P5-2/3/7/8 的管理面 + 验收入口
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 经 worldAi.js 子路由挂载 → 继承 authenticateAdminToken（server.js 零改动，Phase 2b 先例）。
 * ★ 真人玩家入口在 /api/gameplay（routes/gameplay.js，玩家 JWT），不在这里。
 */
'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../../database/db');
const taskService = require('../gameplay/taskService');
const activityService = require('../gameplay/activityService');
const currencyService = require('../../services/currencyService');

function wId(req) { return req.query.worldId || null; }

// ── 任务 ──────────────────────────────────────────────────────────────
router.get('/tasks', async (req, res) => {
  try {
    const rows = await taskService.listTasks({ worldId: wId(req), visibility: req.query.visibility, status: req.query.status });
    res.json({ success: true, tasks: rows });
  } catch (e) { res.status(500).json({ error: '读取任务失败: ' + e.message }); }
});

router.get('/tasks/:id', async (req, res) => {
  try {
    const row = (await query(`SELECT * FROM world_tasks WHERE id=$1`, [String(req.params.id)])).rows[0];
    if (!row) return res.status(404).json({ error: '任务不存在' });
    res.json({ success: true, task: row });
  } catch (e) { res.status(500).json({ error: '读取任务失败: ' + e.message }); }
});

// POST /tasks/:id/claim { actorType, actorId } —— 服务端代领（管理/验收口；真人走 /api/gameplay）
router.post('/tasks/:id/claim', async (req, res) => {
  try {
    const r = await taskService.claimTask({
      taskId: req.params.id,
      actorType: req.body.actorType, actorId: req.body.actorId,
    });
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) { res.status(500).json({ error: '领取失败: ' + e.message }); }
});

// POST /tasks/evaluate { actorType, actorId } —— 事件驱动评估（区域/聊天事件也可自动触发）
router.post('/tasks/evaluate', async (req, res) => {
  try {
    const r = await taskService.evaluateForActor({ actorType: req.body.actorType, actorId: req.body.actorId });
    res.json({ success: r.ok, ...r });
  } catch (e) { res.status(500).json({ error: '评估失败: ' + e.message }); }
});

router.get('/tasks/:id/progress/:actorId', async (req, res) => {
  try {
    const row = await taskService.getProgress(req.params.id, req.params.actorId);
    res.json({ success: true, progress: row });
  } catch (e) { res.status(500).json({ error: '读取进度失败: ' + e.message }); }
});

// ── 活动 ──────────────────────────────────────────────────────────────
router.get('/activities', async (req, res) => {
  try {
    const rows = await activityService.listActivities({ worldId: wId(req), status: req.query.status });
    res.json({ success: true, activities: rows });
  } catch (e) { res.status(500).json({ error: '读取活动失败: ' + e.message }); }
});

router.get('/activities/:id', async (req, res) => {
  try {
    const a = await activityService.findById(req.params.id);
    if (!a) return res.status(404).json({ error: '活动不存在' });
    res.json({ success: true, activity: a });
  } catch (e) { res.status(500).json({ error: '读取活动失败: ' + e.message }); }
});

router.post('/activities/:id/announce', async (req, res) => {
  try {
    const r = await activityService.announce(req.params.id);
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) { res.status(500).json({ error: 'announce 失败: ' + e.message }); }
});

router.post('/activities/:id/start', async (req, res) => {
  try {
    const r = await activityService.start(req.params.id, { effectiveAutonomy: 'managed', approvedRisks: ['high'] });
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) { res.status(500).json({ error: 'start 失败: ' + e.message }); }
});

router.post('/activities/:id/join', async (req, res) => {
  try {
    const r = await activityService.join(req.params.id, req.body.actorType, req.body.actorId);
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) { res.status(500).json({ error: 'join 失败: ' + e.message }); }
});

router.post('/activities/:id/tick', async (req, res) => {
  try {
    const r = await activityService.tick(req.params.id, { effectiveAutonomy: 'managed', approvedRisks: ['high'] });
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) { res.status(500).json({ error: 'tick 失败: ' + e.message }); }
});

router.post('/activities/:id/settle', async (req, res) => {
  try {
    const r = await activityService.settle(req.params.id, { effectiveAutonomy: 'managed', approvedRisks: ['high'] });
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) { res.status(500).json({ error: 'settle 失败: ' + e.message }); }
});

// ── 钱包（管理面：充值/查余额；扣款只走 purchase，不开放管理扣款口）────────
router.post('/wallets/deposit', async (req, res) => {
  try {
    const r = await currencyService.deposit({
      ownerType: req.body.ownerType || 'user', ownerId: req.body.ownerId,
      amount: req.body.amount, kind: 'admin_topup',
      idempotencyKey: req.body.idempotencyKey || null,
      refType: 'admin', refId: String(req.adminUser.id),
    });
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) { res.status(500).json({ error: '充值失败: ' + e.message }); }
});

router.get('/wallets/:ownerType/:ownerId', async (req, res) => {
  try {
    const r = await currencyService.getBalance(req.params.ownerType, req.params.ownerId);
    res.json({ success: true, ...r });
  } catch (e) { res.status(500).json({ error: '查余额失败: ' + e.message }); }
});

module.exports = router;
