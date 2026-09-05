/**
 * 占位符 + 按距离加载改造验收 v2（修正断言字段 bug + 截图目检）
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3002';

function pass(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + (detail || ''));
  return ok;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars', '--window-size=1600,900'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)));

  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
  try { await page.click('#close-controls-hint', { timeout: 3000 }); } catch (e) {}
  await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.THREE && window.PlaceholderField, null, { timeout: 30000 });
  await page.waitForTimeout(60000);

  const st = await page.evaluate(() => {
    const w = window.gameWorld;
    const PF = window.PlaceholderField;
    const out = {};
    out.pfShown = PF.shownCount();
    out.allObjects = w.allWorldObjects.length;
    out.loaded = w.loadedObjects.size;
    out.calls = w.renderer.info.render.calls;
    out.triangles = w.renderer.info.render.triangles;

    const px = window.player ? window.player.position.x : 0, pz = window.player ? window.player.position.z : 0;
    let nearLoaded = 0, nearTotal = 0, farLoaded = 0, farTotal = 0, farHasBox = 0;
    const noBox = [];
    w.allWorldObjects.forEach((o) => {
      const d = Math.sqrt(Math.pow((o.position_x || 0) - px, 2) + Math.pow((o.position_z || 0) - pz, 2));
      if (d < 200) { nearTotal++; if (w.loadedObjects.has(o.id)) nearLoaded++; }
      if (d > 300) { farTotal++; if (w.loadedObjects.has(o.id)) farLoaded++; if (PF.has(o.id)) farHasBox++; }
      if (!PF.has(o.id) && !w.loadedObjects.has(o.id)) noBox.push({ id: o.id, type: o.type, d: Math.round(d), pos: (o.position_x || 0) + ',' + (o.position_z || 0) });
    });
    out.near = { loaded: nearLoaded, total: nearTotal };
    out.far = { loaded: farLoaded, total: farTotal, hasBox: farHasBox };
    out.noBoxSample = noBox.slice(0, 10);

    // 相机视锥方向可见的模型/实例统计
    let visibleModels = 0, visibleInstanced = 0, instancedCount = 0;
    w.generatedBuildings.forEach((b) => {
      if (b.model && b.model.userData && b.model.visible) visibleModels++;
    });
    w.scene.traverse((o) => {
      if (o.isInstancedMesh && o.visible) { visibleInstanced++; instancedCount += (o.count || 0); }
    });
    out.visibleModels = visibleModels;
    out.visibleInstanced = visibleInstanced;
    out.instancedTotal = instancedCount;
    // merge 状态
    out.merger = (window.WorldInstanceMerger && window.WorldInstanceMerger.stats) ? window.WorldInstanceMerger.stats() : 'n/a';
    return out;
  });
  console.log(JSON.stringify(st, null, 1));

  // 截图：出生点视角
  await page.screenshot({ path: 'l:/shegnjir185/Screenshot/_accept_ph_spawn.png' });
  // 转向 180° 再截
  await page.evaluate(() => {
    if (window.MOUSE) { window.MOUSE.targetRotationY += Math.PI; window.MOUSE.rotationY = window.MOUSE.targetRotationY; }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'l:/shegnjir185/Screenshot/_accept_ph_back.png' });

  let failed = 0;
  failed += pass('A2 全图覆盖：盒子+已加载 ≈ 总数', st.pfShown + st.loaded >= st.allObjects * 0.95, '盒子' + st.pfShown + ' + 已加载' + st.loaded + ' = ' + (st.pfShown + st.loaded) + '/' + st.allObjects) ? 0 : 1;
  failed += pass('A3a 远处(>300m)不加载', st.far.loaded === 0, st.far.loaded + '/' + st.far.total) ? 0 : 1;
  failed += pass('A3b 远处保有占位方块', st.far.hasBox >= st.far.total * 0.95, st.far.hasBox + '/' + st.far.total) ? 0 : 1;
  failed += pass('A3c 近处(<200m)已加载', st.near.loaded >= st.near.total * 0.85, st.near.loaded + '/' + st.near.total) ? 0 : 1;
  failed += pass('A6 draw call 大幅下降', st.calls < 1600, 'calls=' + st.calls + '（改造前≈2150）') ? 0 : 1;
  failed += pass('A7 console 无报错', errors.filter(e => e.indexOf('runtime.lastError') === -1 && e.indexOf('index.global.js') === -1).length === 0, errors.length + ' 条') ? 0 : 1;

  console.log('\n===== ' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED') + ' =====');
  console.log('截图: Screenshot/_accept_ph_spawn.png / _accept_ph_back.png（人工目检画面）');
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
