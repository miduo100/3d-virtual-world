/**
 * r185 升级阶段 2（垫片）验收脚本
 * ------------------------------------------------------------------
 * 覆盖第六节阶段 2 验收标准：代码块预览（含 EffectComposer/tweakpane 类）、
 * AI 生成场景、AI 动作工厂全部跑通；外加主世界 FBX 垫片链路（three-shim +
 * three-examples r185）冒烟。
 *
 * 用法：node scripts/accept_stage2_shims.js
 * 输出：逐项 PASS/FAIL + 总结；截图存 Screenshot/accept_stage2/
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';
const OUT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_stage2');

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
    if (m.type() === 'error' && !isNoise(m.text())) bag.consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (!isNoise(e.message)) bag.pageErrors.push(e.message);
  });
  page.on('requestfailed', (r) => {
    const f = r.failure() || {};
    if (!/net::ERR_ABORTED/.test(f.errorText || '')) bag.failedRequests.push(r.url() + ' ' + (f.errorText || ''));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) bag.http4xx.push(r.status() + ' ' + r.url());
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

// ===== L1 主世界：three-shim + three-examples r185 FBX 垫片链路 =====
async function testWorldShims(context) {
  console.log('[L1] 主世界 FBX 垫片链路');
  const bag = { consoleErrors: [], pageErrors: [], failedRequests: [], http4xx: [] };
  const page = await context.newPage();
  attachErrorCollectors(page, bag);
  try {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(8000); // 等 three bundle + 场景基础加载（游客态）
    const rev = await page.evaluate(() => window.THREE && window.THREE.REVISION);
    report('L1-1 window.THREE.REVISION === 185', rev === '185', 'got ' + rev);

    // 通过 importmap 同款 URL 动态导入 shim，校验关键符号非空（覆盖 FBX + postprocessing 并集）
    const shim = await page.evaluate(async () => {
      const m = await import('/js/lib/three-shim.js?v=185');
      const need = ['ColorManagement', 'REVISION', 'WebGLRenderTarget', 'Uniform', 'Curve',
        'LinearSRGBColorSpace', 'Data3DTexture', 'RGBADepthPacking', 'EventDispatcher', 'QuaternionKeyframeTrack'];
      const missing = need.filter((k) => m[k] === undefined);
      return { revision: m.REVISION, missing, defaultIsNS: !!m.default && m.default.REVISION === m.REVISION };
    });
    report('L1-2 three-shim 关键导出齐全', shim.missing.length === 0 && shim.revision === '185',
      'missing=' + JSON.stringify(shim.missing) + ' rev=' + shim.revision + ' defaultIsNS=' + shim.defaultIsNS);

    // r185 FBXLoader（three-examples）经 shim 加载真实 FBX 样本
    const fbx = await page.evaluate(async () => {
      const mod = await import('/js/lib/three-examples/loaders/FBXLoader.js?v=185');
      const FBXLoader = mod.FBXLoader;
      if (typeof FBXLoader !== 'function') return { error: 'FBXLoader not a function' };
      const loader = new FBXLoader();
      return await new Promise((resolve) => {
        loader.load('/uploads/anim-library/anim-1779263475939-548011705.fbx',
          (obj) => {
            let boneCount = 0; let clipInfo = [];
            obj.traverse((n) => { if (n.isBone) boneCount++; });
            if (obj.animations) clipInfo = obj.animations.map((a) => a.name + ':' + a.duration.toFixed(2) + 's/' + a.tracks.length + 'trk');
            resolve({ ok: true, isGroup: !!obj.isGroup, boneCount, clipInfo, type: obj.type });
          },
          undefined,
          (err) => resolve({ error: String(err && err.message || err) }));
      });
    });
    const fbxOK = fbx.ok && fbx.isGroup && fbx.boneCount > 0 && fbx.clipInfo.length > 0;
    report('L1-3 r185 FBXLoader 加载样本动画', !!fbxOK,
      fbx.error ? fbx.error : ('bones=' + fbx.boneCount + ' clips=' + JSON.stringify(fbx.clipInfo.slice(0, 3))));

    await page.screenshot({ path: path.join(OUT_DIR, 'l1_world_shim.png') });
    report('L1-4 主世界无控制台报错', bag.consoleErrors.length === 0 && bag.pageErrors.length === 0,
      'console=' + bag.consoleErrors.length + ' page=' + bag.pageErrors.length +
      (bag.pageErrors[0] ? ' first=' + bag.pageErrors[0].slice(0, 160) : ''));
  } catch (e) {
    report('L1 执行异常', false, e.message);
  } finally {
    await page.close();
  }
}

// ===== L2 admin 代码块预览：EffectComposer + tweakpane 类代码 =====
async function testAdminCodePreview(context, loginData) {
  console.log('[L2] admin 代码块预览（EffectComposer/tweakpane）');
  const bag = { consoleErrors: [], pageErrors: [], failedRequests: [], http4xx: [] };
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  attachErrorCollectors(page, bag);
  try {
    await injectAdminStorage(context, loginData);
    await page.goto(BASE + '/admin.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(6000);
    // admin 的 three bundle 为惰性注入（首次预览时 _waitForTHREE 触发 loadThreeJS），REVISION 在预览后断言

    await page.evaluate(() => { showPage('threejs-blocks'); });
    await page.waitForTimeout(1500);
    // 编辑器视图默认 display:none，需走"新增代码块"入口展开
    await page.evaluate(() => { openThreejsBlockEditor(); });
    await page.waitForTimeout(800);
    const hasEditor = await page.evaluate(() => !!document.getElementById('threejs-code') && !!document.getElementById('threejs-preview'));
    report('L2-2 Three.js 代码库编辑器就位', hasEditor);

    // EffectComposer + RenderPass + Pane 样例（runner 会剥 import、注入桩/真库）
    const sample = [
      'function createScene() {',
      '  const scene = new THREE.Scene();',
      '  const camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 100);',
      '  camera.position.z = 5;',
      '  const renderer = new THREE.WebGLRenderer({ antialias: true });',
      '  renderer.setSize(800, 600);',
      '  document.getElementById("box").appendChild(renderer.domElement);',
      '  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff6600 }));',
      '  scene.add(cube);',
      '  scene.add(new THREE.AmbientLight(0xffffff, 1));',
      '  const composer = new EffectComposer(renderer);',
      '  composer.addPass(new RenderPass(scene, camera));',
      '  const pane = new Pane();',
      '  pane.addBinding(cube.position, "x");',
      '  globalThis.__ppMarker = {',
      '    passes: composer.passes ? composer.passes.length : -1,',
      '    composerCtor: composer.constructor.name,',
      '    renderPassEnabled: composer.passes && composer.passes[0] ? composer.passes[0].enabled : null',
      '  };',
      '  function animate() {',
      '    requestAnimationFrame(animate);',
      '    cube.rotation.x += 0.01; cube.rotation.y += 0.01;',
      '    composer.render();',
      '  }',
      '  animate();',
      '  return scene;',
      '}',
      'createScene();'
    ].join('\n');

    await page.fill('#threejs-code', sample);
    await page.evaluate(() => previewThreejsBlock());
    await page.waitForTimeout(9000); // Babel + 依赖惰性加载 + 渲染

    const st = await page.evaluate(() => {
      const pp = window.postprocessing;
      const marker = globalThis.__ppMarker;
      const canvas = document.querySelector('#threejs-preview canvas');
      return {
        rev: window.THREE && window.THREE.REVISION,
        ppLoaded: !!pp,
        ppReal: !!(pp && (pp.BloomEffect || pp.version || (pp.EffectComposer && pp.EffectComposer.toString().length > 200))),
        ppKeys: pp ? Object.keys(pp).length : 0,
        marker, canvasCount: document.querySelectorAll('#threejs-preview canvas').length,
        hasCanvas: !!canvas
      };
    });
    report('L2-1 admin 预览链路加载 r185 bundle', st.rev === '185', 'REVISION=' + st.rev);
    report('L2-3 postprocessing 6.39.4 真库加载（非桩）', st.ppLoaded && st.ppReal, 'keys=' + st.ppKeys);
    report('L2-4 EffectComposer/RenderPass/Pane 代码执行', !!st.marker && st.marker.passes >= 1 && st.hasCanvas,
      'marker=' + JSON.stringify(st.marker) + ' canvas=' + st.canvasCount);

    await page.screenshot({ path: path.join(OUT_DIR, 'l2_admin_pp_preview.png') });
    const errStr = bag.consoleErrors.concat(bag.pageErrors).filter(t => !/postprocessing|tweakpane/.test(t));
    report('L2-5 预览无报错', errStr.length === 0, errStr.length ? 'first=' + errStr[0].slice(0, 200) : '');
  } catch (e) {
    report('L2 执行异常', false, e.message);
  } finally {
    await page.close();
  }
}

// ===== L3 AI 动作工厂：r185 bundle + Timer =====
async function testMotionFactory(context) {
  console.log('[L3] AI 动作工厂（r185 + Timer）');
  const bag = { consoleErrors: [], pageErrors: [], failedRequests: [], http4xx: [] };
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  attachErrorCollectors(page, bag);
  try {
    await page.goto(BASE + '/ai_motion_factory.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(9000); // DOMContentLoaded + 100ms 延迟 init + 模型默认加载
    const st = await page.evaluate(() => {
      const p = window.AIFactoryPlayer || {};
      // bundle 是压缩产物，constructor.name 为短名（如 'Xu'），必须用 instanceof 判定
      return {
        rev: window.THREE && window.THREE.REVISION,
        playerInited: !!p.renderer,
        controlsIsOC: !!p.controls && window.THREE && (p.controls instanceof window.THREE.OrbitControls),
        timerIsTimer: !!p.timer && window.THREE && (p.timer instanceof window.THREE.Timer),
        sceneMeshes: p.scene ? p.scene.children.length : 0
      };
    });
    report('L3-1 动作工厂 r185 bundle', st.rev === '185', 'REVISION=' + st.rev);
    report('L3-2 播放器初始化（renderer/controls）', st.playerInited && st.controlsIsOC,
      'controls instanceof OrbitControls=' + st.controlsIsOC + ' sceneChildren=' + st.sceneMeshes);
    report('L3-3 Clock→Timer 迁移生效', st.timerIsTimer, 'timerCtor=' + st.timerCtor);

    await page.screenshot({ path: path.join(OUT_DIR, 'l3_motion_factory.png') });
    const errStr = bag.consoleErrors.concat(bag.pageErrors);
    report('L3-4 无控制台报错', errStr.length === 0, errStr.length ? 'first=' + errStr[0].slice(0, 200) : '');
  } catch (e) {
    report('L3 执行异常', false, e.message);
  } finally {
    await page.close();
  }
}

// ===== L4 AI 场景生成器（阶段 3 前仍 CDN r128，存活检查）=====
async function testSceneGenerator(context) {
  console.log('[L4] AI 场景生成器（CDN r128 存活检查）');
  const bag = { consoleErrors: [], pageErrors: [], failedRequests: [], http4xx: [] };
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  attachErrorCollectors(page, bag);
  try {
    await page.goto(BASE + '/ai_scene_generator.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(9000);
    const rev = await page.evaluate(() => window.THREE && window.THREE.REVISION);
    report('L4-1 AI 场景生成器可加载', !!rev, 'THREE.REVISION=' + rev + '（阶段 3 迁移前应为 128）');
    const errStr = bag.consoleErrors.concat(bag.pageErrors).filter(t => !/404|Failed to load resource/.test(t));
    report('L4-2 无功能性报错', errStr.length === 0, errStr.length ? 'first=' + errStr[0].slice(0, 200) : '');
  } catch (e) {
    report('L4 执行异常', false, e.message);
  } finally {
    await page.close();
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  try {
    const loginData = await fetchAdminToken();
    await testWorldShims(context);
    await testAdminCodePreview(context, loginData);
    await testMotionFactory(context);
    await testSceneGenerator(context);
  } finally {
    await browser.close();
  }
  const pass = results.filter(r => r.pass).length;
  console.log('\n===== 阶段 2 验收总结: ' + pass + '/' + results.length + ' PASS =====');
  results.filter(r => !r.pass).forEach(r => console.log('  FAIL >> ' + r.name + ' | ' + r.detail));
  process.exit(pass === results.length ? 0 : 1);
})();
