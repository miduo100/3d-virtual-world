/**
 * longTermMission —— 长期使命 Long-term Mission（AI World Brain · Phase 7b · §I.6）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 命名说明：同目录的 `missionService.js` 是 **Phase 3.5 的建设委托服务**（world_build_missions，
 *   missionRunner 在用），本文件是 Phase 7b 的长期使命（world_missions）——两者生命周期完全不同，
 *   绝不合并（§I.6 注意事项 8）。
 *
 * 定位：world_plans 是"干一票"，长期使命是"雇一个管家管一两年"。使命管方向与节奏，
 * Plan 管单次执行。核心设计 = **滚动规划**：远处定方向（阶段，季度粒度），近处做细节（周计划）。
 *
 * 七条纪律（§I.6 开发注意事项，全部落进本模块）：
 *   1) 定时循环 = scheduler 的 setTimeout 链（tick_weekly / tick_monthly），本模块不自己起定时器；
 *   2) 月度预算每月 1 日发放（按服务器时间）；used 从 ai_call_log / world_tool_executions 聚合，绝不清账本；
 *   3) 优化规则确定性先行（Phase 7 optimizer），本模块的 LLM 只做"怎么动"；
 *   4) 周计划走 llmClient purpose='plan'；失败**不静默**——沿用上周节奏 + 记 memory + 返回 flagged；
 *   5) 红线零旁路：使命状态机无权改 world_ai_configs.risk_policy / 区域自主度；
 *   6) 每月强制人机决策（pendingQuestion）：30 天未答自动 paused，不默认"听 AI 的"；
 *   7) 暂停/终止不删任何东西（world_objects 都是普通行，批次回滚能力保留）。
 *
 * 验收专用钩子：opts._test_forceLlmFailure=true 时跳过 LLM 直接走"失败降级"分支
 *   （与 worldai/config.useWorldId 同款的显式测试口，避免验收真调 LLM）。
 */
'use strict';

const { query } = require('../../database/db');
const memoryService = require('../memory/memoryService');
const promptBuilder = require('../llm/promptBuilder');
const providerRouter = require('../llm/providerRouter');

const ACTIVE_STATUSES = ['draft', 'running', 'paused', 'awaiting_review'];
const DEFAULT_LIMITS = { tokens: 0, objects: 200, demolitions: 20 }; // 0 = 不限

function bad(code, reason) { return { ok: false, code, reason }; }
function monthKey(d) { const x = d || new Date(); return x.toISOString().slice(0, 7); }
function isoWeek(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((x - yearStart) / 86400000) + 1) / 7);
  return x.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}
async function getMission(id) {
  return (await query(`SELECT * FROM world_missions WHERE id=$1`, [String(id)])).rows[0] || null;
}

// ── 查询 ──────────────────────────────────────────────────────────

async function getActive(worldId) {
  const r = await query(
    `SELECT * FROM world_missions WHERE world_id=$1 AND status = ANY($2::varchar[])
      ORDER BY created_at DESC LIMIT 1`, [String(worldId), '{' + ACTIVE_STATUSES.join(',') + '}']);
  return r.rows[0] || null;
}
async function listMissions(worldId) {
  const r = await query(
    `SELECT * FROM world_missions WHERE world_id=$1 ORDER BY created_at DESC LIMIT 20`, [String(worldId)]);
  return r.rows || [];
}
/** 生成前注入（§I.6 技术保障①）：给 worldPlanner / 周计划用的使命上下文；无使命返回 null */
async function getMissionContext(worldId) {
  const m = await getActive(worldId);
  if (!m || m.status === 'draft') return null;
  const phases = Array.isArray(m.phases) ? m.phases : [];
  const cur = phases.find((p) => Number(p.seq) === Number(m.current_phase)) || null;
  return '长期使命：' + String(m.statement).slice(0, 300)
    + '\n当前阶段（' + m.current_phase + '/' + phases.length + '）'
    + (cur ? '「' + String(cur.title).slice(0, 60) + '」：' + String(cur.goal).slice(0, 200) : '（无目标）');
}

// ── 状态机（draft→running→(paused⇄running)→finished/terminated）────────

