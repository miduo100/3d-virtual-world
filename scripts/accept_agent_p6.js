/**
 * accept_agent_p6.js — 发现端点守护（v6 轮重建；原脚本于 2026-09-18 文件事故丢失）
 *
 * 为什么它最重要：发现端点（well-known / capabilities / openapi.json）是**外部 AI 零知识接入的唯一入口**，
 * 而它已被连着改过两轮（移除未实现的 VOICE_MESSAGE、actions 新增 stop）——此前没有任何自动化守护。
 *
 * 判据（P = 判据编号）：
 *   P1  well-known 200，必备字段齐全（含 auth/tiers/scopes/actions/pushTiers/limits/entityIdentity）
 *   P2  auth 段字段齐全，且 sessionTtlSeconds / guestSessionTtlSeconds 为正数、游客票 > 会话票
 *   P3  **auth.sessionTtlSeconds 与实际签发的 JWT TTL 一致**（防"文档写 900、实际发 3600"漂移）
 *   P4  capabilities 的共享段（tiers/scopes/actions/pushTiers/limits/entityIdentity）与 well-known **逐字一致**
 *   P5  protocolVersion 两处一致；capabilities 独有 session 段存在（记录 well-known 无 session 的观察项）
 *   P6  actions 集合 = 八动作（move/walk_to/follow/rotate/jump/say/interact/stop）
 *   P7  **三处动作清单一致**（well-known.actions / openapi['x-websocket'].actions / openapi /action 的 enum）
 *   P8  outboundMessages 与 openapi['x-websocket'].outbound 一致，且**不含 VOICE_MESSAGE**（红线 5 决策守护）
 *   P9  tiers['guest-pull'].actionRates 覆盖全部 8 个动作键，且 stop === [1,2000]（v2-4 的免费断言点）
 *   P10 openapi.paths 的 key 集合 === 白名单（多一个未实现端点 / 少一个已实现端点都 FAIL）
 *   P11 limits 的三个值与后台 admin config 一致（防发现端点与真实配置漂移）
 *   P12 agent_enabled=false 时三个发现端点**仍 200**（发现端点必须公开）
 *
 * 用法：node scripts/accept_agent_p6.js
 * 产物：examples/agent-client/live/p6.json
 * 注：脚本自查总闸原值并在收尾恢复（不硬编码 false，见文档 §9 坑 35）。
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const K = require('./agentV2TestKit');

const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const STORE = path.join(__dirname, '_tmp_tier_agents.json');
const REPORT = path.join(__dirname, '..', 'examples', 'agent-client', 'live', 'p6.json');

// 与实现逐项核对过的白名单（P8 之后新增 /guest/session；改动 meta.js 时应同步这里）
const EXPECTED_PATHS = [
  '/guest/session', '/session', '/me', '/session/revoke', '/observe', '/chat/history',
  '/action', '/capabilities', '/openapi.json',
  '/federation/worlds', '/federation/status', '/federation/teleport/prepare'
];
const EXPECTED_ACTIONS = ['move', 'walk_to', 'follow', 'rotate', 'jump', 'say', 'interact', 'stop'];
const SHARED_KEYS = ['tiers', 'scopes', 'actions', 'pushTiers', 'limits', 'entityIdentity'];
const WELLKNOWN_FIELDS = ['success', 'protocolVersion', 'agentEnabled', 'world', 'endpoints', 'auth',
  'tiers', 'scopes', 'actions', 'pushTiers', 'limits', 'entityIdentity'];

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = stable(v[k]);
    return o;
  }
  return v;
}
const norm = (v) => JSON.stringify(stable(v));
const sortSet = (a) => [...a].sort();

function decode(t) { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')); }

async function adminToken() {
  let tok = null;
  try {
    if (fs.existsSync(STORE)) {
      const prev = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      if (prev.adminToken) {
        const t = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + prev.adminToken } });
        if (t.status === 200) { tok = prev.adminToken; console.log('[admin] 复用已有 token'); }
      }
    }
  } catch (e) { /* 回落登录 */ }
  if (!tok) {
    const r = await K.httpJson('/api/admin-auth/login', {
      method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
    });
    const j = r.json || {};
    tok = j.token || (j.data && j.data.token) || null;
    console.log('[admin] 登录 ->', r.status);
  }
  return tok;
}

