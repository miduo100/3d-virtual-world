/**
 * boundsGuard —— 地理围栏（矩形 · O(1)）+ 占位预检 + 换位搜索（Phase 3.5-1 · §G.5 ②③）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§G.5 ②（禁止覆盖式搭建）/ ③（出生点保护半径）+ §C.3 ⑩（bounds 一期只有 rect）
 * + §H.10.4（并行的安全边界 = 区域边界）。
 *
 * 一期只做轴对齐矩形（§I.3 已论证：将来要旋转只需加 rotationDeg，判定改成"把点变换到
 * 矩形局部坐标再比"，**不要提前实现**）。
 *
 * ★ 碰撞预检为什么按"空间窗口"查而不是按 region_id 查：
 *   管理员手建的东西region_id 是 NULL（既有 1127 行都是），若只查 region_id = 本区域，
 *   就等于"没归属的人工资产永远撞不到" —— 这正是 §G.5 ② 要防的那种误覆盖。
 *   故按 bounds 的空间窗口取候选，再逐个做 AABB 求交。
 */
'use strict';

const { query } = require('../../database/db');

/** 兜底足迹（米）：world_objects 没有 size 列，用来源零件的 grid 尺寸，缺则用这个 */
const DEFAULT_FOOTPRINT = { w: 2, d: 2 };

function num(v, def) {
  const n = Number(v);
  return isFinite(n) ? n : def;
}

/** 校验并归一 bounds（§C.3⑩：{kind:'rect', x, z, width, depth}） */
function normalizeBounds(b) {
  const src = b && typeof b === 'object' ? b : {};
  if (src.kind && src.kind !== 'rect') {
    return { ok: false, code: 'BOUNDS_KIND_UNSUPPORTED', reason: '一期只支持 kind=rect（多边形/旋转矩形见 §I.3，刻意不实现）' };
  }
  const x = num(src.x, NaN), z = num(src.z, NaN), width = num(src.width, NaN), depth = num(src.depth, NaN);
  if (!isFinite(x) || !isFinite(z) || !isFinite(width) || !isFinite(depth)) {
    return { ok: false, code: 'BOUNDS_INVALID', reason: 'bounds 必须含数值 x / z / width / depth' };
  }
  if (width <= 0 || depth <= 0) {
    return { ok: false, code: 'BOUNDS_EMPTY', reason: 'bounds 宽深必须为正数' };
  }
  return { ok: true, bounds: { kind: 'rect', x, z, width, depth, minX: x, minZ: z, maxX: x + width, maxZ: z + depth } };
}

/** 点是否在矩形内（margin>0 时内缩，用于"整件必须落在区域内"） */
function contains(bounds, x, z, margin) {
  const b = bounds || {};
  const minX = num(b.minX, num(b.x, 0)), maxX = num(b.maxX, num(b.x, 0) + num(b.width, 0));
  const minZ = num(b.minZ, num(b.z, 0)), maxZ = num(b.maxZ, num(b.z, 0) + num(b.depth, 0));
  const m = num(margin, 0);
  return x >= minX + m && x <= maxX - m && z >= minZ + m && z <= maxZ - m;
}

/**
 * 整件是否落在区域内（用足迹的半宽半深判断中心点，§G.5① 越界判据 P35-7）。
 * @returns {{ok:boolean, code?:string, reason?:string}}
 */
function checkInside(bounds, x, z, footprint) {
  const f = Object.assign({}, DEFAULT_FOOTPRINT, footprint || {});
  const hw = Math.abs(num(f.w, DEFAULT_FOOTPRINT.w)) / 2;
  const hd = Math.abs(num(f.d, DEFAULT_FOOTPRINT.d)) / 2;
  // ★ 判定口径：**整件必须落在区域内** = 中心点距边界至少半个足迹。
  //   （不要拿"某个角点"去查 contains —— 角点天然在边界外，会把贴边放置全部误判成越界。）
  const margin = Math.max(hw, hd);
  if (contains(bounds, x, z, margin)) return { ok: true };
  return {
    ok: false,
    code: 'OUT_OF_BOUNDS',
    reason: '落点（或其足迹）超出区域围栏 —— 越界一律拒绝，不是事后清理（判据 P35-7）',
    bounds: bounds, x, z, footprint: f,
  };
}

/** world_objects 行 → AABB（无 size 列时按足迹推；custom_config.bbox/size 优先） */
function aabbOf(row, footprint) {
  const cc = (row && row.custom_config) || {};
  const box = cc.bbox || cc.size || null;
  const f = Object.assign({}, DEFAULT_FOOTPRINT, footprint || {});
  const w = box && isFinite(Number(box.w)) ? Math.abs(Number(box.w)) : (box && isFinite(Number(box.width)) ? Math.abs(Number(box.width)) : Math.abs(num(f.w, DEFAULT_FOOTPRINT.w)));
  const d = box && isFinite(Number(box.d)) ? Math.abs(Number(box.d)) : (box && isFinite(Number(box.depth)) ? Math.abs(Number(box.depth)) : Math.abs(num(f.d, DEFAULT_FOOTPRINT.d)));
  const h = box && isFinite(Number(box.h)) ? Math.abs(Number(box.h)) : Math.abs(num(f.h, 3));
  const x = num(row.position_x, 0), z = num(row.position_z, 0), y = num(row.position_y, 0);
  const sx = Math.abs(num(row.scale_x, 1)) || 1, sz = Math.abs(num(row.scale_z, 1)) || 1, sy = Math.abs(num(row.scale_y, 1)) || 1;
  const hw = (w * sx) / 2, hd = (d * sz) / 2;
  return { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, minY: y, maxY: y + h * sy };
}

