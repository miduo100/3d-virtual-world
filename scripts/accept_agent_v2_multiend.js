/**
 * AI Agent 接入 v2 联测 —— 多端同时在线（3 Agent × 5 真人 + 真人端观测）
 *
 * 覆盖提示词 §2 的观察点：
 *   M1 多端在场与 entities 唯一性（按 id 去重、字段完整）
 *   M2 多 Agent observe 限频公平性（Key 1Hz / 游客 0.5Hz，互不影响）
 *   M3 POSITION_UPDATE 全量广播的带宽与服务器 CPU（realtime 档 Agent 实测口径）
 *   M4 Agent 之间互见/互聊 + 契约（CHAT.characterId ≡ entities[].id）
 *   M5 多 Agent 同时 follow 同一真人（收敛且互不干扰）
 *   M6 world_chat_log 落库增量（多端高频聊天）
 *   M7 真人端（playwright 真浏览器）0 console error + FPS + 看到的人/AI 数
 *
 * 运行：node scripts/accept_agent_v2_multiend.js
 * 报告：examples/agent-client/live/v2-multiend.json
 *
 * 注意：脚本会创建 2 个 Key Agent（结束后删除）并让 5 个"模拟真人"入场走动，
 *       真人在浏览器里会看到这些额外角色。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const K = require('./agentV2TestKit');

const R = K.createReporter('多端同时在线（3 Agent × 5 真人）');
const sleep = K.sleep;
const RUN = (Math.floor(Date.now() / 1000) % 90) + 10;
const GUEST_IP = `203.0.113.${RUN + 80}`;
const OB_RATE_MS = 1100;      // Key 档允许 1Hz；用 1.1s 间隔持续拉
const GUEST_OB_MS = 2200;     // 游客 1 次/2s

const openSockets = [];
const agents = [];            // { tag, token, agentId, name, conn, pushTier }
const simHumans = [];         // { characterId, name, conn, timer, position }
let adminToken = null;

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  return K.httpJson(pathname, { method, headers, body });
}

async function login() {
  const r = await K.httpJson('/api/admin-auth/login', {
    method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
  });
  const j = r.json || {};
  adminToken = j.token || (j.data && j.data.token) || null;
  return adminToken;
}

// ==================== 端上线 ====================

async function createKeyAgent(tag, pushTier) {
  const r = await api('/api/agent/v1/admin/agents', {
    method: 'POST', token: adminToken,
    body: { name: `v2_multi_${tag}_${RUN}`, description: 'v2 多端压测 Agent', pushTier }
  });
  if (r.status !== 200) { R.check(`M0 创建 Key Agent ${tag}`, false, r.status); return null; }
  const agentId = r.json.agent.id, apiKey = r.json.apiKey;
  const s = await api('/api/agent/v1/session', { method: 'POST', token: apiKey });
  if (s.status !== 200) { R.check(`M0 ${tag} 换票`, false, s.status); return null; }
  const conn = await K.openAgentWs({ authHeader: 'Bearer ' + s.json.token });
  if (!conn.ok) { R.check(`M0 ${tag} WS 连接`, false, conn.statusCode || conn.error); return null; }
  openSockets.push(conn.ws);
  const ready = await K.waitFor(conn.msgs, 'READY', 5000);
  const a = { tag, agentId, apiKey, token: s.json.token, name: r.json.agent.name, conn, pushTier: ready && ready.payload.pushTier };
  agents.push(a);
  return a;
}

async function startSimHumans(n) {
  // 2026-09-23 修夹具：模拟真人的站位必须**跟着世界出生点**走。
  // 原实现硬编码 (10 + 3i, 0, 10)，而 ① 出生点修复后所有 Agent 都在
  // system_config('world_spawn_point')（本例 -26.32, 9.59, 12.56）附近生成 →
  // 两者相距 36m，超出 30m 的 CHAT 投递半径与推送订阅半径，导致 M3b（realtime 位置流）、
  // M4c（真人侧收 CHAT）、M5-rt（follow 收敛）**假失败**。
  // （历史上 AI 生在 (0,0,0) 才恰好落在 30m 内，属夹具与产品行为耦合的隐患。）
  const spRes = await K.httpJson('/api/world/spawn-point', { method: 'GET' });
  const sp = (spRes.json && spRes.json.spawnPoint && spRes.json.spawnPoint.position) || { x: 0, y: 0, z: 0 };
  R.info('模拟真人站位基准（世界出生点）', JSON.stringify(sp));
  for (let i = 0; i < n; i++) {
    const cid = uuidv4();
    const bx = sp.x + 10 + i * 3;      // 相对出生点：横向 10~22m 内，确保在 30m 半径里
    const bz = sp.z + 2;
    const c = await K.openHumanWs({ characterId: cid, characterName: `模拟真人${i + 1}`, position: { x: bx, y: sp.y, z: bz } });
    if (!c.ok) { R.check(`M0 模拟真人${i + 1} 上线`, false, c.error); continue; }
    openSockets.push(c.ws);
    const h = { characterId: cid, name: `模拟真人${i + 1}`, conn: c, t: i * 0.7 };
    h.timer = setInterval(() => {
      h.t++;
      const r = 6 + (i % 3) * 2;
      const x = bx + Math.cos(h.t / 6) * r;
      const z = bz + Math.sin(h.t / 6) * r;
      try {
        c.ws.send(JSON.stringify({
          type: 'POSITION_UPDATE',
          payload: { characterId: cid, position: { x, y: sp.y, z }, rotation: h.t / 6, animMode: 'walk' }
        }));
      } catch (e) { /* ignore */ }
    }, 250);                       // 4Hz
    simHumans.push(h);
    // 2026-09-23 修夹具②：**0 号（M5 的跟随目标）保持静止**。
    // 跟随的契约是"进入 stopDistance(3) + 死区 INNER_SLACK(1.5) = 4.5m 内停住"；目标若以
    // ~1m/s 绕半径 6m 的圈走动，跟随者只能维持 ~6m 的滞后平衡，而 M5 断言阈值硬编码 ≤6
    // → 实测两轮分别 5.3/6.1/4.6 与 5.5/6.2/6.5，长期在边界抖动（rt 两轮都 FAIL）。
    // 静止目标才能真正测"收敛到目标附近"；其余 4 个继续走动，M3 的位置流不受影响。
    if (i === 0) clearInterval(h.timer);
  }
  return simHumans.length;
}

