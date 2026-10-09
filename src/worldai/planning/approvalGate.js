/**
 * approvalGate —— Plan 状态机 + 人工审批闸（AI World Brain · Phase 3 · P2-3/4/5）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 状态机（§C.3③）：draft → review → approved | rejected；executing ⇄ paused。
 * ★ Phase 3 铁律：**approve 之前 Runtime 不执行任何 step**（P2-2）；approve 是唯一人工闸门（P2-5）。
 * 每次决定都写 world_approvals 行（审计主体）。
 */
'use strict';

const { query } = require('../../database/db');
const memoryService = require('../memory/memoryService');

const STATUSES = ['draft', 'review', 'approved', 'executing', 'paused', 'completed', 'rejected', 'superseded'];

function bad(code, reason) { return Object.assign({ ok: false, code, reason }, {}); }

async function getPlan(worldId, id) {
  const r = await query(`SELECT * FROM world_plans WHERE world_id = $1 AND id = $2`, [String(worldId), String(id)]);
  return r.rows[0] || null;
}

/** 通用状态迁移：froms 白名单 + 审计行 */
async function transition(worldId, planId, to, froms, fields, approvalRow) {
  const params = [String(worldId), String(planId), to];
  let sql = `UPDATE world_plans SET status = $3::varchar, updated_at = NOW()`;
  for (const f of (fields || [])) { params.push(f.value); sql += `, ${f.col} = $${params.length}`; }
  params.push(froms);
  sql += ` WHERE world_id = $1 AND id = $2 AND status = ANY($${params.length}::varchar[]) RETURNING *`;
  const r = await query(sql, params);
  if (!r.rows.length) return null;
  const plan = r.rows[0];
  if (approvalRow) {
    await query(
      `INSERT INTO world_approvals (world_id, target_type, target_id, risk_tier, payload, decision, decided_by, decided_at, comment, expires_at)
       VALUES ($1,'plan',$2,$3,$4,$5,$6,NOW(),$7, NOW() + INTERVAL '72 hours')`,
      [String(worldId), String(planId), approvalRow.risk || 'plan',
        JSON.stringify(approvalRow.payload || { title: plan.title, revision: plan.revision }),
        approvalRow.decision, approvalRow.decidedBy || null, approvalRow.comment || null]
    );
  }
  return plan;
}

/** draft|rejected → review（提交人工审核） */
async function submit(worldId, planId, admin) {
  const plan = await transition(worldId, planId, 'review', ['draft', 'rejected'],
    [{ col: 'reviewed_by', value: admin ? admin.id : null }, { col: 'reviewed_at', value: new Date() }], null);
  if (!plan) return bad('INVALID_TRANSITION', '只有 draft/rejected 可以 submit');
  return { ok: true, plan };
}

/** review → approved（★人工闸门：记录 approved_by/at + 审批行） */
async function approve(worldId, planId, admin, comment) {
  const plan = await transition(worldId, planId, 'approved', ['review'],
    [{ col: 'approved_by', value: admin ? admin.id : null }, { col: 'approved_at', value: new Date() }],
    { decision: 'approved', decidedBy: admin && admin.id, comment, risk: 'plan' });
  if (!plan) return bad('INVALID_TRANSITION', '只有 review 可以 approve');
  memoryService.write({ worldId, scope: 'world', kind: 'decision', source: 'operator',
    subject_id: String(planId), importance: 4,
    content: 'Plan「' + plan.title + '」v' + plan.revision + ' 已由管理员 ' + (admin && admin.username) + ' 批准，等待执行' })
    .catch(() => {});
  return { ok: true, plan };
}

/** review → rejected（必须带 reason，P2-5） */
async function reject(worldId, planId, admin, reason) {
  const why = String(reason || '').trim();
  if (!why) return bad('REASON_REQUIRED', '驳回必须写明原因（AI 要据此重规划）');
  const plan = await transition(worldId, planId, 'rejected', ['review'],
    [{ col: 'rejected_reason', value: why.slice(0, 500) }],
    { decision: 'rejected', decidedBy: admin && admin.id, comment: why.slice(0, 500), risk: 'plan' });
  if (!plan) return bad('INVALID_TRANSITION', '只有 review 可以 reject');
  return { ok: true, plan };
}

/** executing ⇄ paused */
async function pause(worldId, planId) {
  const plan = await transition(worldId, planId, 'paused', ['executing'], [], null);
  if (!plan) return bad('INVALID_TRANSITION', '只有 executing 可以 pause');
  return { ok: true, plan };
}
async function resume(worldId, planId) {
  const plan = await transition(worldId, planId, 'executing', ['paused', 'approved'], [], null);
  if (!plan) return bad('INVALID_TRANSITION', '只有 paused/approved 可以 resume');
  return { ok: true, plan };
}

module.exports = { STATUSES, getPlan, submit, approve, reject, pause, resume };
