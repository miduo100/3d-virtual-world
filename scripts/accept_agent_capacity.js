/**
 * accept_agent_capacity.js — AI Agent 容量与稳定性实测（v5 轮批次 C）
 *
 * 目的：把"AI 可进入的世界"从"功能可用"推进到"**承载可承诺**"，产出可写进运营口径的承载表。
 *
 * 场景（默认，可用参数覆盖）：
 *   - N=100 个**游客档** Agent（eco/拉模式）批量上线：每 Agent 一个独立假 IP
 *     （票不绑 IP，但"游客每 IP 并发 1 连接"看连接来源 → 100 个游客必须 100 个不同 IP，§9 坑 24）
 *   - `max_agents` 临时精确置为 N → 第 N+1 个连接必须被拒（总闸门验证）
 *   - 负载 = ① M 个"移动中" Agent（每 2.1s 重发 move，游客 move 限频 1/2s）
 *             ② OBSERVERS 个 Agent 轮询 observe（每 2.2s，游客 observe 限频 1/2s）
 *   - 采样 = 服务器进程 CPU 秒 / RSS（PowerShell Get-Process）、observe 延迟 P50/P95 与 429 率、
 *            真人侧观察者收到的 POSITION_UPDATE 条数/字节（**直接量化人类侧扇出**）与玩家数
 *   - 同场 1 个 playwright 真 GPU 页面读 FPS / draw calls / players.size / console error
 *
 * 产出：examples/agent-client/live/capacity.json（逐次采样表 + 承载汇总 + 扇出外推）
 *
 * 运行：
 *   node scripts/accept_agent_capacity.js                                  # 100 游客 / 60s / 10 移动 / 带浏览器
 *   node scripts/accept_agent_capacity.js 50 --duration=40 --movers=5 --no-browser
 *
 * ⚠️ 收尾把 agent_enabled / max_agents 恢复为运行前的值（红线 6 + 配置复位）。
 * ⚠️ 别在真人玩家高峰期跑：100 个 avatar 会让真人客户端明显变卡（这正是要测的）。
 * ⚠️ 拒绝路径口径：max_agents 与每 IP 并发都是**升级成功后** close(1013) + 先发一条 ERROR
 *    （code=MAX_AGENTS_REACHED / GUEST_IP_CONCURRENCY），不是 upgrade 阶段拒。
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const K = require('./agentV2TestKit');

const R = K.createReporter('AI Agent 容量与稳定性实测');
const sleep = K.sleep;
const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const PORT = Number((BASE.match(/:(\d+)/) || [])[1] || 3002);

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const N = Math.max(1, Number(argv.find(a => /^\d+$/.test(a))) || 100);
const argOf = (name, def) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const DURATION_SEC = argOf('duration', 60);
const MOVERS = Math.min(argOf('movers', 10), N);
const OBSERVERS = Math.min(argOf('observers', 12), N);
const WITH_BROWSER = !argv.includes('--no-browser');
// 与长会话同场跑时使用：长会话的 Key Agent 也占 max_agents 名额，
// 把它们算进闸门，N 个游客才都能进来（随后第 N+EXTRA+1 个仍会被拒 → 闸门判据不变）。
const EXTRA_AGENTS = argOf('extra-agents', 0);
const MAX_AGENTS_SET = N + EXTRA_AGENTS;

// 100 个 IP 必须互不重复（同 IP 游客并发只有 1）：RUN+i 不绕回，模 254 后仍唯一
const RUN = Math.floor(Date.now() / 1000) % 200;          // 0..199 → RUN+i ≤ 249
const ipFor = (i) => (i < 50
  ? `198.51.100.${1 + ((RUN + i) % 254)}`
  : `203.0.113.${1 + ((RUN + i) % 254)}`);

const REPORT = path.join(__dirname, '..', 'examples', 'agent-client', 'live', 'capacity.json');
const sockets = [];
let adminTok = null;
let origEnabled = null;
let origMaxAgents = null;

// ==================== 服务端进程指标（Windows PowerShell）====================

function ps(cmd) {
  return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
}

function findServerPid() {
  try {
    return Number(ps(`(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`));
  } catch (e) { return NaN; }
}

function serverStat(pid) {
  if (!Number.isFinite(pid)) return null;
  try {
    const raw = ps(`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { "$($p.CPU)|$($p.WorkingSet64)|$($p.Threads.Count)" } else { '' }`);
    if (!raw) return null;
    const [cpu, rss, threads] = raw.split('|').map(Number);
    return { cpuSeconds: cpu, rssBytes: rss, threads };
  } catch (e) { return null; }
}

// ==================== 真人侧观察者（Node WS，无渲染）====================

/**
 * 用途：① WORLD_STATE.payload.players 长度 = 服务器 playerPositions 条数
 *       ② 统计收到的 POSITION_UPDATE 条数/字节 → **直接量化人类侧扇出**
 *          （每个移动中的 Agent 每 100ms 经 presenceBridge → wsServer.broadcastToAll 全量广播一次）
 */
