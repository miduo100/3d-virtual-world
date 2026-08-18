#!/usr/bin/env node
/**
 * planA_recompress.js — 方案A：教室模型批量降分辨率（4K -> 2K）
 * 逐个调用已验证的 recompress_textures.js（继承其安全机制：备份/无收益保护/布局断言）
 * 完成后同步 uploaded_models.file_size
 *
 * 用法:
 *   node scripts/planA_recompress.js --dry             # 预览（输出 *.tex.glb，不写盘不动库）
 *   node scripts/planA_recompress.js --apply --max-size 2048   # 正式执行
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pool } = require('../src/database/db');

const PUBLIC_ROOT = path.join(__dirname, '../public');
const SINGLE = path.join(__dirname, 'recompress_textures_v2.js');
const UPLOAD_DIR = path.join(PUBLIC_ROOT, 'models/uploaded');
const BACKUP_DIR = path.join(UPLOAD_DIR, '_backup_纹理压缩前');
const PX = -41.2, PZ = 224.6, RADIUS = 60;

function fmt(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(2) + 'MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + 'KB';
  return b + 'B';
}

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

// 检查当前文件是否还有超过 maxSize 的非法线贴图（需要处理则返回 true）
function needsRecompress(fp, maxSize) {
  let json, bin;
  try {
    const parsed = parseGLB(fs.readFileSync(fp));
    json = parsed.json; bin = parsed.bin;
  } catch { return true; }
  const usage = classifyTextures(json);
  const bufStart = [];
  let acc = 0;
  for (const b of json.buffers) { bufStart.push(acc); acc += b.byteLength; }
  for (const [bvIdx, type] of usage) {
    if (type === 'normal' || type === 'occlusion') continue;
    const bv = json.bufferViews[bvIdx];
    const gOff = bufStart[bv.buffer] + (bv.byteOffset || 0);
    const sub = bin.subarray(gOff, gOff + bv.byteLength);
    if (sub.length >= 24 && sub.readUInt32BE(0) === 0x89504E47) {
      const w = sub.readUInt32BE(16), h = sub.readUInt32BE(20);
      if (Math.max(w, h) > maxSize) return true;
    }
  }
  return false;
}

async function collectTargetFiles() {
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
    else console.log(`[MISS] ${r.model_path}`);
  }
  return [...seen.values()];
}

async function syncDB() {
  const files = fs.readdirSync(path.join(PUBLIC_ROOT, 'models/uploaded')).filter(f => /\.glb$/i.test(f));
  let updated = 0;
  for (const f of files) {
    const size = fs.statSync(path.join(PUBLIC_ROOT, 'models/uploaded', f)).size;
    const r = await pool.query(
      'UPDATE uploaded_models SET file_size = $1 WHERE saved_file_name = $2 AND file_size <> $1',
      [size, f]
    );
    updated += r.rowCount;
  }
  return updated;
}

(async () => {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const maxSizeIdx = args.indexOf('--max-size');
  const maxSize = maxSizeIdx >= 0 ? parseInt(args[maxSizeIdx + 1]) || 0 : 0;

  let files = await collectTargetFiles();
  console.log(`Target: ${files.length} GLB | mode: ${dry ? 'DRY-RUN' : 'APPLY'} | max-size: ${maxSize || 'none'}`);

  let totalBefore = 0, totalAfter = 0, ok = 0, skipNoGain = 0, skipDone = 0, fail = 0;
  for (const fp of files) {
    if (maxSize && !needsRecompress(fp, maxSize)) {
      skipDone++;
      console.log(`[DONE] ${path.basename(fp)}: textures already <= ${maxSize}, skip`);
      continue;
    }
    const before = fs.statSync(fp).size;
    const childArgs = [SINGLE, fp];
    if (!dry) childArgs.push('--apply');
    if (maxSize) childArgs.push('--max-size', String(maxSize));
    const r = spawnSync(process.execPath, childArgs, { encoding: 'utf8', timeout: 600000 });

    const outPath = dry ? fp.replace(/\.glb$/i, '') + '.tex.glb' : fp;
    const after = fs.existsSync(outPath) ? fs.statSync(outPath).size : before;

    if (r.status !== 0) {
      fail++;
      const msg = (r.stderr || r.stdout || 'unknown').split('\n').filter(Boolean).pop();
      console.log(`[FAIL] ${path.basename(fp)}: ${msg}`);
      if (dry && fs.existsSync(outPath)) fs.unlinkSync(outPath);
      continue;
    }
    if (after < before) {
      ok++;
      console.log(`[ OK ] ${path.basename(fp)}: ${fmt(before)} -> ${fmt(after)} (-${(100 - after / before * 100).toFixed(1)}%)`);
    } else {
      skipNoGain++;
      console.log(`[SKIP] ${path.basename(fp)}: ${fmt(before)} no gain, keep original`);
    }
    totalBefore += before;
    totalAfter += after;
    if (dry && fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }

  console.log('════════ SUMMARY ════════');
  console.log(`ok=${ok} | already-done=${skipDone} | no-gain=${skipNoGain} | fail=${fail}`);
  if (totalBefore > 0) {
    console.log(`Total: ${fmt(totalBefore)} -> ${fmt(totalAfter)} (save ${fmt(totalBefore - totalAfter)}, -${(100 - totalAfter / totalBefore * 100).toFixed(1)}%)`);
  }

  if (!dry) {
    const n = await syncDB();
    console.log(`DB uploaded_models.file_size synced: ${n} rows`);
  }
  await pool.end();
})().catch(e => { console.error('PLAN A FAIL:', e.message); process.exit(1); });
