/**
 * _tmp_cleanup_test_agents.js — 清理历史联测遗留的测试 Agent（两段式：预览 → 确认）
 *
 * 背景：多轮联测（P1/P3/P4/P6/tier 六轮/capacity/longsession）累积了大量测试 Agent，
 * 而 v6 之前 `_tmp_tier_setup.js` 每跑一次就新建 3 个（名字带运行号），进一步堆积。
 * 本脚本按**白名单正则**匹配测试名，默认只预览；加 --confirm 才真删。
 *
 * 安全设计：
 *   ① 只删匹配白名单的（绝不会碰到真实用户/正式 Agent）；
 *   ② **默认跳过** `_tmp_tier_agents.json` 账本里引用的 3 个联测主力（要删得显式加 --include-ledger）；
 *   ③ 危险操作两段式（参照 adminMaintenanceCharAssets.js 的先例）；
 *   ④ 删除走 DELETE /admin/agents/:id（先吊销 Key、级联清 session，产品已实现）。
 *
 * 用法：
 *   node scripts/_tmp_cleanup_test_agents.js                 # 预览（默认，不删）
 *   node scripts/_tmp_cleanup_test_agents.js --confirm       # 真删
 *   node scripts/_tmp_cleanup_test_agents.js --confirm --include-ledger
 */

const fs = require('fs');
const path = require('path');

const BASE = process.env.AGENT_TEST_BASE || 'http://localhost:3002';
const STORE = path.join(__dirname, '_tmp_tier_agents.json');
const CONFIRM = process.argv.includes('--confirm');
const INCLUDE_LEDGER = process.argv.includes('--include-ledger');

// 只匹配明确是"联测测试"的名字（宁可漏删，绝不误删）
const PATTERNS = [
  /^p1_test_agent$/, /^p3_test_agent$/, /^p4_test_agent$/, /^p5_test_agent$/, /^p6_test_agent$/,
  /^p4_pw_agent_/, /^p4_probe_/, /^p6_pw_/, /^pw_agent_/, /^accept_/,
  /^tier_eco(_|$)/, /^tier_std(_|$)/, /^tier_rt(_|$)/,
  /^fix[a-z]_agent/, /^v2_/, /^live_agent_/, /^stop_/, /^cap_/, /^renew_/, /^test_agent/
];

const isTestName = (n) => PATTERNS.some(re => re.test(String(n || '')));

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

  const ledgerIds = new Set();
  try {
    const st = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    for (const c of (st.created || [])) if (c.id) ledgerIds.add(c.id);
  } catch (e) { /* 无账本 */ }

  const list = await httpJson('/api/agent/v1/admin/agents', { token });
  const agents = (list.json && list.json.agents) || [];
  if (list.status !== 200) { console.log('列出 Agent 失败', list.status, list.text.slice(0, 200)); process.exitCode = 1; return; }

  const targets = agents.filter(a => isTestName(a.name));
  const skippedLedger = targets.filter(a => !INCLUDE_LEDGER && ledgerIds.has(a.id));
  const toDelete = targets.filter(a => INCLUDE_LEDGER || !ledgerIds.has(a.id));

  console.log(`\nAgent 总数 = ${agents.length}；匹配测试名 = ${targets.length}；`
    + `跳过账本主力 = ${skippedLedger.length}；将删除 = ${toDelete.length}`);
  console.log('\n--- 将删除 ---');
  for (const a of toDelete) console.log(`  ${a.id}  ${a.name}  status=${a.status}  pushTier=${a.pushTier}  keys=${a.activeKeyCount}`);
  if (skippedLedger.length) {
    console.log('\n--- 跳过（_tmp_tier_agents.json 账本引用，联测主力）---');
    for (const a of skippedLedger) console.log(`  ${a.id}  ${a.name}  (加 --include-ledger 才删)`);
  }

  if (!CONFIRM) {
    console.log('\n[预览模式] 未删除任何数据。确认无误后加 --confirm 再跑一次。');
    process.exitCode = 0;
    return;
  }

  let ok = 0, fail = 0;
  for (const a of toDelete) {
    const r = await httpJson(`/api/agent/v1/admin/agents/${a.id}`, { method: 'DELETE', token });
    if (r.status === 200) { ok++; console.log(`  已删除 ${a.name}`); }
    else { fail++; console.log(`  删除失败 ${a.name} -> ${r.status} ${r.text.slice(0, 120)}`); }
  }
  const after = await httpJson('/api/agent/v1/admin/agents', { token });
  const left = ((after.json && after.json.agents) || []).length;
  console.log(`\n[确认模式] 删除成功 ${ok} / 失败 ${fail}；Agent 总数 ${agents.length} -> ${left}`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
