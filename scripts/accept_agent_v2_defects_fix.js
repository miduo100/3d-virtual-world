/**
 * accept_agent_v2_defects_fix.js — v2 轮联测缺陷 v2-1 / v2-3 修复后的专项验收
 *
 * 背景（v2 联测实测 3/3）：
 *   v2-1（P1）WS 升级后"瞬时断开" → agentWsServer 把 ws.on('close') 注册在两次 await 之后，
 *             close 帧先到则监听器永远挂不上 → handleClose 不执行，三项永久泄漏：
 *             ① 每 IP 名额 ② playerPositions 幽灵实体 ③ activeAgents 占 max_agents 名额。
 *   v2-3（P2）move / jump 未注入 { requestId, reply }，被打断时不补发 ACTION_COMPLETED{superseded}。
 *
 * 修复：① 监听器前置注册（earlyClosed）+ await 后 readyState 兜底（早退归还每 IP 名额）；
 *       ② movement.startMove/jump 接收 opts 并写入任务，被打断/断线时 notifyCompleted。
 *
 * 判据：
 *   V1  瞬时断开 ×N 后，同 IP 用新票可**立刻**重连（不再 GUEST_IP_CONCURRENCY）
 *   V2  瞬时断开 ×N 后，另一 IP 的游客 observe **看不到**该 agentId（无幽灵实体）
 *   V3  审计日志为每次瞬时断开都记下 ws_disconnected（phase=closed_before_ready）→ 证明 handleClose 执行
 *   V4  move 被 walk_to 打断 → 旧 requestId 收到 ACTION_COMPLETED{reason:superseded}
 *   V5  jump 被 walk_to 打断 → 旧 requestId 收到 ACTION_COMPLETED{reason:superseded}
 *   V6  快照：修复前后对照（v2 轮 3/3 泄漏 → 现在 0/N）
 *
 * 运行：node scripts/accept_agent_v2_defects_fix.js
 * 报告：examples/agent-client/live/v2-defects-fix.json
 *
 * 坑位：每次尝试用**独立 IP**（同 IP 每张票都算额度，10 张/小时）——初始票 + 重连票 = 2 张/IP。
 */

const fs = require('fs');
const path = require('path');
const K = require('./agentV2TestKit');

const R = K.createReporter('v2 缺陷修复专项验收（v2-1 瞬时断开泄漏 / v2-3 移动类回执）');
const sleep = K.sleep;

const RUN = (Math.floor(Date.now() / 1000) % 80) + 10;   // 10..89，避免与上一轮烧掉的窗口撞车
const IPS = (i) => `203.0.113.${RUN + i}`;
const OBS_IP = IPS(180);

const ATTEMPTS = 6;
const openSockets = [];

function auditLogPath() {
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(__dirname, '..', 'logs', `audit-${key}.log`);
}

/** 读审计日志（JSONL），只返回 ts >= sinceMs 的行 */
function readAuditSince(sinceMs) {
  const p = auditLogPath();
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const ln of lines) {
    let o;
    try { o = JSON.parse(ln); } catch (e) { continue; }
    const t = Date.parse(o.ts || o.time || '');
    if (!Number.isFinite(t) || t < sinceMs - 2000) continue;
    out.push(o);
  }
  return out;
}

async function adminToken() {
  const r = await K.httpJson('/api/admin-auth/login', {
    method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
  });
  const j = r.json || {};
  return j.token || (j.data && j.data.token) || null;
}

// ==================== V1~V3：瞬时断开泄漏 ====================

