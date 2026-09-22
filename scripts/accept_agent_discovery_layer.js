/**
 * AI Agent 引流 第 2 步验收：机器可读发现层
 *   public/robots.txt · public/sitemap.xml · public/llms.txt · public/agents/index.html
 *
 * 判据 D1~D10，来源：AI-Agent引流提示词-2-机器可读发现层-v2-含文档全文.md §4
 *
 * 可重跑：node scripts/accept_agent_discovery_layer.js
 *
 * 两处与提示词字面描述的**有意偏移**（均已在输出里 INFO 记录）：
 *   D2  sitemap 的 <loc> 写死生产域名 miduo100.com，本地验收把协议+host 换成 BASE 后探测
 *       （验证"路径在本部署内存在"），绝对 URL 的实测结果只作 INFO——线上部署是人工步骤。
 *   D8  抽出的示例代码只做一处替换：HOST 常量改为 process.env.AGENT_HOST（否则会打真实线上世界）。
 *
 * 总闸：脚本开头统一把 agent_enabled 打开（走管理员 API，直写 DB 不生效），
 *       收尾恢复为运行前值——否则 D7/D10b 会被 guest/session 的 503 AGENT_DISABLED 误判为失败。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  BASE, createReporter, httpJson, waitFor, sleep, testIp, openAgentWs
} = require('./agentV2TestKit');

const R = createReporter('发现层验收 D1~D10');
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';

let saw5xx = [];

// ==================== HTTP 原始文本请求（发现层大多是非 JSON）====================

async function httpRaw(p, options = {}) {
  const { method = 'GET', headers = {}, body, ip, redirect = 'follow', absolute } = options;
  const h = { ...headers };
  if (ip) { h['X-Real-IP'] = ip; h['X-Forwarded-For'] = ip; }
  let payload;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const url = absolute || (BASE + p);
  let res;
  try {
    res = await fetch(url, { method, headers: h, body: payload, redirect });
  } catch (e) {
    return { status: 0, text: '', headers: new Headers(), error: e.message };
  }
  const text = await res.text();
  if (res.status >= 500) saw5xx.push(`${method} ${p} → ${res.status}`);
  return { status: res.status, text, headers: res.headers, finalUrl: res.url };
}

function jsonOf(r) { try { return JSON.parse(r.text); } catch (e) { return null; } }

// ==================== D8 用的总闸开关（必须走 API，直写 DB 不生效）====================

async function readAgentEnabled() {
  const caps = jsonOf(await httpRaw('/api/agent/v1/capabilities'));
  return caps ? Boolean(caps.agentEnabled) : null;
}

async function setAgentEnabled(enabled) {
  const login = await httpRaw('/api/admin-auth/login', {
    method: 'POST', body: { username: ADMIN_USER, password: ADMIN_PASS }
  });
  const tok = jsonOf(login);
  const token = tok && (tok.token || (tok.data && tok.data.token));
  if (!token) throw new Error('管理员登录失败：' + login.status + ' ' + login.text.slice(0, 120));
  const put = await httpRaw('/api/agent/v1/admin/config', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + token }, body: { agent_enabled: enabled }
  });
  if (put.status !== 200) throw new Error('PUT admin/config 失败：' + put.status + ' ' + put.text.slice(0, 160));
  return true;
}

async function waitAgentEnabled(want, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await readAgentEnabled();
    if (v === want) return true;
    await sleep(400);
  }
  return false;
}

// ==================== 主流程 ====================

(async () => {
  const originalEnabled = await readAgentEnabled();

  // ---------- 读本地文件（D3/D6/D7/D8/D9 需要原文）----------
  const llmsPath = path.join(PUBLIC, 'llms.txt');
  const llmsText = fs.existsSync(llmsPath) ? fs.readFileSync(llmsPath, 'utf8') : '';
  const indexPath = path.join(PUBLIC, 'index.html');
  const indexText = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';

  // ---------- 总闸：D8 需要 agent_enabled=true（顺带避免 D7/D10 被 503 干扰）----------
  // 必须走 API（服务器进程内有 60s 配置缓存，直写 DB 不生效）；收尾恢复运行前值。
  let enabledTouched = false;
  if (originalEnabled !== true) {
    try {
      await setAgentEnabled(true);
      enabledTouched = true;
      await waitAgentEnabled(true);
    } catch (e) { R.info('开闸失败（D7/D8 可能受影响）', e.message); }
  }

  // ---------- D1 robots.txt ----------
  const robots = await httpRaw('/robots.txt');
  R.check('D1 robots.txt 200 + text/plain', robots.status === 200 && /text\/plain/i.test(robots.headers.get('content-type') || ''),
    `${robots.status} ${robots.headers.get('content-type')}`);
  R.check('D1b robots.txt 放行 AI 爬虫且禁止 /admin.html',
    /User-agent:\s*GPTBot/i.test(robots.text) && /Disallow:\s*\/admin\.html/i.test(robots.text) && /Sitemap:/.test(robots.text));
  R.info('D1c robots.txt Cache-Control', robots.headers.get('cache-control') || '(none)');

  // ---------- D2 sitemap.xml ----------
  const sm = await httpRaw('/sitemap.xml');
  const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  R.check('D2 sitemap.xml 200 + <urlset> 根节点',
    sm.status === 200 && /<urlset[\s>]/.test(sm.text) && locs.length >= 1,
    `${sm.status} locs=${locs.length}`);

  let locOk = 0;
  const locDetail = [];
  for (const loc of locs) {
    let u; try { u = new URL(loc); } catch (e) { locDetail.push(`${loc}=非法URL`); continue; }
    // 本地口径：协议+host 换成 BASE，验证"该路径在本部署内可达"
    const local = await httpRaw(u.pathname + u.search, { method: 'HEAD' });
    const okLocal = local.status === 200 || local.status === 301 || local.status === 302;
    // 绝对 URL 口径（依赖人工上线部署）：仅作 INFO
    const real = await httpRaw(null, { method: 'HEAD', absolute: loc });
    if (okLocal) locOk++;
    locDetail.push(`${u.pathname} local=${local.status} live=${real.status}`);
  }
  R.check('D2b 所有 <loc> 路径在本部署内可达（HEAD 200/301）', locOk === locs.length, locDetail.join(' | '));
  R.info('D2c 绝对 URL（miduo100.com）实测——依赖人工部署，不作判据', locDetail.join(' | '));

  // ---------- D3 llms.txt ----------
  const llms = await httpRaw('/llms.txt');
  const firstLine = (llms.text.split(/\r?\n/)[0] || '');
  R.check('D3 llms.txt 200 + 首行以 "# " 开头',
    llms.status === 200 && firstLine.startsWith('# '), `${llms.status} first="${firstLine}"`);
  R.check('D3b llms.txt 含发现文档与能力清单端点',
    llms.text.includes('/.well-known/virtual-world-agent.json') && llms.text.includes('/api/agent/v1/capabilities'));
  R.info('D3c llms.txt Cache-Control', llms.headers.get('cache-control') || '(none)');

  // ---------- D4 /agents/ 页面 ----------
  const agents = await httpRaw('/agents/');
  const a = agents.text;
  R.check('D4 /agents/ 200 + 关键元素齐全', agents.status === 200
    && /<title>/.test(a) && /<code>/.test(a) && /<table>/.test(a)
    && a.includes('application/ld+json') && a.includes('/.well-known/virtual-world-agent.json'),
    `status=${agents.status} len=${a.length}`);
  R.check('D4b /agents/ 未伪造演示素材（保留 TODO 占位）',
    a.includes('<!-- TODO: 演示 GIF') || !/\.gif/i.test(a));

  // ---------- D5 目录尾斜杠 301 ----------
  const noSlash = await httpRaw('/agents', { redirect: 'manual' });
  const loc = noSlash.headers.get('location') || '';
  R.check('D5 GET /agents → 301 到 /agents/',
    noSlash.status === 301 && /\/agents\/$/.test(loc), `${noSlash.status} location=${loc}`);

  // ---------- D6 防文档漂移（最关键）----------
  const capsRes = await httpRaw('/api/agent/v1/capabilities');
  const caps = jsonOf(capsRes);
  if (!caps) {
    R.check('D6 capabilities 可解析', false, `status=${capsRes.status}`);
  } else {
    const actions = caps.actions || [];
    const missingActions = actions.filter(x => !llmsText.includes('`' + x + '`'));
    R.check('D6a capabilities.actions 全部出现在 llms.txt', actions.length > 0 && missingActions.length === 0,
      `actions=${actions.length} missing=[${missingActions.join(',')}]`);

    const L = caps.limits || {};
    const expect = { observeRadiusMaxGuest: 30, observeRadiusMax: 200, sayMaxLength: 200, guestObserveIntervalSeconds: 2 };
    const badConst = Object.keys(expect).filter(k => Number(L[k]) !== expect[k]);
    R.check('D6b capabilities.limits 四个关键值与契约一致', badConst.length === 0,
      badConst.map(k => `${k}=${L[k]}(期望${expect[k]})`).join(',') || 'all ok');
    const badInDoc = Object.keys(expect).filter(k => {
      const v = Number(L[k]);
      return !new RegExp('(^|[^0-9])' + v + '([^0-9]|$)').test(llmsText);
    });
    R.check('D6c limits 四个关键值都出现在 llms.txt', badInDoc.length === 0,
      badInDoc.map(k => `${k}=${L[k]}`).join(',') || 'all present');

    const forbidden = (caps.scopes && caps.scopes.forbidden) || [];
    const missedForbidden = forbidden.filter(x => !llmsText.includes('`' + x + '`'));
    R.check('D6d scopes.forbidden 5 项都出现在 llms.txt',
      forbidden.length === 5 && missedForbidden.length === 0,
      `forbidden=[${forbidden.join(',')}] missing=[${missedForbidden.join(',')}]`);

    const tiers = (caps.tiers && caps.tiers.options) || [];
    R.check('D6e 两个档位都出现在 llms.txt',
      tiers.length === 2 && tiers.every(t => llmsText.includes('`' + t + '`')), tiers.join(','));

    R.info('D6f capabilities 关键值快照',
      `actions=${actions.length} observeRadiusMaxGuest=${L.observeRadiusMaxGuest} observeRadiusMax=${L.observeRadiusMax} sayMaxLength=${L.sayMaxLength} guestObserveIntervalSeconds=${L.guestObserveIntervalSeconds}`);
  }

  // ---------- D7 llms.txt 里每个端点都可达 ----------
  const epSet = new Set();
  for (const m of llmsText.matchAll(/\/(?:\.well-known|api\/agent\/v1|agents|llms\.txt)[A-Za-z0-9._\/-]*/g)) {
    let p = m[0].replace(/[.,)）]+$/, '');
    if (p.includes('ws/agent')) continue;
    epSet.add(p);
  }
  const POST_ENDPOINTS = new Set(['/api/agent/v1/guest/session']);
  const epDetail = [];
  let epBad = 0;
  for (const p of epSet) {
    const isPost = POST_ENDPOINTS.has(p);
    const r = await httpRaw(p, { method: isPost ? 'POST' : 'GET', body: isPost ? {} : undefined, ip: testIp(240) });
    const bad = r.status === 404 || r.status === 0 || r.status >= 500;
    if (bad) epBad++;
    epDetail.push(`${isPost ? 'POST' : 'GET'} ${p}=${r.status}`);
  }
  R.check('D7 llms.txt 内全部端点可达（无 404/5xx）', epSet.size > 0 && epBad === 0, epDetail.join(' | '));

  // ---------- D8 llms.txt 示例代码可运行 ----------
  let d8pass = false, d8detail = '';
  let tempFile = null;
  try {
    const block = llmsText.match(/```js\r?\n([\s\S]*?)```/);
    if (!block) {
      d8detail = 'llms.txt 内未找到 js 代码块';
    } else {
      const code = block[1].replace(
        /const HOST = '[^']*';/,
        "const HOST = process.env.AGENT_HOST || 'https://miduo100.com';"
      ) + `

// ---------- 验收附加断言（不属于 llms.txt 原文，仅验收脚本追加）----------
let gotReady = false;
ws.addEventListener('message', (e) => {
  try { const m = JSON.parse(e.data); if (m.type === 'READY') gotReady = true; } catch (err) {}
});
await new Promise(r => setTimeout(r, 3000));
console.log('__RESULT__' + JSON.stringify({
  wkSuccess: Boolean(wk && wk.success),
  ticket: Boolean(s && s.token),
  tier: s && (s.tier || null),
  wsOpen: ws.readyState === 1,
  ready: gotReady
}));
try { ws.close(); } catch (e) {}
`;
      tempFile = path.join(os.tmpdir(), 'llms_block_' + Date.now() + '.mjs');
      fs.writeFileSync(tempFile, code, 'utf8');
      const run = spawnSync(process.execPath, [tempFile], {
        encoding: 'utf8', timeout: 40000,
        env: { ...process.env, AGENT_HOST: BASE }
      });
      const out = (run.stdout || '') + (run.stderr || '');
      const hit = out.match(/__RESULT__(\{.*\})/);
      const res = hit ? JSON.parse(hit[1]) : null;
      d8pass = Boolean(res && res.wkSuccess && res.ticket && res.wsOpen && res.ready);
      d8detail = res ? JSON.stringify(res) : `no __RESULT__ exit=${run.status} out=${out.slice(-200)}`;
    }
  } catch (e) {
    d8detail = 'D8 异常：' + e.message;
  } finally {
    if (tempFile && fs.existsSync(tempFile)) { try { fs.unlinkSync(tempFile); } catch (e) {} }
  }
  R.check('D8 llms.txt 示例代码可运行（票 + WS + READY）', d8pass, d8detail);

  // ---------- D9 index.html 含 /agents/ 入口 ----------
  const allAgentsLinks = [...indexText.matchAll(/href="\/agents\/?"/g)].length;
  R.check('D9 public/index.html 含指向 /agents/ 的链接',
    /href="\/agents\/?"/.test(indexText) && allAgentsLinks === 1, `count=${allAgentsLinks}`);

  // ---------- D10 无 5xx + 主世界冒烟 ----------
  const smoke = spawnSync(process.execPath, [path.join(__dirname, 'smoke_r185_world.js')], {
    encoding: 'utf8', timeout: 180000, cwd: ROOT
  });
  const smokeOut = (smoke.stdout || '') + (smoke.stderr || '');
  const smokeHit = smokeOut.match(/(\d+)\s*\/\s*(\d+)\s*(?:PASS|passed)/i);
  R.check('D10 主世界冒烟无回归（9/9）',
    Boolean(smokeHit) && smokeHit[1] === smokeHit[2] && Number(smokeHit[2]) >= 9,
    smokeHit ? smokeHit[0] : smokeOut.slice(-200));
  R.check('D10b 全程无 5xx', saw5xx.length === 0, saw5xx.join(' | ') || 'none');

  // ---------- 收尾：恢复总闸为运行前值 ----------
  if (enabledTouched) {
    try {
      await setAgentEnabled(Boolean(originalEnabled));
      await waitAgentEnabled(Boolean(originalEnabled));
    } catch (e) { R.info('收尾恢复 agent_enabled 失败', e.message); }
  }
  R.info('收尾 agent_enabled', `运行前=${originalEnabled} → 当前=${await readAgentEnabled()}`);

  const sum = R.summary();
  console.log(`\n[环境] BASE=${BASE}  agent_enabled(收尾)=${await readAgentEnabled()}`);
  process.exitCode = sum.fail === 0 ? 0 : 1;
})();
