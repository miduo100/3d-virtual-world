/**
 * textureCompress.js — GLB 内嵌纹理重压缩（默认 WebP q92 / 4:4:4）
 *
 * 为什么用 WebP 而不是 palette PNG（2026-10-23 实测决策）：
 *   同一个机器人模型（3×4096 真彩，贴图 27.28MB）
 *     palette 256 色 → 贴图 2.52MB、GLB 5.36MB、PSNR 38.9/36.3/40.7（文字缺笔、变形）
 *     WebP q92 4:4:4 → 贴图 1.57MB、GLB 2.87MB、PSNR 41.5/46.3/49.1（文字清晰）
 *   即 WebP 体积更小、画质更高，且无调色板量化、无色度下采样（4:4:4）。
 *   浏览器验证：Chrome 主线程 GLTFLoader 与 Worker 两条路径均可解码，4096 贴图正常。
 *
 * ★ sourcePath：贴图从"原始上传文件"取，而不是从减面/几何压缩后的文件取。
 *   gltfpack 减面时会顺手把贴图重新编码（实测 normal/metallicRoughness 被量化成 256 色），
 *   若在减面后的文件上再压，会把这份损失继承下来。按贴图用途（baseColor/normal/...）配对取源图。
 *
 * 布局支持（v2 多 buffer）：
 *   - 图片 bufferView 位于所属 buffer 的前段，可跨越 0..N 个 buffer
 *   - 含图片的 buffer：图片区前/后可存在几何数据或 EXT_meshopt_compression 压缩流，
 *     图片压缩后同 buffer 内图片区之后的 bufferView / meshopt 流偏移整体平移
 *   - 不含图片的 buffer 原样保留
 *
 * 安全：布局断言失败（图片区与几何真实交错）/ 整体无收益 → skipped，不写盘，不阻断上传。
 */
const fs = require('fs');
const sharp = require('sharp');

const DEFAULT_EFFORT = 7;      // PNG 无损重编码的 zlib effort
const WEBP_QUALITY = 92;       // 4:4:4 + q92：文字锐利，体积远小于 palette PNG
const WEBP_EFFORT = 4;         // 0~6，4 是上传速度/体积平衡点
const DEFAULT_FORMAT = 'webp';

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

// ---------- 纹理用途识别（bufferView → normal/baseColor/metallicRoughness/occlusion/other） ----------
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

/** 读出 GLB 内所有内嵌图片的原始字节（按 images 数组顺序，无内嵌的为 null） */
function readImageBuffers(json, bin) {
  const starts = [];
  let acc = 0;
  for (const b of json.buffers) { starts.push(acc); acc += b.byteLength; }
  return (json.images || []).map((img) => {
    if (img.bufferView == null) return null;
    const bv = json.bufferViews[img.bufferView];
    const s = (starts[bv.buffer || 0] || 0) + (bv.byteOffset || 0);
    if (s < 0 || s + bv.byteLength > bin.length) return null;
    return Buffer.from(bin.subarray(s, s + bv.byteLength));
  });
}

/**
 * 从原始文件按"贴图用途"建源图分组：type → [{buf, mime}]（同 type 多张按出现顺序）
 * 用用途配对而不是按索引，避免 gltfpack 重排 images 后贴图张冠李戴。
 */
function loadSourceGroups(sourcePath) {
  try {
    const { json, bin } = parseGLB(fs.readFileSync(sourcePath));
    const usage = classifyTextures(json);
    const bufs = readImageBuffers(json, bin);
    const groups = new Map();
    (json.images || []).forEach((img, i) => {
      const buf = bufs[i];
      if (!buf) return;
      const type = usage.get(img.bufferView) || 'other';
      const mime = img.mimeType || 'image/png';
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push({ buf, mime });
    });
    return groups;
  } catch (e) {
    console.warn('[textureCompress] 源贴图读取失败，回退为目标文件自身贴图:', e.message);
    return null;
  }
}

