/**
 * 安全修复验收（D1 / D2 / D3 / D5②③④）
 * ------------------------------------------------------------------
 * 覆盖：
 *   A. 策略表单测（含宽前缀挂载点作用域）
 *   B. 反向矩阵：无凭证写 → 401/403
 *   C. 正向矩阵：带管理员 token → 非 401（证明后台未被误伤）
 *   D. 公开读回归：GET 全公开
 *   E. 红线：/api/inventory/remote-add 保持匿名（守卫不拦截，落到 handler）
 *   F. D2 玩家级：身份只从 token 派生 + 属主校验
 *   G. D3 配额：AI_QUOTA_PER_HOUR=2 时第 3 次 429
 *   H. D5④ WS：未登记连接 CHAT 不广播 / maxPayload / 单连接限频
 *   I. D5① SQL 标识符注入：未知列名不再 500
 *   J. D5② 联邦 sync-user：role → 400、未信任来源 → 403、本地账号 → 403
 *   K. D5③ + S2-04c：bundle/zip 扩展名白名单（.html 不落盘）
 *   L. 保险丝：SECURITY_GUARD_OFF=1 反向矩阵全部放行（证明可回退）
 *
 * 用法：node scripts/accept_security_fixes.js
 * 依赖：本地 3002 已在跑最新代码；管理员账号 baseline_shot / Baseline#185
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const WebSocket = require('ws');

process.chdir(path.join(__dirname, '..'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { query } = require('../src/database/db');
const guard = require('../src/middleware/apiWriteGuard');

const BASE = 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  [' + detail + ']'));
}

async function api(method, p, body, token, base) {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch((base || BASE) + p, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* 非 JSON */ }
  return { status: res.status, data };
}

async function adminToken() {
  const preset = process.env.ADMIN_TOKEN;
  if (preset) {
    const probe = await api('GET', '/api/uploaded-models', undefined, preset);
    if (probe.status === 200) return preset;
  }
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('admin login failed: ' + JSON.stringify(data));
  return data.token;
}

/** 与 apiWriteGuard.forMount 同口径的"是否会被守卫拦"判定（含宽前缀作用域） */
function wouldBlock(mountPrefix, absPath, method) {
  return guard.wouldGuard(mountPrefix, absPath, method);
}

// ───────────────────────── A 策略表单测 ─────────────────────────
async function partA() {
  const cases = [
    ['/api', '/api/upload-model', 'POST', 'admin'],
    ['/api', '/api/upload-models-batch', 'POST', 'admin'],
    ['/api', '/api/uploaded-models/x/decimate', 'POST', 'admin'],
    ['/api', '/api/uploaded-models/x/agent-description', 'PUT', 'admin'],
    ['/api', '/api/upload-model-zip', 'POST', 'admin'],
    ['/api', '/api/ai-factory/generate', 'POST', null],          // 宽前缀不得兜住
    ['/api', '/api/config/world-settings', 'PUT', null],
    ['/api', '/api/portal/use', 'POST', null],
    ['/api', '/api/threejs-issues/config', 'PUT', null],
    ['/api/inventory', '/api/inventory/remote-add', 'POST', 'public'],
    ['/api/inventory', '/api/inventory/pools', 'POST', 'admin'],
    ['/api/inventory', '/api/inventory/drops/d1/pick', 'POST', 'user'],
    ['/api/monster', '/api/monster/spawn', 'POST', 'admin'],
    ['/api/monster', '/api/monster/m1/take-damage', 'POST', 'user'],
    ['/api/skills', '/api/skills/trigger', 'POST', 'user'],
    ['/api/skills', '/api/skills/add', 'POST', 'admin'],
    ['/api/shop', '/api/shop/purchase', 'POST', 'user'],
    ['/api/shop', '/api/shop/ad-slots', 'POST', 'admin'],
    ['/api/ai', '/api/ai/chat', 'POST', 'quota'],
    ['/api/ai-scene', '/api/ai-scene/generate-scene', 'POST', 'quota'],
    ['/api/ai-scene', '/api/ai-scene/import-to-world/x', 'POST', 'admin'],
    ['/api/users', '/api/users/character/x/appearance', 'POST', 'user'],
    ['/api/character-templates', '/api/character-templates/upload-sound', 'POST', 'admin'],
  ];
  let ok = 0;
  const bad = [];
  for (const [m, p, method, want] of cases) {
    const got = guard.resolvePolicy(m, p, method);
    // want=null 表示"该请求不属于这个挂载点"（宽前缀作用域外），用与 forMount 同口径的判定验证
    const pass = want === null ? wouldBlock(m, p, method) === false : got === want;
    if (pass) ok++; else bad.push(`${method} ${p} want=${want} got=${got} blocked=${wouldBlock(m, p, method)}`);
  }
  check('A 策略表单测 ' + ok + '/' + cases.length, ok === cases.length, bad.join(' ; '));
}

