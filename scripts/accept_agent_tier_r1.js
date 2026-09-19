/**
 * 三档 AI 联测 · 轮1（隔离基线，只测不改）
 *
 * 目标：逐档单独上线（eco / standard / realtime），在"同一世界、同一批真人"条件下对比：
 *   A 未订阅时是否收到位置流（SUBSCRIBE 门控）
 *   B SUBSCRIBE 回执（topics/radius）
 *   C 半径门控：真人 150m 外移动是否仍被推送（订阅 radius=30）
 *   D CHAT 近距可达 / 远距不可达
 *   E Agent 动作：walk_to 到达回执 + 真人侧 POSITION_UPDATE 频率（10Hz?）
 *   F observe radius=200 + self 为实时位置
 *
 * 依赖：scripts/_tmp_tier_agents.json（先跑 _tmp_tier_setup.js）
 * 运行：node scripts/accept_agent_tier_r1.js
 * 报告：examples/agent-client/live/tier-r1.json
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const K = require('./agentV2TestKit');

const R = K.createReporter('三档隔离基线（轮1）');
const sleep = K.sleep;
const ORDER = ['eco', 'standard', 'realtime'];
const AGENTS_FILE = path.join(__dirname, '_tmp_tier_agents.json');
const REPORT_DIR = path.join(__dirname, '..', 'examples', 'agent-client', 'live');

const store = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
const SPECS = ORDER.map(k => store.created.find(a => a.key === k)).filter(Boolean);
const issues = [];
const data = {};
const sockets = [];

// ==================== 工具 ====================

function statsFrom(msgs, fromIdx) {
  const arr = msgs.slice(fromIdx);
  const byType = {}; const ids = new Set(); let bytes = 0;
  for (const m of arr) {
    byType[m.type] = (byType[m.type] || 0) + 1;
    try { bytes += JSON.stringify(m).length; } catch (e) {}
    const p = (m && m.payload) || {};
    if (p.id) ids.add(p.id);
    if (p.characterId) ids.add(p.characterId);
    if (Array.isArray(p.moves)) p.moves.forEach(x => x && x.id && ids.add(x.id));
  }
  return { byType, ids: [...ids], bytes, count: arr.length };
}

function startMoving(conn, baseX, baseZ, amp) {
  let i = 0;
  const t = setInterval(() => {
    i++;
    const x = baseX + (i % 2 === 0 ? (amp || 1) : -(amp || 1));
    K.wsSend(conn.ws, {
      type: 'POSITION_UPDATE',
      payload: { characterId: conn.characterId, position: { x, y: 0, z: baseZ }, animMode: 'walk', rotation: 0 }
    });
  }, 200);
  return () => clearInterval(t);
}

async function sessionFor(apiKey) {
  const r = await K.httpJson('/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }
  });
  return (r.json && r.json.token) || null;
}

function countFor(msgs, fromIdx, characterId) {
  return msgs.slice(fromIdx).filter(m => {
    const p = (m && m.payload) || {};
    if (p.id === characterId || p.characterId === characterId) return true;
    return Array.isArray(p.moves) && p.moves.some(x => x && x.id === characterId);
  }).length;
}

// ==================== 单档检测 ====================

async function runTier(spec) {
  const tag = spec.pushTier;
  const d = data[tag] = { pushTierDeclared: spec.pushTier };
  const token = await sessionFor(spec.apiKey);
  R.check(`[${tag}] /session 换票成功`, !!token, token ? 'ok' : 'no token');
  if (!token) return;

  // 近距真人（5m）与远距真人（150m）——先入场，再让 Agent 上线
  const nearChar = uuidv4(), farChar = uuidv4();
  const near = await K.openHumanWs({ characterId: nearChar, characterName: `真人-近-${tag}`, position: { x: 5, y: 0, z: 0 } });
  const far = await K.openHumanWs({ characterId: farChar, characterName: `真人-远-${tag}`, position: { x: 150, y: 0, z: 0 } });
  near.characterId = nearChar;
  far.characterId = farChar;
  if (near.ok) sockets.push(near.ws);
  if (far.ok) sockets.push(far.ws);
  await sleep(700);

  const conn = await K.openAgentWs({ authHeader: 'Bearer ' + token });
  R.check(`[${tag}] Agent WS 连接成功`, conn.ok === true, conn.ok ? 'upgraded' : (conn.statusCode || conn.error));
  if (!conn.ok) return;
  sockets.push(conn.ws);

  const ready = await K.waitFor(conn.msgs, 'READY', 5000);
  R.check(`[${tag}] READY.pushTier=${tag}`, ready && ready.payload.pushTier === tag,
    ready && ready.payload.pushTier);
  R.check(`[${tag}] 真人侧收到 Agent 入场 PLAYER_JOINED`, countFor(near.msgs, 0, spec.id) >= 0 && near.msgs.some(m => m.type === 'PLAYER_JOINED' && m.payload.characterId === spec.id),
    near.msgs.filter(m => m.type === 'PLAYER_JOINED').map(m => m.payload.characterName));

  // ---------- 阶段 A：未订阅 6s，两个真人都在动 ----------
  const stopNear = startMoving(near, 5, 0, 1);
  const stopFar = startMoving(far, 150, 0, 1);
  const idxA = conn.msgs.length;
  await sleep(6000);
  const A = statsFrom(conn.msgs, idxA);
  d.unsubscribed = A;
  R.info(`[${tag}] A 未订阅 6s 收到`, { 类型: A.byType, 实体数: A.ids.length, 字节: A.bytes });
  R.check(`[${tag}] A eco 档未订阅无任何推送（红线：eco 无位置流）`,
    tag !== 'eco' || A.count === 0, tag === 'eco' ? A.byType : '(非 eco，跳过断言)');
  if (tag !== 'eco' && A.count > 0) {
    issues.push({
      tier: tag, level: 'P2', item: 'SUBSCRIBE 门控缺失',
      detail: `未发送 SUBSCRIBE 即收到 ${A.count} 条推送（${JSON.stringify(A.byType)}）`,
      code: 'src/websocket/agentWsServer.js startPushLoop() 只判断 state.pushTier，未检查 subscription.topics（对比 forwardChatToAgents 有 topics.has(\'chat\') 门控）'
    });
  }

  // ---------- 阶段 B：SUBSCRIBE ----------
  K.wsSend(conn.ws, { type: 'SUBSCRIBE', payload: { topics: ['chat', 'movement', 'presence'], radius: 30 } });
  const sub = await K.waitFor(conn.msgs, 'SUBSCRIBED', 3000);
  R.check(`[${tag}] SUBSCRIBE 回执 radius=30`, !!sub && sub.payload.radius === 30, sub && sub.payload);

  // ---------- 阶段 C：仅 150m 外真人移动 6s（半径门控） ----------
  stopNear();
  const idxC = conn.msgs.length;
  await sleep(6000);
  const C = statsFrom(conn.msgs, idxC);
  const farHits = countFor(conn.msgs, idxC, farChar);
  d.farPushed = { count: farHits, byType: C.byType };
  R.info(`[${tag}] C 150m 外真人移动 6s：命中该实体消息数`, farHits);
  R.check(`[${tag}] C 订阅半径 30m 时不应收到 150m 外实体位置流`,
    tag === 'eco' ? farHits === 0 : farHits === 0, farHits === 0 ? 'ok' : `收到 ${farHits} 条`);
  if (tag !== 'eco' && farHits > 0) {
    issues.push({
      tier: tag, level: 'P2', item: '订阅半径未参与位置流过滤',
      detail: `SUBSCRIBE radius=30 但 150m 外实体位置更新仍被推送（${farHits} 条）`,
      code: 'agentWsServer.js startPushLoop() 未读取 state.subscription.radius（radius 仅在 SUBSCRIBED 回执里显示）'
    });
  }

  // ---------- 阶段 D：CHAT 近距 / 远距 ----------
  const idxD = conn.msgs.length;
  K.wsSend(near.ws, { type: 'CHAT', payload: { message: `近距-${tag}-${Date.now()}` } });
  K.wsSend(far.ws, { type: 'CHAT', payload: { message: `远距-${tag}-${Date.now()}` } });
  await sleep(1200);
  const chats = conn.msgs.slice(idxD).filter(m => m.type === 'CHAT').map(m => m.payload);
  d.chat = chats.map(c => ({ sender: c.sender, message: String(c.message).slice(0, 12) }));
  const gotNear = chats.some(c => String(c.message).startsWith('近距'));
  const gotFar = chats.some(c => String(c.message).startsWith('远距'));
  R.check(`[${tag}] D 30m 内真人 CHAT 可达 Agent`, gotNear, chats.length);
  R.check(`[${tag}] D 150m 外真人 CHAT 不可达（30m 投递口径）`, !gotFar, gotFar ? '意外收到远距消息' : 'ok');
  if (tag !== 'eco' && !gotNear) {
    issues.push({ tier: tag, level: 'P1', item: '近距 CHAT 未送达 Agent', detail: `订阅 chat 后仍收不到 30m 内真人消息`, code: 'agentWsServer.forwardChatToAgents / wsServer CHAT 分支' });
  }

  // ---------- 阶段 E：Agent 动作 + 真人侧观感 ----------
  const reqWalk = uuidv4();
  const idxE = near.msgs.length;
  const tE0 = Date.now();
  K.wsSend(conn.ws, { type: 'ACTION', payload: { action: 'walk_to', requestId: reqWalk, target: { x: 20, z: 0 } } });
  const acc = await K.waitFor(conn.msgs, 'ACTION_ACCEPTED', 4000);
  R.check(`[${tag}] E walk_to 被接受`, !!acc, acc && acc.payload);
  // 等到达回执（20m / 12m/s ≈ 1.7s）
  let comp = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    comp = conn.msgs.find(m => m.type === 'ACTION_COMPLETED' && m.payload && m.payload.requestId === reqWalk);
    if (comp) break;
    await sleep(100);
  }
  R.check(`[${tag}] E walk_to 到达回执 reason=arrived`, !!comp && comp.payload.reason === 'arrived', comp && comp.payload);
  if (comp && comp.payload.position) {
    const err = Math.hypot(comp.payload.position.x - 20, comp.payload.position.z - 0);
    R.check(`[${tag}] E 到达位置误差 <0.6m`, err < 0.6, err.toFixed(3));
  }
  const posUpdates = near.msgs.slice(idxE).filter(m => m.type === 'POSITION_UPDATE' && m.payload.characterId === spec.id);
  const dur = Date.now() - tE0;
  const hz = posUpdates.length / (dur / 1000);
  d.positionPush = { count: posUpdates.length, ms: dur, hz: Number(hz.toFixed(2)) };
  R.info(`[${tag}] E 真人侧 POSITION_UPDATE`, `${posUpdates.length} 条 / ${dur}ms = ${hz.toFixed(2)} Hz`);
  R.check(`[${tag}] E 真人侧位置广播频率 5~12Hz（服务端 10Hz 推进）`, hz >= 5 && hz <= 12, hz.toFixed(2));
  if (tag === 'realtime' && (hz < 5 || hz > 12)) {
    issues.push({ tier: tag, level: 'P3', item: 'Agent 位置广播频率异常', detail: `${hz.toFixed(2)} Hz（服务端 10Hz 推进）`, code: 'agentMovementService TICK_INTERVAL_MS=100' });
  }

  // say 投递（近距真人应收到）
  const reqSay = uuidv4();
  const idxSay = near.msgs.length;
  K.wsSend(conn.ws, { type: 'ACTION', payload: { action: 'say', requestId: reqSay, text: `你好-${tag}-${Date.now()}` } });
  await sleep(1200);
  const sayToNear = near.msgs.slice(idxSay).filter(m => m.type === 'CHAT').map(m => m.payload);
  d.say = sayToNear.map(c => ({ sender: c.sender, characterId: c.characterId }));
  R.check(`[${tag}] E say 投递到 30m 内真人（senderId≡agent.id）`,
    sayToNear.length > 0 && sayToNear.some(c => c.characterId === spec.id), sayToNear.length);

  // ---------- 阶段 F：observe ----------
  const obs = await K.httpJson('/api/agent/v1/observe?radius=200', { headers: { Authorization: 'Bearer ' + token } });
  d.observe = obs.json ? { radius: obs.json.radius, self: obs.json.self && obs.json.self.position, entities: (obs.json.entities || []).length } : null;
  R.check(`[${tag}] F observe radius=200 不被钳`, obs.status === 200 && obs.json.radius === 200, { status: obs.status, radius: obs.json && obs.json.radius });
  const selfPos = obs.json && obs.json.self && obs.json.self.position;
  const selfErr = selfPos ? Math.hypot((selfPos.x || 0) - 20, selfPos.z || 0) : 999;
  R.check(`[${tag}] F observe.self 为实时位置（≈20,0）`, selfErr < 2, selfPos);

  stopNear(); stopFar();
  try { conn.ws.close(); } catch (e) {}
  try { near.ws.close(); } catch (e) {}
  try { far.ws.close(); } catch (e) {}
  await sleep(1200);
}

// ==================== 主流程 ====================

async function main() {
  R.info('基线配置', JSON.stringify(store.baseline));
  for (const spec of SPECS) {
    console.log(`\n---------- 档位 ${spec.pushTier} (${spec.name}) ----------`);
    await runTier(spec);
  }
  const sum = R.summary();
  console.log('\n===== 数据对比 =====');
  for (const tag of ORDER) {
    const d = data[tag];
    if (!d) continue;
    console.log(`[${tag}] 未订阅6s=${JSON.stringify(d.unsubscribed && d.unsubscribed.byType)} | 150m外推送=${d.farPushed && d.farPushed.count} | 位置广播=${d.positionPush && d.positionPush.hz}Hz | say投递=${(d.say || []).length} | CHAT=${JSON.stringify(d.chat)}`);
  }
  console.log('\n===== 疑似问题 =====');
  if (issues.length === 0) console.log('（无）');
  issues.forEach((it, i) => console.log(`${i + 1}. [${it.level}][${it.tier}] ${it.item}：${it.detail}\n   → ${it.code}`));

  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'tier-r1.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), summary: sum, data, issues }, null, 2));
    console.log('\n报告已写入', path.join(REPORT_DIR, 'tier-r1.json'));
  } catch (e) { console.log('报告写入失败', e.message); }

  K.closeAll(...sockets);
  process.exitCode = sum.fail > 0 ? 1 : 0;
}

main();
