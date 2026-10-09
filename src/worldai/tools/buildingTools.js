/**
 * buildingTools —— ③ 建筑 6 工具（AI World Brain · Phase 5 · §D.3③ + P4-1~P4-10/P4-15）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 全部走 executor（守卫/预算/账本零本地实现）；world_objects 的写入只经
 *   entityAssembler → batchJournal（红线 1）。procedural 产出 model_path 恒为
 *   'geometry_building:<数字id>'（P4-5 契约，前端 addGeometryBuilding 可反查渲染）。
 */
'use strict';

const { query } = require('../../database/db');
const verbRegistry = require('./verbRegistry');
const builderRuntime = require('../builder/builderRuntime');
const specCompiler = require('../builder/specCompiler');
const assetValidator = require('../builder/assetValidator');
const buildingSpec = require('../builder/buildingSpec');
const entityAssembler = require('../builder/entityAssembler');
const assetSelector = require('../builder/assetSelector');

/** spec 干编译 + 预算校验（executor 校验层之后、impl 之前的 preValidate，P4-9/P4-10） */
function preValidateSpec(p) {
  const v = buildingSpec.validate(p.spec);
  if (!v.ok) return { ok: false, code: 'SPEC_INVALID', errors: v.errors, hint: v.hint };
  const compiled = specCompiler.compile(v.spec);
  if (!compiled.ok) return compiled;
  const val = assetValidator.validateComponents(compiled.components, {
    maxComponents: v.spec.budget && v.spec.budget.maxComponents,
    maxTriangles: v.spec.budget && v.spec.budget.maxTriangles,
  });
  if (!val.ok) return { ok: false, code: 'ASSET_VALIDATOR_DENY', errors: val.errors, hint: val.hint, stats: val.stats };
  return { ok: true };
}

/** assemble 的 repeat 展开计数 + 图元预算（preValidate） */
function preValidateParts(p) {
  const parts = Array.isArray(p.parts) ? p.parts : [];
  let count = 0;
  const compBudget = (p.spec && p.spec.budget) || {};
  for (const raw of parts) {
    const rep = raw && raw.repeat;
    const n = rep && Number(rep.count) > 1 ? Math.min(400, Math.floor(Number(rep.count))) : 1;
    count += n;
  }
  const maxComp = Math.min(assetValidator.HARD_LIMITS.maxComponents,
    Math.max(1, Math.floor(Number(compBudget.maxComponents) || assetValidator.HARD_LIMITS.maxComponents)));
  if (count > maxComp) {
    return { ok: false, code: 'ASSET_VALIDATOR_DENY', hint: '展开后部件数 ' + count + ' > ' + maxComp,
      errors: [{ path: 'parts', message: 'repeat 展开后共 ' + count + ' 个部件，超过预算 ' + maxComp, got: count }] };
  }
  return { ok: true, expanded: count };
}

