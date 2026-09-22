#!/usr/bin/env node
/**
 * accept_agent_endpoint_proto.js — 发现端点「协议一致性」验收（A1~A8）
 *
 * 背景（2026-09-21 线上实测）：`GET https://miduo100.com/.well-known/virtual-world-agent.json`
 * 同一份响应里 `world.url` 是 https，`endpoints.apiBase` 却是 http、WS 是 ws
 * → https 页面里的 AI 客户端第一跳就被 Mixed Content 拦掉（"AI 来了也进不去"）。
 *
 * 根因两层：
 *   ① 部署侧：README 的 Nginx `location /` 缺 X-Forwarded-Proto，Node 只能猜 http；
 *   ② 代码侧：deriveBaseUrl 无权威兜底（site 入口 URL 就在 federationSystem.worldUrl /
 *      system_config('world_url') 里，却没被用来校正协议）。
 *
 * 本脚本验证修复后：三个发现端点（well-known / capabilities / openapi.json）广播的
 * 协议与站点实际协议一致，且 WebSocket 协议联动（https→wss）。
 *
 * 用法：node scripts/accept_agent_endpoint_proto.js
 *   前置：本地服务器跑在 3002（node src/server.js）。
 *   A4 会临时把 world_url 改成 https 再还原（含 world_config.federation_config 的
 *   url_source 字段），需要本地 Postgres 可连（.env 的 DB_* 配置）。
 *   ⚠️ A4 的临时改动会触发一次「世界 URL 变更广播」（config.js 的行为，非本脚本新增）：
 *   已信任世界若不在线，服务器日志会出现 `[URL广播] ... ECONNREFUSED` 警告，属预期噪音。
 */

const path = require('path');
const { createReporter, BASE, sleep } = require('./agentV2TestKit');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const R = createReporter('发现端点协议修正验收');

const WK_PATH = '/.well-known/virtual-world-agent.json';
const CAPS_PATH = '/api/agent/v1/capabilities';
const OPENAPI_PATH = '/api/agent/v1/openapi.json';

const H_PROTO = { 'X-Forwarded-Proto': 'https' };
const H_PROTO_HOST = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'miduo100.com' };
const H_MULTI = { 'X-Forwarded-Proto': 'https,http' };

const statuses = [];

/** 原生 fetch（kit.httpJson 不回传响应头，A8 需读 Cache-Control） */
async function req(pathname, headers) {
  const res = await fetch(BASE + pathname, { headers: headers || {} });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  statuses.push(res.status);
  return { status: res.status, json, text, headers: res.headers };
}

// 2026-09-22 起 PUT /api/config/* 需管理员 token（config.js 鉴权收口），main 里登录后自动携带
let ADMIN_TOKEN = '';

async function putJson(pathname, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (ADMIN_TOKEN) headers['Authorization'] = 'Bearer ' + ADMIN_TOKEN;
  const res = await fetch(BASE + pathname, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  statuses.push(res.status);
  return { status: res.status, json, text };
}

/** 取 URL 的「协议 + 主机」用于跨端点比对 */
function originOf(u) {
  const m = /^([a-z]+):\/\/([^/]+)/i.exec(String(u || ''));
  return m ? { scheme: m[1].toLowerCase(), host: m[2].toLowerCase() } : { scheme: null, host: null };
}

/** ws/wss 归一为 http/https 口径，便于与 HTTP 端点比较协议层级 */
function schemeFamily(u) {
  const s = originOf(u).scheme;
  if (s === 'wss') return 'https';
  if (s === 'ws') return 'http';
  return s;
}

// ==================== Postgres 直连（仅 A4 备份/还原 federation_config）====================

async function withPg(fn) {
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'virtual_world',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password'
  });
  try {
    return await fn(pool);
  } finally {
    try { await pool.end(); } catch (e) { /* ignore */ }
  }
}

async function countTrustedWorlds() {
  try {
    return await withPg(async (p) => {
      const r = await p.query('SELECT COUNT(*)::int AS n FROM trusted_worlds');
      return r.rows[0].n;
    });
  } catch (e) {
    R.info('A4 查询 trusted_worlds 失败（按"有信任世界"保守处理）', e.message);
    return -1;
  }
}

async function readFedConfigBackup() {
  try {
    return await withPg(async (p) => {
      const r = await p.query(`SELECT value FROM world_config WHERE key = 'federation_config'`);
      return r.rows.length ? r.rows[0].value : null;
    });
  } catch (e) {
    R.info('A4 直连 Postgres 备份失败（跳过 url_source 还原）', e.message);
    return null;
  }
}

