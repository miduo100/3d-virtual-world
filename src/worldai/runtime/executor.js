/**
 * executor —— World Tool 统一执行器（AI World Brain · Phase 4 · ★核心）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 流水线（§H.3 / §F.1 + §G.5①「统一守卫，不散落到动词内部」）：
 *   注册表 → 双层校验 → 每日/每轮预算 → ownershipGuard（唯一守卫）→ 风险闸
 *   → 记账(before) → 执行 → 记账(after/undo) → 幂等/回滚
 *
 * 关键判定顺序（判据对应）：
 *   P3-14 ToolValidation 结构化错误（在预算之前：参数不合法不占预算语义由 errors 说明）；
 *   P3-9  预算耗尽 → 账本记 denied；
 *   P3-6  守卫拒绝（human 资产）→ 账本记 denied，零副作用；
 *   P3-7  high 风险 → guard 的 HIGH_RISK_NEEDS_APPROVAL 转审批流（execution proposed + world_approvals）；
 *   P3-5  同 plan_step_id 幂等（succeeded 复用 / proposed 返回 AWAITING_APPROVAL）；
 *   P3-11 出生点保护半径在守卫内（§G.5③，budget.spawnProtection 提供参数）。
 */
'use strict';

const { query } = require('../../database/db');
const verbRegistry = require('../tools/verbRegistry');
const validate = require('../tools/validate');
const guard = require('../tools/ownershipGuard');
const toolJournal = require('../journal/toolJournal');
const budget = require('./budget');
const riskGate = require('./riskGate');

/** 懒加载工具实现并注册（避免 verbRegistry ↔ 工具模块循环 require） */
let loaded = false;
function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  require('../tools/observationTools').registerAll();
  require('../tools/spatialTools').registerAll();
  require('../tools/analyticsTools').registerAll();
  require('../tools/buildingTools').registerAll();   // Phase 5：建筑 6 工具
  require('../tools/npcTools').registerAll();        // Phase 5：NPC/玩法 4 工具
  require('../tools/gameplayTools').registerAll();   // Phase 6：玩法 9 + 世界系统 2 工具
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/** 组装守卫 ctx（守卫参数只来自配置与目标行，绝不接受 override） */
async function buildGuardCtx(ctx, target, def) {
  const cfg = await require('../config').getConfig(ctx.worldId);
  const sp = await budget.spawnProtection(ctx.worldId);
  return {
    worldId: String(ctx.worldId),
    regionKey: (target && target.region_id) || (ctx.regionKey || null),
    missionId: ctx.missionId || null,
    effectiveAutonomy: (cfg && cfg.autonomy) || 'managed',
    approvedRisks: Array.isArray(ctx.approvedRisks) ? ctx.approvedRisks : [],
    spawnPoint: sp.spawnPoint,
    protectedSpawnRadius: sp.radius,
  };
}

/** 取守卫目标行：create 类用预设行；entity 类取实体首个部件行；其余按 objectId 查真实行 */
async function resolveTarget(def, params, ctx) {
  if (!def.guardAction) return { target: null, gctx: await buildGuardCtx(ctx, null, def) };
  if (def.name === 'create_object' || def.presetTarget === 'create') {
    const target = {
      origin: 'ai',
      region_id: params.regionId || null,
      created_by: ctx.missionId || '',
      type: params.type || 'uploaded_model',
      position_x: num(params.x), position_z: num(params.z),
      is_locked: false,
    };
    return { target, gctx: await buildGuardCtx(ctx, target, def) };
  }
  if (def.presetTarget === 'entity') {
    const er = await query(`SELECT * FROM world_entities WHERE id = $1 AND world_id = $2`,
      [String(params.entityId || ''), String(ctx.worldId)]);
    const entity = er.rows[0] || null;
    if (!entity) {
      return { invalid: { ok: false, code: 'ENTITY_NOT_FOUND', reason: '实体不存在：' + (params.entityId || '(空)') } };
    }
    const pr = await query(
      `SELECT o.* FROM world_entity_parts pa JOIN world_objects o ON o.id = pa.world_object_id
        WHERE pa.entity_id = $1 ORDER BY pa.id ASC LIMIT 1`, [entity.id]);
    const row = pr.rows[0] || {
      origin: 'ai', region_id: entity.region_key, created_by: entity.created_by,
      is_locked: false, position_x: 0, position_z: 0, type: 'building',
    };
    const gctx = await buildGuardCtx(ctx, row, def);
    gctx.entityId = entity.id;
    return { target: row, gctx, entity };
  }
  const id = Number(params.objectId);
  if (!Number.isInteger(id) || id <= 0) {
    return { invalid: { ok: false, code: 'OBJECT_ID_INVALID', reason: 'objectId 必须是正整数' } };
  }
  const r = await query(`SELECT * FROM world_objects WHERE id = $1`, [id]);
  const row = r.rows[0] || null;
  return { target: row, gctx: await buildGuardCtx(ctx, row, def) };
}

