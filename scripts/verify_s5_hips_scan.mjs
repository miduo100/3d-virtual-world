/**
 * 阶段5前置侦察（只读）：10 模板 idle 动画 Hips 轨道 vs 归一后模型 Hips bind 的偏移统计
 * 目的：确认「窄幅大偏移」（动画侧容器轴向）特征只命中线上转换的GLB，不误伤其他模板
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
const angleDeg = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI;

function findHips(root) {
  let hips = null;
  root.traverse((n) => { if (n.isBone && /hips/i.test(n.name) && !hips) hips = n; });
  return hips;
}

console.log('模板                     | sunk | Hips轨 | 偏移avg  min   max   幅宽  | 判定');
console.log('-'.repeat(96));
for (const [name, modelRel, animRel] of CASES) {
  try {
    const gm = await loadGLB(modelRel);
    const root = gm.scene;
    root.updateMatrixWorld(true);
    const diag = Comp._diag(root); // 副作用：触发归一（若有）
    const hips = findHips(root);
    if (!hips) { console.log(name.padEnd(24) + ' | 无Hips骨'); continue; }
    const bind = hips.quaternion.clone();

    const ga = await loadGLB(animRel);
    const clip = ga.animations[0];
    // 动画文件骨架链的容器旋转（关键：动画侧是否有 Armature 类 +90 父链）
    let animContainerRot = 'I';
    const animHips = findHips(ga.scene);
    if (animHips && animHips.parent && !animHips.parent.isBone) {
      const a = angleDeg(animHips.parent.quaternion);
      animContainerRot = a > 5 ? a.toFixed(0) + '°' : 'I';
    }
    const track = clip.tracks.find((t) => t.name === hips.name + '.quaternion' || /hips/i.test(t.name) && t.name.endsWith('.quaternion'));
    if (!track) { console.log(name.padEnd(24) + ' | ' + String(diag.sunk) + ' | 无Hips轨道 | anim容器=' + animContainerRot); continue; }
    const n = track.times.length;
    const devs = [];
    for (let i = 0; i < n; i++) {
      const q = new THREE.Quaternion(track.values[i * 4], track.values[i * 4 + 1], track.values[i * 4 + 2], track.values[i * 4 + 3]);
      devs.push(angleDeg(bind.clone().invert().multiply(q)));
    }
    const min = Math.min(...devs), max = Math.max(...devs);
    const avg = devs.reduce((s, x) => s + x, 0) / devs.length;
    const narrow = (max - min) < 12, big = avg > 45;
    const verdict = narrow && big ? '★命中(动画侧轴向)' : 'ok';
    console.log(name.padEnd(24) + ' | ' + String(diag.sunk).padEnd(4) + ' | ' + String(n).padEnd(6) + ' | ' + avg.toFixed(1).padEnd(6) + ' ' + min.toFixed(1).padEnd(6) + ' ' + max.toFixed(1).padEnd(6) + ' ' + (max - min).toFixed(1).padEnd(5) + ' | ' + verdict + ' (anim容器=' + animContainerRot + ')');
  } catch (e) {
    console.log(name.padEnd(24) + ' | ERR ' + e.message.slice(0, 60));
  }
}
console.log('\n判据：窄幅(<12°)且大偏移(>45°) = 动画侧容器轴向特征（候选补偿层触发条件）');
