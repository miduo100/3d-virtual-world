/**
 * missionPlanner —— prompt → 布局提案（Phase 3.5-2 · 判据 P35-13/13b/10）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 3.5 文件清单 + §H.9（装配契约）+ §H.10（用途分工）+ §F（Builder Pipeline）。
 *
 * ★ 三条纪律：
 *   1) **prompt 必须经 llm/promptBuilder 产出**（§H.9.5 P1-12 的后半句），本文件不许裸拼模板；
 *   2) **坐标最终决定权不在 LLM**：LLM 只给块与零件的**相对偏移**（anchor/part 的 dx,dz），
 *      绝对坐标由 missionRunner 按 gridsnap 吸附后决定（§Phase 3.5 清单原文）；
 *   3) **预算查表不查内存**：maxLlmCalls 用 `SELECT count(*) FROM ai_call_log WHERE mission_id=$1`
 *      （P35-10★：内存计数器进程重启即清零，等于没有预算）。
 *
 * 用途分工（§H.10.3）：本文件只碰 purpose='plan'；tool_select 阶段留到 Phase 4 的 function calling。
 */
'use strict';

const { query } = require('../../database/db');
const llmClient = require('../../services/llmClient');
const promptBuilder = require('../llm/promptBuilder');
const providerRouter = require('../llm/providerRouter');
const providerFallback = require('../llm/providerFallback'); // 3.5-3 P35-22：跨厂商兜底
const assetSearch = require('../tools/assetSearch');
const boundsGuard = require('../regions/boundsGuard');

const MAX_ROUNDS = 2;

/** LLM 输出的 JSON 结构（约束输出，别让它自由发挥） */
const PLAN_SCHEMA = {
  name: 'build_plan',
  schema: {
    type: 'object',
    properties: {
      style: { type: 'string' },
      summary: { type: 'string' },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string' },
            footprint: { type: 'object', properties: { w: { type: 'number' }, d: { type: 'number' } } },
            anchor: { type: 'object', properties: { dx: { type: 'number' }, dz: { type: 'number' } } },
            parts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  partKey: { type: 'string' },
                  dx: { type: 'number' }, dz: { type: 'number' },
                  ry: { type: 'number' }, level: { type: 'number' },
                },
                required: ['partKey'],
              },
            },
          },
          required: ['kind', 'parts'],
        },
      },
    },
    required: ['blocks'],
  },
};
/** 委托已用掉的 LLM 次数（**查表**，重启安全 —— 判据 P35-10） */
async function countLlmCalls(missionId) {
  const res = await query(
    `SELECT count(*)::int AS n FROM ai_call_log WHERE mission_id = $1`,
    [String(missionId)]
  );
  return res.rows[0].n;
}

/** 区域内已有对象（给 LLM 看，避免它把楼盖在现有建筑上） */
async function regionSnapshot(region) {
  const rows = await boundsGuard.loadObstacles(region.bounds, { pad: 8 });
  const b = region.bounds || {};
  return {
    name: region.name,
    regionName: region.region_key,
    regionKey: region.region_key,
    bounds: b,
    rules: [],
    stats: { objectsInRegion: rows.length, areaM2: Math.round((b.width || 0) * (b.depth || 0)) },
    objects: rows.slice(0, 120).map((r) => ({
      id: r.id, name: r.name, type: r.type, distance: 0,
      description: (r.origin || 'human') === 'ai' ? 'AI 之前建的资产' : '管理员手建资产（不可触碰）',
    })),
  };
}

