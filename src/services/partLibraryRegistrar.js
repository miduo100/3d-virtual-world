/**
 * 零件库注册服务（Phase 1）
 *
 * 职责：把一个已落盘的 bundle 目录注册成「库 + 零件清单」。
 * 被两条通道共用（唯一区别是 target）：
 *   · 扫描通道  POST /api/asset-library/scan       （服务器本地目录 → 复制落盘 → 本服务）
 *   · 上传通道  POST /api/upload-model-bundle/zip  （浏览器文件夹 → 落盘 → 本服务）
 * 两者都是：落盘 → ingestBundle(..., { target }) → 本服务建库+归类。
 *
 * 幂等：同一 pack_key 重复注册时复用已有库；零件行用 ON CONFLICT DO UPDATE。
 */
const path = require('path');
const { pool } = require('../database/db');
const assetPathKit = require('./assetPathKit');
const classifier = require('./partClassifier');

/** 由 pack_key 猜风格族（后台可改） */
function inferStyleFamily(packKey) {
  const k = String(packKey || '').toLowerCase();
  if (/(castle|medieval|tower|village|fantasy)/.test(k)) return 'castle';
  if (/(city|urban|downtown|street|commercial|skyscraper|building)/.test(k)) return 'brick_urban';
  if (/(industrial|factory|warehouse|pipe|tank)/.test(k)) return 'industrial';
  if (/(space|station|scifi|sci_fi|futur)/.test(k)) return 'future';
  if (/(nature|forest|tree|plant|flower)/.test(k)) return 'nature';
  if (/(furniture|chair|table|bed|indoor)/.test(k)) return 'furniture';
  if (/(hexagon|tile|arena|golf)/.test(k)) return 'minimal';
  if (/(food|weapon|blaster|survival)/.test(k)) return 'prop';
  return null;
}

/** 建库（pack_key 已存在则复用） */
async function ensureLibrary(opts) {
  const key = String(opts.packKey || '').slice(0, 60);
  const name = String(opts.displayName || key).slice(0, 120);
  if (!key) throw new Error('pack_key 不能为空');

  const exist = await pool.query(
    'SELECT * FROM part_libraries WHERE LOWER(pack_key) = LOWER($1) LIMIT 1', [key]);
  if (exist.rows.length) {
    return { libraryId: exist.rows[0].id, created: false, library: exist.rows[0] };
  }
  const ins = await pool.query(
    `INSERT INTO part_libraries
       (world_id, pack_key, display_name, style_family, source_type, source_ref,
        license_info, status, stats, created_at, updated_at)
     VALUES ('default',$1,$2,$3,$4,$5,$6,$7,$8, NOW(), NOW()) RETURNING *`,
    [
      key, name, opts.styleFamily || null,
      opts.sourceType || 'external_kit',
      opts.sourceRef ? String(opts.sourceRef).slice(0, 500) : null,
      opts.licenseInfo ? JSON.stringify(opts.licenseInfo) : null,
      opts.status || 'active',
      JSON.stringify(opts.stats || {}),
    ]
  );
  return { libraryId: ins.rows[0].id, created: true, library: ins.rows[0] };
}