// ───────────────────── B/C/D/E 反向与正向矩阵 ─────────────────────
const ADMIN_WRITES = [
  ['POST', '/api/upload-model'],
  ['POST', '/api/upload-models-batch'],
  ['POST', '/api/upload-model-bundle'],
  ['POST', '/api/upload-model-zip'],
  ['DELETE', '/api/uploaded-models/00000000-0000-0000-0000-000000000000'],
  ['POST', '/api/uploaded-models/00000000-0000-0000-0000-000000000000/decimate'],
  ['PUT', '/api/uploaded-models/00000000-0000-0000-0000-000000000000/agent-description'],
  ['POST', '/api/media/upload'],
  ['POST', '/api/media/upload-video'],
  ['DELETE', '/api/media/images/nope.png'],
  ['POST', '/api/monster/spawn'],
  ['DELETE', '/api/monster/00000000-0000-0000-0000-000000000000'],
  ['POST', '/api/inventory/pools'],
  ['POST', '/api/shop/ad-slots'],
  ['POST', '/api/shop/create'],
  ['POST', '/api/tags/create'],
  ['POST', '/api/tags/auto-tag-all'],
  ['POST', '/api/tags/auto-tag-batch'],
  ['PUT', '/api/tags/model/uploaded/00000000-0000-0000-0000-000000000000'],
  ['POST', '/api/character-templates/upload-sound'],
  ['DELETE', '/api/character-templates/00000000-0000-0000-0000-000000000000'],
  ['PUT', '/api/character-templates/00000000-0000-0000-0000-000000000000/anim-sounds'],
  ['POST', '/api/geometry-building/create'],
  ['POST', '/api/geometry-building/generate'],
  ['DELETE', '/api/geometry-building/00000000-0000-0000-0000-000000000000'],
  ['POST', '/api/gallery/scan'],
  ['POST', '/api/gallery/configs'],
  ['POST', '/api/ai-providers/00000000-0000-0000-0000-000000000000/test'],
  ['POST', '/api/ai-providers'], 
  ['POST', '/api/npc/generate-shape'],
  ['POST', '/api/npc/test-prompt'],
  ['DELETE', '/api/npc/00000000-0000-0000-0000-000000000000/history'],
  ['POST', '/api/custom-npc/test-api'],
  ['POST', '/api/threejs-blocks/import-url'],
  ['POST', '/api/plot/create'],
  ['POST', '/api/plot/00000000-0000-0000-0000-000000000000/add-building'],
  ['POST', '/api/skills/add'],
  ['DELETE', '/api/skills/00000000-0000-0000-0000-000000000000'],
  ['POST', '/api/ai-scene/save-scene'],
  ['POST', '/api/ai-scene/import-to-world/00000000-0000-0000-0000-000000000000'],
  ['PUT', '/api/ai-scene/scene/00000000-0000-0000-0000-000000000000'],
  ['DELETE', '/api/ai-scene/scene/00000000-0000-0000-0000-000000000000'],
];

const PUBLIC_GETS = [
  '/api/health', '/api/world/objects', '/api/world/spawn-point', '/api/uploaded-models',
  '/api/media/images', '/api/media/videos', '/api/character-templates', '/api/npc',
  '/api/monster', '/api/shop/ad-slots', '/api/inventory/pools', '/api/tags/library',
  '/api/gallery/items', '/api/geometry-building/list', '/api/ai-providers/providers',
  '/api/federation/info', '/api/config/lod-enabled', '/api/config/world-settings',
  '/api/threejs-blocks', '/api/threejs-issues/config', '/api/ui-controls/config',
  '/api/three-dgs/list', '/api/public/character-templates/weapons', '/api/model-guard/config',
];

