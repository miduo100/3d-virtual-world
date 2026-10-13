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
const recipeValidate = require('../recipes/validate'); // recipe 骨架校验（规则不写在本文件，守 500 行红线）
const partUsage = require('../recipes/partUsage'); // 零件用途对照表（role → 干什么/摆哪/注意什么），注入 [PARTS] 段
const candidatePool = require('./candidatePool'); // 候选零件池三步构建（2026-10-13 从本文件拆出，守 500 行红线）

// ★ 建楼默认层高（后台 system_config.building_floor_height，缺省 2.4m）。
//   进程内缓存 60s：plan 一次委托只读一次库，后台改配置不必重启即可在下一批委托生效。
const DEFAULT_FLOOR_HEIGHT = 2.4;
let _fhCache = { v: DEFAULT_FLOOR_HEIGHT, at: 0 };
async function buildingFloorHeight() {
  if (Date.now() - _fhCache.at < 60000) return _fhCache.v;
  try {
    const r = await query("SELECT config_value FROM system_config WHERE config_key = 'building_floor_height'");
    const n = Number(r.rows[0] && r.rows[0].config_value);
    if (isFinite(n) && n > 0 && n <= 20) _fhCache = { v: n, at: Date.now() };
    else _fhCache = { v: DEFAULT_FLOOR_HEIGHT, at: Date.now() };
  } catch (e) { _fhCache = { v: DEFAULT_FLOOR_HEIGHT, at: Date.now() }; }
  return _fhCache.v;
}

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

/** recipe 零件解析器：把 assetSearch.getPart 的行形状适配成 recipes 契约（grid 数组化） */
async function recipePartResolver(partKey) {
  const p = await assetSearch.getPart(partKey);
  if (!p) return null;
  return {
    part_key: p.part_key, part_role: p.part_role,
    grid: [p.grid_w || 1, p.grid_h || 1, p.grid_d || 1],
    model_path: p.model_path,
  };
}

/** 校验并归一 LLM 产物：非法 partKey / 禁用 role 一律剔除；超预算截断（P35-9）
 *  opts.seedStr：确定性种子（recipe 展开用；缺省退化为固定串，注入路径可重跑同坐标） */
