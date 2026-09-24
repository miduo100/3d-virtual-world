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

/**
 * 按 RFC 9309 解析 robots.txt 的**分组**（供 D1b2 用）。
 * 一组 = 「一个或多个连续的 User-agent 行」+「其后的规则行」。
 * 规则行之后再出现 User-agent 行 → 属于**新的一组**（组之间不合并）。
 * 返回 [{ agents: ['GPTBot', …], rules: [{type:'Allow'|'Disallow', path:'/x'}] }]
 */
function parseRobotsGroups(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const ua = /^User-agent:\s*(.+)$/i.exec(line);
    if (ua) {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(ua[1].trim());
      lastWasAgent = true;
      continue;
    }
    const rule = /^(Allow|Disallow):\s*(.*)$/i.exec(line);
    if (rule) {
      if (!cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.rules.push({ type: rule[1].replace(/^./, c => c.toUpperCase()), path: rule[2].trim() });
      lastWasAgent = false;
      continue;
    }
    lastWasAgent = false;   // Sitemap 等非规则行：切断当前组的连续性判定
  }
  return groups;
}

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

  // D1b2（2026-09-22 新增）：robots 规范里**各组不合并**（RFC 9309：只用最匹配的那一组），
  // 所以"全文件里存在 Disallow: /admin.html"是不够的 —— 它可能只写在 `User-agent: *` 组里，
  // 而 GPTBot 组只有一行 `Allow: /`，等于**放行 /api/（含 784KB 的 /api/world/objects）与全部 .glb**。
  // 实测过就是这个状态（AI 访客体检 [1-2]）。这里按组解析，要求每个 AI 组自己写全关键 Disallow。
  const groups = parseRobotsGroups(robots.text);
  const AI_PROBE = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Bytespider', 'OAI-SearchBot'];
  const MUST_DISALLOW = ['/api/', '/admin.html', '/*_editor.html'];
  const groupBad = [];
  let aiGroupCount = 0;
  for (const g of groups) {
    const isAi = g.agents.some(a => AI_PROBE.some(x => a.toLowerCase() === x.toLowerCase()));
    if (!isAi) continue;
    aiGroupCount++;
    for (const p of MUST_DISALLOW) {
      if (!g.rules.some(r => r.type === 'Disallow' && r.path === p)) {
        groupBad.push(`${g.agents[0]} 组缺 Disallow ${p}`);
      }
    }
  }
  R.check('D1b2 每个 AI 组的组内都写全了关键 Disallow（组不合并，只写 Allow 等于放行 /api/ 与 .glb）',
    aiGroupCount > 0 && groupBad.length === 0,
    `AI 组数=${aiGroupCount} ${groupBad.length ? '问题=[' + groupBad.join('; ') + ']' : 'all ok'}`);
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
    // D6a（2026-09-22 收紧）：原判据是"capabilities 的动作都出现在 llms.txt"（**包含**关系），
    // superset 也能通过 —— 于是 llms.txt 曾把 HTTP 端点 `observe` 混进 WS 动作清单（9 项 vs 8 项）
    // 而没被拦住，导致 AI 照文档发 `ACTION{action:'observe'}` 必然 `unknown_action`
    // （AI 访客体检 [6-1]）。现改为对 llms.txt 的「WS actions」行做**逐项相等**比对。
    const llmsWsLine = (llmsText.split('\n').find(l => /WS actions/i.test(l)) || '');
    const llmsWsActions = Array.from(llmsWsLine.matchAll(/`([a-z_]+)`/g)).map(m => m[1]);
    const onlyInCaps = actions.filter(x => !llmsWsActions.includes(x));
    const onlyInLlms = llmsWsActions.filter(x => !actions.includes(x));
    R.check('D6a llms.txt 的 WS 动作清单与 capabilities.actions 逐项相等',
      actions.length > 0 && llmsWsActions.length > 0 && onlyInCaps.length === 0 && onlyInLlms.length === 0,
      `caps=${actions.length} llms=${llmsWsActions.length} 仅在caps=[${onlyInCaps.join(',')}] 仅在llms=[${onlyInLlms.join(',')}]`);

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

    // D6g（2026-09-23 新增）：**语义漂移**守住。
    // 背景：2026-09-23 AI 访客体检发现 —— 距离/回执语义已经写进 capabilities、openapi、observe 响应，
    // 而两份门面文档（llms.txt / /agents/）**0 处提及**：AI 读完门面仍不知道"服务端判距是水平距离"
    // "say 回执里有 recipients""自己的 y 不是渲染高度"。与 D6a 同理：契约里的语义必须同步到门面，
    // 否则 AI 会按旧认知写错代码（例如拿 y 差判断楼层、把 delivered 当成真有人听见）。
    const oaRes = await httpRaw('/api/agent/v1/openapi.json');
    const oa = jsonOf(oaRes) || {};
    const oaObsDesc = String((((oa.paths || {})['/observe'] || {}).get || {}).description || '');
    const semKeys = ['distance3D', 'recipients', 'positionIsServerPlane'];
    const missingInLlms = semKeys.filter(k => !llmsText.includes(k));
    const missingInAgents = semKeys.filter(k => !a.includes(k));
    R.check('D6g 新语义（distance3D / recipients / positionIsServerPlane）已同步进门面（llms.txt + /agents/），且 openapi 描述含 distance3D',
      missingInLlms.length === 0 && missingInAgents.length === 0 && /distance3D/.test(oaObsDesc),
      `llms缺=[${missingInLlms.join(',')}] agents缺=[${missingInAgents.join(',')}] openapi含distance3D=${/distance3D/.test(oaObsDesc)}`);
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

  // D8b（2026-09-23 新增）：D8 是把 llms.txt 的示例**原样跑一遍**，而示例里带一句 say ——
  // 于是每次跑验收都会往世界聊天记录里写一条示例文案（体检时实测就是这类噪音的来源之一）。
  // 这里把它清掉；只在打本机时清（db 句柄永远指向本机库，打远端不能删）。
  try {
    const sampleText = (llmsText.match(/text:\s*'([^']{1,80})'/) || [])[1];
    if (sampleText && /localhost|127\.0\.0\.1|\[::1\]/.test(BASE)) {
      const dbc = require('../src/database/db');
      const del = await dbc.query('DELETE FROM world_chat_log WHERE message = $1', [sampleText]);
      R.info('D8b 已清理示例代码写入的聊天记录', `${del.rowCount} 行（"${sampleText.slice(0, 24)}…"）`);
    } else {
      R.info('D8b 跳过示例聊天清理', sampleText ? '目标是远端' : '未从 llms.txt 解析出示例文案');
    }
  } catch (e) { R.info('D8b 示例聊天清理失败（不影响判据）', e.message); }

  // ---------- D9 index.html 含 /agents/ 入口 ----------
  // 2026-09-23 放宽：原判据按提示词 §4 写的是"**恰好 1 个**"，但首页后来在「世界简介」SEO 区块
  // （#world-intro 的「入口：AI 接入说明」）里也加了一个，与专用爬虫入口各司其职 —— 于是
  // "恰好 1 个"成了误报。判据的真实意图是"首页有 AI 接入入口、且不堆砌（防 SEO 垃圾化）"，
  // 故改为 1~3 个并记录条数；若将来要继续收紧，应先决定删哪一个入口（属产品决策）。
  const allAgentsLinks = [...indexText.matchAll(/href="\/agents\/?"/g)].length;
  R.check('D9 public/index.html 含指向 /agents/ 的入口（1~3 个，防堆砌）',
    allAgentsLinks >= 1 && allAgentsLinks <= 3, `count=${allAgentsLinks}`);

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
