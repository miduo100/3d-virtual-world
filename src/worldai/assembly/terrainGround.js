/**
 * terrainGround —— 地形高程查询（M1-4c · 地形贴合）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 解决什么（2026-11-07 实测）：
 *   世界地形是「离散地块 + 噪声高度场」。山地地块（heightScale=60）上，
 *   样板街那一片地面 y ≈ 17.8m，而求解器一律按 y=0 落位 —— 整条街沉在山下。
 *   所以落位前必须问一句「这块地皮多高」，把整个建筑抬到地面上。
 *
 * ★ 为什么不自己重写一份高度公式：
 *   地形高度是纯函数，但参数组合（fbm 标定系数 2.8/2.6、ridged 混合、flatFade 衰减）
 *   全都写死在客户端 `public/js/terrain/terrainHeight.js` 里，而且被调过多次。
 *   在服务端抄一份 = 两份公式必然漂移，将来改一处忘一处，房子就会"有时沉、有时浮"。
 *   故这里 **直接 require 客户端同一份文件**（IIFE 写 globalThis，Node 下可直接跑），
 *   保证「渲染出来的地面」和「算出来的落地面」是同一根曲线。
 *
 * 口径（无地形时一律回落 0，即历史行为不变）：
 *   baseY = max(中心贴合高度, 最高点 − MAX_BURY)
 *   既不想整栋陷进土里，也不想悬空一大截 —— 山坡上取「埋深不超过 0.8m」的中间值。
 */
'use strict';

const path = require('path');

/** 允许的最大埋深（米）。超过就抬高，宁可露出一截地基也不要整面墙进土 */
const MAX_BURY = 0.8;

/** 采样缓存（地形配置很少变；30s 内复用，避免每栋楼都查一次库） */
let _cache = null;
let _cacheAt = 0;
const TTL_MS = 30000;

/** 载入客户端同一份地形采样器（惰性 + 幂等；IIFE 只会在首次 require 时挂到 globalThis） */
function samplerLib() {
  const base = path.join(__dirname, '../../../public/js/terrain');
  require(path.join(base, 'terrainNoise.js'));
  require(path.join(base, 'terrainHeight.js'));
  const lib = globalThis.TerrainHeight;
  if (!lib || typeof lib.createWorldSampler !== 'function') {
    throw new Error('TerrainHeight 未挂到 globalThis（public/js/terrain/terrainHeight.js 可能被改坏）');
  }
  return lib;
}

async function buildSampler() {
  const { query } = require('../../database/db');
  const r = await query(
    `SELECT id, name, seed, params, pos_x, pos_z, width, depth, base_y, priority
       FROM terrains WHERE is_active = TRUE ORDER BY priority DESC, id ASC`
  );
  const terrains = (r.rows || []).map((t) => ({
    id: t.id,
    name: t.name || '',
    seed: Number(t.seed) || 1,
    params: t.params || {},
    area: {
      x: Number(t.pos_x) || 0, z: Number(t.pos_z) || 0,
      width: Number(t.width) || 0, depth: Number(t.depth) || 0,
      baseY: Number(t.base_y) || 0, priority: Number(t.priority) || 0,
    },
  }));
  return { sampler: samplerLib().createWorldSampler({ terrains }), terrains };
}

/** @returns {Promise<{sampler:object, terrains:array}>} */
async function getSampler() {
  const now = Date.now();
  if (_cache && now - _cacheAt < TTL_MS) return _cache;
  _cache = await buildSampler();
  _cacheAt = now;
  return _cache;
}

/** 测试/长期运行时手动失效（改了地形配置立刻生效） */
function invalidate() {
  _cache = null;
  _cacheAt = 0;
}

/**
 * 单点地面高度。
 * @returns {Promise<number|null>} null = 该点没有地形（地块之外，玩家会一直下坠）
 */
async function groundAt(x, z) {
  const { sampler } = await getSampler();
  const h = sampler.groundAt(Number(x), Number(z));
  return h == null ? null : Number(h);
}

/**
 * 建筑墙中线占地范围内的地面高度统计。
 *
 * ★ 只取「墙中线矩形」，不含出檐：屋檐本来就该悬在坡上，
 *   把屋檐算进来会把整栋楼抬高一截（大面积足迹更容易踩到高点）。
 *
 * @param {number} cx 建筑中心 x
 * @param {number} cz 建筑中心 z
 * @param {number} width  宽（米）
 * @param {number} depth  深（米）
 * @returns {Promise<{hasTerrain:boolean, baseY:number, min:number, max:number,
 *                    center:number, span:number, bury:number, float:number, samples:number}>}
 */
async function underFootprint(cx, cz, width, depth) {
  const { sampler } = await getSampler();
  const hw = Math.max(0, Number(width) || 0) / 2;
  const hd = Math.max(0, Number(depth) || 0) / 2;
  const xs = [-1, 0, 1];
  const zs = [-1, 0, 1];
  const vals = [];
  for (const ix of xs) {
    for (const iz of zs) {
      const h = sampler.groundAt(Number(cx) + ix * hw, Number(cz) + iz * hd);
      if (h != null && isFinite(h)) vals.push(Number(h));
    }
  }
  if (!vals.length) {
    // 地形之外：保持历史行为（y 从 0 起算），由调用方决定要不要提示
    return { hasTerrain: false, baseY: 0, min: 0, max: 0, center: 0, span: 0, bury: 0, float: 0, samples: 0 };
  }
  const min = Math.min.apply(null, vals);
  const max = Math.max.apply(null, vals);
  const center = (min + max) / 2;
  // 居中贴合，但埋深不超过 MAX_BURY（陡坡上宁可露出一点，也不要把整面墙埋掉）
  const baseY = Math.max(center, max - MAX_BURY);
  return {
    hasTerrain: true,
    baseY: Math.round(baseY * 1000) / 1000,
    min: Math.round(min * 1000) / 1000,
    max: Math.round(max * 1000) / 1000,
    center: Math.round(center * 1000) / 1000,
    span: Math.round((max - min) * 1000) / 1000,
    bury: Math.round((max - baseY) * 1000) / 1000,
    float: Math.round((baseY - min) * 1000) / 1000,
    samples: vals.length,
  };
}

module.exports = { groundAt, underFootprint, getSampler, invalidate, MAX_BURY };
