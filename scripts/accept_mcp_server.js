/**
 * accept_mcp_server.js — MCP Server 接入验收（M1~M14，可重跑）
 *
 * 判据来源：《AI-Agent引流提示词-4-MCP-Server接入》§4。
 * 灵魂两条：
 *   M6  —— 用**第二个客户端**验证"AI 真的在世界里存在"（说的那句话被另一个客户端收到）；
 *   M13 —— 验证"AI 真的能看懂世界"（物体 description 完整透出）。
 * 只测接口不测这两点等于没测。
 *
 * 用法：
 *   node scripts/accept_mcp_server.js
 *   环境变量：AGENT_TEST_BASE(默认 http://localhost:3002)、MCP_TEST_API_KEY(可选，Key 档)、
 *            MCP_ONLINE_HOST(默认 https://miduo100.com，M14 线上发现用；不可达时只记 INFO)
 *
 * 脚本自己会：
 *   ① 用管理员 API 打开 agent_enabled（必须在 server 进程内改，直写 DB 不会让 60s 缓存失效）；
 *   ② 跑完恢复运行前的值（红线 9：默认 false）；
 *   ③ 用 stdio + JSON-RPC 拉起真实 MCP server 进程调工具（不依赖 SDK，主项目依赖零污染）。
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const jwt = require('jsonwebtoken');

const K = require('./agentV2TestKit');
const M = require('./mcpTestKit');

const SECRET = process.env.AGENT_JWT_SECRET;
const ONLINE_HOST = process.env.MCP_ONLINE_HOST || 'https://miduo100.com';
const SMOKE = path.join(__dirname, 'smoke_r185_world.js');
const MCP_WORLD_CLIENT = path.join(M.MCP_DIR, 'src', 'worldClient.js');

const EXPECTED_TOOLS = [
  'world_discover', 'world_enter', 'world_observe', 'world_say',
  'world_walk_to', 'world_follow', 'world_chat_history', 'world_leave'
];

const cleanups = [];
function onCleanup(fn) { cleanups.push(fn); }

function bytes(s) { return Buffer.byteLength(s || '', 'utf8'); }
function decode(t) { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); }

/** 等"某实体进入世界"的广播（真人侧观察者的视角） */
async function waitJoin(msgs, characterId, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find((m) => m && m.type === 'PLAYER_JOINED'
      && m.payload && String(m.payload.characterId) === String(characterId));
    if (hit) return hit;
    await K.sleep(100);
  }
  return null;
}

async function waitChat(msgs, needle, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find((m) => m && m.type === 'CHAT'
      && m.payload && String(m.payload.message || '').includes(needle));
    if (hit) return hit;
    await K.sleep(100);
  }
  return null;
}

async function sessionToken(apiKey) {
  const r = await M.httpJson('/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: {}
  });
  return (r.json && r.json.token) || null;
}

async function runSmoke(adminTok) {
  return new Promise((resolve) => {
    // 传 ADMIN_TOKEN：smoke 脚本默认自己登录，而管理员登录有 IP 限流（成功也计数），
    // 连跑多个验收脚本时必被打满 → 复用本脚本已经拿到的 token。
    const child = spawn(process.execPath, [SMOKE], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ADMIN_TOKEN: adminTok || '' }
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { out += d.toString('utf8'); });
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* noop */ } resolve({ code: -1, out }); }, 240000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