async function startHumanObserver() {
  const characterId = `cap_human_${RUN}`;
  const h = await K.openHumanWs({ characterId, characterName: 'cap_human', position: { x: 0, y: 0, z: 0 } });
  if (!h.ok) return null;
  sockets.push(h.ws);
  const counters = { posUpdates: 0, posBytes: 0, players: 0, agents: 0, joined: 0, left: 0 };
  h.ws.on('message', (d) => {
    let m = null;
    try { m = JSON.parse(d.toString()); } catch (e) { return; }
    if (m.type === 'POSITION_UPDATE') { counters.posUpdates += 1; counters.posBytes += d.length; }
    else if (m.type === 'WORLD_STATE' && m.payload && Array.isArray(m.payload.players)) {
      counters.players = m.payload.players.length;
      counters.agents = m.payload.players.filter(p => p && p.entityType === 'agent').length;
    } else if (m.type === 'PLAYER_JOINED') counters.joined += 1;
    else if (m.type === 'PLAYER_LEFT') counters.left += 1;
  });
  return { conn: h, counters, characterId };
}

function netPlayers(h) {
  if (!h) return null;
  return h.counters.players + (h.counters.joined - h.counters.left);
}

// ==================== 批量上线游客 Agent ====================

async function bringUpGuests(n) {
  const started = Date.now();
  const up = [];
  const failures = [];
  for (let i = 0; i < n; i++) {
    const ip = ipFor(i);
    const t = await K.guestTicket(ip);
    if (!t.ticket) {
      failures.push({ i, ip, stage: 'ticket', status: t.status, code: t.json && t.json.code });
      continue;
    }
    const c = await K.openAgentWs({ token: t.ticket.token, authHeader: 'Bearer ' + t.ticket.token, ip });
    if (!c.ok) {
      failures.push({ i, ip, stage: 'upgrade', statusCode: c.statusCode, error: c.error });
      continue;
    }
    sockets.push(c.ws);
    up.push({ i, ip, agentId: t.ticket.agent.id, ticket: t.ticket.token, conn: c });
    if ((i + 1) % 10 === 0) {
      const ready = up.filter(u => u.conn.msgs.some(m => m && m.type === 'READY')).length;
      console.log(`[up] ${i + 1}/${n} 已连接，READY ${ready}，失败 ${failures.length}`);
      await sleep(350);
    }
  }
  await sleep(2500);
  const ready = up.filter(u => u.conn.msgs.some(m => m && m.type === 'READY')).length;
  return { up, failures, ready, setupMs: Date.now() - started };
}

// ==================== observe 采样 ====================

async function observeOnce(token) {
  const t0 = Date.now();
  const r = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: { Authorization: 'Bearer ' + token } });
  return { ms: Date.now() - t0, status: r.status, code: r.json && r.json.code };
}

function percentile(list, p) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return Number(s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1));
}

// ==================== 浏览器（真 GPU）真人页 ====================

