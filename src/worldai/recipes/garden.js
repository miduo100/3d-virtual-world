/**
 * garden —— 花坛 / 绿化 recipe 引擎（AI 自由拼装 · §4.5）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 花坛 = 围边（edge 沿周长） + 内部花卉（泊松盘散点，避开围边）。
 * 围边复用 fence 的沿段立板逻辑（矩形）或圆周采样（circle）；
 * 花卉坐标同样确定性——重跑幂等。
 *
 * 骨架契约（与 registry.DESC.garden 一致）：
 *   spec.shape         'rect'（默认）| 'circle'
 *   spec.size          {width,depth} 花坛尺寸米（circle 用 width 作直径）
 *   spec.flower_types  [partKey,...] 花卉键（≥1，确定性轮换）
 *   spec.parts.edge    围边零件键（可省；省则纯花卉散点）
 *
 * 输出与 path/fence 同构：{ partKey, dx, dz, ry, level, grid, modelPath, role }
 */
'use strict';

const g = require('./geometry');
const { poissonScatter, radiusFor, rotationFor, hashSeed } = require('../missions/scatter');

function fail(code, reason, hint, stats) {
  return { ok: false, code, reason, hint, stats: Object.assign({ recipe: 'garden', count: 0 }, stats || {}) };
}

/** 围边沿走向的长度：取长边（薄板厚度边不能当步长，与 fence.panelLen 同口径） */
function edgeLen(grid) {
  return Math.max(0.5, Number(grid[0]) || 0, Number(grid[2]) || 0);
}

