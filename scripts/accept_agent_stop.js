/**
 * accept_agent_stop.js — 新增动作 `stop` 专项验收（缺陷 v2-4，用户决策 D1-A）
 *
 * 背景：`move` 是持续位移，此前没有干净的停法——客户端只能
 *   ① observe 拿自己坐标再 `walk_to` 到自己（触发 arrived 回执 + 0.5m 到达阈值），或
 *   ② 发另一条移动指令打断（等于继续走）。
 * `movementService.stopMove()` 曾是全项目零调用死代码，且只处理 mode==='move'。
 *
 * 定稿语义（D1-A）：
 *   - 立即终止该连接上一切移动类任务（move / walk_to / follow），原地切 idle
 *   - 被打断的那条指令 → ACTION_COMPLETED { requestId, reason: 'stopped' }
 *   - stop 自身       → ACTION_COMPLETED { requestId, result: { wasMoving } }
 *   - 幂等：无移动任务时也成功（wasMoving:false）
 *
 * 判据（S1~S8）：
 *   S1  move 中 stop → 位置 1s 内冻结（±0.3m）+ entities[self].animMode='idle'
 *   S2  move 的 requestId 收到 ACTION_COMPLETED{reason:'stopped'}
 *   S3  stop 自身收到 ACTION_COMPLETED{result.wasMoving===true}
 *   S4  walk_to 途中 stop → 该 requestId 收 'stopped'（不是 'arrived'）
 *   S5  follow 途中 stop → follow 收 'stopped'，且目标再动不再被跟随
 *   S6  幂等：无任务时 stop → wasMoving=false 且不抛错
 *   S7  游客档 stop 可用，2s 内第二次 rate_limited（TIER_ACTION_RATES 已加表项）
 *   S8  发现端点动作清单四处（capabilities / well-known / openapi x-websocket / openapi /action enum）
 *       + guest-pull.actionRates.stop === [1,2000]
 *
 * 运行：node scripts/accept_agent_stop.js
 * 报告：examples/agent-client/live/stop.json
 *
 * 口径修正（非产品缺陷）：`observe.self` 结构里**没有 animMode**（只有 id/name/position/rotation），
 *   animMode 在 `entities[]` 上 —— 本脚本按 `entities.find(isSelf).animMode` 断言（等价语义）。
 *
 * 坑位备忘：Key 档 observe 限频是按**时间窗口**（950ms）的 1 次/秒 → 本脚本用 obs() 统一节流，
 *   避免自造 429 假失败（§9 坑 25 同类）；游客票按 IP 计量（10 张/小时），每次运行 IP 随机偏移。
 */

const fs = require('fs');
const path = require('path');
const K = require('./agentV2TestKit');

const REPORT = path.join(__dirname, '..', 'examples', 'agent-client', 'live', 'stop.json');
const R = K.createReporter('新增动作 stop 专项验收（v2-4 / D1-A）');
const sleep = K.sleep;

// 游客 IP：用 TEST-NET-2 段并随运行号偏移，避免烧掉同一窗口的签票额度（§9 坑 24）
const RUN = Math.floor(Date.now() / 1000) % 100000;
const GUEST_IP = `198.51.100.${10 + (RUN % 40)}`;

const openSockets = [];
let adminTok = null;
let origEnabled = null;
let obsLastAt = 0;

// ==================== 基础设施 ====================

/** 优先复用 _tmp_tier_agents.json 里的 adminToken（避开管理员登录 15 次/小时限流，§9 坑 26） */
async function adminToken() {
  const storePath = path.join(__dirname, '_tmp_tier_agents.json');
  if (fs.existsSync(storePath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (prev.adminToken) {
        const t = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + prev.adminToken } });
        if (t.status === 200) { console.log('[admin] 复用已有 token'); return prev.adminToken; }
      }
    } catch (e) { /* 回落登录 */ }
  }
  const r = await K.httpJson('/api/admin-auth/login', {
    method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
  });
  const j = r.json || {};
  console.log('[admin] 登录 ->', r.status);
  return j.token || (j.data && j.data.token) || null;
}

/** 用 tier 测试 Agent（key-push 档）换 Agent JWT */
async function keyAgent() {
  const store = JSON.parse(fs.readFileSync(path.join(__dirname, '_tmp_tier_agents.json'), 'utf8'));
  const a = store.created.find(x => x.key === 'eco') || store.created[0];
  const r = await K.httpJson('/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + a.apiKey }, body: {}
  });
  if (r.status !== 200 || !r.json.token) {
    throw new Error(`key session 失败: ${r.status} ${r.text.slice(0, 200)}`);
  }
  return { agent: a, token: r.json.token };
}