async function partB_C_D(base, token) {
  let bOk = 0; const bBad = [];
  for (const [method, p] of ADMIN_WRITES) {
    const r = await api(method, p, {}, undefined, base);
    if (r.status === 401 || r.status === 403) bOk++; else bBad.push(`${method} ${p} → ${r.status}`);
  }
  check(`B 反向矩阵（无凭证写）${bOk}/${ADMIN_WRITES.length}`, bOk === ADMIN_WRITES.length, bBad.slice(0, 8).join(' ; '));

  if (!token) return;
  let cOk = 0; const cBad = [];
  for (const [method, p] of ADMIN_WRITES) {
    const r = await api(method, p, {}, token, base);
    // 正向：不得再是 401/未授权（400/404/500 都说明已过守卫进入业务层）
    if (r.status !== 401) cOk++; else cBad.push(`${method} ${p} → 401`);
  }
  check(`C 正向矩阵（带 adminToken）${cOk}/${ADMIN_WRITES.length}`, cOk === ADMIN_WRITES.length, cBad.slice(0, 8).join(' ; '));
}

async function partD(base) {
  let ok = 0; const bad = [];
  for (const p of PUBLIC_GETS) {
    const r = await api('GET', p, undefined, undefined, base);
    if (r.status === 200) ok++; else bad.push(`${p} → ${r.status}`);
  }
  check(`D 公开读回归 ${ok}/${PUBLIC_GETS.length}`, ok === PUBLIC_GETS.length, bad.slice(0, 8).join(' ; '));
}

async function partE() {
  const r = await api('POST', '/api/inventory/remote-add', {});
  const hitHandler = r.status === 400 && String(r.data && r.data.error).includes('homeUserId');
  check('E 红线 remote-add 保持匿名（守卫不拦截，落到 handler）', hitHandler, r.status + ' ' + JSON.stringify(r.data));

  const ai = await api('POST', '/api/ai-factory/generate', {});
  check('E 宽前缀未被兜住：/api/ai-factory/generate 到达 handler', ai.status === 400, ai.status + ' ' + JSON.stringify(ai.data).slice(0, 80));
}

// ───────────────────── F D2 玩家级（身份来自 token） ─────────────────────
async function partF(adminTk) {
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET;

  const users = await query(
    `SELECT u.id AS user_id, c.id AS character_id
     FROM users u JOIN characters c ON c.user_id = u.id
     ORDER BY u.created_at LIMIT 2`
  );
  if (users.rows.length < 2) { check('F D2 玩家级（缺少测试数据，跳过）', false, 'users<2'); return; }
  const me = users.rows[0], other = users.rows[1];
  const myToken = jwt.sign({ userId: me.user_id, username: 'secfix_probe' }, secret, { expiresIn: '1h' });
  const otherToken = jwt.sign({ userId: other.user_id, username: 'secfix_probe2' }, secret, { expiresIn: '1h' });

  // F1：无 token → 401（挂载层 user 策略）
  const f1 = await api('POST', `/api/users/character/${me.character_id}/appearance`, { hair: 'x' });
  check('F1 玩家级接口无 token → 401', f1.status === 401, f1.status);

  // F2：改他人角色外观 → 403（属主校验，无写入）
  const f2 = await api('POST', `/api/users/character/${other.character_id}/appearance`, { hair: 'x' }, myToken);
  check('F2 改他人角色外观 → 403', f2.status === 403, f2.status + ' ' + JSON.stringify(f2.data));

  // F3：改自己角色外观（空 body：只动 updated_at，不改任何外观列）→ 200
  const f3 = await api('POST', `/api/users/character/${me.character_id}/appearance`, {}, myToken);
  check('F3 改自己角色外观 → 200', f3.status === 200, f3.status);

  // F4：改他人重生点 → 403
  const f4 = await api('POST', `/api/users/character/${other.character_id}/respawn-point`, {}, myToken);
  check('F4 改他人重生点 → 403', f4.status === 403, f4.status);

  // F5：D5① SQL 标识符注入——未知列名不再产生 SQL 错误（改造前必 500）。
  // body 只含未知列名 → 白名单全部忽略 → 仅 updated_at 变化，不写任何外观字段
  const inj = await api('POST', `/api/users/character/${me.character_id}/appearance`,
    { '__sec_audit_no_such_col__': 1 }, myToken);
  check('F5 未知列名不再产生 SQL 错误（200 而非 500）', inj.status === 200, inj.status);

  // F6：拾取接口无 body.userId 也能过 "userId 必填"（身份来自 token）
  const f6 = await api('POST', '/api/inventory/drops/00000000-0000-0000-0000-000000000001/pick', {}, myToken);
  check('F6 拾取身份来自 token（无 body.userId → 404 掉落物不存在）',
    f6.status === 404, f6.status + ' ' + JSON.stringify(f6.data));

  const f7 = await api('POST', '/api/shop/purchase', { buyerId: other.user_id, shopItemId: '00000000-0000-0000-0000-000000000002', quantity: 1 }, myToken);
  check('F7 下单身份来自 token（绕过 buyerId 伪造 → 404 商品不存在）', f7.status === 404, f7.status + ' ' + JSON.stringify(f7.data));

  // F8：未登录访问他人角色详情 → 不返回 user_email（S2-08）
  const f8 = await api('GET', `/api/users/character/${me.character_id}`);
  const leaked = f8.data && f8.data.character && f8.data.character.user_email;
  check('F8 GET 他人角色不返回 user_email', !leaked, 'user_email=' + leaked);

  // F9：属主自己带 token 读 → 仍能拿到 user_email（个人资料面板依赖）
  const f9 = await api('GET', `/api/users/character/${me.character_id}`, undefined, myToken);
  const ownerEmail = f9.data && f9.data.character && f9.data.character.user_email;
  check('F9 属主带 token 仍可读到 user_email', !!ownerEmail, 'user_email=' + String(ownerEmail));

  // F10：monster take-damage 无 token → 401；带 token → 非 401
  const f10a = await api('POST', '/api/monster/00000000-0000-0000-0000-000000000003/take-damage', { damage: 1 });
  const f10b = await api('POST', '/api/monster/00000000-0000-0000-0000-000000000003/take-damage', { damage: 1, characterId: me.character_id, userId: other.user_id }, myToken);
  check('F10 打怪接口 无token=401 / 带token=非401', f10a.status === 401 && f10b.status !== 401, `${f10a.status}/${f10b.status}`);
  void otherToken; void adminTk;
}