/** 校验并归一 LLM 产物：非法 partKey / 禁用 role 一律剔除；超预算截断（P35-9） */
async function validatePlan(raw, constraints) {
  const c = constraints || {};
  const allowed = Array.isArray(c.allowed_roles) ? c.allowed_roles.map(String) : null;
  const forbid = Array.isArray(c.forbid_roles) ? c.forbid_roles.map(String) : [];
  const maxObjects = Number(c.max_objects) > 0 ? Number(c.max_objects) : 120;
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const kept = [];
  // ★ 预算计数单位是**零件**，不是块（判据 P35-9：maxObjects=10 而布局 30 件 → 截断到 10 件）
  let placedParts = 0;
  const dropped = { unknownPart: 0, roleNotAllowed: 0, roleForbidden: 0, overBudget: 0 };
  for (const b of blocks) {
    const parts = [];
    for (const p of (Array.isArray(b.parts) ? b.parts : [])) {
      if (!p || !p.partKey) { dropped.unknownPart++; continue; }
      const part = await assetSearch.getPart(p.partKey);
      if (!part) { dropped.unknownPart++; continue; }
      if (forbid.indexOf(String(part.part_role)) >= 0) { dropped.roleForbidden++; continue; }
      if (allowed && allowed.indexOf(String(part.part_role)) < 0) { dropped.roleNotAllowed++; continue; }
      if (placedParts >= maxObjects) { dropped.overBudget++; continue; } // 截断不报错（P35-9）
      placedParts++;
      parts.push({
        partKey: part.part_key, role: part.part_role,
        dx: Number(p.dx) || 0, dz: Number(p.dz) || 0,
        ry: Number(p.ry) || 0, level: Number(p.level) || 0,
        grid: [part.grid_w || 1, part.grid_h || 1, part.grid_d || 1],
        modelPath: part.model_path,
      });
    }
    if (!parts.length) continue;
    kept.push({
      kind: String(b.kind || 'block'),
      footprint: { w: Number(b.footprint && b.footprint.w) || 0, d: Number(b.footprint && b.footprint.d) || 0 },
      anchor: { dx: Number(b.anchor && b.anchor.dx) || 0, dz: Number(b.anchor && b.anchor.dz) || 0 },
      parts,
    });
  }
  return {
    plan: { style: raw.style || null, summary: raw.summary || null, blocks: kept },
    stats: { blocks: kept.length, parts: kept.reduce((s, b) => s + b.parts.length, 0), dropped },
    truncated: dropped.overBudget > 0,
  };
}
/**
 * 生成布局提案。
 * @param {object} mission world_build_missions 行
 * @param {object} region  world_regions 行
 * @param {object} opts { provider?, worldId?, injectPlan?（测试用：注入固定 plan 走"注入路径"验收）, maxRounds? }
 * @returns {Promise<{ok, plan?, stats?, rounds?, llmCalls?, code?, reason?}>}
 */
