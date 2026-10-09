/**
 * worldPlanner —— goal → 5 阶段规划（AI World Brain · Phase 3 · P2-1/8/9）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 3 文件清单「goal → 目的原语 → phases → steps（LLM 展开，确定性排序）」。
 *
 * 三条纪律（沿用 3.5 planner 已验证的口径）：
 *   1) prompt 必经 promptBuilder（装配契约，§H.9）；聊天文本只进 untrusted 区（§H.6，P2-9）；
 *   2) 跨厂商兜底走 providerFallback（3.5-3 既有口径），两次调用都落 ai_call_log；
 *   3) injectPlan 注入路径（验收/演练）与 missionPlanner 同款——只喂固定 plan，不绕过校验。
 * 确定性排序：phases 按 no 升序、steps 按 seq 升序落库（LLM 输出顺序不信任）。
 */
'use strict';

const { query } = require('../../database/db');
const promptBuilder = require('../llm/promptBuilder');
const providerRouter = require('../llm/providerRouter');
const providerFallback = require('../llm/providerFallback');
const worldAiConfig = require('../config');
const memoryService = require('../memory/memoryService');
const goalService = require('../goals/goalService');
const planValidator = require('./planValidator');
const purposePrimitives = require('./purposePrimitives');

/** 提示词注入的输入面（P2-9）：最近聊天进 untrusted（截断 + 由 promptBuilder 剥指令句式）。
 *  ★ world_chat_log 没有 world_id 列（P4 迁移即如此），取最近 10 条全局聊天——
 *  单世界部署语义等价；多世界共库时由 Phase 4 的事件流（world_events，带 world_id）接替。 */
async function recentChatUntrusted() {
  try {
    const r = await query(
      `SELECT sender_type, message FROM world_chat_log ORDER BY created_at DESC LIMIT 10`
    );
    return r.rows.map((row) => ('[' + (row.sender_type || 'human') + '] ' + String(row.message || '').slice(0, 120)));
  } catch (e) { return []; }
}

/** 世界快照（最小集；完整 Snapshot 属 Phase 4 感知） */
async function worldSnapshot(worldId) {
  const o = await query(`SELECT count(*)::int AS n FROM world_objects`);
  const rg = await query(`SELECT count(*)::int AS n FROM world_regions`);
  return { objectId: 'world', name: '本世界', stats: { objects: o.rows[0].n, regions: rg.rows[0].n } };
}

/**
 * 生成规划（status=draft，**永不直接生效**）。
 * @param {object} o { worldId, goalId, injectPlan?, adminName? }
 * @returns {ok, plan?, stats?, errors?, reason?}
 */