async function browserProbe() {
  let browser = null;
  try {
    const { chromium } = require('playwright');
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      console.log('[browser] chrome 通道（真 GPU）');
    } catch (e) {
      browser = await chromium.launch({ headless: true });
      console.log('[browser] 默认通道（swiftshader，FPS 会失真）:', String(e.message).slice(0, 80));
    }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (t.includes('runtime.lastError') || t.includes('index.global.js')) return;
      if (t.includes('Failed to load resource') && t.includes('404')) return;
      errors.push(`${t} @ ${m.location && m.location().url}`);
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    const navAt = Date.now();
    await page.goto(BASE + '/index.html?guest=1', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await sleep(14000);
    await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });
    await sleep(800);

    const info = await page.evaluate(() => {
      let gl = 'unknown';
      try {
        const r = window.gameWorld && window.gameWorld.renderer;
        const c = r && r.getContext();
        const dbg = c && c.getExtension('WEBGL_debug_renderer_info');
        gl = dbg ? c.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'no-debug-ext';
      } catch (e) { }
      return { gl, players: window.gameWorld && window.gameWorld.players ? window.gameWorld.players.size : -1 };
    });

    const fpsSamples = [];
    for (let i = 0; i < 3; i++) {
      const fps = await page.evaluate(() => new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const loop = () => {
          n++;
          if (performance.now() - t0 < 2000) requestAnimationFrame(loop);
          else res(n / ((performance.now() - t0) / 1000));
        };
        requestAnimationFrame(loop);
      }));
      fpsSamples.push(Number(fps.toFixed(1)));
      await sleep(700);
    }
    const render = await page.evaluate(() => {
      const r = window.gameWorld && window.gameWorld.renderer;
      return r ? {
        calls: r.info.render.calls, triangles: r.info.render.triangles,
        geometries: r.info.memory.geometries, programs: r.info.programs ? r.info.programs.length : -1
      } : null;
    });

    fs.mkdirSync(path.join(__dirname, '..', 'Screenshot'), { recursive: true });
    const shot = path.join(__dirname, '..', 'Screenshot', `_tmp_capacity_${N}_agents.png`);
    await page.screenshot({ path: shot });
    await browser.close();
    return {
      gl: info.gl, players: info.players, fpsSamples, render, errors, screenshot: shot,
      navToDoneMs: Date.now() - navAt
    };
  } catch (e) {
    try { if (browser) await browser.close(); } catch (e2) { }
    return { error: e.message };
  }
}

// ==================== 拒绝路径（升级成功 → ERROR + close 1013）====================

async function expectReject(ip, expectCode) {
  const t = await K.guestTicket(ip);
  if (!t.ticket) return { stage: 'ticket', status: t.status, code: t.json && t.json.code };
  const c = await K.openAgentWs({ token: t.ticket.token, authHeader: 'Bearer ' + t.ticket.token, ip });
  if (!c.ok) return { stage: 'upgrade', statusCode: c.statusCode, error: c.error };
  sockets.push(c.ws);
  const err = await K.waitFor(c.msgs, 'ERROR', 5000);
  await K.waitClose(c.closeInfo, 5000);
  K.closeAll(c.ws);
  return {
    stage: 'post_upgrade', code: err && err.payload && err.payload.code, closeCode: c.closeInfo.code,
    reason: c.closeInfo.reason, matched: Boolean(err && err.payload && err.payload.code === expectCode)
  };
}

// ==================== 主流程 ====================