/** 审批流：execution 停在 proposed + world_approvals 一行 pending（P3-7） */
async function requestApproval(def, params, ctx) {
  const exec = await toolJournal.startExecution({
    worldId: ctx.worldId, planId: ctx.planId, planStepId: ctx.planStepId,
    toolName: def.name, params, riskTier: def.risk,
    actor: ctx.actor || 'world_ai:runtime', reason: ctx.reason || null,
    beforeState: null,
  });
  const ap = await query(
    `INSERT INTO world_approvals (world_id, target_type, target_id, risk_tier, payload, decision, expires_at)
     VALUES ($1,'tool',gen_random_uuid(),$2,$3,'pending', NOW() + INTERVAL '72 hours')
     RETURNING *`,
    [String(ctx.worldId), def.risk, JSON.stringify({
      executionId: exec.id, tool: def.name, params,
      planId: ctx.planId || null, planStepId: ctx.planStepId || null,
    })]
  );
  await toolJournal.markProposed(exec.id, ap.rows[0].id);
  return {
    ok: false, code: 'AWAITING_APPROVAL', executionId: exec.id, approvalId: ap.rows[0].id,
    reason: def.risk === 'high'
      ? '「' + def.name + '」属 high 风险，必须人工批准后执行（§G.4，不可降级）'
      : '「' + def.name + '」按 risk_policy 需人工批准后执行',
  };
}

/** 执行一个工具（唯一入口） */
async function execute(toolName, params, ctx) {
  const c = ctx || {};
  ensureLoaded();
  const def = verbRegistry.get(toolName);
  // ① 注册表（never 类根本不在表里 → TOOL_NOT_REGISTERED，P2-7 的 Phase 4 形态）
  if (!def || !def.impl) {
    return {
      ok: false, code: 'TOOL_NOT_REGISTERED',
      reason: 'TOOL_NOT_REGISTERED: ' + toolName + '（不在 verbRegistry；never 类工具不存在于注册表，非"禁用"）',
    };
  }
  const p = params && typeof params === 'object' ? params : {};
  // ② 双层校验（P3-14 结构化错误，回给 LLM 自修）
  const v = validate.validate(def, p);
  if (!v.ok) {
    await toolJournal.markDenied({
      worldId: c.worldId, planId: c.planId, planStepId: c.planStepId,
      toolName: def.name, params: p, riskTier: def.risk,
      actor: c.actor, reason: c.reason,
      error: 'ToolValidation: ' + v.errors.map((e) => (e.path || '(root)') + ' ' + e.message).join('; ').slice(0, 500),
    });
    return v;
  }
  // ②b Phase 5 预算闸（assetValidator 等）：参数合法但超出结构/面数预算 → DENY + 结构化错误
  if (typeof def.preValidate === 'function') {
    const pv = await def.preValidate(p);
    if (!pv || pv.ok !== true) {
      await toolJournal.markDenied({
        worldId: c.worldId, planId: c.planId, planStepId: c.planStepId, toolName: def.name,
        params: p, riskTier: def.risk, actor: c.actor, reason: c.reason,
        error: (pv && (pv.hint || pv.code)) || 'PreValidate DENY',
      });
      return pv && pv.ok === false ? pv : { ok: false, code: 'PRE_VALIDATE', reason: '预校验未通过' };
    }
  }
  // ③ 预算（查表不查内存，P3-9）
  const b = await budget.check(c.worldId, c.runUsed);
  if (!b.ok) {
    await toolJournal.markDenied({
      worldId: c.worldId, planId: c.planId, planStepId: c.planStepId,
      toolName: def.name, params: p, riskTier: def.risk,
      actor: c.actor, reason: c.reason, error: b.code + ': ' + b.reason,
    });
    return { ok: false, code: b.code, reason: b.reason };
  }
  // ④ 幂等（P3-5）：同一 plan_step_id
  if (c.planStepId) {
    const prev = await toolJournal.findByIdempotentKey(c.planStepId);
    if (prev && prev.status === 'succeeded') {
      return { ok: true, deduped: true, executionId: prev.id, result: prev.result || {}, reason: '幂等：该 plan_step 已成功执行过，直接返回上次结果（P3-5）' };
    }
    if (prev && prev.status === 'proposed') {
      return { ok: false, code: 'AWAITING_APPROVAL', executionId: prev.id, approvalId: prev.approval_id, reason: '该 plan_step 已在等待人工审批，不重复提交' };
    }
  }
  // ⑤ 唯一守卫（§G.5①：动词执行前统一过一次，不可绕过）
  const t = await resolveTarget(def, p, c);
  if (t.invalid) {
    await toolJournal.markDenied({
      worldId: c.worldId, planId: c.planId, planStepId: c.planStepId, toolName: def.name,
      params: p, riskTier: def.risk, actor: c.actor, reason: c.reason,
      error: t.invalid.code + ': ' + t.invalid.reason,
    });
    return t.invalid;
  }
  let verdict = { allow: true, code: 'NO_GUARD', reason: '该工具不触碰 world_objects', risk: def.risk };
  if (def.guardAction && def.name !== 'create_area' && def.name !== 'modify_area' && def.name !== 'delete_area') {
    verdict = guard.check(def.guardAction, t.target, t.gctx);
    if (!verdict.allow) {
      // high 且守卫要求审批 → 转审批流（P3-7）；其余拒绝 → 账本记 denied（P3-6/P3-10/P3-11）
      if (verdict.code === 'HIGH_RISK_NEEDS_APPROVAL') {
        return await requestApproval(def, p, c);
      }
      await toolJournal.markDenied({
        worldId: c.worldId, planId: c.planId, planStepId: c.planStepId, toolName: def.name,
        params: p, riskTier: def.risk, actor: c.actor, reason: c.reason,
        error: verdict.code + ': ' + verdict.reason,
      });
      return { ok: false, code: verdict.code, reason: verdict.reason };
    }
  }
  // ⑥ 风险闸（low/medium 按 policy；high 已在上面被守卫拦下）
  const rg = await riskGate.decide(c.worldId, def.risk);
  if (rg.action === 'needs_approval') return await requestApproval(def, p, c);
  // ⑦ 执行（记账 before → impl → after/undo）
  return await runImpl(def, p, c, t);
}

