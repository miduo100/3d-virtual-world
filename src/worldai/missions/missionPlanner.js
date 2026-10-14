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
const scatterMod = require('./scatter'); // 队列14 C2：散点布局原语（确定性泊松盘）
const recipeRegistry = require('../recipes'); // AI 自由拼装：recipe 注册表（几何与落件全在 recipes/）
const partUsage = require('../recipes/partUsage'); // 零件用途对照表（role → 干什么/摆哪/注意什么），注入 [PARTS] 段
const candidatePool = require('./candidatePool'); // 候选零件池三步构建（2026-10-1
const planValidate = require('./planValidate'); // LLM 产物校验与归一（2026-10-13 自本文件拆出，纯搬移）3 从本文件拆出，守 500 行红线）

// ★ 建楼默认层高（后台 system_config.building_floor_height，缺省 2.4m）。
//   进程内缓存 60s：plan 一次委托只读一次库，后台改配置不必重启即可在下一批委托生效。
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
            mode: { type: 'string', enum: ['scatter', 'recipe'] },
            recipe: { type: 'string' },
            spec: { type: 'object' },
            partKeys: { type: 'array', items: { type: 'string' } },
            count: { type: 'number' },
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
          required: ['kind'],
        },
      },
    },
    required: ['blocks'],
  },
};
/** 关键词预选输出 schema（candidate 语义贴合用，失败静默回退轮转采样） */
const KEYWORD_SCHEMA = {
  name: 'part_keywords',
  schema: {
    type: 'object',
    properties: { keywords: { type: 'array', items: { type: 'string' } } },
    required: ['keywords'],
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
    const v = await planValidate.validatePlan(o.injectPlan, constraints, { seedStr: String(mission.id) + '|inject' });
    return Object.assign({ ok: true, rounds: 0, llmCalls: await countLlmCalls(mission.id), injected: true }, v);
  }

  // 1) 预算闸门（查表）
  const used0 = await countLlmCalls(mission.id);
  const maxCalls = Number(budget.maxLlmCalls) > 0 ? Number(budget.maxLlmCalls) : 12;
  if (used0 >= maxCalls) {
    return { ok: false, code: 'LLM_BUDGET_EXCEEDED', llmCalls: used0, reason: '委托 LLM 次数预算已用完（' + used0 + '/' + maxCalls + '，查 ai_call_log 表），拒绝再发起调用' };
  }

  // ★ 白卷换家开关（2026-10-14）：qwen 白卷不是 HTTP 失败，fallback 不触发，须主动切（声明须在 provider 获取前，防 TDZ）
  let switchProvider = false;
  // 2) 用途级路由拿 provider（plan 与 tool_select 必须同家，§H.10.3）
  let provider = o.provider || null;
  if (!provider) {
    const r = await providerRouter.resolve('plan', {
      worldId,
      providerMap: mission.provider_id ? { plan: Number(mission.provider_id), tool_select: Number(mission.provider_id) } : null,
    });
    // ★ 白卷换家（2026-10-14）：上一轮交了白卷（blocks 空）——那是 HTTP 200 的合法
    //   JSON，providerFallback 的失败切换不触发。第二轮强制用候选链下一家：
    //   qwen-plus 实测会连续多轮对同一 prompt 交白卷，换豆包即恢复。
    if (switchProvider && provider && provider.id != null) {
      try {
        const cands = await providerRouter.safeCandidates('plan');
        const next = cands.find(function (x) { return Number(x.id) !== Number(provider.id) && x.isUsable !== false; });
        if (next) {
          fallbackNotes.push('白卷换家重试：' + (provider.display_name || provider.provider_name || provider.id)
            + ' → ' + (next.display_name || next.provider_name || next.id));
          provider = next;
        }
      } catch (e) { /* 换家失败用原 provider，不影响主流程 */ }
    }
    provider = r.provider;
    if (!provider) return { ok: false, code: 'NO_PROVIDER', reason: r.reason || '没有可用 provider' };
  }

  // 3) 世界快照 + 候选零件池（2026-10-13 三步逻辑拆到 candidatePool.js，守 500 行红线）
  const world = await regionSnapshot(region);
  const fallbackNotes = []; // 3.5-3 P35-22：换家原因（runner 会并入 executed_stats.notes）
  let candidates = await candidatePool.buildBase(constraints);
  if (o.injectPlan == null && used0 < maxCalls) {
    const kw = await candidatePool.enrichByKeywords({
      providerFallback: providerFallback, provider: provider, mission: mission,
      constraints: constraints, keywordSchema: KEYWORD_SCHEMA, parseJson: parseJson,
      onNote: function (n) { fallbackNotes.push(n); },
    });
    if (kw.items) {
      candidates = { ok: true, items: kw.items, total: kw.items.length, notice: 'keyword-driven: ' + kw.keywords.join(',') };
    }
    try {
      const fin = await candidatePool.finalize({
        candidates: candidates, keywordHits: kw.hits, constraints: constraints,
        prompt: mission.prompt, onNote: function (n) { fallbackNotes.push(n); },
      });
      candidates.items = fin.items;
      if (fin.notice) candidates.notice = (candidates.notice ? candidates.notice + ' | ' : '') + fin.notice;
    } catch (e) {
      fallbackNotes.push('候选池收尾失败（保留原候选）：' + String(e.message || e).slice(0, 160));
    }
  }

  const maxRounds = Math.min(MAX_ROUNDS, Math.max(1, Number(o.maxRounds) || MAX_ROUNDS));
  let rounds = 0;
  let lastStats = null;
  let lastPlan = null;
  let lastMissing = [];   // 上一轮 AI 编造/记错的 partKey（回流给下一轮 history）

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
          outputContract: buildPlanOutputContract(region, Number(constraints.max_objects) > 0 ? Number(constraints.max_objects) : 120, mission.prompt),
        },
        parts: candidates.items,
        // ★ 零件用途对照表（2026-10-11 接线）：partUsage.usagePromptText() 此前**零引用**，
        //   各 role「干什么/摆哪/注意什么」从未进入任何 prompt —— AI 拿到 24 个英文键名
        //   却没人告诉它 wall 是墙、roof 是屋顶，只能瞎猜键名 → 大量 unknownPart。
        partsUsage: partUsage.usagePromptText(),
        memories: [],
        tools: [],
        allowedTools: [],
        // ★ missingParts 回流（2026-10-13）：AI 编造的键名上一轮只进了 executed_stats，
        //   第二轮 LLM 根本看不到，重试等于瞎猜。现在把「哪些键不存在 + 必须改用清单里的键」
        //   明确写进 history，AI 才能自愈。
        history: round > 1 && lastStats ? [{
          tool: 'validate_plan',
          // ★ 修正指令放最前（renderHistory 会截断，dropped JSON 很长，关键信息必须在头部）。
          //   2026-10-14 强化：intentGap 也前置成硬性要求——旧版 gap 拼在剔除 JSON 之后，
          //   实测「建一栋两层小楼+院子」LLM 两轮都只交 fence，第二轮根本没理会尾部
          //   的「未达标：主体建筑缺失」。
          argsSummary: ((lastMissing.length || (lastPlan && lastPlan.intentGap))
            ? '【上轮方案被打回，本轮必须修正】'
            + (lastMissing.length ? lastMissing.slice(0, 3).join('；').slice(0, 300) + '。' : '')
            + (lastPlan && lastPlan.intentGap ? '硬性要求：' + lastPlan.intentGap + '。' : '')
            : '')
            + '上轮剔除 ' + JSON.stringify(lastStats.dropped),
          ok: lastStats.parts > 0,
        }] : [],
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
      // 6000（2026-10-14）：subBlocks 大 JSON（城堡 4 角楼）实测逼近 4000 上限，
      // 截断 → repairTruncatedJson 修出残块 → 被拒。qwen-plus 输出上限 8k，留足余量。
      maxTokens: 6000,
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
    const v = await planValidate.validatePlan(raw, constraints, { seedStr: String(mission.id) + '|r' + round, bounds: region && region.bounds, candidates: candidates.items });
    // ★ 数量兜底（队列14 收尾）：用户写了具体下限而模型没给够 → 直接把散点块 count 抬到下限
    //   （确定性、零 LLM；实测"大于6个"模型给 5 件、重试仍 5 件——散点原语本身就能精确补足）。
    //   注意此时散点块尚未展开（v.stats.parts 只计普通 parts），件数要按 scatter.count 直算。
    //   预算红线不破：补足量钳在 maxObjects 剩余额度内。
    const minCount = parseMinCount(mission.prompt);
    if (minCount) {
      const scatters = (v.plan.blocks || []).filter((x) => x.mode === 'scatter' && x.scatter);
      // ★ §11-1：recipe 块已在本函数内展开成 parts，故走 parts.length 分支即可；
      //   若将来改回"延后展开"，这里必须改用 recipeStats.count，否则 recipe 块恒被当 0 件
      //   → 数量兜底会把预算全加到散点块上（队列14 A3 同款坑）。
      const plannedParts = (v.plan.blocks || []).reduce(
        (s, x) => s + (x.mode === 'scatter' && x.scatter ? x.scatter.count : (x.parts || []).length), 0
      );
      const maxObjects = Number(constraints.max_objects) > 0 ? Number(constraints.max_objects) : 120;
      const add = Math.min(minCount - plannedParts, maxObjects - plannedParts);
      if (add > 0 && scatters.length) {
        const per = Math.ceil(add / scatters.length);
        for (const sb of scatters) sb.scatter.count = Math.min(sb.scatter.count + per, sb.scatter.count + add);
        fallbackNotes.push('数量兜底：模型给 ' + plannedParts + ' 件 < 用户要求 ≥' + minCount + '，散点块已确定性补足到 ≥' + (plannedParts + add) + ' 件');
      }
    }
    // ★ C2：散点块展开为具体零件坐标（确定性：同委托同轮 → 同坐标 → 重跑幂等去重命中）
    const exp = expandScatterBlocks(v.plan, region, String(mission.id) + '|r' + round);
    if (exp.blocks > 0) {
      v.stats.blocks = (v.plan.blocks || []).length;
      v.stats.parts = (v.plan.blocks || []).reduce((s, b) => s + (b.parts || []).length, 0);
      fallbackNotes.push('散点块已展开：' + exp.blocks + ' 块 / ' + exp.parts + ' 件（泊松盘确定性布点）');
    }
    lastStats = v.stats;
    lastPlan = v.plan;
    lastMissing = Array.isArray(v.missingParts) ? v.missingParts : [];
    // ★ 意图达标检查（队列14 A1/A2）：有合法零件但数量/种类不达标 → 带差距反馈重试下一轮
    //   （MAX_ROUNDS=2 兜底：第 2 轮仍不达标就用最好的一版，绝不静默丢弃差距信息——notes 会带出去）
    //   ★ 白卷也要带反馈（2026-10-14）：parts=0（blocks 空，或全被拒）时旧逻辑不记
    //     gap 不 break——下一轮 LLM 完全不知道自己交了白卷 → 必再交白卷
    //     （实测「4 层住宅楼」连空两轮，一轮反馈都没有）。
    if (v.stats.parts > 0) {
      const gap = intentGap(mission.prompt, v);
      if (!gap) break;
      lastPlan.intentGap = gap; // 透出给 runner notes / 后台确认卡
      fallbackNotes.push('第 ' + round + ' 轮方案未达用户意图（' + gap + '），重试下一轮');
    } else {
      // ★ 白卷反馈分级（2026-10-14）：复合型大工程（城堡/庄园/小镇）模型一轮规划
      //   不动（实测 castle 三轮空 blocks）——反馈里明确「本轮只交主体建筑一个块」，
      //   配景放弃，先保主体成功。单一委托才要求完整输出。
      const complex = /城堡|宫殿|庄园|小镇|商业街|村庄|要塞|要塞/.test(String(mission.prompt || ''));
      const blankGap = complex
        ? '方案 blocks 为空。该委托是复合型大工程——本轮【只输出主体建筑一个块】（building recipe 主楼），围墙/树丛/花坛等配景全部不要，先确保主体成功'
        : '方案 blocks 为空或没有任何合法零件——这是不合格方案，必须至少输出一个内容块（building/fence/forest/garden/path recipe 块，或普通零件块）';
      lastPlan.intentGap = blankGap;
      switchProvider = true;   // 下一轮换候选链下一家（白卷不是 HTTP 失败，须主动切）
      fallbackNotes.push('第 ' + round + ' 轮交了空方案，带反馈重试下一轮' + (complex ? '（复合委托：只要求主体）' : ''));
    }
  }

  if (!lastPlan) {
    return { ok: false, code: 'PLAN_PARSE_FAILED', rounds, llmCalls: await countLlmCalls(mission.id), reason: '全部 ' + rounds + ' 轮 LLM 产物均无法解析为方案 JSON（含截断修复），请缩小委托体量或稍后重试' };
  }
  // ★ 空方案显式失败（2026-10-14）：复杂委托（如「中世纪城堡」）实测 LLM 三轮都交
  //   {"style":…,"summary":…,"blocks":[]}——style/summary 齐全但一个块都没有。
  //   旧逻辑照单全收 ok=true → 落库 0 件、后台看起来"成功"。空方案必须报失败，
  //   让后台能看到并重试（改写委托/换 provider）。
  if (!lastPlan.blocks || !lastPlan.blocks.length) {
    // ★ 拒绝明细透出（2026-10-14）：blocks 空通常是「AI 交了块但全被 validate 拒」
    //   （实测 Wall_Arch 编造键名整块被拒）——只报"blocks 为空"后台根本没法诊断。
    const why = (lastMissing.length ? '；被拒明细：' + lastMissing.slice(0, 3).join('｜').slice(0, 400) : '')
      + (lastPlan.intentGap ? '；差距：' + String(lastPlan.intentGap).slice(0, 200) : '');
    return {
      ok: false, code: 'PLAN_EMPTY', rounds, llmCalls: await countLlmCalls(mission.id),
      reason: 'LLM ' + rounds + ' 轮均未产出任何合法内容块' + why
        + '。请把委托拆小（先主体后配景）或稍后重试',
      fallbackNotes,
    };
  }

  return {
    ok: true, plan: lastPlan, stats: lastStats, rounds,
    llmCalls: await countLlmCalls(mission.id),
    truncated: !!(lastStats && lastStats.dropped && lastStats.dropped.overBudget),
    candidates: candidates.items.length,
    fallbackNotes,
  };
}