async function plan(mission, region, opts) {
  const o = opts || {};
  const constraints = mission.constraints || {};
  const budget = mission.budget || {};
  const worldId = o.worldId || mission.world_id;

  // 0) 注入路径（欠费/不可用时的验收与演练路径，§Phase 3.5「不得为绕过欠费实现程序化兜底」的反面：这里只是把固定 plan 喂进去）
  if (o.injectPlan) {
    const v = await validatePlan(o.injectPlan, constraints);
    return Object.assign({ ok: true, rounds: 0, llmCalls: await countLlmCalls(mission.id), injected: true }, v);
  }

  // 1) 预算闸门（查表）
  const used0 = await countLlmCalls(mission.id);
  const maxCalls = Number(budget.maxLlmCalls) > 0 ? Number(budget.maxLlmCalls) : 12;
  if (used0 >= maxCalls) {
    return { ok: false, code: 'LLM_BUDGET_EXCEEDED', llmCalls: used0, reason: '委托 LLM 次数预算已用完（' + used0 + '/' + maxCalls + '，查 ai_call_log 表），拒绝再发起调用' };
  }

  // 2) 用途级路由拿 provider（plan 与 tool_select 必须同家，§H.10.3）
  let provider = o.provider || null;
  if (!provider) {
    const r = await providerRouter.resolve('plan', {
      worldId,
      providerMap: mission.provider_id ? { plan: Number(mission.provider_id), tool_select: Number(mission.provider_id) } : null,
    });
    provider = r.provider;
    if (!provider) return { ok: false, code: 'NO_PROVIDER', reason: r.reason || '没有可用 provider' };
  }

  // 3) 世界快照 + 候选零件（只带 partKey/role/尺寸/gridsnap，§H.9.2 硬约束 2）
  const world = await regionSnapshot(region);
  const candidates = await assetSearch.searchParts({
    roles: constraints.allowed_roles,
    forbidRoles: constraints.forbid_roles,
    styleFamily: constraints.style_family,
    limit: 24,
  });

  const maxRounds = Math.min(MAX_ROUNDS, Math.max(1, Number(o.maxRounds) || MAX_ROUNDS));
  let rounds = 0;
  let lastStats = null;
  let lastPlan = null;
  const fallbackNotes = []; // 3.5-3 P35-22：换家原因（runner 会并入 executed_stats.notes）

  for (let round = 1; round <= maxRounds; round++) {
    const used = await countLlmCalls(mission.id);
    if (used >= maxCalls) {
      return { ok: false, code: 'LLM_BUDGET_EXCEEDED', llmCalls: used, rounds, reason: '第 ' + round + ' 轮被预算拒绝（' + used + '/' + maxCalls + '，查 ai_call_log 表）' };
    }
    rounds = round;
    // 4) ★ prompt 必须经 promptBuilder（判据 P35-13b 断言分层标记存在）
    const built = promptBuilder.build({
      purpose: 'plan',
      ctx: {
        world,
        task: {
          prompt: mission.prompt,
          constraints: {
            style: constraints.style_family || null,
            exclude: Array.isArray(constraints.forbid_roles) ? constraints.forbid_roles : null,
            budget: { maxObjects: constraints.max_objects || null, maxTris: constraints.max_tris || null, maxHeight: constraints.max_height || null },
          },
          // 输出与布局契约（TASK 永不裁）：曾实测模型不知道 dx/dz 的单位与相对关系，
          // 把全部零件写成 dx=0,dz=0 叠在区域角点 → 全部 OUT_OF_BOUNDS、0 件落地。
          outputContract: buildPlanOutputContract(region),
        },
        parts: candidates.items,
        memories: [],
        tools: [],
        allowedTools: [],
        history: round > 1 && lastStats ? [{ tool: 'validate_plan', argsSummary: '上一轮剔除 ' + JSON.stringify(lastStats.dropped), ok: lastStats.parts > 0 }] : [],
        untrusted: [String(mission.title || '')],
        contextWindowTokens: o.contextWindowTokens || null,
        nearDist: 0, midDist: 0,
      },
    });

    // 3.5-3 P35-22：失败后取候选链下一家重试一次；两次调用 llmClient 都会落 ai_call_log
    const chat = await providerFallback.chatWithFallback({
      messages: built.messages,
      jsonSchema: PLAN_SCHEMA,
      temperature: 0.2,
      maxTokens: 4000,
      // 规划输出大（实测千问 2000 token 需 ~44s），默认 60s 必超时；超时仍不重试（§口径），给足 3 分钟
      timeoutMs: 180000,
      purpose: 'plan',
      caller: 'world_ai_mission_planner',
      missionId: String(mission.id),
      regionKey: String(mission.region_key),
      contextMeta: { tokensPerSection: built.meta.tokensPerSection, dropped: built.meta.dropped, round },
      retries: 1,
    }, {
      primary: provider,
      onFallback: (info) => fallbackNotes.push(
        'P35-22 LLM 调用失败已切换厂商：' + (info.from ? (info.from.display_name || info.from.provider_name) + '#' + info.from.id : '?')
        + ' → ' + (info.to ? (info.to.display_name || info.to.provider_name) + '#' + info.to.id : '?')
        + '（原因：' + info.error + '）；两次调用均已记入 ai_call_log（同一委托不跨家第二次）'
      ),
    });

    const raw = parseJson(chat.content);
    if (!raw) {
      // 截断修复后仍不可解析：不硬失败，记原因进下一轮重试（预算由循环内 countLlmCalls + maxRounds 双闸守着）
      fallbackNotes.push('第 ' + round + ' 轮 LLM 产物解析失败（截断修复后仍不可解析），重试下一轮');
      continue;
    }
    const v = await validatePlan(raw, constraints);
    lastStats = v.stats;
    lastPlan = v.plan;
    // 还有合法零件就不必再来一轮（省调用成本）
    if (v.stats.parts > 0) break;
  }

  if (!lastPlan) {
    return { ok: false, code: 'PLAN_PARSE_FAILED', rounds, llmCalls: await countLlmCalls(mission.id), reason: '全部 ' + rounds + ' 轮 LLM 产物均无法解析为方案 JSON（含截断修复），请缩小委托体量或稍后重试' };
  }

  return {
    ok: true, plan: lastPlan, stats: lastStats, rounds,
    llmCalls: await countLlmCalls(mission.id),
    truncated: !!(lastStats && lastStats.dropped && lastStats.dropped.overBudget),
    candidates: candidates.items.length,
    fallbackNotes,
  };
}

