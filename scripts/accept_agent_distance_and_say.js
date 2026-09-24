/**
 * accept_agent_distance_and_say.js —— ② say 回执真实收件人数 + ③ 距离 2D/3D 口径（2026-09-23）
 *
 * 这两条都来自**AI 访客实访线上世界的真实摩擦**（不是纸面推演）：
 *   ③ 距离语义：`distance` 一直是**水平距离**（dist2D，半径过滤也用它），而世界有真实高度差
 *      —— 真人出生点在高台 y≈9.6，AI 走平面 y=0。实测 AI 看到 "d=4.44m" 判定"我就在他旁边"，
 *      实际垂直差 9.6m，真人**完全看不到** AI，AI 也看不出"没人理我"是因为自己在地底下。
 *      修复：observe 的 entities/objects/portals 全部补 `distance3D`（空间距离），并在
 *      响应顶层给出 `distanceSemantics` 一句话说明；路由描述同源。
 *   ② say 回执：原来写死 `delivered: true`（其调用的 broadcastToNearby 本就 return count，
 *      被 agentWsServer 的 CHAT patch 吞掉了），AI 无法区分"3 个人听见"和"对着空气说话"。
 *      修复：`{ delivered: recipients > 0, recipients }`，recipients = 30m 内**实际收到**这条
 *      消息的连接数（真人 WS + 已订阅 chat 的别的 Agent，不含发送者自己）。
 *
 * 判据（D=距离口径 / S=say 回执）：
 *   D1 响应含 distanceSemantics 且说明 2D/3D 差异
 *   D2 entities 每项都有 distance 与 distance3D（有限数）
 *   D3 真人实体：水平距离小但空间距离大（复现"高台"场景）→ distance3D ≈ √(d²+Δy²)
 *   D4 所有条目（entities/objects/portals）满足 distance3D ≥ distance
 *   D5 用 ?y=30 抬高观察点：distance 不变、distance3D 按新的 Δy 重算（证明真按 3D 算）
 *   S1 30m 内有真人观察者时 say → ACTION_COMPLETED recipients ≥ 1 且 delivered === true
 *   S2 真人观察者**真的收到** CHAT（端到端"真人可见"，不靠 delivered 自证）
 *   S3 真人离开后再说 → recipients === 0 且 delivered === false（空场必须能自检出来）
 *
 * 用法：node scripts/accept_agent_distance_and_say.js
 *   · 自动开总闸并在收尾恢复运行前值（走 admin API，避免 60s 缓存）
 *   · 用非回环测试 IP 签票，不烧本机 IP 的签票窗口
 *   · 真人侧用根路径 WS 观察者模拟（openHumanWs），不需要浏览器
 */
const kit = require('./agentV2TestKit');
const mcp = require('./mcpTestKit');
const { httpJson, guestTicket, openAgentWs, openHumanWs, wsSend, sleep, testIp } = kit;

const R = kit.createReporter('AI 距离口径(③) + say 回执(②) 验收');
const IP_AI = process.env.AUDIT_IP_DIST || testIp(111);
const HUMAN_ID = 'acc-dist-human-1';

async function waitActionCompleted(msgs, requestId, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find(m => m && m.type === 'ACTION_COMPLETED' && m.payload && m.payload.requestId === requestId);
    if (hit) return hit;
    await sleep(60);
  }
  return null;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * 选"用于验证高度差"的实体：优先按 id 命中脚本自己造的真人观察者；找不到时退化为 |Δy| 最大
 * 的非 self 实体。为什么需要它：线上世界常有真实玩家（实测"米多"就在出生点旁 Δy≈0.05），
 * 直接取"第一个非 self"会拿真人当被测对象 → D3/D5 假失败（脚本自身缺陷，非被测代码缺陷）。
 * selfY 由调用方给（D5 会用 ?y= 覆盖观察点高度，不能用 self.position.y）。
 */
function pickLiftTarget(entities, selfY, expectedId) {
  const others = (entities || []).filter(e => !e.isSelf);
  if (expectedId) {
    const byId = others.find(e => String(e.id) === expectedId);
    if (byId) return byId;
  }
  const dy = (e) => Math.abs(num(e.position && e.position.y) - (selfY == null ? 0 : selfY));
  return others.slice().sort((a, b) => dy(b) - dy(a))[0] || null;
}

