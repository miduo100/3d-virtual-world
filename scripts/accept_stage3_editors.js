/**
 * r185 升级阶段 3（编辑器群迁移）验收脚本
 * ------------------------------------------------------------------
 * 覆盖第六节阶段 3 验收标准：world_editor / unified_editor /
 * character_editor / animation_puppeteer / ai_scene_generator 全部迁到
 * 本地 r185 bundle（REVISION=185、组件就绪、无 three-CDN 请求、无控制台
 * 报错、canvas 渲染存活、OrbitControls 可交互），外加 bundle 新增
 * BufferGeometryUtils 别名与 admin 校准器 r185 控制器形态检查。
 *
 * 用法：node scripts/accept_stage3_editors.js
 * 输出：逐项 PASS/FAIL + 总结；截图存 Screenshot/accept_stage3/
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const BASE = 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';
const OUT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_stage3');

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail: detail || '' });
  console.log((pass ? '  PASS' : '  FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

// 浏览器扩展噪音过滤（headless 下偶现 runtime.lastError / index.global.js）
function isNoise(msg) {
  const t = msg || '';
  return /runtime\.lastError|index\.global\.js|ResizeObserver loop/i.test(t);
}

function attachErrorCollectors(page, bag) {
  page.on('console', (m) => {
    if (m.type() !== 'error' || isNoise(m.text())) return;
    const t = m.text();
    // "Failed to load resource: net::ERR_*" 不带 URL，无法区分来源：
    // 仅当存在本地（localhost/相对路径）资源连接失败时计入，否则视为外部 CDN 网络抖动
    if (/Failed to load resource: net::ERR_/.test(t) && bag.localFailed.length === 0) return;
    bag.consoleErrors.push(t);
  });
  page.on('pageerror', (e) => {
    if (!isNoise(e.message)) bag.pageErrors.push(e.message);
  });
  page.on('requestfailed', (r) => {
    const url = r.url();
    if (/^https?:\/\/(localhost|127\.)/.test(url) || !/^https?:/.test(url)) {
      bag.localFailed.push(url + ' ' + ((r.failure() || {}).errorText || ''));
    } else {
      bag.externalFailed.push(url);
    }
  });
  // three 相关 CDN 请求必须为 0（迁移即验收点）
  page.on('request', (r) => {
    if (/unpkg\.com\/three|cdnjs\.cloudflare\.com\/ajax\/libs\/three|jsdelivr\.net\/npm\/three/i.test(r.url())) {
      bag.threeCdnRequests.push(r.url());
    }
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && /\/js\/lib\//.test(r.url())) bag.libMiss.push(r.status() + ' ' + r.url());
  });
}

async function fetchAdminToken() {
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('admin login failed: ' + JSON.stringify(data));
  return data;
}

async function injectAdminStorage(context, loginData) {
  const p = await context.newPage();
  await p.goto(BASE + '/admin_login.html', { waitUntil: 'domcontentloaded' });
  await p.evaluate((d) => {
    localStorage.setItem('adminToken', d.token);
    localStorage.setItem('adminUser', JSON.stringify(d.adminUser || { username: 'baseline_shot' }));
  }, loginData);
  await p.close();
}

// 合成器截图平均亮度（readPixels 在无 preserveDrawingBuffer 下必为 0）
async function screenshotStats(page) {
  const buf = await page.screenshot();
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  const step = info.channels * 97;
  for (let i = 0; i + 2 < data.length; i += step) sum += data[i] + data[i + 1] + data[i + 2];
  const avg = sum / Math.max(1, Math.floor(data.length / step));
  return { buf, avg };
}

async function meanAbsDiff(bufA, bufB) {
  const a = await sharp(bufA).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(bufB).raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return -1;
  let sum = 0;
  const n = Math.min(a.data.length, b.data.length);
  const step = a.info.channels * 53;
  let cnt = 0;
  for (let i = 0; i < n; i += step) {
    sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    cnt++;
  }
  return cnt ? sum / cnt : -1;
}

// 通用页面打开器
async function openEditor(context, tag, html, waitMs) {
  const bag = { consoleErrors: [], pageErrors: [], threeCdnRequests: [], libMiss: [], localFailed: [], externalFailed: [] };
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  attachErrorCollectors(page, bag);
  try {
    await page.goto(BASE + '/' + html, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(waitMs);
    return { page, bag };
  } catch (e) {
    report(tag + ' 页面打开', false, e.message);
    await page.close().catch(() => {});
    return { page: null, bag };
  }
}

// ===== L1 world_editor：全组件 + 交互 + 无 CDN =====
async function testWorldEditor(context) {
  console.log('[L1] world_editor.html');
  const { page, bag } = await openEditor(context, 'L1', 'world_editor.html', 12000);
  if (!page) return;
  try {
    const info = await page.evaluate(() => {
      const T = window.THREE;
      const canvas = document.querySelector('canvas');
      return {
        revision: T ? T.REVISION : null,
        components: T ? ['GLTFLoader', 'DRACOLoader', 'OBJLoader', 'MTLLoader', 'OrbitControls', 'TransformControls']
          .filter((c) => typeof T[c] === 'function') : [],
        getHelper: T && T.TransformControls ? typeof T.TransformControls.prototype.getHelper : 'n/a',
        hasCanvas: !!canvas,
        canvasSize: canvas ? canvas.width + 'x' + canvas.height : null,
      };
    });
    report('L1-1 THREE.REVISION === 185', info.revision === '185', 'got ' + info.revision);
    report('L1-2 组件 6/6 挂载', info.components.length === 6, info.components.join(','));
    report('L1-3 r185 TransformControls（getHelper 存在）', info.getHelper === 'function', String(info.getHelper));
    report('L1-4 渲染 canvas 存在', info.hasCanvas, info.canvasSize);

    const s1 = await screenshotStats(page);
    report('L1-5 canvas 非黑屏', s1.avg > 1, 'avgLuma=' + s1.avg.toFixed(1));

    // OrbitControls 交互：水平拖拽旋转视角，画面必须变化
    await page.mouse.move(800, 450);
    await page.mouse.down();
    await page.mouse.move(1250, 450, { steps: 25 });
    await page.mouse.up();
    await page.waitForTimeout(2500);
    const s2 = await screenshotStats(page);
    const diff = await meanAbsDiff(s1.buf, s2.buf);
    report('L1-6 OrbitControls 拖拽旋转生效', diff > 0.5, 'meanAbsDiff=' + diff.toFixed(2));

    fs.writeFileSync(path.join(OUT_DIR, 'l1_world_editor.png'), s2.buf);
    report('L1-7 无控制台/page 报错', bag.consoleErrors.length === 0 && bag.pageErrors.length === 0,
      'console=' + bag.consoleErrors.length + ' page=' + bag.pageErrors.length +
      (bag.consoleErrors[0] ? ' first=' + bag.consoleErrors[0].slice(0, 160) : ''));
    report('L1-8 无 three-CDN 请求', bag.threeCdnRequests.length === 0,
      bag.threeCdnRequests.length ? bag.threeCdnRequests.join(',') : '0');
    report('L1-9 js/lib 资源无 4xx/5xx', bag.libMiss.length === 0, bag.libMiss.join(',') || '0');
  } finally {
    await page.close();
  }
}

// ===== L2 unified_editor：本地优先加载链路 =====
async function testUnifiedEditor(context) {
  console.log('[L2] unified_editor.html');
  const { page, bag } = await openEditor(context, 'L2', 'unified_editor.html', 12000);
  if (!page) return;
  try {
    const info = await page.evaluate(() => {
      const T = window.THREE;
      return {
        revision: T ? T.REVISION : null,
        threeJSLoaded: !!window.threeJSLoaded,
        bgu: T && T.BufferGeometryUtils ? typeof T.BufferGeometryUtils.mergeBufferGeometries : 'missing',
      };
    });
    report('L2-1 THREE.REVISION === 185', info.revision === '185', 'got ' + info.revision);
    report('L2-2 threeJSLoaded === true（本地加载链路）', info.threeJSLoaded === true, String(info.threeJSLoaded));
    report('L2-3 BufferGeometryUtils + 旧名别名', info.bgu === 'function', String(info.bgu));

    const s = await screenshotStats(page);
    fs.writeFileSync(path.join(OUT_DIR, 'l2_unified_editor.png'), s.buf);
    report('L2-4 canvas 非黑屏', s.avg > 1, 'avgLuma=' + s.avg.toFixed(1));
    report('L2-5 无控制台/page 报错', bag.consoleErrors.length === 0 && bag.pageErrors.length === 0,
      'console=' + bag.consoleErrors.length + ' page=' + bag.pageErrors.length +
      (bag.consoleErrors[0] ? ' first=' + bag.consoleErrors[0].slice(0, 160) : ''));
    report('L2-6 无 three-CDN 请求', bag.threeCdnRequests.length === 0,
      bag.threeCdnRequests.length ? bag.threeCdnRequests.join(',') : '0');
    report('L2-7 js/lib 资源无 4xx/5xx', bag.libMiss.length === 0, bag.libMiss.join(',') || '0');
  } finally {
    await page.close();
  }
}

// ===== L3 character_editor =====
async function testCharacterEditor(context) {
  console.log('[L3] character_editor.html');
  const { page, bag } = await openEditor(context, 'L3', 'character_editor.html', 10000);
  if (!page) return;
  try {
    const info = await page.evaluate(() => {
      const T = window.THREE;
      return {
        revision: T ? T.REVISION : null,
        components: T ? ['OrbitControls', 'GLTFLoader'].filter((c) => typeof T[c] === 'function') : [],
        hasCanvas: !!document.querySelector('canvas'),
      };
    });
    report('L3-1 THREE.REVISION === 185', info.revision === '185', 'got ' + info.revision);
    report('L3-2 OrbitControls/GLTFLoader 就绪', info.components.length === 2, info.components.join(','));
    report('L3-3 渲染 canvas 存在', info.hasCanvas);
    const s = await screenshotStats(page);
    fs.writeFileSync(path.join(OUT_DIR, 'l3_character_editor.png'), s.buf);
    report('L3-4 无控制台/page 报错', bag.consoleErrors.length === 0 && bag.pageErrors.length === 0,
      'console=' + bag.consoleErrors.length + ' page=' + bag.pageErrors.length +
      (bag.consoleErrors[0] ? ' first=' + bag.consoleErrors[0].slice(0, 160) : ''));
    report('L3-5 无 three-CDN 请求', bag.threeCdnRequests.length === 0,
      bag.threeCdnRequests.length ? bag.threeCdnRequests.join(',') : '0');
  } finally {
    await page.close();
  }
}

// ===== L4 animation_puppeteer =====
async function testAnimationPuppeteer(context) {
  console.log('[L4] animation_puppeteer.html');
  const { page, bag } = await openEditor(context, 'L4', 'animation_puppeteer.html', 10000);
  if (!page) return;
  try {
    const info = await page.evaluate(() => {
      const T = window.THREE;
      return {
        revision: T ? T.REVISION : null,
        orbit: T ? typeof T.OrbitControls : 'missing',
        hasCanvas: !!document.querySelector('canvas'),
      };
    });
    report('L4-1 THREE.REVISION === 185', info.revision === '185', 'got ' + info.revision);
    report('L4-2 OrbitControls 就绪', info.orbit === 'function', String(info.orbit));
    const s = await screenshotStats(page);
    fs.writeFileSync(path.join(OUT_DIR, 'l4_animation_puppeteer.png'), s.buf);
    report('L4-3 无控制台/page 报错', bag.consoleErrors.length === 0 && bag.pageErrors.length === 0,
      'console=' + bag.consoleErrors.length + ' page=' + bag.pageErrors.length +
      (bag.consoleErrors[0] ? ' first=' + bag.consoleErrors[0].slice(0, 160) : ''));
    report('L4-4 无 three-CDN 请求', bag.threeCdnRequests.length === 0,
      bag.threeCdnRequests.length ? bag.threeCdnRequests.join(',') : '0');
  } finally {
    await page.close();
  }
}

// ===== L5 ai_scene_generator =====
async function testAiSceneGenerator(context) {
  console.log('[L5] ai_scene_generator.html');
  const { page, bag } = await openEditor(context, 'L5', 'ai_scene_generator.html', 10000);
  if (!page) return;
  try {
    const info = await page.evaluate(() => {
      const T = window.THREE;
      return { revision: T ? T.REVISION : null, orbit: T ? typeof T.OrbitControls : 'missing' };
    });
    report('L5-1 THREE.REVISION === 185', info.revision === '185', 'got ' + info.revision);
    report('L5-2 OrbitControls 就绪', info.orbit === 'function', String(info.orbit));
    const s = await screenshotStats(page);
    fs.writeFileSync(path.join(OUT_DIR, 'l5_ai_scene_generator.png'), s.buf);
    report('L5-3 无控制台/page 报错', bag.consoleErrors.length === 0 && bag.pageErrors.length === 0,
      'console=' + bag.consoleErrors.length + ' page=' + bag.pageErrors.length +
      (bag.consoleErrors[0] ? ' first=' + bag.consoleErrors[0].slice(0, 160) : ''));
    report('L5-4 无 three-CDN 请求', bag.threeCdnRequests.length === 0,
      bag.threeCdnRequests.length ? bag.threeCdnRequests.join(',') : '0');
  } finally {
    await page.close();
  }
}

// ===== L6 admin：r185 控制器形态 + 校准代码 getHelper 双兼容存在性 =====
async function testAdmin(context) {
  console.log('[L6] admin.html 校准器 r185 形态');
  const bag = { consoleErrors: [], pageErrors: [], threeCdnRequests: [], libMiss: [], localFailed: [], externalFailed: [] };
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  attachErrorCollectors(page, bag);
  try {
    await page.goto(BASE + '/admin.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(15000);
    const info = await page.evaluate(() => {
      const T = window.THREE; // admin 惰性注入，dashboard 态可能未加载
      return {
        hasTHREE: !!T,
        revision: T ? T.REVISION : null,
        getHelper: T && T.TransformControls ? typeof T.TransformControls.prototype.getHelper : 'n/a',
      };
    });
    report('L6-1 admin 页面无 three-CDN 请求', bag.threeCdnRequests.length === 0,
      bag.threeCdnRequests.length ? bag.threeCdnRequests.join(',') : '0');
    if (info.hasTHREE) {
      report('L6-2 admin（若已注入）REVISION/getHelper', info.revision === '185' && info.getHelper === 'function',
        'rev=' + info.revision + ' getHelper=' + info.getHelper);
    } else {
      report('L6-2 admin THREE 惰性未注入（正常）', true, 'dashboard 态不加载 three');
    }
    // 校准器双兼容静态断言：源码含 getHelper 三元式
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
    const dualCompatCount = (src.match(/getHelper \?/g) || []).length;
    report('L6-3 校准器 getHelper 双兼容 >=3 处', dualCompatCount >= 3, 'count=' + dualCompatCount);
  } finally {
    await page.close();
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const loginData = await fetchAdminToken();
  console.log('[accept3] admin token acquired (len=' + loginData.token.length + ')');

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

  try {
    await injectAdminStorage(context, loginData);
    await testWorldEditor(context);
    await testUnifiedEditor(context);
    await testCharacterEditor(context);
    await testAnimationPuppeteer(context);
    await testAiSceneGenerator(context);
    await testAdmin(context);
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log('\n===== STAGE 3 RESULTS =====');
  results.forEach((r) => { if (!r.pass) console.log('  FAILED: ' + r.name + ' | ' + r.detail); });
  console.log(passed + '/' + results.length + ' passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('[accept3] FATAL', e); process.exit(2); });