async function openKey(jwt) {
  const c = await K.openAgentWs({ token: jwt, authHeader: 'Bearer ' + jwt });
  if (!c.ok) throw new Error(`Agent WS 连接失败: ${c.statusCode || c.error}`);
  openSockets.push(c.ws);
  return c;
}

/** observe（统一节流 ≥1s，避开 950ms 限频窗口） */
async function obs(conn, jwt) {
  const wait = 1000 - (Date.now() - obsLastAt);
  if (wait > 0) await sleep(wait);
  obsLastAt = Date.now();
  const r = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: { Authorization: 'Bearer ' + jwt } });
  return r.json;
}

function sendAction(conn, action, params, requestId) {
  return K.wsSend(conn.ws, { type: 'ACTION', payload: { action, requestId, ...(params || {}) } });
}

/** 等待某 requestId 的 ACTION_COMPLETED / ACTION_REJECTED */
async function waitReply(msgs, type, requestId, timeoutMs = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find(m => m && m.type === type && m.payload && m.payload.requestId === requestId);
    if (hit) return hit;
    await sleep(50);
  }
  return null;
}

function selfEntry(json) {
  const agentId = json.self.id;
  return (json.entities || []).find(e => String(e.id) === String(agentId)) || null;
}

function dist(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0));
}

// ==================== S1~S3：move → stop ====================

async function groupMoveStop(conn, jwt, report) {
  const o0 = await obs(conn, jwt);
  const base = { ...o0.self.position };
  R.check('S0 前置：Agent 在线且可 observe', Number.isFinite(base.x) && Number.isFinite(base.z),
    { spawn: base, agentId: o0.self.id });

  sendAction(conn, 'move', { direction: { x: 1, z: 0 } }, 'stop-move-1');
  await sleep(1300);
  const o1 = await obs(conn, jwt);
  const moved = dist(o1.self.position, base);
  R.check('S1a move 生效（1.3s 内位移 >5m）', moved > 5, { moved: Number(moved.toFixed(2)), at: o1.self.position });

  sendAction(conn, 'stop', {}, 'stop-1');
  await sleep(1000);
  const o2 = await obs(conn, jwt);
  await sleep(1000);
  const o3 = await obs(conn, jwt);
  const drift = dist(o3.self.position, o2.self.position);
  R.check('S1b stop 后位置冻结（1s 内漂移 ≤0.3m）', drift <= 0.3,
    { p2: o2.self.position, p3: o3.self.position, drift: Number(drift.toFixed(3)) });

  const selfEntity = selfEntry(o3) || selfEntry(o2);
  R.check('S1c stop 后 animMode=idle（entities[self]）', selfEntity && selfEntity.animMode === 'idle',
    selfEntity ? { animMode: selfEntity.animMode } : 'no self entity');

  const cMove = await waitReply(conn.msgs, 'ACTION_COMPLETED', 'stop-move-1');
  R.check('S2 move 的 requestId 收 ACTION_COMPLETED{reason:stopped}',
    cMove && cMove.payload.reason === 'stopped', cMove ? cMove.payload : 'no completed');

  const cStop = await waitReply(conn.msgs, 'ACTION_COMPLETED', 'stop-1');
  R.check('S3 stop 自身收 ACTION_COMPLETED{result.wasMoving:true}',
    cStop && cStop.payload.result && cStop.payload.result.wasMoving === true,
    cStop ? cStop.payload : 'no completed');

  report.groups.moveStop = { base, o1: o1.self.position, o2: o2.self.position, o3: o3.self.position, drift };
}

// ==================== S4：walk_to 途中 stop ====================

async function groupWalkToStop(conn, jwt, report) {
  const oa = await obs(conn, jwt);
  const p = oa.self.position;
  // 目标 60m 外（12 m/s 需 5s）→ 1.3s 时必然未到达；同号保证不越界
  const sign = (p.x + 60 <= 900) ? 1 : -1;
  const target = { x: p.x + sign * 60, z: p.z };

  sendAction(conn, 'walk_to', { target }, 'stop-walk-1');
  await sleep(1300);
  sendAction(conn, 'stop', {}, 'stop-2');

  const cWalk = await waitReply(conn.msgs, 'ACTION_COMPLETED', 'stop-walk-1');
  R.check('S4a walk_to 途中 stop → requestId 收 reason=stopped（非 arrived）',
    cWalk && cWalk.payload.reason === 'stopped', cWalk ? cWalk.payload : 'no completed');

  // 该 requestId 只应有一条终态回执（不能既 stopped 又 arrived）
  const all = conn.msgs.filter(m => m && m.type === 'ACTION_COMPLETED' && m.payload && m.payload.requestId === 'stop-walk-1');
  R.check('S4b 同一 requestId 仅一条终态回执（arrived 未重复发）', all.length === 1,
    all.map(x => x.payload.reason));

  await sleep(1200);
  const q1 = await obs(conn, jwt);
  await sleep(1000);
  const q2 = await obs(conn, jwt);
  const drift = dist(q2.self.position, q1.self.position);
  R.check('S4c stop 后不再朝目标推进（1s 漂移 ≤0.3m）', drift <= 0.3, Number(drift.toFixed(3)));

  report.groups.walkToStop = { target, receipts: all.map(x => x.payload), drift };
}

