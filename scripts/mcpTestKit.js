/**
 * mcpTestKit.js — MCP Server 验收专用工具（被 scripts/accept_mcp_server.js 使用）
 *
 * 提供三样东西：
 *   ① McpStdioClient：以真实 MCP 宿主的方式（stdio + JSON-RPC）拉起 examples/mcp-server 并调用工具。
 *      刻意**不依赖** @modelcontextprotocol/sdk —— 主项目 package.json 不许被污染（红线 5），
 *      手写 JSON-RPC 也顺便验证了协议层（很多宿主就是手写/异构实现）。
 *   ② 管理员助手：登录 / 读配置 / 开关 agent_enabled（走 admin API，直写 DB 不会让 60s 缓存失效）。
 *   ③ 文本解析：从 world_observe 的输出里取自身坐标（该格式由 examples/mcp-server/src/format.js 定义）。
 *
 * ⚠️ 踩坑记录：MCP 的 initialize 请求**必须**带 protocolVersion / capabilities / clientInfo，
 *    否则服务端不应答（表现为"发出去没反应"，很容易误判成 server 挂了）。
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const MCP_DIR = path.join(__dirname, '..', 'examples', 'mcp-server');
const MCP_ENTRY = path.join(MCP_DIR, 'src', 'index.js');
const AGENT_STORE = path.join(__dirname, '_tmp_tier_agents.json');
const PROTOCOL_VERSION = '2025-06-18';

// ==================== MCP stdio 客户端 ====================

class McpStdioClient {
  /**
   * @param {object} opts { name, env, cwd }
   *   env 会与 process.env 合并后传给子进程；AGENT_HOST / AGENT_API_KEY 由调用方给。
   */
  constructor(opts = {}) {
    this.name = opts.name || 'mcp';
    this.env = opts.env || {};
    this.cwd = opts.cwd || MCP_DIR;
    this.child = null;
    this.stderrLines = [];
    this.serverInfo = null;
    this.protocolVersion = null;
    this._buf = '';
    this._pending = new Map();
    this._seq = 0;
    this._exited = null;
  }

  async start(timeoutMs = 20000) {
    this.child = spawn(process.execPath, [MCP_ENTRY], {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout.on('data', (d) => this._onStdout(d.toString('utf8')));
    this.child.stderr.on('data', (d) => {
      const line = d.toString('utf8').trim();
      if (line) this.stderrLines.push(line);
    });
    this.child.on('exit', (code) => {
      this._exited = code;
      for (const [, p] of this._pending) p.reject(new Error(`[${this.name}] MCP server 进程退出 code=${code}`));
      this._pending.clear();
    });

    const init = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'accept-mcp-server', version: '1.0.0' }
    }, timeoutMs);
    this.serverInfo = (init && init.serverInfo) || null;
    this.protocolVersion = (init && init.protocolVersion) || null;
    this.notify('notifications/initialized', {});
    return init;
  }

  _onStdout(chunk) {
    this._buf += chunk;
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, idx).trim();
      this._buf = this._buf.slice(idx + 1);
      if (!line) continue;
      let msg = null;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.id != null && this._pending.has(msg.id)) {
        const p = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(Object.assign(new Error(`RPC error: ${msg.error.message || JSON.stringify(msg.error)}`), { rpcError: msg.error }));
        else p.resolve(msg.result);
      }
    }
  }

  request(method, params, timeoutMs = 30000) {
    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`[${this.name}] ${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._write({ jsonrpc: '2.0', id, method, params: params || {} });
    });
  }

  notify(method, params) {
    this._write({ jsonrpc: '2.0', method, params: params || {} });
  }

  _write(obj) {
    if (!this.child || !this.child.stdin.writable) throw new Error(`[${this.name}] stdin 不可写`);
    this.child.stdin.write(JSON.stringify(obj) + '\n');
  }

  listTools() { return this.request('tools/list', {}); }
  listResources() { return this.request('resources/list', {}); }
  listPrompts() { return this.request('prompts/list', {}); }
  readResource(uri) { return this.request('resources/read', { uri }); }
  getPrompt(name, args) { return this.request('prompts/get', { name, arguments: args || {} }); }

  /** 调工具：返回 { isError, text, raw }（工具内部错误不会 reject，便于断言可读文案） */
  async callTool(name, args = {}, timeoutMs = 40000) {
    const res = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    return { isError: Boolean(res && res.isError), text: textOf(res), raw: res };
  }

  async stop() {
    try { this.child.stdin.end(); } catch (e) { /* noop */ }
    try { this.child.kill(); } catch (e) { /* noop */ }
    for (const [, p] of this._pending) { clearTimeout(p.timer); p.reject(new Error('stopped')); }
    this._pending.clear();
  }

  get exited() { return this._exited; }
}

/** 取 tools/call 结果里的文本（MCP 允许 content 为多块，这里拼起来） */
function textOf(result) {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n');
}

/**
 * 从 world_observe 输出里解析自身坐标。
 * 依赖 format.js 里刻意保留的锚点行：`你在 (x, y, z)，观察半径 …`
 */
function parseSelfPosition(text) {
  const m = /你在 \(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/.exec(text || '');
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
}

// ==================== 管理员助手 ====================

async function httpJson(p, options = {}) {
  const { method = 'GET', headers = {}, body } = options;
  const h = { ...headers };
  let payload;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(BASE + p, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json, text };
}

/** 管理员 token：优先复用 scripts/_tmp_tier_agents.json，避免烧掉 IP 登录限流 */
async function adminToken(credentials) {
  const creds = credentials || [
    { username: process.env.ADMIN_USER || 'baseline_shot', password: process.env.ADMIN_PASS || 'Baseline#185' },
    { username: 'admin', password: process.env.ADMIN_PASS || 'admin123' }
  ];
  try {
    if (fs.existsSync(AGENT_STORE)) {
      const prev = JSON.parse(fs.readFileSync(AGENT_STORE, 'utf8'));
      if (prev.adminToken) {
        const t = await httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + prev.adminToken } });
        if (t.status === 200) return prev.adminToken;
      }
    }
  } catch (e) { /* 回落登录 */ }
  for (const c of creds) {
    const r = await httpJson('/api/admin-auth/login', { method: 'POST', body: c });
    const tok = r.json && (r.json.token || (r.json.data && r.json.data.token));
    if (tok) return tok;
  }
  return null;
}

async function getAgentConfig(token) {
  const r = await httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + token } });
  return (r.json && r.json.config) || null;
}

async function setAgentEnabled(token, enabled) {
  return httpJson('/api/agent/v1/admin/config', {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token },
    body: { agent_enabled: Boolean(enabled) }
  });
}

/**
 * 取一个可用的 Key Agent（env → 本地账本 → 现场创建），返回 { apiKey, agentId, name, from }
 * @param opts.key  账本里的档位名（'eco' | 'standard' | 'realtime'）：用于拿**两个不同**的 Agent
 *                  （max_connections_per_agent=1，同一个 Agent 的第二条连接会顶替掉第一条）
 */
async function ensureKeyAgent(token, opts = {}) {
  const wantKey = opts.key || null;
  const candidates = [];
  if (process.env.MCP_TEST_API_KEY) candidates.push({ apiKey: process.env.MCP_TEST_API_KEY, name: 'env', from: 'env' });
  try {
    if (fs.existsSync(AGENT_STORE)) {
      const store = JSON.parse(fs.readFileSync(AGENT_STORE, 'utf8'));
      for (const a of store.created || []) {
        if (a && a.apiKey) candidates.push({ apiKey: a.apiKey, agentId: a.id, name: a.name, key: a.key, from: 'store' });
      }
    }
  } catch (e) { /* ignore */ }
  for (const c of candidates) {
    if (wantKey && c.key && c.key !== wantKey) continue;
    const s = await httpJson('/api/agent/v1/session', { method: 'POST', headers: { Authorization: 'Bearer ' + c.apiKey }, body: {} });
    if (s.status === 200 && s.json && s.json.token) {
      return { ...c, agentId: (s.json.agent && s.json.agent.id) || c.agentId, name: (s.json.agent && s.json.agent.name) || c.name };
    }
  }
  const created = await httpJson('/api/agent/v1/admin/agents', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: { name: opts.newName || `mcp_accept_${Date.now().toString().slice(-6)}` }
  });
  const apiKey = created.json && created.json.apiKey;
  if (!apiKey) return null;
  return { apiKey, agentId: created.json.agent && created.json.agent.id, name: created.json.agent && created.json.agent.name, from: 'created' };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = {
  BASE,
  MCP_DIR,
  MCP_ENTRY,
  AGENT_STORE,
  PROTOCOL_VERSION,
  McpStdioClient,
  textOf,
  parseSelfPosition,
  httpJson,
  adminToken,
  getAgentConfig,
  setAgentEnabled,
  ensureKeyAgent,
  sleep
};