(async () => {
  const R = K.createReporter('MCP Server 接入验收（M1~M14）');
  let guest = null; let keyCli = null;
  let adminToken = null; let origEnabled = false;

  try {
    // ==================== 环境前置 ====================
    adminToken = await M.adminToken();
    if (!adminToken) { console.log('FATAL: 拿不到 adminToken（登录限流？重启本地服务器清空计数器）'); process.exitCode = 1; return; }
    const cfg0 = await M.getAgentConfig(adminToken);
    origEnabled = Boolean(cfg0 && cfg0.agentEnabled);
    R.info('环境', { base: K.BASE, agentEnabledBefore: origEnabled, agentJwtSecret: Boolean(SECRET), chatLogEnabled: cfg0 && cfg0.chatLogEnabled });
    if (!origEnabled) { await M.setAgentEnabled(adminToken, true); await K.sleep(800); }

    // 两个**不同**的 Key Agent：max_connections_per_agent=1，同一个 Agent 的第二条连接会顶替第一条
    const keyAgent = await M.ensureKeyAgent(adminToken, { key: 'eco' });
    const agentB = await M.ensureKeyAgent(adminToken, { key: 'standard' });
    R.info('Key Agent（M8/M9 用）', keyAgent ? { name: keyAgent.name, from: keyAgent.from } : null);
    R.info('第二 Key Agent（M10 scope 判定用）', agentB ? { name: agentB.name, from: agentB.from } : null);
    if (!keyAgent || !SECRET) { console.log('FATAL: 缺少 Key Agent 或 AGENT_JWT_SECRET，无法跑完整验收'); process.exitCode = 1; return; }

    // ==================== M1 / M2：stdio 握手 + 工具清单（零凭证进程）====================
    guest = new M.McpStdioClient({ name: 'guest', env: { AGENT_HOST: K.BASE, AGENT_API_KEY: '' } });
    onCleanup(() => guest && guest.stop());
    const init = await guest.start();
    R.check('M1 MCP stdio 握手成功（initialize → serverInfo）',
      Boolean(init && init.serverInfo && init.serverInfo.name === 'virtual-world'),
      { serverInfo: init && init.serverInfo, protocolVersion: guest.protocolVersion });

    const tools = ((await guest.listTools()) || {}).tools || [];
    const names = tools.map((t) => t.name);
    R.check('M2a tools/list 返回 8 个工具', tools.length === 8, names);
    R.check('M2b 工具名与设计一致', EXPECTED_TOOLS.every((n) => names.includes(n)) && names.every((n) => EXPECTED_TOOLS.includes(n)), names);
    R.check('M2c 每个工具都有清晰 description(≥30 字) 与 object 型 inputSchema',
      tools.every((t) => t.description && t.description.length >= 30 && t.inputSchema && t.inputSchema.type === 'object'),
      tools.filter((t) => !(t.description && t.inputSchema && t.inputSchema.type === 'object')).map((t) => t.name));
    R.check('M2d 工具清单里没有任何传送/设坐标类工具（红线 3：不包一层绕过）',
      !names.some((n) => /teleport|set_?position|setpos/i.test(n)), names);

    const resources = ((await guest.listResources()) || {}).resources || [];
    R.check('M2e Resource：世界导览存在', resources.length === 1 && resources[0].uri === 'virtual-world://guide', resources.map((r) => r.uri));
    const guide = await guest.readResource('virtual-world://guide');
    const guideText = (guide.contents && guide.contents[0] && guide.contents[0].text) || '';
    R.check('M2f 导览资源可读且含关键事实（8 工具 / 用 id 认人 / 禁止传送）',
      guideText.length > 500 && guideText.includes('world_observe') && guideText.includes('id') && guideText.includes('传送'),
      { bytes: bytes(guideText) });
    const prompts = ((await guest.listPrompts()) || {}).prompts || [];
    R.check('M2g Prompts：world_guided_tour + world_report',
      prompts.length === 2 && prompts.map((p) => p.name).sort().join(',') === 'world_guided_tour,world_report',
      prompts.map((p) => p.name));
    const tourPrompt = await guest.getPrompt('world_guided_tour');
    const tourText = ((tourPrompt.messages || [])[0] || {}).content ? tourPrompt.messages[0].content.text : '';
    R.check('M2h 漫游提示模板有实质内容（含限频与禁止传送的规矩）',
      tourText.length > 300 && tourText.includes('world_observe') && /限频|不要连续刷屏/.test(tourText), { bytes: bytes(tourText) });

    // ==================== M3：零凭证路径 ====================
    const disc = await guest.callTool('world_discover', {});
    R.check('M3a 零凭证 world_discover 成功（只设 AGENT_HOST）', !disc.isError && disc.text.length > 100,
      disc.isError ? disc.text.slice(0, 160) : disc.text.split('\n')[0]);
    R.check('M3b 返回世界名与当前档位（游客档）', /世界「.+」/.test(disc.text) && disc.text.includes('游客档'));
    R.check('M3c 返回能力与限制（观察半径 / 限频 / 明确禁止项）',
      disc.text.includes('观察半径') && disc.text.includes('限频') && disc.text.includes('禁止'));

    // ==================== M4：进入世界（游客档）====================
    // 真人侧观察者（浏览器客户端同款 WS），用来证明"世界里真的出现了这个 Agent"
    const human = await K.openHumanWs({ characterId: 'mcp-accept-human', characterName: 'MCP验收观察者', position: { x: 6, y: 0, z: 4 } });
    onCleanup(() => K.closeAll(human.ws));
    R.info('真人侧观察者', human.ok ? 'connected' : human.error);

    const enter = await guest.callTool('world_enter', {}, 30000);
    const agentId = (/agentId=([^\s)）]+)/.exec(enter.text) || [])[1];
    if (enter.isError && /GUEST_TICKET_RATE_LIMITED/.test(enter.text)) {
      console.log('FATAL: 本机 IP 游客签票额度已满（10 张/小时）。重启本地服务器可清空内存计数器。');
      R.check('M4a 游客 world_enter 成功', false, enter.text.slice(0, 160));
      return;
    }
    R.check('M4a 游客 world_enter 成功并返回身份（agentId）', !enter.isError && enter.text.includes('已进入世界') && Boolean(agentId),
      enter.isError ? enter.text.slice(0, 200) : { agentId });
    const join = await waitJoin(human.msgs, agentId, 8000);
    R.check('M4b 端到端：世界（真人侧客户端）真的看到该 Agent 入场', Boolean(join),
      join ? { characterId: join.payload.characterId, entityType: join.payload.entityType } : 'no PLAYER_JOINED');

    // ==================== M5：observe 结构化且紧凑 ====================
    const obs = await guest.callTool('world_observe', {}, 30000);
    R.check('M5a world_observe 成功', !obs.isError, obs.isError ? obs.text.slice(0, 160) : '');
    R.check('M5b 返回体积 < 2KB（不是原始 API JSON）', bytes(obs.text) < 2048, bytes(obs.text) + ' bytes');
    R.check('M5c 按信息密度组织（含分节标题与下一步提示）',
      obs.text.includes('【附近的人】') && obs.text.includes('【附近的物体】') && obs.text.includes('【传送门】') && obs.text.includes('下一步'));
    R.check('M5d 不含原始 JSON 字段片段', !/"(position|distance|sequence|timestamp)"\s*:/.test(obs.text));
    const pos0 = M.parseSelfPosition(obs.text);
    R.check('M5e 能读到自身坐标（后续判据依赖）', Boolean(pos0), pos0);

    // ==================== M7：walk_to 真的改变位置 ====================
    const target = { x: Math.round((pos0 ? pos0.x : 0) + 8), z: Math.round(pos0 ? pos0.z : 0) };
    const walk = await guest.callTool('world_walk_to', { x: target.x, z: target.z }, 40000);
    R.check('M7a world_walk_to 返回到达或已接受', !walk.isError && /已到达|正在走向/.test(walk.text), walk.text.slice(0, 160));
    await K.sleep(1200);
    const obs2 = await guest.callTool('world_observe', {}, 30000);
    const pos1 = M.parseSelfPosition(obs2.text);
    const moved = pos0 && pos1 ? Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z) : 0;
    R.check('M7b 位置真的变化（observe 前后 self.position 对比）', moved > 4, { from: pos0, to: pos1, moved: Number(moved.toFixed(2)) });

    // ==================== M6：say 端到端（灵魂判据 ①）====================
    // 第二个客户端 = 真人侧观察者（与浏览器同一条 WS 管线），位置贴着 Agent，确保在 30m 气泡范围内
    const human2 = await K.openHumanWs({
      characterId: 'mcp-accept-witness',
      characterName: 'MCP验收见证者',
      position: { x: (pos1 ? pos1.x : 0) + 4, y: 0, z: pos1 ? pos1.z : 0 }
    });
    onCleanup(() => K.closeAll(human2.ws));
    await K.sleep(600);
    const sayText = 'MCP-E2E-' + Date.now().toString().slice(-6) + ' 你好，我是被派来参观的 AI';
    const say = await guest.callTool('world_say', { text: sayText }, 30000);
    R.check('M6a MCP 侧 world_say 成功', !say.isError && say.text.includes('已说出'), say.text.slice(0, 160));
    const chat = await waitChat(human2.msgs, sayText.slice(0, 14), 8000);
    R.check('M6b 端到端：第二个客户端在世界里真的收到了这句话', Boolean(chat),
      chat ? { from: chat.payload.sender, characterId: chat.payload.characterId } : 'no CHAT');
    await K.sleep(900);   // 等异步落库
    const hist = await guest.callTool('world_chat_history', { limit: 10 }, 30000);
    R.check('M6c 消息已落库且能通过 world_chat_history 读回', !hist.isError && hist.text.includes(sayText.slice(0, 14)),
      hist.isError ? hist.text.slice(0, 120) : hist.text.split('\n').slice(0, 3).join(' / '));

    // ==================== M13：description 完整透出（灵魂判据 ②）====================
    const posNow = M.parseSelfPosition((await guest.callTool('world_observe', { maxBytes: 700 }, 30000)).text) || pos1 || { x: 0, z: 0 };
    const db = require('../src/database/db');
    const near = await db.query(
      `SELECT id, name, agent_description FROM world_objects
       WHERE position_x BETWEEN $1 AND $2 AND position_z BETWEEN $3 AND $4
       ORDER BY (position_x - $5)^2 + (position_z - $6)^2 ASC LIMIT 1`,
      [posNow.x - 30, posNow.x + 30, posNow.z - 30, posNow.z + 30, posNow.x, posNow.z]
    );
    const obj = near.rows[0];
    if (!obj) {
      R.check('M13a 找到附近的世界对象用于描述校验', false, '附近 30m 内没有 world_objects');
    } else {
      const testDesc = 'MCP-E2E 描述校验：这里是一间教室，内含 28 个学生模型与 4 张课桌，靠近可交互但无实际功能。';
      const put = await M.httpJson('/api/world/objects/' + obj.id, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + adminToken },
        body: { agent_description: testDesc }
      });
      R.check('M13a 通过 API 写入测试描述成功', put.status === 200, { id: obj.id, name: obj.name, status: put.status });
      const o3 = await guest.callTool('world_observe', { maxBytes: 4000 }, 30000);
      R.check('M13b description 完整透出（>20 字且与写入值一致）',
        !o3.isError && o3.text.includes(testDesc), { id: obj.id, hit: o3.text.includes(testDesc) });
      // 还原
      const back = await M.httpJson('/api/world/objects/' + obj.id, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + adminToken },
        body: { agent_description: obj.agent_description || null }
      });
      const after = await db.query('SELECT agent_description FROM world_objects WHERE id = $1', [obj.id]);
      R.check('M13c 测试描述已还原（不留脏数据）',
        back.status === 200 && (after.rows[0] || {}).agent_description === obj.agent_description,
        { restored: (after.rows[0] || {}).agent_description === obj.agent_description });
    }

    // ==================== M8：空闲超时 / 被踢后透明重连（Key 档）====================
    keyCli = new M.McpStdioClient({ name: 'key', env: { AGENT_HOST: K.BASE, AGENT_API_KEY: keyAgent.apiKey } });
    onCleanup(() => keyCli && keyCli.stop());
    await keyCli.start();
    const ke1 = await keyCli.callTool('world_enter', {}, 30000);
    R.check('M8a Key 档 world_enter 成功', !ke1.isError && ke1.text.includes('已进入世界'), ke1.text.slice(0, 160));
    // 用同一个 Agent 的第二条连接顶替它（服务端 close 4004 REPLACED_BY_NEW_CONNECTION）→ 模拟"被踢"
    const kickToken = await sessionToken(keyAgent.apiKey);
    const kicker = await K.openAgentWs({ token: kickToken });
    R.info('顶替连接', kicker.ok ? 'connected（MCP 那条应被服务端踢掉）' : kicker.error);
    await K.sleep(1200);
    K.closeAll(kicker.ws);
    await K.sleep(800);
    const ke2 = await keyCli.callTool('world_enter', {}, 30000);
    R.check('M8b 被踢后再次调用工具 → 透明重连（报"已重新进入世界"）',
      !ke2.isError && ke2.text.includes('已重新进入世界'), ke2.text.slice(0, 160));
    const keyAgentId = (/agentId=([^\s)）]+)/.exec(ke2.text) || [])[1];
    const rejoin = await waitJoin(human.msgs, keyAgentId, 6000);
    R.check('M8c 重连后世界里重新看到它（presence 已重新登记）', Boolean(rejoin),
      rejoin ? { characterId: rejoin.payload.characterId } : 'no PLAYER_JOINED');

    // ==================== M9：Key 档续期（压窗口）====================
    const fresh = await M.httpJson('/api/agent/v1/session', {
      method: 'POST', headers: { Authorization: 'Bearer ' + keyAgent.apiKey }, body: {}
    });
    const p = fresh.json && fresh.json.token ? decode(fresh.json.token) : null;
    const expired = p ? jwt.sign(
      { sub: p.sub, principalType: 'agent', worldId: p.worldId, scopes: p.scopes },
      SECRET, { jwtid: p.jti, expiresIn: -60 }
    ) : null;
    const stale = expired ? await M.httpJson('/api/agent/v1/observe?radius=30', { headers: { Authorization: 'Bearer ' + expired } }) : { status: 0, json: null };
    R.check('M9a 自签过期 token 确实被拒（HTTP 403 TOKEN_EXPIRED，窗口真的被压缩）',
      stale.status === 403 && stale.json && stale.json.code === 'TOKEN_EXPIRED',
      { status: stale.status, code: stale.json && stale.json.code });
    // 先验证 Key 档 MCP 侧 HTTP 通路（此时 keyCli 还连着），再停掉它做进程内续期测试，
    // 否则进程内客户端会以同一 Agent 建连、按 max_connections_per_agent=1 把 keyCli 顶替掉。
    const keyObs = await keyCli.callTool('world_observe', {}, 30000);
    R.check('M9d Key 档 MCP 侧 observe 可用（HTTP 通路正常）', !keyObs.isError && /观察半径/.test(keyObs.text), keyObs.text.split('\n')[2] || '');
    await keyCli.stop();   // 保留对象引用：M11 要检查它的 stderr

    const { WorldClient } = await import(pathToFileURL(MCP_WORLD_CLIENT).href);
    const ren = new WorldClient({ host: K.BASE, apiKey: keyAgent.apiKey, log: () => {} });
    onCleanup(() => ren.close());
    await ren.ensureWs();
    const connects0 = ren.wsConnectCount;
    ren.token = expired;                 // 把内存里的 token 换成已过期的（同 jti，只有 exp 不同）
    ren.tokenExpiresAt = Date.now() - 60000;
    let renewOk = null;
    try { renewOk = await ren.observe({ radius: 30 }); } catch (e) { renewOk = { error: e }; }
    R.check('M9b 客户端自动换票后 HTTP 恢复可用', Boolean(renewOk && renewOk.body && renewOk.body.success === true),
      renewOk && renewOk.error ? renewOk.error.toText() : 'observe ok');
    R.check('M9c 续期**没有**重连 WS（wsConnectCount 不变且 socket 仍 open）',
      ren.wsConnectCount === connects0 && ren.ws && ren.ws.readyState === 1,
      { before: connects0, after: ren.wsConnectCount, readyState: ren.ws && ren.ws.readyState });
    await ren.close();

    // ==================== M10：错误可读性 ====================
    await K.sleep(5500);                 // 游客档 say 限频 1 条/5 秒，先等够再制造"第二条被限频"
    const say1 = await guest.callTool('world_say', { text: 'MCP rate test 1' }, 30000);
    const say2 = await guest.callTool('world_say', { text: 'MCP rate test 2' }, 30000);
    R.info('限频复现', { first: say1.isError ? 'error' : 'ok', second: say2.isError ? 'error' : 'ok' });
    R.check('M10a 触发 rate_limited 时返回可读文案（不是裸错误码）',
      say2.isError && /限频|过于频繁/.test(say2.text) && /秒|重试/.test(say2.text) && !/^ACTION_REJECTED/.test(say2.text),
      say2.text.slice(0, 200));

    // teleport：MCP 侧**没有**这个工具，直接走客户端 action 通道验证"服务端红线仍然生效、且错误可读"
    const attacker = new WorldClient({ host: K.BASE, apiKey: (agentB || keyAgent).apiKey, log: () => {} });
    onCleanup(() => attacker.close());
    let tpErr = null;
    try {
      await attacker.ensureWs();
      const res = await attacker.action('teleport', { target: { x: 100, z: 100 } });
      const { interpretReceipt } = await import(pathToFileURL(MCP_WORLD_CLIENT).href);
      interpretReceipt(res);
    } catch (e) { tpErr = e; }
    R.check('M10b teleport 被服务端拒绝且文案可读（含红线说明）',
      Boolean(tpErr) && String(tpErr.code) === 'scope_denied' && /红线|teleport/.test(tpErr.toText()),
      tpErr ? tpErr.toText().slice(0, 200) : 'no error');
    await attacker.close();

    // ==================== M14：协议兜底（不盲信发现文档）====================
    const stub = new WorldClient({ host: 'https://example.test', apiKey: 'dummy', log: () => {} });
    const origFetch = global.fetch;
    global.fetch = async (url, init) => {
      if (String(url).includes('.well-known')) {
        return new Response(JSON.stringify({
          success: true,
          world: { id: 'w_doc', name: '文档世界' },
          endpoints: { apiBase: 'http://example.test/api/agent/v1', websocket: 'ws://example.test/ws/agent' },
          auth: { sessionTtlSeconds: 900, guestSessionTtlSeconds: 1800 },
          agentEnabled: true
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return origFetch(url, init);
    };
    let stubOk = false;
    try { await stub.discover(); stubOk = true; } catch (e) { stubOk = false; }
    global.fetch = origFetch;
    R.check('M14a 发现文档广播 http 时，端点仍按 AGENT_HOST 的 https 推导',
      stubOk && stub.endpoints.apiBase === 'https://example.test/api/agent/v1' && stub.endpoints.wsUrl === 'wss://example.test/ws/agent',
      { apiBase: stub.endpoints.apiBase, websocket: stub.endpoints.wsUrl });
    R.check('M14b 检测到协议不一致并提示 X-Forwarded-Proto', stub.protocolMismatch === true && stub.notes.some((n) => n.includes('X-Forwarded-Proto')));

    const online = new WorldClient({ host: ONLINE_HOST, log: () => {} });
    let onlineDoc = null;
    try { onlineDoc = await online.discover(); } catch (e) { onlineDoc = null; }
    if (onlineDoc) {
      const docProto = (/^([a-z]+):\/\//.exec((onlineDoc.endpoints && onlineDoc.endpoints.apiBase) || '') || [])[1] || '?';
      R.check('M14c 线上 https 站点可正常发现（TLS 通路 + 端点按 AGENT_HOST 协议）',
        online.endpoints.apiBase.startsWith('https://') && online.endpoints.wsUrl.startsWith('wss://'),
        { host: ONLINE_HOST, docProtocol: docProto, protocolMismatch: Boolean(online.protocolMismatch) });
    } else {
      R.info('M14c 线上站点不可达（本机网络/站点状态），跳过；M14a/b 已证明协议兜底逻辑', ONLINE_HOST);
    }

    // ==================== M11：子进程无致命错误 + 主项目回归 ====================
    const badLines = [...guest.stderrLines, ...keyCli.stderrLines].filter((l) => /FATAL|UnhandledPromiseRejection|TypeError|ReferenceError/.test(l));
    R.check('M11a MCP server 子进程无致命报错（stderr 干净）', badLines.length === 0, badLines.slice(0, 3));
    const smoke = await runSmoke(adminToken);
    const m = /(\d+)\/(\d+) passed/.exec(smoke.out);
    R.check('M11b 主项目回归 smoke_r185_world.js 全绿',
      Boolean(m) && m[1] === m[2], m ? m[0] : smoke.out.slice(-200));
  } catch (e) {
    R.check('验收流程未抛异常', false, String((e && e.message) || e));
    console.error(e);
  } finally {
    // ==================== 收尾 ====================
    for (const fn of cleanups) { try { await fn(); } catch (e) { /* noop */ } }
    if (adminToken) {
      try {
        await M.setAgentEnabled(adminToken, origEnabled);
        const cfg1 = await M.getAgentConfig(adminToken);
        R.check('M12 收尾 agent_enabled 恢复运行前的值（红线 9）',
          Boolean(cfg1) && Boolean(cfg1.agentEnabled) === origEnabled,
          { before: origEnabled, after: cfg1 && cfg1.agentEnabled });
      } catch (e) {
        R.check('M12 收尾 agent_enabled 恢复运行前的值（红线 9）', false, e.message);
      }
    }
    const s = R.summary();
    // ⚠️ 必须用 process.exit：本脚本用过项目 db 连接池 + 多处 fetch，
    // 自然退出在 Windows 上会撞 UV_HANDLE_CLOSING 断言（噪音，不影响判据）。
    process.exit(s.fail ? 1 : 0);
  }
})();
