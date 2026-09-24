/**
 * audit_ai_visitor.js —— AI 访客视角体检工具（打任意世界，默认本机）
 *
 * 与 accept_agent_*.js 的区别：**不设通过/失败**，只输出"AI 进来会看到什么"的客观指标，
 * 用来找优化空间（响应体积、字段覆盖、文档漂移、限频、回执信息量、错误文案）。
 * 因为不写死阈值，它不会随产品演进而腐烂。
 *
 * 用法：
 *   node scripts/audit_ai_visitor.js                                  # 打本机 3002
 *   AGENT_TEST_BASE=https://miduo100.com node scripts/audit_ai_visitor.js
 *   AUDIT_IP=203.0.113.77（可选）—— 用非回环测试 IP 签票，不烧本机额度
 *
 * 只读为主：会签 1 张游客票、连 1 条 WS、发几次动作（rotate/move/stop/无效动作）用于看回执，
 * 不发 say（避免往真实世界写聊天记录）。
 */
const kit = require('./agentV2TestKit');
const { httpJson, guestTicket, openAgentWs, wsSend, sleep } = kit;

const BASE = kit.BASE;
const IP = process.env.AUDIT_IP || '203.0.113.126';
const bytes = (o) => Buffer.byteLength(typeof o === 'string' ? o : JSON.stringify(o), 'utf8');
const log = (s) => console.log(s);
const sec = (t) => console.log('\n===== ' + t + ' =====');
const rawText = async (p) => {
  const r = await fetch(BASE + p, { redirect: 'follow' });
  const t = await r.text();
  return { status: r.status, text: t, bytes: Buffer.byteLength(t, 'utf8') };
};
const waitReq = async (msgs, requestId, timeoutMs = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find((m) => m && /^ACTION_/.test(m.type) && m.payload && m.payload.requestId === requestId);
    if (hit) return hit;
    await sleep(80);
  }
  return null;
};

