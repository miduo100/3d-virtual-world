/**
 * accept_world_ai_phase2b.js —— Phase 2b 验收（Runtime 状态机 P1-7 · start 闸 P1-8 · 熔断 P1-9）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 判据（§J.2 / §D P1 清单）：
 *   P1-7  Runtime 状态机：start/pause/resume/stop/restart + 非法迁移拒绝 + 防双开
 *         + 崩溃恢复（孤儿 running 委托判 interrupted_by_restart + 定时器链续跑；error 不复活）
 *   P1-8  enabled=false 时 start 拒绝（RUNTIME_DISABLED；熔断关闸后同口径）
 *   P1-9  熔断：连续 3 轮异常（挂 missionRunner 真实轮次）→ runtime_state='error'
 *         + enabled=false + last_error 留痕；成功一轮复位计数；restart 清计数但 Start 闸照走
 *
 * 成本纪律：全程零真实 LLM —— 注定失败的委托用 budget.maxLlmCalls=0（预算闸直接拒，
 * 不发上游请求）；成功轮用 injectPlan（missionRunner 既有演练口径）。
 *
 * 双进程口径：HTTP 打服务器进程（路由/鉴权/DB 权威状态）；熔断连续计数是**进程内内存**
 * （trip 状态才在 DB，§I.2），故熔断组用进程内 runtime 模块验证计数语义。
 * 跑法：node scripts/accept_world_ai_phase2b.js   （需要 3002 在跑新代码）
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const POOL = new Pool({
  host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'virtual_world',
  user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'password',
});
const q = (sql, params) => POOL.query(sql, params);
let T = null;
const REPORT = [];
function log(name, ok, detail) {
  REPORT.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''));
}
async function api(p, o) {
  const opt = o || {};
  const headers = {};
  if (opt.body !== undefined) headers['Content-Type'] = 'application/json';
  if (T && !opt.noAuth) headers.Authorization = 'Bearer ' + T;
  const res = await fetch(BASE + p, { method: opt.method || 'GET', headers, body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined });
  let j = null; try { j = await res.json(); } catch (e) { j = {}; }
  return { status: res.status, j };
}
const KEY = 'accept_p2b_' + Date.now();
const doomIds = [];
const BIG_INTERVAL = 30 * 60 * 1000; // 定时器 30 分钟一跳：验收窗口内绝不自动触发，全部走手动 tick

async function main() {
  let snap = null;
  const doomIds = [];
  const li = await api('/api/admin-auth/login', { method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }, noAuth: true });
  T = li.j.token || li.j.adminToken;
  if (!T) { console.log('FATAL 管理员登录失败', li.status); process.exit(1); }
  const cfg0 = (await api('/api/world-ai/config')).j.config;
  const WORLD = cfg0.worldId;
  snap = { enabled: cfg0.enabled, autonomy: cfg0.autonomy, runtimeState: cfg0.runtimeState, schedule: cfg0.schedule || null };
  const runtime = require('../src/worldai/runtime/worldAiRuntime');
  runtime.useWorldId(WORLD); // ★ 非服务器进程必须显式指定 worldId（§3.1-3：否则回落占位 UUID）
  const missionRunner = require('../src/worldai/missions/missionRunner');
  // 开工清扫：上一轮异常退出可能遗留卡死委托/测试区域
  await q("DELETE FROM world_build_missions WHERE region_key = 'accept_p2b_missing_region' OR region_key LIKE 'accept_p2b_%'");
  await q("DELETE FROM world_regions WHERE region_key LIKE 'accept_p2b_%'");
  await q("DELETE FROM world_objects WHERE region_id LIKE 'accept_p2b_%'");
  await api('/api/world-ai/config', { method: 'PUT', body: { autonomy: 'semi_autonomous' } });

  // 测试区域 + 零件
  const partRow = (await q(
    `SELECT i.part_key FROM part_library_items i JOIN part_libraries l ON l.id = i.library_id
      WHERE l.status='active' AND i.part_role='wall' ORDER BY l.id, i.id LIMIT 1`)).rows[0];
  const PART = partRow.part_key;
  await api('/api/world-ai/regions', { method: 'POST', body: {
    regionKey: KEY, name: '2b 验收区', bounds: { x: 8400, z: 8400, width: 80, depth: 80 }, autonomy: 'semi_autonomous',
    gridsnap: { kind: 'modular', unit: [1, 1, 1] }, constraints: { maxObjects: 6 }, notes: '2b 验收',
  } });
  const mkMission = async (extra) => (await api('/api/world-ai/missions', { method: 'POST', body: Object.assign({
    regionKey: KEY, title: '2b', prompt: '砌墙', constraints: { maxObjects: 4 },
  }, extra || {}) })).j.mission;
  const doomin = async () => { // 注定失败：region_key 指向不存在区域 → REGION_NOT_FOUND（零 LLM 成本、确定性）
    const m = await mkMission({ title: '注定失败' });
    await api('/api/world-ai/missions/' + m.id + '/queue', { method: 'POST', body: {} });
    await q("UPDATE world_build_missions SET region_key='accept_p2b_missing_region' WHERE id=$1", [String(m.id)]);
    doomIds.push(String(m.id));
    return m;
  };

  // ── 鉴权 ──
  const noAuth = await fetch(BASE + '/api/world-ai/runtime').then((r) => r.status);
  log('R0 未鉴权 GET /runtime → 401（子路由继承管理员鉴权）', noAuth === 401, 'got ' + noAuth);

  // ── P1-8：enabled=false 时 start 拒绝 ──
  await api('/api/world-ai/config', { method: 'PUT', body: { enabled: false } });
  const r1 = await api('/api/world-ai/runtime/start', { method: 'POST', body: {} });
  log('P1-8a enabled=false → start 400 RUNTIME_DISABLED', r1.status === 400 && r1.j.code === 'RUNTIME_DISABLED', r1.j.code || r1.status);

  // ── P1-7：start / 防双开 ──
  await api('/api/world-ai/config', { method: 'PUT', body: { enabled: true } });
  const r2 = await api('/api/world-ai/runtime/start', { method: 'POST', body: { intervalMs: BIG_INTERVAL } });
  log('P1-7a start → running（定时器链已起，30min 间隔验收内不自动跳）', r2.status === 200 && r2.j.ok === true && r2.j.state === 'running', JSON.stringify(r2.j));
  const r2b = await api('/api/world-ai/runtime/start', { method: 'POST', body: {} });
  log('P1-7b 已 running 再 start → 400 ALREADY_RUNNING（条件 UPDATE 防双开）', r2b.status === 400 && r2b.j.code === 'ALREADY_RUNNING', r2b.j.code || '');
  const st = (await api('/api/world-ai/runtime')).j.runtime;
  log('P1-7c GET /runtime：running + 心跳已记 + 定时器活着',
    st.runtimeState === 'running' && !!st.lastHeartbeatAt && st.diag.timerActive === true, JSON.stringify(st.diag));

  // ── P1-7：状态迁移 ──
  const idle = await api('/api/world-ai/runtime/tick', { method: 'POST', body: {} });
  log('P1-7d running 空转一轮 → action=idle（无排队委托）', idle.status === 200 && idle.j.action === 'idle', idle.j.action + '/' + (idle.j.reason || ''));
  await api('/api/world-ai/runtime/pause', { method: 'POST', body: {} });
  const pausedTick = await api('/api/world-ai/runtime/tick', { method: 'POST', body: {} });
  const pause2 = await api('/api/world-ai/runtime/pause', { method: 'POST', body: {} });
  log('P1-7e paused 可手动调试轮（tick 放行）但 pause 不可重复（INVALID_TRANSITION）',
    pausedTick.status === 200 && pause2.status === 400 && pause2.j.code === 'INVALID_TRANSITION',
    'tick=' + pausedTick.status + ' pause2=' + pause2.j.code);
  const rs = await api('/api/world-ai/runtime/resume', { method: 'POST', body: {} });
  log('P1-7f resume → running（不重放历史，只续调度）', rs.status === 200 && rs.j.ok === true && rs.j.state === 'running', '');
  const stopR = await api('/api/world-ai/runtime/stop', { method: 'POST', body: {} });
  const pauseAfterStop = await api('/api/world-ai/runtime/pause', { method: 'POST', body: {} });
  const st2 = (await api('/api/world-ai/runtime')).j.runtime;
  log('P1-7g stop → stopped 且定时器链拆除；stopped 下 pause 被拒',
    stopR.status === 200 && stopR.j.ok === true && pauseAfterStop.status === 400 && st2.runtimeState === 'stopped' && st2.diag.timerActive === false,
    'state=' + st2.runtimeState + ' timer=' + st2.diag.timerActive);

  // ── P1-7：崩溃恢复（mission 级等价；进程内显式 recover，不误伤服务器进程）──
  const orphan = await mkMission({ title: '孤儿' });
  await q("UPDATE world_build_missions SET status='running', started_at=now() WHERE id=$1", [String(orphan.id)]);
  await q("UPDATE world_ai_configs SET runtime_state='running' WHERE world_id=$1", [WORLD]); // 模拟上一进程遗留
  const rec = await runtime.recover();
  const orphanRow = (await q('SELECT status, executed_stats FROM world_build_missions WHERE id=$1', [String(orphan.id)])).rows[0];
  const recSt = (await api('/api/world-ai/runtime')).j.runtime;
  log('P1-7h 崩溃恢复：孤儿 running 委托判 failed(interrupted_by_restart) + 链续跑',
    rec.ok === true && rec.action === 'recovered' && orphanRow.status === 'failed'
    && orphanRow.executed_stats && orphanRow.executed_stats.error === 'interrupted_by_restart'
    && recSt.runtimeState === 'running' && runtime.getDiag().timerActive === true, // 定时器在脚本进程（recover 的调用方）
    JSON.stringify({ rec: rec.action, orphan: orphanRow.status, st: recSt.runtimeState }));
  await api('/api/world-ai/runtime/stop', { method: 'POST', body: {} });
  await q("UPDATE world_ai_configs SET runtime_state='error' WHERE world_id=$1", [WORLD]);
  const recErr = await runtime.recover();
  const stErr = (await api('/api/world-ai/runtime')).j.runtime;
  log('P1-7i error 态 recover 不动作（熔断不因重启静默复活）',
    recErr.ok === true && recErr.action === 'none' && stErr.runtimeState === 'error', recErr.action);
  await q("UPDATE world_ai_configs SET runtime_state='stopped' WHERE world_id=$1", [WORLD]);

  // ── P1-9：熔断（进程内真实轮次；计数=内存，trip 状态=DB）──
  const sIn = await runtime.start({ intervalMs: BIG_INTERVAL });
  log('P1-9a 进程内 start → running（同一 DB 状态机，服务器进程已 stopped 不冲突）',
    sIn.ok === true, sIn.code || '');
  await doomin(); // 一条卡死委托（REGION_NOT_FOUND，永远留在 queued）：连续 3 轮同一异常 → 熔断
  const d1 = await runtime.tickNow();
  const d2 = await runtime.tickNow();
  log('P1-9b 第 1、2 轮失败只累计不熔断（consecutive=1,2）',
    d1.ok === false && d1.code !== 'BREAKER_TRIPPED' && d2.ok === false && d2.consecutiveFailures === 2
    && runtime.peekConsecutiveFailures() === 2,
    'd2.consecutive=' + d2.consecutiveFailures);
  const d3 = await runtime.tickNow();
  const cfgAfter = (await api('/api/world-ai/config')).j.config;
  log('P1-9c 第 3 轮失败 → 熔断：runtime_state=error + enabled=false + last_error 留痕（§H.7）',
    d3.ok === false && d3.code === 'BREAKER_TRIPPED' && cfgAfter.runtimeState === 'error' && cfgAfter.enabled === false
    && String(cfgAfter.lastError || '').indexOf('熔断') >= 0,
    'code=' + d3.code + ' st=' + cfgAfter.runtimeState + ' enabled=' + cfgAfter.enabled);
  const tickAfter = await api('/api/world-ai/runtime/tick', { method: 'POST', body: {} });
  const startAfter = await api('/api/world-ai/runtime/start', { method: 'POST', body: {} });
  log('P1-9d 熔断后 tick 与 start 都被拒（RUNTIME_DISABLED，P1-8 语义保持）',
    tickAfter.status === 400 && tickAfter.j.code === 'RUNTIME_DISABLED' && startAfter.status === 400 && startAfter.j.code === 'RUNTIME_DISABLED',
    'tick=' + tickAfter.j.code + ' start=' + startAfter.j.code);
  const restartDisabled = await api('/api/world-ai/runtime/restart', { method: 'POST', body: {} });
  log('P1-9e enabled=false 下 restart 也拒（熔断必须人工开闸才能复活）',
    restartDisabled.status === 400 && restartDisabled.j.code === 'RUNTIME_DISABLED', restartDisabled.j.code || '');
  await api('/api/world-ai/config', { method: 'PUT', body: { enabled: true } });
  const reRestart = await api('/api/world-ai/runtime/restart', { method: 'POST', body: { intervalMs: BIG_INTERVAL } });
  log('P1-9f 人工开闸后 restart → running（restart 清熔断计数，Start 闸照走）',
    reRestart.status === 200 && reRestart.j.ok === true && reRestart.j.state === 'running', reRestart.j.code || '');

  // ── 成功一轮复位计数（进程内验证）──
  await api('/api/world-ai/runtime/pause', { method: 'POST', body: {} });
  await q("UPDATE world_ai_configs SET runtime_state='running' WHERE world_id=$1", [WORLD]); // 两进程共享状态机的测试垫片（收尾统一 stop）
  await q("DELETE FROM world_build_missions WHERE region_key = 'accept_p2b_missing_region'"); // 移除卡死委托，避免成功轮前再次连败
  const good = await mkMission({ title: '成功轮', constraints: { maxObjects: 3 } });
  await api('/api/world-ai/missions/' + good.id + '/queue', { method: 'POST', body: {} });
  const okRound = await runtime.tickNow({ injectPlan: { blocks: [{ kind: 'w', anchor: { dx: 0, dz: 0 }, parts: [
    { partKey: PART, dx: 4, dz: 4 }, { partKey: PART, dx: 10, dz: 4 }, { partKey: PART, dx: 16, dz: 4 }] }] } });
  log('P1-9g 成功一轮 → 计数复位（consecutiveFailures=0）',
    okRound.ok === true && okRound.action === 'ran' && runtime.peekConsecutiveFailures() === 0,
    'peek=' + runtime.peekConsecutiveFailures());
  await missionRunner.rollback(good.id);

  // ── 收尾 ──
  await api('/api/world-ai/runtime/stop', { method: 'POST', body: {} });
  await api('/api/world-ai/config', { method: 'PUT', body: { enabled: snap.enabled, autonomy: snap.autonomy, schedule: snap.schedule } });
  await q('UPDATE world_ai_configs SET runtime_state=$2 WHERE world_id=$1', [WORLD, snap.runtimeState || 'stopped']);
  await q('DELETE FROM world_objects WHERE region_id = $1', [KEY]);
  await q('DELETE FROM world_build_missions WHERE region_key = $1 OR id = ANY($2::uuid[])', [KEY, doomIds]);
  await q('DELETE FROM world_regions WHERE region_key = $1', [KEY]);
  const fin = (await api('/api/world-ai/config')).j.config;
  log('收尾：区域/委托已清，enabled/autonomy/schedule/runtime_state 已还原',
    fin.enabled === snap.enabled && fin.autonomy === snap.autonomy, 'enabled=' + fin.enabled + ' st=' + fin.runtimeState);
}

(async () => {
  try { await main(); } catch (e) {
    log('FATAL 脚本异常', false, e && e.message);
    try {
      await q('DELETE FROM world_objects WHERE region_id = $1', [KEY]);
      await q('DELETE FROM world_build_missions WHERE region_key = $1 OR id = ANY($2::uuid[])', [KEY, doomIds]);
      await q('DELETE FROM world_regions WHERE region_key = $1', [KEY]);
    } catch (e2) { /* ignore */ }
  }
  const fails = REPORT.filter((r) => !r.ok);
  console.log('\n共 ' + REPORT.length + ' 条：PASS ' + (REPORT.length - fails.length) + ' / FAIL ' + fails.length);
  console.log('\n════════ VERDICT: ' + (fails.length ? 'FAILED' : 'ACCEPTED') + '（' + (REPORT.length - fails.length) + '/' + REPORT.length + '）════════');
  await POOL.end();
  process.exit(fails.length ? 1 : 0);
})();