/** C2：把散点块展开为具体零件（确定性泊松盘，同种子同结果）。返回展开的 {blocks, parts} 数 */
function expandScatterBlocks(plan, region, seedStr) {
  const b = (region && region.bounds) || {};
  const minX = Number(b.minX != null ? b.minX : b.x) || 0;
  const minZ = Number(b.minZ != null ? b.minZ : b.z) || 0;
  const maxX = Number(b.maxX != null ? b.maxX : minX + (Number(b.width) || 0));
  const maxZ = Number(b.maxZ != null ? b.maxZ : minZ + (Number(b.depth) || 0));
  const w = Math.max(2, maxX - minX - 8); // 留 4m 边界余量（契约"距边界 ≥2m"+吸附余量）
  const d = Math.max(2, maxZ - minZ - 8);
  let outBlocks = 0, outParts = 0;
  for (const blk of (plan.blocks || [])) {
    if (!blk || blk.mode !== 'scatter' || !blk.scatter || !blk.scatter.parts || !blk.scatter.parts.length) continue;
    const s = blk.scatter;
    const radius = scatterMod.radiusFor(s.parts.map((p) => p.grid));
    const fpW = Number(blk.footprint && blk.footprint.w) > 0 ? Math.min(Number(blk.footprint.w), w) : w;
    const fpD = Number(blk.footprint && blk.footprint.d) > 0 ? Math.min(Number(blk.footprint.d), d) : d;
    const pts = scatterMod.poissonScatter({ width: fpW, depth: fpD, count: s.count, radius, seed: seedStr + '|' + blk.kind });
    blk.parts = pts.map((p, i) => {
      const m = s.parts[i % s.parts.length];
      return {
        partKey: m.partKey, role: m.role,
        dx: Number(p.dx.toFixed(2)), dz: Number(p.dz.toFixed(2)),
        ry: scatterMod.rotationFor(seedStr + blk.kind, i), level: 0,
        grid: m.grid, modelPath: m.modelPath,
      };
    });
    delete blk.mode; // 已展开为具体 parts，清除散点标记（scatter 元数据保留供追溯）
    outBlocks++;
    outParts += blk.parts.length;
  }
  if (outBlocks > 0) {
    plan.blocks = (plan.blocks || []).filter((blk) => !blk || blk.mode !== 'scatter' || (blk.parts && blk.parts.length));
  }
  return { blocks: outBlocks, parts: outParts };
}

