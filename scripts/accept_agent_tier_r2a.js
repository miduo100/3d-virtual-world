/**
 * 三档 AI 联测 · 轮2a（三档同场 + 多真人，只测不改）
 *
 * 检测项：
 *   G 三档同场推送量化（类型/条数/字节/节奏间隔）
 *   H 150m 外实体是否仍被推送（半径门控复现）
 *   I 真人晚于 Agent 上线时是否收到 ENTITY_ADDED（协议语义）
 *   J Agent 互见（observe.entities 是否含其他 Agent，type=agent）
 *   K Agent 互聊（30m 内 say → 其他 Agent 是否收到 CHAT）
 *   L 感知盲区：真人原地跳跃（仅 y/animMode 变）与原地转向（仅 rotation 变）是否被推送
 *   N 令牌桶丢包：25 个实体同时移动时 realtime 档每实体接收条数分布
 *
 * 依赖：scripts/_tmp_tier_agents.json
 * 运行：node scripts/accept_agent_tier_r2a.js
 * 报告：examples/agent-client/live/tier-r2a.json
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const K = require('./agentV2TestKit');

const R = K.createReporter('三档同场 · 多真人（轮2a）');
const sleep = K.sleep;
const ORDER = ['eco', 'standard', 'realtime'];
const AGENTS_FILE = path.join(__dirname, '_tmp_tier_agents.json');
const REPORT_DIR = path.join(__dirname, '..', 'examples', 'agent-client', 'live');

const store = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
const SPECS = ORDER.map(k => store.created.find(a => a.key === k)).filter(Boolean);
const issues = [];
const data = { agents: {}, phases: {} };
const sockets = [];

const gAgents = {};   // tier -> { spec, token, conn }
const humans = {};    // role -> { ws, characterId, name, baseX }

function humanSend(h, x, y, z, animMode, rotation) {
  K.wsSend(h.ws, {
    type: 'POSITION_UPDATE',
    payload: { characterId: h.characterId, position: { x, y, z }, animMode: animMode || 'walk', rotation: rotation === undefined ? 0 : rotation }
  });
}

function startMoving(h, amp, periodMs) {
  let i = 0;
  const t = setInterval(() => {
    i++;
    const off = (i % 2 === 0 ? amp : -amp);
    humanSend(h, h.baseX + off, 0, h.baseZ + off * 0.5, 'walk', 0);
  }, periodMs || 200);
  return () => clearInterval(t);
}

function stats(msgs, fromIdx) {
  const arr = msgs.slice(fromIdx);
  const byType = {}; const perEntity = new Map(); const stamps = []; let bytes = 0;
  for (const m of arr) {
    byType[m.type] = (byType[m.type] || 0) + 1;
    try { bytes += JSON.stringify(m).length; } catch (e) {}
    stamps.push(Date.now());
    const p = (m && m.payload) || {};
    const items = Array.isArray(p.moves) ? p.moves : (p.id ? [p] : []);
    items.forEach(x => { if (x && x.id) perEntity.set(x.id, (perEntity.get(x.id) || 0) + 1); });
  }
  return { count: arr.length, byType, bytes, perEntity, stamps };
}

async function main() {
  // ---------- 连接三档 Agent ----------
  for (const spec of SPECS) {
    const s = await K.httpJson('/api/agent/v1/session', { method: 'POST', headers: { Authorization: 'Bearer ' + spec.apiKey } });
    const token = s.json && s.json.token;
    const conn = await K.openAgentWs({ authHeader: 'Bearer ' + token });
    if (!conn.ok) { R.check(`[${spec.pushTier}] Agent 连接成功`, false, conn.statusCode || conn.error); continue; }
    sockets.push(conn.ws);
    const ready = await K.waitFor(conn.msgs, 'READY', 5000);
    K.wsSend(conn.ws, { type: 'SUBSCRIBE', payload: { topics: ['chat', 'movement', 'presence'], radius: 30 } });
    await K.waitFor(conn.msgs, 'SUBSCRIBED', 3000);
    gAgents[spec.pushTier] = { spec, token, conn };
    R.check(`[${spec.pushTier}] 三档同场就绪（READY.pushTier 一致）`, !!ready && ready.payload.pushTier === spec.pushTier, ready && ready.payload.pushTier);
  }
  if (Object.keys(gAgents).length !== 3) { console.log('三档未全部就绪，终止'); return finish(); }

  // ---------- 真人：3 近（5m）+ 2 远（150m） ----------
  const defs = [
    { role: 'n1', x: 5, z: 0 }, { role: 'n2', x: 7, z: 3 }, { role: 'n3', x: 4, z: -4 },
    { role: 'f1', x: 150, z: 0 }, { role: 'f2', x: -150, z: 40 }
  ];
  for (const d of defs) {
    const cid = uuidv4();
    const h = await K.openHumanWs({ characterId: cid, characterName: `R2-${d.role}`, position: { x: d.x, y: 0, z: d.z } });
    if (!h.ok) continue;
    sockets.push(h.ws);
    humans[d.role] = { ws: h.ws, msgs: h.msgs, characterId: cid, name: `R2-${d.role}`, baseX: d.x, baseZ: d.z, near: d.role[0] === 'n' };
  }
  await sleep(1500);
  R.info('真人场景就绪', `${Object.keys(humans).length} 个模拟真人（3 近 5m / 2 远 150m）`);

  // ---------- G：全部真人移动 15s，量化三档 ----------
  // 源频率 100ms（10Hz）—— 与"真人客户端每帧上报"的真实场景同量级（前端 broadcastPosition 每帧发），
  // 只有源 ≥10Hz 才能验证 realtime 档的 10Hz 上限（原用 200ms=5Hz 源，测不出档位差异）。
  const stops = Object.values(humans).map(h => startMoving(h, 1.5, 100));
  const idxG = {}; ORDER.forEach(t => idxG[t] = gAgents[t].conn.msgs.length);
  const tG0 = Date.now();
  await sleep(15000);
  const G = {};
  for (const t of ORDER) {
    const st = stats(gAgents[t].conn.msgs, idxG[t]);
    const gaps = [];
    for (let i = 1; i < st.stamps.length; i++) gaps.push(st.stamps[i] - st.stamps[i - 1]);
    const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
    G[t] = { count: st.count, byType: st.byType, bytes: st.bytes, entityCount: st.perEntity.size, avgGapMs: avgGap, perEntity: [...st.perEntity.entries()].length };
    R.info(`[${t}] G 15s 推送`, { 条数: st.count, 类型: st.byType, 字节: st.bytes, 实体数: st.perEntity.size, 平均间隔ms: avgGap });
    const bps = Math.round(st.bytes / 15);
    R.info(`[${t}] G 带宽`, `${bps} B/s（≈${(bps * 8 / 1000).toFixed(1)} kbps）`);
  }
  data.phases.G = G;

  // 档位差异断言
  R.check('[eco] G 无位置流（仅 CHAT 可能）', (G.eco.byType.ENTITY_UPDATED || 0) === 0 && (G.eco.byType.ENTITY_MOVEMENT_BATCH || 0) === 0, G.eco.byType);
  // T5 判据（2026-09-19 修复后改写）：realtime 档位速率必须显著高于 standard，且接近 10Hz 上限。
  // 修复前 realtime 与 standard 同为 1s tick（信息量等价，只是消息形态不同）。
  const rtPerSecPerEntity = G.realtime.entityCount > 0 ? G.realtime.count / 15 / G.realtime.entityCount : 0;
  G.realtime.ratePerEntityHz = Number(rtPerSecPerEntity.toFixed(2));
  R.info('[realtime vs standard] 消息条数比', `${G.realtime.count} : ${G.standard.count}`);
  R.info('[realtime] 档位速率', `${rtPerSecPerEntity.toFixed(2)} Hz/实体（源 10Hz）`);
  R.check('[realtime] 档位速率 ≥8Hz/实体（T5：真 10Hz 采样）', rtPerSecPerEntity >= 8,
    `${rtPerSecPerEntity.toFixed(2)} Hz（${G.realtime.count} 条 / 15s / ${G.realtime.entityCount} 实体）`);
  if (rtPerSecPerEntity < 8) {
    issues.push({
      tier: 'realtime', level: 'P2', item: 'realtime 档位速率不足 8Hz/实体（与 standard 信息量等价）',
      detail: `源以 10Hz 上报，realtime 实测 ${rtPerSecPerEntity.toFixed(2)} Hz/实体（${G.realtime.count} 条 / 15s / ${G.realtime.entityCount} 实体），standard ${G.standard.count} 条 batch`,
      code: 'agentWsServer.js startRealtimeLoop()（应每 100ms 采样一次、每实体每轮最多 1 条）'
    });
  }

  // ---------- H：150m 外实体覆盖 ----------
  const farIds = ['f1', 'f2'].map(r => humans[r] && humans[r].characterId).filter(Boolean);
  const H = {};
  for (const t of ORDER) {
    const ids = [...(gAgents[t].conn.msgs.slice(idxG[t]).map(m => {
      const p = (m && m.payload) || {};
      const its = Array.isArray(p.moves) ? p.moves : (p.id ? [p] : []);
      return its.map(x => x && x.id);
    }).flat())].filter(Boolean);
    const hitFar = farIds.filter(id => ids.includes(id)).length;
    H[t] = hitFar;
    R.info(`[${t}] H 150m 外真人被推送的实体数`, `${hitFar}/${farIds.length}`);
  }
  data.phases.H = H;
  if ((H.standard || 0) > 0 || (H.realtime || 0) > 0) {
    issues.push({
      tier: 'standard/realtime', level: 'P2', item: '订阅半径未过滤位置流（复现轮1）',
      detail: `SUBSCRIBE radius=30，但 150m 外真人仍被推送：standard 命中 ${H.standard}/2、realtime 命中 ${H.realtime}/2`,
      code: 'agentWsServer.js startPushLoop() 全程未读取 state.subscription.radius'
    });
  }

  // ---------- I：真人晚入场是否 ENTITY_ADDED ----------
  const lateCid = uuidv4();
  const late = await K.openHumanWs({ characterId: lateCid, characterName: 'R2-late', position: { x: 8, y: 0, z: 8 } });
  if (late.ok) { sockets.push(late.ws); humans.late = { ws: late.ws, msgs: late.msgs, characterId: lateCid, name: 'R2-late', baseX: 8, baseZ: 8, near: true }; }
  const idxI = {}; ORDER.forEach(t => idxI[t] = gAgents[t].conn.msgs.length);
  await sleep(3500);
  const I = {};
  for (const t of ORDER) {
    const arr = gAgents[t].conn.msgs.slice(idxI[t]);
    I[t] = {
      added: arr.filter(m => m.type === 'ENTITY_ADDED').length,
      types: arr.reduce((a, m) => { a[m.type] = (a[m.type] || 0) + 1; return a; }, {}),
      gotLate: arr.some(m => JSON.stringify(m.payload || {}).includes(lateCid))
    };
    R.info(`[${t}] I 真人晚入场 3.5s`, I[t]);
  }
  data.phases.I = I;
  R.check('[standard] I 新入场实体被感知（ADDED 或位置流任一）', I.standard.gotLate === true, I.standard);
  R.check('[realtime] I 新入场实体被感知', I.realtime.gotLate === true, I.realtime);
  if (I.standard.added === 0 && I.realtime.gotLate === true) {
    issues.push({
      tier: 'standard/realtime', level: 'P3', item: 'ENTITY_ADDED 实际不触发（新实体首次只以位置流到达）',
      detail: `真人上线 3.5s：ENTITY_ADDED=${I.standard.added}（standard）/${I.realtime.added}（realtime），但位置流已含该实体 → 客户端不能用 ADDED 作为"实体出现"的唯一信号`,
      code: 'startPushLoop() 中 ADDED 仅在"实体存在于 playerPositions 但不在 snap"时触发，而新实体总是先进入 batch 并写入 snap'
    });
  }

  // ---------- J：Agent 互见 ----------
  const J = {};
  for (const t of ORDER) {
    const obs = await K.httpJson('/api/agent/v1/observe?radius=200', { headers: { Authorization: 'Bearer ' + gAgents[t].token } });
    const ents = (obs.json && obs.json.entities) || [];
    const agentsSeen = ents.filter(e => e.type === 'agent').map(e => e.id);
    const otherAgents = ORDER.filter(x => x !== t).map(x => gAgents[x].spec.id);
    J[t] = { entities: ents.length, agentEntities: agentsSeen.length, seesOthers: otherAgents.filter(id => agentsSeen.includes(id)).length };
    R.info(`[${t}] J observe 结果`, J[t]);
  }
  data.phases.J = J;
  R.check('[realtime] J Agent 能通过 observe 看到另外两个 Agent', J.realtime.seesOthers === 2, J.realtime);

  // ---------- K：Agent 互聊 ----------
  // 先把三档 Agent 聚到同一位置附近（walk_to 同一目标），再让 eco 说话
  for (const t of ORDER) {
    K.wsSend(gAgents[t].conn.ws, { type: 'ACTION', payload: { action: 'walk_to', requestId: uuidv4(), target: { x: 10, z: 10 } } });
  }
  await sleep(3500);
  const idxK = {}; ORDER.forEach(t => idxK[t] = gAgents[t].conn.msgs.length);
  const text = `广播-${Date.now()}`;
  K.wsSend(gAgents.eco.conn.ws, { type: 'ACTION', payload: { action: 'say', requestId: uuidv4(), text } });
  await sleep(1800);
  const K2 = {};
  for (const t of ORDER) {
    const got = gAgents[t].conn.msgs.slice(idxK[t]).filter(m => m.type === 'CHAT').map(m => ({ sender: m.payload.sender, msg: String(m.payload.message).slice(0, 10) }));
    K2[t] = got;
    R.info(`[${t}] K 收到 CHAT 数`, got.length);
  }
  data.phases.K = K2;
  R.check('[standard] K Agent 互相收到 say（30m 内）', K2.standard.some(c => c.msg.startsWith('广播')), K2.standard);
  R.check('[realtime] K Agent 互相收到 say', K2.realtime.some(c => c.msg.startsWith('广播')), K2.realtime);

  // ---------- L：感知盲区（仅 y / 仅 rotation 变化） ----------
  stops.forEach(fn => fn());
  const n1 = humans.n1;
  // 先归位到固定 x/z 并等 snap 收敛，避免 L 阶段第一次发送被算成"水平移动"
  humanSend(n1, n1.baseX + 1, 0, n1.baseZ, 'idle', 0);
  await sleep(2500);   // 静止，让各档 snap 收敛
  const idxL = {}; ORDER.forEach(t => idxL[t] = gAgents[t].conn.msgs.length);
  for (let i = 0; i < 15; i++) {
    humanSend(n1, n1.baseX + 1, 1.5, n1.baseZ, 'jump', 0);     // 仅 y 与 animMode 变
    await sleep(200);
    humanSend(n1, n1.baseX + 1, 0, n1.baseZ, 'idle', 0);
    await sleep(200);
  }
  for (let i = 0; i < 12; i++) { humanSend(n1, n1.baseX + 1, 0, n1.baseZ, 'idle', i * 0.5); await sleep(200); }  // 仅 rotation 变
  const L = {};
  for (const t of ORDER) {
    const arr = gAgents[t].conn.msgs.slice(idxL[t]);
    const hit = arr.filter(m => {
      const p = (m && m.payload) || {};
      const its = Array.isArray(p.moves) ? p.moves : (p.id ? [p] : []);
      return its.some(x => x && x.id === n1.characterId);
    }).length;
    L[t] = hit;
    R.info(`[${t}] L 原地跳跃/转向期收到该实体更新数`, hit);
  }
  data.phases.L = L;
  R.check('[standard] L 原地跳跃与转向不产生位置流（T7 已决策：仅 x/z 变化才推）',
    (L.standard || 0) === 0, L.standard);
  if ((L.standard || 0) === 0) {
    // 2026-09-19 用户明确决策：**不需要** AI 感知真人的跳跃与转向 → 本条不作为缺陷记录，
    // 仅保留一行 INFO 说明口径（原 issues.push 已移除，避免报告里长期挂着"已接受"的项）。
    R.info('L 感知盲区口径', '仅 x/z 变化触发位置流；y/animMode/rotation 变化不推 —— 用户已决策接受（T7）');
  }

  // ---------- N：推送覆盖公平性（25 实体同时移动） ----------
  // 注意（2026-09-19 半径过滤 T4 生效后）：实体必须落在订阅半径（30m）内，否则本场景一个都推不到
  // （原坐标为 x=20+i*1.5 / z=60，距 K 阶段把三档 Agent 聚集到的 (10,10) 有 50m+ → 全被过滤）。
  // 现在把 25 个实体铺在 (10,20) 附近（距 Agent ≈10m）。
  const crowd = [];
  for (let i = 0; i < 25; i++) {
    const cid = uuidv4();
    const x = 10 + (i % 10) * 1.2;
    const z = 20 + Math.floor(i / 10) * 1.2;
    const h = await K.openHumanWs({ characterId: cid, characterName: `crowd${i}`, position: { x, y: 0, z } });
    if (!h.ok) continue;
    const rec = { ws: h.ws, msgs: h.msgs, characterId: cid, name: `crowd${i}`, baseX: x, baseZ: z, near: true };
    crowd.push(rec); humans[`crowd${i}`] = rec;
    sockets.push(h.ws);
  }
  await sleep(2000);
  const crowdStops = crowd.map(h => startMoving(h, 1.2, 200));
  const idxN = { standard: gAgents.standard.conn.msgs.length, realtime: gAgents.realtime.conn.msgs.length };
  await sleep(10000);
  const N = {};
  for (const t of ['standard', 'realtime']) {
    const arr = gAgents[t].conn.msgs.slice(idxN[t]);
    const per = new Map();
    arr.forEach(m => {
      const p = (m && m.payload) || {};
      const its = Array.isArray(p.moves) ? p.moves : (p.id ? [p] : []);
      its.forEach(x => { if (x && x.id) per.set(x.id, (per.get(x.id) || 0) + 1); });
    });
    const cover = crowd.filter(h => per.has(h.characterId)).length;
    const counts = [...per.values()].sort((a, b) => a - b);
    N[t] = {
      messages: arr.length, entitiesCovered: cover, crowdSize: crowd.length,
      perEntityMin: counts[0] || 0, perEntityMax: counts[counts.length - 1] || 0,
      perEntityAvg: counts.length ? Number((counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(2)) : 0
    };
    R.info(`[${t}] N 25 实体同时移动 10s`, N[t]);
  }
  data.phases.N = N;
  R.check('[realtime] N 25 实体全部被至少推送一次', N.realtime.entitiesCovered === crowd.length,
    `${N.realtime.entitiesCovered}/${crowd.length}`);
  if (N.realtime.entitiesCovered < crowd.length || N.realtime.perEntityMin < N.realtime.perEntityMax * 0.4) {
    issues.push({
      tier: 'realtime', level: 'P2', item: 'realtime 档实体覆盖不均衡（部分实体收不到位置更新）',
      detail: `25 实体同时移动 10s：覆盖 ${N.realtime.entitiesCovered}/${crowd.length}，单实体条数 ${N.realtime.perEntityMin}~${N.realtime.perEntityMax}（平均 ${N.realtime.perEntityAvg}），standard 侧同一场景 ${N.standard.messages} 条 batch 覆盖 ${N.standard.entitiesCovered}`,
      code: 'agentWsServer.js startRealtimeLoop()：位置流按"每实体每轮最多 1 条"下发且不消耗令牌桶（T6 修复后仍不均衡 → 查半径/订阅门控或 loop 抛错）'
    });
  }
  crowdStops.forEach(fn => fn());

  finish();
}

function finish() {
  const sum = R.summary();
  console.log('\n===== 疑似问题 =====');
  if (issues.length === 0) console.log('（无）');
  issues.forEach((it, i) => console.log(`${i + 1}. [${it.level}][${it.tier}] ${it.item}\n   证据：${it.detail}\n   代码：${it.code}`));
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'tier-r2a.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary: sum, data, issues }, null, 2));
    console.log('\n报告已写入', path.join(REPORT_DIR, 'tier-r2a.json'));
  } catch (e) { console.log('报告写入失败', e.message); }
  K.closeAll(...sockets);
  process.exitCode = sum.fail > 0 ? 1 : 0;
}

main();
