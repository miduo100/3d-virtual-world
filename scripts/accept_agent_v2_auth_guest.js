/**
 * AI Agent 接入 v2 联测 —— 游客档（guest-pull）登录/鉴权边界用例矩阵
 *
 * 覆盖提示词 §1.1 用例表全部条目（除"票 30 分钟到期"用合成过期 token 代替、多端部分在 Key 脚本）：
 *   A 发现端点公开性 / B 签票 / C WS 鉴权边界 / D observe 边界 / E 动作边界
 *   F 签票限流 / G 聊天历史 / H 总开关（临时关闭再恢复）/ X 瞬时断开泄漏回归（缺陷 v2-1）
 *
 * 运行：node scripts/accept_agent_v2_auth_guest.js
 * 报告：examples/agent-client/live/v2-auth-guest.json
 *
 * 注意：H 组会临时把 agent_enabled 置 false 再恢复 true；F 组会烧掉 198.51.100.77 的签票窗口。
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const K = require('./agentV2TestKit');

const R = K.createReporter('游客档登录/鉴权边界矩阵');
const sleep = K.sleep;

// 每次运行的 IP 窗口随运行序号偏移：
// ① 避免与上一次运行已"烧掉"的签票窗口（10 张/小时）或已泄漏的连接名额撞车；
// ② 服务端重启会清空全部内存窗口，届时可复位。
const RUN = (Math.floor(Date.now() / 1000) % 90) + 10;   // 10..99
// 签票窗口与"WS 连接名额"解耦：票不绑定 IP，只有"每 IP 并发 1 连接"按连接来源 IP 计。
// 因此下面把"会被关闭的连接"与"后续断言依赖的主连接"分到不同 IP，
// 避免缺陷 v2-1（关闭时名额可能不释放）级联污染其他用例。
const OWNER_IP = `203.0.113.${RUN}`;           // 签票来源 IP（B 组）
const AUTH_IP = `203.0.113.${RUN + 30}`;       // C7 一次性连接（Authorization 头验证，随即可关）
const MAIN_IP = `203.0.113.${RUN + 40}`;       // 主连接 IP（C7b~C17b）
const OWNER_IP2 = `203.0.113.${RUN + 100}`;    // 第二个 IP（并发在线用）
const C18_IP = `203.0.113.${RUN + 120}`;       // C18 备用 IP（主连接若被泄漏名额阻塞则切换）
const RATE_IP = `198.51.100.${RUN}`;           // 签票限流专用 IP（会烧掉 10 张窗口）
const FRESH_IP = `203.0.113.${RUN + 50}`;
const FRESH_IP2 = `203.0.113.${RUN + 150}`;
const X_OBSERVER_IP = `203.0.113.${RUN + 70}`; // 缺陷 v2-1 复现：观察幽灵实体的 IP

const openSockets = [];

function secret() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const m = env.match(/^AGENT_JWT_SECRET=(.*)$/m);
  return m ? m[1].trim() : null;
}

// 管理员登录有 per-IP 限流（5 次/分钟），必须缓存 token 复用
let _adminToken = null;
async function adminToken() {
  if (_adminToken) return _adminToken;
  const r = await K.httpJson('/api/admin-auth/login', {
    method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
  });
  const j = r.json || {};
  _adminToken = j.token || (j.data && j.data.token) || null;
  return _adminToken;
}

async function setAgentEnabled(value) {
  const t = await adminToken();
  if (!t) return { ok: false, error: 'admin_login_failed' };
  const r = await K.httpJson('/api/agent/v1/admin/config', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + t }, body: { agent_enabled: value }
  });
  return { ok: r.status === 200, status: r.status, json: r.json };
}

async function readPushDefault() {
  const t = await adminToken();
  const r = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + t } });
  const cfg = (r.json && (r.json.config || r.json)) || {};
  return cfg.agent_push_default || cfg.pushDefault || 'eco';
}

async function setPushDefault(value) {
  const t = await adminToken();
  const r = await K.httpJson('/api/agent/v1/admin/config', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + t }, body: { agent_push_default: value }
  });
  return r.status === 200;
}

// ==================== A. 发现端点（公开无鉴权）====================

async function groupA() {
  const wk = await K.httpJson('/.well-known/virtual-world-agent.json');
  const cap = await K.httpJson('/api/agent/v1/capabilities');
  const oa = await K.httpJson('/api/agent/v1/openapi.json');
  R.check('A1 well-known 公开 200', wk.status === 200, { status: wk.status });
  R.check('A2 capabilities 公开 200', cap.status === 200, { status: cap.status });
  R.check('A3 openapi.json 公开 200', oa.status === 200, { status: oa.status });
  if (!wk.json || !cap.json || !oa.json) return { wk: wk.json, cap: cap.json, oa: oa.json };

  R.check('A4 well-known.agentEnabled=true（联测期）', wk.json.agentEnabled === true, wk.json.agentEnabled);
  R.check('A5 tiers.default=guest-pull', wk.json.tiers && wk.json.tiers.default === 'guest-pull', wk.json.tiers && wk.json.tiers.default);
  R.check('A6 limits.observeRadiusMaxGuest=30（红线 15）',
    wk.json.limits && wk.json.limits.observeRadiusMaxGuest === 30, wk.json.limits && wk.json.limits.observeRadiusMaxGuest);

  const a = wk.json.entityIdentity, b = cap.json.entityIdentity, c = oa.json['x-entity-identity'];
  R.check('A7 entityIdentity 三处同源同形（F/H 契约）',
    a && b && c && JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(c),
    { wk: !!a, cap: !!b, openapi: !!c });
  R.check('A8 uniqueIdField=id', a && a.uniqueIdField === 'id', a && a.uniqueIdField);

  const capLimits = cap.json.limits, wkLimits = wk.json.limits;
  R.check('A9 capabilities 与 well-known limits 同源（H 修复）',
    JSON.stringify(capLimits) === JSON.stringify(wkLimits), { cap: !!capLimits, wk: !!wkLimits });
  R.check('A10 openapi 含 /guest/session（P8）',
    !!(oa.json.paths && oa.json.paths['/guest/session']), Object.keys((oa.json.paths) || {}).length + ' paths');
  R.check('A11 capabilities 不泄漏密钥类字段',
    !/apiKey|api_key|secret/i.test(JSON.stringify(cap.json)), '无 apiKey/secret 字样');
  return { wk: wk.json, cap: cap.json, oa: oa.json };
}

// ==================== B. 签票 ====================

async function groupB(ip) {
  const r = await K.guestTicket(ip);
  R.check('B1 无鉴权头签票 200', r.status === 200, { status: r.status, code: r.json && r.json.code });
  const j = r.json || {};
  R.check('B2 tier=guest-pull / mode=pull', j.tier === 'guest-pull' && j.mode === 'pull', { tier: j.tier, mode: j.mode });
  R.check('B3 expiresIn=1800（30min）', j.expiresIn === 1800, j.expiresIn);
  R.check('B4 agent.id 形如 agent:guest:<uuid>', typeof j.agent === 'object' && /^agent:guest:[0-9a-f-]{36}$/.test(j.agent.id), j.agent && j.agent.id);
  R.check('B5 agent.name 以 游客AI- 开头', typeof j.agent === 'object' && /^游客AI-/.test(j.agent.name), j.agent && j.agent.name);
  R.check('B6 tierInfo.pushAllowed=false（红线 14）', j.tierInfo && j.tierInfo.pushAllowed === false, j.tierInfo && j.tierInfo.pushAllowed);
  R.check('B7 tierInfo.observeMaxRadius=30', j.tierInfo && j.tierInfo.observeMaxRadius === 30, j.tierInfo && j.tierInfo.observeMaxRadius);
  R.check('B8 scopes 为游客级白名单且无 teleport',
    Array.isArray(j.agent.scopes) && j.agent.scopes.includes('observe') && !j.agent.scopes.includes('teleport'),
    j.agent.scopes);
  R.check('B9 响应不包含 API Key 明文', !/agk_live_/.test(r.text), '无 agk_live_ 字样');
  R.check('B10 ticketRemaining 为数字（限流窗口可见）', Number.isFinite(j.ticketRemaining), j.ticketRemaining);
  return j;
}

// ==================== C. WS 鉴权边界 ====================

async function groupC(ownerTicket, ownerAgentId) {
  const noTok = await K.openAgentWs({});
  R.check('C1 无 token 连 /ws/agent → 401', noTok.ok === false && noTok.statusCode === 401, noTok.statusCode || noTok.error);

  const fake = await K.openAgentWs({ token: 'not-a-jwt-at-all' });
  R.check('C2 伪造 token → 401', fake.ok === false && fake.statusCode === 401, fake.statusCode || fake.error);

  const s = secret();
  const badSig = jwt.sign({ sub: ownerAgentId, principalType: 'agent' }, 'wrong-secret-wrong-secret', { jwtid: 'x', expiresIn: 60 });
  const r3 = await K.openAgentWs({ token: badSig });
  R.check('C3 签名错误（格式合法）→ 401', r3.ok === false && r3.statusCode === 401, r3.statusCode || r3.error);

  const expired = jwt.sign({ sub: ownerAgentId, principalType: 'agent' }, s, { jwtid: 'expired-test', expiresIn: -10 });
  const r4 = await K.openAgentWs({ token: expired });
  R.check('C4 过期 token → 403（TOKEN_EXPIRED）', r4.ok === false && r4.statusCode === 403, r4.statusCode || r4.error);

  const noSession = jwt.sign({ sub: ownerAgentId, principalType: 'agent' }, s, { jwtid: 'no-such-session-' + Date.now(), expiresIn: 300 });
  const r5 = await K.openAgentWs({ token: noSession });
  R.check('C5 未过期但 jti 无会话（第二道门）被拒', r5.ok === false && (r5.statusCode === 401 || r5.statusCode === 403),
    { wsStatus: r5.statusCode, auditCode: 'SESSION_NOT_FOUND（见 audit.log）' });
  const httpSame = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: { Authorization: 'Bearer ' + noSession } });
  // v2-2 修复（2026-09-19 用户决策 D2-A）：原为 R.info 记录的观察项（WS=401 / HTTP=403），
  // 现 WS 侧 SESSION_* 也映射 403 → 提升为正式断言。
  R.check('C5b 口径统一：同一"会话不存在"在 WS 升级与 HTTP 均为 403',
    r5.statusCode === 403 && httpSame.status === 403,
    { ws: r5.statusCode, http: httpSame.status });

  const notAgent = jwt.sign({ sub: 'user-1', principalType: 'human' }, s, { jwtid: 'x2', expiresIn: 300 });
  const r6 = await K.openAgentWs({ token: notAgent });
  R.check('C6 principalType≠agent → 401（不与用户 JWT 混用）', r6.ok === false && r6.statusCode === 401, r6.statusCode || r6.error);

  // C7 主路径：Authorization: Bearer <游客票>（用一次性 IP，避免其关闭动作影响主连接）
  const connA = await K.openAgentWs({ token: ownerTicket, authHeader: 'Bearer ' + ownerTicket, ip: AUTH_IP });
  R.check('C7 有效游客票（Authorization 头，主路径）可进场', connA.ok === true, connA.ok ? 'upgraded' : (connA.statusCode || connA.error));
  if (!connA.ok) return { conn: null };
  await sleep(700);
  K.closeAll(connA.ws);
  await sleep(900);

  // C7b 降级路径：?token=，且使用**专用主连接 IP**（本组后续断言全部依赖它）
  const conn = await K.openAgentWs({ token: ownerTicket, ip: MAIN_IP });
  if (conn.ok) openSockets.push(conn.ws);
  R.check('C7b 游客票走查询参数（?token= 降级路径）可进场',
    conn.ok === true, conn.ok ? 'upgraded' : (conn.statusCode || conn.error));
  if (!conn.ok) return { conn: null };
  const ready = await K.waitFor(conn.msgs, 'READY');
  const snap = await K.waitFor(conn.msgs, 'WORLD_SNAPSHOT');
  R.check('C8 READY.pushTier=eco（红线 14）', ready && ready.payload.pushTier === 'eco', ready && ready.payload.pushTier);
  R.check('C9 READY.tier=guest-pull', ready && ready.payload.tier === 'guest-pull', ready && ready.payload.tier);
  R.check('C10 READY 带 tierInfo.pushAllowed=false', ready && ready.payload.tierInfo && ready.payload.tierInfo.pushAllowed === false,
    ready && ready.payload.tierInfo && ready.payload.tierInfo.pushAllowed);
  R.check('C11 READY 后立刻收到 WORLD_SNAPSHOT', snap !== null, snap ? 'ok' : 'missing');
  R.check('C12 WORLD_SNAPSHOT.self.id = 本 Agent', snap && snap.payload.self && snap.payload.self.id === ownerAgentId,
    snap && snap.payload.self && snap.payload.self.id);

  // C14 SUBSCRIBE 被拒（红线 14）
  K.wsSend(conn.ws, { type: 'SUBSCRIBE', payload: { topics: ['chat', 'presence', 'movement'] } });
  const errMsg = await K.waitFor(conn.msgs, 'ERROR', 3000);
  R.check('C14 游客 SUBSCRIBE → GUEST_PUSH_FORBIDDEN',
    !!errMsg && errMsg.payload && errMsg.payload.code === 'GUEST_PUSH_FORBIDDEN', errMsg && errMsg.payload && errMsg.payload.code);

  // C15 PING → PONG
  const beforePong = conn.msgs.length;
  K.wsSend(conn.ws, { type: 'PING' });
  await sleep(600);
  const pong = conn.msgs.slice(beforePong).find(m => m.type === 'PONG');
  R.check('C15 PING → PONG', !!pong, pong ? 'ok' : 'no pong');

  // C16 同 IP 第 2 条连接 → 并发拒绝（conn 仍开着）
  const dup = await K.openAgentWs({ token: ownerTicket, ip: MAIN_IP });
  if (dup.ok) openSockets.push(dup.ws);
  const dupErr = dup.ok ? await K.waitFor(dup.msgs, 'ERROR', 3000) : null;
  const dupClose = dup.ok ? await K.waitClose(dup.closeInfo, 4000) : null;
  R.check('C16 同 IP 第 2 条连接 → GUEST_IP_CONCURRENCY + close 1013',
    dup.ok === true && dupErr && dupErr.payload.code === 'GUEST_IP_CONCURRENCY' && dupClose && dupClose.code === 1013,
    { code: dupErr && dupErr.payload && dupErr.payload.code, closeCode: dupClose && dupClose.code });

  // C17 不同 IP 的第二位游客可同时在线（D2 修复 / 反代 IP 口径）
  const t2 = await K.guestTicket(OWNER_IP2);
  const guest2 = t2.ticket ? await K.openAgentWs({ token: t2.ticket.token, ip: OWNER_IP2 }) : { ok: false };
  if (guest2.ok) openSockets.push(guest2.ws);
  const ready2 = guest2.ok ? await K.waitFor(guest2.msgs, 'READY', 4000) : null;
  R.check('C17 不同真实 IP 的游客可同时在线（per-IP 并发隔离）',
    guest2.ok === true && !!ready2, guest2.ok ? (ready2 ? 'both online' : 'no READY') : (t2.status || guest2.statusCode));
  if (guest2.ok) { K.closeAll(guest2.ws); await sleep(500); }

  // C17b 正常关闭（已收到 READY = 服务端 close 监听器必已挂上）后，同 IP 名额应立即释放
  //      —— 这是区分"瞬时断开竞态（v2-1）"与"任何关闭都泄漏"的关键用例
  K.closeAll(conn.ws);
  await sleep(900);
  const re = await K.openAgentWs({ token: ownerTicket, ip: MAIN_IP });
  if (re.ok) openSockets.push(re.ws);
  const reErr = re.ok ? await K.waitFor(re.msgs, 'ERROR', 1500) : null;
  const slotStuck = !!(reErr && reErr.payload && reErr.payload.code === 'GUEST_IP_CONCURRENCY');
  R.check('C17b 正常关闭后同 IP 应立即释放名额（可重连）',
    re.ok === true && !slotStuck, { reopen: re.ok, 名额卡死: slotStuck });

  // C18 红线 14 强断言：后台默认档设为 realtime，游客仍 eco
  const origDefault = await readPushDefault();
  const changed = await setPushDefault('realtime');
  await sleep(300);
  if (re.ok) { K.closeAll(re.ws); await sleep(900); }
  let conn3 = await K.openAgentWs({ token: ownerTicket, ip: MAIN_IP });
  let ready3 = conn3.ok ? await K.waitFor(conn3.msgs, 'READY', 4000) : null;
  if (!ready3) {
    // 主连接 IP 若被 v2-1 泄漏的名额卡住 → 换备用 IP 继续（并记录）
    R.info('C18 前置：主连接 IP 名额被占用，切换备用 IP', { mainIp: MAIN_IP, fallback: C18_IP });
    if (conn3.ok) K.closeAll(conn3.ws);
    await sleep(600);
    conn3 = await K.openAgentWs({ token: ownerTicket, ip: C18_IP });
    ready3 = conn3.ok ? await K.waitFor(conn3.msgs, 'READY', 4000) : null;
  }
  R.check('C18 后台默认档=realtime 时游客 READY.pushTier 仍为 eco（红线 14 强断言）',
    ready3 !== null && ready3.payload.pushTier === 'eco',
    { pushDefault: 'realtime(临时)', pushTier: ready3 && ready3.payload.pushTier });
  if (conn3.ok) openSockets.push(conn3.ws);
  await setPushDefault(origDefault);   // 恢复
  R.info('C18b 后台默认档已恢复', origDefault + (changed ? '' : '（原值读取异常）'));
  // conn3 作为后续 D/E/G 组的主连接（保持打开）
  return { conn: ready3 ? conn3 : null };
}

// ==================== X. 瞬时断开 → 名额/实体泄漏（缺陷 v2-1，已修复 2026-09-19）====================
// 现象（修复前，实测 3/3）：客户端在 upgrade 成功瞬间断开（e.g. 探活脚本、客户端崩溃、立刻 cancel），
//       服务端 handleClose 不执行 → ①每 IP 并发名额永久占用 ②playerPositions 幽灵实体常驻
// 根因（代码级）：agentWsServer.js 的 wss.on('connection') 是 async 函数，
//       ws.on('close')/ws.on('message') 注册在函数末尾，中间隔着
//       `await agentConfigService.getConfig()` 与 `await agentSessionManager.getLatestPosition()`
//       两次异步等待；若 close 帧先到，Node 已经 emit 过 'close'，监听器永远挂不上。
// 修复：① 监听器前置注册（早于任何 await）+ ② await 后 readyState 兜底（早退归还每 IP 名额）。
//       专项验收（含审计日志证据 / jump 回执）见 scripts/accept_agent_v2_defects_fix.js（7/7）。
async function groupX() {
  const ATTEMPTS = 3;
  const results = [];

  // 独立的"观察者"游客（另一个 IP 常驻），用于查幽灵实体；
  // 每个尝试用**独立票**且事后不再用该票连接 → entities 里同 id 出现即确定为幽灵。
  const obsT = await K.guestTicket(X_OBSERVER_IP);
  if (!obsT.ticket) {
    R.check('X0 缺陷 v2-1 复现前置：观察者签票成功', false, obsT.status);
    return { results };
  }
  const obs = await K.openAgentWs({ token: obsT.ticket.token, ip: X_OBSERVER_IP });
  if (!obs.ok) {
    R.check('X0 缺陷 v2-1 复现前置：观察者连接成功', false, obs.statusCode || obs.error);
    return { results };
  }
  openSockets.push(obs.ws);
  await K.waitFor(obs.msgs, 'READY', 4000);

  for (let i = 0; i < ATTEMPTS; i++) {
    const ip = `203.0.113.${RUN + 60 + i}`;
    const t = await K.guestTicket(ip);
    if (!t.ticket) { results.push({ attempt: i + 1, ip, error: 'ticket_' + t.status }); continue; }
    const agentId = t.ticket.agent.id;
    const c = await K.openAgentWs({ token: t.ticket.token, ip });
    if (!c.ok) { results.push({ attempt: i + 1, ip, error: 'upgrade_' + (c.statusCode || c.error) }); continue; }
    K.closeAll(c.ws);                       // 瞬时断开：不等 READY、不等任何消息
    await sleep(1600);

    // ① 幽灵实体（该票之后不再连接 → 出现即泄漏）
    const r = await K.httpJson('/api/agent/v1/observe?radius=200', { headers: { Authorization: 'Bearer ' + obsT.ticket.token } });
    const ghost = r.status === 200 && ((r.json.entities || []).some(e => e.id === agentId));

    // ② 每 IP 名额泄漏：同 IP 用**新票**再连（新 agent，不会走同 agent 顶替）
    let slotLeak = null;
    const t2 = await K.guestTicket(ip);
    if (t2.ticket) {
      const c2 = await K.openAgentWs({ token: t2.ticket.token, ip });
      if (c2.ok) {
        const e = await K.waitFor(c2.msgs, 'ERROR', 1500);
        slotLeak = !!(e && e.payload && e.payload.code === 'GUEST_IP_CONCURRENCY');
        if (slotLeak) openSockets.push(c2.ws);
        else { K.closeAll(c2.ws); await sleep(700); }
      } else { slotLeak = false; }
    }
    results.push({ attempt: i + 1, ip, agentId, ghost, slotLeak });
    await sleep(800);                       // 让观察者的 observe 限频窗口（1 次/2s）过去
  }

  const ghosts = results.filter(x => x.ghost).length;
  const leaks = results.filter(x => x.slotLeak === true).length;
  const bad = results.filter(x => x.error).length;
  R.check('X1 瞬时断开后同 IP 用新票可立刻重连（名额未被永久占用，v2-1 修复）',
    leaks === 0, { 泄漏次数: leaks, 尝试次数: ATTEMPTS, 失败尝试: bad });
  R.check('X2 瞬时断开后不留下幽灵 AI 实体（真人会看到不动的 avatar，v2-1 修复）',
    ghosts === 0, { 幽灵次数: ghosts, 尝试次数: ATTEMPTS });
  if (ghosts) {
    R.info('幽灵实体明细（真人在世界里可见、observe 也返回）',
      results.filter(x => x.ghost).map(x => x.agentId));
  }
  return { results, ghosts, leaks };
}

// ==================== D. observe 边界 ====================

async function groupD(ticket, agentId) {
  const auth = { Authorization: 'Bearer ' + ticket };

  const d1 = await K.httpJson('/api/agent/v1/observe?radius=200', { headers: auth });
  R.check('D1 游客 observe?radius=200 → 静默钳到 30（不报错）',
    d1.status === 200 && d1.json.radius === 30, { status: d1.status, radius: d1.json && d1.json.radius });
  const j = d1.json || {};
  R.check('D2 响应结构完整（world/self/entities/objects/portals/timestamp/sequence）',
    !!(j.world && j.self && Array.isArray(j.entities) && Array.isArray(j.objects) && Array.isArray(j.portals) && j.timestamp !== undefined && j.sequence !== undefined),
    { entities: (j.entities || []).length, objects: (j.objects || []).length, portals: (j.portals || []).length });
  R.check('D3 self.id = 本 Agent（同一命名空间）', j.self && j.self.id === agentId, j.self && j.self.id);
  R.check('D4 tier 字段回显 guest-pull', j.tier === 'guest-pull', j.tier);

  const d2 = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: auth });
  R.check('D5 游客 2 秒内第 2 次 observe → 429 GUEST_OBSERVE_RATE_LIMITED',
    d2.status === 429 && d2.json.code === 'GUEST_OBSERVE_RATE_LIMITED',
    { status: d2.status, code: d2.json && d2.json.code, retryAfter: d2.json && d2.json.retryAfter });
  R.check('D6 429 带 retryAfter（秒）', d2.json && Number.isFinite(d2.json.retryAfter) && d2.json.retryAfter >= 1, d2.json && d2.json.retryAfter);

  const d3 = await K.httpJson('/api/agent/v1/observe?radius=30');
  R.check('D7 observe 无 token → 401', d3.status === 401, d3.status);

  await sleep(2200);
  const d4 = await K.httpJson('/api/agent/v1/observe?radius=10', { headers: auth });
  R.check('D8 小于上限时保留请求值（radius=10 → 10）', d4.status === 200 && d4.json.radius === 10,
    { status: d4.status, radius: d4.json && d4.json.radius });

  await sleep(2200);
  const d5 = await K.httpJson('/api/agent/v1/observe?radius=-5', { headers: auth });
  R.check('D9 非法 radius（负值）→ 回落上限 30', d5.status === 200 && d5.json.radius === 30,
    { status: d5.status, radius: d5.json && d5.json.radius });
  return d1.json;
}

// ==================== E. 动作边界（游客）====================

function action(conn, obj) {
  const requestId = 't' + Math.random().toString(36).slice(2, 10);
  K.wsSend(conn.ws, { type: 'ACTION', payload: { requestId, ...obj } });
  return requestId;
}

async function waitAction(msgs, requestId, types, timeoutMs = 6000) {
  return waitActionWhere(msgs, m => types.includes(m.type) && m.payload && m.payload.requestId === requestId, timeoutMs);
}

async function waitActionWhere(msgs, pred, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find(pred);
    if (hit) return hit;
    await sleep(50);
  }
  return null;
}

async function groupE(conn, ticket) {
  const auth = { Authorization: 'Bearer ' + ticket };

  const id1 = action(conn, { action: 'say', text: 'v2 鉴权矩阵探针' });
  const r1 = await waitAction(conn.msgs, id1, ['ACTION_COMPLETED', 'ACTION_REJECTED']);
  R.check('E1 游客 say → ACTION_COMPLETED', !!r1 && r1.type === 'ACTION_COMPLETED', r1 && (r1.payload.code || r1.type));

  const id2 = action(conn, { action: 'say', text: '立刻第二条（应被限频）' });
  const r2 = await waitAction(conn.msgs, id2, ['ACTION_COMPLETED', 'ACTION_REJECTED'], 4000);
  R.check('E2 5 秒内第 2 条 say → ACTION_REJECTED{rate_limited}',
    !!r2 && r2.type === 'ACTION_REJECTED' && r2.payload.code === 'rate_limited',
    r2 && { type: r2.type, code: r2.payload.code });

  const id3 = action(conn, { action: 'teleport', targetWorld: 'x' });
  const r3 = await waitAction(conn.msgs, id3, ['ACTION_REJECTED'], 4000);
  R.check('E3 teleport → ACTION_REJECTED（红线 2）', !!r3, r3 && { code: r3.payload.code, reason: r3.payload.reason });

  const id4 = action(conn, { action: 'set_position', position: { x: 1, y: 1, z: 1 } });
  const r4 = await waitAction(conn.msgs, id4, ['ACTION_REJECTED'], 4000);
  R.check('E4 set_position → ACTION_REJECTED（红线 10）', !!r4, r4 && { code: r4.payload.code, reason: r4.payload.reason });

  const id5 = action(conn, { action: 'move', direction: { x: 1, z: 0 } });
  const r5 = await waitAction(conn.msgs, id5, ['ACTION_ACCEPTED', 'ACTION_REJECTED'], 4000);
  R.check('E5 move → ACTION_ACCEPTED', !!r5 && r5.type === 'ACTION_ACCEPTED', r5 && (r5.payload.code || r5.type));

  await sleep(2200);   // 等 observe 限频窗口（游客 1 次/2s），否则下面这次必然 429
  const before = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: auth });
  const p0 = before.json && before.json.self && before.json.self.position;

  const id6 = action(conn, { action: 'walk_to', target: { x: 30, z: 30 } });
  const r6 = await waitAction(conn.msgs, id6, ['ACTION_ACCEPTED', 'ACTION_REJECTED'], 4000);
  const sup = await waitAction(conn.msgs, id5, ['ACTION_COMPLETED'], 4000);
  // §5.2 移动类回执契约："移动类动作（move/walk_to/jump/follow）互斥：新指令打断旧任务
  //                    并向旧 requestId 发 reason=superseded"
  // v2-3 修复前：walk_to 打断 move 时旧 move 的 requestId 收不到任何回执（实测）；
  //              修复后 startMove 注入 { requestId, reply }，被打断即补发 superseded。
  R.check('E6 move 被打断补发 ACTION_COMPLETED{superseded}（契约 §5.2，v2-3 修复）',
    !!sup && sup.payload.reason === 'superseded',
    sup ? { reason: sup.payload.reason } : '旧 move 的 requestId 未收到任何回执');
  R.check('E6b walk_to 被接受', !!r6 && r6.type === 'ACTION_ACCEPTED', r6 && (r6.payload.code || r6.type));

  await sleep(2600);
  const after = await K.httpJson('/api/agent/v1/observe?radius=30', { headers: auth });
  const p1 = after.json && after.json.self && after.json.self.position;
  const moved = p0 && p1 ? Math.hypot(p1.x - p0.x, p1.z - p0.z) : 0;
  R.check('E7 服务端限速推进生效（2.6s 内位移 > 1m）', moved > 1, { from: p0, to: p1, moved: Number(moved.toFixed(2)) });

  const id7 = action(conn, { action: 'interact', targetId: '00000000-0000-4000-8000-000000000000' });
  const r7 = await waitAction(conn.msgs, id7, ['ACTION_REJECTED', 'ACTION_COMPLETED'], 4000);
  R.check('E8 interact 目标不存在 → 被拒', !!r7 && r7.type === 'ACTION_REJECTED', r7 && { code: r7.payload.code, reason: r7.payload.reason });

  // 注意：此用例故意不带 requestId（服务端回执的 requestId 也会是 undefined），
  // 因此按 code 匹配而不是按 requestId 匹配
  K.wsSend(conn.ws, { type: 'ACTION', payload: {} });
  const r8 = await waitActionWhere(conn.msgs, m => m.type === 'ACTION_REJECTED' && m.payload && m.payload.code === 'missing_action');
  R.check('E9 ACTION 缺 action 字段 → ACTION_REJECTED{missing_action}', !!r8, r8 && r8.payload.code);

  const id9 = action(conn, { action: 'follow', targetId: '00000000-0000-4000-8000-000000000001' });
  const r9 = await waitAction(conn.msgs, id9, ['ACTION_REJECTED', 'ACTION_ACCEPTED'], 4000);
  R.check('E10 follow 目标不存在 → 被拒（不静默）', !!r9 && r9.type === 'ACTION_REJECTED', r9 && { code: r9.payload.code, reason: r9.payload.reason });

  // 观察项（v2-4）：文档"七动作"不含 stop；agentMovementService.stopMove 导出但零调用方
  // → 连续 move 只能靠 walk_to 到自身坐标 / 断线来停下，客户端无显式停止语义
  R.info('E11 观察项：连续 move 无显式停止入口（无 stop 动作；movementService.stopMove 零调用）',
    '停止手段：walk_to 到当前坐标 / 断线 / 被其它移动指令打断');
}

// ==================== F. 签票限流 ====================

async function groupF() {
  let issued = 0;
  for (let i = 1; i <= 10; i++) {
    const r = await K.guestTicket(RATE_IP);
    if (r.status === 200) issued++; else break;
  }
  R.check('F1 同一 IP 前 10 张票全部 200', issued === 10, { issued });
  const r11 = await K.guestTicket(RATE_IP);
  R.check('F2 第 11 张 → 429 GUEST_TICKET_RATE_LIMITED',
    r11.status === 429 && r11.json.code === 'GUEST_TICKET_RATE_LIMITED',
    { status: r11.status, code: r11.json && r11.json.code });
  R.check('F3 429 带 retryAfter（秒，>0）', r11.json && Number.isFinite(r11.json.retryAfter) && r11.json.retryAfter > 0,
    r11.json && r11.json.retryAfter);
  const other = await K.guestTicket(FRESH_IP);
  R.check('F4 另一 IP 不受影响 → 200（限流窗口按真实 IP 隔离）', other.status === 200, { status: other.status, code: other.json && other.json.code });
  return other.ticket;
}

// ==================== G. 聊天历史 ====================

async function groupG(ticket, observeJson) {
  const auth = { Authorization: 'Bearer ' + ticket };
  const r = await K.httpJson('/api/agent/v1/chat/history?limit=30', { headers: auth });
  R.check('G1 游客 chat/history 200', r.status === 200, { status: r.status, code: r.json && r.json.code });
  const noAuth = await K.httpJson('/api/agent/v1/chat/history?limit=5');
  R.check('G2 chat/history 无 token → 401', noAuth.status === 401, noAuth.status);

  const rows = (r.json && (r.json.messages || r.json.history || r.json.data)) || [];
  const withSender = rows.filter(x => x && (x.senderId || x.sender_id));
  if (withSender.length && observeJson) {
    const ids = new Set((observeJson.entities || []).map(e => e.id));
    const hit = withSender.filter(x => ids.has(x.senderId || x.sender_id)).length;
    R.info('G3 senderId 与 entities[].id 命名空间一致性（在线者命中数）',
      `${hit}/${withSender.length} 命中（离线发送者不在快照中属正常）`);
  } else {
    R.info('G3 聊天历史为空或字段异常，跳过命名空间比对', { rows: rows.length });
  }
  return rows.length;
}

// ==================== H. 总开关（临时关闭再恢复）====================

async function groupH() {
  const off = await setAgentEnabled(false);
  R.check('H1 管理员可关闭 agent_enabled', off.ok === true, off.status || off.error);
  await sleep(300);
  const g = await K.guestTicket(FRESH_IP2);
  R.check('H2 关闭后 /guest/session → 503 AGENT_DISABLED_GLOBALLY',
    g.status === 503 && g.json.code === 'AGENT_DISABLED_GLOBALLY', { status: g.status, code: g.json && g.json.code });
  const s = await K.httpJson('/api/agent/v1/session', { method: 'POST', body: {} });
  R.check('H3 关闭后 /session → 503 AGENT_DISABLED_GLOBALLY',
    s.status === 503 && s.json.code === 'AGENT_DISABLED_GLOBALLY', { status: s.status, code: s.json && s.json.code });
  const wk = await K.httpJson('/.well-known/virtual-world-agent.json');
  const cap = await K.httpJson('/api/agent/v1/capabilities');
  const oa = await K.httpJson('/api/agent/v1/openapi.json');
  R.check('H4 关闭后发现端点仍公开 200（永远可发现）',
    wk.status === 200 && cap.status === 200 && oa.status === 200,
    { wk: wk.status, cap: cap.status, openapi: oa.status });
  R.check('H5 well-known.agentEnabled 反映实时值 false',
    wk.json && wk.json.agentEnabled === false, wk.json && wk.json.agentEnabled);

  const on = await setAgentEnabled(true);
  R.check('H6 恢复 agent_enabled=true', on.ok === true, on.status || on.error);
  await sleep(300);
  const g2 = await K.guestTicket(FRESH_IP2);
  R.check('H7 恢复后签票 200（联测期保持开启）', g2.status === 200, { status: g2.status, code: g2.json && g2.json.code });
  R.info('H8 提醒', '联测收尾需按红线 6 恢复 agent_enabled=false');
}

// ==================== 主流程 ====================

(async () => {
  const started = Date.now();
  let ownerTicket = null, ownerAgentId = null, observeJson = null, historyRows = 0;
  const report = {
    when: new Date().toISOString(), run: RUN,
    ips: {
      owner: OWNER_IP, auth: AUTH_IP, main: MAIN_IP, c18: C18_IP, owner2: OWNER_IP2,
      rate: RATE_IP, fresh: FRESH_IP, fresh2: FRESH_IP2, xObserver: X_OBSERVER_IP,
      xAttempts: [0, 1, 2].map(i => `203.0.113.${RUN + 60 + i}`)
    },
    groups: {}, fatal: null
  };
  try {
    report.groups.A = await groupA();
    const b = await groupB(OWNER_IP);
    ownerTicket = b.token; ownerAgentId = b.agent && b.agent.id;
    report.groups.B = { agentId: ownerAgentId, name: b.agent && b.agent.name };

    const c = await groupC(ownerTicket, ownerAgentId);
    report.groups.C = { connected: !!c.conn };

    if (c.conn && c.conn.ok) {
      observeJson = await groupD(ownerTicket, ownerAgentId);
      report.groups.D = { radius: observeJson && observeJson.radius };
      await groupE(c.conn, ownerTicket);
      const rows = await groupG(ownerTicket, observeJson);
      historyRows = rows;
      report.groups.G = { rows };
    } else {
      R.check('D/E/G 组前置：游客主连接可用', false, 'C 组未取得连接，后续组跳过');
    }

    const freshTicket = await groupF();
    report.groups.F = { freshTicket: !!freshTicket };

    report.groups.X = await groupX();

    await groupH();
  } catch (e) {
    report.fatal = e.stack || e.message;
    console.error('FATAL', e);
  } finally {
    K.closeAll(...openSockets);
  }

  const sum = R.summary();
  report.result = { pass: sum.pass, fail: sum.fail, total: sum.total };
  report.rows = sum.rows;
  report.durationMs = Date.now() - started;

  const dir = path.join(__dirname, '..', 'examples', 'agent-client', 'live');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'v2-auth-guest.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log('报告: ' + out);
  process.exitCode = sum.fail === 0 ? 0 : 1;
})();
