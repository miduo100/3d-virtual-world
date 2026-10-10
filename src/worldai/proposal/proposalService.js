/**
 * proposalService —— 设计提案（design_proposal）→ Operator 审核执行
 * AI World Brain · Phase 8 · §B.2「Steward/Builder Agent 想改世界必须向 Brain 提交建议」
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 载体复用 `world_approvals`（target_type='proposal'，决策②用户拍板）：
 *   审批流、审计、过期时间全部现成，不新建第二套待办表。
 * ★ Builder Agent 零写权：submit 只写 world_approvals，**绝不写 world_objects**；
 *   真正落世界必须等 Operator approve → 走既有 executor（守卫/预算/账本/审批一个不落）。
 */
'use strict';

const { query } = require('../../database/db');
const verbRegistry = require('../tools/verbRegistry');

const TARGET_TYPE = 'proposal';
/** Builder Agent 可提案的动词白名单（刻意排除一切删除/高风险动词） */
const ALLOWED_VERBS = ['create_building', 'create_procedural_building', 'assemble_building', 'create_object', 'create_npc', 'create_interaction', 'create_quest'];
/** 代码级硬拒：删除类与系统类动词永远不接受提案（§G.5 ⑥/⑦ 同源精神） */
const FORBIDDEN_VERBS = ['delete_object', 'remove_building', 'remove_npc', 'delete_area', 'modify_world_rule', 'cancel_event'];

function bad(code, reason, extra) { return Object.assign({ ok: false, code, reason }, extra || {}); }

/**
 * 提交提案（Builder Agent 唯一入口）
 * @param {object} o { worldId, actorId, actorType, title, verb, params, idempotencyKey, note }
 */
async function submit(o) {
  const p = o || {};
  if (!p.worldId) return bad('WORLD_ID_REQUIRED', '缺少 worldId');
  const verb = String(p.verb || '');
  if (!verb) return bad('VERB_REQUIRED', '缺少 verb');
  if (FORBIDDEN_VERBS.indexOf(verb) >= 0) {
    return bad('VERB_FORBIDDEN', '该动词不接受提案（删除/系统类只能由 Operator 直接走审批）：' + verb);
  }
  if (ALLOWED_VERBS.indexOf(verb) < 0) {
    return bad('VERB_NOT_ALLOWED', 'Builder Agent 只能提案建设类动词（白名单：' + ALLOWED_VERBS.join('/') + '）');
  }
  const def = verbRegistry.get(verb);
  if (!def || !def.impl) {
    return bad('TOOL_NOT_REGISTERED', '动词不在注册表：' + verb + '（never 类工具不存在于注册表，非"禁用"）');
  }
  // 幂等：同 key 只落一条（Runtime/客户端重跑安全）
  if (p.idempotencyKey) {
    const prev = (await query(
      `SELECT * FROM world_approvals WHERE target_type=$1 AND payload->>'idempotencyKey' = $2 LIMIT 1`,
      [TARGET_TYPE, String(p.idempotencyKey)])).rows[0];
    if (prev) return { ok: true, deduped: true, proposalId: prev.id, status: prev.decision, proposal: prev };
  }
  const ins = await query(
    `INSERT INTO world_approvals (world_id, target_type, target_id, risk_tier, payload, decision, expires_at)
     VALUES ($1,$2,gen_random_uuid(),$3,$4::jsonb,'pending', NOW() + INTERVAL '72 hours') RETURNING *`,
    [String(p.worldId), TARGET_TYPE, def.risk, JSON.stringify({
      kind: 'design_proposal',
      title: String(p.title || '').slice(0, 200),
      verb, params: p.params && typeof p.params === 'object' ? p.params : {},
      actorId: p.actorId ? String(p.actorId) : null,
      actorType: p.actorType ? String(p.actorType) : null,
      note: p.note ? String(p.note).slice(0, 500) : null,
      idempotencyKey: p.idempotencyKey ? String(p.idempotencyKey) : null,
      createdAt: new Date().toISOString(),
    })]);
  return { ok: true, deduped: false, proposalId: ins.rows[0].id, status: 'pending', proposal: ins.rows[0] };
}

async function get(proposalId) {
  const r = await query(`SELECT * FROM world_approvals WHERE id=$1 AND target_type=$2`, [String(proposalId || ''), TARGET_TYPE]);
  return r.rows[0] || null;
}

