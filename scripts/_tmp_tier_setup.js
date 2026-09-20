/**
 * 三档联测 - 环境准备（临时脚本）
 * 1) 管理员登录（1 次），token 落盘供后续轮次复用（避开登录限流 15 次/小时）
 * 2) 开启 agent_enabled，固定基线配置，记录基线
 * 3) **幂等**准备 3 个测试 Agent（eco / standard / realtime），明文 Key 落盘（仅创建/重发时返回）
 *
 * v6 批次 D 改动：原实现每次运行都 POST /admin/agents 新建 3 个（名字带运行号），
 * 联测多轮后 agents 表里堆积几十个 `tier_*_<RUN>` 行。现改为复用优先：
 *   ① 旧账本里的 Key 仍有效且 Agent 还在 → 直接复用（不碰 DB）；
 *   ② 否则按**固定名** `tier_eco`/`tier_std`/`tier_rt` 找，再退而找同前缀的历史批次（`tier_eco_*`）；
 *   ③ 找到但档位不符 → 改档；没有可用的明文 Key → 重发 Key；
 *   ④ 都没有才创建。
 *   ⇒ 连跑两次，agents 表行数不变（幂等）。
 *
 * 运行：node scripts/_tmp_tier_setup.js
 * 产物：scripts/_tmp_tier_agents.json
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const OUT = path.join(__dirname, '_tmp_tier_agents.json');

const SPECS = [
  { key: 'eco', pushTier: 'eco', name: 'tier_eco', prefix: 'tier_eco_' },
  { key: 'standard', pushTier: 'standard', name: 'tier_std', prefix: 'tier_std_' },
  { key: 'realtime', pushTier: 'realtime', name: 'tier_rt', prefix: 'tier_rt_' }
];

async function httpJson(p, { method = 'GET', token, apiKey, body } = {}) {
  const h = {};
  if (token) h.Authorization = 'Bearer ' + token;
  if (apiKey) h.Authorization = 'Bearer ' + apiKey;
  let payload;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json, text };
}

/** API Key 是否还能换到会话 */
async function keyWorks(apiKey) {
  if (!apiKey) return false;
  const r = await httpJson('/api/agent/v1/session', { method: 'POST', apiKey, body: {} });
  return r.status === 200 && !!(r.json && r.json.token);
}

async function main() {
  // ---- adminToken：优先复用 ----
  let token = null;
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* 首次运行 */ }
  if (prev.adminToken) {
    const t = await httpJson('/api/agent/v1/admin/config', { token: prev.adminToken });
    if (t.status === 200) { token = prev.adminToken; console.log('复用已有 admin token'); }
  }
  if (!token) {
    const r = await httpJson('/api/admin-auth/login', {
      method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
    });
    token = r.json && (r.json.token || (r.json.data && r.json.data.token));
    if (!token) { console.log('admin login 失败', r.status, r.text.slice(0, 200)); process.exitCode = 1; return; }
    console.log('admin 登录成功');
  }

  // ---- 基线配置（三档同场对照需要：总开关开、默认档 eco 以免干扰自身档位判定）----
  const put = await httpJson('/api/agent/v1/admin/config', {
    method: 'PUT', token,
    body: {
      agent_enabled: true,
      agent_push_default: 'eco',
      agent_observe_rate_key: 1,
      agent_max_connections_per_agent: 1,
      agent_voice_relay: false
    }
  });
  console.log('PUT config ->', put.status, JSON.stringify(put.json));

  const cfg = await httpJson('/api/agent/v1/admin/config', { token });
  const baseline = cfg.json && cfg.json.config;
  console.log('基线配置:', JSON.stringify(baseline));

  // ---- 幂等准备 3 个测试 Agent ----
  const list = await httpJson('/api/agent/v1/admin/agents', { token });
  const agents = (list.json && list.json.agents) || [];
  console.log('现有 Agent 总数 =', agents.length);

  const prevByKey = {};
  for (const c of (prev.created || [])) prevByKey[c.key] = c;

  const created = [];
  for (const spec of SPECS) {
    let agent = null, apiKey = null, action = '';

    // ① 旧账本 Key 仍有效且 Agent 还在
    const old = prevByKey[spec.key];
    if (old && old.id && old.apiKey && agents.some(a => a.id === old.id) && await keyWorks(old.apiKey)) {
      agent = agents.find(a => a.id === old.id);
      apiKey = old.apiKey;
      action = 'reuse-key';
    }
    // ② 固定名 → 历史同前缀批次
    if (!agent) {
      agent = agents.find(a => a.name === spec.name)
        || agents.find(a => a.name && a.name.startsWith(spec.prefix));
      if (agent) action = 'reuse-agent';
    }
    // ③ 创建
    if (!agent) {
      const r = await httpJson('/api/agent/v1/admin/agents', {
        method: 'POST', token,
        body: { name: spec.name, description: `三档联测 Agent（${spec.pushTier}）`, pushTier: spec.pushTier }
      });
      if (r.status !== 200 || !r.json.apiKey) {
        console.log(`创建 ${spec.name} 失败`, r.status, r.text.slice(0, 200));
        continue;
      }
      agent = r.json.agent;
      apiKey = r.json.apiKey;
      action = 'created';
    }
    // ④ 档位对齐
    if (agent.pushTier !== spec.pushTier) {
      const t = await httpJson(`/api/agent/v1/admin/agents/${agent.id}/tier`, {
        method: 'POST', token, body: { pushTier: spec.pushTier }
      });
      console.log(`  改档 ${agent.name}: ${agent.pushTier} -> ${spec.pushTier} (${t.status})`);
      agent = { ...agent, pushTier: spec.pushTier };
    }
    // ⑤ 复用路径没有明文 Key → 重发
    if (!apiKey) {
      const r = await httpJson(`/api/agent/v1/admin/agents/${agent.id}/regenerate-key`, {
        method: 'POST', token, body: {}
      });
      if (r.status === 200 && r.json.apiKey) { apiKey = r.json.apiKey; action += '+regen-key'; }
      else console.log(`  重发 Key 失败 ${agent.name} ->`, r.status);
    }

    created.push({ key: spec.key, pushTier: spec.pushTier, name: agent.name, id: agent.id, apiKey });
    console.log(`${action.padEnd(18)} ${agent.name} -> ${agent.id} pushTier=${agent.pushTier} `
      + `key=${apiKey ? apiKey.slice(0, 16) + '...' : 'MISSING'}`);
  }

  const finalList = await httpJson('/api/agent/v1/admin/agents', { token });
  const finalCount = ((finalList.json && finalList.json.agents) || []).length;
  console.log(`Agent 总数：${agents.length} -> ${finalCount}（幂等：只有新建才会增长）`);

  fs.writeFileSync(OUT, JSON.stringify({
    adminToken: token, base: BASE, baseline,
    agentCountBefore: agents.length, agentCountAfter: finalCount,
    created
  }, null, 2));
  console.log('已写入', OUT);
}

main();
