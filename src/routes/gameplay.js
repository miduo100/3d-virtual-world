/**
 * 真人玩法路由（/api/gameplay）—— AI World Brain · Phase 6 · 用户拍板②：真人交互前端
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 前端 public/js/worldInteractions.js 调用：
 *   GET  /nearby?x=&z=            附近交互点 + 公开任务（公开，游客也可看）
 *   POST /interact                交互（玩家 JWT；服务端判定口径与 Agent 完全一致）
 *   POST /tasks/:id/claim         领取公开任务（玩家 JWT）
 *   GET  /tasks/mine              我的进行中任务
 *   POST /tasks/evaluate          触发评估（真人 reach_region/reach_position 用实时位置判定）
 *   GET  /activities?x=&z=        可加入的活动
 *   POST /activities/:id/join     加入活动（玩家 JWT）
 * 写请求走玩家 JWT（挂载层 apiWriteGuard 'user' + 路由内二次校验）。
 */
'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const interactionService = require('../worldai/gameplay/interactionService');
const taskService = require('../worldai/gameplay/taskService');
const activityService = require('../worldai/gameplay/activityService');
const worldAiConfig = require('../worldai/config');

function myId(req) {
  return req.user && req.user.userId ? String(req.user.userId) : null;
}

// GET /api/gameplay/nearby?x=&z= —— 附近交互点 + 公开任务（公开读）
router.get('/nearby', async (req, res) => {
  try {
    const pos = { x: Number(req.query.x) || 0, z: Number(req.query.z) || 0 };
    const near = await interactionService.findNearby(pos, { regionKey: req.query.regionKey || undefined });
    const cfg = await worldAiConfig.getConfig();
    const tasks = await taskService.listTasks({ worldId: cfg.world_id, visibility: 'public', status: 'published' });
    const activities = (await activityService.listActivities({ worldId: cfg.world_id }))
      .filter((a) => ['announced', 'running'].indexOf(a.status) >= 0);
    res.json({ success: true, interactions: near.items, tasks, activities });
  } catch (e) {
    console.error('[gameplay nearby]', e.message);
    res.status(500).json({ error: '读取附近交互失败' });
  }
});

// POST /api/gameplay/interact { interactionKey?, x, z } —— 真人交互（玩家 JWT）
router.post('/interact', authenticateToken, async (req, res) => {
  try {
    const uid = myId(req);
    if (!uid) return res.status(401).json({ error: '未授权：缺少玩家token' });
    const cfg = await worldAiConfig.getConfig();
    const r = await interactionService.interact({
      actorType: 'human', actorId: uid,
      position: { x: Number(req.body.x) || 0, z: Number(req.body.z) || 0 },
      interactionKey: req.body.interactionKey || undefined,
      worldId: cfg.world_id, regionKey: req.body.regionKey || undefined,
    });
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) {
    console.error('[gameplay interact]', e.message);
    res.status(500).json({ error: '交互失败' });
  }
});

// POST /api/gameplay/tasks/:id/claim —— 领取公开任务（玩家 JWT）
router.post('/tasks/:id/claim', authenticateToken, async (req, res) => {
  try {
    const uid = myId(req);
    if (!uid) return res.status(401).json({ error: '未授权：缺少玩家token' });
    const r = await taskService.claimTask({ taskId: req.params.id, actorType: 'human', actorId: uid });
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) {
    console.error('[gameplay claim]', e.message);
    res.status(500).json({ error: '领取失败' });
  }
});

// GET /api/gameplay/tasks/mine —— 我的进行中任务
router.get('/tasks/mine', authenticateToken, async (req, res) => {
  try {
    const uid = myId(req);
    const rows = (await require('../database/db').query(
      `SELECT t.id, t.title, t.description, t.type, t.objectives, t.reward,
              pr.state, pr.objective_index, pr.status, pr.reward_granted, pr.claimed_at
         FROM world_task_progress pr JOIN world_tasks t ON t.id = pr.task_id
        WHERE pr.actor_type='human' AND pr.actor_id=$1 AND pr.status IN ('active','completed')
        ORDER BY pr.claimed_at DESC LIMIT 20`, [uid])).rows;
    res.json({ success: true, tasks: rows });
  } catch (e) {
    console.error('[gameplay mine]', e.message);
    res.status(500).json({ error: '读取任务失败' });
  }
});

// POST /api/gameplay/tasks/evaluate —— 触发评估（真人 reach_region/reach_position 走实时位置）
router.post('/tasks/evaluate', authenticateToken, async (req, res) => {
  try {
    const uid = myId(req);
    if (!uid) return res.status(401).json({ error: '未授权：缺少玩家token' });
    const r = await taskService.evaluateForActor({ actorType: 'human', actorId: uid });
    res.json({ success: r.ok, ...r });
  } catch (e) {
    console.error('[gameplay evaluate]', e.message);
    res.status(500).json({ error: '评估失败' });
  }
});

// GET /api/gameplay/activities —— 可加入的活动（公开读）
router.get('/activities', async (req, res) => {
  try {
    const cfg = await worldAiConfig.getConfig();
    const rows = (await activityService.listActivities({ worldId: cfg.world_id }))
      .filter((a) => ['announced', 'running'].indexOf(a.status) >= 0);
    res.json({ success: true, activities: rows });
  } catch (e) {
    console.error('[gameplay activities]', e.message);
    res.status(500).json({ error: '读取活动失败' });
  }
});

// POST /api/gameplay/activities/:id/join —— 加入活动（玩家 JWT）
router.post('/activities/:id/join', authenticateToken, async (req, res) => {
  try {
    const uid = myId(req);
    if (!uid) return res.status(401).json({ error: '未授权：缺少玩家token' });
    const r = await activityService.join(req.params.id, 'human', uid);
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) {
    console.error('[gameplay join]', e.message);
    res.status(500).json({ error: '加入失败' });
  }
});

module.exports = router;
