/**
 * TEMP diagnostic (delete after use). Read-only probe for "first-entry + immediate turn = freeze".
 * Reproduces: login -> enter world -> turn camera immediately -> record long frames
 * and correlate each freeze with renderer.info deltas
 *   programs jump   => shader compile stall
 *   calls jump      => draw-call burst / GPU first-use
 *   textures jump   => texture upload burst
 *   neither         => JS main-thread work (loading queue etc.)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3002';
const USER = 'diag_tmp_1';
const PASS = 'Diag#2026tmp';

function log(m) { console.log('[probe] ' + m); }

(async () => {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then(r => r.json());
  if (!login.token) throw new Error('login failed: ' + JSON.stringify(login).slice(0, 200));
  log('user login ok, characterId=' + login.characterId);

  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(async (e) => {
    log('chrome channel failed (' + e.message.slice(0, 80) + '), fallback chromium+swiftshader');
    return chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  });
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
        if (window.__frames.length > 20000) window.__frames.length = 0;
        window.__frames.push({ t: now, d });
        cb(t);
      });
    };
  });

  // set auth on origin, then reload into world
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
  const failedReq = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 150)));
  page.on('requestfailed', (r) => failedReq.push(r.url().slice(-110) + ' :: ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400) failedReq.push('HTTP' + r.status() + ' ' + r.url().slice(-110)); });

  log('entering world...');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // start sampler
  await page.evaluate(() => {
    window.__samples = [];
    window.__marks = {};
    window.__sampler = setInterval(() => {
      const gw = window.gameWorld;
      if (!gw || !gw.renderer) return;
      const i = gw.renderer.info;
      window.__samples.push({
        t: performance.now(),
        calls: i.render.calls, tris: i.render.triangles,
        programs: i.programs ? i.programs.length : -1,
        textures: i.memory.textures, geometries: i.memory.geometries,
        player: !!(window.player && window.player.position),
      });
    }, 250);
  });

  // wait for player, dismiss controls hint, then TURN IMMEDIATELY (the complaint scenario)
  await page.waitForFunction(() => window.player && window.player.position, null, { timeout: 120000 });
  await page.evaluate(() => {
    const btn = document.querySelector('.close-controls-hint');
    if (btn) btn.click();
  });
  await page.evaluate(() => {
    window.__marks.turnStart = performance.now();
    // fast drag-like rotation ~1.2 rad/s for 6s => >360deg
    window.__turnTimer = setInterval(() => {
      if (!window.MOUSE) return;
      window.MOUSE.targetRotationY -= 0.02;
    }, 16);
    setTimeout(() => {
      clearInterval(window.__turnTimer);
      window.__marks.turnEnd = performance.now();
    }, 6000);
  });
  log('turning started (immediately after player spawn)');

  // let loading finish and observe post-turn behavior
  await page.waitForTimeout(30000);
  const loadingState = await page.evaluate(() => {
    try {
      const gw = window.gameWorld;
      const d = window.LoadingProgress && window.LoadingProgress._diag ? window.LoadingProgress._diag() : null;
      return JSON.stringify({
        diag: d,
        generatedBuildings: gw && gw.generatedBuildings ? gw.generatedBuildings.size : -1,
        loadingQueue: gw && gw.loadingQueue ? gw.loadingQueue.length : -1,
        loadedObjects: gw && gw.loadedObjects ? gw.loadedObjects.size : -1,
        visibleCalls: gw && gw.renderer ? gw.renderer.info.render.calls : -1,
      });
    } catch (e) { return 'diag-err: ' + e.message; }
  });
  log('world state after 30s: ' + loadingState);

  // phase 2: turn again AFTER loading settled (control scenario: user says later turning is smooth)
  await page.evaluate(() => {
    window.__marks.turn2Start = performance.now();
    window.__turnTimer2 = setInterval(() => {
      if (!window.MOUSE) return;
      window.MOUSE.targetRotationY -= 0.02;
    }, 16);
    setTimeout(() => {
      clearInterval(window.__turnTimer2);
      window.__marks.turn2End = performance.now();
    }, 6000);
  });
  log('turn phase 2 started (after load settled)');
  await page.waitForTimeout(10000);

  const data = await page.evaluate(() => ({
    frames: window.__frames,
    samples: window.__samples,
    marks: window.__marks,
    t0: window.__frames.length ? window.__frames[0].t : 0,
  }));
  await browser.close();

  // ---- analyze ----
  const { frames, samples, marks, t0 } = data;
  const rel = (t) => Math.round(t - t0);
  const sAt = (t) => {
    // nearest samples around [t-1500, t]
    return samples.filter((s) => s.t >= t - 1500 && s.t <= t + 200);
  };

  log('turnStart rel=' + rel(marks.turnStart) + 'ms turnEnd rel=' + rel(marks.turnEnd) + 'ms');
  log('total frames captured: ' + frames.length);

  const long = frames.filter((f) => f.d > 200).sort((a, b) => b.d - a.d);
  log('long frames (>200ms): ' + long.length + '  | >500ms: ' + frames.filter((f) => f.d > 500).length + '  | >1000ms: ' + frames.filter((f) => f.d > 1000).length);

  function attribute(f) {
    const around = sAt(f.t);
    if (around.length < 2) return { tag: 'no-sample', dP: 0, dC: 0, dT: 0, dG: 0 };
    const a = around[0], b = around[around.length - 1];
    return {
      tag: '',
      dP: b.programs - a.programs,
      dC: Math.max(0, b.calls - a.calls),
      dT: b.textures - a.textures,
      dG: b.geometries - a.geometries,
    };
  }

  console.log('\n=== TOP 20 freezes ===');
  console.log('rel_ms    dur_ms   programsDelta  callsDelta  texturesDelta  geomDelta  attribution');
  for (const f of long.slice(0, 20)) {
    const a = attribute(f);
    let tag = 'JS/main-thread';
    if (a.dP > 0) tag = 'SHADER-COMPILE(programs+' + a.dP + ')';
    else if (a.dT > 3) tag = 'TEXTURE-UPLOAD(+' + a.dT + ')';
    else if (a.dC > 150) tag = 'DRAW-BURST(calls ' + a.dC + ')';
    const inTurn = f.t >= marks.turnStart && f.t <= marks.turnEnd;
    const inTurn2 = marks.turn2Start && f.t >= marks.turn2Start && f.t <= marks.turn2End;
    console.log(
      String(rel(f.t)).padStart(7) + ' ' + String(Math.round(f.d)).padStart(7) + '   ' +
      String(a.dP).padStart(6) + ' ' + String(a.dC).padStart(11) + ' ' + String(a.dT).padStart(8) + ' ' + String(a.dG).padStart(7) +
      '   ' + tag + (inTurn ? '  [DURING-TURN1]' : '') + (inTurn2 ? '  [DURING-TURN2]' : '')
    );
  }

  // freeze clusters: group long frames within 2s windows
  const clusters = [];
  for (const f of long) {
    const c = clusters[clusters.length - 1];
    if (c && f.t - c.end < 2000) { c.end = f.t; c.sum += f.d; c.n++; }
    else clusters.push({ start: f.t, end: f.t, sum: f.d, n: 1 });
  }
  console.log('\n=== freeze clusters (window 2s) ===');
  for (const c of clusters.slice(0, 12)) {
    const inTurn = !(c.end < marks.turnStart || c.start > marks.turnEnd);
    console.log('rel ' + rel(c.start) + '-' + rel(c.end) + 'ms  totalStall=' + Math.round(c.sum) + 'ms  n=' + c.n + (inTurn ? '  [TURN]' : ''));
  }

  // programs growth timeline
  console.log('\n=== programs/calls timeline (every ~2s) ===');
  let lastS = null;
  for (const s of samples) {
    if (lastS && s.t - lastS.t >= 2000) {
      console.log('rel ' + rel(s.t) + 'ms  programs=' + s.programs + ' (+' + (s.programs - lastS.programs) + ')  calls=' + s.calls + '  textures=' + s.textures + '  geoms=' + s.geometries);
      lastS = s;
    } else if (!lastS) lastS = s;
  }

  console.log('\nconsole errors (first 8): ' + errors.slice(0, 8).join(' | '));
  console.log('\nfailed/4xx requests (' + failedReq.length + '):');
  failedReq.slice(0, 12).forEach((u) => console.log('  ' + u));

  fs.writeFileSync(path.join(__dirname, '_tmp_turn_probe_data.json'), JSON.stringify(data, null, 1));
  log('raw data saved to scripts/_tmp_turn_probe_data.json');
})().catch((e) => { console.error('[probe] FATAL', e); process.exit(1); });
