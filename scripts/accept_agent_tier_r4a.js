/**
 * 三档 AI 联测 · 轮4a（三档同时 follow 同一真人，只测不改）
 *
 * 检测项：
 *   W 三档能否各自 follow 同一目标并收敛（服务端 10Hz 追击）
 *   X 三档 Agent 是否会完全重合（v2-5 多 Agent 无避让）
 *   Y follow 期间 Agent 与目标的实时距离曲线（是否跟丢/震荡）
 *   Z 目标停止后是否停在 stopDistance 内，并正确回 idle
 *
 * 依赖：scripts/_tmp_tier_agents.json
 * 运行：node scripts/accept_agent_tier_r4a.js
 * 报告：examples/agent-client/live/tier-r4a.json
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const K = require('./agentV2TestKit');

const R = K.createReporter('三档 follow 同一目标（轮4a）');
const sleep = K.sleep;
const ORDER = ['eco', 'standard', 'realtime'];
const AGENTS_FILE = path.join(__dirname, '_tmp_tier_agents.json');
const REPORT_DIR = path.join(__dirname, '..', 'examples', 'agent-client', 'live');

const store = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
const SPECS = ORDER.map(k => store.created.find(a => a.key === k)).filter(Boolean);
const issues = [];
const data = { curves: {} };
const sockets = [];

function humanMove(h, x, z) {
  K.wsSend(h.ws, {
    type: 'POSITION_UPDATE',
    payload: { characterId: h.characterId, position: { x, y: 0, z }, animMode: 'walk', rotation: 0 }
  });
}

async function observe(token) {
  const r = await K.httpJson('/api/agent/v1/observe?radius=200', { headers: { Authorization: 'Bearer ' + token } });
  return r.status === 200 ? r.json : null;
}

async function main() {
  // 目标真人（从原点沿 +x 走）
  const targetCid = uuidv4();
  const target = await K.openHumanWs({ characterId: targetCid, characterName: 'R4-目标真人', position: { x: 0, y: 0, z: 0 } });
  if (target.ok) sockets.push(target.ws);
  await sleep(800);

  // 三档 Agent：分散起点
  const starts = [{ x: -12, z: 0 }, { x: 12, z: 0 }, { x: 0, z: -12 }];
  const agents = {};
  for (let i = 0; i < SPECS.length; i++) {
    const spec = SPECS[i];
    const s = await K.httpJson('/api/agent/v1/session', { method: 'POST', headers: { Authorization: 'Bearer ' + spec.apiKey } });
    const token = s.json && s.json.token;
    const conn = await K.openAgentWs({ authHeader: 'Bearer ' + token });
    if (!conn.ok) { R.check(`[${spec.pushTier}] Agent 上线`, false, conn.statusCode || conn.error); continue; }
    sockets.push(conn.ws);
    await K.waitFor(conn.msgs, 'READY', 5000);
    K.wsSend(conn.ws, { type: 'ACTION', payload: { action: 'walk_to', requestId: uuidv4(), target: starts[i] } });
    agents[spec.pushTier] = { spec, token, conn, start: starts[i] };
  }
  await sleep(6000);
  R.info('三档 Agent 就位', Object.entries(agents).map(([t, a]) => `${t}@${JSON.stringify(a.start)}`).join(' '));

  // 三档同时 follow
  for (const t of ORDER) {
    if (!agents[t]) continue;
    const r = K.wsSend(agents[t].conn.ws, { type: 'ACTION', payload: { action: 'follow', requestId: uuidv4(), targetId: targetCid, stopDistance: 2 } });
    R.check(`[${t}] follow 指令下发`, r === true, r);
  }
  const acc = {};
  for (const t of ORDER) {
    if (!agents[t]) continue;
    const a = await K.waitFor(agents[t].conn.msgs, 'ACTION_ACCEPTED', 4000);
    acc[t] = !!(a && a.payload && a.payload.result);
    R.check(`[${t}] follow 被接受（ACTION_ACCEPTED）`, acc[t], a && a.payload && a.payload.result);
  }

  // 目标真人以 6 m/s 移动 20s（每 100ms 更新）
  let x = 0; const z = 0; const speed = 6; const dtMs = 100;
  const moveTimer = setInterval(() => { x += speed * (dtMs / 1000); humanMove(target, x, z); }, dtMs);

  // 采样：每档每 1.2s observe 一次（避免 1Hz 限频 429）
  const samples = ORDER.map(() => []);
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    for (const t of ORDER) {
      if (!agents[t]) continue;
      const o = await observe(agents[t].token);
      if (o && o.self && o.self.position) {
        const others = (o.entities || []).filter(e => e.type === 'agent' && e.id !== agents[t].spec.id);
        samples[ORDER.indexOf(t)].push({
          t: Date.now() - t0,
          self: o.self.position,
          distToTarget: Number((o.entities || []).filter(e => e.id === targetCid).map(e => e.distance)[0] || -1),
          otherAgentDists: others.map(e => Number((e.distance || 0).toFixed(2)))
        });
      }
      await sleep(400);
    }
  }
  clearInterval(moveTimer);

  // 目标停下，等 4s 观察是否停在 stopDistance 内
  const stopX = x; humanMove(target, stopX, z);
  await sleep(4000);
  const final = {};
  for (const t of ORDER) {
    if (!agents[t]) continue;
    const o = await observe(agents[t].token);
    if (!o) continue;
    const me = o.self ? o.self.position : null;
    const tgt = (o.entities || []).find(e => e.id === targetCid);
    const others = (o.entities || []).filter(e => e.type === 'agent' && e.id !== agents[t].spec.id);
    final[t] = {
      distToTarget: tgt ? Number((tgt.distance || 0).toFixed(2)) : -1,
      animMode: (o.entities || []).filter(e => e.id === agents[t].spec.id).map(e => e.animMode)[0] || o.self.animMode || null,
      distToOtherAgents: others.map(e => Number((e.distance || 0).toFixed(2))),
      self: me
    };
    const arr = samples[ORDER.indexOf(t)].map(s => s.distToTarget).filter(v => v >= 0);
    const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : -1;
    const maxD = arr.length ? Math.max(...arr) : -1;
    const last3 = arr.slice(-3);
    data.curves[t] = {
      samples: arr.length,
      avgDist: Number(avg.toFixed(2)), maxDist: Number(maxD.toFixed(2)),
      tailDists: last3.map(v => Number(v.toFixed(2))),
      finalDist: final[t].distToTarget,
      distToOtherAgents: final[t].distToOtherAgents,
      distSeries: arr.filter((_, i) => i % 3 === 0).map(v => Number(v.toFixed(2)))
    };
    R.info(`[${t}] W follow 统计`, { 采样: arr.length, 平均距离: avg.toFixed(2), 最远: maxD.toFixed(2), 末段: last3.map(v => v.toFixed(2)) });
    R.check(`[${t}] W follow 收敛（末段距离 ≤ 4m）`, last3.length > 0 && Math.max(...last3) <= 4, last3.map(v => v.toFixed(2)));
    R.check(`[${t}] Z 目标停止后停在 stopDistance 附近（≤3m）`, final[t].distToTarget >= 0 && final[t].distToTarget <= 3, final[t].distToTarget);
  }
  data.final = final;

  // X：三档 Agent 之间的最小距离（重合检测）
  const minPair = [];
  for (const t of ORDER) {
    if (!final[t]) continue;
    final[t].distToOtherAgents.forEach(d => minPair.push(d));
  }
  const minDist = minPair.length ? Math.min(...minPair) : -1;
  R.info('X 三档 Agent 之间的最小距离', `${minDist.toFixed(2)}m`);
  R.check('X 多 Agent 之间保持间距（>0.5m，不重合）', minDist > 0.5, minDist.toFixed(2));
  if (minDist <= 0.5) {
    issues.push({
      tier: 'all', level: 'P3', item: '多 Agent 同时 follow 同一目标时完全重合（无避让，v2-5 复现）',
      detail: `三档 Agent 停在目标周围时彼此最小距离 ${minDist.toFixed(2)}m；真人观感为"多个 AI 叠在一起"`,
      code: 'agentFollowService / agentMovementService 推进逻辑无 Agent 间避让（目标点相同即完全重叠）'
    });
  }

  finish();
}

function finish() {
  const sum = R.summary();
  console.log('\n===== follow 曲线（每档） =====');
  for (const t of ORDER) if (data.curves[t]) console.log(`[${t}]`, JSON.stringify(data.curves[t]));
  console.log('\n===== 疑似问题 =====');
  if (issues.length === 0) console.log('（无）');
  issues.forEach((it, i) => console.log(`${i + 1}. [${it.level}][${it.tier}] ${it.item}\n   证据：${it.detail}\n   代码：${it.code}`));
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'tier-r4a.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary: sum, data, issues }, null, 2));
    console.log('\n报告已写入', path.join(REPORT_DIR, 'tier-r4a.json'));
  } catch (e) { console.log('报告写入失败', e.message); }
  K.closeAll(...sockets);
  process.exitCode = sum.fail > 0 ? 1 : 0;
}

main();
