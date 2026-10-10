/**
 * agentTasks —— 外部 Agent 的任务/活动接口（AI World Brain · Phase 8 · P7-1/P7-2）
 * 挂载于 /api/agent/v1（src/routes/agent/index.js，★必须挂在 admin 子路由之前）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 权限（用户决策③）：
 *   GET  /tasks、GET /activities                —— **公开可读**（游客档也能看：任务是世界公开信息）
 *   POST /tasks/:id/claim                        —— 需 Agent 凭证且 **Key 档**
 *   GET  /tasks/:id/progress                     —— 需 Agent 凭证（只看自己的进度）
 *   PUT  /tasks/:id/progress                     —— 需 Agent 凭证且 **Key 档**（只能写备注/放弃）
 *
 * ★ 红线不动：任何档位（含 Key）对 `world:*` 工具零写权；本路由不触碰 world_objects，
 *   任务的**判定与结算一律复用** gameplay/taskService + objectiveEvaluator + rewardService，
 *   Agent 不能自己给自己判完成（PUT 明确不接受 completed/objective 进度）。
 */
'use strict';

const express = require('express');
const router = express.Router();

const { query } = require('../../database/db');
const worldAiConfig = require('../../worldai/config');
const taskService = require('../../worldai/gameplay/taskService');
const activityService = require('../../worldai/gameplay/activityService');
const sessionRouter = require('../../routes/agent/session');
const tierService = require('../../agent/agentTierService');

const authenticateAgentToken = sessionRouter.authenticateAgentToken;

/** 公开任务可见性：human_only 永不外泄给 Agent */
const VISIBILITIES = ['public', 'agent_only'];
/** 公开可见的任务状态（draft/completed/cancelled 不列表） */
const STATUSES = ['published', 'active'];

const shapeTask = (t) => ({
  id: t.id, title: t.title, description: t.description, type: t.type,
  objectives: t.objectives || [], reward: t.reward || null,
  regionKey: t.region_key || null, status: t.status, visibility: t.visibility,
  repeatable: t.repeatable === true, createdAt: t.created_at,
});

const shapeActivity = (a) => ({
  id: a.id, title: a.title, description: a.description, kind: a.kind || null,
  status: a.status, regionKey: a.region_key || null,
  startsAt: a.starts_at || null, endsAt: a.ends_at || null, createdAt: a.created_at,
});

/** 当前世界 ID（每请求解析；独立进程回落 system_config，与 config.getWorldId 同口径） */
async function currentWorldId() { return await worldAiConfig.getWorldId(); }

/** Key 档闸门：游客档（拉模式）禁止写类操作 */
function requireKeyTier(req, res) {
  const tier = tierService.resolveTier(req.agentJwt, req.agentSession);
  if (tierService.isGuest(tier)) {
    res.status(403).json({
      error: '游客档（guest-pull）为只读拉模式，不能领取或上报任务进度；请改用 API Key 档',
      code: 'GUEST_READ_ONLY', tier,
    });
    return false;
  }
  req.tier = tier;
  return true;
}

function fail(res, status, code, error) { return res.status(status).json({ error, code }); }

// ── 公开读：任务列表 ────────────────────────────────────────────────
router.get('/tasks', async (req, res) => {
  try {
    const worldId = await currentWorldId();
    const limit = Math.min(50, Math.max(1, Math.floor(Number(req.query.limit) || 20)));
    const r = await query(
      `SELECT * FROM world_tasks
        WHERE world_id=$1 AND visibility = ANY($2::varchar[]) AND status = ANY($3::varchar[])
        ORDER BY created_at DESC LIMIT $4`,
      [String(worldId), VISIBILITIES, STATUSES, limit]);
    res.json({ success: true, scope: 'public', tasks: (r.rows || []).map(shapeTask), count: (r.rows || []).length });
  } catch (e) {
    console.error('[Agent] GET /tasks 失败:', e && e.message);
    res.status(500).json({ error: '任务列表读取失败', code: 'TASKS_FAILED' });
  }
});

// ── 公开读：活动列表 ────────────────────────────────────────────────
router.get('/activities', async (req, res) => {
  try {
    const worldId = await currentWorldId();
    const list = await activityService.listActivities({ worldId });
    const open = (list || []).filter((a) => ['announced', 'running'].indexOf(a.status) >= 0);
    res.json({ success: true, scope: 'public', activities: open.map(shapeActivity), count: open.length });
  } catch (e) {
    console.error('[Agent] GET /activities 失败:', e && e.message);
    res.status(500).json({ error: '活动列表读取失败', code: 'ACTIVITIES_FAILED' });
  }
});

