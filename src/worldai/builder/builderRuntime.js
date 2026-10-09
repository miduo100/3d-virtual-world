/**
 * builderRuntime —— 编排：选策略 → 生成 → 装配 Entity → 记账（AI World Brain · Phase 5 · §F.2④~⑦）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 编排口径（§F.2 Builder Runtime 图）：
 *   buildingSpec 校验 → assetSelector 定策略（L0 资产 → L1 零件装配 → L2 程序化兜底）
 *   → 生成 visual/physical → entityAssembler 装配 → eventLog + world_memories 记账。
 * ★ 红线：本文件不直接 INSERT world_objects（走 entityAssembler→batchJournal）、
 *   事件只走 eventLog.log()（TYPES 已含 entity_created/object_created）、LLM 意图外的决定全在代码。
 */
'use strict';

const { query } = require('../../database/db');
const buildingSpec = require('./buildingSpec');
const assetSelector = require('./assetSelector');
const specCompiler = require('./specCompiler');
const assetValidator = require('./assetValidator');
const entityAssembler = require('./entityAssembler');
const tagMapper = require('./canonicalTagMapper');

function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }
function r2(v) { return Math.round(Number(v) * 100) / 100; }

/** components → 物理摘要（bounds/height/footprint，供 world_entities.physical 与碰撞） */
function physicalOf(components, fallbackFootprint) {
  let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0, has = false;
  for (const c of (components || [])) {
    const p = c.position || {};
    const h = num(c.height, num(c.radius, 1) * 2) || 1;
    const w = num(c.width, num(c.radius, 1) * 2) || 1;
    const d = num(c.depth, num(c.radius, 1) * 2) || 1;
    minX = Math.min(minX, num(p.x, 0) - w / 2); maxX = Math.max(maxX, num(p.x, 0) + w / 2);
    minY = Math.min(minY, num(p.y, 0) - h / 2); maxY = Math.max(maxY, num(p.y, 0) + h / 2);
    minZ = Math.min(minZ, num(p.z, 0) - d / 2); maxZ = Math.max(maxZ, num(p.z, 0) + d / 2);
    has = true;
  }
  if (!has) {
    const fp = fallbackFootprint || { width: 4, depth: 4 };
    return { hasCollision: true, footprint: { width: fp.width, depth: fp.depth }, height: 3, bounds: null, anchorOffsetY: 0 };
  }
  const size = { width: r2(maxX - minX), height: r2(maxY - minY), depth: r2(maxZ - minZ) };
  return {
    hasCollision: true,
    footprint: { width: size.width || 4, depth: size.depth || 4 },
    height: size.height || 3,
    bounds: { min: { x: r2(minX), y: r2(minY), z: r2(minZ) }, max: { x: r2(maxX), y: r2(maxY), z: r2(maxZ) }, size, center: { x: r2((minX + maxX) / 2), y: r2((minY + maxY) / 2), z: r2((minZ + maxZ) / 2) } },
    anchorOffsetY: 0,
  };
}

/** L2 程序化：编译 → 写 geometry_buildings → 返回部件参数（model_path='geometry_building:<数字id>'，P4-5） */
async function buildProceduralPart(s, x, y, z) {
  const compiled = specCompiler.compile(s);
  if (!compiled.ok) return compiled;
  const v = assetValidator.validateComponents(compiled.components, {
    maxComponents: s.budget && s.budget.maxComponents, maxTriangles: s.budget && s.budget.maxTriangles,
  });
  if (!v.ok) return { ok: false, code: 'ASSET_VALIDATOR_DENY', errors: v.errors, hint: v.hint, stats: v.stats };
  const ins = await query(
    `INSERT INTO geometry_buildings (user_id, name, template_id, geometry_data, category, description)
     VALUES (0, $1, $2, $3::jsonb, 'building', $4) RETURNING id`,
    [String(compiled.name).slice(0, 200), String(s.buildingType || 'ai_spec').slice(0, 100),
      JSON.stringify({ name: compiled.name, components: compiled.components, specSource: 'world_ai', seed: s.seed }),
      'World AI SpecCompiler 生成（spec seed=' + s.seed + '）']
  );
  const gid = ins.rows[0].id;
  return {
    ok: true,
    strategy: 'procedural',
    compiled,
    physical: physicalOf(compiled.components, s.footprint),
    part: {
      partKey: 'main', partRole: tagMapper.mapRole(String(s.buildingType || 'building')),
      assetRef: { kind: 'template', ref: 'spec:' + String(s.buildingType || 'ai_spec'), params: { seed: s.seed } },
      localTransform: { position: { x: 0, y: 0, z: 0 } },
      objectParams: {
        type: 'geometry_building', name: compiled.name,
        model_path: 'geometry_building:' + gid,    // ★ P4-5 契约（不是 geometry:xxx）
        position_x: x, position_y: y, position_z: z,
        has_collision: true,
      },
    },
  };
}

