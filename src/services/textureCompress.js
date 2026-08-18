/**
 * textureCompress.js — GLB 内嵌 PNG 纹理重压缩服务（上传管线二级压缩）
 *
 * 在几何压缩（gltfpack, modelAutoCompress.js）之后调用：
 *   法线/occlusion 图 → 无损重编码（不降分辨率不量化）
 *   metallicRoughness → palette 256 色 + quality 95
 *   baseColor / 其他  → palette 256 色 + quality 80
 *   传 maxSize 时，非 normal/occlusion 纹理超过该像素上限 → 降分辨率（如 4K→2K）
 *
 * 布局支持（v2 多 buffer，2026-08-18 由 scripts/recompress_textures_v2.js 移植）：
 *   - 图片 bufferView 位于所属 buffer 的前段，可跨越 0..N 个 buffer
 *   - 含图片的 buffer：图片区前/后可存在几何数据或 EXT_meshopt_compression 压缩流，
 *     图片压缩后同 buffer 内图片区之后的 bufferView / meshopt 流偏移整体平移
 *   - 不含图片的 buffer 原样保留
 *
 * 安全：布局断言失败（图片区与几何数据真实交错）/ 单张纹理压完反而变大 / 整体无收益
 * → 返回 skipped，不写盘，不影响原文件（不阻断上传）。
 */
const fs = require('fs');
const sharp = require('sharp');

const DEFAULT_EFFORT = 7; // 上传场景速度与体积的平衡点（10 最慢最优，体积差 1~3%）

// ---------- GLB 解析 / 组装 ----------
function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('not a valid GLB');
  const totalLen = buf.readUInt32LE(8);
  let offset = 12;
  let json = null, bin = null;
  while (offset < totalLen) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + chunkLen);
    if (chunkType === 0x4E4F534A) json = JSON.parse(data.toString('utf8'));
    else if (chunkType === 0x004E4942) bin = Buffer.from(data);
    offset += 8 + chunkLen;
  }
  if (!json || !bin) throw new Error('GLB missing JSON or BIN chunk');
  return { json, bin };
}

function buildGLB(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binPadded = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546C67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded.length, 12);
  out.writeUInt32LE(0x4E4F534A, 16);
  jsonPadded.copy(out, 20);
  const binOff = 20 + jsonPadded.length;
  out.writeUInt32LE(binPadded.length, binOff);
  out.writeUInt32LE(0x004E4942, binOff + 4);
  binPadded.copy(out, binOff + 8);
  return out;
}

// ---------- 纹理用途识别 ----------
function classifyTextures(json) {
  const usage = new Map();
  const mark = (texIdx, type) => {
    if (texIdx == null) return;
    const tex = (json.textures || [])[texIdx];
    if (!tex) return;
    const img = (json.images || [])[tex.source];
    if (img && img.bufferView != null && !usage.has(img.bufferView)) {
      usage.set(img.bufferView, type);
    }
  };
  for (const m of (json.materials || [])) {
    if (m.normalTexture) mark(m.normalTexture.index, 'normal');
    const pbr = m.pbrMetallicRoughness || {};
    if (pbr.baseColorTexture) mark(pbr.baseColorTexture.index, 'baseColor');
    if (pbr.metallicRoughnessTexture) mark(pbr.metallicRoughnessTexture.index, 'metallicRoughness');
    if (m.occlusionTexture) mark(m.occlusionTexture.index, 'occlusion');
  }
  for (const img of (json.images || [])) {
    if (img.bufferView != null && !usage.has(img.bufferView)) usage.set(img.bufferView, 'other');
  }
  return usage;
}

// ---------- 单张纹理重压缩（normal/occlusion 不降分辨率，其余超 maxSize 则缩小） ----------
async function recompressPng(pngBuf, type, effort, maxSize) {
  const img = sharp(pngBuf, { failOn: 'none' });
  let meta = null;
  const limit = (type === 'normal' || type === 'occlusion') ? 0 : (maxSize || 0);
  let pipeline = img;
  if (limit) {
    meta = await img.metadata();
    if (Math.max(meta.width || 0, meta.height || 0) > limit) {
      pipeline = img.resize({ width: limit, height: limit, fit: 'inside', kernel: 'lanczos3' });
    }
  }
  let opts;
  if (type === 'normal' || type === 'occlusion') {
    opts = { compressionLevel: 9, effort };
  } else if (type === 'metallicRoughness') {
    opts = { palette: true, quality: 95, compressionLevel: 9, effort };
  } else {
    opts = { palette: true, quality: 80, compressionLevel: 9, effort };
  }
  const out = await pipeline.png(opts).toBuffer();
  // 返回输出尺寸（resize 后与输入不同，供报告使用）
  let outMeta = null;
  if (limit) {
    try { outMeta = await sharp(out).metadata(); } catch {}
  }
  return { out, meta: outMeta || meta };
}

/**
 * 压缩 GLB 内嵌纹理（原地替换，失败保留原文件）
 * @param {string} absPath GLB 绝对路径
 * @param {object} [options] { effort = 7, maxSize = 0 } maxSize>0 时非 normal/occlusion
 *   纹理最长边超过该像素值则降分辨率
 * @returns {Promise<{compressed:boolean, skipped:boolean, reason:string, originalSize:number, newSize:number, detail:Array}>}
 */