// ── 领取任务（Key 档）──────────────────────────────────────────────
router.post('/tasks/:id/claim', authenticateAgentToken, async (req, res) => {
  try {
    if (!requireKeyTier(req, res)) return;
    const r = await taskService.claimTask({
      taskId: req.params.id, actorId: req.agent.id, actorType: 'agent',
    });
    if (!r.ok) return fail(res, 400, r.code, r.reason);
    res.json({
      success: true, deduped: r.deduped === true, tier: req.tier,
      taskId: r.task ? r.task.id : req.params.id,
      progress: r.progress ? {
        taskId: r.progress.task_id, status: r.progress.status,
        objectiveIndex: r.progress.objective_index || 0, claimedAt: r.progress.claimed_at,
      } : null,
      hint: r.deduped ? '该任务你已领取过（幂等）' : '已领取；进度由服务端事件自动判定，无需上报',
    });
  } catch (e) {
    console.error('[Agent] POST /tasks/:id/claim 失败:', e && e.message);
    res.status(500).json({ error: '领取任务失败', code: 'CLAIM_FAILED' });
  }
});

// ── 自身进度（需凭证；只看自己的）────────────────────────────────────
router.get('/tasks/:id/progress', authenticateAgentToken, async (req, res) => {
  try {
    const pr = await taskService.getProgress(req.params.id, req.agent.id);
    if (!pr) return fail(res, 404, 'PROGRESS_NOT_FOUND', '你还没有领取该任务（或任务不存在）');
    res.json({
      success: true, tier: req.tier,
      progress: {
        taskId: pr.task_id, status: pr.status, objectiveIndex: pr.objective_index || 0,
        state: pr.state || {}, rewardGranted: pr.reward_granted === true,
        claimedAt: pr.claimed_at, completedAt: pr.completed_at,
      },
    });
  } catch (e) {
    console.error('[Agent] GET /tasks/:id/progress 失败:', e && e.message);
    res.status(500).json({ error: '进度读取失败', code: 'PROGRESS_FAILED' });
  }
});

// ── 自身进度上报（Key 档；★只接受 note 与 abandon，绝不接受完成判定）──
router.put('/tasks/:id/progress', authenticateAgentToken, async (req, res) => {
  try {
    if (!requireKeyTier(req, res)) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const pr = await taskService.getProgress(req.params.id, req.agent.id);
    if (!pr) return fail(res, 404, 'PROGRESS_NOT_FOUND', '你还没有领取该任务');
    if (pr.status === 'completed') return fail(res, 400, 'ALREADY_COMPLETED', '该任务你已完成，不可再改');

    const state = Object.assign({}, pr.state || {});
    if (body.note !== undefined) state.note = String(body.note).slice(0, 200);
    const abandon = body.abandon === true;
    // ★ 任何完成/目标进度字段一律拒绝：判定权只在 objectiveEvaluator
    for (const k of ['status', 'completed', 'objectiveIndex', 'steps', 'rewardGranted']) {
      if (k in body && k !== 'status') return fail(res, 400, 'FIELD_NOT_ALLOWED', '不允许上报字段：' + k + '（进度由服务端判定）');
    }
    // ★ world_task_progress 无 updated_at 列（迁移未建），不要写它
    const upd = await query(
      `UPDATE world_task_progress SET state=$2::jsonb, status=$3 WHERE id=$1 RETURNING *`,
      [pr.id, JSON.stringify(state), abandon ? 'abandoned' : pr.status]);
    res.json({
      success: true, tier: req.tier,
      progress: {
        taskId: upd.rows[0].task_id, status: upd.rows[0].status,
        state: upd.rows[0].state || {}, abandoned: abandon,
      },
      hint: '进度判定由服务端事件驱动（objectiveEvaluator），本接口只记录备注/放弃',
    });
  } catch (e) {
    console.error('[Agent] PUT /tasks/:id/progress 失败:', e && e.message);
    res.status(500).json({ error: '进度上报失败', code: 'PROGRESS_UPDATE_FAILED' });
  }
});

module.exports = router;
