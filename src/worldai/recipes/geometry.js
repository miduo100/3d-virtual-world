/**
 * geometry —— Recipe 共用几何（AI 自由拼装 · 会话1 · §4.7）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么存在：§2.1 分工铁律——**AI 只给骨架（waypoints/footprint），引擎负责几何计算**。
 * path/building/fence/garden 四个 recipe 都要用到同一批平面几何算子（折线分段、等距采样、
 * 方向角、转折角、多边形边枚举、环型闭合、宽排法线偏移），各写一份必然出现两种答案
 * （与 assetSearch 同款理由：几何是"事实"，不能各算各的）。
 *
 * ★ 三条纪律：
 *   1) 纯函数、零 IO、不读库不读盘（partResolver 由调用方注入）；
 *   2) **禁用 Math.random**，随机一律由调用方走 scatter.mulberry32/hashSeed（§11-8 幂等铁律）；
 *   3) 坐标输出一律 2 位小数（与 missionPlanner.expandScatterBlocks 同款 toFixed(2)），
 *      保证「同种子 + 同输入 → 逐字节同输出」→ 委托重跑命中 batchJournal 幂等去重。
 *
 * 坐标系：与 missionPlanner 一致 —— dx = 相对块 anchor 的 X 偏移（米），dz = Z 偏移（米），
 * ry = 绕 Y 轴角度（度，[-180,180)），零件 local X 轴在 ry=0 时沿世界 +X。
 */
'use strict';

/** 统一 2 位小数（所有对外坐标） */
function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** 角度归一到 [-180,180)（0 → 0，180 → -180，-10 → -10） */
function normalize180(deg) {
  let d = Number(deg) || 0;
  d = d % 360;
  if (d < 0) d += 360;
  return d >= 180 ? d - 360 : d;
}

/** 两方向夹角（0~180，取最小夹角；用于"拐角"判定） */
function turnDeg(fromDeg, toDeg) {
  let d = (Number(toDeg) - Number(fromDeg)) % 360;
  if (d < 0) d += 360;
  return d > 180 ? 360 - d : d;
}

/** 段方向角（度）：atan2(dz,dx) → [-180,180) */
function angleDeg(dx, dz) {
  return normalize180((Math.atan2(Number(dz) || 0, Number(dx) || 0) * 180) / Math.PI);
}

/** 单点归一：接受 {dx,dz} 或 {x,z} */
function point(p) {
  if (!p) return null;
  const dx = Number(p.dx != null ? p.dx : p.x);
  const dz = Number(p.dz != null ? p.dz : p.z);
  if (!isFinite(dx) || !isFinite(dz)) return null;
  return { dx, dz };
}

/**
 * 骨架点归一：去相邻重复点、剔除零长段（首尾同点）。
 * AI 经常给「(0,0),(0,0),(8,0)」这种重复点，不清会让段长为 0 → atan2=0 → ry 全错。
 */
function normPoints(waypoints) {
  const out = [];
  for (const raw of Array.isArray(waypoints) ? waypoints : []) {
    const p = point(raw);
    if (!p) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.dx - p.dx) < 1e-6 && Math.abs(last.dz - p.dz) < 1e-6) continue;
    out.push(p);
  }
  if (out.length >= 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a.dx - b.dx) < 1e-6 && Math.abs(a.dz - b.dz) < 1e-6) out.pop(); // 显式闭合点去掉首点
  }
  return out;
}

/**
 * 环型闭合判定：末点距首点 ≤ tol → 视为闭环（自动补回首点）。
 * @param {Array} points normPoints 产物
 * @param {number} tol 容差（调用方传"零件尺寸"，§4.3 环型规格；<=0 时按 1.5m）
 */
function closeLoop(points, tol) {
  const p = points || [];
  if (p.length < 3) return { points: p, closed: false };
  const a = p[0], b = p[p.length - 1];
  const t = Number(tol) > 0 ? Number(tol) : 1.5;
  const dist = Math.hypot(b.dx - a.dx, b.dz - a.dz);
  if (dist <= 1e-6) return { points: p, closed: true };
  // 闭合：**用首点取代尾点**再接回首点（不是简单追加）——否则 (0.5,0.2) 这种"靠近首点
  // 但不是首点"的尾点会多产出一段几十厘米的短段，既多铺一块砖又在接缝处留缺口。
  if (dist <= t) return { points: p.slice(0, -1).concat([{ dx: a.dx, dz: a.dz }]), closed: true };
  return { points: p, closed: false };
}

/** 折线 → 段数组（零长段已由 normPoints 剔除，这里再兜一层） */
function segments(points) {
  const out = [];
  const p = points || [];
  for (let i = 0; i + 1 < p.length; i++) {
    const dx = p[i + 1].dx - p[i].dx, dz = p[i + 1].dz - p[i].dz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    out.push({ i, ax: p[i].dx, az: p[i].dz, bx: p[i + 1].dx, bz: p[i + 1].dz, dx, dz, len, ang: angleDeg(dx, dz) });
  }
  return out;
}