/** 单张纹理编码（webp / png）。normal/occlusion 不降分辨率，其余超 maxSize 才缩小 */
async function encodeImage(srcBuf, type, opts) {
  const { maxSize, format, quality, effort } = opts;
  const img = sharp(srcBuf, { failOn: 'none' });
  let meta = null;
  const limit = (type === 'normal' || type === 'occlusion') ? 0 : (maxSize || 0);
  let pipeline = img;
  if (limit) {
    meta = await img.metadata();
    if (Math.max(meta.width || 0, meta.height || 0) > limit) {
      pipeline = img.resize({ width: limit, height: limit, fit: 'inside', kernel: 'lanczos3' });
    }
  }
  if (format === 'webp') {
    const out = await pipeline.webp({
      quality: quality || WEBP_QUALITY,
      chromaSubsampling: '4:4:4',   // 不做色度下采样：文字/彩色边缘不发噪
      effort: WEBP_EFFORT,
      smartSubsample: false,
    }).toBuffer();
    return { out, meta, mime: 'image/webp' };
  }
  // 兜底：PNG 无损（palette 显式关闭 —— sharp 0.35 的 png() 默认 palette:true 会静默量化）
  const out = await pipeline.png({ compressionLevel: 9, effort: effort || DEFAULT_EFFORT, palette: false }).toBuffer();
  return { out, meta, mime: 'image/png' };
}

/**
 * 压缩 GLB 内嵌纹理（原地替换，失败保留原文件）
 * @param {string} absPath 目标 GLB 绝对路径（可能是减面版 _dec.glb）
 * @param {object} [options]
 *   format    'webp'（默认）| 'png'
 *   maxSize   非 normal/occlusion 纹理最长边上限（0 = 不限制；建议 4096）
 *   quality   WebP 质量（默认 92）
 *   sourcePath 原始上传文件路径：贴图从这里取（避免继承减面时的量化损失）
 * @returns {Promise<{compressed,skipped,reason,originalSize,newSize,detail}>}
 */
async function compressTextures(absPath, options = {}) {
  const effort = options.effort || DEFAULT_EFFORT;
  const maxSize = options.maxSize || 0;
  const format = options.format || DEFAULT_FORMAT;
  const quality = options.quality || WEBP_QUALITY;
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

    // 源图分组（原始文件）。目标与源是同一文件时不必重复解析。
    const sourceGroups = (options.sourcePath && options.sourcePath !== absPath)
      ? loadSourceGroups(options.sourcePath)
      : null;

    // bufferView → images 索引（用于改写 mimeType）
    const bvToImage = new Map();
    (json.images || []).forEach((img, i) => { if (img.bufferView != null) bvToImage.set(img.bufferView, i); });

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

      if (imgs.length === 0) {
        newBuffers.push(bin.subarray(sliceStart, sliceEnd));
        continue;
      }

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

      const parts = [];
      let cursor = minOff;
      if (minOff > 0) parts.push(bin.subarray(sliceStart, sliceStart + minOff));

      const sorted = [...imgs].sort((a, b) => a.offset - b.offset);
      for (const im of sorted) {
        const bv = bvs[im.bvIndex];
        const selfBuf = bin.subarray(sliceStart + im.offset, sliceStart + im.offset + im.length);
        const type = usage.get(im.bvIndex) || 'other';

        // 贴图来源：优先原始文件同用途的图（同用途多张按顺序配对），取不到才用目标自身的图
        let srcBuf = selfBuf;
        let fromSource = false;
        if (sourceGroups) {
          const list = sourceGroups.get(type);
          if (list && list.length) { srcBuf = list.shift().buf; fromSource = true; }
        }

        const { out, meta, mime } = await encodeImage(srcBuf, type, { maxSize, format, quality, effort });
        // 用源图时质量优先（目标里那张可能已被 gltfpack 量化，即使更小也不用它）
        const keptOriginal = !fromSource && out.length >= selfBuf.length;
        const finalBuf = keptOriginal ? selfBuf : out;

        if (!keptOriginal) {
          const imgIdx = bvToImage.get(im.bvIndex);
          if (imgIdx !== undefined) {
            const img = json.images[imgIdx];
            img.mimeType = mime;
            delete img.uri;
          }
        }

        report.push({
          bufferView: im.bvIndex, type, fromSource,
          dim: meta ? ((meta.width || '?') + 'x' + (meta.height || '?')) : undefined,
          old: selfBuf.length, new: finalBuf.length, keptOriginal, mime: keptOriginal ? undefined : mime,
        });

        bv.byteOffset = cursor;
        bv.byteLength = finalBuf.length;
        parts.push(finalBuf);
        cursor += finalBuf.length;
        const pad = (4 - (cursor % 4)) % 4;
        if (pad) { parts.push(Buffer.alloc(pad, 0)); cursor += pad; }
      }

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
    return { compressed: true, skipped: false, reason: '', originalSize, newSize: outGLB.length, detail: report, format };
  } catch (e) {
    return { compressed: false, skipped: true, reason: e.message, originalSize, newSize: originalSize, detail: [] };
  }
}

module.exports = { compressTextures, WEBP_QUALITY, DEFAULT_FORMAT };
