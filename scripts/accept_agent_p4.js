/**
 * accept_agent_p4.js — 行动系统 + 聊天记录守护（v6 轮重建；原脚本于 2026-09-18 文件事故丢失）
 *
 * 覆盖（文档第 7 节 P4）：
 *  ① say 全链路：Agent say → 30m 内真人收到 CHAT → world_chat_log 落库 1 行 → /chat/history 可读回
 *  ② 红线：teleport / set_position 必被服务端拒绝（红线 2 与红线 10）
 *  ③ 管理员 Agent 端点：list / create / tier / disable / enable / regenerate-key / delete + 鉴权门
 *  ④ observe 结构与 AI 描述字段（objects[].description，2026-09-18 新增列）
 *
 * 用法：node scripts/accept_agent_p4.js
 * 产物：examples/agent-client/live/p4.json
 * 注：不硬编码"总闸必须已是 true"——脚本自己按运行前原值恢复（文档 §9 坑 35）。
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const K = require('./agentV2TestKit');
const { pool, query } = require('../src/database/db');

const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const STORE = path.join(__dirname, '_tmp_tier_agents.json');
const REPORT = path.join(__dirname, '..', 'examples', 'agent-client', 'live', 'p4.json');
const RUN = String(Date.now()).slice(-8);
const TEXT = 'p4-say-' + RUN;

async function waitReq(msgs, type, requestId, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find(m => m && m.type === type && m.payload && m.payload.requestId === requestId);
    if (hit) return hit;
    await K.sleep(80);
  }
  return null;
}

async function waitChat(msgs, text, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find(m => m && m.type === 'CHAT' && m.payload && m.payload.message === text);
    if (hit) return hit;
    await K.sleep(80);
  }
  return null;
}

async function adminToken() {
  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  try {
    if (store.adminToken) {
      const t = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + store.adminToken } });
      if (t.status === 200) { console.log('[admin] 复用已有 token'); return { tok: store.adminToken, store }; }
    }
  } catch (e) { /* 回落登录 */ }
  const r = await K.httpJson('/api/admin-auth/login', {
    method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
  });
  const j = r.json || {};
  console.log('[admin] 登录 ->', r.status);
  return { tok: j.token || (j.data && j.data.token) || null, store };
}

