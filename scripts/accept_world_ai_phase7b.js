/**
 * accept_world_ai_phase7b —— Phase 7b 验收（判据 P7b-1 ~ P7b-11）
 * AI World Brain · Phase 7b · §I.6 长期使命 Long-term Mission（world_missions + 月报 + 月度预算）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 运行：node scripts/accept_world_ai_phase7b.js
 * 前置：本地 3002 已重启（迁移 add_world_missions.sql + worldAiMission 路由 + scheduler 扩展已加载）。
 * 纪律：①LLM 零调用（LLM 路径用 inject / _test_forceLlmFailure 钩子，ai_call_log 不新增成功调用）；
 *       ②测试数据 accept_p7b_ 前缀，清理按前缀全量清（不带 created_at 过滤）；③每条清理 SQL 独立 try/catch。
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { execSync, spawnSync } = require('child_process');

const BASE = process.env.ACCEPT_BASE || 'http://127.0.0.1:3002';
const ADMIN = { username: 'baseline_shot', password: 'Baseline#185' };
const P = 'accept_p7b';
const STMT = P + '_使命：把这个世界经营成有烟火气的中世纪小镇';

let pass = 0, fail = 0;
const fails = [];
function log(name, ok, note) {
  if (ok) { pass++; console.log('PASS  ' + name + (note ? '  —— ' + note : '')); }
  else { fail++; fails.push(name); console.log('FAIL  ' + name + (note ? '  —— ' + note : '')); }
}
/** FATAL：计入失败（否则 0 FAIL 也会误报 ACCEPTED）+ 收尾退出；调用处必须 `return FATAL(...)` */
function FATAL(msg) {
  fail++; fails.push('FATAL: ' + msg);
  console.log('FATAL ' + msg);
  finish();
  return false;
}

