/**
 * P1 验收脚本：Agent 身份与会话
 * 判据（文档第 7 节 P1）：
 *   ① 建测试 Agent → 换 token → GET /me 成功
 *   ② 错误 Key 401
 *   ③ 过期 token 403
 *   ④ 现有 /api/auth/login 冒烟不变
 *   ⑤ 迁移幂等（跑两遍不报错）
 * 附加：总开关关闭 503、吊销后 403、限流 429
 * 注意：服务器端 agentConfigService 有 60s 缓存，
 *   因此"开开关"在任何 HTTP 请求之前完成，"关开关"测试放最后并轮询等待缓存过期。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const BASE = 'http://localhost:3002';
const { pool, query } = require('../src/database/db');

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail ? '  -> ' + detail : ''}`);
}

async function req(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, json };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const agentManager = require('../src/agent/agentManager');
  const agentConfigService = require('../src/agent/agentConfigService');

  // ---------- ⑤ 迁移幂等（直接执行两遍） ----------
  try {
    const files = ['add_agents.sql', 'add_agent_sessions.sql']
      .map(f => fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', f), 'utf-8'));
    for (let round = 1; round <= 2; round++) {
      for (const sql of files) await pool.query(sql);
    }
    record('A1', '迁移幂等（两文件各执行两遍无报错）', true);
  } catch (e) {
    record('A1', '迁移幂等', false, e.message);
  }

  // ---------- 表结构 ----------
  try {
    const dup = await query(`SELECT COUNT(*)::int AS c FROM information_schema.tables
      WHERE table_name IN ('agents','agent_api_keys','agent_sessions')`);
    if (dup.rows[0].c !== 3) throw new Error(`表数量 ${dup.rows[0].c} != 3`);
    record('A2', '三张表已创建', true);
  } catch (e) {
    record('A2', '三张表已创建', false, e.message);
  }

  // ---------- 准备：默认配置行 + 测试 Agent + 先开总开关（在任何 HTTP 前） ----------
  await agentConfigService.ensureDefaultConfig();
  await agentConfigService.setConfigValue('agent_enabled', 'true');

  let agent = await agentManager.getAgentByName('p1_test_agent');
  let apiKey;
  if (!agent) {
    const created = await agentManager.createAgent({ name: 'p1_test_agent', description: 'P1 验收' });
    agent = created.agent;
    apiKey = created.apiKey.key;
  } else {
    apiKey = (await agentManager.createApiKey(agent.id)).key;
  }

  // ---------- ① 正常链路 ----------
  const s1 = await req('POST', '/api/agent/v1/session', { token: apiKey });
  const ok1 = s1.status === 200 && s1.json?.success && typeof s1.json?.token === 'string' && s1.json?.expiresIn === 900;
  record('C1', '正确 API Key 换取 Agent JWT（15min）', ok1, `status=${s1.status} expiresIn=${s1.json?.expiresIn} code=${s1.json?.code}`);
  if (!ok1) { await finish(); return; }
  const token = s1.json.token;

  const me1 = await req('GET', '/api/agent/v1/me', { token });
  const ok2 = me1.status === 200 && me1.json?.agent?.name === 'p1_test_agent'
    && Array.isArray(me1.json?.permissions?.scopes)
    && me1.json?.permissions?.scopes.includes('observe')
    && !me1.json?.permissions?.scopes.includes('teleport');
  record('C2', 'GET /me 返回 Agent 信息 + 游客级 scope（无 teleport）', ok2,
    `status=${me1.status} scopes=${JSON.stringify(me1.json?.permissions?.scopes)}`);

  // ---------- ② 错误 Key / 无凭证 ----------
  const bad1 = await req('POST', '/api/agent/v1/session', { token: 'agk_live_' + 'a'.repeat(64) });
  record('D1', '伪造 API Key（合法格式）返回 401', bad1.status === 401, `status=${bad1.status}`);
  const bad2 = await req('POST', '/api/agent/v1/session', { token: 'not-a-key' });
  record('D2', '畸形 API Key 返回 401', bad2.status === 401, `status=${bad2.status}`);
  const bad3 = await req('GET', '/api/agent/v1/me', {});
  record('D3', '无 token 访问 /me 返回 401', bad3.status === 401, `status=${bad3.status}`);
  const bad4 = await req('GET', '/api/agent/v1/me', { token: 'user-jwt-should-not-work' });
  record('D4', '非 Agent JWT 访问 /me 被拒', bad4.status === 401 || bad4.status === 403, `status=${bad4.status}`);

  // ---------- ③ 过期 token ----------
  const expired = jwt.sign(
    { sub: agent.id, principalType: 'agent', scopes: ['observe'] },
    process.env.AGENT_JWT_SECRET,
    { expiresIn: -10, jwtid: 'expired-jti-test' }
  );
  const me2 = await req('GET', '/api/agent/v1/me', { token: expired });
  record('E1', '过期 Agent JWT 返回 403', me2.status === 403, `status=${me2.status} code=${me2.json?.code}`);

  // ---------- 吊销链路 ----------
  const rev = await req('POST', '/api/agent/v1/session/revoke', { token });
  record('F1', 'POST /session/revoke 成功', rev.status === 200 && rev.json?.success, `status=${rev.status}`);
  const me3 = await req('GET', '/api/agent/v1/me', { token });
  record('F2', '吊销后再访问 /me 返回 403', me3.status === 403, `status=${me3.status} code=${me3.json?.code}`);

  // ---------- ④ 现有 /api/auth/login 冒烟 ----------
  const login = await req('POST', '/api/auth/login', { body: { username: 'no_such_user_smoke', password: 'wrong' } });
  record('G1', '/api/auth/login 行为不变（错误凭据 401/400，非 5xx）',
    (login.status === 401 || login.status === 400) && login.json, `status=${login.status}`);

  // ---------- 限流（放后段，会触发 429） ----------
  let saw429 = false;
  for (let i = 0; i < 12; i++) {
    const r = await req('POST', '/api/agent/v1/session', { token: apiKey });
    if (r.status === 429) { saw429 = true; break; }
  }
  record('H1', 'POST /session 限流触发 429', saw429);

  // ---------- 总开关关闭（最后：等服务器 60s 配置缓存过期 + 限流窗口过去） ----------
  await agentConfigService.setConfigValue('agent_enabled', 'false');
  console.log('\n[wait] 关闭总开关，轮询等待服务器 60s 缓存过期（最长 140s）...');
  let off503 = false;
  const deadline = Date.now() + 140000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const r = await req('POST', '/api/agent/v1/session', { token: apiKey });
    if (r.status === 503) { off503 = true; break; }
    // 429 属于限流窗口未过，继续等
  }
  record('B1', 'agent_enabled=false 时 POST /session 返回 503', off503);

  console.log('\n[cleanup] agent_enabled 已恢复 false（红线：默认关）');
  await finish();
}

async function finish() {
  const pass = results.filter(r => r.pass).length;
  console.log(`\n===== P1 验收: ${pass}/${results.length} PASS =====`);
  process.exitCode = pass === results.length ? 0 : 1;
  try { await pool.end(); } catch (e) { /* ignore */ }
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
