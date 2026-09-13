/**
 * glbFaceReducer.js — 强制把（已剥贴图的、未压缩的）GLB 简化到绝对目标面数
 *
 * 背景（2026-09-13 低模样式标准）：gltfpack -sa 受「锁定边界顶点」拓扑下限约束，
 * 部分模型最低只能到 150~550 面，无法满足用户「低模 ≤100 面」的硬标准。
 * 本模块在 gltfpack 输出之后做第二级「贪心边坍缩」（纯 JS，输入已是数百面的小网格，
 * 性能无忧），把面数压到 ≤ 目标值；只改索引与顶点数据，不动 nodes/materials JSON
 * （节点名保留 → 前端借高模材质链路不受影响）。
 *
 * 输入约束：单 buffer、无 images（贴图已剥离）、bufferView 未用 EXT_meshopt_compression
 * （modelLod 管线的输出天然满足；stripVariantTextures 的闸门同样拒绝压缩文件）。
 * 位置 accessor 允许量化（5123/5121、normalized 或节点缩放语义）——坍缩决策只用
 * 相对位置，输出索引引用的顶点数据原样保留，不影响渲染正确性。
 *
 * 算法：反复选「当前最短边」做顶点合并（b→a），删除退化三角形，直到 ≤ 目标面数。
 * 质量不重要（低模样式），重要的是面数确定达标、包围盒不爆炸（合并到保留顶点，
 * 顶点位置不被修改）。
 */
const fs = require('fs');
const path = require('path');

const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_ELEMS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ALIGN = 4;

function align4(n) { return Math.ceil(n / ALIGN) * ALIGN; }

function parseGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not glb');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  // BIN chunk：跳过 JSON chunk（20 + jsonLen 对齐到 4）
  let off = 20 + align4(jsonLen);
  let bin = null;
  while (off + 8 <= buf.length) {
    const cLen = buf.readUInt32LE(off);
    const cType = buf.slice(off + 4, off + 8).toString('ascii');
    if (cType === 'BIN\0') { bin = buf.slice(off + 8, off + 8 + cLen); break; }
    off += 8 + align4(cLen);
  }
  if (!bin) throw new Error('no bin chunk');
  return { json, bin };
}

function writeGlb(json, bin) {
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  if (jsonBytes.length % 4 !== 0) {
    const pad = Buffer.alloc(4 - (jsonBytes.length % 4), 0x20);
    jsonBytes = Buffer.concat([Buffer.from(jsonBytes), pad]);
  }
  const binPad = align4(bin.length) - bin.length;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'ascii');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binChunk.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBytes.length, 0);
  jh.write('JSON', 4, 'ascii');
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binChunk.length, 0);
  bh.writeUInt32LE(0x004e4942, 4); // BIN\0
  return Buffer.concat([head, jh, Buffer.from(jsonBytes), bh, binChunk]);
}

/** 读 accessor 全量数据为 Float32 位置数组（VEC3 假定；归一化/量化近似解码即可） */
function readPositions(json, bin, accIdx) {
  const a = json.accessors[accIdx];
  const bv = json.bufferViews[a.bufferView];
  const es = COMP_SIZE[a.componentType] * TYPE_ELEMS[a.type];
  const stride = bv.byteStride || es;
  if (stride < es) throw new Error('bad stride');
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const count = a.count;
  const out = new Float32Array(count * 3);
  const norm = a.normalized ? (a.componentType === 5123 ? 65535 : a.componentType === 5121 ? 255 : a.componentType === 5122 ? 32767 : 1) : 1;
  const signed = a.componentType === 5122 || a.componentType === 5120;
  for (let i = 0; i < count; i++) {
    const o = base + i * stride;
    for (let k = 0; k < 3; k++) {
      let v = 0;
      if (a.componentType === 5126) v = bin.readFloatLE(o + k * 4);
      else if (a.componentType === 5123) v = bin.readUInt16LE(o + k * 2);
      else if (a.componentType === 5122) v = bin.readInt16LE(o + k * 2);
      else if (a.componentType === 5121) v = bin.readUInt8(o + k);
      else if (a.componentType === 5120) v = bin.readInt8(o + k);
      else if (a.componentType === 5125) v = bin.readUInt32LE(o + k * 4);
      out[i * 3 + k] = signed ? v / norm : (norm === 1 ? v : v / norm);
    }
  }
  return out;
}

function readIndices(json, bin, accIdx) {
  const a = json.accessors[accIdx];
  const bv = json.bufferViews[a.bufferView];
  const es = COMP_SIZE[a.componentType];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Uint32Array(a.count);
  for (let i = 0; i < a.count; i++) {
    const o = base + i * es;
    out[i] = a.componentType === 5125 ? bin.readUInt32LE(o)
      : a.componentType === 5123 ? bin.readUInt16LE(o)
      : bin.readUInt8(o);
  }
  return out;
}

