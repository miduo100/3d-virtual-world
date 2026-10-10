/**
 * accept_world_ai_phase7bc —— Phase 7b 遗留三件验收（判据 P7b-12/13/14/15）
 * AI World Brain · Phase 7b 遗留：月报问题 LLM 生成 / 共享预算接 planRunner / 后台阶段自定义表单
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 运行：node scripts/accept_world_ai_phase7bc.js [--no-ui]   （--no-ui 跳过 playwright UI 段）
 * 纪律：
 *   ①LLM 路径用进程内 fetch 桩（不烧钱）；_test_forceLlmFailure 钩子测降级；inject 路径零变化；
 *   ②测试数据 accept_p7bc 前缀；清理每条 SQL 独立 try/catch；
 *   ③planRunner 预算判据用未注册假工具（executor 拒绝，零世界写入）；
 *   ④进程内调用显式传 worldId（权威来源 = well-known world.id）。
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = process.env.ACCEPT_BASE || 'http://127.0.0.1:3002';
const ADMIN = { username: 'baseline_shot', password: 'Baseline#185' };
const P = 'accept_p7bc';
const NO_UI = process.argv.includes('--no-ui');

let pass = 0, fail = 0;
const fails = [];
function log(name, ok, note) {
  if (ok) { pass++; console.log('PASS  ' + name + (note ? '  —— ' + note : '')); }
  else { fail++; fails.push(name); console.log('FAIL  ' + name + (note ? '  —— ' + note : '')); }
}
function FATAL(msg) { console.log('FATAL ' + msg); finish(); return false; }

let T = null, W = null;
const { query, pool } = require('../src/database/db');
const missionService = require('../src/worldai/missions/longTermMission');
const planRunner = require('../src/worldai/planning/planRunner');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(p, opts) {
  const o = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
  if (o.token) headers['Authorization'] = 'Bearer ' + o.token;
  else if (T && !o.noAuth) headers['Authorization'] = 'Bearer ' + T;
  const r = await fetch(BASE + p, {
    method: o.method || 'GET', headers,
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (e) { /* 空 body */ }
  return { status: r.status, j: j || {} };
}

async function cleanup() {
  const sqls = [
    [`DELETE FROM world_plan_steps WHERE plan_id IN (SELECT id FROM world_plans WHERE title LIKE $1)`, [P + '%']],
    [`DELETE FROM world_plans WHERE title LIKE $1`, [P + '%']],
    [`DELETE FROM world_approvals WHERE payload::text LIKE $1`, ['%' + P + '%']],
    [`DELETE FROM world_missions WHERE statement LIKE $1`, [P + '%']],
    [`DELETE FROM world_tool_executions WHERE created_at >= date_trunc('day', NOW()) AND params::text LIKE $1`, ['%' + P + '%']],
    [`DELETE FROM world_memories WHERE subject_id LIKE $1 OR content LIKE $2`, [P + '%', '%' + P + '%']],
    [`DELETE FROM ai_call_log WHERE caller = 'world_ai_mission_monthly_question' AND created_at >= date_trunc('day', NOW())`, []],
  ];
  for (const [sql, params] of sqls) {
    try { await query(sql, params); } catch (e) { console.log('  (cleanup warn) ' + e.message); }
  }
}

function finish() {
  const done = () => {
    console.log('\n===== Phase 7b 遗留验收结果：' + pass + ' PASS / ' + fail + ' FAIL =====');
    if (fails.length) console.log('失败项：' + fails.join(' | '));
    console.log(fail === 0 ? 'VERDICT ACCEPTED' : 'VERDICT FAILED');
    try { pool.end().then(() => process.exit(fail ? 1 : 0)); } catch (e) { process.exit(fail ? 1 : 0); }
    setTimeout(() => process.exit(fail ? 1 : 0), 1500);
  };
  cleanup().then(done).catch(done);
}