/** 审批通过后的续跑（worldAiOps 的 approve 端点调用） */
async function resume(executionId, opts) {
  const o = opts || {};
  ensureLoaded();
  const exec = await toolJournal.findById(executionId);
  if (!exec) return { ok: false, code: 'EXECUTION_NOT_FOUND', reason: '账本行不存在：' + executionId };
  if (exec.status !== 'proposed' && exec.status !== 'approved') {
    return { ok: false, code: 'NOT_AWAITING_APPROVAL', reason: '该执行不在等待审批状态，当前 status=' + exec.status };
  }
  const def = verbRegistry.get(exec.tool_name);
  if (!def || !def.impl) return { ok: false, code: 'TOOL_NOT_REGISTERED', reason: '工具已被移除注册表：' + exec.tool_name };
  const params = exec.params || {};
  const ctx = {
    worldId: exec.world_id, planId: exec.plan_id, planStepId: exec.plan_step_id,
    missionId: null, actor: exec.actor, reason: exec.reason,
    approvedRisks: ['high'],
  };
  const t = await resolveTarget(def, params, ctx);
  if (t.invalid) return t.invalid;
  if (def.guardAction && def.presetTarget !== 'create') {
    const verdict = guard.check(def.guardAction, t.target, t.gctx);
    if (!verdict.allow) {
      await toolJournal.finishFail(exec.id, '审批后守卫仍拒绝：' + verdict.code + ' ' + verdict.reason, 0);
      return { ok: false, code: verdict.code, reason: verdict.reason };
    }
  }
  return await runImpl(def, params, ctx, t, exec.id);
}

/** 记账 before → 执行 → 记账 after/undo */
async function runImpl(def, params, ctx, t, existingExecutionId) {
  const started = Date.now();
  let beforeState = null;
  if (t.target && def.name !== 'create_object') beforeState = JSON.parse(JSON.stringify(t.target));
  const exec = existingExecutionId
    ? await toolJournal.findById(existingExecutionId)
    : await toolJournal.startExecution({
        worldId: ctx.worldId, planId: ctx.planId, planStepId: ctx.planStepId,
        toolName: def.name, params, riskTier: def.risk,
        actor: ctx.actor || 'world_ai:runtime', reason: ctx.reason || null,
        beforeState,
      });
  try {
    const implCtx = {
      worldId: String(ctx.worldId),
      actor: ctx.actor || 'world_ai:runtime',
      missionId: ctx.missionId || null,
      regionKey: ctx.regionKey || (t.target && t.target.region_id) || (params.regionId || null),
      effectiveAutonomy: t.gctx && t.gctx.effectiveAutonomy,
      approvedRisks: t.gctx && Array.isArray(t.gctx.approvedRisks) ? t.gctx.approvedRisks : [],
      executionId: exec.id,
    };
    const r = await def.impl(params, implCtx);
    if (!r || r.ok !== true) {
      const reason = (r && (r.reason || r.error)) || '工具执行失败';
      await toolJournal.finishFail(exec.id, (r && r.code ? r.code + ': ' : '') + reason, Date.now() - started);
      return { ok: false, code: (r && r.code) || 'TOOL_FAILED', reason };
    }
    const finished = await toolJournal.finishSuccess(exec.id, {
      afterState: r.afterState !== undefined ? r.afterState : { done: true },
      undo: r.undo || null,
      undoable: r.undoable === true,
      result: r.result || {},
      latencyMs: Date.now() - started,
    });
    return { ok: true, executionId: exec.id, status: finished.status, result: r.result || {}, deduped: r.deduped === true };
  } catch (e) {
    await toolJournal.finishFail(exec.id, 'EXCEPTION: ' + String(e && e.message).slice(0, 500), Date.now() - started);
    return { ok: false, code: 'TOOL_EXCEPTION', reason: String(e && e.message).slice(0, 300) };
  }
}

module.exports = { execute, resume, ensureLoaded };
