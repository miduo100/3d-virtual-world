/**
 * LDraw 内置零件库 seed（M2）
 *
 * 把 public/models/builtin/ldraw/ 下的 170 件 GLB 幂等入库：
 *   part_libraries（pack_key='ldraw_builtin', source_type='builtin'）
 *   + uploaded_models（part_category='part', path 指向 git 内静态文件）
 *   + part_library_items（role 来自转换 manifest，尺寸为米制 bbox）
 *
 * 幂等：uploaded_models 按 path 复用已有行；part_library_items 走
 * (library_id, part_key) ON CONFLICT DO UPDATE —— 重复执行不产生新行/孤儿。
 *
 * 用法：node scripts/ldraw_seed.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/database/db');
const classifier = require('../src/services/partClassifier');
const { ensureLibrary, refreshLibraryStats, pruneOrphanModels } = require('../src/services/partLibraryRegistrar');

const MANIFEST = path.join(__dirname, 'ldraw_parts_manifest.json');
const GLB_DIR = path.join(__dirname, '..', 'public', 'models', 'builtin', 'ldraw');
const URL_PREFIX = '/models/builtin/ldraw/';
/** 转换时烘进根节点的缩放：LDU(0.0004m) × 人仔比例 17.5 */
const ROOT_SCALE = 0.0004 * 17.5;

function r4(n) { return Math.round(n * 10000) / 10000; }

(async () => {
  const dry = process.argv.includes('--dry');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const roleMap = new Map(manifest.items.map(it => [it.part, it]));

  const files = fs.readdirSync(GLB_DIR).filter(f => f.endsWith('.glb')).sort();
  if (!files.length) { console.error('FATAL: no GLB in ' + GLB_DIR); process.exit(2); }
  console.log(`GLB files: ${files.length}, manifest items: ${manifest.items.length}`);

  if (!dry) {
    await ensureLibrary({
      packKey: 'ldraw_builtin',
      displayName: 'LDraw 内置积木件',
      styleFamily: 'brick_urban',
      sourceType: 'builtin',
      sourceRef: 'LDraw.org Parts Library (curated subset)',
      licenseInfo: {
        type: 'CC BY 4.0',
        author: 'LDraw.org Parts Library Contributors',
        url: 'https://ldraw.org/license.html',
        note: 'Parts copyright LDraw.org contributors, licensed CC BY 4.0. LEGO(R) is a trademark of the LEGO Group; this library is not affiliated with or endorsed by it.',
      },
      status: 'active',
    });
  }

  let libraryId = null;
  if (!dry) {
    const libRow = (await pool.query(
      `SELECT id FROM part_libraries WHERE LOWER(pack_key)='ldraw_builtin' AND deleted_at IS NULL LIMIT 1`
    )).rows[0];
    if (!libRow) { console.error('FATAL: ldraw_builtin library not found'); process.exit(2); }
    libraryId = libRow.id;
  }

  let seeded = 0, missing = 0, noStats = 0;
  const roleCount = {};
  let totalTris = 0;

  for (const f of files) {
    const abs = path.join(GLB_DIR, f);
    const base = path.basename(f, '.glb');
    const mf = roleMap.get(base + '.dat');
    if (!mf) { missing++; continue; }
    const stats = classifier.readModelStats(abs);
    if (!stats) { noStats++; }

    const tris = stats ? stats.tris : 0;
    totalTris += tris;
    const role = mf.role || 'prop';
    roleCount[role] = (roleCount[role] || 0) + 1;
    const subtype = classifier.deriveSubtype(base, role);
    const lodPolicy = (tris > 0 && tris < classifier.LOD_MIN_TRIS) ? 'never' : 'auto';
    const metaPath = URL_PREFIX + f;
    const size = fs.statSync(abs).size;

    // bbox：accessor min/max 是未缩放的 LDU 值，乘根节点缩放得米制
    const w = stats && stats.w != null ? r4(stats.w * ROOT_SCALE) : null;
    const h = stats && stats.h != null ? r4(stats.h * ROOT_SCALE) : null;
    const d = stats && stats.d != null ? r4(stats.d * ROOT_SCALE) : null;

    if (dry) { seeded++; continue; }

    // uploaded_models：按 path 复用（避免重复执行刷行）
    const m = await pool.query('SELECT id FROM uploaded_models WHERE path = $1 LIMIT 1', [metaPath]);
    let modelId;
    if (m.rows.length) {
      modelId = m.rows[0].id;
      await pool.query(
        `UPDATE uploaded_models SET pack_id=$1, part_category='part', file_size=$2,
           display_name=$3, updated_at=NOW() WHERE id=$4`,
        [libraryId, size, mf.title, modelId]);
    } else {
      const ins = await pool.query(
        `INSERT INTO uploaded_models
           (file_name, saved_file_name, path, file_type, file_size, category,
            display_name, pack_id, part_category)
         VALUES ($1,$2,$3,'glb',$4,'builtin',$5,$6,'part') RETURNING id`,
        [f, f, metaPath, size, mf.title, libraryId]);
      modelId = ins.rows[0].id;
    }

    const meta = {
      tris, mats: stats ? stats.mats : 0, textures: 0,
      bbox: (w != null) ? { w, h, d } : null,
      externalTextures: 0, extensions: stats ? stats.extensions : [],
      sourceType: 'glb', file: f,
      ldraw: { part: base, title: mf.title },
      license: 'CC BY 4.0', origin: 'builtin_ldraw', scale: ROOT_SCALE,
    };

    await pool.query(
      `INSERT INTO part_library_items
         (library_id, model_id, part_key, part_role, part_subtype,
          grid_w, grid_h, grid_d, collidable, repeat_allowed, stack_rule,
          lod_policy, thumbnail, tags, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,TRUE,'none',$9,NULL,$10,$11,NOW())
       ON CONFLICT (library_id, part_key) DO UPDATE SET
         model_id=EXCLUDED.model_id, part_role=EXCLUDED.part_role,
         part_subtype=EXCLUDED.part_subtype, grid_w=EXCLUDED.grid_w,
         grid_h=EXCLUDED.grid_h, grid_d=EXCLUDED.grid_d,
         lod_policy=EXCLUDED.lod_policy, tags=EXCLUDED.tags,
         metadata=EXCLUDED.metadata`,
      [libraryId, modelId, base, role, subtype, w, h, d, lodPolicy,
       [role, subtype], JSON.stringify(meta)]);
    seeded++;
  }

  console.log(`seeded=${seeded} missing-manifest=${missing} noStats=${noStats}`);
  console.log('roleCount:', JSON.stringify(roleCount), 'totalTris:', totalTris);

  if (dry) { await pool.end(); process.exit(0); }
  {
    const orphans = await pruneOrphanModels(libraryId);
    console.log('orphan models pruned:', orphans.removed);
    const stats = await refreshLibraryStats(libraryId, {
      fileCount: seeded, bytes: files.reduce((s, f) => s + fs.statSync(path.join(GLB_DIR, f)).size, 0),
      textureCount: 0, thumbnailCount: 0,
    });
    console.log('library stats:', JSON.stringify(stats));
  }
  await pool.end();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