(async () => {
  // ---------- 前置：总闸（收尾恢复运行前值）----------
  const before = await httpJson('/.well-known/virtual-world-agent.json', { method: 'GET' });
  const wasEnabled = before.json ? before.json.agentEnabled : null;
  if (wasEnabled !== true) {
    const token = await mcp.adminToken();
    if (!token) { R.check('前置：取管理员 token 以开闸', false, 'adminToken 取不到（限流或凭据失效）'); return finish(); }
    await mcp.setAgentEnabled(token, true);
    for (let i = 0; i < 20; i++) {
      const r = await httpJson('/.well-known/virtual-world-agent.json', { method: 'GET' });
      if (r.json && r.json.agentEnabled === true) break;
      await sleep(400);
    }
  }
  R.check('前置：agent_enabled 已开', (await httpJson('/.well-known/virtual-world-agent.json')).json.agentEnabled === true);

  // ---------- 世界出生点 + AI 入场 ----------
  const sp = await httpJson('/api/world/spawn-point', { method: 'GET' });
  const base = sp.json && sp.json.spawnPoint && sp.json.spawnPoint.position;
  R.info('世界出生点（服务端权威）', JSON.stringify(base));
  if (!base) { R.check('前置：能读到世界出生点', false, JSON.stringify(sp.status)); return finish(); }

  const tAI = await guestTicket(IP_AI);
  R.check('前置：游客票签发', tAI.status === 200 && !!tAI.ticket, `status=${tAI.status}`);
  if (!tAI.ticket) return finish();
  const ai = await openAgentWs({ token: tAI.ticket.token, ip: IP_AI });
  R.check('前置：Agent WS 连接', ai.ok === true, JSON.stringify({ ok: ai.ok, statusCode: ai.statusCode }));
  if (!ai.ok) return finish();
  await sleep(1200);

  // ① 出生点对齐：**只读判据**（不修改任何配置，可安全打线上）。
  // 线上尚未部署 ① 时 READY.spawn 会是 (0,0,0)，与真人出生点相距 31.22m。
  const readyAi = await kit.waitFor(ai.msgs, 'READY', 6000);
  const spawnAi = readyAi && readyAi.payload && readyAi.payload.spawn;
  const spawnDist = spawnAi ? Math.sqrt(Math.pow(spawnAi.x - base.x, 2) + Math.pow(spawnAi.z - base.z, 2)) : null;
  R.info('READY.spawn', JSON.stringify(spawnAi));
  R.check('S0 ① AI 出生点落在世界出生点 ≤3.01m 内（未部署时是 (0,0,0)）',
    !!spawnAi && !(spawnAi.x === 0 && spawnAi.z === 0) && spawnDist != null && spawnDist <= 3.01,
    `spawn=${JSON.stringify(spawnAi)} 距出生点=${spawnDist != null ? spawnDist.toFixed(2) + 'm' : '?'}`);

  // 真人观察者：**故意抬高 12m** 制造"不在同一层"的场景。
  // 说明：本地已带 ① 出生点修复（AI spawn.y = 世界出生点 y），所以自然状态下 Δy=0、
  // 构造不出高度差 —— 这里显式把真人放在出生台上方 12m（仍在 3D 30m 说话范围内）。
  const baseY = num(base.y) != null ? Number(base.y) : 9.6;
  const HUMAN_LIFT = 12;
  const humanPos = { x: base.x + 1.5, y: baseY + HUMAN_LIFT, z: base.z + 1.5 };
  const human = await openHumanWs({ characterId: HUMAN_ID, characterName: '验收真人', position: humanPos });
  R.check('前置：真人侧 WS 观察者入场', human.ok === true, JSON.stringify({ ok: human.ok, error: human.error }));
  await sleep(1200);

  const auth = { Authorization: 'Bearer ' + tAI.ticket.token };

  // ==================== ③ 距离口径 ====================
  const ob1 = await httpJson('/api/agent/v1/observe?radius=30', { method: 'GET', headers: auth });
  const b1 = ob1.json || {};
  R.check('D1 响应含 distanceSemantics 且点明 2D/3D 差异',
    typeof b1.distanceSemantics === 'string' && /distance3D/.test(b1.distanceSemantics),
    String(b1.distanceSemantics).slice(0, 120));
  // D6：AI 必须知道"我的 y 是服务端平面估算，不是渲染高度"（否则它会用自己的 y 判断楼层）
  R.check('D6 self 标出 positionIsServerPlane + 语义串说明自身 y 是平面估算',
    b1.self && b1.self.positionIsServerPlane === true
    && typeof b1.distanceSemantics === 'string' && /plane estimate/i.test(b1.distanceSemantics),
    `positionIsServerPlane=${b1.self && b1.self.positionIsServerPlane}`);

  const ents1 = b1.entities || [];
  const badEntity = ents1.filter(e => num(e.distance) == null || num(e.distance3D) == null);
  R.check('D2 entities 每项都有 distance 与 distance3D', ents1.length > 0 && badEntity.length === 0,
    `共 ${ents1.length} 条，缺字段 ${badEntity.length} 条`);

  // ⚠️ 线上是有真人玩家的世界：不能取"第一个非 self"（那会抓到旁边 Δy≈0 的真玩家，
  //    2026-09-23 实测就在线上误判成 D3 FAIL）。优先按 id 找脚本自己造的观察者，
  //    找不到再退化为"高度差最大的那个非 self 实体"。
  const me = ents1.find(e => e.isSelf) || {};
  const other = pickLiftTarget(ents1, num(me.position && me.position.y), HUMAN_ID);
  R.info('self', JSON.stringify(me.position));
  R.info('对方实体', other ? `${other.name} distance=${other.distance} distance3D=${other.distance3D}` : '未找到');
  const d2 = other ? num(other.distance) : null;
  const d3 = other ? num(other.distance3D) : null;
  const dy1 = other && me.position ? Math.abs(num(other.position.y) - num(me.position.y)) : null;
  R.check('D3 水平距离小但空间距离大（高度差被纳入 distance3D）',
    d2 != null && d3 != null && d2 < 6 && d3 > d2 + 2 && dy1 != null && dy1 > 2,
    `distance=${d2} distance3D=${d3} Δy=${dy1}`);
  const expect1 = (d2 != null && dy1 != null) ? Math.sqrt(d2 * d2 + dy1 * dy1) : null;
  R.check('D3b distance3D ≈ √(distance² + Δy²)（口径自洽，误差 ≤0.5m）',
    d3 != null && expect1 != null && Math.abs(d3 - expect1) <= 0.5,
    `实际=${d3} 期望=${expect1 ? expect1.toFixed(2) : '?'}`);

  const allItems = [...ents1, ...(b1.objects || []), ...(b1.portals || [])];
  const violated = allItems.filter(o => num(o.distance) != null && num(o.distance3D) != null && num(o.distance3D) < num(o.distance) - 0.01);
  R.check('D4 所有条目 distance3D ≥ distance', allItems.length > 0 && violated.length === 0,
    `共 ${allItems.length} 条，违反 ${violated.length} 条`);

  await sleep(2300);   // 游客 observe 限频 1 次/2s
  // 抬高观察点（+40m）→ 与真人所在高度差从 12m 变成 28m，distance3D 必须随之变大
  const OVERRIDE_Y = baseY + 40;
  const ob2 = await httpJson(`/api/agent/v1/observe?radius=30&x=${encodeURIComponent(me.position.x)}&y=${OVERRIDE_Y}&z=${encodeURIComponent(me.position.z)}`,
    { method: 'GET', headers: auth });
  const b2 = ob2.json || {};
  const other2 = pickLiftTarget(b2.entities, OVERRIDE_Y, HUMAN_ID);   // 同上：按 id 定位，避免抓到真玩家
  const d2b = other2 ? num(other2.distance) : null;
  const d3b = other2 ? num(other2.distance3D) : null;
  const dy2 = other2 ? Math.abs(num(other2.position.y) - OVERRIDE_Y) : null;
  const expect2 = (d2b != null && dy2 != null) ? Math.sqrt(d2b * d2b + dy2 * dy2) : null;
  R.check('D5 抬高观察点(?y=出生点+40m)：水平距离不变、distance3D 按新 Δy 重算',
    d2b != null && d3b != null && expect2 != null
    && Math.abs(d2b - d2) <= 0.5 && d3b > d3 + 5 && Math.abs(d3b - expect2) <= 0.5,
    `d 前=${d2} 后=${d2b}；distance3D 前=${d3} 后=${d3b}（期望 ${expect2 ? expect2.toFixed(2) : '?'}）`);

  // ==================== ② say 回执 ====================
  const text1 = '【验收-DS】1 有人在旁边';
  wsSend(ai.ws, { type: 'ACTION', payload: { action: 'say', text: text1, requestId: 'ds-say-1' } });
  const ack1 = await waitActionCompleted(ai.msgs, 'ds-say-1');
  const rc1 = ack1 ? ack1.payload.result && ack1.payload.result.recipients : null;
  R.check('S1 附近有真人时 recipients ≥ 1 且 delivered === true',
    !!ack1 && num(rc1) != null && num(rc1) >= 1 && ack1.payload.result.delivered === true,
    JSON.stringify(ack1 && ack1.payload.result));

  const humanGot = human.msgs.find(m => m && m.type === 'CHAT' && m.payload && m.payload.message === text1);
  R.check('S2 真人侧**真的收到** CHAT（端到端可见，不靠 delivered 自证）', !!humanGot,
    humanGot ? JSON.stringify(humanGot.payload).slice(0, 140) : '未收到');

  // ---------- S4（L2 专项）：台面场景下"水平距离内、空间距离外"必须仍能投递 ----------
  // 背景：服务端把 Agent 走平面（y=0），真人在 9.6m 高的出生台上 —— 旧实现按 3D 判距，
  //       水平 28m 的人会被算成 35m，say 投递不到（半径白丢）。判距改 2D 后必须能送达。
  const FAR_X = base.x + 29.5;
  wsSend(ai.ws, { type: 'ACTION', payload: { action: 'walk_to', target: { x: FAR_X, z: base.z }, requestId: 'ds-walk' } });
  const walkAck = await waitActionCompleted(ai.msgs, 'ds-walk', 20000);
  R.check('S4a 走到 29.5m 外（站到世界地面的平面上）',
    !!walkAck && walkAck.payload.reason === 'arrived', JSON.stringify(walkAck && walkAck.payload).slice(0, 120));
  await sleep(2300);   // observe 限频 1 次/2s
  const ob4 = await httpJson('/api/agent/v1/observe?radius=30', { method: 'GET', headers: auth });
  const b4 = ob4.json || {};
  const self4 = b4.self && b4.self.position;
  const humanEnt4 = (b4.entities || []).find(e => String(e.id) === HUMAN_ID);
  const h2 = humanEnt4 ? num(humanEnt4.distance) : null;
  const h3 = humanEnt4 ? num(humanEnt4.distance3D) : null;
  R.check('S4b 前提成立：自己的 y 已被移动重置为服务端平面 0（而真人在高台上）',
    self4 && num(self4.y) === 0 && h3 != null && h2 != null && h3 > h2 + 5,
    `self.y=${self4 && self4.y}；真人 distance=${h2} distance3D=${h3}`);
  await sleep(2600);   // 累计满足 say 1 条/5s
  const text3 = '【验收-DS】3 台面场景（水平内/空间外）';
  wsSend(ai.ws, { type: 'ACTION', payload: { action: 'say', text: text3, requestId: 'ds-say-4' } });
  const ack4 = await waitActionCompleted(ai.msgs, 'ds-say-4');
  const rc4 = ack4 ? ack4.payload.result && ack4.payload.result.recipients : null;
  R.info('S4 距离对比', `水平 ${h2}m（≤30 应投递） / 空间 ${h3}m（>30，旧 3D 口径会判失败）`);
  R.check('S4c 水平距离内、空间距离外 → 仍投递成功（判距已统一为 2D）',
    !!ack4 && num(rc4) != null && num(rc4) >= 1 && ack4.payload.result.delivered === true && h2 != null && h2 <= 30 && h3 != null && h3 > 30,
    `recipients=${rc4} 水平=${h2} 空间=${h3}`);

  // 我的观察者离场 → 再 say 一次。**注意：线上世界可能还有真实玩家在附近**
  // （实测 2026-09-23 线上"米多"就在出生点旁），此时 recipients≥1 才是正确的；
  // 只有确认附近确实没有别人时，才断言"必须 0"。所以先 observe 数一下剩余实体。
  try { human.ws.close(); } catch (e) { /* ignore */ }
  await sleep(2500);
  const ob3 = await httpJson('/api/agent/v1/observe?radius=30', { method: 'GET', headers: auth });
  const others3 = ((ob3.json && ob3.json.entities) || []).filter(e => !e.isSelf);
  R.info('S3 前的在场实体（不含自己）', others3.length
    ? others3.map(e => `${e.name}(${e.distance}m/${e.distance3D}m)`).join(', ') : '无（真空场）');
  await sleep(2800);   // 与上一句 say 累计间隔 ≥5s（游客 1 条/5s）

  const text2 = '【验收-DS】2 再确认一次回执';
  wsSend(ai.ws, { type: 'ACTION', payload: { action: 'say', text: text2, requestId: 'ds-say-2' } });
  const ack2 = await waitActionCompleted(ai.msgs, 'ds-say-2');
  const rc2 = ack2 ? ack2.payload.result && ack2.payload.result.recipients : null;
  const delivered2 = ack2 ? ack2.payload.result.delivered : null;
  if (others3.length === 0) {
    R.check('S3 空场时 recipients === 0 且 delivered === false（不再谎报"已送达"）',
      !!ack2 && num(rc2) === 0 && delivered2 === false,
      JSON.stringify(ack2 && ack2.payload.result));
  } else {
    // 线上有真人在场：判据改成"回执必须与真实在场人数一致"，这才是这条修复的本质
    R.check('S3 附近有真人时：delivered === (recipients > 0) 且 recipients 与实际在场数一致',
      !!ack2 && num(rc2) != null && delivered2 === (num(rc2) > 0) && num(rc2) <= others3.length,
      `recipients=${rc2} delivered=${delivered2} 在场=${others3.length}`);
  }

  try { ai.ws.close(); } catch (e) { /* ignore */ }
  return finish();

  async function finish() {
    // 清理本轮验收自己写的测试聊天记录：前缀是本脚本自造的，不会碰真实玩家/AI 的消息。
    // 不做的话 world_chat_log 里会长期留 "【验收-DS】…" 噪音，被下一个 AI 用
    // world_chat_history 读到会误导它（以为世界里有这么一句话）。
    // ⚠️ 只在打本地时清理：本脚本连的是 kit.BASE，而 db 句柄永远指向**本机库**——
    // 打线上时直接删会删错库（线上测试消息留在线上库），故此时只提示手工 SQL。
    if (/localhost|127\.0\.0\.1|\[::1\]/.test(kit.BASE)) {
      try {
        const dbc = require('../src/database/db');
        const del = await dbc.query("DELETE FROM world_chat_log WHERE message LIKE '【验收-DS】%'");
        R.info('已清理本轮验收写入的测试聊天记录', del.rowCount);
      } catch (e) { R.info('测试聊天记录清理失败（不影响判据）', e.message); }
    } else {
      R.info('跳过测试聊天记录清理（目标是远端）',
        "如需清理请对**线上库**执行：DELETE FROM world_chat_log WHERE message LIKE '【验收-DS】%'");
    }
    if (wasEnabled !== true) {
      const token = await mcp.adminToken();
      if (token) await mcp.setAgentEnabled(token, wasEnabled === true);
    }
    R.info('收尾：agent_enabled 已恢复运行前值', String(wasEnabled === true));
    const s = R.summary();
    process.exit(s.fail > 0 ? 1 : 0);
  }
})().catch(e => { console.error('FATAL ' + (e && e.stack || e)); process.exit(2); });