async function generate(o) {
  const p = o || {};
  if (!p.worldId) return { ok: false, code: 'WORLD_REQUIRED', reason: '缺少 worldId' };
  const goal = await goalService.getGoal(p.worldId, p.goalId);
  if (!goal) return { ok: false, code: 'GOAL_NOT_FOUND', reason: '目标不存在：' + p.goalId };

  // 版本 = 同 goal 当前最大 version + 1
  const v = await query(`SELECT COALESCE(MAX(version), 0) + 1 AS nv FROM world_plans WHERE world_id = $1 AND goal_id = $2`,
    [String(p.worldId), String(p.goalId)]);
  const version = v.rows[0].nv;

  let validated;
  let llmCallId = null;
  if (p.injectPlan) {
    validated = planValidator.validate(p.injectPlan);
    if (!validated.ok) return { ok: false, code: 'PLAN_INVALID', errors: validated.errors, reason: '注入的规划未通过校验' };
  } else {
    const built = promptBuilder.build({
      purpose: 'plan',
      ctx: {
        world: await worldSnapshot(p.worldId),
        task: {
          prompt: (goal.vision ? String(goal.vision) : goal.title)
            + '\n硬性规则（不可违反）：' + (goal.hard_rules || []).join('；')
            + '\n偏好：' + (goal.soft_prefs || []).join('；'),
          constraints: { phases: planValidator.PHASE_COUNT, purposeVocabulary: purposePrimitives.KEYS },
        },
        parts: purposePrimitives.PRIMITIVES.map((x) => ({ partKey: x.key, role: x.title, name: x.key, description: x.desc + '；依赖：' + (x.dependsOn.join('/') || '无') })),
        // Phase 7（P6-12）：world + **feedback** 两档一起召回 —— 真人反馈必须能进下轮规划的 prompt；
        // 反馈属玩家输入，渲染时由 promptBuilder 的 [MEMORY] 行统一过 sanitizeUntrusted。
        memories: (await memoryService.recall({ worldId: p.worldId, scope: 'world', limit: 10 }))
          .items
          .concat((await memoryService.recall({ worldId: p.worldId, scope: 'feedback', limit: 5 })).items)
          .map((m) => ({ content: m.content, kind: m.kind })),
        tools: [],
        allowedTools: [],
        history: [],
        untrusted: await recentChatUntrusted(),
        yesterdaySummary: await require('../memory/dailyDigest').buildYesterdayDigest(p.worldId), // Phase 7 P6-11
        contextWindowTokens: null,
        nearDist: 0, midDist: 0,
      },
    });
    const cfg = await worldAiConfig.getConfig(p.worldId);
    const router = await providerRouter.resolve('plan', { worldId: p.worldId });
    if (!router.provider) return { ok: false, code: 'NO_PROVIDER', reason: router.reason || '没有可用 provider' };
    let chat;
    try {
      chat = await providerFallback.chatWithFallback({
        messages: built.messages,
        jsonSchema: planValidator.PLAN_JSON_SCHEMA,
        temperature: 0.3,
        maxTokens: 3000,
        purpose: 'plan',
        caller: 'world_ai_planner',
        regionKey: null,
        contextMeta: { tokensPerSection: built.meta.tokensPerSection, dropped: built.meta.dropped, goalId: String(p.goalId) },
        retries: 1,
      }, { primary: router.provider });
    } catch (e) {
      return { ok: false, code: 'LLM_FAILED', reason: String(e && e.message).slice(0, 300) };
    }
    llmCallId = chat.callLogId || null;
    const raw = parseJson(chat.content);
    if (!raw) return { ok: false, code: 'PLAN_PARSE_FAILED', reason: 'LLM 产物不是可解析 JSON（前 200 字：' + String(chat.content || '').slice(0, 200) + '）' };
    validated = planValidator.validate(raw);
    if (!validated.ok) return { ok: false, code: 'PLAN_INVALID', errors: validated.errors, reason: 'LLM 规划未通过校验：' + validated.errors.join('；').slice(0, 300) };
  }

  // 落库：phases 压进主表，steps 逐行（确定性排序）
  const ins = await query(
    `INSERT INTO world_plans (world_id, goal_id, version, title, summary, overview, phases, risks, status, llm_call_id, prompt_digest)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10) RETURNING *`,
    [String(p.worldId), String(p.goalId), version,
      validated.plan.title, validated.plan.summary, validated.plan.overview,
      JSON.stringify(validated.plan.phases.map((ph) => ({ no: ph.no, title: ph.title, purpose: ph.purpose, dependsOn: ph.dependsOn }))),
      JSON.stringify(validated.plan.risks), llmCallId,
      ('sha:' + (built_digest(validated.plan) )).slice(0, 128)]
  );
  const plan = ins.rows[0];
  // P2-6：继承上一版本的人工风险锁——同 goal 上一版本中 human_risk_locked 的 step，
  // 新版本即使 AI 标成 low 也保持人工等级（人工设定优先，合并键= phase_no+seq+tool_name）
  let humanLocks = {};
  if (version > 1) {
    const prev = await query(
      `SELECT s.phase_no, s.seq, s.tool_name, s.risk_tier FROM world_plan_steps s
         JOIN world_plans p ON p.id = s.plan_id
        WHERE p.world_id = $1 AND p.goal_id = $2 AND p.version = $3 AND s.human_risk_locked = true`,
      [String(p.worldId), String(p.goalId), version - 1]
    );
    for (const r of prev.rows) humanLocks[r.phase_no + ':' + r.seq + ':' + r.tool_name] = r.risk_tier;
  }
  const stepRows = [];
  for (const ph of validated.plan.phases) {
    for (const st of ph.steps) {
      const lockKey = ph.no + ':' + st.seq + ':' + st.tool_name;
      const lockedRisk = humanLocks[lockKey];
      stepRows.push([plan.id, ph.no, st.seq, st.tool_name, JSON.stringify(st.params), st.rationale, JSON.stringify(st.expected_effect),
        lockedRisk || st.risk_tier, !!lockedRisk]);
    }
  }
  if (stepRows.length) {
    for (const r of stepRows) {
      await query(
        `INSERT INTO world_plan_steps (plan_id, phase_no, seq, tool_name, params, rationale, expected_effect, risk_tier, human_risk_locked, status)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,'pending')`,
        r
      );
    }
  }
  await query(`UPDATE world_plans SET progress = $2::jsonb WHERE id = $1`, [plan.id,
    JSON.stringify({ totalSteps: stepRows.length, doneSteps: 0, failedSteps: 0, currentStepId: null })]);

  // P2-8：generate 后产生 world 记忆
  await memoryService.write({ worldId: p.worldId, scope: 'world', kind: 'decision', source: 'planner',
    subject_id: String(plan.id), importance: 3,
    content: '为目标「' + goal.title + '」生成规划 v' + version + '「' + plan.title + '」：' + (plan.summary || plan.title).slice(0, 120) + '（draft，待人工审核）' });

  return { ok: true, plan, stats: validated.stats };
}

/** 简易内容指纹（prompt_digest 位；完整 untrusted 片段计数属 Phase 4 感知） */
function built_digest(plan) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(JSON.stringify(plan.phases)).digest('hex').slice(0, 32);
}

/** 容忍模型在 JSON 前后加解释文字 / ```json 围栏（与 missionPlanner 同款） */
function parseJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}

module.exports = { generate, parseJson };
