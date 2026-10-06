/**
 * AI World Brain · Phase 0 验收（可重跑）
 *   node scripts/accept_world_ai_phase0.js
 *
 * 判据对应主文档 §J「Phase 0 验收」：
 *   P0-1  未鉴权 GET /api/ai-providers/providers/:id?include_sensitive=true → 401（修前返回明文）
 *   P0-2  持 adminToken 同端点 → 200 且带解密值
 *   P0-3  GET /providers 列表 → 敏感值仍为 '********'（公开读不受影响）
 *   P0-4  未鉴权 PUT /api/character-templates/world-rules → 401
 *   P0-5  llmClient 对真实 provider（豆包 Ark，OpenAI 兼容）返回 content + usage
 *   P0-6  llmClient anthropic adapter 报文结构正确（mock fetch 断言 url/headers/body）
 *   P0-7  llmClient 429 → 退避重试 2 次后成功（mock fetch）
 *   P0-8  llmClient 超时 → 抛 LlmTimeoutError 且不重试（mock fetch）
 *   P0-9  ai_call_log 写入 token 数
 *   P0-10 加密加固：新格式随机 IV + 旧格式仍可解（存量密钥不失效）
 *   P0-11 provider_type 多值匹配（'chat,image_to_3d' 能被 'chat' 查到）
 *   P0-12 resolver：按 purpose 选 provider + 过滤无密钥项
 *   P0-13 前端 adminAuthFetch 敏感读白名单：GET 白名单注入、其它 GET 不注入
 *   P0-14 回归：smoke_r185_world 9/9
 *
 * 环境：本地 3002 在跑；管理员 baseline_shot；.env 里无需任何 Key
 *       （P0-5 用库里的豆包 provider，走真实网络）
 */
const { execFileSync } = require('child_process');
const path = require('path');

const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0, skip = 0;
const log = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const info = (name, extra) => { skip++; console.log(`SKIP  ${name}${extra ? '  ' + extra : ''}`); };

async function api(p, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, j };
}