// ───────────────────── G 配额（独立实例 3004） ─────────────────────
function startInstance(env, port) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, env, { PORT: String(port) }),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}
async function waitPort(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`);
      if (r.ok) return true;
    } catch (e) { /* 未起 */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function partG() {
  const port = 3004;
  const child = startInstance({ AI_QUOTA_PER_HOUR: '2' }, port);
  const up = await waitPort(port, 40000);
  if (!up) { check('G 配额（实例未起，跳过）', false, 'port ' + port); child.kill(); return; }
  const base = `http://localhost:${port}`;
  const s1 = await api('POST', '/api/ai/chat', {}, undefined, base);
  const s2 = await api('POST', '/api/ai/chat', {}, undefined, base);
  const s3 = await api('POST', '/api/ai/chat', {}, undefined, base);
  check('G1 配额内前 2 次放行（非 429）', s1.status !== 429 && s2.status !== 429, `${s1.status}/${s2.status}`);
  check('G2 第 3 次 429 + AI_QUOTA_EXCEEDED + retryAfter',
    s3.status === 429 && s3.data && s3.data.code === 'AI_QUOTA_EXCEEDED' && s3.data.retryAfter > 0,
    s3.status + ' ' + JSON.stringify(s3.data));
  // 管理员豁免：带 adminToken 不计配额（此处仅验证守卫对无 token 生效、有 token 不受 429）
  const tk = await (async () => {
    try { return await adminToken(); } catch (e) { return null; }
  })();
  if (tk) {
    const s4 = await api('POST', '/api/ai/chat', {}, tk, base);
    check('G3 管理员 token 不计配额（非 429）', s4.status !== 429, s4.status);
  }
  child.kill();
  await new Promise(r => setTimeout(r, 1200));
}

