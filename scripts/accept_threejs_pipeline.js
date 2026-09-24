/**
 * accept_threejs_pipeline.js — Three.js 代码块"放进来就能用"链路验收（2026-09-24）
 *
 * 覆盖：
 *  A 组：样本全量过真实链路（detect → normalize → runner world 模式）——每个样本必须零报错
 *  B 组：preview 模式抽查（光柱/草地）——必须出 canvas
 *  C 组：F4 尺寸归一（世界侧）——1000m 代码块自动缩到 ×0.05，10m 不变
 *
 * 用法：node scripts/accept_threejs_pipeline.js [样本目录]
 * 默认样本目录：L:\shegnjir185\网上找的代码
 * 前置：本地服务器 3002 在跑
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.ACCEPT_BASE || 'http://localhost:3002';
const SAMPLES_DIR = process.argv[2] || 'L:/shegnjir185/网上找的代码';
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const TMP_SAMPLES = path.join(PUBLIC_DIR, '_tmp_samples');
const TMP_HARNESS = path.join(PUBLIC_DIR, '_tmp_harness.html');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  | ' + detail : ''));
}

const HARNESS_HTML = [
  '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>harness</title>',
  '<script src="/js/lib/three.min.js?v=185"></scr' + 'ipt>',
  '<script src="/js/threejsCompatibility.js"></scr' + 'ipt>',
  '<script src="/js/threejsCodeRunner.js?v=1"></scr' + 'ipt>',
  '<script src="/js/threejsCodeNormalizer.js"></scr' + 'ipt>',
  '<script src="/js/threejsInputAdapter.js"></scr' + 'ipt>',
  '<script src="/js/threejsWorldSanitizer.js"></scr' + 'ipt>',
  '</head><body><div id="pv" style="width:400px;height:300px"></div><script>',
  'window.__results=[];window.__pageErrors=[];',
  'window.addEventListener("error",function(e){window.__pageErrors.push(String((e&&e.message)||e));});',
  'function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}',
  'async function testOne(fname){var rec={file:fname};try{',
  'var raw=await (await fetch("/_tmp_samples/"+encodeURIComponent(fname))).text();',
  'var detection=window.ThreeJSInputAdapter.detect(raw);rec.detectType=detection.type;',
  'var extracted=detection.code||raw;',
  'var norm1=window.ThreeJSCodeNormalizer.normalize(extracted,{aggressive:true,stripExports:true,stripImports:true,stripTypeScript:true});',
  'var stored=norm1.code;',
  'try{var res=window.ThreeJSCodeRunner.runThreeJSCode(stored,{mode:"world"});',
  'rec.worldOk=!res.error;if(res.error)rec.worldError=String((res.error&&res.error.message)||res.error);',
  'if(res.object){var c={meshes:0,points:0,lines:0,sprites:0,inst:0};res.object.traverse(function(o){',
  'if(o.isInstancedMesh)c.inst++;else if(o.isMesh)c.meshes++;else if(o.isPoints)c.points++;else if(o.isLine)c.lines++;else if(o.isSprite)c.sprites++;});rec.counts=c;',
  'var box=new THREE.Box3().setFromObject(res.object);if(isFinite(box.min.x)&&isFinite(box.max.x)){var s=new THREE.Vector3();box.getSize(s);rec.size=[s.x,s.y,s.z].map(function(v){return Math.round(v*100)/100;});}}',
  'await sleep(1200);if(res.dispose){try{res.dispose();}catch(e){}}}catch(e){rec.worldOk=false;rec.worldError="THROW: "+String((e&&e.message)||e);}',
  'if(fname==="光柱.html"||fname==="草地.html"){',
  'try{var pv=document.getElementById("pv");pv.innerHTML="";',
  'var res3=window.ThreeJSCodeRunner.runThreeJSCode(stored,{mode:"preview",container:pv});',
  'rec.previewOk=!res3.error;if(res3.error)rec.previewError=String((res3.error&&res3.error.message)||res3.error);',
  'await sleep(1200);rec.previewCanvas=!!pv.querySelector("canvas");',
  'if(res3.dispose){try{res3.dispose();}catch(e){}}}catch(e){rec.previewOk=false;rec.previewError="THROW: "+String((e&&e.message)||e);}}',
  '}catch(e){rec.fatal=String((e&&e.message)||e);}window.__results.push(rec);}',
  '(async function(){var FILES=window.__FILES||[];for(var i=0;i<FILES.length;i++){await testOne(FILES[i]);}window.__done=true;})();',
  '</scr' + 'ipt></body></html>'
].join('\n');

(async () => {
  const files = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.html'));
  if (!files.length) { console.error('样本目录无 html 文件: ' + SAMPLES_DIR); process.exit(1); }
  console.log('样本: ' + files.length + ' 个，目录: ' + SAMPLES_DIR);

  if (!fs.existsSync(TMP_SAMPLES)) fs.mkdirSync(TMP_SAMPLES);
  const copied = [];
  for (const f of files) {
    fs.copyFileSync(path.join(SAMPLES_DIR, f), path.join(TMP_SAMPLES, f));
    copied.push(f);
  }
  fs.writeFileSync(TMP_HARNESS, HARNESS_HTML, 'utf8');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    // ===== A/B 组：链路执行 =====
    const page2 = await browser.newPage();
    await page2.addInitScript((list) => { window.__FILES = list; }, copied);
    await page2.goto(BASE + '/_tmp_harness.html', { waitUntil: 'load', timeout: 30000 });
    await page2.waitForFunction(() => window.__done === true, null, { timeout: 240000 });
    const rows = await page2.evaluate(() => window.__results);

    for (const r of rows) {
      const c = r.counts ? ('m' + r.counts.meshes + ' p' + r.counts.points + ' l' + r.counts.lines) : '-';
      check('A world执行 ' + r.file, r.worldOk === true && !r.fatal,
        c + (r.size ? ' size=' + r.size.join('x') : '') + (r.worldError ? ' err=' + r.worldError : '') + (r.fatal ? ' fatal=' + r.fatal : ''));
      if (r.previewOk !== undefined) {
        check('B preview ' + r.file, r.previewOk === true && r.previewCanvas === true,
          'canvas=' + r.previewCanvas + (r.previewError ? ' err=' + r.previewError : ''));
      }
    }
    await page2.close();

    // ===== C 组：F4 世界侧尺寸归一 =====
    const BIG = 'function createGeometry(THREE){ var g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1000,1000,1000), new THREE.MeshStandardMaterial())); return g; }';
    const SMALL = 'function createGeometry(THREE){ var g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(10,10,10), new THREE.MeshStandardMaterial())); return g; }';
    const page3 = await browser.newPage();
    await page3.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page3.waitForFunction(() => window.gameWorld && window.gameWorld.addThreeJSModel && window.player, null, { timeout: 180000 });
    await page3.waitForTimeout(3000);
    const r4 = await page3.evaluate(async ({ bigCode, smallCode }) => {
      const out = {};
      const gw = window.gameWorld;
      await gw.addThreeJSModel({ id: 'acc_f4_big', name: 'acc_f4_big', type: 'threejs_code', threejs_code: bigCode, position_x: -26, position_y: 30, position_z: 80, scale_x: 1, scale_y: 1, scale_z: 1, file_size: 0 });
      await gw.addThreeJSModel({ id: 'acc_f4_small', name: 'acc_f4_small', type: 'threejs_code', threejs_code: smallCode, position_x: -26, position_y: 30, position_z: 100, scale_x: 1, scale_y: 1, scale_z: 1, file_size: 0 });
      const big = gw.generatedBuildings.get('acc_f4_big');
      const small = gw.generatedBuildings.get('acc_f4_small');
      out.bigScale = big && big.model ? big.model.scale.x : null;
      out.smallScale = small && small.model ? small.model.scale.x : null;
      return out;
    }, { bigCode: BIG, smallCode: SMALL });
    check('C1 超大代码块(1000m)自动缩小×0.05', Math.abs((r4.bigScale || 0) - 0.05) < 0.001, 'scale=' + r4.bigScale);
    check('C2 正常代码块(10m)尺寸不变', r4.smallScale === 1, 'scale=' + r4.smallScale);
    await page3.close();
  } finally {
    await browser.close();
    try { fs.unlinkSync(TMP_HARNESS); } catch (e) {}
    try { for (const f of copied) fs.unlinkSync(path.join(TMP_SAMPLES, f)); fs.rmdirSync(TMP_SAMPLES); } catch (e) {}
  }

  const fails = results.filter((r) => !r.ok);
  console.log('\n===== ' + (results.length - fails.length) + '/' + results.length + ' PASS =====');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  try { fs.unlinkSync(TMP_HARNESS); } catch (e2) {}
  try { fs.rmSync(TMP_SAMPLES, { recursive: true, force: true }); } catch (e2) {}
  process.exit(1);
});