/** 缩略图/零件名归一：只留字母数字小写。part_key 里 `-` 被转成 `_`，Previews 用的是 `-` */
function thumbKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** 归类入库：逐个主文件建 part_library_items 行 + 回填 uploaded_models */
async function classifyBundle({ bundleName, libraryId, uploadRoot, bundlePrefix }) {
  const bundleDir = path.join(uploadRoot, bundleName);
  const prefix = bundlePrefix || `/models/uploaded/${bundleName}/`;
  const all = classifier.walkBundle(bundleDir);
  const warnings = [];
  let itemCount = 0, updatedModels = 0, totalTris = 0, skippedDup = 0, noStats = 0;
  const roleCount = {};

  // Previews 目录的缩略图（按同名匹配，键需归一：building-block.png ↔ building_block）
  // ⚠ 正则必须允许 Previews 在**顶层**（(^|/)）：落盘路径是 `Previews/xxx.png`，
  //   原来的 /[\\/]Previews[\\/]/ 要求前面有斜杠 → 顶层目录一个都匹配不到（thumbnail 全 null）。
  const thumbs = {};
  for (const f of all) {
    if (f.ext !== '.png') continue;
    if (!/(^|[\\/])Previews[\\/]/.test(f.rel)) continue;
    thumbs[thumbKey(path.basename(f.rel, '.png'))] = prefix + f.rel;
  }

  const primaries = all.filter(f =>
    ['.gltf', '.glb', '.obj'].includes(f.ext) && !/_(mid|lod)\.(gltf|glb|obj)$/i.test(f.rel));

  for (const f of primaries) {
    const partKey = classifier.derivePartKey(f.rel);
    const cls = classifier.classifyByName(partKey);
    const stats = classifier.readModelStats(f.abs);
    if (!stats) { warnings.push(`无法解析几何统计：${f.rel}`); noStats++; }

    const tris = stats ? stats.tris : 0;
    const modelPath = prefix + f.rel;
    const m = await pool.query('SELECT id FROM uploaded_models WHERE path = $1 LIMIT 1', [modelPath]);
    if (!m.rows.length) { warnings.push(`uploaded_models 无对应记录：${modelPath}`); continue; }
    const modelId = m.rows[0].id;

    // 冲突守卫：同一 (library_id, part_key) 已有行且旧行有几何统计时，
    // 不允许被一个「解析不出几何」的文件（典型=.obj）覆盖。
    const dup = await pool.query(
      `SELECT model_id, (metadata->>'tris')::bigint AS tris
         FROM part_library_items WHERE library_id = $1 AND part_key = $2`,
      [libraryId, partKey]
    );
    if (dup.rows.length && Number(dup.rows[0].tris) > 0 && tris === 0) {
      skippedDup++;
      warnings.push(`跳过同键低质量副本：${f.rel}（已存在 tris=${dup.rows[0].tris} 的 ${partKey}）`);
      continue;
    }
    if (dup.rows.length && Number(dup.rows[0].tris) > 0) skippedDup++;

    totalTris += tris;
    roleCount[cls.role] = (roleCount[cls.role] || 0) + 1;
    const lodPolicy = (stats && tris > 0 && tris < classifier.LOD_MIN_TRIS) ? 'never' : 'auto';

    await pool.query(
      `UPDATE uploaded_models SET pack_id = $1, part_category = 'part', updated_at = NOW() WHERE id = $2`,
      [libraryId, modelId]);
    updatedModels++;

    const subtype = classifier.deriveSubtype(partKey, cls.role);
    const meta = {
      tris, mats: stats ? stats.mats : 0, textures: stats ? stats.textures : 0,
      bbox: stats ? { w: stats.w, h: stats.h, d: stats.d } : null,
      externalTextures: stats ? stats.externalRefs : 0,
      extensions: stats ? stats.extensions : [],
      sourceType: f.ext.replace('.', ''), file: f.rel,
    };
    await pool.query(
      `INSERT INTO part_library_items
         (library_id, model_id, part_key, part_role, part_subtype,
          grid_w, grid_h, grid_d, collidable, repeat_allowed, stack_rule,
          lod_policy, thumbnail, tags, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (library_id, part_key) DO UPDATE SET
         model_id=EXCLUDED.model_id, part_role=EXCLUDED.part_role,
         part_subtype=EXCLUDED.part_subtype, grid_w=EXCLUDED.grid_w,
         grid_h=EXCLUDED.grid_h, grid_d=EXCLUDED.grid_d,
         collidable=EXCLUDED.collidable, stack_rule=EXCLUDED.stack_rule,
         lod_policy=EXCLUDED.lod_policy, thumbnail=EXCLUDED.thumbnail,
         metadata=EXCLUDED.metadata`,
      [
        libraryId, modelId, partKey, cls.role, subtype,
        stats ? stats.w : null, stats ? stats.h : null, stats ? stats.d : null,
        cls.collidable, classifier.inferStackRule(partKey), lodPolicy,
        thumbs[thumbKey(partKey)] || null,
        // tags 是 TEXT[]，必须传真正的 JS 数组（node-postgres 会序列化为 Postgres 数组
        // 字面量）。此前传 JSON.stringify([...]) → 报 malformed array literal，扫描通道必 500。
        [cls.role, subtype],
        JSON.stringify(meta),
      ]
    );
    itemCount++;
  }
  return { itemCount, roleCount, updatedModels, warnings, totalTris, skippedDup, noStats };
}