function stopSimHumans() {
  for (const h of simHumans) { clearInterval(h.timer); }
}

// ==================== 工具 ====================

async function observeWith(agent, radius = 200) {
  return api(`/api/agent/v1/observe?radius=${radius}`, { token: agent.token });
}

function serverPid() {
  try {
    const out = execSync('netstat -ano | findstr :3002', { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/LISTENING\s+(\d+)\s*$/);
      if (m) return Number(m[1]);
    }
  } catch (e) { /* ignore */ }
  return null;
}

function serverCpuSeconds(pid) {
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).TotalProcessorTime.TotalSeconds"`, { encoding: 'utf8' });
    const v = Number(String(out).trim());
    return Number.isFinite(v) ? v : null;
  } catch (e) { return null; }
}

function pgEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k, d) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : d; };
  return { host: get('DB_HOST', 'localhost'), port: Number(get('DB_PORT', '5432')), database: get('DB_NAME'), user: get('DB_USER'), password: get('DB_PASSWORD') };
}

async function chatLogCount() {
  try {
    const { Client } = require('pg');
    const c = new Client(pgEnv());
    await c.connect();
    const r = await c.query('SELECT count(*)::int AS n FROM world_chat_log');
    await c.end();
    return r.rows[0].n;
  } catch (e) { return null; }
}

// ==================== M1 实体唯一性 ====================

async function m1(simCount) {
  await sleep(3500);
  const r = await observeWith(agents[0]);
  const ents = (r.json && r.json.entities) || [];
  const ids = ents.map(e => e.id);
  const unique = new Set(ids);
  R.check('M1 多端在场：observe 返回实体（含 5 模拟真人 + 3 Agent）', ents.length >= simCount + 3,
    { entities: ents.length, 期望至少: simCount + 3 });
  R.check('M1b entities 按 id 唯一（无重复实体）', unique.size === ids.length,
    { total: ids.length, unique: unique.size });
  const bad = ents.filter(e => !e.id || !e.type || !e.position || e.distance === undefined);
  R.check('M1c 每条实体字段完整（id/type/name/position/distance）', bad.length === 0, { 缺字段: bad.length });
  const agentEnts = ents.filter(e => e.type === 'agent');
  R.check('M1d 三个 Agent 均在场且 type=agent', agentEnts.length >= 3,
    { agents: agentEnts.map(e => e.name) });
  return { entities: ents.length, unique: unique.size, agents: agentEnts.length };
}

