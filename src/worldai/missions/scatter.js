/**
 * scatter —— 散点布局原语（队列14 C2 · 确定性泊松盘采样）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么存在：小模型不会排坐标（实测把 4 棵树全写在 (0,0)）。散点类需求
 * （森林/花田/草地/树丛）的"语义"只有三件事——用什么零件、多少棵、铺多大范围；
 * 坐标交给本模块用带种子的泊松盘采样生成：均匀、不重叠、**同种子结果逐字节一致**
 * （委托重跑 → 同坐标 → batchJournal 幂等去重命中，不产生重复件）。
 *
 * 契约（§队列14 C2）：
 *   - 输入 {width, depth, count, radius, seed}
 *   - 输出 [{dx, dz}]（相对块 anchor 的米级偏移，已居中：dx∈[-w/2,+w/2]）
 *   - 纯函数、零 IO、确定性
 */
'use strict';

/** mulberry32：小巧的确定性 PRNG（种子 → [0,1)） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字符串 → 32 位种子（FNV-1a） */
function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * 泊松盘散点（dart-throwing + 最小距离栅格加速；count ≤ 400 时毫秒级）。
 * @param {object} o { width, depth, count, radius, seed }
 *   width/depth 米；radius 相邻两点最小中心距（米）；seed 任意字符串。
 * @returns {Array<{dx:number, dz:number}>} 相对中心偏移
 */
function poissonScatter(o) {
  const width = Math.max(2, Number(o && o.width) || 20);
  const depth = Math.max(2, Number(o && o.depth) || 20);
  const count = Math.max(1, Math.min(400, Math.floor(Number(o && o.count) || 1)));
  const radius = Math.max(1, Number(o && o.radius) || 2);
  const rng = mulberry32(hashSeed(o && o.seed));
  const halfW = width / 2, halfD = depth / 2;
  const r2 = radius * radius;

  // 栅格加速：cell = radius/√2，保证每 cell 至多 1 点时的近邻查询正确性
  const cell = radius / Math.SQRT2;
  const gw = Math.max(1, Math.ceil(width / cell));
  const gd = Math.max(1, Math.ceil(depth / cell));
  const grid = new Int32Array(gw * gd).fill(-1); // -1 = 空
  const pts = [];

  const cellOf = (dx, dz) => [
    Math.min(gw - 1, Math.max(0, Math.floor((dx + halfW) / cell))),
    Math.min(gd - 1, Math.max(0, Math.floor((dz + halfD) / cell))),
  ];
  const fits = (dx, dz) => {
    const [cx, cz] = cellOf(dx, dz);
    for (let gx = Math.max(0, cx - 2); gx <= Math.min(gw - 1, cx + 2); gx++) {
      for (let gz = Math.max(0, cz - 2); gz <= Math.min(gd - 1, cz + 2); gz++) {
        const idx = grid[gz * gw + gx];
        if (idx < 0) continue;
        const p = pts[idx];
        const ddx = p.dx - dx, ddz = p.dz - dz;
        if (ddx * ddx + ddz * ddz < r2) return false;
      }
    }
    return true;
  };
  const place = (dx, dz) => {
    const [cx, cz] = cellOf(dx, dz);
    grid[cz * gw + cx] = pts.length;
    pts.push({ dx, dz });
  };

  let attempts = 0;
  const maxAttempts = count * 60 + 200; // 密集时放宽，仍保证有界
  while (pts.length < count && attempts < maxAttempts) {
    attempts++;
    const dx = (rng() * 2 - 1) * halfW;
    const dz = (rng() * 2 - 1) * halfD;
    if (fits(dx, dz)) place(dx, dz);
  }
  // 极小区域放不下 count 个（radius 过大）→ 尽力而为返回已放下的点（调用方按实际长度统计）
  return pts;
}

/** 按种子从 [0,90,180,270] 里取旋转角（散点自然物的朝向随机化） */
function rotationFor(seedStr, index) {
  return (hashSeed(seedStr + ':' + index) >>> 2) % 4 * 90;
}

/** 估算散点最小间距：取零件最大边长 × 1.2，下限 1.5m（防同种零件贴脸重叠） */
function radiusFor(gridSizes) {
  let maxEdge = 1;
  for (const g of (gridSizes || [])) {
    if (Array.isArray(g)) maxEdge = Math.max(maxEdge, Number(g[0]) || 0, Number(g[2]) || 0);
  }
  return Math.max(1.5, maxEdge * 1.2);
}

module.exports = { poissonScatter, mulberry32, hashSeed, rotationFor, radiusFor };
