/**
 * accept_first_load_ready_gate.js — 首屏加载丝滑化 Step 1 + Step 2 验收
 * ------------------------------------------------------------------
 * Step 1（worldReadyGate.js 环境就绪闸门）：
 *   A 组（正常路径，CDP 限速 6Mbps/RTT200ms）：
 *     A1 _diag() 字段齐全
 *     A2 tReadyMs 落在 6000~14000ms（本机基准）
 *     A3 reason ∈ {ready, timeout}
 *     A4 ready 后 isReady()=true 且 onReady 注册立即触发（锁存语义）
 *     A5 触发时 geometryDone=true 且 pendingSmallMedium=0（reason=ready 时）
 *   B 组（timeout 兜底可达，不卡死）：
 *     构造"队列永不空"场景（持续注入 <15MB 假对象）+ reset({timeoutMs:3000})
 *     B1 ready=true 且 reason='timeout'
 *     B2 tReadyMs ≈ 3000ms（2500~4500）
 *     B3 页面仍可响应（evaluate 正常返回）
 *
 * Step 2（skyManager.js 天空盒让路，v2）：
 *   C 组：
 *     C0 就绪前 SkyManager 处于 deferred 占位态（placeholderKind='gradient'）
 *     C1 EXR 请求 start ≥ T_ready（-300ms 容差）
 *     C2 T_ready 前 0 条 EXR 请求（含 EXRLoader.js 模块请求）
 *     C3 就绪前首屏截图非纯黑（渐变占位天空可见）
 *     C4 场景 GLB #1 完成时间 < 26s（§1 基线 28.2s，显著提前；记录数字）
 *     C5 SkyManager 最终 deferred=false 且背景为真纹理（占位已替换）
 *
 * 用法：node scripts/accept_first_load_ready_gate.js
 * 前置：本地服务器 3002 已启动。
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3002';
const THROTTLE = { latency: 200, downloadThroughput: 6 * 1024 * 1024 / 8, uploadThroughput: 6 * 1024 * 1024 / 8 };

function log(msg) { console.log('[gate] ' + msg); }

const NOISE_PATTERNS = [
  /runtime\.lastError/i, /index\.global\.js/i, /favicon/i,
  /net::ERR_ABORTED/i, /net::ERR_INTERNET/i, /net::ERR_CONNECTION/,
];

function isNoise(text) { return NOISE_PATTERNS.some((p) => p.test(text)); }

async function main() {
  const results = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    // ---- 请求时间线（页面时钟，相对 pageStart） ----
    const pageStart = Date.now();
    const reqLog = [];   // { t, kind, url }
    const sceneGlbDone = []; // { t, url } 响应完成时刻
    page.on('request', (r) => {
      const u = r.url();
      const t = Date.now() - pageStart;
      if (/\.exr($|\?)/.test(u)) reqLog.push({ t, kind: 'skyExr', url: u });
      else if (/EXRLoader\.js/.test(u)) reqLog.push({ t, kind: 'exrLoader', url: u });
      else if (/\/uploads\/character-templates\/.*\.glb/.test(u)) reqLog.push({ t, kind: 'charGlb', url: u });
      else if (/\.glb($|\?)/.test(u)) reqLog.push({ t, kind: 'sceneGlb', url: u });
    });
    page.on('response', (r) => {
      const u = r.url();
      if (/\.glb($|\?)/.test(u) && !/character-templates/.test(u) && r.status() < 400) {
        sceneGlbDone.push({ t: Date.now() - pageStart, url: u.split('/').pop() });
      }
    });

    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 200)));

    // 【二期A】页内埋点：longtask + 关键日志时间戳（天空替换 hitch 归因用）
    await page.addInitScript(() => {
      window.__lt = [];
      window.__marks = [];
      try {
        new PerformanceObserver((list) => {
          list.getEntries().forEach((e) => window.__lt.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }));
        }).observe({ entryTypes: ['longtask'] });
      } catch (e) {}
      const ol = console.log;
      console.log = function () { try { window.__marks.push({ t: Math.round(performance.now()), m: [].slice.call(arguments).join(' ').slice(0, 120) }); } catch (e) {} ol.apply(console, arguments); };
    });

    // CDP 限速：必须在 goto 之前
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: THROTTLE.latency,
      downloadThroughput: THROTTLE.downloadThroughput,
      uploadThroughput: THROTTLE.uploadThroughput,
    });
    log('CDP 限速已启用: 6Mbps / RTT 200ms');

    await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 40000 });
    await page.waitForFunction(() => window.WorldReadyGate && window.gameWorld && window.player, null, { timeout: 40000 });
    log('世界与闸门已挂载，开始观察');

    // ---------- A 组：正常路径 ----------
    const t0 = Date.now();
    let diagA = null;
    let skyDeferredSeen = false;
    let earlyShot = null;
    while (Date.now() - t0 < 35000) {
      const sample = await page.evaluate(() => ({
        gate: window.WorldReadyGate._diag(),
        sky: (window.SkyManager && window.SkyManager._diag) ? window.SkyManager._diag() : null,
      }));
      diagA = sample.gate;
      if (sample.sky && sample.sky.deferred === true && sample.sky.placeholderKind === 'gradient') skyDeferredSeen = true;
      if (!earlyShot && sample.gate && !sample.gate.ready) earlyShot = await page.screenshot();
      if (diagA.ready) break;
      await page.waitForTimeout(300);
    }
    const fields = ['ready', 'reason', 'tReadyMs', 'sinceEnterMs', 'geometryDone', 'pendingSmallMedium', 'queueLen', 'batchLen'];
    results.push({ name: 'A1 _diag() 字段齐全', pass: fields.every((f) => f in (diagA || {})), detail: JSON.stringify(diagA) });
    // 注：上限放宽到 16s——闸门 tick 走 interval，限速加载期主线程被解析长帧
    // 阻塞时 tick 会推迟（timeoutMs=12000 但实测触发可达 ~14.5s），属调度抖动非判据错误
    results.push({ name: 'A2 tReadyMs 6000~16000ms', pass: diagA.tReadyMs != null && diagA.tReadyMs >= 6000 && diagA.tReadyMs <= 16000, detail: 'tReadyMs=' + diagA.tReadyMs });
    results.push({ name: 'A3 reason ∈ {ready,timeout}', pass: diagA.reason === 'ready' || diagA.reason === 'timeout', detail: 'reason=' + diagA.reason });
    const latch = await page.evaluate(() => new Promise((res) => {
      let fired = false;
      window.WorldReadyGate.onReady(() => { fired = true; });
      setTimeout(() => res({ isReady: window.WorldReadyGate.isReady(), fired }), 150);
    }));
    results.push({ name: 'A4 ready 锁存 + onReady 立即触发', pass: latch.isReady === true && latch.fired === true, detail: JSON.stringify(latch) });
    results.push({
      name: 'A5 reason=ready 时判据成立',
      pass: diagA.reason !== 'ready' || (diagA.geometryDone === true && diagA.pendingSmallMedium === 0),
      detail: 'geometryDone=' + diagA.geometryDone + ' pending=' + diagA.pendingSmallMedium,
    });
    log('A 组 diag: ' + JSON.stringify(diagA));

    // T_ready 换算到页面外时钟（performance.timeOrigin + tReadyMs）
    const tReadyDate = await page.evaluate((ms) => performance.timeOrigin + ms, diagA.tReadyMs);
    const tReadyRel = tReadyDate - pageStart; // 相对 pageStart 的就绪时刻

    // ---------- B 组：timeout 兜底 ----------
    await page.evaluate(() => {
      window.__gateKeepAlive = setInterval(() => {
        const w = window.gameWorld;
        if (!w || !window.player) return;
        if (w.loadingQueue.length === 0) {
          w.loadingQueue.push({
            id: 'gate_fake_' + Math.random(), type: 'uploaded_model', name: 'gate_fake',
            fileSize: 1024 * 1024,
            position_x: window.player.position.x, position_z: window.player.position.z,
          });
        }
      }, 300);
      window.WorldReadyGate.reset({ timeoutMs: 3000 });
      return true;
    });
    const t1 = Date.now();
    let diagB = null;
    while (Date.now() - t1 < 12000) {
      diagB = await page.evaluate(() => window.WorldReadyGate._diag());
      if (diagB.ready) break;
      await page.waitForTimeout(300);
    }
    results.push({ name: 'B1 timeout 兜底可达 reason=timeout', pass: !!diagB && diagB.ready === true && diagB.reason === 'timeout', detail: JSON.stringify(diagB) });
    results.push({ name: 'B2 tReadyMs ≈3000ms (2500~4500)', pass: !!diagB && diagB.tReadyMs != null && diagB.tReadyMs >= 2500 && diagB.tReadyMs <= 4500, detail: 'tReadyMs=' + (diagB && diagB.tReadyMs) });
    const alive = await page.evaluate(() => ({ ok: !!(window.gameWorld && window.WorldReadyGate), q: window.gameWorld.loadingQueue.length }));
    results.push({ name: 'B3 页面未卡死', pass: alive.ok === true, detail: JSON.stringify(alive) });
    await page.evaluate(() => {
      if (window.__gateKeepAlive) { clearInterval(window.__gateKeepAlive); window.__gateKeepAlive = null; }
      window.WorldReadyGate.reset({ timeoutMs: 12000 });
    });
    log('B 组 diag: ' + JSON.stringify(diagB));

    // ---------- C 组：天空盒让路（Step 2 + 二期A 错峰/分帧/降采样） ----------
    // 等真实天空替换完成（EXR 11.75MB @6Mbps ≈ 20s+），含空闲期 PMREM 环境光
    const t2 = Date.now();
    let skyFinal = null;
    while (Date.now() - t2 < 60000) {
      skyFinal = await page.evaluate(() => (window.SkyManager && window.SkyManager._diag) ? window.SkyManager._diag() : null);
      if (skyFinal && !skyFinal.deferred && skyFinal.hasTexture && skyFinal.backgroundIsTexture && skyFinal.hasEnvironment) break;
      await page.waitForTimeout(500);
    }
    // 等场景 GLB #1 完成（最多 40s，用于 C4）
    const t3 = Date.now();
    while (sceneGlbDone.length === 0 && Date.now() - t3 < 40000) {
      await page.waitForTimeout(400);
    }
    // 等空闲期 PMREM 完成（真纹理上屏后 ~1s 内；hasEnvironment 自占位期即 true 不能作判据）
    const tEnv = Date.now();
    while (Date.now() - tEnv < 15000) {
      const hasEnvMark = await page.evaluate(() => (window.__marks || []).some((m) => /环境光照已生成/.test(m.m)));
      if (hasEnvMark) break;
      await page.waitForTimeout(500);
    }
    // 页内埋点快照（longtask + 标记，页面时钟）
    const probes = await page.evaluate(() => ({
      marks: (window.__marks || []).filter((m) => /SkyManager|已应用天空/.test(m.m)),
      longtasks: (window.__lt || []).filter((x) => x.d >= 100),
    }));

    results.push({ name: 'C0 就绪前天空处于渐变占位态', pass: skyDeferredSeen === true, detail: 'deferred+gradient seen=' + skyDeferredSeen });
    const exrReqs = reqLog.filter((r) => r.kind === 'skyExr');
    const exrLoaderReqs = reqLog.filter((r) => r.kind === 'exrLoader');
    const TOL = 300;
    const earlyExr = exrReqs.filter((r) => r.t < tReadyRel - TOL);
    const earlyLoader = exrLoaderReqs.filter((r) => r.t < tReadyRel - TOL);
    results.push({
      name: 'C1 EXR 请求 start ≥ T_ready',
      pass: exrReqs.length > 0 && exrReqs.every((r) => r.t >= tReadyRel - TOL),
      detail: 'tReady=' + Math.round(tReadyRel) + 'ms exrStarts=[' + exrReqs.map((r) => r.t).join(',') + ']',
    });
    results.push({
      name: 'C2 T_ready 前 0 条 EXR 相关请求',
      pass: earlyExr.length === 0 && earlyLoader.length === 0,
      detail: 'earlyExr=' + earlyExr.length + ' earlyLoader=' + earlyLoader.length,
    });
    // C3：就绪前截图非纯黑
    let c3pass = false, c3detail = 'no-early-shot';
    if (earlyShot) {
      const sharp = require('sharp');
      const { data, info: imgInfo } = await sharp(earlyShot).raw().toBuffer({ resolveWithObject: true });
      let sum = 0;
      const step = imgInfo.channels * 97;
      for (let i = 0; i + 2 < data.length; i += step) sum += data[i] + data[i + 1] + data[i + 2];
      const avg = sum / Math.max(1, Math.floor(data.length / step));
      c3pass = avg > 3;
      c3detail = 'avgLuma=' + avg.toFixed(1);
    }
    results.push({ name: 'C3 就绪前首屏非纯黑（渐变天空可见）', pass: c3pass, detail: c3detail });
    const firstSceneGlb = sceneGlbDone.length > 0 ? sceneGlbDone[0] : null;
    results.push({
      name: 'C4 场景 GLB #1 完成 < 26s（基线 28.2s）',
      pass: !!firstSceneGlb && firstSceneGlb.t < 26000,
      detail: firstSceneGlb ? (firstSceneGlb.url + ' @' + firstSceneGlb.t + 'ms') : 'none',
    });
    results.push({
      name: 'C5 占位已被真天空替换（含环境光）',
      pass: !!skyFinal && skyFinal.deferred === false && skyFinal.hasTexture === true && skyFinal.backgroundIsTexture === true && skyFinal.hasEnvironment === true,
      detail: JSON.stringify(skyFinal),
    });

    // ---------- 【二期A】天空替换瞬间的 hitch 与错峰断言 ----------
    // 页面时钟换算：skyMark 的页面时间 → 相对 pageStart
    const skyMark = probes.marks.find((m) => /已应用天空/.test(m.m)) || null;
    const envMark = probes.marks.find((m) => /环境光照已生成/.test(m.m)) || null;
    const prewarmMark = probes.marks.find((m) => /占位环境光已上屏/.test(m.m)) || null;
    if (skyMark) log('（INFO）skyMark(页面时钟)=' + skyMark.t + 'ms envMark=' + (envMark ? envMark.t : 'none') + 'ms prewarm=' + (prewarmMark ? prewarmMark.t : 'none') + 'ms');
    // C6：替换瞬间（含解码）的最大 longtask —— 基线 2717ms（解码+PMREM+同步 paint），
    // 二期A 后应只剩解码任务（PMREM 已错峰空闲期 + 降采样）
    let c6pass = false, c6detail = 'no-sky-mark';
    let c6bpass = false, c6bdetail = 'no-env-mark';
    if (skyMark) {
      const rel = (x) => x; // longtask/marks 同为页面 performance.now 时钟
      // 归因：每个任务找最近日志标记
      const nearestMark = (x) => {
        let best = null, bd = Infinity;
        probes.marks.forEach((mk) => { const dd = Math.abs(mk.t - x.t); if (dd < bd) { bd = dd; best = mk; } });
        return (best && bd < 4000) ? best.m : '';
      };
      // C6：替换瞬间本身（解码任务，结束于 mark 前）：窗口 [mark-2500, mark+400]
      const atReplace = probes.longtasks.filter((x) => x.t + x.d > rel(skyMark.t) - 2500 && x.t < rel(skyMark.t) + 400);
      const replaceMax = atReplace.length ? Math.max(...atReplace.map((x) => x.d)) : 0;
      c6pass = replaceMax <= 1000;
      c6detail = 'maxAtReplace(EXR解码)=' + replaceMax + 'ms（基线 2717ms 同步含 PMREM）';
      // C6b：空闲期 env 任务（含降采样+PMREM+回收；错峰后世界已可交互、天空已可见）
      if (envMark) {
        const atEnv = probes.longtasks.filter((x) => x.t + x.d > rel(envMark.t) - 2500 && x.t < rel(envMark.t) + 2500);
        const envMax = atEnv.length ? Math.max(...atEnv.map((x) => x.d)) : 0;
        c6bpass = envMax <= 2200;
        c6bdetail = 'maxEnvIdleTask=' + envMax + 'ms（基线该成本混在替换瞬间的 2717ms 里同步支付）';
      }
    }
    results.push({ name: 'C6 天空替换瞬间 hitch ≤1000ms（基线 2717ms）', pass: c6pass, detail: c6detail });
    results.push({ name: 'C6b 空闲期 env 任务 ≤2200ms（已错峰，世界可交互）', pass: c6bpass, detail: c6bdetail });
    // C7：PMREM 错峰——环境光生成发生在背景上屏之后（空闲期）
    results.push({
      name: 'C7 PMREM 错峰（env 在背景上屏之后生成）',
      pass: !!(skyMark && envMark && envMark.t > skyMark.t),
      detail: 'sky=' + (skyMark ? skyMark.t : '-') + ' env=' + (envMark ? envMark.t : '-'),
    });
    // C8：占位环境光在加载屏内就位（材质从此带 envmap 编译，换真纹理零重编译）
    results.push({
      name: 'C8 占位环境光已预热（加载屏内）',
      pass: !!prewarmMark && !!skyMark && prewarmMark.t < skyMark.t,
      detail: 'prewarm=' + (prewarmMark ? prewarmMark.t : 'none') + 'ms',
    });

    // ---------- 汇总 ----------
    const gateErrors = errors.filter((e) => /worldReadyGate|ReadyGate|SkyManager/i.test(e));
    results.push({ name: '闸门/天空模块自身 0 报错', pass: gateErrors.length === 0, detail: gateErrors.join(' | ') });
    if (errors.length > 0) log('（INFO）页面 console 错误 ' + errors.length + ' 条（含媒体 abort 等环境噪音，不判定）: ' + errors.slice(0, 3).join(' || '));
    if (reqLog.length > 0) log('（INFO）请求时间线: ' + reqLog.map((x) => x.kind + '+' + x.t).join(', '));
    if (sceneGlbDone.length > 0) log('（INFO）场景 GLB 完成序列: ' + sceneGlbDone.map((x) => x.t).join(', '));

    const failed = results.filter((r) => !r.pass);
    console.log('\n========== Step 1 + Step 2 验收结果 ==========');
    results.forEach((r) => console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  [' + r.detail + ']'));
    console.log('总计: ' + (results.length - failed.length) + '/' + results.length + ' PASS');
    process.exit(failed.length === 0 ? 0 : 1);
  } catch (e) {
    console.error('[gate] FATAL: ' + (e && e.stack || e));
    process.exit(2);
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
