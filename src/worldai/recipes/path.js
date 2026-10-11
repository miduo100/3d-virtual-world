/**
 * path —— 小路 / 广场 recipe 引擎（AI 自由拼装 · 会话1 · §4.3）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么存在（§1.2 根因1）：让小模型算一条 S 弯路的 30 块砖累加偏移，它会崩，
 * 于是干脆"放一整栋楼"。本模块把几何收回来：AI 只给**折线骨架 + 宽度 + 路面砖**，
 * 引擎负责分段、等距采样、拐角换角砖、宽排并铺 —— 确定性、零 LLM、可单测。
 *
 * 支持形状（§4.3）：直线(2 点) / L 型(3 点) / Z 型(4 点) / S 弯(4~6 点交替) /
 *                环型(末点距首点 ≤ 零件尺寸 → 自动闭合) / 任意多段折线。
 *
 * 输出与 missionPlanner.validatePlan 的 block.parts **完全一致**（§2.2）：
 *   { partKey, dx, dz, ry, level, grid, modelPath, role }
 * 因此下游 absoluteOf → gridsnap → batchJournal → boundsGuard → 幂等去重全部零改动。
 */
'use strict';

const g = require('./geometry');
const { hashSeed } = require('../missions/scatter');

/** 转折超过该角度即视为"拐角"，该顶点改用 cornerTile（§4.3-5） */
const CORNER_ANGLE_DEG = 30;

function fail(code, reason, hint, stats) {
  return { ok: false, code, reason, hint, stats: Object.assign({ recipe: 'path', count: 0 }, stats || {}) };
}

/**
 * @param {object} spec { waypoints:[{dx,dz}], width, tile:[partKey...], cornerTile }
 * @param {object} ctx  { partResolver(partKey)→Promise<part|null>, seedStr, maxObjects }
 * @returns {Promise<{ok:true, parts, stats} | {ok:false, code, reason, hint}>}
 */
