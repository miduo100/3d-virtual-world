/**
 * accept_agent_live_renew.js — 长驻客户端"会话续期"验收（v6 轮，批次 A）
 *
 * 背景（v5 长会话实测发现的真缺陷 A）：Agent JWT TTL = 900s，
 *   **WS 只在建连时校验一次**（连接可远超 TTL 存活），**HTTP 端点每次调用都校验** →
 *   不续期的长驻客户端 t≈15min 起 observe / /me / chat/history 全部 403 TOKEN_EXPIRED，
 *   而 WS 仍活着（还能 say / move）→ 世界里表现为"AI 还回话，但看不见世界、也不再对世界有反应"。
 *
 * 两组判据（before 组是"复现"，after 组是"修复生效"）：
 *
 *   before 组（无续期对照，用自签短命 JWT 把 15 分钟窗口压缩到 2 分钟）：
 *     B0 换票成功 → B1 自签短命 token 当前有效（observe 200）→ B2 用该 token 连 WS 成功
 *     → 等 token 过期 → B3 observe 403 TOKEN_EXPIRED / B4 /me 403 TOKEN_EXPIRED
 *     → B5 WS readyState 仍 = 1（连接没断、客户端表面"在线"）
 *     → B6 say 仍 ACTION_COMPLETED / B7 move 仍 ACTION_ACCEPTED（WS 侧活着）
 *
 *   after 组（启动 ai-live.mjs 子进程，把续期间隔压到 60s，跑约 4.5 分钟）：
 *     A0 READY 成功上线 / A1 observe 持续成功（HTTP 能力在线）
 *     A2 observe 0 次 HTTP 错误（= 0 次 403） / A3 chat/history 0 次 HTTP 错误
 *     A4 tokenRefreshedAt 出现 ≥3 个不同值（确实在续期） / A5 续期事件 ≥3 条
 *     A6 WS 未重连（ws closed 计数 = 0，符合 §5.2 设计）
 *
 * 用法：node scripts/accept_agent_live_renew.js
 *   环境变量：AI_LIVE_SHORT_TTL（before 组短命 TTL 秒，默认 120）
 *             AI_LIVE_RUN_MS（after 组运行毫秒，默认 270000）
 *             AI_LIVE_REFRESH_MS_TEST（after 组续期间隔毫秒，默认 60000）
 * 产物：examples/agent-client/live/live_renew.json
 * 注：脚本自身会把 ai-live 子进程的 live 目录隔离到临时目录（AI_LIVE_DIR），避免污染驻场进程。
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const K = require('./agentV2TestKit');

const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const SECRET = process.env.AGENT_JWT_SECRET;
const STORE = path.join(__dirname, '_tmp_tier_agents.json');
const AI_LIVE = path.join(__dirname, '..', 'examples', 'agent-client', 'ai-live.mjs');
const REPORT = path.join(__dirname, '..', 'examples', 'agent-client', 'live', 'live_renew.json');

const SHORT_TTL = Number(process.env.AI_LIVE_SHORT_TTL || 120);
const RUN_MS = Number(process.env.AI_LIVE_RUN_MS || 270000);
const REFRESH_MS = Number(process.env.AI_LIVE_REFRESH_MS_TEST || 60000);

function decode(t) { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')); }

async function waitReq(msgs, type, requestId, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find(m => m && m.type === type && m.payload && m.payload.requestId === requestId);
    if (hit) return hit;
    await K.sleep(80);
  }
  return null;
}

async function adminToken() {
  let tok = null;
  try {
    if (fs.existsSync(STORE)) {
      const prev = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      if (prev.adminToken) {
        const t = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + prev.adminToken } });
        if (t.status === 200) { tok = prev.adminToken; console.log('[admin] 复用已有 token（未烧登录限流）'); }
      }
    }
  } catch (e) { /* 回落登录 */ }
  if (!tok) {
    const r = await K.httpJson('/api/admin-auth/login', {
      method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
    });
    const j = r.json || {};
    tok = j.token || (j.data && j.data.token) || null;
    console.log('[admin] 登录 ->', r.status);
  }
  return tok;
}

// ==================== before 组：复现"变木头人" ====================

