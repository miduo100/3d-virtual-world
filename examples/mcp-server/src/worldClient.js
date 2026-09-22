/**
 * worldClient.js — 世界接入客户端（MCP server 的"身体"）：WebSocket 侧 + 动作 + 生命周期
 *
 * 分层（每层都能单独测，改动请守住边界）：
 *   httpClient.js  —— 端点推导 / 发现 / 签票续期 / observe / 聊天历史（HTTP 侧）
 *   waiter.js      —— "按 requestId 等回执 / 按类型等消息"（消息等待原语）
 *   本文件         —— WS 入场与重连、动作收发、事件环形缓冲、离场、状态汇总
 *
 * 本层四条要点：
 *   1) **懒连接**：MCP 宿主启动时不该立刻连世界，第一次需要"身体"的工具调用才建连。
 *   2) **透明重连**：被服务端空闲超时踢出（close 1001）/被新连接顶替（4004）/网络抖动断开后，
 *      下一次工具调用自动重连并重新登记 presence（WS 建连本身就是入场动作）。
 *   3) **续期绝不重连 WS**：token 由 http 层换新，WS 用旧 jti 是设计使然（§2.5）。
 *   4) **事件环形缓冲**：WS 收到的 CHAT / ENTITY_* 存进上限 100 条的缓冲，
 *      由 world_observe 取出给 AI —— 这是 AI 感知"有人跟我说话了"的唯一途径。
 *      ⚠️ 游客档收不到推流，缓冲只能靠自己的动作回执填充（工具返回里会如实说明）。
 *
 * ⚠️ 所有日志必须走 stderr（console.error）——stdout 是 MCP 的 JSON-RPC 通道。
 */

import { WorldError, actionError, upgradeError } from './errors.js';
import { WorldHttp, AGENT_TIER_GUEST, deriveEndpoints } from './httpClient.js';
import { MessageBus } from './waiter.js';

const EVENT_BUFFER_MAX = 100;
const WS_OPEN_TIMEOUT_MS = 8000;
const READY_TIMEOUT_MS = 8000;
const DEFAULT_WS_RADIUS = 60;

export class WorldClient {
  constructor(options = {}) {
    this.http = new WorldHttp(options);
    this.log = options.log || ((...a) => console.error('[virtual-world-mcp]', ...a));
    this.wsRadius = Number(options.wsRadius || process.env.MCP_WS_RADIUS || DEFAULT_WS_RADIUS) || DEFAULT_WS_RADIUS;
    // 保活默认关闭：MCP 是"工具被调用"驱动的，常驻空转只会占着世界里的名额与 Agent 配额。
    this.keepAliveSeconds = Number(options.keepAliveSeconds || 0) || 0;

    this.bus = new MessageBus();
    this.ws = null;
    this.wsReady = false;
    this.wsConnectCount = 0;
    this.wsClosedCount = 0;
    this.lastClose = null;              // { code, reason, at }
    this.subscribedTopics = [];
    this.subscribedRadius = null;
    this.pushTier = null;
    this.spawn = null;
    this.events = [];
    this.eventSeq = 0;
    this.eventCursor = 0;
    this._wsPromise = null;
    this._reqSeq = 0;
    this._keepAliveTimer = null;
  }

  // ==================== 透传 http 层的状态（工具层/测试直接读客户端即可）====================

  get endpoints() { return this.http.endpoints; }
  get host() { return this.http.host; }
  get apiKey() { return this.http.apiKey; }
  get notes() { return this.http.notes; }
  get protocolMismatch() { return this.http.protocolMismatch; }
  get token() { return this.http.token; }
  set token(v) { this.http.token = v; }                       // 供验收脚本注入过期 token（M9）
  get tokenExpiresAt() { return this.http.tokenExpiresAt; }
  set tokenExpiresAt(v) { this.http.tokenExpiresAt = v; }
  get autoRefresh() { return this.http.autoRefresh; }
  set autoRefresh(v) { this.http.autoRefresh = v; }

