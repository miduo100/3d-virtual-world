/**
 * recipes/index.js —— Recipe 注册表（AI 自由拼装 · 会话1 · §4.7）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * planner 只做两件薄接线（§4.6 missionPlanner 已贴 500 行红线）：
 *   ① 调 build(name, spec, ctx)；② 按 stats.count 记账预算。
 * 其余一律在这里收口，避免 planner 里长出 if-else 链条。
 *
 * 未知 recipe 必须**带可用清单 hint**（§4.7 / R1-5）：LLM 拼错名字时能自纠，
 * 而不是拿到一个无信息的失败（§11-6 同款"显式丢+计数"精神）。
 */
'use strict';

const REGISTRY = new Map();

/** 每个 recipe 一行中文说明（拼进 hint 与阶段2 场景 prompt，LLM 自纠用） */
const DESC = {
  path: '小路/广场/栈道：waypoints 折线点(2~8个) + width 宽 + tile 路面砖键 + cornerTile 拐角砖键',
  building: '房屋/店铺：footprint 轮廓多边形 + floors 层数 + door/windows/balcony + parts{wall,corner,door,window,roof}',
  fence: '围栏/围墙：polygon 多边形 + gate_position 门口位置(0~1比例) + parts{fence,post,gate}',
  garden: '花坛/绿化：shape 形状 + size 尺寸 + flower_types 零件键 + parts{edge}',
  forest: '树丛/树林：count 数量 + around 中心偏移 + partKeys 树种键（泊松盘确定性布点）',
};

/**
 * 注册一个 recipe
 * @param {string} name recipe 名（小写）
 * @param {function} fn async (spec, ctx) => { ok, parts?, stats?, code?, reason?, hint? }
 * @param {string} [desc] 中文说明（进 hint）
 */
function register(name, fn, desc) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) throw new Error('recipe 名不能为空');
  if (typeof fn !== 'function') throw new Error('recipe ' + key + ' 必须传函数');
  REGISTRY.set(key, { name: key, fn, desc: desc || DESC[key] || '' });
  return key;
}

/** 注销（测试用） */
function unregister(name) {
  return REGISTRY.delete(String(name || '').trim().toLowerCase());
}

/** 已注册 recipe 名（升序） */
function listRecipeNames() {
  return Array.from(REGISTRY.keys()).sort();
}

/** 是否已注册 */
function has(name) {
  return REGISTRY.has(String(name || '').trim().toLowerCase());
}

/** 给 LLM 看的可用清单（名(说明) 逗号分隔） */
function describe() {
  return listRecipeNames()
    .map((k) => k + (DESC[k] || (REGISTRY.get(k) && REGISTRY.get(k).desc) ? '(' + (DESC[k] || REGISTRY.get(k).desc) + ')' : ''))
    .join(' | ') || '（空）';
}

/**
 * 执行一个 recipe（统一失败形状，planner 只需判 ok）
 * @returns {Promise<{ok:true, parts, stats} | {ok:false, code, reason, hint}>}
 */
async function build(name, spec, ctx) {
  const key = String(name == null ? '' : name).trim().toLowerCase();
  const entry = REGISTRY.get(key);
  if (!entry) {
    return {
      ok: false,
      code: 'UNKNOWN_RECIPE',
      recipe: key || null,
      reason: '未知 recipe：' + (String(name) || '(空)') + '（可用：' + listRecipeNames().join(', ') + '）',
      hint: '可用 recipe —— ' + describe(),
      available: listRecipeNames(),
    };
  }
  let r;
  try {
    r = await entry.fn(spec || {}, ctx || {});
  } catch (e) {
    return {
      ok: false, code: 'RECIPE_EXCEPTION', recipe: key,
      reason: 'recipe ' + key + ' 抛异常：' + String(e && e.message || e).slice(0, 200),
      hint: '这是引擎缺陷，请改用同结构的其它 recipe 或缩小 spec 规模',
    };
  }
  if (!r || r.ok !== true) {
    return Object.assign(
      { ok: false, code: (r && r.code) || 'RECIPE_FAILED', recipe: key },
      r || { reason: 'recipe ' + key + ' 返回空结果' }
    );
  }
  if (!Array.isArray(r.parts)) {
    return {
      ok: false, code: 'RECIPE_BAD_OUTPUT', recipe: key,
      reason: 'recipe ' + key + ' 返回 ok=true 但 parts 不是数组',
      hint: '契约要求 { ok:true, parts:[{partKey,dx,dz,ry,level,grid,modelPath,role}], stats }',
    };
  }
  return r;
}

// ── 注册（会话1 只有 path；后续会话各加一行，见 §4.7 文件清单）
register('path', require('./path').build);

module.exports = { register, unregister, listRecipeNames, has, describe, build, DESC };