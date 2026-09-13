/**
 * glbTextureStripper.js — LOD 变体 GLB 贴图剥离（模型 LOD 三版方案 · 二期「变体复用高模贴图」）
 *
 * 背景（2026-09-12 实测定位）：
 *   变体（_mid/_lod）由 gltfpack -kn -km 生成，各自内嵌一整套贴图副本 → 前端把高/中/低
 *   三个变体全部加载常驻 → 每个模型 3 份贴图（内存/显存 3 倍，磁盘 +76.8% 的根因）。
 *   前端 worldInstanceMerger_v2.js attachLodBand 已改为：变体网格按节点名借用高模材质
 *   （Material.clone 共享 Texture 对象，零额外显存），并立即 dispose 变体自带贴图。
 *   → 变体文件里的贴图成了纯死重：本模块把它从 GLB 里剥掉（JSON+BIN 手术，几何不动）。
 *
 * 安全闸门（任一不满足则跳过、保留原文件）：
 *   1. mesh 名匹配：变体的全部网格节点名 ⊆ 生效源文件网格节点名
 *      （前端按名匹配材质；对不上名的网格会回退用变体自带材质——剥了就丢贴图，故必须先验证）
 *   2. 无压缩扩展：EXT_meshopt_compression / KHR_draco_mesh_compression 的文件不做手术
 *   3. 单 buffer：引用了非 0 号 buffer 的几何数据不做手术（GLB 只有 1 个 BIN chunk）
 *   4. 已无贴图：images 为空的文件幂等跳过
 *   5. 几何不变：剥离前后三角面数逐 accessor 校验一致，不一致不落盘
 *
 * 约束：绝不修改源文件；输出走 .tmp 原子 rename；任何失败返回 skipped，绝不抛异常。
 */
const fs = require('fs');

const GLB_MAGIC = 0x46546c67;   // 'glTF'
const CHUNK_JSON = 0x4e4f534a;  // 'JSON'
const CHUNK_BIN = 0x004e4942;   // 'BIN'

/** 解析 GLB → { json, bin }，失败返回 null */
function parseGlb(absPath) {
  let buf;
  try { buf = fs.readFileSync(absPath); } catch (_) { return null; }
  if (buf.length < 20 || buf.readUInt32LE(0) !== GLB_MAGIC) return null;
  if (buf.readUInt32LE(4) !== 2) return null;                       // 仅处理 version 2
  const totalLen = buf.readUInt32LE(8);
  if (totalLen > buf.length) return null;
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== CHUNK_JSON) return null;
  let json;
  try {
    json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8').replace(/[\s\u0000]+$/, ''));
  } catch (_) { return null; }
  let bin = Buffer.alloc(0);
  let off = 20 + jsonLen;
  if (off + 8 <= totalLen && buf.readUInt32LE(off + 4) === CHUNK_BIN) {
    const binLen = buf.readUInt32LE(off);
    bin = buf.slice(off + 8, Math.min(off + 8 + binLen, totalLen));
  }
  return { json, bin };
}

/** 序列化 GLB（JSON chunk 空格补齐 / BIN chunk 零补齐，均按 4 字节对齐） */
function buildGlb(json, bin) {
  const jsonStr = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const hasBin = bin.length > 0 || binPad > 0;
  const total = 12 + 8 + jsonStr.length + jsonPad + (hasBin ? 8 + bin.length + binPad : 0);
  const out = Buffer.alloc(total);
  let off = 0;
  out.writeUInt32LE(GLB_MAGIC, off); off += 4;
  out.writeUInt32LE(2, off); off += 4;
  out.writeUInt32LE(total, off); off += 4;
  out.writeUInt32LE(jsonStr.length + jsonPad, off); off += 4;
  out.writeUInt32LE(CHUNK_JSON, off); off += 4;
  jsonStr.copy(out, off); off += jsonStr.length;
  for (let i = 0; i < jsonPad; i++) out[off++] = 0x20;
  if (hasBin) {
    out.writeUInt32LE(bin.length + binPad, off); off += 4;
    out.writeUInt32LE(CHUNK_BIN, off); off += 4;
    bin.copy(out, off); off += bin.length;
    for (let i = 0; i < binPad; i++) out[off++] = 0;
  }
  return out;
}