/** 贪心边坍缩：合并最短边直至 ≤ targetFaces */
function collapseToFaces(pos, idx32, targetFaces) {
  let tris = [];
  for (let i = 0; i < idx32.length; i += 3) {
    const [a, b, c] = [idx32[i], idx32[i + 1], idx32[i + 2]];
    if (a !== b && b !== c && a !== c) tris.push([a, b, c]);
  }
  const edgeLen2 = (a, b) => {
    const dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  let guard = 0;
  while (tris.length > targetFaces && guard++ < 200000) {
    // 找最短边
    let best = null, bestL = Infinity;
    for (const t of tris) {
      const e = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
      for (const [a, b] of e) {
        if (a === b) continue;
        const l = edgeLen2(a, b);
        if (l < bestL) { bestL = l; best = [a, b]; }
      }
    }
    if (!best) break;
    const [keep, gone] = best;
    // 合并 gone → keep
    const next = [];
    for (const t of tris) {
      const a = t[0] === gone ? keep : t[0];
      const b = t[1] === gone ? keep : t[1];
      const c = t[2] === gone ? keep : t[2];
      if (a === b || b === c || a === c) continue; // 退化面删除
      next.push([a, b, c]);
    }
    tris = next;
  }
  // 去重相邻重复面
  const seen = new Set();
  const out = [];
  for (const t of tris) {
    const key = t.join('_');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t[0], t[1], t[2]);
  }
  return new Uint32Array(out);
}

/** 顶点紧缩：只保留被索引引用的顶点，返回 { remap, usedCount } */
function compactRemap(idx32, vertexCount) {
  const remap = new Int32Array(vertexCount).fill(-1);
  let n = 0;
  for (let i = 0; i < idx32.length; i++) {
    const v = idx32[i];
    if (remap[v] === -1) remap[v] = n++;
  }
  return { remap, usedCount: n };
}

/**
 * 把 GLB 简化到 ≤ targetFaces（每个 primitive 按面数占比分摊目标）
 * @returns {{ok:boolean, trisBefore:number, trisAfter:number, error?:string}}
 */
