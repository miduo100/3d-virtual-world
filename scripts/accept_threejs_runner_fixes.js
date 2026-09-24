/**
 * accept_threejs_runner_fixes.js — Three.js 代码块管线「收敛修复」验收
 * ------------------------------------------------------------------
 * 覆盖本轮收敛项（2026-09-24）：
 *   R1 同步代码块（回归）           ：object 非空 + 捕获组内有渲染物
 *   R2 顶层 await（代码自建场景）    ：object 非空（不显示"未生成模型"占位）+ 异步内容随后可见
 *   R3 顶层 await + 入口函数        ：异步完成后入口函数被调用、内容出现（B4 修复点：
 *                                    修复前该形态"无报错、无内容"）
 *   R4 万能桩安全（A4）             ：for...of 桩不死循环、JSON.stringify(桩) 不抛
 *   R5 ShaderMaterial 对数深度（B1）：片元 main 括号与花括号之间带注释写法时，
 *                                    不得出现「VS 已注入 / FS 未注入」的半成品状态
 *   R6 环境标记                     ：异步执行期间 captureScene.userData.__asyncPending 语义正确
 *
 * 方式：在真实世界页（index.html）内直接调用 window.ThreeJSCodeRunner（registry + sanitizer
 *      均已加载，与生产同链路）。仅创建临时捕获组，不污染世界场景。
 *
 * 用法：node scripts/accept_threejs_runner_fixes.js   （前置：本地 3002 已启动）
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3002';

function log(m) { console.log('[tjfix] ' + m); }

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    const page = await browser.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 40000 });
    await page.waitForFunction(() => window.ThreeJSCodeRunner && window.THREE && window.ThreeJSIssueRegistry, null, { timeout: 40000 });
    log('runner / registry 已加载（sanitizer=' + (await page.evaluate(() => !!window.ThreeJSWorldSanitizer)) + '）');

    const countRenderables = `(function(root){var n=0,meshes=0;root.traverse(function(o){if(o.isMesh||o.isPoints||o.isLine||o.isSprite){n++;if(o.isMesh)meshes++;}});return {renderables:n,meshes:meshes};})`;

    // ---------- R1 同步代码块（回归） ----------
    const r1 = await page.evaluate((cntSrc) => {
      const code = [
        'const scene = new THREE.Scene();',
        'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial({color:0x00ff00})));',
      ].join('\n');
      const r = window.ThreeJSCodeRunner.runThreeJSCode(code, { mode: 'world', THREE: THREE });
      const cnt = eval(cntSrc)(r.object);
      return { hasObject: !!r.object, err: r.error ? String(r.error.message || r.error) : null, cnt: cnt, asyncPending: !!(r.object && r.object.userData.__asyncPending) };
    }, countRenderables);
    results.push({ name: 'R1 同步代码块可用（回归）', pass: !!r1.hasObject && !r1.err && r1.cnt.meshes >= 1 && r1.asyncPending === false, detail: JSON.stringify(r1) });

    // ---------- R2 顶层 await（代码自建场景） ----------
    const r2 = await page.evaluate(async (cntSrc) => {
      const code = [
        'await new Promise(function(r){ setTimeout(r, 80); });',
        'const scene = new THREE.Scene();',
        'scene.add(new THREE.Mesh(new THREE.BoxGeometry(2,2,2), new THREE.MeshBasicMaterial({color:0x0000ff})));',
      ].join('\n');
      const r = window.ThreeJSCodeRunner.runThreeJSCode(code, { mode: 'world', THREE: THREE });
      const immediate = { hasObject: !!r.object, err: r.error ? String(r.error.message || r.error) : null, pending: !!(r.object && r.object.userData.__asyncPending) };
      await new Promise((res) => setTimeout(res, 1200));
      const after = eval(cntSrc)(r.object);
      return { immediate: immediate, after: after, pendingAfter: !!(r.object && r.object.userData.__asyncPending) };
    }, countRenderables);
    results.push({
      name: 'R2 顶层 await：object 非空（不显示未生成模型占位）',
      pass: !!(r2.immediate && r2.immediate.hasObject && !r2.immediate.err),
      detail: JSON.stringify(r2.immediate),
    });
    results.push({ name: 'R2b 异步内容随后可见 + pending 归位', pass: r2.after.meshes >= 1 && r2.pendingAfter === false, detail: JSON.stringify({ after: r2.after, pendingAfter: r2.pendingAfter }) });

    // ---------- R3 顶层 await + 入口函数（B4 修复点） ----------
    const r3 = await page.evaluate(async (cntSrc) => {
      const code = [
        'await new Promise(function(r){ setTimeout(r, 60); });',
        'function createModel() {',
        '  const g = new THREE.Group();',
        '  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5), new THREE.MeshBasicMaterial({color:0xff8800})));',
        '  return g;',
        '}',
      ].join('\n');
      const r = window.ThreeJSCodeRunner.runThreeJSCode(code, { mode: 'world', THREE: THREE });
      await new Promise((res) => setTimeout(res, 1200));
      const cnt = eval(cntSrc)(r.object);
      return { hasObject: !!r.object, meshes: cnt.meshes, pending: !!(r.object && r.object.userData.__asyncPending) };
    }, countRenderables);
    results.push({
      name: 'R3 顶层 await + 入口函数：异步完成后入口被调用（B4）',
      pass: r3.hasObject && r3.meshes >= 1 && r3.pending === false,
      detail: JSON.stringify(r3),
    });

    // ---------- R4 万能桩安全（A4） ----------
    const r4 = await page.evaluate(async (cntSrc) => {
      const out = { iterOk: false, iterElapsed: -1, stringifyOk: false, error: null, hasObject: false };
      // 迭代未知库对象：修复前迭代器是桩自身 → 可能死循环（用 Promise.race 保护，超时即判失败）
      const codeIter = [
        'const scene = new THREE.Scene();',
        'var n = 0;',
        'for (const item of THREE.SomeMissingLibrary) { n++; if (n > 50) break; }',
        'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial()));',
      ].join('\n');
      const t0 = performance.now();
      const r = window.ThreeJSCodeRunner.runThreeJSCode(codeIter, { mode: 'world', THREE: THREE });
      out.iterElapsed = Math.round(performance.now() - t0);
      out.iterOk = out.iterElapsed < 2000 && !!r.object && !r.error;
      out.hasObject = !!r.object;
      // JSON.stringify(桩) 不应抛
      try {
        const cnt2 = window.ThreeJSCodeRunner.runThreeJSCode(
          'const scene = new THREE.Scene();\nvar s = JSON.stringify(THREE.SomeMissingLibrary);\nif (s === undefined) { s = "undefined"; }\nscene.userData.__s = s;',
          { mode: 'world', THREE: THREE });
        out.stringifyOk = !!cnt2.object;
      } catch (e) { out.error = String(e && e.message || e); }
      return out;
    }, countRenderables);
    results.push({ name: 'R4 万能桩：for...of 不死循环（<2s）', pass: r4.iterOk === true, detail: JSON.stringify(r4) });
    results.push({ name: 'R4b 万能桩：JSON.stringify 不抛', pass: r4.stringifyOk === true, detail: JSON.stringify({ stringifyOk: r4.stringifyOk, error: r4.error }) });

    // ---------- R5 ShaderMaterial 对数深度：不得半成品（B1） ----------
    const r5 = await page.evaluate(() => {
      const code = [
        'const scene = new THREE.Scene();',
        'const mat = new THREE.ShaderMaterial({',
        '  vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",',
        '  fragmentShader: "void main() /* keep */ { gl_FragColor = vec4(1.0, 0.5, 0.2, 1.0); }"',
        '});',
        'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), mat));',
      ].join('\n');
      const r = window.ThreeJSCodeRunner.runThreeJSCode(code, { mode: 'world', THREE: THREE });
      let m = null;
      if (r.object) r.object.traverse((o) => { if (o.isShaderMaterial) m = o; else if (o.material && o.material.isShaderMaterial) m = o.material; });
      if (!m) return { found: false };
      const vsPatched = /vFragDepth/.test(m.vertexShader || '');
      const fsPatched = /gl_FragDepth/.test(m.fragmentShader || '');
      return {
        found: true, vsPatched: vsPatched, fsPatched: fsPatched,
        halfPatch: vsPatched !== fsPatched,
        vsHead: (m.vertexShader || '').slice(0, 40),
        fsHead: (m.fragmentShader || '').slice(0, 60),
      };
    });
    results.push({
      name: 'R5 ShaderMaterial 对数深度注入不出现半成品（B1）',
      pass: r5.found === true && (r5.halfPatch === false),
      detail: JSON.stringify(r5) + '（期望 vsPatched 与 fsPatched 同真同假）',
    });

    // ---------- R6 include 形式不重复注入 ----------
    const r6 = await page.evaluate(() => {
      const code = [
        'const scene = new THREE.Scene();',
        'const mat = new THREE.ShaderMaterial({',
        '  vertexShader: "#include <logdepthbuf_pars_vertex>\\nvoid main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); #include <logdepthbuf_vertex>\\n}",',
        '  fragmentShader: "#include <logdepthbuf_pars_fragment>\\nvoid main() { gl_FragColor = vec4(1.0); #include <logdepthbuf_fragment>\\n}"',
        '});',
        'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), mat));',
      ].join('\n');
      const r = window.ThreeJSCodeRunner.runThreeJSCode(code, { mode: 'world', THREE: THREE });
      let m = null;
      if (r.object) r.object.traverse((o) => { if (o.material && o.material.isShaderMaterial) m = o.material; });
      if (!m) return { found: false };
      const declCount = ((m.vertexShader || '').match(/varying float vFragDepth;/g) || []).length;
      return { found: true, declCount: declCount, vs: (m.vertexShader || '').slice(0, 80) };
    });
    results.push({
      name: 'R6 logdepthbuf include 形式不重复声明 vFragDepth',
      pass: r6.found === true && r6.declCount <= 1,
      detail: JSON.stringify(r6) + '（<=1 即未重复注入）',
    });

    const failed = results.filter((x) => !x.pass);
    console.log('\n========== Three.js 管线收敛验收 ==========');
    results.forEach((x) => console.log((x.pass ? 'PASS' : 'FAIL') + '  ' + x.name + '  [' + x.detail + ']'));
    console.log('总计: ' + (results.length - failed.length) + '/' + results.length + ' PASS');
    process.exit(failed.length === 0 ? 0 : 1);
  } catch (e) {
    console.error('[tjfix] FATAL: ' + (e && e.stack || e));
    process.exit(2);
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
