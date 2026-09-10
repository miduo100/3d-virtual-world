/**
 * diag_first_entry.js —— 出生点首进诊断（可复用）
 * ------------------------------------------------------------------
 * 输出：
 *   1. 帧间隔分布（含 >500ms/>300ms 长帧及其 rAF 回调源码片段）
 *   2. PrewarmGate 状态（预编译材质数/门开关）
 *   3. CompileBudget 慢编译明细（>50ms 的 compileAsync，含 mesh 名/材质数/耗时）
 *   4. 程序总数
 * 用法：node scripts/diag_first_entry.js [采样毫秒，默认 45000]
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3002';
const USER = 'diag_tmp_1';
const PASS = 'Diag#2026tmp';
function log(m) { console.log('[diagfe] ' + m); }

const SAMPLE_MS = parseInt(process.argv[2] || '45000', 10);

(async () => {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then(r => r.json());
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() =>
    chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] }));
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__frames = [];
    window.__lastFrameAt = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      const src = String(cb).slice(0, 100).replace(/\s+/g, ' ');
      return orig(function (t) {
        const start = performance.now();
        const gap = start - window.__lastFrameAt;
        cb(t);
        const cbMs = performance.now() - start;
        const now = performance.now();
        window.__lastFrameAt = now;
        if (window.__frames.length > 30000) window.__frames.length = 0;
        window.__frames.push({ t: now, d: gap, cbMs: Math.round(cbMs), src: src });
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
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(SAMPLE_MS);
  const res = await page.evaluate(() => ({
    frames: window.__frames,
    gate: window.PrewarmGate ? window.PrewarmGate.stats() : null,
    slow: window.__slowCompiles || [],
    budget: window.CompileBudget ? window.CompileBudget.pending() : -1,
    programs: window.gameWorld.renderer.info.programs.length,
  }));
  await browser.close();

  const frames = res.frames;
  const byCb = frames.filter((f) => f.cbMs > 200).sort((a, b) => b.cbMs - a.cbMs);
  const byGap = frames.filter((f) => f.d > 300).sort((a, b) => b.d - a.d);
  log('gate: ' + JSON.stringify(res.gate) + '  budgetPending=' + res.budget + '  programs=' + res.programs);
  log('frames=' + frames.length + '  worst-callback=' + (byCb[0] ? byCb[0].cbMs + 'ms' : '0') + '  worst-gap=' + (byGap[0] ? byGap[0].d + 'ms' : '0'));
  log('frames >500ms(gap)=' + byGap.length + '  callbacks >200ms=' + byCb.length);
  console.log('\n=== slow callbacks (cbMs>200, top10) ===');
  byCb.slice(0, 10).forEach((f) => console.log('  ' + f.cbMs + 'ms @t=' + Math.round(f.t) + '  src: ' + f.src));
  console.log('\n=== slow compiles (compileAsync >50ms) n=' + res.slow.length + ' ===');
  res.slow.sort((a, b) => b.ms - a.ms).slice(0, 15).forEach((c) => console.log('  ' + c.ms + 'ms  mats=' + c.mats + '  ' + c.name));
  const sum = res.slow.reduce((s, c) => s + c.ms, 0);
  console.log('  total slow-compile time=' + sum + 'ms  count=' + res.slow.length);
})().catch((e) => { console.error('[diagfe] FATAL', e); process.exit(1); });
