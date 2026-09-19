/**
 * 三档联测 - 环境准备（临时脚本）
 * 1) 管理员登录（1 次），token 落盘供后续轮次复用（避开登录限流 15 次/小时）
 * 2) 开启 agent_enabled，固定基线配置，记录基线
 * 3) 创建 3 个测试 Agent（eco / standard / realtime），明文 Key 落盘（仅创建时返回）
 *
 * 运行：node scripts/_tmp_tier_setup.js
 * 产物：scripts/_tmp_tier_agents.json
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const OUT = path.join(__dirname, '_tmp_tier_agents.json');
const RUN = String(Math.floor(Date.now() / 1000) % 100000);

async function httpJson(p, { method = 'GET', token, body } = {}) {
  const h = {};
  if (token) h.Authorization = 'Bearer ' + token;
  let payload;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}

async function main() {
  // 复用已有 admin token（若存在且未过期）
  let token = null;
  if (fs.existsSync(OUT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
      if (prev.adminToken) {
        const t = await httpJson('/api/agent/v1/admin/config', { token: prev.adminToken });
        if (t.status === 200) { token = prev.adminToken; console.log('复用已有 admin token'); }
      }
    } catch (e) {}
  }
  if (!token) {
    const r = await httpJson('/api/admin-auth/login', {
      method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' }
    });
    token = r.json && (r.json.token || (r.json.data && r.json.data.token));
    if (!token) { console.log('admin login 失败', r.status, r.text.slice(0, 200)); process.exitCode = 1; return; }
    console.log('admin 登录成功');
  }

  // 基线配置（三档同场对照需要：总开关开、默认档 eco 以免干扰自身档位判定）
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

  // 创建 3 个 Agent（名字带运行号，避免重名 409）
  const specs = [
    { key: 'eco', pushTier: 'eco', name: `tier_eco_${RUN}` },
    { key: 'standard', pushTier: 'standard', name: `tier_std_${RUN}` },
    { key: 'realtime', pushTier: 'realtime', name: `tier_rt_${RUN}` }
  ];
  const created = [];
  for (const s of specs) {
    const r = await httpJson('/api/agent/v1/admin/agents', {
      method: 'POST', token,
      body: { name: s.name, description: `三档联测 Agent（${s.pushTier}）`, pushTier: s.pushTier }
    });
    if (r.status !== 200 || !r.json.apiKey) {
      console.log(`创建 ${s.name} 失败`, r.status, r.text.slice(0, 200));
      continue;
    }
    created.push({ key: s.key, pushTier: s.pushTier, name: s.name, id: r.json.agent.id, apiKey: r.json.apiKey });
    console.log(`创建 ${s.name} -> ${r.json.agent.id} pushTier=${r.json.agent.pushTier} key=${r.json.apiKey.slice(0, 16)}...`);
  }

  fs.writeFileSync(OUT, JSON.stringify({ adminToken: token, base: BASE, run: RUN, baseline, created }, null, 2));
  console.log('已写入', OUT);
}

main();