(async () => {
  const R = K.createReporter('P6 发现端点守护（well-known / capabilities / openapi）');
  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const AGENT = store.created.find(a => a.key === 'eco') || store.created[0];
  const tok = await adminToken();
  if (!tok) { console.log('FATAL: 拿不到 adminToken'); process.exitCode = 1; return; }

  const cfgBefore = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + tok } });
  const orig = (cfgBefore.json && cfgBefore.json.config) || {};
  const adminPut = (body) => K.httpJson('/api/agent/v1/admin/config', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + tok }, body
  });

  // ---- 拉三个发现端点 ----
  const wkR = await K.httpJson('/.well-known/virtual-world-agent.json');
  const capR = await K.httpJson('/api/agent/v1/capabilities');
  const oaR = await K.httpJson('/api/agent/v1/openapi.json');
  const wk = wkR.json, cap = capR.json, oa = oaR.json;
  R.check('P1a well-known → 200', wkR.status === 200, wkR.status);
  R.check('P1b capabilities → 200', capR.status === 200, capR.status);
  R.check('P1c openapi.json → 200', oaR.status === 200, oaR.status);
  if (!wk || !cap || !oa) { R.summary(); process.exitCode = 1; return; }

  const missing = WELLKNOWN_FIELDS.filter(k => wk[k] === undefined);
  R.check('P1d well-known 必备字段齐全', missing.length === 0, missing.length ? '缺少 ' + missing.join(',') : WELLKNOWN_FIELDS.length + ' 项齐全');

  // ---- P2/P3：会话 TTL ----
  const auth = wk.auth || {};
  const authFields = ['apiKeyHeader', 'agentJwtHeader', 'sessionEndpoint', 'sessionTtlSeconds',
    'guestSessionEndpoint', 'guestSessionTtlSeconds'];
  const authMissing = authFields.filter(k => auth[k] === undefined);
  R.check('P2a auth 段字段齐全', authMissing.length === 0,
    authMissing.length ? '缺少 ' + authMissing.join(',') : JSON.stringify({
      sessionTtlSeconds: auth.sessionTtlSeconds, guestSessionTtlSeconds: auth.guestSessionTtlSeconds
    }));
  R.check('P2b TTL 均为正数且游客票 > 会话票',
    Number(auth.sessionTtlSeconds) > 0 && Number(auth.guestSessionTtlSeconds) > Number(auth.sessionTtlSeconds),
    { session: auth.sessionTtlSeconds, guest: auth.guestSessionTtlSeconds });

  // P3 需要总闸打开才能换票 → 临时打开
  await adminPut({ agent_enabled: 'true' });
  await K.sleep(300);
  const s = await K.httpJson('/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + AGENT.apiKey }, body: {}
  });
  const token = s.json && s.json.token;
  if (token) {
    const p = decode(token);
    const actualTtl = p.exp - p.iat;
    R.check('P3 auth.sessionTtlSeconds 与实际签发 JWT TTL 一致',
      actualTtl === Number(auth.sessionTtlSeconds), { actualTtl, documented: auth.sessionTtlSeconds });
  } else {
    R.check('P3 auth.sessionTtlSeconds 与实际签发 JWT TTL 一致', false, '换票失败 ' + s.status);
  }

  // ---- P4/P5：共享段同源 ----
  const diffKeys = SHARED_KEYS.filter(k => norm(wk[k]) !== norm(cap[k]));
  R.check('P4 capabilities 共享段与 well-known 逐字一致（缺陷 F/H 守护）',
    diffKeys.length === 0, diffKeys.length ? '不一致: ' + diffKeys.join(',') : SHARED_KEYS.join(','));
  R.check('P5a protocolVersion 两处一致', wk.protocolVersion === cap.protocolVersion,
    { wk: wk.protocolVersion, cap: cap.protocolVersion });
  R.check('P5b capabilities 含 session 段（记录：well-known 无此字段）',
    !!cap.session, Object.keys(cap.session || {}));

  // ---- P6/P7：动作清单三处一致 ----
  const wkActions = wk.actions || [];
  const oaWs = oa['x-websocket'] || {};
  const oaActions = oaWs.actions || [];
  const enumActions = (((oa.paths || {})['/action'] || {}).post || {}).requestBody?.content?.['application/json']?.schema?.properties?.action?.enum || [];
  R.check('P6 actions 集合 = 八动作', norm(sortSet(wkActions)) === norm(sortSet(EXPECTED_ACTIONS)),
    { got: wkActions, expect: EXPECTED_ACTIONS });
  R.check('P7a well-known.actions === openapi x-websocket.actions',
    norm(sortSet(wkActions)) === norm(sortSet(oaActions)), { wk: wkActions, oa: oaActions });
  R.check('P7b openapi x-websocket.actions === /action requestBody enum（第三处）',
    norm(sortSet(oaActions)) === norm(sortSet(enumActions)), { oa: oaActions, enum: enumActions });

  // ---- P8：outbound 一致且无语音 ----
  const outCap = (cap.websocket && cap.websocket.outboundMessages) || [];
  const outOa = oaWs.outbound || [];
  R.check('P8a capabilities.outboundMessages === openapi x-websocket.outbound',
    norm(sortSet(outCap)) === norm(sortSet(outOa)), { cap: outCap, oa: outOa });
  R.check('P8b outbound 不含 VOICE_MESSAGE / SPEECH（红线 5：Agent 语音不做）',
    !outCap.includes('VOICE_MESSAGE') && !outCap.includes('SPEECH'), outCap.length + ' 类');

  // ---- P9：游客限频表（新增动作的免费断言点）----
  const guestRates = ((wk.tiers || {})['guest-pull'] || {}).actionRates || {};
  const rateMissing = EXPECTED_ACTIONS.filter(a => !guestRates[a]);
  R.check('P9a guest-pull.actionRates 覆盖全部八动作', rateMissing.length === 0,
    rateMissing.length ? '缺少 ' + rateMissing.join(',') : Object.keys(guestRates).length + ' 键');
  R.check('P9b actionRates.stop === [1,2000]（v2-4 显式加表项）',
    norm(guestRates.stop) === norm([1, 2000]), guestRates.stop);

  // ---- P10：openapi paths 白名单 ----
  const paths = Object.keys(oa.paths || {});
  const extra = paths.filter(p => !EXPECTED_PATHS.includes(p));
  const lack = EXPECTED_PATHS.filter(p => !paths.includes(p));
  R.check('P10 openapi.paths 与白名单逐项一致（未实现端点不得出现）',
    extra.length === 0 && lack.length === 0,
    { 多余: extra, 缺失: lack, 实测: paths.length, 白名单: EXPECTED_PATHS.length });

  // ---- P11：limits 与后台配置一致 ----
  const lim = wk.limits || {};
  R.check('P11a limits.movementSpeed === admin config maxSpeed',
    Number(lim.movementSpeed) === Number(orig.maxSpeed),
    { limits: lim.movementSpeed, admin: orig.maxSpeed });
  R.check('P11b limits.maxAgents === admin config maxAgents',
    Number(lim.maxAgents) === Number(orig.maxAgents),
    { limits: lim.maxAgents, admin: orig.maxAgents });
  R.check('P11c limits.maxConnectionsPerAgent === admin config maxConnectionsPerAgent',
    Number(lim.maxConnectionsPerAgent) === Number(orig.maxConnectionsPerAgent),
    { limits: lim.maxConnectionsPerAgent, admin: orig.maxConnectionsPerAgent });

  // ---- P12：总闸关闭时发现端点仍公开 ----
  await adminPut({ agent_enabled: 'false' });
  await K.sleep(400);
  const off1 = await K.httpJson('/.well-known/virtual-world-agent.json');
  const off2 = await K.httpJson('/api/agent/v1/capabilities');
  const off3 = await K.httpJson('/api/agent/v1/openapi.json');
  R.check('P12 agent_enabled=false 时三个发现端点仍 200（连"开关是否开"都要先能查到）',
    off1.status === 200 && off2.status === 200 && off3.status === 200,
    { wellknown: off1.status, capabilities: off2.status, openapi: off3.status });

  // ---- 收尾：恢复运行前配置 ----
  await adminPut({ agent_enabled: orig.agentEnabled ? 'true' : 'false' });
  const cfgAfter = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + tok } });
  const now = (cfgAfter.json && cfgAfter.json.config) || {};
  R.check(`P13 收尾恢复运行前配置（agentEnabled=${orig.agentEnabled}）`,
    String(now.agentEnabled) === String(!!orig.agentEnabled), now.agentEnabled);

  const sum = R.summary();
  try {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, JSON.stringify({
      ts: new Date().toISOString(),
      pass: sum.pass, fail: sum.fail, total: sum.total,
      rows: sum.rows,
      snapshot: {
        protocolVersion: wk.protocolVersion,
        actions: wkActions,
        sessionTtlSeconds: auth.sessionTtlSeconds,
        guestSessionTtlSeconds: auth.guestSessionTtlSeconds,
        limits: lim,
        outbound: outCap,
        openapiPaths: paths,
        wellknownKeys: Object.keys(wk),
        capabilitiesKeys: Object.keys(cap)
      }
    }, null, 2), 'utf8');
    console.log('报告：' + REPORT);
  } catch (e) { console.log('报告写入失败: ' + e.message); }
  process.exitCode = sum.fail === 0 ? 0 : 1;
})();
