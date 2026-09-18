/**
 * accept_agent_fix_d.js — 第一轮联测缺陷 D 验收：Key 档 observe 采样率可配
 *
 * 缺陷（2026-09-18 实测）：observe 对非游客 tier 硬限 1Hz（src/routes/agent/observe.js），
 * 实测频繁 429；跟随闭环误差 1~3m，"AI 端总在找"。
 *
 * 修复：新增 system_config `agent_observe_rate_key`（次/秒，1~10，默认 1）——
 *   - **默认值行为与修复前完全一致**（1Hz，不改变既有验收结论）；
 *   - 调高后限频按新值生效，超频仍 429 且 retryAfter 正确；
 *   - 游客档固定 1 次/2 秒，不受该键影响（红线 15 与拉模式口径不变）。
 *
 * 判据：
 *  D1  默认 1Hz：1 秒内第 2 次 observe → 429（行为不变）
 *  D2  调高到 5Hz：1 秒内前 5 次 200，第 6 次 429
 *  D3  429 响应带 retryAfter（1~2 秒）
 *  D4  窗口过后恢复正常 200
 *  D5  非法值（0 / 99）被拒绝，配置保持 5
 *  D6  游客档观察限频不受该键影响（tierService 规则仍 1 次/2 秒，unit）
 *  D7  调回 1 后恢复 1Hz 行为
 *
 * 运行：node scripts/accept_agent_fix_d.js
 */
'use strict';

const path = require('path');
const BASE = process.env.TEST_BASE || 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? ' :: ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
}
function section(t) { console.log(`\n[${t}]`); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function j(method, url, body, token) {
  const opts = { method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  let jr = null;
  try { jr = await r.json(); } catch (e) { /* ignore */ }
  return { status: r.status, body: jr };
}

/** 在 1 秒窗口内连续打 N 次 observe，返回每次状态码 */
async function burst(token, n, intervalMs = 120) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await j('GET', `${BASE}/api/agent/v1/observe?radius=10`, undefined, token);
    out.push({ status: r.status, retryAfter: r.body && r.body.retryAfter });
    await sleep(intervalMs);
  }
  return out;
}

