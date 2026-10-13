'use strict';
/**
 * candidatePool —— 候选零件池构建（2026-10-13 从 missionPlanner.js 拆出）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 拆分原因：missionPlanner.js 已 765 行，远超 500 行红线；候选池三步逻辑
 * （轮转采样 → LLM 关键词预选 → 过滤/补齐/加权排序）自成一体，是最适合
 * 独立的部分。拆出后 missionPlanner 专注「prompt 组装 + LLM 调用 + 校验」。
 *
 * 三步流程（行为与拆分前逐字节一致，另含 2026-10-13 三项增强）：
 *   ① buildBase()            轮转采样
 *   ② enrichByKeywords()     LLM 提炼委托关键词 → 按词检索合并（失败静默回退）
 *   ③ finalize()             尺寸过滤 + building role 补齐 + 加权排序 + MUST_KEEP 保底
 *
 * 加权优先级（finalize 的 sort）：
 *   1) 关键词命中（委托语义）
 *   2) 坡屋顶件 —— 仅当委托提到坡屋顶/斜顶（2026-10-13 新增，按需加权不误伤现代建筑）
 *   3) 大墙件（h 1.5~4m 且 w≥1.5m 且命名像墙）（2026-10-13：宽度下限治格栅墙）
 *   4) 成套 pack → pack 内 role 种类 → 字典序
 */
const assetSearch = require('../tools/assetSearch');

// 坡屋顶/塔顶命名特征（与 validate.js 的 SLOPE_NAME 保持一致）
const SLOPE_NAME = /roof|slate|tile|spire|gable|pitch|steeple|turret|_top$|^top_/i;
// 正经墙件命名 / 排除装饰边线类
const WALL_HI = /wall|brick|panel|plaster|block|stone|concrete|timber|wood|stucco|adobe/i;
// ★ arch/fence/rail（2026-10-13）：Wall_Arch(2×3×0.064) 名字含 wall 匹配了 WALL_HI，
//   被当"大墙件"排最前 → AI 拿拱形薄片铺主墙，34 件拱洞墙**整栋楼能看穿**。
const NOT_WALL = /gutter|trim|border|edge|corner|detail|deco|cap|sill|frame|arch|fence|rail|picket/i;
// building recipe 必需 role（凑不齐 AI 只能编键名 → 整块丢弃）
const NEED = ['wall', 'door', 'window', 'roof'];
const LIMIT = 24;
// 委托提到坡屋顶时的触发词
const SLOPE_WORDS = /坡屋顶|斜顶|斜屋顶|尖顶|人字顶|斜面顶|瓦顶|pitched|sloped roof/i;

const num = function (v) { const n = Number(v); return isFinite(n) ? n : 0; };
const gridOf = function (it) { return (Array.isArray(it.grid) ? it.grid : []).map(Number); };

/** 尺寸 sanity 过滤（2026-10-11 引入，10-12/10-13 修订，详见各分支注释） */
function shapeBad(it) {
  const g = gridOf(it);
  if (g.length < 3 || !g.every(function (v) { return isFinite(v) && v >= 0; })) return false;
  const minEdge = Math.min(g[0], g[2]);
  const h = g[1];
  if (it.role === 'floor') return h > minEdge + 1e-6;                 // 地板只能是平板
  if (it.role === 'roof') {                                            // 屋顶：平板或坡屋顶二选一
    if (h <= minEdge + 1e-6) return false;
    return !(SLOPE_NAME.test(String(it.partKey || '')) && minEdge >= 1 && h <= 5);
  }
  if (it.role === 'wall') return minEdge > 2.5;                        // 整栋模型（20×28×16）
  if (['door', 'window', 'trim', 'railing'].indexOf(it.role) >= 0) return minEdge > 1.5 || h > 8;
  // 整栋模型被改判成 prop 后仍占候选名额（Building_Large_2 28m、Medium 25m），对
  // building recipe 永远不可用，也不适合散点——超大 prop 直接滤掉腾位置
  if (it.role === 'prop') return Math.max(g[0], g[1], g[2]) > 15;
  return false;
}

