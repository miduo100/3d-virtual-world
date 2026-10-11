/**
 * validate.js —— recipe 块校验（AI 自由拼装 · 实测接线用 · 配套 §4.5）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么单独成文件（§4.6 红线）：`missionPlanner.js` 已 525 行贴 500 红线，
 * 校验规则（必填字段 / 零件解析 / role 约束）必须放 recipes/ 里，planner 只调一次。
 *
 * 职责边界：**只校验骨架，不算坐标**。坐标由 recipe 引擎沿骨架铺（§2.1 分工铁律）。
 * 校验失败一律带 code + hint（§11-6：显式丢 + 计数，绝不静默跳过）。
 */
'use strict';

const registry = require('./index');

/**
 * 每个 recipe 的骨架规格规则。新增 recipe 时在此登记一行（与 index.js 的注册同步）。
 *  required  必填字段
 *  partKeys  从 spec 里抽出要解析的零件键
 *  roles     该 recipe 允许的 part_role（**防"搭路抓整楼"的源头闸门**，§1.2 根因2）
 */
const SPEC_RULES = {
  path: {
    required: ['waypoints', 'tile'],
    partKeys: (spec) => (Array.isArray(spec.tile) ? spec.tile : [spec.tile])
      .filter(Boolean).map(String)
      .concat(spec.cornerTile ? [String(spec.cornerTile)] : []),
    roles: ['road', 'ground', 'floor'],
  },
};

/** 已登记规则的 recipe 名 */
function knownSpecs() {
  return Object.keys(SPEC_RULES);
}

function fail(code, reason, hint, extra) {
  return Object.assign({ ok: false, code, reason, hint }, extra || {});
}

/**
 * 校验并归一一个 recipe 块。
 * @param {object} block LLM 产出的块 { mode:'recipe', recipe, spec }
 * @param {object} opts  { partResolver(partKey)→Promise<part|null>, forbidRoles?, allowedRoles? }
 * @returns {Promise<{ok, recipe, spec, partKeys, notes} | {ok:false, code, reason, hint}>}
 */
async function validateRecipeBlock(block, opts) {
  const o = opts || {};
  const b = block || {};
  const recipe = String(b.recipe == null ? '' : b.recipe).trim().toLowerCase();

  // 1) recipe 名
  if (!recipe) {
    return fail('RECIPE_NAME_MISSING', '块声明了 mode=recipe 却没有给 recipe 名',
      'recipe 名必须是 ' + registry.listRecipeNames().join(' / '), { recipe: null });
  }
  if (!registry.has(recipe)) {
    return fail('UNKNOWN_RECIPE', '未知 recipe：' + recipe + '（已注册：' + registry.listRecipeNames().join(', ') + '）',
      '可用 recipe —— ' + registry.describe(), { recipe });
  }

  // 2) spec 必填字段
  const spec = b.spec && typeof b.spec === 'object' ? b.spec : null;
  if (!spec) {
    return fail('RECIPE_SPEC_INCOMPLETE', 'recipe=' + recipe + ' 但没有给 spec 骨架',
      'spec 是"骨架"（waypoints/footprint 等），不是逐件坐标——AI 只描述形状与位置', { recipe });
  }
  const rule = SPEC_RULES[recipe];
  if (!rule) {
    return fail('RECIPE_NO_SPEC_RULE', 'recipe=' + recipe + ' 未登记骨架规则（引擎侧漏实现）',
      '已登记规则的 recipe：' + knownSpecs().join(', '), { recipe });
  }
  for (const f of rule.required) {
    const v = spec[f];
    const empty = v == null || (Array.isArray(v) && !v.length) || (typeof v === 'string' && !v.trim());
    if (empty) {
      return fail('RECIPE_SPEC_INCOMPLETE', 'recipe=' + recipe + ' 的 spec.' + f + ' 缺失或为空',
        recipe + ' 的骨架必填字段：' + rule.required.join(', ') + '；参考：' + (registry.DESC[recipe] || ''), { recipe, field: f });
    }
  }

  // 3) 零件键解析（真实查库由注入的 partResolver 完成，本模块零 IO）
  const keys = rule.partKeys(spec) || [];
  if (!keys.length) {
    return fail('RECIPE_SPEC_INCOMPLETE', 'recipe=' + recipe + ' 的 spec 里没有任何零件键',
      recipe + ' 需要至少 1 个 partKey（来自候选零件清单）', { recipe });
  }
  const forbid = (o.forbidRoles || []).map(String);
  const allow = Array.isArray(o.allowedRoles) && o.allowedRoles.length ? o.allowedRoles.map(String) : null;
  const notes = [];
  const resolved = {};
  let unknown = 0, roleBad = 0;
  for (const k of Array.from(new Set(keys))) {
    let raw = null;
    try { raw = await o.partResolver(k); } catch (e) {
      notes.push('partResolver(' + k + ') 抛错：' + String(e && e.message || e).slice(0, 120));
    }
    if (!raw) { unknown++; notes.push('零件不存在：' + k); continue; }
    const role = String(raw.part_role || raw.role || '');
    if (forbid.indexOf(role) >= 0) { roleBad++; notes.push('角色被禁用：' + k + '(' + role + ')'); continue; }
    if (allow && allow.indexOf(role) < 0) { roleBad++; notes.push('角色不在允许集：' + k + '(' + role + ')'); continue; }
    // recipe 自带角色闸：path 只吃路面件，防止"搭路→放整栋楼"（§1.2 根因2）
    if (rule.roles && rule.roles.length && rule.roles.indexOf(role) < 0) {
      roleBad++;
      notes.push('零件角色不适合 ' + recipe + '：' + k + '(' + role + ')，只接受 ' + rule.roles.join('/'));
      continue;
    }
    resolved[k] = raw;
  }
  if (!Object.keys(resolved).length) {
    return fail('RECIPE_ALL_PARTS_UNKNOWN',
      'recipe=' + recipe + ' 的 ' + keys.length + ' 个零件键全部不可用（未知 ' + unknown + ' / 角色不符 ' + roleBad + '）',
      'partKey 必须来自 PARTS 候选清单；' + recipe + ' 只接受角色 ' + (rule.roles || []).join('/') + '；把 PARTS 里合适的键填进 spec',
      { recipe, unknown, roleBad, notes });
  }

  // 4) 归一 spec（只做类型归一，不改语义）
  const normSpec = Object.assign({}, spec);
  if (spec.tile && !Array.isArray(spec.tile)) normSpec.tile = [spec.tile];
  if (spec.width != null) normSpec.width = Number(spec.width) || undefined;

  return { ok: true, recipe, spec: normSpec, partKeys: Object.keys(resolved), notes };
}

module.exports = { validateRecipeBlock, SPEC_RULES, knownSpecs };