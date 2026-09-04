/**
 * r185 升级阶段 5 验收（会话 9）—— FBX r184 up-axis 行为实测
 * ------------------------------------------------------------------
 * 验收口径（规范第六节阶段 5 ②）：FBX r184 起 FBXLoader 自动 +Z-up→+Y-up 转换，
 * Mixamo FBX 动画套 GLB 模型姿态正确（不躺倒/不歪斜）。
 *
 * 用 Mixamo FBX 套标准 mixamo 骨架 GLB（拿剑武士，P/K 零干预模型），
 * 若 up-axis 转换异常 → 蒙皮渲染盒躺倒（sizeZ >> sizeY）或骨骼世界轴向错误。
 *
 * 用法：node scripts/accept_stage5_fbx.js
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:3002';
const OUT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_stage5');

// Mixamo FBX 样本（骨骼名 mixamorig*，与拿剑武士 GLB 同约定）
const MODEL = '/uploads/character-templates/char-1779180094927-135896146.glb';
const FBX_LIST = [
  ['fbx1', '/uploads/anim-library/anim-1779263475939-548011705.fbx'],
  ['fbx2', '/uploads/anim-library/anim-1779266358942-3366866.fbx'],
];

function log(msg) { console.log('[s5fbx] ' + msg); }
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 200) });
  log((pass ? 'PASS' : 'FAIL') + '  ' + name + '  [' + String(detail).slice(0, 160) + ']');
}

async function SAMPLE_FN(args) {
  const gw = window.gameWorld, T = window.THREE;
  const pd = gw.players.get(args.cid);
  if (!pd) return { error: 'player not found' };
  const cg = pd.group, model = cg.userData.glbModel;
  const out = { hasModel: !!model };
  if (!model) return out;
  model.updateWorldMatrix(true, true);

  // 蒙皮姿态盒（applyBoneTransform 采样）
  const box = new T.Box3();
  let meshes = 0, verts = 0;
  model.traverse((o) => {
    if (o.isSkinnedMesh && o.visible !== false && o.geometry && o.geometry.attributes.position && o.geometry.attributes.skinIndex) {
      meshes++;
      const pos = o.geometry.attributes.position;
      const v = new T.Vector3();
      const stride = Math.max(1, Math.floor(pos.count / 400));
      for (let i = 0; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i);
        try { o.applyBoneTransform(i, v); } catch (e) {}
        v.applyMatrix4(o.matrixWorld);
        box.expandByPoint(v);
        verts++;
      }
    }
  });
  const size = new T.Vector3(); box.getSize(size);
  out.skinBox = {
    min: [box.min.x, box.min.y, box.min.z].map((x) => +x.toFixed(2)),
    max: [box.max.x, box.max.y, box.max.z].map((x) => +x.toFixed(2)),
  };
  out.sizeY = +size.y.toFixed(2); out.sizeZ = +size.z.toFixed(2);
  out.meshes = meshes; out.verts = verts;

  // 骨骼轴向：脊柱骨世界位置沿 +Y 排布（up-axis 错转会沿 Z）
  const spine = [];
  model.traverse((o) => { if (o.isBone && /^(mixamorig)?(Hips|Spine|Head)$/.test(o.name)) spine.push([o.name, +o.getWorldPosition(new T.Vector3()).y.toFixed(2), +o.getWorldPosition(new T.Vector3()).z.toFixed(2)]); });
  out.spine = spine;

  // mixer/action/轨道命中
  const mixer = cg.userData.sharedMixer;
  out.hasMixer = !!mixer;
  if (mixer) {
    const act = mixer._actions ? mixer._actions.find((a) => a.isRunning()) : null;
    out.runningAction = act ? act._clip.name : null;
    if (act && act._clip) {
      const boneNames = new Set();
      model.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.bones.forEach((b) => boneNames.add(b.name.replace(/_\d+$/, ''))); });
      const qTracks = act._clip.tracks.filter((t) => t.name.endsWith('.quaternion'));
      out.trackHit = qTracks.filter((t) => boneNames.has(t.name.split('.')[0])).length;
      out.trackTotal = qTracks.length;
    }
  }
  // 骨骼驱动
  const s1 = (function () { const a = []; model.traverse((o) => { if (o.isBone) a.push(o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w); }); return a; })();
  await new Promise((r) => setTimeout(r, 800));
  const s2 = (function () { const a = []; model.traverse((o) => { if (o.isBone) a.push(o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w); }); return a; })();
  let delta = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length); i++) delta += Math.abs(s1[i] - s2[i]);
  out.boneQuatDelta = +delta.toFixed(5);
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  try {
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 200)));

    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 40000 });
    await page.waitForSelector('#canvas', { timeout: 15000 });
    await page.evaluate(() => { const b = document.getElementById('close-controls-hint'); if (b) b.click(); });
    await page.waitForTimeout(22000);

    const rev = await page.evaluate(() => window.THREE.REVISION);
    check('FBX0 THREE.REVISION=185', rev === '185', rev);

    for (let i = 0; i < FBX_LIST.length; i++) {
      const [tag, fbxUrl] = FBX_LIST[i];
      const cid = 's5fbx-' + i;
      log('--- ' + tag + ': ' + fbxUrl + ' ---');
      await page.evaluate(({ cid, glb }) => {
        window.gameWorld.addPlayer(cid, 'fbx验收', { x: 6, y: 0, z: 6 }, false, glb);
      }, { cid, glb: MODEL });
      for (let w = 0; w < 20; w++) {
        const ok = await page.evaluate(({ cid }) => {
          const pd = window.gameWorld.players.get(cid);
          return !!(pd && pd.group && pd.group.userData.glbModel);
        }, { cid });
        if (ok) break;
        await page.waitForTimeout(2000);
      }
      await page.evaluate(({ cid, url }) => { window.gameWorld._loadPlayerAnimGlb(cid, 'idle', url); }, { cid, url: fbxUrl });
      await page.waitForTimeout(9000); // FBXLoader ESM 动态加载 + clip 处理

      const r = await page.evaluate(SAMPLE_FN, { cid });
      log(tag + ' info: ' + JSON.stringify(r).slice(0, 460));

      const P = tag + ' ' + path.basename(fbxUrl);
      check(P + ' model loaded', r.hasModel === true, 'hasModel=' + r.hasModel);
      check(P + ' mixer bound + fbx action running', r.hasMixer && !!r.runningAction, 'action=' + r.runningAction);
      check(P + ' track hit-rate > 0', (r.trackHit || 0) > 0, 'hit=' + r.trackHit + '/' + r.trackTotal);
      check(P + ' bones driven', (r.boneQuatDelta || 0) > 0.0001, 'delta=' + r.boneQuatDelta);
      // 姿态判定：站立（不躺不深埋）——r184 up-axis 转换正确性的权威判据
      const sb = r.skinBox || { min: [], max: [] };
      const stand = r.sizeY > r.sizeZ * 1.15 && sb.min[1] > -0.5 && sb.max[1] > 0.9;
      check(P + ' standing pose (up-axis correct)', stand,
        'sizeY=' + r.sizeY + ' sizeZ=' + r.sizeZ + ' minY=' + sb.min[1] + ' maxY=' + sb.max[1]);
      // 脊柱沿 Y：Head.y > Spine.y > Hips.y（up-axis 错转时脊柱沿 Z）
      if (r.spine && r.spine.length >= 3) {
        const byName = {}; r.spine.forEach(([n, y, z]) => byName[n] = { y, z });
        const h = byName['mixamorigHips'] || byName['Hips'], s = byName['mixamorigSpine'] || byName['Spine'], hd = byName['mixamorigHead'] || byName['Head'];
        if (h && s && hd) {
          check(P + ' spine axis along +Y', hd.y > s.y && s.y > h.y && (hd.y - h.y) > 0.3,
            'Hips.y=' + h.y + ' Spine.y=' + s.y + ' Head.y=' + hd.y + ' Head.z=' + hd.z);
        }
      }

      await page.evaluate(({ px }) => {
        if (window.player && window.player.position) { window.player.position.set(px, 0, 14); if (window.player.rotation) window.player.rotation.set(0, 0, 0); }
      }, { px: 6 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(OUT_DIR, 's5fbx_' + tag + '.png') });
      await page.evaluate(({ cid }) => { window.gameWorld.removePlayer(cid); }, { cid });
      await page.waitForTimeout(1000);
    }

    const realErrors = errors.filter((t) => !/runtime\.lastError|index\.global\.js|ResizeObserver|Failed to load resource/i.test(t));
    check('ALL console/page errors = 0', realErrors.length === 0, realErrors.length ? realErrors.slice(0, 6).join(' || ') : '0');
    await page.close();
  } finally {
    await browser.close();
  }

  console.log('\n===== STAGE 5 FBX ACCEPTANCE =====');
  let failed = 0;
  for (const r of results) { console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  [' + r.detail + ']'); if (!r.pass) failed++; }
  console.log('===== ' + (results.length - failed) + '/' + results.length + ' passed =====');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('[s5fbx] FATAL', e); process.exit(1); });