async function list(o) {
  const p = o || {};
  const params = [TARGET_TYPE, String(p.worldId || '')];
  let sql = `SELECT * FROM world_approvals WHERE target_type=$1 AND world_id=$2`;
  if (p.decision) { params.push(String(p.decision)); sql += ` AND decision=$` + params.length; }
  sql += ` ORDER BY created_at DESC LIMIT 50`;
  return (await query(sql, params)).rows || [];
}

/**
 * Operator 批准并执行（唯一会落世界的路径）
 * @param {object} o { operator, operatorId, ctx }  ctx 透传给 executor（worldId/actor/missionId/regionKey...）
 */
async function approve(proposalId, o) {
  const p = o || {};
  const row = await get(proposalId);
  if (!row) return bad('PROPOSAL_NOT_FOUND', '提案不存在：' + proposalId);
  if (row.decision !== 'pending') return bad('ALREADY_DECIDED', '该提案已决定：' + row.decision, { proposalId: row.id, decision: row.decision });
  const payload = row.payload || {};
  const verb = String(payload.verb || '');
  const def = verbRegistry.get(verb);
  if (!def || !def.impl) return bad('TOOL_NOT_REGISTERED', '动词已不在注册表：' + verb);

  const executor = require('../runtime/executor');
  const ctx = Object.assign({}, p.ctx || {}, {
    worldId: String((p.ctx && p.ctx.worldId) || row.world_id || ''),
    actor: (p.ctx && p.ctx.actor) || ('operator:' + String(p.operator || 'admin')),
    reason: 'design_proposal:' + row.id,
  });
  const r = await executor.execute(verb, payload.params || {}, ctx);
  // 审批未完（high 风险转人工）→ 保持 pending，记下 executionId 便于续跑
  if (!r.ok && r.code === 'AWAITING_APPROVAL') {
    await query(`UPDATE world_approvals SET payload = payload || $2::jsonb WHERE id=$1`,
      [row.id, JSON.stringify({ awaitingExecutionId: r.executionId || null, awaitingApprovalId: r.approvalId || null })]);
    return { ok: false, code: 'AWAITING_APPROVAL', proposalId: row.id, executionId: r.executionId, approvalId: r.approvalId, reason: r.reason };
  }
  if (!r.ok) {
    await query(`UPDATE world_approvals SET payload = payload || $2::jsonb WHERE id=$1`,
      [row.id, JSON.stringify({ lastError: { code: r.code, reason: String(r.reason || '').slice(0, 300), at: new Date().toISOString() } })]);
    return bad(r.code || 'EXECUTE_FAILED', String(r.reason || '执行失败'), { proposalId: row.id });
  }
  const up = await query(
    `UPDATE world_approvals SET decision='approved', decided_by=$2, decided_at=NOW(),
            comment=$3, payload = payload || $4::jsonb WHERE id=$1 RETURNING *`,
    [row.id, Number.isInteger(Number(p.operatorId)) ? Number(p.operatorId) : null,
      String(p.operator || 'operator').slice(0, 200),
      JSON.stringify({ executionId: r.executionId || null, result: r.result || {}, decidedBy: String(p.operator || 'operator') })]);
  return { ok: true, proposalId: row.id, decision: 'approved', executionId: r.executionId, proposal: up.rows[0] };
}

async function reject(proposalId, o) {
  const p = o || {};
  const row = await get(proposalId);
  if (!row) return bad('PROPOSAL_NOT_FOUND', '提案不存在：' + proposalId);
  if (row.decision !== 'pending') return bad('ALREADY_DECIDED', '该提案已决定：' + row.decision);
  const up = await query(
    `UPDATE world_approvals SET decision='rejected', decided_by=$2, decided_at=NOW(), comment=$3 WHERE id=$1 RETURNING *`,
    [row.id, Number.isInteger(Number(p.operatorId)) ? Number(p.operatorId) : null, String(p.reason || '').slice(0, 500)]);
  return { ok: true, proposalId: row.id, decision: 'rejected', proposal: up.rows[0] };
}

module.exports = { submit, get, list, approve, reject, ALLOWED_VERBS, FORBIDDEN_VERBS, TARGET_TYPE };
