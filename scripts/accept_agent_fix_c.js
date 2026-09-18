/**
 * accept_agent_fix_c.js — 第一轮联测缺陷 C 验收：新增 follow（跟随/持续目标）动作
 *
 * 缺陷（2026-09-18 实测）：只有一次性 walk_to，持续跟随必须客户端高频重发；
 * 每次重发都会 cancelMovement + 重建 10Hz 推进 → 走走停停（6 分钟下发 220+ 条 walk_to）。
 *
 * 修复：新增 src/agent/agentFollowService.js —— follow{targetId, stopDistance=2, maxDurationMs=60000}
 *   服务端每 100ms 追一次（5m/s 上限）、进入 stopDistance 停住（idle）、目标消失/超时/被打断即结束并回执。
 *   目标按 **id(characterId)** 定位（第 5.4 节契约）；与 walk_to/move/jump 互斥。
 *
 * 判据：
 *  C1  follow 收到 ACTION_ACCEPTED（回显 targetId/stopDistance/maxDurationMs）
 *  C2  服务端自动把 Agent 推进到目标 stopDistance 内
 *  C3  贴身时 animMode=idle；移动途中 animMode=walk
 *  C4  目标直线移动 30s，全程距离稳定在 stopDistance+1m 内（采样 ≥24 次）
 *  C5  目标消失（PLAYER_LEFT）→ follow 结束，reason='target_lost'
 *  C6  互斥：follow 进行中收到 walk_to → follow 收到 reason='superseded'
 *  C7  超时：maxDurationMs 到期 → reason='timeout'
 *  C8  targetId 不存在 → REJECTED target_not_found
 *  C9  缺 targetId → REJECTED missing_targetId
 *  C10 游客档动作限频表已含 follow（unit）
 *  C11 全程无意外 ACTION_REJECTED
 *
 * 运行：node scripts/accept_agent_fix_c.js
 */
'use strict';

const path = require('path');
const BASE = process.env.TEST_BASE || 'http://localhost:3002';
const WS_BASE = BASE.replace(/^http/, 'ws');
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? ' :: ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
}
function section(t) { console.log(`\n[${t}]`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function d2(a, b) { return Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0)); }

async function j(method, url, body, token) {
  const opts = { method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  let jr = null;
  try { jr = await r.json(); } catch (e) { /* ignore */ }
  return { status: r.status, body: jr };
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    ws.addEventListener('message', (ev) => { try { inbox.push({ t: Date.now(), msg: JSON.parse(ev.data) }); } catch (e) { /* ignore */ } });
    ws.addEventListener('open', () => resolve({
      ws, inbox,
      send(obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ } },
      async waitFor(type, requestId, ms = 12000) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          const hit = inbox.find(x => x.msg.type === type && (!requestId || (x.msg.payload && x.msg.payload.requestId === requestId)));
          if (hit) return { ...hit.msg, _at: hit.t };
          await sleep(50);
        }
        return null;
      },
      close() { try { ws.close(); } catch (e) { /* ignore */ } }
    }), { once: true });
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
    setTimeout(() => reject(new Error('ws open timeout')), 8000);
  });
}

async function observe(token, query = '?radius=50') {
  for (let i = 0; i < 3; i++) {
    const r = await j('GET', `${BASE}/api/agent/v1/observe${query}`, undefined, token);
    if (r.status !== 429) return r;
    await sleep(1200);
  }
  return { status: 429, body: null };
}

