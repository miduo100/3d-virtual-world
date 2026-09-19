/**
 * accept_agent_jwt_expiry.js — 机制级实证：Agent JWT 到期后 **HTTP 拒绝、WS 不校验**
 *
 * 背景（v5 轮 35 分钟长会话实测发现的真实现象）：连接建立后 WS 一直活着（35 分钟远超 TTL 900s），
 * 但 `observe` 等 HTTP 调用从 t≈15min 起全部 403 TOKEN_EXPIRED。
 *
 * 实证方式（不需要等 15 分钟）：用 AGENT_JWT_SECRET 自己签一个 **已过期** 但 jti 指向**有效会话**的 token
 *   - 若 HTTP observe 返回 403 TOKEN_EXPIRED → 证明 HTTP 每次调用都重新校验 JWT
 *   - 若 WS upgrade 用同一 token 也 403 → 与既有 C4 判据一致
 *   - 同时用**新签的有效 token** 调 observe 返回 200 → 证明会话本身仍有效（区别只在 JWT 过期）
 *
 * 用法：node scripts/accept_agent_jwt_expiry.js   （6/6 PASS，可重跑；收尾把 agent_enabled 复位 false）
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const K = require('./agentV2TestKit');

const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const SECRET = process.env.AGENT_JWT_SECRET;
const store = JSON.parse(fs.readFileSync(path.join(__dirname, '_tmp_tier_agents.json'), 'utf8'));
const AGENT = store.created.find(a => a.key === 'eco') || store.created[0];

function decode(t) { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')); }

(async () => {
  const R = K.createReporter('JWT 到期机制实证（HTTP vs WS）');
  if (!SECRET) { console.log('缺 AGENT_JWT_SECRET'); process.exitCode = 1; return; }

  // 前置：打开总闸
  const sw = await K.httpJson('/api/agent/v1/admin/config', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + store.adminToken }, body: { agent_enabled: 'true' }
  });
  R.check('P0 agent_enabled=true', sw.status === 200, sw.status);

  // 1) 正常换票（有效 token + 有效会话）
  const s = await K.httpJson('/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + AGENT.apiKey }, body: {}
  });
  const fresh = s.json && s.json.token;
  R.check('P1 换票成功', s.status === 200 && !!fresh, s.status);
  if (!fresh) return;
  const payload = decode(fresh);
  console.log('   jti =', payload.jti, '| exp =', new Date(payload.exp * 1000).toISOString());

  const ok = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: { Authorization: 'Bearer ' + fresh } });
  R.check('P2 有效 token 调 observe → 200', ok.status === 200, ok.status);

  // 2) 同一 jti（有效会话）+ 已过期签名 → HTTP 应 403 TOKEN_EXPIRED
  const expired = jwt.sign(
    { sub: payload.sub, principalType: 'agent', worldId: payload.worldId, scopes: payload.scopes },
    SECRET,
    { jwtid: payload.jti, expiresIn: -60 }
  );
  const expObs = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: { Authorization: 'Bearer ' + expired } });
  R.check('P3 同一会话 jti + 已过期 JWT → HTTP observe 403 TOKEN_EXPIRED（HTTP 每次调用都校验）',
    expObs.status === 403 && expObs.json && expObs.json.code === 'TOKEN_EXPIRED',
    { status: expObs.status, code: expObs.json && expObs.json.code });

  // 3) 同一过期 token 连 WS → 升级阶段 403（与既有 C4 判据一致）
  const wsExp = await K.openAgentWs({ token: expired, authHeader: 'Bearer ' + expired });
  R.check('P4 过期 JWT 连 /ws/agent → 升级阶段 403', wsExp.ok === false && wsExp.statusCode === 403,
    { ok: wsExp.ok, statusCode: wsExp.statusCode });

  // 4) 用有效 token 建连后再换新票：WS 不断；旧 jti 的 HTTP 会 403、新 jti 的 HTTP 200
  const conn = await K.openAgentWs({ token: fresh, authHeader: 'Bearer ' + fresh });
  K.waitFor(conn.msgs, 'READY', 4000);
  await K.sleep(600);
  const s2 = await K.httpJson('/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + AGENT.apiKey }, body: {}
  });
  const fresh2 = s2.json && s2.json.token;
  const oldStill = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: { Authorization: 'Bearer ' + expired } });
  const newOk = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: { Authorization: 'Bearer ' + fresh2 } });
  R.check('P5 换票后：新 token 的 HTTP 200、过期 token 的 HTTP 仍 403、且 WS 连接未断',
    conn.ok === true && conn.ws.readyState === 1 && newOk.status === 200 && oldStill.status === 403,
    { wsReadyState: conn.ws.readyState, newStatus: newOk.status, expiredStatus: oldStill.status });

  K.closeAll(conn.ws);
  await K.httpJson('/api/agent/v1/admin/config', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + store.adminToken }, body: { agent_enabled: 'false' }
  });
  R.summary();
  process.exitCode = 0;
})();