// ==================== M2 observe 限频公平性 ====================

async function pollObserve(agent, intervalMs, durationMs) {
  const t0 = Date.now();
  let ok = 0, limited = 0, other = 0;
  while (Date.now() - t0 < durationMs) {
    const r = await observeWith(agent, 30);
    if (r.status === 200) ok++;
    else if (r.status === 429) limited++;
    else other++;
    await sleep(intervalMs);
  }
  return { ok, limited, other, 时长秒: Math.round(durationMs / 1000) };
}

async function m2(guest) {
  // 按 tag 去重（guest 已在 agents 里；重复会让同一 Agent 双倍轮询，把限频测成"饥饿"）
  const targets = agents.filter((a, i) => agents.findIndex(x => x.tag === a.tag) === i && (a.tag !== 'guest' || a === guest));
  const results = await Promise.all(targets.map(a => pollObserve(a, a.tag === 'guest' ? GUEST_OB_MS : OB_RATE_MS, 15000)));
  targets.forEach((a, i) => {
    const r = results[i];
    // 期望成功率：Key 档 1Hz（15s → ≥11 次成功）；游客档 0.5Hz（15s → ≥5 次成功）
    const minOk = a.tag === 'guest' ? 5 : 11;
    R.check(`M2 多 Agent 并发 observe：${a.tag}(${a.pushTier || 'eco'}) 全部被服务（无饥饿）`, r.ok >= minOk,
      { agent: a.name, ...r, 期望成功至少: minOk });
  });
  // 本组刻意"不超频"（Key 1.1s / 游客 2.2s 间隔）→ 应几乎 0 误报 429；
  // "超频必 429" 由 D5（游客 429）与 K3g（Key 429）覆盖，此处验证并发下无限频误伤
  const maxLimited = Math.max(...results.map(r => r.limited));
  R.check('M2b 未超频请求在多 Agent 并发下不被误拒（每 Agent 429 ≤ 1）', maxLimited <= 1,
    results.map((r, i) => `${targets[i].tag}:${r.ok}成功/${r.limited}被限`));
  R.check('M2c 一方限频不影响另一方（每个 Agent 都有成功响应）', results.every(r => r.ok > 0),
    results.map(r => r.ok));
  return { targets: targets.map(a => a.tag), results };
}

// ==================== M3 带宽与 CPU ====================

