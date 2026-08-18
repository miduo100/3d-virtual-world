#!/usr/bin/env node
/**
 * recompress_textures.js — GLB 内嵌 PNG 纹理重压缩试验脚本
 *
 * 用法：
 *   node scripts/recompress_textures.js <file.glb>                    # dry-run：输出到 *.tex.glb 供验证
 *   node scripts/recompress_textures.js <file.glb> --apply            # 备份到 _backup_纹理压缩前/ 后原地替换
 *   node scripts/recompress_textures.js <file.glb> --apply --max-size 2048  # 超过2048px的非法线纹理降分辨率
 *
 * 策略（按纹理用途区分）：
 *   normal / occlusion       → 无损重编码（compressionLevel 9, effort 10），不降分辨率不量化
 *   metallicRoughness        → palette 256 色 + quality 95（近似无损）
 *   baseColor / 其他          → palette 256 色 + quality 80（视觉几乎无差）
 *
 * 安全：
 *   - 仅支持"图片位于 buffer 0 前段、几何数据(含 meshopt 压缩流)位于后段"的 gltfpack 布局，否则报错中止
 *   - 不支持文件中含多个 buffer 实际数据（gltfpack fallback 未写入文件时 OK）
 *   - 单张纹理压完若反而变大 → 保留原始数据
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// ---------- GLB 解析 / 组装 ----------
function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('不是有效的 GLB 文件');
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
  if (!json || !bin) throw new Error('GLB 缺少 JSON 或 BIN chunk');
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
  const usage = new Map(); // bufferViewIndex -> type
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

async function recompress(pngBuf, type, maxSize) {
  const img = sharp(pngBuf, { failOn: 'none' });
  const meta = await img.metadata();
  let pipeline = img;
  const limit = (type === 'normal' || type === 'occlusion') ? 0 : maxSize; // 法线图不降分辨率
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
  if (!file || !fs.existsSync(file)) { console.error('用法: node scripts/recompress_textures.js <file.glb> [--apply] [--max-size N]'); process.exit(1); }
  let apply = false, maxSize = 0;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--max-size') maxSize = parseInt(args[++i]) || 0;
  }

  const raw = fs.readFileSync(file);
  const { json, bin } = parseGLB(raw);
  const bvs = json.bufferViews || [];

  // ---- 安全检查 ----
  if (json.buffers.length > 1 && bin.length > json.buffers[0].byteLength) {
    throw new Error('文件包含多 buffer 实际数据（fallback 已写入文件），超出本试验支持范围，中止');
  }
  const usage = classifyTextures(json);
  const imageBvIndices = [...usage.keys()];
  let imageEnd = 0;
  for (const i of imageBvIndices) {
    const bv = bvs[i];
    if (!bv) throw new Error('bufferView 缺失: ' + i);
    if (bv.buffer !== undefined && bv.buffer !== 0) throw new Error(`图片 bufferView ${i} 不在 buffer 0，中止`);
    if (bv.byteOffset == null) bv.byteOffset = 0;
    imageEnd = Math.max(imageEnd, bv.byteOffset + bv.byteLength);
  }
  for (let i = 0; i < bvs.length; i++) {
    if (usage.has(i)) continue;
    const bv = bvs[i];
    const usesBuffer0 = bv.buffer === undefined || bv.buffer === 0;
    if (usesBuffer0 && bv.byteOffset < imageEnd) throw new Error(`非图片 bufferView ${i} 与图片区域交错，不支持，中止`);
    const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
    if (ext && ext.buffer === 0 && ext.byteOffset < imageEnd) throw new Error(`bufferView ${i} 的 meshopt 压缩流位于图片区域，中止`);
  }

  console.log('════════ 纹理重压缩 ' + (apply ? '[APPLY]' : '[DRY-RUN]') + ' ════════');
  console.log('文件:', file, '(', fmt(raw.length), ')');
  console.log('图片区域: 0 ~', imageEnd, '| 几何数据区:', imageEnd, '~', bin.length);

  // ---- 逐图压缩 ----
  const report = [];
  const parts = [];
  let cursor = 0;
  for (const i of imageBvIndices) {
    const bv = bvs[i];
    const pngBuf = bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
    const type = usage.get(i);
    const { out, meta } = await recompress(pngBuf, type, maxSize);
    const keptOriginal = out.length >= pngBuf.length;
    const finalBuf = keptOriginal ? pngBuf : out;
    report.push({ i, type, dim: (meta.width || '?') + 'x' + (meta.height || '?'), old: pngBuf.length, neu: finalBuf.length, keptOriginal });

    bv.byteOffset = cursor;
    bv.byteLength = finalBuf.length;
    parts.push(finalBuf);
    cursor += finalBuf.length;
    const pad = (4 - (cursor % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad, 0)); cursor += pad; }
  }

  // ---- 追加几何数据区（原样拷贝）并平移偏移 ----
  const delta = cursor - imageEnd;
  parts.push(bin.subarray(imageEnd));
  const newBin = Buffer.concat(parts);
  if (delta !== 0) {
    for (let i = 0; i < bvs.length; i++) {
      if (usage.has(i)) continue;
      const bv = bvs[i];
      const usesBuffer0 = bv.buffer === undefined || bv.buffer === 0;
      if (usesBuffer0 && bv.byteOffset >= imageEnd) bv.byteOffset += delta;
      const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
      if (ext && ext.buffer === 0 && ext.byteOffset >= imageEnd) ext.byteOffset += delta;
    }
  }
  json.buffers[0].byteLength = newBin.length;

  const outGLB = buildGLB(json, newBin);

  // ---- 报告 ----
  let texOld = 0, texNew = 0;
  for (const r of report) {
    texOld += r.old; texNew += r.neu;
    console.log(`  [${r.type.padEnd(19)}] bv${String(r.i).padStart(2)} ${r.dim.padStart(10)}  ${fmt(r.old).padStart(9)} → ${fmt(r.neu).padStart(9)}  (-${(100 - r.neu / r.old * 100).toFixed(1)}%)${r.keptOriginal ? ' [压完更大,保留原图]' : ''}`);
  }
  console.log(`  纹理合计: ${fmt(texOld)} → ${fmt(texNew)} (-${(100 - texNew / texOld * 100).toFixed(1)}%)`);
  console.log(`  文件总计: ${fmt(raw.length)} → ${fmt(outGLB.length)} (-${(100 - outGLB.length / raw.length * 100).toFixed(1)}%)`);

  if (apply) {
    const backupDir = path.join(path.dirname(file), '_backup_纹理压缩前');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, path.basename(file));
    if (!fs.existsSync(backupPath)) fs.copyFileSync(file, backupPath);
    fs.writeFileSync(file, outGLB);
    console.log('✅ 已写盘:', file, '(' + outGLB.length + ' B)  备份:', backupPath);
  } else {
    const outPath = file.replace(/\.glb$/i, '') + '.tex.glb';
    fs.writeFileSync(outPath, outGLB);
    console.log('dry-run 输出(供验证):', outPath);
  }
}

main().catch(e => { console.error('❌ 失败:', e.message); process.exit(1); });