async function build(spec, ctx) {
  const s = spec || {};
  const c = ctx || {};
  const notes = [];
  const dropped = { unknownPart: 0 };
  const shape = String(s.shape || 'rect').toLowerCase() === 'circle' ? 'circle' : 'rect';

  // ── 1) 零件解析：flower_types 必需；edge 可省
  const fKeys = (Array.isArray(s.flower_types) ? s.flower_types : [s.flower_types])
    .filter(Boolean).map(String);
  if (!fKeys.length) {
    return fail('RECIPE_SPEC_INCOMPLETE', 'spec.flower_types 为空，没有花卉',
      '至少给 1 个花卉 partKey（part_role=plant/prop），如 ["flower_red","flower_yellow"]',
      { dropped, notes });
  }
  const slots = [['flower', fKeys]].concat(s.parts && s.parts.edge ? [['edge', [String(s.parts.edge)]]] : []);
  const resolved = new Map();
  for (const [slot, ks] of slots) {
    const list = resolved.get(slot) || [];
    for (const k of ks) {
      let raw = null;
      try { raw = await c.partResolver(k); } catch (e) {
        notes.push('partResolver(' + k + ') 抛错：' + String(e && e.message || e).slice(0, 120));
      }
      if (!raw) { dropped.unknownPart++; notes.push(slot + ' 查不到（显式丢弃）: ' + k); continue; }
      list.push({
        partKey: String(raw.part_key || raw.partKey || k),
        role: String(raw.part_role || raw.role || (slot === 'edge' ? 'trim' : 'plant')),
        grid: g.normGrid(raw.grid || [raw.grid_w, raw.grid_h, raw.grid_d]),
        modelPath: raw.model_path || raw.modelPath || null,
      });
    }
    if (list.length) resolved.set(slot, list);
  }
  const flowers = resolved.get('flower') || [];
  if (!flowers.length) {
    return fail('RECIPE_ALL_PARTS_UNKNOWN',
      'flower_types 里 ' + fKeys.length + ' 个全部查不到（dropped.unknownPart=' + dropped.unknownPart + '）',
      'partKey 必须来自 PARTS 清单；请换用清单内的花卉/植物键',
      { dropped, notes });
  }
  const edge = (resolved.get('edge') || [])[0] || null;

  // ── 2) 尺寸
  const width = Math.max(1.5, Number(s.size && s.size.width) || 8);
  const depth = Math.max(1.5, Number(s.size && s.size.depth) || 6);

  // ── 3) 围边：矩形 4 段沿段立板 / 圆形圆周采样
  const parts = [];
  const taken = new Set();
  const keyOf = (dx, dz) => Math.round(dx * 100) + ':' + Math.round(dz * 100);
  const push = (p) => { const kk = keyOf(p.dx, p.dz); if (taken.has(kk)) return false; taken.add(kk); parts.push(p); return true; };
  const edgeStep = edge ? edgeLen(edge.grid) : 0;
  const edgeInset = edge ? Math.max(edgeStep, 1) : 0;   // 花卉内缩量（别压在围边上）

  let edgeCount = 0;
  if (edge) {
    if (shape === 'rect') {
      const hw = width / 2, hd = depth / 2;
      const quad = [
        { dx: -hw, dz: -hd }, { dx: hw, dz: -hd }, { dx: hw, dz: hd }, { dx: -hw, dz: hd }, { dx: -hw, dz: -hd },
      ];
      const segs = g.segments(quad);
      for (const sg of segs) {
        for (const d of g.sampleDistances(sg.len, edgeStep, false, false)) {
          const pt = g.lerpOnSeg(sg, d);
          if (push({ partKey: edge.partKey, role: edge.role, grid: edge.grid, modelPath: edge.modelPath,
            dx: g.r2(pt.dx), dz: g.r2(pt.dz), ry: g.r2(sg.ang), level: 0 })) edgeCount++;
        }
      }
    } else {
      // circle：直径 = width；圆周按 edgeStep 采样，ry = 切线朝向
      const R = width / 2;
      const circ = Math.PI * 2 * R;
      const n = Math.max(4, Math.round(circ / edgeStep));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        if (push({ partKey: edge.partKey, role: edge.role, grid: edge.grid, modelPath: edge.modelPath,
          dx: g.r2(Math.cos(a) * R), dz: g.r2(Math.sin(a) * R),
          ry: g.r2((a * 180) / Math.PI + 90), level: 0 })) edgeCount++;
      }
    }
  }

  // ── 4) 花卉：内部泊松盘（范围按围边内缩，圆形按内接矩形近似）
  const seedStr = String(c.seedStr || 'garden');
  const fx = edge ? Math.max(2, width - edgeInset * 2) : width;
  const fz = edge ? Math.max(2, depth - edgeInset * 2) : depth;
  const fCount = Math.max(1, Math.floor(Number(s.count) || Math.round((fx * fz) / 2.5))); // 每 2.5m² 一株
  const fRadius = radiusFor(flowers.map((t) => t.grid));
  const pts = poissonScatter({ width: fx, depth: fz, count: fCount, radius: fRadius, seed: seedStr + ':' + hashSeed(fKeys.join(',')) });
  if (!pts.length) {
    return fail('RECIPE_SPEC_INCOMPLETE', '花卉散点为空（内部范围过小）',
      'size 再大一点（≥2×2 米），或去掉 parts.edge 让花卉铺满',
      { dropped, notes });
  }
  for (let i = 0; i < pts.length; i++) {
    const t = flowers[hashSeed(seedStr + ':flower:' + i) % flowers.length];
    // 圆形：落在内切圆外的点丢弃（泊松盘是矩形域）
    if (shape === 'circle') {
      const rr = (pts[i].dx / (fx / 2)) ** 2 + (pts[i].dz / (fz / 2)) ** 2;
      if (rr > 1) continue;
    }
    push({ partKey: t.partKey, role: t.role, grid: t.grid, modelPath: t.modelPath,
      dx: g.r2(pts[i].dx), dz: g.r2(pts[i].dz), ry: rotationFor(seedStr + ':ry', i), level: 0 });
  }

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
      recipe: 'garden', count: parts.length, shape,
      edge: edge ? edge.partKey : null, edgeCount,
      flowers: flowers.map((t) => t.partKey), flowerCount: parts.length - edgeCount,
      width, depth, radius: Math.round(fRadius * 100) / 100,
      truncated, bounds: g.boundsOf(parts), dropped, notes,
    },
  };
}

module.exports = { build, edgeLen };