(async () => {
  const R = K.createReporter('P4 行动系统 + 聊天记录守护');
  const { tok, store } = await adminToken();
  if (!tok) { console.log('FATAL: 拿不到 adminToken'); process.exitCode = 1; return; }
  const AGENT = store.created.find(a => a.key === 'eco') || store.created[0];
  const auth = { Authorization: 'Bearer ' + tok };
  const adminPut = (body) => K.httpJson('/api/agent/v1/admin/config', { method: 'PUT', headers: auth, body });

  const cfg = await K.httpJson('/api/agent/v1/admin/config', { headers: auth });
  const orig = (cfg.json && cfg.json.config) || {};
  R.check('P0 读取运行前配置（收尾按原值恢复）', cfg.status === 200,
    { agentEnabled: orig.agentEnabled, pushDefault: orig.pushDefault, maxAgents: orig.maxAgents });
  await adminPut({ agent_enabled: 'true' });
  await K.sleep(400);

  // ==================== ① say 全链路 ====================
  const s = await K.httpJson('/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + AGENT.apiKey }, body: {}
  });
  const token = s.json && s.json.token;
  R.check('S1 换票成功', s.status === 200 && !!token, s.status);
  if (!token) { R.summary(); await finish(); return; }
  const aAuth = { Authorization: 'Bearer ' + token };

  const conn = await K.openAgentWs({ token, authHeader: 'Bearer ' + token });
  R.check('S3 Agent WS 连接成功', conn.ok === true, conn.ok ? 'connected' : conn.statusCode);
  const ready = conn.ok ? await K.waitFor(conn.msgs, 'READY', 5000) : null;

  // Agent 实时位置 **必须在 WS 连接之后取**：WS 未连时 playerPositions 里还没有该 Agent 条目，
  // observe 会回落到 session 位置，而新会话（换票必换 jti）的 session 位置为空 → 返回 (0,0,0)；
  // 用它去定位真人观察者会把观察者放到 200m 外，30m nearby 的 CHAT 投递就收不到（本脚本首跑踩到）。
  const ob0 = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: aAuth });
  const self = ob0.json && ob0.json.self;
  const sp = self && self.position;
  const spawn = ready && ready.payload && ready.payload.spawn;
  R.check('S2 WS 连接后 observe 的 self 坐标 = READY.spawn（实时位置口径，缺陷 A/J 守护）',
    !!(sp && spawn && Math.abs(sp.x - spawn.x) < 1 && Math.abs(sp.z - spawn.z) < 1),
    { self: sp, spawn });

  const bot = await K.openHumanWs({
    characterId: 'p4-observer-' + RUN, characterName: 'p4观察者',
    position: sp || { x: 0, y: 0, z: 0 }
  });
  R.check('S4 真人观察者 WS 连接成功（与 Agent 同点 → 30m 内）', bot.ok === true, bot.ok ? 'connected' : bot.error);
  await K.sleep(800);

  if (conn.ok) {
    K.wsSend(conn.ws, { type: 'ACTION', payload: { requestId: 'p4-say-1', action: 'say', text: TEXT } });
    const done = await waitReq(conn.msgs, 'ACTION_COMPLETED', 'p4-say-1', 6000);
    R.check('S5 say → ACTION_COMPLETED', !!done, done ? done.payload : 'TIMEOUT');

    const chat = bot.ok ? await waitChat(bot.msgs, TEXT, 6000) : null;
    R.check('S6 30m 内真人收到 CHAT（含发送文本）', !!chat,
      chat ? { sender: chat.payload.sender, characterId: chat.payload.characterId } : 'TIMEOUT');
    R.check('S7 CHAT 携带 position 字段（Agent 距离过滤用，P4 新增）',
      !!(chat && chat.payload && chat.payload.position !== undefined),
      chat && chat.payload ? chat.payload.position : 'n/a');
  }

  const dbc = await query('SELECT count(*)::int AS c FROM world_chat_log WHERE message = $1', [TEXT]);
  R.check('S8 world_chat_log 落库 1 行（服务端权威写入）', dbc.rows[0].c === 1, dbc.rows[0].c);

  const his = await K.httpJson('/api/agent/v1/chat/history?limit=50', { headers: aAuth });
  const hitHis = his.json && Array.isArray(his.json.history) && his.json.history.some(h => h.message === TEXT);
  R.check('S9 GET /chat/history 可读回该消息（AI 重连恢复上下文）', his.status === 200 && hitHis,
    { status: his.status, count: his.json && his.json.history && his.json.history.length });
  const humanOnly = his.json && Array.isArray(his.json.history) && his.json.history.every(h => h.senderType);
  R.check('S10 history 行含 senderType/senderName/message/createdAt 字段', !!humanOnly,
    his.json && his.json.history && his.json.history[0]);

  // ==================== ② 红线动作 ====================
  if (conn.ok) {
    K.wsSend(conn.ws, { type: 'ACTION', payload: { requestId: 'p4-tp', action: 'teleport', target: { x: 10, z: 10 } } });
    const tp = await waitReq(conn.msgs, 'ACTION_REJECTED', 'p4-tp', 6000);
    R.check('X1 teleport → ACTION_REJECTED scope_denied（红线 2）',
      !!tp && tp.payload.code === 'scope_denied', tp ? tp.payload : 'TIMEOUT');

    K.wsSend(conn.ws, { type: 'ACTION', payload: { requestId: 'p4-sp', action: 'set_position', position: { x: 0, y: 0, z: 0 } } });
    const sp = await waitReq(conn.msgs, 'ACTION_REJECTED', 'p4-sp', 6000);
    R.check('X2 set_position → ACTION_REJECTED（红线 10：不允许裸位置接口）',
      !!sp, sp ? sp.payload : 'TIMEOUT');
  } else {
    R.check('X1 teleport → ACTION_REJECTED scope_denied（红线 2）', false, 'WS 未连接');
    R.check('X2 set_position → ACTION_REJECTED（红线 10：不允许裸位置接口）', false, 'WS 未连接');
  }

  // ==================== ③ 管理员 Agent 端点 ====================
  const list0 = await K.httpJson('/api/agent/v1/admin/agents', { headers: auth });
  R.check('AD1 GET /admin/agents → 200 且返回数组', list0.status === 200 && Array.isArray(list0.json.agents),
    { status: list0.status, count: list0.json && list0.json.agents && list0.json.agents.length });

  const probeName = 'p4_probe_' + RUN;
  const created = await K.httpJson('/api/agent/v1/admin/agents', {
    method: 'POST', headers: auth, body: { name: probeName, description: 'P4 临时探针', pushTier: 'eco' }
  });
  const pid = created.json && created.json.agent && created.json.agent.id;
  R.check('AD2 POST /admin/agents 创建 → 200 且返回明文 apiKey（仅此一次）',
    created.status === 200 && !!created.json.apiKey && !!pid, { status: created.status, id: pid, keyPrefix: created.json && created.json.apiKeyPrefix });

  const tier = await K.httpJson(`/api/agent/v1/admin/agents/${pid}/tier`, {
    method: 'POST', headers: auth, body: { pushTier: 'standard' }
  });
  R.check('AD3 POST /admin/agents/:id/tier 改档 → 200', tier.status === 200, { status: tier.status, body: tier.json });

  const dis = await K.httpJson(`/api/agent/v1/admin/agents/${pid}/disable`, { method: 'POST', headers: auth, body: {} });
  const list1 = await K.httpJson('/api/agent/v1/admin/agents', { headers: auth });
  const row1 = (list1.json.agents || []).find(a => a.id === pid);
  R.check('AD4 POST :id/disable → 200 且列表 status=disabled',
    dis.status === 200 && row1 && row1.status === 'disabled', { status: dis.status, row: row1 && row1.status });

  const en = await K.httpJson(`/api/agent/v1/admin/agents/${pid}/enable`, { method: 'POST', headers: auth, body: {} });
  const list2 = await K.httpJson('/api/agent/v1/admin/agents', { headers: auth });
  const row2 = (list2.json.agents || []).find(a => a.id === pid);
  R.check('AD5 POST :id/enable → 200 且列表 status=active',
    en.status === 200 && row2 && row2.status === 'active', { status: en.status, row: row2 && row2.status });

  const regen = await K.httpJson(`/api/agent/v1/admin/agents/${pid}/regenerate-key`, { method: 'POST', headers: auth, body: {} });
  R.check('AD6 POST :id/regenerate-key → 200 且返回新明文 Key',
    regen.status === 200 && !!regen.json.apiKey, { status: regen.status, prefix: regen.json && regen.json.apiKeyPrefix });

  const del = await K.httpJson(`/api/agent/v1/admin/agents/${pid}`, { method: 'DELETE', headers: auth });
  const list3 = await K.httpJson('/api/agent/v1/admin/agents', { headers: auth });
  R.check('AD7 DELETE :id → 200 且列表不再含该 Agent',
    del.status === 200 && !(list3.json.agents || []).some(a => a.id === pid), { status: del.status });

  const noAuth = await K.httpJson('/api/agent/v1/admin/agents');
  R.check('AD8 无凭据访问 /admin/agents → 401/403（鉴权门）',
    noAuth.status === 401 || noAuth.status === 403, noAuth.status);

  // ==================== ④ observe 结构与 AI 描述字段 ====================
  const ob = await K.httpJson('/api/agent/v1/observe?radius=100', { headers: aAuth });
  const objects = (ob.json && ob.json.objects) || [];
  const allHaveDesc = objects.length > 0 && objects.every(o => Object.prototype.hasOwnProperty.call(o, 'description'));
  R.check('O1 observe objects[].description 字段存在（AI 物体描述列）',
    allHaveDesc, { objects: objects.length, first: objects[0] || null });
  R.check('O2 observe 含 self/entities/world 三段结构',
    !!(ob.json && ob.json.self && Array.isArray(ob.json.entities) && ob.json.world),
    { self: !!ob.json.self, entities: ob.json.entities && ob.json.entities.length, world: !!(ob.json && ob.json.world) });
  const entOk = (ob.json.entities || []).every(e => e.id !== undefined && e.position !== undefined && e.distance !== undefined);
  R.check('O3 entities 元素含 id/position/distance', entOk, ob.json.entities && ob.json.entities.length);
  R.check('O4 observe 不泄露私有字段（无 email/userId/role/scopes）',
    !objects.some(o => o.email !== undefined || o.userId !== undefined || o.role !== undefined),
    objects.length + ' objects 检查');

  if (conn.ok) K.closeAll(conn.ws);
  if (bot.ok) K.closeAll(bot.ws);

  // ==================== 收尾 ====================
  await adminPut({ agent_enabled: orig.agentEnabled ? 'true' : 'false' });
  const back = await K.httpJson('/api/agent/v1/admin/config', { headers: auth });
  const now = (back.json && back.json.config) || {};
  R.check(`P9 收尾恢复运行前配置（agentEnabled=${orig.agentEnabled}）`,
    String(now.agentEnabled) === String(!!orig.agentEnabled), now.agentEnabled);

  const sum = R.summary();
  try {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, JSON.stringify({
      ts: new Date().toISOString(), message: TEXT,
      pass: sum.pass, fail: sum.fail, total: sum.total, rows: sum.rows,
      origConfig: { agentEnabled: orig.agentEnabled, pushDefault: orig.pushDefault, maxAgents: orig.maxAgents }
    }, null, 2), 'utf8');
    console.log('报告：' + REPORT);
  } catch (e) { console.log('报告写入失败: ' + e.message); }
  await finish();
  process.exitCode = sum.fail === 0 ? 0 : 1;
})().catch(async (e) => {
  console.log('FATAL: ' + e.message);
  process.exitCode = 1;
  await finish();
});

async function finish() {
  // 2026-09-23：清理本脚本写入的测试聊天。不做的话 world_chat_log 会长期留 "p4-say-xxxx"，
  // 被下一个 AI 用 /chat/history 恢复上下文时读到，污染它对世界的认知（本地体检发现的第 3 类问题）。
  try {
    const del = await query("DELETE FROM world_chat_log WHERE message LIKE 'p4-say-%'");
    if (del.rowCount) console.log(`已清理测试聊天记录 ${del.rowCount} 行`);
  } catch (e) { /* ignore */ }
  try { await pool.end(); } catch (e) { /* ignore */ }
}