function reduceGlbFaces(absPath, targetFaces) {
  const buf = fs.readFileSync(absPath);
  const { json, bin } = parseGlb(buf);
  if ((json.extensionsRequired || []).includes('EXT_meshopt_compression')) {
    return { ok: false, error: 'meshopt-compressed input not supported' };
  }
  // 带贴图的文件也接受：images 的 bufferView 会随 copyOldBV 原样搬运（只是文件偏大）

  const trisBefore = (json.meshes || []).reduce((s, m) => s + (m.primitives || []).reduce((s2, p) =>
    s2 + (p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count) / 3, 0), 0);
  if (trisBefore <= targetFaces) return { ok: true, trisBefore: Math.round(trisBefore), trisAfter: Math.round(trisBefore) };

  const oldAccessors = json.accessors;
  const oldBufferViews = json.bufferViews;
  const newAccessors = [];
  const newBufferViews = [];
  const newBinChunks = [];
  let binCursor = 0;

  function pushData(data, target) {
    const bvIdx = newBufferViews.length;
    newBufferViews.push({ buffer: 0, byteOffset: binCursor, byteLength: data.length, ...(target ? { target } : {}) });
    newBinChunks.push(data);
    binCursor += align4(data.length);
    return bvIdx;
  }
  const oldToNewBV = new Map(); // 保留非几何 bufferView 原样搬运
  function copyOldBV(bvIdx) {
    if (oldToNewBV.has(bvIdx)) return oldToNewBV.get(bvIdx);
    const bv = oldBufferViews[bvIdx];
    const data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const n = pushData(Buffer.from(data), bv.target);
    oldToNewBV.set(bvIdx, n);
    return n;
  }
  const accRemap = new Map(); // 旧 accessor idx → 新 idx
  function copyOldAccessor(accIdx) {
    if (accRemap.has(accIdx)) return accRemap.get(accIdx);
    const a = oldAccessors[accIdx];
    const n = newAccessors.length;
    newAccessors.push({ ...a, bufferView: copyOldBV(a.bufferView) });
    accRemap.set(accIdx, n);
    return n;
  }

  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.indices === undefined || !prim.attributes || prim.attributes.POSITION === undefined) {
        // 无索引/无位置的 primitive：原样搬运 accessor
        for (const k of Object.keys(prim.attributes || {})) prim.attributes[k] = copyOldAccessor(prim.attributes[k]);
        if (prim.indices !== undefined) prim.indices = copyOldAccessor(prim.indices);
        continue;
      }
      const posAccIdx = prim.attributes.POSITION;
      const posAcc = oldAccessors[posAccIdx];
      const vertexCount = posAcc.count;
      const pos = readPositions(json, bin, posAccIdx);
      const idx32 = readIndices(json, bin, prim.indices);
      const faces = idx32.length / 3;
      const primTarget = Math.max(1, Math.round(targetFaces * (faces / trisBefore)));
      const targetIdxCount = Math.max(3, primTarget * 3);
      const reduced = faces <= primTarget ? idx32 : collapseToFaces(pos, idx32, primTarget);

      const { remap, usedCount } = compactRemap(reduced, vertexCount);
      const newIdx = new Uint32Array(reduced.length);
      for (let i = 0; i < reduced.length; i++) newIdx[i] = remap[reduced[i]];

      // 重写属性 accessor（只保留 used 顶点行；支持交错读取，输出非交错）
      const newAttrs = {};
      for (const [name, accIdx] of Object.entries(prim.attributes)) {
        const a = oldAccessors[accIdx];
        const bv = oldBufferViews[a.bufferView];
        const es = COMP_SIZE[a.componentType] * TYPE_ELEMS[a.type];
        const stride = bv.byteStride || es;
        if (stride < es) throw new Error('bad stride');
        const rowBytes = es;
        const data = Buffer.alloc(usedCount * rowBytes);
        const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
        for (let v = 0; v < vertexCount; v++) {
          const nm = remap[v];
          if (nm === -1) continue;
          bin.copy(data, nm * rowBytes, base + v * stride, base + v * stride + rowBytes);
        }
        const bvIdx = pushData(data, 34962);
        const na = {
          bufferView: bvIdx, componentType: a.componentType, count: usedCount, type: a.type,
          normalized: a.normalized || undefined,
        };
        if (name === 'POSITION' && a.componentType === 5126) {
          // 重算 min/max（仅 float accessor；量化 accessor 交由渲染端自行算界）
          const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
          for (let v = 0; v < usedCount; v++) {
            for (let k = 0; k < 3; k++) {
              const v0 = data.readFloatLE(v * 12 + k * 4);
              if (v0 < mn[k]) mn[k] = v0;
              if (v0 > mx[k]) mx[k] = v0;
            }
          }
          na.min = mn; na.max = mx;
        }
        newAttrs[name] = newAccessors.length;
        newAccessors.push(na);
      }
      prim.attributes = newAttrs;
      const bvI = pushData(Buffer.from(newIdx.buffer, newIdx.byteOffset, newIdx.length * 4), 34963);
      const ia = { bufferView: bvI, componentType: 5125, count: newIdx.length, type: 'SCALAR' };
      prim.indices = newAccessors.length;
      newAccessors.push(ia);
    }
  }

  // 搬运其余被引用的 accessor（动画/IBLM 等，低模文件通常没有）
  const referenced = new Set();
  const walk = (o) => {
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o.accessor !== 'number') return;
    walk(o.accessor);
  };
  // 收集 meshes 之外的 accessor 引用（这里简单化：KHR/动画字段在低模文件中不存在；
  // 若存在未知 accessor 引用，按原样拷贝全部未处理 accessor）
  // 简化实现：对未被 remap 的旧 accessor 一律原样拷贝（保守、幂等）
  for (let i = 0; i < oldAccessors.length; i++) {
    if (!accRemap.has(i)) copyOldAccessor(i);
  }
  // 重建 accessor 索引引用：上面 prim 已指向新索引；拷贝的旧 accessor 从 accRemap 取
  // （copyOldAccessor 在 prim 重写之后调用不会改写 prim——prim 用的是 newAccessors.length 递增，
  //  与 copyOldAccessor 的编号空间一致，无需二次映射）

  json.accessors = newAccessors;
  json.bufferViews = newBufferViews;
  json.buffers = [{ byteLength: 0 }];
  const newBin = Buffer.concat(newBinChunks.map((c, i) => {
    const pad = align4(c.length) - c.length;
    return pad ? Buffer.concat([c, Buffer.alloc(pad)]) : c;
  }));
  json.buffers[0].byteLength = newBin.length;
  delete json.extensionsUsed;
  delete json.extensionsRequired;

  const out = writeGlb(json, newBin);
  const tmp = absPath + '.tmp_reduce';
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, absPath);
  const trisAfter = (json.meshes || []).reduce((s, m) => s + (m.primitives || []).reduce((s2, p) =>
    s2 + (p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count) / 3, 0), 0);
  return { ok: true, trisBefore: Math.round(trisBefore), trisAfter: Math.round(trisAfter) };
}

module.exports = { reduceGlbFaces };
if (require.main === module) {
  const [f, t] = process.argv.slice(2);
  if (!f) { console.log('usage: node glbFaceReducer.js <file.glb> [targetFaces]'); process.exit(1); }
  console.log(JSON.stringify(reduceGlbFaces(path.resolve(f), Number(t) || 100)));
}
