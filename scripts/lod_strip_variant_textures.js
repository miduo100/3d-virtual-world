/**
 * lod_strip_variant_textures.js — 存量 LOD 变体贴图批量剥离（二期「变体复用高模贴图」）
 *
 * 背景：2026-09-12 实测确认变体各自内嵌整套贴图 → 前端高/中/低三变体常驻 = 每模型 3 份贴图。
 *       前端已改为复用高模材质；本脚本把存量变体文件里的贴图剥掉（几何不动，磁盘同步回收）。
 *       新上传的模型由 src/services/modelLod.js 在生成时自动剥离，无需本脚本。
 *
 * 安全：sourcePath 闸门（变体网格节点名 ⊆ 源网格节点名，否则跳过保留贴图——
 *       前端对不上名时会回退用变体自带材质，剥了就丢贴图）；strip 内部还有压缩/多 buffer/
 *       已无贴图/几何一致性等多重闸门，任何 skipped 都保留原文件。
 *
 * 用法：
 *   node scripts/lod_strip_variant_textures.js --dry     # 只统计不写盘
 *   node scripts/lod_strip_variant_textures.js           # 实际执行
 *   node scripts/lod_strip_variant_textures.js --limit 5 # 只处理前 5 个（试跑）
 */
const path = require('path');
const fs = require('fs');
const { stripVariantTextures, parseGlb, variantNamesCompatible } = require('../src/services/glbTextureStripper');
const { resolveLodSource, lodPaths } = require('../src/services/modelLod');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'models', 'uploaded');
const MAX_DEPTH = 3;

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 0 : 0;

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)}${units[i]}`;
}

/** 收集上传目录下的变体文件（_mid/_lod），跳过备份目录 */
function walkVariants(dir, depth, out) {
  if (depth > MAX_DEPTH) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  entries.forEach((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (/^_?backup/i.test(ent.name)) return;
      walkVariants(full, depth + 1, out);
    } else if (/(_mid|_lod)\.glb$/i.test(ent.name) && !/\.tmp\.glb$/i.test(ent.name)) {
      out.push(full);
    }
  });
  return out;
}

async function main() {
  const variants = walkVariants(UPLOAD_DIR, 0, []);
  console.log(`[strip] found ${variants.length} variant file(s)`);

  const rows = [];
  let stripped = 0; let skipped = 0; let failed = 0;
  let totalSaved = 0;

  for (const vPath of variants) {
    const base = path.basename(vPath).replace(/(_mid|_lod)\.glb$/i, '');
    // 生效源：X_dec.glb 优先（与 modelLod.resolveLodSource 同规则），无则 X.glb
    const plain = path.join(path.dirname(vPath), base + '.glb');
    const dec = plain.replace(/\.glb$/i, '_dec.glb');
    const sourcePath = fs.existsSync(dec) ? dec : (fs.existsSync(plain) ? plain : null);

    if (!sourcePath) {
      skipped += 1;
      rows.push({ file: path.basename(vPath), result: 'skip', reason: 'no-source' });
      continue;
    }

    if (DRY) {
      // dry 模式：只做闸门预判（网格名兼容性），不写盘
      const src = parseGlb(sourcePath);
      const varJson = parseGlb(vPath);
      if (!src || !varJson) { failed += 1; rows.push({ file: path.basename(vPath), result: 'fail', reason: 'parse' }); continue; }
      const hasImages = (varJson.json.images || []).length > 0;
      if (!hasImages) { skipped += 1; rows.push({ file: path.basename(vPath), result: 'skip', reason: 'no-images' }); continue; }
      if (!variantNamesCompatible(varJson.json, src.json)) { skipped += 1; rows.push({ file: path.basename(vPath), result: 'skip', reason: 'mesh-name-mismatch' }); continue; }
      rows.push({ file: path.basename(vPath), result: 'would-strip', size: fs.statSync(vPath).size });
      continue;
    }

    const r = await stripVariantTextures(vPath, { sourcePath });
    if (r.ok) {
      stripped += 1;
      totalSaved += r.saved;
      rows.push({ file: path.basename(vPath), result: 'stripped', saved: r.saved, images: r.images });
      console.log(`[strip] ${path.basename(vPath)}: ${fmtBytes(r.bytesBefore)} -> ${fmtBytes(r.bytesAfter)} (-${fmtBytes(r.saved)}, ${r.images} images)`);
    } else if (r.skipped) {
      skipped += 1;
      rows.push({ file: path.basename(vPath), result: 'skip', reason: r.reason, error: r.error });
    } else {
      failed += 1;
      rows.push({ file: path.basename(vPath), result: 'fail', reason: r.reason, error: r.error });
    }
    if (LIMIT && stripped >= LIMIT && !DRY) { console.log('[strip] --limit reached, stop'); break; }
  }

  console.log('\n===== SUMMARY =====');
  console.log(JSON.stringify({
    dry: DRY, total: variants.length, stripped, skipped, failed,
    totalSaved: DRY ? null : fmtBytes(totalSaved),
  }, null, 2));

  const reportPath = path.join(__dirname, `_tmp_strip_report${DRY ? '_dry' : ''}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`[strip] report: ${reportPath}`);
}

main().catch((e) => { console.error('[strip] FATAL:', e.message); process.exit(1); });