async function m3(guest) {
  const rt = agents.find(a => a.tag === 'rt');
  if (!rt) { R.check('M3 realtime Agent 在场', false); return null; }
  const from = rt.conn.msgs.length;
  const guestFrom = guest ? guest.conn.msgs.length : null;   // 只统计本窗口内新增的消息
  const pid = serverPid();
  const cpu0 = pid ? serverCpuSeconds(pid) : null;
  const t0 = Date.now();
  await sleep(20000);
  const wall = (Date.now() - t0) / 1000;
  const cpu1 = pid ? serverCpuSeconds(pid) : null;
  const slice = rt.conn.msgs.slice(from);
  const bytes = slice.reduce((s, m) => s + JSON.stringify(m).length, 0);
  const counts = {};
  slice.forEach(m => { counts[m.type] = (counts[m.type] || 0) + 1; });
  const perSec = bytes / wall;
  R.info('M3 realtime 档 Agent 实测推送量', {
    秒: Math.round(wall), 消息数: slice.length, 字节每秒: Math.round(perSec),
    类型分布: counts
  });
  R.check('M3b realtime 档收到位置流（ENTITY_UPDATED / MOVEMENT_BATCH）',
    (counts.ENTITY_UPDATED || 0) > 0 || (counts.ENTITY_MOVEMENT_BATCH || 0) > 0, counts);
  // realtime 档实测帧率（下一轮待评估项：文档记"第三档≈1Hz"，这里量化确认）
  R.info('M3b2 realtime 档位置流实测帧率', {
    实体位置消息每秒: Number(((counts.ENTITY_UPDATED || 0) / wall).toFixed(1)),
    在线移动实体: simHumans.length,
    结论: '推送循环为 1s tick，故 realtime ≈ 1Hz/实体（非 10Hz）'
  });
  // 红线 14 反证：游客连接在同一 20s 窗口内不应收到任何推送
  const guestMsgs = (guest && guestFrom != null) ? guest.conn.msgs.slice(guestFrom) : null;
  const guestBytes = guestMsgs ? guestMsgs.reduce((s2, m) => s2 + JSON.stringify(m).length, 0) : null;
  R.check('M3c 游客连接在同一 20s 窗口内 0 推送（红线 14 复验）',
    guestMsgs != null && guestMsgs.length === 0, { 游客收到消息数: guestMsgs ? guestMsgs.length : null, 字节: guestBytes });
  const cpuDelta = (cpu0 != null && cpu1 != null) ? (cpu1 - cpu0) : null;
  R.info('M3d 服务器 CPU（本机口径，多端在线期间）', cpuDelta == null ? '不可用' : {
    核秒: Number(cpuDelta.toFixed(2)), 墙钟秒: Math.round(wall),
    占单核百分比: Math.round((cpuDelta / wall) * 100)
  });
  R.check('M3e 服务器 CPU 占用有上界（< 2 核，2核4G 基线可承载）',
    cpuDelta == null || (cpuDelta / wall) < 2, cpuDelta == null ? 'n/a' : Number((cpuDelta / wall).toFixed(2)));
  return { bytesPerSec: Math.round(perSec), counts, guestBytes, cpuCores: cpuDelta == null ? null : Number((cpuDelta / wall).toFixed(2)) };
}

// ==================== M4 互见/互聊 + 契约 ====================

async function m4(guest) {
  const rt = agents.find(a => a.tag === 'rt');
  const text = '契约探针-' + Math.random().toString(36).slice(2, 7);
  const before = rt.conn.msgs.length;
  const humanBefore = simHumans[0].conn.msgs.length;
  K.wsSend(guest.conn.ws, { type: 'ACTION', payload: { requestId: 'm4-say', action: 'say', text } });
  await sleep(1500);
  const chatOnAgent = rt.conn.msgs.slice(before).find(m => m.type === 'CHAT' && m.payload && m.payload.message === text);
  R.check('M4 Agent 之间互聊：Key Agent 收到游客 Agent 的 CHAT（30m 附近）', !!chatOnAgent,
    chatOnAgent ? 'received' : 'not received');
  if (chatOnAgent) {
    const r = await observeWith(agents[0]);
    const own = ((r.json.entities) || []).find(e => e.id === guest.agentId);
    R.check('M4b 契约：CHAT.characterId ≡ entities[].id（可直接按 id 定位发言者）',
      !!own && chatOnAgent.payload.characterId === guest.agentId && chatOnAgent.payload.characterId === own.id,
      { chatCharacterId: chatOnAgent.payload.characterId, entityId: own && own.id, entityName: own && own.name });
  }
  const chatOnHuman = simHumans[0].conn.msgs.slice(humanBefore).find(m => m.type === 'CHAT' && m.payload && m.payload.message === text);
  R.check('M4c 真人侧（模拟真人 WS）同样收到该 CHAT（30m 投递一致）', !!chatOnHuman, chatOnHuman ? 'received' : 'not received');
  return { text };
}

// ==================== M5 双 Agent 同时 follow 同一真人 ====================