// ───────────────────── H WS 加固 ─────────────────────
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('ws timeout')), 8000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function partH() {
  const url = 'ws://localhost:3002';
  // H1：未登记连接的 CHAT 不广播
  const observer = await wsConnect(url);
  const spy = [];
  observer.on('message', (m) => { try { spy.push(JSON.parse(m.toString())); } catch (e) {} });
  observer.send(JSON.stringify({ type: 'PLAYER_JOIN', payload: { characterId: 'secfix_obs', characterName: 'secfix_obs', position: { x: 0, y: 0, z: 0 } } }));
  await sleep(800);

  const rogue = await wsConnect(url);
  rogue.send(JSON.stringify({ type: 'CHAT', payload: { message: 'SECFIX_ROGUE_CHAT', sender: '伪造者' } }));
  await sleep(1200);
  const gotRogue = spy.some(m => m.type === 'CHAT' && m.payload && m.payload.message === 'SECFIX_ROGUE_CHAT');
  check('H1 未登记连接的 CHAT 不再全服广播', !gotRogue, 'observer 收到=' + gotRogue);

  // H2：已登记连接（同位置 30m 内）的 CHAT 仍可送达 —— 确认没有误伤正常聊天
  observer.send(JSON.stringify({ type: 'CHAT', payload: { message: 'SECFIX_OK_CHAT' } }));
  await sleep(1200);
  const gotOk = spy.some(m => m.type === 'CHAT' && m.payload && m.payload.message === 'SECFIX_OK_CHAT');
  check('H2 已登记连接的附近聊天仍正常送达', gotOk, '收到=' + gotOk);

  // H3：单连接限频（1 秒内 40 条 → 应被丢弃一部分）
  const before = spy.length;
  for (let i = 0; i < 40; i++) {
    observer.send(JSON.stringify({ type: 'CHAT', payload: { message: 'SECFIX_BURST_' + i } }));
  }
  await sleep(1500);
  const burst = spy.slice(before).filter(m => m.type === 'CHAT' && String((m.payload || {}).message || '').startsWith('SECFIX_BURST_')).length;
  check('H3 单连接限频生效（40 条突发被丢弃一部分）', burst > 0 && burst < 40, '送达 ' + burst + '/40');

  // H4：maxPayload（>4MB 单帧 → 连接被关闭 1009）
  const big = await wsConnect(url);
  const closed = await new Promise((resolve) => {
    big.on('close', (code) => resolve(code));
    big.send(JSON.stringify({ type: 'CHAT', payload: { message: 'BIG', pad: 'x'.repeat(5 * 1024 * 1024) } }));
    setTimeout(() => resolve(-1), 6000);
  });
  check('H4 超过 4MB 单帧被拒（连接关闭 1009）', closed === 1009, 'closeCode=' + closed);

  try { observer.close(); } catch (e) {}
  try { rogue.close(); } catch (e) {}
  await sleep(400);
}

// ───────────────────── J 联邦 sync-user ─────────────────────
async function partJ() {
  const trusted = (await query('SELECT world_id FROM trusted_worlds LIMIT 1')).rows[0];
  if (!trusted) { check('J 联邦 sync-user（缺少受信世界，跳过）', false, 'no trusted world'); return; }

  // 自建一次性探针用户：**绝不用真实用户**做目标（首次运行时曾真的改写了一行真实用户，
  // 已用 db_export.sql 的原始值还原）。这样即使守卫失效，被改的也只是本脚本自己的行，
  // 且下面会显式断言"目标行未被改写"。
  const uuidv4 = require('uuid').v4;
  const probeId = uuidv4();
  const PROBE = { username: 'secfix_probe_user', email: 'secfix_probe@test.local', role: 'user' };
  await query(
    `INSERT INTO users (id, username, email, password_hash, role) VALUES ($1, $2, $3, 'secfix_probe', $4)`,
    [probeId, PROBE.username, PROBE.email, PROBE.role]
  );

  try {
    const j1 = await api('POST', '/api/federation/sync-user',
      { userId: probeId, sourceWorldId: trusted.world_id, userData: { user: { username: 'x', email: 'x@x.x', role: 'admin' } } });
    check('J1 sync-user 带 role → 400 FEDERATION_ROLE_FORBIDDEN',
      j1.status === 400 && j1.data && j1.data.code === 'FEDERATION_ROLE_FORBIDDEN', j1.status + ' ' + JSON.stringify(j1.data));

    const j2 = await api('POST', '/api/federation/sync-user',
      { userId: probeId, sourceWorldId: 'world_does_not_exist_secfix', userData: {} });
    check('J2 sync-user 未信任来源 → 403 FEDERATION_SOURCE_UNTRUSTED',
      j2.status === 403 && j2.data && j2.data.code === 'FEDERATION_SOURCE_UNTRUSTED', j2.status + ' ' + JSON.stringify(j2.data));

    const j3 = await api('POST', '/api/federation/sync-user',
      { userId: probeId, sourceWorldId: trusted.world_id, userData: { user: { username: 'x', email: 'x@x.x' } } });
    check('J3 sync-user 试图改写本地账号 → 403（本地账号保护）',
      j3.status === 403 && j3.data && j3.data.code === 'FEDERATION_LOCAL_ACCOUNT_PROTECTED', j3.status + ' ' + JSON.stringify(j3.data));

    const j4 = await api('POST', '/api/federation/sync-user', { sourceWorldId: trusted.world_id });
    check('J4 sync-user 缺 userId → 400', j4.status === 400, j4.status);

    // J5：核心断言——三次尝试之后探针行必须**逐字未变**（防回归：守卫若失效会立刻暴露）
    const after = (await query('SELECT username, email, role FROM users WHERE id = $1', [probeId])).rows[0];
    const intact = after && after.username === PROBE.username && after.email === PROBE.email && after.role === PROBE.role;
    check('J5 探针用户行未被任何一次 sync-user 改写', intact,
      JSON.stringify(after) + ' vs ' + JSON.stringify(PROBE));
  } finally {
    await query('DELETE FROM users WHERE id = $1', [probeId]);
  }
}

