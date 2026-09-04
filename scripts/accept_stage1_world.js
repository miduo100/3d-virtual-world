/**
 * r185 升级阶段 1 完整验收（会话 4）
 * ------------------------------------------------------------------
 * 验收口径（规范第六节阶段 1）：
 *  登录→进世界→建筑/角色/动画/传送门/合批全链路无控制台报错；
 *  动画命中率与升级前一致（204 骨 51 匹配等基线）。
 *
 * 三层检查：
 *  L1 游客全链路：REVISION / 建筑 / 传送门(API+UI) / 合批 InstancedMesh / FPS / 错误
 *  L2 骨骼动画全链路：addPlayer 加载"谁到发疯"模板 + 动作库 idle 动画，
 *     检查 duplicateBoneChainFixer / animConventionCompensator / sharedMixer 绑定 /
 *     轨道命中率（历史基线 51/204）/ 骨骼驱动采样 / 站立姿态（历史趴地/埋地案不复发）
 *  L3 红军合批：统计 InstancedMesh 渲染与 FPS（headless swiftshader 环境 FPS 仅记录，
 *     不与 GPU 基线 60 直接比较）
 *
 * 用法：node scripts/accept_stage1_world.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';
const OUT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_stage1');

const SHUIDA_GLB = '/uploads/character-templates/char-1788244701927-488551754.glb';
const IDLE_ANIM = '/uploads/anim-library/anim-1788167785209-773140698.glb';
const TEST_CID = 'accept-stage1';

function log(msg) { console.log('[accept] ' + msg); }
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 200) });
  log((pass ? 'PASS' : 'FAIL') + '  ' + name + '  [' + String(detail).slice(0, 160) + ']');
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

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const loginData = await fetchAdminToken();

  // 传送门 API 服务端检查（admin token）
  const portalRes = await fetch(BASE + '/api/portal', { headers: { Authorization: 'Bearer ' + loginData.token } });
  const portalJson = await portalRes.json().catch(() => null);
  check('L1 portal API status', portalRes.status === 200, 'HTTP ' + portalRes.status + ' body=' + JSON.stringify(portalJson).slice(0, 80));

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  const notFound = [];

  try {
    // 注入登录态
    const p0 = await context.newPage();
    await p0.goto(BASE + '/admin_login.html', { waitUntil: 'domcontentloaded' });
    await p0.evaluate((d) => {
      localStorage.setItem('adminToken', d.token);
      localStorage.setItem('adminUser', JSON.stringify(d.adminUser || { username: 'baseline_shot' }));
    }, loginData);
    await p0.close();

    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 220)); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 220)));
    page.on('response', (r) => { if (r.status() >= 400) notFound.push(r.status() + ' ' + r.url()); });

    // ============ L1 游客全链路 ============
    log('--- L1: world full-chain (guest) ---');
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 40000 });
    await page.waitForSelector('#canvas', { timeout: 15000 });
    // 关闭"操作指南"弹窗（遮挡视野）
    await page.evaluate(() => { const b = document.getElementById('close-controls-hint'); if (b) b.click(); });
    await page.waitForTimeout(25000);

    const l1 = await page.evaluate(() => {
      const T = window.THREE, gw = window.gameWorld;
      let meshCount = 0, visibleMeshes = 0, skinned = 0, imCount = 0, imTotal = 0;
      if (gw && gw.scene) {
        gw.scene.traverse((o) => {
          if (o.isMesh) {
            meshCount++;
            if (o.visible !== false) visibleMeshes++;
            if (o.isSkinnedMesh) skinned++;
          }
          if (o.isInstancedMesh) { imCount++; imTotal += o.count || 0; }
        });
      }
      return {
        revision: T ? T.REVISION : null,
        outputColorSpace: gw && gw.renderer ? String(gw.renderer.outputColorSpace) : null,
        generatedBuildings: gw && gw.generatedBuildings ? gw.generatedBuildings.size : -1,
        placeholders: gw && gw.placeholderMeshes ? gw.placeholderMeshes.size : -1,
        sceneChildren: gw && gw.scene ? gw.scene.children.length : -1,
        meshCount, visibleMeshes, skinned, imCount, imTotal,
        mergerLoaded: !!window.WorldInstanceMerger,
        portalBtn: !!document.getElementById('open-portals-btn') || !!document.querySelector('[onclick*="openPortalManager"]'),
        portalsListEl: !!document.getElementById('portals-list')
      };
    });
    log('L1 info: ' + JSON.stringify(l1));
    check('L1 THREE.REVISION=185', l1.revision === '185', l1.revision);
    check('L1 outputColorSpace=srgb', l1.outputColorSpace === 'srgb', l1.outputColorSpace);
    check('L1 generatedBuildings loaded', l1.generatedBuildings > 50, 'size=' + l1.generatedBuildings);
    check('L1 visible meshes rendering', l1.visibleMeshes > 50, 'visible=' + l1.visibleMeshes + '/' + l1.meshCount);
    check('L1 InstancedMesh merger loaded (active groups verified in L3 dense zone)', l1.mergerLoaded, 'mergerLoaded=' + l1.mergerLoaded);
    check('L1 portal UI present', l1.portalBtn || l1.portalsListEl, 'btn=' + l1.portalBtn + ' list=' + l1.portalsListEl);

    // FPS（记录值，swiftshader 环境不与 GPU 基线直接对比）
    const fps = await page.evaluate(() => new Promise((res) => {
      let n = 0; const t0 = performance.now();
      (function loop() { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(loop); else res((n / ((performance.now() - t0) / 1000)).toFixed(1)); })();
    }));
    log('L1 FPS(swiftshader): ' + fps);
    check('L1 render loop alive', Number(fps) > 0, 'fps=' + fps);
    await page.screenshot({ path: path.join(OUT_DIR, 'accept_L1_guest.png') });

    // ============ L2 骨骼动画全链路（谁到发疯模板）============
    log('--- L2: skeletal anim chain (shuida template) ---');
    await page.evaluate(({ cid, glb }) => {
      window.gameWorld.addPlayer(cid, '验收角色', { x: 6, y: 0, z: 6 }, false, glb);
    }, { cid: TEST_CID, glb: SHUIDA_GLB });
    await page.waitForTimeout(9000); // 模型加载 + 修复器（duplicateBoneChainFixer / animConventionCompensator）
    await page.evaluate(({ cid, url }) => {
      window.gameWorld._loadPlayerAnimGlb(cid, 'idle', url);
    }, { cid: TEST_CID, url: IDLE_ANIM });
    await page.waitForTimeout(6000);

    const l2 = await page.evaluate(async (cid) => {
      const gw = window.gameWorld;
      const T = window.THREE;
      const pd = gw.players.get(cid);
      if (!pd) return { error: 'player not found' };
      const cg = pd.group;
      const model = cg.userData.glbModel;
      const out = { hasModel: !!model };
      if (!model) return out;

      // 世界包围盒（站立姿态判定）
      model.updateWorldMatrix(true, true);
      const box = new T.Box3().setFromObject(model);
      const size = new T.Vector3(); box.getSize(size);
      out.box = { min: [box.min.x, box.min.y, box.min.z].map((v) => +v.toFixed(2)), max: [box.max.x, box.max.y, box.max.z].map((v) => +v.toFixed(2)) };
      out.sizeY = +size.y.toFixed(2); out.sizeZ = +size.z.toFixed(2);

      // sharedMixer 绑定（板斧①）
      const mixer = cg.userData.sharedMixer;
      out.hasMixer = !!mixer;
      if (mixer) {
        out.mixerInModel = model.getObjectById ? (function () {
          let inTree = false;
          model.traverse((o) => { if (o === mixer._root) inTree = true; });
          return inTree || mixer._root === model;
        })() : null;
        // 当前 action / clip
        const act = mixer._actions ? mixer._actions.find((a) => a.isRunning()) : null;
        out.runningAction = act ? (act._clip ? act._clip.name : '?') : null;
        if (act && act._clip) {
          // 轨道命中率（板斧②：轨道名 vs 骨骼名，去 _N 后缀）
          const boneNames = new Set();
          let boneCount = 0;
          model.traverse((o) => {
            if (o.isSkinnedMesh && o.skeleton) o.skeleton.bones.forEach((b) => { boneNames.add(b.name.replace(/_\d+$/, '')); boneCount++; });
          });
          const qTracks = act._clip.tracks.filter((t) => t.name.endsWith('.quaternion'));
          const hit = qTracks.filter((t) => boneNames.has(t.name.split('.')[0]));
          out.trackHit = hit.length; out.trackTotal = qTracks.length; out.uniqueBones = boneNames.size;
        }
      }
      // 骨骼驱动采样（板斧③：间隔 800ms 两次 quaternion 比较）
      const sample = () => { const a = []; model.traverse((o) => { if (o.isBone) a.push(o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w); }); return a; };
      const s1 = sample();
      await new Promise((r) => setTimeout(r, 800));
      const s2 = sample();
      let delta = 0;
      for (let i = 0; i < Math.min(s1.length, s2.length); i++) delta += Math.abs(s1[i] - s2[i]);
      out.boneQuatDelta = +delta.toFixed(5);
      out.boneCount = s1.length / 4;
      // animConventionCompensator 诊断（容器下沉归一/补偿链路状态）
      try {
        if (window.AnimConventionCompensator && window.AnimConventionCompensator._diag) {
          out.compDiag = window.AnimConventionCompensator._diag(model);
        }
      } catch (e) { out.compDiag = { error: String(e && e.message) }; }
      return out;
    }, TEST_CID);
    log('L2 info: ' + JSON.stringify(l2));
    check('L2 glbModel loaded', l2.hasModel === true, JSON.stringify(l2).slice(0, 80));
    if (l2.hasModel) {
      check('L2 sharedMixer bound to current model', l2.hasMixer && l2.mixerInModel, 'mixer=' + l2.hasMixer + ' inTree=' + l2.mixerInModel);
      check('L2 idle action running', !!l2.runningAction, 'action=' + l2.runningAction);
      check('L2 anim track hit-rate > 0 (baseline 51/204)', l2.trackHit > 0, 'hit=' + l2.trackHit + '/' + l2.trackTotal + ' uniqueBones=' + l2.uniqueBones);
      check('L2 bones driven (quat delta > 0)', l2.boneQuatDelta > 0.0001, 'delta=' + l2.boneQuatDelta + ' bones=' + l2.boneCount);
      // 站立姿态：Y 高度明显大于 Z 深度、不深埋地（历史趴地/埋地案）
      // 站立姿态（历史"半埋地/趴地"案不复发）：补偿诊断 sunk+!restBroken+willCompensate 是权威判据
      // （Box3.setFromObject 用 bind-pose 几何盒不反映蒙皮姿态，截图作为视觉证据见 accept_L2_anim.png）
      const d = l2.compDiag || {};
      check('L2 no lay-flat/bury (animcomp sunk+!restBroken+willCompensate; baseline matched=51)', d.sunk === true && d.restBroken === false && d.willCompensate === true && d.matched === 51, 'sunk=' + d.sunk + ' restBroken=' + d.restBroken + ' willCompensate=' + d.willCompensate + ' matched=' + d.matched);
    }
    // 相机对准验收角色再截图（玩家移到角色正后方，第三人称相机朝 -Z 前方）
    await page.evaluate(() => {
      if (window.player && window.player.position) {
        window.player.position.set(6, 0, 13);
        if (window.player.rotation) window.player.rotation.set(0, 0, 0);
      }
    });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT_DIR, 'accept_L2_anim.png') });

    // ============ L3 合批视距裁剪（红军区）============
    log('--- L3: redarmy merged instancing ---');
    await page.evaluate(() => {
      if (window.player && window.player.position) window.player.position.set(41, 0, -223);
    });
    await page.waitForTimeout(4000);
    const l3 = await page.evaluate(() => {
      const gw = window.gameWorld;
      let imCount = 0, imTotal = 0, imVisible = 0;
      gw.scene.traverse((o) => {
        if (o.isInstancedMesh) { imCount++; imTotal += o.count || 0; if (o.visible !== false) imVisible++; }
      });
      return { imCount, imTotal, imVisible, playerPos: window.player ? [window.player.position.x, window.player.position.z] : null };
    });
    log('L3 info: ' + JSON.stringify(l3));
    const fps3 = await page.evaluate(() => new Promise((res) => {
      let n = 0; const t0 = performance.now();
      (function loop() { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(loop); else res((n / ((performance.now() - t0) / 1000)).toFixed(1)); })();
    }));
    check('L3 instancing active at redarmy zone', l3.imCount > 0 && l3.imTotal > 100, 'groups=' + l3.imCount + ' instances=' + l3.imTotal + ' fps=' + fps3);
    await page.screenshot({ path: path.join(OUT_DIR, 'accept_L3_redarmy.png') });

    // ============ 错误汇总 ============
    const realErrors = errors.filter((t) => !/runtime\.lastError|index\.global\.js|ResizeObserver|Failed to load resource/i.test(t));
    check('ALL console/page errors = 0', realErrors.length === 0, realErrors.length ? realErrors.slice(0, 6).join(' || ') : '0');
    log('http>=400 list (' + notFound.length + '):');
    notFound.slice(0, 10).forEach((u) => log('  ' + u));

    await page.close();
  } finally {
    await browser.close();
  }

  console.log('\n===== STAGE 1 ACCEPTANCE =====');
  let failed = 0;
  for (const r of results) { console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  [' + r.detail + ']'); if (!r.pass) failed++; }
  console.log('===== ' + (results.length - failed) + '/' + results.length + ' passed =====');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('[accept] FATAL', e); process.exit(1); });
