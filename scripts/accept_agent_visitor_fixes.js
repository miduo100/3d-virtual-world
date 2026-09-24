/**
 * accept_agent_visitor_fixes.js —— AI 访客体检剩余项修复的验收（2026-09-22）
 *
 * 覆盖三条**实现级契约**（都是 AI 访客体检发现、修复后固化为回归判据）：
 *   #3  AI 出生点对齐真人区域：READY.spawn 不再兜底 (0,0,0)，而是
 *       system_config('world_spawn_point') + ≤3m 随机偏移（多 AI 同时进世界不重叠）。
 *       —— 修复前 AI 出生点与真人出生点相距 31.22m，恰好超出 30m 的 observe 半径与
 *          说话气泡半径：AI 进来第一眼"附近 0 个人"、say 回执 delivered:true 但没人听见。
 *   #7  未知动作口径：拼错的动作名（walkTo）→ unknown_action + 可用动作清单；
 *       红线明令禁止的动作（teleport/set_position/inventory/profile/shop）仍 → scope_denied。
 *       —— 修复前两者都被报成 scope_denied，AI 会把"拼写错"误当成"没权限"而放弃。
 *   #8  BAD_JSON 必须带可读 message（原来只有 code，AI 无法区分整体格式坏还是字段坏）。
 *
 * 顺带断言 #10（乱码显示名）已在本地库修好：observe 里不应再出现 mojibake 物体名。
 *
 * 用法：node scripts/accept_agent_visitor_fixes.js
 *   · 会自动开总闸并在收尾恢复运行前值（走 admin API，避免 60s 缓存不生效）
 *   · 用两个非回环测试 IP 签票（避开每 IP 1 连接的游客并发闸），不烧本机 IP 的签票窗口
 */
const kit = require('./agentV2TestKit');
const mcp = require('./mcpTestKit');
const { httpJson, guestTicket, openAgentWs, wsSend, sleep } = kit;

const R = kit.createReporter('AI 访客体检修复验收（#3 / #7 / #8 / #10）');
const IP_A = process.env.AUDIT_IP_A || '203.0.113.91';
const IP_B = process.env.AUDIT_IP_B || '203.0.113.92';

