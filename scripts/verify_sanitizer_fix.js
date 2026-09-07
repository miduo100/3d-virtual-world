/**
 * 验证 threejsWorldSanitizer 材质判定修复（constructor.name -> is*Material 标志位）
 * ------------------------------------------------------------------
 * 检查项：
 *  A1. 真 r185 MeshStandardMaterial（constructor.name 为 minified 短名）不再被降级（同一引用保留）
 *  A2. GLTF 场景常见的 MeshBasicMaterial / MeshPhysicalMaterial 同样保留
 *  A3. 自定义材质子类（extends MeshStandardMaterial）保留原样（方案 A 预期行为）
 *  A4. 真正的非标准材质（裸对象）仍被降级为 MeshStandardMaterial（降级路径未失效）
 *  B1. 主世界加载后 console 无 "世界模式降级非标准材质" 警告
 *
 * 用法：node scripts/verify_sanitizer_fix.js
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3002';

function log(msg) { console.log('[verify] ' + msg); }

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const results = [];

  // ---------- A. 单元级（在真实 r185 bundle 环境下） ----------
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  try {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 40000 });
    await page.waitForFunction(() => window.THREE && window.ThreeJSWorldSanitizer, null, { timeout: 20000 });

    const unit = await page.evaluate(() => {
      const T = window.THREE;
      const S = window.ThreeJSWorldSanitizer;
      const out = {};

      // A1: MeshStandardMaterial（minified 短名）应保留
      {
        const scene = new T.Scene();
        const mat = new T.MeshStandardMaterial({ color: 0xff0000 });
        mat.userData.marker = 'keepme';
        const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), mat);
        scene.add(mesh);
        S.sanitize(scene, T);
        out.stdName = mat.constructor.name; // minified bundle 下应为短名
        out.stdKept = mesh.material === mat;
        out.stdMarker = mesh.material === mat && mesh.material.userData ? mesh.material.userData.marker : null;
      }
      // A2: Basic / Physical 同样保留
      {
        const scene = new T.Scene();
        const m1 = new T.MeshBasicMaterial();
        const m2 = new T.MeshPhysicalMaterial();
        const mesh1 = new T.Mesh(new T.BoxGeometry(), m1);
        const mesh2 = new T.Mesh(new T.BoxGeometry(), m2);
        scene.add(mesh1, mesh2);
        S.sanitize(scene, T);
        out.basicKept = mesh1.material === m1;
        out.physicalKept = mesh2.material === m2;
      }
      // A3: 自定义子类保留（方案 A 预期）
      {
        class MyGlow extends T.MeshStandardMaterial { }
        const scene = new T.Scene();
        const mat = new MyGlow();
        const mesh = new T.Mesh(new T.BoxGeometry(), mat);
        scene.add(mesh);
        S.sanitize(scene, T);
        out.subclassKept = mesh.material === mat;
      }
      // A4: 真正的非标准材质（裸对象）仍被降级
      {
        const scene = new T.Scene();
        const fake = { color: new T.Color(0x00ff00), transparent: true, opacity: 0.5 };
        const mesh = new T.Mesh(new T.BoxGeometry(), fake);
        scene.add(mesh);
        S.sanitize(scene, T);
        out.fakeDowngraded = !!mesh.material && mesh.material.isMeshStandardMaterial === true;
        out.fakeColor = mesh.material && mesh.material.color ? '#' + mesh.material.color.getHexString() : null;
      }
      return out;
    });
    log('unit result: ' + JSON.stringify(unit));
    results.push({ name: 'A1 MeshStandardMaterial 保留(minified name=' + unit.stdName + ')', pass: unit.stdKept === true, detail: JSON.stringify(unit) });
    results.push({ name: 'A2 Basic/Physical 保留', pass: unit.basicKept === true && unit.physicalKept === true, detail: '' });
    results.push({ name: 'A3 自定义子类保留(方案A)', pass: unit.subclassKept === true, detail: '' });
    results.push({ name: 'A4 非标准材质仍降级', pass: unit.fakeDowngraded === true && unit.fakeColor === '#00ff00', detail: 'color=' + unit.fakeColor });

    // ---------- B. 集成级：重开新页面收集整个加载期的警告 ----------
    const page2 = await context.newPage();
    page2.on('dialog', (d) => d.dismiss().catch(() => {}));
    const sanitizerWarns = [];
    page2.on('console', (m) => {
      const t = m.text();
      if (t.indexOf('ThreeJSWorldSanitizer') !== -1) sanitizerWarns.push(t.slice(0, 160));
    });
    await page2.goto(BASE + '/', { waitUntil: 'load', timeout: 40000 });
    await page2.waitForSelector('#canvas', { timeout: 15000 });
    await page2.waitForTimeout(50000); // 等建筑加载队列跑完（用户日志显示逐个 setTimeout 链式加载）
    const downgradeWarns = sanitizerWarns.filter((t) => t.indexOf('降级非标准材质') !== -1);
    const nanWarns = sanitizerWarns.filter((t) => t.indexOf('NaN') !== -1);
    log('sanitizer warns total=' + sanitizerWarns.length + ' downgrade=' + downgradeWarns.length + ' nan=' + nanWarns.length);
    downgradeWarns.slice(0, 5).forEach((t) => log('  DOWNGRADE: ' + t));
    nanWarns.slice(0, 3).forEach((t) => log('  NAN(cleaned, expected): ' + t));
    results.push({ name: 'B1 主世界无"降级非标准材质"警告', pass: downgradeWarns.length === 0, detail: downgradeWarns.length + ' 条' });
    await page2.close();
  } catch (e) {
    results.push({ name: 'verify run', pass: false, detail: e.message });
  } finally {
    await page.close();
    await browser.close();
  }

  console.log('\n===== VERIFY RESULTS =====');
  let failed = 0;
  for (const r of results) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  [' + String(r.detail).slice(0, 160) + ']');
    if (!r.pass) failed++;
  }
  console.log('===== ' + (results.length - failed) + '/' + results.length + ' passed =====');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('[verify] FATAL', e); process.exit(1); });
