/**
 * AI Agent 接入 v2 联测工具包（共享 helper，供 accept_agent_v2_auth_*.js 使用）
 *
 * 只做三件事：HTTP JSON 请求、游客签票、Agent WS 连接（含 upgrade 被拒时的状态码捕获）。
 * 零业务逻辑，不 require 任何 src/ 下的模块（避免与服务器进程状态耦合）。
 *
 * 坑位备忘：
 *   - 反代 IP 口径用 X-Real-IP + X-Forwarded-For 同时设置（与本项目 Nginx 部署口径一致）；
 *     服务端 HTTP 侧走 Express trust proxy(=1) → req.ip 取 XFF 最后一段，
 *     WS 侧走 middleware/clientIp.resolveClientIp → X-Real-IP 优先。
 *   - ws 库在 upgrade 被拒时触发 'unexpected-response'，statusCode 即服务端写入的状态码。
 */

const WebSocket = require('ws');

const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const WS_AGENT_BASE = BASE.replace(/^http/, 'ws') + '/ws/agent';
const WS_HUMAN_BASE = BASE.replace(/^http/, 'ws') + '/';

// ==================== 断言收集 ====================

function createReporter(title) {
  const rows = [];
  let pass = 0, fail = 0;
  return {
    check(name, ok, detail) {
      if (ok) pass++; else fail++;
      const line = `${ok ? 'PASS' : 'FAIL'} | ${name}${detail !== undefined ? ' | ' + fmt(detail) : ''}`;
      rows.push({ name, ok: Boolean(ok), detail });
      console.log(line);
      return ok;
    },
    info(name, detail) {
      rows.push({ name, info: true, detail });
      console.log(`INFO | ${name}${detail !== undefined ? ' | ' + fmt(detail) : ''}`);
    },
    summary() {
      console.log('');
      console.log(`===== ${title} : ${pass}/${pass + fail} PASS =====`);
      return { pass, fail, total: pass + fail, rows };
    }
  };
}

function fmt(v) {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

// ==================== HTTP ====================

async function httpJson(path, options = {}) {
  const { method = 'GET', headers = {}, body, ip } = options;
  const h = { ...headers };
  if (ip) { h['X-Real-IP'] = ip; h['X-Forwarded-For'] = ip; }
  let payload;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers: h, body: payload });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json, text };
}

/** 游客签票（公开端点，不带任何鉴权头） */
async function guestTicket(ip) {
  const r = await httpJson('/api/agent/v1/guest/session', { method: 'POST', body: {}, ip });
  return { ...r, ticket: r.json && r.json.token ? r.json : null };
}

// ==================== WebSocket ====================

/**
 * 连接 Agent WS。返回：
 *   { ok:true, ws, msgs, closeInfo } | { ok:false, statusCode, error }
 * msgs 为收到的消息数组（实时追加）。closeInfo 在关闭后填充 {code, reason}。
 */
function openAgentWs({ token, authHeader, ip, timeoutMs = 6000 } = {}) {
  return new Promise((resolve) => {
    let url = WS_AGENT_BASE;
    if (token && !authHeader) url += '?token=' + encodeURIComponent(token);
    const headers = {};
    if (authHeader) headers['Authorization'] = authHeader;
    if (ip) { headers['X-Real-IP'] = ip; headers['X-Forwarded-For'] = ip; }

    const msgs = [];
    const closeInfo = { code: null, reason: null };
    let settled = false;
    let ws;
    try {
      ws = new WebSocket(url, { headers });
    } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { ws.terminate(); } catch (e) {} resolve({ ok: false, error: 'connect_timeout' }); }
    }, timeoutMs);

    ws.on('unexpected-response', (req, res) => {
      clearTimeout(timer);
      if (settled) { try { res.resume(); } catch (e) {} return; }
      settled = true;
      const statusCode = res.statusCode;
      try { res.resume(); } catch (e) {}
      try { ws.terminate(); } catch (e) {}
      resolve({ ok: false, statusCode });
    });
    ws.on('open', () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ ok: true, ws, msgs, closeInfo });
    });
    ws.on('message', (d) => {
      try { msgs.push(JSON.parse(d.toString())); } catch (e) { msgs.push({ type: '__unparsed', raw: d.toString() }); }
    });
    ws.on('close', (code, reason) => {
      closeInfo.code = code;
      closeInfo.reason = reason ? reason.toString() : '';
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) { settled = true; resolve({ ok: false, error: err.message }); }
    });
  });
}

/** 人类 WS（根路径，无鉴权）——用作"真人侧观察者" */
function openHumanWs({ characterId, characterName, position } = {}) {
  return new Promise((resolve) => {
    const msgs = [];
    const closeInfo = { code: null, reason: null };
    let settled = false;
    const ws = new WebSocket(WS_HUMAN_BASE);
    const timer = setTimeout(() => { if (!settled) { settled = true; try { ws.terminate(); } catch (e) {} resolve({ ok: false, error: 'timeout' }); } }, 6000);
    ws.on('open', () => {
      clearTimeout(timer);
      if (characterId) {
        ws.send(JSON.stringify({
          type: 'PLAYER_JOIN',
          payload: {
            characterId, characterName: characterName || characterId,
            position: position || { x: 0, y: 0, z: 0 },
            rotation: 0, glbUrl: null
          }
        }));
      }
      if (!settled) { settled = true; resolve({ ok: true, ws, msgs, closeInfo }); }
    });
    ws.on('message', (d) => { try { msgs.push(JSON.parse(d.toString())); } catch (e) {} });
    ws.on('close', (code, reason) => { closeInfo.code = code; closeInfo.reason = reason ? reason.toString() : ''; });
    ws.on('error', (err) => { clearTimeout(timer); if (!settled) { settled = true; resolve({ ok: false, error: err.message }); } });
  });
}

function wsSend(ws, obj) {
  try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
}

function msgsOfType(msgs, type) {
  return msgs.filter(m => m && m.type === type);
}

/** 等待某类消息出现（轮询 msgs 数组，避免监听时序竞态） */
async function waitFor(msgs, type, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = msgs.find(m => m && m.type === type);
    if (hit) return hit;
    await sleep(50);
  }
  return null;
}

/** 等待 WS 关闭（返回 closeInfo） */
async function waitClose(closeInfo, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (closeInfo.code !== null) return closeInfo;
    await sleep(50);
  }
  return closeInfo;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function closeAll(...wss) {
  for (const w of wss) { try { if (w && w.readyState === 1) w.close(); else if (w) w.terminate(); } catch (e) {} }
}

/** 生成一次性测试 IP（避免烧掉同一窗口的签票额度） */
function testIp(seed) { return `203.0.113.${seed}`; }

module.exports = {
  BASE, WS_AGENT_BASE, WS_HUMAN_BASE,
  createReporter, httpJson, guestTicket,
  openAgentWs, openHumanWs, wsSend, msgsOfType, waitFor, waitClose, sleep, closeAll, testIp
};
