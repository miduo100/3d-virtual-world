/**
 * ai-live.mjs — 长连接驻场 AI Agent（真人双端联测用）
 *
 * 用法：
 *   AGENT_HOST=http://localhost:3002 AGENT_API_KEY=agk_live_xxx node ai-live.mjs
 *   AGENT_HOST=http://localhost:3002 node ai-live.mjs          # 无 Key → 游客拉模式（收不到聊天）
 *
 * 会话有效期（重要，v6 新增；详见 README「Session Lifetime & Renewal」）：
 *   - **Key 档：可长期驻场**。启动读 well-known 的 auth.sessionTtlSeconds（缺省 900s），
 *     按 ttl×2/3 定时用 API Key 换新 token 供 HTTP 调用（observe / chat/history）。**WS 不重连**。
 *     原因：WS 只在建连时校验一次 JWT，而 HTTP 端点**每次调用都校验** → 不续期的话
 *     t≈15min 起 observe/chat-history 全部 403 TOKEN_EXPIRED，而 WS 仍活着（还能 say/移动），
 *     表现为"AI 还回话、但看不见世界、也不再对世界有反应"。
 *   - **游客档：不可长期驻场**。票 30 分钟到期后 HTTP 全 403（游客 PING 不计活跃 →
 *     再过约 5 分钟被空闲超时踢出）。换票会换新身份（agent:guest:<uuid>）→ **到期请重启进程**。
 *
 * 环境变量：
 *   AI_LIVE_DIR         覆写 live 目录（默认 ./live）；多实例/测试用独立目录，避免 events.jsonl 混流
 *   AI_LIVE_REFRESH_MS  覆写续期间隔（毫秒，测试用，如 60000）
 *
 * 目录约定（相对本脚本所在目录）：
 *   live/inbox/*.json   待执行命令，按文件名升序处理，执行后移入 live/done/
 *                       文件内容 = 单条命令对象，如
 *                         {"action":"say","text":"你好"}
 *                         {"action":"walk_to","target":{"x":3,"z":0}}
 *                         {"action":"rotate","yaw":1.57}
 *                         {"action":"jump"}
 *                         {"action":"__stop"}
 *   live/events.jsonl   全部入站消息 + 出站命令 + 周期 observe 快照（追加写）
 *   live/state.json     连接状态与自身坐标（覆盖写）
 *
 * 为什么用 inbox 目录而不是"追加式命令文件"：追加式文件重跑会重放全部历史命令，
 * 必须维护行号进度；inbox 一命令一文件、执行即移走，天然幂等，重启不会重放。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = (process.env.AGENT_HOST || 'http://localhost:3002').replace(/\/+$/, '');
const API_KEY = process.env.AGENT_API_KEY || '';
const WS_BASE = HOST.replace(/^http/, 'ws');

const HERE = path.dirname(fileURLToPath(import.meta.url));
// AI_LIVE_DIR：多实例/测试用独立目录。两个进程共用 live/ 会互相抢 inbox 命令、events.jsonl 混流
// （2026-09-19 联测经验 E2）——跑测试或同时驻场多个 Agent 时给每个进程一个目录。
const LIVE = process.env.AI_LIVE_DIR ? path.resolve(process.env.AI_LIVE_DIR) : path.join(HERE, 'live');
const INBOX = path.join(LIVE, 'inbox');
const DONE = path.join(LIVE, 'done');
const EVENTS = path.join(LIVE, 'events.jsonl');
const STATE = path.join(LIVE, 'state.json');

for (const d of [LIVE, INBOX, DONE]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(EVENTS)) fs.writeFileSync(EVENTS, '', 'utf8');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 聊天去重（缺陷 G，2026-09-19）：本客户端同时用 WS CHAT 推送 + /chat/history 轮询，
 * 同一条真人消息会被记录两遍（events.jsonl 里 10:42:38/10:42:39 同一句）。
 *
 * 两层去重（第二轮联测实测修正）：
 *  ① **history 通道用持久 seen 表**（`historySeen`，按 history 行 id/createdAt + 文本）——
 *     只用时间窗口会导致"每过窗口期就把同一批历史行再报一遍"（实测每 10s 重复上报 11 条）。
 *  ② **跨通道用 10s 文本窗口**（`chatSeen`）——两条通道时间戳精度不同（推流是服务端 Date、
 *     history 是 DB created_at），故不逐字段比对；任一条通道报过，另一条在该窗口内就不再报。
 */
