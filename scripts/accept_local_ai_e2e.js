/**
 * accept_local_ai_e2e.js —— 本地"真实 AI 客户端 × 真实浏览器真人"端到端验收（2026-09-23）
 *
 * 与其余 accept_agent_*.js 的区别：**两边都用真东西**，不用 WS 桩
 *   - 真人：playwright 打开本机主页的游客（真前端、真贴地渲染、真气泡 DOM）
 *   - AI  ：examples/agent-client/ai-live.mjs（真示例客户端、游客档、真周期 observe）
 * 覆盖 2026-09-23 这轮四件事：
 *   ① 出生点对齐世界出生点（≤3m；修复前是 (0,0,0)，差 31.22m）
 *   ③ observe 的 distance / distance3D 与 distanceSemantics
 *   L1 self.positionIsServerPlane（AI 知道"我的 y 是服务端平面估算"）
 *   ② say 回执 recipients（真实收件人数，不再写死 true）
 *   L2 判距统一为水平距离：AI 在平面 y=0、真人在台面 y≈11.14，水平 29m / 空间 31m 仍要投递
 *
 * 前置：本地 3002 在跑，且**总闸已开**（红线 6 默认关）：
 *   node scripts/_tmp_agent_switch.js true
 * 用法：node scripts/accept_local_ai_e2e.js
 *   · 结束后自动杀掉 AI 子进程与浏览器；总闸请自行恢复 false
 *   · 聊天记录清理：脚本会在收尾打印需要删除的 LIKE 前缀
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOST = process.env.E2E_HOST || 'http://localhost:3002';
const LIVE = path.join(ROOT, 'examples/agent-client/live-e2e-local');
const INBOX = path.join(LIVE, 'inbox');
const STATE = path.join(LIVE, 'state.json');
const EVENTS = path.join(LIVE, 'events.jsonl');
const MARK1 = '【本地E2E-1】我站在你旁边';
const MARK2 = '【本地E2E-2】我走了 29 米还在说话';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const chk = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).slice(0, 150)}`);
};
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return null; } };
const readEvents = () => {
  try {
    return fs.readFileSync(EVENTS, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
};
const sendCmd = (i, obj) => {
  fs.mkdirSync(INBOX, { recursive: true });
  fs.writeFileSync(path.join(INBOX, `${String(i).padStart(3, '0')}-cmd.json`), JSON.stringify(obj), 'utf8');
};

let ai = null;
let browser = null;
(async () => {
  let chromium;
  try { chromium = require('playwright').chromium; } catch (e) {
    console.error('FATAL 需要 playwright（本机已装）: ' + e.message); process.exit(2);
  }
  try {
    fs.rmSync(LIVE, { recursive: true, force: true });
    fs.mkdirSync(INBOX, { recursive: true });

    const spRes = await fetch(HOST + '/api/world/spawn-point');
    const sp = (await spRes.json()).spawnPoint.position;
    console.log('世界出生点 =', JSON.stringify(sp));

    // ---------- 真人：真实浏览器游客 ----------
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const pageErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
    await page.goto(HOST + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.gameWorld && window.gameWorld.players && window.player, { timeout: 90000 });
    await sleep(6000);
    const hint = await page.$('.close-controls-hint');
    if (hint) await hint.click().catch(() => {});
    const me = await page.evaluate(() => ({
      cid: window.player && window.player.characterId,
      pos: window.player && { x: +window.player.position.x.toFixed(2), y: +window.player.position.y.toFixed(2), z: +window.player.position.z.toFixed(2) },
    }));
    console.log('真人（浏览器游客）', JSON.stringify(me));
    chk('真人侧进场（真实浏览器，真前端）', !!me.cid && !!me.pos, JSON.stringify(me));

    // ---------- AI：真实示例客户端 ----------
    ai = spawn(process.execPath, [path.join(ROOT, 'examples/agent-client/ai-live.mjs')], {
      cwd: ROOT,
      env: { ...process.env, AGENT_HOST: HOST, AI_LIVE_DIR: LIVE },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    ai.stdout.on('data', () => {});
    ai.stderr.on('data', (d) => console.log('[ai-live stderr]', String(d).slice(0, 200)));

    let st = null;
    for (let i = 0; i < 40; i++) { await sleep(500); st = readState(); if (st && st.connected) break; }
    chk('AI 客户端进场（ai-live 游客档 READY）', !!(st && st.connected), st ? `${st.agentName} tier=${st.tier}` : 'no state（总闸是否已开？）');
    if (!(st && st.connected)) return finish();

    // ① 出生点
    const spDist = st.spawn ? Math.hypot(st.spawn.x - sp.x, st.spawn.z - sp.z) : null;
    chk('① AI 出生点落在世界出生点 ≤3m（修复前是 (0,0,0)，差 31.22m）',
      spDist != null && spDist <= 3.01 && !(st.spawn.x === 0 && st.spawn.z === 0),
      `spawn=${JSON.stringify(st.spawn)} 距=${spDist != null ? spDist.toFixed(2) : '?'}m`);

    await sleep(3500);
    st = readState();
    chk('L1 observe 标出 positionIsServerPlane', st && st.selfIsServerPlane === true, `=${st && st.selfIsServerPlane}`);
    chk('L1 distanceSemantics 说明自身 y 是平面估算 / 判距用水平距离',
      st && typeof st.distanceSemantics === 'string' && /plane estimate/i.test(st.distanceSemantics),
      String(st && st.distanceSemantics).slice(0, 90));
    const human = (st.entities || []).find((e) => e.type === 'human');
    chk('③ entities 带 distance 与 distance3D',
      !!human && Number.isFinite(human.d) && Number.isFinite(human.d3),
      human ? `${human.name} d=${human.d} d3=${human.d3} y=${human.y}（我 y=${st.self && st.self.position.y}）` : '未找到真人');

    // ---------- 跟随：靠近后 AI 的 y 会被重置为服务端平面 0 ----------
    const targetId = human ? human.id : me.cid;
    sendCmd(1, { action: 'follow', targetId, stopDistance: 2.5, maxDurationMs: 300000 });
    await sleep(9000);
    st = readState();
    const h2 = (st.entities || []).find((e) => e.type === 'human');
    chk('②a 跟随生效：靠近真人（死区 3+1.5m 内）', !!h2 && h2.d <= 5, h2 ? `水平=${h2.d}m 空间=${h2.d3}m` : 'no human');
    chk('L1 前提成立：移动后自己的 y = 服务端平面 0，真人仍在台面高度',
      !!h2 && Number(st.self.position.y) === 0 && Number(h2.y) > 5,
      `我 y=${st.self.position.y} / 真人 y=${h2 && h2.y}`);

    // ---------- ② say 回执 + 真人端 DOM ----------
    let before = readEvents().length;
    sendCmd(2, { action: 'say', text: MARK1 });
    await sleep(4500);
    const ack1 = readEvents().slice(before).find((e) => e.dir === 'in' && e.msg && e.msg.type === 'ACTION_COMPLETED' && e.msg.payload && e.msg.payload.result);
    const r1 = ack1 && ack1.msg.payload.result;
    chk('②b say 回执携带真实收件人数 recipients', !!r1 && Number(r1.recipients) >= 1 && r1.delivered === true, JSON.stringify(r1));
    const dom1 = await page.evaluate((mk) => {
      const bubbles = [...document.querySelectorAll('#nearby-bubble-layer .nb-bubble')].map((e) => e.textContent);
      return { bubble: bubbles.some((b) => b.includes(mk)), body: document.body.innerText.includes(mk), bubbles };
    }, MARK1);
    chk('②c 真人端 DOM 真的看到 AI 气泡/聊天', dom1.bubble || dom1.body, JSON.stringify(dom1).slice(0, 140));

    // ---------- L2：走到"水平内、空间外"再说 ----------
    const hx = h2 && h2.p ? h2.p.x : sp.x;
    const hz = h2 && h2.p ? h2.p.z : sp.z;
    sendCmd(3, { action: 'walk_to', target: { x: hx + 29.2, z: hz } });
    await sleep(9000);
    st = readState();
    const h3 = (st.entities || []).find((e) => e.type === 'human');
    chk('L2 前提成立：水平 ≤30m、空间 >30m（旧 3D 判距此处必不投递）',
      !!h3 && h3.d > 27 && h3.d <= 30 && h3.d3 > 30, `水平=${h3 && h3.d}m 空间=${h3 && h3.d3}m`);
    before = readEvents().length;
    sendCmd(4, { action: 'say', text: MARK2 });
    await sleep(4500);
    const ack2 = readEvents().slice(before).find((e) => e.dir === 'in' && e.msg && e.msg.type === 'ACTION_COMPLETED' && e.msg.payload && e.msg.payload.result);
    const r2 = ack2 && ack2.msg.payload.result;
    chk('L2 判距已统一为水平距离 → 该距离仍投递成功', !!r2 && Number(r2.recipients) >= 1, JSON.stringify(r2));
    const dom2 = await page.evaluate((mk) => document.body.innerText.includes(mk), MARK2);
    chk('L2 真人端同样收到这句话', dom2, String(dom2));

    const realErrors = pageErrors.filter((t) => !/favicon|Failed to load resource/.test(t));
    chk('真人端 0 console error（排除 favicon）', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
  } catch (e) {
    console.error('FATAL', (e && e.stack) || e);
    process.exitCode = 2;
  }
  return finish();
})();

async function finish() {
  try { if (ai) ai.kill(); } catch (e) {}
  try { if (browser) await browser.close(); } catch (e) {}
  // 清理本轮验收写的测试聊天记录：前缀是本脚本自造的，不会碰真实玩家/AI 的消息。
  // 只在打本机（HOST 是 localhost）时执行 —— db 句柄永远指向本机库，打远端会删错库。
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(HOST)) {
    try {
      const dbc = require('../src/database/db');
      const del = await dbc.query("DELETE FROM world_chat_log WHERE message LIKE '【本地E2E-%'");
      console.log('已清理测试聊天记录行数：' + del.rowCount);
    } catch (e) { console.log('测试聊天记录清理跳过：' + e.message); }
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n===== 本地真 AI 客户端 × 真浏览器真人 E2E : ${pass}/${results.length} PASS =====`);
  console.log('别忘了恢复总闸：node scripts/_tmp_agent_switch.js false');
  process.exit(process.exitCode === 2 ? 2 : (pass === results.length ? 0 : 1));
}