/** 意图差距检测（队列14 A1/A2）：返回可读差距描述；达标返回 null */
function parseMinCount(prompt) {
  const s = String(prompt || '');
  const m = s.match(/(?:大于|超过|至少|不少于|≥)\s*(\d{1,4})\s*[棵个件株朵座栋]/)
    || s.match(/(\d{1,4})\s*[棵个件株朵座栋]\s*(?:以上|及以上)/);
  return m ? Number(m[1]) : null;
}

function intentGap(prompt, v) {
  const minCount = parseMinCount(prompt);
  const wantsVariety = /多样|各种|不同|丰富/.test(String(prompt || ''))
    || /森林|树林|丛林|花田|草地/.test(String(prompt || ''));
  const parts = Number(v.stats && v.stats.parts) || 0;
  const distinctKeys = new Set(
    (v.plan && v.plan.blocks || []).flatMap((b) => (b.parts || []).map((p) => p.partKey))
  ).size;
  if (minCount && parts < minCount) return '用户要求 ≥' + minCount + ' 件，方案只有 ' + parts + ' 件';
  if (wantsVariety && parts >= 3 && distinctKeys < 3) return '用户要求多样/自然景观，方案只用了 ' + distinctKeys + ' 种 partKey（要求 ≥3 种）';
  // ★ 主体建筑缺失检测（2026-10-14）：委托明确要楼/房/堡等建筑，方案却全是
  //   围墙/树丛等配块——实测「建一栋两层小楼+院子」LLM 两轮都只交 fence
  //   （fence 示例变详细后模型注意力漂移），intentGap 没有建筑维度拦不住。
  //   打回重规划后 LLM 会看到差距描述并补 building 块。误伤面小：真不要楼的
  //   委托顶多多花一轮重试，最终仍采用最后方案。
  if (/楼|房屋|房子|住宅|别墅|城堡|店铺|仓库|塔楼|宅邸|两层|三层|五层/.test(String(prompt || ''))) {
    const hasBldg = ((v.plan && v.plan.blocks) || []).some((b) => b.mode === 'recipe' && b.recipe === 'building');
    if (!hasBldg) return '委托要求建筑（楼/房等），方案里没有任何 building 块——主体建筑缺失，必须先输出 building recipe 块';
  }
  return null;
}