async function validatePlan(raw, constraints, opts) {
  const c = constraints || {};
  const seedStr = String((opts && opts.seedStr) || 'seed0');
  const allowed = Array.isArray(c.allowed_roles) ? c.allowed_roles.map(String) : null;
  const forbid = Array.isArray(c.forbid_roles) ? c.forbid_roles.map(String) : [];
  const maxObjects = Number(c.max_objects) > 0 ? Number(c.max_objects) : 120;
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const kept = [];
  // ★ 预算计数单位是**零件**，不是块（判据 P35-9：maxObjects=10 而布局 30 件 → 截断到 10 件）
  let placedParts = 0;
  const dropped = { unknownPart: 0, roleNotAllowed: 0, roleForbidden: 0, overBudget: 0, recipeInvalid: 0 };
  const lastMiss = [];   // AI 编造/记错的 partKey（§11-6 显式记账，供 runner 并入 notes 曝光）
  for (const b of blocks) {
    // ★ AI 自由拼装 recipe 块：AI 只给**骨架**（waypoints/footprint），引擎沿骨架铺零件。
    //   这里是全链路唯一接线点：校验 → 调 registry 展开 → 落成 parts（与普通块同构）。
    if (b && b.mode === 'recipe') {
      const remain0 = maxObjects - placedParts;
      if (remain0 <= 0) { dropped.overBudget++; continue; }
      const rv = await recipeValidate.validateRecipeBlock(b, {
        partResolver: recipePartResolver, forbidRoles: forbid, allowedRoles: allowed,
      });
      if (!rv.ok) {
        dropped.recipeInvalid++;
        lastMiss.push('recipe=' + String(rv.recipe || '?') + ' 校验被拒：' + String(rv.reason || '').slice(0, 200)
          + (rv.hint ? '｜改法：' + String(rv.hint).slice(0, 200) : ''));
        continue;
      }
      const built = await recipeRegistry.build(rv.recipe, rv.spec, {
        partResolver: recipePartResolver,
        seedStr: seedStr + '|' + String(b.kind || rv.recipe),
        maxObjects: remain0,
        // ★ 层高与限高（2026-10-12）：
        //   floorHeight = 后台 system_config.building_floor_height（缺省 2.4m）。
        //     不传则 recipe 退化为"层高=墙件高度"，Kenney building_block 只有 0.625m
        //     → 5 层楼总高 3.1m，像积木玩具。墙件比层高矮时由 recipe 沿高度堆叠补足。
        //   maxHeight = 委托级 constraints.max_height，按"层高×层数"折算成最大层数，
        //     真正截断 floors（此前它只是透传给 LLM 的软约束，从未执行）。
        floorHeight: await buildingFloorHeight(),
        maxHeight: Number(c.max_height) > 0 ? Number(c.max_height) : 0,
      });
      if (!built.ok) {
        dropped.recipeInvalid++;
        // ★ 拒绝原因回流（2026-10-13）：拱件墙/角色不符/尺寸不符被拒时，reason 里
        //   写明了「哪个槽位、什么零件、为什么不行」——必须让下一轮 LLM 看到，
        //   否则它两轮都交同一份被拒方案（实测：新校验上线后 2 轮全拒、0 件落库）。
        lastMiss.push('recipe=' + rv.recipe + ' 整块被拒：' + String(built.reason || '').slice(0, 200)
          + (built.hint ? '｜改法：' + String(built.hint).slice(0, 200) : ''));
        continue;
      }
      if (built.stats && built.stats.truncated) dropped.overBudget++;
      // ★ 槽位件查不到要显式记账（2026-10-12）：AI 会编造零件名（实测把
      //   tower_hexagon_roof_secondary 记成 tower_square_roof_secondary），旧逻辑只对 wall
      //   失败整块拒绝，roof/corner/door 等槽位查不到时静默跳过 → 楼盖出来没屋顶且无痕迹。
      if (built.stats && built.stats.dropped && built.stats.dropped.unknownPart > 0) {
        dropped.recipeInvalid++;
        const miss = (built.stats.notes || []).filter(function (n) { return /查不到/.test(n); });
        if (miss.length) lastMiss.push(miss.join(' | '));
      }
      placedParts += built.parts.length;
      kept.push({
        kind: String(b.kind || rv.recipe), mode: 'recipe',
        recipe: rv.recipe, spec: rv.spec, recipeStats: built.stats,
        footprint: { w: Number(b.footprint && b.footprint.w) || 0, d: Number(b.footprint && b.footprint.d) || 0 },
        anchor: { dx: Number(b.anchor && b.anchor.dx) || 0, dz: Number(b.anchor && b.anchor.dz) || 0 },
        parts: built.parts,
      });
      continue;
    }
    // ★ C2 散点块：模型只给 partKeys + count，坐标由 scatter 原语展开（确定性泊松盘）
    if (b && b.mode === 'scatter') {
      const keys = Array.isArray(b.partKeys) ? b.partKeys.map(String) : [];
      const validParts = [];
      for (const k of keys) {
        const part = await assetSearch.getPart(k);
        if (!part) { dropped.unknownPart++; continue; }
        if (forbid.indexOf(String(part.part_role)) >= 0) { dropped.roleForbidden++; continue; }
        if (allowed && allowed.indexOf(String(part.part_role)) < 0) { dropped.roleNotAllowed++; continue; }
        validParts.push({
          partKey: part.part_key, role: part.part_role,
          grid: [part.grid_w || 1, part.grid_h || 1, part.grid_d || 1],
          modelPath: part.model_path,
        });
      }
      if (!validParts.length) continue;
      let count = Math.max(1, Math.floor(Number(b.count) || validParts.length));
      const remain = maxObjects - placedParts;
      if (count > remain) { count = Math.max(0, remain); dropped.overBudget++; }
      if (count <= 0) continue;
      placedParts += count;
      kept.push({
        kind: String(b.kind || 'scatter'), mode: 'scatter',
        footprint: { w: Number(b.footprint && b.footprint.w) || 0, d: Number(b.footprint && b.footprint.d) || 0 },
        anchor: { dx: Number(b.anchor && b.anchor.dx) || 0, dz: Number(b.anchor && b.anchor.dz) || 0 },
        scatter: { count, parts: validParts },
        parts: [],
      });
      continue;
    }
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
    // AI 编造/记错的 partKey（§11-6）：runner 并入 executed_stats.notes，让"楼没屋顶"这类
    // 静默失败在结果里可见，而不是只埋在 building.js 的 notes 数组里没人看。
    missingParts: lastMiss.slice(0, 6),
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
    const v = await validatePlan(o.injectPlan, constraints, { seedStr: String(mission.id) + '|inject' });
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
          outputContract: buildPlanOutputContract(region, Number(constraints.max_objects) > 0 ? Number(constraints.max_objects) : 120),
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
          // ★ 修正指令放最前（renderHistory 会截断，dropped JSON 很长，关键信息必须在头部）
          argsSummary: (lastMissing.length
            ? '【上轮方案被拒，本轮必须修正】' + lastMissing.slice(0, 3).join('；').slice(0, 420) + '。'
            : '')
            + '上轮剔除 ' + JSON.stringify(lastStats.dropped)
            + (lastPlan && lastPlan.intentGap ? '；未达标：' + lastPlan.intentGap : ''),
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
    const v = await validatePlan(raw, constraints, { seedStr: String(mission.id) + '|r' + round });
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
    if (v.stats.parts > 0) {
      const gap = intentGap(mission.prompt, v);
      if (!gap) break;
      lastPlan.intentGap = gap; // 透出给 runner notes / 后台确认卡
      fallbackNotes.push('第 ' + round + ' 轮方案未达用户意图（' + gap + '），重试下一轮');
    }
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
  return null;
}

/** 方案输出与布局契约（拼进 [TASK]，永不裁）：坐标语义 + 防重叠 + 区域内落点 */
function buildPlanOutputContract(region, maxObjectsCap) {
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
    '★ 数量语义（必须换算成零件件数，用户对数量敏感）：「几棵/几个」=4~6 件；「一片森林/树林/花田/草地」=20~40 件；「很多/大量/尽量多」=本次预算上限（' + (Number(maxObjectsCap) > 0 ? Number(maxObjectsCap) : 120) + ' 件）的 80%；用户写了具体数字（如「大于3棵」「20个以上」）→ parts 总件数必须 ≥ 该数字。',
    '★ 种类语义：委托含「多样/各种/不同/丰富」或主体是自然景观（森林/树林/丛林/花田/草地）→ 必须使用 ≥3 个不同的 partKey（不同树种/不同种类），只重复同一个 partKey 视为不合格。',
    `散点类需求（森林/花田/草地/树丛）推荐用散点块，不必手排坐标：{"kind":"forest","mode":"scatter","partKeys":["tree_pine","tree_oak",…],"count":30}——系统会用确定性均匀布点把 count 件零件铺满整个区域；partKeys 必须来自 PARTS 清单（≥3 个不同键）。`,
    '★ recipe 结构类需求（小路/围墙/房屋等**有形状**的构件）必须用 recipe 模式：{"kind":"主路","mode":"recipe","recipe":"<recipe名>","spec":{…骨架…}}。',
    '  recipe 只给「骨架」，**绝对禁止输出逐件坐标** —— 几何由引擎算；你手排几十块砖的偏移必崩，最后会退化成"放一整栋楼"。',
    '  ★ 已实现的 recipe —— ' + recipeRegistry.describe(),
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
    '  ★ 围墙/栅栏/庭院边界用 fence recipe（自动闭环）：{"kind":"庭院围墙","mode":"recipe","recipe":"fence","spec":{"polygon":[{"dx":0,"dz":0},{"dx":20,"dz":0},{"dx":20,"dz":15},{"dx":0,"dz":15}],"gate_position":0.5,"parts":{"fence":"栏板partKey","post":"柱partKey可省","gate":"大门partKey可省"}}}——polygon 是围墙多边形顶点，gate_position 是门在第一段上的位置(0~1)。',
    '  ★ 树丛/树林用 forest recipe（泊松盘自动布点，绝不重叠）：{"kind":"树林","mode":"recipe","recipe":"forest","spec":{"count":15,"size":{"width":25,"depth":20},"around":{"dx":10,"dz":8},"partKeys":["树种partKey1","树种partKey2"]}}——around 是林子中心偏移（可省=size 居中），多个树种会自动混种。',
    '  ★ 花坛/绿化用 garden recipe（围边+内部花卉散点）：{"kind":"花坛","mode":"recipe","recipe":"garden","spec":{"shape":"rect或circle","size":{"width":8,"depth":5},"flower_types":["花卉partKey1","花卉partKey2"],"parts":{"edge":"围边partKey可省"}}}。',
    // ★ 两条硬规则放 TASK 段（本段永不裁）：PARTS 段超预算时会被 clampText 尾部硬截，
    //   放在那里可能连规则一起被切掉（2026-10-12 修正）。
    '★ 零件多样性（硬性）：同一 role 下若有多个不同 partKey（尤其同 pack 里的墙/屋顶变体），必须交替使用至少 2~3 种，禁止一栋建筑整栋只重复同一个 partKey。',
    '★ 套件一致性（硬性）：同一栋建筑优先从 PARTS 里同一个【pack名】下选零件，混用不同 pack 会出现风格割裂。',
    '  path 示例（10 米直线小路，坐标单位米，相对块 anchor）：{"mode":"recipe","recipe":"path","spec":{"waypoints":[{"dx":0,"dz":0},{"dx":10,"dz":0}],"width":3,"tile":["roadTile_001"],"cornerTile":"roadTile_corner"}}',
    '  ★ 尺寸语义（用户报的数字必须体现在骨架上）："20 米长的小路" → waypoints 首尾直线距离 = 20 米（{"dx":0,"dz":0} 到 {"dx":20,"dz":0}）；不要自作主张加余量、也不要缩水。铺装宽度用 width（米）。',
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

module.exports = { plan, validatePlan, countLlmCalls, parseJson, PLAN_SCHEMA, MAX_ROUNDS, __test_expandScatterBlocks: expandScatterBlocks };