async function restoreFedConfig(backup) {
  if (!backup) return false;
  try {
    await withPg((p) => p.query(
      `UPDATE world_config SET value = $1, updated_at = NOW() WHERE key = 'federation_config'`,
      [backup]
    ));
    return true;
  } catch (e) {
    R.info('A4 url_source 还原失败', e.message);
    return false;
  }
}

// ==================== A1~A3、A5~A7 ====================

async function main() {
  console.log(`[accept] BASE = ${BASE}`);

  // 管理员登录（A4 的 PUT world-settings 需要；登录失败仅告警，A4 走函数级验证路径时无影响）
  try {
    const lr = await fetch(BASE + '/api/admin-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: process.env.ADMIN_USER || 'baseline_shot', password: process.env.ADMIN_PASS || 'Baseline#185' })
    });
    const lj = await lr.json().catch(() => ({}));
    ADMIN_TOKEN = (lj && lj.token) || '';
    if (!ADMIN_TOKEN) R.info('管理员登录失败（A4 无 PUT 路径时无影响）', { status: lr.status });
  } catch (e) {
    R.info('管理员登录异常（A4 无 PUT 路径时无影响）', e.message);
  }

  // ---------- A1 本地直连（无 TLS）：必须广播 http / ws，不能被"强制 https"写死 ----------
  const base = await req(WK_PATH);
  const b = base.json || {};
  const bApi = b.endpoints && b.endpoints.apiBase;
  const bWs = b.endpoints && b.endpoints.websocket;
  R.check(
    'A1 本地无反代头：well-known 广播 http:// + ws://（本地无 TLS 属正确行为）',
    base.status === 200 && !!b.world && String(b.world.url).startsWith('http://')
      && String(bApi).startsWith('http://') && String(bWs).startsWith('ws://'),
    { status: base.status, world: b.world && b.world.url, apiBase: bApi, websocket: bWs }
  );

  // ---------- A2 模拟反代（Proto + Host）----------
  const a2 = await req(WK_PATH, H_PROTO_HOST);
  const a2e = (a2.json && a2.json.endpoints) || {};
  R.check(
    'A2 反代模拟（XFP=https + XFH=miduo100.com）：apiBase=https://miduo100.com，websocket=wss://miduo100.com',
    a2e.apiBase === 'https://miduo100.com/api/agent/v1' && a2e.websocket === 'wss://miduo100.com/ws/agent',
    { apiBase: a2e.apiBase, websocket: a2e.websocket }
  );

  // ---------- A3 只有 XFP（无 XFH）：协议仍为 https ----------
  const a3 = await req(WK_PATH, H_PROTO);
  const a3e = (a3.json && a3.json.endpoints) || {};
  R.check(
    'A3 只带 X-Forwarded-Proto: https（无 Host）：协议仍为 https/wss',
    String(a3e.apiBase).startsWith('https://') && String(a3e.websocket).startsWith('wss://'),
    { apiBase: a3e.apiBase, websocket: a3e.websocket }
  );

  // ---------- A7 多段 proto 取第一段 ----------
  const a7 = await req(WK_PATH, H_MULTI);
  const a7e = (a7.json && a7.json.endpoints) || {};
  R.check(
    'A7 x-forwarded-proto: "https,http"（多段）取第一段 = https',
    String(a7e.apiBase).startsWith('https://') && String(a7e.websocket).startsWith('wss://'),
    { apiBase: a7e.apiBase, websocket: a7e.websocket }
  );

  // ---------- A5 三个发现端点协议一致 ----------
  const caps = await req(CAPS_PATH, H_PROTO_HOST);
  const openapi = await req(OPENAPI_PATH, H_PROTO_HOST);
  // capabilities 的 endpoints 逐端点列出（无 apiBase 字段），取 session 端点代表 baseUrl
  const capsApi = caps.json && caps.json.endpoints && caps.json.endpoints.session;
  const capsWs = caps.json && caps.json.endpoints && caps.json.endpoints.websocket;
  const oaBase = openapi.json && openapi.json.servers && openapi.json.servers[0] && openapi.json.servers[0].url;
  const oaWs = openapi.json && openapi.json['x-websocket'] && openapi.json['x-websocket'].url;
  const fams = [a2e.apiBase, a2e.websocket, capsApi, capsWs, oaBase, oaWs].map(schemeFamily);
  const hosts = [a2e.apiBase, a2e.websocket, capsApi, capsWs, oaBase, oaWs].map(u => originOf(u).host);
  R.check(
    'A5 well-known / capabilities / openapi 三处协议与主机完全一致',
    caps.status === 200 && openapi.status === 200
      && fams.every(f => f === 'https') && hosts.every(h => h === 'miduo100.com'),
    { fams, hosts, capsApi, capsWs, oaBase, oaWs }
  );

  // ---------- A6 world.url 与 endpoints.apiBase 协议必须相同（本次 bug 直接判据）----------
  const sameFamily = (u, v) => schemeFamily(u) === schemeFamily(v);
  const a6Both = sameFamily(a2.json.world.url, a2e.apiBase)
    && sameFamily(a2.json.world.url, a2e.websocket)
    && sameFamily(b.world && b.world.url, bApi)
    && sameFamily(b.world && b.world.url, bWs);
  R.check(
    'A6 world.url 与 endpoints.apiBase / websocket 协议相同（基线与反代两种场景）',
    a6Both,
    {
      baseline: [b.world && b.world.url, bApi, bWs],
      proxied: [a2.json.world.url, a2e.apiBase, a2e.websocket]
    }
  );

  // ---------- A4 权威来源兜底：system_config('world_url') 为 https 时，无任何反代头也须 https ----------
  await testA4();

  // ---------- A9 同类隐患：联邦接收端 nextStep.url（buildWsUrl）也已联动 wss ----------
  // 原实现在 X-Forwarded-Proto: https 时会拼出 `https://host/ws/agent`（不是 wss），客户端连不上。
  await testA9();

  // ---------- A8 无 5xx / 结构完整 / 缓存头 ----------
  const maxStatus = statuses.reduce((m, s) => Math.max(m, s), 0);
  const wkShape = b.success === true && !!b.world && !!b.endpoints && !!b.auth
    && Array.isArray(b.actions) && !!b.limits && !!b.entityIdentity;
  const cacheHeader = base.headers.get('cache-control');
  R.check(
    'A8 全程无 5xx + well-known 结构完整 + Cache-Control(max-age=60) 存在',
    maxStatus < 500 && wkShape && /max-age=60/.test(String(cacheHeader || '')),
    { maxStatus, wkShape, cacheControl: cacheHeader }
  );

  const summary = R.summary();
  // A4 用过 pg / fetch，node 可能因句柄未释放滞留
  process.exit(summary.fail === 0 ? 0 : 1);
}