async function beforeGroup(R, AGENT) {
  const s = await K.httpJson('/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + AGENT.apiKey }, body: {}
  });
  const fresh = s.json && s.json.token;
  R.check('B0 换票成功（拿有效会话 jti）', s.status === 200 && !!fresh, s.status);
  if (!fresh) return;

  const p = decode(fresh);
  // 同 jti + 短命（默认 120s）→ 把 15 分钟窗口压缩到 2 分钟
  const short = jwt.sign(
    { sub: p.sub, principalType: 'agent', worldId: p.worldId, scopes: p.scopes },
    SECRET,
    { jwtid: p.jti, expiresIn: SHORT_TTL }
  );

  const ok1 = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: { Authorization: 'Bearer ' + short } });
  R.check('B1 自签短命 token 此刻有效（observe 200）', ok1.status === 200, ok1.status);

  const conn = await K.openAgentWs({ token: short });
  R.check('B2 用该 token 连 /ws/agent 成功（此刻未过期）', conn.ok === true, conn.ok ? 'connected' : conn.statusCode);
  if (!conn.ok) return;
  await K.waitFor(conn.msgs, 'READY', 4000);

  console.log(`   ...等待 token 过期（${SHORT_TTL}s + 10s 余量）`);
  await K.sleep(SHORT_TTL * 1000 + 10000);

  const obs = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: { Authorization: 'Bearer ' + short } });
  R.check('B3 到期后 observe → 403 TOKEN_EXPIRED（HTTP 侧已"瞎"）',
    obs.status === 403 && obs.json && obs.json.code === 'TOKEN_EXPIRED',
    { status: obs.status, code: obs.json && obs.json.code });

  const me = await K.httpJson('/api/agent/v1/me', { headers: { Authorization: 'Bearer ' + short } });
  R.check('B4 到期后 /me → 403 TOKEN_EXPIRED',
    me.status === 403 && me.json && me.json.code === 'TOKEN_EXPIRED',
    { status: me.status, code: me.json && me.json.code });

  R.check('B5 WS 仍 OPEN（readyState=1）→ 连接没断，客户端表面"在线"',
    conn.ws.readyState === 1, conn.ws.readyState);

  K.wsSend(conn.ws, { type: 'ACTION', payload: { requestId: 'renew-b-say', action: 'say', text: 'renew-test-before' } });
  const sayDone = await waitReq(conn.msgs, 'ACTION_COMPLETED', 'renew-b-say', 6000);
  R.check('B6 到期后 say 仍 ACTION_COMPLETED（WS 侧活着，还能回话）',
    !!sayDone, sayDone ? sayDone.payload : 'TIMEOUT');

  K.wsSend(conn.ws, { type: 'ACTION', payload: { requestId: 'renew-b-move', action: 'move', direction: { x: 1, z: 0 } } });
  const moveAck = await waitReq(conn.msgs, 'ACTION_ACCEPTED', 'renew-b-move', 6000);
  R.check('B7 到期后 move 仍 ACTION_ACCEPTED（移动仍可用 → 会一直走到世界边界）',
    !!moveAck, moveAck ? moveAck.payload : 'TIMEOUT');

  K.wsSend(conn.ws, { type: 'ACTION', payload: { requestId: 'renew-b-stop', action: 'stop' } });
  await K.sleep(800);
  K.closeAll(conn.ws);
  await K.sleep(1200);   // 等服务端清理连接（单 Agent 并发上限 1，避免顶掉 after 组连接）
}

// ==================== after 组：续期生效 ====================

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}