async function compressTextures(absPath, options = {}) {
  const effort = options.effort || DEFAULT_EFFORT;
  const maxSize = options.maxSize || 0;
  let originalSize = 0;
  try {
    const raw = fs.readFileSync(absPath);
    originalSize = raw.length;
    const { json, bin } = parseGLB(raw);
    const bvs = json.bufferViews || [];
    const usage = classifyTextures(json);
    const imgBvIndices = [...usage.keys()];
    if (usage.size === 0) {
      return { compressed: false, skipped: true, reason: 'no_embedded_textures', originalSize, newSize: originalSize, detail: [] };
    }

    // 每个 buffer 在 BIN chunk 内的起始偏移
    const bufStart = [];
    let acc = 0;
    for (const b of json.buffers) { bufStart.push(acc); acc += b.byteLength; }

    const report = [];
    const newBuffers = [];

    for (let bufIdx = 0; bufIdx < json.buffers.length; bufIdx++) {
      const imgs = [];
      for (const i of imgBvIndices) {
        const bv = bvs[i];
        if (bv.buffer === undefined) bv.buffer = 0;
        if (bv.buffer === bufIdx) imgs.push({ bvIndex: i, offset: bv.byteOffset || 0, length: bv.byteLength });
      }

      const sliceStart = bufStart[bufIdx];
      const sliceEnd = sliceStart + json.buffers[bufIdx].byteLength;

      // 不含图片的 buffer 原样保留
      if (imgs.length === 0) {
        newBuffers.push(bin.subarray(sliceStart, sliceEnd));
        continue;
      }

      // 图片区范围
      let minOff = Infinity, imageEnd = 0;
      for (const im of imgs) { minOff = Math.min(minOff, im.offset); imageEnd = Math.max(imageEnd, im.offset + im.length); }

      // 安全断言：图片区内不得有非图片 bufferView / meshopt 流（真交错 → skipped 不阻断）
      for (let i = 0; i < bvs.length; i++) {
        if (imgBvIndices.includes(i)) continue;
        const bv = bvs[i];
        const off = bv.byteOffset || 0;
        if (bv.buffer === bufIdx && off < imageEnd && off + bv.byteLength > minOff) {
          return { compressed: false, skipped: true, reason: 'overlap_non_image_bv_' + bufIdx, originalSize, newSize: originalSize, detail: [] };
        }
        const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
        if (ext && ext.buffer === bufIdx && ext.byteOffset < imageEnd && ext.byteOffset + ext.byteLength > minOff) {
          return { compressed: false, skipped: true, reason: 'overlap_meshopt_stream_' + bufIdx, originalSize, newSize: originalSize, detail: [] };
        }
      }

      // 逐图压缩并重排（图片区前段数据原样保留，图片区后段整体平移）
      const parts = [];
      let cursor = minOff;
      if (minOff > 0) parts.push(bin.subarray(sliceStart, sliceStart + minOff));

      const sorted = [...imgs].sort((a, b) => a.offset - b.offset);
      for (const im of sorted) {
        const bv = bvs[im.bvIndex];
        const pngBuf = bin.subarray(sliceStart + im.offset, sliceStart + im.offset + im.length);
        const type = usage.get(im.bvIndex);
        const { out, meta } = await recompressPng(pngBuf, type, effort, maxSize);
        const keptOriginal = out.length >= pngBuf.length;
        const finalBuf = keptOriginal ? pngBuf : out;
        report.push({
          bufferView: im.bvIndex, type,
          dim: meta ? ((meta.width || '?') + 'x' + (meta.height || '?')) : undefined,
          old: pngBuf.length, new: finalBuf.length, keptOriginal
        });
        bv.byteOffset = cursor;
        bv.byteLength = finalBuf.length;
        parts.push(finalBuf);
        cursor += finalBuf.length;
        const pad = (4 - (cursor % 4)) % 4;
        if (pad) { parts.push(Buffer.alloc(pad, 0)); cursor += pad; }
      }

      // 图片区之后的几何 / meshopt 流偏移平移
      const tailStart = sliceStart + imageEnd;
      if (sliceEnd > tailStart) {
        const delta = cursor - imageEnd;
        parts.push(bin.subarray(tailStart, sliceEnd));
        for (let i = 0; i < bvs.length; i++) {
          if (imgBvIndices.includes(i)) continue;
          const bv = bvs[i];
          const off = bv.byteOffset || 0;
          if (bv.buffer === bufIdx && off >= imageEnd) bv.byteOffset = off + delta;
          const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
          if (ext && ext.buffer === bufIdx && ext.byteOffset >= imageEnd) ext.byteOffset += delta;
        }
      }

      const newBuf = Buffer.concat(parts);
      json.buffers[bufIdx].byteLength = newBuf.length;
      newBuffers.push(newBuf);
    }

    const newBin = Buffer.concat(newBuffers);
    const outGLB = buildGLB(json, newBin);
    if (outGLB.length >= raw.length) {
      return { compressed: false, skipped: true, reason: 'no_gain', originalSize, newSize: originalSize, detail: report };
    }

    fs.writeFileSync(absPath, outGLB);
    return { compressed: true, skipped: false, reason: '', originalSize, newSize: outGLB.length, detail: report };
  } catch (e) {
    return { compressed: false, skipped: true, reason: e.message, originalSize, newSize: originalSize, detail: [] };
  }
}

module.exports = { compressTextures };