async function waitType(msgs, type, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find(m => m && m.type === type);
    if (hit) return hit;
    await sleep(60);
  }
  return null;
}
async function waitReject(msgs, needle, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find(m => m && m.type === 'ACTION_REJECTED' && String(m.payload && m.payload.reason || '').includes(needle));
    if (hit) return hit;
    await sleep(60);
  }
  return null;
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

  // ---------- 服务端权威出生点 ----------
  const sp = await httpJson('/api/world/spawn-point', { method: 'GET' });
  const base = sp.json && sp.json.spawnPoint && sp.json.spawnPoint.position;
  R.info('世界出生点（服务端权威）', JSON.stringify(base));
  if (!base) { R.check('前置：能读到世界出生点', false, JSON.stringify(sp.status)); return finish(); }
  const dist = (p) => Math.sqrt(Math.pow(p.x - base.x, 2) + Math.pow(p.z - base.z, 2));

  // ---------- #3 出生点 ----------
  const tA = await guestTicket(IP_A);
  R.check('#3-票 A 签发', tA.status === 200 && !!tA.ticket, `status=${tA.status}`);
  if (!tA.ticket) return finish();
  const cA = await openAgentWs({ token: tA.ticket.token, ip: IP_A });
  R.check('#3-连接 A 建立', cA.ok === true, JSON.stringify({ ok: cA.ok, statusCode: cA.statusCode }));
  if (!cA.ok) return finish();
  await sleep(1200);
  const readyA = await waitType(cA.msgs, 'READY');
  const spawnA = readyA && readyA.payload && readyA.payload.spawn;
  R.check('#3a READY.spawn 不再是 (0,0,0)', !!spawnA && !(spawnA.x === 0 && spawnA.z === 0), JSON.stringify(spawnA));
  R.check('#3b READY.spawn 落在世界出生点 ≤3.01m 内', !!spawnA && dist(spawnA) <= 3.01, `距离=${spawnA ? dist(spawnA).toFixed(2) : '?'}m`);

  const ob = await httpJson('/api/agent/v1/observe?radius=5', { method: 'GET', headers: { Authorization: 'Bearer ' + tA.ticket.token } });
  const self = ob.json && ob.json.self && ob.json.self.position;
  R.check('#3c observe.self 同样落在出生点附近（与 READY.spawn 同源）', !!self && dist(self) <= 3.01,
    `self=${JSON.stringify(self)} 距离=${self ? dist(self).toFixed(2) : '?'}m`);

  const tB = await guestTicket(IP_B);
  const cB = await openAgentWs({ token: tB.ticket ? tB.ticket.token : '', ip: IP_B });
  await sleep(1200);
  const readyB = cB.ok ? await waitType(cB.msgs, 'READY') : null;
  const spawnB = readyB && readyB.payload && readyB.payload.spawn;
  R.check('#3d 两次连接出生点不同（≤3m 随机偏移生效，防多 AI 重叠）',
    !!spawnA && !!spawnB && (spawnA.x !== spawnB.x || spawnA.z !== spawnB.z),
    `A=${JSON.stringify(spawnA)} B=${JSON.stringify(spawnB)}`);

  // ---------- #10 乱码显示名（本地库应已修好）----------
  const ob2 = await httpJson('/api/agent/v1/observe?radius=30', { method: 'GET', headers: { Authorization: 'Bearer ' + tA.ticket.token } });
  const objs = (ob2.json && ob2.json.objects) || [];
  const mojibake = objs.filter(o => /[ÃÂåæçèéêëìíîïðñòóôõö]/.test(String(o.name)));
  R.check('#10 observe 里已无乱码物体名', mojibake.length === 0, `乱码=${JSON.stringify(mojibake.map(o => o.name))}`);

  // ---------- #7 未知动作口径 ----------
  await sleep(2200);   // 游客动作限频 1 次/2s
  wsSend(cA.ws, { type: 'ACTION', payload: { action: 'walkTo', requestId: 'v-walkTo' } });
  const r1 = await waitReject(cA.msgs, 'walkTo');
  R.check('#7a 拼错的 walkTo → unknown_action', !!r1 && r1.payload.code === 'unknown_action', JSON.stringify(r1 && r1.payload));
  R.check('#7b unknown_action 的 reason 附可用动作清单',
    !!r1 && /可用动作/.test(String(r1.payload.reason)) && /walk_to/.test(String(r1.payload.reason)),
    r1 ? String(r1.payload.reason) : '');

  await sleep(2200);
  wsSend(cA.ws, { type: 'ACTION', payload: { action: 'teleport', requestId: 'v-teleport' } });
  const r2 = await waitReject(cA.msgs, 'teleport');
  R.check('#7c 红线动作 teleport 仍是 scope_denied（"明确禁止"与"拼写错"必须可区分）',
    !!r2 && r2.payload.code === 'scope_denied', JSON.stringify(r2 && r2.payload));

  // ---------- #8 BAD_JSON 文案 ----------
  try { cA.ws.send('not-a-json'); } catch (e) { /* ignore */ }
  await sleep(1200);
  const badJson = cA.msgs.filter(m => m.type === 'ERROR' && m.payload && m.payload.code === 'BAD_JSON').pop();
  R.check('#8 BAD_JSON 带可读 message', !!badJson && !!badJson.payload.message, JSON.stringify(badJson && badJson.payload));

  try { cA.ws.close(); } catch (e) { /* ignore */ }
  try { if (cB.ws) cB.ws.close(); } catch (e) { /* ignore */ }
  return finish();

  async function finish() {
    if (wasEnabled !== true) {
      const token = await mcp.adminToken();
      if (token) await mcp.setAgentEnabled(token, wasEnabled === true);
    }
    R.info('收尾：agent_enabled 已恢复运行前值', String(wasEnabled === true));
    const s = R.summary();
    process.exit(s.fail > 0 ? 1 : 0);
  }
})().catch(e => { console.error('FATAL ' + (e && e.stack || e)); process.exit(2); });