/** 校验阶段数组：1~8 个，{seq,title,goal} 必填 */
function validatePhases(phases) {
  if (!Array.isArray(phases) || !phases.length || phases.length > 8) {
    return { ok: false, reason: 'phases 必须是 1~8 个阶段' };
  }
  for (const p of phases) {
    if (!p || !p.title || !p.goal) return { ok: false, reason: '每个阶段必须带 title 与 goal' };
  }
  return { ok: true, phases: phases.map((p, i) => ({
    seq: Number(p.seq) || i + 1, title: String(p.title).slice(0, 120), goal: String(p.goal).slice(0, 500),
    milestoneCheck: String(p.milestoneCheck || '').slice(0, 300), status: 'pending',
  })) };
}
/** 确定性兜底阶段模板（LLM 阶段拆分可用 proposePhases 注入覆盖） */
function fallbackPhases(statement) {
  return ['摸底与试点：选 1 个区域小步建设，跑通规划→审批→执行→验证闭环',
    '规模化建设：按北极星指标铺开内容，覆盖冷区激活与引导缺口',
    '活动与留存：组织周期性活动，拉参与率与回访',
    '评审与交接：里程碑评审，沉淀经验并为下一轮使命做候选'].map((g, i) => ({
    seq: i + 1, title: '阶段 ' + (i + 1), goal: g, milestoneCheck: '', status: 'pending',
  }));
}

async function createMission(o) {
  const p = o || {};
  if (!p.worldId || !p.statement) return bad('PARAMS_REQUIRED', '必须给 worldId 与 statement');
  const v = p.phases ? validatePhases(p.phases) : { ok: true, phases: fallbackPhases(p.statement) };
  if (!v.ok) return bad('PHASES_INVALID', v.reason);
  try {
    const ins = await query(
      `INSERT INTO world_missions (world_id, statement, north_star, phases, monthly_budget, status)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'draft') RETURNING *`,
      [String(p.worldId), String(p.statement).slice(0, 2000),
        JSON.stringify(p.northStar && typeof p.northStar === 'object' ? p.northStar : {}),
        JSON.stringify(v.phases),
        JSON.stringify({ limits: Object.assign({}, DEFAULT_LIMITS, (p.monthlyBudget && p.monthlyBudget.limits) || {}), used: {} })]);
    return { ok: true, mission: ins.rows[0] };
  } catch (e) {
    if (String(e.message).indexOf('uq_world_missions_active') >= 0) {
      return bad('ACTIVE_EXISTS', '该世界已有一个进行中的长期使命（每世界同时最多 1 个）');
    }
    return bad('DB_ERROR', String(e.message).slice(0, 200));
  }
}

const TRANSITIONS = {
  start: { from: ['draft'], to: 'running', extra: 'started_at=NOW()' },
  pause: { from: ['running', 'awaiting_review'], to: 'paused', extra: '' },
  resume: { from: ['paused'], to: 'running', extra: '' },
  finish: { from: ['running', 'paused', 'awaiting_review'], to: 'finished', extra: 'finished_at=NOW()' },
  terminate: { from: ['draft', 'running', 'paused', 'awaiting_review'], to: 'terminated', extra: 'finished_at=NOW()' },
};

async function setStatus(id, action, reason) {
  const t = TRANSITIONS[action];
  if (!t) return bad('UNKNOWN_ACTION', '未知动作：' + action);
  const r = await query(
    `UPDATE world_missions SET status=$2, paused_reason=$3, updated_at=NOW()` + (t.extra ? ', ' + t.extra : '') +
    ` WHERE id=$1 AND status = ANY($4::varchar[]) RETURNING *`,
    [String(id), t.to, action === 'pause' ? String(reason || '人工暂停').slice(0, 300) : null, '{' + t.from.join(',') + '}']);
  if (!r.rows.length) {
    const m = await getMission(id);
    return bad('ILLEGAL_TRANSITION', '非法状态迁移：' + action + '（当前 status=' + (m ? m.status : '不存在') + '）');
  }
  return { ok: true, mission: r.rows[0] };
}