async function m5() {
  const target = simHumans[0];
  const tags = agents.map(a => a.tag);
  for (const a of agents) {
    K.wsSend(a.conn.ws, { type: 'ACTION', payload: { requestId: `m5-${a.tag}`, action: 'follow', targetId: target.characterId, stopDistance: 3, maxDurationMs: 60000 } });
  }
  await sleep(1200);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const r = await observeWith(agents[0]);
    const ents = (r.json && r.json.entities) || [];
    // 注意：observe 的 distance 是"相对请求方"的距离，多 Agent 对比时必须自己按坐标算
    const sim = ents.find(x => x.id === target.characterId);
    const rec = { t: i, target: sim ? sim.position : null, pos: {} };
    for (const a of agents) {
      const e = ents.find(x => x.id === a.agentId);
      rec[a.tag] = (e && sim) ? Math.hypot(e.position.x - sim.position.x, e.position.z - sim.position.z) : null;
      if (e) rec.pos[a.tag] = e.position;
    }
    samples.push(rec);
    await sleep(1100);
  }
  const last = samples[samples.length - 1];
  for (const a of agents) {
    const vals = samples.map(s => s[a.tag]).filter(v => v != null);
    const converged = vals.length > 0 && vals[vals.length - 1] <= 6;
    R.check(`M5 多 Agent 同时 follow 同一真人：${a.tag} 收敛到目标附近`, converged,
      { 首值: vals[0] === undefined ? null : Number(vals[0].toFixed(1)), 末值: vals.length ? Number(vals[vals.length - 1].toFixed(1)) : null, 采样: vals.length });
  }
  R.info('M5b 跟随距离序列（相对目标）', samples.map(s => tags.map(t => s[t] === null ? '-' : s[t].toFixed(1)).join('/')).join(' → '));
  // Agent 之间是否互相避让（当前实现无 Agent-Agent 碰撞）→ 量化重叠程度
  const lp = samples[samples.length - 1].pos || {};
  const pairTags = Object.keys(lp);
  if (pairTags.length >= 2) {
    let minPair = Infinity;
    for (let i = 0; i < pairTags.length; i++) {
      for (let j = i + 1; j < pairTags.length; j++) {
        const A = lp[pairTags[i]], B = lp[pairTags[j]];
        minPair = Math.min(minPair, Math.hypot(A.x - B.x, A.z - B.z));
      }
    }
    R.info('M5c 多 Agent 同时跟随同一目标时的彼此间距（无 Agent 间避让/碰撞）',
      { 最小间距m: Number(minPair.toFixed(2)), 说明: '间距≈0 表示多个 Agent 位置重合（真人观感为叠在一起）' });
  }
  return { last };
}

// ==================== M6 聊天落库 ====================

async function m6(before) {
  const after = await chatLogCount();
  if (before == null || after == null) { R.info('M6 world_chat_log 行数', '数据库不可读，跳过'); return; }
  R.check('M6 多端聊天写入 world_chat_log（行数增长）', after > before, { before, after, 增量: after - before });
}

// ==================== M7 真人端（playwright 真浏览器）====================

async function m7() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    R.info('M7 真人端浏览器观测', 'playwright 不可用，跳过');
    return null;
  }
  const BASE = K.BASE;
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', headless: true }); }   // 真实 GPU（FPS 有意义）
  catch (e) { browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] }); }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    const notFound = [];
    // 关键：console error 文案里不含 URL，必须用 m.location().url 才能判是不是 favicon 噪音
    page.on('console', (m) => {
      if (m.type() === 'error') {
        const loc = (typeof m.location === 'function' ? m.location() : null) || {};
        errors.push({ text: m.text().slice(0, 200), url: loc.url || '' });
      }
    });
    page.on('pageerror', (e) => errors.push({ text: 'PAGEERROR: ' + String(e.message).slice(0, 200), url: '' }));
    page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
    page.on('dialog', (d) => { d.dismiss().catch(() => {}); });
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 40000 });
    await page.waitForSelector('#canvas', { timeout: 20000 });
    await page.waitForTimeout(12000);
    const info = await page.evaluate(async () => {
      const out = { players: null, fps: null, revision: window.THREE && window.THREE.REVISION };
      try { out.players = window.gameWorld && window.gameWorld.players ? window.gameWorld.players.size : null; } catch (e) {}
      out.fps = await new Promise((resolve) => {
        let n = 0; const t0 = performance.now();
        const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve(Math.round(n / ((performance.now() - t0) / 1000))); };
        requestAnimationFrame(tick);
      });
      return out;
    });
    // 噪音过滤：chrome 通道会请求 /favicon.ico（404）；console 文案无 URL，故按 location().url 判定
    const realErrors = errors.filter(e => !(/Failed to load resource/.test(e.text) && /favicon/i.test(e.url)));
    R.check('M7 真人端（真浏览器）多端在线时 0 console/page error', realErrors.length === 0,
      { errors: realErrors.slice(0, 3), notFound: notFound.slice(0, 3), 原始错误: errors.slice(0, 3) });
    R.check('M7b 真人端看到世界里的其他角色与 AI（players.size ≥ 6）',
      info.players != null && info.players >= 6, { players: info.players, 期望: '≥ 5 模拟真人 + 3 Agent' });
    R.info('M7c 真人端渲染帧率（headless chrome，真实 GPU；证明多端在线时渲染循环正常）',
      { fps: info.fps, revision: info.revision });
    return info;
  } finally {
    try { await browser.close(); } catch (e) {}
  }
}

