/**
 * templatePlanner —— 「模板契约」规划器（M1-7）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么要新写一个，而不是改 missionPlanner：
 *   现有 plan() 的契约是「零件清单 + recipe 骨架」，LLM 要逐字记住 partKey、
 *   手写 footprint 多边形、还得理解 fence/forest/garden/path 五个 recipe 的 spec。
 *   那套契约 3230 token，实测 plan 失败率约 11%。
 *   而工具层已经有 build_from_template / pave / scatter 了 —— 只要 LLM 说
 *   「哪个模板、放哪、朝哪」，坐标和件数全部由代码算。
 *
 *   ★ 这是**并行实现**，不改 missionPlanner：legacy 委托仍走旧契约，互不影响。
 *     等模板契约跑顺、失败率实测比旧的低，再决定要不要切默认。
 *
 * 分工（与 scripts/village_from_intent.js 一致）：
 *   LLM 只输出「意图」；坐标合法性、件数预算、模板是否存在，全由 validateIntent 兜住。
 */
'use strict';

const registry = require('../assembly/templateRegistry');
const { estimateTokens } = require('../llm/tokenEstimate');

/** 合法朝向（度）。0 = 门朝 −Z（求解器的 south 边） */
const FACINGS = [0, 90, 180, 270];

/**
 * 生成「模板契约」文本。刻意保持短：模板清单按风格压成一行，规则只留会被违反的那几条。
 * @param {object} region 区域行（含 bounds）
 * @param {object} [opts] { maxObjects }
 * @returns {{text:string, tokens:number, templates:string[]}}
 */
function buildContract(region, opts) {
  const o = opts || {};
  const b = (region && region.bounds) || {};
  const x0 = Number(b.x) || 0, z0 = Number(b.z) || 0;
  const w = Number(b.width) || 0, d = Number(b.depth) || 0;

  // 模板按风格压行：id(件数) —— 让 LLM 一眼看到"有哪些、多大、多少件"
  const byStyle = {};
  registry.listTemplates().forEach((t) => {
    const key = t.style || 'misc';
    byStyle[key] = byStyle[key] || [];
    byStyle[key].push(t.id + '(' + (t.pieceCount || 0) + '件)');
  });
  const catalogue = Object.keys(byStyle)
    .map((s) => '  ' + s + ': ' + byStyle[s].join(' '))
    .join('\n');

  const budget = Number(o.maxObjects) > 0 ? Number(o.maxObjects) : 0;
  const lines = [
    '【模板契约】只输出 JSON：',
    '{"style":"","summary":"","buildings":[{"template":"id","x":0,"z":0,"facing":0}],'
      + '"props":[{"partKey":"键","x":0,"z":0,"count":1,"width":0,"depth":0}]}',
    `区域左上角 (${x0}, ${z0})，宽 ${w}m 深 ${d}m。x/z 是世界坐标（米），须在区域内且距边界 ≥2m。`,
    '模板（id(件数)）：',
    catalogue,
    '1. facing 取 0/90/180/270（0=门朝−Z，90=+X，180=+Z，270=−X）；街道两侧的房子面对面。',
    '2. 建筑按「占地+2m 出檐」占位，相邻中心距 ≥(两者宽和/2+3)m，否则互相穿插。',
    '3. **不要给 roads**：街道由引擎按房屋排布自动生成（位置、长度、宽度全部引擎算）。',
    '4. props 的 partKey 只能取：tree_default tree_cone tree_blocks plant_bush flower_redA flower_yellowA rock_smallA log（别的键不存在）。',
    '5. 房屋要成排（同一排的 z 相同或相近），把排与排之间留 8~20m 当街——引擎会在那里铺街。',
    '6. 禁止编造模板 id / partKey。' + (budget > 0 ? `总件数（含铺装）≤${budget}。` : ''),
    '【村庄骨架示例】设区域中心 (cx,cz)=' + ((x0 + w / 2) | 0) + ',' + ((z0 + d / 2) | 0) + '，沿 X 轴建街：',
    '{"buildings":[{"template":"medieval_6x10","x":cx-20,"z":cz-7,"facing":180},'
      + '{"template":"medieval_8x8","x":cx,"z":cz-8,"facing":180},'
      + '{"template":"medieval_6x10","x":cx-20,"z":cz+7,"facing":0},'
      + '{"template":"medieval_8x8","x":cx,"z":cz+8,"facing":0}]}',
    '↑北排 z<cz、facing180；南排 z>cz、facing0；同排间距≥14m。照此加减栋数（街道会自动铺在两排之间）。',
  ];
  const text = lines.join('\n');
  return {
    text,
    tokens: estimateTokens(text),
    templates: registry.listTemplates().map((t) => t.id),
  };
}

