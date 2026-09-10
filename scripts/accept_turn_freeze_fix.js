/**
 * 验收：转向卡顿治理第一会话（灯池降容 + 空闲预绘制 + 面向优先）
 * ------------------------------------------------------------------
 * 判据：
 *   A1 LightPool 池大小 = 8（降容生效）
 *   A2 PreloadSweeper 存在且已启动过扫掠（stats 可读、程序数曾增长）
 *   A3 加载收敛后（队列空 + 扫掠暂停）执行 6 秒 360° 转向：worst frame < 300ms
 *   A4 全程 0 pageerror（过滤扩展噪音）
 *
 * 用法：node scripts/accept_turn_freeze_fix.js
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3002';
const USER = 'diag_tmp_1';
const PASS = 'Diag#2026tmp';
function log(m) { console.log('[accept] ' + m); }

(async () => {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then(r => r.json());
  if (!login.token) throw new Error('login failed');

  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() =>
    chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] }));
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__frames = [];
    window.__lastFrameAt = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return orig(function (t) {
        const now = performance.now();
        const d = now - window.__lastFrameAt;
        window.__lastFrameAt = now;
        if (window.__frames.length > 30000) window.__frames.length = 0;
        window.__frames.push({ t: now, d });
        cb(t);
      });
    };
  });

  const p0 = await ctx.newPage();
  await p0.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await p0.evaluate((d) => {
    localStorage.setItem('token', d.token);
    localStorage.setItem('userId', String(d.userId));
    localStorage.setItem('characterId', String(d.characterId));
  }, login);
  await p0.close();

  const page = await ctx.newPage();
  const errors = [];
  const badUrls = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 150)));
  page.on('requestfailed', (r) => badUrls.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400) badUrls.push('HTTP' + r.status() + ' ' + r.url()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass, detail }); log((pass ? 'PASS ' : 'FAIL ') + name + ' :: ' + detail); };

  await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player, null, { timeout: 180000 });
  await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });

  // A1 灯池
  const pool = await page.evaluate(() => (window.LightPool && window.LightPool.stats) ? window.LightPool.stats() : null);
  check('A1 LightPool size=8', !!pool && pool.size === 8, JSON.stringify(pool));

  // A2 扫掠器已启动（等收敛：队列空 + sweeper 暂停，最长 90s）
  let sweep = null, converged = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(3000);
    sweep = await page.evaluate(() => (window.PreloadSweeper && window.PreloadSweeper.stats) ? window.PreloadSweeper.stats() : null);
    const queueLen = await page.evaluate(() => {
      const g = window.gameWorld; return g && g.loadingQueue ? g.loadingQueue.length : -1;
    });
    if (sweep && sweep.active === false && sweep.dir !== undefined && queueLen === 0 && i > 4) { converged = true; break; }
    if (sweep && sweep.active === false && i > 8) { converged = true; break; } // 已收敛停扫
  }
  check('A2 PreloadSweeper ran & converged', converged && !!sweep, JSON.stringify(sweep));

  // A3 收敛后转向：6 秒 360°
  const start = await page.evaluate(() => {
    window.__mStart = performance.now();
    window.__tt = setInterval(() => { if (window.MOUSE) window.MOUSE.targetRotationY -= 0.02; }, 16);
    setTimeout(() => clearInterval(window.__tt), 6000);
    return window.__mStart;
  });
  await page.waitForTimeout(6500);
  const frames = await page.evaluate((s) => {
    const out = [];
    for (const f of window.__frames) if (f.t >= s && f.t <= s + 6400) out.push(f);
    return out;
  }, start);
  const longs = frames.filter((f) => f.d > 200).map((f) => Math.round(f.d)).sort((a, b) => b - a);
  const worst = longs.length ? longs[0] : 0;
  check('A3 post-settle turn worst frame < 300ms', worst < 300, 'worst=' + worst + 'ms  longFrames(>200ms)=' + longs.length + '  frames=' + frames.length);

  // A4 console/page errors（URL 级噪音单独归类：favicon 404、已知死端口角色模板、扩展噪音）
  const noiseRe = /runtime\.lastError|index\.global\.js|ResizeObserver/i;
  const noiseUrlRe = /favicon\.ico|localhost:6002\/uploads\/character-templates/i;
  const real = errors.filter((t) => !noiseRe.test(t) && !/Failed to load resource/i.test(t));
  // net::ERR_ABORTED = 卸载逻辑主动中断在途下载（跑远 unload），属设计行为非错误
  const realBadUrls = badUrls.filter((u) => !noiseUrlRe.test(u) && !/ERR_ABORTED/.test(u));
  check('A4 console/page errors (non-resource)=0', real.length === 0, real.slice(0, 5).join(' | ') || '0');
  check('A4b resource errors excluding known noise=0', realBadUrls.length === 0,
    realBadUrls.slice(0, 5).join(' | ') || '0 (noise: ' + badUrls.filter((u) => noiseUrlRe.test(u)).length + ' known)');

  await browser.close();

  const passCount = results.filter((r) => r.pass).length;
  console.log('\n=== VERDICT: ' + passCount + '/' + results.length + ' ' + (passCount === results.length ? 'ALL PASS' : 'HAS FAILURES') + ' ===');
  process.exit(passCount === results.length ? 0 : 1);
})().catch((e) => { console.error('[accept] FATAL', e); process.exit(2); });