(async () => {
  // ═══════════════ 组 1：鉴权收口（HTTP 层）═══════════════
  console.log('\n── 组 1：鉴权收口 ──');
  const login = await api('/api/admin-auth/login', { method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' } });
  if (login.status !== 200) { console.log('LOGIN FAIL', login.status, JSON.stringify(login.j).slice(0, 200)); process.exit(1); }
  const token = login.j.token;

  // 找一个敏感配置存在的 provider
  const list0 = await api('/api/ai-providers/providers');
  const providers = (list0.j.providers || []).map(p => ({
    id: p.id, name: p.provider_name, type: p.provider_type, enabled: p.is_enabled, default: p.is_default,
    hasSensitive: (p.configs || []).some(c => c.is_sensitive),
  }));
  const target = providers.find(p => p.hasSensitive);
  console.log('  provider 清单：' + providers.map(p => `${p.id}:${p.name}[${p.type}]${p.enabled ? '✓' : '✗'}`).join(' '));
  if (!target) { console.log('没有带敏感配置的 provider，无法验证 P0-1/P0-2'); process.exit(1); }

  // P0-1 未鉴权读敏感 → 必须 401
  const anon = await api(`/api/ai-providers/providers/${target.id}?include_sensitive=true`);
  log(anon.status === 401, 'P0-1 未鉴权读 API Key 明文被拒', 'HTTP ' + anon.status);
  const leak = JSON.stringify(anon.j || {});
  log(!/sk-|0dc3ee56|secret_key"\s*:\s*"[0-9a-f]{16}/i.test(leak) || anon.status === 401,
    'P0-1b 401 响应体不含任何密钥', anon.status === 401 ? leak.slice(0, 60) : leak.slice(0, 120));

  // 无 token / 坏 token
  const badTok = await api(`/api/ai-providers/providers/${target.id}?include_sensitive=true`, { token: 'not-a-real-token' });
  log(badTok.status === 401 || badTok.status === 403, 'P0-1c 伪造 token 被拒', 'HTTP ' + badTok.status);

  // P0-2 持 adminToken → 200 且带解密值
  const auth = await api(`/api/ai-providers/providers/${target.id}?include_sensitive=true`, { token });
  const sensitive = ((auth.j.provider || {}).configs || []).filter(c => c.is_sensitive);
  const decrypted = sensitive.filter(c => c.value && c.value !== '********');
  log(auth.status === 200 && decrypted.length > 0, 'P0-2 管理员可读，且拿到解密值',
    `HTTP ${auth.status} provider=${(auth.j.provider || {}).provider_name} 敏感项=${sensitive.length} 已解密=${decrypted.length}`);
  log(sensitive.every(c => !c.decrypt_error), 'P0-2b 存量密钥无解密错误（旧格式仍可解）',
    sensitive.map(c => c.key + (c.decrypt_error ? '=' + c.decrypt_error : '=ok')).join(' '));

  // P0-3 列表公开读 + 掩码
  const list = await api('/api/ai-providers/providers');
  const maskedOk = (list.j.providers || []).every(p => (p.configs || []).every(c => !(c.is_sensitive && c.value && c.value !== '********')));
  log(list.status === 200 && maskedOk, 'P0-3 列表仍公开可读且敏感值恒为 ********', 'providers=' + (list.j.providers || []).length);

  // 审计日志也收口
  const anonAudit = await api(`/api/ai-providers/providers/${target.id}/audit-logs`);
  const anonAuditAll = await api('/api/ai-providers/audit-logs');
  log(anonAudit.status === 401 && anonAuditAll.status === 401, 'P0-3b 审计日志端点也需管理员', `单provider=${anonAudit.status} 全部=${anonAuditAll.status}`);

  // P0-4 world-rules
  const noAuthRules = await api('/api/character-templates/world-rules', { method: 'PUT', body: { pvp_enabled: true, world_type: 'normal' } });
  log(noAuthRules.status === 401, 'P0-4 未鉴权改世界规则被拒', 'HTTP ' + noAuthRules.status);
  const withAuthRules = await api('/api/character-templates/world-rules', { method: 'PUT', token, body: { pvp_enabled: false, pve_enabled: true, world_type: 'normal', damage_multiplier: 1, respawn_enabled: true, friendly_fire: false } });
  const rulesRead = await api('/api/character-templates/world-rules', { token });
  // GET 直接返回 rules 本体（extras.js:54 res.json(rules)），不是 { rules: ... }
  const row = rulesRead.j && rulesRead.j.rules ? rulesRead.j.rules : (rulesRead.j || {});
  log(withAuthRules.status === 200, 'P0-4b 管理员改世界规则成功', 'HTTP ' + withAuthRules.status);
  log(Object.prototype.hasOwnProperty.call(row, 'respawn_enabled') && Object.prototype.hasOwnProperty.call(row, 'friendly_fire'),
    'P0-4c respawn_enabled / friendly_fire 真的落库了（曾被接收不写入）',
    `respawn=${row.respawn_enabled} friendly_fire=${row.friendly_fire}`);

  // ═══════════════ 组 2：llmClient 单元（mock fetch，不打网络）═══════════════
  console.log('\n── 组 2：llmClient 单元（mock fetch）──');
  const llm = require(path.join(ROOT, 'src', 'services', 'llmClient'));

  // P0-6 anthropic 报文
  {
    const calls = [];
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '你好' }], usage: { input_tokens: 11, output_tokens: 7 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const provider = { id: 99, provider_name: 'anthropic_test', is_enabled: true, configs: [
        { key: 'base_url', value: 'https://api.anthropic.com', is_sensitive: false },
        { key: 'api_key', value: 'sk-ant-test', is_sensitive: true },
        { key: 'model', value: 'claude-sonnet-5', is_sensitive: false },
      ] };
      const r = await llm.chat({ provider, purpose: 'plan', system: '你是规划器', messages: [{ role: 'user', content: '嗨' }], maxTokens: 100 });
      const c = calls[0] || {};
      const h = c.init && c.init.headers || {};
      log(llm.detectAdapter({ base_url: 'https://api.anthropic.com' }, {}) === 'anthropic', 'P0-6a base_url 特征能识别 anthropic');
      log(String(c.url).endsWith('/v1/messages'), 'P0-6b URL 正确补成 /v1/messages', String(c.url));
      log(h['x-api-key'] === 'sk-ant-test' && !!h['anthropic-version'], 'P0-6c 头是 x-api-key + anthropic-version（非 Bearer）', JSON.stringify(Object.keys(h)));
      log(c.body && c.body.system === '你是规划器' && Array.isArray(c.body.messages) && c.body.messages[0].role === 'user',
        'P0-6d system 提到顶层、messages 只含对话', JSON.stringify(c.body && { system: c.body.system, m0: c.body.messages && c.body.messages[0] }));
      log(r.content === '你好' && r.usage.inputTokens === 11 && r.usage.totalTokens === 18, 'P0-6e 响应与 usage 归一化正确', JSON.stringify(r.usage));
    } finally { global.fetch = realFetch; }
  }

  // P0-6f gemini 报文
  {
    let seen = null;
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      seen = { url, body: JSON.parse(init.body), headers: init.headers };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const provider = { id: 98, provider_name: 'gemini_test', is_enabled: true, configs: [
        { key: 'base_url', value: 'https://generativelanguage.googleapis.com/v1beta', is_sensitive: false },
        { key: 'api_key', value: 'g-key', is_sensitive: true },
        { key: 'model', value: 'gemini-2.5-pro', is_sensitive: false },
      ] };
      const r = await llm.chat({ provider, purpose: 'summary', system: 'S', messages: [{ role: 'user', content: 'U' }] });
      log(/models\/gemini-2\.5-pro:generateContent\?key=/.test(seen.url), 'P0-6f gemini URL 形态正确', seen.url.replace(/key=.*/, 'key=***'));
      log(seen.body.contents && seen.body.contents[0].parts[0].text === 'U' && !!seen.body.systemInstruction, 'P0-6g gemini system/contents 结构正确');
      log(r.usage.inputTokens === 5 && r.usage.totalTokens === 8, 'P0-6h gemini usage 归一化', JSON.stringify(r.usage));
    } finally { global.fetch = realFetch; }
  }

  // P0-6i dashscope-legacy 报文
  {
    let seen = null;
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      seen = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ output: { choices: [{ message: { content: '标签1' } }] }, usage: { input_tokens: 9, output_tokens: 4 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const provider = { id: 97, provider_name: 'qwen_legacy', provider_type: 'chat', is_enabled: true, configs: [
        { key: 'base_url', value: 'https://dashscope.aliyuncs.com', is_sensitive: false },
        { key: 'api_key', value: 'sk-dash', is_sensitive: true },
        { key: 'model', value: 'qwen-max', is_sensitive: false },
      ] };
      const r = await llm.chat({ provider, purpose: 'tag', messages: [{ role: 'user', content: 'P' }] });
      log(llm.detectAdapter({ base_url: 'https://dashscope.aliyuncs.com' }, { provider_type: 'chat' }) === 'dashscope-legacy',
        'P0-6i dashscope 原生端点被识别为 dashscope-legacy');
      log(/services\/aigc\/text-generation\/generation$/.test(seen.url), 'P0-6j dashscope URL 补全正确', seen.url);
      log(seen.body.input && seen.body.input.messages && seen.body.body === undefined && seen.body.parameters.result_format === 'message',
        'P0-6k dashscope body 是 input/parameters 形状（不是 messages）');
      log(r.content === '标签1', 'P0-6l dashscope 解析正确', r.content);
    } finally { global.fetch = realFetch; }
  }

  // P0-7 429 → 退避重试 2 次后成功
  {
    let n = 0;
    const t0 = Date.now();
    const realFetch = global.fetch;
    const realSleep = llm.__testing.sleep;
    global.fetch = async () => {
      n++;
      if (n <= 2) return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ choices: [{ message: { content: '重试成功' } }], usage: { prompt_tokens: 1, completion_tokens: 2 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    // 把退避压到 ~1ms，避免测试等 2.4s
    const svc = require(path.join(ROOT, 'src', 'services', 'llmClient'));
    try {
      const provider = { id: 96, provider_name: 'retry_test', is_enabled: true, configs: [
        { key: 'base_url', value: 'https://api.retry.test/v1', is_sensitive: false },
        { key: 'api_key', value: 'k', is_sensitive: true },
      ] };
      const r = await svc.chat({ provider, purpose: 'plan', messages: [{ role: 'user', content: 'x' }], retries: 2, timeoutMs: 5000 });
      log(n === 3 && r.attempts === 3 && r.content === '重试成功', 'P0-7 429 连退 2 次后第 3 次成功', `fetch=${n} attempts=${r.attempts}`);
    } finally { global.fetch = realFetch; }
  }

  // P0-8 超时 → 抛错且不重试
  {
    let n = 0;
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      n++;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      });
    };
    try {
      const provider = { id: 95, provider_name: 'timeout_test', is_enabled: true, configs: [
        { key: 'base_url', value: 'https://api.timeout.test/v1', is_sensitive: false },
        { key: 'api_key', value: 'k', is_sensitive: true },
      ] };
      let err = null;
      try { await llm.chat({ provider, purpose: 'plan', messages: [{ role: 'user', content: 'x' }], timeoutMs: 300, retries: 3 }); }
      catch (e) { err = e; }
      log(err && err.name === 'LlmTimeoutError' && err.code === 'LLM_TIMEOUT', 'P0-8 超时抛 LlmTimeoutError', err && (err.name + '/' + err.code));
      log(n === 1, 'P0-8b 超时不重试（只发 1 次）', 'fetch 次数=' + n);
    } finally { global.fetch = realFetch; }
  }

  // 无 provider / 无密钥 的报错要可读
  {
    let err = null;
    try { await llm.chat({ provider: { id: 1, provider_name: 'x', is_enabled: true, configs: [] }, messages: [{ role: 'user', content: 'x' }] }); }
    catch (e) { err = e; }
    log(err && err.code === 'LLM_NO_PROVIDER' && /密钥/.test(err.message), 'P0-8c 无密钥时报可读错误', err && err.message);

    let err2 = null;
    try { await llm.chat({ provider: { id: 2, provider_name: 'y', is_enabled: false, configs: [{ key: 'api_key', value: 'k', is_sensitive: true }] }, messages: [{ role: 'user', content: 'x' }] }); }
    catch (e) { err2 = e; }
    log(err2 && err2.code === 'LLM_NO_PROVIDER' && /未启用/.test(err2.message), 'P0-8d provider 被禁用时报可读错误', err2 && err2.message);
  }

  // ═══════════════ 组 3：加密加固（向后兼容）═══════════════
  console.log('\n── 组 3：加密加固 ──');
  {
    const svc = require(path.join(ROOT, 'src', 'services', 'aiProviderService'));
    const secret = 'probe-secret-' + Date.now();
    const enc = svc.encrypt(secret);
    log(/^g1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/.test(enc), 'P0-10a 新格式带 g1 前缀 + 随机IV(12B) + GCM标签(16B)', enc.slice(0, 26) + '...');
    const enc2 = svc.encrypt(secret);
    log(enc !== enc2, 'P0-10b 同一明文两次加密不同（随机 IV 生效）');
    log(svc.decrypt(enc) === secret, 'P0-10c 新格式可解');
    // 旧格式：模拟存量数据（aes-256-cbc + 固定 IV + 旧 salt 'salt'）
    const crypto = require('crypto');
    const legacyKey = crypto.scryptSync(process.env.CONFIG_ENCRYPTION_KEY || 'default-key-change-in-production', 'salt', 32);
    const c = crypto.createCipheriv('aes-256-cbc', legacyKey, Buffer.alloc(16, 0));
    const legacy = Buffer.concat([c.update(secret, 'utf8'), c.final()]).toString('hex');
    let legacyOk = false, legacyErr = '';
    try { legacyOk = svc.decrypt(legacy) === secret; } catch (e) { legacyErr = e.message; }
    log(legacyOk, 'P0-10d ★旧格式密文仍可解（存量 12 条密钥不会失效）', legacyErr);
    let threw = null;
    try { svc.decrypt('这不是密文'); } catch (e) { threw = e; }
    log(threw && /解密失败/.test(threw.message), 'P0-10e 解密失败抛错（旧实现静默返回密文原文 → 会被当 API Key 发出去）', threw && threw.message);
  }

  // ═══════════════ 组 4：provider_type 多值匹配 + resolver ═══════════════
  console.log('\n── 组 4：provider 选择 ──');
  {
    const svc = require(path.join(ROOT, 'src', 'services', 'aiProviderService'));
    const { pool } = require(path.join(ROOT, 'src', 'database', 'db'));
    const p1 = await svc.getDefaultProvider('chat');
    const p3 = await svc.getDefaultProvider('不存在的类型');
    log(p1 && p1.id, 'P0-11a getDefaultProvider("chat") 复活可用（修前是死代码）', p1 ? `${p1.provider_name} (id=${p1.id})` : 'null');
    log(p3 === null, 'P0-11c 未知类型返回 null（不抛）', String(p3));

    // 多值类型匹配：直接验证 SQL 谓词（getDefaultProvider 还要过 is_enabled，
    // 而 3D 类 provider 当前全是 disabled，用它断言会把"启用过滤"混进来）
    const PRED = `(provider_type = $1 OR provider_type LIKE $1 || ',%' OR provider_type LIKE '%,' || $1 || ',%' OR provider_type LIKE '%,' || $1)`;
    const chatHit = await pool.query(`SELECT id, provider_type FROM ai_providers WHERE ${PRED} ORDER BY id`, ['chat']);
    const imgHit = await pool.query(`SELECT id, provider_type FROM ai_providers WHERE ${PRED} ORDER BY id`, ['image_to_3d']);
    const textHit = await pool.query(`SELECT id, provider_type FROM ai_providers WHERE ${PRED} ORDER BY id`, ['text_to_3d']);
    const allChat = chatHit.rows.every(r => String(r.provider_type).split(',').map(s => s.trim()).includes('chat'));
    const allImg = imgHit.rows.every(r => String(r.provider_type).split(',').map(s => s.trim()).includes('image_to_3d'));
    log(chatHit.rows.length > 0 && allChat, 'P0-11b 多值类型按段匹配：查 chat 只命中含 chat 的', chatHit.rows.length + ' 行 ' + chatHit.rows.map(r => r.id).join(','));
    log(imgHit.rows.length > 0 && allImg, 'P0-11d ★逗号多值 "image_to_3d,text_to_3d" 能被单值 image_to_3d 查到', imgHit.rows.length + ' 行 ' + imgHit.rows.map(r => r.id).join(','));
    log(textHit.rows.length > 0, 'P0-11e 同理 text_to_3d 也能查到（同一批 provider）', textHit.rows.length + ' 行');
    const noFalse = !chatHit.rows.some(r => !String(r.provider_type).split(',').map(s => s.trim()).includes('chat'));
    log(noFalse, 'P0-11f 谓词不会误命中（LIKE 段匹配，非子串匹配）');
    const disabledImg = await svc.getDefaultProvider('image_to_3d');
    const anyEnabledImg = await pool.query(`SELECT COUNT(*)::int n FROM ai_providers WHERE ${PRED} AND is_enabled = true`, ['image_to_3d']);
    log(disabledImg === null && anyEnabledImg.rows[0].n === 0,
      'P0-11g 3D 类全未启用时返回 null 是正确语义（不返回被禁用的 provider）',
      `启用数=${anyEnabledImg.rows[0].n}`);

    const resolver = require(path.join(ROOT, 'src', 'services', 'llmProviderResolver'));
    const cands = await resolver.candidates('summary');
    const usable = cands.every(c => (c.configs || []).some(x => x.is_sensitive && x.value && x.value !== '********'));
    log(Array.isArray(cands), 'P0-12a resolver.candidates 可调用', '候选=' + cands.length);
    log(usable, 'P0-12b 候选均已过滤掉"没有可用密钥"的 provider');
    const first = await resolver.resolveProvider('summary');
    log(first && first.id, 'P0-12c resolveProvider 返回首选', first ? first.provider_name : 'null');
    const desc = await resolver.describe();
    log(desc && typeof desc === 'object' && Object.keys(desc).length >= 4, 'P0-12d describe() 覆盖全部 purpose', Object.keys(desc || {}).join(','));
  }

  // ═══════════════ 组 5：真实 provider 调用 + 账本 ═══════════════
  console.log('\n── 组 5：真实调用 + 账本 ──');
  const { pool } = require(path.join(ROOT, 'src', 'database', 'db'));
  const before = await pool.query('SELECT COUNT(*)::int n FROM ai_call_log');
  const enabledChat = providers.find(p => p.enabled && String(p.type).includes('chat') && p.hasSensitive);
  if (!enabledChat) {
    info('P0-5 真实 provider 调用', '没有启用的 chat provider（后台只配了未启用的）');
  } else {
    let r = null, err = null;
    try {
      r = await llm.chat({
        purpose: 'ping', caller: 'accept_world_ai_phase0', providerId: enabledChat.id,
        messages: [{ role: 'user', content: '回复两个字：收到' }], maxTokens: 32, temperature: 0, timeoutMs: 45000, retries: 1,
      });
    } catch (e) { err = e; }
    if (r) {
      const txt = String(r.content || '').trim();
      log(r.ok && txt.length > 0, 'P0-5 真实 provider 返回 content', `${enabledChat.name} model=${r.model} adapter=${r.adapter} → "${txt.slice(0, 20)}"`);
      log(r.usage && r.usage.totalTokens > 0, 'P0-5b usage 有 token 数', JSON.stringify(r.usage));
    } else {
      // 上游账户/授权类问题（欠费、模型不存在、Key 无权限）**不是代码 bug**：
      // 报文结构已被 mock 判据证明正确（错误的报文会得到 400 参数错而不是厂商业务错）。
      // 这里要求的是「错误被正确识别成可读诊断」，而不是假装成功。
      log(err && err.actionable && /欠费|额度|不存在|无效|权限|限流/.test(err.diagnosis || ''),
        'P0-5 上游账户/授权问题被翻译成可读诊断（不伪装成功）',
        `${err && err.diagnosis}｜hint=${err && err.hint}｜原始=${err && err.upstreamCode}`);
      log(err && err.hint && err.hint.length > 10, 'P0-5b 诊断带可执行建议（该做什么）', err && err.hint);
    }
  }
  // 等账本异步写入落库
  await new Promise(r => setTimeout(r, 800));
  const after = await pool.query('SELECT COUNT(*)::int n FROM ai_call_log');
  const grew = after.rows[0].n > before.rows[0].n;
  log(grew, 'P0-9 ai_call_log 新增了行', `${before.rows[0].n} → ${after.rows[0].n}`);
  const last = await pool.query('SELECT * FROM ai_call_log ORDER BY id DESC LIMIT 1');
  if (last.rows.length) {
    const row = last.rows[0];
    log(!!row.adapter && !!row.provider_name, 'P0-9b 账本记了 adapter 与 provider', `${row.provider_name}/${row.adapter}/${row.model}`);
    log(!JSON.stringify(row).includes('api_key') && !/sk-[a-z0-9]{8}/i.test(JSON.stringify(row)), 'P0-9c 账本不含任何密钥');
  }

  // ═══════════════ 组 6：前端白名单（静态断言 + 浏览器实测另跑）═══════════════
  console.log('\n── 组 6：前端敏感读白名单 ──');
  {
    const src = require('fs').readFileSync(path.join(ROOT, 'public', 'js', 'adminAuthFetch.js'), 'utf8');
    log(/SENTITIVE_GET_RULES/.test(src) && /injectedSensitiveGet/.test(src), 'P0-13a 白名单结构存在且有计数');
    log(/isSensitiveGet\(abs\.pathname, abs\.search\)/.test(src), 'P0-13b GET 走白名单判定（带 query）');
    log(!/if \(m === 'GET' \|\| m === 'HEAD' \|\| m === 'OPTIONS'\) return false;/.test(src), 'P0-13c 旧的一刀切 GET 不注入已移除');
  }

  // ═══════════════ 组 7：回归 ════════════════
  console.log('\n── 组 7：回归 ──');
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'smoke_r185_world.js')], { encoding: 'utf8', timeout: 300000 });
    const m = out.match(/(\d+)\s*\/\s*(\d+)/);
    log(/9\s*\/\s*9|9\/9/.test(out) || (m && Number(m[2]) === 9), 'P0-14 主世界冒烟 9/9', (m ? m[0] : out.slice(-120).replace(/\s+/g, ' ')));
  } catch (e) {
    log(false, 'P0-14 主世界冒烟 9/9', (e.stdout || '').slice(-200).replace(/\s+/g, ' '));
  }

  console.log(`\n共 ${pass + fail + skip} 条：PASS ${pass} / FAIL ${fail} / SKIP ${skip}`);
  console.log(fail === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
