/**
 * modularRules —— 模数规则表（M1-1）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 职责边界（§K）：
 *   纯常量 + 纯函数。不做数据库访问、不读文件、不 console。solver 的几何口径全部来自这里，
 *   验收脚本也复用同一份常量 —— 判据与实现不会各说各话。
 *
 * 为什么单独一个文件（不是"为了分层而分层"）：
 *   这些数字都是**实测值**，不是设计目标。它们必须能被一处看到并解释来源，
 *   否则下次有人"顺手把 0.02 改成 0.05"，接缝判据就悄悄失效了。
 */
'use strict';

/**
 * 墙件厚度（米）。实测 gltf_2 与 downtown 的墙件均为 0.41m 厚。
 * 用途：外墙面 = 墙中线 + 厚度 → 出檐 = (屋顶宽 − 外墙面宽) / 2。
 * ★ 这是「出檐」唯一的计算入口，不要在别处再写 0.41。
 *
 * ★ 2026-11-07 扩展：厚度不再全局写死 —— 模板可用 `module.wallThickness` 覆盖。
 *   Kenney 那几套是 1m 见方的立方模块（城堡/砖城墙厚 1.0m）、
 *   factory kit 的 structure_wall 厚 2.0m。
 *   继续用 0.41 会把外墙面算窄，出檐虚高 0.3~0.8m，M1-2-2 直接判错。
 *   不写该字段的模板仍然是 0.41，行为不变。
 */
const WALL_THICKNESS = 0.41;

/** 取某份 spec 的墙厚（模板可覆盖；缺省回到 0.41） */
function wallThicknessOf(spec) {
  const v = Number(spec && spec.module && spec.module.wallThickness);
  return isFinite(v) && v > 0 ? v : WALL_THICKNESS;
}

/**
 * 收尾判定：剩余长度 ≤ 2cm 视为已闭合。
 * 沿用 scripts/preview_assemble.js 的 while 条件（len - cursor > 0.02）——
 * 三个模板都是整数模数，实测余量恒为 0；这个阈值只用于吸收浮点尾数。
 */
const TAIL_TOL = 0.02;

/** 接缝判据 1mm（判据 M1-1-1：四边间隙 < 1mm） */
const SEAM_TOL = 0.001;

/** 出檐可接受区间（判据 M1-2-2），单位米 */
const EAVE_RANGE = { min: 0.6, max: 1.2 };

/**
 * 余料策略（M1-1 交付要求「两种策略」）：
 *   absorb —— 末段收窄，把余料吃进最后一件（实测脚本行为，接缝恒 0）
 *   snap   —— 拒绝收边，要求边长是件宽整数倍，否则明确失败并给出吸附建议
 * 默认 absorb：三个已验证模板都是整数模数，两种策略产出逐字节一致。
 */
const POLICIES = ['absorb', 'snap'];

/** 屋顶两种铺法（模板 roof.mode 的合法取值） */
const ROOF_MODES = ['whole', 'tile'];

/** 保留 3 位小数：求解器所有坐标输出的唯一取整口径（确定性） */
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;

/** 弧度 → 角度（保留 3 位） */
const deg = (rad) => r3((Number(rad) * 180) / Math.PI);

/**
 * 角度归一到 0/90/180/270。
 * 只用于「墙件朝向」——墙的平面朝向永远是轴对齐的，斜墙不在本轮范围（§8 不做清单）。
 */
const normAng = (a) => (((Math.round(Number(a) / 90) * 90) % 360) + 360) % 360;

/**
 * 层高需要几排墙件。
 * ★ 少数套件（Kenney modular）墙块仅 0.625m 高，层高 2.5m 必须堆 4 排；
 *   中世纪/现代套件墙高≈层高，rows 恒为 1，行为与单排完全一致。
 * @param {number} wallHeight 层高（米）
 * @param {number} pieceH     墙件高（米），≤0.01 时视为无效
 * @returns {number} ≥1 的整数排数
 */
function rowsFor(wallHeight, pieceH) {
  const h = Number(pieceH);
  const H = Number(wallHeight);
  if (!(h > 0.01) || !(H > 0)) return 1;
  return Math.max(1, Math.round(H / h));
}

/** 一条边的平面长度（米）——edges 是轴对齐线段，用勾股即可 */
function edgeLen(edge) {
  const e = edge || {};
  const a = Array.isArray(e.a) ? e.a : [0, 0];
  const b = Array.isArray(e.b) ? e.b : [0, 0];
  return Math.hypot(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1]));
}

/** 余料策略取值：ctx 覆盖 spec，缺省 absorb */
function resolvePolicy(spec, ctx) {
  const c = ctx || {};
  const s = spec || {};
  const p = String(c.policy || s.policy || s.layoutPolicy || 'absorb');
  return POLICIES.indexOf(p) >= 0 ? p : 'absorb';
}

/** 吸附到最近模数倍数（供 snap 策略/失败提示使用）：8.4 → 8 */
function nearestMultiple(v, unit) {
  const n = Number(v);
  const u = Number(unit) || 1;
  if (!Number.isFinite(n)) return u;
  return Math.max(u, Math.round(n / u) * u);
}

/**
 * 出檐计算（两种铺法统一口径）。
 *   whole —— 整块屋顶：出檐 = (屋顶件尺寸 − 外墙面尺寸) / 2
 *   tile  —— 平铺屋顶：配置 eave 是「目标」出檐，实际出檐取决于件数与件宽（会取整）
 * @returns {{configured:number|null, actual:{x:number,z:number}}}
 */
function eaveOf(spec, roofPart) {
  const s = spec || {};
  const W = Number(s.width), D = Number(s.depth);
  const T = wallThicknessOf(s);
  const outerW = W + T;
  const outerD = D + T;
  const rf = s.roof || {};
  const rp = roofPart || {};
  if (rf.mode === 'whole') {
    const ax = rp.w > 0 ? (Number(rp.w) - outerW) / 2 : 0;
    const az = rp.d > 0 ? (Number(rp.d) - outerD) / 2 : 0;
    return { configured: null, actual: { x: r3(ax), z: r3(az) } };
  }
  const cfg = Number(rf.eave);
  if (!(cfg >= 0)) return { configured: null, actual: { x: 0, z: 0 } };
  // 平铺：件数向上取整后再回算真实出檐（取整会让出檐略大于配置值）
  const w = Number(rp.w) > 0 ? Number(rp.w) : 1;
  const d = Number(rp.d) > 0 ? Number(rp.d) : 1;
  const tx = Math.max(1, Math.round((outerW + cfg * 2) / w));
  const tz = Math.max(1, Math.round((outerD + cfg * 2) / d));
  return {
    configured: cfg,
    actual: { x: r3((tx * w - outerW) / 2), z: r3((tz * d - outerD) / 2) },
  };
}

/** 出檐是否落在可接受区间（M1-2-2 的判据函数，供验收与未来选型使用） */
function isEaveAcceptable(eave) {
  const e = eave || {};
  const x = Number(e.x), z = Number(e.z);
  return isFinite(x) && isFinite(z) &&
    x >= EAVE_RANGE.min && x <= EAVE_RANGE.max &&
    z >= EAVE_RANGE.min && z <= EAVE_RANGE.max;
}

module.exports = {
  WALL_THICKNESS, TAIL_TOL, SEAM_TOL, EAVE_RANGE, POLICIES, ROOF_MODES,
  r3, deg, normAng, wallThicknessOf,
  rowsFor, edgeLen, resolvePolicy, nearestMultiple, eaveOf, isEaveAcceptable,
};
