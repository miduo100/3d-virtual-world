/**
 * forest —— 树丛 / 树林 recipe 引擎（AI 自由拼装 · §4.5）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 散点类需求（小模型实测把 4 棵树全写在 (0,0)），本模块只收三个语义：
 * 用什么树、多少棵、铺多大范围——坐标交给 poissonScatter 带种子的泊松盘：
 * 均匀、不重叠、同种子逐字节一致（重跑 → batchJournal 幂等去重命中）。
 *
 * 骨架契约（与 registry.DESC.forest 一致）：
 *   spec.count    棵数（默认 10，上限 200）
 *   spec.around   {dx,dz} 林子中心相对块 anchor 的偏移（可省 = 0,0）
 *   spec.size     {width,depth} 覆盖范围米（默认 20×20）
 *   spec.partKeys [partKey,...] 树种键（≥1，确定性轮换）
 *
 * 输出与 path/fence 同构：{ partKey, dx, dz, ry, level, grid, modelPath, role }
 */
'use strict';

const { poissonScatter, radiusFor, rotationFor, hashSeed } = require('../missions/scatter');

function fail(code, reason, hint, stats) {
  return { ok: false, code, reason, hint, stats: Object.assign({ recipe: 'forest', count: 0 }, stats || {}) };
}

async function build(spec, ctx) {
  const s = spec || {};
  const c = ctx || {};
  const notes = [];
  const dropped = { unknownPart: 0 };

  // ── 1) 树种解析（≥1）
  const keys = (Array.isArray(s.partKeys) ? s.partKeys : [s.partKeys])
    .filter(Boolean).map(String);
  if (!keys.length) {
    return fail('RECIPE_SPEC_INCOMPLETE', 'spec.partKeys 为空，没有树种',
      '至少给 1 个树的 partKey（part_role=tree/plant），如 ["tree_oak","tree_pine"]',
      { dropped, notes });
  }
  const resolved = [];
  for (const k of keys) {
    let raw = null;
    try { raw = await c.partResolver(k); } catch (e) {
      notes.push('partResolver(' + k + ') 抛错：' + String(e && e.message || e).slice(0, 120));
    }
    if (!raw) { dropped.unknownPart++; notes.push('树种查不到（显式丢弃）: ' + k); continue; }
    resolved.push({
      partKey: String(raw.part_key || raw.partKey || k),
      role: String(raw.part_role || raw.role || 'tree'),
      grid: raw.grid || [raw.grid_w, raw.grid_h, raw.grid_d],
      modelPath: raw.model_path || raw.modelPath || null,
    });
  }
  if (!resolved.length) {
    return fail('RECIPE_ALL_PARTS_UNKNOWN',
      'partKeys 里 ' + keys.length + ' 个全部查不到（dropped.unknownPart=' + dropped.unknownPart + '）',
      'partKey 必须来自 PARTS 清单；请换用清单内的树/植物键',
      { dropped, notes });
  }

  // ── 2) 范围与数量
  const width = Math.max(2, Number(s.size && s.size.width) || 20);
  const depth = Math.max(2, Number(s.size && s.size.depth) || 20);
  const count = Math.max(1, Math.min(200, Math.floor(Number(s.count) || 10)));
  const around = s.around || {};
  const adx = isFinite(Number(around.dx)) ? Number(around.dx) : 0;
  const adz = isFinite(Number(around.dz)) ? Number(around.dz) : 0;

  // ── 3) 泊松盘散点（间距按最大树冠 × 1.2，防贴脸重叠）
  const seedStr = String(c.seedStr || 'forest');
  const radius = radiusFor(resolved.map((t) => (Array.isArray(t.grid) ? t.grid : [1, 1, 1]).map(Number)));
  const pts = poissonScatter({ width, depth, count, radius, seed: seedStr + ':' + hashSeed(keys.join(',')) });
  if (!pts.length) {
    return fail('RECIPE_SPEC_INCOMPLETE', '散点结果为空（size 过小或 count/radius 冲突）',
      'size 至少 2×2 米；count 与范围匹配（如 20×20 放 20 棵）',
      { dropped, notes });
  }
  if (pts.length < count) notes.push('范围放不下 ' + count + ' 棵（间距 ' + radius.toFixed(1) + 'm）→ 实放 ' + pts.length + ' 棵');

  // ── 4) 落件：树种确定性轮换 + 朝向随机化
  const parts = pts.map((p, i) => {
    const t = resolved[hashSeed(seedStr + ':tree:' + i) % resolved.length];
    return {
      partKey: t.partKey, role: t.role, grid: t.grid, modelPath: t.modelPath,
      dx: Math.round((p.dx + adx) * 100) / 100,
      dz: Math.round((p.dz + adz) * 100) / 100,
      ry: rotationFor(seedStr + ':ry', i), level: 0,
    };
  });

  // ── 5) 预算截断
  let truncated = false;
  const maxObjects = Number(c.maxObjects) > 0 ? Math.floor(Number(c.maxObjects)) : 0;
  if (maxObjects && parts.length > maxObjects) {
    notes.push('预算截断：' + parts.length + ' → ' + maxObjects);
    parts.length = maxObjects;
    truncated = true;
  }

  return {
    ok: true,
    parts,
    stats: {
      recipe: 'forest', count: parts.length, requested: count,
      radius: Math.round(radius * 100) / 100, width, depth, around: { dx: adx, dz: adz },
      species: resolved.map((t) => t.partKey),
      truncated, dropped, notes,
    },
  };
}

module.exports = { build };
