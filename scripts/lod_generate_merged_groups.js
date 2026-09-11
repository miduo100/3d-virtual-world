/**
 * lod_generate_merged_groups.js — 为「会被合批的模型组」预生成 LOD 中低模
 *
 * 用途：阶段 4 前端三带渲染验收的前置条件（D1/D4 需要红军等合批组已有 _mid/_lod）。
 *       与阶段 5 的「全量转换」区别：只处理 world_objects 中同源副本数 ≥ min 的模型。
 * 用法：node scripts/lod_generate_merged_groups.js [--min 6] [--dry]
 * 输出：每个模型的 源面数 / 中模比例 / 低模比例 / 耗时；结束给磁盘增量汇总。
 */
const fs = require('fs');
const path = require('path');
const { query } = require('../src/database/db');
const { generateLodVariants, countTrisExact, lodPaths } = require('../src/services/modelLod');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const minIdx = args.indexOf('--min');
const MIN_GROUP = minIdx >= 0 ? parseInt(args[minIdx + 1], 10) || 6 : 6;

(async () => {
  const r = await query(
    `SELECT model_path, COUNT(*) AS cnt FROM world_objects
     WHERE model_path IS NOT NULL AND model_path <> '' AND LOWER(model_path) LIKE '%.glb'
     GROUP BY model_path HAVING COUNT(*) >= $1 ORDER BY cnt DESC`,
    [MIN_GROUP]
  );
  console.log(`merged groups (count >= ${MIN_GROUP}): ${r.rows.length}${dry ? ' (dry run)' : ''}`);

  let diskBefore = 0;
  let diskAfter = 0;
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of r.rows) {
    const abs = path.join(__dirname, '..', 'public', row.model_path.replace(/^[\\/]+/, ''));
    if (!fs.existsSync(abs)) {
      console.log(`  SKIP (missing) ${row.model_path}`);
      skipped += 1;
      continue;
    }
    const p = lodPaths(abs);
    const sizeBefore = fs.statSync(abs).size;
    diskBefore += sizeBefore;
    const midExistsBefore = fs.existsSync(p.midPath);
    const lowExistsBefore = fs.existsSync(p.lowPath);
    if (midExistsBefore && lowExistsBefore) {
      diskAfter += sizeBefore + fs.statSync(p.midPath).size + fs.statSync(p.lowPath).size;
      console.log(`  EXISTS ${row.model_path} (${row.cnt} 副本)`);
      skipped += 1;
      continue;
    }
    if (dry) {
      diskAfter += sizeBefore;
      console.log(`  DRY    ${row.model_path} (${row.cnt} 副本) tris=${countTrisExact(abs)}`);
      continue;
    }
    const t0 = Date.now();
    const res = await generateLodVariants(abs);
    const ms = Date.now() - t0;
    const srcTris = res.sourceTris || countTrisExact(abs);
    const midTris = fs.existsSync(p.midPath) ? countTrisExact(p.midPath) : 0;
    const lowTris = fs.existsSync(p.lowPath) ? countTrisExact(p.lowPath) : 0;
    const midSize = fs.existsSync(p.midPath) ? fs.statSync(p.midPath).size : 0;
    const lowSize = fs.existsSync(p.lowPath) ? fs.statSync(p.lowPath).size : 0;
    diskAfter += sizeBefore + midSize + lowSize;
    if (res.ok) {
      ok += 1;
      const midPct = srcTris ? (midTris / srcTris * 100).toFixed(1) : '?';
      const lowPct = srcTris ? (lowTris / srcTris * 100).toFixed(1) : '?';
      console.log(`  OK     ${row.model_path} (${row.cnt} 副本) src=${srcTris} mid=${midTris}(${midPct}%) low=${lowTris}(${lowPct}%) +${((midSize + lowSize) / 1048576).toFixed(2)}MB ${ms}ms`);
    } else {
      failed += 1;
      console.log(`  FAIL   ${row.model_path} reason=${res.reason} ${ms}ms`);
    }
  }

  console.log(`\nsummary: ok=${ok} skipped=${skipped} failed=${failed}`);
  console.log(`disk: ${(diskBefore / 1048576).toFixed(1)}MB -> ${(diskAfter / 1048576).toFixed(1)}MB (+${((diskAfter - diskBefore) / 1048576).toFixed(1)}MB, +${diskBefore ? ((diskAfter / diskBefore - 1) * 100).toFixed(1) : 0}%)`);
  process.exit(0);
})();
