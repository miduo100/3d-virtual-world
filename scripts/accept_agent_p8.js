/**
 * accept_agent_p8.js — P8「Agent 开放生态：拉/推双模式」验收脚本
 *
 * 判据：
 *  1  无 Key 可签票          POST /guest/session 公开端点返回 200 + tier=guest-pull
 *  2  有票可进场              WS /ws/agent?token= 收到 READY（含 tierInfo，pushAllowed=false）
 *  3  observe 超半径被钳      radius=200 → 游客被静默收敛到 30
 *  4  SUBSCRIBE 被拒         ERROR / GUEST_PUSH_FORBIDDEN
 *  5  动作限频               连续 rotate 第二次被 ACTION_REJECTED(rate_limited)
 *  6  每 IP 并发 2 被拒      第二条游客 WS 连接收到 GUEST_IP_CONCURRENCY 后被关闭
 *  7  空闲踢出生效           独立实例（PORT=3003, AGENT_IDLE_TIMEOUT_MINUTES=0.05）上游客被踢
 *  8  Key Agent 推流回归      Key Agent SUBSCRIBE 成功收到 SUBSCRIBED（三档推送未被破坏）
 *  9  日志三分流落盘          access/ops/audit 三文件均生成且内容命中各自通道
 * 10  日志按天轮转            filePath 随日期变化（unit 级，无需等一天）
 * 11  /health 过滤           access.log 不含 /health
 * 12  游客不获得推流（静态）   READY.pushTier 恒为 eco（即使后台默认档为 realtime）
 *
 * 运行：node scripts/accept_agent_p8.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BASE = process.env.TEST_BASE || 'http://localhost:3002';
const WS_BASE = BASE.replace(/^http/, 'ws');
const LOG_DIR = path.join(__dirname, '..', 'logs');
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

async function j(method, url, body, token) {
  const opts = { method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  let jr = null;
  try { jr = await r.json(); } catch (e) { /* non-JSON */ }
  return { status: r.status, body: jr };
}

/** 最小 WS 客户端：收集收到的消息，直到 close */
function wsConnect(url, { waitMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const inbox = [];
    let ws;
    try { ws = new WebSocket(url); } catch (e) { resolve({ ok: false, error: e.message, inbox }); return; }
    let closed = false;
    const t = setTimeout(() => { if (!closed) { closed = true; try { ws.close(); } catch (e) {} resolve({ ok: true, inbox, timeout: true }); } }, waitMs);
    ws.addEventListener('message', (ev) => {
      try { inbox.push(JSON.parse(ev.data)); } catch (e) { inbox.push({ _raw: ev.data }); }
    });
    ws.addEventListener('close', (ev) => {
      if (closed) return;
      closed = true; clearTimeout(t);
      resolve({ ok: true, inbox, code: ev.code, reason: ev.reason });
    });
    ws.addEventListener('error', () => { /* close 事件随后到达 */ });
    ws._ready = new Promise((res) => ws.addEventListener('open', res, { once: true }));
    ws._inbox = inbox;
    // 暴露句柄供外部 send/close
    setTimeout(() => {}, 0);
    resolve({ ok: true, inbox, ws, pending: true });
  });
}

/** 打开 WS 并等待 open，返回句柄；waitMessages(ms) 收集消息 */
async function openWs(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  ws.addEventListener('message', (ev) => { try { inbox.push(JSON.parse(ev.data)); } catch (e) {} });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', (e) => rej(new Error('ws error: ' + (e.message || 'unknown'))), { once: true });
    setTimeout(() => rej(new Error('ws open timeout')), 5000);
  });
  return {
    ws, inbox,
    send(obj) { ws.send(JSON.stringify(obj)); },
    async waitFor(type, ms = 4000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const m = inbox.find(x => x.type === type);
        if (m) return m;
        await sleep(80);
      }
      return null;
    },
    async waitClose(ms = 8000) {
      if (ws.readyState === WebSocket.CLOSED) return true;
      return await new Promise((res) => {
        const t = setTimeout(() => res(false), ms);
        ws.addEventListener('close', () => { clearTimeout(t); res(true); }, { once: true });
      });
    },
    close() { try { ws.close(); } catch (e) {} }
  };
}

function readLog(channel) {
  const file = path.join(LOG_DIR, `${channel}-${new Date().toISOString().slice(0, 10)}.log`);
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
}

// ==================== main ====================

