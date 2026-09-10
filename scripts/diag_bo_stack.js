/**
 * diag_bo_stack.js —— Bo(WebGLUniforms) 采样调用栈回溯（可复用）
 * 用法：node scripts/diag_bo_stack.js [窗口毫秒，默认 40000]
 * 输出：Bo 采样最频繁的调用路径（父链向上 6 级）。
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3002';
const USER = 'diag_tmp_1';
const PASS = 'Diag#2026tmp';
function log(m) { console.log('[bostk] ' + m); }

const SAMPLE_MS = parseInt(process.argv[2] || '40000', 10);
const FN = process.argv[3] || 'Bo';

(async () => {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then(r => r.json());

  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() =>
    chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] }));
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
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
  await browser.close();

  const byId = new Map();
  const parentOf = new Map();
  for (const n of prof.nodes) {
    byId.set(n.id, n);
    (n.children || []).forEach((c) => parentOf.set(c, n.id));
  }
  const per = (prof.endTime - prof.startTime) / prof.samples.length / 1000;

  // count Bo self samples & collect their sample times
  const boSamples = [];
  for (let i = 0; i < prof.samples.length; i++) {
    const node = byId.get(prof.samples[i]);
    if (!node) continue;
    if (node.callFrame.functionName === FN) boSamples.push(i * per);
  }
  log(FN + ' samples=' + boSamples.length + '  totalMs≈' + Math.round(boSamples.length * per));
  if (!boSamples.length) return;
  boSamples.sort((a, b) => a - b);

  // cluster Bo samples into time clusters (>300ms gap = new cluster)
  const clusters = [];
  for (const t of boSamples) {
    const c = clusters[clusters.length - 1];
    if (c && t - c.end < 300) { c.end = t; c.n++; }
    else clusters.push({ start: t, end: t, n: 1 });
  }
  clusters.sort((a, b) => b.n - a.n);
  log('Bo clusters (top5):');
  for (const c of clusters.slice(0, 5)) {
    console.log('  t=' + Math.round(c.start) + '-' + Math.round(c.end) + 'ms  BoMs≈' + Math.round(c.n * per));
  }

  // take the biggest cluster midpoint, print call paths of samples inside
  const top = clusters[0];
  const mid = (top.start + top.end) / 2;
  const paths = new Map();
  for (let i = 0; i < prof.samples.length; i++) {
    const t = i * per;
    if (t < top.start || t > top.end) continue;
    const node = byId.get(prof.samples[i]);
    if (!node || node.callFrame.functionName !== FN) continue;
    // walk up parents
    const chain = [];
    let cur = node.id;
    let hops = 0;
    while (cur != null && hops < 8) {
      const pn = byId.get(cur);
      if (!pn) break;
      const f = pn.callFrame;
      chain.push((f.functionName || '(anon)') + '@' + String(f.url || '').split('/').pop() + ':' + (f.lineNumber + 1));
      cur = parentOf.get(cur);
      hops++;
    }
    const key = chain.join(' ← ');
    paths.set(key, (paths.get(key) || 0) + 1);
  }
  console.log('\n=== Bo call paths in biggest cluster ===');
  for (const [k, v] of [...paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log('  x' + v + '  ' + k);
  }
})().catch((e) => { console.error('[bostk] FATAL', e); process.exit(1); });
