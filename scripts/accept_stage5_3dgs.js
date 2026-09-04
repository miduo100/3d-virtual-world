/**
 * r185 升级阶段 5 验收（会话 10）—— ③ gaussianSplatRenderer shader 实测 + ④ WebGL2 检测降级
 * ------------------------------------------------------------------
 * 验收口径（规范第六节阶段 5 ③④ + 风险矩阵 #6/#8）：
 *
 * L1 test_gaussian.html（独立验证页，r185 bundle + WebGL2/GLSL3 自动转换）：
 *   A REVISION=185  B WebGL2 上下文  C PLY 加载完成（合成样本 24000 点）
 *   D 渐进上屏 100%  E FPS>0  F 0 控台错误（shader 编译无误的判据）
 *   G 像素断言：红/绿/蓝三扇区色块均可见（黑盒验证 GLSL1 源码经 r185
 *     自动转 GLSL3 后协方差投影/点尺寸/高斯衰减/手动 pow(1/2.2) 全链路正常）
 *   H dispose → 重新加载 → 再次可见（几何/材质重建路径）
 *
 * L2 主世界内 addGaussianSplat（真实渲染器上下文：precision mediump +
 *   logarithmicDepthBuffer + sortObjects=false，与测试页不同的风险组合）：
 *   A splat 节点创建  B Points 可见 + drawRange 全量（LOD 不误剪）
 *   C renderer.render 已被 world3dgs 包装（__gsWrapped）  D 0 新增错误
 *   E 截图前后像素差（splat 确实画上了）+ 三扇区色块增量
 *
 * L3 WebGL2 友好降级（webgl2Guard.js，模拟无 WebGL2 旧设备）：
 *   A 全屏中文提示可见  B __WEBGL2_UNSUPPORTED 标记
 *   C three bundle 未被请求（window.stop 省流量生效）
 *
 * 前置：node scripts/gen_3dgs_test_ply.js（样本已生成则跳过）
 * 用法：node scripts/accept_stage5_3dgs.js
 */
const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';
const OUT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_stage5');
const PLY_URL = '/scenes/3dgs/scene-1786835882322-897112501.ply';
const PLY_FILE = path.join(__dirname, '..', 'public', 'scenes', '3dgs', 'scene-1786835882322-897112501.ply');

// 浏览器扩展噪音（playwright 断言经验：与页面无关）
const NOISE = [/runtime\.lastError/, /index\.global\.js/];

function log(msg) { console.log('[s5-3dgs] ' + msg); }
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 200) });
  log((pass ? 'PASS' : 'FAIL') + '  ' + name + '  [' + String(detail).slice(0, 160) + ']');
}

// ---- 截图像素分析（sharp raw RGBA）----
async function analyzeSectorColors(pngBuf) {
  const { data, info } = await sharp(pngBuf).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  // 裁掉左侧 HUD 区域（进度条紫色渐变会污染蓝色计数），取 x>=420
  const X0 = Math.min(420, W);
  let red = 0, green = 0, blue = 0, lumaSum = 0, n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = X0; x < W; x++) {
      const i = (y * W + x) * C;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      lumaSum += 0.299 * r + 0.587 * g + 0.114 * b; n++;
      if (r > 200 && g < 150 && b < 150 && r - g > 60) red++;
      else if (g > 200 && r < 150 && b < 150 && g - r > 60) green++;
      else if (b > 200 && r < 150 && g < 150 && b - r > 60) blue++;
    }
  }
  return { red, green, blue, avgLuma: +(lumaSum / n).toFixed(1), W, H };
}

// 两张截图逐像素平均绝对差 + 差异像素占比
async function diffShots(bufA, bufB) {
  const a = await sharp(bufA).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(bufB).raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return { error: 'size mismatch', diffPct: 100 };
  }
  const C = Math.min(a.info.channels, b.info.channels);
  const da = a.data, db = b.data, N = a.info.width * a.info.height;
  let sumAbs = 0, hot = 0;
  for (let i = 0; i < N; i++) {
    const p = i * C;
    const d = (Math.abs(da[p] - db[p]) + Math.abs(da[p + 1] - db[p + 1]) + Math.abs(da[p + 2] - db[p + 2])) / 3;
    sumAbs += d;
    if (d > 8) hot++;
  }
  return { meanAbs: +(sumAbs / N).toFixed(2), diffPct: +((hot / N) * 100).toFixed(3) };
}