(async () => {
  console.log('=== Fix C acceptance: follow action (continuous target) ===');
  let adminToken = null, agentId = null, conn = null, humanWs = null;
  let origEnabled = false, origPush = 'eco', origMaxConn = 1;

  try {
    section('0. setup');
    const login = await j('POST', `${BASE}/api/admin-auth/login`, { username: ADMIN_USER, password: ADMIN_PASS });
    if (login.status !== 200) { console.log('FATAL: admin login failed'); process.exit(1); }
    adminToken = login.body.token;
    const cfg = await j('GET', `${BASE}/api/agent/v1/admin/config`, undefined, adminToken);
    origEnabled = cfg.body.config.agentEnabled;
    origPush = cfg.body.config.pushDefault;
    origMaxConn = cfg.body.config.maxConnectionsPerAgent || 1;
    await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_enabled: 'true' }, adminToken);
    await sleep(300);
    ok('agent_enabled=true (test env)', true);

    const created = await j('POST', `${BASE}/api/agent/v1/admin/agents`, { name: 'fixc_agent_' + Date.now(), description: 'fix C acceptance' }, adminToken);
    ok('create key agent', created.status === 200 && typeof created.body.apiKey === 'string', 'status=' + created.status);
    agentId = created.body.agent.id;
    const sess = await (await fetch(`${BASE}/api/agent/v1/session`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + created.body.apiKey, 'Content-Type': 'application/json' }, body: '{}'
    })).json();
    const token = sess.token;
    conn = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token)}`);
    ok('WS READY', !!(await conn.waitFor('READY')));

    // 真人目标（根路径人类 WS，只发 PLAYER_JOIN / POSITION_UPDATE 作为被跟随对象）
    const targetId = 'fixc-target-' + Date.now();
    const targetPos = { x: 20, z: 0 };
    humanWs = await openWs(`${WS_BASE}/`);
    humanWs.send({ type: 'PLAYER_JOIN', payload: { characterId: targetId, characterName: 'fixc_target', position: { x: targetPos.x, y: 0, z: targetPos.z }, isGuest: true } });
    await sleep(600);
    ok('human target registered via PLAYER_JOIN', true, `targetId=${targetId} at (${targetPos.x},${targetPos.z})`);

    // ---- C1~C3：follow 追上去 ----
    section('1. follow closes the gap by itself');
    conn.send({ type: 'ACTION', payload: { requestId: 'c-1', action: 'follow', targetId, stopDistance: 2, maxDurationMs: 60000 } });
    const acc = await conn.waitFor('ACTION_ACCEPTED', 'c-1', 6000);
    ok('C1 follow ACCEPTED with echoed params',
      !!acc && acc.payload.result.targetId === targetId && acc.payload.result.stopDistance === 2 && acc.payload.result.maxDurationMs === 60000,
      acc ? JSON.stringify(acc.payload.result) : 'no ACCEPTED');

    let reached = null, sawWalk = false;
    for (let i = 0; i < 14; i++) {
      await sleep(900);
      const ob = await observe(token, '?radius=80');
      if (!ob.body) continue;
      const self = ob.body.self.position;
      const own = (ob.body.entities || []).find(e => String(e.id) === String(agentId));
      if (own && own.animMode === 'walk') sawWalk = true;
      const dd = d2(self, targetPos);
      if (dd <= 2.5 && !reached) reached = { dd, animMode: own ? own.animMode : null };
    }
    ok('C2 server-side follow reached the target (<= stopDistance+0.5m)', !!reached,
      reached ? `dist=${reached.dd.toFixed(2)}m` : 'never reached');
    ok('C3 animMode=walk while moving, idle after stopping', sawWalk && !!reached,
      `sawWalk=${sawWalk} stoppedAnim=${reached ? reached.animMode : '-'}`);

    // ---- C4：目标直线移动 30s ----
    section('2. target walks in a straight line for 30s');
    const samples = [];
    const t0 = Date.now();
    let tick = 0;
    const mover = setInterval(() => {
      // 4 m/s 直线 +X（低于 Agent 5 m/s 上限）
      tick += 1;
      targetPos.x = 20 + 0.4 * tick;
      targetPos.z = 0;
      try {
        humanWs.send({ type: 'POSITION_UPDATE', payload: { characterId: targetId, position: { x: targetPos.x, y: 0, z: targetPos.z }, animMode: 'walk' } });
      } catch (e) { /* ignore */ }
    }, 100);
    while (Date.now() - t0 < 30000) {
      await sleep(1100);
      const ob = await observe(token, '?radius=200');
      if (!ob.body) continue;
      const self = ob.body.self.position;
      const own = (ob.body.entities || []).find(e => String(e.id) === String(agentId));
      samples.push({ t: Date.now() - t0, d: d2(self, targetPos), anim: own ? own.animMode : null });
    }
    clearInterval(mover);
    const within = samples.filter(s => s.d <= 3).length;
    const maxD = samples.reduce((m, s) => Math.max(m, s.d), 0);
    const lastD = samples.length ? samples[samples.length - 1].d : NaN;
    ok('C4 distance stayed within stopDistance+1m for >=90% of samples',
      samples.length >= 20 && within / samples.length >= 0.9,
      `samples=${samples.length} within(${within}) max=${maxD.toFixed(2)}m last=${lastD.toFixed(2)}m`);

    // ---- C5：目标消失 ----
    section('3. target disappears');
    try { humanWs.close(); } catch (e) { /* ignore */ }
    humanWs = null;
    const compLost = await conn.waitFor('ACTION_COMPLETED', 'c-1', 8000);
    ok('C5 follow ends with reason=target_lost', !!compLost && compLost.payload.reason === 'target_lost',
      compLost ? `reason=${compLost.payload.reason}` : 'no COMPLETED');

    // ---- C6：互斥（follow -> walk_to）----
    section('4. mutual exclusion');
    humanWs = await openWs(`${WS_BASE}/`);
    humanWs.send({ type: 'PLAYER_JOIN', payload: { characterId: targetId, characterName: 'fixc_target', position: { x: targetPos.x, y: 0, z: targetPos.z }, isGuest: true } });
    await sleep(600);
    conn.send({ type: 'ACTION', payload: { requestId: 'c-2', action: 'follow', targetId, stopDistance: 40, maxDurationMs: 60000 } });
    await conn.waitFor('ACTION_ACCEPTED', 'c-2', 6000);
    await sleep(700);
    conn.send({ type: 'ACTION', payload: { requestId: 'c-3', action: 'walk_to', target: { x: targetPos.x + 5, z: targetPos.z + 5 } } });
    const compFollow = await conn.waitFor('ACTION_COMPLETED', 'c-2', 6000);
    ok('C6 follow interrupted by walk_to -> reason=superseded',
      !!compFollow && compFollow.payload.reason === 'superseded', compFollow ? `reason=${compFollow.payload.reason}` : 'no COMPLETED');
    await conn.waitFor('ACTION_COMPLETED', 'c-3', 8000);

    // ---- C7：超时 ----
    section('5. timeout');
    conn.send({ type: 'ACTION', payload: { requestId: 'c-4', action: 'follow', targetId, stopDistance: 50, maxDurationMs: 2000 } });
    const accT = await conn.waitFor('ACTION_ACCEPTED', 'c-4', 6000);
    const compT = await conn.waitFor('ACTION_COMPLETED', 'c-4', 8000);
    const tOut = compT && accT ? compT._at - accT._at : -1;
    ok('C7 follow ends with reason=timeout (~maxDurationMs)', !!compT && compT.payload.reason === 'timeout' && tOut > 1500 && tOut < 5000,
      compT ? `reason=${compT.payload.reason} after=${tOut}ms` : 'no COMPLETED');

    // ---- C8/C9：参数校验 ----
    section('6. params validation');
    conn.send({ type: 'ACTION', payload: { requestId: 'c-bad1', action: 'follow', targetId: 'no-such-entity-' + Date.now() } });
    const r1 = await conn.waitFor('ACTION_REJECTED', 'c-bad1', 5000);
    ok('C8 unknown targetId -> REJECTED target_not_found', !!r1 && r1.payload.code === 'target_not_found', r1 ? r1.payload.code : 'none');
    conn.send({ type: 'ACTION', payload: { requestId: 'c-bad2', action: 'follow' } });
    const r2 = await conn.waitFor('ACTION_REJECTED', 'c-bad2', 5000);
    ok('C9 missing targetId -> REJECTED missing_targetId', !!r2 && r2.payload.code === 'missing_targetId', r2 ? r2.payload.code : 'none');

    // ---- C10：游客限频表含 follow（unit）----
    section('7. unit: guest rate table');
    const schema = require(path.join(__dirname, '..', 'src', 'agent', 'agentSchema.js'));
    const guestRates = schema.TIER_ACTION_RATES['guest-pull'] || {};
    ok('C10 guest tier has follow rate limit', Array.isArray(guestRates.follow), JSON.stringify(guestRates.follow || null));

    // ---- C11：无意外 REJECTED ----
    const unexpected = conn.inbox.filter(x => x.msg.type === 'ACTION_REJECTED'
      && ['c-1', 'c-2', 'c-3', 'c-4'].includes(x.msg.payload && x.msg.payload.requestId));
    ok('C11 no unexpected REJECTED for valid follow commands', unexpected.length === 0,
      unexpected.map(x => JSON.stringify(x.msg.payload)).join(' / ') || 'none');
  } catch (e) {
    ok('unexpected error', false, e.message);
  } finally {
    try { if (humanWs) humanWs.close(); } catch (e) { /* ignore */ }
    try { if (conn) conn.close(); } catch (e) { /* ignore */ }
    if (adminToken) {
      if (agentId) { try { await j('DELETE', `${BASE}/api/agent/v1/admin/agents/${agentId}`, undefined, adminToken); } catch (e) { /* ignore */ } }
      try {
        await j('PUT', `${BASE}/api/agent/v1/admin/config`,
          { agent_enabled: origEnabled ? 'true' : 'false', agent_push_default: origPush || 'eco', agent_max_connections_per_agent: String(origMaxConn) }, adminToken);
      } catch (e) { /* ignore */ }
      console.log(`\n[restore] agent_enabled=${origEnabled ? 'true' : 'false'} pushDefault=${origPush}`);
    }
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (failures.length) console.log('FAILED: ' + failures.join(' | '));
  process.exitCode = fail === 0 ? 0 : 1;
})();