/** 调整方向：只暂存，**从下一阶段起生效**（§I.6：当前阶段按原目标跑完，避免半途变向） */
async function adjustStatement(id, newStatement) {
  if (!newStatement || !String(newStatement).trim()) return bad('STATEMENT_REQUIRED', '新使命文本不能为空');
  const m = await getMission(id);
  if (!m) return bad('NOT_FOUND', '使命不存在');
  await query(`UPDATE world_missions SET pending_statement=$2, updated_at=NOW() WHERE id=$1`,
    [String(id), String(newStatement).slice(0, 2000)]);
  await memoryService.write({ worldId: m.world_id, scope: 'world', kind: 'decision', source: 'mission',
    subject_id: String(id), importance: 4,
    content: '管理员调整长期使命方向（自第 ' + (Number(m.current_phase) + 1) + ' 阶段起生效）：' + String(newStatement).slice(0, 160) });
  return { ok: true, effectiveFromPhase: Number(m.current_phase) + 1 };
}

/** 里程碑评审：达标→下一阶段；不达标→awaiting_review + 3 个调整方案（§I.6 滚动规划末端） */
async function reviewMilestone(id, o) {
  const p = o || {};
  const m = await getMission(id);
  if (!m) return bad('NOT_FOUND', '使命不存在');
  if (m.status !== 'running') return bad('NOT_RUNNING', '使命不在运行中（status=' + m.status + '）');
  const phases = Array.isArray(m.phases) ? m.phases.slice() : [];
  const cur = phases.find((x) => Number(x.seq) === Number(m.current_phase));
  if (!cur) return bad('PHASE_MISSING', '当前阶段缺失');

  if (p.passed !== false) {
    cur.status = 'done';
    const nextSeq = Number(m.current_phase) + 1;
    const next = phases.find((x) => Number(x.seq) === nextSeq);
    const patch = {
      phases,
      current_phase: Math.min(nextSeq, phases.length),
      statement: m.pending_statement || m.statement,   // ★ 调整方向在这里生效
      pending_statement: null,
    };
    let finished = false;
    if (!next) { finished = true; patch.status = 'finished'; patch.finished_at = new Date(); }
    else next.status = 'active';
    const upd = await query(
      `UPDATE world_missions SET phases=$2::jsonb, current_phase=$3, statement=$4, pending_statement=NULL,
         status=$5::varchar, finished_at=CASE WHEN $5::varchar='finished' THEN NOW() ELSE finished_at END, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [String(id), JSON.stringify(patch.phases), patch.current_phase, patch.statement, finished ? 'finished' : 'running']);
    await memoryService.write({ worldId: m.world_id, scope: 'world', kind: 'decision', source: 'mission',
      subject_id: String(id), importance: 4,
      content: '阶段「' + String(cur.title).slice(0, 60) + '」里程碑评审通过' + (m.pending_statement ? '，并按新使命方向进入下一阶段' : '') });
    return { ok: true, advanced: true, finished, mission: upd.rows[0] };
  }

  // 不达标：AI 给 3 个调整方案（验收走确定性兜底；接入 LLM 后由 purpose='summary' 生成）
  const options = Array.isArray(p.options) && p.options.length >= 2
    ? p.options.slice(0, 3).map((s) => String(s).slice(0, 300))
    : ['降低本阶段目标范围，只保核心场景', '延长本阶段 4 周，补足参与率后再评审', '调整北极星指标口径（更关注质量而非数量）'];
  const upd = await query(
    `UPDATE world_missions SET status='awaiting_review', review_options=$2::jsonb, updated_at=NOW()
      WHERE id=$1 RETURNING *`, [String(id), JSON.stringify(options)]);
  return { ok: true, advanced: false, awaitingReview: true, options, mission: upd.rows[0] };
}

/** 采纳某个调整方案 → 回 running（管理员三选 / "听 AI 的"） */
async function applyReviewChoice(id, choiceIndex) {
  const m = await getMission(id);
  if (!m || m.status !== 'awaiting_review') return bad('NOT_AWAITING_REVIEW', '使命不在等待评审状态');
  const options = Array.isArray(m.review_options) ? m.review_options : [];
  const choice = options[Number(choiceIndex)] || options[0] || '';
  const upd = await query(
    `UPDATE world_missions SET status='running', paused_reason=NULL, updated_at=NOW() WHERE id=$1 RETURNING *`, [String(id)]);
  await memoryService.write({ worldId: m.world_id, scope: 'world', kind: 'decision', source: 'mission',
    subject_id: String(id), importance: 4, content: '里程碑调整方案已采纳：' + String(choice).slice(0, 160) });
  return { ok: true, mission: upd.rows[0], adopted: choice };
}

// ── 月度预算（§I.6 注意事项 2：每月 1 日发放；used 聚合账本，绝不清账本）────────

/** 当月用量：ai_call_log（tokens/调用）+ world_tool_executions（succeeded 建类 / 拆类） */
async function getMonthlyUsage(worldId) {
  const r1 = await query(
    `SELECT COALESCE(SUM(total_tokens),0)::bigint AS tokens, count(*)::int AS calls
       FROM ai_call_log WHERE created_at >= date_trunc('month', NOW())`);
  const r2 = await query(
    `SELECT count(*) FILTER (WHERE tool_name LIKE 'create%' OR tool_name LIKE 'assemble%')::int AS objects,
            count(*) FILTER (WHERE tool_name IN ('delete_object','remove_building'))::int AS demolitions
       FROM world_tool_executions
      WHERE status='succeeded' AND created_at >= date_trunc('month', NOW())`);
  return {
    tokens: Number(r1.rows[0].tokens) || 0, llmCalls: Number(r1.rows[0].calls) || 0,
    objects: Number(r2.rows[0].objects) || 0, demolitions: Number(r2.rows[0].demolitions) || 0,
  };
}

/** 每月 1 日发放：monthly_budget.month ≠ 当月 → 重置（used 里只有累计型计数器 weeklyPlans 保留归零） */
async function grantMonthlyBudgetIfNeeded(m) {
  const b = m.monthly_budget && typeof m.monthly_budget === 'object' ? m.monthly_budget : {};
  if (b.month === monthKey()) return { granted: false, budget: m.monthly_budget };
  const limits = Object.assign({}, DEFAULT_LIMITS, b.limits || {});
  const nb = { month: monthKey(), limits, used: { weeklyPlans: 0 } };
  const upd = await query(
    `UPDATE world_missions SET monthly_budget=$2::jsonb, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [m.id, JSON.stringify(nb)]);
  return { granted: true, budget: upd.rows[0].monthly_budget };
}

/** 预算闸：超限 → ok=false（用完自动降速：不发起新委托，进行中的跑完；绝不清账本） */
async function checkMonthlyBudget(m) {
  const usage = await getMonthlyUsage(m.world_id);
  const b = m.monthly_budget || {};
  const limits = Object.assign({}, DEFAULT_LIMITS, (b && b.limits) || {});
  const over = [];
  if (limits.tokens > 0 && usage.tokens >= limits.tokens) over.push('tokens ' + usage.tokens + '/' + limits.tokens);
  if (limits.objects > 0 && usage.objects >= limits.objects) over.push('objects ' + usage.objects + '/' + limits.objects);
  if (limits.demolitions > 0 && usage.demolitions >= limits.demolitions) over.push('demolitions ' + usage.demolitions + '/' + limits.demolitions);
  return { ok: over.length === 0, over, usage, limits };
}

// ── 周计划（滚动规划"近处做细节"）────────────────────────────────────

function parseJsonLoose(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}

/** 周计划 JSON 最小校验：动作动词必须在 verbRegistry（红线 5：零旁路） */
function validateWeeklyPlan(plan) {
  if (!plan || typeof plan !== 'object') return { ok: false, reason: '不是对象' };
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  if (actions.length > 20) return { ok: false, reason: '周动作数 ≤20' };
  const registry = require('../tools/verbRegistry');
  require('../runtime/executor').ensureLoaded();
  for (const a of actions) {
    if (!a || !a.verb || !registry.has(a.verb)) {
      return { ok: false, reason: '未知动词：' + String(a && a.verb) + '（不在注册表，拒绝执行口径见 P2-7b）' };
    }
  }
  return { ok: true, plan: {
    title: String(plan.title || '本周计划').slice(0, 120),
    focus: (Array.isArray(plan.focus) ? plan.focus : []).slice(0, 6).map((s) => String(s).slice(0, 160)),
    actions: actions.slice(0, 20).map((a) => ({ verb: String(a.verb), params: a.params && typeof a.params === 'object' ? a.params : {}, why: String(a.why || '').slice(0, 200) })),
    notes: String(plan.notes || '').slice(0, 500),
  } };
}

/**
 * 生成周计划（runWeeklyTick 的核心）。幂等：同一 ISO 周只生成一次。
 * @param {object} opts { inject?:object（验收/演练注入，不调 LLM）, _test_forceLlmFailure?:boolean }
 */
async function generateWeeklyPlan(worldId, opts) {
  const o = opts || {};
  const m = await getActive(worldId);
  if (!m) return { ok: false, code: 'NO_MISSION', reason: '没有进行中的长期使命' };
  if (m.status !== 'running') return { ok: false, code: 'NOT_RUNNING', reason: '使命不在运行中（status=' + m.status + '）' };

  await grantMonthlyBudgetIfNeeded(m);
  const cur = await getMission(m.id);
  const budget = await checkMonthlyBudget(cur);
  const week = isoWeek(new Date());
  const wp = cur.weekly_plan && typeof cur.weekly_plan === 'object' ? cur.weekly_plan : {};
  if (wp.week === week) return { ok: true, skipped: 'already_planned', week, plan: wp };
  if (!budget.ok) {
    return { ok: false, code: 'budget_exhausted', flagged: true, reason: '月度预算已用尽（' + budget.over.join('；') + '），本月不再发起新委托', usage: budget.usage };
  }

  const phases = Array.isArray(cur.phases) ? cur.phases : [];
  const phase = phases.find((x) => Number(x.seq) === Number(cur.current_phase)) || null;
  let plan = null, source = null, llmError = null;

  if (o.inject) {
    const v = validateWeeklyPlan(o.inject);
    if (!v.ok) return { ok: false, code: 'PLAN_INVALID', reason: v.reason };
    plan = v.plan; source = 'injected';
  } else {
    // LLM 路径（purpose='plan'，必经 promptBuilder，落 ai_call_log）
    try {
      if (o._test_forceLlmFailure) throw new Error('TEST_FORCED_LLM_FAILURE');
      const built = promptBuilder.build({
        purpose: 'plan',
        ctx: {
          world: { name: '本世界', stats: {} },
          task: { prompt: '为长期使命生成本周计划。使命：' + String(cur.statement).slice(0, 400)
            + (phase ? '\n当前阶段目标：' + String(phase.goal).slice(0, 300) : '')
            + '\n只输出 JSON：{"title","focus":[..],"actions":[{"verb","params","why"}],"notes"}，动词必须来自给定工具清单。',
            constraints: {} },
          tools: require('../tools/verbRegistry').toLLM().slice(0, 30),
          allowedTools: null, memories: [], parts: [], history: [], untrusted: [],
          contextWindowTokens: null, nearDist: 0, midDist: 0,
        },
      });
      const router = await providerRouter.resolve('plan', { worldId });
      if (!router.provider) throw new Error('NO_PROVIDER: ' + (router.reason || '没有可用 provider'));
      const chat = await require('../../services/llmClient').chat({
        provider: router.provider, messages: built.messages, temperature: 0.4, maxTokens: 1200,
        purpose: 'plan', caller: 'world_ai_mission_weekly', timeoutMs: 60000, retries: 1,
      });
      const raw = parseJsonLoose(chat.content);
      const v = validateWeeklyPlan(raw);
      if (!v.ok) throw new Error('PLAN_INVALID: ' + v.reason);
      plan = v.plan; source = 'llm';
    } catch (e) {
      llmError = String(e && e.message).slice(0, 200);
    }
  }

  if (!plan) {
    // ★ 失败不静默（§I.6 注意事项 4）：沿用上周节奏 + 记 memory + flagged
    const carry = wp && wp.actions ? {
      week, title: wp.title || '本周计划（沿用上周节奏）',
      focus: wp.focus || [], actions: wp.actions || [], notes: String(wp.notes || '') + '（沿用上周节奏）',
      source: 'carryover', generatedAt: new Date().toISOString(), flagged: true, carryReason: llmError || 'LLM 失败',
    } : {
      week, title: '本周计划（待生成）', focus: [], actions: [], notes: '本周计划生成失败，待人工/下轮重试',
      source: 'carryover', generatedAt: new Date().toISOString(), flagged: true, carryReason: llmError || 'LLM 失败',
    };
    await query(`UPDATE world_missions SET weekly_plan=$2::jsonb, updated_at=NOW() WHERE id=$1`, [cur.id, JSON.stringify(carry)]);
    await memoryService.write({ worldId, scope: 'world', kind: 'lesson', source: 'mission',
      subject_id: 'mission_weekly:' + week, importance: 3,
      content: '周计划生成失败已降级沿用上周（' + week + '）：' + (llmError || 'LLM 失败') });
    return { ok: true, degraded: true, flagged: true, source: 'carryover', reason: llmError || 'LLM 失败', plan: carry };
  }

  const nb = cur.monthly_budget || {};
  const used = Object.assign({ weeklyPlans: 0 }, nb.used || {});
  used.weeklyPlans = Number(used.weeklyPlans) + 1;
  const saved = {
    week, title: plan.title, focus: plan.focus, actions: plan.actions, notes: plan.notes,
    source, generatedAt: new Date().toISOString(), flagged: false,
    phase: phase ? phase.title : null,
  };
  const upd = await query(
    `UPDATE world_missions SET weekly_plan=$2::jsonb, monthly_budget=$3::jsonb, updated_at=NOW() WHERE id=$1 RETURNING weekly_plan`,
    [cur.id, JSON.stringify(saved), JSON.stringify(Object.assign({}, nb, { used }))]);
  return { ok: true, source, week, plan: upd.rows[0].weekly_plan };
}

// ── 月报（每月一次；★必须携带 pendingQuestion）──────────────────────

function fallbackQuestion(m, phase) {
  return {
    question: '当前阶段「' + (phase ? String(phase.title).slice(0, 60) : '-') + '」目标是：'
      + (phase ? String(phase.goal).slice(0, 200) : '（无）') + '。下月继续按此目标推进，还是调整方向？',
    options: ['继续当前目标', '调整方向（请在备注说明）', '听 AI 的（按数据自行决定）'],
    askedAt: new Date().toISOString(), answered: null,
  };
}

/** 月报（runMonthlyTick 核心）。幂等：同一自然月只生成一次。 */
async function generateMonthlyReport(worldId, opts) {
  const o = opts || {};
  const m = await getActive(worldId);
  if (!m) return { ok: false, code: 'NO_MISSION', reason: '没有进行中的长期使命' };
  const month = monthKey();
  if (m.last_report && m.last_report.month === month) {
    return { ok: true, skipped: 'already_reported', month, report: m.last_report };
  }
  const usage = await getMonthlyUsage(worldId);
  const b = m.monthly_budget || {};
  const limits = Object.assign({}, DEFAULT_LIMITS, (b.limits) || {});
  const phases = Array.isArray(m.phases) ? m.phases : [];
  const phase = phases.find((x) => Number(x.seq) === Number(m.current_phase)) || null;
  const prev = monthKey(new Date(Date.now() - 31 * 86400000));
  let visitsNow = 0, visitsPrev = 0;
  try {
    const mr = await query(
      `SELECT day, (metrics->>'visits')::int AS visits FROM world_metrics_daily
        WHERE day >= $1 AND day < date_trunc('month', NOW()) + interval '1 month'`,
      [prev + '-01']);
    for (const r of mr.rows) {
      const k = String(r.day).slice(0, 7);
      if (k === month) visitsNow += Number(r.visits) || 0;
      else if (k === prev) visitsPrev += Number(r.visits) || 0;
    }
  } catch (e) { /* metrics 缺表/缺列不阻断月报 */ }

  const wp = m.weekly_plan || {};
  const report = {
    month,
    did: '本月生成周计划 ' + ((b.used && b.used.weeklyPlans) || 0) + ' 份'
      + (wp.title ? '；本周重点「' + String(wp.title).slice(0, 60) + '」' : ''),
    dataCompare: { visitsThisMonth: visitsNow, visitsLastMonth: visitsPrev,
      llmTokens: usage.tokens, llmCalls: usage.llmCalls, objectsBuilt: usage.objects, demolitions: usage.demolitions },
    promises: '预算用量：tokens ' + usage.tokens + '/' + (limits.tokens || '不限')
      + '，objects ' + usage.objects + '/' + (limits.objects || '不限')
      + '，demolitions ' + usage.demolitions + '/' + (limits.demolitions || '不限'),
    nextMonth: phase ? '继续阶段「' + String(phase.title).slice(0, 60) + '」：' + String(phase.goal).slice(0, 200) : '进入下一阶段（待里程碑评审）',
    pendingQuestion: o.injectQuestion || fallbackQuestion(m, phase),   // LLM 增强留接口；确定性兜底保底
    generatedAt: new Date().toISOString(),
  };
  await query(`UPDATE world_missions SET last_report=$2::jsonb, updated_at=NOW() WHERE id=$1`, [m.id, JSON.stringify(report)]);
  return { ok: true, month, report };
}

/** 管理员回答月报问题（三选：A/B/听 AI 的 + 备注）；未答不默认任何选项（§I.6 注意事项 6） */
async function answerQuestion(id, choice, note) {
  const m = await getMission(id);
  if (!m || !m.last_report || !m.last_report.pendingQuestion) return bad('NO_QUESTION', '没有待回答的月报问题');
  if (m.last_report.pendingQuestion.answered) return bad('ALREADY_ANSWERED', '该月报问题已回答（幂等）');
  const idx = Math.max(0, Math.min(2, Number(choice) || 0));
  const report = m.last_report;
  report.pendingQuestion.answered = {
    choice: idx, choiceText: (report.pendingQuestion.options || [])[idx] || '',
    note: String(note || '').slice(0, 500), at: new Date().toISOString(),
  };
  await query(`UPDATE world_missions SET last_report=$2::jsonb, updated_at=NOW() WHERE id=$1`, [String(id), JSON.stringify(report)]);
  await memoryService.write({ worldId: m.world_id, scope: 'world', kind: 'decision', source: 'mission',
    subject_id: String(id), importance: 4,
    content: '月报问题已回答（' + monthKey() + '）：' + report.pendingQuestion.answered.choiceText + (note ? '｜备注：' + String(note).slice(0, 120) : '') });
  return { ok: true, answered: report.pendingQuestion.answered };
}

/** 30 天未答 → 自动 paused + 原因（防选项疲劳后无人把关；不默认"听 AI 的"） */
async function checkPendingQuestionTimeout(worldId) {
  const m = await getActive(worldId);
  if (!m || m.status !== 'running' || !m.last_report || !m.last_report.pendingQuestion) {
    return { ok: true, paused: false };
  }
  const q = m.last_report.pendingQuestion;
  if (q.answered) return { ok: true, paused: false };
  const asked = new Date(q.askedAt || 0).getTime();
  if (!asked || Date.now() - asked < 30 * 86400000) return { ok: true, paused: false };
  const r = await query(
    `UPDATE world_missions SET status='paused', paused_reason=$2, updated_at=NOW()
      WHERE id=$1 AND status='running' RETURNING *`,
    [m.id, '月报方向性问题超过 30 天未回答，自动暂停（请到后台查看月报并回答）']);
  return { ok: true, paused: r.rows.length > 0, reason: r.rows.length ? r.rows[0].paused_reason : null };
}

// ── scheduler tick 入口（weekly / monthly；均幂等，天然适合频繁触发）────

async function runWeeklyTick(worldId) {
  const r = await generateWeeklyPlan(worldId, {});
  return { ok: true, action: 'tick_weekly', result: r };
}
async function runMonthlyTick(worldId) {
  const m = await getActive(worldId);
  if (!m) return { ok: true, action: 'tick_monthly', result: { ok: false, code: 'NO_MISSION' } };
  await grantMonthlyBudgetIfNeeded(m);
  const rep = await generateMonthlyReport(worldId, {});
  const timeout = await checkPendingQuestionTimeout(worldId);
  return { ok: true, action: 'tick_monthly', result: { report: rep, questionTimeout: timeout } };
}

module.exports = {
  ACTIVE_STATUSES, DEFAULT_LIMITS,
  listMissions, getActive, getMission, getMissionContext,
  createMission, setStatus, adjustStatement, reviewMilestone, applyReviewChoice,
  validatePhases, validateWeeklyPlan, fallbackPhases,
  getMonthlyUsage, grantMonthlyBudgetIfNeeded, checkMonthlyBudget,
  generateWeeklyPlan, generateMonthlyReport, answerQuestion, checkPendingQuestionTimeout,
  runWeeklyTick, runMonthlyTick,
};