/** 从 json 统计三角面数（与 modelLod.countTrisExact 同口径：index.count/3 优先） */
function trisOf(json) {
  const accessors = json.accessors || [];
  let total = 0;
  (json.meshes || []).forEach((m) => {
    (m.primitives || []).forEach((pr) => {
      const idx = pr.index !== undefined && accessors[pr.index] ? accessors[pr.index].count : 0;
      const pos = pr.attributes && pr.attributes.POSITION !== undefined && accessors[pr.attributes.POSITION]
        ? accessors[pr.attributes.POSITION].count : 0;
      if (idx > 0) total += Math.floor(idx / 3);
      else if (pos > 0) total += Math.floor(pos / 3);
    });
  });
  return total;
}

/**
 * 收集「带 mesh 的节点名」（递归 nodes.children，容环）
 * 前端 buildMeshTemplates 取 mesh.name 或其父节点名；gltfpack -kn 保留节点名，两者同源
 */
function meshNodeNames(json) {
  const names = [];
  const nodes = json.nodes || [];
  const seen = new Set();
  const walk = (idx) => {
    if (idx === undefined || idx === null || seen.has(idx)) return;
    seen.add(idx);
    const n = nodes[idx];
    if (!n) return;
    if (n.mesh !== undefined) names.push(n.name || '');
    (n.children || []).forEach(walk);
  };
  (json.scenes && json.scenes[json.scene || 0] && json.scenes[json.scene || 0].nodes || []).forEach(walk);
  return names;
}

/**
 * 变体与源的网格节点名兼容性闸门（与前端 worldInstanceMerger_v2.attachLodBand 的匹配规则同构）：
 *   - 数量一致：按 DFS 序逐位对齐（前端 positional 兜底同口径），有名字处必须相等（无名不冲突）
 *   - 数量不一致：退回严格名匹配——变体全部网格节点必须有名且 ⊆ 源名集合
 * 实测注（2026-09-12）：本世界 213/215 组变体的网格节点本就无名（源与变体同为 [""]），
 * 实际靠「数量一致 + 位序对齐」命中；gltfpack 保留节点结构不重排，位序稳定。
 */
function variantNamesCompatible(varJson, srcJson) {
  const varNames = meshNodeNames(varJson);
  if (!varNames.length) return false;
  const srcNames = meshNodeNames(srcJson);
  if (srcNames.length === varNames.length) {
    return varNames.every((n, i) => !n || !srcNames[i] || n === srcNames[i]);
  }
  const srcSet = new Set(srcNames);
  return varNames.every((n) => n && srcSet.has(n));
}

/** 深度删除材质树里所有 *Texture 引用（含 extensions 内的，如 specularColorTexture） */
function stripMaterialTextureRefs(mat) {
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const k of Object.keys(obj)) {
      if (/Texture$/.test(k)) { delete obj[k]; continue; }
      walk(obj[k]);
    }
  };
  walk(mat);
}

/**
 * 对 GLB 执行贴图剥离（内存中完成，返回新文件字节；失败返回 null）
 * @returns {{ buf:Buffer, images:number, saved:number }|null}
 */
