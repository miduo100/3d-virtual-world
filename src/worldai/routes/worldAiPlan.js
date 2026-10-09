/**
 * worldAiPlan 路由（/api/world-ai 的第三个 router · AI World Brain · Phase 3）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 目标 CRUD + 规划生成/编辑/审批（§D World Plan 端点的 Phase 3 子集）。
 * rollback/replan/step approve|retry 等执行类端点属 Phase 4（工具账本就位后才有意义）。
 * 挂载在 worldAi.js → 继承 authenticateAdminToken。
 */
const express = require('express');
const router = express.Router();
const { query } = require('../../database/db');
const worldAiConfig = require('../config');
const goalService = require('../goals/goalService');
const worldPlanner = require('../planning/worldPlanner');
const planValidator = require('../planning/planValidator');
const approvalGate = require('../planning/approvalGate');

async function wid(body) {
  return (body && body.worldId) || (await worldAiConfig.getConfig()).world_id;
}
function send(res, r, okStatus) {
  if (r && r.ok) return res.status(okStatus || 200).json(Object.assign({ success: true }, r));
  return res.status(400).json(Object.assign({ success: false }, r));
}

// ── 目标 ──
router.post('/goals', async (req, res) => {
  try {
    const b = req.body || {};
    send(res, await goalService.createGoal(Object.assign({}, b, { worldId: await wid(b), approvedBy: req.adminUser.id })));
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.get('/goals', async (req, res) => {
  try { send(res, await goalService.listGoals(await wid(req.query))); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.put('/goals/:id', async (req, res) => {
  try { send(res, await goalService.updateGoal(await wid(req.body), req.params.id, req.body || {})); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 规划 ──
router.post('/plans/generate', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.goalId) return res.status(400).json({ success: false, code: 'GOAL_REQUIRED', reason: '必须指定 goalId' });
    send(res, await worldPlanner.generate({ worldId: await wid(b), goalId: b.goalId, injectPlan: b.injectPlan || null, adminName: req.adminUser.username }));
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.get('/plans', async (req, res) => {
  try {
    const w = await wid(req.query);
    const params = [String(w)];
    let sql = `SELECT p.*, (SELECT count(*)::int FROM world_plan_steps s WHERE s.plan_id = p.id) AS step_count
                 FROM world_plans p WHERE p.world_id = $1`;
    if (req.query.status) { params.push(String(req.query.status)); sql += ` AND p.status = $${params.length}`; }
    if (req.query.goalId) { params.push(String(req.query.goalId)); sql += ` AND p.goal_id = $${params.length}`; }
    sql += ` ORDER BY p.created_at DESC LIMIT 50`;
    const r = await query(sql, params);
    res.json({ success: true, plans: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.get('/plans/:id', async (req, res) => {
  try {
    const w = await wid(req.query);
    const plan = await approvalGate.getPlan(w, req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: '规划不存在' });
    const steps = await query(`SELECT * FROM world_plan_steps WHERE plan_id = $1 ORDER BY phase_no, seq`, [plan.id]);
    res.json({ success: true, plan, steps: steps.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/** 人工编辑（P2-4）：revision+1 → 状态回 draft；删阶段 = removePhaseNo（级联删该阶段 steps） */
router.put('/plans/:id', async (req, res) => {
  try {
    const w = await wid(req.body);
    const plan = await approvalGate.getPlan(w, req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: '规划不存在' });
    if (['executing', 'completed'].indexOf(plan.status) >= 0) {
      return res.status(400).json({ success: false, code: 'EDIT_FORBIDDEN', reason: '执行中/已完成的规划不可编辑（先 pause 或回滚）' });
    }
    const b = req.body || {};
    const phases = Array.isArray(b.phases) ? b.phases : (plan.phases || []);
    const removePhaseNo = Number(b.removePhaseNo) > 0 ? Number(b.removePhaseNo) : null;
    const finalPhases = removePhaseNo ? phases.filter((ph) => Number(ph.no) !== removePhaseNo) : phases;
    if (removePhaseNo) {
      await query(`DELETE FROM world_plan_steps WHERE plan_id = $1 AND phase_no = $2`, [plan.id, removePhaseNo]);
      // 重排剩余 phase 的 steps.phase_no（确定性）
      for (let i = 0; i < finalPhases.length; i++) {
        const newNo = i + 1;
        const oldNo = Number(finalPhases[i].no);
        if (oldNo !== newNo) await query(`UPDATE world_plan_steps SET phase_no = $3 WHERE plan_id = $1 AND phase_no = $2`, [plan.id, oldNo, newNo]);
        finalPhases[i].no = newNo;
      }
    }
    const r = await query(
      `UPDATE world_plans SET
         title = COALESCE($3, title), summary = COALESCE($4, summary), overview = COALESCE($5, overview),
         phases = $6::jsonb, risks = $7::jsonb,
         revision = revision + 1, status = 'draft', updated_at = NOW()
       WHERE id = $1 AND world_id = $2 RETURNING *`,
      [plan.id, String(w),
        b.title !== undefined ? String(b.title).slice(0, 200) || null : null,
        b.summary !== undefined ? String(b.summary || '').slice(0, 2000) : null,
        b.overview !== undefined ? String(b.overview || '').slice(0, 5000) : null,
        JSON.stringify(finalPhases), b.risks !== undefined ? JSON.stringify(b.risks || []) : JSON.stringify(plan.risks || [])]
    );
    res.json({ success: true, plan: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/plans/:id/submit', async (req, res) => {
  try { send(res, await approvalGate.submit(await wid(req.body), req.params.id, req.adminUser)); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/plans/:id/approve', async (req, res) => {
  try { send(res, await approvalGate.approve(await wid(req.body), req.params.id, req.adminUser, (req.body || {}).comment)); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/plans/:id/reject', async (req, res) => {
  try { send(res, await approvalGate.reject(await wid(req.body), req.params.id, req.adminUser, (req.body || {}).reason)); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/plans/:id/pause', async (req, res) => {
  try { send(res, await approvalGate.pause(await wid(req.body), req.params.id)); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/plans/:id/resume', async (req, res) => {
  try { send(res, await approvalGate.resume(await wid(req.body), req.params.id)); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 步骤 ──
router.get('/steps', async (req, res) => {
  try {
    const params = [];
    let sql = `SELECT s.*, p.title AS plan_title, p.status AS plan_status FROM world_plan_steps s
                 JOIN world_plans p ON p.id = s.plan_id WHERE p.world_id = $1`;
    params.push(String(await wid(req.query)));
    if (req.query.planId) { params.push(String(req.query.planId)); sql += ` AND s.plan_id = $${params.length}`; }
    if (req.query.status) { params.push(String(req.query.status)); sql += ` AND s.status = $${params.length}`; }
    sql += ` ORDER BY s.phase_no, s.seq LIMIT 200`;
    const r = await query(sql, params);
    res.json({ success: true, steps: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/** 人工改 step（P2-4/P2-6）：params/risk/rationale/删除；risk 人工设定即锁定（AI 不得降级）；
 *  编辑动作让 Plan revision+1 并回 draft（executing/completed 除外）。 */
router.put('/steps/:id', async (req, res) => {
  try {
    const w = await wid(req.body);
    const b = req.body || {};
    const sr = await query(
      `SELECT s.*, p.world_id, p.status AS plan_status FROM world_plan_steps s
         JOIN world_plans p ON p.id = s.plan_id WHERE s.id = $1`, [String(req.params.id)]);
    if (!sr.rows.length) return res.status(404).json({ success: false, error: '步骤不存在' });
    const step = sr.rows[0];
    if (step.world_id !== String(w)) return res.status(404).json({ success: false, error: '步骤不存在' });
    if (['executing', 'completed'].indexOf(step.plan_status) >= 0) {
      return res.status(400).json({ success: false, code: 'EDIT_FORBIDDEN', reason: '执行中/已完成的规划不可改步骤（先 pause）' });
    }
    if (b.deleted) {
      await query(`DELETE FROM world_plan_steps WHERE id = $1`, [step.id]);
    } else {
      const risk = ['low', 'medium', 'high'].indexOf(String(b.risk_tier)) >= 0 ? String(b.risk_tier) : null;
      await query(
        `UPDATE world_plan_steps SET
           params = COALESCE($2::jsonb, params),
           rationale = COALESCE($3, rationale),
           risk_tier = COALESCE($4, risk_tier),
           human_risk_locked = CASE WHEN $4::varchar IS NULL THEN human_risk_locked ELSE true END,
           updated_at = NOW()
         WHERE id = $1`,
        [step.id, b.params !== undefined ? JSON.stringify(b.params) : null,
          b.rationale !== undefined ? String(b.rationale || '').slice(0, 500) || null : null, risk]
      );
    }
    const pr = await query(
      `UPDATE world_plans SET revision = revision + 1, status = 'draft', updated_at = NOW()
        WHERE id = $1 AND status <> 'executing' AND status <> 'completed' RETURNING *`, [step.plan_id]);
    res.json({ success: true, step: (await query(`SELECT * FROM world_plan_steps WHERE id = $1`, [step.id])).rows[0] || null,
      plan: pr.rows[0] || null });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
