/**
 * planValidate —— LLM 产物校验与归一（自 missionPlanner 拆出 · 纯搬移零行为变化）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 拆分原因（2026-10-13）：missionPlanner 640 行超 500 红线（§H.9.2 硬约束）。
 * validatePlan 是纯校验/归一逻辑（三种块模式：recipe/scatter/普通 parts），
 * 与"编排"无关，自成一体。planner 保留 plan() 编排与 prompt 构造。
 *
 * 搬入内容（逐行原样，仅加模块包装）：
 *   - buildingFloorHeight()：后台 system_config.building_floor_height（60s 缓存）
 *   - recipePartResolver(partKey)：assetSearch 行 → recipes 契约（grid 数组化）
 *   - validatePlan(raw, constraints, opts)：非法 partKey / 禁用 role 剔除、预算按
 *     零件计数截断（P35-9）、recipe 骨架校验+展开、拒绝原因回流（2026-10-13）
 */
'use strict';

const { query } = require('../../database/db');
const assetSearch = require('../tools/assetSearch');
const recipeRegistry = require('../recipes');
const recipeValidate = require('../recipes/validate');

const DEFAULT_FLOOR_HEIGHT = 2.4;
let _fhCache = { v: DEFAULT_FLOOR_HEIGHT, at: 0 };
async function buildingFloorHeight() {
  if (Date.now() - _fhCache.at < 60000) return _fhCache.v;
  try {
    const r = await query("SELECT config_value FROM system_config WHERE config_key = 'building_floor_height'");
    const n = Number(r.rows[0] && r.rows[0].config_value);
    if (isFinite(n) && n > 0 && n <= 20) _fhCache = { v: n, at: Date.now() };
    else _fhCache = { v: DEFAULT_FLOOR_HEIGHT, at: Date.now() };
  } catch (e) { _fhCache = { v: DEFAULT_FLOOR_HEIGHT, at: Date.now() }; }
  return _fhCache.v;
}

/** recipe 零件解析器：把 assetSearch.getPart 的行形状适配成 recipes 契约（grid 数组化） */
async function recipePartResolver(partKey) {
  const p = await assetSearch.getPart(partKey);
  if (!p) return null;
  return {
    part_key: p.part_key, part_role: p.part_role,
    grid: [p.grid_w || 1, p.grid_h || 1, p.grid_d || 1],
    model_path: p.model_path,
  };
}

/** 校验并归一 LLM 产物：非法 partKey / 禁用 role 一律剔除；超预算截断（P35-9）
 *  opts.seedStr：确定性种子（recipe 展开用；缺省退化为固定串，注入路径可重跑同坐标） */
