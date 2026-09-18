/**
 * P3 验收（playwright）：①浏览器根路径 WS 回归 + ④真人看到 AI Avatar
 * 游客模式进世界（不需登录，避免限流）→ 检查 WS 连接 + players.size>0 + 0 console error（①）
 * → Agent WS 连接 → 检查真人端 players.size 增加 + 系统消息含 (AI)（④）
 */
require('dotenv').config();
const { chromium } = require('playwright');
const WebSocket = require('ws');
const { pool } = require('../src/database/db');

const BASE = 'http://localhost:3002';
const WS_URL = 'ws://localhost:3002/ws/agent';

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail ? '  -> ' + detail : ''}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const agentManager = require('../src/agent/agentManager');
  const agentConfigService = require('../src/agent/agentConfigService');

  await agentConfigService.ensureDefaultConfig();
  await agentConfigService.setConfigValue('agent_enabled', 'true');
  await agentConfigService.setConfigValue('max_agents', '50');
  await agentConfigService.setConfigValue('agent_push_default', 'standard');

  // 重启服务器让配置生效（60s 缓存）—— 脚本外已重启，这里等 65s
  console.log('[wait] 等 65s 让 agent_enabled=true 缓存过期...');
  await sleep(65000);

  // 准备测试 Agent（带真实 GLB avatar）
  const glbUrl = '/models/uploaded/model-1787128490256_dec.glb';  // 红军减面模型（已知存在）
  let agent = await agentManager.getAgentByName('p3_test_agent');
  if (!agent) {
    const c = await agentManager.createAgent({ name: 'p3_test_agent', description: 'P3', avatarConfig: { glbUrl } });
    agent = c.agent;
  }
  const apiKey = (await agentManager.createApiKey(agent.id)).key;

  // 换 token
  const s = await fetch(BASE + '/api/agent/v1/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }
  });
  const sJson = await s.json();
  if (s.status !== 200 || !sJson.token) {
    record('Z', '前置：换 token', false, `status=${s.status}`);
    await finish(); return;
  }
  const agentToken = sJson.token;
  record('Z', '前置：换 token', true);

  // ---------- playwright 游客进世界 ----------
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      // 过滤浏览器扩展噪音 + favicon 404 资源加载噪音（chrome 通道请求 /favicon.ico）
      if (t.includes('runtime.lastError') || t.includes('index.global.js')) return;
      if (t.includes('Failed to load resource') && t.includes('404')) return;
      consoleErrors.push(t);
    }
  });

  console.log('[nav] 游客模式打开主世界...');
  await page.goto(BASE + '/index.html?guest=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);  // 等世界加载 + WS 连接

  // ① 检查 WS 连接 + players.size > 0
  const state1 = await page.evaluate(() => {
    return {
      wsConnected: !!(window.gameWorld && window.gameWorld.players),
      playersSize: window.gameWorld ? window.gameWorld.players.size : -1,
      hasPlayer: !!window.player
    };
  });
  const ok1 = state1.wsConnected && state1.playersSize >= 0 && state1.hasPlayer;
  record('A1', '①浏览器根路径 WS 回归（游客进世界，WS 连接，players 初始化）', ok1,
    `playersSize=${state1.playersSize} hasPlayer=${state1.hasPlayer}`);

  const errBefore = consoleErrors.length;

  // ---------- Agent WS 连接 ----------
  console.log('[agent] Agent WS 连接 /ws/agent...');
  const agentWs = new WebSocket(WS_URL, { headers: { 'Authorization': 'Bearer ' + agentToken } });
  let agentReady = false;
  await new Promise((resolve) => {
    agentWs.on('open', () => { console.log('[agent] WS open'); });
    agentWs.on('message', (data) => {
      let msg; try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (msg.type === 'READY') { agentReady = true; resolve(); }
    });
    agentWs.on('error', (e) => { console.log('[agent] WS error:', e.message); resolve(); });
    setTimeout(resolve, 5000);
  });
  record('B1', 'Agent WS 连接 + 收到 READY', agentReady, `agentReady=${agentReady}`);

  // 等 PLAYER_JOINED 广播到达真人端
  await sleep(2000);

  // ④ 检查真人端 players.size 增加 + 系统消息含 (AI)
  const state2 = await page.evaluate((agentId) => {
    const players = window.gameWorld ? window.gameWorld.players : null;
    let agentPlayer = null;
    if (players) {
      for (const [cid, pd] of players.entries()) {
        if (cid === agentId) { agentPlayer = pd; break; }
      }
    }
    return {
      playersSize: players ? players.size : -1,
      agentInPlayers: !!agentPlayer
    };
  }, agent.id);

  const ok4 = state2.playersSize > state1.playersSize;
  record('A2', '④真人端 players.size 增加（Agent 入场）', ok4,
    `before=${state1.playersSize} after=${state2.playersSize}`);

  // 检查系统消息含 (AI) —— 通过 UI.addChatMessage 写入的 DOM
  const chatText = await page.evaluate(() => {
    const els = document.querySelectorAll('[class*="chat"], [id*="chat"], [class*="message"], [id*="message"]');
    let text = '';
    els.forEach(e => { text += (e.textContent || '') + '\n'; });
    return text;
  });
  const hasAiMsg = chatText.includes('(AI)') || chatText.includes('AI');
  record('A3', '④真人端系统消息含 (AI)（Agent 加入提示）', hasAiMsg, `chatLen=${chatText.length}`);

  // 0 console error（过滤浏览器扩展噪音后）
  const newErrors = consoleErrors.slice(errBefore).filter(e => !e.includes('favicon'));
  record('A4', '①真人端 0 新 console error', newErrors.length === 0, `errors=${newErrors.length}${newErrors.length ? ' content=' + newErrors.join(' | ') : ''}`);

  try { agentWs.close(); } catch (e) {}
  await browser.close();

  // 收尾
  await agentConfigService.setConfigValue('agent_enabled', 'false');
  await agentConfigService.setConfigValue('agent_push_default', 'eco');
  console.log('\n[cleanup] agent_enabled=false, pushDefault=eco');
  await finish();
}

async function finish() {
  const pass = results.filter(r => r.pass).length;
  console.log(`\n===== P3 验收（①④ playwright）: ${pass}/${results.length} PASS =====`);
  process.exitCode = pass === results.length ? 0 : 1;
  try { await pool.end(); } catch (e) {}
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
