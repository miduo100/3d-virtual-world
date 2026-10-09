/**
 * AI World Brain · Phase 2a UI 验收（P1-10 · 可重跑）
 *   node scripts/accept_world_ai_phase2a_ui.js
 *
 * P1-10 后台 page + sub-tab「设置」可见、可保存、刷新后回填正确；总闸/自主度可交互。
 * 真浏览器（playwright chrome 通道）；顺带断言 0 console error（过滤 favicon 与浏览器扩展噪音）。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { chromium } = require('playwright');

const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
let pass = 0, fail = 0;
const log = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

async function api(p, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, j };
}

(async () => {
  const login = await api('/api/admin-auth/login', { method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' } });
  if (login.status !== 200) { console.log('LOGIN FAIL', login.status); process.exit(1); }
  const T = login.j.token;

  // 快照（收尾还原）
  const cfg0 = (await api('/api/world-ai/config', { token: T })).j.config;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (url.includes('favicon')) return; // chrome 通道噪音
    consoleErrors.push(m.text() + ' @ ' + url);
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  // 注入登录态（checkAdminAuth 需要 adminToken + adminUser 同时存在）
  await page.addInitScript(([t]) => {
    localStorage.setItem('adminToken', t);
    localStorage.setItem('adminUser', JSON.stringify({ username: 'baseline_shot', role: 'superadmin' }));
  }, [T]);

  await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // U1 nav 项存在且可点击
  const navItem = page.locator('.nav-item', { hasText: 'AI 世界大脑' });
  log(await navItem.count() === 1, 'U1 侧栏「AI 世界大脑」nav 项存在（且仅 1 个，末尾追加无错位）', '');
  await navItem.first().click();
  await page.waitForTimeout(900);

  // U2 page 激活 + sub-tab 容器由模块注入
  const pageActive = await page.evaluate(() => document.getElementById('page-ai-world-brain').classList.contains('active'));
  log(pageActive, 'U2 page-ai-world-brain 激活', '');
  const subVisible = await page.locator('#ai-world-brain-sub-awb-settings').isVisible();
  log(subVisible, 'U3 sub-tab「设置」容器可见（awb- 前缀）', '');

  // U4 表单已回填（GET /config 数据出现在控件里）
  const enabledChecked = await page.evaluate(() => document.getElementById('awb-enabled').checked === false);
  log(enabledChecked, 'U4 总闸 checkbox 与服务端 enabled=false 一致', '');

  // U5 修改 → 保存 → 断言落库
  const marker = 'UI-P2A-' + Date.now();
  await page.fill('#awb-system-prompt', marker);
  await page.locator('input[name="awb-autonomy"][value="semi_autonomous"]').check();
  await page.click('#awb-save-btn');
  await page.waitForTimeout(800);
  const saved = (await api('/api/world-ai/config', { token: T })).j.config;
  log(saved.systemPrompt === marker && saved.autonomy === 'semi_autonomous', 'U5 保存生效（system_prompt + autonomy 落库）', '');

  // U6 刷新页面 → 重新进入 → 回填正确
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('.nav-item', { hasText: 'AI 世界大脑' }).first().click();
  await page.waitForTimeout(900);
  const backfilled = await page.evaluate(() => document.getElementById('awb-system-prompt').value);
  const radioBack = await page.evaluate(() => {
    const el = document.querySelector('input[name="awb-autonomy"]:checked');
    return el ? el.value : null;
  });
  log(backfilled === marker && radioBack === 'semi_autonomous', 'U6 刷新后回填正确', '');

  // U7 凭证区可见
  const credVisible = await page.locator('#awb-cred-list').isVisible();
  log(credVisible, 'U7 凭证管理区可见', '');

  // U8 恢复现场 + 0 console error
  await api('/api/world-ai/config', {
    token: T, method: 'PUT',
    body: { system_prompt: cfg0.systemPrompt, autonomy: cfg0.autonomy },
  });
  log(consoleErrors.length === 0, 'U8 0 console error', consoleErrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n════════ VERDICT: ${fail === 0 ? 'ACCEPTED' : 'FAILED'}  ${pass}/${pass + fail} ════════`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