/** 大墙件判定：高度合理 + 宽度 ≥1.5m（2026-10-13 加宽度下限）+ 命名像墙 */
function isBigWall(it) {
  if (it.role !== 'wall') return false;
  const g = gridOf(it);
  if (g.length < 3) return false;
  const h = g[1], w = g[0];
  return h >= 1.5 && h <= 4 && w >= 1.5
    && WALL_HI.test(String(it.partKey || '')) && !NOT_WALL.test(String(it.partKey || ''));
}
/** 坡屋顶件判定 */
function isSlopeRoof(it) {
  if (it.role !== 'roof') return false;
  const g = gridOf(it);
  if (g.length < 3) return false;
  const minEdge = Math.min(g[0], g[2]);
  return g[1] > minEdge + 1e-6 && SLOPE_NAME.test(String(it.partKey || '')) && minEdge >= 1 && g[1] <= 5;
}

/** ① 轮转采样基础候选 */
async function buildBase(constraints) {
  return assetSearch.searchParts({
    roles: constraints.allowed_roles,
    forbidRoles: constraints.forbid_roles,
    styleFamily: constraints.style_family,
    limit: LIMIT,
  });
}

/**
 * ② LLM 关键词预选（失败/零命中静默回退，绝不抛错）
 * @param {object} o { providerFallback, provider, mission, constraints, onNote }
 * @returns {{ items: Array, hits: Set, keywords: Array }}
 */
async function enrichByKeywords(o) {
  const out = { items: null, hits: new Set(), keywords: [] };
  const c = o || {};
  if (!c.providerFallback || !c.provider) return out;
  try {
    const kwChat = await c.providerFallback.chatWithFallback({
      messages: [
        { role: 'system', content: '你是零件库检索助手。从建设委托提炼 3~6 个英文检索关键词（库内键名是英文，如 tree/pine/rock/wall/floor/door/fence/table/chair/roof/slate/castle）。只输出 JSON：{"keywords":["..."]}' },
        { role: 'user', content: '建设委托：' + String(c.mission.prompt || '').slice(0, 400) },
      ],
      jsonSchema: c.keywordSchema,
      temperature: 0.1,
      maxTokens: 300,
      purpose: 'tool_select',
      caller: 'world_ai_mission_planner_keywords',
      missionId: String(c.mission.id),
      regionKey: String(c.mission.region_key),
      timeoutMs: 60000,
      retries: 0,
    }, { primary: c.provider });
    const kwParsed = c.parseJson ? c.parseJson(kwChat.content) : null;
    const keywords = kwParsed && Array.isArray(kwParsed.keywords)
      ? kwParsed.keywords.map(function (s) { return String(s).trim(); }).filter(Boolean).slice(0, 6)
      : [];
    if (!keywords.length) return out;
    out.keywords = keywords;
    const merged = new Map();
    // ★ 全部关键词都检索（2026-10-13）：旧写法 `if (merged.size >= 24) break` 会让
    //   先检索的词把名额占满——实测 castle/stone/roof 命中的大多是 prop，轮到 slate 时
    //   已满 24 直接 break，Roof_Slate 系坡屋顶根本进不了池（加权排前也无米之炊）。
    //   截断统一交给 finalize（过滤→补齐→排序→slice 24）。
    for (const k of keywords) {
      const r = await assetSearch.searchParts({
        keyword: k,
        forbidRoles: c.constraints.forbid_roles,
        styleFamily: c.constraints.style_family,
        limit: 12,
      });
      for (const it of (r.items || [])) if (!merged.has(it.partKey)) merged.set(it.partKey, it);
    }
    if (merged.size) {
      out.items = Array.from(merged.values());
      // 命中记录（排序加权用）：此前关键词预选的成果会被"pack 成套度"排序反超
      merged.forEach(function (v, k) { out.hits.add(k); });
    }
  } catch (e) {
    if (c.onNote) c.onNote('关键词预选失败已回退轮转采样：' + String(e.message || e).slice(0, 160));
  }
  return out;
}

/**
 * ③ 收尾：过滤 → 补齐 → 加权排序 → MUST_KEEP 保底
 * @param {object} o { candidates, keywordHits, constraints, prompt, onNote }
 * @returns {{ items: Array, notice: string }}
 */