/**
 * 主入口：spec → 完整实体。
 * @param {object} o { spec, worldId, regionKey, missionId, actor, x, z, rotationY, effectiveAutonomy,
 *                     interactions:[{interactionType,key,label,radius,payload,grants}] }
 */
async function buildFromSpec(o) {
  const opt = o || {};
  const v = buildingSpec.validate(opt.spec);
  if (!v.ok) return { ok: false, code: 'SPEC_INVALID', errors: v.errors, hint: v.hint };
  const s = v.spec;
  const x = num(opt.x, 0), z = num(opt.z, 0);
  const ry = num(opt.rotationY, 0);
  const ctxCommon = {
    worldId: String(opt.worldId), regionKey: opt.regionKey, missionId: opt.missionId || null,
    actor: opt.actor || 'world_ai:runtime', effectiveAutonomy: opt.effectiveAutonomy,
  };

  // ① 策略（L0 → L1 → L2）
  const strat = await assetSelector.decideStrategy(s);
  let parts = [];
  let visual = null;
  let physical = null;
  let notes = [];

  if (strat.strategy === 'asset') {
    // L0：整栋资产单体放置
    const a = strat.asset;
    parts = [{
      partKey: 'main', partRole: 'building',
      assetRef: { kind: 'asset', ref: a.modelPath, params: { modelId: a.modelId } },
      localTransform: { position: { x: 0, y: 0, z: 0 } },
      objectParams: {
        type: 'uploaded_model', name: s.name || a.name, model_path: a.modelPath,
        position_x: x, position_y: 0, position_z: z, rotation_y: ry, has_collision: true,
      },
    }];
    visual = { mode: 'asset', modelPath: a.modelPath, modelId: a.modelId, name: a.name };
    physical = physicalOf([], s.footprint);
  } else if (strat.strategy === 'composite' && s.assembly !== 'procedural_only') {
    // L1：零件装配（确定性布局：南墙一排 + 屋顶居中，模数取零件自带 grid）
    const wall = strat.partsByRole.wall[0];
    const roof = strat.partsByRole.roof[0];
    const w = num(s.footprint && s.footprint.width, 6);
    const count = Math.max(1, Math.floor(w / Math.max(0.5, num(wall.grid[0], 1))));
    const step = w / count;
    for (let i = 0; i < count; i++) {
      parts.push({
        partKey: 'wall_south_' + (i + 1), partRole: 'wall',
        assetRef: { kind: 'asset', ref: wall.modelPath, params: { partKey: wall.partKey, pack: wall.pack } },
        localTransform: { position: { x: r2(-w / 2 + step * (i + 0.5)), y: 0, z: r2(-(num(s.footprint.depth, 6) / 2)) } },
        objectParams: {
          type: 'uploaded_model', name: (s.name || '建筑') + '_wall_' + (i + 1), model_path: wall.modelPath,
          position_x: x + (-w / 2 + step * (i + 0.5)), position_y: 0, position_z: z - num(s.footprint.depth, 6) / 2,
          rotation_y: ry, has_collision: true,
        },
      });
    }
    parts.push({
      partKey: 'roof', partRole: 'roof',
      assetRef: { kind: 'asset', ref: roof.modelPath, params: { partKey: roof.partKey, pack: roof.pack } },
      localTransform: { position: { x: 0, y: num(wall.grid[1], 3), z: 0 } },
      objectParams: {
        type: 'uploaded_model', name: (s.name || '建筑') + '_roof', model_path: roof.modelPath,
        position_x: x, position_y: num(wall.grid[1], 3), position_z: z, rotation_y: ry, has_collision: false,
      },
    });
    visual = { mode: 'composite', parts: parts.map((p) => ({ partKey: p.partKey, partRole: p.partRole, ref: p.assetRef.ref })) };
    physical = { hasCollision: true, footprint: { width: w, depth: num(s.footprint.depth, 6) }, height: num(wall.grid[1], 3) + num(roof.grid[1], 1), bounds: null, anchorOffsetY: 0 };
    notes.push('L1 零件装配：wall=' + wall.partKey + ' roof=' + roof.partKey);
  } else {
    // L2：程序化兜底（P4-4：写 memory「缺少 X 类资产」）
    const built = await buildProceduralPart(s, x, 0, z);
    if (!built.ok) return built;
    parts = [built.part];
    visual = { mode: 'components', geometryDataId: null, fallbackTemplateId: String(s.buildingType || ''), componentsMeta: built.compiled.meta };
    physical = built.physical;
    const missingTags = strat.tags.length ? strat.tags.join('/') : String(s.buildingType || '');
    try {
      await require('../memory/memoryService').write({
        worldId: ctxCommon.worldId, scope: 'world', kind: 'fact', source: 'planner',
        subject_id: 'asset_gap:' + missingTags, importance: 2, tags: strat.tags.slice(0, 5),
        content: '缺少 ' + missingTags + ' 类资产：「' + (s.name || s.buildingType) + '」已降级程序化生成（P4-4），建议补充零件库后重建',
      });
      notes.push('memory: 缺少 ' + missingTags + ' 类资产');
    } catch (e) { /* 记忆失败不阻断建设 */ }
  }

  // ② 装配 Entity
  const r = await entityAssembler.assembleEntity(Object.assign({}, ctxCommon, {
    entityType: s.entityType || 'building',
    name: s.name || strat.asset && strat.asset.name || String(s.buildingType || 'AI 建筑'),
    purpose: s.purpose,
    visual, physical,
    spec: Object.assign({}, s, { strategy: strat.strategy }),
    parts,
    interactions: opt.interactions || [],
  }));
  if (!r.ok) return r;

  // ③ 记账：事件（唯一写入器）+ 审计 notes
  try {
    const eventLog = require('../perception/eventLog');
    await eventLog.log({
      worldId: ctxCommon.worldId, type: 'entity_created', actorType: 'ai', actorId: ctxCommon.actor,
      entityId: r.entity.id, regionId: null, targetId: r.entity.regionKey, x, z,
      payload: { name: String(r.entity.name).slice(0, 60), mode: visual.mode, strategy: strat.strategy, parts: parts.length, objects: (r.createdObjectIds || []).length },
    });
    for (const oid of (r.createdObjectIds || [])) {
      await eventLog.log({
        worldId: ctxCommon.worldId, type: 'object_created', actorType: 'ai', actorId: ctxCommon.actor,
        entityId: r.entity.id, worldObjectId: oid, x, z,
        payload: { entity: String(r.entity.name).slice(0, 60), strategy: strat.strategy },
      });
    }
  } catch (e) { /* 事件失败不阻断（eventLog 本身也吞错） */ }

  return {
    ok: true,
    strategy: strat.strategy,
    reason: strat.reason,
    notes,
    entityId: r.entity.id,
    deduped: r.deduped,
    entity: r.entity,
    createdObjectIds: r.createdObjectIds || [],
    undo: r.undo,
    undoable: true,
  };
}

/** 干跑（预览路由用）：只编译/校验/定策略，不写任何表 */
async function preview(o) {
  const opt = o || {};
  const v = buildingSpec.validate(opt.spec);
  if (!v.ok) return { ok: false, code: 'SPEC_INVALID', errors: v.errors, hint: v.hint };
  const s = v.spec;
  const strat = await assetSelector.decideStrategy(s);
  const compiled = specCompiler.compile(s);
  const val = compiled.ok ? assetValidator.validateComponents(compiled.components, {
    maxComponents: s.budget && s.budget.maxComponents, maxTriangles: s.budget && s.budget.maxTriangles,
  }) : { ok: false, errors: compiled.errors, hint: compiled.hint, stats: { components: 0, tris: 0 } };
  return {
    ok: val.ok,
    strategy: strat.strategy, reason: strat.reason, tags: strat.tags,
    spec: s,
    stats: val.stats,
    errors: val.errors || [], hint: val.hint || '',
    componentCount: compiled.ok ? compiled.components.length : 0,
    templateSchema: specCompiler.getTemplateSchema(),
  };
}

module.exports = { buildFromSpec, preview, physicalOf, buildProceduralPart };
