/**
 * diag_longtask_profile.js —— 长任务采样切片（可复用）
 * 用法：node scripts/diag_longtask_profile.js [采样窗口毫秒，默认 40000]
 * 输出：每个 >300ms 长任务窗口内的 JS 热点函数（均匀时间映射切片）。
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3002';
const USER = 'diag_tmp_1';
const PASS = 'Diag#2026tmp';
function log(m) { console.log('[ltprof] ' + m); }

const SAMPLE_MS = parseInt(process.argv[2] || '40000', 10);

(async () => {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then(r => r.json());

  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() =>
    chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] }));
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__lt = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lt.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
      }).observe({ entryTypes: ['longtask'] });
    } catch (e) {}
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
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player, null, { timeout: 180000 });
  await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });
  await page.waitForTimeout(SAMPLE_MS);
  const prof = (await cdp.send('Profiler.stop')).profile;
  const lt = await page.evaluate(() => window.__lt);
  await browser.close();

  const byId = new Map();
  for (const n of prof.nodes) byId.set(n.id, n);
  const samples = prof.samples;
  const per = (prof.endTime - prof.startTime) / samples.length / 1000; // ms per sample
  log('samples=' + samples.length + ' span=' + ((prof.endTime - prof.startTime) / 1e6).toFixed(1) + 's perSample=' + per.toFixed(3) + 'ms');

  function topIn(winStart, winEnd, topN) {
    const agg = new Map();
    let n = 0;
    for (let i = 0; i < samples.length; i++) {
      const rel = i * per;
      if (rel < winStart || rel >= winEnd) continue;
      const node = byId.get(samples[i]);
      n++;
      if (!node) continue;
      const f = node.callFrame;
      const key = (f.functionName || '(anon)') + ' @' + String(f.url || '').split('/').pop() + ':' + (f.lineNumber + 1);
      agg.set(key, (agg.get(key) || 0) + 1);
    }
    log('  window [' + winStart + ',' + winEnd + '] sampled=' + n);
    for (const [k, v] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log('    ' + (100 * v / Math.max(1, n)).toFixed(0) + '%  ' + k);
    }
  }

  const tasks = lt.filter((e) => e.d > 300).sort((a, b) => b.d - a.d).slice(0, 4);
  if (!tasks.length) log('no long tasks >300ms');
  for (const e of tasks) {
    log('LONG ' + e.d + 'ms @t=' + e.t);
    topIn(e.t, e.t + e.d + 50, 12);
  }
})().catch((e) => { console.error('[ltprof] FATAL', e); process.exit(1); });
