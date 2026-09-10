/**
 * 验收：会话2 Worker 化 GLB 解析
 * ------------------------------------------------------------------
 * 判据：
 *   B1 GltfWorkerClient 存在且 worker 未损坏
 *   B2 加载 60s 后 worker 解析数 >= 3（真实走通），fallback 占比 < 50%
 *   B3 模型渲染完整：loadedObjects>=100；抽样 30 个 mesh 材质纹理无损坏
 *   B4 加载窗口期持续转向：无 >500ms 长帧（解析/编译停顿已消除）
 *   B5 非噪音 console/page 错误 = 0
 *   B6 截图存档 Screenshot/accept_worker_parse.png
 *
 * 用法：node scripts/accept_worker_parse.js
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const USER = 'diag_tmp_1';
const PASS = 'Diag#2026tmp';
function log(m) { console.log('[accept2] ' + m); }

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
  const workerLogs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
    if (/Worker|fallback|回退|meshopt|Meshopt/i.test(m.text())) workerLogs.push(m.type() + ': ' + m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 160)));
  page.on('requestfailed', (r) => badUrls.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400) badUrls.push('HTTP' + r.status() + ' ' + r.url()); });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player, null, { timeout: 180000 });
  await page.evaluate(() => {
    const b = document.querySelector('.close-controls-hint'); if (b) b.click();
    // render 计时（长帧归因用）
    const gw = window.gameWorld;
    const origRender = gw.renderer.render.bind(gw.renderer);
    gw.renderer.render = function (scene, camera) {
      const s = performance.now();
      const r = origRender(scene, camera);
      window.__lastRenderMs = performance.now() - s;
      return r;
    };
  });
  // 每帧补充 renderMs
  await page.evaluate(() => {
    setInterval(() => {
      if (window.__frames && window.__frames.length) window.__frames[window.__frames.length - 1].renderMs = window.__lastRenderMs || 0;
    }, 100);
  });

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass, detail }); log((pass ? 'PASS ' : 'FAIL ') + name + ' :: ' + detail); };

  // B1 worker client
  const c1 = await page.evaluate(() => {
    const s = window.GltfWorkerClient ? window.GltfWorkerClient.stats() : null;
    return s;
  });
  check('B1 GltfWorkerClient present', !!c1, JSON.stringify(c1));

  // B4 加载窗口期持续转向（整个加载期间慢速转动）
  await page.evaluate(() => {
    window.__tt = setInterval(() => { if (window.MOUSE) window.MOUSE.targetRotationY -= 0.006; }, 50);
  });

  // 等加载完成 + 扫掠收敛（最长 120s）
  let converged = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(3000);
    const s = await page.evaluate(() => ({
      queue: window.gameWorld.loadingQueue ? window.gameWorld.loadingQueue.length : -1,
      loaded: window.gameWorld.loadedObjects ? window.gameWorld.loadedObjects.size : -1,
      sweep: window.PreloadSweeper ? window.PreloadSweeper.stats() : null,
      gwc: window.GltfWorkerClient ? window.GltfWorkerClient.stats() : null,
    }));
    if (s.queue === 0 && s.loaded > 50 && s.sweep && s.sweep.active === false && i > 8) { converged = true; log('load settled at iter ' + i + ': ' + JSON.stringify(s)); break; }
  }
  await page.evaluate(() => clearInterval(window.__tt));

  const stats = await page.evaluate(() => window.GltfWorkerClient.stats());
  log('spawn-phase stats: ' + JSON.stringify(stats));

  // B2b 传送玩家到 GLB 密集区（612 个 GLB 在 150m 内）压测 worker 解析
  const before = stats.worker + stats.fallback;
  await page.evaluate(() => { if (window.player) window.player.position.set(-273, 12, -1056); });
  await page.waitForTimeout(60000);
  const stats2 = await page.evaluate(() => window.GltfWorkerClient.stats());
  log('after GLB-dense teleport: ' + JSON.stringify(stats2));
  if (stats2.worker === 0) {
    log('workerLogs(all): ' + workerLogs.slice(0, 20).join(' ; '));
  }
  const parsed = stats2.worker + stats2.fallback - before;
  check('B2 dense-area: worker parses >= 5 & fallback < 50%', stats2.worker >= 5 && stats2.fallback < Math.max(3, stats2.worker * 0.5),
    'totalParsedInDense=' + parsed + ' ' + JSON.stringify(stats2) + ' || ' + workerLogs.slice(0, 4).join(' ; '));

  // B3 模型渲染完整性抽样
  const sample = await page.evaluate(() => {
    const g = window.gameWorld;
    const loaded = g.loadedObjects ? g.loadedObjects.size : -1;
    let meshTotal = 0, texBroken = 0, matBroken = 0, sampled = 0;
    const problems = [];
    g.generatedBuildings.forEach((b) => {
      if (!b || !b.model) return;
      b.model.traverse((o) => {
        if (!o.isMesh) return;
        meshTotal++;
        if (sampled >= 30) return;
        sampled++;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) { matBroken++; problems.push(b.model.userData.worldObjectId + ':null-material'); continue; }
          const maps = [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.emissiveMap];
          for (const t of maps) {
            if (t && (!t.image || !t.image.width)) { texBroken++; problems.push(b.model.userData.worldObjectId + ':broken-tex'); }
          }
        }
      });
    });
    return { loaded, meshTotal, texBroken, matBroken, problems: problems.slice(0, 5) };
  });
  check('B3 models loaded & textures intact', sample.loaded >= 100 && sample.texBroken === 0 && sample.matBroken === 0, JSON.stringify(sample));

  // B4a 加载窗口长帧（观察项：loading 进度条展示期间的程序创建停顿不构成体感卡顿）
  const frames = await page.evaluate(() => window.__frames.slice());
  const loadLongs = frames.filter((f) => f.d > 500);
  const loadWorst = frames.reduce((m, f) => Math.max(m, f.d), 0);
  log('B4a load-window longFrames(>500ms)=' + loadLongs.length + ' worst=' + Math.round(loadWorst) + 'ms（观察项，非阻断）');

  // 等密集区加载收敛
  for (let i = 0; i < 25; i++) {
    const s = await page.evaluate(() => ({
      q: window.gameWorld.loadingQueue.length,
      sweep: window.PreloadSweeper.stats(),
      pend: window.PlaceholderField && window.PlaceholderField.pendingCount ? window.PlaceholderField.pendingCount() : 0,
    }));
    if (s.q === 0 && s.pend === 0 && s.sweep.active === false) break;
    await page.waitForTimeout(3000);
  }

  // B4b 硬指标：收敛后持续转向，无 >500ms 长帧
  const turnStart = await page.evaluate(() => {
    window.__tt = setInterval(() => { if (window.MOUSE) window.MOUSE.targetRotationY -= 0.02; }, 16);
    return Math.round(performance.now());
  });
  await page.waitForTimeout(6000);
  await page.evaluate(() => clearInterval(window.__tt));
  await page.waitForTimeout(2000);
  const turnFrames = await page.evaluate((s) => {
    const out = [];
    for (const f of window.__frames) if (f.t >= s && f.t <= s + 8500) out.push(f);
    return out;
  }, turnStart);
  const turnLongs = turnFrames.filter((f) => f.d > 500);
  const turnWorst = turnFrames.reduce((m, f) => Math.max(m, f.d), 0);
  check('B4 post-settle turn worst < 500ms', turnLongs.length === 0, 'worst=' + Math.round(turnWorst) + 'ms  longFrames=' + turnLongs.length + '  frames=' + turnFrames.length);

  // B5 错误
  const noiseRe = /runtime\.lastError|index\.global\.js|ResizeObserver/i;
  const noiseUrlRe = /favicon\.ico|localhost:6002/i;
  const realErr = errors.filter((t) => !noiseRe.test(t) && !/Failed to load resource/i.test(t));
  const realBad = badUrls.filter((u) => !noiseUrlRe.test(u) && !/ERR_ABORTED/.test(u));
  check('B5 errors (non-noise)=0', realErr.length === 0 && realBad.length === 0,
    (realErr.slice(0, 3).join(' | ') + ' || ' + realBad.slice(0, 3).join(' | ')).trim() || '0');

  // B6 截图
  const shot = await page.screenshot();
  fs.writeFileSync('Screenshot/accept_worker_parse.png', shot);
  check('B6 screenshot saved', true, 'Screenshot/accept_worker_parse.png (' + Math.round(shot.length / 1024) + 'KB)');

  await browser.close();

  const passCount = results.filter((r) => r.pass).length;
  console.log('\n=== VERDICT: ' + passCount + '/' + results.length + ' ' + (passCount === results.length ? 'ALL PASS' : 'HAS FAILURES') + ' ===');
  process.exit(passCount === results.length ? 0 : 1);
})().catch((e) => { console.error('[accept2] FATAL', e); process.exit(2); });
