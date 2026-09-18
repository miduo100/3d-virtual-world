/**
 * accept_agent_fix_a.js — 第一轮联测缺陷 A 验收：observe 的 self 与 distance 基准
 *
 * 缺陷（2026-09-18 实测）：GET /observe 的 self.position 与所有实体的 distance 原点，
 * 旧实现只取 session.current_position → 用"第二条只读会话（纯 HTTP、无 WS）"调用时恒为 (0,0,0)，
 * 同一 agent 在 entities 里另有真实位置条目 → 客户端按 self 算距离直接跑偏。
 *
 * 修复：观察点解析顺序改为 query x/z → playerPositions 中该 Agent 的实时位置 → session.current_position → (0,0,0)。
 *
 * 判据（self 与 distance 共用同一 pos，故两者必须同时正确）：
 *  A1  有在线 WS 的会话：self == 实时位置（<0.1m）
 *  A2  有在线 WS 的会话：自身实体条目 distance == 0 且 position == self.position
 *  A3  有在线 WS 的会话：每个 object/portal 的 distance == 2D(self, item)（误差 <0.01）
 *  A4  有在线 WS 的会话：distance 原点确为实时位置（与以 (0,0,0) 为原点的口径差 >5m）
 *  A5  纯 HTTP 第二会话（同一 API Key）：self == 实时位置（修复前恒为 (0,0,0)）← 判别性判据
 *  A6  纯 HTTP 第二会话：自身实体条目 distance == 0 且 position == self.position
 *  A7  纯 HTTP 第二会话：object distance 与实时位置口径一致，且非 (0,0,0) 口径
 *  A8  observe 返回结构完整（world/self/entities/objects/portals/radius/limit/timestamp/sequence）
 *  A9  entities 内 id 唯一（缺陷 B 的接口层保证）
 *  A10 radius 仍被硬钳到 ≤200
 *  A11 游客（transient 身份）走同一链路正常：WS 会话 self == 实时位置
 *  A12 无 token 仍 401（鉴权回归）
 *
 * 运行：node scripts/accept_agent_fix_a.js
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
function r2(n) { return Math.round(n * 100) / 100; }

async function j(method, url, body, token) {
  const opts = { method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  let jr = null;
  try { jr = await r.json(); } catch (e) { /* non-JSON */ }
  return { status: r.status, body: jr };
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    ws.addEventListener('message', (ev) => { try { inbox.push(JSON.parse(ev.data)); } catch (e) { /* ignore */ } });
    ws.addEventListener('open', () => resolve({
      ws, inbox,
      send(obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ } },
      async waitFor(type, ms = 5000) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          const m = inbox.find(x => x.type === type);
          if (m) return m;
          await sleep(80);
        }
        return null;
      },
      close() { try { ws.close(); } catch (e) { /* ignore */ } }
    }), { once: true });
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
    setTimeout(() => reject(new Error('ws open timeout')), 8000);
  });
}

/** observe 调用（自动处理 429：等待 retryAfter 后重试，最多 3 次） */
async function observe(token, query = '?radius=100', tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await j('GET', `${BASE}/api/agent/v1/observe${query}`, undefined, token);
    if (r.status !== 429) return r;
    const wait = Math.min(3000, (r.body && r.body.retryAfter ? r.body.retryAfter * 1000 : 1200) + 200);
    await sleep(wait);
  }
  return { status: 429, body: null };
}

/** 轮询直到到达目标点附近（1Hz 限频下的常规做法） */
async function waitArrival(token, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await observe(token, '?radius=5');
    if (r.status === 200 && r.body && r.body.self && r.body.self.position) {
      last = r.body.self.position;
      const err = d2(last, target);
      if (err < 0.6) return { ok: true, pos: last, err };
    }
    await sleep(600);
  }
  return { ok: false, pos: last || { x: 0, y: 0, z: 0 }, err: last ? d2(last, target) : NaN };
}

/** 核验 body 中每个 object/portal 的 distance 是否等于"以 self 为原点"的 2D 距离 */
function checkDistances(body) {
  const self = body.self.position;
  const items = [].concat(body.objects || [], body.portals || []);
  let maxErr = 0, maxOriginDiff = 0, count = 0;
  for (const it of items) {
    if (!it || !it.position) continue;
    const dSelf = Math.hypot(it.position.x - self.x, it.position.z - self.z);
    const dOrigin = Math.hypot(it.position.x, it.position.z);
    maxErr = Math.max(maxErr, Math.abs(dSelf - (typeof it.distance === 'number' ? it.distance : 0)));
    maxOriginDiff = Math.max(maxOriginDiff, Math.abs(dSelf - dOrigin));
    count++;
  }
  return { maxErr, maxOriginDiff, count };
}

