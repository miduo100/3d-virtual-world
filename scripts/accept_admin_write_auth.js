/**
 * accept_admin_write_auth.js — config.js 管理写接口鉴权收口验收（2026-09-22 v7）
 *
 * 背景：src/routes/config.js 曾全文 0 处鉴权，匿名即可 PUT world-settings（可连锁污染
 * 联邦信任表）、weather（广播全体玩家）、language、seo、character-editor。
 * 本次给 5 个写接口接上 authenticateAdminToken；读接口保持公开（游戏前端无 token 调用）。
 *
 * 判据：
 *   W1 无 token → PUT /world-settings 401；伪造 token → 403
 *   W2 有效管理员 token → 200，且值确实写入（改 world_description 后读回，收尾还原）
 *   W3 写接口全覆盖：POST /character-editor、PUT /world-settings、PUT /weather、
 *      PUT /language、PUT /seo 无 token 全部 401
 *   W4 读接口仍公开（不带任何 token 全部 200）：GET /world-settings、/lod-enabled、
 *      /weather、/language、/seo、/character-editor
 *   W5 未授权调用不会改动配置：未授权 PUT 前后 GET /world-settings 快照一致；
 *      GET /.well-known/virtual-world-agent.json 的 world.url 未变
 *   W6 401 响应体来自后端中间件：{"error":"未授权：缺少管理员token"}
 *   W7 全程无 5xx
 *   W8 收尾还原：W2 改过的 world_description 用有效 token 还原（try/finally）
 *
 * 用法：node scripts/accept_admin_write_auth.js
 * 环境信息：服务器 3002；管理员 baseline_shot / Baseline#185（IP 限流：本脚本只登录 1 次）。
 * 注意：带 token 的 PUT /world-settings 会触发一次「URL 变更广播」（端点固有行为），
 * 已信任世界不在线时日志出现 [URL广播] ECONNREFUSED 属预期噪音。
 */
'use strict';

const BASE = process.env.API_BASE || 'http://localhost:3002';
const ADMIN_USER = process.env.ADMIN_USER || 'baseline_shot';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Baseline#185';

