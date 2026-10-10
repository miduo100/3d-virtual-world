/**
 * builderAgentTools —— Builder Agent 的能力边界（AI World Brain · Phase 8 · §B.2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * Builder Agent（世界的"设计师"，可以是 Steward 也可以是外部 Agent 侧的设计角色）
 * 与 World AI Brain 的严格分离（§B.2 表）：
 *   · 它**不直接写世界**：本模块没有任何 create/delete/modify 世界对象的实现；
 *   · 它只能提交 `design_proposal`（落 world_approvals，target_type='proposal'）；
 *   · 执行与否由 **Operator（人）** 决定，执行走既有 executor（守卫/预算/账本/审批一个不落）。
 *
 * ★ 红线：外部 Agent 零写权（AGENT_SCOPES 不含任何 world:* scope）——
 *   即使本模块被外部 Agent 调用，落到世界的那一跳仍必须经 Operator + executor。
 */
'use strict';

const proposalService = require('../proposal/proposalService');

/** 本模块的导出白名单（验收断言：不允许出现任何世界写入函数） */
const EXPORTS = ['submitDesignProposal', 'listMyProposals', 'getProposal', 'describeCapabilities', 'EXPORTS', 'ALLOWED_VERBS'];
const ALLOWED_VERBS = proposalService.ALLOWED_VERBS;

/** 可提交提案的主体类型（外部 Agent / Steward / 内部 Builder；都不含写权） */
const ACTOR_TYPES = ['agent', 'builder', 'steward'];

function bad(code, reason, extra) { return Object.assign({ ok: false, code, reason }, extra || {}); }

/**
 * 提交设计提案（Builder Agent 的唯一动作）
 * @param {object} o { worldId, actorId, actorType, title, verb, params, idempotencyKey, note }
 */
async function submitDesignProposal(o) {
  const p = o || {};
  if (!p.actorId) return bad('ACTOR_REQUIRED', '缺少 actorId');
  const actorType = String(p.actorType || 'agent');
  if (ACTOR_TYPES.indexOf(actorType) < 0) {
    return bad('ACTOR_TYPE_INVALID', 'actorType 必须是 ' + ACTOR_TYPES.join('/'));
  }
  const r = await proposalService.submit(Object.assign({}, p, { actorType }));
  if (!r.ok) return r;
  return {
    ok: true, deduped: r.deduped === true, proposalId: r.proposalId, status: 'pending',
    note: '提案已提交，等待 Operator 审核；Builder Agent 本身不会改动世界（world_objects 零写入）',
  };
}

async function listMyProposals(o) {
  const p = o || {};
  const rows = await proposalService.list({ worldId: p.worldId, decision: p.decision });
  const mine = rows.filter((r) => String((r.payload && r.payload.actorId) || '') === String(p.actorId || ''));
  return { ok: true, proposals: mine };
}

async function getProposal(proposalId) {
  const row = await proposalService.get(proposalId);
  if (!row) return bad('PROPOSAL_NOT_FOUND', '提案不存在：' + proposalId);
  return { ok: true, proposal: row };
}

/** 能力自述（给 Agent/LLM 看：明确"只能提案，不能写"） */
function describeCapabilities() {
  return {
    role: 'builder_agent',
    canWriteWorld: false,
    canOnly: ['submit design_proposal'],
    allowedVerbs: ALLOWED_VERBS.slice(),
    flow: 'submit → (Operator approve) → executor（守卫/预算/账本/审批）→ world_objects',
    note: '提案提交本身对世界零写入；审批与执行由 Operator 完成，不以 Agent 身份直接写库',
  };
}

module.exports = {
  submitDesignProposal, listMyProposals, getProposal, describeCapabilities,
  EXPORTS, ALLOWED_VERBS,
};
