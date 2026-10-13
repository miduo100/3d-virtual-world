/**
 * fence —— 围栏 / 围墙 recipe 引擎（AI 自由拼装 · §4.5）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 与 path 的差别：path 沿折线「平铺」路面（可宽排），fence 沿多边形「立板」——
 * 栏板长边贴墙方向、单排、拐角换柱、可嵌大门。庭院/庄园围墙必然闭环，
 * 故本 recipe 永远闭环（末点 ≠ 首点时自动补闭合段）。
 *
 * 骨架契约（与 registry.DESC.fence 一致，AI 只描述形状不逐件排坐标）：
 *   spec.polygon      [{dx,dz},...] 多边形顶点（≥3 个，相对块 anchor，米）
 *   spec.parts.fence  栏板/墙段 partKey（必需）
 *   spec.parts.post   拐角柱 partKey（可省；省则栏板直接转角）
 *   spec.parts.gate   大门 partKey（可省）
 *   spec.gate_position 0~1，门在第一段上的比例位置（默认 0.5 中点）
 *
 * 输出与 path/building 同构：{ partKey, dx, dz, ry, level, grid, modelPath, role }
 * → 下游 absoluteOf → gridsnap → batchJournal → boundsGuard → 幂等去重零改动。
 */
'use strict';

const g = require('./geometry');

function fail(code, reason, hint, stats) {
  return { ok: false, code, reason, hint, stats: Object.assign({ recipe: 'fence', count: 0 }, stats || {}) };
}

/** 栏板沿墙方向的长度：取长边（与 building.js segLen 同口径——薄板的厚度边不能当步长） */
function panelLen(grid) {
  return Math.max(0.5, grid[0], grid[2]);
}