function stripInMemory(absPath, sourceJson) {
  const parsed = parseGlb(absPath);
  if (!parsed) return null;
  const { json, bin } = parsed;

  const images = json.images || [];
  if (!images.length) return null; // 已无贴图（幂等）
  const extUsed = json.extensionsUsed || [];
  if (extUsed.includes('EXT_meshopt_compression') || extUsed.includes('KHR_draco_mesh_compression')) return null;
  if ((json.bufferViews || []).some((bv) => bv.extensions)) return null;

  // 闸门 1：变体网格节点名必须与源兼容（否则前端会回退用变体自带材质，剥了就丢贴图）
  if (sourceJson && !variantNamesCompatible(json, sourceJson)) return null;

  // 闸门 3：只处理单 buffer（GLB 只有 1 个 BIN chunk）
  const bvs = json.bufferViews || [];
  const usedBv = new Set();
  (json.accessors || []).forEach((a) => { if (a && a.bufferView !== undefined) usedBv.add(a.bufferView); });
  const retained = [];
  for (let i = 0; i < bvs.length; i++) {
    if (!usedBv.has(i)) continue;
    const bv = bvs[i];
    if ((bv.buffer || 0) !== 0) return null;
    const start = bv.byteOffset || 0;
    retained.push({ i, start, end: start + (bv.byteLength || 0) });
  }

  const trisBefore = trisOf(json);

  // 重建 buffer：只保留被 accessor 引用的区间，其余（图片数据）整体丢弃
  retained.sort((a, b) => a.start - b.start);
  const merged = [];
  retained.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) { if (r.end > last.end) last.end = r.end; }
    else merged.push({ start: r.start, end: r.end });
  });
  const parts = [];
  let cursor = 0;
  merged.forEach((m) => {
    const len = m.end - m.start;
    if (len <= 0) return;
    if (m.start + len > bin.length) return; // 越界保护：宁可保留整块也不产出坏文件
    m.newStart = cursor;
    parts.push(bin.slice(m.start, m.end));
    cursor += len;
  });
  const newBin = Buffer.concat(parts);
  // 旧偏移 → 新偏移：所在合并区间内做相对换算（相邻/部分重叠区间会被并入同一块，
  // 中间起点的 bufferView 不能只靠「区间起点」映射——首版此处丢映射导致产坏文件）
  const mapOffset = (off) => {
    for (const m of merged) {
      if (off >= m.start && off < m.end) return m.newStart + (off - m.start);
    }
    return -1;
  };

  // bufferView 重排：丢弃未引用项（图片数据）并建立「旧索引→新索引」映射，
  // accessor 的 bufferView 引用必须同步重写（⚠️ 不能用 filter 压缩数组——索引会整体错位，
  // 首版实现曾因此产出 GLTFLoader 报 "reading 'extensions'" 的坏文件）
  const newBvs = [];
  const indexRemap = new Map();
  bvs.forEach((bv, i) => {
    if (!usedBv.has(i)) return;
    const oldOff = bv.byteOffset || 0;
    const newOff = mapOffset(oldOff);
    if (newOff < 0) throw new Error('unmapped bufferView region');
    const nb = Object.assign({}, bv);
    nb.byteOffset = newOff;
    indexRemap.set(i, newBvs.length);
    newBvs.push(nb);
  });

  const nj = Object.assign({}, json);
  nj.bufferViews = newBvs;
  nj.buffers = [{ byteLength: newBin.length }];
  (nj.accessors || []).forEach((a) => {
    if (a.bufferView !== undefined) a.bufferView = indexRemap.get(a.bufferView);
  });
  delete nj.images;
  delete nj.textures;
  delete nj.samplers;
  (nj.materials || []).forEach(stripMaterialTextureRefs);

  // 闸门 5：几何必须逐面一致
  if (trisOf(nj) !== trisBefore) return null;

  return { buf: buildGlb(nj, newBin), images: images.length, tris: trisBefore };
}

/**
 * 剥离一个 LOD 变体文件的贴图（原子写盘：.tmp → rename，失败保留原文件）
 * @param {string} absPath 变体文件（_mid.glb / _lod.glb）
 * @param {object} [opts]
 * @param {string} [opts.sourcePath] 生效源文件（用于 mesh 名闸门；缺省跳过闸门）
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string, bytesBefore?:number,
 *                     bytesAfter?:number, saved?:number, images?:number, error?:string}>}
 */
async function stripVariantTextures(absPath, { sourcePath } = {}) {
  const fail = (reason) => ({ ok: false, skipped: true, reason });
  try {
    if (!absPath || typeof absPath !== 'string' || !/\.glb$/i.test(absPath)) return fail('bad-path');
    if (!fs.existsSync(absPath)) return fail('not-found');

    let sourceJson = null;
    if (sourcePath) {
      const src = parseGlb(sourcePath);
      if (!src) return fail('source-unreadable');
      sourceJson = src.json;
    }

    const bytesBefore = fs.statSync(absPath).size;
    const r = stripInMemory(absPath, sourceJson);
    if (!r) return fail('skipped'); // 命中任一安全闸门（幂等/压缩/多 buffer/名不匹配/几何校验失败）
    if (r.buf.length >= bytesBefore) return fail('no-gain');

    const tmpPath = absPath + '.strip.tmp';
    fs.writeFileSync(tmpPath, r.buf);
    // 回读验证：JSON 可解析、面数一致、accessor→bufferView 引用完整，才允许覆盖
    const verify = parseGlb(tmpPath);
    const refsOk = verify && (verify.json.accessors || [])
      .every((a) => a.bufferView === undefined || Boolean((verify.json.bufferViews || [])[a.bufferView]));
    if (!verify || trisOf(verify.json) !== r.tris || !refsOk) {
      try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
      return fail('verify-failed');
    }
    fs.renameSync(tmpPath, absPath);
    return {
      ok: true,
      bytesBefore,
      bytesAfter: r.buf.length,
      saved: bytesBefore - r.buf.length,
      images: r.images,
    };
  } catch (e) {
    return { ok: false, skipped: true, reason: 'error', error: e.message };
  }
}

module.exports = { stripVariantTextures, parseGlb, meshNodeNames, trisOf, stripMaterialTextureRefs, variantNamesCompatible };