(async () => {
  if (!fs.existsSync(PLY_FILE)) {
    log('样本不存在，先运行生成器…');
    require('child_process').execSync('node ' + path.join(__dirname, 'gen_3dgs_test_ply.js'), { stdio: 'inherit' });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars'] });

  /* ================= L1: test_gaussian.html ================= */
  log('=== L1 test_gaussian.html ===');
  {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.some((re) => re.test(m.text()))) errors.push(m.text().slice(0, 220)); });
    page.on('pageerror', (e) => { if (!NOISE.some((re) => re.test(e.message))) errors.push('PAGEERROR: ' + String(e.message).slice(0, 200)); });

    await page.goto(BASE + '/test_gaussian.html', { waitUntil: 'load', timeout: 30000 });

    // 等待加载完成 ✅（下载+解析 5.7MB 样本）
    let okMsg = false;
    for (let w = 0; w < 20 && !okMsg; w++) {
      okMsg = await page.evaluate(() => (document.getElementById('f-msg').textContent || '').indexOf('✅') >= 0);
      if (!okMsg) await page.waitForTimeout(1500);
    }
    // 渐进上屏 100%
    let render100 = false;
    for (let w = 0; w < 10 && !render100; w++) {
      render100 = await page.evaluate(() => (document.getElementById('f-render').textContent || '') === '100%');
      if (!render100) await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(4000); // FPS 统计 + 渲染稳定

    const l1 = await page.evaluate(() => {
      const cv = document.querySelector('#app canvas');
      return {
        rev: window.THREE ? window.THREE.REVISION : null,
        webgl2: !!(cv && cv.getContext('webgl2')),
        msg: (document.getElementById('f-msg').textContent || '').trim(),
        count: (document.getElementById('f-count').textContent || '').trim(),
        renderPct: (document.getElementById('f-render').textContent || '').trim(),
        fps: (document.getElementById('f-fps').textContent || '').trim(),
      };
    });
    log('L1 info: ' + JSON.stringify(l1));
    const shot1 = await page.screenshot();
    fs.writeFileSync(path.join(OUT_DIR, '3dgs_l1_testpage.png'), shot1);
    const px1 = await analyzeSectorColors(shot1);
    log('L1 pixels: ' + JSON.stringify(px1));

    check('L1 A THREE.REVISION=185', l1.rev === '185', l1.rev);
    check('L1 B WebGL2 context', l1.webgl2 === true, 'getContext(webgl2)=' + l1.webgl2);
    check('L1 C PLY loaded (msg has ✅)', l1.msg.indexOf('✅') >= 0, l1.msg);
    check('L1 C2 count=24,000', l1.count.indexOf('24,000') >= 0, l1.count);
    check('L1 D progressive 100%', render100, 'f-render=' + l1.renderPct);
    check('L1 E FPS>0', parseInt(l1.fps, 10) > 0, 'fps=' + l1.fps);
    check('L1 F 0 console errors (shader compiled)', errors.length === 0, errors.length ? errors[0] : 'clean');
    check('L1 G1 red sector visible', px1.red > 200, 'red=' + px1.red);
    check('L1 G2 green sector visible', px1.green > 200, 'green=' + px1.green);
    check('L1 G3 blue sector visible', px1.blue > 200, 'blue=' + px1.blue);
    check('L1 G4 not black (avgLuma>10)', px1.avgLuma > 10, 'avgLuma=' + px1.avgLuma);

    // H: dispose → 重新加载
    await page.click('#btn-toggle'); // dispose
    const disposedMsg = await page.evaluate(() => (document.getElementById('f-msg').textContent || '').trim());
    await page.click('#btn-toggle'); // 重新加载
    let ok2 = false;
    for (let w = 0; w < 20 && !ok2; w++) {
      ok2 = await page.evaluate(() => (document.getElementById('f-msg').textContent || '').indexOf('✅') >= 0);
      if (!ok2) await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(2500);
    const shot2 = await page.screenshot();
    fs.writeFileSync(path.join(OUT_DIR, '3dgs_l1_reload.png'), shot2);
    const px2 = await analyzeSectorColors(shot2);
    check('L1 H1 dispose message', disposedMsg.indexOf('dispose') >= 0, disposedMsg);
    check('L1 H2 reload renders again', ok2 && px2.red > 200 && px2.green > 200 && px2.blue > 200,
      'ok=' + ok2 + ' r/g/b=' + px2.red + '/' + px2.green + '/' + px2.blue);
    const errsAfter = errors.filter((e) => e.indexOf('3DGS') >= 0);
    check('L1 H3 no 3DGS errors after reload', errsAfter.length === 0, errsAfter[0] || 'clean');

    await context.close();
  }

  /* ================= L2: 主世界内 addGaussianSplat ================= */
  log('=== L2 主世界 addGaussianSplat ===');
  {
    const login = await fetch(BASE + '/api/admin-auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    }).then((r) => r.json());
    if (!login.token) throw new Error('admin login failed');

    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const p0 = await context.newPage();
    await p0.goto(BASE + '/admin_login.html', { waitUntil: 'domcontentloaded' });
    await p0.evaluate((d) => {
      localStorage.setItem('adminToken', d.token);
      localStorage.setItem('adminUser', JSON.stringify(d.adminUser || { username: 'baseline_shot' }));
    }, login);
    await p0.close();

    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    const errors = [];
    const gsLogs = [];
    page.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' && !NOISE.some((re) => re.test(t))) errors.push(t.slice(0, 220));
      if (m.type() === 'log' && t.indexOf('3DGS') >= 0) gsLogs.push(t.slice(0, 160));
    });
    page.on('pageerror', (e) => { if (!NOISE.some((re) => re.test(e.message))) errors.push('PAGEERROR: ' + String(e.message).slice(0, 200)); });

    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#canvas', { timeout: 15000 });
    await page.evaluate(() => { const b = document.getElementById('close-controls-hint'); if (b) b.click(); });
    await page.waitForTimeout(15000); // 世界对象加载稳定

    // 正常路径不应触发 WebGL2 降级
    const noOverlay = await page.evaluate(() => !document.getElementById('webgl2-unsupported-overlay'));

    // 相机策略：animate 循环每帧把相机重置到玩家（出生点）后方，无法强制摆位；
    // 正确做法是把 splat 放进默认相机视野——取 相机→玩家 方向延长线、玩家前方 7m。
    await page.waitForTimeout(2000);
    const shotA = await page.screenshot();
    fs.writeFileSync(path.join(OUT_DIR, '3dgs_l2_world_before.png'), shotA);

    const errBefore = errors.length;
    await page.evaluate(({ url }) => {
      const gw = window.gameWorld;
      // 放置策略：沿"相机视线中心偏下"的射线取 11m 处 —— 保证在屏内且不埋入
      // 出生点高台地形（玩家 y≈11，固定 y=0 会整球入地）。
      const cam = gw.camera;
      const target = new THREE.Vector3(0, -0.3, 0.5).unproject(cam);
      const dir = target.sub(cam.position).normalize();
      const sx = cam.position.x + dir.x * 11;
      const sy = Math.max(0, cam.position.y + dir.y * 11);
      const sz = cam.position.z + dir.z * 11;
      window.__s5SplatPos = { x: sx, y: sy, z: sz };
      gw.addGaussianSplat({
        id: 999901, name: 's5-3dgs-验收',
        model_path: url,
        position_x: sx, position_y: sy, position_z: sz,
        rotation_x: 0, rotation_y: 0, rotation_z: 0,
        scale_x: 8, scale_y: 8, scale_z: 8, // 显示跨度 8 米
      });
    }, { url: PLY_URL });

    // 轮询 splat 就绪
    let probe = { ready: false };
    for (let w = 0; w < 20 && !probe.ready; w++) {
      probe = await page.evaluate((id) => {
        const gw = window.gameWorld;
        const e = gw && gw.generatedBuildings && gw.generatedBuildings.get(id);
        if (!e || !e.splat || !e.splat.object3D) return { ready: false };
        const pts = e.splat.object3D;
        // NDC（是否在屏内）+ 手动渲染一帧后的 points 绘制计数
        pts.updateWorldMatrix(true, true);
        const wp = new THREE.Vector3().setFromMatrixPosition(e.model.matrixWorld);
        const ndc = wp.clone().project(gw.camera);
        gw.renderer.info.reset();
        gw.renderer.render(gw.scene, gw.camera);
        return {
          ready: true, visible: pts.visible,
          drawRange: pts.geometry.drawRange.count,
          attrPos: pts.geometry.attributes.position.count,
          patchWrapped: !!(gw.renderer && gw.renderer.render && gw.renderer.render.__gsWrapped),
          children: e.model.children.map((c) => c.type).join(','),
          ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2), +ndc.z.toFixed(2)],
          infoPoints: gw.renderer.info.render.points,
          pos: [+wp.x.toFixed(1), +wp.y.toFixed(1), +wp.z.toFixed(1)],
        };
      }, 999901);
      if (!probe.ready) await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(4000); // 渐进上屏 + 相机稳定
    const shotB = await page.screenshot();
    fs.writeFileSync(path.join(OUT_DIR, '3dgs_l2_world_after.png'), shotB);

    const d = await diffShots(shotA, shotB);
    const pxA = await analyzeSectorColors(shotA);
    const pxB = await analyzeSectorColors(shotB);
    const sectorDelta = (pxB.red - pxA.red) + (pxB.green - pxA.green) + (pxB.blue - pxA.blue);
    log('L2 probe: ' + JSON.stringify(probe));
    log('L2 diff: ' + JSON.stringify(d) + ' sectorDelta=' + sectorDelta + ' A=' + JSON.stringify(pxA) + ' B=' + JSON.stringify(pxB));

    check('L2 pre: WebGL2 guard not triggered', noOverlay === true, 'overlay=' + !noOverlay);
    check('L2 A splat created', probe.ready === true, JSON.stringify(probe).slice(0, 100));
    check('L2 B Points visible + drawRange full (LOD ok)', probe.ready && probe.visible === true && probe.drawRange === probe.attrPos,
      'visible=' + probe.visible + ' drawRange=' + probe.drawRange + '/' + probe.attrPos);
    check('L2 B2 in-frustum & drawn (NDC in view, points>0)',
      probe.ready && Math.abs(probe.ndc[0]) < 1 && Math.abs(probe.ndc[1]) < 1 && (probe.infoPoints || 0) > 0,
      'ndc=' + JSON.stringify(probe.ndc) + ' infoPoints=' + probe.infoPoints + ' pos=' + JSON.stringify(probe.pos));
    check('L2 C renderer.render wrapped (__gsWrapped)', probe.patchWrapped === true, 'wrapped=' + probe.patchWrapped);
    check('L2 D 0 new console errors', errors.length === errBefore, (errors.length - errBefore) + ' new; first=' + (errors[errBefore] || 'none'));
    check('L2 E1 screenshot diff (splat drawn)', d.diffPct > 0.3 && d.meanAbs > 0.1, 'diffPct=' + d.diffPct + '% meanAbs=' + d.meanAbs);
    check('L2 E2 sector color delta > 300', sectorDelta > 300, 'delta=' + sectorDelta);
    check('L2 info: 3DGS log seen', gsLogs.some((t) => t.indexOf('真实渲染已接入') >= 0), gsLogs.join(' | ').slice(0, 120) || 'no gs log');

    // 清理测试对象（走真实删除路径，同时验证 dispose 钩子）
    await page.evaluate((id) => {
      const gw = window.gameWorld;
      gw.generatedBuildings.delete(id);
      if (window.World && window.World.prototype.unloadObject) {
        gw.unloadObject({ id: id, type: 'gaussian_splat' });
      }
    }, 999901);
    await page.waitForTimeout(1500);
    await context.close();
  }

  /* ================= L3: WebGL2 友好降级 ================= */
  log('=== L3 WebGL2 友好降级（模拟无 WebGL2 设备） ===');
  {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type) {
        if (type === 'webgl2' || type === 'experimental-webgl2') return null;
        return orig.apply(this, arguments);
      };
    });
    const page = await context.newPage();
    const threeReqs = [];
    page.on('request', (r) => { if (r.url().indexOf('three.min.js') >= 0) threeReqs.push(r.url()); });
    const errors = [];
    page.on('pageerror', (e) => { if (!NOISE.some((re) => re.test(e.message))) errors.push(String(e.message).slice(0, 150)); });

    // window.stop() 会中止文档解析（domcontentloaded 不再触发），改用 commit + 等待
    await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 15000 }).catch(() => { /* 预期内：stop 中止加载 */ });
    await page.waitForTimeout(4000);

    const l3 = await page.evaluate(() => {
      const ov = document.getElementById('webgl2-unsupported-overlay');
      let visible = false;
      if (ov) {
        const r = ov.getBoundingClientRect();
        visible = r.width > 0 && r.height > 0 && ov.style.display !== 'none';
      }
      return {
        exists: !!ov,
        visible,
        text: ov ? ov.innerText.slice(0, 120) : '',
        flag: window.__WEBGL2_UNSUPPORTED === true,
        threeNotExecuted: typeof window.THREE === 'undefined',
      };
    });
    log('L3 info: ' + JSON.stringify(l3) + ' threeReqs=' + threeReqs.length);
    await page.screenshot({ path: path.join(OUT_DIR, '3dgs_l3_webgl2_guard.png') });

    check('L3 A overlay visible with WebGL2 text', l3.exists && l3.visible && l3.text.indexOf('WebGL2') >= 0, l3.text.slice(0, 60) || 'missing');
    check('L3 B __WEBGL2_UNSUPPORTED flag', l3.flag === true, 'flag=' + l3.flag);
    // 预加载扫描器会提前预取 three.min.js 字节（请求无法撤回），但 window.stop()
    // 保证解析中止后脚本不执行 —— 权威判据是 window.THREE 未定义。
    check('L3 C three bundle not executed (window.THREE undefined)', l3.threeNotExecuted === true, 'threeNotExecuted=' + l3.threeNotExecuted + ' (prefetch reqs=' + threeReqs.length + ')');

    await context.close();
  }

  await browser.close();

  // ---- 汇总 ----
  const fail = results.filter((r) => !r.pass).length;
  log('==========================================');
  log('TOTAL ' + results.length + '  PASS ' + (results.length - fail) + '  FAIL ' + fail);
  if (fail) {
    results.filter((r) => !r.pass).forEach((r) => log('  FAIL: ' + r.name + ' [' + r.detail + ']'));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => { console.error('[s5-3dgs] FATAL', e); process.exit(2); });