/** 数值容错：接受 "180" / 180.0 / 缺省 */
function num(v, dflt) {
  const n = Number(v);
  return isFinite(n) ? n : dflt;
}

/**
 * 校验 LLM 输出的意图。
 * 不做「猜你想要」的修补：模板不存在、朝向非法、装不下、超预算 —— 一律明确报错，
 * 并把可行的替代（候选模板 / 可用范围）带回去，让下一轮 LLM 能改对。
 *
 * @param {object} intent LLM 的 JSON
 * @param {object} region 区域行
 * @param {object} [opts] { maxObjects }
 * @returns {{ok:true, plan:object, stats:object} | {ok:false, code:string, reason:string, hints?:object}}
 */
function validateIntent(intent, region, opts) {
  const o = opts || {};
  const b = (region && region.bounds) || {};
  const minX = num(b.minX, num(b.x, 0));
  const minZ = num(b.minZ, num(b.z, 0));
  const maxX = num(b.maxX, minX + num(b.width, 0));
  const maxZ = num(b.maxZ, minZ + num(b.depth, 0));
  const EDGE = 2;   // 距边界最小距离（契约里承诺过的）

  const it = intent || {};
  const buildings = Array.isArray(it.buildings) ? it.buildings : [];
  if (!buildings.length) {
    return { ok: false, code: 'INTENT_EMPTY', reason: 'buildings 为空：至少给一栋（只写 style/summary 不算方案）' };
  }

  const all = registry.listTemplates();
  const ids = all.map((t) => t.id);
  const styleOf = {};
  all.forEach((t) => { styleOf[t.id] = t.style; });

  const out = { style: String(it.style || ''), summary: String(it.summary || ''), buildings: [], roads: [], props: [] };
  const notes = [];   // 「代码替你修了什么」——不静默改，让人能看见
  const r3 = (v) => Math.round(Number(v) * 1000) / 1000;
  let pieces = 0;
  const placed = [];   // 已接受的建筑占地，用于互撞检测

  for (let i = 0; i < buildings.length; i++) {
    const raw = buildings[i] || {};
    const id = String(raw.template || '').trim();
    if (!id) return { ok: false, code: 'BUILDING_NO_TEMPLATE', reason: `buildings[${i}] 缺 template` };
    if (ids.indexOf(id) < 0) {
      // 候选：先按 LLM 自己声明的风格筛；声明缺失/风格也编了，就给全量前 8 个
      //   （2026-11-07 实测：风格未知时若只按 styleOf[id] 过滤，候选会是空数组 ——
      //    对 LLM 等于"没有任何提示"，下一轮只能继续瞎猜）
      const wantStyle = String(it.style || '').trim();
      const styleKnown = wantStyle && all.some((t) => t.style === wantStyle);
      const sameStyle = styleKnown ? all.filter((t) => t.style === wantStyle) : all;
      return {
        ok: false, code: 'TEMPLATE_UNKNOWN',
        reason: `buildings[${i}] 的模板「${id}」不存在。可用：${ids.slice(0, 12).join(', ')} …`,
        hints: { availableTemplates: ids, sameStyle: sameStyle.map((t) => t.id).slice(0, 8) },
      };
    }
    const t = registry.getTemplate(id);
    const facing = raw.facing == null ? 0 : num(raw.facing, NaN);
    if (FACINGS.indexOf(facing) < 0) {
      return { ok: false, code: 'FACING_INVALID', reason: `buildings[${i}].facing=${raw.facing} 非法，只接受 0/90/180/270` };
    }
    const x = num(raw.x, NaN), z = num(raw.z, NaN);
    if (!isFinite(x) || !isFinite(z)) {
      return { ok: false, code: 'ANCHOR_INVALID', reason: `buildings[${i}] 的 x/z 必须是数字` };
    }
    // 旋转后的半宽半深 + 1m 出檐余量
    const swap = Math.abs(Math.round(facing / 90) % 2) === 1;
    const halfW = (swap ? t.dimensions.depth : t.dimensions.width) / 2 + 1;
    const halfD = (swap ? t.dimensions.width : t.dimensions.depth) / 2 + 1;
    if (x - halfW < minX + EDGE || x + halfW > maxX - EDGE || z - halfD < minZ + EDGE || z + halfD > maxZ - EDGE) {
      return {
        ok: false, code: 'BUILDING_OUT_OF_BOUNDS',
        reason: `buildings[${i}]（${id}，facing=${facing}）含出檐需要 ${(halfW * 2).toFixed(0)}×${(halfD * 2).toFixed(0)}m，`
          + `在 (${x},${z}) 放不下（区域可用范围 ${minX + EDGE}~${maxX - EDGE} / ${minZ + EDGE}~${maxZ - EDGE}）`,
        hints: { need: { width: halfW * 2, depth: halfD * 2 }, allowance: { x: [minX + EDGE, maxX - EDGE], z: [minZ + EDGE, maxZ - EDGE] } },
      };
    }
    // 互撞：只拦"真的重叠"，留 1m 容差（契约要求 3m 间距，这里不苛求）
    for (const p of placed) {
      if (Math.abs(p.x - x) < (p.halfW + halfW - 1) && Math.abs(p.z - z) < (p.halfD + halfD - 1)) {
        return {
          ok: false, code: 'BUILDING_OVERLAP',
          reason: `buildings[${i}] 与 buildings[${p.i}] 重叠（中心距 ${Math.hypot(p.x - x, p.z - z).toFixed(1)}m 太近）`,
        };
      }
    }
    placed.push({ i, x, z, halfW, halfD });
    pieces += Number((t.metrics && t.metrics.pieceCount) || 0);
    out.buildings.push({ template: id, x, z, facing });
  }

  // ── 街道：完全由代码生成（2026-11-07 结构性决定）───────────────────
  //   三次 20 次统计里 **100% 的失败都在"路与房子的几何关系"**（ROAD_HITS_BUILDING）；
  //   给可操作数字 → 85%，自动推导 → 80%。结论不是"再修一次"，而是让这个失败类别
  //   **在构造上不可能发生**：模型不再提供 roads，街道位置一律由代码按房屋排布算，
  //   并用所有房子的 AABB 逐个校验，冲突就换下一条候选带。
  if (Array.isArray(it.roads) && it.roads.length) {
    notes.push('模型给的 roads 已忽略：街道位置由代码按房屋排布生成（避免路压房）');
  }

  /** 房子实体 AABB（出檐那 1m 不算实体） */
  const solidOf = (p) => ({
    x0: p.x - p.halfW + 1, x1: p.x + p.halfW - 1,
    z0: p.z - p.halfD + 1, z1: p.z + p.halfD - 1,
  });
  const hitsAny = (r) => placed.some((p) => {
    const s0 = solidOf(p);
    return (r.x - r.width / 2) < s0.x1 && (r.x + r.width / 2) > s0.x0
      && (r.z - r.depth / 2) < s0.z1 && (r.z + r.depth / 2) > s0.z0;
  });

  if (placed.length >= 2) {
    const zsSorted = placed.map((p) => p.z).sort((a, b) => a - b);
    const xsAll = placed.map((p) => p.x);
    const maxHalfD = Math.max.apply(null, placed.map((p) => p.halfD));
    const spanX = (Math.max.apply(null, xsAll) - Math.min.apply(null, xsAll)) + 10;
    const streetW = Math.max(10, Math.min(spanX, (maxX - minX) - 6));
    const cx = Math.max(minX + streetW / 2 + 2, Math.min(maxX - streetW / 2 - 2,
      (Math.min.apply(null, xsAll) + Math.max.apply(null, xsAll)) / 2));

    const cands = [];
    let gap = null;
    for (let i = 1; i < zsSorted.length; i++) {
      const g = zsSorted[i] - zsSorted[i - 1];
      if (g >= 6 && (!gap || g > gap.g)) gap = { g, mid: (zsSorted[i - 1] + zsSorted[i]) / 2 };
    }
    if (gap) cands.push(gap.mid);
    cands.push(Math.max.apply(null, zsSorted) + maxHalfD + 3);
    cands.push(Math.min.apply(null, zsSorted) - maxHalfD - 3);
    for (let z = minZ + 3; z <= maxZ - 3; z += 1) cands.push(z);

    const DEPTH = 5;
    let street = null;
    for (const z of cands) {
      if (z - DEPTH / 2 < minZ || z + DEPTH / 2 > maxZ) continue;
      const r = { x: r3(cx), z: r3(z), width: r3(streetW), depth: DEPTH };
      if (!hitsAny(r)) { street = r; break; }
    }
    if (street) {
      out.roads.push(street);
      pieces += Math.round(street.width) * Math.round(street.depth);
      notes.push('街道由代码生成：X 向 ' + r3(street.width) + '×' + r3(street.depth)
        + 'm @' + r3(street.x) + ',' + r3(street.z)
        + (gap && Math.abs(street.z - gap.mid) < 1e-6 ? '（落在两排房之间的间隙）' : '（置于房群外侧）'));
    } else {
      notes.push('区域被房子塞满，找不到 5m 空带 → 本村不铺街（不报错）');
    }
  }

  // props：范围散布
  // ★ 注意：下面用 forEach，回调里的 return 只退出这一次迭代、不会退出 validateIntent。
  //   所以错误必须先收集到 propErr，循环结束后再抛（2026-11-07 实测：越界道具被静默丢弃）。
  let propErr = null;
  (Array.isArray(it.props) ? it.props : []).forEach((p) => {
    if (propErr) return;
    const key = String((p && p.partKey) || '').trim();
    let x = num(p && p.x, NaN), z = num(p && p.z, NaN);
    if (!key || !isFinite(x) || !isFinite(z)) return;
    let pw = Math.max(0.2, num(p && p.width, 2));
    let pd = Math.max(0.2, num(p && p.depth, 2));
    // 同路一样：越界的散布矩形裁到区域内（植被放哪不改变设计意图）
    if (x - pw / 2 < minX || x + pw / 2 > maxX || z - pd / 2 < minZ || z + pd / 2 > maxZ) {
      const nx0 = Math.max(minX, x - pw / 2), nx1 = Math.min(maxX, x + pw / 2);
      const nz0 = Math.max(minZ, z - pd / 2), nz1 = Math.min(maxZ, z + pd / 2);
      if (nx1 - nx0 < 0.5 || nz1 - nz0 < 0.5) return;   // 裁没了就不放（不报错）
      notes.push(`props（${key}）越界，散布范围裁到 ${r3(nx1 - nx0)}×${r3(nz1 - nz0)}m`);
      x = r3((nx0 + nx1) / 2); z = r3((nz0 + nz1) / 2);
      pw = r3(nx1 - nx0); pd = r3(nz1 - nz0);
    }
    out.props.push({
      partKey: key,
      x, z,
      count: Math.max(1, Math.round(num(p && p.count, 1))),
      width: pw,
      depth: pd,
    });
    pieces += Math.max(1, Math.round(num(p && p.count, 1)));
  });

  if (propErr) return propErr;

  const maxObjects = num(o.maxObjects, 0);
  if (maxObjects > 0 && pieces > maxObjects) {
    return {
      ok: false, code: 'INTENT_EXCEEDS_BUDGET',
      reason: `按意图估算约 ${pieces} 件，超过预算 ${maxObjects}（铺装最占件数，缩小 roads 或减少建筑）`,
      hints: { pieces, maxObjects },
    };
  }

  return {
    ok: true,
    plan: out,
    notes,
    stats: { buildings: out.buildings.length, roads: out.roads.length, props: out.props.length, pieces },
  };
}

