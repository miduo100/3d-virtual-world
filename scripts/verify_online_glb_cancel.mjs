/**
 * 验证「线上转换的GLB」：模型 +90°X 与动画烘死的 -90° 是否互相抵消（自洽对）
 * A 实例：不动模型 → 测 rest 渲染 / 原始动画播放渲染
 * B 实例：执行模块归一（下沉）→ 再测 rest 渲染 / 原始动画播放渲染
 * 目的：判断下沉归一对该模板是改善还是破坏（只读，不改程序文件）
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

const f3 = (x) => x.toFixed(3);
function rawBox(m) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); return m.geometry.boundingBox; }
function worldBox(m, bb) {
  const out = new THREE.Box3();
  const c = new THREE.Vector3();
  for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
    c.set(ix ? bb.max.x : bb.min.x, iy ? bb.max.y : bb.min.y, iz ? bb.max.z : bb.min.z);
    out.expandByPoint(c.applyMatrix4(m.matrixWorld));
  }
  return out;
}
function verdict(b) {
  const sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
  if (Math.max(sy, sz) < 0.05) return 'tiny';
  if (sy > sz * 1.15) return 'stand';
  if (sz > sy * 1.15) return 'lie';
  return 'amb';
}
/** 蒙皮渲染盒（权威口径） */
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
function makeApplier(root) {
  const restQ = new Map(), restP = new Map();
  root.traverse(n => { restQ.set(n, n.quaternion.clone()); restP.set(n, n.position.clone()); });
  const byName = new Map();
  root.traverse(n => { if (n.isBone && n.name) byName.set(n.name, n); });
  return {
    restore() { root.traverse(n => { const q = restQ.get(n); if (q) n.quaternion.copy(q); const p = restP.get(n); if (p) n.position.copy(p); }); root.updateMatrixWorld(true); },
    apply(clip, t) {
      this.restore();
      let hits = 0;
      clip.tracks.forEach(tt => {
        if (!tt.name.endsWith('.quaternion')) return;
        const b = byName.get(tt.name.slice(0, -11));
        if (!b) return;
        hits++;
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
      return hits;
    }
  };
}
function show(tag, box) {
  const v = verdict(box);
  console.log('  ' + tag.padEnd(26) + v.padEnd(6) +
    ' Y[' + f3(box.min.y) + ',' + f3(box.max.y) + '] 高=' + f3(box.max.y - box.min.y) +
    ' Z[' + f3(box.min.z) + ',' + f3(box.max.z) + ']');
  return v;
}

const clips = {};
for (const [k, rel] of [['idle', ANIM_IDLE], ['walk', ANIM_WALK]]) {
  clips[k] = (await loadGLB(rel)).animations[0];
}

// ═════ 实例 A：不干预（当前模块改动前的状态）═════
console.log('\n════════ A：模型不做任何处理（改动前行为）════════');
{
  const root = (await loadGLB(MODEL)).scene;
  root.updateMatrixWorld(true);
  const app = makeApplier(root);
  app.restore();
  show('rest 渲染', skinnedBox(root));
  for (const k of ['idle', 'walk']) {
    const c = clips[k];
    const hits = app.apply(c, c.duration * 0.5);
    show(k + ' 播放(原始值,命中' + hits + '骨)', skinnedBox(root));
  }
  app.restore();
}

// ═════ 实例 B：执行模块归一 + 补偿（改动后行为）═════
console.log('\n════════ B：模块 v2 归一 + 补偿（改动后行为）════════');
{
  const root = (await loadGLB(MODEL)).scene;
  root.updateMatrixWorld(true);
  // 注意：applier 必须在归一【之后】创建，否则 restore() 会把归一撤销（v1 的坑）
  // 触发模块归一（_diag 会执行 getModelBind → normalizeContainers）
  const dg = Comp._diag(root);
  console.log('  _diag: ' + JSON.stringify(dg));
  const app = makeApplier(root); // ← 归一后快照 rest
  show('归一后 rest 渲染', skinnedBox(root));

  for (const k of ['idle', 'walk']) {
    // ① 原始动画值（未经补偿）
    const cRaw = (await loadGLB(k === 'idle' ? ANIM_IDLE : ANIM_WALK)).animations[0];
    app.apply(cRaw, cRaw.duration * 0.5);
    show(k + ' 播放(原始值)', skinnedBox(root));
    // ② 经模块补偿后的值
    const cComp = (await loadGLB(k === 'idle' ? ANIM_IDLE : ANIM_WALK)).animations[0];
    const r = Comp.processClip(cComp, root, k);
    app.apply(cComp, cComp.duration * 0.5);
    show(k + ' 播放(补偿后,' + (r.compensated ? '已补偿' : '未补偿') + ')', skinnedBox(root));
  }
  app.restore();
}

// ═════ 补充：模型自带的内嵌 clip 在归一前后的表现（决定性判据）═════
console.log('\n════════ C：模型内嵌 clip（与模型同文件，天然自洽对）════════');
for (const doSink of [false, true]) {
  const gm = await loadGLB(MODEL);
  const root = gm.scene;
  root.updateMatrixWorld(true);
  if (doSink) { Comp._diag(root); }             // 触发归一
  const app = makeApplier(root);                 // 归一后快照
  const clip = gm.animations[0];
  console.log((doSink ? '  [归一后]' : '  [原始] ') + 'clip=' + clip.name +
    ' 时长=' + clip.duration.toFixed(2) + 's 轨道=' + clip.tracks.length);
  show('    rest', skinnedBox(root));
  for (const frac of [0.1, 0.5, 0.9]) {
    const t = Math.min(frac * clip.duration, Math.max(0, clip.duration - 0.01));
    app.apply(clip, t);
    show('    t=' + t.toFixed(2), skinnedBox(root));
  }
  app.restore();
}

console.log('\n════ 结论提示 ════');
console.log('  若 A/C 的「播放」= stand 而 B 的「播放」= lie → 模型+动画原本互相抵消（自洽对），');
console.log('  下沉归一拆掉了模型那半导致失衡 → 归一前必须判断动画是否已抵消（应跳过归一）。');
console.log('  若 A 与 B 播放都 = lie，说明动画本身携带轴向偏移（动画文件也是带 Armature+90 的角色 GLB），');
console.log('  需要「动画侧轴向补偿」——本模块目前只看模型侧，看不到动画文件自身的骨架链。');
