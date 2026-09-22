/**
 * httpClient.js — 世界接入的"HTTP 侧"：端点推导 / 发现 / 签票与续期 / observe / 聊天历史
 *
 * 三条设计约束（每条都对应提示词 §2 的实测结论）：
 *
 *   1) **协议不盲信发现文档**（§2.3）：端点一律由 AGENT_HOST 的协议推导，文档只用来取路径。
 *      线上发现文档可能仍广播 `http://`（反向代理没透传 X-Forwarded-Proto），
 *      盲信它会在 https 站点上踩 Mixed Content。发现不一致时记一条 note 提示用户。
 *
 *   2) **Key 档自动续期**（§2.5）：Agent JWT TTL 900s，HTTP 端点**每次调用都校验**、
 *      WS 只在建连时校验一次 → 在"剩余 < TTL/3"时用 API Key 换新 token。
 *      ⚠️ 只换 token 变量，**绝不重连 WS**（重连会让真人玩家看到形象闪烁）。
 *
 *   3) **游客档不静默换票**（§2.5）：每次 /guest/session 都会生成全新身份
 *      （`agent:guest:<uuid>`），静默换票会让"HTTP 身份"与"已连通的 WS 身份"错位
 *      → 票过期只抛可读错误，让用户重启 MCP server 或改用 API Key。
 */

import { WorldError, httpError } from './errors.js';

const DEFAULT_HOST = 'http://localhost:3002';
const WELLKNOWN_TTL_MS = 5 * 60 * 1000;
const FALLBACK_SESSION_TTL = 900;
const FALLBACK_GUEST_TTL = 1800;
const HTTP_TIMEOUT_MS = 15000;

export const AGENT_TIER_GUEST = 'guest-pull';

