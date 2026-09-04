/**
 * 阶段5验证（模块 v2.1 动画侧容器轴向补偿）：全 10 模板走真实 processClip 流程，
 * 验证 ①线上转换的GLB axisFixed 触发且播放 stand ②其余模板零干预不劣化
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
console.log('module version = ' + Comp.version);

const CT = 'public/uploads/character-templates';
const AL = 'public/uploads/anim-library';
const CASES = [
  ['线上转换的GLB', CT + '/char-1772847423638-210646326.glb', CT + '/char-1772848040795-98054925.glb'],
  ['拿剑武士', CT + '/char-1779180094927-135896146.glb', AL + '/anim-1780048384423-799659208.glb'],
  ['Kipfel_Mobile', CT + '/char-1788236817301-186541966.glb', AL + '/anim-1780048384423-799659208.glb'],
  ['谁到发疯', CT + '/char-1788244701927-488551754.glb', AL + '/anim-1780048384423-799659208.glb'],
  ['zhu跳舞', CT + '/char-1788426399836-76140549.glb', CT + '/char-1788426407531-583007359.glb'],
  ['来跳舞', CT + '/char-1788426026946-576656940.glb', CT + '/char-1788426043178-715086088.glb'],
  ['美女', CT + '/char-1780048961474-732397004.glb', AL + '/anim-1780048384423-799659208.glb'],
  ['新生成美女无皮', CT + '/char-1780308958337-973251791.glb', AL + '/anim-1780048384423-799659208.glb'],
  ['metool转GLB', CT + '/char-1780047374315-163599099.glb', CT + '/char-1788055122225-439259052.glb'],
  ['测试跳跃不管用', CT + '/char-1779357967829-417752268.glb', CT + '/char-1779410355442-617521426.glb'],
];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
async function loadGLB(rel) {
  const b = fs.readFileSync(path.join(ROOT, rel));
  return new Promise((res, rej) => loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej));
}

function skinnedBox(root, step = 6) {
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
    apply(clip, t) {
      root.traverse(n => { const q = restQ.get(n); if (q) n.quaternion.copy(q); const p = restP.get(n); if (p) n.position.copy(p); });
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

let pass = 0, fail = 0;
console.log('模板                 | rest  | 模块result                    | 播放@50% | 判定');
console.log('-'.repeat(100));
for (const [name, modelRel, animRel] of CASES) {
  try {
    const gm = await loadGLB(modelRel);
    const root = gm.scene;
    root.updateMatrixWorld(true);
    const diag = Comp._diag(root); // 副作用：归一（若触发）

    const ga = await loadGLB(animRel);
    const clip = ga.animations[0];
    const res = Comp.processClip(clip, root, 'idle');

    const app = makeApplier(root);
    app.apply(clip, clip.duration * 0.5);
    const v = verdict(skinnedBox(root));

    let ok;
    if (name === '线上转换的GLB') {
      ok = v === 'stand' && (res.axisFixed || 0) > 0;
    } else {
      ok = v !== 'lie' && (res.axisFixed || 0) === 0; // 不躺 + 零轴向干预
    }
    ok ? pass++ : fail++;
    console.log(name.padEnd(20) + ' | ' + (diag.sunk ? 'sunk ' : '     ') + ' | ' +
      JSON.stringify(res).slice(0, 44).padEnd(44) + ' | ' + v.padEnd(8) + ' | ' + (ok ? 'PASS' : 'FAIL'));
  } catch (e) {
    fail++;
    console.log(name.padEnd(20) + ' | ERR ' + e.message.slice(0, 70));
  }
}
console.log('\n===== ' + pass + '/' + (pass + fail) + ' passed =====');
process.exit(fail ? 1 : 0);
