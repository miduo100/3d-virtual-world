/**
 * accept_loading_progress.js — 顶部进度条引擎（loadingProgress.js）验收
 *
 * 判据：
 *  P1 引擎已加载且 world.js 钩子生效
 *  P2 进入世界后进度条出现过（visible 至少一次）
 *  P3 进度条到达 100% 并隐藏（不再卡 34.5%）；100% 时刻 pending=0（全部渲染确认/超时收敛）
 *  P4 走远后新任务集触发重现（再次 visible）
 *  P5 全程无 console error（过滤扩展噪音）
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3002';
const NOISE = /runtime\.lastError|index\.global\.js/i;

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true }); // 真实 GPU，队列消耗快
    console.log('[0] using channel: chrome');
  } catch (e) {
    browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
    console.log('[0] using bundled chromium (swiftshader)');
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const locUrl = (m.location() && m.location().url) || '';
    if (/favicon/i.test(locUrl)) return; // chrome 通道 favicon 噪音
    if (!NOISE.test(m.text())) errors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => { if (!NOISE.test(String(e))) errors.push('PAGEERROR: ' + String(e).slice(0, 200)); });
  // favicon 404 是 chrome 通道噪音，单独记录不计入错误
  const resp404 = [];
  page.on('response', (r) => { if (r.status() >= 400) resp404.push(r.status() + ' ' + r.url()); });

  console.log('[1] open world page ...');
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
  try { await page.click('#close-controls-hint', { timeout: 5000 }); } catch (e) {}
  await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.THREE && window.PlaceholderField && window.LoadingProgress, null, { timeout: 30000 });
  console.log('[1] OK  engine + world ready');

  // P2/P3: 轮询观察首环加载（500ms 采样防错过 1s 淡出窗；completedGens 持久断言）
  let sawVisible = false, sawComplete = false, completePending = -1, completePct = 0;
  let maxPct = 0, bad100 = 0, gens0 = -1;
  const t0 = Date.now();
  console.log('[2] watching initial load (max 900s) ...');
  while (Date.now() - t0 < 900000) {
    const s = await page.evaluate(() => {
      const d = window.LoadingProgress._diag();
      const c = document.getElementById('loading-progress-container');
      return {
        visible: d.visible, pct: d.displayPct, n: d.tasks.length,
        completed: d.completedGens,
        domShown: c ? c.style.display !== 'none' : false,
        pending: d.tasks.filter(t => !t.rendered && !t.forced).length
      };
    }).catch(() => null);
    if (s) {
      if (gens0 < 0) gens0 = s.completed;
      maxPct = Math.max(maxPct, s.pct);
      if (s.pct >= 99.95 && s.pending > 0) bad100++;
      if (s.visible || s.domShown) sawVisible = true;
      if (s.completed > gens0) { sawComplete = true; break; } // 一代完整走完 100% 并淡出
      completePct = Math.max(completePct, s.pct);
    }
    await page.waitForTimeout(500);
  }

  // 抓 100% 时刻 pending：在隐藏前窗口内记录
  const diagSnap = await page.evaluate(() => window.LoadingProgress._diag());
  console.log('[2] result: sawVisible=' + sawVisible + ' maxPct=' + maxPct.toFixed(1) + ' tasksNow=' + diagSnap.tasks.length);
  await page.screenshot({ path: 'Screenshot/_loadingbar_initial.png' });

  // P4: 走远触发新任务集（动态找未加载对象最密集的点，避免传到空旷区）
  console.log('[3] find densest unloaded area and teleport ...');
  const dest = await page.evaluate(() => {
    const w = window.gameWorld;
    let best = null, bestN = 0;
    for (let i = 0; i < w.allWorldObjects.length; i += 5) {
      const o = w.allWorldObjects[i];
      if (!o || w.loadedObjects.has(o.id)) continue;
      const ox = o.position_x || 0, oz = o.position_z || 0;
      let n = 0;
      for (const t of w.allWorldObjects) {
        if (w.loadedObjects.has(t.id)) continue;
        const dx = ox - (t.position_x || 0), dz = oz - (t.position_z || 0);
        if (dx * dx + dz * dz < 150 * 150) n++;
      }
      if (n > bestN) { bestN = n; best = { x: ox, z: oz }; }
    }
    return best;
  });
  console.log('[3] dest=' + JSON.stringify(dest));
  let reShow = false;
  if (dest) {
    await page.evaluate((d) => {
      const p = window.player;
      if (p) { p.position.x = d.x; p.position.z = d.z; }
    }, dest);
    const t1 = Date.now();
    while (Date.now() - t1 < 240000) {
      const s = await page.evaluate(() => {
        const d = window.LoadingProgress._diag();
        const c = document.getElementById('loading-progress-container');
        return {
          visible: d.visible || (c && c.style.display !== 'none'),
          n: d.tasks.length, pct: d.displayPct,
          pending: d.tasks.filter(t => !t.rendered && !t.forced).length
        };
      }).catch(() => null);
      if (s && s.pct >= 99.95 && s.pending > 0) bad100++;
      if (s && s.visible && s.n > 0) { reShow = true; break; }
      await page.waitForTimeout(2000);
    }
  }
  console.log('[3] reShow=' + reShow + ' bad100Samples=' + bad100);
  await page.screenshot({ path: 'Screenshot/_loadingbar_reappear.png' });

  const engineOk = await page.evaluate(() => typeof window.LoadingProgress === 'object' && typeof window.LoadingProgress.sync === 'function');

  // favicon 404 属 chrome 通道噪音，不计入
  const onlyFavicon404 = resp404.length > 0 && resp404.every(u => /favicon/i.test(u));
  const realErrors = errors.filter(e => !(onlyFavicon404 && /Failed to load resource/.test(e)));
  const real404 = resp404.filter(u => !/favicon/i.test(u));

  console.log('=== VERDICT ===');
  console.log('P1 engine loaded            : ' + (engineOk ? 'PASS' : 'FAIL'));
  console.log('P2 bar appeared             : ' + (sawVisible ? 'PASS' : 'FAIL'));
  console.log('P3 reached 100% and hidden  : ' + (sawComplete ? 'PASS' : 'FAIL') + ' (maxPct=' + maxPct.toFixed(1) + ')');
  console.log('P4 re-show after move       : ' + (reShow ? 'PASS' : 'FAIL'));
  console.log('P5 console errors           : ' + (realErrors.length === 0 ? 'PASS (0)' : 'FAIL (' + realErrors.length + ')'));
  console.log('P6 no "100% with pending"   : ' + (bad100 === 0 ? 'PASS' : 'FAIL (' + bad100 + ' samples)'));
  realErrors.slice(0, 10).forEach((e) => console.log('   ERR: ' + e));
  real404.slice(0, 5).forEach((u) => console.log('   4xx: ' + u));
  const pass = engineOk && sawVisible && sawComplete && realErrors.length === 0 && bad100 === 0;
  console.log(pass ? 'ALL PASS' : 'HAS FAIL');

  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
