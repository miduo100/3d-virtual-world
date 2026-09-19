/**
 * 三档 AI 联测 · 轮3（真人浏览器观感，只测不改）
 *
 * 检测项：
 *   P 三档 Agent 同时出现在真人端（players.size / 🤖 名字 / 系统消息 (AI)）
 *   Q 模型可见性（group.visible + 子节点数 + 截图存证）
 *   R 移动跟随误差：Agent 以 agent_max_speed=12 直线移动时，真人端显示位置 vs 服务端理论权威位置的滞后
 *   S 瞬移跳变次数（平滑器上限 5.4m/s 与 12m/s 不匹配的证据）
 *   T 贴地（显示 y 与服务器 y=0 的偏移）
 *   U 聊天：Agent say → 真人端 DOM 出现(气泡/系统消息)
 *   V 真人端 FPS + console error
 *
 * 依赖：scripts/_tmp_tier_agents.json
 * 运行：node scripts/accept_agent_tier_r3_playwright.js
 * 报告/截图：examples/agent-client/live/tier-r3.json + Screenshot/_tmp_tier_r3_*.png
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const K = require('./agentV2TestKit');

const R = K.createReporter('真人端观感（轮3）');
const sleep = K.sleep;
const BASE = 'http://localhost:3002';
const ORDER = ['eco', 'standard', 'realtime'];
const AGENTS_FILE = path.join(__dirname, '_tmp_tier_agents.json');
const REPORT_DIR = path.join(__dirname, '..', 'examples', 'agent-client', 'live');
const SHOT_DIR = path.join(__dirname, '..', 'Screenshot');

const store = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
const SPECS = ORDER.map(k => store.created.find(a => a.key === k)).filter(Boolean);
const MAX_SPEED = (store.baseline && store.baseline.maxSpeed) || 12;
const issues = [];
const data = {};
const sockets = [];

async function main() {
  // 优先 chrome 通道（真 GPU，避免 swiftshader 软渲染把 FPS/平滑追赶速度压低）
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    console.log('[browser] chrome 通道（真 GPU）');
  } catch (e) {
    browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    console.log('[browser] chromium 默认通道（swiftshader）:', e.message.slice(0, 80));
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (t.includes('runtime.lastError') || t.includes('index.global.js')) return;
    if (t.includes('Failed to load resource') && t.includes('404')) return;
    consoleErrors.push(`${t} @ ${m.location && m.location().url}`);
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  console.log('[nav] 游客进世界...');
  await page.goto(BASE + '/index.html?guest=1', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(12000);
  // 关操作指南弹窗（会遮挡截图）
  await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });
  await sleep(500);

  const me = await page.evaluate(() => {
    let gl = 'unknown';
    try {
      const r = window.gameWorld && window.gameWorld.renderer;
      const ctx = r && r.getContext();
      const dbg = ctx && ctx.getExtension('WEBGL_debug_renderer_info');
      gl = dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (ctx ? 'no-debug-ext' : 'no-ctx');
    } catch (e) {}
    return {
      ok: !!(window.gameWorld && window.player),
      pos: window.player ? { x: window.player.position.x, y: window.player.position.y, z: window.player.position.z } : null,
      players: window.gameWorld ? window.gameWorld.players.size : -1,
      smoother: window.AgentPositionSmoother ? window.AgentPositionSmoother.getStats() : null,
      gl
    };
  });
  R.info('渲染后端', me.gl);
  R.check('P0 真人端世界就绪（gameWorld+player）', me.ok, me);
  if (!me.ok) return finish(browser);
  data.player = me;
  // T1（2026-09-19 已修）判据：上限必须 ≥ 服务端 agent_max_speed（低于它必然追不上 → 滞后累积 + 吸附瞬移）。
  // 修复前是常量 5.4，现在跟随 /.well-known 的 limits.movementSpeed（× 1.2 余量）并带自适应兜底。
  R.check('P0b 位置平滑器已安装且上限 ≥ 服务端最大速度', !!(me.smoother && me.smoother.installed && me.smoother.maxSpeed >= MAX_SPEED), me.smoother);
  if (me.smoother && me.smoother.maxSpeed < MAX_SPEED) {
    issues.push({
      tier: 'client', level: 'P1', item: '前端平滑器速度上限低于服务端最大速度（T1：真人端滞后/瞬移根因）',
      detail: `agentPositionSmoother 生效上限=${me.smoother.maxSpeed} m/s < 后台 agent_max_speed=${MAX_SPEED} m/s → Agent 快速移动时真人端持续滞后，到阈值后吸附跳变`,
      code: 'public/js/agentPositionSmoother.js（上限来源：well-known limits.movementSpeed ×1.2 / 实测速率自适应）'
    });
  }

  // ---------- 三档 Agent 上线，走到真人旁 4m ----------
  const myX = me.pos ? me.pos.x : 0, myZ = me.pos ? me.pos.z : 0;
  const targets = [
    { x: myX + 4, z: myZ }, { x: myX - 4, z: myZ }, { x: myX, z: myZ + 4 }
  ];
  const agents = {};
  for (let i = 0; i < SPECS.length; i++) {
    const spec = SPECS[i];
    const s = await K.httpJson('/api/agent/v1/session', { method: 'POST', headers: { Authorization: 'Bearer ' + spec.apiKey } });
    const token = s.json && s.json.token;
    const conn = await K.openAgentWs({ authHeader: 'Bearer ' + token });
    if (!conn.ok) { R.check(`[${spec.pushTier}] Agent 上线`, false, conn.statusCode || conn.error); continue; }
    sockets.push(conn.ws);
    await K.waitFor(conn.msgs, 'READY', 5000);
    K.wsSend(conn.ws, { type: 'ACTION', payload: { action: 'walk_to', requestId: uuidv4(), target: targets[i] } });
    agents[spec.pushTier] = { spec, token, conn, target: targets[i] };
  }
  await sleep(7000);   // 走到真人旁（距离不定，给足时间）

  // ---------- P：真人端看到几个 Agent ----------
  const seen = await page.evaluate(() => {
    const out = [];
    if (!window.gameWorld) return out;
    for (const [cid, pd] of window.gameWorld.players.entries()) {
      out.push({
        cid,
        name: pd.name || null,
        isAgent: !!(pd.group && pd.group.userData && pd.group.userData.isAgent),
        visible: !!(pd.group && pd.group.visible),
        children: pd.group ? pd.group.children.length : -1,
        pos: pd.group ? { x: pd.group.position.x, y: pd.group.position.y, z: pd.group.position.z } : null,
        webgl: !!(pd.group && pd.group.children.some(c => c.isMesh || c.type === 'Group'))
      });
    }
    return out;
  });
  data.seenInBrowser = seen;
  const agentViews = seen.filter(x => x.isAgent);
  R.check('P 三档 Agent 全部出现在真人端 players 中', agentViews.length === 3, seen.map(x => `${x.name}(agent=${x.isAgent})`));
  R.check('P2 Agent 名字带 🤖 前缀', agentViews.filter(x => x.name && x.name.startsWith('🤖')).length === 3, agentViews.map(x => x.name));
  R.check('P3 Agent 显示 group.visible=true', agentViews.every(x => x.visible), agentViews.map(x => x.visible));
  R.check('P4 Agent 模型有子节点（几何棍人已构建）', agentViews.every(x => x.children > 0), agentViews.map(x => x.children));
  const sysMsg = await page.evaluate(() => {
    const el = document.getElementById('chatBox');
    return el ? el.innerText.slice(-800) : '(#chatBox 未找到)';
  });
  data.chatDomSnippet = sysMsg;
  R.check('P5 系统消息含 (AI)加入了', sysMsg.includes('(AI)加入了'), sysMsg.match(/[^\n]*\(AI\)加入了[^\n]*/g));

  // ---------- Q：截图存证 ----------
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, '_tmp_tier_r3_agents_idle.png') });
  } catch (e) {}

  // ---------- R/S/T：让 realtime 档 Agent 直线走 60m，采样显示位置 vs 理论位置 ----------
  const rt = agents.realtime || agents.standard;
  const rtTier = agents.realtime ? 'realtime' : 'standard';
  const start = rt.target;
  // 理论权威位置的口径（2026-09-19 T1 修复时同步修正）：
  // 原实现用**第一个采样点**当理论起点（theoX = samples[0].x + v·t），但首个采样点在指令发出后
  // ≈150ms 才拿到，此时 Agent 已经走出 12×0.15 ≈ 1.8m → 模型里凭空多出 1.8m 恒定偏差
  // （修复后实测 max 3.32m 里约 1.8m 来自这个偏差）。现在改为"发指令前一刻的显示位置"作起点
  // —— 此刻 Agent 静止、显示位置 ≡ 权威位置，模型无偏。
  const prePos = await page.evaluate((cid) => {
    const pd = window.gameWorld && window.gameWorld.players.get(cid);
    return pd && pd.group ? { x: pd.group.position.x, y: pd.group.position.y, z: pd.group.position.z } : null;
  }, rt.spec.id);
  const startT = Date.now();
  const goal = { x: start.x + 60, z: start.z };
  K.wsSend(rt.conn.ws, { type: 'ACTION', payload: { action: 'walk_to', requestId: uuidv4(), target: goal } });
  // 采样：浏览器显示位置 + 时间
  const samples = [];
  const sampler = setInterval(async () => {
    try {
      const p = await page.evaluate((cid) => {
        const pd = window.gameWorld && window.gameWorld.players.get(cid);
        return pd && pd.group ? { x: pd.group.position.x, y: pd.group.position.y, z: pd.group.position.z } : null;
      }, rt.spec.id);
      if (p) samples.push({ t: Date.now() - startT, ...p });
    } catch (e) {}
  }, 150);
  const travelMs = Math.ceil(60 / MAX_SPEED * 1000) + 1500;
  await sleep(travelMs);
  clearInterval(sampler);
  // 移动结束后等 4s：检查真人端最终是否追上权威终点（smoother 空转追赶）
  await sleep(4000);
  const settled = await page.evaluate((cid) => {
    const pd = window.gameWorld && window.gameWorld.players.get(cid);
    return pd && pd.group ? { x: pd.group.position.x, y: pd.group.position.y, z: pd.group.position.z } : null;
  }, rt.spec.id);
  const settleLag = settled ? Math.hypot(settled.x - goal.x, settled.z - goal.z) : -1;
  data.settleLagM = Number(settleLag.toFixed(2));
  R.info(`[${rtTier}] S2 移动结束 4s 后显示位置 vs 权威终点`, `滞后 ${settleLag.toFixed(2)}m（终点 ${JSON.stringify(goal)}）`);
  R.check('S2 静止 4s 后真人端追上权威位置（<1m）', settleLag >= 0 && settleLag < 1, settleLag.toFixed(2));

  // 理论权威位置（服务端限速直线推进；起点=出发时显示位置）
  // 瞬移判定口径（2026-09-19 T1 修复时同步修正）：原阈值写死 8 m/s，是"Agent 上限 5 m/s"时代
  // 的常量——服务端提速到 12 m/s 后，**合法移动本身就是 12 m/s > 8**，会把正常高速移动记成瞬移。
  // 现在按"是否超过服务端最大速度的 1.5 倍"判定（真瞬移 = SNAP 吸附/传送跳变，量级 100+ m/s），
  // 同时保留 8 m/s 口径的计数作为参考（S_ref，仅信息）。
  const JUMP_RATE = MAX_SPEED * 1.5;
  let maxLag = 0, avgLag = 0, lags = [], jumps = 0, maxJump = 0, last = null, refJumps = 0;
  let maxLagOldModel = 0;
  const s0 = (prePos && Number.isFinite(prePos.x)) ? prePos : samples[0];
  for (const s of samples) {
    const tSec = s.t / 1000;
    const dist = Math.min(MAX_SPEED * tSec, 60);
    const theoX = s0.x + dist;
    const theoZ = s0.z;
    const lag = Math.hypot(s.x - theoX, s.z - theoZ);
    lags.push(Number(lag.toFixed(2)));
    if (lag > maxLag) maxLag = lag;
    // 旧口径（首采样点为起点）对照，便于与上一轮 21.01m 直接比较
    if (samples[0]) {
      const lagOld = Math.hypot(s.x - (samples[0].x + dist), s.z - samples[0].z);
      if (lagOld > maxLagOldModel) maxLagOldModel = lagOld;
    }
    if (last) {
      const step = Math.hypot(s.x - last.x, s.z - last.z);
      const dt = (s.t - last.t) / 1000;
      if (dt > 0 && step / dt > JUMP_RATE) { jumps++; if (step > maxJump) maxJump = step; }
      if (dt > 0 && step / dt > 8) refJumps++;
    }
    last = s;
  }
  avgLag = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : 0;
  data.motion = {
    tier: rtTier, samples: samples.length, maxLagM: Number(maxLag.toFixed(2)), avgLagM: Number(avgLag.toFixed(2)),
    jumps, maxJumpM: Number(maxJump.toFixed(2)), jumpRateThreshold: Number(JUMP_RATE.toFixed(1)),
    refJumpsOver8ms: refJumps, first: s0, usedPrePos: !!(prePos && Number.isFinite(prePos.x)),
    maxLagOldModelM: Number(maxLagOldModel.toFixed(2)),
    last: samples[samples.length - 1],
    lagSeries: lags.filter((_, i) => i % 5 === 0)
  };
  R.info(`[${rtTier}] R 真人端跟随滞后`, `max=${maxLag.toFixed(2)}m avg=${avgLag.toFixed(2)}m（采样 ${samples.length} 次；旧口径 max=${maxLagOldModel.toFixed(2)}m）`);
  R.info(`[${rtTier}] S 瞬移跳变`, `${jumps} 次（单次最大 ${maxJump.toFixed(2)}m，阈值 ${JUMP_RATE.toFixed(1)}m/s）`);
  R.info(`[${rtTier}] S_ref 参考口径`, `>8m/s 步进 ${refJumps} 次（含合法高速移动，仅参考）`);
  R.check(`R 真人端跟随滞后 <3m（平滑器追得上 ${MAX_SPEED}m/s）`, maxLag < 3, maxLag.toFixed(2));
  R.check(`S 无瞬移跳变（> ${JUMP_RATE.toFixed(1)}m/s 的采样步进 = 吸附/传送）`, jumps === 0, `${jumps} 次 / 最大 ${maxJump.toFixed(2)}m`);
  if (maxLag >= 3 || jumps > 0) {
    issues.push({
      tier: rtTier, level: 'P1', item: '真人端看到的 Agent 移动滞后/瞬移（T1：平滑器上限低于服务端速度）',
      detail: `Agent 直线走 60m：真人端显示位置与理论权威位置最大滞后 ${maxLag.toFixed(2)}m（平均 ${avgLag.toFixed(2)}m），检测到 ${jumps} 次瞬移（单次最大 ${maxJump.toFixed(2)}m，阈值 ${JUMP_RATE.toFixed(1)}m/s）`,
      code: 'public/js/agentPositionSmoother.js（上限应跟随 well-known limits.movementSpeed ×1.2，并有实测速率自适应兜底）；服务端 agent_max_speed=' + MAX_SPEED
    });
  }
  // T 贴地
  const lastP = samples[samples.length - 1];
  if (lastP) {
    R.info('T 真人端 Agent 显示 y', `${lastP.y}（服务器 y=0；棍人补偿 +1.5 / GLB +0）`);
    data.displayY = lastP.y;
    R.check('T 显示 y 在合理区间（0~3，未潜入地下）', lastP.y > -1 && lastP.y < 4, lastP.y);
  }
  try { await page.screenshot({ path: path.join(SHOT_DIR, '_tmp_tier_r3_moving.png') }); } catch (e) {}

  // ---------- U：Agent say → 真人端聊天区 + 头顶气泡 ----------
  const before = await page.evaluate(() => {
    const el = document.getElementById('chatBox');
    return el ? el.innerText.length : 0;
  });
  const text = `观感测试-${Date.now()}`;
  const sayAgent = agents.eco || rt;
  K.wsSend(sayAgent.conn.ws, { type: 'ACTION', payload: { action: 'say', requestId: uuidv4(), text } });
  await sleep(2500);
  const after = await page.evaluate((t) => {
    const el = document.getElementById('chatBox');
    const dom = el ? el.innerText : '';
    const bubbleEls = Array.from(document.querySelectorAll('#nearby-bubble-layer .nb-bubble'));
    return {
      len: dom.length,
      hasText: dom.includes(t),
      bubbleCount: bubbleEls.length,
      bubbleTexts: bubbleEls.map(b => (b.textContent || '').slice(0, 40))
    };
  }, text);
  data.sayDom = after;
  R.check('U1 Agent say 出现在真人端聊天区（#chatBox）', after.hasText === true, { len: `${before}→${after.len}`, hasText: after.hasText });
  R.check('U2 Agent say 显示为头顶气泡（.nb-bubble）', after.bubbleCount > 0, after.bubbleTexts);
  R.check('U Agent say 出现在真人端聊天 DOM', after.hasText === true, after);
  if (!after.hasText) {
    issues.push({ tier: sayAgent.spec.pushTier, level: 'P2', item: 'Agent say 未在真人端聊天区显示', detail: `发送「${text}」后 DOM 未见（长度 ${before}→${after.len}）`, code: 'public/js/websocket.js CHAT 处理 / chatBubbles 距离过滤' });
  }

  // ---------- V：FPS + console error ----------
  await page.evaluate(() => {
    if (window.__fpsProbe) return;
    window.__fpsProbe = { frames: 0, t0: performance.now() };
    const tick = () => { window.__fpsProbe.frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await sleep(5000);
  const fps = await page.evaluate(() => {
    const q = window.__fpsProbe;
    return q ? Number((q.frames / ((performance.now() - q.t0) / 1000)).toFixed(1)) : -1;
  });
  data.fps = fps;
  const info = await page.evaluate(() => {
    const r = window.gameWorld && window.gameWorld.renderer;
    return r ? { calls: r.info.render.calls, tris: r.info.render.triangles, programs: r.info.programs ? r.info.programs.length : -1 } : null;
  });
  data.rendererInfo = info;
  R.info('V 真人端性能', { fps, gl: me.gl, ...(info || {}) });
  const isSoft = /swiftshader|llvmpipe|software/i.test(String(me.gl));
  if (isSoft) {
    R.info('V FPS 判据跳过（软渲染环境，非产品问题）', `${fps} fps @ ${me.gl}`);
  } else {
    R.check('V 真人端 FPS > 20（3 Agent 在场）', fps > 20, `${fps} fps @ ${me.gl}`);
  }
  R.check('V console error = 0', consoleErrors.length === 0, consoleErrors.slice(0, 3));

  // ---------- 断线：Agent 全部下线，真人端应移除 avatar ----------
  Object.values(agents).forEach(a => { try { a.conn.ws.close(); } catch (e) {} });
  await sleep(2500);
  const afterLeave = await page.evaluate(() => {
    let n = 0;
    for (const [, pd] of window.gameWorld.players.entries()) if (pd.group && pd.group.userData && pd.group.userData.isAgent) n++;
    return n;
  });
  R.check('P6 Agent 全部下线后真人端 avatar 被移除', afterLeave === 0, afterLeave);

  finish(browser);
}

function finish(browser) {
  const sum = R.summary();
  console.log('\n===== 疑似问题 =====');
  if (issues.length === 0) console.log('（无）');
  issues.forEach((it, i) => console.log(`${i + 1}. [${it.level}][${it.tier}] ${it.item}\n   证据：${it.detail}\n   代码：${it.code}`));
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'tier-r3.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary: sum, data, issues }, null, 2));
    console.log('\n报告已写入', path.join(REPORT_DIR, 'tier-r3.json'));
  } catch (e) { console.log('报告写入失败', e.message); }
  K.closeAll(...sockets);
  if (browser) browser.close().catch(() => {});
  process.exitCode = sum.fail > 0 ? 1 : 0;
}

main();