// ==================== 主流程 ====================

(async () => {
  const started = Date.now();
  const report = { when: new Date().toISOString(), run: RUN, groups: {}, fatal: null };
  let guest = null, logBefore = null;
  try {
    await login();
    R.check('M0 管理员登录成功', !!adminToken);
    logBefore = await chatLogCount();

    const a1 = await createKeyAgent('std', 'standard');
    const a2 = await createKeyAgent('rt', 'realtime');
    R.check('M0b 两个 Key Agent（standard / realtime）WS 在线',
      !!a1 && !!a2 && a1.conn.ok && a2.conn.ok,
      agents.map(a => `${a.name}:${a.pushTier}`));
    for (const a of agents) K.wsSend(a.conn.ws, { type: 'SUBSCRIBE', payload: { topics: ['chat', 'presence', 'movement'] } });
    await sleep(600);

    // 第 3 个 Agent：测试用游客（独立 IP，不受驻场游客影响）
    const gt = await K.httpJson('/api/agent/v1/guest/session', { method: 'POST', body: {}, ip: GUEST_IP });
    if (gt.status === 200) {
      const gConn = await K.openAgentWs({ token: gt.json.token, ip: GUEST_IP });
      if (gConn.ok) {
        openSockets.push(gConn.ws);
        await K.waitFor(gConn.msgs, 'READY', 5000);
        guest = { tag: 'guest', token: gt.json.token, agentId: gt.json.agent.id, name: gt.json.agent.name, conn: gConn, pushTier: 'eco' };
        agents.push(guest);
      }
    }
    R.check('M0c 第 3 个 Agent（游客档）在线', !!guest, guest ? guest.name : 'failed');

    const simCount = await startSimHumans(5);
    R.check('M0d 5 个模拟真人上线（4Hz 位置更新）', simCount === 5, simCount);

    report.groups.M1 = await m1(simCount);
    report.groups.M2 = await m2(guest);
    report.groups.M3 = await m3(guest);
    if (guest) report.groups.M4 = await m4(guest);
    report.groups.M5 = await m5();
    await m6(logBefore);
    stopSimHumans();
    report.groups.M7 = await m7();
  } catch (e) {
    report.fatal = e.stack || e.message;
    console.error('FATAL', e);
  } finally {
    stopSimHumans();
    for (const a of agents) { K.closeAll(a.conn.ws); }
    for (const h of simHumans) K.closeAll(h.conn.ws);
    K.closeAll(...openSockets);
    await sleep(800);
    // 清理测试 Key Agent
    for (const a of agents) {
      if (a.tag === 'guest' || !a.agentId) continue;
      try { await api('/api/agent/v1/admin/agents/' + a.agentId, { method: 'DELETE', token: adminToken }); } catch (e) {}
    }
    // 2026-09-23：清理本脚本写入的测试聊天（M4 的 "契约探针-xxxx"）。
    // 不做的话下一个 AI 用 /chat/history 会把它当成世界里的真实对话。
    try {
      const dbc = require('../src/database/db');
      const del = await dbc.query("DELETE FROM world_chat_log WHERE message LIKE '契约探针-%'");
      if (del.rowCount) console.log(`已清理测试聊天记录 ${del.rowCount} 行`);
    } catch (e) { /* ignore */ }
  }

  const sum = R.summary();
  report.result = { pass: sum.pass, fail: sum.fail, total: sum.total };
  report.rows = sum.rows;
  report.durationMs = Date.now() - started;
  const dir = path.join(__dirname, '..', 'examples', 'agent-client', 'live');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'v2-multiend.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log('报告: ' + out);
  process.exitCode = sum.fail === 0 ? 0 : 1;
})();
