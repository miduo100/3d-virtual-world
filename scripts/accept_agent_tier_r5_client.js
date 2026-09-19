/**
 * 三档 AI 联测 · 轮5（限频安全间隔 + 真人端动画表现，只测不改）
 *
 * 检测项：
 *   AA observe 限频边界：以不同间隔请求，量化"安全间隔"（对 AI 客户端轮询的实操口径）
 *   BB 真人端 Agent 行走动画：静止 vs 移动时骨骼/子节点旋转变化量（摆臂动画是否在动）
 *   CC 真人端 Agent 跳跃：服务器 y 变化是否传导到真人端显示（smoother Y 直跟）
 *
 * 依赖：scripts/_tmp_tier_agents.json
 * 运行：node scripts/accept_agent_tier_r5_client.js
 * 报告：examples/agent-client/live/tier-r5.json
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const K = require('./agentV2TestKit');

const R = K.createReporter('限频边界 + 真人端动画（轮5）');
const sleep = K.sleep;
const BASE = 'http://localhost:3002';
const AGENTS_FILE = path.join(__dirname, '_tmp_tier_agents.json');
const REPORT_DIR = path.join(__dirname, '..', 'examples', 'agent-client', 'live');

const store = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
const rtSpec = store.created.find(a => a.key === 'realtime');
const ecoSpec = store.created.find(a => a.key === 'eco');
const issues = [];
const data = {};
const sockets = [];

async function session(key) {
  const r = await K.httpJson('/api/agent/v1/session', { method: 'POST', headers: { Authorization: 'Bearer ' + key } });
  return r.json && r.json.token;
}

// ==================== AA 限频边界 ====================
async function rateLimitProbe(token) {
  const results = {};
  for (const gap of [1000, 1100, 1250, 1500]) {
    await sleep(2200);   // 清空窗口
    let ok = 0, e429 = 0;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const t0 = Date.now();
      const r = await K.httpJson('/api/agent/v1/observe?radius=50', { headers: { Authorization: 'Bearer ' + token } });
      if (r.status === 200) ok++; else if (r.status === 429) e429++;
      const rest = gap - (Date.now() - t0);
      if (rest > 0) await sleep(rest);
    }
    results[gap] = { ok, e429, ratio429: Number((e429 / n).toFixed(2)) };
    R.info(`AA 间隔 ${gap}ms`, `${ok}/${n} 成功，429=${e429}`);
  }
  data.rateLimit = results;
  R.check('AA 间隔 1250ms 无 429（安全轮询间隔）', results[1250].e429 === 0, results[1250]);
  R.check('AA 间隔 1500ms 无 429', results[1500].e429 === 0, results[1500]);
  if (results[1000].e429 > 0) {
    issues.push({
      tier: 'any', level: 'P3', item: 'observe 限频窗口无余量（固定 1.0s 轮询会被判超频）',
      detail: `按 1000ms 固定间隔请求：${results[1000].e429}/10 次 429；1100ms：${results[1100].e429}/10；1250ms 起为 0 → 客户端需 ≥1.25s 间隔才稳`,
      code: 'src/routes/agent/observe.js rateLimitObserve(): 滑动窗口 filter(now-ts<1000) + list.length>=1，无抖动容差（无 retryAfter 毫秒级回退）'
    });
  }
}

// ==================== BB/CC 真人端动画 ====================
async function browserProbe() {
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream'] });
  } catch (e) {
    browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream'] });
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    const u = (m.location && m.location().url) || '';
    // favicon 404 的文本里不含 URL，必须按 location().url 判定（历史坑）
    if (/runtime\.lastError|index\.global\.js/i.test(t) || /favicon/i.test(u)) return;
    if (t.includes('Failed to load resource') && t.includes('404')) return;
    errs.push(`${t} @ ${u}`);
  });
  await page.goto(BASE + '/index.html?guest=1', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(11000);
  await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });

  const me = await page.evaluate(() => ({ x: window.player.position.x, z: window.player.position.z }));
  const token = await session(rtSpec.apiKey);
  const conn = await K.openAgentWs({ authHeader: 'Bearer ' + token });
  if (!conn.ok) { R.check('BB Agent 上线', false, conn.statusCode || conn.error); await browser.close(); return; }
  sockets.push(conn.ws);
  await K.waitFor(conn.msgs, 'READY', 5000);
  K.wsSend(conn.ws, { type: 'ACTION', payload: { action: 'walk_to', requestId: uuidv4(), target: { x: me.x + 5, z: me.z + 5 } } });
  await sleep(6000);

  const sampleBones = () => page.evaluate((cid) => {
    const pd = window.gameWorld && window.gameWorld.players.get(cid);
    if (!pd || !pd.group) return null;
    const out = {};
    pd.group.traverse(o => {
      const key = (o.name || o.type) + '#' + (o.id || '');
      if (o.quaternion) out[key] = o.quaternion.toArray().map(v => Number(v.toFixed(4)));
    });
    return out;
  }, rtSpec.id);

  const diff = (a, b) => {
    if (!a || !b) return -1;
    let sum = 0, n = 0;
    for (const k of Object.keys(a)) {
      if (!b[k]) continue;
      for (let i = 0; i < 4; i++) sum += Math.abs(a[k][i] - b[k][i]);
      n++;
    }
    return { nodes: n, sum: Number(sum.toFixed(4)) };
  };

  // 静止时
  const idleA = await sampleBones();
  await sleep(1000);
  const idleB = await sampleBones();
  const idleMove = diff(idleA, idleB);

  // 移动中
  K.wsSend(conn.ws, { type: 'ACTION', payload: { action: 'walk_to', requestId: uuidv4(), target: { x: me.x + 35, z: me.z + 35 } } });
  await sleep(800);
  const walkA = await sampleBones();
  await sleep(1000);
  const walkB = await sampleBones();
  const walkMove = diff(walkA, walkB);

  data.anim = { idle: idleMove, walking: walkMove };
  R.info('BB 真人端 Agent 骨骼/节点旋转变化量', { 静止: idleMove, 移动: walkMove });
  R.check('BB Agent 静止时不乱动（变化量 < 移动中）',
    idleMove !== -1 && walkMove !== -1 && idleMove.sum < walkMove.sum, { idle: idleMove.sum, walk: walkMove.sum });
  if (idleMove !== -1 && walkMove !== -1 && idleMove.sum >= walkMove.sum) {
    issues.push({ tier: 'realtime', level: 'P2', item: '真人端 Agent 移动时无行走动画（骨骼不动）', detail: `静止变化量 ${idleMove.sum} vs 移动变化量 ${walkMove.sum}`, code: 'public/js/websocket.js handlePositionUpdate → gameWorld.updatePlayerPosition(animMode) → world.js 动画切换' });
  }
  await sleep(3500);   // 等待走到位（此时应 idle）

  // CC 跳跃：同时采样「服务器权威 y」（人类观察者收到的 POSITION_UPDATE，10Hz）与「真人端显示 y」
  const yBefore = await page.evaluate((cid) => { const pd = window.gameWorld.players.get(cid); return pd && pd.group ? pd.group.position.y : null; }, rtSpec.id);
  const obsCid = uuidv4();
  const observer = await K.openHumanWs({ characterId: obsCid, characterName: 'R5-观察者', position: { x: me.x, y: 0, z: me.z } });
  if (observer.ok) sockets.push(observer.ws);
  await sleep(600);
  const idxObs = observer.ok ? observer.msgs.length : 0;
  const reqJump = uuidv4();
  K.wsSend(conn.ws, { type: 'ACTION', payload: { action: 'jump', requestId: reqJump } });
  const jumpAck = await K.waitFor(conn.msgs, 'ACTION_COMPLETED', 3000);
  let yMax = yBefore, samples = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    const y = await page.evaluate((cid) => { const pd = window.gameWorld.players.get(cid); return pd && pd.group ? pd.group.position.y : null; }, rtSpec.id);
    if (y !== null) { samples++; if (y > yMax) yMax = y; }
    await sleep(120);
  }
  const serverYs = observer.ok ? observer.msgs.slice(idxObs)
    .filter(m => m.type === 'POSITION_UPDATE' && m.payload.characterId === rtSpec.id)
    .map(m => Number((m.payload.position.y || 0).toFixed(3))) : [];
  const serverYMax = serverYs.length ? Math.max(...serverYs) : null;
  data.jump = {
    yBefore, clientYMax: yMax, clientDelta: Number((yMax - yBefore).toFixed(3)),
    serverYMax, serverYSamples: serverYs.length, serverYSeries: serverYs.slice(0, 14),
    ack: jumpAck && jumpAck.payload
  };
  R.info('CC 真人端显示 y 峰值', `${yMax}（Δ${(yMax - yBefore).toFixed(3)}m，采样 ${samples}）`);
  R.info('CC 服务器权威 y 峰值（观察者收到的广播）', `${serverYMax}（样本 ${serverYs.length}）`);
  R.check('CC 服务器确实产生垂直位移（权威 y > 0.2m）', serverYMax !== null && serverYMax > 0.2, { serverYMax, series: serverYs.slice(0, 10) });
  R.check('CC 跳跃在真人端可见（显示 y 上升 >0.2m）', yMax - yBefore > 0.2, data.jump);
  if (serverYMax !== null && serverYMax > 0.2 && (yMax - yBefore) <= 0.2) {
    issues.push({
      tier: 'realtime', level: 'P2', item: '真人端看不到 Agent 跳跃（前端贴地逻辑覆盖服务器 y）',
      detail: `服务器权威 y 峰值 ${serverYMax}m（观察者收到 ${serverYs.length} 条带 y 的广播），但真人端显示 y 恒为 ${yBefore}（Δ0）→ 玩家完全看不到 AI 起跳`,
      code: 'public/js/websocket.js snapAgentPosition(): position.y = getGroundHeight(probe) + yOffset，丢弃服务器 y（仅地形查询失败时才回退服务器 y）'
    });
  }

  R.check('CC console error = 0', errs.length === 0, errs.slice(0, 3));
  await browser.close();
}

async function main() {
  if (process.env.SKIP_AA === '1') {
    R.info('AA 限频探测已跳过（SKIP_AA=1，结论沿用上一轮：1000ms→1/10 429、1100ms 起 0）');
  } else {
    const token = await session(ecoSpec.apiKey);
    R.check('AA 换票成功', !!token, token ? 'ok' : 'no token');
    if (token) await rateLimitProbe(token);
  }
  await browserProbe();
  finish();
}

function finish() {
  const sum = R.summary();
  console.log('\n===== 疑似问题 =====');
  if (issues.length === 0) console.log('（无）');
  issues.forEach((it, i) => console.log(`${i + 1}. [${it.level}][${it.tier}] ${it.item}\n   证据：${it.detail}\n   代码：${it.code}`));
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'tier-r5.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary: sum, data, issues }, null, 2));
    console.log('\n报告已写入', path.join(REPORT_DIR, 'tier-r5.json'));
  } catch (e) { console.log('报告写入失败', e.message); }
  K.closeAll(...sockets);
  process.exitCode = sum.fail > 0 ? 1 : 0;
}

main();
