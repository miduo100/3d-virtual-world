/**
 * spatialTools —— ② 空间建设 9 个（AI World Brain · Phase 4 · §D.3②）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 风险分级照抄 §G.4：create_area/create_object/move/rotate/scale = low；
 * modify_area/modify_object = medium；delete_area/delete_object = high（不可降级）。
 *
 * ★ 写 world_objects 全部走 batchJournal（AI 对象唯一写库路径，守卫在此层再查一次）；
 * ★ 区域操作走 regionService（含 REGION_NOT_EMPTY 等既有保护）。
 * undo_payload 结构由实现返回，rollback 由 journal/toolJournal 执行（判据 P3-4）。
 */
'use strict';

const { query } = require('../../database/db');
const verbRegistry = require('./verbRegistry');
const batchJournal = require('../journal/batchJournal');
const regionService = require('../regions/regionService');

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

async function fetchObjectRow(id) {
  const r = await query(`SELECT * FROM world_objects WHERE id = $1`, [Number(id)]);
  return r.rows[0] || null;
}

function registerAll() {
  const R = (d) => verbRegistry.register(Object.assign({ category: 'spatial', scope: 'world:build' }, d));

  // ── low ──────────────────────────────────────────────────────────────
  R({
    name: 'create_area', risk: 'low', reversible: true, guardAction: null,
    summary: '创建区域（autonomy 必填；bounds 矩形）',
    params: { type: 'object', required: ['regionKey', 'name', 'bounds', 'autonomy'], properties: {
      regionKey: { type: 'string', minLength: 2, maxLength: 60 },
      name: { type: 'string', minLength: 1, maxLength: 60 },
      purpose: { type: 'string', maxLength: 60 },
      bounds: { type: 'object', required: ['x', 'z', 'width', 'depth'], properties: {
        x: { type: 'number' }, z: { type: 'number' }, width: { type: 'number', min: 1, max: 5000 }, depth: { type: 'number', min: 1, max: 5000 },
      } },
      autonomy: { type: 'string', enum: ['managed', 'semi_autonomous', 'autonomous'] },
      notes: { type: 'string', maxLength: 300 },
    } },
    impl: async (p, ctx) => {
      const r = await regionService.createRegion({
        regionKey: p.regionKey, worldId: ctx.worldId, name: p.name, purpose: p.purpose || null,
        bounds: p.bounds, autonomy: p.autonomy, notes: p.notes || null, createdBy: ctx.actor,
      });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      return {
        ok: true,
        result: { regionKey: r.region.region_key, id: r.region.id },
        afterState: { regionKey: r.region.region_key, name: r.region.name, bounds: r.region.bounds, autonomy: r.region.autonomy },
        undo: { kind: 'delete_region', worldId: ctx.worldId, regionKey: r.region.region_key },
        undoable: true,
      };
    },
  });

  R({
    name: 'create_object', risk: 'low', reversible: true, guardAction: 'place_part',
    summary: '创建 AI 对象（origin 恒为 ai；出生点保护半径内拒建）',
    params: { type: 'object', required: ['regionId', 'x', 'z'], properties: {
      regionId: { type: 'string', minLength: 2, maxLength: 60 },
      type: { type: 'string', maxLength: 40 },
      name: { type: 'string', maxLength: 80 },
      modelPath: { type: 'string', maxLength: 300 },
      x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
      rotationY: { type: 'number' },
      scaleX: { type: 'number' }, scaleY: { type: 'number' }, scaleZ: { type: 'number' },
      hasCollision: { type: 'boolean' },
    } },
    impl: async (p, ctx) => {
      const r = await batchJournal.createObject({
        type: p.type || 'uploaded_model', name: p.name || 'AI 对象', model_path: p.modelPath || null,
        position_x: p.x, position_y: p.y || 0, position_z: p.z,
        rotation_y: p.rotationY || 0,
        scale_x: num(p.scaleX, 1), scale_y: num(p.scaleY, 1), scale_z: num(p.scaleZ, 1),
        has_collision: p.hasCollision === true,
      }, { regionKey: ctx.regionKey, missionId: ctx.missionId, effectiveAutonomy: ctx.effectiveAutonomy });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      return {
        ok: true, deduped: r.deduped === true,
        result: { objectId: r.id },
        afterState: { objectId: r.id },
        undo: { kind: 'delete_world_object', id: r.id },
        undoable: true,
      };
    },
  });

  R({
    name: 'move_object', risk: 'low', reversible: true, guardAction: 'move_object',
    summary: '移动 AI 对象',
    params: { type: 'object', required: ['objectId', 'x', 'z'], properties: {
      objectId: { type: 'integer', min: 1 }, x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
    } },
    impl: async (p, ctx) => patchObject(p, ctx, { position_x: num(p.x, 0), position_y: num(p.y, 0), position_z: num(p.z, 0) }),
  });

  R({
    name: 'rotate_object', risk: 'low', reversible: true, guardAction: 'rotate',
    summary: '旋转 AI 对象（Y 轴）',
    params: { type: 'object', required: ['objectId', 'rotationY'], properties: {
      objectId: { type: 'integer', min: 1 }, rotationY: { type: 'number' },
    } },
    impl: async (p, ctx) => patchObject(p, ctx, { rotation_y: num(p.rotationY, 0) }),
  });

  R({
    name: 'scale_object', risk: 'low', reversible: true, guardAction: 'scale',
    summary: '缩放 AI 对象',
    params: { type: 'object', required: ['objectId', 'scaleX'], properties: {
      objectId: { type: 'integer', min: 1 },
      scaleX: { type: 'number', min: 0.01, max: 100 }, scaleY: { type: 'number', min: 0.01, max: 100 }, scaleZ: { type: 'number', min: 0.01, max: 100 },
    } },
    impl: async (p, ctx) => patchObject(p, ctx, {
      scale_x: num(p.scaleX, 1), scale_y: num(p.scaleY !== undefined ? p.scaleY : p.scaleX, 1), scale_z: num(p.scaleZ !== undefined ? p.scaleZ : p.scaleX, 1),
    }),
  });

  // ── medium ───────────────────────────────────────────────────────────
  R({
    name: 'modify_object', risk: 'medium', reversible: true, guardAction: 'modify',
    summary: '修改 AI 对象属性（名字/位置/旋转/缩放/碰撞）',
    params: { type: 'object', required: ['objectId', 'patch'], properties: {
      objectId: { type: 'integer', min: 1 },
      patch: { type: 'object', properties: {
        name: { type: 'string', maxLength: 80 },
        position_x: { type: 'number' }, position_y: { type: 'number' }, position_z: { type: 'number' },
        rotation_y: { type: 'number' },
        scale_x: { type: 'number' }, scale_y: { type: 'number' }, scale_z: { type: 'number' },
        has_collision: { type: 'boolean' },
      } },
    } },
    impl: async (p, ctx) => patchObject(p, ctx, p.patch),
  });

  R({
    name: 'modify_area', risk: 'medium', reversible: true, guardAction: null,
    summary: '修改区域元数据（名字/用途/标签）',
    params: { type: 'object', required: ['regionKey', 'patch'], properties: {
      regionKey: { type: 'string', minLength: 2, maxLength: 60 },
      patch: { type: 'object', properties: {
        name: { type: 'string', minLength: 1, maxLength: 60 },
        purpose: { type: 'string', maxLength: 60 },
      } },
    } },
    impl: async (p, ctx) => {
      const region = await regionService.getRegion(ctx.worldId, p.regionKey);
      if (!region) return { ok: false, code: 'REGION_NOT_FOUND', reason: '区域不存在：' + p.regionKey };
      const sets = [];
      const params = [];
      const cols = {};
      for (const k of ['name', 'purpose']) {
        if (p.patch[k] !== undefined) {
          params.push(String(p.patch[k]));
          sets.push(k + ' = $' + params.length);
          cols[k] = region[k];
        }
      }
      if (!sets.length) return { ok: false, code: 'NOTHING_TO_UPDATE', reason: 'patch 没有可更新字段' };
      params.push(String(ctx.worldId), String(p.regionKey));
      await query(`UPDATE world_regions SET ` + sets.join(', ') + `, updated_at = NOW()
                    WHERE world_id = $` + (params.length - 1) + ` AND region_key = $` + params.length, params);
      return {
        ok: true,
        result: { regionKey: p.regionKey, updated: sets.length },
        afterState: { regionKey: p.regionKey, patch: p.patch },
        undo: { kind: 'restore_region', id: region.id, cols },
        undoable: true,
      };
    },
  });

  // ── high（不可降级，人工审批）─────────────────────────────────────────
  R({
    name: 'delete_object', risk: 'high', reversible: false, guardAction: 'delete_object',
    summary: '删除 AI 对象（只允许 origin=ai 且未锁定；human/portal/ad_slot 永拒）',
    params: { type: 'object', required: ['objectId'], properties: {
      objectId: { type: 'integer', min: 1 },
      reason: { type: 'string', maxLength: 300 },
    } },
    impl: async (p, ctx) => {
      const row = await fetchObjectRow(p.objectId);
      if (!row) return { ok: false, code: 'OBJECT_NOT_FOUND', reason: '对象不存在：#' + p.objectId };
      const r = await batchJournal.deleteObject(p.objectId, {
        regionKey: ctx.regionKey, missionId: ctx.missionId, effectiveAutonomy: ctx.effectiveAutonomy,
        approvedRisks: ctx.approvedRisks,   // 审批通过后 resume 携带 ['high']，batchJournal 二次守卫才能放行
      });
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      return {
        ok: true,
        result: { objectId: p.objectId, deleted: 1 },
        afterState: { objectId: p.objectId, deleted: true },
        // 删除类不自动回滚（重插 id/引用可能不一致）；before_state 已留全行快照供人工追溯
        undoable: false,
      };
    },
  });

  R({
    name: 'delete_area', risk: 'high', reversible: false, guardAction: null,
    summary: '删除区域（区域内还有 AI 产物时拒绝；不删其内对象）',
    params: { type: 'object', required: ['regionKey'], properties: {
      regionKey: { type: 'string', minLength: 2, maxLength: 60 },
    } },
    impl: async (p, ctx) => {
      const r = await regionService.deleteRegion(ctx.worldId, p.regionKey);
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      return {
        ok: true,
        result: { regionKey: p.regionKey, deleted: true },
        afterState: { regionKey: p.regionKey, deleted: true },
        undoable: false,
      };
    },
  });
}

