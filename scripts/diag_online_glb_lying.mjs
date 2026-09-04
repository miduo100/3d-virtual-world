/**
 * 诊断「线上转换的GLB」模板躺倒：托底模块为何没生效（只读，不改任何程序文件）
 * 检查项：
 *  1. 模板配置（模型 URL / 动画 URL / 平台）
 *  2. 模型 GLB：骨骼命名、骨骼数、顶层节点、容器旋转、网格父链、内嵌动画
 *  3. 动画 GLB（该模板的 idle/walk/run 是完整角色 GLB）：骨骼/动画/皮肤
 *  4. rest 渲染姿态判据 + 模块实际判定（_diag / processClip）
 *  5. 播放模拟：原始动画 vs 补偿后动画的渲染姿态
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';
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

// 加载线上模块（只读评估其行为）
const moduleSrc = fs.readFileSync(path.join(ROOT, 'public/js/animConventionCompensator.js'), 'utf8');
(0, eval)(moduleSrc);
const Comp = globalThis.window.AnimConventionCompensator;
console.log('模块加载 OK, version=' + Comp.version);

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'virtual_world', user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});
const tr = await pool.query(
  `SELECT name, glb_url, anim_idle_url, anim_walk_url, anim_run_url, anim_mode, model_source_platform
   FROM character_templates WHERE name LIKE '%线上转换%'`);
await pool.end();
if (!tr.rows.length) { console.log('未找到「线上转换的GLB」模板'); process.exit(1); }
const tpl = tr.rows[0];
console.log('\n══ 模板配置 ══');
Object.entries(tpl).forEach(([k, v]) => console.log('  ' + k + ' = ' + v));

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
async function loadGLB(rel) {
  const fp = path.join(ROOT, 'public', String(rel).replace(/^\//, ''));
  if (!fs.existsSync(fp)) { console.log('  ⚠️ 文件不存在: ' + fp); return null; }
  const b = fs.readFileSync(fp);
  const sizeMB = (fs.statSync(fp).size / 1048576).toFixed(2);
  const g = await new Promise((res, rej) => loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej));
  return { g, fp, sizeMB };
}

const angleDeg = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI;
const f3 = (x) => x.toFixed(3);
const MARGIN = 1.15, MIN_SIZE = 0.05;
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
  if (Math.max(sy, sz, b.max.x - b.min.x) < MIN_SIZE) return 'tiny';
  if (sy > sz * MARGIN) return 'stand';
  if (sz > sy * MARGIN) return 'lie';
  return 'amb';
}
function meshes(root) { const o = []; root.traverse(n => { if ((n.isMesh || n.isSkinnedMesh) && n.geometry && n.geometry.attributes.position) o.push(n); }); return o; }
function skinnedBox(root, step = 11) {
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

async function report(tag, rel, withPlay) {
  const loaded = await loadGLB(rel);
  if (!loaded) return null;
  const { g, fp, sizeMB } = loaded;
  const root = g.scene;
  root.updateMatrixWorld(true);
  console.log('\n════════ ' + tag + ' (' + path.basename(fp) + ', ' + sizeMB + 'MB) ════════');
  console.log('内嵌动画 clips = ' + (g.animations ? g.animations.length : 0));

  const bones = [];
  root.traverse(n => { if (n.isBone) bones.push(n); });
  console.log('骨骼数 = ' + bones.length);
  if (bones.length) {
    const names = bones.map(b => b.name);
    const mixCount = names.filter(n => /^mixamorig/i.test(n)).length;
    console.log('mixamorig 命名骨骼 = ' + mixCount + ' / ' + bones.length +
      '   mixamorigHips = ' + names.includes('mixamorigHips'));
    console.log('骨骼名样本: ' + names.slice(0, 12).join(', '));
    const hipsLike = names.filter(n => /hips|pelvis|root/i.test(n));
    console.log('hip 类骨骼: ' + (hipsLike.join(', ') || '(无)'));
  }

  // 顶层结构
  console.log('顶层节点: ' + root.children.map(c => (c.name || c.type) + '[' + c.type + '] q=' + angleDeg(c.quaternion).toFixed(1) + '°').join(' | '));
  root.children.forEach(c => {
    if (c.children && c.children.length && angleDeg(c.quaternion) > 1) {
      console.log('  ├ ' + (c.name || c.type) + ' 子节点: ' + c.children.slice(0, 8).map(k => (k.name || k.type) + '[' + k.type + ']').join(', '));
    }
  });

  // 网格与判据
  const ms = meshes(root);
  console.log('网格 ' + ms.length + ' 个（前 8）:');
  let broken = false;
  ms.slice(0, 8).forEach(m => {
    const rb = rawBox(m), wb = worldBox(m, rb);
    const v1 = verdict(rb), v2 = verdict(wb);
    if (v1 === 'stand' && v2 === 'lie') broken = true;
    const pc = [];
    let cur = m.parent;
    while (cur) { pc.push(cur.name || cur.type); cur = cur.parent; }
    console.log('  ' + (m.name || '?').padEnd(22) + (m.isSkinnedMesh ? '[Skinned]' : '[Mesh]   ') +
      ' raw=' + v1 + ' render=' + v2 + '  父链: ' + pc.slice(0, 4).join('←'));
  });
  console.log('→ B类(双重轴转换)触发判据 = ' + broken);

  // 模块判定
  const dg = Comp._diag(root);
  console.log('模块 _diag: ' + JSON.stringify(dg));

  if (withPlay && g.animations && g.animations.length) {
    const clip = g.animations[0];
    const r = Comp.processClip(clip, root, 'idle');
    console.log('模块 processClip: ' + JSON.stringify(r));
    // 播放模拟
    const boneByName = new Map();
    root.traverse(n => { if (n.isBone && n.name) boneByName.set(n.name, n); });
    const restQ = new Map(), restP = new Map();
    root.traverse(n => { restQ.set(n, n.quaternion.clone()); restP.set(n, n.position.clone()); });
    const applyAt = (t) => {
      root.traverse(n => { const q = restQ.get(n); if (q) n.quaternion.copy(q); const p = restP.get(n); if (p) n.position.copy(p); });
      clip.tracks.forEach(tt => {
        if (!tt.name.endsWith('.quaternion') && !tt.name.endsWith('.rotation')) return;
        const bn = tt.name.replace(/\.(quaternion|rotation)$/, '');
        const b = boneByName.get(bn);
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
    };
    applyAt(0.2);
    const box = skinnedBox(root);
    console.log('播放 t=0.2 蒙皮渲染: ' + verdict(box) +
      ' Y[' + f3(box.min.y) + ',' + f3(box.max.y) + '] Z[' + f3(box.min.z) + ',' + f3(box.max.z) + ']');
  }
  return { root, g };
}

// 1. 角色主模型
await report('角色主模型', tpl.glb_url, true);
// 2. 三个动画文件（该模板用的是完整角色 GLB）
for (const [k, rel] of [['idle', tpl.anim_idle_url], ['walk', tpl.anim_walk_url], ['run', tpl.anim_run_url]]) {
  if (rel) await report('动画文件 ' + k, rel, false);
}
console.log('\n诊断结束');
