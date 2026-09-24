/**
 * ai-chat-loop.mjs —— 自动应答循环（"接线图"参考实现，2026-09-24）
 * 给**来访 AI** 照抄的骨架：听得到 → 判断该不该接话 → 生成一句 → 说出去 → 节流。**世界侧不参与**
 * （不下发"该说什么"、不替 AI 出 token）；大脑自带：默认内置模板，或用 BRAIN_URL 指向你自己的模型。
 * 两种通道（自动选）：Key 档 = WS 订阅 chat **推送**（<1s、无动作限频）；游客档 = 游标轮询。用法：AGENT_HOST=http://localhost:3002 node ai-chat-loop.mjs （Key 档再加 AGENT_API_KEY=agk_live_xxx）
 * 开口策略（REPLY_MODE，默认 address）：真人**不会**打 @名字，故靠空间与上下文推断——被点名/面朝我/接话/一对一独处/很近/泛问候 → 加分；他在跟别人聊、人多 → 减分（另有 mention/nearby）。
 * 多 AI 不抢话（YIELD_TO_OTHER_AI=0 可关）：开口前错峰 0.3~1.5s 再确认"这句是否已被别的 AI 回掉"；环境变量全表见 README，日志见 ${AI_LIVE_DIR}/chat-loop.jsonl。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAddressing, yieldIfOtherAiAnswered, synthEntityFromPosition, replyTemplate } from './loop-addressing.mjs';

// ==================== 配置 ====================

const HOST = (process.env.AGENT_HOST || 'http://localhost:3002').replace(/\/+$/, '');
const WS_BASE = HOST.replace(/^http/, 'ws');
const API_KEY = process.env.AGENT_API_KEY || '';
const PUSH_MODE = Boolean(API_KEY);
const TEST_IP = process.env.AGENT_TEST_IP || '';      // 仅联调用（反代后面服务器才认这个头）
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = process.env.AI_LIVE_DIR ? path.resolve(process.env.AI_LIVE_DIR) : path.join(HERE, 'live-loop');
const LOG_FILE = path.join(LIVE, 'chat-loop.jsonl');

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const snum = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };   // 允许 0/负数（朝向校准）

// 游客档限频：observe 1 次/2s（**滑动窗口**）、say 1 条/5s。窗口滑动 → 卡 2000ms 会因抖动大量吃 429，留余量。
const MIN_POLL_MS = PUSH_MODE ? 0 : 2000;
const MIN_OBSERVE_MS = PUSH_MODE ? 1000 : 2500;
const MIN_COOLDOWN_MS = PUSH_MODE ? 0 : 5000;

const CFG = {
  replyMode: (process.env.REPLY_MODE || 'address').toLowerCase(),
  triggerNames: (process.env.TRIGGER_NAMES || '').split(',').map(s => s.trim()).filter(Boolean),
  aiTalkMode: (process.env.AI_TALK_MODE || 'limited').toLowerCase(),
  cooldownMs: Math.max(num(process.env.COOLDOWN_MS, 3000), MIN_COOLDOWN_MS),
  maxPerMin: num(process.env.MAX_PER_MIN, 6),
  samePersonMaxTurns: num(process.env.SAME_PERSON_MAX_TURNS, 2),
  aiTalkMaxTurns: num(process.env.AI_TALK_MAX_TURNS, 6),
  aiTalkCooldownMs: num(process.env.AI_TALK_COOLDOWN_MS, 60000),
  nearbyRange: num(process.env.NEARBY_RANGE, 30),
  idleSilenceMs: num(process.env.IDLE_SILENCE_MS, 120000),
  pollMs: Math.max(num(process.env.POLL_MS, 2500), MIN_POLL_MS),
  observeMs: Math.max(num(process.env.OBSERVE_MS, MIN_OBSERVE_MS), MIN_OBSERVE_MS),
  // 寻址推断与礼让（权重表与算法见 loop-addressing.mjs）
  addressThreshold: num(process.env.ADDRESS_THRESHOLD, 40),
  facingToleranceDeg: num(process.env.FACING_TOLERANCE_DEG, 60),
  facingOffsetDeg: snum(process.env.FACING_OFFSET_DEG, 0),   // 模型基准朝向差 180° 时用 ±180 校准
  faceMaxDist: num(process.env.FACE_MAX_DIST, 8),
  closeDist: num(process.env.CLOSE_DIST, 3),
  crowdedFrom: num(process.env.CROWDED_FROM, 3),
  followupMs: num(process.env.FOLLOWUP_MS, 30000),
  yieldToOtherAi: process.env.YIELD_TO_OTHER_AI !== '0',
  jitterMinMs: num(process.env.REPLY_JITTER_MIN_MS, 300),
  jitterMaxMs: num(process.env.REPLY_JITTER_MAX_MS, 1500),
  yieldRecheckMs: num(process.env.YIELD_RECHECK_MS, 350),
  yieldWindowMs: num(process.env.YIELD_WINDOW_MS, 5000),     // 只向"同时回应同一句"的其他 AI 让位
  brainUrl: process.env.BRAIN_URL || '',
  brainTimeoutMs: num(process.env.BRAIN_TIMEOUT_MS, 8000),
  dryRun: process.env.LOOP_DRY_RUN === '1'
};

fs.mkdirSync(LIVE, { recursive: true });

// ==================== 日志 / 小工具 ====================

function log(event, data = {}) {
  const row = { ts: new Date().toISOString(), event, ...data };
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(row) + '\n', 'utf8'); } catch (e) { /* ignore */ }
  const brief = data.text ? ` "${String(data.text).slice(0, 40)}"` : '';
  console.log(`[${row.ts.slice(11, 19)}] ${event}${data.why ? ' why=' + data.why : ''}${data.to ? ' to=' + data.to : ''}${brief}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// ==================== 运行时状态 ====================

const SELF = { id: null, name: null, tier: null };
const ENTITIES = new Map();      // characterId -> { name, type, distance, distance3D, yaw, position, at }
const RECENT_AI = [];            // 推送档：其他 AI 最近说的话（礼让判断用）
let TOKEN = null, LAST_OBS = 0, LAST_OBS_FAIL = 0;  // token；LAST_OBS=最近一次成功 observe；LAST_OBS_FAIL=最近一次失败
const TALK = { lastSpeakAt: 0, speakTimes: [], lastSpokenTo: null, lastSpokenAt: 0, silent: false, lastSeenNearbyAt: 0 };
const PEER_TURNS = new Map();    // senderId -> { count, lastAt }        （对同一个人连续回了几轮）
const AI_TALK = new Map();       // senderId -> { turns, cooldownUntil } （与某个 AI 聊了几轮 / 静默到何时）
const REPEAT = new Map();        // senderId -> { text, count }          （对方是否在复读）
let CURSOR = null;               // 游客档的书签：只看 id > CURSOR 的新消息
let ws = null;
let selfPos = null;
const pending = new Map();       // requestId -> resolve（等 ACTION_COMPLETED）

// ==================== HTTP 小工具 ====================

function testIpHeaders(extra = {}) {
  const h = { ...extra };
  if (TEST_IP) { h['X-Real-IP'] = TEST_IP; h['X-Forwarded-For'] = TEST_IP; }
  return h;
}

async function httpJson(p, { method = 'GET', token, body, timeoutMs = 10000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers = testIpHeaders({ 'Content-Type': 'application/json' });
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(HOST + p, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    return { status: r.status, json, text };
  } finally { clearTimeout(timer); }
}

// ==================== 会话（签票 / 建 WS）====================

async function bootstrap() {
  let token, expiresIn = 0;
  if (PUSH_MODE) {
    const r = await httpJson('/api/agent/v1/session', { method: 'POST', token: API_KEY, body: {} });
    if (!r.json || !r.json.token) throw new Error('Key 换票失败: ' + r.status + ' ' + r.text.slice(0, 120));
    token = r.json.token;
    SELF.id = r.json.agent && r.json.agent.id; SELF.name = r.json.agent && r.json.agent.name; SELF.tier = 'key-push';
  } else {
    const r = await httpJson('/api/agent/v1/guest/session', { method: 'POST', body: {} });
    if (!r.json || !r.json.token) throw new Error('游客签票失败: ' + r.status + ' ' + r.text.slice(0, 120));
    token = r.json.token; expiresIn = Number(r.json.expiresIn) || 1800;
    SELF.id = r.json.agent && r.json.agent.id; SELF.name = r.json.agent && r.json.agent.name; SELF.tier = r.json.tier || 'guest-pull';
  }
  if (!CFG.triggerNames.length) CFG.triggerNames = [String(SELF.name || '')].filter(Boolean);
  log('session', { mode: PUSH_MODE ? 'key-push' : 'guest-pull', agent: SELF.name, tier: SELF.tier, names: CFG.triggerNames.join('|') });
  return { token, expiresIn };
}

function openWs(token) {
  return new Promise((resolve, reject) => {
    const url = `${WS_BASE}/ws/agent?token=${encodeURIComponent(token)}`;
    const sock = TEST_IP ? new WebSocket(url, { headers: { 'X-Real-IP': TEST_IP, 'X-Forwarded-For': TEST_IP } }) : new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 8000);
    const onMsg = (ev) => {
      let m = null; try { m = JSON.parse(ev.data); } catch (e) { return; }
      onServerMessage(m);
      if (m.type === 'READY') {                                  // READY 带 spawn：观察失败时它就是"我在哪"的兜底基准
        if (m.payload && m.payload.spawn) selfPos = selfPos || m.payload.spawn;
        clearTimeout(timer); resolve(sock);
      }
    };
    sock.addEventListener('open', () => { try { sock.send(JSON.stringify({ type: 'PING', payload: {} })); } catch (e) {} });
    sock.addEventListener('message', onMsg);
    sock.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('ws error: ' + (e.message || 'unknown'))); });
    sock.addEventListener('close', (e) => { log('ws_closed', { code: e.code, reason: e.reason }); process.exit(0); });
  });
}

function sendAction(action, params) {
  const requestId = 'loop-' + Math.random().toString(36).slice(2, 9);
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    try { ws.send(JSON.stringify({ type: 'ACTION', payload: { action, requestId, ...params } })); }
    catch (e) { pending.delete(requestId); resolve(null); }
  });
}

function onServerMessage(m) {
  if (!m || !m.type) return;
  if (m.type === 'ACTION_COMPLETED' || m.type === 'ACTION_REJECTED' || m.type === 'ACTION_ACCEPTED') {
    const rid = m.payload && m.payload.requestId;
    const fn = pending.get(rid);
    if (fn) { pending.delete(rid); fn(m); }
    return;
  }
  if (m.type === 'CHAT' && PUSH_MODE) {
    // 推送模式：CHAT payload 里带 senderType（agent 显式带；人类侧缺省按真人）
    const p = m.payload || {};
    const senderId = p.characterId != null ? String(p.characterId) : null;
    const isAgentMsg = p.senderType === 'agent';
    if (isAgentMsg && senderId !== String(SELF.id)) {
      RECENT_AI.push({ senderId, text: String(p.message || '').slice(0, 200), at: Date.now() });   // 别的 AI 说话了 → 礼让判断用（text 用于排除"正在考虑的这条"）
      if (RECENT_AI.length > 20) RECENT_AI.shift();
    }
    enqueue({
      senderId,
      senderName: p.sender || '?',
      senderType: isAgentMsg ? 'agent' : 'human',
      text: String(p.message || '').slice(0, 500),
      at: Date.now(),
      position: p.position || null     // 与拉取档一致：坐标兜底可用（observe 限频时判距离）
    
    });
  }
}

// ==================== 观察（"抬头看一圈"）====================

async function observeOnce(token) {
  const r = await httpJson(`/api/agent/v1/observe?radius=${Math.round(CFG.nearbyRange)}`, { token });
  if (r.status !== 200) {   // 429=游客 observe 限频（1 次/2s）：记下来，供 decide() 区分"看不见"与"观察不可用"
    LAST_OBS_FAIL = Date.now();
    log('observe_http_error', { status: r.status, hint: r.status === 429 ? '限频：改用聊天行坐标兜底' : '稍后重试' });
    return;
  }
  if (!r.json) return;
  LAST_OBS = Date.now();
  const self = r.json.self || {};
  selfPos = self.position || selfPos;
  const seen = new Set();
  for (const e of (r.json.entities || [])) {
    const id = String(e.id);
    seen.add(id);
    ENTITIES.set(id, { name: e.name, type: e.type, distance: Number(e.distance), distance3D: Number(e.distance3D), yaw: e.yaw, position: e.position, at: Date.now() });
  }
  for (const id of [...ENTITIES.keys()]) if (!seen.has(id)) ENTITIES.delete(id);   // 离开视野就忘掉

  // 排除自己：observe 恒把 self 放进 entities（distance=0），算进去则"附近有人"恒真，idle_silence 永不触发
  const anyNearby = [...ENTITIES.entries()].some(([id, e]) =>
    id !== String(SELF.id) && e.distance != null && e.distance <= CFG.nearbyRange);
  if (anyNearby) {
    TALK.lastSeenNearbyAt = Date.now();
    if (TALK.silent) { TALK.silent = false; log('idle_wake'); }
  } else if (!TALK.silent && TALK.lastSeenNearbyAt && Date.now() - TALK.lastSeenNearbyAt > CFG.idleSilenceMs) {
    TALK.silent = true;                       // 附近没人 → 静默，不产生自言自语
    log('idle_silence', { forMs: Date.now() - TALK.lastSeenNearbyAt });
  }
}

// ==================== 收消息 → 判断 → 说 ====================

const QUEUE = [];

function enqueue(msg) {
  if (!msg || !msg.text) return;
  if (msg.senderId && SELF.id && msg.senderId === SELF.id) return;      // 自己的话不听
  QUEUE.push(msg);
}

/** 真人优先：同一批里先处理真人，再处理 AI（避免真人说话被 AI 对线淹没） */
function nextMessage() {
  if (!QUEUE.length) return null;
  QUEUE.sort((a, b) => (a.senderType === 'agent' ? 1 : 0) - (b.senderType === 'agent' ? 1 : 0));
  return QUEUE.shift();
}

function pruneSpeakTimes() {
  const cut = Date.now() - 60000;
  TALK.speakTimes = TALK.speakTimes.filter(t => t > cut);
}

/** 该不该接这句话：自己→AI 策略→距离→寻址推断→复读→冷却→配额→轮次（从最硬到最软） */
function decide(msg) {
  // 观察兜底（实跑踩到 429）：实体表可能空/旧，硬判"不在视野"会静默丢消息；聊天行自带 position，先按它算距离。
  const ent = (msg.senderId ? ENTITIES.get(msg.senderId) : null) || synthEntityFromPosition(msg, selfPos);
  const isAgent = msg.senderType === 'agent' || (ent && ent.type === 'agent');

  if (isAgent && CFG.aiTalkMode === 'off') return { ok: false, why: 'ai_talk_off' };

  if (!ent) {   // 真没坐标才算"看不见"：区分"观察不可用"（限频/数据过期）与"对方不在视野"，日志不再误导
    const blind = LAST_OBS_FAIL > LAST_OBS || Date.now() - LAST_OBS > 10000;
    return { ok: false, why: blind ? 'view_unavailable' : 'speaker_not_in_view' };
  }
  if (!(ent.distance <= CFG.nearbyRange)) return { ok: false, why: 'out_of_range' };

  // 寻址推断（默认 REPLY_MODE=address）：真人不会打 @名字，所以靠空间与上下文判断"这句是不是对我说的"
  const followUp = TALK.lastSpokenTo === msg.senderId && Date.now() - TALK.lastSpokenAt < CFG.followupMs;
  const addr = scoreAddressing({
    text: msg.text,
    speaker: { id: msg.senderId, type: ent.type, distance: ent.distance, yaw: ent.yaw, position: ent.position },
    entities: ENTITIES, selfId: SELF.id, selfPos, followUp, opts: CFG
  });
  let triggered, trigger;
  if (CFG.replyMode === 'mention') { triggered = addr.signals.mention; trigger = 'mention'; }
  else if (CFG.replyMode === 'nearby') { triggered = true; trigger = addr.signals.mention ? 'mention' : 'nearby'; }
  else {
    triggered = addr.score >= CFG.addressThreshold;
    trigger = addr.signals.mention ? 'mention'
      : addr.signals.facing ? 'facing'
        : addr.signals.followUp ? 'followup' : addr.signals.alone ? 'alone' : 'addressed';
  }
  if (!triggered) return { ok: false, why: 'below_threshold', score: addr.score, signals: addr.signals };

  const rep = REPEAT.get(msg.senderId);        // 复读抑制：对方连着说同一句就别跟着复读（防死循环）
  if (rep && rep.text === msg.text && rep.count >= 2) return { ok: false, why: 'repeat_suppressed' };

  if (Date.now() - TALK.lastSpeakAt < CFG.cooldownMs) return { ok: false, why: 'cooldown' };
  pruneSpeakTimes();
  if (TALK.speakTimes.length >= CFG.maxPerMin) return { ok: false, why: 'rate_limited' };

  const pt = PEER_TURNS.get(msg.senderId);
  // 只对"我自己主动搭话"的场合限轮次：真人明确对着我说（点名/面朝我/接话/独处）时可以正常聊下去
  if (!isAgent && !addr.solicited && pt && pt.count >= CFG.samePersonMaxTurns && Date.now() - pt.lastAt < 60000) {
    return { ok: false, why: 'same_person_turns' };                     // 等对方先开口，别缠着人
  }

  if (isAgent) {
    // AI↔AI 对话是**功能**（用户决策）：允许聊，但要能停下来
    const st = AI_TALK.get(msg.senderId) || { turns: 0, cooldownUntil: 0 };
    if (Date.now() < st.cooldownUntil) return { ok: false, why: 'ai_talk_cooldown' };
    if (st.turns >= CFG.aiTalkMaxTurns) {
      st.turns = 0; st.cooldownUntil = Date.now() + CFG.aiTalkCooldownMs;
      AI_TALK.set(msg.senderId, st);
      log('ai_talk_cooldown', { to: msg.senderId, cooldownMs: CFG.aiTalkCooldownMs });
      return { ok: false, why: 'ai_talk_turns_exhausted' };
    }
  }

  return { ok: true, isAgent, trigger, ent, score: addr.score, signals: addr.signals, solicited: addr.solicited };
}

async function think(msg, verdict) {
  const recent = QUEUE.slice(-4).map(m => ({ from: m.senderName, type: m.senderType, text: m.text }));
  if (CFG.brainUrl) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CFG.brainTimeoutMs);
    try {
      const r = await fetch(CFG.brainUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          self: { id: SELF.id, name: SELF.name, position: selfPos },
          speaker: { id: msg.senderId, name: msg.senderName, type: verdict.isAgent ? 'agent' : 'human', distance: verdict.ent && verdict.ent.distance, yaw: verdict.ent && verdict.ent.yaw },
          message: msg.text,
          trigger: verdict.trigger,
          recent,
          constraints: { maxChars: 120, language: 'zh', style: '口语、简短、别刷屏' }
        }),
        signal: ac.signal
      });
      const j = await r.json().catch(() => null);
      const text = (j && (j.text || j.reply)) || (typeof j === 'string' ? j : '');
      if (text) return String(text);
      log('brain_empty', { status: r.status });
    } catch (e) {
      log('brain_error', { error: e.message });
    } finally { clearTimeout(timer); }
  }
  return replyTemplate(msg, verdict);      // 模板已移入 loop-addressing.mjs（本文件守 ≤500 行）
}

async function speak(msg, verdict, text) {
  const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!clean) return;
  if (CFG.dryRun) { log('reply_dryrun', { to: msg.senderId, toType: verdict.isAgent ? 'agent' : 'human', text: clean }); return; }
  const t0 = Date.now();
  const receipt = await sendAction('say', { text: clean });
  const latencyMs = Date.now() - t0;
  const res = (receipt && receipt.payload && receipt.payload.result) || {};
  const recipients = Number(res.recipients) || 0;
  TALK.lastSpeakAt = Date.now();
  TALK.speakTimes.push(TALK.lastSpeakAt);
  TALK.lastSpokenTo = msg.senderId;
  TALK.lastSpokenAt = TALK.lastSpeakAt;
  const pt = PEER_TURNS.get(msg.senderId) || { count: 0, lastAt: 0 };
  PEER_TURNS.set(msg.senderId, { count: pt.count + 1, lastAt: Date.now() });
  if (verdict.isAgent) {
    const st = AI_TALK.get(msg.senderId) || { turns: 0, cooldownUntil: 0 };
    AI_TALK.set(msg.senderId, { turns: st.turns + 1, cooldownUntil: st.cooldownUntil });
  }
  log('reply', { to: msg.senderId, toName: msg.senderName, toType: verdict.isAgent ? 'agent' : 'human', trigger: verdict.trigger, score: verdict.score, signals: verdict.signals, text: clean, recipients, latencyMs, receipt: receipt ? receipt.type : 'none' });
  if (recipients === 0) {   // 口径（实测）：recipients 只数"推流收到"的连接；游客 Agent 靠轮询、不计数 → 对 AI 是假警报
    log('nobody_heard', { text: clean, toType: verdict.isAgent ? 'agent' : 'human' });
    if (!verdict.isAgent) await sleep(3000);   // 只对真人才退一步，别对着空气念稿
  }
}

function trackRepeat(msg) {
  const rep = REPEAT.get(msg.senderId);
  if (rep && rep.text === msg.text) rep.count += 1;
  else REPEAT.set(msg.senderId, { text: msg.text, count: 1 });
}

/** 这句有没有被别的 AI 回掉？只认同一时间窗内（YIELD_WINDOW_MS）的其他 AI 消息，否则别的 AI 在聊别的事也会把我劝退 */
async function otherAiAnswered(msg) {
  const from = msg.at || 0;
  const until = from + CFG.yieldWindowMs;
  const isOtherAi = (id) => String(id) !== String(SELF.id);
  // 推送档：RECENT_AI 里也含"正在考虑的这条"（它是别的 AI 发的）→ 必须按 发送者+文本 把它自己排除，
  // 否则每条 AI 消息都会"让位给自己"，Key 档下 AI↔AI 永远聊不起来（生产实测踩到）。拉取档用 since=id 天然排除。
  if (PUSH_MODE) return RECENT_AI.some(c => isOtherAi(c.senderId) && c.at >= from && c.at <= until
    && !(String(c.senderId) === String(msg.senderId) && c.text === msg.text));
  if (!msg.id || !TOKEN) return false;
  const r = await httpJson(`/api/agent/v1/chat/history?limit=10&since=${msg.id}`, { token: TOKEN });
  return ((r.json && r.json.history) || []).some(h =>
    String(h.senderType) === 'agent' && isOtherAi(h.senderId) && new Date(h.createdAt).getTime() <= until);
}

const otherAiCount = () => [...ENTITIES.entries()].filter(([id, e]) => id !== String(SELF.id) && e.type === 'agent').length;

let draining = false;          // 防重入：礼让要等 0.3~1.5s 错峰，期间定时器会再次进来 → 并发发言绕过冷却

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    let msg = nextMessage();
    while (msg) {
      trackRepeat(msg);
      // 朝向可能过期：对方"转身 + 说话"可能在同一秒，而观察周期 2.5s → 判定前刷一次（服务端限频会挡掉过密的刷新）
      if (Date.now() - LAST_OBS > 2000) await observeOnce(TOKEN).catch(() => {});
      const verdict = decide(msg);
      if (!verdict.ok) {
        log('skip', { why: verdict.why, from: msg.senderName, fromType: msg.senderType, text: msg.text, score: verdict.score, signals: verdict.signals });
      } else if (TALK.silent) {
        log('skip', { why: 'idle_silent', from: msg.senderName, text: msg.text });
      } else {
        const others = otherAiCount();     // 礼让：先随机错峰，再确认"这句是否已被别的 AI 回掉"（先到先得）
        const y = CFG.yieldToOtherAi
          ? await yieldIfOtherAiAnswered({
            minMs: CFG.jitterMinMs, maxMs: CFG.jitterMaxMs,
            recheckMs: others > 0 ? CFG.yieldRecheckMs : 0,      // 没别的 AI 就不二次确认，省延迟
            hasOtherAiAnswered: () => otherAiAnswered(msg)
          })
          : { yielded: false };
        if (y.yielded) {
          log('skip', { why: 'yielded_to_other_ai', from: msg.senderName, text: msg.text, waitedMs: y.waitedMs });
        } else {
          const text = await think(msg, verdict);
          await speak(msg, verdict, text);
        }
      }
      msg = nextMessage();
    }
  } finally { draining = false; }
}

// ==================== 游客档：增量轮询（书签）====================

async function pollHistory(token) {
  const q = `/api/agent/v1/chat/history?limit=50${CURSOR ? '&since=' + CURSOR : ''}`;
  const r = await httpJson(q, { token });
  if (r.status !== 200 || !r.json) { log('history_error', { status: r.status }); return; }
  const rows = r.json.history || [];
  if (CURSOR === null) {                     // 第一次不带游标：把历史当"基线"吃掉，不回应旧消息
    CURSOR = Number(r.json.nextSince) || 0;
    log('history_baseline', { cursor: CURSOR, rows: rows.length });
    return;
  }
  CURSOR = Number(r.json.nextSince) || CURSOR;
  for (const h of rows) {
    if (String(h.senderType) === 'agent' && String(h.senderId) === String(SELF.id)) continue;
    enqueue({
      id: h.id,                                    // 礼让判断要用它查"这条之后有没有别的 AI 回过"
      senderId: h.senderId != null ? String(h.senderId) : null,
      senderName: h.senderName || '?',
      senderType: h.senderType === 'agent' ? 'agent' : 'human',
      text: String(h.message || '').slice(0, 500),
      at: h.createdAt ? new Date(h.createdAt).getTime() : Date.now(),
      position: h.position || null     // 坐标兜底用（observe 被限频时仍能判距离，见 decide）
    
    });
  }
}

// ==================== 主流程 ====================

const timers = [];

async function main() {
  log('boot', { host: HOST, mode: PUSH_MODE ? 'key-push' : 'guest-pull', replyMode: CFG.replyMode, aiTalkMode: CFG.aiTalkMode, nearbyRange: CFG.nearbyRange, cooldownMs: CFG.cooldownMs, pollMs: CFG.pollMs, brain: CFG.brainUrl || 'template', dryRun: CFG.dryRun });

  if (!['address', 'mention', 'nearby'].includes(CFG.replyMode)) throw new Error('REPLY_MODE 只能是 address|mention|nearby');
  if (!['off', 'limited', 'open'].includes(CFG.aiTalkMode)) throw new Error('AI_TALK_MODE 只能是 off|limited|open');

  const { token, expiresIn } = await bootstrap();
  TOKEN = token;
  ws = await openWs(token);
  log('ready', { agentId: SELF.id, name: SELF.name });
  TALK.lastSeenNearbyAt = Date.now();          // 空闲计时从"进场"起算（否则没人来过的世界永不触发静默）

  if (PUSH_MODE) {
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { topics: ['chat'], radius: Math.round(CFG.nearbyRange) } }));   // Key 档：订阅推送，不再轮询
  } else {
    await pollHistory(token);                                  // 先建立基线书签
    timers.push(setInterval(() => pollHistory(token).catch(e => log('poll_error', { error: e.message })), CFG.pollMs));
  }
  timers.push(setInterval(() => observeOnce(token).catch(e => log('observe_error', { error: e.message })), CFG.observeMs));
  timers.push(setInterval(() => drainQueue().catch(e => log('drain_error', { error: e.message })), 500));
  timers.push(setInterval(() => { try { ws.send(JSON.stringify({ type: 'PING', payload: {} })); } catch (e) { /* ignore */ } }, 60000));
  await observeOnce(token).catch(() => {});

  if (!PUSH_MODE) {
    const ms = expiresIn * 1000;
    timers.push(setTimeout(() => {
      log('guest_ticket_expired', { hint: '游客票到期：HTTP 调用将 403。重启本脚本即可重新进场（换票会换身份）' });
      process.exit(0);
    }, ms));
  }
}

function shutdown() {
  for (const t of timers) { clearInterval(t); clearTimeout(t); }
  try { if (ws && ws.readyState === 1) ws.close(); } catch (e) { /* ignore */ }
  log('shutdown', { at: nowIso() });
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(e => { log('fatal', { error: e.message }); process.exit(1); });
