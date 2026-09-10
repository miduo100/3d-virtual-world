/**
 * 自定义天空（天空库）浏览器端验收
 *
 * 用法: node scripts/accept_sky_manager.js
 *
 * 覆盖：
 *  1. 默认天空零回归（scene.background 仍是纯色 Color）
 *  2. 选中全景图后背景变纹理（equirect mapping），晴天 intensity=1
 *  3. 切雨天：背景仍是该图，intensity/blurriness 按天气调参（天气配合天空）
 *  4. 切回晴天恢复
 *  5. HDR(EXR) 天空 + 环境光照（scene.environment 非空）
 *  6. 回退默认天空：背景恢复纯色、environment 清空
 *  7. 控制台无错误（过滤浏览器扩展与 favicon 噪音）
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3002';
const ADMIN_USER = process.argv[2] || 'baseline_shot';
const ADMIN_PASS = process.argv[3] || 'Baseline#185';
const OUT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_sky');

const IMG = path.join(__dirname, '..', 'public', 'uploads', 'sky', 'DaySkyHDRI054B_1K_TONEMAPPED.jpg');
const HDR = path.join(__dirname, '..', 'public', 'uploads', 'sky', 'DaySkyHDRI054B_1K_HDR.exr');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + String(detail).slice(0, 160));
}

let TOKEN = '';
const H = (json) => Object.assign({ Authorization: 'Bearer ' + TOKEN }, json ? { 'Content-Type': 'application/json' } : {});

async function upload(file) {
  const buf = fs.readFileSync(file);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), path.basename(file));
  return (await fetch(BASE + '/api/sky/upload', { method: 'POST', headers: H(), body: fd })).json();
}
async function setWeather(body) {
  const r = await fetch(BASE + '/api/config/weather', {
    method: 'PUT', headers: H(true), body: JSON.stringify(body)
  });
  return r.json();
}
async function delSky(id) {
  return (await fetch(BASE + '/api/sky/' + id, { method: 'DELETE', headers: H() })).json();
}

async function waitDiag(page, predicate, timeoutMs, label) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate(() => (window.SkyManager ? window.SkyManager._diag() : null));
    if (last && predicate(last)) return last;
    await page.waitForTimeout(500);
  }
  console.log('   timeout waiting: ' + label + ', last diag=' + JSON.stringify(last));
  return last;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---- 登录 & 准备素材 ----
  const lr = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
  });
  const ld = await lr.json();
  TOKEN = ld.token || '';
  check('B0 admin login', !!TOKEN, TOKEN ? 'ok' : JSON.stringify(ld));
  if (!TOKEN) process.exit(1);

  // 先回到默认天空，保证"零回归"基线
  await setWeather({ type: 'clear', intensity: 50, wind: 20, auto_cycle: false, cycle_interval: 30, sky_id: 'default' });

  const imgUp = await upload(IMG);
  const imgSky = imgUp.sky;
  check('B1 upload panorama', !!imgSky, imgSky ? imgSky.url : JSON.stringify(imgUp));

  let hdrSky = null;
  if (fs.existsSync(HDR)) {
    const hdrUp = await upload(HDR);
    hdrSky = hdrUp.sky;
    check('B2 upload hdr exr', !!hdrSky, hdrSky ? hdrSky.kind + ' use_env=' + hdrSky.use_env : JSON.stringify(hdrUp));
  } else {
    check('B2 upload hdr exr', false, 'missing ' + HDR);
  }

  // ---- 打开世界 ----
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 200)));

  try {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#canvas', { timeout: 20000 });
    await page.evaluate(() => { const b = document.getElementById('close-controls-hint'); if (b) b.click(); });
    await page.waitForFunction(() => !!(window.gameWorld && window.SkyManager && window.SkyManager._diag().attached), null, { timeout: 60000 });
    await page.waitForTimeout(3000);

    // 1. 默认天空（零回归）
    let d = await waitDiag(page, (x) => x.backgroundIsTexture === false, 8000, 'default sky');
    check('B3 default sky = solid color', d && d.backgroundIsTexture === false && d.sky === null,
      'bgIsTexture=' + (d && d.backgroundIsTexture) + ' sky=' + JSON.stringify(d && d.sky));
    await page.screenshot({ path: path.join(OUT_DIR, 'sky_default.png') });

    // 2. 选中全景图
    await setWeather({ type: 'clear', intensity: 50, wind: 20, sky_id: imgSky.id });
    d = await waitDiag(page, (x) => x.backgroundIsTexture === true, 25000, 'panorama applied');
    const texInfo = await page.evaluate(() => {
      const s = window.gameWorld.scene;
      const t = s.background;
      return {
        isTexture: !!(t && t.isTexture),
        mapping: t && t.mapping,
        colorSpace: t && t.colorSpace,
        width: t && t.image ? t.image.width : null,
        height: t && t.image ? t.image.height : null,
        intensity: s.backgroundIntensity,
        blurriness: s.backgroundBlurriness
      };
    });
    check('B4 panorama applied as background', texInfo.isTexture === true, JSON.stringify(texInfo));
    check('B5 mapping = equirect(303)', texInfo.mapping === 303, 'mapping=' + texInfo.mapping);
    check('B6 texture size 1024x512', texInfo.width === 1024 && texInfo.height === 512, texInfo.width + 'x' + texInfo.height);
    check('B7 clear: intensity=1 blurriness=0', texInfo.intensity === 1 && texInfo.blurriness === 0,
      'i=' + texInfo.intensity + ' b=' + texInfo.blurriness);
    await page.screenshot({ path: path.join(OUT_DIR, 'sky_panorama_clear.png') });

    // 3. 雨天配合
    await setWeather({ type: 'rain', intensity: 60, wind: 30, sky_id: imgSky.id });
    d = await waitDiag(page, (x) => x.weather === 'rain' && Math.abs(x.intensity - 0.5) < 0.001, 20000, 'rain tuning');
    check('B8 rain keeps sky texture', d && d.backgroundIsTexture === true, 'bgIsTexture=' + (d && d.backgroundIsTexture));
    check('B9 rain intensity=0.5 blur=0.15', d && Math.abs(d.intensity - 0.5) < 0.001 && Math.abs(d.blurriness - 0.15) < 0.001,
      'i=' + (d && d.intensity) + ' b=' + (d && d.blurriness));
    await page.screenshot({ path: path.join(OUT_DIR, 'sky_panorama_rain.png') });

    // 4. 回晴天
    await setWeather({ type: 'clear', intensity: 50, wind: 20, sky_id: imgSky.id });
    d = await waitDiag(page, (x) => x.weather === 'clear' && x.intensity === 1, 20000, 'clear restored');
    check('B10 back to clear intensity=1', d && d.intensity === 1, 'i=' + (d && d.intensity));

    // 5. HDR + 环境光照
    if (hdrSky) {
      await setWeather({ type: 'clear', intensity: 50, wind: 20, sky_id: hdrSky.id });
      d = await waitDiag(page, (x) => x.sky && x.sky.kind === 'hdr' && x.hasTexture === true, 45000, 'hdr applied');
      check('B11 hdr exr loaded as background', d && d.backgroundIsTexture === true && d.sky && d.sky.kind === 'hdr',
        'kind=' + (d && d.sky && d.sky.kind) + ' tex=' + (d && d.hasTexture));
      check('B12 hdr environment light on', d && d.hasEnvironment === true, 'hasEnv=' + (d && d.hasEnvironment));
      await page.screenshot({ path: path.join(OUT_DIR, 'sky_hdr.png') });
    }

    // 6. 回退默认天空
    await setWeather({ type: 'clear', intensity: 50, wind: 20, sky_id: 'default' });
    d = await waitDiag(page, (x) => x.sky === null && x.backgroundIsTexture === false, 20000, 'fallback default');
    check('B13 fallback to default (color)', d && d.backgroundIsTexture === false && d.sky === null,
      'bgIsTexture=' + (d && d.backgroundIsTexture));
    check('B14 environment cleared', d && d.hasEnvironment === false, 'hasEnv=' + (d && d.hasEnvironment));
    await page.screenshot({ path: path.join(OUT_DIR, 'sky_back_to_default.png') });

    // 7. 控制台错误（过滤噪音）
    const noise = ['favicon', 'runtime.lastError', 'index.global.js', 'Failed to load resource'];
    const real = errors.filter((e) => !noise.some((n) => e.includes(n)));
    check('B15 no console errors', real.length === 0, real.slice(0, 3).join(' || ') || 'clean');
  } catch (e) {
    check('FATAL', false, e.message);
  } finally {
    await browser.close();
    // 清理测试数据
    if (imgSky) await delSky(imgSky.id);
    if (hdrSky) await delSky(hdrSky.id);
    await setWeather({ type: 'clear', intensity: 50, wind: 20, sky_id: 'default' });
  }

  const passed = results.filter((r) => r.pass).length;
  console.log('\n=== SKY BROWSER ACCEPTANCE: ' + passed + '/' + results.length + ' ===');
  process.exit(passed === results.length ? 0 : 1);
})();