/** 从模型输出里抠 JSON（容忍围栏与前后解释） */
function parseIntent(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}

/**
 * 调一次模型拿意图（真 LLM 路径）。
 * ★ o.chat 可注入：验收脚本用它跑"假模型"，所以这条路径的逻辑（解析/校验/重试）
 *   在没有网络、不花 token 的情况下也能被测到。真调模型的行为仍标注为待实测。
 *
 * @param {object} mission
 * @param {object} region
 * @param {object} opts { chat, provider, maxObjects, maxRounds }
 */
async function planTemplates(mission, region, opts) {
  const o = opts || {};
  const maxObjects = num(o.maxObjects, num((mission.constraints || {}).max_objects, 0));
  const contract = buildContract(region, { maxObjects });
  const maxRounds = Math.max(1, num(o.maxRounds, 2));

  const chat = o.chat || (async (messages) => {
    const providerRouter = require('../llm/providerRouter');
    const providerFallback = require('../llm/providerFallback');
    const provider = o.provider || (await providerRouter.resolve('plan', { worldId: mission.world_id })).provider;
    if (!provider) throw new Error('没有可用 provider');
    const r = await providerFallback.chatWithFallback({
      messages,
      temperature: 0.2,
      maxTokens: 2000,
      timeoutMs: 120000,
      purpose: 'plan',
      caller: 'world_ai_template_planner',
      missionId: String(mission.id),
      regionKey: String(mission.region_key),
      retries: 1,
    }, { primary: provider });
    return r.content;
  });

  const messages = [
    { role: 'system', content: '你是虚拟世界里的建造规划器。只做决策，不算坐标细节，不编造 id。' },
    { role: 'user', content: '【委托】' + String(mission.prompt || mission.title || '') + '\n\n' + contract.text },
  ];

  let lastErr = null;
  let lastRaw = null;   // 失败时把模型最后一版原样带回，便于诊断（不看原文只能瞎猜）
  for (let round = 1; round <= maxRounds; round++) {
    const content = await chat(messages);
    lastRaw = String(content || '').slice(0, 1500);
    const intent = parseIntent(content);
    if (!intent) {
      lastErr = { ok: false, code: 'INTENT_UNPARSEABLE', reason: '模型没输出合法 JSON' };
      messages.push({ role: 'assistant', content: String(content || '').slice(0, 2000) });
      messages.push({ role: 'user', content: '上一条不是合法 JSON，请只输出契约要求的 JSON 对象。' });
      continue;
    }
    let v;
    let lastIntent = null;
    try {
      lastIntent = JSON.stringify(intent).slice(0, 1600);   // 失败时带回去，便于复现（别靠猜）
      v = validateIntent(intent, region, { maxObjects });
    } catch (e) {
      v = { ok: false, code: 'VALIDATE_THREW', reason: String((e && e.message) || e) };
    }
    if (v.ok) return { ok: true, rounds: round, plan: v.plan, stats: v.stats, contractTokens: contract.tokens };
    lastErr = v;
    lastErr.lastIntent = lastIntent;
    // 把"哪里不合法 + 可行范围"喂回去，让下一轮改对（这是失败率能不能降下来的关键）
    messages.push({ role: 'assistant', content: String(content || '').slice(0, 2000) });
    messages.push({
      role: 'user',
      content: '上一版被拒：' + v.code + ' — ' + v.reason
        + (v.hints ? '\n可用信息：' + JSON.stringify(v.hints) : '')
        + '\n请按契约修正后重新输出 JSON。',
    });
  }
  return Object.assign({ ok: false, rounds: maxRounds, contractTokens: contract.tokens, lastRaw }, lastErr || {});
}

module.exports = { buildContract, validateIntent, parseIntent, planTemplates, FACINGS };