async function build(spec, ctx) {
  const s = spec || {};
  const c = ctx || {};
  const notes = [];
  const dropped = { unknownPart: 0 };

  // ── 1) 多边形归一（≥3 点）
  const pts = g.normPoints(s.polygon || s.waypoints);
  if (pts.length < 3) {
    return fail('RECIPE_SPEC_INCOMPLETE',
      'polygon 归一后只剩 ' + pts.length + ' 个有效点（围墙至少 3 个顶点）',
      '给 3~12 个 {dx,dz} 顶点（单位米，相对块 anchor）；矩形给 4 角即可，会自动闭环',
      { dropped, notes });
  }

  // ── 2) 零件解析（fence 必需；post/gate 可省）
  const P = (s.parts && typeof s.parts === 'object') ? s.parts : {};
  if (!P.fence) {
    return fail('RECIPE_SPEC_INCOMPLETE', 'spec.parts.fence 缺失，没有栏板零件',
      'parts 至少给 fence（栏板/墙段 partKey，part_role=railing/wall）；post（拐角柱）与 gate（大门）可省',
      { dropped, notes });
  }
  const keys = ['fence', 'post', 'gate'].filter((k) => P[k]).map(String);
  const resolved = new Map();
  for (const slot of keys) {
    const k = String(P[slot]);
    let raw = null;
    try { raw = await c.partResolver(k); } catch (e) {
      notes.push('partResolver(' + k + ') 抛错：' + String(e && e.message || e).slice(0, 120));
    }
    if (!raw) { dropped.unknownPart++; notes.push('parts.' + slot + ' 查不到（显式丢弃）: ' + k); continue; }
    resolved.set(slot, {
      slot,
      partKey: String(raw.part_key || raw.partKey || k),
      role: String(raw.part_role || raw.role || 'railing'),
      grid: g.normGrid(raw.grid || [raw.grid_w, raw.grid_h, raw.grid_d]),
      modelPath: raw.model_path || raw.modelPath || null,
    });
  }
  const panel = resolved.get('fence');
  if (!panel) {
    return fail('RECIPE_ALL_PARTS_UNKNOWN',
      'parts.fence 查不到（' + String(P.fence) + '），无栏板不构成围墙',
      'fence 必须是 PARTS 清单里的真实 partKey（role=railing/wall）',
      { dropped, notes });
  }
  const post = resolved.get('post') || null;
  const gate = resolved.get('gate') || null;

  // ── 3) 分段（永远闭环）
  //   closeLoop 只在「末首距 ≤ tol」时才闭合——矩形围墙给 4 角点时末首距 15m，
  //   不会自动闭 → 左边整段丢失（实测 panels 25 vs 期望 30）。fence 语义上必然闭环，
  //   末点 ≠ 首点时手动补闭合段。
  const loop = g.closeLoop(pts, panelLen(panel.grid));
  const fpts = loop.points.slice();
  if (!loop.closed) {
    const a = fpts[0], b = fpts[fpts.length - 1];
    if (Math.abs(a.dx - b.dx) > 1e-6 || Math.abs(a.dz - b.dz) > 1e-6) fpts.push({ dx: a.dx, dz: a.dz });
  }
  const segs = g.segments(fpts);
  if (!segs.length) return fail('RECIPE_SPEC_INCOMPLETE', '多边形没有任何有效段', '检查 polygon 顶点', { dropped, notes });

  // ── 4) 落件：拐角柱先占位 → 栏板 → 门替换
  const taken = new Set();
  const parts = [];
  const keyOf = (dx, dz) => Math.round(dx * 100) + ':' + Math.round(dz * 100);
  const push = (p) => { const kk = keyOf(p.dx, p.dz); if (taken.has(kk)) return false; taken.add(kk); parts.push(p); return true; };

  let posts = 0;
  if (post) {
    for (const sg of segs) {
      if (push({ partKey: post.partKey, role: post.role, grid: post.grid, modelPath: post.modelPath,
        dx: g.r2(sg.ax), dz: g.r2(sg.az), ry: g.r2(sg.ang), level: 0 })) posts++;
    }
  }

  const step = panelLen(panel.grid);
  let gateDone = false;
  const gatePos = isFinite(Number(s.gate_position)) ? Math.max(0, Math.min(1, Number(s.gate_position))) : 0.5;
  const first = segs[0];

  // ── 门段/门点判定（2026-10-14 加 gate_align）──
  //   旧行为：门永远在第一段 gatePos 比例处——与建筑门位无关，院子门可能开在
  //   房子山墙面，进门先撞墙。
  //   gate_align {dx,dz}：参考点（通常是 building 大门相对本块 anchor 的偏移）。
  //   门选**离参考点最近的段**，门点取参考点在该段上的投影——院门正对楼门。
  let gateSeg = first;
  let gateD = first.len * gatePos;
  const ga = s.gate_align || null;
  const gax = ga && isFinite(Number(ga.dx)) ? Number(ga.dx) : null;
  const gaz = ga && isFinite(Number(ga.dz)) ? Number(ga.dz) : null;
  if (gate && gax !== null && gaz !== null) {
    let bestSeg = null, bestD = 0, bestDist = Infinity;
    for (const sg of segs) {
      const rad = (sg.ang * Math.PI) / 180;
      const ux = Math.cos(rad), uz = Math.sin(rad);
      let t = (gax - sg.ax) * ux + (gaz - sg.az) * uz;   // 投影参数（米）
      t = Math.max(0, Math.min(sg.len, t));
      const px = sg.ax + ux * t, pz = sg.az + uz * t;
      const dd = (px - gax) * (px - gax) + (pz - gaz) * (pz - gaz);
      if (dd < bestDist) { bestDist = dd; bestSeg = sg; bestD = t; }
    }
    if (bestSeg) {
      gateSeg = bestSeg;
      gateD = bestD;
      notes.push('gate_align：门选最近段（距参考点 ' + (Math.sqrt(bestDist).toFixed(2)) + 'm），投影点距段起点 ' + bestD.toFixed(2) + 'm');
    }
  }
  const gatePt = gate ? g.lerpOnSeg(gateSeg, gateD) : null;

  let panels = 0;
  for (const sg of segs) {
    const isGateSeg = gate && sg === gateSeg;
    const dists = g.sampleDistances(sg.len, step, false, false);
    for (const d of dists) {
      const pt = g.lerpOnSeg(sg, d);
      // 门位：门段上距 gatePt 最近的一块板换成大门（换完即止）
      if (isGateSeg && !gateDone && gatePt && Math.abs(d - gateD) <= step / 2 + 1e-6) {
        if (push({ partKey: gate.partKey, role: gate.role, grid: gate.grid, modelPath: gate.modelPath,
          dx: g.r2(pt.dx), dz: g.r2(pt.dz), ry: g.r2(sg.ang), level: 0 })) { gateDone = true; continue; }
      }
      if (push({ partKey: panel.partKey, role: panel.role, grid: panel.grid, modelPath: panel.modelPath,
        dx: g.r2(pt.dx), dz: g.r2(pt.dz), ry: g.r2(sg.ang), level: 0 })) panels++;
    }
  }
  if (gate && !gateDone) notes.push('大门未嵌入（门段没有可替换的栏板位）→ 落在门点补放');
  if (gate && !gateDone && gatePt) {
    push({ partKey: gate.partKey, role: gate.role, grid: gate.grid, modelPath: gate.modelPath,
      dx: g.r2(gatePt.dx), dz: g.r2(gatePt.dz), ry: g.r2(gateSeg.ang), level: 0 });
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
      recipe: 'fence', count: parts.length, panels, posts,
      gate: gateDone ? gate.partKey : (gate ? (gate.partKey + '(门点补放)') : null),
      gateAlign: !!(gax !== null && gaz !== null),
      segments: segs.length, step: g.r2(step), closed: true,
      truncated, bounds: g.boundsOf(parts), dropped, notes,
    },
  };
}

module.exports = { build, panelLen };
