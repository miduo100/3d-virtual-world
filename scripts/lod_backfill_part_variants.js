/**
 * 零件库热点零件 LOD 变体补齐（2026-10-15）
 *
 * 背景：零件库入库链从不生成 LOD 变体（partClassifier.LOD_MIN_TRIS=5000，
 * 全部零件 lod_policy='never'）。人手摆几个零件时成立，但 AI 自由拼装会把
 * 同一零件摆几百次（城堡 566 实例、乐高砖 559 实例…），GPU 成本 = 单件面数 ×
 * 实例数。零件 URL 全部被 worldInstanceMerger_v2 合批，合批组分带依赖该 URL
 * 的 _mid/_lod 变体文件 —— 变体缺失 = 全程高模。
 *
 * 做法：扫 world_objects 按模型 URL 聚合实例数，对
 *   总面数 = 实例数 × 单件面数 ≥ min-total
 * 且单件面数 ≥ min-source 的 .glb 零件调 modelLod.generateLodVariants
 * （放宽 minSourceTris 门禁）。前端零改动（WorldLodAssets 按 URL 探测变体，
 * 刷新页面后合批组自动分带）。
 *
 * 已知边界：
 *   - 只处理 .glb。.gltf 零件（Kenney 部分）前端 worldLodAssets.lodUrl 不支持
 *     .gltf 变体 URL，生成了也不会被消费，显式跳过并列出。
 *   - 生成走 modelLod 既有管线（原子写盘 / 低模 -sa 触底 / 变体剥贴图复用高模材质）。
 *
 * 用法：
 *   node scripts/lod_backfill_part_variants.js [--dry] [--min-total 10000] [--min-source 64] [--force]
 */
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');
const { generateLodVariants, UPLOAD_DIR } = require('../src/services/modelLod');

// ---- 参数 ----
const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const numArg = (k, dflt) => {
  const i = args.indexOf(k);
  if (i < 0 || !args[i + 1]) return dflt;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
const DRY = has('--dry');
const MIN_TOTAL = numArg('--min-total', 10000);
const MIN_SOURCE = numArg('--min-source', 64);
const FORCE = has('--force');

// ---- .env ----
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const PUBLIC_DIR = path.resolve(UPLOAD_DIR, '..', '..');

function urlToAbs(u) {
  // 通用映射：站点 URL 直接映射到 public 根
  //   /models/uploaded/bundle-x/... → public/models/uploaded/bundle-x/...
  //   /models/builtin/ldraw/x.glb   → public/models/builtin/ldraw/x.glb
  const rel = String(u).replace(/^\/+/, '').replace(/[?#].*$/, '');
  return path.join(PUBLIC_DIR, rel);
}

(async () => {
  const c = new Client({
    host: env.DB_HOST || 'localhost', port: +(env.DB_PORT || 5432),
    database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
  });
  await c.connect();
  const r = await c.query(
    `SELECT u.path,
            count(*)::int AS instances,
            MAX((i.metadata->>'tris')::int) AS tris
       FROM world_objects o
       JOIN uploaded_models u ON u.path = o.model_path
       LEFT JOIN part_library_items i ON i.model_id = u.id
      GROUP BY u.path`
  );
  await c.end();

  const rows = r.rows.map((x) => ({ ...x, totalTris: x.instances * (x.tris || 0) }));
  const hot = rows
    .filter((x) => x.totalTris >= MIN_TOTAL)
    .sort((a, b) => b.totalTris - a.totalTris);

  console.log(`world_objects 引用的模型 URL 共 ${rows.length} 个；总面数 >= ${MIN_TOTAL} 的热点 ${hot.length} 个`);
  console.log(`门禁：单件面数 >= ${MIN_SOURCE}；DRY=${DRY} FORCE=${FORCE}\n`);

  const results = [];
  for (const x of hot) {
    const ext = path.extname(x.path).toLowerCase();
    const label = `${x.path.split('/').pop()} (${x.instances} 实例 × ${x.tris} 面 = ${x.totalTris})`;
    if (ext !== '.glb') {
      console.log(`SKIP  ${label} — .${ext} 变体前端不支持（worldLodAssets.lodUrl 仅认 .glb）`);
      results.push({ label, status: 'skipped-gltf' });
      continue;
    }
    if ((x.tris || 0) < MIN_SOURCE) {
      console.log(`SKIP  ${label} — 单件面数低于门禁`);
      results.push({ label, status: 'skipped-lowpoly' });
      continue;
    }
    const abs = urlToAbs(x.path);
    if (!fs.existsSync(abs)) {
      console.log(`SKIP  ${label} — 磁盘文件不存在: ${abs}`);
      results.push({ label, status: 'missing' });
      continue;
    }
    if (DRY) {
      console.log(`DRY   ${label} — 将生成变体: ${abs}`);
      results.push({ label, status: 'dry' });
      continue;
    }
    try {
      const res = await generateLodVariants(abs, { force: FORCE, minSourceTris: MIN_SOURCE });
      if (res.ok) {
        const mid = res.variants.mid || {};
        const low = res.variants.low || {};
        console.log(`OK    ${label} — mid=${mid.tris != null ? mid.tris : '?'}面 low=${low.tris != null ? low.tris : '?'}面`);
        results.push({ label, status: 'ok', mid: mid.tris, low: low.tris });
      } else {
        console.log(`FAIL  ${label} — skipped=${res.skipped} reason=${res.reason || res.error || '?'}`);
        results.push({ label, status: 'fail', reason: res.reason || res.error });
      }
    } catch (e) {
      console.log(`FAIL  ${label} — ${e.message}`);
      results.push({ label, status: 'fail', reason: e.message });
    }
  }

  const ok = results.filter((x) => x.status === 'ok').length;
  const fail = results.filter((x) => x.status === 'fail').length;
  console.log(`\n完成：OK=${ok} FAIL=${fail} 跳过=${results.length - ok - fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