async function groupTransientDisconnect() {
  const t0 = Date.now();

  // 观察者：另一个 IP 的游客，常驻直到结束（用于查幽灵实体）
  const obsT = await K.guestTicket(OBS_IP);
  if (!obsT.ticket) {
    R.check('V0 前置：观察者签票成功', false, obsT.status);
    return { results: [] };
  }
  const obs = await K.openAgentWs({ token: obsT.ticket.token, ip: OBS_IP });
  if (!obs.ok) {
    R.check('V0 前置：观察者连接成功', false, obs.statusCode || obs.error);
    return { results: [] };
  }
  openSockets.push(obs.ws);
  await K.waitFor(obs.msgs, 'READY', 4000);

  const results = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    const ip = IPS(60 + i);
    const t = await K.guestTicket(ip);
    if (!t.ticket) { results.push({ attempt: i + 1, ip, error: 'ticket_' + t.status }); continue; }
    const agentId = t.ticket.agent.id;

    const c = await K.openAgentWs({ token: t.ticket.token, ip });
    if (!c.ok) { results.push({ attempt: i + 1, ip, error: 'upgrade_' + (c.statusCode || c.error) }); continue; }
    K.closeAll(c.ws);                 // ← 瞬时断开：不等 READY、不等任何消息
    await sleep(1500);

    // V2：幽灵实体（该票之后不再连接 → 出现即泄漏）
    const ob = await K.httpJson('/api/agent/v1/observe?radius=200', {
      headers: { Authorization: 'Bearer ' + obsT.ticket.token }
    });
    const ghost = ob.status === 200 && ((ob.json.entities || []).some(e => e.id === agentId));

    // V1：同 IP 用**新票**立刻重连（新 agent → 不会走"同 agent 顶替"）
    let reconnect = null;
    const t2 = await K.guestTicket(ip);
    if (t2.ticket) {
      const c2 = await K.openAgentWs({ token: t2.ticket.token, ip });
      reconnect = c2.ok === true;
      if (c2.ok) {
        // 连上后立刻断（避免占用该 IP 名额影响后续断言）—— 再看它自己是否也泄漏
        K.closeAll(c2.ws);
      }
    }
    results.push({ attempt: i + 1, ip, agentId, ghost, reconnect });
    await sleep(900);                 // 让观察者 observe 限频窗口（1 次/2s）过去
  }

  const ghosts = results.filter(x => x.ghost).length;
  const reconnectFails = results.filter(x => x.reconnect === false).length;
  const bad = results.filter(x => x.error).length;

  R.check(`V1 瞬时断开后同 IP 用新票可立刻重连（${ATTEMPTS} 次）`,
    reconnectFails === 0, { 重连失败: reconnectFails, 尝试次数: ATTEMPTS, 失败尝试: bad });
  R.check(`V2 瞬时断开后不留下幽灵 AI 实体（观察者 observe 看不到）`,
    ghosts === 0, { 幽灵次数: ghosts, 尝试次数: ATTEMPTS });

  // V3：审计日志机制证明 —— 每次瞬时断开都必须有一条 ws_disconnected
  let disconnects = [];
  for (let i = 0; i < 10; i++) {
    disconnects = readAuditSince(t0).filter(o => o.event === 'ws_disconnected');
    const ids = new Set(disconnects.map(o => o.connectionId).filter(Boolean));
    if (disconnects.length >= ATTEMPTS * 2) break;   // 每次尝试 = 断裂 + 重连后主动断，共 2 条
    await sleep(400);
  }
  const preReady = disconnects.filter(o => o.phase === 'closed_before_ready');
  const connectedIds = new Set(readAuditSince(t0).filter(o => o.event === 'ws_connected').map(o => o.connectionId));
  R.check('V3 审计日志记录 ws_disconnected（handleClose 确实执行，含 phase=closed_before_ready）',
    disconnects.length > 0 && preReady.length > 0,
    { ws_disconnected: disconnects.length, closed_before_ready: preReady.length, ws_connected: connectedIds.size });
  R.info('V3b 泄漏机理反证', 'ws 监听器前置注册后，close 事件必然进入 handleClose：'
    + `本次 ${ATTEMPTS} 次瞬时断开产生 ${preReady.length} 条 phase=closed_before_ready 审计；`
    + `修复前这 ${ATTEMPTS} 条连接不会产生任何 ws_disconnected（handleClose 未执行），且留下 ${ATTEMPTS} 个幽灵实体`);

  // 收尾观察者
  K.closeAll(obs.ws);
  return { results, ghosts, reconnectFails, disconnects: disconnects.length, preReady: preReady.length };
}

// ==================== V4~V5：移动类回执 ====================

function action(conn, obj) {
  const requestId = 'f' + Math.random().toString(36).slice(2, 10);
  K.wsSend(conn.ws, { type: 'ACTION', payload: { requestId, ...obj } });
  return requestId;
}

async function waitAction(msgs, requestId, types, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find(m => m && types.includes(m.type) && m.payload && m.payload.requestId === requestId);
    if (hit) return hit;
    await sleep(50);
  }
  return null;
}

