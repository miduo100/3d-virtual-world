/**
 * 验收：placeholderField 预热批编译（2026-09-09）
 * ------------------------------------------------------------------
 * 背景：world_objects id=8392（model-1788498327710-939035107_dec.glb）
 *   8.2MB / 2784 mesh / 100 材质。旧 reveal 实现"每帧只编译 1 个 mesh"
 *   → 2784 帧 ≈ 40~50 秒才显现（用户实测体感）。
 *
 * 判据：
 *   R1 该模型进入 reveal（mesh 数 >= 1000）
 *   R2 reveal 耗时 < 20s（headless 软渲染放宽；真机应 < 5s）
 *   R3 模型最终 visible=true 且在场景中
 *   R4 预热期间无 >3000ms 的极端长帧（批编译没有把新程序挤进单帧）
 *   R5 非噪音 console error = 0
 *   R6 输出"旧算法（每帧 1 mesh）预估耗时"作为对照
 *
 * 用法：node scripts/accept_reveal_batch.js
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3002';
const USER = 'diag_tmp_1';
const PASS = 'Diag#2026tmp';
const TARGET = { x: -401.95, y: 6, z: 545 };   // 8392 位于 (-401.95, -1.98, 522.76)
const MESH_THRESHOLD = 1000;
const MS_LIMIT = 20000;

function log(m) { console.log('[reveal] ' + m); }

(async () => {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then(r => r.json());
  if (!login.token) throw new Error('login failed: ' + JSON.stringify(login));

  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() =>
    chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] }));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__frames = [];
    window.__lastFrameAt = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return orig(function (t) {
        const now = performance.now();
        const d = now - window.__lastFrameAt;
        window.__lastFrameAt = now;
        if (window.__frames.length > 60000) window.__frames.length = 0;
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
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // 404 类资源错误的文本里没有 URL，必须按 m.location().url 判来源
    const url = (m.location && m.location().url) || '';
    errors.push({ text: m.text().slice(0, 200), url });
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player && window.PlaceholderField, null, { timeout: 180000 });
  log('world ready');

  // 注入 reveal 探针
  await page.evaluate(() => {
    window.__revealLog = [];
    const PF = window.PlaceholderField;
    const orig = PF.reveal;
    PF.reveal = function (obj, r, c, s, cb) {
      let meshes = 0;
      obj.traverse(o => { if (o.isMesh) meshes++; });
      const rec = { meshes, t0: performance.now(), ms: null, wid: null };
      window.__revealLog.push(rec);
      return orig.call(PF, obj, r, c, s, function (o) {
        rec.ms = Math.round(performance.now() - rec.t0);
        rec.wid = (obj.userData && obj.userData.worldObjectId) || null;
        return cb && cb(o);
      });
    };
  });

  // 瞬移到 8392 附近
  await page.evaluate((t) => {
    window.__frames.length = 0;
    window.player.position.set(t.x, t.y, t.z);
  }, TARGET);
  log('teleported to 8392 area');

  // 等目标模型完成 reveal
  const got = await page.waitForFunction((th) => {
    const hit = (window.__revealLog || []).filter(r => r.meshes >= th && r.ms !== null);
    return hit.length ? hit[0] : null;
  }, MESH_THRESHOLD, { timeout: 240000 }).then(h => h.jsonValue()).catch(() => null);

  const extra = await page.evaluate(() => {
    const g = window.gameWorld;
    let found = null;
    g.generatedBuildings.forEach((b, id) => {
      if (b && b.model) {
        let n = 0; b.model.traverse(o => { if (o.isMesh) n++; });
        if (n >= 1000) found = { id, meshes: n, visible: b.model.visible, inScene: !!b.model.parent };
      }
    });
    const ds = (window.__frames || []).map(f => f.d).filter(d => d > 0).sort((a, b) => a - b);
    const med = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
    return {
      found,
      frameMedian: Math.round(med),
      frameWorst: Math.round(ds.length ? ds[ds.length - 1] : 0),
      frameCount: ds.length,
      dbg: window.PlaceholderField._debug(),
      programs: g.renderer.info.programs ? g.renderer.info.programs.length : -1
    };
  });

  log('reveal record: ' + JSON.stringify(got));
  log('scene state : ' + JSON.stringify(extra));

  const results = [];
  const push = (id, ok, detail) => { results.push({ id, ok, detail }); log((ok ? 'PASS' : 'FAIL') + ' ' + id + ' :: ' + detail); };

  push('R1 目标模型进入 reveal', !!got, got ? ('mesh=' + got.meshes) : '未捕获到 mesh>=1000 的 reveal');
  const ms = got ? got.ms : Infinity;
  push('R2 reveal 耗时 < ' + MS_LIMIT + 'ms', ms < MS_LIMIT, 'ms=' + ms);
  push('R3 模型最终可见', !!(extra.found && extra.found.visible && extra.found.inScene), JSON.stringify(extra.found));
  push('R4 无 >3000ms 极端长帧', extra.frameWorst < 3000, 'worst=' + extra.frameWorst + 'ms median=' + extra.frameMedian + 'ms');
  const noise = errors.filter(e => !/runtime\.lastError|index\.global\.js/i.test(e.text) && !/favicon/i.test(e.url));
  push('R5 console error = 0', noise.length === 0, noise.slice(0, 3).map(e => e.text + ' @ ' + e.url).join(' | ') || 'none');
  if (got) {
    const est = Math.round(got.meshes * (extra.frameMedian || 16) / 1000);
    push('R6 旧算法预估对照', true, '旧（每帧1 mesh）≈ ' + est + 's vs 新 ' + Math.round(ms / 1000) + 's');
  }

  await page.screenshot({ path: 'Screenshot/accept_reveal_batch.png' }).catch(() => {});
  await browser.close();

  const fail = results.filter(r => !r.ok);
  console.log('\n==== ' + (results.length - fail.length) + '/' + results.length + ' PASS ====');
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