(async () => {
  log(`目标: ${BASE}`);

  // ==================== 1. 发现层（无凭证） ====================
  sec('1. 发现层');
  const wk = await httpJson('/.well-known/virtual-world-agent.json');
  const cap = await httpJson('/api/agent/v1/capabilities');
  const oa = await httpJson('/api/agent/v1/openapi.json');
  const wkB = wk.json || {}, capB = cap.json || {}, oaB = oa.json || {};
  log(`well-known ${wk.status} ${bytes(wkB)}B enabled=${wkB.agentEnabled} world=${wkB.world && wkB.world.name}(${wkB.world && wkB.world.id})`);
  log(`  endpoints apiBase=${wkB.endpoints && wkB.endpoints.apiBase} ws=${wkB.endpoints && wkB.endpoints.websocket}`);
  log(`  auth TTL: agent=${wkB.auth && wkB.auth.sessionTtlSeconds}s guest=${wkB.auth && wkB.auth.guestSessionTtlSeconds}s`);
  log(`capabilities ${cap.status} ${bytes(capB)}B actions=${(capB.actions || []).join('/')}`);
  log(`  guest 档: radius=${(capB.tiers || {})['guest-pull'] && capB.tiers['guest-pull'].observeMaxRadius} pushAllowed=${(capB.tiers || {})['guest-pull'] && capB.tiers['guest-pull'].pushAllowed}`);
  const xwsActions = (oaB['x-websocket'] || {}).actions || [];
  log(`openapi ${oa.status} paths=${Object.keys(oaB.paths || {}).length} ws动作与 capabilities 一致=${JSON.stringify(xwsActions) === JSON.stringify(capB.actions)}`);
  const obsDesc = String((oaB.paths || {})['/observe'] && oaB.paths['/observe'].get.description || '');
  log(`  /observe 描述: distance3D=${/distance3D/.test(obsDesc)} plane=${/plane/i.test(obsDesc)}`);
  log(`  /action 描述: recipients=${/recipients/.test(obsDesc) || /recipients/.test(String((oaB.paths || {})['/action'] && oaB.paths['/action'].post.description || ''))}`);

  // 门面文档漂移（原始文本）
  for (const p of ['/llms.txt', '/agents/']) {
    const r = await rawText(p);
    log(`${p} ${r.status} ${r.bytes}B | 提到 distance3D=${/distance3D/.test(r.text)} recipients=${/recipients/.test(r.text)} 水平距离=${/水平距离|horizontal/i.test(r.text)}`);
  }

  if (!capB.agentEnabled) { log('!! agent_enabled=false，入场部分无法进行'); return finish(); }

  // ==================== 2. 入场 ====================
  sec('2. 入场（游客档）');
  const t = await guestTicket(IP);
  log(`guest/session ${t.status} tier=${t.ticket && t.ticket.tier} expiresIn=${t.ticket && t.ticket.expiresIn}s`);
  if (!t.ticket) { log('!! 签票失败: ' + JSON.stringify(t.json)); return finish(); }
  const auth = { Authorization: 'Bearer ' + t.ticket.token };
  const conn = await openAgentWs({ token: t.ticket.token, ip: IP });
  log(`WS ok=${conn.ok}${conn.ok ? '' : ' statusCode=' + conn.statusCode}`);
  if (!conn.ok) return finish();
  await sleep(2500);
  const ready = conn.msgs.find((m) => m.type === 'READY');
  log(`READY: ${JSON.stringify(ready && ready.payload).slice(0, 300)}`);
  const snap = conn.msgs.find((m) => m.type === 'WORLD_SNAPSHOT');
  const snapEnt = (snap && snap.payload && snap.payload.entities) || [];
  log(`WORLD_SNAPSHOT: ${snapEnt.length} 实体 bytes=${snap ? bytes(snap) : 0} 字段=${snapEnt[0] ? Object.keys(snapEnt[0]).join(',') : '-'}`);
  wsSend(conn.ws, { type: 'SUBSCRIBE', payload: { topics: ['chat'] } });
  await sleep(1200);
  const subErr = conn.msgs.find((m) => m.type === 'ERROR');
  log(`SUBSCRIBE: ${JSON.stringify(subErr && subErr.payload).slice(0, 120)}`);
  wsSend(conn.ws, { type: 'PING', payload: {} });
  await sleep(1000);
  log(`PING → ${conn.msgs.some((m) => m.type === 'PONG') ? 'PONG ✓' : '无响应 ✗'}`);

  // ==================== 3. 感知：体积与字段 ====================
  sec('3. 感知（observe / chat.history）');
  await sleep(2300);
  const o1 = await httpJson('/api/agent/v1/observe?radius=200', { headers: auth });
  const b1 = o1.json || {};
  log(`observe?radius=200 → ${o1.status} ${bytes(b1)}B radius回填=${b1.radius}（游客钳到 30）`);
  log(`  self y=${b1.self && b1.self.position.y} plane标记=${b1.self && b1.self.positionIsServerPlane} 字段=${b1.self ? Object.keys(b1.self).join(',') : '-'}`);
  const all = [...(b1.entities || []), ...(b1.objects || []), ...(b1.portals || [])];
  log(`  entities=${(b1.entities || []).length} objects=${(b1.objects || []).length} portals=${(b1.portals || []).length}`);
  log(`  字段覆盖: distance=${all.filter((x) => Number.isFinite(x.distance)).length}/${all.length} distance3D=${all.filter((x) => Number.isFinite(x.distance3D)).length}/${all.length}`);
  log(`  物体描述覆盖 ${(b1.objects || []).filter((o) => o.description).length}/${(b1.objects || []).length}；无描述: ${(b1.objects || []).filter((o) => !o.description).map((o) => o.id + ':' + o.name).join(' | ') || '无'}`);
  const moji = all.filter((x) => /[ÃÂåæçèé]/.test(String(x.name) + String(x.description || '')));
  log(`  乱码名/描述: ${moji.length ? moji.map((m) => `${m.id}:${m.name}`).join(' | ') : '无'}`);
  log(`  传送门: ${(b1.portals || []).map((p) => `${p.name}${p.description ? '✓' : '✗无描述'}`).join(', ') || '无'}`);
  log(`  附近真人: ${(b1.entities || []).filter((e) => e.type === 'human').map((h) => `${h.name} 水平=${h.distance} 空间=${h.distance3D}`).join(', ') || '无'}`);
  log(`  distanceSemantics=${String(b1.distanceSemantics).slice(0, 100)}`);

  const probes = [['radius=30（默认 limit）', '/api/agent/v1/observe?radius=30'],
    ['radius=30&limit=5', '/api/agent/v1/observe?radius=30&limit=5'],
    ['radius=30&include=uploaded_model', '/api/agent/v1/observe?radius=30&include=uploaded_model']];
  for (const [label, url] of probes) {
    await sleep(2300);
    const r = await httpJson(url, { headers: auth });
    log(`  ${label}: ${r.status} ${bytes(r.json)}B objects=${((r.json || {}).objects || []).length}`);
  }

  await sleep(2300);
  const ch = await httpJson('/api/agent/v1/chat/history?limit=5', { headers: auth });
  const h = (ch.json || {}).history || [];
  log(`chat/history ${ch.status} ${bytes(ch.json)}B 条数=${h.length} 顺序=${h.length > 1 && new Date(h[0].createdAt) > new Date(h[h.length - 1].createdAt) ? '最新在前(需客户端 reverse)' : '时间升序'} 字段=${h[0] ? Object.keys(h[0]).join(',') : '-'}`);

  // ==================== 4. 动作回执信息量 ====================
  sec('4. 动作回执与错误文案');
  const act = async (label, payload) => {
    wsSend(conn.ws, { type: 'ACTION', payload: { ...payload, requestId: 'au-' + label } });
    const ack = await waitReq(conn.msgs, 'au-' + label);
    const p = ack && ack.payload;
    log(`${label.padEnd(14)} ${ack ? ack.type.replace('ACTION_', '') : '超时'} ${JSON.stringify((p && p.result) || { code: p && p.code, reason: p && p.reason }).slice(0, 130)}`);
    await sleep(2300);
    return ack;
  };
  await act('rotate', { action: 'rotate', yaw: 0.5 });
  await act('jump', { action: 'jump' });
  await act('move', { action: 'move', direction: { x: 1, z: 0 } });
  await sleep(1500);
  await act('stop', { action: 'stop' });
  await act('walk_to', { action: 'walk_to', target: { x: (b1.self && b1.self.position.x || 0) + 6, z: b1.self.position.z || 0 } });
  await act('unknown_action', { action: 'fly' });
  await act('teleport', { action: 'teleport' });

  // ==================== 5. 观察点覆盖（游客能力边界） ====================
  sec('5. 观察点覆盖 x/y/z');
  await sleep(2300);
  const o5 = await httpJson('/api/agent/v1/observe?radius=30&x=200&z=-300&y=0', { headers: auth });
  log(`指定 x=200&z=-300 → ${o5.status} self=${JSON.stringify((o5.json || {}).self && o5.json.self.position)} objects=${((o5.json || {}).objects || []).length}`);
  log('  → 游客可把 30m 视野挪到地图任意点（是否允许属产品决策）');

  try { conn.ws.close(); } catch (e) { /* ignore */ }
  return finish();

  function finish() {
    log('\n===== 审计结束（本工具只报指标，不做通过/失败判定） =====');
    process.exit(0);
  }
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