const CHAT_DEDUPE_WINDOW_MS = 10000;
const chatSeen = new Map();     // `${senderId}|${message}` -> 最近一次时间戳（跨通道）
const historySeen = new Set();  // history 行的持久去重键

function isDuplicateChat(senderId, message) {
  const key = `${senderId || '?'}|${message}`;
  const now = Date.now();
  const last = chatSeen.get(key);
  if (last && now - last < CHAT_DEDUPE_WINDOW_MS) return true;
  chatSeen.set(key, now);
  if (chatSeen.size > 500) {
    for (const [k, t] of chatSeen.entries()) if (now - t > CHAT_DEDUPE_WINDOW_MS) chatSeen.delete(k);
  }
  return false;
}

/** history 行持久去重键（行有稳定 id/createdAt 时优先用它） */
function historyKey(h) {
  return `${h.id != null ? 'id:' + h.id : 'ts:' + h.createdAt}|${h.message}`;
}

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}`;
  console.log(line);
}

function emit(obj) {
  try { fs.appendFileSync(EVENTS, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n', 'utf8'); } catch (e) {}
}

function writeState(patch) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { /* ignore */ }
  try { fs.writeFileSync(STATE, JSON.stringify({ ...cur, ...patch, updatedAt: new Date().toISOString() }, null, 2), 'utf8'); } catch (e) {}
}

async function post(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  let j = null;
  try { j = await r.json(); } catch (e) { /* ignore */ }
  return { status: r.status, body: j };
}

/**
 * 读发现入口拿会话 TTL。**拿不到就用缺省值**：发现端点虽然公开无鉴权，
 * 但网络抖动 / 版本差异都可能失败，客户端启动绝不能依赖它。
 */
async function readWellKnownTtls() {
  const fallback = { sessionTtlSeconds: 900, guestSessionTtlSeconds: 1800 };
  try {
    const r = await fetch(HOST + '/.well-known/virtual-world-agent.json');
    const j = await r.json();
    const a = (j && j.auth) || {};
    const s = Number(a.sessionTtlSeconds), g = Number(a.guestSessionTtlSeconds);
    return {
      sessionTtlSeconds: s > 0 ? s : fallback.sessionTtlSeconds,
      guestSessionTtlSeconds: g > 0 ? g : fallback.guestSessionTtlSeconds
    };
  } catch (e) {
    log('well-known 读取失败，用缺省 TTL（session=' + fallback.sessionTtlSeconds + 's）: ' + e.message);
    return fallback;
  }
}

/** 解 JWT payload 的 exp（仅用于日志/状态落盘，不校验签名） */
function decodeJwtExp(t) {
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')).exp; } catch (e) { return null; }
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', (e) => reject(new Error('ws error: ' + (e.message || 'unknown'))), { once: true });
    setTimeout(() => reject(new Error('ws open timeout')), 8000);
  });
}

(async function main() {
  log('ai-live starting | host=' + HOST + ' | mode=' + (API_KEY ? 'key-push' : 'guest-pull'));
  writeState({ started: true, host: HOST, mode: API_KEY ? 'key-push' : 'guest-pull', connected: false });

  // ---- 0. discovery：拿会话 TTL（失败用缺省值，不影响启动）----
  const ttl = await readWellKnownTtls();
  const SESSION_TTL = ttl.sessionTtlSeconds;              // Key 档 JWT 有效期（默认 900s）
  const GUEST_SESSION_TTL = ttl.guestSessionTtlSeconds;   // 游客票有效期（默认 1800s）
  log('ttl | session=' + SESSION_TTL + 's guest=' + GUEST_SESSION_TTL + 's');

  // ---- 1. session ----
  let token, tier, agentId, agentName, guestExpiresIn = 0;
  if (API_KEY) {
    const r = await post(HOST + '/api/agent/v1/session', {
      Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json'
    }, {});
    if (!r.body || !r.body.token) { log('session FAILED', r.status, r.body); writeState({ connected: false, error: 'session failed' }); process.exitCode = 1; return; }
    token = r.body.token; tier = 'key-push';
    agentId = r.body.agent && r.body.agent.id; agentName = r.body.agent && r.body.agent.name;
  } else {
    const r = await post(HOST + '/api/agent/v1/guest/session', { 'Content-Type': 'application/json' }, {});
    if (!r.body || !r.body.token) { log('guest session FAILED', r.status, r.body); writeState({ connected: false, error: 'guest session failed' }); process.exitCode = 1; return; }
    token = r.body.token; tier = r.body.tier;
    agentId = r.body.agent && r.body.agent.id; agentName = r.body.agent && r.body.agent.name;
    guestExpiresIn = Number(r.body.expiresIn) || GUEST_SESSION_TTL;   // 游客票有效期（秒）
  }
  log('session ok | agent=' + agentName + ' tier=' + tier);
  const myExp = decodeJwtExp(token);
  writeState({
    agentId, agentName, tier, connected: false,
    tokenExpiresAt: myExp ? new Date(myExp * 1000).toISOString() : null
  });

  // ---- 2. WS ----
  const ws = await openWs(`${WS_BASE}/ws/agent?token=${encodeURIComponent(token)}`);
  ws.addEventListener('message', (ev) => {
    let m = null;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    emit({ dir: 'in', msg: m });
    if (m.type === 'READY') {
      writeState({ connected: true, tier: m.payload && m.payload.tier, pushTier: m.payload && m.payload.pushTier, spawn: m.payload && m.payload.spawn });
      log('READY', m.payload && m.payload.agentName, 'tier=' + (m.payload && m.payload.tier), 'push=' + (m.payload && m.payload.pushTier));
    } else if (m.type === 'CHAT') {
      // G：按 id 判重（同一条消息也会被下面的 history 轮询拉到）
      const p = m.payload || {};
      if (!isDuplicateChat(p.characterId || p.senderId, p.message)) {
        log('CHAT <-', p.sender, ':', p.message);
      }
    } else if (m.type === 'ERROR') {
      log('ERROR', m.payload && m.payload.code);
    }
  });
  ws.addEventListener('close', (ev) => {
    log('ws closed code=' + ev.code + ' reason=' + ev.reason);
    // 可观测：会话续期**不应**导致 WS 重连（§5.2 设计），这条事件是验收判据
    emit({ dir: 'ws', event: 'closed', code: ev.code, reason: ev.reason });
    writeState({ connected: false, wsClosedAt: new Date().toISOString() });
    process.exit(0);
  });

  // Key 模式订阅 chat / movement / presence（游客会被拒，忽略）。
  // 2026-09-19 起位置流受订阅门控（T3）：只订阅 chat 的客户端收不到 ENTITY_* 推送，
  // 半径默认 30m（T4 生效），需要更远可显式传 radius（1~200）。
  ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { topics: ['chat', 'movement', 'presence'], radius: 60 } }));

  // ---- 2b. 应用层保活（联测修复 C 配套）----
  // 服务端空闲超时 5 分钟；活跃信号 = WS ACTION/SUBSCRIBE/UNSUBSCRIBE + Key 档 PING + HTTP observe。
  // 本客户端是纯拉模式（observe 走 HTTP），但只连不动的长驻场景仍需主动 PING，
  // 否则一旦停止轮询就会被 ws_idle_timeout 踢出。游客档 PING 不计活跃（防占名额），
  // 游客靠下面的周期 observe 续命。
  setInterval(() => {
    try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'PING', payload: {} })); } catch (e) {}
  }, 60000);

  // ---- 2c. 会话续期（v6 新增）----
  // 为什么必须做：Agent JWT TTL = 900s，**WS 只在建连时校验一次、HTTP 端点每次调用都校验** →
  // 不续期的话 t≈15min 起 observe / chat/history 全部 403 TOKEN_EXPIRED（WS 仍活着、还能 say/移动），
  // 世界里表现为"AI 还在回话，但看不见世界、也不再对世界有反应"。
  //
  // Key 档：定时用 API Key 换新 token。**只需给闭包里的 token 重新赋值** —— 下面的周期
  //   observe / history 都是"每次调用时才读 token"，故不用改那两处 fetch；WS 用旧 jti 是
  //   设计使然（§5.2），**不要重连**。
  // 游客档：**不续期**（换票会生成新身份 agent:guest:<uuid>，与已建 WS 连接的 presence 身份错位，
  //   observe 的 self 会变 (0,0,0)）→ 票到期后请重启进程重签。
  let refreshInFlight = false;
  let refreshAttempt = 0;
  const REFRESH_RETRY_MS = [5000, 15000, 45000];   // 失败重试间隔（最多 3 次，之后告警但不退出）

  async function refreshSession() {
    if (refreshInFlight) return;                    // 防重入：重试与定时器可能撞车
    refreshInFlight = true;
    const r = await post(HOST + '/api/agent/v1/session', {
      Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json'
    }, {});
    if (r.body && r.body.token) {
      token = r.body.token;                         // ★ 关键：只重新赋值，两个周期任务下次调用自会读到新值
      refreshAttempt = 0;
      refreshInFlight = false;
      const exp = decodeJwtExp(token);
      writeState({
        tokenRefreshedAt: new Date().toISOString(),
        tokenExpiresAt: exp ? new Date(exp * 1000).toISOString() : null
      });
      emit({ dir: 'session', event: 'refreshed', expiresIn: SESSION_TTL, exp });
      log('session refreshed | exp=' + (exp ? new Date(exp * 1000).toISOString() : '?'));
      return;
    }
    refreshInFlight = false;
    const err = 'status=' + r.status + ' ' + JSON.stringify(r.body || {});
    if (refreshAttempt < REFRESH_RETRY_MS.length) {
      const wait = REFRESH_RETRY_MS[refreshAttempt++];
      log('session refresh FAILED (' + err + ')，' + (wait / 1000) + 's 后重试');
      emit({ dir: 'session', event: 'refresh_retry', waitMs: wait, error: err });
      setTimeout(refreshSession, wait);
    } else {
      // 不退出：WS 还活着，客户端还能 say/walk；只是 HTTP 能力（observe/history）会失效
      log('session refresh GIVE UP: ' + err + '（WS 仍在，observe/history 将 403）');
      emit({ dir: 'session', event: 'refresh_giveup', error: err });
      writeState({ tokenRefreshFailedAt: new Date().toISOString(), tokenRefreshError: err });
    }
  }

  if (API_KEY) {
    const intervalMs = Number(process.env.AI_LIVE_REFRESH_MS) || Math.round(SESSION_TTL * 1000 * 2 / 3);
    setInterval(refreshSession, intervalMs);        // 首轮不立即续期（第一次在 interval 之后）
    log('session auto-refresh ON | every ' + Math.round(intervalMs / 1000) + 's (ttl=' + SESSION_TTL + 's)');
  } else {
    const expireAt = new Date(Date.now() + guestExpiresIn * 1000).toISOString();
    writeState({ guestTicketExpiresAt: expireAt, guestNoRenew: true });
    log('guest ticket expires at ' + expireAt + ' | 游客不自动续期（换票会换身份）→ 到期请重启进程');
    setTimeout(() => {
      log('guest ticket EXPIRED — HTTP 调用（observe/chat-history）将开始 403；'
        + 'WS 约 5 分钟后被空闲超时踢出。请重启本进程重新签票。');
      writeState({ guestTicketExpired: true });
      emit({ dir: 'session', event: 'guest_ticket_expired' });
    }, guestExpiresIn * 1000);
  }

  // ---- 3. 周期 observe ----
  // v6：HTTP 失败必须留痕 —— 原实现只在 success 时 emit，JWT 过期后
  // "看不见世界"对客户端自己是**完全静默**的（这正是缺陷 A 难以被发现的原因）。
  let lastObserve = 0;
  const lastObserveErr = { status: 0 };
  setInterval(async () => {
    if (Date.now() - lastObserve < 3000) return;
    lastObserve = Date.now();
    try {
      const r = await fetch(HOST + '/api/agent/v1/observe?radius=100', { headers: { Authorization: 'Bearer ' + token } });
      const j = await r.json().catch(() => null);
      if (j && j.success) {
        const ents = (j.entities || []).map(e => ({ id: e.id, name: e.name, type: e.type, d: e.distance, p: e.position }));
        emit({ dir: 'observe', self: j.self, entities: ents });
        writeState({ self: j.self, entities: ents });
        if (lastObserveErr.status) { log('observe recovered (HTTP 200)'); lastObserveErr.status = 0; }
      } else if (!r.ok) {
        emit({ dir: 'observe', event: 'http_error', status: r.status, code: j && j.code });
        if (lastObserveErr.status !== r.status) {
          lastObserveErr.status = r.status;
          log('observe HTTP ' + r.status + ' ' + ((j && j.code) || '')
            + ' ← HTTP 凭据失效：Key 档应已自动续期（若持续出现请查 API Key）；游客档请重启进程重签票');
        }
      }
    } catch (e) { /* ignore */ }
  }, 1000);

  // ---- 3b. 聊天历史轮询（拉模式兜底：游客收不到 CHAT 推送，只能拉）----
  // 缺陷 G：与 WS 推送共用同一个去重表（isDuplicateChat），避免同一条消息记两遍
  setInterval(async () => {
    try {
      const r = await fetch(HOST + '/api/agent/v1/chat/history?limit=30', { headers: { Authorization: 'Bearer ' + token } });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        emit({ dir: 'chat-history', event: 'http_error', status: r.status, code: j && j.code });
        return;
      }
      if (!j || !j.success || !Array.isArray(j.history)) return;
      for (const h of j.history.slice().reverse()) {
        if (h.senderType !== 'human') continue;
        const hk = historyKey(h);
        if (historySeen.has(hk)) continue;         // ① 这一行已经处理过（持久）
        historySeen.add(hk);
        if (historySeen.size > 1000) {             // 防长会话内存增长：只保留最近 200 条
          const keep = [...historySeen].slice(-200);
          historySeen.clear();
          keep.forEach(k => historySeen.add(k));
        }
        if (isDuplicateChat(h.senderId, h.message)) continue;   // ② WS 推送在 10s 内已报过
        emit({ dir: 'chat-history', from: h.senderName, text: h.message });
        log('PULLED <-', h.senderName, ':', h.message);
      }
    } catch (e) { /* ignore */ }
  }, 2500);

  // ---- 4. inbox 命令循环 ----
  let reqSeq = 0;
  setInterval(() => {
    let files;
    try { files = fs.readdirSync(INBOX).filter(f => f.endsWith('.json')).sort(); } catch (e) { return; }
    for (const f of files) {
      const src = path.join(INBOX, f);
      let cmd = null;
      try { cmd = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) {
        try { fs.renameSync(src, path.join(DONE, f + '.bad')); } catch (e2) {}
        continue;
      }
      if (cmd && cmd.action === '__stop') {
        log('stop requested');
        try { fs.renameSync(src, path.join(DONE, f)); } catch (e) {}
        ws.close(); return;
      }
      const payload = { requestId: `live-${++reqSeq}`, ...cmd };
      ws.send(JSON.stringify({ type: 'ACTION', payload }));
      emit({ dir: 'out', file: f, payload });
      log('ACTION ->', JSON.stringify(payload));
      try { fs.renameSync(src, path.join(DONE, f)); } catch (e) {}
    }
  }, 400);

  log('ai-live online. inbox=' + INBOX);
})().catch(e => { log('fatal: ' + e.message); writeState({ connected: false, error: e.message }); process.exitCode = 1; });