// ==================== A4 实现 ====================

async function testA4() {
  const settings = await req('/api/config/world-settings');
  const originUrl = settings.json && settings.json.world_url;
  const originName = settings.json && settings.json.world_name;
  if (!originUrl || !originName) {
    R.check('A4 权威 world_url 为 https 时无任何反代头也广播 https', false,
      { reason: '无法读取 /api/config/world-settings', status: settings.status });
    return;
  }

  const fedBackup = await readFedConfigBackup();
  let restored = false;
  let stage = 'origin-https';

  try {
    if (String(originUrl).startsWith('https://')) {
      // 权威本来就是 https（线上常态）：零副作用端到端——直接裸请求断言
      const bare = await req(WK_PATH);
      const e = (bare.json && bare.json.endpoints) || {};
      const w = (bare.json && bare.json.world) || {};
      R.check('A4 权威 world_url 为 https 时无任何反代头也广播 https/wss（权威兜底生效）',
        String(e.apiBase).startsWith('https://') && String(e.websocket).startsWith('wss://')
          && schemeFamily(w.url) === 'https',
        { stage: 'origin-https', world: w.url, apiBase: e.apiBase, websocket: e.websocket });
      return;
    }

    // 权威是 http（本地/内网）时需要临时抬成 https。但 PUT world-settings 会触发
    // 「向所有已信任世界广播 URL 变更」，两次广播是 fire-and-forget、顺序不可控
    // （broadcastWorldUrlChange 内部串行，但两次调用之间会并发交错）——被污染的是
    // **对方世界的信任表**，且可能留下临时 URL。因此在存在已信任世界时不做端到端，
    // 改为直接调用 deriveBaseUrl 做函数级验证（同样能钉死兜底规则，零副作用）。
    const trustedCount = await countTrustedWorlds();
    if (trustedCount !== 0) {
      const { deriveBaseUrl } = require('../src/routes/agent/meta');
      const fakeReq = (headers) => ({ headers, get: (n) => headers[String(n).toLowerCase()] });
      const cases = {
        '无头+权威https': deriveBaseUrl(fakeReq({ host: 'localhost:3002' }), 'https://miduo100.com'),
        '无头+权威http': deriveBaseUrl(fakeReq({ host: 'localhost:3002' }), 'http://localhost:3002'),
        '反代头+权威https': deriveBaseUrl(fakeReq({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'miduo100.com' }), 'https://miduo100.com'),
        '无头+权威非法值': deriveBaseUrl(fakeReq({ host: 'localhost:3002' }), 'not-a-url')
      };
      const ok = cases['无头+权威https'] === 'https://miduo100.com'
        && cases['无头+权威http'] === 'http://localhost:3002'
        && cases['反代头+权威https'] === 'https://miduo100.com'
        && cases['无头+权威非法值'] === 'http://localhost:3002';
      R.info('A4 存在已信任世界，跳过会触发联邦广播的端到端用例（改走函数级验证）', { trustedCount });
      R.check('A4 权威 world_url 为 https 时无任何反代头也广播 https/wss（权威兜底生效）',
        ok, { stage: 'unit-level', ...cases });
      return;
    }

    // 走到这里 originUrl 必为 http（https 场景已在上方 return）：临时抬成 https（保留原 host）。
    // 该端点会同步 federationSystem.worldUrl 内存态（否则改 DB 后需重启才生效）
    stage = 'temporary-https';
    const httpsUrl = 'https://' + String(originUrl).replace(/^https?:\/\//i, '');
    const put = await putJson('/api/config/world-settings', { world_name: originName, world_url: httpsUrl });
    if (put.status !== 200) {
      R.check('A4 权威 world_url 为 https 时无任何反代头也广播 https', false,
        { reason: 'PUT /api/config/world-settings 失败', status: put.status, body: put.text.slice(0, 200) });
      return;
    }
    await sleep(300);

    // 关键：不带任何 X-Forwarded-* 头（模拟反代漏配头）
    const bare = await req(WK_PATH);
    const e = (bare.json && bare.json.endpoints) || {};
    const w = (bare.json && bare.json.world) || {};
    const ok = String(e.apiBase).startsWith('https://') && String(e.websocket).startsWith('wss://')
      && schemeFamily(w.url) === 'https';
    R.check('A4 权威 world_url 为 https 时无任何反代头也广播 https/wss（权威兜底生效）', ok, {
      stage, world: w.url, apiBase: e.apiBase, websocket: e.websocket
    });
  } finally {
    if (stage === 'temporary-https') {
      await putJson('/api/config/world-settings', { world_name: originName, world_url: originUrl });
      await sleep(200);
    }
    const fedOk = stage === 'temporary-https' ? await restoreFedConfig(fedBackup) : 'skipped(未改动世界配置)';
    const back = await req(WK_PATH);
    const backUrl = back.json && back.json.world && back.json.world.url;
    const backApi = back.json && back.json.endpoints && back.json.endpoints.apiBase;
    restored = String(backUrl) === String(originUrl) && schemeFamily(backUrl) === schemeFamily(backApi);
    R.check('A4 收尾还原：world_url 与端点协议恢复原值', restored,
      { before: originUrl, after: backUrl, apiBase: backApi, fedConfigRestored: fedOk });
  }
}

// ==================== A9 联邦接收端 nextStep.url ====================

async function testA9() {
  let buildWsUrl;
  try {
    buildWsUrl = require('../src/routes/agentFederation').buildWsUrl;
  } catch (e) {
    R.check('A9 联邦接收端 nextStep.url 反代下为 wss://', false, { reason: 'require 失败: ' + e.message });
    return;
  }
  const fakeReq = (headers) => ({ headers, get: (n) => headers[String(n).toLowerCase()] });
  try {
    const proxied = await buildWsUrl(fakeReq({ 'x-forwarded-proto': 'https', host: 'miduo100.com' }), '/ws/agent');
    const local = await buildWsUrl(fakeReq({ host: 'localhost:3002' }), '/ws/agent');
    R.check(
      'A9 联邦接收端 nextStep.url：反代下 wss://host，本地 ws://host（原实现会拼出 https:// 客户端连不上）',
      proxied === 'wss://miduo100.com/ws/agent' && local === 'ws://localhost:3002/ws/agent',
      { proxied, local }
    );
  } catch (e) {
    R.check('A9 联邦接收端 nextStep.url 反代下为 wss://', false, { reason: e.message });
  }
}

main().catch((e) => {
  console.error('[accept] 运行失败:', e && e.stack || e);
  process.exit(1);
});
