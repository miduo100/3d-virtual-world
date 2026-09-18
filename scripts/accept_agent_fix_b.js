/**
 * accept_agent_fix_b.js — 第一轮联测缺陷 B 验收：同角色多连接（去重 + 新连接顶掉旧连接）
 *
 * 缺陷（2026-09-18 实测）：同一 API Key 开两条 WS 连接时
 *   ① observe 的 entities 出现同 id 两条（一条真实位置 animMode=idle，一条 animMode:null 停在出生点）；
 *   ② 两条连接各自 10Hz 广播 POSITION_UPDATE，真人端同一个 avatar 被两个位置源来回拉扯（"移动时原地徘徊"）。
 *   用户实测指正：真人端看不到两个 avatar（前端按 characterId 只画一个），故这是接口层 + 位置源问题。
 *
 * 修复：① entities 按 characterId 去重（保留带 animMode/最新位置的一条）；
 *       ② 新模块 agentConnectionRegistry：同一 agentId 新连接顶掉旧连接（close 4004 REPLACED_BY_NEW_CONNECTION），
 *          上限由 system_config agent_max_connections_per_agent 决定（默认 1，范围 1~10）；
 *          被顶掉的连接静默清理（不广播 PLAYER_LEFT，避免真人端 avatar 闪断）。
 *
 * 判据：
 *  B1  WS READY（第 1 条连接）
 *  B2  第 2 条连接（同一 agentId）成功 READY
 *  B3  旧连接收到 close 4004（REPLACED_BY_NEW_CONNECTION）
 *  B4  audit.log 出现 ws_replaced 事件
 *  B5  observe 中该 agentId 的实体恰好 1 条（去重生效）
 *  B6  该实体 distance == 0 且 position == self.position
 *  B7  真人侧观察者收到该 characterId 的 PLAYER_JOINED（新连接接管，avatar 仍在）
 *  B8  真人侧观察者**没有**收到该 characterId 的 PLAYER_LEFT（avatar 不闪断）
 *  B9  存活连接（第 2 条）能继续推进位置，且 observe 里始终只有 1 条（无位置源拉扯）
 *  B10 entities 内 id 全局唯一
 *  B11 顶替可持续：第 3 条连接顶掉第 2 条（旧连接仍收 4004）
 *  B12 连接注销无残留：旧连接关闭后新连接可正常进场并被 observe 看到
 *  B13 上限可配：agent_max_connections_per_agent=2 时两条连接共存（不互相顶替）
 *  B14 上限=2 时 observe 仍只返回 1 条（去重不依赖顶替）
 *  B15 上限恢复 1 后，新连接顶掉其中一条（4004）
 *
 * 运行：node scripts/accept_agent_fix_b.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE || 'http://localhost:3002';
const WS_BASE = BASE.replace(/^http/, 'ws');
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';
const LOG_DIR = path.join(__dirname, '..', 'logs');

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
  try { jr = await r.json(); } catch (e) { /* non-JSON */ }
  return { status: r.status, body: jr };
}

/** WS 客户端：记录全部入站消息 + close 信息 */
function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    let closed = false;
    let closeInfo = null;
    const waiters = [];
    function notify() { while (waiters.length) waiters.shift()(); }
    ws.addEventListener('message', (ev) => {
      try { inbox.push(JSON.parse(ev.data)); } catch (e) { /* ignore */ }
      notify();
    });
    ws.addEventListener('close', (ev) => {
      if (closed) return;
      closed = true;
      closeInfo = { code: ev.code, reason: ev.reason };
      notify();
    });
    ws.addEventListener('open', () => resolve({
      ws, inbox,
      get closeInfo() { return closeInfo; },
      send(obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ } },
      async waitFor(type, ms = 5000) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          const m = inbox.find(x => x.type === type);
          if (m) return m;
          await Promise.race([new Promise(r => waiters.push(r)), sleep(80)]);
        }
        return null;
      },
      async waitClose(ms = 6000) {
        if (closed) return closeInfo;
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (closed) return closeInfo;
          await Promise.race([new Promise(r => waiters.push(r)), sleep(80)]);
        }
        return closed ? closeInfo : null;
      },
      close() { try { ws.close(); } catch (e) { /* ignore */ } }
    }), { once: true });
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
    setTimeout(() => reject(new Error('ws open timeout')), 8000);
  });
}

async function observe(token, query = '?radius=100', tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await j('GET', `${BASE}/api/agent/v1/observe${query}`, undefined, token);
    if (r.status !== 429) return r;
    const wait = Math.min(3000, (r.body && r.body.retryAfter ? r.body.retryAfter * 1000 : 1200) + 200);
    await sleep(wait);
  }
  return { status: 429, body: null };
}

async function waitArrival(token, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await observe(token, '?radius=5');
    if (r.status === 200 && r.body && r.body.self && r.body.self.position) {
      last = r.body.self.position;
      if (d2(last, target) < 0.6) return { ok: true, pos: last, err: d2(last, target) };
    }
    await sleep(500);
  }
  return { ok: false, pos: last || { x: 0, y: 0, z: 0 }, err: last ? d2(last, target) : NaN };
}