  isGuest() { return this.http.isGuest(); }
  upgradeHint() { return this.http.upgradeHint(); }
  discover(force) { return this.http.discover(force); }
  ensureSession() { return this.http.ensureSession(); }
  signSession() { return this.http.signSession(); }
  observe(params) { return this.http.observe(params); }
  chatHistory(limit) { return this.http.chatHistory(limit); }

  /** 当前状态快照（工具返回里用，让 AI 知道"我是谁、什么档、还能用多久"） */
  status() {
    const h = this.http;
    const now = Date.now();
    return {
      host: h.host,
      tier: h.tier,
      mode: h.isGuest() ? 'guest-pull（拉模式）' : (h.tier ? 'key-push（推模式）' : '未进入'),
      agentId: h.agentId,
      agentName: h.agentName,
      pushTier: this.pushTier,
      connected: Boolean(this.ws && this.ws.readyState === 1 && this.wsReady),
      wsConnects: this.wsConnectCount,
      wsClosed: this.wsClosedCount,
      subscribedTopics: [...this.subscribedTopics],
      tokenSecondsLeft: h.tokenExpiresAt ? Math.max(0, Math.round((h.tokenExpiresAt - now) / 1000)) : null,
      guestSecondsLeft: h.guestExpiresAt ? Math.max(0, Math.round((h.guestExpiresAt - now) / 1000)) : null,
      sessionTtlSeconds: h.sessionTtlSeconds,
      lastClose: this.lastClose
    };
  }

  // ==================== WS 入场 / 重连 ====================

  /** 保证 WS 已连且已收到 READY；懒连接 + 透明重连的唯一入口 */
  async ensureWs() {
    if (this.ws && this.ws.readyState === 1 && this.wsReady) {
      return { connected: true, reconnected: false, readyAlready: true };
    }
    if (this._wsPromise) return this._wsPromise;
    this._wsPromise = this._connect();
    try {
      return await this._wsPromise;
    } finally {
      this._wsPromise = null;
    }
  }

