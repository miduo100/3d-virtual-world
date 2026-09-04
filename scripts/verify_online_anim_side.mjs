/**
 * 验证修复方向：「动画侧根骨轴向偏移」补偿（只读，不改程序文件）
 * 现象：线上转换的GLB 归一后 rest 站立，但播放仍躺倒
 * 怀疑：动画 clip 的 Hips 值烘死了 -90°X（动画文件自身也是 Armature+90°X 的角色 GLB）
 * 做法：测量 clip 的 Hips 值相对模型 Hips 绑定的偏移角；试做反向补偿后看是否站立
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { createElementNS: () => ({ style: {}, getContext: () => null }), createElement: () => ({ style: {}, getContext: () => null }) };
}
const origErr = console.error;
console.error = (...a) => { if (!/Couldn't load texture/.test(String(a[0] || ''))) origErr(...a); };
globalThis.THREE = THREE;

const moduleSrc = fs.readFileSync(path.join(ROOT, 'public/js/animConventionCompensator.js'), 'utf8');
(0, eval)(moduleSrc);
const Comp = globalThis.window.AnimConventionCompensator;

const MODEL = 'public/uploads/character-templates/char-1772847423638-210646326.glb';
const ANIM_IDLE = 'public/uploads/character-templates/char-1772848040795-98054925.glb';
const ANIM_WALK = 'public/uploads/character-templates/char-1774260405787-934220533.glb';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
async function loadGLB(rel) {
  const b = fs.readFileSync(path.join(ROOT, rel));
  return new Promise((res, rej) => loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej));
}
const angleDeg = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI;
const f3 = (x) => x.toFixed(3);

function skinnedBox(root, step = 5) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3(), tmp = new THREE.Vector3(), acc = new THREE.Vector3();
  root.traverse(m => {
    if (!m.isSkinnedMesh || !m.geometry.attributes.position) return;
    const pos = m.geometry.attributes.position;
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    if (!si || !sw) return;
    const bm = m.skeleton.bones.map((bn, i) => bn.matrixWorld.clone().multiply(m.skeleton.boneInverses[i]));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w <= 0) continue;
        const mm = bm[si.getComponent(i, k)];
        if (!mm) continue;
        tmp.copy(v).applyMatrix4(mm).multiplyScalar(w);
        acc.add(tmp);
      }
      acc.applyMatrix4(m.matrixWorld);
      box.expandByPoint(acc);
    }
  });
  return box;
}
function verdict(b) {
  const sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
  if (Math.max(sy, sz) < 0.05) return 'tiny';
  if (sy > sz * 1.15) return 'stand';
  if (sz > sy * 1.15) return 'lie';
  return 'amb';
}
function makeApplier(root) {
  const restQ = new Map(), restP = new Map();
  root.traverse(n => { restQ.set(n, n.quaternion.clone()); restP.set(n, n.position.clone()); });
  const byName = new Map();
  root.traverse(n => { if (n.isBone && n.name) byName.set(n.name, n); });
  return {
    restore() { root.traverse(n => { const q = restQ.get(n); if (q) n.quaternion.copy(q); const p = restP.get(n); if (p) n.position.copy(p); }); root.updateMatrixWorld(true); },
    apply(clip, t) {
      this.restore();
      clip.tracks.forEach(tt => {
        if (!tt.name.endsWith('.quaternion')) return;
        const b = byName.get(tt.name.slice(0, -11));
        if (!b) return;
        const ta = tt.times, v = tt.values;
        if (ta.length === 1) { b.quaternion.set(v[0], v[1], v[2], v[3]); return; }
        let i = 0;
        while (i < ta.length - 1 && ta[i + 1] < t) i++;
        const a = ta[i + 1] > ta[i] ? Math.max(0, Math.min(1, (t - ta[i]) / (ta[i + 1] - ta[i]))) : 0;
        const qa = new THREE.Quaternion(v[i*4], v[i*4+1], v[i*4+2], v[i*4+3]);
        const qb = new THREE.Quaternion(v[i*4+4], v[i*4+5], v[i*4+6], v[i*4+7]);
        qa.slerp(qb, a);
        b.quaternion.copy(qa);
      });
      root.updateMatrixWorld(true);
    }
  };
}
function show(tag, box) {
  const v = verdict(box);
  console.log('  ' + tag.padEnd(30) + v.padEnd(6) + ' 高=' + f3(box.max.y - box.min.y) + ' Y[' + f3(box.min.y) + ',' + f3(box.max.y) + '] Z[' + f3(box.min.z) + ',' + f3(box.max.z) + ']');
  return v;
}

// 归一后的模型
const root = (await loadGLB(MODEL)).scene;
root.updateMatrixWorld(true);
Comp._diag(root);                 // 执行归一
const app = makeApplier(root);    // 归一后快照
show('归一后 rest', skinnedBox(root));

// 模型 Hips 绑定局部旋转（归一后应为标准：≈单位）
let hips = null;
root.traverse(n => { if (n.isBone && n.name === 'mixamorigHips') hips = n; });
const hipsBindLocal = hips.quaternion.clone();
console.log('\n模型 Hips 绑定局部旋转（归一后）= (' + hipsBindLocal.toArray().map(x => x.toFixed(4)).join(',') + ') 角度=' + angleDeg(hipsBindLocal).toFixed(1) + '°');

for (const [k, rel] of [['idle', ANIM_IDLE], ['walk', ANIM_WALK]]) {
  const gm = await loadGLB(rel);
  const clip = gm.animations[0];
  const hipsTrack = clip.tracks.find(t => t.name === 'mixamorigHips.quaternion');
  if (!hipsTrack) { console.log(k + ': 无 Hips 轨道'); continue; }
  const n = hipsTrack.times.length;
  const vals = [];
  for (let i = 0; i < n; i++) vals.push(new THREE.Quaternion(hipsTrack.values[i*4], hipsTrack.values[i*4+1], hipsTrack.values[i*4+2], hipsTrack.values[i*4+3]));
  // 相对模型 Hips 绑定的偏移角（逐帧）
  const devs = vals.map(q => angleDeg(hipsBindLocal.clone().invert().multiply(q)));
  const min = Math.min(...devs), max = Math.max(...devs);
  const avg = devs.reduce((s, x) => s + x, 0) / devs.length;
  console.log('\n' + k + ': Hips 轨道 ' + n + ' 帧，相对模型绑定的偏移角 min=' + min.toFixed(1) + '° max=' + max.toFixed(1) + '° avg=' + avg.toFixed(1) + '°');
  console.log('  首帧 Hips 值 = (' + vals[0].toArray().map(x => x.toFixed(4)).join(',') + ')');

  // 试补偿：用「偏移的逆」左乘整个 Hips 轨道（估 neutral = 平均四元数）
  let acc = new THREE.Quaternion(0, 0, 0, 0);
  vals.forEach(q => { acc.x += q.x; acc.y += q.y; acc.z += q.z; acc.w += q.w; });
  const mean = new THREE.Quaternion(acc.x, acc.y, acc.z, acc.w).normalize();
  const corr = hipsBindLocal.clone().multiply(mean.clone().invert());
  console.log('  补偿量 corr = modelBind × mean⁻¹，角度=' + angleDeg(corr).toFixed(1) + '°');
  const fixed = clip.clone();
  fixed.tracks.forEach(tt => {
    if (tt.name !== 'mixamorigHips.quaternion') return;
    const vv = tt.values.slice();
    const q = new THREE.Quaternion();
    for (let i = 0; i < tt.times.length; i++) {
      q.set(tt.values[i*4], tt.values[i*4+1], tt.values[i*4+2], tt.values[i*4+3]);
      const q2 = corr.clone().multiply(q);
      vv[i*4] = q2.x; vv[i*4+1] = q2.y; vv[i*4+2] = q2.z; vv[i*4+3] = q2.w;
    }
    tt.values = vv;
  });
  app.apply(clip, clip.duration * 0.5);
  show('  原动画播放', skinnedBox(root));
  app.apply(fixed, clip.duration * 0.5);
  show('  Hips补偿后播放', skinnedBox(root));
}
app.restore();
console.log('\n验证结束');
