/**
 * ai-live.mjs — 长连接驻场 AI Agent（真人双端联测用）
 *
 * 用法：
 *   AGENT_HOST=http://localhost:3002 AGENT_API_KEY=agk_live_xxx node ai-live.mjs
 *   AGENT_HOST=http://localhost:3002 node ai-live.mjs          # 无 Key → 游客拉模式（收不到聊天）
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
const LIVE = path.join(HERE, 'live');
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

  // ---- 1. session ----
  let token, tier, agentId, agentName;
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
  }
  log('session ok | agent=' + agentName + ' tier=' + tier);
  writeState({ agentId, agentName, tier, connected: false });

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
  ws.addEventListener('close', (ev) => { log('ws closed code=' + ev.code + ' reason=' + ev.reason); writeState({ connected: false }); process.exit(0); });

  // Key 模式订阅 chat（游客会被拒，忽略）
  ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { topics: ['chat'] } }));

  // ---- 2b. 应用层保活（联测修复 C 配套）----
  // 服务端空闲超时 5 分钟；活跃信号 = WS ACTION/SUBSCRIBE/UNSUBSCRIBE + Key 档 PING + HTTP observe。
  // 本客户端是纯拉模式（observe 走 HTTP），但只连不动的长驻场景仍需主动 PING，
  // 否则一旦停止轮询就会被 ws_idle_timeout 踢出。游客档 PING 不计活跃（防占名额），
  // 游客靠下面的周期 observe 续命。
  setInterval(() => {
    try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'PING', payload: {} })); } catch (e) {}
  }, 60000);

  // ---- 3. 周期 observe ----
  let lastObserve = 0;
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
      }
    } catch (e) { /* ignore */ }
  }, 1000);

  // ---- 3b. 聊天历史轮询（拉模式兜底：游客收不到 CHAT 推送，只能拉）----
  // 缺陷 G：与 WS 推送共用同一个去重表（isDuplicateChat），避免同一条消息记两遍
  setInterval(async () => {
    try {
      const r = await fetch(HOST + '/api/agent/v1/chat/history?limit=30', { headers: { Authorization: 'Bearer ' + token } });
      const j = await r.json().catch(() => null);
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
