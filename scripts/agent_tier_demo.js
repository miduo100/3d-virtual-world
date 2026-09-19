/**
 * 三档 AI 驻场演示（给你自己进世界看）
 *
 * 作用：把 eco / standard / realtime 三个 Agent 同时接入世界，自动做这些事：
 *   - 每 8 秒 observe 一次，找到最近的真人 → follow（跟到 3m 停下）；没有真人就在出生点附近游走
 *   - 每 20 秒轮流说话（三档各说一句，验证 CHAT 与气泡）
 * 你只需要：浏览器打开 http://localhost:3002 → 进世界，观察三个 🤖 的行为。
 *
 * 运行：node scripts/agent_tier_demo.js
 * 停止：Ctrl + C（会自动断开三个 Agent 并广播离场）
 *
 * 前置：先跑过 node scripts/_tmp_tier_setup.js（会打开 agent_enabled 并创建三档 Agent）
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const K = require('./agentV2TestKit');

const AGENTS_FILE = path.join(__dirname, '_tmp_tier_agents.json');
const store = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
const ORDER = ['eco', 'standard', 'realtime'];
const SPECS = ORDER.map(k => store.created.find(a => a.key === k)).filter(Boolean);
const sockets = [];
const agents = {};

function log(...a) { console.log(`[${new Date().toLocaleTimeString()}]`, ...a); }

async function connect(spec) {
  const s = await K.httpJson('/api/agent/v1/session', { method: 'POST', headers: { Authorization: 'Bearer ' + spec.apiKey } });
  const token = s.json && s.json.token;
  const conn = await K.openAgentWs({ authHeader: 'Bearer ' + token });
  if (!conn.ok) { log(spec.pushTier, '连接失败', conn.statusCode || conn.error); return null; }
  sockets.push(conn.ws);
  const ready = await K.waitFor(conn.msgs, 'READY', 5000);
  K.wsSend(conn.ws, { type: 'SUBSCRIBE', payload: { topics: ['chat', 'movement', 'presence'], radius: 60 } });
  log(`${spec.pushTier} 已上线（pushTier=${ready && ready.payload.pushTier}，spawn=${JSON.stringify(ready && ready.payload.spawn)}）`);
  return { spec, token, conn };
}

async function observe(agent) {
  const r = await K.httpJson('/api/agent/v1/observe?radius=200', { headers: { Authorization: 'Bearer ' + agent.token } });
  return r.status === 200 ? r.json : null;
}

async function tick() {
  for (const t of ORDER) {
    const a = agents[t];
    if (!a) continue;
    const o = await observe(a);
    if (!o) continue;
    const humans = (o.entities || []).filter(e => e.type === 'human');
    const self = o.self && o.self.position;
    if (humans.length > 0) {
      const near = humans.sort((x, y) => (x.distance || 999) - (y.distance || 999))[0];
      K.wsSend(a.conn.ws, { type: 'ACTION', payload: { action: 'follow', requestId: uuidv4(), targetId: near.id, stopDistance: 3 } });
      log(`${t} → follow ${near.name || near.id}（${Number(near.distance || 0).toFixed(1)}m）`);
    } else if (self) {
      const target = { x: Math.round((self.x || 0) + (Math.random() * 20 - 10)), z: Math.round((self.z || 0) + (Math.random() * 20 - 10)) };
      K.wsSend(a.conn.ws, { type: 'ACTION', payload: { action: 'walk_to', requestId: uuidv4(), target } });
      log(`${t} → 无真人，游走到 ${JSON.stringify(target)}`);
    }
  }
}

async function main() {
  log('连接三档 Agent...');
  for (const spec of SPECS) {
    const a = await connect(spec);
    if (a) agents[spec.pushTier] = a;
  }
  if (Object.keys(agents).length === 0) { log('无 Agent 上线，退出'); return; }

  const lines = ['大家好，我是第 2 档 eco Agent', '我是第 3 档 standard Agent', '我是第 4 档 realtime Agent'];
  let n = 0;
  const sayTimer = setInterval(() => {
    const t = ORDER[n % ORDER.length]; n++;
    const a = agents[t];
    if (!a) return;
    K.wsSend(a.conn.ws, { type: 'ACTION', payload: { action: 'say', requestId: uuidv4(), text: `${lines[ORDER.indexOf(t)] || '在的'}（${new Date().toLocaleTimeString()}）` } });
  }, 20000);
  const tickTimer = setInterval(tick, 8000);
  await tick();

  log('已驻场。浏览器打开 http://localhost:3002 进世界即可看到三个 🤖（Ctrl+C 停止）');
  process.on('SIGINT', () => {
    clearInterval(sayTimer); clearInterval(tickTimer);
    K.closeAll(...sockets);
    log('已断开全部 Agent，退出');
    process.exit(0);
  });
}

main();
