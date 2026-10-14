/**
 * ldraw_convert.js —— LDraw DAT → GLB 转换器（自研轻量，零外部依赖）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * LDraw 格式核心（纯文本行）：
 *   1 <colour> <a..f 12数矩阵> <file.dat>   子件引用（4x4 仿射，列主序前12）
 *   3 <colour> <x1 y1 z1 ... x3 y3 z3>      三角面
 *   4 <colour> <x1 y1 z1 ... x4 y4 z4>      四边面（拆两个三角）
 *   0 //!COI ... 等元数据行忽略；BFC 指令忽略（输出双面材质，不做背面剔除）
 *   2 <colour> ...                          线段（不转几何）
 *
 * 单位：LDraw 1 LDU = 0.4mm。乐高人仔 100 LDU ≈ 4cm → 人仔比例（人高1.75m）缩放 S≈17.5。
 *       brick 2x4（80×24 LDU）→ 0.56m × 0.168m —— 正好是「模数墙段」尺度。
 *
 * 用法：
 *   单件  node scripts/ldraw_convert.js --ldraw .tmp_ldraw/ldraw --part 3001.dat --color 4 --scale 17.5 --out out.glb
 *   批量  node scripts/ldraw_convert.js --ldraw .tmp_ldraw/ldraw --batch manifest.json（见文件尾注释）
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── 颜色表：LDConfig.ldr 解析（0 !COLOUR name CODE x EDGE ...）──
function loadColors(ldrawDir) {
  const colors = { 16: [0.86, 0.86, 0.86], 24: [0.96, 0.8, 0.16] }; // 16=主色(默认白)、24=次要(黄)
  const cfg = path.join(ldrawDir, 'LDConfig.ldr');
  if (!fs.existsSync(cfg)) { console.warn('[ldraw] LDConfig.ldr 不存在 → 全部用默认白'); return colors; }
  const lines = fs.readFileSync(cfg, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^0\s+!COLOUR\s+(\S+).*?CODE\s+(\d+).*?VALUE\s+#([0-9A-Fa-f]{6})/);
    if (!m) continue;
    const hex = m[3];
    colors[Number(m[2])] = [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  return colors;
}

// ── DAT 递归解析：输出三角形数组 [x,y,z ×9]（已世界变换、已着色属性分离）──
function resolvePath(ldrawDir, file) {
  const tries = [
    path.join(ldrawDir, 'parts', file),
    path.join(ldrawDir, 'p', file),
    path.join(ldrawDir, file),
    path.join(ldrawDir, 'parts', 's', file),   // 子模型
  ];
  for (const t of tries) if (fs.existsSync(t)) return t;
  return null;
}

function mul3(a, b) {
  // 两个 3x3（行主序 9 元素）相乘
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return r;
}
function xform(mat, v) {
  return [
    mat[0] * v[0] + mat[3] * v[1] + mat[6] * v[2],
    mat[1] * v[0] + mat[4] * v[1] + mat[7] * v[2],
    mat[2] * v[0] + mat[5] * v[1] + mat[8] * v[2],
  ];
}

// ── GLB 封装：单 mesh，POSITION + NORMAL + COLOR_0（顶点色），双面材质 ──
function writeGlb(tris, outPath) {
  const pos = [], nrm = [], col = [], idx = [];
  // ★ 每三角独立顶点（2026-10-14）：按位置去重会让后写面的法线被先写面的法线覆盖
  //   （顶/底面复用壁面顶点 → 顶底面法线变成壁面法线 → 渲染隐身）。乐高件面数低，
  //   独立顶点的体积开销可忽略。
  for (const tri of tris) {
    const [a, b, c] = tri.v;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const base = pos.length / 3;
    for (const v of tri.v) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(nx, ny, nz);
      col.push(tri.rgb[0], tri.rgb[1], tri.rgb[2]);
    }
    idx.push(base, base + 1, base + 2);
  }
  const posBuf = new Float32Array(pos);
  const nrmBuf = new Float32Array(nrm);
  const colBuf = new Float32Array(col);
  const idxArr = pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  const json = {
    asset: { version: '2.0', generator: 'ldraw_convert.js (miduo100)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'LDrawPart' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.85 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: accMin(posBuf, 3), max: accMax(posBuf, 3) },
      { bufferView: 1, componentType: 5126, count: nrm.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: col.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: idxArr instanceof Uint32Array ? 5125 : 5123, count: idxArr.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.byteLength },
      { buffer: 0, byteOffset: align(posBuf.byteLength), byteLength: nrmBuf.byteLength },
      { buffer: 0, byteOffset: align(posBuf.byteLength + nrmBuf.byteLength), byteLength: colBuf.byteLength },
      { buffer: 0, byteOffset: align(posBuf.byteLength + nrmBuf.byteLength + colBuf.byteLength), byteLength: idxArr.byteLength },
    ],
    buffers: [{ byteLength: 0 }],
  };
  json.buffers[0].byteLength = align(posBuf.byteLength + nrmBuf.byteLength + colBuf.byteLength + idxArr.byteLength);
  // 组装 BIN
  const total = json.buffers[0].byteLength;
  const bin = new Uint8Array(total);
  bin.set(new Uint8Array(posBuf.buffer, 0, posBuf.byteLength), 0);
  bin.set(new Uint8Array(nrmBuf.buffer, 0, nrmBuf.byteLength), align(posBuf.byteLength));
  bin.set(new Uint8Array(colBuf.buffer, 0, colBuf.byteLength), align(posBuf.byteLength + nrmBuf.byteLength));
  bin.set(new Uint8Array(idxArr.buffer, 0, idxArr.byteLength), align(posBuf.byteLength + nrmBuf.byteLength + colBuf.byteLength));
  const jsonStr = JSON.stringify(json);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonBuf = new TextEncoder().encode(jsonStr + ' '.repeat(jsonPad));
  const binPad = (4 - (bin.length % 4)) % 4;
  const header = Buffer.alloc(12);
  const totalLen = 12 + 8 + jsonBuf.length + 8 + bin.length + binPad;
  header.writeUInt32LE(0x46546C67, 0);   // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLen, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4E4F534A, 4); // 'JSON'
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length + binPad, 0); bh.writeUInt32LE(0x004E4942, 4); // 'BIN\0'
  fs.writeFileSync(outPath, Buffer.concat([header, jh, jsonBuf, bh, bin, Buffer.alloc(binPad)]));
}
function align(n) { return Math.ceil(n / 4) * 4; }
function accMin(buf, stride) { const m = [Infinity, Infinity, Infinity]; for (let i = 0; i < buf.length; i += stride) for (let k = 0; k < 3; k++) if (buf[i + k] < m[k]) m[k] = buf[i + k]; return m; }
function accMax(buf, stride) { const m = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < buf.length; i += stride) for (let k = 0; k < 3; k++) if (buf[i + k] > m[k]) m[k] = buf[i + k]; return m; }

// ── CLI ──
function main() {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
  const ldrawDir = get('ldraw') || '.tmp_ldraw/ldraw';
  // scale = 人仔比例系数（人高 1.75m / 人仔 0.04m=100LDU ≈ 17.5）；
  // LDraw 1 LDU = 0.4mm = 0.0004m —— 最终米 = LDU × 0.0004 × scale
  const scale = (Number(get('scale')) || 17.5) * 0.0004;
  const out = get('out');
  const part = get('part');
  const color = Number(get('color')) || 16;
  if (!out || !part) { console.error('用法: node scripts/ldraw_convert.js --ldraw <dir> --part <file.dat> [--color 16] [--scale 17.5] --out <out.glb>'); process.exit(1); }
  const colors = loadColors(ldrawDir);
  const out_ = { tris: [], colors: colors, missing: new Set() };
  const cache = { done: new Map() };
  const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const ORIGIN = [0, 0, 0];
  collectTrisRoot(ldrawDir, part, color, IDENT, ORIGIN, scale, cache, out_);
  console.log('三角形: ' + out_.tris.length + '  顶点: ' + (out_.tris.length * 3) + '  缺失子件: ' + out_.missing.size);
  if (out_.missing.size) console.log('  缺失清单: ' + Array.from(out_.missing).slice(0, 5).join(', '));
  if (!out_.tris.length) { console.error('无几何产出'); process.exit(1); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  writeGlb(out_.tris, out);
  console.log('写出: ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + 'KB)');
}
// 根入口（把根平移并入 mat 的第 4 列——本转换器用独立 tr 参数，故根用 0 平移）
function collectTrisRoot(ldrawDir, file, color, mat, tr, scale, cache, out_) {
  // 简化：根层先把文件读出来平移已经内含 0，无需处理
  const saved = { tris: out_.tris };
  out_.tris = [];
  collectTrisInner(ldrawDir, file, color, mat, tr, scale, cache, 0, out_);
  saved.tris.push.apply(saved.tris, out_.tris);
  out_.tris = saved.tris;
}
function collectTrisInner(ldrawDir, file, color, mat, tr, scale, cache, depth, out_) {
  if (depth > 12) return;
  const full = resolvePath(ldrawDir, file);
  if (!full) { out_.missing.add(file); return; }
  const text = fs.readFileSync(full, 'utf8');
  const localTris = [];
  const subRefs = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const t0 = line[0];
    if (t0 !== '1' && t0 !== '3' && t0 !== '4') continue;
    const t = line.split(/\s+/);
    const c = Number(t[1]);
    if (t0 === '1') {
      const nums = t.slice(2, 14).map(Number);
      const m2 = nums.slice(0, 9), tr2 = nums.slice(9, 12);
      const nmat = mul3(mat, m2);
      // 世界平移 = mat × (tr2·scale) + tr（tr 已是世界系；mat 是 3×3 行主序 9 元素——
      //  曾误写 mat[9]*tr[0]（undefined→NaN）→ 子件顶点全 NaN 被 GPU 剔除，渲染只剩本层面）
      const ntr = [
        mat[0] * tr2[0] * scale + mat[3] * tr2[1] * scale + mat[6] * tr2[2] * scale + tr[0],
        mat[1] * tr2[0] * scale + mat[4] * tr2[1] * scale + mat[7] * tr2[2] * scale + tr[1],
        mat[2] * tr2[0] * scale + mat[5] * tr2[1] * scale + mat[8] * tr2[2] * scale + tr[2],
      ];
      subRefs.push({ file: t[14], color: c, mat: nmat, tr: ntr });
    } else {
      const n = t0 === '3' ? 3 : 4;
      const v = [];
      for (let i = 0; i < n; i++) {
        const vx = Number(t[2 + i * 3]) * scale, vy = Number(t[3 + i * 3]) * scale, vz = Number(t[4 + i * 3]) * scale;
        v.push([
          mat[0] * vx + mat[3] * vy + mat[6] * vz + tr[0],
          mat[1] * vx + mat[4] * vy + mat[7] * vz + tr[1],
          mat[2] * vx + mat[5] * vy + mat[8] * vz + tr[2],
        ]);
      }
      localTris.push({ c: c, v: [v[0], v[1], v[2]] });
      if (n === 4) localTris.push({ c: c, v: [v[0], v[2], v[3]] });
    }
  }
  for (const tri of localTris) {
    // ★ 颜色码 16 = 主色，继承父级调用色（不是查表白）——3001 引用色 4(红) 时
    //   内部 16 的面必须渲染成红（2026-10-14 渲染目检抓出）
    const rgb = tri.c === 16
      ? (out_.colors[color] || [0.8, 0.8, 0.8])
      : (out_.colors[tri.c] || out_.colors[16] || [0.8, 0.8, 0.8]);
    out_.tris.push({ rgb: rgb, v: tri.v });
  }
  for (const s of subRefs) {
    const saved = { tris: out_.tris };
    out_.tris = [];
    collectTrisInner(ldrawDir, s.file, s.color === 16 ? color : s.color, s.mat, s.tr, scale, cache, depth + 1, out_);
    saved.tris.push.apply(saved.tris, out_.tris);
    out_.tris = saved.tris;
  }
}

if (require.main === module) main();
module.exports = { loadColors, collectTrisInner, writeGlb };