/**
 * 清理孤儿：同一 library 下 part_category='part' 但已不被任何零件行引用的 uploaded_models。
 * 场景：重复扫描同一 kit（AL-15 幂等）会新建 bundle 目录 + 新 uploaded_models 行，
 * 零件行被 ON CONFLICT 更新指向新行 → 旧行成为孤儿。不清理会让「零件数」逐次虚增。
 * 只删 DB 行，不动磁盘文件（静态目录由人工/后续清理脚本处理）。
 */
async function pruneOrphanModels(libraryId) {
  const r = await pool.query(
    `DELETE FROM uploaded_models u
      WHERE u.pack_id = $1 AND u.part_category = 'part'
        AND NOT EXISTS (SELECT 1 FROM part_library_items i WHERE i.model_id = u.id)
      RETURNING u.path`,
    [libraryId]
  );
  return { removed: r.rows.length, sample: r.rows.slice(0, 5).map(x => x.path) };
}

/** 刷新库统计 */
async function refreshLibraryStats(libraryId, extra) {
  const agg = await pool.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM((metadata->>'tris')::bigint),0) AS tris
       FROM part_library_items WHERE library_id = $1`, [libraryId]);
  const th = await pool.query(
    `SELECT COUNT(*)::int AS n FROM part_library_items
      WHERE library_id = $1 AND thumbnail IS NOT NULL`, [libraryId]);
  const stats = {
    partCount: agg.rows[0].n,
    totalTris: Number(agg.rows[0].tris) || 0,
    thumbnailCount: th.rows[0].n,
    ...(extra || {}),
  };
  await pool.query('UPDATE part_libraries SET stats=$1, updated_at=NOW() WHERE id=$2',
    [JSON.stringify(stats), libraryId]);
  return stats;
}

/** 完整流程：建库 + 归类 + 刷统计。上传与扫描两个入口都调它。 */
async function registerBundle({ bundleName, uploadRoot, sourceRef, licenseInfo, styleFamily, sourceType, status }) {
  const bundleDir = path.join(uploadRoot, bundleName);
  const rawName = path.basename(String(sourceRef || '').replace(/[\\/]+$/, '')) || bundleName;
  const packKey = assetPathKit.derivePackKey(rawName, bundleName);
  const displayName = assetPathKit.deriveDisplayName(rawName);

  const pre = classifier.previewBundle(bundleDir);
  const lib = await ensureLibrary({
    packKey, displayName,
    styleFamily: styleFamily || inferStyleFamily(packKey),
    sourceType: sourceType || 'external_kit',
    sourceRef, licenseInfo,
    status: status || 'active',
    stats: { partCount: pre.modelCount, totalTris: pre.totalTris, textureCount: pre.textureCount, bytes: pre.bytes },
  });

  const res = await classifyBundle({ bundleName, libraryId: lib.libraryId, uploadRoot });
  const orphans = await pruneOrphanModels(lib.libraryId);
  const stats = await refreshLibraryStats(lib.libraryId, {
    textureCount: pre.textureCount, bytes: pre.bytes, fileCount: pre.fileCount,
  });
  return {
    libraryId: lib.libraryId, packKey, displayName, created: lib.created,
    roleCount: res.roleCount, ...res, orphans, stats,
  };
}

module.exports = { inferStyleFamily, ensureLibrary, classifyBundle, refreshLibraryStats, pruneOrphanModels, registerBundle, thumbKey };