/** 由 AGENT_HOST 推导全部端点（协议以它为准；只从发现文档取路径） */
export function deriveEndpoints(host) {
  let u;
  try {
    u = new URL(host);
  } catch (e) {
    throw new WorldError(`AGENT_HOST 不是合法 URL：${host}`, {
      code: 'BAD_HOST',
      hint: '示例：AGENT_HOST=https://miduo100.com 或 http://localhost:3002'
    });
  }
  const origin = u.origin;
  return {
    origin,
    apiBase: origin + '/api/agent/v1',
    wsUrl: (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/ws/agent',
    protocol: u.protocol.replace(':', ''),
    wellKnown: origin + '/.well-known/virtual-world-agent.json'
  };
}

export class WorldHttp {
  constructor(options = {}) {
    this.host = String(options.host || process.env.AGENT_HOST || DEFAULT_HOST).replace(/\/+$/, '');
    this.apiKey = String(options.apiKey || process.env.AGENT_API_KEY || '').trim();
    this.autoRefresh = options.autoRefresh !== false;   // false 仅供验收脚本压"token 过期"窗口
    this.log = options.log || (() => {});

    this.token = null;
    this.tier = null;                 // 'guest-pull' | 'key-push'
    this.agentId = null;
    this.agentName = null;
    this.tierInfo = null;
    this.tokenExpiresAt = 0;
    this.guestExpiresAt = 0;
    this.sessionTtlSeconds = FALLBACK_SESSION_TTL;
    this.guestTtlSeconds = FALLBACK_GUEST_TTL;
    this.protocolMismatch = false;
    this.notes = [];

    this._wellKnown = null;
    this._wellKnownAt = 0;
    this._signPromise = null;
    this.lastObserve = null;
    this.lastObserveAt = 0;
  }

  get endpoints() { return deriveEndpoints(this.host); }

  isGuest() { return this.tier === AGENT_TIER_GUEST; }

  noteOnce(text) { if (!this.notes.includes(text)) this.notes.push(text); }

  /** 升级提示（游客档才有；来自服务端 tiers.*.upgradeHint） */
  upgradeHint() {
    if (this.tierInfo && this.tierInfo.upgradeHint) return this.tierInfo.upgradeHint;
    const wk = this._wellKnown;
    const t = wk && wk.tiers && wk.tiers[AGENT_TIER_GUEST];
    return (t && t.upgradeHint) || null;
  }

  // ==================== 发现 ====================

  async discover(force = false) {
    if (!force && this._wellKnown && Date.now() - this._wellKnownAt < WELLKNOWN_TTL_MS) return this._wellKnown;
    const ep = this.endpoints;
    let res;
    try {
      res = await fetch(ep.wellKnown, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch (e) {
      throw new WorldError(`读取世界发现文档失败：${e.message}`, {
        code: 'DISCOVERY_FAILED',
        hint: `请确认 AGENT_HOST（${this.host}）可访问，且该世界已部署 Agent 接入。`
      });
    }
    const text = await res.text().catch(() => '');
    let doc = null;
    try { doc = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    if (!res.ok || !doc || !doc.success) {
      throw httpError(res.status, doc, { what: '/.well-known/virtual-world-agent.json', host: this.host });
    }

    this._wellKnown = doc;
    this._wellKnownAt = Date.now();
    const auth = doc.auth || {};
    if (Number(auth.sessionTtlSeconds) > 0) this.sessionTtlSeconds = Number(auth.sessionTtlSeconds);
    if (Number(auth.guestSessionTtlSeconds) > 0) this.guestTtlSeconds = Number(auth.guestSessionTtlSeconds);

    const docApi = (doc.endpoints && doc.endpoints.apiBase) || '';
    const proto = /^([a-z][a-z0-9+.-]*):\/\//i.exec(docApi);
    const docProto = proto ? proto[1].toLowerCase() : null;
    this.protocolMismatch = Boolean(docProto && docProto !== ep.protocol);
    if (this.protocolMismatch) {
      this.noteOnce(
        `发现文档广播的是 ${docProto}://（${docApi}），与 AGENT_HOST 的 ${ep.protocol}:// 不一致：`
        + `本客户端按 AGENT_HOST 的协议访问（${ep.apiBase}），否则 https 站点会踩 Mixed Content。`
        + '这通常说明世界侧反向代理没有透传 X-Forwarded-Proto，值得反馈给世界管理员。'
      );
    }
    return doc;
  }

  // ==================== 会话：签票 / 续期 ====================

  _assertGuestAlive() {
    if (!this.token) {
      throw new WorldError('还没有游客票', { code: 'NO_SESSION', hint: '先调用 world_enter 进入世界。' });
    }
    if (this.guestExpiresAt && Date.now() >= this.guestExpiresAt) {
      throw new WorldError('游客票已过期（30 分钟）', {
        code: 'GUEST_TICKET_EXPIRED',
        hint: '游客票**不能续期**（换新票 = 换新身份，会让已在世界里的形象与 HTTP 身份错位）。'
          + '请重启 MCP server 重新签票，或配置 AGENT_API_KEY 使用 Key 档（可长期驻场并自动续期）。'
      });
    }
  }

  /** 保证有可用 token：Key 档按 TTL/3 阈值提前换票；游客档只校验有效期，绝不静默换票 */
  async ensureSession() {
    if (!this._wellKnown) await this.discover();
    if (this.isGuest()) {
      this._assertGuestAlive();
      return this.token;
    }
    const left = this.token ? this.tokenExpiresAt - Date.now() : -1;
    const threshold = Math.max(30000, Math.round((this.sessionTtlSeconds * 1000) / 3));
    if (!this.token || (this.autoRefresh && left < threshold)) {
      await this.signSession();
    } else if (!this.autoRefresh && left <= 0) {
      throw new WorldError('Agent 会话已过期（已禁用自动续期）', {
        code: 'TOKEN_EXPIRED',
        hint: '正常使用不会出现：autoRefresh 默认开启（只有验收脚本会关它来压缩过期窗口）。'
      });
    }
    return this.token;
  }

  /** 换票：有 API Key 走 /session；无 Key 走公开 /guest/session（只签一次，之后复用） */
  async signSession() {
    if (this._signPromise) return this._signPromise;
    this._signPromise = this._doSign();
    try {
      return await this._signPromise;
    } finally {
      this._signPromise = null;
    }
  }

  async _doSign() {
    const ep = this.endpoints;
    const isKey = Boolean(this.apiKey);
    const url = isKey ? ep.apiBase + '/session' : ep.apiBase + '/guest/session';
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (isKey) headers.Authorization = 'Bearer ' + this.apiKey;

    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch (e) {
      throw new WorldError(`建立 Agent 会话失败：${e.message}`, {
        code: 'SESSION_REQUEST_FAILED',
        hint: `请确认 AGENT_HOST（${this.host}）可访问。`
      });
    }
    const text = await res.text().catch(() => '');
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    if (!res.ok || !body || !body.token) {
      throw httpError(res.status, body, { what: isKey ? '/session' : '/guest/session', host: this.host });
    }

    this.token = body.token;
    this.tier = body.tier || (isKey ? 'key-push' : AGENT_TIER_GUEST);
    this.agentId = (body.agent && body.agent.id) || null;
    this.agentName = (body.agent && body.agent.name) || null;
    this.tierInfo = body.tierInfo || null;
    const expiresIn = Number(body.expiresIn) || (isKey ? this.sessionTtlSeconds : this.guestTtlSeconds);
    if (this.isGuest()) this.guestExpiresAt = Date.now() + expiresIn * 1000;
    else this.tokenExpiresAt = Date.now() + expiresIn * 1000;
    this.log(`session ok | tier=${this.tier} agent=${this.agentName} expiresIn=${expiresIn}s`);
    return this.token;
  }

  /** 凭据是否有效？用于把 WS upgrade 失败翻译成人话（WHATWG WebSocket 拿不到 HTTP 状态码） */
  async probeCredential() {
    try {
      const res = await fetch(this.endpoints.apiBase + '/me', {
        headers: { Authorization: 'Bearer ' + this.token, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      const text = await res.text().catch(() => '');
      let body = null;
      try { body = JSON.parse(text); } catch (e) { /* noop */ }
      return { status: res.status, code: body && body.code, message: body && body.error };
    } catch (e) {
      return null;
    }
  }

  // ==================== HTTP：observe / chat history ====================

  _observeIntervalMs() {
    const wk = this._wellKnown;
    if (this.isGuest()) {
      const s = (wk && wk.limits && Number(wk.limits.guestObserveIntervalSeconds)) || 2;
      return s * 1000;
    }
    const hz = (wk && wk.limits && Number(wk.limits.observeRateLimitPerSecond)) || 1;
    return Math.ceil(1000 / Math.max(1, hz));
  }

  /**
   * 空间雷达。客户端侧也做节流（服务端限频是硬闸，撞 429 只是浪费一次往返）：
   * 不足间隔时**等待**而不是返回缓存 —— 缓存会让"刚落库的描述 / 刚移动的位置"看不见。
   */
  async observe(params = {}) {
    const interval = this._observeIntervalMs();
    let waitedMs = 0;
    if (this.lastObserveAt) {
      const rest = interval - (Date.now() - this.lastObserveAt);
      if (rest > 0) { waitedMs = rest; await new Promise((r) => setTimeout(r, rest)); }
    }
    const qs = new URLSearchParams();
    if (params.radius != null) qs.set('radius', String(params.radius));
    if (params.include) qs.set('include', String(params.include));
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.x != null) qs.set('x', String(params.x));
    if (params.y != null) qs.set('y', String(params.y));
    if (params.z != null) qs.set('z', String(params.z));
    const q = qs.toString();
    this.lastObserveAt = Date.now();
    const body = await this.httpGet('/observe' + (q ? '?' + q : ''));
    this.lastObserve = body;
    return { body, waitedMs };
  }

  async chatHistory(limit = 20) {
    return this.httpGet('/chat/history?limit=' + encodeURIComponent(limit));
  }

  async httpGet(path) {
    await this.ensureSession();
    const url = this.endpoints.apiBase + path;
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + this.token, Accept: 'application/json' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
      });
    } catch (e) {
      throw new WorldError(`请求世界接口失败：${e.message}`, {
        code: 'NETWORK_ERROR',
        hint: `请确认 AGENT_HOST（${this.host}）可访问。`
      });
    }
    const text = await res.text().catch(() => '');
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* noop */ }
    if (!res.ok) throw httpError(res.status, body, { what: path, host: this.host, tier: this.tier });
    return body;
  }
}