// ───────────────────── K 上传扩展名白名单 ─────────────────────
async function partK(token) {
  if (!token) { check('K 上传扩展名白名单（无 adminToken，跳过）', false, 'no token'); return; }
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  zip.addFile('evil.html', Buffer.from('<script>alert(1)</script>'));
  zip.addFile('evil.svg', Buffer.from('<svg onload="alert(1)"></svg>'));
  const buf = zip.toBuffer();
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'application/zip' }), 'secfix.zip');
  const res = await fetch(BASE + '/api/upload-model-zip', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form,
  });
  let data = null; try { data = await res.json(); } catch (e) {}
  await sleep(300);
  // 检查落盘：bundle-* 目录里不得出现 evil.html / evil.svg
  const root = path.join(__dirname, '..', 'public', 'models', 'uploaded');
  let leaked = [];
  let created = [];
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root)) {
      if (!d.startsWith('bundle-')) continue;
      const full = path.join(root, d);
      const stack = [full];
      while (stack.length) {
        const cur = stack.pop();
        for (const f of fs.readdirSync(cur, { withFileTypes: true })) {
          const p2 = path.join(cur, f.name);
          if (f.isDirectory()) stack.push(p2);
          else {
            const ext = path.extname(f.name).toLowerCase();
            if (ext === '.html' || ext === '.svg' || ext === '.js') leaked.push(p2);
            if (f.name === 'evil.html' || f.name === 'evil.svg') created.push(p2);
          }
        }
      }
    }
  }
  check('K1 zip 内 .html/.svg 未落盘到同源目录', leaked.length === 0, leaked.slice(0, 3).join(' ; '));
  check('K2 请求未被守卫拦（非 401）', res.status !== 401, res.status + ' ' + JSON.stringify(data).slice(0, 90));
  void created;
}

// ───────────────────── L 保险丝 ─────────────────────
async function partL() {
  const port = 3005;
  const child = startInstance({ SECURITY_GUARD_OFF: '1' }, port);
  const up = await waitPort(port, 40000);
  if (!up) { check('L 保险丝（实例未起，跳过）', false, 'port ' + port); child.kill(); return; }
  const base = `http://localhost:${port}`;
  let ok = 0; const bad = [];
  const sample = ADMIN_WRITES.slice(0, 12).concat([
    ['POST', '/api/users/character/00000000-0000-0000-0000-000000000000/appearance'],
  ]);
  for (const [method, p] of sample) {
    const r = await api(method, p, {}, undefined, base);
    if (r.status !== 401 && r.status !== 403) ok++; else bad.push(`${method} ${p} → ${r.status}`);
  }
  check(`L 保险丝 SECURITY_GUARD_OFF=1 全部放行 ${ok}/${sample.length}`, ok === sample.length, bad.slice(0, 6).join(' ; '));
  child.kill();
  await new Promise(r => setTimeout(r, 1200));
}

// ───────────────────────────── main ─────────────────────────────
(async () => {
  delete process.env.SECURITY_GUARD_OFF;
  console.log('===== 安全修复验收 (D1/D2/D3/D5) =====');
  await partA();
  await partD(BASE);
  await partE();
  const tk = await adminToken();
  console.log('[accept] adminToken acquired');
  await partB_C_D(BASE, tk);
  await partF(tk);
  await partJ();
  await partK(tk);
  await partG();
  await partH();
  await partL();

  const passed = results.filter(r => r.pass).length;
  console.log('\n===== RESULTS =====');
  console.log(`${passed}/${results.length} PASS`);
  const fails = results.filter(r => !r.pass);
  if (fails.length) {
    console.log('FAILED:');
    fails.forEach(f => console.log('  - ' + f.name + ' | ' + f.detail));
  }
  console.log(passed === results.length ? 'VERDICT ACCEPTED' : 'VERDICT FAILED');
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
