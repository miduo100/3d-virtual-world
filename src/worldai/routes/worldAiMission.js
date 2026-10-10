/**
 * worldAiMission —— 长期使命管理口（AI World Brain · Phase 7b · §I.6）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 挂载于 worldAi.js（继承 authenticateAdminToken）。业务失败一律 200 + {success:false,code}
 * 或 400 + code（与 worldAiRuntime 同款口径）；本文件只做参数整形与调用 missionService。
 */
'use strict';

const express = require('express');
const router = express.Router();
const { logAdminAction } = require('../../middleware/adminAuth');
const missionService = require('../missions/longTermMission');
const { getWorldId } = require('../config');

/** worldId 解析：显式 body/query 优先（验收脚本进程外调用），否则走配置权威 */
async function resolveWorldId(req) {
  return String((req.body && req.body.worldId) || req.query.worldId || await getWorldId() || '');
}

function shape(m) {
  if (!m) return null;
  return {
    id: m.id, worldId: m.world_id, statement: m.statement,
    pendingStatement: m.pending_statement || null,
    northStar: m.north_star || {}, phases: m.phases || [], currentPhase: m.current_phase,
    weeklyPlan: m.weekly_plan || {}, lastReport: m.last_report || null,
    monthlyBudget: m.monthly_budget || {}, reviewOptions: m.review_options || null,
    status: m.status, pausedReason: m.paused_reason || null,
    startedAt: m.started_at, finishedAt: m.finished_at, createdAt: m.created_at, updatedAt: m.updated_at,
  };
}

// ── 查询 ──────────────────────────────────────────────────────────

router.get('/missions', async (req, res) => {
  try {
    const worldId = await resolveWorldId(req);
    const rows = await missionService.listMissions(worldId);
    const active = rows.find((m) => missionService.ACTIVE_STATUSES.indexOf(m.status) >= 0) || null;
    let budget = null;
    if (active) budget = await missionService.checkMonthlyBudget(active);
    res.json({ success: true, active: shape(active), history: rows.map(shape),
      budget: budget ? { ok: budget.ok, over: budget.over, usage: budget.usage, limits: budget.limits } : null,
      context: await missionService.getMissionContext(worldId) });
  } catch (e) { res.status(500).json({ success: false, error: '查询使命失败: ' + e.message }); }
});

router.post('/missions', async (req, res) => {
  try {
    const worldId = await resolveWorldId(req);
    const r = await missionService.createMission({
      worldId, statement: req.body && req.body.statement,
      northStar: req.body && req.body.northStar,
      phases: req.body && req.body.phases,
      monthlyBudget: req.body && req.body.monthlyBudget,
    });
    if (!r.ok) return res.status(400).json({ success: false, code: r.code, reason: r.reason });
    try { await logAdminAction(req.adminUser.id, 'world_ai_mission_create', 'world_missions', String(r.mission.id), '', req.ip); } catch (e) { /* ignore */ }
    res.json({ success: true, mission: shape(r.mission) });
  } catch (e) { res.status(500).json({ success: false, error: '创建使命失败: ' + e.message }); }
});

// ── 状态机（start/pause/resume/finish/terminate）────────────────────

/** :id 支持 'current'（取当前 active 使命）——后台卡片不缓存 id，避免多页签竞态 */
async function resolveMissionId(idOrCurrent) {
  if (String(idOrCurrent).toLowerCase() !== 'current') return String(idOrCurrent);
  const worldId = await getWorldId();
  const m = await missionService.getActive(worldId);
  return m ? m.id : null;
}

router.post('/missions/:id/:action(start|pause|resume|finish|terminate)', async (req, res) => {
  try {
    const mid = await resolveMissionId(req.params.id);
    if (!mid) return res.status(404).json({ success: false, code: 'NO_MISSION', reason: '没有进行中的长期使命' });
    const r = await missionService.setStatus(mid, req.params.action, req.body && req.body.reason);
    if (!r.ok) return res.status(400).json({ success: false, code: r.code, reason: r.reason });
    try { await logAdminAction(req.adminUser.id, 'world_ai_mission_' + req.params.action, 'world_missions', String(req.params.id), '', req.ip); } catch (e) { /* ignore */ }
    res.json({ success: true, mission: shape(r.mission) });
  } catch (e) { res.status(500).json({ success: false, error: '状态变更失败: ' + e.message }); }
});