async function finalize(o) {
  const c = o || {};
  const items = (c.candidates && c.candidates.items) || [];
  const hits = c.keywordHits || new Set();
  const constraints = c.constraints || {};
  const wantSlope = SLOPE_WORDS.test(String(c.prompt || ''));   // 委托提到坡屋顶才加权

  // ── 过滤：先滤后补（顺序错会导致补进来的件又被滤掉，实测"缺失 roof"）──
  let pool = items.filter(function (it) { return !shapeBad(it); });
  if (pool.length >= 8) items.length = 0, Array.prototype.push.apply(items, pool);  // 别把池子滤空

  // ★ 大墙件充足时剔除窄件（2026-10-13）：wall 265 件里 219 件 w<1.5m，
  //   实测 AI 选 building_roof(1.34m 宽) 铺 281 件格栅墙。池内有 ≥3 件大墙件时，
  //   窄件不再进 prompt，AI 无从选错；castle 等没有大墙件的包不受影响。
  const bigWalls = pool.filter(isBigWall);
  if (bigWalls.length >= 3) {
    const onlyBig = pool.filter(function (it) { return it.role !== 'wall' || isBigWall(it); });
    if (onlyBig.length >= 8) {
      pool = onlyBig;
      if (c.onNote) c.onNote('候选池剔除窄墙件 ' + (items.length - pool.length) + ' 件（保留 ' + bigWalls.length + ' 件大墙件）');
    }
  }

  // ── 坡屋顶程序化补搜（2026-10-13）──
  //   委托明确要坡屋顶时，不指望 LLM 提炼出 slate/tile 这类词（实测它只会提炼 "roof"，
  //   而 "roof" 命中的第一件永远是 Roof_2x2 平板）——直接按已知坡屋顶命名补搜，
  //   确定性把 Roof_Slate 系带进池子。
  if (wantSlope && !pool.some(isSlopeRoof)) {
    for (const kw of ['slate', 'tile', 'gable']) {
      const r = await assetSearch.searchParts({
        keyword: kw,
        forbidRoles: constraints.forbid_roles,
        styleFamily: constraints.style_family,
        limit: 6,
      });
      for (const it of (r.items || [])) {
        if (!isSlopeRoof(it) || shapeBad(it)) continue;
        if (!pool.some(function (x) { return x.partKey === it.partKey; })) pool.push(it);
      }
      if (pool.some(isSlopeRoof)) break;
    }
  }

  // ── building 必需 role 定向补齐 ──
  const BUILDING_ROLES = ['wall', 'door', 'window', 'roof', 'column', 'cornice', 'floor', 'railing', 'stairs'];
  const have = new Set(pool.map(function (it) { return it.role; }));
  for (const r of BUILDING_ROLES) {
    if (have.has(r)) continue;
    // roof 多取几件（limit 8）：轮转采样/关键词预选经常只带回平板屋顶，
    // 若只取 3 件大概率全是 Roof_2x2，坡屋顶（Roof_Slate 系）进不了池子，
    // 下方"坡屋顶保底"就成了无米之炊（实测 roof:1 全是平板）。
    const rr = await assetSearch.searchParts({
      roles: [r],
      forbidRoles: constraints.forbid_roles,
      styleFamily: constraints.style_family,
      limit: r === 'roof' ? 8 : 3,
    });
    for (const it of (rr.items || [])) {
      if (shapeBad(it)) continue;
      if (!pool.some(function (x) { return x.partKey === it.partKey; })) pool.push(it);
    }
  }

  // ── 自然类保底（2026-10-14）──
  //   forest/garden recipe 的槽件全在 nature role（全库 273 件，根本没有 tree/plant
  //   role），而轮转采样/关键词预选从不带回它（实测庄园候选池 role 分布无 nature）。
  //   叠加 prompt 门槛表「≥2 棵树必须 forest」后 AI 无米下锅 → 直接放弃种树
  //   （实测庄园复跑树类 0 件）。委托含自然意图词就定向补 nature；补 6 件不挤占
  //   建筑件名额（MUST_KEEP 再兜底保证不被 LIMIT 裁掉）。
  const NATURE_WORDS = /树|林|花|草|绿化|自然|森林|院子|庄园|花园|公园|tree|forest|garden|plant|nature|yard|manor/i;
  const wantNature = NATURE_WORDS.test(String(c.prompt || ''));
  if (wantNature && !pool.some(function (it) { return it.role === 'nature'; })) {
    const rr = await assetSearch.searchParts({
      roles: ['nature'],
      forbidRoles: constraints.forbid_roles,
      styleFamily: constraints.style_family,
      limit: 6,
    });
    for (const it of (rr.items || [])) {
      if (shapeBad(it)) continue;
      if (!pool.some(function (x) { return x.partKey === it.partKey; })) pool.push(it);
    }
  }

  // ── 加权排序 ──
  const packOf = function (it) { return it.pack || it.styleFamily || ''; };
  const packScore = new Map();
  for (const it of pool) {
    const pk = packOf(it);
    if (!packScore.has(pk)) packScore.set(pk, new Set());
    packScore.get(pk).add(it.role);
  }
  const fullPacks = new Set(
    Array.from(packScore.entries()).filter(function (e) { return NEED.every(function (r) { return e[1].has(r); }); }).map(function (e) { return e[0]; })
  );
  pool.sort(function (a, b) {
    // 1) 关键词命中
    const ka = hits.has(a.partKey) ? 1 : 0, kb = hits.has(b.partKey) ? 1 : 0;
    if (ka !== kb) return kb - ka;
    // 2) 坡屋顶件（仅当委托提到坡屋顶；2026-10-13）
    if (wantSlope) {
      const sa = isSlopeRoof(a) ? 1 : 0, sb = isSlopeRoof(b) ? 1 : 0;
      if (sa !== sb) return sb - sa;
    }
    // 3) 大墙件（宽度下限治格栅墙；2026-10-13）
    const ga = isBigWall(a) ? 1 : 0, gb = isBigWall(b) ? 1 : 0;
    if (ga !== gb) return gb - ga;
    // 4) 成套 pack → pack 内 role 种类 → 字典序
    const fa = fullPacks.has(packOf(a)) ? 1 : 0, fb = fullPacks.has(packOf(b)) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const pa = packScore.get(packOf(a)).size, pb = packScore.get(packOf(b)).size;
    if (pa !== pb) return pb - pa;
    return String(a.partKey).localeCompare(String(b.partKey));
  });

  // ── MUST_KEEP 保底：必需 role 每个至少留 1 件；委托要坡屋顶时再保 1 件坡屋顶 ──
  //   （实测：关键词命中 13 个 prop 挤占名额，池里只剩 1 件平板 roof，坡屋顶被挤出前 24
  //    —— 加权排前也没用，件根本不在清单里）
  let final = pool;
  if (pool.length > LIMIT) {
    const mustKeep = [];
    const usedRole = new Set();
    for (const it of pool) {
      if (NEED.indexOf(it.role) >= 0 && !usedRole.has(it.role)) {
        mustKeep.push(it);
        usedRole.add(it.role);
        if (usedRole.size === NEED.length) break;
      }
    }
    // 坡屋顶保底（排序已把坡屋顶排前，这里取排序后第一个坡屋顶件）
    if (wantSlope && !mustKeep.some(isSlopeRoof)) {
      const slope = pool.find(isSlopeRoof);
      if (slope && mustKeep.indexOf(slope) < 0) mustKeep.push(slope);
    }
    // 自然类保底（2026-10-14）：委托含自然意图时保 2 件 nature（forest/garden 槽件），
    // 否则排不出前 24 又被裁（与坡屋顶保底同款问题：件不在清单里，prompt 再怎么说也没用）
    if (wantNature && !mustKeep.some(function (it) { return it.role === 'nature'; })) {
      const nats = pool.filter(function (it) { return it.role === 'nature'; }).slice(0, 2);
      for (const n of nats) if (mustKeep.indexOf(n) < 0) mustKeep.push(n);
    }
    const rest = pool.filter(function (it) { return mustKeep.indexOf(it) < 0; });
    final = mustKeep.concat(rest).slice(0, LIMIT);
  }

  let notice = '';
  if (fullPacks.size) {
    notice = 'building-ready packs: ' + Array.from(fullPacks).slice(0, 3).join(',');
  }
  return { items: final, notice: notice };
}

module.exports = { buildBase, enrichByKeywords, finalize, shapeBad, isBigWall, isSlopeRoof, NEED, LIMIT };