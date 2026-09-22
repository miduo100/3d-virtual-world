/**
 * r185 升级阶段 1 冒烟验证
 * ------------------------------------------------------------------
 * 验证项：
 *  1. 主世界 index.html 加载 r185 bundle（THREE.REVISION=185、加载器挂载）；
 *  2. 主世界 WebGL 渲染器创建成功、场景搭建无异常（收集 console/page 错误）；
 *  3. test_gaussian.html 同样命中本地 r185 bundle。
 *
 * 用法：node scripts/smoke_r185_world.js
 * 说明：完整全链路验收（动画命中率/合批/传送门）属会话 4，本脚本只做冒烟。
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';

function log(msg) { console.log('[smoke] ' + msg); }

async function fetchAdminToken() {
  // 复用外部传入的 adminToken（脚本串联时用）：管理员登录有 IP 限流（5/分钟 + 15/小时，
  // **成功也计数**，计数器在内存里），连跑多个验收脚本时必被打满 → 支持 ADMIN_TOKEN 传入可避免。
  const preset = process.env.ADMIN_TOKEN;
  if (preset) {
    try {
      const probe = await fetch(BASE + '/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + preset } });
      if (probe.ok) return { token: preset };
      log('ADMIN_TOKEN 已失效，回落到账号登录');
    } catch (e) { log('ADMIN_TOKEN 校验异常，回落到账号登录：' + e.message); }
  }
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('admin login failed: ' + JSON.stringify(data));
  return data;
}

async function checkWorld(context, results) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const errors = [];
  const notFound = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 220)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 220)));
  page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
  try {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 40000 });
    await page.waitForSelector('#canvas', { timeout: 15000 });
    await page.waitForTimeout(20000); // 等场景/模型/动画初始化

    const info = await page.evaluate(() => {
      const T = window.THREE;
      const gw = window.gameWorld;
      return {
        revision: T ? T.REVISION : null,
        loaders: T ? ['GLTFLoader', 'DRACOLoader', 'OBJLoader', 'MTLLoader', 'OrbitControls', 'TransformControls', 'FBXLoader']
          .filter((c) => typeof T[c] === 'function') : [],
        rendererOK: !!(gw && gw.renderer && gw.renderer.domElement),
        outputColorSpace: gw && gw.renderer ? String(gw.renderer.outputColorSpace) : null,
        sceneChildren: gw && gw.scene ? gw.scene.children.length : -1,
        playerOK: !!(window.player && window.player.position),
        mixerRoot: !!(gw && gw.players)
      };
    });
    log('world info: ' + JSON.stringify(info));
    results.push({ name: 'index.html THREE.REVISION', pass: info.revision === '185', detail: String(info.revision) });
    results.push({ name: 'index.html loaders mounted(7)', pass: info.loaders.length === 7, detail: info.loaders.join(',') });
    results.push({ name: 'index.html renderer/outputColorSpace=srgb', pass: info.rendererOK && info.outputColorSpace === 'srgb', detail: info.outputColorSpace });
    results.push({ name: 'index.html scene built', pass: info.sceneChildren > 0, detail: 'scene.children=' + info.sceneChildren });

    // 白屏检测：合成器截图 + sharp 采样（readPixels 在无 preserveDrawingBuffer 下必为 0）
    const shotBuf = await page.screenshot();
    const sharp = require('sharp');
    const { data, info: imgInfo } = await sharp(shotBuf).raw().toBuffer({ resolveWithObject: true });
    const cx = Math.floor(imgInfo.width / 2), cy = Math.floor(imgInfo.height / 2);
    const idx = (cy * imgInfo.width + cx) * imgInfo.channels;
    const px = [data[idx], data[idx + 1], data[idx + 2]];
    // 再采样全图平均亮度，避免单点恰好是天空外黑边
    let sum = 0;
    const step = imgInfo.channels * 97;
    for (let i = 0; i + 2 < data.length; i += step) sum += data[i] + data[i + 1] + data[i + 2];
    const avg = sum / Math.max(1, Math.floor(data.length / step));
    results.push({ name: 'index.html canvas not black', pass: avg > 1 || (px[0] + px[1] + px[2]) > 0, detail: 'center=' + px.join(',') + ' avgLuma=' + avg.toFixed(1) });
  } catch (e) {
    results.push({ name: 'index.html load', pass: false, detail: e.message });
  } finally {
    // 过滤已知无害噪音（浏览器扩展、playwright 内部等）
    const realErrors = errors.filter((t) => !/runtime\.lastError|index\.global\.js|ResizeObserver|Failed to load resource/i.test(t));
    results.push({ name: 'index.html console errors', pass: realErrors.length === 0, detail: realErrors.length ? realErrors.slice(0, 8).join(' || ') : '0' });
    log('console errors (filtered): ' + realErrors.length);
    realErrors.slice(0, 8).forEach((t) => log('  ERROR: ' + t));
    // 404 清单（仅记录 lib/vendor 相关为致命，其余为数据性 404 待人工确认）
    log('404 resources: ' + notFound.length);
    notFound.slice(0, 10).forEach((u) => log('  404: ' + u));
    const libMiss = notFound.filter((u) => /\/js\/lib\//.test(u));
    results.push({ name: 'index.html lib resources 404', pass: libMiss.length === 0, detail: libMiss.length ? libMiss.join(',') : '0' });
    const dataMiss = notFound.filter((u) => !/\/js\/lib\//.test(u));
    results.push({ name: 'index.html data 404 (informational)', pass: true, detail: dataMiss.length + ' (see log)' });
    await page.close();
  }
}

async function checkGaussian(context, results) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  try {
    await page.goto(BASE + '/test_gaussian.html', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(3000);
    const rev = await page.evaluate(() => (window.THREE ? window.THREE.REVISION : null));
    results.push({ name: 'test_gaussian THREE.REVISION', pass: rev === '185', detail: String(rev) });
  } catch (e) {
    results.push({ name: 'test_gaussian load', pass: false, detail: e.message });
  } finally {
    await page.close();
  }
}

(async () => {
  const loginData = await fetchAdminToken();
  log('admin token acquired');

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const results = [];
  try {
    // 注入登录态（同基线口径）
    const p = await context.newPage();
    await p.goto(BASE + '/admin_login.html', { waitUntil: 'domcontentloaded' });
    await p.evaluate((d) => {
      localStorage.setItem('adminToken', d.token);
      localStorage.setItem('adminUser', JSON.stringify(d.adminUser || { username: 'baseline_shot' }));
    }, loginData);
    await p.close();

    await checkWorld(context, results);
    await checkGaussian(context, results);
  } finally {
    await browser.close();
  }

  console.log('\n===== SMOKE RESULTS =====');
  let failed = 0;
  for (const r of results) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  [' + r.detail.slice(0, 160) + ']');
    if (!r.pass) failed++;
  }
  console.log('===== ' + (results.length - failed) + '/' + results.length + ' passed =====');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('[smoke] FATAL', e); process.exit(1); });