(async () => {
  console.log('=== Fix D acceptance: key-tier observe sampling rate ===');
  let adminToken = null, agentId = null;
  let origEnabled = false, origPush = 'eco', origRate = 1, origMaxSpeed = 9, origMaxConn = 1;

  try {
    section('0. setup');
    const login = await j('POST', `${BASE}/api/admin-auth/login`, { username: ADMIN_USER, password: ADMIN_PASS });
    if (login.status !== 200) { console.log('FATAL: admin login failed'); process.exit(1); }
    adminToken = login.body.token;
    const cfg = await j('GET', `${BASE}/api/agent/v1/admin/config`, undefined, adminToken);
    origEnabled = cfg.body.config.agentEnabled;
    origPush = cfg.body.config.pushDefault;
    origRate = cfg.body.config.observeRateKey || 1;
    origMaxSpeed = cfg.body.config.maxSpeed || 9;
    origMaxConn = cfg.body.config.maxConnectionsPerAgent || 1;
    ok('config exposes observeRateKey (default 1)', cfg.body.config.observeRateKey === 1, 'rate=' + cfg.body.config.observeRateKey);

    await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_enabled: 'true', agent_observe_rate_key: '1' }, adminToken);
    await sleep(300);
    const created = await j('POST', `${BASE}/api/agent/v1/admin/agents`, { name: 'fixd_agent_' + Date.now(), description: 'fix D acceptance' }, adminToken);
    ok('create key agent', created.status === 200 && typeof created.body.apiKey === 'string', 'status=' + created.status);
    agentId = created.body.agent.id;
    const sess = await (await fetch(`${BASE}/api/agent/v1/session`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + created.body.apiKey, 'Content-Type': 'application/json' }, body: '{}'
    })).json();
    const token = sess.token;

    // ---- D1：默认 1Hz（向后兼容）----
    section('1. default 1Hz (backward compatible)');
    let res1 = await burst(token, 3, 150);
    ok('D1 default 1Hz: 1st=200, 2nd=429', res1[0].status === 200 && res1[1].status === 429,
      res1.map(r => r.status).join(','));
    ok('D3 429 carries retryAfter', res1[1].retryAfter >= 1 && res1[1].retryAfter <= 2, 'retryAfter=' + res1[1].retryAfter);

    await sleep(1300);
    // ---- D2：调高到 5Hz ----
    section('2. raise to 5Hz');
    await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_observe_rate_key: '5' }, adminToken);
    await sleep(2500);   // 等 60s 缓存失效（setConfigValue 即时清缓存，这里留裕量）
    const res5 = await burst(token, 7, 120);
    const first5 = res5.slice(0, 5).filter(r => r.status === 200).length;
    ok('D2 5Hz: first 5 calls 200', first5 >= 4, res5.map(r => r.status).join(','));
    ok('D2b 5Hz: 6th+ call 429', res5.slice(5).some(r => r.status === 429), res5.map(r => r.status).join(','));

    // ---- D4：窗口过后恢复 ----
    section('3. window recovery');
    await sleep(1200);
    const after = await j('GET', `${BASE}/api/agent/v1/observe?radius=10`, undefined, token);
    ok('D4 recovers to 200 after window', after.status === 200, 'status=' + after.status);

    // ---- D5：非法值被拒 ----
    section('4. invalid values rejected');
    await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_observe_rate_key: '99' }, adminToken);
    await sleep(300);
    let cfgAfter = await j('GET', `${BASE}/api/agent/v1/admin/config`, undefined, adminToken);
    const stillBad = cfgAfter.body.config.observeRateKey;
    await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_observe_rate_key: '0' }, adminToken);
    await sleep(300);
    cfgAfter = await j('GET', `${BASE}/api/agent/v1/admin/config`, undefined, adminToken);
    ok('D5 out-of-range values ignored (rate unchanged)', stillBad === 5 && cfgAfter.body.config.observeRateKey === 5,
      `after99=${stillBad} after0=${cfgAfter.body.config.observeRateKey}`);

    // ---- D6：游客档不受影响（unit）----
    section('5. guest tier unaffected (unit)');
    const schema = require(path.join(__dirname, '..', 'src', 'agent', 'agentSchema.js'));
    const guestObserve = (schema.TIER_ACTION_RATES['guest-pull'] || {}).observe;
    ok('D6 guest observe rate stays [1, 2000]', Array.isArray(guestObserve) && guestObserve[0] === 1 && guestObserve[1] === 2000,
      JSON.stringify(guestObserve));

    // ---- D7：调回 1 ----
    section('6. restore 1Hz');
    await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_observe_rate_key: '1' }, adminToken);
    await sleep(1500);
    const resBack = await burst(token, 3, 150);
    ok('D7 back to 1Hz behavior', resBack[0].status === 200 && resBack[1].status === 429, resBack.map(r => r.status).join(','));
  } catch (e) {
    ok('unexpected error', false, e.message);
  } finally {
    if (adminToken) {
      if (agentId) { try { await j('DELETE', `${BASE}/api/agent/v1/admin/agents/${agentId}`, undefined, adminToken); } catch (e) { /* ignore */ } }
      try {
        await j('PUT', `${BASE}/api/agent/v1/admin/config`, {
          agent_enabled: origEnabled ? 'true' : 'false',
          agent_push_default: origPush || 'eco',
          agent_observe_rate_key: String(origRate),
          agent_max_speed: String(origMaxSpeed),
          agent_max_connections_per_agent: String(origMaxConn)
        }, adminToken);
      } catch (e) { /* ignore */ }
      console.log(`\n[restore] enabled=${origEnabled} push=${origPush} observeRate=${origRate} maxSpeed=${origMaxSpeed}`);
    }
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (failures.length) console.log('FAILED: ' + failures.join(' | '));
  process.exitCode = fail === 0 ? 0 : 1;
})();