async function afterGroup(R, AGENT) {
  const dir = path.join(__dirname, '..', 'examples', 'agent-client', 'live', '_tmp_renew_' + Date.now());
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });

  const child = spawn(process.execPath, [AI_LIVE], {
    env: {
      ...process.env,
      AGENT_HOST: BASE,
      AGENT_API_KEY: AGENT.apiKey,
      AI_LIVE_REFRESH_MS: String(REFRESH_MS),
      AI_LIVE_DIR: dir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childOut = '';
  child.stdout.on('data', d => { childOut += d.toString(); });
  child.stderr.on('data', d => { childOut += d.toString(); });

  const stamps = new Set();
  const expectObserves = Math.floor(RUN_MS / 3000 * 0.7);
  console.log(`   ai-live 子进程已启动（refresh=${REFRESH_MS}ms, run=${Math.round(RUN_MS / 1000)}s, dir=${path.basename(dir)}）`);
  const t0 = Date.now();
  while (Date.now() - t0 < RUN_MS) {
    await K.sleep(5000);
    try {
      const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
      if (st.tokenRefreshedAt) stamps.add(st.tokenRefreshedAt);
    } catch (e) { /* 文件还没生成 */ }
  }
  try { child.kill(); } catch (e) { /* ignore */ }
  await K.sleep(1500);

  const lines = readLines(path.join(dir, 'events.jsonl'));
  const ready = lines.filter(l => l.dir === 'in' && l.msg && l.msg.type === 'READY');
  const observes = lines.filter(l => l.dir === 'observe' && !l.event);
  const obsErr = lines.filter(l => l.dir === 'observe' && l.event === 'http_error');
  const histErr = lines.filter(l => l.dir === 'chat-history' && l.event === 'http_error');
  const refreshed = lines.filter(l => l.dir === 'session' && l.event === 'refreshed');
  const giveup = lines.filter(l => l.dir === 'session' && l.event === 'refresh_giveup');
  const wsClosed = lines.filter(l => l.dir === 'ws' && l.event === 'closed');

  R.check('A0 ai-live 子进程 READY 成功上线', ready.length >= 1, ready.length);
  R.check(`A1 observe 持续成功（≥ ${expectObserves} 条，HTTP 能力在线）`, observes.length >= expectObserves, observes.length);
  R.check('A2 observe 0 次 HTTP 错误（= 0 次 403）', obsErr.length === 0, obsErr.length ? obsErr.slice(0, 2) : 0);
  R.check('A3 chat/history 0 次 HTTP 错误', histErr.length === 0, histErr.length);
  R.check('A4 tokenRefreshedAt 出现 ≥3 个不同值（确实在续期）', stamps.size >= 3, Array.from(stamps));
  R.check('A5 续期成功事件 ≥3 条', refreshed.length >= 3, refreshed.length);
  R.check('A6 WS 未重连（ws closed 计数 = 0，符合 §5.2 设计）', wsClosed.length === 0, wsClosed.length);
  R.check('A7 无 refresh_giveup（续期从未彻底放弃）', giveup.length === 0, giveup.length);

  return { dir, observes: observes.length, obsErr: obsErr.length, stamps: Array.from(stamps), childOutTail: childOut.split('\n').filter(Boolean).slice(-25) };
}

// ==================== main ====================

(async () => {
  const R = K.createReporter('长驻客户端会话续期验收（before 复现 / after 修复）');
  if (!SECRET) { console.log('FATAL: 缺 AGENT_JWT_SECRET（无法自签短命 token）'); process.exitCode = 1; return; }
  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const AGENT = store.created.find(a => a.key === 'eco') || store.created[0];

  const tok = await adminToken();
  if (!tok) { console.log('FATAL: 拿不到 adminToken'); process.exitCode = 1; return; }
  const before = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + tok } });
  const orig = (before.json && before.json.config) || {};
  console.log('原配置:', JSON.stringify({ agentEnabled: orig.agentEnabled, maxAgents: orig.maxAgents, pushDefault: orig.pushDefault }));

  // 开总闸（本脚本需要 Agent 能上线）
  const on = await K.httpJson('/api/agent/v1/admin/config', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + tok }, body: { agent_enabled: 'true' }
  });
  R.check('P0 agent_enabled=true（验收前置）', on.status === 200, on.status);

  const t_all = Date.now();
  console.log('\n--- before 组：复现"HTTP 瞎了但 WS 还活着" ---');
  await beforeGroup(R, AGENT);

  console.log('\n--- after 组：ai-live.mjs 自动续期 ---');
  const after = await afterGroup(R, AGENT);

  // 收尾：恢复运行前读到的配置（不硬编码，参照 fix_a~f 口径）
  await K.httpJson('/api/agent/v1/admin/config', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + tok },
    body: { agent_enabled: orig.agentEnabled ? 'true' : 'false' }
  });
  const back = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + tok } });
  const now = (back.json && back.json.config) || {};
  R.check(`P9 收尾恢复运行前配置（agentEnabled=${orig.agentEnabled}）`,
    String(now.agentEnabled) === String(!!orig.agentEnabled), now.agentEnabled);

  const sum = R.summary();
  try {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, JSON.stringify({
      ts: new Date().toISOString(),
      durationSec: Math.round((Date.now() - t_all) / 1000),
      config: { shortTtlSec: SHORT_TTL, refreshMs: REFRESH_MS, runMs: RUN_MS },
      origConfig: { agentEnabled: orig.agentEnabled, maxAgents: orig.maxAgents, pushDefault: orig.pushDefault },
      pass: sum.pass, fail: sum.fail, total: sum.total,
      rows: sum.rows,
      afterDetail: { observes: after.observes, obsErr: after.obsErr, refreshStamps: after.stamps, childOutTail: after.childOutTail }
    }, null, 2), 'utf8');
    console.log('报告：' + REPORT);
  } catch (e) { console.log('报告写入失败: ' + e.message); }
  process.exitCode = sum.fail === 0 ? 0 : 1;
})();