(async () => {
  const started = Date.now();
  const report = {
    title: 'accept_agent_capacity', startedAt: new Date().toISOString(),
    params: { N, DURATION_SEC, MOVERS, OBSERVERS, WITH_BROWSER, port: PORT }
  };
  let browserPromise = null;
  let human = null;

  try {
    adminTok = await getAdminToken();
    const cfg = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + adminTok } });
    const c = (cfg.json && cfg.json.config) || {};
    origEnabled = c.agentEnabled; origMaxAgents = c.maxAgents;
    R.check('P0 读取基线配置成功', origEnabled !== undefined && origMaxAgents !== undefined,
      { agentEnabled: origEnabled, maxAgents: origMaxAgents });

    const put = await K.httpJson('/api/agent/v1/admin/config', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + adminTok },
      body: { agent_enabled: 'true', max_agents: String(MAX_AGENTS_SET), agent_push_default: 'eco', agent_max_speed: '12' }
    });
    R.check('P1 配置就绪（agent_enabled=true / max_agents=N+extra / pushDefault=eco）',
      put.status === 200, { status: put.status, maxAgents: MAX_AGENTS_SET, extraAgents: EXTRA_AGENTS });
    await sleep(700);

    const pid = findServerPid();
    console.log(`[server] pid=${pid} port=${PORT}`);
    R.check('P2 取得服务器进程句柄（CPU/RSS 可采样）', Number.isFinite(pid), { pid });

    human = await startHumanObserver();
    R.check('P3 真人侧观察者（Node WS）已入场', !!human, human ? human.characterId : 'failed');
    await sleep(600);

    // ---------- 批量上线 ----------
    console.log(`\n[load] 上线 ${N} 个游客 Agent（${MOVERS} 移动 / ${OBSERVERS} observe）...`);
    const upInfo = await bringUpGuests(N);
    R.check(`L1 ${N} 个游客 Agent 全部 READY`, upInfo.ready === N,
      { ready: upInfo.ready, attempted: N, failures: upInfo.failures.length, setupMs: upInfo.setupMs });
    report.bringUp = { ready: upInfo.ready, failures: upInfo.failures.slice(0, 20), setupMs: upInfo.setupMs };
    if (!upInfo.up.length) throw new Error('没有任何 Agent 上线成功，终止');

    await sleep(1500);
    const playersAfterUp = netPlayers(human);
    R.check('L2 真人侧看到 Agent 入场（players 净增 ≥N）', playersAfterUp >= N,
      { playersNet: playersAfterUp, agentsInState: human ? human.counters.agents : null });

    // ---------- 负载期（浏览器探针并行） ----------
    if (WITH_BROWSER) browserPromise = browserProbe();

    const samples = [];
    const latencies = [];
    let okCount = 0, err429 = 0, errOther = 0;
    const stat0 = serverStat(pid);
    let lastCpu = stat0 || { cpuSeconds: 0, rssBytes: 0, threads: 0 };
    const t0 = Date.now();

    const movers = upInfo.up.slice(0, MOVERS);
    const observers = upInfo.up.slice(0, OBSERVERS);
    const nudge = () => {
      for (const m of movers) {
        if (m.conn.ws.readyState !== 1) continue;
        K.wsSend(m.conn.ws, {
          type: 'ACTION',
          payload: { action: 'move', direction: { x: 1, z: 0.3 }, requestId: `cap-move-${m.i}-${Date.now()}` }
        });
      }
    };
    nudge();                                              // 立即走起来
    const moveTimer = setInterval(nudge, 2100);           // 游客 move 限频 1 次/2s → 2.1s 安全

    const obsTimer = setInterval(async () => {
      for (const o of observers) {
        if (o.conn.ws.readyState !== 1) continue;
        const r = await observeOnce(o.ticket);
        if (r.status === 200) { okCount++; latencies.push(r.ms); }
        else if (r.status === 429) err429++;
        else errOther++;
      }
    }, 2200);                                             // 游客 observe 限频 1 次/2s → 2.2s 安全

    let lastPos = human ? human.counters.posUpdates : 0;
    let lastPosBytes = human ? human.counters.posBytes : 0;
    const sampleTimer = setInterval(() => {
      const st = serverStat(pid);
      const cur = human ? human.counters.posUpdates : 0;
      const curB = human ? human.counters.posBytes : 0;
      samples.push({
        tSec: Number(((Date.now() - t0) / 1000).toFixed(1)),
        agentsOnline: upInfo.up.filter(u => u.conn.ws.readyState === 1).length,
        cpuPercentOfOneCore: st ? Number((((st.cpuSeconds - lastCpu.cpuSeconds) / 5) * 100).toFixed(1)) : null,
        rssMB: st ? Math.round(st.rssBytes / 1048576) : null,
        threads: st ? st.threads : null,
        humanPlayersNet: netPlayers(human),
        fanoutMsgPerSec: Number(((cur - lastPos) / 5).toFixed(1)),
        fanoutKBPerSec: Number((((curB - lastPosBytes) / 5) / 1024).toFixed(1)),
        observeOk: okCount, observe429: err429
      });
      lastPos = cur; lastPosBytes = curB;
      if (st) lastCpu = st;
    }, 5000);

    console.log(`[load] 负载期 ${DURATION_SEC}s ...`);
    await sleep(DURATION_SEC * 1000);
    clearInterval(moveTimer); clearInterval(obsTimer); clearInterval(sampleTimer);

    const stat1 = serverStat(pid);
    const elapsed = (Date.now() - t0) / 1000;
    const cpuUsed = stat0 && stat1 ? Number((stat1.cpuSeconds - stat0.cpuSeconds).toFixed(2)) : null;
    const cpuCores = cpuUsed !== null ? Number((cpuUsed / elapsed).toFixed(3)) : null;

    // 用新增的 stop 批量停下（顺带验证 100 规模下 stop 可用）
    let stopSent = 0;
    for (const m of movers) {
      if (m.conn.ws.readyState !== 1) continue;
      K.wsSend(m.conn.ws, { type: 'ACTION', payload: { action: 'stop', requestId: `cap-stop-${m.i}` } });
      stopSent++;
    }
    await sleep(1500);
    const movedAfterStop = human ? human.counters.posUpdates : 0;
    await sleep(1200);
    const idleFanout = Number((((human ? human.counters.posUpdates : 0) - movedAfterStop) / 1.2).toFixed(1));
    R.check('L3 stop 批量生效：停下后人类侧扇出显著下降', stopSent > 0 && idleFanout <= Math.max(2, (MOVERS)),
      { sent: stopSent, fanoutWhileIdleMsgPerSec: idleFanout });
    R.check('L4 负载期无 Agent 掉线（连接全存活）',
      upInfo.up.filter(u => u.conn.ws.readyState === 1).length === N,
      { online: upInfo.up.filter(u => u.conn.ws.readyState === 1).length, expected: N });

    // ---------- 闸门 + 每 IP 并发 ----------
    const gate = await expectReject(ipFor(198), 'MAX_AGENTS_REACHED');
    R.check(`L5 max_agents 满额（${MAX_AGENTS_SET}）：再来一个 Agent 被拒（ERROR + close 1013）`,
      gate.matched === true && gate.closeCode === 1013, gate);

    // ⚠️ 测序坑：服务端的检查顺序是「先 max_agents，再每 IP 名额」（agentWsServer:178→186），
    // 所以必须在**总闸门有余量**时测每 IP —— 否则拿到的是 MAX_AGENTS_REACHED（测不到目标闸门）。
    await K.httpJson('/api/agent/v1/admin/config', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + adminTok },
      body: { max_agents: String(MAX_AGENTS_SET + 5) }
    });
    await sleep(400);
    const dup = await expectReject(upInfo.up[0].ip, 'GUEST_IP_CONCURRENCY');
    R.check('L6 同 IP 第二个游客连接被拒（每 IP 并发 1；已临时抬高总闸以隔离两道闸）',
      dup.matched === true && dup.closeCode === 1013, dup);
    await K.httpJson('/api/agent/v1/admin/config', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + adminTok },
      body: { max_agents: String(MAX_AGENTS_SET) }
    });
    await sleep(300);

    // ---------- 浏览器结果 ----------
    if (browserPromise) report.browser = await browserPromise;
    if (report.browser && !report.browser.error) {
      const f = report.browser.fpsSamples || [];
      const minFps = f.length ? Math.min(...f) : null;
      R.check('L7 真 GPU 真人页可读 FPS（≥30 视为不影响正常游玩）', minFps !== null && minFps >= 30,
        { fps: f, gl: report.browser.gl, players: report.browser.players });
      R.check('L8 真人页 0 console error', (report.browser.errors || []).length === 0,
        (report.browser.errors || []).slice(0, 3));
    }

    // ---------- 承载汇总 ----------
    const cpuPct = samples.map(s => s.cpuPercentOfOneCore).filter(v => v !== null);
    const fanout = samples.map(s => s.fanoutMsgPerSec).filter(v => v !== null);
    const fanoutAvg = fanout.length ? fanout.reduce((a, b) => a + b, 0) / fanout.length : 0;
    report.capacity = {
      agents: N, movers: MOVERS, observers: OBSERVERS, durationSec: Number(elapsed.toFixed(1)),
      cpuCoresUsed: cpuUsed,
      cpuCoresAvg: cpuCores,
      cpuPercentPeak: cpuPct.length ? Math.max(...cpuPct) : null,
      rssMBStart: stat0 ? Math.round(stat0.rssBytes / 1048576) : null,
      rssMBEnd: stat1 ? Math.round(stat1.rssBytes / 1048576) : null,
      threadsEnd: stat1 ? stat1.threads : null,
      observe: {
        ok: okCount, rateLimited: err429, other: errOther,
        p50ms: percentile(latencies, 0.5), p95ms: percentile(latencies, 0.95),
        successRate: okCount + err429 + errOther > 0
          ? Number((okCount / (okCount + err429 + errOther)).toFixed(4)) : null
      },
      fanout: {
        msgPerSecAvg: Number(fanoutAvg.toFixed(1)),
        msgPerSecPeak: fanout.length ? Math.max(...fanout) : null,
        kbPerSecAvg: samples.length ? Number((samples.reduce((a, s) => a + (s.fanoutKBPerSec || 0), 0) / samples.length).toFixed(1)) : null,
        perMovingAgentMsgPerSec: MOVERS ? Number((fanoutAvg / MOVERS).toFixed(2)) : null,
        note: 'POSITION_UPDATE 是 broadcastToAll 全量广播（§9 坑 5 预置设计）；公式 = 移动中 Agent 数 × 10Hz × 人类连接数'
      },
      rejects: { maxAgents: gate, perIpConcurrency: dup },
      samples
    };
  } catch (e) {
    report.fatal = e.stack || e.message;
    console.error('FATAL', e);
  } finally {
    await restoreConfig();
    K.closeAll(...sockets);
    await sleep(1500);
  }

  const sum = R.summary();
  report.result = { pass: sum.pass, fail: sum.fail, total: sum.total };
  report.rows = sum.rows;
  report.durationMs = Date.now() - started;
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
  printTable(report);
  console.log('报告: ' + REPORT);
  process.exitCode = sum.fail === 0 ? 0 : 1;
})();