// ── 方向调整 / 里程碑评审 / 评审三选 ────────────────────────────────

router.post('/missions/:id/adjust', async (req, res) => {
  try {
    const mid = await resolveMissionId(req.params.id);
    if (!mid) return res.status(404).json({ success: false, code: 'NO_MISSION', reason: '没有进行中的长期使命' });
    const r = await missionService.adjustStatement(mid, req.body && req.body.statement);
    if (!r.ok) return res.status(400).json({ success: false, code: r.code, reason: r.reason });
    try { await logAdminAction(req.adminUser.id, 'world_ai_mission_adjust', 'world_missions', String(mid), '', req.ip); } catch (e) { /* ignore */ }
    res.json({ success: true, ...r });
  } catch (e) { res.status(500).json({ success: false, error: '调整失败: ' + e.message }); }
});

router.post('/missions/:id/review', async (req, res) => {
  try {
    const mid = await resolveMissionId(req.params.id);
    if (!mid) return res.status(404).json({ success: false, code: 'NO_MISSION', reason: '没有进行中的长期使命' });
    const r = await missionService.reviewMilestone(mid, {
      passed: req.body ? req.body.passed : undefined,
      options: req.body && req.body.options,
    });
    if (!r.ok) return res.status(400).json({ success: false, code: r.code, reason: r.reason });
    res.json({ success: true, ...r, mission: shape(r.mission) });
  } catch (e) { res.status(500).json({ success: false, error: '评审失败: ' + e.message }); }
});

router.post('/missions/:id/review-choice', async (req, res) => {
  try {
    const mid = await resolveMissionId(req.params.id);
    if (!mid) return res.status(404).json({ success: false, code: 'NO_MISSION', reason: '没有进行中的长期使命' });
    const r = await missionService.applyReviewChoice(mid, req.body && req.body.choice);
    if (!r.ok) return res.status(400).json({ success: false, code: r.code, reason: r.reason });
    res.json({ success: true, mission: shape(r.mission), adopted: r.adopted });
  } catch (e) { res.status(500).json({ success: false, error: '采纳失败: ' + e.message }); }
});

// ── 月报问题回答 / 预算 / 手动触发 tick（验收与运维口）──────────────

router.post('/missions/:id/answer', async (req, res) => {
  try {
    const mid = await resolveMissionId(req.params.id);
    if (!mid) return res.status(404).json({ success: false, code: 'NO_MISSION', reason: '没有进行中的长期使命' });
    const r = await missionService.answerQuestion(mid, req.body && req.body.choice, req.body && req.body.note);
    if (!r.ok) return res.status(400).json({ success: false, code: r.code, reason: r.reason });
    res.json({ success: true, answered: r.answered });
  } catch (e) { res.status(500).json({ success: false, error: '回答失败: ' + e.message }); }
});

router.get('/missions/:id/budget', async (req, res) => {
  try {
    const m = await missionService.getMission(req.params.id);
    if (!m) return res.status(404).json({ success: false, code: 'NOT_FOUND' });
    const b = await missionService.checkMonthlyBudget(m);
    res.json({ success: true, budget: { ok: b.ok, over: b.over, usage: b.usage, limits: b.limits, monthly: m.monthly_budget } });
  } catch (e) { res.status(500).json({ success: false, error: '查询预算失败: ' + e.message }); }
});

router.post('/missions/tick-weekly', async (req, res) => {
  try {
    const worldId = await resolveWorldId(req);
    res.json(await missionService.runWeeklyTick(worldId));
  } catch (e) { res.status(500).json({ success: false, error: 'tick_weekly 失败: ' + e.message }); }
});

router.post('/missions/tick-monthly', async (req, res) => {
  try {
    const worldId = await resolveWorldId(req);
    res.json(await missionService.runMonthlyTick(worldId));
  } catch (e) { res.status(500).json({ success: false, error: 'tick_monthly 失败: ' + e.message }); }
});

module.exports = router;
