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

/**
 * 建库。
 *
 * 撞名处理（2026-10-07）：扫描通道拿**路径末段**当库名，而每套素材包的模型目录
 * 都叫 `glTF` / `GLB format` / `obj` → pack_key 全都撞成同一个，不同素材包的零件
 * 会混进同一个库（实测已出现叫 `glTF` 的库混了 248 个零件）。
 *
 * 现在按用户口径处理：**保留原名，撞了就加后缀错开**（gltf → gltf_2 → gltf_3…）。
 *
 * 但必须同时保住「同一个包重复导入要幂等复用」的原有语义，所以复用的判据是
 * **pack_key 相同 且 source_path 相同**（同一来源目录），而不是只看 pack_key：
 *   · 同一目录再扫一次        → source_path 相同 → 复用原库（不会刷出 gltf_2/gltf_3）
 *   · 另一套包的 glTF 目录    → source_path 不同 → gltf_2 独立成库（零件不再混）
 *   · 早期数据（source_path 为 NULL）→ 视为"不同来源"，因此下次导入会新开一个 gltf_2，
 *     旧库原样保留、不会被动到（用户可自行用回收站处理）
 */
async function ensureLibrary(opts) {
  const baseKey = String(opts.packKey || '').slice(0, 60);
  if (!baseKey) throw new Error('pack_key 不能为空');
  const sourcePath = opts.sourcePath ? String(opts.sourcePath).slice(0, 500) : null;

  // ① 幂等：**同一个来源目录**就是同一个包，直接复用（不论它当初落在哪个 pack_key 上）
  //    ⚠ 不能用 `pack_key = baseKey AND source_path = ...` 来查：撞名后实际落库的是
  //      gltf_2 / gltf_3，这样查会漏掉它们 → 同一目录重复导入会不断刷出新库。
  if (sourcePath) {
    const same = await pool.query(
      'SELECT * FROM part_libraries WHERE source_path = $1 LIMIT 1', [sourcePath]);
    if (same.rows.length) {
      return { libraryId: same.rows[0].id, created: false, library: same.rows[0], reused: true };
    }
  } else {
    const exist = await pool.query(
      'SELECT * FROM part_libraries WHERE LOWER(pack_key) = LOWER($1) LIMIT 1', [baseKey]);
    if (exist.rows.length) {
      return { libraryId: exist.rows[0].id, created: false, library: exist.rows[0] };
    }
  }

  // ② 撞名 → 加 _2 / _3 错开
  let key = baseKey, seq = 1, name = String(opts.displayName || baseKey).slice(0, 120);
  for (let guard = 0; guard < 200; guard++) {
    const hit = await pool.query(
      'SELECT id FROM part_libraries WHERE LOWER(pack_key) = LOWER($1) LIMIT 1', [key]);
    if (!hit.rows.length) break;
    seq += 1;
    key = baseKey.slice(0, Math.max(8, 60 - String(seq).length - 1)) + '_' + seq;
    // 库名同步加后缀，避免出现"两个都叫 glTF、只有 pack_key 不同"的歧义
    name = (String(opts.displayName || baseKey).slice(0, 110)) + '_' + seq;
  }

  const ins = await pool.query(
    `INSERT INTO part_libraries
       (world_id, pack_key, display_name, style_family, source_type, source_ref, source_path,
        license_info, status, stats, created_at, updated_at)
     VALUES ('default',$1,$2,$3,$4,$5,$6,$7,$8,$9, NOW(), NOW()) RETURNING *`,
    [
      key, name, opts.styleFamily || null,
      opts.sourceType || 'external_kit',
      opts.sourceRef ? String(opts.sourceRef).slice(0, 500) : null,
      sourcePath,
      opts.licenseInfo ? JSON.stringify(opts.licenseInfo) : null,
      opts.status || 'active',
      JSON.stringify(opts.stats || {}),
    ]
  );
  return {
    libraryId: ins.rows[0].id, created: true, library: ins.rows[0],
    renamed: seq > 1, packKey: key, displayName: name,
  };
}


/** 缩略图/零件名归一：只留字母数字小写。part_key 里 `-` 被转成 `_`，Previews 用的是 `-` */
function thumbKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * 缩略图目录约定（**三套都要认** —— 这是 771 件零件没图的真因）：
 *
 *   老版 Kenney kit：  Previews/xxx.png                一件一张正视/斜视预览
 *   新版 Kenney kit：  Side/xxx.png                    正侧视（**没有** Previews/）
 *                     Isometric/xxx_NE.png            等距 4 视角（NE/NW/SE/SW 后缀）
 *   优先级：Previews > Side > Isometric（同件多图时取先命中的）
 *
 * ⚠ 两个踩过的坑：
 *   ① 目录名可能在**顶层**（落盘路径就是 `Side/xxx.png`），正则必须用 `(^|[\\/])`，
 *      否则要求前面有斜杠 → 一个都匹配不到（thumbnail 全 null）。
 *   ② Isometric 的文件名带方向后缀（`bed_floor_NE.png`），归一后是 `bedfloorne`，
 *      与 part_key `bed_floor` 对不上 → 匹配前先剥掉方向后缀。
 *   ③ Isometric 图量是 Side 的 4 倍（nature-kit 1316 vs 322），为cover 7 件边角料
 *      搬 4 倍图片不值 → **默认只落盘 Previews/ 与 Side/**，Isometric 需显式开启。
 */
