/**
 * lod_backfill_low_variants.js — 强制补生成被收益闸门拦下的低模（_lod.glb）
 *
 * 背景（2026-09-12 GPU 100% 深查）：7 个红军模型当年被「低模≥中模」收益闸门拦下无 _lod.glb，
 * 前端对这 7 组走「变体缺失→高模兜底」且远界回落 200m → 用户配置 far=50 也不生效，
 * 232 实例仍渲染高模。阶段 5 已定论「低模文件必须存在（它是远界的开关）」，
 * 故此处绕过收益闸门直接补生成（低模≈中模面数是可接受的，阶段 5 决策）。
 *
 * 识别口径：有 _mid.glb 且无 _lod.glb 的基准名（skip.json 存在与否均可）。
 * 成功后删除对应的 _lod.skip.json，使 scanStatus 恢复正常计数。
 *
 * 用法：node scripts/lod_backfill_low_variants.js [--dry]
 */
const path = require('path');
const fs = require('fs');
const { runPack } = require('../src/services/modelDecimate');
const { stripVariantTextures } = require('../src/services/glbTextureStripper');
const { lodPaths, resolveLodSource, countTrisExact, UPLOAD_DIR, MID_SUFFIX, LOW_SUFFIX } = require('../src/services/modelLod');

const DRY = process.argv.includes('--dry');
const MIN_OUTPUT_TRIS = 300;
const MAX_DEPTH = 3;

function walkGlb(dir, depth, out) {
  if (depth > MAX_DEPTH) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  entries.forEach((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (/^_?backup/i.test(ent.name)) return;
      walkGlb(full, depth + 1, out);
    } else if (/\.glb$/i.test(ent.name) && !/\.tmp\.glb$/i.test(ent.name)) {
      out.push(full);
    }
  });
  return out;
}

async function main() {
  const all = walkGlb(UPLOAD_DIR, 0, []);
  const mids = new Map(); // base(abs dir|name) → midPath
  all.forEach((p) => {
    if (new RegExp(MID_SUFFIX.replace('.', '\\.') + '$', 'i').test(p)) {
      mids.set(path.dirname(p).toLowerCase() + '|' + path.basename(p, MID_SUFFIX).toLowerCase(), p);
    }
  });
  const lows = new Set(all.filter((p) => new RegExp(LOW_SUFFIX.replace('.', '\\.') + '$', 'i').test(p))
    .map((p) => path.dirname(p).toLowerCase() + '|' + path.basename(p, LOW_SUFFIX).toLowerCase()));

  const missing = [];
  mids.forEach((midPath, key) => { if (!lows.has(key)) missing.push(key); });
  console.log(`[backfill] ${mids.size} mid variant(s), ${lows.size} low variant(s), missing low: ${missing.length}`);

  let ok = 0; let fail = 0;
  for (const key of missing) {
    const midPath = mids.get(key);
    const dir = midPath.slice(0, midPath.length - path.basename(midPath).length);
    const baseName = path.basename(midPath, MID_SUFFIX); // 保留原始大小写
    // 生效源：与 modelLod 同规则（_dec 优先）；基准名从 mid 文件名反推
    const guessSrc = path.join(dir, baseName + '.glb');
    const decSrc = guessSrc.replace(/\.glb$/i, '_dec.glb');
    const srcPath = resolveLodSource(fs.existsSync(decSrc) ? decSrc : guessSrc);
    const { lowPath } = lodPaths(srcPath);
    const srcTris = countTrisExact(srcPath);
    if (DRY) { console.log(`[backfill][dry] ${path.basename(lowPath)} <- ${path.basename(srcPath)} (${srcTris} tris)`); continue; }

    const tmpPath = lowPath + '.tmp.glb';
    try {
      await runPack(srcPath, tmpPath, '0.1');
      if (!fs.existsSync(tmpPath)) { console.log(`[backfill] FAIL no-output: ${baseName}`); fail++; continue; }
      const outTris = countTrisExact(tmpPath);
      if (outTris < MIN_OUTPUT_TRIS || outTris >= srcTris) {
        fs.unlinkSync(tmpPath);
        console.log(`[backfill] FAIL tris ${srcTris}->${outTris}: ${baseName}`);
        fail++; continue;
      }
      // 与上传管线同口径：剥贴图（前端复用高模材质）
      const st = await stripVariantTextures(tmpPath, { sourcePath: srcPath });
      if (st.ok) console.log(`[backfill]   stripped ${fmt(st.saved)}`);
      fs.renameSync(tmpPath, lowPath);
      // 清除收益闸门标记（如有），使 scanStatus 不再把它算待生成/已拦截
      const skipPath = lowPath.replace(/\.glb$/i, '') + '.skip.json';
      if (fs.existsSync(skipPath)) fs.unlinkSync(skipPath);
      ok++;
      console.log(`[backfill] OK ${path.basename(lowPath)} (${srcTris} -> ${outTris} tris)`);
    } catch (e) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
      console.log(`[backfill] FAIL ${baseName}: ${e.message}`);
      fail++;
    }
  }
  console.log(`[backfill] DONE ok=${ok} fail=${fail}`);
  function fmt(n) { return (n / 1048576).toFixed(1) + 'MB'; }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
