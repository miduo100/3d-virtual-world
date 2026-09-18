/**
 * _tmp_fixb_live.js — 临时：缺陷 B 真人联测（同一 API Key 开第二条连接 → 旧连接被顶掉）
 *
 * 用法：AGENT_HOST=http://localhost:3002 AGENT_API_KEY=agk_... node scripts/_tmp_fixb_live.js [holdMs]
 *
 * 同时验证缺陷 J（新发现）：新会话的 current_position 为空 → presenceBridge 用 (0,0,0) 当出生点，
 * 于是"重连/新客户端"会把 Agent 瞬移回原点。本脚本先打印 J 的证据（会话位置为空 → 默认出生点），
 * 然后把该会话位置预置为 Agent 实时位置再连接，避免联测期间干扰真人视线。
 */
require('dotenv').config();
const path = require('path');
const { query } = require('../src/database/db');

const HOST = process.env.AGENT_HOST || 'http://localhost:3002';
const WS = HOST.replace(/^http/, 'ws');
const KEY = process.env.AGENT_API_KEY || '';
const HOLD_MS = parseInt(process.argv[2] || '30000', 10);

function decodeJwt(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
  } catch (e) { return null; }
}

(async () => {
  if (!KEY) { console.log('missing AGENT_API_KEY'); process.exit(1); }
  const s = await (await fetch(HOST + '/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: '{}'
  })).json();
  if (!s || !s.token) { console.log('session failed', JSON.stringify(s)); process.exit(1); }
  const payload = decodeJwt(s.token);
  const jti = payload && payload.jti;
  console.log('[J] new session agentId=' + (s.agent && s.agent.id) + ' jti=' + jti);

  // 证据 J：新会话行为 —— 该会话在 DB 里没有 current_position
  const row = await query('SELECT id, current_position FROM agent_sessions WHERE jti = $1', [jti]);
  const before = row.rows[0] ? row.rows[0].current_position : undefined;
  console.log('[J] session.current_position before = ' + JSON.stringify(before) + '  (null → presenceBridge 会退回 (0,0,0) 出生点)');

  // 用新会话调 observe（修好 A 后 self 取实时位置），把该会话位置预置成实时位置
  const ob = await (await fetch(HOST + '/api/agent/v1/observe?radius=5', { headers: { Authorization: 'Bearer ' + s.token } })).json().catch(() => null);
  const live = ob && ob.self && ob.self.position;
  console.log('[J] live position (from observe.self of the NEW session) = ' + JSON.stringify(live));
  if (live && row.rows[0]) {
    await query('UPDATE agent_sessions SET current_position = $1 WHERE jti = $2', [JSON.stringify(live), jti]);
    console.log('[J] pre-seeded the new session position to the live position (avoids teleport-to-origin during this test)');
  }

  const ws = new WebSocket(`${WS}/ws/agent?token=${encodeURIComponent(s.token)}`);
  let readyAt = 0;
  let closed = null;
  ws.addEventListener('message', (ev) => {
    let m = null; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === 'READY') {
      readyAt = Date.now();
      console.log('[B] READY at ' + new Date().toISOString().slice(11, 19)
        + ' agentId=' + m.payload.agentId + ' pushTier=' + m.payload.pushTier
        + ' spawn=' + JSON.stringify(m.payload.spawn));
    } else if (m.type === 'ERROR') {
      console.log('[B] ERROR ' + JSON.stringify(m.payload));
    }
  });
  ws.addEventListener('close', (ev) => {
    closed = { code: ev.code, reason: ev.reason, at: new Date().toISOString().slice(11, 19) };
    console.log('[B] CLOSED code=' + ev.code + ' reason=' + ev.reason + ' at ' + closed.at);
  });

  await new Promise((r) => setTimeout(r, HOLD_MS));
  console.log('[B] hold done. closeInfo=' + JSON.stringify(closed));
  try { ws.close(); } catch (e) { /* ignore */ }
  process.exitCode = 0;
})();