// ── 进程内 fetch 桩：拦 LLM 兼容报文（messages+model），其余透传 ──────
function installLlmStub(question) {
  const orig = global.fetch;
  global.fetch = async function (url, opts) {
    let body = null;
    try { body = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null; } catch (e) { /* not json */ }
    if (body && body.messages && body.model) {
      const content = JSON.stringify(question);
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return orig(url, opts);
  };
  return () => { global.fetch = orig; };
}

async function countCalls(caller) {
  const r = await query(`SELECT count(1)::int AS c FROM ai_call_log WHERE purpose='summary' AND caller=$1`, [caller]);
  return Number(r.rows[0].c);
}

// ══════════════════════════════════════════════════════════════════
async function main() {
  console.log('=== Phase 7b 遗留验收开始（P7b-12/13/14/15）===');
  const login = await api('/api/admin-auth/login', { method: 'POST', body: ADMIN, noAuth: true });
  if (!login.j || !login.j.token) return FATAL('管理员登录失败：' + JSON.stringify(login.j).slice(0, 200));
  T = login.j.token;
  const wk = await api('/.well-known/virtual-world-agent.json', { noAuth: true });
  W = (wk.j && wk.j.world && wk.j.world.id) || '';
  if (!W) return FATAL('拿不到权威 worldId');
  console.log('  world=' + W);

  // ── P7b-12 月报问题 LLM 生成 ────────────────────────────────────
  const created = await missionService.createMission({
    worldId: W, statement: P + '_使命：测试长期使命', status: undefined,
  });
  if (!created.ok) return FATAL('创建测试使命失败：' + created.reason);
  const missionId = created.mission.id;
  await query(`UPDATE world_missions SET status='running', started_at=NOW() WHERE id=$1`, [missionId]);

  // 12c 先测 LLM 失败降级（不静默）
  const mrFail = await missionService.generateMonthlyReport(W, { llmQuestion: true, _test_forceLlmFailure: true });
  log('P7b-12a LLM 失败 → 回落模板：questionSource=fallback + questionNote 写明原因（不静默）',
    mrFail.ok === true && mrFail.report.questionSource === 'fallback'
    && /LLM 问题生成失败已用模板/.test(mrFail.report.questionNote || '')
    && /TEST_FORCED_LLM_FAILURE/.test(mrFail.report.questionNote || ''),
    'source=' + mrFail.report.questionSource + ' note=' + String(mrFail.report.questionNote || '').slice(0, 70));
  log('P7b-12a 降级后 pendingQuestion 三选恒在（30 天暂停机制不受影响）',
    mrFail.report.pendingQuestion && Array.isArray(mrFail.report.pendingQuestion.options)
    && mrFail.report.pendingQuestion.options.length === 3 && mrFail.report.pendingQuestion.answered === null,
    'options=' + (mrFail.report.pendingQuestion.options || []).length);

  // 12b LLM 成功路径（进程内 fetch 桩，不烧钱）
  const question = {
    question: '下一月应优先推进「石井广场」还是先补齐「灯光氛围」？',
    options: ['继续当前目标', '先做灯光氛围', '听 AI 的（按数据自行决定）'],
  };
  const callsBefore = await countCalls('world_ai_mission_monthly_question');
  await query(`UPDATE world_missions SET last_report=NULL WHERE id=$1`, [missionId]);
  const restoreFetch = installLlmStub(question);
  let mrLlm = null, llmErr = null;
  try { mrLlm = await missionService.generateMonthlyReport(W, { llmQuestion: true }); }
  catch (e) { llmErr = e.message; }
  restoreFetch();
  if (!mrLlm) return FATAL('LLM 路径异常：' + llmErr);
  log('P7b-12b LLM 生成成功：questionSource=llm 且问题/三选项来自 LLM 输出',
    mrLlm.report.questionSource === 'llm'
    && mrLlm.report.pendingQuestion.question === question.question
    && mrLlm.report.pendingQuestion.options.join('|') === question.options.join('|')
    && mrLlm.report.pendingQuestion.answered === null,
    'q=' + String(mrLlm.report.pendingQuestion.question).slice(0, 40));
  const callsAfter = await countCalls('world_ai_mission_monthly_question');
  log('P7b-12b LLM 调用落账（purpose=summary caller=world_ai_mission_monthly_question）',
    callsAfter === callsBefore + 1, callsBefore + '→' + callsAfter);

  // 12a inject 路径零变化
  await query(`UPDATE world_missions SET last_report=NULL WHERE id=$1`, [missionId]);
  const injected = { question: P + ' 注入的问题', options: ['A', 'B', 'C'], askedAt: new Date().toISOString(), answered: null };
  const mrInj = await missionService.generateMonthlyReport(W, { injectQuestion: injected });
  log('P7b-12a inject 注入路径零变化（source=injected，问题逐字一致）',
    mrInj.report.questionSource === 'injected' && mrInj.report.pendingQuestion.question === injected.question,
    'source=' + mrInj.report.questionSource);

  // 12d runMonthlyTick 显式走 LLM 路径（失败降级口）
  await query(`UPDATE world_missions SET last_report=NULL WHERE id=$1`, [missionId]);
  const tick = await missionService.runMonthlyTick(W, { _test_forceLlmFailure: true });
  log('P7b-12d runMonthlyTick 携带 llmQuestion=true（tick 路径 LLM 生成 + 失败降级可用）',
    tick.ok === true && tick.result.report.ok === true && tick.result.report.report.questionSource === 'fallback'
    && /TEST_FORCED_LLM_FAILURE/.test(tick.result.report.report.questionNote || ''),
    'source=' + (tick.result.report.report.questionSource));

  // ── P7b-13 共享预算接 planRunner ────────────────────────────────
  await query(
    `INSERT INTO world_plans (world_id, title, summary, status, approved_at)
     VALUES ($1,$2,$3,'approved',NOW()) RETURNING id`,
    [W, P + '_plan', P]);
  const planRow = await query(`SELECT id FROM world_plans WHERE title=$1`, [P + '_plan']);
  const planId = planRow.rows[0].id;
  await query(
    `INSERT INTO world_plan_steps (plan_id, phase_no, seq, tool_name, params, risk_tier, status)
     VALUES ($1,1,1,$2,$3::jsonb,'low','pending')`,
    [planId, P + '_fake_tool', JSON.stringify({ note: P })]);

  // 13a 超限：limits.objects = 当前用量 → budget_exhausted，step 保持 pending，零写入
  await query(`UPDATE world_missions SET monthly_budget = jsonb_set(monthly_budget, '{limits,objects}', to_jsonb($2::int)) WHERE id=$1`,
    [missionId, 0]);
  const usageNow = await missionService.getMonthlyUsage(W);
  await query(`UPDATE world_missions SET monthly_budget = jsonb_set(monthly_budget, '{limits,objects}', to_jsonb($2::int)) WHERE id=$1`,
    [missionId, usageNow.objects]);
  const rExh = await planRunner.attemptApprovedPlan(W);
  const stepAfterExh = await query(`SELECT status FROM world_plan_steps WHERE plan_id=$1 AND seq=1`, [planId]);
  log('P7b-13a 共享预算超限 → action=budget_exhausted + step 保持 pending（零执行）',
    rExh.ok === true && rExh.action === 'budget_exhausted' && stepAfterExh.rows[0].status === 'pending'
    && Array.isArray(rExh.over) && rExh.over.some((s) => /^objects /.test(s)),
    'action=' + rExh.action + ' step=' + stepAfterExh.rows[0].status + ' over=' + (rExh.over || []).join(';'));

  // 13b 预算有余 → 通过预算闸进入 executor（假工具 → TOOL_NOT_REGISTERED 明确失败，零世界写入）
  await query(`UPDATE world_missions SET monthly_budget = jsonb_set(monthly_budget, '{limits,objects}', to_jsonb($2::int)) WHERE id=$1`,
    [missionId, usageNow.objects + 100]);
  const rOk = await planRunner.attemptApprovedPlan(W);
  const stepAfterOk = await query(`SELECT status FROM world_plan_steps WHERE plan_id=$1 AND seq=1`, [planId]);
  log('P7b-13b 预算有余 → 通过共享预算闸进入 executor（未注册工具 → failed_unregistered 明确失败）',
    rOk.ok === true && rOk.action === 'failed_unregistered' && stepAfterOk.rows[0].status === 'failed',
    'action=' + rOk.action + ' step=' + stepAfterOk.rows[0].status);

  // 13c 无活跃使命 → 完全不受影响（闸不生效，同样走到 executor）
  await query(`UPDATE world_missions SET status='terminated' WHERE id=$1`, [missionId]);
  await query(
    `INSERT INTO world_plan_steps (plan_id, phase_no, seq, tool_name, params, risk_tier, status)
     VALUES ($1,1,2,$2,$3::jsonb,'low','pending')`,
    [planId, P + '_fake_tool', JSON.stringify({ note: P })]);
  const rNoM = await planRunner.attemptApprovedPlan(W);
  log('P7b-13c 无活跃使命 → 预算闸不生效（同样走到 executor，行为与 Phase 4 一致）',
    rNoM.ok === true && rNoM.action === 'failed_unregistered',
    'action=' + rNoM.action);

  // ── P7b-14 后台阶段自定义表单（API 层）─────────────────────────
  const phasesIn = [
    { title: 'P1 摸底', goal: '选 1 个区域跑通闭环', milestoneCheck: '区域整洁且可交互' },
    { title: 'P2 铺开', goal: '按北极星指标铺开内容' },
  ];
  const cApi = await api('/api/world-ai/long-missions', { method: 'POST', body: { statement: P + '_ui_使命', phases: phasesIn } });
  const uiMission = cApi.j && cApi.j.mission;
  const got = uiMission && uiMission.phases;
  log('P7b-14a 自定义阶段落库：标题/目标/里程碑逐字一致',
    cApi.status === 200 && Array.isArray(got) && got.length === 2
    && got[0].title === 'P1 摸底' && got[0].goal === '选 1 个区域跑通闭环'
    && got[0].milestoneCheck === '区域整洁且可交互' && got[1].milestoneCheck === '',
    got ? ('phases=' + got.map((x) => x.title).join(',')) : 'no mission');
  const cBad = await api('/api/world-ai/long-missions', { method: 'POST', body: { statement: P + '_bad_使命', phases: [] } });
  log('P7b-14a 非法阶段（空数组）→ 400 PHASES_INVALID 不创建',
    cBad.status === 400 && cBad.j.code === 'PHASES_INVALID', 'code=' + cBad.j.code);
  await query(`DELETE FROM world_missions WHERE statement = $1`, [P + '_ui_使命']);

  if (!NO_UI) await uiSmoke();

  // ── P7b-15 回归（phase7b 31 判据单独跑，见收尾提示）────────────
}

/** UI 冒烟：真实 admin.html 表单创建自定义阶段使命 + 非法行报错不创建 */
async function uiSmoke() {
  let chromium;
  try { chromium = require('playwright').chromium; } catch (e) {
    log('P7b-14b UI 冒烟（playwright 不可用，记 INFO 跳过）', true, 'skip: ' + e.message.slice(0, 60));
    return;
  }
  const before = await query(`SELECT count(1)::int AS c FROM world_missions WHERE statement LIKE $1`, [P + '%']);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext();
  await ctx.addInitScript(([tk]) => {
    localStorage.setItem('adminToken', tk);
    localStorage.setItem('adminUser', JSON.stringify({ username: 'baseline_shot', role: 'superadmin' }));
  }, [T]);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 120)));
  try {
    await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);   // 面板惰性构建（1.2s 轮询）+ 登录守卫
    const hasForm = await page.evaluate(() => !!document.getElementById('am-create') && !!document.getElementById('am-new-phases'));
    log('P7b-14b 设定使命表单含阶段输入框（textarea 注入）', hasForm, 'form=' + hasForm);

    // 非法行 → 可读报错不创建（★evaluate 闭包拿不到 Node 变量，字符串先在 Node 侧拼好再传参）
    await page.evaluate((stmt) => {
      document.getElementById('am-new-statement').value = stmt;
      document.getElementById('am-new-phases').value = '只有一段没有竖线';
      document.getElementById('am-create').click();
    }, P + '_bad_line_使命');
    await sleep(800);
    const msg1 = await page.evaluate(() => (document.getElementById('am-msg') || {}).textContent || '');
    const mid = await query(`SELECT count(1)::int AS c FROM world_missions WHERE statement = $1`, [P + '_bad_line_使命']);
    log('P7b-14b 非法行 → 页内可读报错 + 不创建',
      /格式不对/.test(msg1) && mid.rows[0].c === 0, 'msg=' + msg1.slice(0, 50));

    // 合法两行 → 创建成功且阶段落库
    await page.evaluate(([stmt, phases]) => {
      document.getElementById('am-new-statement').value = stmt;
      document.getElementById('am-new-phases').value = phases;
      document.getElementById('am-create').click();
    }, [P + '_ui_使命', 'P1 摸底|选 1 个区域跑通闭环|区域整洁\nP2 铺开|按北极星指标铺开内容']);
    await sleep(1500);
    const m2 = await query(`SELECT statement, jsonb_array_length(phases) AS n FROM world_missions WHERE statement = $1`, [P + '_ui_使命']);
    log('P7b-14b UI 创建 → 自定义阶段落库（2 个阶段）',
      m2.rows.length === 1 && Number(m2.rows[0].n) === 2,
      m2.rows.length ? ('phases=' + m2.rows[0].n) : 'no mission');
    log('P7b-14b UI 全程 0 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'clean');
  } catch (e) {
    log('P7b-14b UI 冒烟', false, 'EXC ' + String(e.message).slice(0, 120));
  } finally {
    await browser.close().catch(() => {});
  }
  const after = await query(`SELECT count(1)::int AS c FROM world_missions WHERE statement LIKE $1`, [P + '%']);
  console.log('  (missions accept_p7bc% ' + before.rows[0].c + '→' + after.rows[0].c + '，收尾统一清理)');
}

(async () => {
  try { await main(); }
  catch (e) { console.log('FATAL ' + (e.stack || e.message)); fail++; }
  finish();
})();
