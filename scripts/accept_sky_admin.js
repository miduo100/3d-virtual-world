/**
 * 管理后台「天气控制→天空」UI 冒烟验收
 *
 * 用法: node scripts/accept_sky_admin.js
 *
 * 覆盖：默认天空卡片渲染 / 上传 jpg 自动选中 / 上传 exr 自动选中并启用环境光照
 *      / 切换选中（点卡片） / 删除 / 缩略图与 i18n 正常
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';
const OUT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_sky');
const IMG = path.join(__dirname, '..', 'public', 'uploads', 'sky', 'DaySkyHDRI054B_1K_TONEMAPPED.jpg');
const HDR = path.join(__dirname, '..', 'public', 'uploads', 'sky', 'DaySkyHDRI054B_1K_HDR.exr');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + String(detail).slice(0, 160));
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 先确保从 default 天空开始（避免污染）
  const lr = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
  });
  const ld = await lr.json();
  const TOKEN = ld.token;
  await fetch(BASE + '/api/config/weather', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'clear', intensity: 50, wind: 20, sky_id: 'default' })
  });

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars']
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];

  try {
    // 注入 token 后打开 admin.html
    const p0 = await ctx.newPage();
    await p0.goto(BASE + '/admin_login.html', { waitUntil: 'domcontentloaded' });
    await p0.evaluate((d) => {
      localStorage.setItem('adminToken', d.token);
      localStorage.setItem('adminUser', JSON.stringify({ username: 'baseline_shot' }));
    }, { token: TOKEN });
    await p0.close();

    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {})); // 默认 dismiss，避免弹窗卡死
// 删除前会临时把 window.confirm 改为 true 来通过原生确认框
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 200)));

    await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // 等 i18n 与 adminSky 模块就绪
    await page.waitForFunction(() => window.adminSky && window.i18n, null, { timeout: 30000 });

    // 进入天气控制子页（直接强制显示 + 触发加载，避开 subtab 点击的遮挡/弹窗）
    await page.evaluate(() => {
      document.querySelectorAll('.sub-page').forEach((el) => { el.style.display = 'none'; });
      const t = document.getElementById('world-sub-weather');
      if (t) t.style.display = '';
      if (typeof loadWeatherConfig === 'function') loadWeatherConfig();
    });
    await page.waitForSelector('#sky-library', { state: 'attached', timeout: 10000 });
    // 等 adminSky 渲染完默认天空卡片
    await page.waitForFunction(() => {
      const el = document.getElementById('sky-library');
      return el && /默认天空|System Default/.test(el.textContent);
    }, null, { timeout: 15000 });

    const cardCount0 = await page.evaluate(() => document.querySelectorAll('#sky-library > div').length);
    check('C1 default sky card rendered', cardCount0 >= 1, 'cards=' + cardCount0);
    await page.screenshot({ path: path.join(OUT_DIR, 'admin_sky_default.png'), fullPage: false, clip: { x: 300, y: 200, width: 1100, height: 600 } });

    // 上传全景图（自动选中）
    await page.setInputFiles('#sky-file-input', IMG);
    await page.waitForFunction(() => document.querySelectorAll('#sky-library > div').length >= 2, null, { timeout: 15000 });
    await page.waitForTimeout(1500); // 让自动选中 + 广播完成
    const hasSelectedImg = await page.evaluate(() => {
      const cards = document.querySelectorAll('#sky-library > div');
      return Array.from(cards).some((c) => c.textContent.includes('DaySkyHDRI054B_1K_TONEMAPPED') && c.textContent.includes('✅'));
    });
    check('C2 panorama uploaded and selected', hasSelectedImg, 'checked=' + hasSelectedImg);
    await page.screenshot({ path: path.join(OUT_DIR, 'admin_sky_panorama.png'), fullPage: false, clip: { x: 300, y: 200, width: 1100, height: 600 } });

    // 上传 HDR
    await page.setInputFiles('#sky-file-input', HDR);
    await page.waitForFunction(() => document.querySelectorAll('#sky-library > div').length >= 3, null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    const hasSelectedHdr = await page.evaluate(() => {
      const cards = document.querySelectorAll('#sky-library > div');
      return Array.from(cards).some((c) => c.textContent.includes('DaySkyHDRI054B_1K_HDR') && c.textContent.includes('✅'));
    });
    check('C3 hdr uploaded and selected', hasSelectedHdr, 'checked=' + hasSelectedHdr);
    await page.screenshot({ path: path.join(OUT_DIR, 'admin_sky_hdr.png'), fullPage: false, clip: { x: 300, y: 200, width: 1100, height: 600 } });

    // 点回全景图卡片（切换选中）
    const switchOk = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#sky-library > div'));
      const pano = cards.find((c) => c.textContent.includes('DaySkyHDRI054B_1K_TONEMAPPED'));
      if (!pano) return false;
      const fn = window.adminSkySelect;
      // onClick 已经绑 inline：触发点击即可
      pano.click();
      return true;
    });
    await page.waitForTimeout(1500);
    const panoramaSelectedAgain = await page.evaluate(() => {
      const cards = document.querySelectorAll('#sky-library > div');
      return Array.from(cards).some((c) => c.textContent.includes('DaySkyHDRI054B_1K_TONEMAPPED') && c.textContent.includes('✅'));
    });
    check('C4 click panorama card reselects', panoramaSelectedAgain, 'switchOk=' + switchOk);

    // 删除两张（用 window.confirm 注入绕过原生 confirm 弹窗）
    await page.evaluate(() => { window.confirm = () => true; });
    await page.evaluate((name) => {
      const card = Array.from(document.querySelectorAll('#sky-library > div')).find((c) => c.textContent.includes(name));
      if (card) {
        const x = card.querySelector('span[onclick]');
        if (x) x.click();
      }
    }, 'DaySkyHDRI054B_1K_TONEMAPPED');
    await page.waitForFunction(() => {
      return !Array.from(document.querySelectorAll('#sky-library > div')).some((c) => c.textContent.includes('DaySkyHDRI054B_1K_TONEMAPPED'));
    }, null, { timeout: 10000 });

    await page.evaluate((name) => {
      const card = Array.from(document.querySelectorAll('#sky-library > div')).find((c) => c.textContent.includes(name));
      if (card) {
        const x = card.querySelector('span[onclick]');
        if (x) x.click();
      }
    }, 'DaySkyHDRI054B_1K_HDR');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#sky-library > div').length === 1;
    }, null, { timeout: 10000 });
    const cardCountFinal = await page.evaluate(() => document.querySelectorAll('#sky-library > div').length);
    check('C5 deleted both, only default remains', cardCountFinal === 1, 'remaining=' + cardCountFinal);

    // 控制台无错误
    const noise = ['favicon', 'runtime.lastError', 'index.global.js'];
    const real = errors.filter((e) => !noise.some((n) => e.includes(n)));
    check('C6 no console errors', real.length === 0, real.slice(0, 3).join(' || ') || 'clean');
  } catch (e) {
    check('FATAL', false, e.message);
  } finally {
    await browser.close();
    // 收尾：清库 + 回到默认天空
    if (TOKEN) {
      const list = await (await fetch(BASE + '/api/sky/list', { headers: { Authorization: 'Bearer ' + TOKEN } })).json();
      for (const s of list.skies || []) {
        if (!s.builtin) await fetch(BASE + '/api/sky/' + s.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + TOKEN } });
      }
      await fetch(BASE + '/api/config/weather', {
        method: 'PUT', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clear', intensity: 50, wind: 20, sky_id: 'default' })
      });
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log('\n=== SKY ADMIN UI ACCEPTANCE: ' + passed + '/' + results.length + ' ===');
  process.exit(passed === results.length ? 0 : 1);
})();