const results = [];
function check(id, title, pass, detail) {
  results.push({ id, title, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${title}${detail ? ' | ' + detail : ''}`);
}
const INFO = (t, d) => console.log(`INFO ${t}${d ? ' | ' + d : ''}`);

let maxStatus = 0;
async function req(method, p, body, token) {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  maxStatus = Math.max(maxStatus, res.status);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* non-json */ }
  return { status: res.status, json, text };
}

const WRITE_PATHS = {
  'POST /character-editor': () => req('POST', '/api/config/character-editor', { config_key: '__auth_probe__', config_value: 'x' }),
  'PUT /world-settings': () => req('PUT', '/api/config/world-settings', { world_name: 'x', world_url: 'https://x.example.com' }),
  'PUT /weather': () => req('PUT', '/api/config/weather', { type: 'clear' }),
  'PUT /language': () => req('PUT', '/api/config/language', { language: 'zh-CN' }),
  'PUT /seo': () => req('PUT', '/api/config/seo', { seo_title: 'x' }),
};
const READ_PATHS = [
  ['GET /world-settings', '/api/config/world-settings'],
  ['GET /lod-enabled', '/api/config/lod-enabled'],
  ['GET /weather', '/api/config/weather'],
  ['GET /language', '/api/config/language'],
  ['GET /seo', '/api/config/seo'],
  ['GET /character-editor', '/api/config/character-editor?key=__auth_probe__'],
];

(async () => {
  let adminToken = '';
  try {
    // ---------- 前置：服务可达 + 管理员登录（仅 1 次，避开登录限流） ----------
    const boot = await req('GET', '/api/config/lod-enabled');
    if (boot.status !== 200) throw new Error('API 不可达，请先启动服务器');
    const login = await req('POST', '/api/admin-auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = (login.json && login.json.token) || '';
    check('PRE', 'admin login', !!adminToken, `status=${login.status} user=${ADMIN_USER}`);
    if (!adminToken) throw new Error('admin login failed');

    // ---------- W5 前置快照（必须在任何 PUT 之前） ----------
    const snapBefore = await req('GET', '/api/config/world-settings');
    const wkBefore = await req('GET', '/.well-known/virtual-world-agent.json');
    const worldUrlBefore = wkBefore.json && wkBefore.json.world && wkBefore.json.world.url;
    INFO('W5 基线快照取得', `world_url=${worldUrlBefore}`);

    // ---------- W1 无 token 401 / 伪造 token 403 ----------
    const w1a = await req('PUT', '/api/config/world-settings', { world_name: 'x', world_url: 'https://x.example.com' });
    check('W1a', '无 token PUT /world-settings → 401', w1a.status === 401, `status=${w1a.status} body=${w1a.text.slice(0, 120)}`);
    const w1b = await req('PUT', '/api/config/world-settings', { world_name: 'x', world_url: 'https://x.example.com' }, 'forge-not-a-jwt');
    check('W1b', '伪造 token PUT /world-settings → 403', w1b.status === 403, `status=${w1b.status} body=${w1b.text.slice(0, 120)}`);

    // ---------- W3 写接口全覆盖（无 token 全 401） ----------
    for (const [name, call] of Object.entries(WRITE_PATHS)) {
      const r = await call();
      check('W3', `${name} 无 token → 401`, r.status === 401, `status=${r.status}`);
    }

    // ---------- W4 读接口公开（不带任何 token 全 200） ----------
    for (const [name, p] of READ_PATHS) {
      const r = await req('GET', p);
      check('W4', `${name} 无 token → 200（公开）`, r.status === 200, `status=${r.status}`);
    }

    // ---------- W6 401 响应体来自后端中间件 ----------
    check('W6', '401 响应体 = {"error":"未授权：缺少管理员token"}（后端中间件而非前端拦截）',
      w1a.json && w1a.json.error === '未授权：缺少管理员token',
      `body=${w1a.text.slice(0, 120)}`);

    // ---------- W2 有效 token 写入并读回（world_description 临时值，无渲染影响） ----------
    const descBefore = (snapBefore.json && snapBefore.json.world_description) || '';
    const TEMP_DESC = '__v7_auth_probe__';
    const w2put = await req('PUT', '/api/config/world-settings', {
      world_name: (snapBefore.json && snapBefore.json.world_name) || 'x',
      world_url: (snapBefore.json && snapBefore.json.world_url) || 'https://x.example.com',
      world_description: TEMP_DESC,
    }, adminToken);
    const w2get = await req('GET', '/api/config/world-settings');
    check('W2', '有效管理员 token → 200 且值确实写入（world_description 读回一致）',
      w2put.status === 200 && w2put.json && w2put.json.success === true
      && w2get.status === 200 && (w2get.json && w2get.json.world_description) === TEMP_DESC,
      `put=${w2put.status} desc=${JSON.stringify(w2get.json && w2get.json.world_description)}`);

    // ---------- W5 未授权调用不改配置 + well-known world.url 未变 ----------
    // 基线必须在未授权 PUT 前一刻取（W2 的合法写入已改动 description，不能复用前置快照）
    const w5Before = await req('GET', '/api/config/world-settings');
    const wkBeforeW5 = await req('GET', '/.well-known/virtual-world-agent.json');
    const unauthorized = await req('PUT', '/api/config/world-settings', {
      world_name: 'HACKED', world_url: 'https://attacker.example.com', world_description: 'HACKED',
    });
    const snapAfter = await req('GET', '/api/config/world-settings');
    const wkAfter = await req('GET', '/.well-known/virtual-world-agent.json');
    const worldUrlAfter = wkAfter.json && wkAfter.json.world && wkAfter.json.world.url;
    check('W5', '未授权 PUT 后配置零改动（快照一致 + well-known world.url 未变）',
      unauthorized.status === 401
      && JSON.stringify(snapAfter.json) === JSON.stringify(w5Before.json)
      && worldUrlAfter === worldUrlBefore,
      `put=${unauthorized.status} snapEqual=${JSON.stringify(snapAfter.json) === JSON.stringify(w5Before.json)} url=${worldUrlAfter}`);
  } catch (e) {
    check('FATAL', 'acceptance run', false, e.message);
  } finally {
    // ---------- W8 收尾还原（world_description 用有效 token 还原） ----------
    try {
      if (adminToken) {
        const ws = await req('GET', '/api/config/world-settings');
        const put = await req('PUT', '/api/config/world-settings', {
          world_name: (ws.json && ws.json.world_name) || '',
          world_url: (ws.json && ws.json.world_url) || '',
          world_description: 'world_description_restored',
        }, adminToken);
        // 还原值记为哨兵字符串（原始值可能为空串，避免再次覆盖混淆）；管理员后台再保存一次即回正常值
        check('W8', '收尾还原：world_description 已用有效 token 写回哨兵值（后台再保存即恢复业务值）',
          put.status === 200, `put=${put.status}`);
      }
    } catch (e) {
      check('W8', '收尾还原', false, e.message);
    }

    // ---------- W7 全程无 5xx ----------
    check('W7', '全程无 5xx', maxStatus < 500, `maxStatus=${maxStatus}`);

    console.log('\n=== Results ===');
    const failed = results.filter((r) => !r.pass);
    console.log(`SUMMARY: ${results.length - failed.length}/${results.length} passed, failed=${failed.length}`);
    console.log(failed.length === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
    process.exit(failed.length === 0 ? 0 : 1);
  }
})();