/** 展开一个 part 计划 → 部件数组（确定性） */
function expandPartPlan(raw, index) {
  const rep = raw && raw.repeat;
  const n = rep && Number(rep.count) > 1 ? Math.min(400, Math.floor(Number(rep.count))) : 1;
  const axis = rep && ['x', 'y', 'z'].indexOf(String(rep.axis)) >= 0 ? String(rep.axis) : 'x';
  const step = Number(rep && rep.step) || 1;
  const baseKey = String((raw && raw.partKey) || 'part_' + (index + 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const pos = Object.assign({}, (raw && raw.position) || {});
    if (n > 1) pos[axis] = (Number(pos[axis]) || 0) + step * i;
    out.push({
      partKey: n > 1 ? baseKey + '_' + (i + 1) : baseKey,
      partRole: (raw && raw.partRole) || 'prop',
      templateId: raw && raw.templateId,
      params: (raw && raw.params) || {},
      assetPath: raw && raw.assetPath,
      position: pos,
      rotationY: Number(raw && raw.rotationY) || 0,
    });
  }
  return out;
}

function registerAll() {
  const R = (d) => verbRegistry.register(Object.assign({ category: 'building', scope: 'world:build' }, d));

  // ── create_building：通用入口（资产优先，自动降级 procedural）───────────
  R({
    name: 'create_building', risk: 'low', reversible: true, guardAction: 'place_part', presetTarget: 'create',
    preValidate: preValidateSpec,
    summary: '按 Building Spec 建完整实体（L0 资产 → L1 零件 → L2 程序化自动选路；同 spec 幂等）',
    params: { type: 'object', required: ['spec', 'regionId', 'x', 'z'], properties: {
      spec: { type: 'object' },
      regionId: { type: 'string', minLength: 2, maxLength: 60 },
      x: { type: 'number' }, z: { type: 'number' }, rotationY: { type: 'number' },
    } },
    impl: async (p, ctx) => {
      const r = await builderRuntime.buildFromSpec({
        spec: p.spec, worldId: ctx.worldId, regionKey: p.regionId || ctx.regionKey,
        missionId: ctx.missionId, actor: ctx.actor, x: p.x, z: p.z, rotationY: p.rotationY,
        effectiveAutonomy: ctx.effectiveAutonomy,
      });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason || (r.errors && JSON.stringify(r.errors).slice(0, 300)), errors: r.errors, hint: r.hint };
      return {
        ok: true, deduped: r.deduped,
        result: { entityId: r.entityId, strategy: r.strategy, reason: r.reason, notes: r.notes, objects: (r.createdObjectIds || []).length },
        afterState: { entityId: r.entityId, name: r.entity.name, mode: r.entity.visual && r.entity.visual.mode },
        undo: r.undo, undoable: true,
      };
    },
  });

  // ── create_procedural_building：显式程序化（跳过资产检索）──────────────
  R({
    name: 'create_procedural_building', risk: 'low', reversible: true, guardAction: 'place_part', presetTarget: 'create',
    preValidate: preValidateSpec,
    summary: '强制程序化：SpecCompiler 编译 components → geometry_buildings + world_objects（model_path=geometry_building:<id>）',
    params: { type: 'object', required: ['spec', 'regionId', 'x', 'z'], properties: {
      spec: { type: 'object' },
      regionId: { type: 'string', minLength: 2, maxLength: 60 },
      x: { type: 'number' }, z: { type: 'number' }, rotationY: { type: 'number' },
    } },
    impl: async (p, ctx) => {
      const spec = Object.assign({}, p.spec, { assembly: 'procedural_only', assetHints: { keywords: [], preferTags: [] } });
      const r = await builderRuntime.buildFromSpec({
        spec, worldId: ctx.worldId, regionKey: p.regionId || ctx.regionKey,
        missionId: ctx.missionId, actor: ctx.actor, x: p.x, z: p.z, rotationY: p.rotationY,
        effectiveAutonomy: ctx.effectiveAutonomy,
      });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason || (r.errors && JSON.stringify(r.errors).slice(0, 300)), errors: r.errors, hint: r.hint };
      return {
        ok: true, deduped: r.deduped,
        result: { entityId: r.entityId, strategy: r.strategy, objects: (r.createdObjectIds || []).length },
        afterState: { entityId: r.entityId },
        undo: r.undo, undoable: true,
      };
    },
  });

  // ── assemble_building：显式零件装配（P4-7 幂等 20 面墙）────────────────
  R({
    name: 'assemble_building', risk: 'low', reversible: true, guardAction: 'place_part', presetTarget: 'create',
    preValidate: preValidateParts,
    summary: '显式装配：parts[]（templateId 或 assetPath，可 repeat）→ N 个 world_objects + 1 实体（UNIQUE 幂等）',
    params: { type: 'object', required: ['regionId', 'x', 'z', 'parts'], properties: {
      name: { type: 'string', maxLength: 120 },
      regionId: { type: 'string', minLength: 2, maxLength: 60 },
      x: { type: 'number' }, z: { type: 'number' }, rotationY: { type: 'number' },
      parts: { type: 'array', maxItems: 100, items: { type: 'object' } },
    } },
    impl: async (p, ctx) => {
      const regionKey = p.regionId || ctx.regionKey;
      // 展开部件计划；模板部件按 (templateId+params) 共享一条 geometry_buildings 行（合批友好）
      const plans = [];
      (p.parts || []).forEach((raw, i) => plans.push(...expandPartPlan(raw, i)));
      const geoCache = new Map();
      const parts = [];
      for (const plan of plans) {
        let modelPath = plan.assetPath ? String(plan.assetPath) : null;
        let assetRef = { kind: 'asset', ref: modelPath };
        if (!modelPath) {
          if (!plan.templateId) return { ok: false, code: 'PART_INVALID', reason: '部件 ' + plan.partKey + ' 缺 templateId 或 assetPath' };
          const key = plan.templateId + '|' + JSON.stringify(plan.params || {});
          if (!geoCache.has(key)) {
            const built = specCompiler.compile({ parts: [{ templateId: plan.templateId, params: plan.params }], seed: p.seed, name: plan.partKey });
            if (!built.ok) return { ok: false, code: built.code, reason: (built.errors && JSON.stringify(built.errors).slice(0, 200)) || built.hint, errors: built.errors, hint: built.hint };
            const val = assetValidator.validateComponents(built.components, {});
            if (!val.ok) return { ok: false, code: 'ASSET_VALIDATOR_DENY', errors: val.errors, hint: val.hint };
            const ins = await query(
              `INSERT INTO geometry_buildings (user_id, name, template_id, geometry_data, category, description)
               VALUES (0, $1, $2, $3::jsonb, 'building', 'World AI assemble_building 共享几何') RETURNING id`,
              [String(built.name).slice(0, 200), String(plan.templateId).slice(0, 100), JSON.stringify({ name: built.name, components: built.components, specSource: 'world_ai' })]
            );
            geoCache.set(key, ins.rows[0].id);
          }
          modelPath = 'geometry_building:' + geoCache.get(key);
          assetRef = { kind: 'template', ref: plan.templateId, params: plan.params, geometryId: geoCache.get(key) };
        }
        parts.push({
          partKey: plan.partKey, partRole: plan.partRole, assetRef,
          localTransform: { position: plan.position, rotationY: plan.rotationY },
          objectParams: {
            type: modelPath.startsWith('geometry_building:') ? 'geometry_building' : 'uploaded_model',
            name: (p.name || 'AI 装配') + '_' + plan.partKey,
            model_path: modelPath,
            position_x: (Number(p.x) || 0) + (Number(plan.position.x) || 0),
            position_y: Number(plan.position.y) || 0,
            position_z: (Number(p.z) || 0) + (Number(plan.position.z) || 0),
            rotation_y: plan.rotationY,
            has_collision: plan.partRole !== 'roof',
          },
        });
      }
      const specForHash = { name: p.name || 'assemble', parts: (p.parts || []), x: p.x, z: p.z };
      const r = await entityAssembler.assembleEntity({
        worldId: ctx.worldId, regionKey, missionId: ctx.missionId, actor: ctx.actor,
        effectiveAutonomy: ctx.effectiveAutonomy,
        entityType: 'building', name: p.name || 'AI 装配建筑', purpose: null,
        visual: { mode: 'composite', parts: parts.map((x) => ({ partKey: x.partKey, partRole: x.partRole, ref: x.assetRef.ref })) },
        physical: { hasCollision: true, footprint: { width: Math.max(1, parts.length), depth: 1 }, height: 3, bounds: null, anchorOffsetY: 0 },
        spec: specForHash, parts,
      });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      try {
        const eventLog = require('../perception/eventLog');
        await eventLog.log({ worldId: ctx.worldId, type: 'entity_created', actorType: 'ai', actorId: ctx.actor,
          entityId: r.entity.id, x: p.x, z: p.z,
          payload: { name: String(r.entity.name).slice(0, 60), mode: 'composite', strategy: 'assemble', parts: parts.length, objects: (r.createdObjectIds || []).length } });
      } catch (e) { /* 静默 */ }
      return {
        ok: true, deduped: r.deduped,
        result: { entityId: r.entity.id, parts: parts.length, objects: (r.createdObjectIds || []).length },
        afterState: { entityId: r.entity.id, partCount: parts.length },
        undo: { kind: 'remove_entity', worldId: String(ctx.worldId), entityId: r.entity.id },
        undoable: true,
      };
    },
  });

  // ── modify_building：整体改名/整体移动（medium）────────────────────────
  R({
    name: 'modify_building', risk: 'medium', reversible: false, guardAction: 'modify', presetTarget: 'entity',
    summary: '修改实体：patch.name 改名 / patch.{dx,dy,dz} 整体平移（逐部件过守卫）',
    params: { type: 'object', required: ['entityId', 'patch'], properties: {
      entityId: { type: 'string', minLength: 8, maxLength: 64 },
      patch: { type: 'object', properties: {
        name: { type: 'string', maxLength: 120 },
        dx: { type: 'number' }, dy: { type: 'number' }, dz: { type: 'number' },
      } },
    } },
    impl: async (p, ctx) => {
      const r = await entityAssembler.moveBuilding({
        worldId: ctx.worldId, entityId: p.entityId, name: p.patch && p.patch.name,
        dx: p.patch && p.patch.dx, dy: p.patch && p.patch.dy, dz: p.patch && p.patch.dz,
        regionKey: ctx.regionKey, missionId: ctx.missionId,
        effectiveAutonomy: ctx.effectiveAutonomy, approvedRisks: ctx.approvedRisks,
      });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      return { ok: true, result: { moved: r.count }, afterState: { entityId: p.entityId, patch: p.patch }, undoable: false };
    },
  });

  // ── remove_building：整体删除（high，审批；事务原子，P4-8）──────────────
  R({
    name: 'remove_building', risk: 'high', reversible: false, guardAction: 'delete_object', presetTarget: 'entity',
    summary: '删除整个实体（单事务：N 部件 + Entity + 交互点；逐件过守卫，任一拒绝整体回滚）',
    params: { type: 'object', required: ['entityId'], properties: {
      entityId: { type: 'string', minLength: 8, maxLength: 64 },
      reason: { type: 'string', maxLength: 300 },
    } },
    impl: async (p, ctx) => {
      const r = await entityAssembler.removeBuilding({
        worldId: ctx.worldId, entityId: p.entityId,
        regionKey: ctx.regionKey, missionId: ctx.missionId,
        effectiveAutonomy: ctx.effectiveAutonomy, approvedRisks: ctx.approvedRisks,
      });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      try {
        const eventLog = require('../perception/eventLog');
        await eventLog.log({ worldId: ctx.worldId, type: 'entity_removed', actorType: 'ai', actorId: ctx.actor,
          entityId: r.entityId, payload: { name: String(r.name || '').slice(0, 60), objects: r.deletedObjects } });
      } catch (e) { /* 静默 */ }
      return { ok: true, result: { entityId: r.entityId, deletedObjects: r.deletedObjects }, afterState: { entityId: r.entityId, deleted: true }, undoable: false };
    },
  });

  // ── search_assets：只读检索（不碰 world_objects）──────────────────────
  R({
    name: 'search_assets', risk: 'low', reversible: false, guardAction: null, scope: 'world:observe',
    summary: '检索可用资产：整栋资产（v_all_models）+ 零件库（part_libraries，pending_review 隐身）',
    params: { type: 'object', properties: {
      text: { type: 'string', maxLength: 120 },
      tags: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 40 } },
      roles: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 40 } },
      styleFamily: { type: 'string', maxLength: 60 },
      limit: { type: 'integer', min: 1, max: 20 },
    } },
    impl: async (p) => {
      const assets = await assetSelector.searchAssets({ text: p.text, tags: p.tags, limit: p.limit || 8 });
      const parts = (p.roles && p.roles.length)
        ? await assetSelector.searchPartsByRoles(p.roles.map(String), p.styleFamily || null)
        : null;
      return {
        ok: true,
        result: {
          tags: assets.tags,
          assets: assets.items,
          partsByRole: parts ? Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.slice(0, 5).map((x) => ({ partKey: x.partKey, role: x.role, modelPath: x.modelPath, grid: x.grid }))])) : null,
        },
        afterState: { done: true },
      };
    },
  });
}

module.exports = { registerAll };