function hasKeys(obj, keys) {
  return obj && keys.every(k => Object.prototype.hasOwnProperty.call(obj, k));
}

(async () => {
  console.log('=== Fix A acceptance: observe self / distance origin ===');

  let adminToken = null, agentId = null, guestConn = null, keyConn = null;
  let origEnabled = false, origPush = 'eco', origMaxConn = null;

  try {
    // ---- setup ----
    section('0. setup');
    const login = await j('POST', `${BASE}/api/admin-auth/login`, { username: ADMIN_USER, password: ADMIN_PASS });
    if (login.status !== 200 || !login.body || !login.body.token) {
      console.log('FATAL: admin login failed', login.status, JSON.stringify(login.body));
      process.exit(1);
    }
    adminToken = login.body.token;
    ok('admin login', true);

    const cfg = await j('GET', `${BASE}/api/agent/v1/admin/config`, undefined, adminToken);
    origEnabled = cfg.body.config.agentEnabled;
    origPush = cfg.body.config.pushDefault;
    origMaxConn = cfg.body.config.maxConnectionsPerAgent;
    ok('admin config readable', !!cfg.body.config);
    await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_enabled: 'true' }, adminToken);
    await sleep(300);
    ok('agent_enabled=true (test env)', true);

    const created = await j('POST', `${BASE}/api/agent/v1/admin/agents`, {
      name: 'fixa_agent_' + Date.now(), description: 'fix A acceptance'
    }, adminToken);
    ok('create key agent', created.status === 200 && created.body && typeof created.body.apiKey === 'string',
      'status=' + created.status);
    const apiKey = created.body.apiKey;
    agentId = created.body.agent.id;

    // 同一 API Key 两个会话（① 有 WS 的会话 ② 纯 HTTP 只读会话）
    const s1 = await fetch(`${BASE}/api/agent/v1/session`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: '{}'
    });
    const s1b = await s1.json();
    const s2 = await fetch(`${BASE}/api/agent/v1/session`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: '{}'
    });
    const s2b = await s2.json();
    const token1 = s1b.token, token2 = s2b.token;
    ok('two sessions issued for same API Key', !!token1 && !!token2 && token1 !== token2);

    // ---- ① 有在线 WS 的会话 ----
    section('1. session #1 (with live WS) walks to a known point');
    keyConn = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token1)}`);
    const ready = await keyConn.waitFor('READY', 6000);
    ok('WS READY', !!ready);

    const TARGET = { x: 30, z: 20 };
    keyConn.send({ type: 'ACTION', payload: { requestId: 'fixa-walk', action: 'walk_to', target: TARGET } });
    const acc = await keyConn.waitFor('ACTION_ACCEPTED', 4000);
    ok('walk_to accepted', !!acc);

    const arrived = await waitArrival(token1, TARGET, 25000);
    ok('agent arrived near target', arrived.ok,
      `pos=(${arrived.pos.x.toFixed(2)},${arrived.pos.z.toFixed(2)}) err=${arrived.err.toFixed(2)}m`);
    const live = arrived.pos;

    const ob1 = await observe(token1, '?radius=100');
    ok('observe (ws session) -> 200', ob1.status === 200, 'status=' + ob1.status);
    const self1 = ob1.body.self.position;
    ok('A1 [ws session] self == live position', d2(self1, live) < 0.1,
      `self=(${self1.x.toFixed(2)},${self1.z.toFixed(2)}) live=(${live.x.toFixed(2)},${live.z.toFixed(2)})`);

    const own1 = (ob1.body.entities || []).find(e => String(e.id) === String(agentId));
    ok('A2 [ws session] own entity distance == 0 & position == self',
      !!own1 && own1.distance === 0 && d2(own1.position, self1) < 1e-6,
      own1 ? `distance=${own1.distance} pos=(${own1.position.x},${own1.position.z})` : 'own entity MISSING');

    const chk1 = checkDistances(ob1.body);
    ok('A3 [ws session] object/portal distance == 2D(self,item)', chk1.count > 0 && chk1.maxErr < 0.01,
      `items=${chk1.count} maxErr=${chk1.maxErr.toFixed(4)}`);
    ok('A4 [ws session] distance origin is live position (not 0,0,0)', chk1.maxOriginDiff > 5,
      `maxDiff_vs_origin=${chk1.maxOriginDiff.toFixed(2)}m`);

    // ---- ② 纯 HTTP 第二会话（判别性判据）----
    section('2. session #2 (pure HTTP, no WS) — the discriminating case');
    const ob2 = await observe(token2, '?radius=100');
    ok('observe (http-only session) -> 200', ob2.status === 200, 'status=' + ob2.status);
    const self2 = ob2.body.self.position;
    ok('A5 [http-only] self == live position (was (0,0,0) before fix)', d2(self2, live) < 0.1,
      `self=(${self2.x.toFixed(2)},${self2.z.toFixed(2)}) live=(${live.x.toFixed(2)},${live.z.toFixed(2)})`);

    const own2 = (ob2.body.entities || []).find(e => String(e.id) === String(agentId));
    ok('A6 [http-only] own entity distance == 0 & position == self',
      !!own2 && own2.distance === 0 && d2(own2.position, self2) < 1e-6,
      own2 ? `distance=${own2.distance}` : 'own entity MISSING');

    const chk2 = checkDistances(ob2.body);
    ok('A7 [http-only] object distance uses live origin', chk2.count > 0 && chk2.maxErr < 0.01 && chk2.maxOriginDiff > 5,
      `items=${chk2.count} maxErr=${chk2.maxErr.toFixed(4)} maxDiff_vs_origin=${chk2.maxOriginDiff.toFixed(2)}m`);

    // ---- 结构 / 契约回归 ----
    section('3. payload shape & contract regression');
    ok('A8 observe payload shape complete',
      hasKeys(ob2.body, ['world', 'self', 'entities', 'objects', 'portals', 'radius', 'limit', 'timestamp', 'sequence']),
      Object.keys(ob2.body).join(','));
    const ids = (ob2.body.entities || []).map(e => String(e.id));
    ok('A9 entities ids unique', new Set(ids).size === ids.length, `n=${ids.length} unique=${new Set(ids).size}`);

    const obBig = await observe(token1, '?radius=5000');
    ok('A10 radius still clamped to <=200', obBig.status === 200 && obBig.body.radius <= 200,
      'radius=' + (obBig.body && obBig.body.radius));

    // ---- 游客（transient 身份）同一链路 ----
    section('4. guest (transient identity) same code path');
    const tk = await j('POST', `${BASE}/api/agent/v1/guest/session`, {});
    if (tk.status === 200) {
      guestConn = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(tk.body.token)}`);
      const gReady = await guestConn.waitFor('READY', 6000);
      ok('guest WS READY', !!gReady);
      const GT = { x: 12, z: 8 };
      guestConn.send({ type: 'ACTION', payload: { requestId: 'fixa-gwalk', action: 'walk_to', target: GT } });
      const gArrived = await waitArrival(tk.body.token, GT, 20000);
      ok('guest arrived near target', gArrived.ok, `err=${gArrived.err.toFixed(2)}m`);
      const gOb = await observe(tk.body.token, '?radius=30');
      const gSelf = gOb.body && gOb.body.self && gOb.body.self.position;
      ok('A11 [guest] self == live position (transient path ok)',
        !!gSelf && d2(gSelf, gArrived.pos) < 0.1,
        gSelf ? `self=(${gSelf.x.toFixed(2)},${gSelf.z.toFixed(2)})` : 'no self');
    } else {
      ok('A11 [guest] self == live position (transient path ok)', false,
        'guest ticket unavailable (status=' + tk.status + ' ' + (tk.body && tk.body.code) + ') — restart server to reset per-IP ticket window');
    }

    section('5. auth regression');
    const noTok = await j('GET', `${BASE}/api/agent/v1/observe?radius=10`);
    ok('A12 observe without token -> 401', noTok.status === 401, 'status=' + noTok.status);
  } catch (e) {
    ok('unexpected error', false, e.message);
  } finally {
    // ---- cleanup ----
    try { if (keyConn) keyConn.close(); } catch (e) { /* ignore */ }
    try { if (guestConn) guestConn.close(); } catch (e) { /* ignore */ }
    if (adminToken) {
      if (agentId) { try { await j('DELETE', `${BASE}/api/agent/v1/admin/agents/${agentId}`, undefined, adminToken); } catch (e) { /* ignore */ } }
      try {
        await j('PUT', `${BASE}/api/agent/v1/admin/config`, {
          agent_enabled: origEnabled ? 'true' : 'false',
          agent_push_default: origPush || 'eco',
          ...(origMaxConn ? { agent_max_connections_per_agent: String(origMaxConn) } : {})
        }, adminToken);
      } catch (e) { /* ignore */ }
      console.log(`\n[restore] agent_enabled=${origEnabled ? 'true' : 'false'} pushDefault=${origPush} maxConnPerAgent=${origMaxConn}`);
    }
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (failures.length) console.log('FAILED: ' + failures.join(' | '));
  process.exitCode = fail === 0 ? 0 : 1;
})();
