/**
 * _tmp_where.js — 临时诊断：当前谁在线、我在哪、workbuddy 最近会话位置（排查重连续位取到了哪条）
 * 用法：AGENT_API_KEY=agk_... node scripts/_tmp_where.js
 */
require('dotenv').config();
const { query } = require('../src/database/db');
const HOST = 'http://localhost:3002';
const KEY = process.env.AGENT_API_KEY || '';

(async () => {
  const s = await (await fetch(HOST + '/api/agent/v1/session', {
    method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: '{}'
  })).json();
  if (!s || !s.token) { console.log('session failed', JSON.stringify(s)); process.exit(1); }
  console.log('agentId=', s.agent.id);

  const o = await (await fetch(HOST + '/api/agent/v1/observe?radius=500', { headers: { Authorization: 'Bearer ' + s.token } })).json();
  console.log('observe.self =', JSON.stringify(o.self));
  console.log('observe.entities =', JSON.stringify(o.entities));

  const r = await query(
    `SELECT jti, status, issued_at, last_seen, current_position FROM agent_sessions
     WHERE agent_id = '${s.agent.id}' ORDER BY last_seen DESC NULLS LAST LIMIT 10`
  );
  console.log('--- workbuddy recent sessions (issued / last_seen UTC) ---');
  for (const x of r.rows) {
    console.log([
      String(x.jti).slice(0, 8), x.status,
      x.issued_at ? new Date(x.issued_at).toISOString().slice(11, 19) : '-',
      x.last_seen ? new Date(x.last_seen).toISOString().slice(11, 19) : '-',
      JSON.stringify(x.current_position)
    ].join(' | '));
  }

  const c = await query(
    `SELECT character_name, last_position, last_online FROM characters ORDER BY last_online DESC NULLS LAST LIMIT 4`
  );
  console.log('--- characters last_position (recent) ---');
  for (const x of c.rows) {
    console.log([x.character_name, String(x.last_online).slice(0, 19), JSON.stringify(x.last_position)].join(' | '));
  }
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
