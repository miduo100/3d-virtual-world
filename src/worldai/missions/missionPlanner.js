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

    const chat = await llmClient.chat({
      provider,
      messages: built.messages,
      jsonSchema: PLAN_SCHEMA,
      temperature: 0.2,
      maxTokens: 2000,
      purpose: 'plan',
      caller: 'world_ai_mission_planner',
      missionId: String(mission.id),
      regionKey: String(mission.region_key),
      contextMeta: { tokensPerSection: built.meta.tokensPerSection, dropped: built.meta.dropped, round },
      retries: 1,
    });

    const raw = parseJson(chat.content);
    if (!raw) {
      return { ok: false, code: 'PLAN_PARSE_FAILED', rounds, llmCalls: await countLlmCalls(mission.id), reason: 'LLM 产物不是可解析的 JSON（前 200 字：' + String(chat.content || '').slice(0, 200) + '）' };
    }
    const v = await validatePlan(raw, constraints);
    lastStats = v.stats;
    lastPlan = v.plan;
    // 还有合法零件就不必再来一轮（省调用成本）
    if (v.stats.parts > 0) break;
  }

  return {
    ok: true, plan: lastPlan, stats: lastStats, rounds,
    llmCalls: await countLlmCalls(mission.id),
    truncated: !!(lastStats && lastStats.dropped && lastStats.dropped.overBudget),
    candidates: candidates.items.length,
  };
}

/** 容忍模型在 JSON 前后加解释文字 / ```json 围栏 */
function parseJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}

module.exports = { plan, validatePlan, countLlmCalls, parseJson, PLAN_SCHEMA, MAX_ROUNDS };