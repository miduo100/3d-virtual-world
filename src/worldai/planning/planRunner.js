/**
 * planRunner —— 已批准 Plan 的最小执行尝试（AI World Brain · Phase 3 · P2-2/6/7）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * Phase 3 边界（写进代码，避免被当成故障）：
 *   1) **工具注册表为空**（World Tool 注册属 Phase 4）→ 低风险 step 尝试执行必然
 *      TOOL_NOT_REGISTERED——这是**明确的失败 + 记忆**，不是静默（P2-7）；
 *   2) **人工风险等级优先**（P2-6）：human_risk_locked 的 step 保持人工设定的等级，
 *      非 low 一律转 awaiting_approval + 写 world_approvals（Phase 4 审批闸接管），
 *      绝不自动执行——哪怕 AI 后来把它标成 low；
 *   3) 未 approve 的 Plan 一行都不执行（P2-2）：本文件只取 status='approved' 的 Plan。
 * 不计入 Runtime 熔断（那是 LLM 委托轮次的闸；Phase 4 工具执行再纳入轮预算）。
 */
'use strict';

const { query } = require('../../database/db');
const memoryService = require('../memory/memoryService');
const logger = require('../../services/logger');

/**
 * 尝试推进最旧一条 approved Plan 的第一个 pending step（每 tick 最多一个）。
 * @returns {ok, action:'none'|'started'|'awaiting_approval'|'failed_unregistered', ...}
 */
async function attemptApprovedPlan(worldId) {
  const planR = await query(
    `SELECT * FROM world_plans WHERE world_id = $1 AND status IN ('approved','executing') ORDER BY approved_at ASC LIMIT 1`,
    [String(worldId)]
  );
  if (!planR.rows.length) return { ok: true, action: 'none' };
  const plan = planR.rows[0];

  // approved → executing（条件迁移；已在 executing 的继续推进——多 tick 跨天执行同一 Plan）
  let active = plan;
  if (plan.status === 'approved') {
    const st = await query(
      `UPDATE world_plans SET status='executing', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND status = 'approved' RETURNING *`, [plan.id]);
    if (!st.rows.length) return { ok: true, action: 'none' };
    active = st.rows[0];
  }

  const stepR = await query(
    `SELECT * FROM world_plan_steps WHERE plan_id = $1 AND status = 'pending' ORDER BY phase_no ASC, seq ASC LIMIT 1`,
    [active.id]
  );
  if (!stepR.rows.length) {
    // 全部 step 有终态 → 收尾
    await query(`UPDATE world_plans SET status='completed', finished_at=NOW(), updated_at=NOW() WHERE id=$1`, [active.id]);
    return { ok: true, action: 'completed', planId: String(active.id) };
  }
  const step = stepR.rows[0];

  // P2-6：非 low（含被人工锁定为 high/medium 的）一律不自动执行 → 审批闸
  if (step.risk_tier !== 'low') {
    await query(
      `UPDATE world_plan_steps SET status='awaiting_approval',
          error = $2, finished_at = NULL, updated_at = NOW() WHERE id = $1`,
      [step.id, '风险等级 ' + step.risk_tier + (step.human_risk_locked ? '（人工设定，AI 不得降级）' : '') + ' 需人工审批（Phase 4 审批闸），不自动执行']
    );
    await query(
      `INSERT INTO world_approvals (world_id, target_type, target_id, risk_tier, payload, decision, expires_at)
       VALUES ($1,'tool',$2,$3,$4,'pending', NOW() + INTERVAL '72 hours')`,
      [String(worldId), step.id, step.risk_tier,
        JSON.stringify({ planId: String(active.id), tool: step.tool_name, params: step.params, phaseNo: step.phase_no, seq: step.seq })]
    );
    logger.audit('world_ai_step_awaiting_approval', { planId: String(active.id), stepId: String(step.id), risk: step.risk_tier, locked: step.human_risk_locked });
    return { ok: true, action: 'awaiting_approval', planId: String(active.id), stepId: String(step.id), risk: step.risk_tier };
  }

  // P2-7：低风险才尝试执行；Phase 3 工具注册表为空 → 明确失败 + 记忆（不静默）
  await query(`UPDATE world_plan_steps SET status='executing', started_at=NOW(), updated_at=NOW() WHERE id=$1`, [step.id]);
  const reason = 'TOOL_NOT_REGISTERED: ' + step.tool_name + '（World Tool 注册表属 Phase 4，本阶段无任何已注册工具）';
  await query(
    `UPDATE world_plan_steps SET status='failed', error=$2, finished_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [step.id, reason]
  );
  const pr = await query(`SELECT progress FROM world_plans WHERE id = $1`, [active.id]);
  const prog = pr.rows[0].progress || {};
  prog.totalSteps = prog.totalSteps || 0;
  prog.failedSteps = (prog.failedSteps || 0) + 1;
  prog.currentStepId = String(step.id);
  await query(`UPDATE world_plans SET progress = $2::jsonb, updated_at=NOW() WHERE id=$1`, [active.id, JSON.stringify(prog)]);
  await memoryService.write({ worldId: String(worldId), scope: 'plan', kind: 'lesson', source: 'planner',
    subject_id: String(step.id), plan_id: active.id, importance: 4,
    content: 'step 执行明确失败：' + reason + '（工具在 Phase 4 注册后可 retry）' });
  logger.audit('world_ai_step_failed_unregistered', { planId: String(active.id), stepId: String(step.id), tool: step.tool_name });
  return { ok: true, action: 'failed_unregistered', planId: String(active.id), stepId: String(step.id), tool: step.tool_name };
}

module.exports = { attemptApprovedPlan };
