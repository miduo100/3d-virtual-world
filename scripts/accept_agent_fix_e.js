/**
 * accept_agent_fix_e.js — 第一轮联测缺陷 E 验收：walk_to 到达 / 被打断回执
 *
 * 缺陷（2026-09-18 实测）：ACTION_ACCEPTED=221 而 ACTION_COMPLETED=16（16 条全是 say 的 delivered），
 * walk_to 到达只能靠客户端轮询位置推断，1Hz 下延迟 1~3s。
 *
 * 修复：movement service 在「到达 / 被新指令打断 / 断线」时补发
 *      ACTION_COMPLETED { requestId, reason }（reason: arrived | superseded | disconnected）。
 *      回执发送器由 WS 层在 ACTION 分发时注入（ctx.reply），旧客户端收到未知回执会忽略，向后兼容。
 *
 * 判据：
 *  E1  walk_to 收到 ACTION_ACCEPTED（含 estimatedMs）
 *  E2  到达后收到 ACTION_COMPLETED，reason='arrived'，requestId 与指令一致
 *  E3  耗时与 estimatedMs（=距离/5m/s）相符（±35%，含 0.1s tick 粒度）
 *  E4  到达位置准：observe.self 与目标点误差 <0.6m
 *  E5  被打断：第二条 walk_to 下发后，第一条立即收到 COMPLETED reason='superseded'
 *  E6  第二条 walk_to 自己正常到达（reason='arrived'）
 *  E7  follow 打断 walk_to 时，walk_to 收到 reason='superseded'（与 C 项互斥联动）
 *  E8  不存在的目标/非法参数不会误发 COMPLETED（只有 REJECTED）
 *
 * 运行：node scripts/accept_agent_fix_e.js
 */
'use strict';

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
  const r = await j('GET', `${BASE}/api/agent/v1/observe${query}`, undefined, token);
  return r;
}

(async () => {
  console.log('=== Fix E acceptance: walk_to arrival / interrupt receipts ===');
  let adminToken = null, agentId = null, conn = null;
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

    const created = await j('POST', `${BASE}/api/agent/v1/admin/agents`, { name: 'fixe_agent_' + Date.now(), description: 'fix E acceptance' }, adminToken);
    ok('create key agent', created.status === 200 && typeof created.body.apiKey === 'string', 'status=' + created.status);
    agentId = created.body.agent.id;
    const sess = await (await fetch(`${BASE}/api/agent/v1/session`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + created.body.apiKey, 'Content-Type': 'application/json' }, body: '{}'
    })).json();
    const token = sess.token;
    conn = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token)}`);
    ok('WS READY', !!(await conn.waitFor('READY')));
    conn.send({ type: 'SUBSCRIBE', payload: { topics: ['chat'] } });

    // ---- E1~E4：到达回执 ----
    section('1. arrival receipt');
    const T1 = { x: 24, z: 0 };
    const t0 = Date.now();
    conn.send({ type: 'ACTION', payload: { requestId: 'e-arrive', action: 'walk_to', target: T1 } });
    const acc = await conn.waitFor('ACTION_ACCEPTED', 'e-arrive', 5000);
    ok('E1 ACTION_ACCEPTED with estimatedMs', !!acc && Number.isFinite(acc.payload.result.estimatedMs),
      acc ? 'estimatedMs=' + acc.payload.result.estimatedMs : 'no ACCEPTED');
    const comp = await conn.waitFor('ACTION_COMPLETED', 'e-arrive', 15000);
    const elapsed = comp ? comp._at - t0 : -1;
    ok('E2 ACTION_COMPLETED reason=arrived, requestId matched',
      !!comp && comp.payload.reason === 'arrived' && comp.payload.requestId === 'e-arrive',
      comp ? `reason=${comp.payload.reason}` : 'no COMPLETED');
    const est = acc ? acc.payload.result.estimatedMs : 0;
    ok('E3 elapsed matches estimatedMs (distance/5m/s)',
      elapsed > 0 && Math.abs(elapsed - est) / Math.max(est, 1) < 0.35,
      `elapsed=${elapsed}ms estimated=${est}ms`);
    const ob1 = await observe(token, '?radius=5');
    const self1 = ob1.body && ob1.body.self && ob1.body.self.position;
    ok('E4 arrival position correct (<0.6m)',
      !!self1 && d2(self1, T1) < 0.6, self1 ? `self=(${self1.x.toFixed(2)},${self1.z.toFixed(2)})` : 'no self');

    // ---- E5~E6：被打断 ----
    section('2. interrupted walk_to gets a receipt');
    conn.send({ type: 'ACTION', payload: { requestId: 'e-long', action: 'walk_to', target: { x: 120, z: 0 } } });
    await conn.waitFor('ACTION_ACCEPTED', 'e-long', 5000);
    await sleep(900);
    conn.send({ type: 'ACTION', payload: { requestId: 'e-second', action: 'walk_to', target: { x: 0, z: 0 } } });
    const comp1 = await conn.waitFor('ACTION_COMPLETED', 'e-long', 6000);
    ok('E5 interrupted walk_to -> COMPLETED reason=superseded',
      !!comp1 && comp1.payload.reason === 'superseded', comp1 ? `reason=${comp1.payload.reason}` : 'no COMPLETED');
    const comp2 = await conn.waitFor('ACTION_COMPLETED', 'e-second', 30000);
    ok('E6 second walk_to arrives normally', !!comp2 && comp2.payload.reason === 'arrived',
      comp2 ? `reason=${comp2.payload.reason}` : 'no COMPLETED');

    // ---- E7：follow 打断 walk_to ----
    section('3. follow interrupts walk_to');
    conn.send({ type: 'ACTION', payload: { requestId: 'e-3rd', action: 'walk_to', target: { x: 90, z: 90 } } });
    await conn.waitFor('ACTION_ACCEPTED', 'e-3rd', 5000);
    await sleep(700);
    conn.send({ type: 'ACTION', payload: { requestId: 'e-follow', action: 'follow', targetId: agentId, stopDistance: 1, maxDurationMs: 1500 } });
    const comp3 = await conn.waitFor('ACTION_COMPLETED', 'e-3rd', 6000);
    ok('E7 walk_to interrupted by follow -> reason=superseded',
      !!comp3 && comp3.payload.reason === 'superseded', comp3 ? `reason=${comp3.payload.reason}` : 'no COMPLETED');
    const compF = await conn.waitFor('ACTION_COMPLETED', 'e-follow', 8000);
    ok('E7b follow itself ends with timeout/completed receipt',
      !!compF && ['timeout', 'arrived', 'target_lost'].includes(compF.payload.reason),
      compF ? `reason=${compF.payload.reason}` : 'no COMPLETED');

    // ---- E8：非法请求不误发回执 ----
    section('4. invalid request -> only REJECTED');
    conn.send({ type: 'ACTION', payload: { requestId: 'e-bad', action: 'walk_to', target: { x: 99999, z: 0 } } });
    const rej = await conn.waitFor('ACTION_REJECTED', 'e-bad', 5000);
    const badComp = await conn.waitFor('ACTION_COMPLETED', 'e-bad', 1500);
    ok('E8 out-of-bounds walk_to -> REJECTED and no COMPLETED',
      !!rej && rej.payload.code === 'out_of_bounds' && !badComp,
      rej ? `code=${rej.payload.code} completed=${!!badComp}` : 'no REJECTED');
  } catch (e) {
    ok('unexpected error', false, e.message);
  } finally {
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
