/**
 * r185 升级阶段 5 验收（会话 9）—— 骨骼动画套件全量回归
 * ------------------------------------------------------------------
 * 验收口径（规范第六节阶段 5 ① + 第八节历史回归清单）：
 *  8 个角色模板（含全部历史案）在 r185 GLTFLoader 下站立/动画正常，
 *  趴地/半埋地/裙子收起/副本骨骼链/远距离透明等历史案不复发。
 *
 * 覆盖模板（10 个，含 5 大历史案 + 全部活模板）：
 *  [历史案] 线上转换的GLB(B类双重轴) / 拿剑武士(副本骨骼链) /
 *           Kipfel_Mobile(裙子收起) / 谁到发疯(半身埋地+容器下沉) /
 *           zhu跳舞(mofx_rig 趴地案族)
 *  [活模板] 测试跳跃不管用 / metool转GLB / 美女 / 新生成美女无皮 / 来跳舞
 *
 * 每模板 6 判据：
 *  A glbModel 加载  B sharedMixer 绑定当前模型  C idle action 运行
 *  D 轨道命中率>0  E 骨骼驱动 quatDelta>0
 *  F 蒙皮站立姿态（程序化，采样 applyBoneTransform 顶点世界包围盒）：
 *    sizeY > sizeZ*1.15（不趴倒）、minY > -0.5（不深埋）、maxY > 0.9（身高正常）
 *
 * 专项：谁到发疯 compDiag 与阶段 1 基线一致（matched=51/sunk=true/
 *       restBroken=false/willCompensate=true）
 * 汇总：修复器 3 模块在场（DuplicateBoneChainFixer/AnimConventionCompensator/BonePhysics）；
 *       world_objects#482 幻影石已删（Node 端已查 0 行，记录项）
 *
 * 用法：node scripts/accept_stage5_skeleton.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';
const OUT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_stage5');

const CT = '/uploads/character-templates';
const AL = '/uploads/anim-library';
const TEMPLATES = [
  // [名称, 模型, idle 动画, 历史案标签]
  ['线上转换的GLB', CT + '/char-1772847423638-210646326.glb', CT + '/char-1772848040795-98054925.glb', 'B类双重轴'],
  ['拿剑武士', CT + '/char-1779180094927-135896146.glb', AL + '/anim-1780048384423-799659208.glb', '副本骨骼链'],
  ['Kipfel_Mobile', CT + '/char-1788236817301-186541966.glb', AL + '/anim-1780048384423-799659208.glb', '裙子收起'],
  ['谁到发疯', CT + '/char-1788244701927-488551754.glb', AL + '/anim-1780048384423-799659208.glb', '半身埋地+容器下沉'],
  ['zhu跳舞', CT + '/char-1788426399836-76140549.glb', CT + '/char-1788426407531-583007359.glb', 'mofx_rig 趴地案族'],
  ['来跳舞', CT + '/char-1788426026946-576656940.glb', CT + '/char-1788426043178-715086088.glb', ''],
  ['美女', CT + '/char-1780048961474-732397004.glb', AL + '/anim-1780048384423-799659208.glb', ''],
  ['新生成美女无皮', CT + '/char-1780308958337-973251791.glb', AL + '/anim-1780048384423-799659208.glb', ''],
  ['metool转GLB', CT + '/char-1780047374315-163599099.glb', CT + '/char-1788055122225-439259052.glb', ''],
  ['测试跳跃不管用', CT + '/char-1779357967829-417752268.glb', CT + '/char-1779410355442-617521426.glb', ''],
];

function log(msg) { console.log('[s5] ' + msg); }
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 200) });
  log((pass ? 'PASS' : 'FAIL') + '  ' + name + '  [' + String(detail).slice(0, 160) + ']');
}

// 浏览器内采样逻辑（playwright 直接传函数引用，参数单对象）
async function SAMPLE_FN(args) {
  const gw = window.gameWorld, T = window.THREE;
  const pd = gw.players.get(args.cid);
  if (!pd) return { error: 'player not found' };
  const cg = pd.group, model = cg.userData.glbModel;
  const out = { hasModel: !!model };
  if (!model) return out;
  model.updateWorldMatrix(true, true);

  // F: 蒙皮姿态盒（applyBoneTransform 采样顶点 → 世界空间）
  const box = new T.Box3();
  let skinnedMeshes = 0, sampledVerts = 0;
  model.traverse((o) => {
    if (o.isSkinnedMesh && o.visible !== false && o.geometry && o.geometry.attributes.position) {
      skinnedMeshes++;
      const pos = o.geometry.attributes.position;
      const v = new T.Vector3();
      const stride = Math.max(1, Math.floor(pos.count / 400));
      for (let i = 0; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i);
        if (o.applyBoneTransform) { try { o.applyBoneTransform(i, v); } catch (e) {} }
        v.applyMatrix4(o.matrixWorld);
        box.expandByPoint(v);
        sampledVerts++;
      }
    }
  });
  const size = new T.Vector3(); box.getSize(size);
  out.skinBox = {
    min: [box.min.x, box.min.y, box.min.z].map((x) => +x.toFixed(2)),
    max: [box.max.x, box.max.y, box.max.z].map((x) => +x.toFixed(2)),
  };
  out.sizeY = +size.y.toFixed(2); out.sizeZ = +size.z.toFixed(2);
  out.skinnedMeshes = skinnedMeshes; out.sampledVerts = sampledVerts;

  // B/C/D: sharedMixer 与轨道命中
  const mixer = cg.userData.sharedMixer;
  out.hasMixer = !!mixer;
  if (mixer) {
    out.mixerInModel = (function () {
      if (mixer._root === model) return true;
      let inTree = false;
      model.traverse((o) => { if (o === mixer._root) inTree = true; });
      return inTree;
    })();
    const act = mixer._actions ? mixer._actions.find((a) => a.isRunning()) : null;
    out.runningAction = act ? (act._clip ? act._clip.name : '?') : null;
    if (act && act._clip) {
      const boneNames = new Set();
      model.traverse((o) => {
        if (o.isSkinnedMesh && o.skeleton) o.skeleton.bones.forEach((b) => boneNames.add(b.name.replace(/_\d+$/, '')));
      });
      const qTracks = act._clip.tracks.filter((t) => t.name.endsWith('.quaternion'));
      const hit = qTracks.filter((t) => boneNames.has(t.name.split('.')[0]));
      out.trackHit = hit.length; out.trackTotal = qTracks.length; out.uniqueBones = boneNames.size;
    }
  }

  // E: 骨骼驱动采样（间隔 800ms 两次 quaternion 比较）
  const sample = () => { const a = []; model.traverse((o) => { if (o.isBone) a.push(o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w); }); return a; };
  const s1 = sample();
  await new Promise((r) => setTimeout(r, 800));
  const s2 = sample();
  let delta = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length); i++) delta += Math.abs(s1[i] - s2[i]);
  out.boneQuatDelta = +delta.toFixed(5);
  out.boneCount = s1.length / 4;

  // 归因记录：补偿器诊断 + 修复器在场
  try { if (window.AnimConventionCompensator && window.AnimConventionCompensator._diag) out.compDiag = window.AnimConventionCompensator._diag(model); } catch (e) { out.compDiag = { error: String(e && e.message) }; }
  return out;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const login = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  }).then((r) => r.json());
  if (!login.token) throw new Error('admin login failed');

  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  let curTag = 'startup';
  global.__curTag = () => curTag;

  try {
    const p0 = await context.newPage();
    await p0.goto(BASE + '/admin_login.html', { waitUntil: 'domcontentloaded' });
    await p0.evaluate((d) => {
      localStorage.setItem('adminToken', d.token);
      localStorage.setItem('adminUser', JSON.stringify(d.adminUser || { username: 'baseline_shot' }));
    }, login);
    await p0.close();

    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('[' + curTag + '] ' + m.text().slice(0, 220)); });
    page.on('pageerror', (e) => errors.push('[' + curTag + '] PAGEERROR: ' + String(e.message).slice(0, 150) + ' STACK: ' + String(e.stack || '').replace(/\n/g, ' <- ').slice(0, 600)));

    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 40000 });
    await page.waitForSelector('#canvas', { timeout: 15000 });
    await page.evaluate(() => { const b = document.getElementById('close-controls-hint'); if (b) b.click(); });
    await page.waitForTimeout(22000);

    // L0: 修复器模块在场（骨骼套件完整性）
    const l0 = await page.evaluate(() => ({
      rev: window.THREE ? window.THREE.REVISION : null,
      dup: !!window.DuplicateBoneChainFixer,
      comp: !!window.AnimConventionCompensator,
      compVer: window.AnimConventionCompensator && window.AnimConventionCompensator.version,
      phy: !!window.BonePhysics,
    }));
    log('L0 modules: ' + JSON.stringify(l0));
    check('L0 THREE.REVISION=185', l0.rev === '185', l0.rev);
    check('L0 duplicateBoneChainFixer present', l0.dup, 'loaded=' + l0.dup);
    check('L0 animConventionCompensator present', l0.comp, 'loaded=' + l0.comp + ' v=' + l0.compVer);
    check('L0 bone-physics present', l0.phy, 'loaded=' + l0.phy);

    // 每模板回归
    for (let i = 0; i < TEMPLATES.length; i++) {
      const [tname, glb, idle, tag] = TEMPLATES[i];
      const cid = 's5-' + i;
      curTag = 'T' + (i + 1) + ':' + tname;
      log('--- T' + (i + 1) + ': ' + tname + (tag ? ' [' + tag + ']' : '') + ' ---');
      await page.evaluate(({ cid, glb, px }) => {
        window.gameWorld.addPlayer(cid, 's5验收', { x: px, y: 0, z: 6 }, false, glb);
      }, { cid, glb, px: 6 + i * 2 });
      // 轮询等待模型就绪（大模型 40MB 在 swiftshader 下加载 20-40s）
      let loaded = false;
      for (let w = 0; w < 24; w++) {
        loaded = await page.evaluate(({ cid }) => {
          const pd = window.gameWorld.players.get(cid);
          return !!(pd && pd.group && pd.group.userData.glbModel);
        }, { cid });
        if (loaded) { log('  model ready after ~' + ((w + 1) * 2) + 's'); break; }
        await page.waitForTimeout(2000);
      }
      if (!loaded) log('  model NOT ready within 48s');
      await page.evaluate(({ cid, url }) => { window.gameWorld._loadPlayerAnimGlb(cid, 'idle', url); }, { cid, url: idle });
      await page.waitForTimeout(7000);

      const r = await page.evaluate(SAMPLE_FN, { cid });
      log('T' + (i + 1) + ' info: ' + JSON.stringify(r).slice(0, 500));

      const P = 'T' + (i + 1) + ' ' + tname;
      check(P + ' A glbModel loaded', r.hasModel === true, JSON.stringify(r).slice(0, 80));
      if (r.hasModel) {
        check(P + ' B mixer bound to current model', r.hasMixer && r.mixerInModel, 'mixer=' + r.hasMixer + ' inTree=' + r.mixerInModel);
        check(P + ' C idle action running', !!r.runningAction, 'action=' + r.runningAction);
        check(P + ' D track hit-rate > 0', (r.trackHit || 0) > 0, 'hit=' + r.trackHit + '/' + r.trackTotal + ' uniqueBones=' + r.uniqueBones);
        check(P + ' E bones driven', (r.boneQuatDelta || 0) > 0.0001, 'delta=' + r.boneQuatDelta + ' bones=' + r.boneCount);
        const sb = r.skinBox || { min: [], max: [] };
        const stand = r.sizeY > r.sizeZ * 1.15 && sb.min[1] > -0.5 && sb.max[1] > 0.9;
        check(P + ' F standing pose (skin box)', stand,
          'sizeY=' + r.sizeY + ' sizeZ=' + r.sizeZ + ' minY=' + sb.min[1] + ' maxY=' + sb.max[1] + ' meshes=' + r.skinnedMeshes + ' verts=' + r.sampledVerts);
      }
      // 专项：谁到发疯 compDiag 与阶段 1 基线一致
      if (tname === '谁到发疯') {
        const d = r.compDiag || {};
        check(P + ' special compDiag baseline (matched=51 sunk willCompensate !restBroken)',
          d.matched === 51 && d.sunk === true && d.restBroken === false && d.willCompensate === true,
          'matched=' + d.matched + ' sunk=' + d.sunk + ' restBroken=' + d.restBroken + ' willCompensate=' + d.willCompensate);
      }

      // 相机对准角色截图（目检证据）
      await page.evaluate(({ px }) => {
        if (window.player && window.player.position) {
          window.player.position.set(px, 0, 14);
          if (window.player.rotation) window.player.rotation.set(0, 0, 0);
        }
      }, { px: 6 + i * 2 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(OUT_DIR, 's5_T' + (i + 1) + '_' + tname.replace(/[^\w\u4e00-\u9fa5]+/g, '_') + '.png') });

      // 清场（避免模型累积拖慢后续）
      await page.evaluate(({ cid }) => { window.gameWorld.removePlayer(cid); }, { cid });
      await page.waitForTimeout(1200);
    }

    // world_objects#482 幻影石案：确认不复发（Node 端已查 0 行；此处检查浏览器场景无 LittlestTokyo 幻影）
    const l482 = await page.evaluate(() => {
      let found = false;
      window.gameWorld.scene.traverse((o) => { if (o.name && o.name.indexOf('20260708') >= 0) found = true; });
      return found;
    });
    check('T-phantom stone #482 not resurrected', l482 === false, 'scene contains 20260708 = ' + l482);

    // 汇总错误（过滤浏览器扩展噪音）
    const realErrors = errors.filter((t) => !/runtime\\.lastError|index\\.global\\.js|ResizeObserver|Failed to load resource/i.test(t));
    check('ALL console/page errors = 0', realErrors.length === 0, realErrors.length ? realErrors.slice(0, 8).join(' || ') : '0');

    await page.close();
  } finally {
    await browser.close();
  }

  console.log('\\n===== STAGE 5 SKELETON ACCEPTANCE =====');
  let failed = 0;
  for (const r of results) { console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  [' + r.detail + ']'); if (!r.pass) failed++; }
  console.log('===== ' + (results.length - failed) + '/' + results.length + ' passed =====');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('[s5] FATAL', e); process.exit(1); });