async function validatePlan(raw, constraints, opts) {
  const c = constraints || {};
  const seedStr = String((opts && opts.seedStr) || 'seed0');
  const allowed = Array.isArray(c.allowed_roles) ? c.allowed_roles.map(String) : null;
  const forbid = Array.isArray(c.forbid_roles) ? c.forbid_roles.map(String) : [];
  const maxObjects = Number(c.max_objects) > 0 ? Number(c.max_objects) : 120;
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const kept = [];
  // ★ 预算计数单位是**零件**，不是块（判据 P35-9：maxObjects=10 而布局 30 件 → 截断到 10 件）
  let placedParts = 0;
  const dropped = { unknownPart: 0, roleNotAllowed: 0, roleForbidden: 0, overBudget: 0, recipeInvalid: 0 };
  const lastMiss = [];   // AI 编造/记错的 partKey（§11-6 显式记账，供 runner 并入 notes 曝光）
  for (const b of blocks) {
    // ★ AI 自由拼装 recipe 块：AI 只给**骨架**（waypoints/footprint），引擎沿骨架铺零件。
    //   这里是全链路唯一接线点：校验 → 调 registry 展开 → 落成 parts（与普通块同构）。
    if (b && b.mode === 'recipe') {
      const remain0 = maxObjects - placedParts;
      if (remain0 <= 0) { dropped.overBudget++; continue; }
      const rv = await recipeValidate.validateRecipeBlock(b, {
        partResolver: recipePartResolver, forbidRoles: forbid, allowedRoles: allowed,
      });
      if (!rv.ok) {
        dropped.recipeInvalid++;
        lastMiss.push('recipe=' + String(rv.recipe || '?') + ' 校验被拒：' + String(rv.reason || '').slice(0, 200)
          + (rv.hint ? '｜改法：' + String(rv.hint).slice(0, 200) : ''));
        continue;
      }
      const built = await recipeRegistry.build(rv.recipe, rv.spec, {
        partResolver: recipePartResolver,
        seedStr: seedStr + '|' + String(b.kind || rv.recipe),
        maxObjects: remain0,
        // ★ 层高与限高（2026-10-12）：
        //   floorHeight = 后台 system_config.building_floor_height（缺省 2.4m）。
        //     不传则 recipe 退化为"层高=墙件高度"，Kenney building_block 只有 0.625m
        //     → 5 层楼总高 3.1m，像积木玩具。墙件比层高矮时由 recipe 沿高度堆叠补足。
        //   maxHeight = 委托级 constraints.max_height，按"层高×层数"折算成最大层数，
        //     真正截断 floors（此前它只是透传给 LLM 的软约束，从未执行）。
        floorHeight: await buildingFloorHeight(),
        maxHeight: Number(c.max_height) > 0 ? Number(c.max_height) : 0,
      });
      if (!built.ok) {
        dropped.recipeInvalid++;
        // ★ 拒绝原因回流（2026-10-13）：拱件墙/角色不符/尺寸不符被拒时，reason 里
        //   写明了「哪个槽位、什么零件、为什么不行」——必须让下一轮 LLM 看到，
        //   否则它两轮都交同一份被拒方案（实测：新校验上线后 2 轮全拒、0 件落库）。
        lastMiss.push('recipe=' + rv.recipe + ' 整块被拒：' + String(built.reason || '').slice(0, 200)
          + (built.hint ? '｜改法：' + String(built.hint).slice(0, 200) : ''));
        continue;
      }
      if (built.stats && built.stats.truncated) dropped.overBudget++;
      // ★ 槽位件查不到要显式记账（2026-10-12）：AI 会编造零件名（实测把
      //   tower_hexagon_roof_secondary 记成 tower_square_roof_secondary），旧逻辑只对 wall
      //   失败整块拒绝，roof/corner/door 等槽位查不到时静默跳过 → 楼盖出来没屋顶且无痕迹。
      if (built.stats && built.stats.dropped && built.stats.dropped.unknownPart > 0) {
        dropped.recipeInvalid++;
        const miss = (built.stats.notes || []).filter(function (n) { return /查不到/.test(n); });
        if (miss.length) lastMiss.push(miss.join(' | '));
      }
      placedParts += built.parts.length;
      kept.push({
        kind: String(b.kind || rv.recipe), mode: 'recipe',
        recipe: rv.recipe, spec: rv.spec, recipeStats: built.stats,
        footprint: { w: Number(b.footprint && b.footprint.w) || 0, d: Number(b.footprint && b.footprint.d) || 0 },
        anchor: { dx: Number(b.anchor && b.anchor.dx) || 0, dz: Number(b.anchor && b.anchor.dz) || 0 },
        parts: built.parts,
      });
      continue;
    }
    // ★ C2 散点块：模型只给 partKeys + count，坐标由 scatter 原语展开（确定性泊松盘）
    if (b && b.mode === 'scatter') {
      const keys = Array.isArray(b.partKeys) ? b.partKeys.map(String) : [];
      const validParts = [];
      for (const k of keys) {
        const part = await assetSearch.getPart(k);
        if (!part) { dropped.unknownPart++; continue; }
        if (forbid.indexOf(String(part.part_role)) >= 0) { dropped.roleForbidden++; continue; }
        if (allowed && allowed.indexOf(String(part.part_role)) < 0) { dropped.roleNotAllowed++; continue; }
        validParts.push({
          partKey: part.part_key, role: part.part_role,
          grid: [part.grid_w || 1, part.grid_h || 1, part.grid_d || 1],
          modelPath: part.model_path,
        });
      }
      if (!validParts.length) continue;
      let count = Math.max(1, Math.floor(Number(b.count) || validParts.length));
      const remain = maxObjects - placedParts;
      if (count > remain) { count = Math.max(0, remain); dropped.overBudget++; }
      if (count <= 0) continue;
      placedParts += count;
      kept.push({
        kind: String(b.kind || 'scatter'), mode: 'scatter',
        footprint: { w: Number(b.footprint && b.footprint.w) || 0, d: Number(b.footprint && b.footprint.d) || 0 },
        anchor: { dx: Number(b.anchor && b.anchor.dx) || 0, dz: Number(b.anchor && b.anchor.dz) || 0 },
        scatter: { count, parts: validParts },
        parts: [],
      });
      continue;
    }
    const parts = [];
    for (const p of (Array.isArray(b.parts) ? b.parts : [])) {
      if (!p || !p.partKey) { dropped.unknownPart++; continue; }
      const part = await assetSearch.getPart(p.partKey);
      if (!part) { dropped.unknownPart++; continue; }
      if (forbid.indexOf(String(part.part_role)) >= 0) { dropped.roleForbidden++; continue; }
      if (allowed && allowed.indexOf(String(part.part_role)) < 0) { dropped.roleNotAllowed++; continue; }
      if (placedParts >= maxObjects) { dropped.overBudget++; continue; } // 截断不报错（P35-9）
      placedParts++;
      parts.push({
        partKey: part.part_key, role: part.part_role,
        dx: Number(p.dx) || 0, dz: Number(p.dz) || 0,
        ry: Number(p.ry) || 0, level: Number(p.level) || 0,
        grid: [part.grid_w || 1, part.grid_h || 1, part.grid_d || 1],
        modelPath: part.model_path,
      });
    }
    if (!parts.length) continue;
    kept.push({
      kind: String(b.kind || 'block'),
      footprint: { w: Number(b.footprint && b.footprint.w) || 0, d: Number(b.footprint && b.footprint.d) || 0 },
      anchor: { dx: Number(b.anchor && b.anchor.dx) || 0, dz: Number(b.anchor && b.anchor.dz) || 0 },
      parts,
    });
  }
  return {
    plan: { style: raw.style || null, summary: raw.summary || null, blocks: kept },
    stats: { blocks: kept.length, parts: kept.reduce((s, b) => s + b.parts.length, 0), dropped },
    // AI 编造/记错的 partKey（§11-6）：runner 并入 executed_stats.notes，让"楼没屋顶"这类
    // 静默失败在结果里可见，而不是只埋在 building.js 的 notes 数组里没人看。
    missingParts: lastMiss.slice(0, 6),
    truncated: dropped.overBudget > 0,
  };
}

module.exports = { validatePlan, recipePartResolver, buildingFloorHeight };
