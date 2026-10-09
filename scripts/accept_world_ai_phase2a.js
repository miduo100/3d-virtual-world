/**
 * AI World Brain · Phase 2a 验收（队列项 1 · 可重跑）
 *   node scripts/accept_world_ai_phase2a.js
 *
 * 判据对应主文档 §Phase 2（本项覆盖 P1-1 / P1-3 / P1-4 / P1-5 / P1-6；P1-2/12/13/14 属队列项 2）：
 *   P1-1  GET/PUT /api/world-ai/config 往返正确；未鉴权 401；非法 autonomy → 400；禁止 scope → 400
 *   P1-3  Credential 创建 → 明文只返回一次 → 库里是 bcrypt hash（$2 开头且 ≠ 明文）
 *   P1-4  rotate 后旧 Key 换发 401、新 Key 200
 *   P1-5  pause 后使用（exchange）→ 403；resume → 200
 *   P1-6  scope 硬过滤：world:raw_sql / world:admin 创建时被剔除（响应 rejectedScopes + 库内 scopes）
 *   P1-x  附加：exchange 出的 JWT type=world_ai + usage_count 记账 + DELETE 吊销后 403
 *
 * 环境还原：恢复 PUT 前的 config 快照；吊销本轮创建的凭证（保留审计行）。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'virtual_world',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

let pass = 0, fail = 0;
const log = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

async function api(p, { method = 'GET', token, body, rawKey } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  else if (rawKey) headers['Authorization'] = 'Bearer ' + rawKey;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, j };
}

(async () => {
  const login = await api('/api/admin-auth/login', { method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' } });
  if (login.status !== 200) { console.log('LOGIN FAIL', login.status, JSON.stringify(login.j).slice(0, 200)); process.exit(1); }
  const T = login.j.token;
  const created = [];

  // ═══ 组 1：P1-1 config 往返与鉴权 ═══
  console.log('\n── 组 1：P1-1 config ──');
  const noAuth = await api('/api/world-ai/config');
  log(noAuth.status === 401, 'P1-1a 未鉴权 GET /config → 401', 'got ' + noAuth.status);
  const noAuthPut = await api('/api/world-ai/config', { method: 'PUT', body: { enabled: true } });
  log(noAuthPut.status === 401, 'P1-1b 未鉴权 PUT /config → 401', 'got ' + noAuthPut.status);

  const g0 = await api('/api/world-ai/config', { token: T });
  log(g0.status === 200 && g0.j.success && g0.j.config && !!g0.j.config.worldId,
    'P1-1c 带 token GET /config → 200 且带 worldId', 'worldId=' + (g0.j.config && g0.j.config.worldId));
  const snapshot = g0.j.config;

  const marker = 'P2A-ROUNDTRIP-' + Date.now();
  const put1 = await api('/api/world-ai/config', {
    token: T, method: 'PUT',
    body: { system_prompt: marker, autonomy: 'semi_autonomous', temperature: 0.5, enabled: false },
  });
  const g1 = await api('/api/world-ai/config', { token: T });
  log(put1.status === 200 && g1.j.config.systemPrompt === marker && g1.j.config.autonomy === 'semi_autonomous' && g1.j.config.temperature === 0.5,
    'P1-1d PUT→GET 往返一致', '');

  const badAuto = await api('/api/world-ai/config', { token: T, method: 'PUT', body: { autonomy: 'god_mode' } });
  log(badAuto.status === 400, 'P1-1e 非法 autonomy → 400', 'got ' + badAuto.status);
  const badScope = await api('/api/world-ai/config', { token: T, method: 'PUT', body: { allowed_scopes: ['world:raw_sql'] } });
  log(badScope.status === 400, 'P1-1f allowed_scopes 含禁止 scope → 400', 'got ' + badScope.status);
  const badPm = await api('/api/world-ai/config', { token: T, method: 'PUT', body: { provider_map: { plan: 'x' } } });
  log(badPm.status === 400, 'P1-1g provider_map 值非正整数 → 400', 'got ' + badPm.status);

  // ═══ 组 2：P1-3/P1-6 凭证创建 + scope 硬过滤 ═══
  console.log('\n── 组 2：P1-3 / P1-6 创建与过滤 ──');
  const credName = 'p2a-acc-' + Date.now();
  const c1 = await api('/api/world-ai/credentials', {
    token: T, method: 'POST',
    body: { name: credName, scopes: ['world:observe', 'world:raw_sql', 'world:admin', 'world:rollback'] },
  });
  const key1 = c1.j.key;
  log(c1.status === 200 && typeof key1 === 'string' && key1.startsWith('waik_'), 'P1-3a 创建成功且明文 Key 以 waik_ 开头', '');
  log(Array.isArray(c1.j.rejectedScopes) && c1.j.rejectedScopes.includes('world:raw_sql') && c1.j.rejectedScopes.includes('world:admin'),
    'P1-6a 响应 rejectedScopes 剔除禁止 scope', JSON.stringify(c1.j.rejectedScopes));
  log(JSON.stringify(c1.j.credential.scopes) === JSON.stringify(['world:observe', 'world:rollback']),
    'P1-6b credential.scopes 只剩合法项', JSON.stringify(c1.j.credential.scopes));
  created.push(c1.j.credential.id);

  const dbRow = (await pool.query('SELECT key_hash, key_prefix, scopes, status FROM world_ai_credentials WHERE id = $1', [c1.j.credential.id])).rows[0];
  log(dbRow && dbRow.key_hash.startsWith('$2') && dbRow.key_hash !== key1, 'P1-3b 库里是 bcrypt hash（≠明文）', '');
  log(dbRow && key1.startsWith(dbRow.key_prefix), 'P1-3c 库里 key_prefix 与明文前缀一致', dbRow && dbRow.key_prefix);
  const listRes = await api('/api/world-ai/credentials', { token: T });
  const listed = (listRes.j.credentials || []).find((c) => c.id === c1.j.credential.id);
  log(listed && !JSON.stringify(listed).includes(key1), 'P1-3d 列表不泄露明文 Key', '');

  // ═══ 组 3：exchange + P1-4 rotate + P1-5 pause ═══
  console.log('\n── 组 3：使用路径（exchange / rotate / pause）──');
  const ex1 = await api('/api/world-ai/auth/exchange', { method: 'POST', rawKey: key1 });
  log(ex1.status === 200 && ex1.j.token && ex1.j.worldId, 'P1-xa 明文 Key 换内部 JWT → 200', '');
  let dec = null;
  try { dec = jwt.decode(ex1.j.token); } catch (e) { /* ignore */ }
  log(dec && dec.type === 'world_ai' && dec.cid === c1.j.credential.id && Array.isArray(dec.scopes),
    'P1-xb JWT type=world_ai + 绑定凭证 + 带 scope', '');

  const rot = await api(`/api/world-ai/credentials/${c1.j.credential.id}/rotate`, { token: T, method: 'POST' });
  const key2 = rot.j.key;
  log(rot.status === 200 && typeof key2 === 'string' && key2.startsWith('waik_') && key2 !== key1, 'P1-4a rotate 返回新明文 Key', '');
  const exOld = await api('/api/world-ai/auth/exchange', { method: 'POST', rawKey: key1 });
  log(exOld.status === 401, 'P1-4b 旧 Key 换发 → 401', 'got ' + exOld.status);
  const exNew = await api('/api/world-ai/auth/exchange', { method: 'POST', rawKey: key2 });
  log(exNew.status === 200, 'P1-4c 新 Key 换发 → 200', '');

  const usage = (await pool.query('SELECT usage_count FROM world_ai_credentials WHERE id = $1', [c1.j.credential.id])).rows[0];
  log(usage && usage.usage_count >= 1, 'P1-xc exchange 记账 usage_count ≥1', String(usage && usage.usage_count));

  const paused = await api(`/api/world-ai/credentials/${c1.j.credential.id}/pause`, { token: T, method: 'POST' });
  log(paused.status === 200 && paused.j.credential.status === 'paused', 'P1-5a pause → status=paused', '');
  const exPaused = await api('/api/world-ai/auth/exchange', { method: 'POST', rawKey: key2 });
  log(exPaused.status === 403, 'P1-5b pause 后使用 → 403', 'got ' + exPaused.status);
  const resumed = await api(`/api/world-ai/credentials/${c1.j.credential.id}/resume`, { token: T, method: 'POST' });
  const exResumed = await api('/api/world-ai/auth/exchange', { method: 'POST', rawKey: key2 });
  log(resumed.status === 200 && exResumed.status === 200, 'P1-5c resume 后恢复可用', '');

  const revoked = await api(`/api/world-ai/credentials/${c1.j.credential.id}`, { token: T, method: 'DELETE' });
  const exRevoked = await api('/api/world-ai/auth/exchange', { method: 'POST', rawKey: key2 });
  // 口径：revoked = 凭证彻底失效 → 401（与 rotate 后旧 Key 同族）；paused = 暂时禁用 → 403（P1-5）
  log(revoked.status === 200 && exRevoked.status === 401, 'P1-xd 吊销后使用 → 401（凭证彻底失效；审计行保留）', 'got ' + exRevoked.status);

  // ═══ 组 4：环境还原 ═══
  console.log('\n── 组 4：环境还原 ──');
  const restore = await api('/api/world-ai/config', {
    token: T, method: 'PUT',
    body: {
      enabled: snapshot.enabled, autonomy: snapshot.autonomy, temperature: snapshot.temperature,
      system_prompt: snapshot.systemPrompt, model: snapshot.model,
    },
  });
  log(restore.status === 200, 'P1-xe config 已还原快照', '');
  // 凭证已吊销（保留审计行），无需删除
  await pool.end();

  console.log(`\n════════ VERDICT: ${fail === 0 ? 'ACCEPTED' : 'FAILED'}  ${pass}/${pass + fail} ════════`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