/** 通用对象 patch（先取 before 行 → batchJournal.updateObject（守卫）→ undo 恢复前置值） */
async function patchObject(p, ctx, patch) {
  const row = await fetchObjectRow(p.objectId);
  if (!row) return { ok: false, code: 'OBJECT_NOT_FOUND', reason: '对象不存在：#' + p.objectId };
  const allowed = ['name', 'position_x', 'position_y', 'position_z', 'rotation_y', 'scale_x', 'scale_y', 'scale_z'];
  const cols = {};
  const clean = {};
  for (const k of allowed) {
    if (patch && patch[k] !== undefined) {
      clean[k] = patch[k];
      cols[k] = row[k];
    }
  }
  if (!Object.keys(clean).length) return { ok: false, code: 'NOTHING_TO_UPDATE', reason: 'patch 没有可更新字段' };
  const r = await batchJournal.updateObject(Number(p.objectId), clean, {
    regionKey: ctx.regionKey, missionId: ctx.missionId, effectiveAutonomy: ctx.effectiveAutonomy,
  });
  if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
  return {
    ok: true,
    result: { objectId: Number(p.objectId), updated: r.updated },
    afterState: { objectId: Number(p.objectId), patch: clean },
    undo: { kind: 'restore_world_object', id: Number(p.objectId), cols },
    undoable: true,
  };
}

module.exports = { registerAll };
