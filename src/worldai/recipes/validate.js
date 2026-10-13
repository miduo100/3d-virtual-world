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
  building: {
    required: ['footprint', 'floors', 'parts'],
    partKeys: (spec) => {
      const p = (spec && spec.parts) || {};
      // ★ 2026-10-12 修既有 bug：原写法 `.filter(k => p[k]).map(String)` 把**槽位名**
      //   （'wall'/'roof'…）当成 partKey 返回，而不是 p[k]。后果：校验与展开全程在查
      //   "碰巧也叫 roof 的零件"，AI 实际填的 partKey 从未被校验 —— 槽位尺寸校验因此
      //   形同虚设（角色模型填 roof 槽位也能过），unknownPart 也永远是 0。
      const keys = ['wall', 'corner', 'door', 'window', 'roof', 'trim', 'balcony']
        .filter((k) => p[k]).map((k) => String(p[k]));
      // ★ interior / subBlocks（2026-10-12）：内部楼板与立柱、子结构各自的 parts
      const IN = (spec && spec.interior) || {};
      if (IN.floor) keys.push(String(IN.floor));
      if (IN.column) keys.push(String(IN.column));
      if (Array.isArray(IN.furniture)) for (const f of IN.furniture) keys.push(String(f));
      for (const sb of (Array.isArray(spec && spec.subBlocks) ? spec.subBlocks : [])) {
        const sp = (sb && sb.parts) || {};
        for (const k of ['wall', 'corner', 'door', 'window', 'roof', 'trim']) if (sp[k]) keys.push(String(sp[k]));
        const si = (sb && sb.interior) || {};
        if (si.floor) keys.push(String(si.floor));
        if (si.column) keys.push(String(si.column));
      }
      return keys;
    },
    roles: ['wall', 'window', 'door', 'roof', 'cornice', 'column', 'floor', 'railing', 'stairs', 'awning'],
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

  // 3.5) ★ 槽位尺寸合理性校验（2026-10-11，2026-10-12 修正）
  //   实测事故：AI 把 Building_Medium_2_001（15.06×25.01×13.06，**整栋楼**）填进 building 的
  //   wall 槽位 —— part_role 确实是 wall（分类器按文件名误判），引擎于是按 grid_h=25 算层高，
  //   3 层楼盖成 0m/25m/50m、屋顶飘在 75.5m。角色闸只管 role 字符串，管不了"这个 role 的尺寸
  //   根本不像个墙"。
  //   ★ 2026-10-12 修正（第一版判据有两处误杀，实测淘汰 roof 176→59 / 66%）：
  //     ① `thin`（最窄边上限）**不能用在 roof/floor** —— 屋顶板本来就是 2×2、4×4 米一块，
  //        Roof_2x2(2×0×2)/Roof_4x4(4×0×4)/Floor_2x2(2×0.1×2) 的 minEdge 是 2/4/2，
  //        全被误判成"整栋模型"。roof/floor 只该查"扁平"（高度 ≤ 最窄边）。
  //     ② 高度下界不能是 0.05 —— Roof_2x2/floor/top 等 12 件 grid_h 记 0（零厚度平板），
  //        它们恰是最标准的屋顶/地板件。下界改为 0（只挡负数）。
  //     ③ wall 的 thin 从 1.5 放宽到 2.5 —— 容纳 wall_corner 系列（2×2.4×2，合法转角件），
  //        同时仍挡得住 Building_Large_2(20.64×28×16.64) 这类整栋模型。
  if (recipe === 'building' && o.sizeCheck !== false) {
    // ★ 槽位-role 对应校验（2026-10-12）：building 的 role 闸门只查"零件 role 在允许集里"，
    //   不查"这个 role 适合这个槽位"。实测 AI 把 Brick_Inset_Window（role=window）填进 wall
    //   槽位 → 整栋楼 120 件玻璃墙、只有 24 件真窗，且 deduped 95（墙和窗同族抢位）。
    const SLOT_ROLES = {
      wall: ['wall'],                       // 墙槽位只收墙件
      window: ['window'],
      door: ['door'],
      roof: ['roof', 'cornice'],            // 屋顶槽位可收屋顶/檐口件
      trim: ['cornice', 'trim', 'railing'],
      corner: ['wall', 'column', 'cornice'],
      railing: ['railing'],
      floor: ['floor'],
    };
    for (const slot of Object.keys(SLOT_ROLES)) {
      const key = (spec.parts || {})[slot];
      if (!key) continue;
      const raw = resolved[String(key)];
      if (!raw) continue;
      const role = String(raw.part_role || raw.role || '');
      if (SLOT_ROLES[slot].indexOf(role) < 0) {
        return fail('RECIPE_PART_ROLE_MISMATCH',
          '槽位 ' + slot + ' 填了 role=' + role + ' 的零件（' + key + '），槽位只接受 ' + SLOT_ROLES[slot].join('/'),
          slot + ' 槽位必须填 ' + SLOT_ROLES[slot].join('/') + ' 角色的零件；'
          + 'PARTS 清单里每个零件都标了 role=，请按 role 选件（如墙件 role=wall、窗件 role=window）',
          { recipe, slot: slot, partRole: role, notes });
      }
      // ★ 主墙不能是拱形/栏杆类薄片（2026-10-13）：Wall_Arch(2×3×0.064) 有拱洞，
      //   拿它铺主墙整栋楼能看穿（实测 34 件拱洞墙）。wall 槽位硬拒这类命名。
      if (slot === 'wall' && /arch|fence|rail|picket/i.test(String(key))) {
        return fail('RECIPE_PART_SHAPE_MISMATCH',
          'wall 槽位填了拱形/栏杆类零件（' + key + '）——有洞，铺出来整栋楼看穿',
          '主墙必须用实心墙板（PARTS 里用途=大墙件——整栋主墙首选 的件）；'
          + '拱形/栏杆件只适合做门廊装饰或阳台栏杆',
          { recipe, slot: slot, notes });
      }
    }
    const SLOT_RULES = {
      wall:    { thin: 2.5, maxH: 8 },
      window:  { thin: 1.5, maxH: 8 },
      door:    { thin: 1.5, maxH: 8 },
      corner:  { thin: 0,   maxH: 8 },              // 0 = 不查薄（角件可以方）
      trim:    { thin: 1.5, maxH: 8 },
      roof:    { thin: 0,   maxH: 8, sloped: true },// 平板 + 坡屋顶两种形态
      floor:   { thin: 0,   maxH: 8, flat: true },  // 地板只能是平板
      railing: { thin: 1.5, maxH: 8 },
    };
    // 坡屋顶/塔顶的命名特征。坡屋顶几何上就该是"高"的（Roof_Slate_Center 2×3×2、
    // tower_square_roof 1×2.01×1），用扁平判据会把它们和角色模型一起误杀 ——
    // 后果是 castle/fantasy 包只能用 downtown 的现代平板屋顶，风格出不来。
    // 但**不能只看名字**：cliff_top_rock（岩石）也含 top。故同时要求 minEdge≥1m。
    const SLOPE_NAME = /roof|slate|tile|spire|gable|pitch|steeple|turret|_top$|^top_/i;
    const parts = (spec && spec.parts) || {};
    const bad = [];
    for (const slot of Object.keys(SLOT_RULES)) {
      const key = parts[slot];
      if (!key) continue;
      const raw = resolved[String(key)];
      if (!raw) continue;                                   // 未知件已在上面记账
      const g = Array.isArray(raw.grid) ? raw.grid.map(Number) : [Number(raw.grid_w) || 1, Number(raw.grid_h) || 1, Number(raw.grid_d) || 1];
      const R = SLOT_RULES[slot];
      const minEdge = Math.min(g[0], g[2]);
      const h = g[1];
      const why = [];
      if (R.thin > 0 && minEdge > R.thin) {
        why.push('最窄边 ' + minEdge.toFixed(2) + 'm > ' + R.thin + 'm（不像' + slot + '件，更像整栋模型）');
      }
      // 扁平/坡屋顶判据：
      //   · 平板屋顶/地板：高度不得超过自身最窄边（Roof_2x2 是 2×0×2，合法）
      //   · 坡屋顶/塔顶：允许 h > minEdge，但要求 ① 命名像屋顶 ② minEdge ≥1m（排除 cliff_top_rock 这类岩石）
      //   实例：Characters_Captain_Barbarossa(1.97×1.85×1.05) 被误标 role=roof，
      //         minEdge=1.05 会漏过"薄"判定，名字也不像屋顶 → 仍被拒。
      if (R.flat && h > minEdge + 1e-6) {
        why.push('高度 ' + h.toFixed(2) + 'm ≥ 最窄边 ' + minEdge.toFixed(2) + 'm（不是平板，不像' + slot + '）');
      } else if (R.sloped && h > minEdge + 1e-6) {
        const looksRoof = SLOPE_NAME.test(String(key));
        if (!looksRoof) why.push('高度 ' + h.toFixed(2) + 'm ≥ 最窄边 ' + minEdge.toFixed(2) + 'm 且命名不像屋顶（不是平板也不像坡屋顶）');
        else if (minEdge < 1) why.push('最窄边 ' + minEdge.toFixed(2) + 'm < 1m（不像屋顶/塔顶，更像立柱或杂物）');
        else if (h > 5) why.push('高度 ' + h.toFixed(2) + 'm > 5m（不像屋顶，更像塔身或整栋）');
      }
      // 下界 0：零厚度平板（grid_h=0）合法；只挡负数和超高
      if (h < 0 || h > R.maxH) why.push('高度 ' + h.toFixed(2) + 'm 超出 0~' + R.maxH + 'm');
      if (why.length) bad.push(slot + '=' + key + '（' + g.map(function (v) { return v.toFixed(2); }).join('×') + '）：' + why.join('；'));
    }
    if (bad.length) {
      return fail('RECIPE_PART_SHAPE_MISMATCH',
        'building 槽位零件尺寸不像对应构件：' + bad.join(' | '),
        'wall/window/door/trim 槽位须放"薄"件（最窄边 ≤2.5m，高度 0~8m）；roof/floor 须放"平板"'
        + '（高度 ≤ 自身最窄边，2×2、4×4 的屋顶板完全合法）；corner 不限。'
        + 'PARTS 清单里 Building_Large_2 / Building_Medium_2_001 这类是【整栋建筑模型】，不能当墙件/屋顶件用；'
        + '请改用同 pack 里的 wall / roof 专件，或改用普通 parts 模式整栋摆放',
        { recipe, bad: bad, notes });
    }
  }

  // 4) 归一 spec（只做类型归一，不改语义）
  const normSpec = Object.assign({}, spec);
  if (spec.tile && !Array.isArray(spec.tile)) normSpec.tile = [spec.tile];
  if (spec.width != null) normSpec.width = Number(spec.width) || undefined;

  return { ok: true, recipe, spec: normSpec, partKeys: Object.keys(resolved), notes };
}

module.exports = { validateRecipeBlock, SPEC_RULES, knownSpecs };