// ==================== 辅助 ====================

async function getAdminToken() {
  const storePath = path.join(__dirname, '_tmp_tier_agents.json');
  if (fs.existsSync(storePath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (prev.adminToken) {
        const t = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + prev.adminToken } });
        if (t.status === 200) { console.log('[admin] 复用已有 token'); return prev.adminToken; }
      }
    } catch (e) { }
  }
  const r = await K.httpJson('/api/admin-auth/login', {
    method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
  });
  const j = r.json || {};
  return j.token || (j.data && j.data.token) || null;
}

async function restoreConfig() {
  if (!adminTok) return;
  try {
    await K.httpJson('/api/agent/v1/admin/config', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + adminTok },
      body: {
        agent_enabled: origEnabled ? 'true' : 'false',
        max_agents: String(origMaxAgents === null || origMaxAgents === undefined ? 50 : origMaxAgents)
      }
    });
    console.log(`[restore] agent_enabled=${origEnabled ? 'true' : 'false'} max_agents=${origMaxAgents}`);
  } catch (e) { /* ignore */ }
}

function printTable(report) {
  const c = report.capacity;
  if (!c) return;
  console.log('\n===== 承载表（每 5s 采样）=====');
  console.log('t(s)  在线   CPU%(单核)  RSS(MB)  真人可见  扇出(msg/s)  扇出(KB/s)');
  for (const s of c.samples) {
    console.log(`${String(s.tSec).padEnd(5)} ${String(s.agentsOnline).padEnd(6)} ${String(s.cpuPercentOfOneCore).padEnd(10)} ${String(s.rssMB).padEnd(8)} ${String(s.humanPlayersNet).padEnd(9)} ${String(s.fanoutMsgPerSec).padEnd(12)} ${s.fanoutKBPerSec}`);
  }
  console.log('\n----- 汇总 -----');
  console.log(`Agent=${c.agents}（移动 ${c.movers} / observe ${c.observers}）时长=${c.durationSec}s`);
  console.log(`CPU 合计 ${c.cpuCoresUsed} 核秒（均值 ${c.cpuCoresAvg} 核）峰值 ${c.cpuPercentPeak}% 单核  线程 ${c.threadsEnd}`);
  console.log(`RSS ${c.rssMBStart}MB → ${c.rssMBEnd}MB`);
  console.log(`observe ok=${c.observe.ok} 429=${c.observe.rateLimited} 其他=${c.observe.other} P50=${c.observe.p50ms}ms P95=${c.observe.p95ms}ms`);
  console.log(`人类侧扇出 均值 ${c.fanout.msgPerSecAvg} msg/s 峰值 ${c.fanout.msgPerSecPeak}（每移动 Agent ≈${c.fanout.perMovingAgentMsgPerSec} msg/s，${c.fanout.kbPerSecAvg} KB/s）`);
  console.log(`拒绝路径：maxAgents=${JSON.stringify(c.rejects.maxAgents)} perIp=${JSON.stringify(c.rejects.perIpConcurrency)}`);
  if (report.browser) {
    if (report.browser.error) console.log(`真人页探针失败: ${report.browser.error}`);
    else {
      console.log(`真人页 FPS=${JSON.stringify(report.browser.fpsSamples)} players=${report.browser.players} GL=${report.browser.gl} console错误=${(report.browser.errors || []).length}`);
      if (report.browser.render) console.log(`draw calls=${report.browser.render.calls} tris=${report.browser.render.triangles} geometries=${report.browser.render.geometries}`);
    }
  }
}