async function build(spec, ctx) {
  const s = spec || {};
  const c = ctx || {};
  const seedStr = String(c.seedStr || '');
  const notes = [];
  const dropped = { unknownPart: 0 };

  // ── 1) 骨架点归一（去重复点 / 剔除零长段）
  let points = g.normPoints(s.waypoints);
  if (points.length < 2) {
    return fail(
      'RECIPE_SPEC_INCOMPLETE',
      'waypoints 归一后只剩 ' + points.length + ' 个有效点（至少需要 2 个）',
      '给 2~8 个 {dx,dz} 折线点（单位米，相对块 anchor）；S 弯给 4~6 点交替上下',
      { dropped, notes }
    );
  }

  // ── 2) 零件解析（partResolver 注入 → 本模块零 IO）
  const tileKeys = (Array.isArray(s.tile) ? s.tile : [s.tile])
    .filter(Boolean).map(String);
  if (!tileKeys.length) {
    return fail(
      'RECIPE_SPEC_INCOMPLETE', 'spec.tile 为空，没有可铺装的路面零件',
      '至少给 1 个路面 partKey（part_role=road/ground），如 ["roadTile_001","roadTile_003"]',
      { dropped, notes }
    );
  }
  const resolved = new Map();
  for (const k of tileKeys.concat(s.cornerTile ? [String(s.cornerTile)] : [])) {
    if (resolved.has(k)) continue;
    let raw = null;
    try { raw = await c.partResolver(k); } catch (e) {
      notes.push('partResolver(' + k + ') 抛错：' + String(e && e.message || e).slice(0, 120));
    }
    if (!raw) { dropped.unknownPart++; notes.push('零件不存在（已丢弃）：' + k); continue; } // §11-6 显式丢+计数，不静默跳过
    resolved.set(k, {
      partKey: String(raw.part_key || raw.partKey || k),
      role: String(raw.part_role || raw.role || 'road'),
      grid: g.normGrid(raw.grid || [raw.grid_w, raw.grid_h, raw.grid_d]),
      modelPath: raw.model_path || raw.modelPath || null,
    });
  }
  const tiles = tileKeys.map((k) => resolved.get(k)).filter(Boolean);
  if (!tiles.length) {
    return fail(
      'RECIPE_ALL_PARTS_UNKNOWN',
      'tile 里 ' + tileKeys.length + ' 个 partKey 全部查不到（dropped.unknownPart=' + dropped.unknownPart + '）',
      'partKey 必须来自候选零件清单（拼装类候选只含 composable）；请换用清单内的路面键',
      { dropped, notes }
    );
  }

  const base = tiles[0];
  const step = Math.max(0.5, base.grid[0]);        // 沿路方向步长（零件 local X 对齐段方向）
  const pitch = Math.max(0.5, base.grid[2]);       // 横向排距（零件 local Z）
  const widthM = Number(s.width) > 0 ? Number(s.width) : pitch;
  const rows = Math.max(1, Math.round(widthM / pitch)); // §4.3-4 宽排并铺
  const rowOffsets = [];
  for (let i = 0; i < rows; i++) rowOffsets.push(g.r2((i - (rows - 1) / 2) * pitch));

  // ── 3) 环型闭合 + 分段
  const loop = g.closeLoop(points, Math.max(1, step));
  points = loop.points;
  const segs = g.segments(points);
  if (!segs.length) {
    return fail('RECIPE_SPEC_INCOMPLETE', '折线没有任何有效段', '检查 waypoints 是否给了不同的点', { dropped, notes });
  }

  // ── 4) 顶点转折判定（§4.3-5）：segi 的起点 = 顶点 i
  const corner = s.cornerTile ? resolved.get(String(s.cornerTile)) : null;
  if (s.cornerTile && !corner) notes.push('cornerTile 查不到 → 拐角退化为普通砖（不报错）');
  const n = segs.length;
  const cornerAt = new Array(n).fill(false);
  for (let i = 1; i < n; i++) cornerAt[i] = !!corner && g.turnDeg(segs[i - 1].ang, segs[i].ang) > CORNER_ANGLE_DEG;
  if (loop.closed) cornerAt[0] = !!corner && g.turnDeg(segs[n - 1].ang, segs[0].ang) > CORNER_ANGLE_DEG;

  // ── 5) 落件：先拐角件（占住顶点坐标）→ 再常规砖（同位去重）
  const taken = new Set();
  const parts = [];
  const keyOf = (dx, dz) => Math.round(dx * 100) + ':' + Math.round(dz * 100);
  const push = (p) => {
    const kk = keyOf(p.dx, p.dz);
    if (taken.has(kk)) return false;
    taken.add(kk);
    parts.push(p);
    return true;
  };

  let corners = 0;
  if (corner) {
    for (let i = 0; i < n; i++) {
      if (!cornerAt[i]) continue;
      const inAng = segs[i - 1] ? segs[i - 1].ang : segs[n - 1].ang; // 闭环时首段的"入段"是末段
      const ry = g.normalize180((inAng + segs[i].ang) / 2);            // 入段角与出段角均值
      if (push({
        partKey: corner.partKey, role: corner.role, grid: corner.grid, modelPath: corner.modelPath,
        dx: g.r2(segs[i].ax), dz: g.r2(segs[i].az), ry: g.r2(ry), level: 0,
      })) corners++;
    }
  }

  for (let i = 0; i < n; i++) {
    const sg = segs[i];
    const nextCorner = i + 1 < n ? cornerAt[i + 1] : (loop.closed ? cornerAt[0] : false);
    const dists = g.sampleDistances(sg.len, step, cornerAt[i], nextCorner);
    const nor = g.segNormal(sg);
    for (const d of dists) {
      const base2 = g.lerpOnSeg(sg, d);
      for (const off of rowOffsets) {
        const t = tiles[hashSeed(seedStr + ':' + parts.length) % tiles.length]; // §4.3-6 确定性轮换
        push({
          partKey: t.partKey, role: t.role, grid: t.grid, modelPath: t.modelPath,
          dx: g.r2(base2.dx + nor.dx * off), dz: g.r2(base2.dz + nor.dz * off),
          ry: g.r2(sg.ang), level: 0,
        });
      }
    }
  }

  // ── 6) 预算截断（§4.1 ctx.maxObjects；超出只截断不报错，与 validatePlan 同款）
  let truncated = false;
  const maxObjects = Number(c.maxObjects) > 0 ? Math.floor(Number(c.maxObjects)) : 0;
  if (maxObjects && parts.length > maxObjects) {
    notes.push('预算截断：展开 ' + parts.length + ' 件 > maxObjects ' + maxObjects + ' → 截到 ' + maxObjects + ' 件');
    parts.length = maxObjects;
    truncated = true;
  }

  return {
    ok: true,
    parts,
    stats: {
      recipe: 'path', count: parts.length, corners, rows, segments: n,
      step: g.r2(step), rowPitch: g.r2(pitch), closed: loop.closed,
      truncated, bounds: g.boundsOf(parts), dropped, notes,
    },
  };
}

module.exports = { build, CORNER_ANGLE_DEG };