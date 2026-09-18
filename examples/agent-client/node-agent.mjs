/**
 * node-agent.mjs — 零依赖 Node 18+ 示例 AI Agent 客户端
 *
 * 三步跑通（推模式，需管理员发的 API Key）：
 *   1. 管理后台 → 用户与角色 → 🤖 AI Agent → 创建 Agent，复制 API Key（仅显示一次）
 *   2. export AGENT_HOST=http://localhost:3002
 *      export AGENT_API_KEY=agk_live_xxxx
 *   3. node examples/agent-client/node-agent.mjs
 *
 * 无 Key 也能跑（P8 拉模式，公开临时票）：
 *   AGENT_HOST=http://localhost:3002 node examples/agent-client/node-agent.mjs
 *   游客只能"你问服务器答"：observe(30m) / say / 移动类动作，且收不到任何推送。
 *
 * 演示链路：
 *   discover → session（Key 或游客票）→ WS?token= → READY/WORLD_SNAPSHOT
 *   → SUBSCRIBE（仅 Key）→ observe → say → walk_to → teleport（红线：必被 REJECTED）
 */

const HOST = (process.env.AGENT_HOST || 'http://localhost:3002').replace(/\/+$/, '');
const API_KEY = process.env.AGENT_API_KEY || '';
const WS_BASE = HOST.replace(/^http/, 'ws');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(...a) { console.log(...a); }

async function getJson(url, token) {
  const r = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  let j = null;
  try { j = await r.json(); } catch (e) { /* non-JSON */ }
  return { status: r.status, body: j };
}

async function postJson(url, body, token) {
  const r = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {})
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* non-JSON */ }
  return { status: r.status, body: j };
}

/** 打开 WS（Node 18+ 全局 WHATWG WebSocket；不能设自定义请求头 → 用 ?token= 查询参数） */
function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    ws.addEventListener('message', (ev) => { try { inbox.push(JSON.parse(ev.data)); } catch (e) {} });
    ws.addEventListener('open', () => resolve({ ws, inbox }), { once: true });
    ws.addEventListener('error', (e) => reject(new Error('WS error: ' + (e.message || 'unknown'))), { once: true });
    setTimeout(() => reject(new Error('WS open timeout')), 8000);
  });
}

async function waitFor(inbox, type, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const m = inbox.find(x => x.type === type);
    if (m) return m;
    await sleep(80);
  }
  return null;
}

(async function main() {
  log('=== Virtual World Agent demo ===');
  log('host =', HOST, '| mode =', API_KEY ? 'key-push (推模式)' : 'guest-pull (拉模式，无 Key)');

  // 1) 自动发现（P6）：仅凭域名
  const wk = await getJson(HOST + '/.well-known/virtual-world-agent.json');
  log('[1] well-known:', wk.status, wk.body && wk.body.world && wk.body.world.name,
    '| agentEnabled =', wk.body && wk.body.agentEnabled);
  if (wk.body && wk.body.agentEnabled === false) {
    log('    ⚠️  该世界未开放 Agent 接入（agent_enabled=false），后续步骤会 503');
  }

  // 2) 会话：有 Key 走 /session，无 Key 走公开 /guest/session（P8）
  let token, tier;
  if (API_KEY) {
    const s = await postJson(HOST + '/api/agent/v1/session', {}, null);
    const r = await fetch(HOST + '/api/agent/v1/session', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const body = await r.json().catch(() => null);
    log('[2] session:', r.status, body && body.agent && body.agent.name);
    if (!body || !body.token) { log('    session 失败：', JSON.stringify(body)); process.exitCode = 1; return; }
    token = body.token; tier = 'key-push';
  } else {
    const g = await postJson(HOST + '/api/agent/v1/guest/session', {}, null);
    log('[2] guest session:', g.status, g.body && g.body.agent && g.body.agent.name,
      '| tier =', g.body && g.body.tier, '| ttl =', g.body && g.body.expiresIn);
    if (!g.body || !g.body.token) { log('    guest 签票失败：', JSON.stringify(g.body)); process.exitCode = 1; return; }
    token = g.body.token; tier = g.body.tier;
  }

  // 3) 进场
  const { ws, inbox } = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token)}`);
  const ready = await waitFor(inbox, 'READY');
  log('[3] READY:', ready ? `${ready.payload.agentName} tier=${ready.payload.tier} push=${ready.payload.pushTier}` : 'TIMEOUT');
  await waitFor(inbox, 'WORLD_SNAPSHOT', 3000);

  // 4) 订阅（红线：游客 SUBSCRIBE 会被拒绝）
  ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { topics: ['chat'] } }));
  const sub = await waitFor(inbox, 'SUBSCRIBED', 3000);
  const subErr = await waitFor(inbox, 'ERROR', 1500);
  if (sub) log('[4] SUBSCRIBED:', JSON.stringify(sub.payload));
  else log('[4] SUBSCRIBE 被拒（预期，游客拉模式）:', subErr && subErr.payload && subErr.payload.code);

  // 5) 观察（游客半径被钳到 30m）
  const ob = await getJson(HOST + '/api/agent/v1/observe?radius=200', token);
  log('[5] observe:', ob.status, '| radius =', ob.body && ob.body.radius,
    '| entities =', ob.body && ob.body.entities && ob.body.entities.length,
    '| objects =', ob.body && ob.body.objects && ob.body.objects.length);

  // 6) 说话
  ws.send(JSON.stringify({ type: 'ACTION', payload: { requestId: 'say-1', action: 'say', text: 'Hello from node-agent demo' } }));
  const said = await waitFor(inbox, 'ACTION_COMPLETED', 4000) || await waitFor(inbox, 'ACTION_REJECTED', 2000);
  log('[6] say:', said ? said.type + ' ' + JSON.stringify(said.payload) : 'TIMEOUT');

  // 7) 走到 5 米外（服务端 5m/s 限速推进）
  ws.send(JSON.stringify({ type: 'ACTION', payload: { requestId: 'walk-1', action: 'walk_to', target: { x: 5, z: 0 } } }));
  const walk = await waitFor(inbox, 'ACTION_ACCEPTED', 4000) || await waitFor(inbox, 'ACTION_REJECTED', 2000);
  log('[7] walk_to:', walk ? walk.type + ' ' + JSON.stringify(walk.payload) : 'TIMEOUT');
  await sleep(2500);

  // 8) 红线演示：teleport 必被拒
  ws.send(JSON.stringify({ type: 'ACTION', payload: { requestId: 'tp-1', action: 'teleport', target: { x: 100, z: 100 } } }));
  const tp = await waitFor(inbox, 'ACTION_REJECTED', 4000);
  log('[8] teleport:', tp ? 'REJECTED ' + tp.payload.code + '（红线：Agent 无传送权限）' : 'TIMEOUT');

  log('\n=== demo done (tier=' + tier + ') ===');
  ws.close();
  process.exitCode = 0;
})().catch(e => { console.error('demo failed:', e.message); process.exitCode = 1; });