const THUMB_DIRS = [
  { re: /(^|[\\/])Previews[\\/]/i, strip: null, name: 'Previews' },
  { re: /(^|[\\/])Side[\\/]/i, strip: null, name: 'Side' },
  { re: /(^|[\\/])Isometric[\\/]/i, strip: /_(ne|nw|se|sw)$/i, name: 'Isometric' },
];

/**
 * 收集缩略图 → Map<thumbKey, 落盘后的相对 URL>
 * @param {Array<{rel:string, ext:string}>} all  bundle 内文件清单（walkBundle 结果）
 * @param {string} prefix  落盘 URL 前缀（如 /models/uploaded/bundle-x/）
 * @param {object} [opts]  { allowIsometric:boolean } 默认不收 Isometric
 */
function collectThumbs(all, prefix, opts) {
  const allowIso = !!(opts && opts.allowIsometric);
  /** @type {Map<string, {url:string, rank:number}>} */
  const best = new Map();
  for (const f of all || []) {
    if (f.ext !== '.png' && f.ext !== '.jpg' && f.ext !== '.jpeg') continue;
    for (let i = 0; i < THUMB_DIRS.length; i++) {
      const d = THUMB_DIRS[i];
      if (d.name === 'Isometric' && !allowIso) continue;
      if (!d.re.test(f.rel)) continue;
      const base = path.basename(f.rel, path.extname(f.rel));
      const key = thumbKey(d.strip ? base.replace(d.strip, '') : base);
      const prev = best.get(key);
      // 优先级低的目录不覆盖已命中的（THUMB_DIRS 已按优先级排序）
      if (prev && prev.rank <= i) break;
      best.set(key, { url: prefix + f.rel, rank: i });
      break;
    }
  }
  const out = {};
  for (const [k, v] of best) out[k] = v.url;
  return out;
}

/** 归类入库：逐个主文件建 part_library_items 行 + 回填 uploaded_models */
async function classifyBundle({ bundleName, libraryId, uploadRoot, bundlePrefix }) {
  const bundleDir = path.join(uploadRoot, bundleName);
  const prefix = bundlePrefix || `/models/uploaded/${bundleName}/`;
  const all = classifier.walkBundle(bundleDir);
  const warnings = [];
  let itemCount = 0, updatedModels = 0, totalTris = 0, skippedDup = 0, noStats = 0;
  const roleCount = {};

  const thumbs = collectThumbs(all, prefix);

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
async function registerBundle({ bundleName, uploadRoot, sourceRef, sourcePath, licenseInfo, styleFamily, sourceType, status }) {
  const bundleDir = path.join(uploadRoot, bundleName);
  const rawName = path.basename(String(sourceRef || '').replace(/[\\/]+$/, '')) || bundleName;
  const packKey = assetPathKit.derivePackKey(rawName, bundleName);
  const displayName = assetPathKit.deriveDisplayName(rawName);

  const pre = classifier.previewBundle(bundleDir);
  const lib = await ensureLibrary({
    packKey, displayName,
    styleFamily: styleFamily || inferStyleFamily(packKey),
    sourceType: sourceType || 'external_kit',
    sourceRef, sourcePath, licenseInfo,
    status: status || 'active',
    stats: { partCount: pre.modelCount, totalTris: pre.totalTris, textureCount: pre.textureCount, bytes: pre.bytes },
  });

  const res = await classifyBundle({ bundleName, libraryId: lib.libraryId, uploadRoot });
  const orphans = await pruneOrphanModels(lib.libraryId);
  const stats = await refreshLibraryStats(lib.libraryId, {
    textureCount: pre.textureCount, bytes: pre.bytes, fileCount: pre.fileCount,
  });
  return {
    libraryId: lib.libraryId,
    // 撞名错开时以**最终落库**的 key/name 为准（gltf_2 / glTF_2），否则界面会显示一个不存在的库名
    packKey: lib.packKey || packKey,
    displayName: lib.displayName || displayName,
    renamed: !!lib.renamed,
    created: lib.created,
    roleCount: res.roleCount, ...res, orphans, stats,
  };
}

module.exports = { inferStyleFamily, ensureLibrary, classifyBundle, refreshLibraryStats, pruneOrphanModels, registerBundle, thumbKey, collectThumbs, THUMB_DIRS };
