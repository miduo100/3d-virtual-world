/**
 * 三档 AI 联测 · 轮4b（重连 / 长会话 / observe 公平性 / 游客档对照，只测不改）
 *
 * 检测项：
 *   A1 断线重连续位：READY.spawn 继承断开前位置（缺陷 J 回归）+ 档位保持
 *   A2 长会话稳定性：90s 保活（每 15s PING），连接不断、推送持续
 *   A3 observe 公平性：三档并发 1.2s 间隔拉取 15s，统计 200/429
 *   A4 第 1 档对照（游客 guest-pull）：pushTier 强制 eco、SUBSCRIBE 被拒、radius 钳 30
 *
 * 依赖：scripts/_tmp_tier_agents.json
 * 运行：node scripts/accept_agent_tier_r4b.js
 * 报告：examples/agent-client/live/tier-r4b.json
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const K = require('./agentV2TestKit');

const R = K.createReporter('重连/长会话/公平性/游客对照（轮4b）');
const sleep = K.sleep;
const ORDER = ['eco', 'standard', 'realtime'];
const AGENTS_FILE = path.join(__dirname, '_tmp_tier_agents.json');
const REPORT_DIR = path.join(__dirname, '..', 'examples', 'agent-client', 'live');

const store = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
const SPECS = ORDER.map(k => store.created.find(a => a.key === k)).filter(Boolean);
const issues = [];
const data = {};
const sockets = [];

async function connect(spec) {
  const s = await K.httpJson('/api/agent/v1/session', { method: 'POST', headers: { Authorization: 'Bearer ' + spec.apiKey } });
  const token = s.json && s.json.token;
  const conn = await K.openAgentWs({ authHeader: 'Bearer ' + token });
  if (conn.ok) sockets.push(conn.ws);
  const ready = conn.ok ? await K.waitFor(conn.msgs, 'READY', 5000) : null;
  return { token, conn, ready };
}

async function main() {
  const agents = {};
  for (const spec of SPECS) {
    const { token, conn, ready } = await connect(spec);
    R.check(`[${spec.pushTier}] 上线`, conn.ok === true, conn.ok ? ready && ready.payload.pushTier : (conn.statusCode || conn.error));
    if (!conn.ok) continue;
    K.wsSend(conn.ws, { type: 'SUBSCRIBE', payload: { topics: ['chat', 'movement', 'presence'], radius: 30 } });
    agents[spec.pushTier] = { spec, token, conn };
  }

  // 让 realtime Agent 走到固定点，用于 A1
  const rt = agents.realtime;
  if (rt) {
    K.wsSend(rt.conn.ws, { type: 'ACTION', payload: { action: 'walk_to', requestId: uuidv4(), target: { x: 30, z: 20 } } });
    await sleep(6000);
    const o = await K.httpJson('/api/agent/v1/observe?radius=50', { headers: { Authorization: 'Bearer ' + rt.token } });
    const selfBefore = o.json && o.json.self && o.json.self.position;
    data.beforeReconnect = selfBefore;
    R.info('A1 断开前位置', selfBefore);

    // ---------- A1 断线重连 ----------
    try { rt.conn.ws.close(); } catch (e) {}
    await sleep(2500);
    const re = await connect(rt.spec);
    const spawn = re.ready && re.ready.payload.spawn;
    const tierOk = re.ready && re.ready.payload.pushTier === 'realtime';
    data.afterReconnect = { spawn, pushTier: re.ready && re.ready.payload.pushTier };
    R.check('A1 重连后档位保持 realtime（自身档位生效）', tierOk === true, data.afterReconnect);
    const dist = (spawn && selfBefore) ? Math.hypot(spawn.x - selfBefore.x, spawn.z - selfBefore.z) : 999;
    R.check('A1 重连 spawn 继承断开前位置（缺陷 J 回归，误差 <2m）', dist < 2, { spawn, before: selfBefore, dist: Number(dist.toFixed(2)) });
    if (!(dist < 2)) {
      issues.push({ tier: 'realtime', level: 'P1', item: '断线重连位置未续位（回归 J）', detail: `断开前 ${JSON.stringify(selfBefore)}，重连 spawn=${JSON.stringify(spawn)}（差 ${dist.toFixed(2)}m）`, code: 'agentSessionManager.getLatestPosition + agentWsServer 连接处 spawn 解析' });
    }
    agents.realtime = { spec: rt.spec, token: re.token, conn: re.conn };
    K.wsSend(re.conn.ws, { type: 'SUBSCRIBE', payload: { topics: ['chat', 'movement', 'presence'], radius: 30 } });
  }

  // ---------- A3 observe 公平性（三档并发 15s） ----------
  // 注意：循环体每档之间 sleep 400ms → **同一 Agent 的间隔 = 3 × 400 = 1.2s**（≥1s 窗口）。
  // 原为 300ms → 同一 Agent 只有 900ms，低于限频窗口，实测 7~8 次 429 被误判成"公平性问题"
  //（§9 坑 6；对应缺陷 T10：客户端应按 ≥1.1s 轮询）。
  const fair = { eco: { ok: 0, e429: 0 }, standard: { ok: 0, e429: 0 }, realtime: { ok: 0, e429: 0 } };
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    for (const t of ORDER) {
      if (!agents[t]) continue;
      const r = await K.httpJson('/api/agent/v1/observe?radius=200', { headers: { Authorization: 'Bearer ' + agents[t].token } });
      if (r.status === 200) fair[t].ok++;
      else if (r.status === 429) fair[t].e429++;
      await sleep(400);
    }
  }
  data.observeFairness = fair;
  R.info('A3 observe 公平性（15s，1.2s 间隔）', fair);
  R.check('A3 三档 observe 均无饥饿（每档成功 ≥ 8 次）',
    ORDER.every(t => !agents[t] || fair[t].ok >= 8), fair);
  R.check('A3 未超频时 429 为 0', ORDER.every(t => fair[t].e429 === 0), fair);

  // ---------- A2 长会话稳定性（90s 保活） ----------
  const humanCid = uuidv4();
  const human = await K.openHumanWs({ characterId: humanCid, characterName: 'R4b-真人', position: { x: 0, y: 0, z: 0 } });
  if (human.ok) sockets.push(human.ws);
  const before = {}; ORDER.forEach(t => agents[t] && (before[t] = agents[t].conn.msgs.length));
  const tA = Date.now();
  let ticks = 0;
  while (Date.now() - tA < 90000) {
    ticks++;
    // 真人持续移动（保证位置流有内容）
    K.wsSend(human.ws, { type: 'POSITION_UPDATE', payload: { characterId: humanCid, position: { x: (ticks % 20) * 2, y: 0, z: 0 }, animMode: 'walk', rotation: 0 } });
    for (const t of ORDER) if (agents[t]) K.wsSend(agents[t].conn.ws, { type: 'PING' });
    await sleep(15000);
  }
  const stable = {};
  for (const t of ORDER) {
    if (!agents[t]) continue;
    const c = agents[t].conn;
    stable[t] = {
      closed: c.closeInfo.code,
      msgsIn90s: c.msgs.length - before[t],
      lastTypes: [...new Set(c.msgs.slice(-25).map(m => m.type))]
    };
    R.info(`[${t}] A2 90s 后`, stable[t]);
    R.check(`[${t}] A2 长会话连接未断`, c.closeInfo.code === null, c.closeInfo);
    R.check(`[${t}] A2 长会话推送持续（90s 内仍有消息）`, stable[t].msgsIn90s > 0 || t === 'eco', stable[t].msgsIn90s);
  }
  data.soak = stable;

  // ---------- A4 第 1 档（游客 guest-pull）对照 ----------
  const guestIp = K.testIp(120 + Math.floor(Math.random() * 60));
  const gt = await K.guestTicket(guestIp);
  R.check('A4 游客签票成功（第 1 档）', gt.status === 200 && !!gt.ticket, gt.status);
  if (gt.ticket) {
    const gc = await K.openAgentWs({ token: gt.ticket.token, ip: guestIp });
    R.check('A4 游客 WS 连接成功', gc.ok === true, gc.ok ? 'ok' : (gc.statusCode || gc.error));
    if (gc.ok) {
      sockets.push(gc.ws);
      const gready = await K.waitFor(gc.msgs, 'READY', 5000);
      R.check('A4 游客 pushTier 被强制 eco（红线 1）', gready && gready.payload.pushTier === 'eco', gready && gready.payload);
      R.check('A4 游客 tier=guest-pull / pushAllowed=false',
        gready && gready.payload.tierInfo && gready.payload.tierInfo.pushAllowed === false,
        gready && gready.payload.tierInfo);
      K.wsSend(gc.ws, { type: 'SUBSCRIBE', payload: { topics: ['movement'] } });
      const gerr = await K.waitFor(gc.msgs, 'ERROR', 3000);
      R.check('A4 游客 SUBSCRIBE 被拒（GUEST_PUSH_FORBIDDEN）', gerr && gerr.payload.code === 'GUEST_PUSH_FORBIDDEN', gerr && gerr.payload);
      const gobs = await K.httpJson('/api/agent/v1/observe?radius=200', { headers: { Authorization: 'Bearer ' + gt.ticket.token } });
      R.check('A4 游客 observe 半径被钳为 30（红线 15）', gobs.status === 200 && gobs.json.radius === 30, { status: gobs.status, radius: gobs.json && gobs.json.radius });
      // 8 秒内不应收到任何推送（红线 14）
      const idx = gc.msgs.length;
      await sleep(8000);
      const pushed = gc.msgs.slice(idx).filter(m => m.type !== 'PONG');
      data.guestPush = pushed.map(m => m.type);
      R.check('A4 游客 8s 内零主动推送（红线 14）', pushed.length === 0, data.guestPush);
      if (pushed.length > 0) {
        issues.push({ tier: 'guest', level: 'P1', item: '游客档收到主动推送（红线 14 违反）', detail: `8s 内收到 ${JSON.stringify(data.guestPush)}`, code: 'agentWsServer 推送分支 / forwardChatToAgents' });
      }
    }
  }

  finish();
}

function finish() {
  const sum = R.summary();
  console.log('\n===== 疑似问题 =====');
  if (issues.length === 0) console.log('（无）');
  issues.forEach((it, i) => console.log(`${i + 1}. [${it.level}][${it.tier}] ${it.item}\n   证据：${it.detail}\n   代码：${it.code}`));
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'tier-r4b.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary: sum, data, issues }, null, 2));
    console.log('\n报告已写入', path.join(REPORT_DIR, 'tier-r4b.json'));
  } catch (e) { console.log('报告写入失败', e.message); }
  K.closeAll(...sockets);
  process.exitCode = sum.fail > 0 ? 1 : 0;
}

main();