// ==================== S5：follow 途中 stop ====================

async function groupFollowStop(conn, jwt, report) {
  const oa = await obs(conn, jwt);
  const myPos = oa.self.position;
  const humanId = `stop_test_human_${RUN}`;
  const humanPos = { x: myPos.x + 8, y: 0, z: myPos.z };
  const human = await K.openHumanWs({ characterId: humanId, characterName: 'stop_human', position: humanPos });
  R.check('S5-0 前置：真人观察者已入场（follow 需要目标实体）', human.ok === true, human.ok ? 'upgraded' : human.error);
  if (!human.ok) return;
  openSockets.push(human.ws);
  await sleep(600);

  sendAction(conn, 'follow', { targetId: humanId, stopDistance: 3, maxDurationMs: 30000 }, 'stop-follow-1');
  await sleep(1300);
  sendAction(conn, 'stop', {}, 'stop-3');

  const cFollow = await waitReply(conn.msgs, 'ACTION_COMPLETED', 'stop-follow-1');
  R.check('S5a follow 途中 stop → follow 的 requestId 收 reason=stopped',
    cFollow && cFollow.payload.reason === 'stopped', cFollow ? cFollow.payload : 'no completed');

  // 目标再移动 25m —— Agent 不应再跟随
  const before = (await obs(conn, jwt)).self.position;
  const farPos = { x: humanPos.x + 25, y: 0, z: humanPos.z + 25 };
  K.wsSend(human.ws, {
    type: 'POSITION_UPDATE',
    payload: { characterId: humanId, position: farPos, animMode: 'walk', rotation: 0 }
  });
  await sleep(2000);
  const after = (await obs(conn, jwt)).self.position;
  const chased = dist(after, before);
  R.check('S5b stop 后目标再动不再被跟随（Agent 位移 ≤0.5m）', chased <= 0.5,
    { before, after, movedTowardTarget: Number(chased.toFixed(2)) });

  report.groups.followStop = { before, after, humanMovedTo: farPos, chased: Number(chased.toFixed(2)) };
}

// ==================== S6：幂等 ====================

async function groupIdempotent(conn, report) {
  sendAction(conn, 'stop', {}, 'stop-idem-1');
  const c = await waitReply(conn.msgs, 'ACTION_COMPLETED', 'stop-idem-1');
  R.check('S6 幂等：无移动任务时 stop 成功且 wasMoving=false',
    c && c.payload.result && c.payload.result.wasMoving === false,
    c ? c.payload : 'no completed');
  const rej = conn.msgs.find(m => m && m.type === 'ACTION_REJECTED' && m.payload && m.payload.requestId === 'stop-idem-1');
  R.check('S6b 幂等调用不产生 ACTION_REJECTED', !rej, rej ? rej.payload : 'none');
  report.groups.idempotent = c ? c.payload : null;
}

// ==================== S7：游客档 stop 与限频 ====================

async function groupGuestStop(report) {
  const t = await K.guestTicket(GUEST_IP);
  if (!t.ticket) {
    R.check('S7-0 前置：游客签票成功', false, { status: t.status, code: t.json && t.json.code });
    return;
  }
  const g = await K.openAgentWs({ token: t.ticket.token, authHeader: 'Bearer ' + t.ticket.token, ip: GUEST_IP });
  if (!g.ok) {
    R.check('S7-0 前置：游客 WS 连接成功', false, g.statusCode || g.error);
    return;
  }
  openSockets.push(g.ws);
  await sleep(400);

  sendAction(g, 'stop', {}, 'guest-stop-1');
  const c1 = await waitReply(g.msgs, 'ACTION_COMPLETED', 'guest-stop-1', 4000);
  R.check('S7a 游客档 stop 可用（ACTION_COMPLETED，wasMoving=false）',
    c1 && c1.payload.result && c1.payload.result.wasMoving === false, c1 ? c1.payload : 'no completed');

  sendAction(g, 'stop', {}, 'guest-stop-2');
  const r2 = await waitReply(g.msgs, 'ACTION_REJECTED', 'guest-stop-2', 4000);
  R.check('S7b 2s 内第二次 stop → rate_limited（TIER_ACTION_RATES 已加表项）',
    r2 && r2.payload.code === 'rate_limited', r2 ? r2.payload : 'no rejected');

  report.groups.guestStop = { first: c1 ? c1.payload : null, second: r2 ? r2.payload : null };
}