/** 方案输出与布局契约（拼进 [TASK]，永不裁）：坐标语义 + 防重叠 + 区域内落点 */
function buildPlanOutputContract(region, maxObjectsCap, prompt) {
  const b = (region && region.bounds) || {};
  const bx = Number(b.x) || 0, bz = Number(b.z) || 0;
  const bw = Number(b.width) || 0, bd = Number(b.depth) || 0;
  const lines = [
    '【输出与布局契约（必须遵守）】',
    '只输出一个 JSON 对象，不要任何解释文字或 markdown 围栏：{"style","summary","blocks":[{"kind","footprint":{"w","d"},"anchor":{"dx","dz"},"parts":[{"partKey","dx","dz","ry","level"}]}]}。',
    '★ blocks 禁止为空数组——只写 style/summary 不写块 = 不合格方案，会被系统整体打回；无论委托多简单，至少输出一个块（先主体建筑，再配景）。',
    `区域范围：左上角 (${bx}, ${bz})，宽 ${bw} 米、深 ${bd} 米。所有坐标单位一律是"米"。`,
    '坐标语义：anchor.dx/dz = 该块相对区域左上角的偏移；parts 的 dx/dz = 该零件相对所属块 anchor 的偏移；ry = 绕 Y 轴角度（0/90/180/270）；level = 堆叠层数（0=地面层）。',
    '布局要求：按 PARTS 段标注的零件尺寸（宽×高×深，米）排布——墙围成一圈、地板铺底、家具放在屋子内部；相邻零件中心间距 ≥ 两者最大边长的一半之和，禁止把多个零件放在同一坐标；全部零件必须落在区域内且距边界 ≥ 2 米。',
    '主体建筑的 anchor 放在区域中部（约 宽/2, 深/2 处），不要贴角。',
    '★ 多栋建筑并排（联排/商业街）时：相邻建筑 footprint 之间至少留 1.5m 间距——引擎按件落位会做碰撞检测，间距不足的墙件会被整段拒绝（外观缺墙）。',
    '★ 数量语义（必须换算成零件件数，用户对数量敏感）：「几棵/几个」=4~6 件；「一片森林/树林/花田/草地」=20~40 件；「很多/大量/尽量多」=本次预算上限（' + (Number(maxObjectsCap) > 0 ? Number(maxObjectsCap) : 120) + ' 件）的 80%；用户写了具体数字（如「大于3棵」「20个以上」）→ parts 总件数必须 ≥ 该数字。',
    '★ 种类语义：委托含「多样/各种/不同/丰富」或主体是自然景观（森林/树林/丛林/花田/草地）→ 必须使用 ≥3 个不同的 partKey（不同树种/不同种类），只重复同一个 partKey 视为不合格。',
    `散点块（mode:"scatter"）是 forest recipe 的简化替代：铺满**整个区域**、不能圈范围/定中心——「草地铺满全图」用它：{"kind":"forest","mode":"scatter","partKeys":["tree_pine","tree_oak",…],"count":30}（partKeys ≥3 个不同键）；要圈范围或放在房子旁边，一律用 forest recipe。`,
    '★ recipe 结构类需求（小路/围墙/房屋等**有形状**的构件）必须用 recipe 模式：{"kind":"主路","mode":"recipe","recipe":"<recipe名>","spec":{…骨架…}}。',
    '  recipe 只给「骨架」，**绝对禁止输出逐件坐标** —— 几何由引擎算；你手排几十块砖的偏移必崩，最后会退化成"放一整栋楼"。',
    '  ★ 已实现的 recipe —— ' + recipeRegistry.describe(),
    // ★ recipe 触发门槛表（2026-10-14）：只有「推荐」没有「门槛」时，小模型会挑软柿子
    //   手排——庄园实测：forest 说明就在 prompt 里，AI 仍手排了 2 棵树。写成**硬门槛**
    //   并同时声明「普通 parts 模式的合法剩余范围」，两边一夹就没有逃逸空间。
    '  ★ recipe 触发门槛（满足条件**必须**用对应 recipe，用普通 parts 手排 = 不合格方案）：',
    '    · 房屋/建筑（含楼/屋/店/堡）→ building；',
    '    · 围墙/栅栏/院界（≥2 段连续边界）→ fence；',
    '    · 树/植物 ≥2 棵（树丛/树林/林间点缀都算）→ forest —— **禁止手排多棵树的坐标**；',
    '    · 花坛/带围边的绿化 → garden；',
    '    · 小路/广场/栈道 → path。',
    '    普通零件块（mode 无 recipe）只允许：单件装饰物、或总数 ≤3 件且无形状规律的零散小件（如门口 1 个路灯 + 1 个信箱）。',
    '  ★ 搭房子/围墙等**有形状的建筑**必须用 building recipe，严禁用普通 parts 逐件手排坐标（你手排几十块砖的偏移必崩）。building 骨架如下：',
    '  {"kind":"主楼","mode":"recipe","recipe":"building","spec":{"footprint":[{"dx":0,"dz":0},{"dx":8,"dz":0},{"dx":8,"dz":6},{"dx":0,"dz":6}],"floors":3,"door":{"side":"south","position":0.5},"windows":{"perWall":2,"skipDoor":true},"parts":{"wall":"<墙件partKey>","door":"<门件partKey>","window":"<窗件partKey>","roof":"<屋顶partKey>","corner":"<角柱partKey,可省>","trim":"<腰线partKey,可省>"}}}',
    '  · footprint：多边形顶点（逆时针，单位米，相对块 anchor），它就是建筑占地； floors：层数。',
    '  ★ 层高由后台统一设定（system_config.building_floor_height，当前默认 2.4m/层），**不要**自己填 floorHeight；墙件比层高矮时引擎会自动沿高度堆叠补足。',
    '  ★ 总高 = 层高 × 层数：想要"20 米高的楼"→ floors = 20 / 2.4 ≈ 8 层。委托若给了 max_height，超出会被自动截断。',
    '  ★ 墙件高度要接近层高（看 PARTS 里的尺寸 w×h×d，h 就是墙件高度）：选 h≈2.4m 的墙件时每层 1 排；选 h=0.625m 的小块时每层要堆 4 排、件数翻 4 倍，很容易撞 max_objects 预算被截断成"矮楼"。**高层建筑优先选高墙件。**',
    '  · door/windows：可选；door.side 取 south/north/east/west（footprint 起边为 south），position 取 0~1 表示沿该边的位置。',
    '  · parts：五个槽位（wall/door/window/roof/corner/trim 均可省），**partKey 必须逐字取自 PARTS 清单**；引擎会自己完成绕轮廓铺墙、换转角件、开窗开门、封屋顶、按层堆叠。',
    '  · roof 槽位选件规则（PARTS 里每件都标了「形态=平板」或「形态=坡屋顶/塔顶」）：城堡/木屋/别墅/中世纪/茅屋 → 必须选「形态=坡屋顶/塔顶」的件（如 Roof_Slate_Center）；现代办公楼/厂房/平顶建筑 → 选「形态=平板」的件（如 Roof_2x2）。**看到「形态=坡屋顶」就不要绕过去选平板。**',
    '  ★ 尺寸语义（用户报的数字必须体现在骨架上）："20 米宽的房子" → footprint 最大跨度 = 20 米；不要自作主张加余量、也不要缩水。',
    '  ★ 让每栋房不一样：parts 里给不同 pack 的墙/屋顶，或多栋楼用不同 pack、不同 floors、不同 footprint —— 这是"组合出新样式"的正路。',
    '  ★ 大型/复合建筑（城堡/宫殿/庄园/城墙）必须用 building 的 subBlocks 组合多个子结构，一个块只出外壳：',
    '    {"kind":"城堡","mode":"recipe","recipe":"building","spec":{"footprint":[主楼多边形],"floors":4,"parts":{"wall":"石墙件","roof":"坡屋顶件（如 Roof_Slate_Center）"},"subBlocks":[{"anchor":{"dx":0,"dz":0},"footprint":[角楼多边形],"floors":6,"parts":{"wall":"石墙件","roof":"坡屋顶件"}},{"anchor":{"dx":20,"dz":0},"footprint":[...],"floors":6}]}}',
    '    · subBlocks[i].anchor 相对本块 anchor； floors / parts 可省略（缺省 floors 比主楼少 1 层、parts 继承主楼）；子块可用不同的 roof 做出坡屋顶塔楼。',
    '    · interior.floor = 每层内部楼板（顶层也铺，等于封顶）；interior.column = 内部立柱。不给 interior 也不会报错，但楼内部是空的。',
    '    · interior.furniture = 室内家具键名数组（如 ["bedSingle","chair","loungeSofa"]，须来自 PARTS 清单），引擎每层地面确定性散点（默认每层 ≤8 件，可用 interior.furnitureCount 调）。住宅/公寓建议配家具——房子从"能看"变"能住"。',
    '  ★ 屋顶两种形态都合法：平板（高度≤最窄边，如 Roof_2x2）与坡屋顶/塔顶（高度可大于最窄边，如 Roof_Slate_Center、tower_square_roof）——坡屋顶件请填在 roof 槽位。',
    '  ★ 屋顶风格要与建筑风格一致：城堡/木屋/别墅/中世纪 → 用坡屋顶（Roof_Slate_Center 这类 h 明显大于 0 的件）；现代办公楼/厂房/平顶建筑 → 用平板（Roof_2x2 这类 h=0 的件）。**不要给城堡盖现代平板顶。**',
    '  ★ 内部结构：不填 interior 时引擎会自动用 parts.roof 铺内部楼板（顶层由屋顶负责），所以楼里不会是空的；想自定义楼板/立柱才填 interior:{floor:"楼板件",column:"立柱件"}。',
    '  ★ 围墙/栅栏/庭院边界用 fence recipe（自动闭环）：{"kind":"庭院围墙","mode":"recipe","recipe":"fence","spec":{"polygon":[{"dx":0,"dz":0},{"dx":20,"dz":0},{"dx":20,"dz":15},{"dx":0,"dz":15}],"gate_align":{"dx":10,"dz":0},"parts":{"fence":"栏板partKey","post":"柱partKey可省","gate":"大门partKey可省"}}}——polygon 是围墙多边形顶点；gate_align 是参考点（填楼门相对本块 anchor 的偏移），门会开在**离它最近的墙段上正对楼门**；不填 gate_align 才用 gate_position(0~1，第一段比例)。',
    '  ★ 树丛/树林用 forest recipe（泊松盘自动布点，绝不重叠）：{"kind":"树林","mode":"recipe","recipe":"forest","spec":{"count":15,"size":{"width":25,"depth":20},"partKeys":["树种partKey1","树种partKey2"]}}——多个树种自动混种；★ **around 通常不要填**（引擎自动把林子放在块中心，而块 anchor 又自动放区域中部——你若按"区域绝对偏移"理解 around 会把林子推到边界外被整片裁掉）；确需相对块中心偏移时才填 {"dx","dz"}（米）。',
    '  ★ 花坛/绿化用 garden recipe（围边+内部花卉散点）：{"kind":"花坛","mode":"recipe","recipe":"garden","spec":{"shape":"rect或circle","size":{"width":8,"depth":5},"flower_types":["花卉partKey1","花卉partKey2"],"parts":{"edge":"围边partKey可省"}}}。',
    // ★ 两条硬规则放 TASK 段（本段永不裁）：PARTS 段超预算时会被 clampText 尾部硬截，
    //   放在那里可能连规则一起被切掉（2026-10-12 修正）。
    '★ 零件多样性（硬性）：同一 role 下若有多个不同 partKey（尤其同 pack 里的墙/屋顶变体），必须交替使用至少 2~3 种，禁止一栋建筑整栋只重复同一个 partKey。',
    '★ 套件一致性（硬性）：同一栋建筑优先从 PARTS 里同一个【pack名】下选零件，混用不同 pack 会出现风格割裂。',
    '  path 示例（10 米直线小路，坐标单位米，相对块 anchor）：{"mode":"recipe","recipe":"path","spec":{"waypoints":[{"dx":0,"dz":0},{"dx":10,"dz":0}],"width":3,"tile":["roadTile_001"],"cornerTile":"roadTile_corner"}}',
    '  ★ 尺寸语义（用户报的数字必须体现在骨架上）："20 米长的小路" → waypoints 首尾直线距离 = 20 米（{"dx":0,"dz":0} 到 {"dx":20,"dz":0}）；不要自作主张加余量、也不要缩水。铺装宽度用 width（米）。',
    '★ 关键：同一个零件复用（如 4 面墙）时，每份的 dx/dz 必须互不相同、按尺寸错开围成一圈。带数字的示例（4 面墙围 4×4 米小屋，建筑块尺寸约 1×3×0.2）：',
    '{"kind":"house","footprint":{"w":4,"d":4},"anchor":{"dx":' + Math.round(bx + bw / 2 - 2) + ',"dz":' + Math.round(bz + bd / 2 - 2) + '},"parts":[{"partKey":"building_block","dx":0,"dz":0,"ry":0,"level":0},{"partKey":"building_block","dx":4,"dz":0,"ry":90,"level":0},{"partKey":"building_block","dx":4,"dz":4,"ry":180,"level":0},{"partKey":"building_block","dx":0,"dz":4,"ry":270,"level":0}]}',
  ];
  // ── 分级瘦身（2026-10-14）：TASK 段 3230 token 且持续膨胀——注意力稀释是复杂
  //   委托空方案的诱因之一。按委托意图只保留对应 recipe 的详细说明组；
  //   契约/门槛表/硬规则永不裁；委托一个组都没命中时全保留（安全默认）。
  const ptxt = String(prompt || '');
  const GROUPS = [
    { re: /楼|房|屋|别墅|城堡|店铺|仓库|塔|宅|馆|厅|宫殿/, sigs: ['recipe":"building', 'building 骨架', 'footprint：多边形顶点', '层高由后台', '总高 = 层高', '墙件高度要接近层高', 'door/windows：可选', '五个槽位', 'roof 槽位选件规则', '米宽的房子', '让每栋房不一样', '大型/复合建筑', 'subBlocks', 'interior.floor', 'interior.furniture', '屋顶两种形态', '屋顶风格要与建筑风格', '内部结构：不填 interior'] },
    { re: /围墙|栅栏|篱笆|院子|庭院|庄园/, sigs: ['recipe":"fence'] },
    { re: /树|林|森林/, sigs: ['recipe":"forest'] },
    { re: /花坛|花卉|花园|绿化/, sigs: ['recipe":"garden'] },
    { re: /小路|广场|栈道|道路|步道/, sigs: ['path 示例', '米长的小路'] },
  ];
  const wanted = [];
  for (const g of GROUPS) if (g.re.test(ptxt)) wanted.push.apply(wanted, g.sigs);
  const keepAll = !wanted.length;
  const groupOf = function (line) {
    for (const g of GROUPS) for (const s of g.sigs) if (line.indexOf(s) >= 0) return g;
    return null;
  };
  const filtered = keepAll ? lines : lines.filter(function (line) {
    const grp = groupOf(line);
    return grp === null || grp.re.test(ptxt);   // 非组内行（契约/门槛表/硬规则）全保留
  });
  return filtered.join('\n');
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

module.exports = { plan, validatePlan: planValidate.validatePlan, countLlmCalls, parseJson, PLAN_SCHEMA, MAX_ROUNDS, __test_expandScatterBlocks: expandScatterBlocks };