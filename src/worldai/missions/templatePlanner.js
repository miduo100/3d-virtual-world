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
      + '"roads":[{"x":0,"z":0,"width":0,"depth":0}],"props":[{"partKey":"键","x":0,"z":0,"count":1,"width":0,"depth":0}]}',
    `区域左上角 (${x0}, ${z0})，宽 ${w}m 深 ${d}m。x/z 是世界坐标（米），须在区域内且距边界 ≥2m。`,
    '模板（id(件数)）：',
    catalogue,
    '1. facing 取 0/90/180/270（0=门朝−Z，90=+X，180=+Z，270=−X）；街道两侧的房子面对面。',
    '2. 建筑按「占地+2m 出檐」占位，相邻中心距 ≥(两者宽和/2+3)m，否则互相穿插。',
    '3. roads 只给矩形范围，铺装块数由引擎算；props 给一块矩形+数量，引擎确定性散布。',
    '4. 禁止编造模板 id / partKey。' + (budget > 0 ? `总件数（含铺装）≤${budget}。` : ''),
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

  // roads：矩形铺装（块数按 1m 砖估，只有上限意义）
  (Array.isArray(it.roads) ? it.roads : []).forEach((r, i) => {
    const x = num(r && r.x, NaN), z = num(r && r.z, NaN);
    const w = num(r && r.width, 0), d = num(r && r.depth, 0);
    if (!isFinite(x) || !isFinite(z) || !(w > 0) || !(d > 0)) {
      return;   // 静默丢弃无效道路项（道路不是主体，不值得整条打回）
    }
    const cw = Math.min(w, maxX - minX), cd = Math.min(d, maxZ - minZ);
    if (x - cw / 2 < minX || x + cw / 2 > maxX || z - cd / 2 < minZ || z + cd / 2 > maxZ) return;
    out.roads.push({ x, z, width: cw, depth: cd });
    pieces += Math.round(cw) * Math.round(cd);
  });

  // ★ 路不能压到房子（2026-11-07 真调用实测抓到）：模型把 4m 宽的路放在距房 3m 处，
  //   中心距够、但路的半宽让矩形插进了房子 2m —— 只算中心距是拦不住的，必须按矩形相交。
  for (let i = 0; i < out.roads.length; i++) {
    const r = out.roads[i];
    const rx0 = r.x - r.width / 2, rx1 = r.x + r.width / 2;
    const rz0 = r.z - r.depth / 2, rz1 = r.z + r.depth / 2;
    for (const p of placed) {
      const bx0 = p.x - p.halfW + 1, bx1 = p.x + p.halfW - 1;   // 出檐余量里那 1m 不算房子实体
      const bz0 = p.z - p.halfD + 1, bz1 = p.z + p.halfD - 1;
      if (rx0 < bx1 && rx1 > bx0 && rz0 < bz1 && rz1 > bz0) {
        return {
          ok: false, code: 'ROAD_HITS_BUILDING',
          reason: `roads[${i}]（${r.width}×${r.depth}m，中心 ${r.x},${r.z}）压到了 buildings[${p.i}] 的房子实体上`
            + '——路要么远离房子，要么缩短到房子边上为止',
          hints: { road: { x: r.x, z: r.z, width: r.width, depth: r.depth }, building: { x: p.x, z: p.z } },
        };
      }
    }
  }

  // props：范围散布
  (Array.isArray(it.props) ? it.props : []).forEach((p) => {
    const key = String((p && p.partKey) || '').trim();
    const x = num(p && p.x, NaN), z = num(p && p.z, NaN);
    if (!key || !isFinite(x) || !isFinite(z)) return;
    out.props.push({
      partKey: key,
      x, z,
      count: Math.max(1, Math.round(num(p && p.count, 1))),
      width: Math.max(0.2, num(p && p.width, 2)),
      depth: Math.max(0.2, num(p && p.depth, 2)),
    });
    pieces += Math.max(1, Math.round(num(p && p.count, 1)));
  });

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
  for (let round = 1; round <= maxRounds; round++) {
    const content = await chat(messages);
    const intent = parseIntent(content);
    if (!intent) {
      lastErr = { ok: false, code: 'INTENT_UNPARSEABLE', reason: '模型没输出合法 JSON' };
      messages.push({ role: 'assistant', content: String(content || '').slice(0, 2000) });
      messages.push({ role: 'user', content: '上一条不是合法 JSON，请只输出契约要求的 JSON 对象。' });
      continue;
    }
    let v;
    try {
      v = validateIntent(intent, region, { maxObjects });
    } catch (e) {
      v = { ok: false, code: 'VALIDATE_THREW', reason: String((e && e.message) || e) };
    }
    if (v.ok) return { ok: true, rounds: round, plan: v.plan, stats: v.stats, contractTokens: contract.tokens };
    lastErr = v;
    // 把"哪里不合法 + 可行范围"喂回去，让下一轮改对（这是失败率能不能降下来的关键）
    messages.push({ role: 'assistant', content: String(content || '').slice(0, 2000) });
    messages.push({
      role: 'user',
      content: '上一版被拒：' + v.code + ' — ' + v.reason
        + (v.hints ? '\n可用信息：' + JSON.stringify(v.hints) : '')
        + '\n请按契约修正后重新输出 JSON。',
    });
  }
  return Object.assign({ ok: false, rounds: maxRounds, contractTokens: contract.tokens }, lastErr || {});
}

module.exports = { buildContract, validateIntent, parseIntent, planTemplates, FACINGS };
