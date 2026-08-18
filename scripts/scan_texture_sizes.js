#!/usr/bin/env node
/**
 * scan_texture_sizes.js — 扫描 GLB 内每张贴图的实际分辨率，标注是否已降级到 maxSize
 * 用法: node scripts/scan_texture_sizes.js [--max-size 2048]
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/database/db');

const PUBLIC_ROOT = path.join(__dirname, '../public');
const PX = -41.2, PZ = 224.6, RADIUS = 60;
const maxSize = parseInt(process.argv[process.argv.indexOf('--max-size') + 1]) || 2048;

function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('not a GLB');
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
  return { json, bin };
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

function pngDim(sub) {
  if (sub.length >= 24 && sub.readUInt32BE(0) === 0x89504E47) {
    return [sub.readUInt32BE(16), sub.readUInt32BE(20)];
  }
  return null;
}

(async () => {
  const { rows } = await pool.query(
    `SELECT id, model_path FROM world_objects
     WHERE position_x BETWEEN $1 AND $2 AND position_z BETWEEN $3 AND $4 AND model_path IS NOT NULL`,
    [PX - RADIUS, PX + RADIUS, PZ - RADIUS, PZ + RADIUS]
  );
  const seen = new Map();
  for (const r of rows) {
    if (!r.model_path || seen.has(r.model_path)) continue;
    let rel = r.model_path.replace(/^\//, '');
    if (rel.startsWith('public/')) rel = rel.slice('public/'.length);
    const fp = path.join(PUBLIC_ROOT, rel);
    if (fs.existsSync(fp)) seen.set(r.model_path, fp);
  }

  const files = [...seen.values()];
  console.log(`Scanning ${files.length} files, max-size=${maxSize}`);

  let needTotal = 0;
  for (const fp of files) {
    let json;
    try { json = parseGLB(fs.readFileSync(fp)).json; }
    catch (e) { console.log(`${path.basename(fp)}: PARSE FAIL ${e.message}`); continue; }
    const usage = classifyTextures(json);
    const bufStart = [];
    let acc = 0;
    for (const b of json.buffers) { bufStart.push(acc); acc += b.byteLength; }
    const bin = parseGLB(fs.readFileSync(fp)).bin;

    let need = false;
    const parts = [];
    for (const [bvIdx, type] of usage) {
      const bv = json.bufferViews[bvIdx];
      const gOff = bufStart[bv.buffer] + (bv.byteOffset || 0);
      const dim = pngDim(bin.subarray(gOff, gOff + bv.byteLength));
      const over = dim && type !== 'normal' && type !== 'occlusion' && Math.max(dim[0], dim[1]) > maxSize;
      if (over) need = true;
      parts.push(`${type}=${dim ? dim.join('x') : '?'}${over ? ' <-- OVER' : ''}`);
    }
    if (need) needTotal++;
    console.log(`${need ? '[NEED]' : '[ OK ]'} ${path.basename(fp)}  ${parts.join(' | ')}`);
  }
  console.log(`Files still needing recompress: ${needTotal}`);
  await pool.end();
})().catch(e => { console.error('SCAN FAIL:', e.message); process.exit(1); });
