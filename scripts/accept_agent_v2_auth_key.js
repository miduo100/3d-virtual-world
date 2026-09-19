/**
 * AI Agent 接入 v2 联测 —— Key 档（key-push）对照矩阵 + C2 空闲续命压缩回归
 *
 * 覆盖提示词 §1.1 中 Key 档专属用例：
 *   K1 管理员创建测试 Agent（拿明文 Key）
 *   K2 /session 换票 + /me；错误 Key / 非法格式被拒
 *   K3 WS 连接：自身 push_tier 生效（realtime）、SUBSCRIBE 允许、observe 200m 不被钳、1Hz 限频
 *   K4 同角色多连接 → 旧连接 4004 REPLACED_BY_NEW_CONNECTION；真人侧**不广播 PLAYER_LEFT**；entities 去重
 *   K5 Key 档无动作限频（连发 say 均成功）
 *   K6 revoke 后 token 立即失效（403 SESSION_REVOKED）
 *   K7 C2 回归（压缩）：独立实例 3003 + AGENT_IDLE_TIMEOUT_MINUTES=0.05
 *        → 游客只 PING 会被踢（防滥用阀门保留）；Key 档只 PING / 只 observe 能续命
 *   K8 清理：删除测试 Agent（级联清 Key/会话，在线连接被踢 4003）
 *
 * 运行：node scripts/accept_agent_v2_auth_key.js
 *       SKIP_K7=1 node scripts/accept_agent_v2_auth_key.js   # 跳过 ~2 分钟的 K7 慢用例
 * 报告：examples/agent-client/live/v2-auth-key.json
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const K = require('./agentV2TestKit');

const R = K.createReporter('Key 档对照矩阵 + C2 空闲续命回归');
const sleep = K.sleep;

const RUN = (Math.floor(Date.now() / 1000) % 90) + 10;
const AGENT_NAME = `v2_key_agent_${RUN}`;
const OBSERVER_CHAR = uuidv4();
const IDLE_PORT = 3003;
const BASE = K.BASE;

const openSockets = [];
let agentId = null, apiKey = null, sessionToken = null, observerConn = null;

async function adminToken() {
  const r = await K.httpJson('/api/admin-auth/login', {
    method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
  });
  const j = r.json || {};
  return j.token || (j.data && j.data.token) || null;
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  return K.httpJson(pathname, { method, headers, body });
}

// ==================== K1 创建测试 Agent ====================

async function k1(admin) {
  const r = await api('/api/agent/v1/admin/agents', {
    method: 'POST', token: admin, body: { name: AGENT_NAME, description: 'v2 登录/鉴权矩阵测试 Agent', pushTier: 'realtime' }
  });
  const okCreate = r.status === 200 && r.json && r.json.apiKey;
  R.check('K1 管理员创建测试 Agent（拿明文 Key，档位 realtime）', okCreate, { status: r.status, code: r.json && r.json.code });
  if (!okCreate) return null;
  agentId = r.json.agent.id;
  apiKey = r.json.apiKey;
  R.check('K1b Key 形如 agk_live_<64hex>', /^agk_live_[a-f0-9]{64}$/.test(apiKey), apiKey.slice(0, 20) + '...');
  R.check('K1c agent.id 为 UUID（非 agent: 合成 ID）', /^[0-9a-f-]{36}$/.test(agentId), agentId);
  return r.json;
}

// ==================== K2 换票 ====================

async function k2() {
  const r = await api('/api/agent/v1/session', { method: 'POST', token: apiKey });
  R.check('K2 Key 换票 200', r.status === 200 && !!r.json.token, { status: r.status, code: r.json && r.json.code });
  if (r.status !== 200) return;
  sessionToken = r.json.token;
  R.check('K2b expiresIn=900（15min）', r.json.expiresIn === 900, r.json.expiresIn);
  R.check('K2c agent.id 与创建时一致', r.json.agent && r.json.agent.id === agentId, r.json.agent && r.json.agent.id);
  R.check('K2d scope 无 teleport（红线 2）',
    Array.isArray(r.json.agent.scopes) && !r.json.agent.scopes.includes('teleport'), r.json.agent.scopes);

  const me = await api('/api/agent/v1/me', { token: sessionToken });
  R.check('K2e GET /me 200 且含 avatar/permissions', me.status === 200 && !!me.json.agent && !!me.json.permissions,
    { status: me.status });
  const noTok = await api('/api/agent/v1/me');
  R.check('K2f /me 无 token → 401', noTok.status === 401, noTok.status);
  const fakeKey = 'agk_live_' + 'f'.repeat(64);
  const bad = await api('/api/agent/v1/session', { method: 'POST', token: fakeKey });
  R.check('K2g 格式合法但不存在的 Key → 401 AGENT_KEY_INVALID',
    bad.status === 401 && bad.json.code === 'AGENT_KEY_INVALID', { status: bad.status, code: bad.json && bad.json.code });
  const malformed = await api('/api/agent/v1/session', { method: 'POST', token: 'not-a-key' });
  R.check('K2h 格式非法 → 401 AGENT_KEY_INVALID',
    malformed.status === 401 && malformed.json.code === 'AGENT_KEY_INVALID', { status: malformed.status, code: malformed.json && malformed.json.code });
}

// ==================== K3 WS 连接与特权 ====================

async function k3() {
  // 真人侧观察者必须**先于 Agent 首次入场**连接，否则收不到第一次 PLAYER_JOINED
  // （人类 WS 无鉴权，用作"真人端 avatar 是否闪断"的观测点）
  const humanObs = await K.openHumanWs({ characterId: OBSERVER_CHAR, characterName: '观察者-v2' });
  if (humanObs.ok) { openSockets.push(humanObs.ws); observerConn = humanObs; }
  R.check('K3-obs 真人观察者已入场（PLAYER_JOIN 已发送）', humanObs.ok === true, humanObs.ok ? 'ok' : humanObs.error);
  await sleep(800);

  const c = await K.openAgentWs({ authHeader: 'Bearer ' + sessionToken });
  if (c.ok) openSockets.push(c.ws);
  R.check('K3 Key Agent WS 连接成功（Authorization 头）', c.ok === true, c.ok ? 'upgraded' : (c.statusCode || c.error));
  if (!c.ok) return null;
  const ready = await K.waitFor(c.msgs, 'READY', 5000);
  R.check('K3b READY.tier=key-push', ready && ready.payload.tier === 'key-push', ready && ready.payload.tier);
  R.check('K3c READY.tierInfo.pushAllowed=true（Key = 推流特权）',
    ready && ready.payload.tierInfo && ready.payload.tierInfo.pushAllowed === true, ready && ready.payload.tierInfo && ready.payload.tierInfo.pushAllowed);
  R.check('K3d 自身 push_tier（realtime）优先于全局默认档', ready && ready.payload.pushTier === 'realtime', ready && ready.payload.pushTier);

  K.wsSend(c.ws, { type: 'SUBSCRIBE', payload: { topics: ['chat', 'presence', 'movement'] } });
  const sub = await K.waitFor(c.msgs, 'SUBSCRIBED', 3000);
  R.check('K3e SUBSCRIBE 允许（推流未被禁）', !!sub && sub.payload.topics.includes('chat'), sub && sub.payload);

  const obs = await api('/api/agent/v1/observe?radius=200', { token: sessionToken });
  R.check('K3f Key 档 observe radius=200 不被钳（红线 15 只约束游客）',
    obs.status === 200 && obs.json.radius === 200, { status: obs.status, radius: obs.json && obs.json.radius });
  const obs2 = await api('/api/agent/v1/observe?radius=30', { token: sessionToken });
  R.check('K3g Key 档 1Hz 限频生效 → 429 AGENT_OBSERVE_RATE_LIMITED',
    obs2.status === 429 && obs2.json.code === 'AGENT_OBSERVE_RATE_LIMITED',
    { status: obs2.status, code: obs2.json && obs2.json.code, retryAfter: obs2.json && obs2.json.retryAfter });
  await sleep(1100);
  const obs3 = await api('/api/agent/v1/observe?radius=30', { token: sessionToken });
  R.check('K3h 1 秒后恢复 200（窗口滚动）', obs3.status === 200, obs3.status);
  return c;
}

// ==================== K4 同角色多连接 ====================

async function k4(conn1) {
  const obs = observerConn;   // 观察者已在 k3 入场（在 Agent 首次入场之前）
  if (!obs) { R.check('K4 前置：真人观察者可用', false); return null; }
  const conn2 = await K.openAgentWs({ authHeader: 'Bearer ' + sessionToken });
  if (conn2.ok) openSockets.push(conn2.ws);
  R.check('K4 同 Agent 第 2 条连接成功建立（顶替而非拒绝）', conn2.ok === true, conn2.ok ? 'upgraded' : (conn2.statusCode || conn2.error));
  if (!conn2.ok) return null;
  await K.waitFor(conn2.msgs, 'READY', 5000);

  const closeInfo = await K.waitClose(conn1.closeInfo, 6000);
  R.check('K4b 旧连接被关闭且 close code=4004', closeInfo && closeInfo.code === 4004,
    { code: closeInfo && closeInfo.code, reason: closeInfo && closeInfo.reason });

  await sleep(1200);
  const joined = K.msgsOfType(obs.msgs, 'PLAYER_JOINED').filter(m => m.payload && m.payload.characterId === agentId);
  const left = K.msgsOfType(obs.msgs, 'PLAYER_LEFT').filter(m => m.payload && m.payload.characterId === agentId);
  R.check('K4c 真人侧收到 PLAYER_JOINED 2 次（两连接各一次）', joined.length === 2, { joined: joined.length });
  R.check('K4d 被顶掉的连接**静默清理**：真人侧 0 次 PLAYER_LEFT（avatar 不闪断）',
    left.length === 0, { left: left.length });

  const o = await api('/api/agent/v1/observe?radius=200', { token: sessionToken });
  const mine = ((o.json && o.json.entities) || []).filter(e => e.id === agentId);
  R.check('K4e observe 中该 id 恰好 1 条（同角色多连接已去重）', mine.length === 1, { 命中: mine.length });
  return conn2;
}

// ==================== K5 Key 档无动作限频 ====================

async function k5(conn) {
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const requestId = 'k5-' + i + '-' + Math.random().toString(36).slice(2, 8);
    ids.push(requestId);
    K.wsSend(conn.ws, { type: 'ACTION', payload: { requestId, action: 'say', text: 'Key档限频探针 ' + i } });
  }
  await sleep(1500);
  const results = ids.map(id => conn.msgs.find(m => m.payload && m.payload.requestId === id));
  const completed = results.filter(m => m && m.type === 'ACTION_COMPLETED').length;
  R.check('K5 Key 档无游客级动作限频：连发 2 条 say 均 ACTION_COMPLETED（间隔 0ms）',
    completed === 2, { completed, detail: results.map(m => m && m.type) });
}

// ==================== K6 revoke ====================

async function k6() {
  const r = await api('/api/agent/v1/session/revoke', { method: 'POST', token: sessionToken });
  R.check('K6 POST /session/revoke 200', r.status === 200 && r.json.revoked === true, { status: r.status, body: r.json });
  const me = await api('/api/agent/v1/me', { token: sessionToken });
  R.check('K6b 吊销后同 token 调 /me → 403 SESSION_REVOKED',
    me.status === 403 && me.json.code === 'SESSION_REVOKED', { status: me.status, code: me.json && me.json.code });
  const obs = await api('/api/agent/v1/observe?radius=30', { token: sessionToken });
  R.check('K6c 吊销后 observe 亦 403（第二道门 jti 权威）', obs.status === 403, obs.status);
}

// ==================== K7 C2 回归（压缩版：独立实例 + 3 秒空闲阈值）====================

async function k7() {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(IDLE_PORT), AGENT_IDLE_TIMEOUT_MINUTES: '0.05' },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`http://localhost:${IDLE_PORT}/api/health`); if (r.status === 200) { up = true; break; } } catch (e) {}
      await sleep(1000);
    }
    R.check('K7 独立实例（3003，空闲阈值 3s）启动就绪', up);
    if (!up) return;

    // 该实例只用于空闲测试；agent_enabled 与 DB 共用（主实例已置 true）
    const cfg = await fetch(`http://localhost:${IDLE_PORT}/.well-known/virtual-world-agent.json`).then(r => r.json()).catch(() => null);
    R.check('K7b 3003 实例 agentEnabled=true（配置共用 DB）', cfg && cfg.agentEnabled === true, cfg && cfg.agentEnabled);

    // ① 游客只 PING → 应被踢（游客 PING 故意不计入活跃度，防过期票占名额）
    const gt = await fetch(`http://localhost:${IDLE_PORT}/api/agent/v1/guest/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Real-IP': '203.0.113.200', 'X-Forwarded-For': '203.0.113.200' }, body: '{}'
    }).then(r => r.json()).catch(() => null);
    R.check('K7c 3003 实例签游客票成功', !!(gt && gt.token), gt && (gt.code || 'ok'));
    if (gt && gt.token) {
      const gws = await openWsOnPort(IDLE_PORT, gt.token);
      const pingTimer = setInterval(() => { K.wsSend(gws.ws, { type: 'PING' }); }, 800);
      const closed = await K.waitClose(gws.closeInfo, 45000);
      clearInterval(pingTimer);
      R.check('K7d 游客"只 PING"被空闲超时踢出（阀门保留）', closed && closed.code !== null,
        { code: closed && closed.code, reason: closed && closed.reason, 观测秒数: '≤45' });
      K.closeAll(gws.ws);
      await sleep(500);
    }

    // ② Key 档只 PING → 应存活（PING 计入 Key 档活跃度）
    const kt = await api('/api/agent/v1/session', { method: 'POST', token: apiKey });
    if (kt.status === 200) {
      const kws = await openWsOnPort(IDLE_PORT, kt.json.token);
      const pingTimer = setInterval(() => { K.wsSend(kws.ws, { type: 'PING' }); }, 800);
      await sleep(45000);      // 远大于 3s 阈值 + 30s 心跳周期
      const alive = kws.closeInfo.code === null;
      clearInterval(pingTimer);
      R.check('K7e Key 档"只 PING"存活超过 45s（C2 修复：PING 计入活跃）', alive,
        { closeCode: kws.closeInfo.code, 阈值: '3s / 心跳 30s' });
      K.closeAll(kws.ws);
      await sleep(500);
    } else {
      R.check('K7e Key 档换票（3003 实例共享 DB/密钥）', false, kt.status);
    }

    // ③ Key 档只 observe（不动作、不订阅）→ 应存活（HTTP observe 计入活跃度）
    const kt2 = await api('/api/agent/v1/session', { method: 'POST', token: apiKey });
    if (kt2.status === 200) {
      const kws2 = await openWsOnPort(IDLE_PORT, kt2.json.token);
      const t0 = Date.now();
      let obsOk = 0;
      while (Date.now() - t0 < 42000) {
        const r = await fetch(`http://localhost:${IDLE_PORT}/api/agent/v1/observe?radius=30`, {
          headers: { Authorization: 'Bearer ' + kt2.json.token }
        }).catch(() => null);
        if (r && r.status === 200) obsOk++;
        await sleep(1100);
      }
      const alive = kws2.closeInfo.code === null;
      R.check('K7f Key 档"只 observe 不动作"存活超过 42s（C2 修复：HTTP observe 计入活跃）', alive,
        { closeCode: kws2.closeInfo.code, 成功observe次数: obsOk });
      K.closeAll(kws2.ws);
      await sleep(500);
    }
  } catch (e) {
    R.check('K7 空闲续命回归', false, e.message);
  } finally {
    try { child.kill('SIGKILL'); } catch (e) {}
  }
}

async function openWsOnPort(port, token) {
  const WebSocket = require('ws');
  const url = `ws://localhost:${port}/ws/agent?token=` + encodeURIComponent(token);
  const result = { ws: null, msgs: [], closeInfo: { code: null, reason: null } };
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    result.ws = ws;
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; try { ws.terminate(); } catch (e) {} resolve(result); } }, 8000);
    ws.on('open', () => { clearTimeout(timer); if (!settled) { settled = true; resolve(result); } });
    ws.on('message', d => { try { result.msgs.push(JSON.parse(d.toString())); } catch (e) {} });
    ws.on('close', (code, reason) => { result.closeInfo.code = code; result.closeInfo.reason = reason ? reason.toString() : ''; });
    ws.on('error', () => { clearTimeout(timer); if (!settled) { settled = true; resolve(result); } });
  });
}

// ==================== K8 清理 ====================

async function k8(admin, conn2) {
  if (conn2 && conn2.ws) { K.closeAll(conn2.ws); await sleep(400); }
  if (observerConn && observerConn.ws) { K.closeAll(observerConn.ws); await sleep(300); }
  const r = await api('/api/agent/v1/admin/agents/' + agentId, { method: 'DELETE', token: admin });
  R.check('K8 删除测试 Agent 200（Key/会话级联清理）', r.status === 200, { status: r.status, body: r.json });
  const list = await api('/api/agent/v1/admin/agents', { token: admin });
  const still = ((list.json && list.json.agents) || []).some(a => a.id === agentId);
  R.check('K8b 删除后列表中不再出现该 Agent', !still);
}

// ==================== 主流程 ====================

(async () => {
  const started = Date.now();
  const report = { when: new Date().toISOString(), run: RUN, agentName: AGENT_NAME, groups: {}, fatal: null };
  let admin = null, conn1 = null, conn2 = null;
  try {
    admin = await adminToken();
    R.check('K0 管理员登录成功', !!admin, admin ? 'ok' : 'failed');
    if (!admin) throw new Error('admin login failed');

    report.groups.K1 = await k1(admin);
    if (!apiKey) throw new Error('create agent failed');

    await k2();
    conn1 = await k3();
    if (conn1) conn2 = await k4(conn1);
    if (conn2) await k5(conn2);
    await k6();
    if (process.env.SKIP_K7 === '1') R.info('K7 已跳过（SKIP_K7=1，仅用于快速重跑其他用例）');
    else await k7();
    await k8(admin, conn2);
  } catch (e) {
    report.fatal = e.stack || e.message;
    console.error('FATAL', e);
  } finally {
    K.closeAll(...openSockets);
  }

  const sum = R.summary();
  report.result = { pass: sum.pass, fail: sum.fail, total: sum.total };
  report.rows = sum.rows;
  report.durationMs = Date.now() - started;
  const dir = path.join(__dirname, '..', 'examples', 'agent-client', 'live');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'v2-auth-key.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log('报告: ' + out);
  process.exitCode = sum.fail === 0 ? 0 : 1;
})();
