#!/usr/bin/env node
/**
 * recompress_textures_v2.js — GLB 内嵌 PNG 纹理重压缩（支持多 buffer 布局）
 *
 * 适用布局（gltfpack -cc 输出）：
 *   - 图片 bufferView 位于所属 buffer 的前段，可跨越 0..N 个 buffer
 *   - 每个含图片的 buffer：图片区之前/之后可以有几何数据或 meshopt 压缩流
 *   - 图片压缩后，同 buffer 内图片区之后的 bufferView / EXT_meshopt_compression 偏移整体平移
 *   - 不含图片的 buffer 原样保留
 *
 * 用法：
 *   node scripts/recompress_textures_v2.js <file.glb>                     # dry-run：输出 *.tex.glb
 *   node scripts/recompress_textures_v2.js <file.glb> --apply             # 备份到 _backup_纹理压缩前/ 后原地替换
 *   node scripts/recompress_textures_v2.js <file.glb> --apply --max-size 2048  # 超 2048px 的非法线纹理降分辨率
 *
 * 策略（与 v1 一致，按纹理用途区分）：
 *   normal / occlusion  → 无损重编码，不降分辨率不量化
 *   metallicRoughness   → palette 256 + quality 95
 *   baseColor / 其他     → palette 256 + quality 80
 *
 * 安全：
 *   - 图片区与几何数据交错的 buffer → 报错中止（不写盘）
 *   - 单张纹理压完若反而变大 → 保留原始数据
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('not a valid GLB');
  const totalLen = buf.readUInt32LE(8);
  let offset = 12, json = null, bin = null;
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

function classifyTextures(json) {
  const usage = new Map();
  const mark = (texIdx, type) => {
    if (texIdx == null) return;
    const tex = (json.textures || [])[texIdx];
    if (!tex) return;
    const img = (json.images || [])[tex.source];
    if (img && img.bufferView != null && !usage.has(img.bufferView)) usage.set(img.bufferView, type);
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

async function recompress(pngBuf, type, maxSize) {
  const img = sharp(pngBuf, { failOn: 'none' });
  const meta = await img.metadata();
  let pipeline = img;
  const limit = (type === 'normal' || type === 'occlusion') ? 0 : maxSize;
  if (limit && Math.max(meta.width || 0, meta.height || 0) > limit) {
    pipeline = pipeline.resize({ width: limit, height: limit, fit: 'inside', kernel: 'lanczos3' });
  }
  let opts;
  if (type === 'normal' || type === 'occlusion') {
    opts = { compressionLevel: 9, effort: 10 };
  } else if (type === 'metallicRoughness') {
    opts = { palette: true, quality: 95, compressionLevel: 9, effort: 10 };
  } else {
    opts = { palette: true, quality: 80, compressionLevel: 9, effort: 10 };
  }
  const out = await pipeline.png(opts).toBuffer();
  return { out, meta };
}

function fmt(b) {
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + 'MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + 'KB';
  return b + 'B';
}

async function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file || !fs.existsSync(file)) { console.error('usage: node scripts/recompress_textures_v2.js <file.glb> [--apply] [--max-size N]'); process.exit(1); }
  let apply = false, maxSize = 0;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--max-size') maxSize = parseInt(args[++i]) || 0;
  }

  const raw = fs.readFileSync(file);
  const { json, bin } = parseGLB(raw);
  const bvs = json.bufferViews || [];
  const usage = classifyTextures(json);
  const imgBvIndices = [...usage.keys()];

  // 每个 buffer 在 BIN chunk 内的起始偏移
  const bufStart = [];
  let acc = 0;
  for (const b of json.buffers) { bufStart.push(acc); acc += b.byteLength; }

  console.log('════════ texture recompress v2 ' + (apply ? '[APPLY]' : '[DRY-RUN]') + ' ════════');
  console.log('file:', file, '(', fmt(raw.length), ') | buffers:', json.buffers.length);

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
      console.log(`buffer[${bufIdx}]: no images, keep as-is (${fmt(sliceEnd - sliceStart)})`);
      newBuffers.push(bin.subarray(sliceStart, sliceEnd));
      continue;
    }

    // 图片区范围
    let minOff = Infinity, imageEnd = 0;
    for (const im of imgs) { minOff = Math.min(minOff, im.offset); imageEnd = Math.max(imageEnd, im.offset + im.length); }

    // 安全检查：图片区内不得有非图片 bufferView / meshopt 流
    for (let i = 0; i < bvs.length; i++) {
      if (imgBvIndices.includes(i)) continue;
      const bv = bvs[i];
      const off = bv.byteOffset || 0;
      if (bv.buffer === bufIdx && off < imageEnd && off + bv.byteLength > minOff) {
        throw new Error(`buffer ${bufIdx}: non-image bufferView ${i} overlaps image region, abort`);
      }
      const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
      if (ext && ext.buffer === bufIdx && ext.byteOffset < imageEnd && ext.byteOffset + ext.byteLength > minOff) {
        throw new Error(`buffer ${bufIdx}: meshopt stream of bv ${i} inside image region, abort`);
      }
    }

    console.log(`buffer[${bufIdx}]: ${imgs.length} images, region ${minOff}..${imageEnd} of ${sliceEnd - sliceStart}`);

    const parts = [];
    let cursor = minOff;
    if (minOff > 0) parts.push(bin.subarray(sliceStart, sliceStart + minOff));

    const sorted = [...imgs].sort((a, b) => a.offset - b.offset);
    for (const im of sorted) {
      const bv = bvs[im.bvIndex];
      const pngBuf = bin.subarray(sliceStart + im.offset, sliceStart + im.offset + im.length);
      const type = usage.get(im.bvIndex);
      const { out, meta } = await recompress(pngBuf, type, maxSize);
      const keptOriginal = out.length >= pngBuf.length;
      const finalBuf = keptOriginal ? pngBuf : out;
      report.push({ i: im.bvIndex, type, dim: (meta.width || '?') + 'x' + (meta.height || '?'), old: pngBuf.length, neu: finalBuf.length, keptOriginal });
      bv.byteOffset = cursor;
      bv.byteLength = finalBuf.length;
      parts.push(finalBuf);
      cursor += finalBuf.length;
      const pad = (4 - (cursor % 4)) % 4;
      if (pad) { parts.push(Buffer.alloc(pad, 0)); cursor += pad; }
    }

    const tailStart = sliceStart + imageEnd;
    const tailEnd = sliceEnd;
    if (tailEnd > tailStart) {
      const delta = cursor - imageEnd;
      parts.push(bin.subarray(tailStart, tailEnd));
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
    console.log(`  buffer[${bufIdx}] rebuilt: ${fmt(sliceEnd - sliceStart)} -> ${fmt(newBuf.length)}`);
  }

  const newBin = Buffer.concat(newBuffers);
  const outGLB = buildGLB(json, newBin);

  let texOld = 0, texNew = 0;
  for (const r of report) {
    texOld += r.old; texNew += r.neu;
    console.log(`  [${r.type.padEnd(19)}] bv${String(r.i).padStart(2)} ${r.dim.padStart(10)}  ${fmt(r.old).padStart(9)} -> ${fmt(r.neu).padStart(9)}  (-${(100 - r.neu / r.old * 100).toFixed(1)}%)${r.keptOriginal ? ' [kept original]' : ''}`);
  }
  console.log(`  textures: ${fmt(texOld)} -> ${fmt(texNew)} (-${(100 - texNew / texOld * 100).toFixed(1)}%)`);
  console.log(`  file: ${fmt(raw.length)} -> ${fmt(outGLB.length)} (-${(100 - outGLB.length / raw.length * 100).toFixed(1)}%)`);

  if (apply) {
    const backupDir = path.join(path.dirname(file), '_backup_纹理压缩前');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, path.basename(file));
    if (!fs.existsSync(backupPath)) fs.copyFileSync(file, backupPath);
    fs.writeFileSync(file, outGLB);
    console.log('written:', file, '(' + outGLB.length + ' B) backup:', backupPath);
  } else {
    const outPath = file.replace(/\.glb$/i, '') + '.tex.glb';
    fs.writeFileSync(outPath, outGLB);
    console.log('dry-run output:', outPath);
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
