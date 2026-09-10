/**
 * 验收：统一编辑器世界对象模型按需加载
 * ------------------------------------------------------------------
 * 背景：世界共 1073 个对象（706 个 uploaded_model，磁盘合计 ~5.8GB），
 *       旧逻辑在 loadWorldObjects() 里对每个对象立刻发起 GLB 加载，页面直接卡死。
 *
 * 判据：
 *   A1 懒加载器与缩略图队列模块已生效
 *   A2 登记的模型总数 == uploaded_model 对象数（不再漏登记）
 *   A3 首屏 25s 内实际发起的 GLB 请求数 <= 20（旧版为 700+）
 *   A4 并发在途请求始终 <= 3
 *   A5 相机附近模型确实被加载（done >= 1）
 *   A6 页面主线程存活（rAF 帧数达标，未冻结）
 *   A7 切到「全部加载」后继续排队加载，且并发仍受限
 *   A8 非噪音 console / 本地资源错误 = 0
 *   A9 截图存档 Screenshot/accept_editor_lazyload.png
 *
 * 用法：node scripts/accept_editor_lazyload.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3002';
const SAMPLE_MS = 25000;
const results = [];

function log(m) { console.log('[accept-editor] ' + m); }
function add(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  log((pass ? 'PASS' : 'FAIL') + ` ${id} ${name} :: ${detail}`);
}

const isNoise = (t) =>
  !t || t.includes('runtime.lastError') || t.includes('index.global.js') ||
  t.includes('favicon.ico') || t.includes('ResizeObserver loop');

(async () => {
  const meta = await fetch(BASE + '/api/world/objects').then(r => r.json()).catch(() => null);
  const uploadedCount = meta && meta.objects
    ? meta.objects.filter(o => o.type === 'uploaded_model').length : 0;
  log('世界 uploaded_model 数量 = ' + uploadedCount);

  // 编辑器需后台登录态
  let adminToken = '';
  for (const acc of [{ username: 'admin', password: 'admin123' }, { username: 'baseline_shot', password: 'Baseline#185' }]) {
    const r = await fetch(BASE + '/api/admin-auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(acc)
    }).then(x => x.json()).catch(() => null);
    if (r && r.success && r.token) { adminToken = r.token; log('管理后台登录成功: ' + acc.username); break; }
  }
  if (!adminToken) throw new Error('admin login failed');

  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() =>
    chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] }));
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((tok) => {
    try { localStorage.setItem('adminToken', tok); } catch (e) { }
  }, adminToken);

  await ctx.addInitScript(() => {
    window.__frames = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return orig(function (t) { window.__frames++; cb(t); });
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  const localFailed = [];
  let glbRequests = 0;
  let inflight = 0;
  let maxInflight = 0;

  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 资源类 404 错误文本不带 URL，需按 location 判定来源（favicon/第三方不计）
    const loc = (m.location && m.location().url) || '';
    if (isNoise(t + ' ' + loc)) return;
    errors.push((t + ' @ ' + loc).slice(0, 300));
  });
  page.on('pageerror', (e) => { if (!isNoise(e.message)) errors.push('pageerror: ' + e.message.slice(0, 300)); });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(BASE) || r.url().startsWith('http://localhost')) {
      localFailed.push(r.url().slice(0, 160));
    }
  });
  page.on('request', (r) => {
    if (/\.glb(\?|$)/i.test(r.url())) { glbRequests++; inflight++; maxInflight = Math.max(maxInflight, inflight); }
  });
  const settle = (r) => { if (/\.glb(\?|$)/i.test(r.url())) inflight = Math.max(0, inflight - 1); };
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);

  await page.goto(BASE + '/unified_editor.html', { waitUntil: 'domcontentloaded' });
  log('页面已打开，采样 ' + (SAMPLE_MS / 1000) + 's ...');
  await page.waitForTimeout(SAMPLE_MS);

  const info = await page.evaluate(() => ({
    hasLoader: !!window.WorldObjectLazyLoader,
    hasThumbs: !!window.ObjectThumbnails,
    stats: window.WorldObjectLazyLoader ? window.WorldObjectLazyLoader.stats() : null,
    mode: window.WorldObjectLazyLoader ? window.WorldObjectLazyLoader.mode : null,
    objects: (typeof worldObjects !== 'undefined') ? worldObjects.length : -1,
    frames: window.__frames,
    bar: !!document.getElementById('lazy-model-load-bar'),
    barText: document.getElementById('lazy-model-load-bar')
      ? document.getElementById('lazy-model-load-bar').textContent.trim() : ''
  }));
  log('state: ' + JSON.stringify(info));

  add('A1', '模块已生效', info.hasLoader && info.hasThumbs && info.bar,
    `loader=${info.hasLoader} thumbs=${info.hasThumbs} 状态条=${info.bar} "${info.barText}"`);
  add('A2', '登记模型数一致', info.stats && uploadedCount > 0 && info.stats.total === uploadedCount,
    `total=${info.stats ? info.stats.total : 'n/a'} / uploaded=${uploadedCount}`);
  add('A3', 'GLB 请求数受控(<=20)', glbRequests <= 20, `${glbRequests} 个请求（旧版约 ${uploadedCount}）`);
  add('A4', '并发受限(<=3)', maxInflight <= 3, `峰值并发 ${maxInflight}`);
  add('A5', '附近模型已加载', info.stats && info.stats.done >= 1,
    `done=${info.stats ? info.stats.done : 'n/a'} loading=${info.stats ? info.stats.loading : 'n/a'}`);
  add('A6', '主线程存活', info.frames > 100, `rAF 帧数 ${info.frames}`);

  // A7：切到全部加载，验证继续排队且并发仍受限
  const before = glbRequests;
  await page.evaluate(() => window.WorldObjectLazyLoader.loadAll());
  await page.waitForTimeout(8000);
  const afterStats = await page.evaluate(() => window.WorldObjectLazyLoader.stats());
  add('A7', '全部加载模式排队正常', glbRequests > before && maxInflight <= 3,
    `新增请求 ${glbRequests - before}，峰值并发仍 ${maxInflight}，done=${afterStats.done}`);

  add('A8', '无非噪音错误', errors.length === 0 && localFailed.length === 0,
    `console=${errors.length}${errors.length ? ' 首条: ' + errors[0] : ''} 本地失败=${localFailed.length}`);

  const out = path.join(__dirname, '..', 'Screenshot', 'accept_editor_lazyload.png');
  await page.screenshot({ path: out });
  add('A9', '截图存档', fs.existsSync(out), out);

  await browser.close();

  const failed = results.filter(r => !r.pass);
  console.log('\n===== 验收结果 ' + (results.length - failed.length) + '/' + results.length + ' =====');
  results.forEach(r => console.log(`${r.pass ? '✅' : '❌'} ${r.id} ${r.name} :: ${r.detail}`));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