let T = null, W = null;
const snap = {};
const box = {};
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(p, opts) {
  const o = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (T && !o.noAuth) headers['Authorization'] = 'Bearer ' + T;
  const r = await fetch(BASE + p, {
    method: o.method || 'GET', headers,
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, j: j || {} };
}

const { query, pool } = require('../src/database/db');
const missionService = require('../src/worldai/missions/longTermMission');
const scheduler = require('../src/worldai/runtime/scheduler');
const configService = require('../src/services/configService');

// ── 清理 / 还原（每条独立 try/catch：一句错不能中断整段清理 —— Phase 8 教训）──
async function cleanup() {
  const sqls = [
    [`DELETE FROM world_memories WHERE subject_id LIKE $1 OR content LIKE $2`, [P + '%', '%' + P + '%']],
    [`DELETE FROM world_tool_executions WHERE actor LIKE $1 OR params::text LIKE $2`, [P + '%', '%' + P + '%']],
    [`DELETE FROM ai_call_log WHERE caller LIKE $1`, [P + '%']],
    [`DELETE FROM world_missions WHERE statement LIKE $1 OR pending_statement LIKE $1`, [P + '%']],
  ];
  for (const [sql, params] of sqls) {
    try { await query(sql, params); } catch (e) { console.log('  (cleanup warn) ' + e.message); }
  }
}
async function restore() {
  try {
    if (snap.schedule !== undefined && snap.schedule !== null) {
      await api('/api/world-ai/config', { method: 'PUT', body: { schedule: snap.schedule } });
    }
  } catch (e) { console.log('  (restore warn) ' + e.message); }
}
function finish() {
  const done = () => {
    console.log('\n===== Phase 7b 验收结果：' + pass + ' PASS / ' + fail + ' FAIL =====');
    if (fails.length) console.log('失败项：' + fails.join(' | '));
    console.log(fail === 0 ? 'VERDICT ACCEPTED' : 'VERDICT FAILED');
    try { pool.end().then(() => process.exit(fail ? 1 : 0)); } catch (e) { /* ignore */ }
    setTimeout(() => process.exit(fail ? 1 : 0), 1500);
  };
  restore().then(() => cleanup()).then(done).catch(done);
}

async function countObjects() {
  return Number((await query(`SELECT count(1)::int AS c FROM world_objects`)).rows[0].c);
}
/** 重启本地 3002（清 eventLog 速率保护 / 管理员登录限流的内存计数器） */
function restartServer() {
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    const pids = new Set();
    out.split(/\r?\n/).forEach((line) => {
      if (!/:3002\s/.test(line)) return;
      const mm = line.trim().split(/\s+/);
      const pid = mm[mm.length - 1];
      if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    });
    for (const pid of pids) {
      try { execSync('taskkill /PID ' + pid + ' /T /F', { encoding: 'utf8' }); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  const child = require('child_process').spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'), detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
}
async function countCallLog() {
  return Number((await query(`SELECT count(1)::int AS c FROM ai_call_log`)).rows[0].c);
}

// ══════════════════════════════════════════════════════════════════
async function main() {
  console.log('=== Phase 7b 验收开始（P7b-1 ~ P7b-11）===');
  await cleanup();

  const login = await api('/api/admin-auth/login', { method: 'POST', body: ADMIN, noAuth: true });
  if (!login.j || !login.j.token) return FATAL('管理员登录失败：' + JSON.stringify(login.j).slice(0, 150));
  T = login.j.token;
  const wk = await api('/.well-known/virtual-world-agent.json', { noAuth: true });
  W = (wk.j && wk.j.world && wk.j.world.id) || await require('../src/worldai/config').getWorldId(); // ★ 权威 worldId（Phase 8 教训）
  const cfg0 = await api('/api/world-ai/config');
  snap.schedule = cfg0.j && cfg0.j.config ? cfg0.j.config.schedule : null;
  console.log('  world=' + W);

  // ═══ P7b-1 迁移 + 每世界最多 1 个 active ═══
  const t1 = await query(`SELECT to_regclass('public.world_missions') IS NOT NULL AS ok`);
  const idx = await query(
    `SELECT count(1)::int AS n FROM pg_indexes WHERE indexname='uq_world_missions_active' AND indexdef ILIKE '%WHERE%'`);
  log('P7b-1a world_missions 表 + active 部分唯一索引存在',
    t1.rows[0].ok === true && idx.rows[0].n === 1, '');
  const c1 = await missionService.createMission({ worldId: W, statement: STMT, northStar: { metric: 'dau', target: 20, check: 'monthly' } });
  log('P7b-1b 创建使命 → draft + 阶段落库', c1.ok === true && c1.mission.status === 'draft'
    && Array.isArray(c1.mission.phases) && c1.mission.phases.length >= 1, 'phases=' + (c1.mission.phases || []).length);
  box.m1 = c1.mission.id;
  const c2 = await missionService.createMission({ worldId: W, statement: P + '_第二个使命' });
  log('P7b-1c 第二个 active 使命被拒（每世界最多 1 个）', c2.ok === false && c2.code === 'ACTIVE_EXISTS', c2.code);

  // ═══ P7b-2 状态机 ═══
  const objBefore = await countObjects();
  const s1 = await missionService.setStatus(box.m1, 'start');
  const s2 = await missionService.setStatus(box.m1, 'pause', '测试暂停');
  const s3 = await missionService.setStatus(box.m1, 'resume');
  const sBad = await missionService.setStatus(box.m1, 'start');   // running 不能再 start
  log('P7b-2a 状态机 start→running→pause→resume 全通', s1.ok && s1.mission.status === 'running'
    && s2.ok && s2.mission.status === 'paused' && s3.ok && s3.mission.status === 'running', '');
  log('P7b-2b 非法迁移被拒（running 不能 start）', sBad.ok === false && sBad.code === 'ILLEGAL_TRANSITION', sBad.code);
  log('P7b-2c 暂停/终止不删任何东西（world_objects 行数不变）', (await countObjects()) === objBefore, '');

  // ═══ P7b-3 里程碑评审 ═══
  const r0 = await missionService.reviewMilestone(box.m1, { passed: false });
  log('P7b-3a 不达标 → awaiting_review + 3 个调整方案',
    r0.ok === true && r0.awaitingReview === true && Array.isArray(r0.options) && r0.options.length === 3, 'options=' + r0.options.length);
  const rc = await missionService.applyReviewChoice(box.m1, 0);
  log('P7b-3b 采纳调整方案 → 回 running', rc.ok === true && rc.mission.status === 'running', rc.adopted.slice(0, 30));
  const adv = await missionService.reviewMilestone(box.m1, { passed: true });
  const mAfter = await missionService.getMission(box.m1);
  log('P7b-3c 达标 → current_phase+1 且上一阶段标 done',
    adv.ok === true && adv.advanced === true && Number(mAfter.current_phase) === 2
      && (mAfter.phases[0].status === 'done'), 'phase=' + mAfter.current_phase);

  // ═══ P7b-4 调整方向从下一阶段生效 ═══
  const newStmt = P + '_新方向：转向海滨度假小镇';
  const adj = await missionService.adjustStatement(box.m1, newStmt);
  const mAdj = await missionService.getMission(box.m1);
  log('P7b-4a adjust 只暂存 pending（当前 statement 不变）',
    adj.ok === true && adj.effectiveFromPhase === 3 && mAdj.statement === STMT && mAdj.pending_statement === newStmt, '');
  const memAdj = await query(`SELECT count(1)::int AS n FROM world_memories WHERE content LIKE '%管理员调整长期使命方向%'`);
  log('P7b-4b 调整写 world 记忆（审计）', memAdj.rows[0].n >= 1, '');
  const adv2 = await missionService.reviewMilestone(box.m1, { passed: true });
  const mNew = await missionService.getMission(box.m1);
  log('P7b-4c 阶段推进时应用新使命文本（pending 清空）',
    adv2.ok === true && mNew.statement === newStmt && mNew.pending_statement === null, '');

  // ═══ P7b-5 周计划（幂等 / inject / 降级 / 预算闸）═══
  await missionService.setStatus(box.m1, 'terminate', '换新使命测周计划');
  const c3 = await missionService.createMission({
    worldId: W, statement: STMT, phases: [
      { seq: 1, title: P + '_阶段一', goal: P + '_先把出生点做热闹' },
      { seq: 2, title: P + '_阶段二', goal: P + '_铺开活动与留客' },
    ],
  });
  box.m2 = c3.mission.id;
  await missionService.setStatus(box.m2, 'start');
  const injectPlan = {
    title: P + '_本周计划', focus: [P + '_激活冷区'],
    actions: [{ verb: 'create_area', params: { name: P + '_区', x: 500, z: 500, width: 20, depth: 20 }, why: '冷区激活' }],
    notes: P,
  };
  const wp1 = await missionService.generateWeeklyPlan(W, { inject: injectPlan });
  log('P7b-5a inject 周计划全链路落库（week/source 正确）',
    wp1.ok === true && wp1.source === 'injected' && wp1.plan.title === injectPlan.title, 'week=' + wp1.week);
  const wp2 = await missionService.generateWeeklyPlan(W, {});
  log('P7b-5b 同一周幂等（already_planned）', wp2.ok === true && wp2.skipped === 'already_planned', '');
  await query(`UPDATE world_missions SET weekly_plan = jsonb_set(weekly_plan, '{week}', '"1999-W01"') WHERE id=$1`, [box.m2]);
  const wp3 = await missionService.generateWeeklyPlan(W, { _test_forceLlmFailure: true });
  log('P7b-5c LLM 失败不静默：沿用上周节奏 + flagged + 记忆',
    wp3.ok === true && wp3.degraded === true && wp3.plan.source === 'carryover' && wp3.flagged === true, wp3.reason);
  const memWp = await query(`SELECT count(1)::int AS n FROM world_memories WHERE content LIKE '%周计划生成失败已降级%'`);
  log('P7b-5d 降级写 memory（后台可见/可追溯）', memWp.rows[0].n >= 1, '');

  // ═══ P7b-6 月报 + pendingQuestion + 30 天超时 ═══
  const mr1 = await missionService.generateMonthlyReport(W, {});
  const q = mr1.report && mr1.report.pendingQuestion;
  log('P7b-6a 月报四段 + 必带 pendingQuestion（问题 + 3 选项）',
    mr1.ok === true && !!mr1.report.did && !!mr1.report.dataCompare && !!mr1.report.promises && !!mr1.report.nextMonth
      && q && q.question && Array.isArray(q.options) && q.options.length === 3, 'month=' + mr1.month);
  const mr2 = await missionService.generateMonthlyReport(W, {});
  log('P7b-6b 同月幂等（already_reported）', mr2.ok === true && mr2.skipped === 'already_reported', '');
  const ans = await missionService.answerQuestion(box.m2, 1, P + '_备注：往海边走');
  log('P7b-6c 回答回写（choice + note + 时间）',
    ans.ok === true && ans.answered.choice === 1 && ans.answered.note.indexOf(P) === 0, '');
  const ans2 = await missionService.answerQuestion(box.m2, 0);
  log('P7b-6d 重复回答 → ALREADY_ANSWERED（幂等）', ans2.ok === false && ans2.code === 'ALREADY_ANSWERED', '');
  await query(
    `UPDATE world_missions SET last_report = jsonb_set(
        jsonb_set(last_report, '{pendingQuestion,answered}', 'null'::jsonb),
        '{pendingQuestion,askedAt}',
        to_jsonb(to_char(NOW() - interval '40 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      WHERE id=$1`, [box.m2]);
  const to = await missionService.checkPendingQuestionTimeout(W);
  const mTo = await missionService.getMission(box.m2);
  log('P7b-6e 30 天未答 → 自动 paused + 原因（不默认"听 AI 的"）',
    to.paused === true && mTo.status === 'paused' && String(mTo.paused_reason).indexOf('天未回答') >= 0,
    'paused=' + to.paused + ' status=' + mTo.status + ' askedAt=' + (mTo.last_report.pendingQuestion ? mTo.last_report.pendingQuestion.askedAt : '-'));

  // ═══ P7b-6f 丢单前还原（供后续用例继续）═══
  await missionService.setStatus(box.m2, 'resume');
  await missionService.setStatus(box.m2, 'resume');

  // ═══ P7b-7 月度预算 ═══
  await query(`UPDATE world_missions SET monthly_budget = jsonb_set(monthly_budget, '{month}', '"1999-01"') WHERE id=$1`, [box.m2]);
  const g1 = await missionService.grantMonthlyBudgetIfNeeded(await missionService.getMission(box.m2));
  log('P7b-7a 月初发放（month 回填口径，不真等）', g1.granted === true && g1.budget.month === new Date().toISOString().slice(0, 7), '');
  const logBefore7 = await countCallLog();
  const fakeTokenRow = await query(
    `INSERT INTO ai_call_log (purpose, caller, ok, total_tokens) VALUES ('plan',$1,TRUE,123) RETURNING id`,
    [P + '_fake_call']);
  const fakeExec = await query(
    `INSERT INTO world_tool_executions (world_id, tool_name, params, status, actor, risk_tier)
     VALUES ($1,'create_object','{}'::jsonb,'succeeded',$2,'low') RETURNING id`,
    [W, P + '_fake_exec']);
  const usage = await missionService.getMonthlyUsage(W);
  log('P7b-7b used 从账本聚合（ai_call_log tokens + tool_executions 建/拆）',
    usage.tokens >= 123 && usage.objects >= 1, 'tokens=' + usage.tokens + ' objects=' + usage.objects);
  await query(`DELETE FROM ai_call_log WHERE id=$1`, [fakeTokenRow.rows[0].id]);
  await query(`DELETE FROM world_tool_executions WHERE id=$1`, [fakeExec.rows[0].id]);
  const mB = await missionService.getMission(box.m2);
  const b0 = await missionService.checkMonthlyBudget(mB);
  await query(`UPDATE world_missions SET monthly_budget = jsonb_set(monthly_budget, '{limits,objects}', to_jsonb($2::int)) WHERE id=$1`,
    [box.m2, b0.usage.objects]);
  await query(`UPDATE world_missions SET weekly_plan = jsonb_set(weekly_plan, '{week}', '"1999-W01"') WHERE id=$1`, [box.m2]);
  const wp4 = await missionService.generateWeeklyPlan(W, {});
  log('P7b-7c 预算耗尽 → 不发起新委托（budget_exhausted，进行中不受影响）',
    wp4.ok === false && wp4.code === 'budget_exhausted' && wp4.flagged === true, wp4.reason);
  await query(`UPDATE world_missions SET monthly_budget = jsonb_set(monthly_budget, '{limits,objects}', '200') WHERE id=$1`, [box.m2]);
  const logAfter7 = await countCallLog();
  log('P7b-7d 绝不清账本（ai_call_log 行数不减）', logAfter7 >= logBefore7, logBefore7 + '→' + logAfter7);

  // ═══ P7b-8 生成前注入（worldPlanner prompt 携带使命）═══
  const goal = await require('../src/worldai/goals/goalService').createGoal({
    worldId: W, title: P + '_愿景', vision: P + '_在东边补个花园', hardRules: [], softPrefs: [], isPrimary: false,
  });
  const goalId = goal.goal ? goal.goal.id : (goal.id || (goal.goal && goal.goal.id));
  const capt = require('../src/worldai/llm/providerFallback');
  const origChat = capt.chatWithFallback;
  let captured = '';
  capt.chatWithFallback = async (o) => {
    captured = JSON.stringify(o.messages);
    const mkPhase = (no, purpose, deps) => ({ no, title: P + '_p' + no, purpose, dependsOn: deps,
      steps: [{ seq: 1, tool_name: 'create_area', params: { name: P + '_' + no, x: 500, z: 500, width: 10, depth: 10 }, rationale: P, expected_effect: {}, risk_tier: 'low' }] });
    return { content: JSON.stringify({ title: P + '_plan', summary: P, overview: P,
      phases: [mkPhase(1, 'base', []), mkPhase(2, 'social', ['base']), mkPhase(3, 'explore', ['base']),
        mkPhase(4, 'commerce', ['base', 'social']), mkPhase(5, 'optimize', ['base'])],
      risks: [] }), callLogId: null };
  };
  let genOk = false, promptHasMission = false;
  const mcDbg = await missionService.getMissionContext(W).catch((e) => 'THREW:' + e.message);
  const stDbg = (await query(`SELECT id, status, left(statement,20) AS s FROM world_missions WHERE world_id=$1`, [W])).rows;
  try {
    const gen = await require('../src/worldai/planning/worldPlanner').generate({ worldId: W, goalId });
    genOk = gen.ok === true;
    promptHasMission = captured.indexOf('长期使命') >= 0 && captured.indexOf(STMT.slice(0, 12)) >= 0
      && captured.indexOf(P + '_先把出生点做热闹') >= 0;
  } catch (e) { console.log('  (gen warn) ' + e.message); }
  capt.chatWithFallback = origChat;
  log('P7b-8a 规划 prompt 携带当前使命 + 阶段目标（生成前注入）', genOk && promptHasMission,
    'genOk=' + genOk + ' captured=' + captured.length + ' hasMission=' + captured.indexOf('长期使命')
    + ' hasStmt=' + captured.indexOf(STMT.slice(0, 12)) + ' hasGoal=' + captured.indexOf(P + '_先把出生点做热闹')
    + ' ctx=' + JSON.stringify(mcDbg && String(mcDbg).slice(0, 60))
    + ' rows=' + JSON.stringify(stDbg));
  try { await query(`DELETE FROM world_plan_steps WHERE plan_id IN (SELECT id FROM world_plans WHERE title LIKE $1)`, [P + '%']); } catch (e) { /* ignore */ }
  try { await query(`DELETE FROM world_plans WHERE title LIKE $1 OR summary LIKE $1`, [P + '%']); } catch (e) { /* ignore */ }
  try { await query(`DELETE FROM world_goals WHERE title LIKE $1`, [P + '%']); } catch (e) { /* ignore */ }

  // ═══ P7b-9 scheduler 集成 ═══
  const kw = scheduler.resolveKind(null, 'weekly');
  const km = scheduler.resolveKind(null, 'monthly');
  const kwOff = scheduler.resolveKind({ schedule: { weekly: { enabled: false } } }, 'weekly');
  log('P7b-9a KINDS 增 weekly/monthly（独立默认频率 6h + 独立开关）',
    scheduler.KINDS.indexOf('weekly') >= 0 && scheduler.KINDS.indexOf('monthly') >= 0
      && kw.intervalMs === 21600000 && km.intervalMs === 21600000 && kwOff.enabled === false, '');
  scheduler.useWorldId(W);
  const trigW = await scheduler.trigger('weekly', P + '_manual');
  const trigM = await scheduler.trigger('monthly', P + '_manual');
  log('P7b-9b trigger 手动触发（无使命安静跳过 / 有使命真跑）',
    trigW.ok === true && trigM.ok === true, 'weekly=' + trigW.action);
  scheduler.useWorldId(null);

  // ═══ P7b-10 崩溃恢复（状态全在 DB；全新进程读库原样恢复）═══
  const childScript = "const{pool,query}=require('" + path.join(__dirname, '..', 'src', 'database', 'db').replace(/\\/g, '/') + "');"
    + "(async()=>{require('dotenv').config({path:'" + path.join(__dirname, '..', '.env').replace(/\\/g, '/') + "'});"
    + "const r=await query('SELECT status,current_phase,weekly_plan IS NOT NULL AS has_wp FROM world_missions WHERE id=$1',[process.argv[1]]);"
    + "console.log(JSON.stringify(r.rows[0]||null));process.exit(0)})()";
  const cp = spawnSync(process.execPath, ['-e', childScript, String(box.m2)], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
  let childRow = null;
  try { childRow = JSON.parse(String(cp.stdout || '').trim().split(/\r?\n/).pop()); } catch (e) { /* ignore */ }
  const parentRow = await missionService.getMission(box.m2);
  log('P7b-10 全新进程读库：running 使命原样恢复（状态/阶段/周计划都在）',
    !!childRow && childRow.status === parentRow.status && Number(childRow.current_phase) === Number(parentRow.current_phase)
      && childRow.has_wp === true,
    'child=' + JSON.stringify(childRow) + ' stdout=' + JSON.stringify(String(cp.stdout || '').slice(0, 200))
      + ' stderr=' + String(cp.stderr || '').slice(0, 160) + ' spawnErr=' + String(cp.error && cp.error.message));

  // ═══ P7b-11 回归（phase7 与 scheduler 强相关，必跑；smoke 保底）═══
  // ★ 回归前先收尾自己的测试数据（Phase 8 教训：带着本轮残留跑 phase6 会假失败）
  await restore();
  await cleanup();
  await sleep(500);
  const suites = ['scripts/smoke_r185_world.js', 'scripts/accept_world_ai_phase7.js', 'scripts/accept_world_ai_phase6.js'];
  const results = [];
  for (const s of suites) {
    const run = () => spawnSync(process.execPath, [s], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
    let rr = run();
    let out = String(rr.stdout || '') + String(rr.stderr || '');
    let m = out.match(/(\d+) PASS \/ (\d+) FAIL/);
    let ok = (/VERDICT ACCEPTED/.test(out) || /PASS \/ 0 FAIL/.test(out) || /9\/9/.test(out)) && rr.status === 0;
    if (!ok) {
      // 已知 flake（eventLog 全局 1200 条/分钟速率保护 + 登录限流）：重启清内存计数器后复跑一次
      console.log('  · ' + s + ' 首轮失败，重启 3002 后复跑一次…');
      restartServer();
      await sleep(12000);
      rr = run();
      out = String(rr.stdout || '') + String(rr.stderr || '');
      m = out.match(/(\d+) PASS \/ (\d+) FAIL/);
      ok = (/VERDICT ACCEPTED/.test(out) || /PASS \/ 0 FAIL/.test(out) || /9\/9/.test(out)) && rr.status === 0;
    }
    results.push({ s, ok, summary: m ? m[0] : 'exit=' + rr.status });
    console.log('  · ' + s + ' → ' + (ok ? 'OK' : 'FAIL') + ' ' + (m ? m[0] : 'exit=' + rr.status));
    if (!ok) {
      const bad = out.split(/\r?\n/).filter((l) => /^FAIL/.test(l)).slice(0, 3);
      if (bad.length) console.log('      ' + bad.join('\n      '));
    }
  }
  log('P7b-11a 回归全绿（smoke + phase7 + phase6）', results.every((r) => r.ok),
    results.filter((r) => !r.ok).map((r) => r.s).join(' | '));
  let sz = 0;
  try { execSync('node scripts/check_file_size.js --fail', { cwd: path.join(__dirname, '..'), stdio: 'pipe' }); sz = 1; } catch (e) { sz = 0; }
  log('P7b-11b check_file_size 退出码 0（新文件 ≤500 行 / 既有文件净增限额内）', sz === 1, '');

  finish();
}

main().catch((e) => {
  fail++; fails.push('FATAL: ' + String(e && e.message).slice(0, 200));
  console.log('FATAL ' + (e && e.stack || e));
  finish();
});