/** 方案输出与布局契约（拼进 [TASK]，永不裁）：坐标语义 + 防重叠 + 区域内落点 */
function buildPlanOutputContract(region) {
  const b = (region && region.bounds) || {};
  const bx = Number(b.x) || 0, bz = Number(b.z) || 0;
  const bw = Number(b.width) || 0, bd = Number(b.depth) || 0;
  return [
    '【输出与布局契约（必须遵守）】',
    '只输出一个 JSON 对象，不要任何解释文字或 markdown 围栏：{"style","summary","blocks":[{"kind","footprint":{"w","d"},"anchor":{"dx","dz"},"parts":[{"partKey","dx","dz","ry","level"}]}]}。',
    `区域范围：左上角 (${bx}, ${bz})，宽 ${bw} 米、深 ${bd} 米。所有坐标单位一律是"米"。`,
    '坐标语义：anchor.dx/dz = 该块相对区域左上角的偏移；parts 的 dx/dz = 该零件相对所属块 anchor 的偏移；ry = 绕 Y 轴角度（0/90/180/270）；level = 堆叠层数（0=地面层）。',
    '布局要求：按 PARTS 段标注的零件尺寸（宽×高×深，米）排布——墙围成一圈、地板铺底、家具放在屋子内部；相邻零件中心间距 ≥ 两者最大边长的一半之和，禁止把多个零件放在同一坐标；全部零件必须落在区域内且距边界 ≥ 2 米。',
    '主体建筑的 anchor 放在区域中部（约 宽/2, 深/2 处），不要贴角。',
    `零件总数控制在 6~15 件（超出会被预算截断；输出过长会被截断导致方案残缺）。`,
    '★ 关键：同一个零件复用（如 4 面墙）时，每份的 dx/dz 必须互不相同、按尺寸错开围成一圈。带数字的示例（4 面墙围 4×4 米小屋，建筑块尺寸约 1×3×0.2）：',
    '{"kind":"house","footprint":{"w":4,"d":4},"anchor":{"dx":' + Math.round(bx + bw / 2 - 2) + ',"dz":' + Math.round(bz + bd / 2 - 2) + '},"parts":[{"partKey":"building_block","dx":0,"dz":0,"ry":0,"level":0},{"partKey":"building_block","dx":4,"dz":0,"ry":90,"level":0},{"partKey":"building_block","dx":4,"dz":4,"ry":180,"level":0},{"partKey":"building_block","dx":0,"dz":4,"ry":270,"level":0}]}',
  ].join('\n');
}

/** 容忍模型在 JSON 前后加解释文字 / ```json 围栏 */
function parseJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { /* 落到截断修复 */ }
  // 截断修复（输出撞 maxTokens 被切）：截到最后一个完整元素边界，去掉悬挂逗号，按栈补齐闭合符。
  // 修复产物里可能混入不完整零件，validatePlan 会按既有规则剔除（dropped），与设计一致。
  return repairTruncatedJson(s.slice(i));
}

function repairTruncatedJson(s) {
  // 收集候选截断点：} ] , 以及"闭合引号且其后一个非空白字符是 , } ]"的引号位置
  // （key 的闭合引号后面是冒号，截在那里会得到 {"key"} 这种残废，必须排除）
  const candidates = [];
  let stack = [], inStr = false, esc = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') {
        inStr = false;
        let m = k + 1;
        while (m < s.length && /\s/.test(s[m])) m++;
        if (m >= s.length || s[m] === ',' || s[m] === '}' || s[m] === ']') candidates.push(k);
      }
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') { if (stack.length) stack.pop(); candidates.push(k); }
    else if (c === ',') candidates.push(k);
  }
  // 从最靠后的候选点往前试：截断 → 去悬挂逗号 → 按栈补齐闭合符 → 能解析即成功
  for (let ci = candidates.length - 1; ci >= 0; ci--) {
    let t = s.slice(0, candidates[ci] + 1).replace(/,\s*$/, '');
    let st = [], inStr2 = false, esc2 = false;
    for (let k = 0; k < t.length; k++) {
      const c = t[k];
      if (inStr2) {
        if (esc2) esc2 = false;
        else if (c === '\\') esc2 = true;
        else if (c === '"') inStr2 = false;
        continue;
      }
      if (c === '"') { inStr2 = true; continue; }
      if (c === '{' || c === '[') st.push(c);
      else if (c === '}' || c === ']') { if (st.length) st.pop(); }
    }
    if (inStr2) t += '"';
    while (st.length) t += st.pop() === '{' ? '}' : ']';
    try { return JSON.parse(t); } catch (e) { /* 试更早的候选点 */ }
  }
  return null;
}

module.exports = { plan, validatePlan, countLlmCalls, parseJson, PLAN_SCHEMA, MAX_ROUNDS };