/**
 * 沿段等距采样（返回距起点的距离序列，米）。
 *★ 均分而非"步长取整"：块数 n = ceil(len/step)，间距均摊 len/n ——
 *   保证 ① 首尾一定到头（否则路短一截：20m/步长3 只铺到 18m）
 *         ② 不会出现"末块间距过小 → gridsnap 吸附后与前一块同格位 → 被去重吃掉"（E2E 实测 7/8 件）。
 *   skipFirst：跳过 d=0（该顶点已由 corner 件占据）；skipEnd：不取到 L（终点是 corner）。
 */
function sampleDistances(len, step, skipFirst, skipEnd) {
  const s = Number(step) > 0 ? Number(step) : 1;
  const L = Number(len) || 0;
  if (!(L > 0)) return [];
  const n = Math.max(1, Math.ceil(L / s - 1e-9));
  const gap = L / n;
  const lastIdx = skipEnd ? n - 1 : n;
  const out = [];
  for (let i = skipFirst ? 1 : 0; i <= lastIdx; i++) out.push(r2(i * gap));
  return out;
}

/** 段上取点（d = 距起点距离） */
function lerpOnSeg(seg, d) {
  const t = seg.len > 0 ? d / seg.len : 0;
  return { dx: seg.ax + seg.dx * t, dz: seg.az + seg.dz * t };
}

/** 段法线（垂直于段方向，单位向量；绕 ry 对齐后零件 local Z 即沿此方向） */
function segNormal(seg) {
  return { dx: seg.dz / seg.len, dz: -seg.dx / seg.len };
}

/** 多边形闭合边（building/fence 用；输入 <3 点返回 []） */
function polygonEdges(points) {
  const p = normPoints(points);
  if (p.length < 3) return [];
  const closed = p.concat([{ dx: p[0].dx, dz: p[0].dz }]);
  const segs = segments(closed);
  return segs.map((s) => ({
    index: s.i, ax: s.ax, az: s.az, bx: s.bx, bz: s.bz,
    // ★ dx/dz 必须带上：lerpOnSeg 靠它们做沿线插值。缺了会让 building 全部墙件坐标变 NaN
    //   → 同位去重把它们压成 1 件（会话2 实测踩到：5 层楼只落了 1 块墙）。
    dx: s.dx, dz: s.dz,
    len: s.len, ang: s.ang,
    mid: { dx: (s.ax + s.bx) / 2, dz: (s.az + s.bz) / 2 },
    normal: segNormal(s),
  }));
}

/** 多边形中心（顶点平均，足够平铺用） */
function polygonCentroid(points) {
  const p = normPoints(points);
  if (!p.length) return { dx: 0, dz: 0 };
  let x = 0, z = 0;
  for (const q of p) { x += q.dx; z += q.dz; }
  return { dx: x / p.length, dz: z / p.length };
}

/** 多边形外扩/内缩（正=外扩；逐顶点取相邻两边法线均值，够用且无依赖） */
function offsetPolygon(points, dist) {
  const edges = polygonEdges(points);
  if (!edges.length) return normPoints(points);
  const d = Number(dist) || 0;
  const p = normPoints(points);
  return p.map((v, i) => {
    const prev = edges[(i - 1 + edges.length) % edges.length];
    const cur = edges[i];
    let nx = prev.normal.dx + cur.normal.dx, nz = prev.normal.dz + cur.normal.dz;
    const len = Math.hypot(nx, nz) || 1;
    nx /= len; nz /= len;
    return { dx: r2(v.dx + nx * d), dz: r2(v.dz + nz * d) };
  });
}

/** 零件 grid 归一（[w,h,d]，缺省 1）
 *  ★ 2026-10-12 修：原写法 `Number(g[1]) || 1` 把 **0 当成缺省值**兜底成 1。
 *    而 Roof_2x2 / floor / top 这类零厚度平板的 grid_h 就是 0（实测 12 件），
 *    被抬成 1 后 building.js 按「墙顶 + h/2」放屋顶 → 屋顶悬在墙顶上方 0.5m，
 *    用户看到"屋顶和墙之间一道缝"。现在 0 是合法值（零厚度），只有未提供/非法才兜底 1。 */
function normGrid(grid) {
  const g = Array.isArray(grid) ? grid : [];
  const one = function (v) {
    if (v == null) return 1;            // null/undefined 是「未提供」（注意 Number(null)===0，不能只靠 isFinite）
    const n = Number(v);
    return (isFinite(n) && n >= 0) ? n : 1;
  };
  return [one(g[0]), one(g[1]), one(g[2])];
}

/** 零件集合包围盒（区域裁剪/越界预判/后台确认卡摘要用） */
function boundsOf(items) {
  if (!Array.isArray(items) || !items.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const it of items) {
    const dx = Number(it && it.dx) || 0, dz = Number(it && it.dz) || 0;
    minX = Math.min(minX, dx); maxX = Math.max(maxX, dx);
    minZ = Math.min(minZ, dz); maxZ = Math.max(maxZ, dz);
  }
  return { minX: r2(minX), maxX: r2(maxX), minZ: r2(minZ), maxZ: r2(maxZ) };
}

module.exports = {
  r2, normalize180, turnDeg, angleDeg, point, normPoints, closeLoop, segments,
  sampleDistances, lerpOnSeg, segNormal, polygonEdges, polygonCentroid,
  offsetPolygon, normGrid, boundsOf,
};