// ==================== S8：发现端点四处清单 ====================

async function groupDiscovery(report) {
  const caps = await K.httpJson('/api/agent/v1/capabilities');
  const wk = await K.httpJson('/.well-known/virtual-world-agent.json');
  const oa = await K.httpJson('/api/agent/v1/openapi.json');

  const capsActions = (caps.json && caps.json.actions) || [];
  R.check('S8a capabilities.actions 含 stop', capsActions.includes('stop'), capsActions);

  const wkActions = (wk.json && wk.json.actions) || [];
  R.check('S8b well-known.actions 含 stop（与 capabilities 同源）', wkActions.includes('stop'), wkActions);

  const wsActions = (oa.json && oa.json['x-websocket'] && oa.json['x-websocket'].actions) || [];
  R.check('S8c openapi x-websocket.actions 含 stop', wsActions.includes('stop'), wsActions);

  const enumList = (((oa.json || {}).paths || {})['/action'] || {}).post;
  const payloadSchema = enumList && enumList.requestBody && enumList.requestBody.content
    && enumList.requestBody.content['application/json'].schema;
  const actionEnum = (payloadSchema && payloadSchema.properties && payloadSchema.properties.action.enum) || [];
  R.check('S8d openapi /action requestBody enum 含 stop（第三处清单）', actionEnum.includes('stop'), actionEnum);

  const rates = (((caps.json || {}).tiers || {})['guest-pull'] || {}).actionRates || {};
  R.check('S8e 游客限频表已下发 stop:[1,2000]（免费断言点）',
    Array.isArray(rates.stop) && rates.stop[0] === 1 && rates.stop[1] === 2000, rates.stop);

  report.groups.discovery = { capsActions, wkActions, wsActions, actionEnum, stopRate: rates.stop };
}

// ==================== 主流程 ====================

(async () => {
  const started = Date.now();
  const report = { title: 'accept_agent_stop', startedAt: new Date().toISOString(), groups: {} };
  try {
    adminTok = await adminToken();
    const cfg = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + adminTok } });
    origEnabled = cfg.json && cfg.json.config && cfg.json.config.agentEnabled;
    // 注意：跑之前 agent_enabled 通常是 false（红线 6 的默认态）——这是**预期**，不是失败；
    // 脚本需要时自己打开，收尾恢复原值。判据只要求"配置可读"。
    R.check('P0 基线配置可读（agent_enabled 原值由收尾恢复）', origEnabled === true || origEnabled === false,
      { agentEnabled: origEnabled });
    if (origEnabled !== true) {
      await K.httpJson('/api/agent/v1/admin/config', {
        method: 'PUT', headers: { Authorization: 'Bearer ' + adminTok }, body: { agent_enabled: 'true' }
      });
      await sleep(500);
    }
    const cfg2 = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + adminTok } });
    R.check('P0b agent_enabled=true（联测期前置，必要时已自动开启）',
      cfg2.json && cfg2.json.config && cfg2.json.config.agentEnabled === true,
      { agentEnabled: cfg2.json && cfg2.json.config && cfg2.json.config.agentEnabled });

    const { agent, token } = await keyAgent();
    console.log(`[key] Agent=${agent.name} pushTier=${agent.pushTier}`);
    const conn = await openKey(token);
    await K.waitFor(conn.msgs, 'READY');
    R.check('P1 前置：Key Agent WS 已 READY', conn.ok === true, agent.name);

    await groupMoveStop(conn, token, report);
    await groupWalkToStop(conn, token, report);
    await groupFollowStop(conn, token, report);
    await groupIdempotent(conn, report);
    await groupGuestStop(report);
    await groupDiscovery(report);
  } catch (e) {
    report.fatal = e.stack || e.message;
    console.error('FATAL', e);
  } finally {
    K.closeAll(...openSockets);
    if (adminTok && origEnabled !== null) {
      try {
        await K.httpJson('/api/agent/v1/admin/config', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + adminTok },
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
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log('报告: ' + REPORT);
  process.exitCode = sum.fail === 0 ? 0 : 1;
})();
