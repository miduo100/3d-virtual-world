/**
 * _tmp_agent_switch.js — 联测环境前置：打开/关闭 Agent 总开关（复用已有 adminToken，不烧登录限流）
 *
 * 为什么需要：很多 v4 之前的验收脚本里有一条判据
 *   `R.check('V0/P0 agent_enabled=true（联测期前置）', origEnabled === true)`
 * 它们在**开跑前**读配置并要求它已经是 true（v4 联测期总开关一直开着，所以全绿）；
 * 而从干净态（红线 6：默认关）直接跑，这些判据必然 FAIL —— 那是**判据口径问题，不是产品缺陷**。
 * 正确做法是按文档 §0 的环境前置：开跑前统一打开，跑完再关。
 *
 * 用法：
 *   node scripts/_tmp_agent_switch.js true      # 打开（联测前）
 *   node scripts/_tmp_agent_switch.js false     # 关闭（收尾，红线 6）
 *   node scripts/_tmp_agent_switch.js           # 只打印当前状态
 *
 * 登录策略：优先复用 scripts/_tmp_tier_agents.json 里的 adminToken；失效才登录一次。
 */

const fs = require('fs');
const path = require('path');

const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const STORE = path.join(__dirname, '_tmp_tier_agents.json');

async function httpJson(p, { method = 'GET', token, body } = {}) {
  const h = {};
  if (token) h.Authorization = 'Bearer ' + token;
  let payload;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json, text };
}

async function adminToken() {
  try {
    if (fs.existsSync(STORE)) {
      const prev = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      if (prev.adminToken) {
        const t = await httpJson('/api/agent/v1/admin/config', { token: prev.adminToken });
        if (t.status === 200) { console.log('[admin] 复用已有 token'); return prev.adminToken; }
      }
    }
  } catch (e) { /* 回落登录 */ }
  const r = await httpJson('/api/admin-auth/login', {
    method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
  });
  const j = r.json || {};
  console.log('[admin] 登录 ->', r.status);
  return j.token || (j.data && j.data.token) || null;
}

(async () => {
  const token = await adminToken();
  if (!token) { console.log('FATAL: 拿不到 adminToken'); process.exitCode = 1; return; }

  const want = process.argv[2];
  const before = await httpJson('/api/agent/v1/admin/config', { token });
  const cur = before.json && before.json.config;
  console.log('当前:', JSON.stringify({ agentEnabled: cur && cur.agentEnabled, maxAgents: cur && cur.maxAgents, pushDefault: cur && cur.pushDefault }));

  if (want !== 'true' && want !== 'false') { process.exitCode = 0; return; }

  const put = await httpJson('/api/agent/v1/admin/config', {
    method: 'PUT', token, body: { agent_enabled: want }
  });
  const after = await httpJson('/api/agent/v1/admin/config', { token });
  const now = after.json && after.json.config;
  console.log(`PUT agent_enabled=${want} ->`, put.status, '| 现在 agentEnabled =', now && now.agentEnabled);
  process.exitCode = (now && String(now.agentEnabled) === want) ? 0 : 1;
})();