function countEntities(body, id) {
  return (body && body.entities ? body.entities : []).filter(e => String(e.id) === String(id)).length;
}
function selfEntity(body, id) {
  return (body && body.entities ? body.entities : []).find(e => String(e.id) === String(id)) || null;
}
function readLog(channel) {
  const file = path.join(LOG_DIR, `${channel}-${new Date().toISOString().slice(0, 10)}.log`);
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
}

(async () => {
  console.log('=== Fix B acceptance: duplicate connections (dedup + replace) ===');

  let adminToken = null, agentId = null, agentName = null;
  const conns = [];
  let origEnabled = false, origPush = 'eco', origMaxConn = 1;

  try {
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
    origMaxConn = cfg.body.config.maxConnectionsPerAgent || 1;
    await j('PUT', `${BASE}/api/agent/v1/admin/config`,
      { agent_enabled: 'true', agent_max_connections_per_agent: '1' }, adminToken);
    await sleep(300);
    ok('agent_enabled=true & maxConnPerAgent=1 (test env)', true);

    agentName = 'fixb_agent_' + Date.now();
    const created = await j('POST', `${BASE}/api/agent/v1/admin/agents`, { name: agentName, description: 'fix B acceptance' }, adminToken);
    ok('create key agent', created.status === 200 && typeof created.body.apiKey === 'string', 'status=' + created.status);
    const apiKey = created.body.apiKey;
    agentId = created.body.agent.id;

    const sess = async () => {
      const r = await fetch(`${BASE}/api/agent/v1/session`, {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: '{}'
      });
      const b = await r.json().catch(() => null);
      return { status: r.status, token: b && b.token };
    };
    const s1 = await sess();
    const s2 = await sess();
    const token1 = s1.token, token2 = s2.token;
    ok('two sessions issued', !!token1 && !!token2);

    // ---- 真人侧观察者（根路径人类 WS，仅收广播，用于判断 avatar 是否被 PLAYER_LEFT 闪断）----
    section('1. human observer on root-path WS');
    const obsId = 'acc-observer-' + Date.now();
    const observer = await openWs(`${WS_BASE}/`);
    observer.send({ type: 'PLAYER_JOIN', payload: { characterId: obsId, characterName: 'acc_observer', position: { x: 900, y: 0, z: 900 } } });
    const worldState = await observer.waitFor('WORLD_STATE', 5000);
    conns.push(observer);
    ok('B0 observer registered (WORLD_STATE)', !!worldState);

    // ---- 第 1 条连接：走到已知点 ----
    section('2. connection #1 walks, then connection #2 takes over');
    const k1 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token1)}`);
    conns.push(k1);
    ok('B1 connection #1 READY', !!(await k1.waitFor('READY', 6000)));

    const P1 = { x: 10, z: 0 };
    k1.send({ type: 'ACTION', payload: { requestId: 'fixb-w1', action: 'walk_to', target: P1 } });
    const arr1 = await waitArrival(token1, P1, 20000);
    ok('connection #1 arrived at (10,0)', arr1.ok, `err=${arr1.err.toFixed(2)}m`);

    const k2 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token2)}`);
    conns.push(k2);
    ok('B2 connection #2 (same agentId) READY', !!(await k2.waitFor('READY', 6000)));

    const close1 = await k1.waitClose(6000);
    ok('B3 old connection closed with 4004', !!close1 && close1.code === 4004,
      close1 ? `code=${close1.code} reason=${close1.reason}` : 'no close event');

    const auditTxt = readLog('audit');
    ok('B4 audit.log has ws_replaced', auditTxt.includes('ws_replaced'), 'audit bytes=' + auditTxt.length);

    await sleep(400);
    const ob1 = await observe(token2, '?radius=100');
    ok('B5 observe returns exactly 1 entity for this agentId', ob1.status === 200 && countEntities(ob1.body, agentId) === 1,
      `status=${ob1.status} count=${countEntities(ob1.body, agentId)}`);

    const own = selfEntity(ob1.body, agentId);
    const selfPos = ob1.body && ob1.body.self ? ob1.body.self.position : null;
    ok('B6 own entity distance == 0 & position == self.position',
      !!own && own.distance === 0 && !!selfPos && d2(own.position, selfPos) < 1e-6,
      own ? `distance=${own.distance} animMode=${own.animMode}` : 'missing');

    const joinedForAgent = observer.inbox.filter(m => m.type === 'PLAYER_JOINED'
      && m.payload && String(m.payload.characterId) === String(agentId));
    const leftForAgent = observer.inbox.filter(m => m.type === 'PLAYER_LEFT'
      && m.payload && String(m.payload.characterId) === String(agentId));
    ok('B7 observer received PLAYER_JOINED for this characterId (new conn took over)', joinedForAgent.length >= 1,
      'joined=' + joinedForAgent.length);
    ok('B8 observer received NO PLAYER_LEFT for this characterId (no avatar flicker)', leftForAgent.length === 0,
      'left=' + leftForAgent.length);

    // ---- 存活连接继续推进：无位置源拉扯 ----
    section('3. surviving connection drives the single entity');
    const P2 = { x: 25, z: 25 };
    k2.send({ type: 'ACTION', payload: { requestId: 'fixb-w2', action: 'walk_to', target: P2 } });
    const arr2 = await waitArrival(token2, P2, 25000);
    ok('connection #2 arrived at (25,25)', arr2.ok, `err=${arr2.err.toFixed(2)}m`);
    const ob2 = await observe(token2, '?radius=100');
    const own2 = selfEntity(ob2.body, agentId);
    ok('B9 single entity tracks the surviving connection', countEntities(ob2.body, agentId) === 1
      && !!own2 && d2(own2.position, P2) < 0.6,
      `count=${countEntities(ob2.body, agentId)} pos=(${own2 ? own2.position.x.toFixed(1) : '?'},${own2 ? own2.position.z.toFixed(1) : '?'})`);
    const ids = (ob2.body.entities || []).map(e => String(e.id));
    ok('B10 entities ids unique', new Set(ids).size === ids.length, `n=${ids.length} unique=${new Set(ids).size}`);

    // ---- 顶替可持续 + 注销无残留 ----
    section('4. replacement is repeatable & unregister leaves no residue');
    const k3 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token1)}`);
    conns.push(k3);
    ok('B11 connection #3 READY and #2 replaced',
      !!(await k3.waitFor('READY', 6000)) && (await k2.waitClose(6000) || {}).code === 4004,
      'k2 close=' + JSON.stringify(k2.closeInfo));

    k3.close();
    await sleep(800);
    const k4 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token1)}`);
    conns.push(k4);
    ok('B12 after close, a new connection enters normally', !!(await k4.waitFor('READY', 6000)));

    // ---- 上限可配（2 条共存 + 仍去重）----
    section('5. agent_max_connections_per_agent=2 -> coexist, still deduped');
    await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_max_connections_per_agent: '2' }, adminToken);
    await sleep(400);
    const k5 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token1)}`);
    const k6 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token2)}`);
    conns.push(k5, k6);
    const r5 = await k5.waitFor('READY', 6000);
    const r6 = await k6.waitFor('READY', 6000);
    await sleep(1500);
    ok('B13 with limit=2 both connections stay alive',
      !!r5 && !!r6 && k5.closeInfo === null && k6.closeInfo === null,
      `k5=${JSON.stringify(k5.closeInfo)} k6=${JSON.stringify(k6.closeInfo)}`);

    const ob3 = await observe(token2, '?radius=100');
    ok('B14 observe still returns exactly 1 entity (dedup independent of replace)',
      ob3.status === 200 && countEntities(ob3.body, agentId) === 1,
      `count=${countEntities(ob3.body, agentId)}`);

    // ---- 恢复上限 1：新连接顶掉全部旧连接（并发数收敛到上限）----
    section('6. restore limit=1 -> new connection evicts all older ones');
    await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_max_connections_per_agent: '1' }, adminToken);
    await sleep(400);
    const k7 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token1)}`);
    conns.push(k7);
    ok('B15 new connection READY with limit=1', !!(await k7.waitFor('READY', 6000)));
    const c5 = await k5.waitClose(6000);
    const c6 = await k6.waitClose(6000);
    // 上限被调低后再有新连接：需要腾出 (现有 + 1 - 上限) 个名额 → 两条旧连接都被顶掉，
    // 保证最终并发数 == 上限（注册表语义：注册后该 agent 的连接数不超过 limit）。
    ok('B15b all older connections evicted with 4004 (concurrency converges to limit)',
      (c5 && c5.code === 4004) && (c6 && c6.code === 4004) && k7.closeInfo === null,
      `k5=${JSON.stringify(c5)} k6=${JSON.stringify(c6)} k7=${JSON.stringify(k7.closeInfo)}`);
    const ob4 = await observe(token2, '?radius=100');
    ok('B15c observe returns exactly 1 entity after converge',
      ob4.status === 200 && countEntities(ob4.body, agentId) === 1,
      `count=${countEntities(ob4.body, agentId)}`);
  } catch (e) {
    ok('unexpected error', false, e.message);
  } finally {
    for (const c of conns) { try { c.close(); } catch (e) { /* ignore */ } }
    if (adminToken) {
      if (agentId) { try { await j('DELETE', `${BASE}/api/agent/v1/admin/agents/${agentId}`, undefined, adminToken); } catch (e) { /* ignore */ } }
      try {
        await j('PUT', `${BASE}/api/agent/v1/admin/config`, {
          agent_enabled: origEnabled ? 'true' : 'false',
          agent_push_default: origPush || 'eco',
          agent_max_connections_per_agent: String(origMaxConn || 1)
        }, adminToken);
      } catch (e) { /* ignore */ }
      console.log(`\n[restore] agent_enabled=${origEnabled ? 'true' : 'false'} pushDefault=${origPush} maxConnPerAgent=${origMaxConn}`);
    }
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (failures.length) console.log('FAILED: ' + failures.join(' | '));
  process.exitCode = fail === 0 ? 0 : 1;
})();