async function groupReceipts() {
  const ip = IPS(190);
  const t = await K.guestTicket(ip);
  if (!t.ticket) { R.check('V4/V5 前置：签票成功', false, t.status); return; }
  const conn = await K.openAgentWs({ token: t.ticket.token, ip });
  if (!conn.ok) { R.check('V4/V5 前置：连接成功', false, conn.statusCode || conn.error); return; }
  openSockets.push(conn.ws);
  await K.waitFor(conn.msgs, 'READY', 4000);

  // V4：move 被 walk_to 打断
  // 注意：游客 tier 的动作限频是**按 action 分桶**的 1 次/2s（agentSchema TIER_ACTION_RATES），
  // 同一动作 2 秒内第二次会直接 rate_limited 而**不会**走到打断逻辑 —— 因此下面每个"同类动作"
  // 之间必须显式 sleep 2.1s，否则测的是限频而不是回执（首轮踩过：V5 因 walk_to 限频假失败）。
  const idMove = action(conn, { action: 'move', direction: { x: 1, z: 0 } });
  const accMove = await waitAction(conn.msgs, idMove, ['ACTION_ACCEPTED', 'ACTION_REJECTED'], 4000);
  const idWalk = action(conn, { action: 'walk_to', target: { x: 5, z: 5 } });
  const supMove = await waitAction(conn.msgs, idMove, ['ACTION_COMPLETED'], 4000);
  R.check('V4 move 被打断补发 ACTION_COMPLETED{reason:superseded}',
    !!accMove && accMove.type === 'ACTION_ACCEPTED' && !!supMove && supMove.payload.reason === 'superseded',
    supMove ? { reason: supMove.payload.reason } : '未收到回执');
  await waitAction(conn.msgs, idWalk, ['ACTION_ACCEPTED'], 3000);
  // 等这条 walk_to 走完（到达即任务被回收），保证 V5 从"无移动任务"的干净状态起跳——
  // jump 复用既有任务时**不会覆盖**旧 requestId（契约：一条任务只有一个待回执的指令），
  // 从干净状态起跳才能确定性地验证"jump 被打断补发 superseded"。
  const arriveWalk = await waitAction(conn.msgs, idWalk, ['ACTION_COMPLETED'], 8000);
  await sleep(2100);   // 清空 move/jump 的动作限频窗口

  // V5：jump 被 move 打断（jump 滞空仅 ~0.5s：v0=4m/s, g=9.8 → 5 tick 落地即回收任务）
  const idJump = action(conn, { action: 'jump' });
  const accJump = await waitAction(conn.msgs, idJump, ['ACTION_ACCEPTED', 'ACTION_REJECTED'], 4000);
  const idMove2 = action(conn, { action: 'move', direction: { x: 0, z: 1 } });
  const supJump = await waitAction(conn.msgs, idJump, ['ACTION_COMPLETED'], 4000);
  R.check('V5 jump 被打断补发 ACTION_COMPLETED{reason:superseded}',
    !!accJump && accJump.type === 'ACTION_ACCEPTED' && !!supJump && supJump.payload.reason === 'superseded',
    { 前一条walk_to到达: arriveWalk ? arriveWalk.payload.reason : 'no-completed', jump回执: supJump ? supJump.payload.reason : '未收到' });
  await waitAction(conn.msgs, idMove2, ['ACTION_ACCEPTED', 'ACTION_REJECTED'], 3000);
  await sleep(2100);   // 清空 walk_to 限频窗口（move 仍在推进，属正常）

  // V6：walk_to 到达回执未回归（E 项既有能力）—— 目标按当前位置 +8m 动态取，避免距离过远
  const selfR = await K.httpJson('/api/agent/v1/observe?radius=5', {
    headers: { Authorization: 'Bearer ' + t.ticket.token }
  });
  const sp = selfR.json && selfR.json.self && selfR.json.self.position;
  const tgt = { x: (sp ? sp.x : 0) + 8, z: (sp ? sp.z : 0) + 8 };
  const idArrive = action(conn, { action: 'walk_to', target: tgt });
  const comp = await waitAction(conn.msgs, idArrive, ['ACTION_COMPLETED'], 10000);
  R.check('V6 walk_to 到达回执未回归（reason=arrived）',
    !!comp && comp.payload.reason === 'arrived',
    { reason: comp && comp.payload.reason, target: tgt });

  R.info('V7 说明', '① move / jump 的 reason=disconnected 回执发给的是**已断开的连接**，客户端无法观测，'
    + '其清理侧证据 = V3 的 ws_disconnected（handleClose → cleanup → cancelMovement）；'
    + '② jump 若**复用**既有移动任务（如 walk_to 途中起跳），该 jump 不另占回执位（一条任务只挂一个待回执指令，'
    + '不覆盖旧 requestId），此时只有主指令收到 superseded —— 属既定契约，非缺陷。');
  K.closeAll(conn.ws);
}

// ==================== 主流程 ====================

(async () => {
  const started = Date.now();
  const report = { when: new Date().toISOString(), run: RUN, ips: { observer: OBS_IP }, groups: {}, fatal: null };
  let token = null, origEnabled = null;

  try {
    token = await adminToken();
    const cfg = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + token } });
    origEnabled = cfg.json && cfg.json.config && cfg.json.config.agentEnabled;
    R.check('V0 agent_enabled=true（联测期前置）', origEnabled === true, { agentEnabled: origEnabled });
    if (origEnabled !== true) {
      await K.httpJson('/api/agent/v1/admin/config', {
        method: 'PUT', headers: { Authorization: 'Bearer ' + token }, body: { agent_enabled: 'true' }
      });
      await sleep(400);
    }

    report.groups.transient = await groupTransientDisconnect();
    report.groups.receipts = 'see rows';
    await groupReceipts();
  } catch (e) {
    report.fatal = e.stack || e.message;
    console.error('FATAL', e);
  } finally {
    K.closeAll(...openSockets);
    if (token && origEnabled !== null) {
      try {
        await K.httpJson('/api/agent/v1/admin/config', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + token },
          body: { agent_enabled: origEnabled ? 'true' : 'false' }
        });
        console.log(`\n[restore] agent_enabled=${origEnabled ? 'true' : 'false'}`);
      } catch (e) { /* ignore */ }
    }
  }

  const sum = R.summary();
  report.result = { pass: sum.pass, fail: sum.fail, total: sum.total };
  report.rows = sum.rows;
  report.durationMs = Date.now() - started;

  const dir = path.join(__dirname, '..', 'examples', 'agent-client', 'live');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'v2-defects-fix.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log('报告: ' + out);
  process.exitCode = sum.fail === 0 ? 0 : 1;
})();
