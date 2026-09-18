/**
 * 验收：WebSocket 断线自愈（重连后自动重新登记玩家身份）
 *
 * 背景（2026-09-18 定位）：前端 WSClient 自动重连只重建连接、不重发 PLAYER_JOIN，
 * 服务器把在线玩家挂在 connectionId 上 → 重连后的连接是"幽灵"：自己发的一切被忽略
 * （对方看不到我移动），也拿不到 WORLD_STATE（我看不到对方），且对方早因 PLAYER_LEFT
 * 把我的角色删掉了。表现=必须 AB 各自刷新页面才互相可见。
 *
 * 判据：
 *   A1 基线：两页互相可见 + 基线移动可见
 *   A2 wsPresenceGuard 已加载并登记身份
 *   A3 强制掉线后自动重连 + 自动重新登记
 *   A4 【核心】重连后对端仍能看到我移动
 *   A5 重连后我仍能看到对端移动
 *   A6 应用层探活 PING→PONG 生效（服务器支持，可发现半开连接）
 *   A7 无 console error（过滤扩展/404 噪音）
 *
 * 运行：node scripts/accept_ws_reconnect_presence.js
 */
require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3002';
const results = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail ? '  -> ' + detail : ''}`);
}

function remotePos(page, cid) {
  return page.evaluate((id) => {
    if (!window.gameWorld) return null;
    const pd = window.gameWorld.players.get(id);
    if (!pd) return null;
    return { x: +pd.group.position.x.toFixed(2), z: +pd.group.position.z.toFixed(2) };
  }, cid);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
  const pageA = await ctx.newPage();
  const pageB = await ctx.newPage();

  const consoleErrors = [];
  const guardLogs = [];
  const attach = (p) => {
    p.on('console', (m) => {
      const t = m.text();
      if (/WSGuard/.test(t)) guardLogs.push(t);
      if (m.type() === 'error') {
        if (t.includes('runtime.lastError') || t.includes('index.global.js')) return;
        if (t.includes('Failed to load resource') && t.includes('404')) return;
        consoleErrors.push(t);
      }
    });
  };
  attach(pageA); attach(pageB);

  console.log('[nav] 两页游客模式进世界...');
  await pageA.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageB.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });

  let ok = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const s1 = await pageA.evaluate(() => window.gameWorld ? window.gameWorld.players.size : -1);
    const s2 = await pageB.evaluate(() => window.gameWorld ? window.gameWorld.players.size : -1);
    if (s1 >= 2 && s2 >= 2) { ok = true; break; }
  }
  const idA = await pageA.evaluate(() => (window.GAME_STATE || {}).characterId);
  const idB = await pageB.evaluate(() => (window.GAME_STATE || {}).characterId);
  record('A1a', '两页互相可见（世界名册 2 人以上）', ok, `A=${idA} B=${idB}`);

  // ---- 基线：A 移动 → B 可见 ----
  await pageA.evaluate(() => { window.player.position.x += 20; window.player.broadcastPosition(); });
  await sleep(1500);
  const bBase = await remotePos(pageB, idA);
  record('A1b', '基线：A 移动后 B 能看到', !!bBase, `B 看到的 A = ${JSON.stringify(bBase)}`);

  // ---- A2 guard ----
  const diag0 = await pageA.evaluate(() => window.WSPresenceGuard ? window.WSPresenceGuard._diag() : null);
  record('A2', 'wsPresenceGuard 已加载并缓存身份', !!(diag0 && diag0.registered),
    `diag=${JSON.stringify(diag0)}`);

  // ---- 断线 ----
  console.log('[break] 强制关闭 A 的 WebSocket（模拟掉线/服务器重启/网络闪断）...');
  await pageA.evaluate(() => { window.WSClient.ws.close(); });

  let reconnected = false;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const c = await pageA.evaluate(() => window.WSClient.isConnected());
    if (c) { reconnected = true; break; }
  }
  const rejoined = guardLogs.some(t => /自动重新登记玩家身份/.test(t));
  record('A3', '掉线后自动重连并重新登记身份', reconnected && rejoined,
    `connected=${reconnected} rejoinLog=${rejoined}`);

  // ---- A4 核心：重连后 A 移动 → B 仍能看到 ----
  await pageA.evaluate(() => { window.player.position.x += 30; window.player.broadcastPosition(); });
  await sleep(2500);
  const bAfter = await remotePos(pageB, idA);
  const bSize = await pageB.evaluate(() => window.gameWorld.players.size);
  const moved = !!(bBase && bAfter) && Math.abs(bAfter.x - bBase.x) > 5;
  record('A4', '【核心】重连后对端仍能看到我移动', moved,
    `before=${JSON.stringify(bBase)} after=${JSON.stringify(bAfter)} B名册=${bSize}`);

  // ---- A5 反向：B 移动 → A 能看到 ----
  const aB1 = await remotePos(pageA, idB);
  await pageB.evaluate(() => { window.player.position.x += 30; window.player.broadcastPosition(); });
  await sleep(2500);
  const aB2 = await remotePos(pageA, idB);
  record('A5', '重连后我仍能看到对端移动',
    !!(aB1 && aB2) && Math.abs(aB2.x - aB1.x) > 5,
    `before=${JSON.stringify(aB1)} after=${JSON.stringify(aB2)}`);

  // ---- A6 探活 PING/PONG ----
  const p0 = await pageA.evaluate(() => window.WSPresenceGuard._diag());
  await pageA.evaluate(() => { window.WSPresenceGuard._probe(); window.WSPresenceGuard._probe(); });
  await sleep(1500);
  const p1 = await pageA.evaluate(() => window.WSPresenceGuard._diag());
  record('A6', '应用层探活 PING→PONG 生效（服务器支持，半开连接可自愈）',
    p1.probeSupported === true && p1.pongs > p0.pongs,
    `probeSupported=${p1.probeSupported} probes=${p1.probes} pongs ${p0.pongs}→${p1.pongs}`);

  // ---- A7 console error ----
  record('A7', '无 console error（已过滤扩展/404 噪音）', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | ') || '0 条');

  // ---- A8 服务器侧无"未登记连接"告警（若诊断日志存在） ----
  const logPath = path.join(__dirname, '..', 'logs', '_ws_diag_stdout.log');
  if (fs.existsSync(logPath)) {
    const txt = fs.readFileSync(logPath, 'utf8');
    const ghostCount = (txt.match(/来自未登记连接/g) || []).length;
    record('A8', '服务器未出现"未登记连接"告警（无幽灵连接）', ghostCount === 0, `告警 ${ghostCount} 条`);
  } else {
    record('A8', '服务器侧幽灵连接告警检查', true, '跳过：未找到诊断日志（非本会话启动）');
  }

  const failed = results.filter(r => !r.pass);
  console.log(`\n===== 验收结果 ${results.length - failed.length}/${results.length} =====`);
  console.log(failed.length === 0 ? 'VERDICT ACCEPTED' : 'VERDICT FAILED: ' + failed.map(f => f.id).join(','));

  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