  async _connect() {
    await this.ensureSession();
    const ep = this.endpoints;
    const reconnected = this.wsConnectCount > 0;
    // WHATWG WebSocket（Node 18+ 全局）不能设自定义请求头 → 只能用 ?token= 查询参数（服务端已支持）
    const ws = new WebSocket(ep.wsUrl + '?token=' + encodeURIComponent(this.token));
    this._attachWs(ws);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { ws.close(); } catch (e) { /* noop */ }
        reject(new Error(`连接超时（${WS_OPEN_TIMEOUT_MS}ms）`));
      }, WS_OPEN_TIMEOUT_MS);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('close', (ev) => {
        clearTimeout(timer);
        reject(new Error(`连接被关闭 code=${ev.code}${ev.reason ? ' reason=' + ev.reason : ''}`));
      }, { once: true });
      ws.addEventListener('error', () => { /* 统一由 close/超时处理 */ }, { once: true });
    }).catch(async (err) => {
      const probe = await this.http.probeCredential();
      throw upgradeError(err.message, probe, { host: this.host });
    });

    this.ws = ws;         // ⚠️ 续期只换 token，绝不因为续期重连；重连只发生在真的断开之后
    this.wsConnectCount += 1;
    const ready = await this.bus.watchType('READY', READY_TIMEOUT_MS);
    if (!ready || ready.type !== 'READY') {
      throw new WorldError('已连上 WebSocket，但 8 秒内没有收到 READY 握手消息', {
        code: 'READY_TIMEOUT',
        hint: '可能是服务端版本与协议不匹配，或连接已被对端关闭。可重试一次。'
      });
    }
    await this._subscribe();
    if (this.isGuest()) {
      this.http.noteOnce('游客档（拉模式）收不到实时推送：真人说话/走动不会主动送到你这里，'
        + '只能用 world_observe / world_chat_history 主动拉。想要实时感请配 AGENT_API_KEY。');
    }
    this.log(`WS ready | tier=${this.http.tier} connects=${this.wsConnectCount} reconnected=${reconnected}`);
    return { connected: true, reconnected, ready: ready.payload };
  }

  _attachWs(ws) {
    this.bus.reset();
    ws.addEventListener('message', (ev) => {
      let msg = null;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      this._onMessage(msg);
    });
    ws.addEventListener('close', (ev) => {
      this.lastClose = { code: ev.code, reason: ev.reason || '', at: new Date().toISOString() };
      this.wsClosedCount += 1;
      if (this.ws === ws || !this.ws) {
        this.ws = null;
        this.wsReady = false;
        this.subscribedTopics = [];
      }
      this.log(`WS closed code=${ev.code} reason=${ev.reason || '-'}（下次工具调用会自动重连）`);
      this.bus.failAll('连接已断开');
    });
    ws.addEventListener('error', () => { /* 由 close/超时处理 */ });
  }

  _onMessage(msg) {
    const p = msg.payload || {};

    if (msg.type === 'READY') {
      this.wsReady = true;
      if (p.spawn) this.spawn = p.spawn;
      if (p.tier) this.http.tier = p.tier;
      if (p.tierInfo) this.http.tierInfo = p.tierInfo;
      if (p.agentId) this.http.agentId = p.agentId;
      if (p.agentName) this.http.agentName = p.agentName;
      if (p.pushTier) this.pushTier = p.pushTier;
    }
    if (msg.type === 'SUBSCRIBED' && Array.isArray(p.topics)) this.subscribedTopics = p.topics;

    this._bufferEvent(msg);
    this.bus.ingest(msg);        // 回执派发 + 类型等待者（放在状态更新之后）
  }

  /** 事件环形缓冲：只留 AI 真正关心的几类（有上限，防长会话内存增长） */
  _bufferEvent(msg) {
    const type = msg.type;
    if (type !== 'CHAT' && type !== 'ENTITY_ADDED' && type !== 'ENTITY_REMOVED' && type !== 'ERROR') return;
    const p = msg.payload || {};
    let data = null;
    if (type === 'CHAT') {
      data = {
        from: p.sender || p.senderName || '?',
        senderId: p.characterId || p.senderId || null,
        text: String(p.message || '').slice(0, 200)
      };
    } else if (type === 'ENTITY_ADDED') {
      data = { id: p.id, name: p.name, kind: p.type };
    } else if (type === 'ENTITY_REMOVED') {
      data = { id: p.id };
    } else {
      data = { code: p.code, message: p.message };
    }
    this.events.push({ seq: ++this.eventSeq, at: new Date().toISOString(), type, data });
    if (this.events.length > EVENT_BUFFER_MAX) this.events.splice(0, this.events.length - EVENT_BUFFER_MAX);
  }

  /** 取出"上次观察之后"的新事件（world_observe 用它让 AI 感知有人说话） */
  takeEvents() {
    const fresh = this.events.filter((e) => e.seq > this.eventCursor);
    this.eventCursor = this.eventSeq;
    return fresh;
  }

  /** 订阅推送（仅 Key 档有意义：游客 SUBSCRIBE 必被拒，直接跳过省一次往返） */
  async _subscribe() {
    if (this.isGuest()) return;
    try {
      this.ws.send(JSON.stringify({
        type: 'SUBSCRIBE',
        payload: { topics: ['chat', 'movement', 'presence'], radius: this.wsRadius }
      }));
    } catch (e) {
      return;
    }
    const [sub, err] = await Promise.all([
      this.bus.watchType('SUBSCRIBED', 3000),
      this.bus.watchType('ERROR', 800)
    ]);
    if (sub && sub.type === 'SUBSCRIBED') {
      this.subscribedTopics = (sub.payload && sub.payload.topics) || [];
      this.subscribedRadius = sub.payload && sub.payload.radius;
    } else if (err && err.type === 'ERROR' && err.payload && err.payload.code === 'GUEST_PUSH_FORBIDDEN') {
      this.http.noteOnce('服务端拒绝了推流订阅（GUEST_PUSH_FORBIDDEN）：本会话只能主动拉取。');
    }
  }

  // ==================== 动作 ====================

  /**
   * 发一条 WS ACTION 并等回执。
   * @returns {{ requestId, payload, receipt, waitFor }}
   *   receipt 为第一条回执（ACTION_ACCEPTED / ACTION_COMPLETED / ACTION_REJECTED）或 null（超时）
   *   waitFor(types, ms) 继续等后续回执（walk_to 的"到达"就是异步补发的）
   */
  async action(action, params = {}, opts = {}) {
    await this.ensureWs();
    const requestId = `mcp-${++this._reqSeq}`;
    const payload = { action, requestId, ...params };
    this.ws.send(JSON.stringify({ type: 'ACTION', payload }));
    const receipt = await this.bus.watch(
      requestId,
      opts.firstTypes || ['ACTION_ACCEPTED', 'ACTION_COMPLETED', 'ACTION_REJECTED'],
      opts.firstMs || 6000
    );
    return { requestId, payload, receipt, waitFor: (types, ms) => this.bus.watch(requestId, types, ms) };
  }

  // ==================== 离场 / 关闭 ====================

  /** 优雅离场（关连接 → 服务端广播 PLAYER_LEFT，世界里的人物消失） */
  async leave() {
    const wasConnected = Boolean(this.ws);
    this.stopKeepAlive();
    if (this.ws) {
      try { this.ws.close(1000, 'mcp leave'); } catch (e) { /* noop */ }
    }
    this.ws = null;
    this.wsReady = false;
    this.subscribedTopics = [];
    if (wasConnected) this.log('left world (WS closed)');
    return { wasConnected };
  }

  async close() {
    await this.leave();
  }

  startKeepAlive(seconds) {
    const s = Number(seconds) || 0;
    if (s <= 0 || this._keepAliveTimer) return;
    this._keepAliveTimer = setInterval(() => {
      try {
        if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'PING', payload: {} }));
      } catch (e) { /* noop */ }
    }, s * 1000);
    if (this._keepAliveTimer.unref) this._keepAliveTimer.unref();
  }

  stopKeepAlive() {
    if (this._keepAliveTimer) {
      clearInterval(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
  }

  /** 诊断信息（不暴露 Key；token 只给前缀） */
  diagnostics() {
    return {
      ...this.status(),
      endpoints: (() => { try { return this.endpoints; } catch (e) { return null; } })(),
      tokenPrefix: this.token ? String(this.token).slice(0, 12) + '…' : null,
      eventsBuffered: this.events.length,
      notes: [...this.notes]
    };
  }
}

/**
 * 把动作回执翻译成可读结果：
 *   - 没有回执（超时）→ 抛 WorldError（可读）
 *   - ACTION_REJECTED → 抛 WorldError（带人话 hint，见 errors.js）
 *   - 其余 → { receiptType, result }
 */
export function interpretReceipt(result) {
  const r = result.receipt;
  if (!r) {
    throw new WorldError(`动作 ${result.payload.action} 发出后 6 秒内没有收到任何回执`, {
      code: 'ACTION_NO_RECEIPT',
      hint: '可能是连接刚断开或服务端繁忙。稍后重试；若反复出现，先 world_discover 确认世界上线状态。'
    });
  }
  if (r.type === 'ACTION_REJECTED') throw actionError(r.payload || {});
  return { receiptType: r.type, result: (r.payload && r.payload.result) || {} };
}

export function createClientFromEnv(env = process.env, options = {}) {
  return new WorldClient({
    host: env.AGENT_HOST,
    apiKey: env.AGENT_API_KEY,
    wsRadius: env.MCP_WS_RADIUS,
    keepAliveSeconds: env.MCP_KEEPALIVE_SECONDS,
    ...options
  });
}

export { AGENT_TIER_GUEST, deriveEndpoints };
