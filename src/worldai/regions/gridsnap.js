/**
 * gridsnap —— 网格对齐（Phase 3.5-1）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 3.5 文件清单「按 part_library_items.grid_w/h/d 吸附」
 * + §C.3 ⑩ gridsnap 字段（{ kind:'modular', unit:[1,0.63,1], sourceLibrary:'kenney_modular-buildings' }，
 *   castle-kit 用 [1,1.31,1]；不需要对齐时留空 {}）。
 *
 * 为什么必须吸附：AI 直接吐的坐标会撞模数、叠人类建筑；模数是零件库自带的物理事实
 * （墙 1m、castle 1.31m），不吸附就会出现"墙与墙之间一条缝 / 屋顶悬空"。
 *
 * ★ 判据 P35-8 要求：连放 20 个墙 → 坐标全部落在模数格点上，**浮点误差 < 1e-6**。
 *   故实现只用 round + 一次乘法，不用 += 累加（累加会漂移）。
 */

/** 区域未配置 gridsnap 时的兜底模数（Kenney modular-buildings 实测值） */
const DEFAULT_UNIT = [1, 1, 1];

function num(v, def) {
  const n = Number(v);
  return isFinite(n) ? n : def;
}

/** 从 region.gridsnap 取模数；空{} → 兜底 1×1×1 */
function unitOf(gridsnap) {
  const g = gridsnap && typeof gridsnap === 'object' ? gridsnap : {};
  const u = Array.isArray(g.unit) ? g.unit : null;
  if (u && u.length >= 3 && u.slice(0, 3).every((v) => isFinite(Number(v)) && Number(v) > 0)) {
    return [num(u[0], 1), num(u[1], 1), num(u[2], 1)];
  }
  return DEFAULT_UNIT.slice();
}

/** 从零件行取模数（优先 part_library_items.grid_w/h/d） */
function unitOfPart(item) {
  const i = item || {};
  const w = num(i.grid_w, 0), h = num(i.grid_h, 0), d = num(i.grid_d, 0);
  if (w > 0 && d > 0) return [w, h > 0 ? h : 1, d];
  return null;
}

/** 单轴吸附：round(x / unit) * unit（★ 一次乘法，误差可控） */
function snapAxis(value, unit) {
  const u = num(unit, 1);
  if (!(u > 0)) return num(value, 0);
  return Math.round(num(value, 0) / u) * u;
}

/**
 * 坐标吸附。level 表示"第几层"（0 = 地面），Y 按层高吸附，避免 y 漂移。
 * @param {{x,y,z}} pos
 * @param {number[]} unit [ux, uy, uz]
 * @param {number} [level=0]
 */
function snap(pos, unit, level) {
  const u = Array.isArray(unit) && unit.length >= 3 ? unit : DEFAULT_UNIT;
  const p = pos || {};
  return {
    x: snapAxis(p.x, u[0]),
    y: snapAxis(p.y, u[1]) + num(level, 0) * num(u[1], 1),
    z: snapAxis(p.z, u[2]),
  };
}

/** 位置 + 旋转一起吸附（ry 只做角度归一，不吸附 —— 模数不约束旋转） */
function snapPlacement(params, unit, level) {
  const s = snap(params, unit, level);
  const ry = num(params && params.ry, 0);
  return Object.assign({}, params, s, { ry: ry });
}

/** 该坐标是否已在格点上（判据 P35-8 用；误差阈值 1e-6） */
function isOnGrid(value, unit, epsilon) {
  const u = num(unit, 1);
  const v = num(value, 0);
  const k = v / u;
  return Math.abs(k - Math.round(k)) * u <= num(epsilon, 1e-6);
}

module.exports = {
  DEFAULT_UNIT,
  unitOf,
  unitOfPart,
  snapAxis,
  snap,
  snapPlacement,
  isOnGrid,
};