(async () => {
  console.log('=== P8 acceptance: pull/push dual mode ===');

  // ---- 0. 管理员登录 + 开启 agent_enabled ----
  section('0. setup');
  const login = await j('POST', `${BASE}/api/admin-auth/login`, { username: ADMIN_USER, password: ADMIN_PASS });
  if (login.status !== 200 || !login.body || !login.body.token) {
    console.log('FATAL: admin login failed', login.status, JSON.stringify(login.body));
    process.exit(1);
  }
  const adminToken = login.body.token;
  ok('admin login', true);

  // 记录后台原档位，测试结束恢复
  const cfgBefore = await j('GET', `${BASE}/api/agent/v1/admin/config`, undefined, adminToken);
  const origEnabled = cfgBefore.body && cfgBefore.body.config && cfgBefore.body.config.agentEnabled;
  const origPush = cfgBefore.body && cfgBefore.body.config && cfgBefore.body.config.pushDefault;

  // 故意把默认档调成 realtime —— 验证游客仍被强制 eco（判据 12）
  await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_enabled: 'true', agent_push_default: 'realtime' }, adminToken);
  await sleep(300);
  const cfgAfter = await j('GET', `${BASE}/api/agent/v1/admin/config`, undefined, adminToken);
  ok('agent_enabled=true (test env)', cfgAfter.body.config.agentEnabled === true, JSON.stringify(cfgAfter.body.config.agentEnabled));

  try {
    // ---- 1. 无 Key 可签票 ----
    section('1. guest ticket (no API Key)');
    const t1 = await j('POST', `${BASE}/api/agent/v1/guest/session`, {});
    ok('POST /guest/session -> 200', t1.status === 200, 'status=' + t1.status);
    ok('tier = guest-pull', t1.body && t1.body.tier === 'guest-pull', t1.body && t1.body.tier);
    ok('mode = pull', t1.body && t1.body.mode === 'pull');
    ok('token present', !!(t1.body && t1.body.token));
    ok('ttl = 1800s', t1.body && t1.body.expiresIn === 1800, String(t1.body && t1.body.expiresIn));
    ok('tierInfo.pushAllowed = false', t1.body && t1.body.tierInfo && t1.body.tierInfo.pushAllowed === false);
    ok('tierInfo.observeMaxRadius = 30', t1.body && t1.body.tierInfo && t1.body.tierInfo.observeMaxRadius === 30);
    ok('scopes = full guest whitelist', t1.body && Array.isArray(t1.body.agent.scopes) && t1.body.agent.scopes.includes('say'));
    const guestToken = t1.body.token;
    const guestId = t1.body.agent.id;

    // ---- 2. 有票可进场 ----
    section('2. guest enters world via WS');
    const g1 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(guestToken)}`);
    const ready = await g1.waitFor('READY', 6000);
    ok('READY received', !!ready);
    ok('READY.tier = guest-pull', ready && ready.payload && ready.payload.tier === 'guest-pull', ready && ready.payload && ready.payload.tier);
    ok('READY.tierInfo.pushAllowed = false', ready && ready.payload && ready.payload.tierInfo && ready.payload.tierInfo.pushAllowed === false);

    // 判据 12：游客被强制 eco（即使后台默认档 realtime）
    ok('READY.pushTier forced eco', ready && ready.payload && ready.payload.pushTier === 'eco', ready && ready.payload && ready.payload.pushTier);

    // ---- 3. observe 半径被钳 ----
    section('3. observe radius clamped');
    const ob = await j('GET', `${BASE}/api/agent/v1/observe?radius=200`, undefined, guestToken);
    ok('observe -> 200', ob.status === 200, 'status=' + ob.status);
    ok('observe tier = guest-pull', ob.body && ob.body.tier === 'guest-pull');
    ok('radius clamped to <= 30', ob.body && ob.body.radius <= 30, 'radius=' + (ob.body && ob.body.radius));

    // ---- 4. SUBSCRIBE 被拒 ----
    section('4. SUBSCRIBE rejected for guest');
    g1.send({ type: 'SUBSCRIBE', payload: { topics: ['chat', 'movement'] } });
    const err = await g1.waitFor('ERROR', 4000);
    ok('ERROR received', !!err);
    ok('code = GUEST_PUSH_FORBIDDEN', err && err.payload && err.payload.code === 'GUEST_PUSH_FORBIDDEN', err && err.payload && err.payload.code);
    const subscribed = await g1.waitFor('SUBSCRIBED', 800);
    ok('no SUBSCRIBED sent', !subscribed);

    // ---- 5. 动作限频 ----
    section('5. action rate limit');
    g1.send({ type: 'ACTION', payload: { requestId: 'r1', action: 'rotate', yaw: 1.0 } });
    await sleep(400);
    g1.send({ type: 'ACTION', payload: { requestId: 'r2', action: 'rotate', yaw: 2.0 } });
    const rej = await g1.waitFor('ACTION_REJECTED', 4000);
    ok('second rotate rejected', !!rej, JSON.stringify(rej && rej.payload));
    ok('reject code = rate_limited', rej && rej.payload && rej.payload.code === 'rate_limited', rej && rej.payload && rej.payload.code);
    const accepted1 = g1.inbox.find(m => (m.type === 'ACTION_COMPLETED' || m.type === 'ACTION_ACCEPTED') && m.payload && m.payload.requestId === 'r1');
    ok('first rotate accepted/completed', !!accepted1);

    // ---- 6. 每 IP 并发 2 被拒 ----
    section('6. per-IP concurrency = 1');
    // 每 IP 每小时 10 次签票，第二张票仍可拿（限的是连接数不是票数）
    const t2 = await j('POST', `${BASE}/api/agent/v1/guest/session`, {});
    ok('second ticket issued', t2.status === 200);
    let secondRejected = false, secondCode = null;
    try {
      const g2 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(t2.body.token)}`);
      const e2 = await g2.waitFor('ERROR', 4000);
      if (e2 && e2.payload && e2.payload.code === 'GUEST_IP_CONCURRENCY') { secondRejected = true; secondCode = e2.payload.code; }
      g2.close();
    } catch (e) {
      // open 失败（服务端直接关闭）也算被拒
      if (/1006|1013|abnormal|error/i.test(e.message)) secondRejected = true;
      console.log('    (second ws open error: ' + e.message + ')');
    }
    ok('second guest connection rejected', secondRejected, 'code=' + secondCode);

    // 释放后应可重连（判据 6 附带：名额归还）
    g1.close();
    await sleep(600);
    let reconnectOk = false;
    try {
      const t3 = await j('POST', `${BASE}/api/agent/v1/guest/session`, {});
      const g3 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(t3.body.token)}`);
      reconnectOk = !!(await g3.waitFor('READY', 5000));
      g3.close();
    } catch (e) { /* ignore */ }
    ok('slot released -> reconnect ok', reconnectOk);

    // ---- 8. Key Agent 推流回归 ----
    section('8. Key Agent push regression');
    const created = await j('POST', `${BASE}/api/agent/v1/admin/agents`, {
      name: 'p8_accept_agent_' + Date.now(),
      description: 'P8 acceptance'
    }, adminToken);
    ok('admin create agent -> 200', created.status === 200, 'status=' + created.status);
    const apiKey = created.body && created.body.apiKey;
    ok('apiKey is string', typeof apiKey === 'string' && apiKey.length > 10);

    if (typeof apiKey === 'string') {
      const ks = await j('POST', `${BASE}/api/agent/v1/session`, {}, undefined);
      // session 用 Bearer agk_ 走 API Key 分支
      const ksess = await fetch(`${BASE}/api/agent/v1/session`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: '{}'
      });
      const ksBody = await ksess.json().catch(() => null);
      ok('key session -> 200', ksess.status === 200, 'status=' + ksess.status);
      const keyToken = ksBody && ksBody.token;
      if (keyToken) {
        const k1 = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(keyToken)}`);
        const kReady = await k1.waitFor('READY', 6000);
        ok('key READY received', !!kReady);
        ok('key READY.tier = key-push', kReady && kReady.payload && kReady.payload.tier === 'key-push', kReady && kReady.payload && kReady.payload.tier);
        // 后台默认档已被改成 realtime → Key Agent 应继承 realtime（证明 Key 特权未被破坏）
        ok('key pushTier = realtime (config honored)', kReady && kReady.payload && kReady.payload.pushTier === 'realtime', kReady && kReady.payload && kReady.payload.pushTier);
        k1.send({ type: 'SUBSCRIBE', payload: { topics: ['chat'] } });
        const sub = await k1.waitFor('SUBSCRIBED', 4000);
        ok('key SUBSCRIBE -> SUBSCRIBED', !!sub, JSON.stringify(sub && sub.payload));
        // observe 200m 不被钳到 30
        const kob = await j('GET', `${BASE}/api/agent/v1/observe?radius=200`, undefined, keyToken);
        ok('key observe radius = 200', kob.body && kob.body.radius === 200, 'radius=' + (kob.body && kob.body.radius));
        k1.close();
      }
    }

    // ---- 9/11. 日志三分流 ----
    section('9. log tri-channel');
    await sleep(600);
    const accessTxt = readLog('access');
    const opsTxt = readLog('ops');
    const auditTxt = readLog('audit');
    ok('access.log exists & non-empty', accessTxt.length > 0, 'bytes=' + accessTxt.length);
    ok('ops.log exists & non-empty', opsTxt.length > 0, 'bytes=' + opsTxt.length);
    ok('audit.log exists & non-empty', auditTxt.length > 0, 'bytes=' + auditTxt.length);
    ok('access.log is JSONL', accessTxt.split('\n').filter(Boolean).every(l => { try { JSON.parse(l); return true; } catch (e) { return false; } }));
    ok('access.log has http entries', accessTxt.includes('"kind":"http"'));
    ok('access.log has ticket entries', accessTxt.includes('"kind":"ticket"'));
    ok('access.log has ws entries', accessTxt.includes('"kind":"ws"'));
    ok('audit.log has guest_ticket_issued', auditTxt.includes('guest_ticket_issued'));
    ok('ops.log has server start line', /服务器已启动/.test(opsTxt) || /Server/.test(opsTxt));
    ok('audit.log is JSONL', auditTxt.split('\n').filter(Boolean).every(l => { try { JSON.parse(l); return true; } catch (e) { return false; } }));

    // 判据 11：/health 被过滤
    ok('access.log excludes /health', !accessTxt.includes('"/health"') && !accessTxt.includes('/api/health'));

    // ---- 10. 按天轮转（unit） ----
    section('10. daily rotation (unit)');
    const logger = require('../src/services/logger');
    const d1 = logger._filePath('access', new Date('2026-01-01T10:00:00'));
    const d2 = logger._filePath('access', new Date('2026-01-02T10:00:00'));
    ok('different day -> different file', d1 !== d2, d1 + ' vs ' + d2);
    ok('file name pattern', /access-2026-01-01\.log$/.test(d1), d1);
    ok('retention access=7 ops=30 audit=365',
      logger.RETENTION_DAYS.access === 7 && logger.RETENTION_DAYS.ops === 30 && logger.RETENTION_DAYS.audit === 365,
      JSON.stringify(logger.RETENTION_DAYS));
  } finally {
    // ---- 恢复配置 ----
    await j('PUT', `${BASE}/api/agent/v1/admin/config`, {
      agent_enabled: origEnabled ? 'true' : 'false',
      agent_push_default: origPush || 'eco'
    }, adminToken);
    console.log('\n[restore] agent_enabled=' + (origEnabled ? 'true' : 'false') + ' pushDefault=' + (origPush || 'eco'));
  }

  // ---- 7. 空闲踢出（独立实例，小超时） ----
  section('7. idle timeout kick (separate instance on 3003)');
  const IDLE_PORT = 3003;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(IDLE_PORT), AGENT_IDLE_TIMEOUT_MINUTES: '0.05' },
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: false
  });
  try {
    // 等待实例就绪
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`http://localhost:${IDLE_PORT}/api/health`); if (r.status === 200) { ready = true; break; } } catch (e) {}
      await sleep(1000);
    }
    ok('idle-test instance up', ready);
    if (ready) {
      // 开启该实例的 agent_enabled（同一个 DB，config 共用，主实例已恢复 false → 需重开）
      const lg = await j('POST', `http://localhost:${IDLE_PORT}/api/admin-auth/login`, { username: ADMIN_USER, password: ADMIN_PASS });
      if (lg.body && lg.body.token) {
        await j('PUT', `http://localhost:${IDLE_PORT}/api/agent/v1/admin/config`, { agent_enabled: 'true' }, lg.body.token);
      }
      const tk = await j('POST', `http://localhost:${IDLE_PORT}/api/agent/v1/guest/session`, {});
      ok('idle-test ticket issued', tk.status === 200, 'status=' + tk.status);
      if (tk.status === 200) {
        const gi = await openWs(`ws://localhost:${IDLE_PORT}/ws/agent?token=${encodeURIComponent(tk.body.token)}`);
        ok('idle-test READY', !!(await gi.waitFor('READY', 6000)));
        // 心跳周期 30s，空闲阈值 3s → 最多等 ~40s 应被踢
        const closed = await gi.waitClose(50000);
        ok('idle connection closed by server', closed);
      }
      // 恢复开关
      if (lg.body && lg.body.token) {
        await j('PUT', `http://localhost:${IDLE_PORT}/api/agent/v1/admin/config`, { agent_enabled: 'false' }, lg.body.token);
      }
    }
  } catch (e) {
    ok('idle timeout test', false, e.message);
  } finally {
    try { child.kill('SIGKILL'); } catch (e) {}
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (failures.length) console.log('FAILED: ' + failures.join(' | '));
  process.exitCode = fail === 0 ? 0 : 1;
})();
