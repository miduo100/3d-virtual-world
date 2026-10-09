/**
 * assetValidator —— components 校验（AI World Brain · Phase 5 · §F.2 + P4-9/P4-10）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 在 executor 的参数校验层之后、impl 之前生效（经 verbRegistry.preValidate 挂载）：
 *   · 图元白名单：box/sphere/cylinder/cone/torus（threejs_code 等永不出现）
 *   · 部件数 ≤ spec 预算（默认硬上限 400）
 *   · 预估三角面 ≤ spec 预算（默认硬上限 60000）
 * 失败返回结构化 errors + hint（回给 LLM 自修）。
 */
'use strict';

const { PRIMITIVES, HARD_LIMITS } = require('./buildingSpec');

/** 单图元面数估算（与 three.js 默认分段保守对齐；宁可高估） */
function triEstimate(comp) {
  const t = comp && comp.type;
  const radial = Math.max(3, Math.floor(Number(comp && comp.radialSegments) || 16));
  const tubular = Math.max(3, Math.floor(Number(comp && comp.tubularSegments) || 24));
  switch (t) {
    case 'box': return 12;
    case 'sphere': return radial * Math.max(2, Math.floor(Number(comp.heightSegments) || 8)) * 2;
    case 'cylinder': return radial * 4 + 2 * radial;   // 侧面 2rad + 上下盖
    case 'cone': return radial * 2 + radial;           // 侧面 + 底盖
    case 'torus': return radial * tubular * 2;
    default: return 12;
  }
}

/**
 * @param {Array} components
 * @param {object} opts { maxComponents, maxTriangles }
 * @returns {{ok:boolean, errors:Array, hint:string, stats:{components:number,tris:number}}}
 */
function validateComponents(components, opts) {
  const o = opts || {};
  const maxComp = Math.min(HARD_LIMITS.maxComponents, Math.max(1, Math.floor(Number(o.maxComponents) || HARD_LIMITS.maxComponents)));
  const maxTri = Math.min(HARD_LIMITS.maxTriangles, Math.max(100, Math.floor(Number(o.maxTriangles) || HARD_LIMITS.maxTriangles)));
  const errors = [];
  const list = Array.isArray(components) ? components : [];
  if (!list.length) errors.push(err('components', '组件数组为空', list.length));
  if (list.length > maxComp) {
    errors.push(err('components', '组件数量 ' + list.length + ' 超过预算 ' + maxComp + '，请减少 repeat/层数或收紧 footprint', list.length));
  }
  let tris = 0;
  list.forEach((c, i) => {
    const t = c && c.type;
    if (PRIMITIVES.indexOf(t) < 0) {
      errors.push(err('components[' + i + '].type', '未知图元（白名单：' + PRIMITIVES.join('/') + '）', t));
      return;
    }
    tris += triEstimate(c);
  });
  if (tris > maxTri) {
    errors.push(err('components', '预估三角面 ' + tris + ' 超过预算 ' + maxTri + '，请降低 radialSegments/分段或缩小建筑', tris));
  }
  const hint = errors.length
    ? 'AssetValidator DENY：' + (list.length > maxComp ? 'components>' + maxComp + '；' : '') + (tris > maxTri ? 'tris>' + maxTri : '')
    : '';
  return { ok: errors.length === 0, errors: errors.slice(0, 10), hint, stats: { components: list.length, tris } };
}

function err(path, message, got) { return { path, message, got: got === undefined ? null : got }; }

module.exports = { validateComponents, triEstimate, HARD_LIMITS };