/** 2D AABB 求交（ footprints 重叠即视为冲突；Y 交叠由调用方按需再判） */
function overlaps(a, b) {
  if (!a || !b) return false;
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
/**
 * 取与区域矩形空间重叠的既有对象候选（**含 region_id 为 NULL 的人工资产**）。
 * 只取窗口内的候选行，避免全表 1127 行进内存（也避免误判"远处的对象也能撞"）。
 */
async function loadObstacles(bounds, opts) {
  const o = opts || {};
  const b = bounds || {};
  const pad = num(o.pad, 6);
  // ★ ignoreSelfBatch（AI 自由拼装 recipe 块）：排除**本委托自己刚建的件**。
  //   原因（E2E 实测真 bug）：recipe 引擎沿骨架均分出的间距可能小于零件尺寸
  //   （20m 骨架 / roadTile 3m → 间距 2.857m），相邻砖天然贴合——这是设计内布局，
  //   不是"撞到东西"。同批件互相判碰撞 → findFreeSpot 换位 → 路被挪歪（实测 1 块飞到 (3238,3227)）。
  //   ★ 人类资产（origin≠'ai'）与**其他委托**的资产照旧参与碰撞——红线"人工资产不覆盖"不受影响。
  const res = await query(
    `SELECT id, name, type, origin, region_id, created_by, is_locked,
            position_x, position_y, position_z, scale_x, scale_y, scale_z, custom_config
       FROM world_objects
      WHERE position_x >= $1::double precision - $4::double precision
        AND position_x <= $2::double precision + $4::double precision
        AND position_z >= $3::double precision - $4::double precision
        AND position_z <= $5::double precision + $4::double precision
        AND NOT ($6::text IS NOT NULL AND origin = 'ai' AND created_by = $6::text)`,
    [num(b.minX, num(b.x, 0)), num(b.maxX, num(b.x, 0) + num(b.width, 0)),
      num(b.minZ, num(b.z, 0)), pad,
      num(b.maxZ, num(b.z, 0) + num(b.depth, 0)),
      o.ignoreSelfBatch ? String(o.missionId || '') : null]
  );
  return res.rows || [];
}

/**
 * 占位预检（§G.5 ②）：新件 AABB 与既有对象求交。
 * - 命中 origin='ai'    → 换位，计入 skippedByCollision
 * - 命中 origin≠'ai'    → 换位，且记 memory('blocked_by_user_asset')
 * 两者都**换位**，绝不覆盖（一期永不提供 placement_policy='replace'）。
 * @returns {{ok:boolean, code?:string, hits?:Array, humanBlocked?:boolean}}
 */
function checkPlacement(bounds, x, z, footprint, obstacles) {
  const inside = checkInside(bounds, x, z, footprint);
  if (!inside.ok) return inside;
  const box = aabbOf({ position_x: x, position_z: z }, footprint);
  const hits = [];
  for (const row of (obstacles || [])) {
    const ob = aabbOf(row);
    if (!overlaps(box, ob)) continue;
    hits.push({ id: row.id, origin: row.origin || 'human', type: row.type, name: row.name });
  }
  if (!hits.length) return { ok: true, box };
  const humanBlocked = hits.some((h) => String(h.origin) !== 'ai');
  return {
    ok: false,
    code: humanBlocked ? 'COLLIDES_HUMAN_ASSET' : 'COLLIDES_AI_ASSET',
    reason: humanBlocked
      ? '落点与人工资产包围盒相交 → 换位（绝不覆盖，§G.5 ②）'
      : '落点与已有 AI 资产相交 → 换位（计入 skippedByCollision）',
    hits,
    humanBlocked,
    box,
  };
}

/**
 * 换位搜索：沿网格向外螺旋找最近空格（§G.5 ② 换位尝试上限 12 次，仍失败则放弃该件 + 记 memory）。
 * @returns {{ok:boolean, x?:number, z?:number, attempts:number, code?:string, reason?:string}}
 */
function findFreeSpot(bounds, prefer, footprint, obstacles, opts) {
  const o = opts || {};
  // 12 次 × 0.5m 步长的老参数在"历次 AI 资产同点堆簇"的角落里搜不出 1.7m 半径，
  // 实测"换位 4 全灭"（§队列14 A3）。48 次 + 步长下限 1m：覆盖半径 ~7m，密簇也能摊开。
  const maxAttempts = Math.max(1, num(o.maxAttempts, 48));
  const stepX = Math.max(1, num(o.stepX, (num(footprint && footprint.w, DEFAULT_FOOTPRINT.w) || 2)));
  const stepZ = Math.max(1, num(o.stepZ, (num(footprint && footprint.d, DEFAULT_FOOTPRINT.d) || 2)));
  const x0 = num(prefer && prefer.x, 0), z0 = num(prefer && prefer.z, 0);
  let attempts = 0;
  for (let ring = 0; ring <= maxAttempts; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        // 只走当前这一圈的外壳，避免重复试内圈
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
        const x = x0 + dx * stepX, z = z0 + dz * stepZ;
        attempts++;
        const r = checkPlacement(bounds, x, z, footprint, obstacles);
        if (r.ok) return { ok: true, x, z, attempts, box: r.box };
        if (attempts >= maxAttempts) {
          return { ok: false, attempts, code: r.code, reason: '换位 ' + maxAttempts + ' 次仍找不到空位 → 该部件放弃 + 记 memory，不硬塞（§G.5 ②）', lastHits: r.hits };
        }
      }
    }
  }
  return { ok: false, attempts, code: 'NO_FREE_SPOT', reason: '区域内找不到空位' };
}

module.exports = {
  DEFAULT_FOOTPRINT,
  normalizeBounds,
  contains,
  checkInside,
  aabbOf,
  overlaps,
  loadObstacles,
  checkPlacement,
  findFreeSpot,
};