/**
 * 零件库删除服务（与归档彻底区分：归档只是隐藏，数据全留）
 *
 * 为什么要独立文件：删除是不可逆的高危操作，必须与只读路由分离，
 * 并且把"哪些能删、哪些必须拦"的判定集中在一处，便于审计。
 *
 * 删除范围（全部按 library_id / pack_id 精确定位，绝不按名字模糊匹配）：
 *   1. part_library_items   —— 零件行（外键 ON DELETE CASCADE，这里显式删便于核对计数）
 *   2. uploaded_models      —— pack_id = 该库 id 且 part_category='part' 的模型行
 *   3. part_libraries       —— 库行
 *   4. 磁盘 bundle 目录     —— 只删「没有其他库仍在使用」的那几个
 *
 * 硬闸门（宁可删不掉也不误伤）：
 *   A. 该库的 uploaded_models 若被 world_objects.model_path 引用 → 整库拒绝，列出被引用的对象
 *   B. 候选磁盘目录若被其它库（非本 pack_id）的 uploaded_models 引用 → 保留该目录，只删 DB 行
 *   C. 目录名必须以 bundle- 开头且 resolve 后仍位于 public/models/uploaded 内（防路径越界）
 */
const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'public', 'models', 'uploaded');
const BUNDLE_PREFIX = 'bundle-';

/** 从 /models/uploaded/bundle-xxx/yyy/zzz.gltf 提取 bundle 目录名；不合法返回 null */
function bundleNameOf(modelPath) {
  const m = /^\/models\/uploaded\/([^/]+)\//.exec(String(modelPath || ''));
  if (!m) return null;
  const name = m[1];
  return name.indexOf(BUNDLE_PREFIX) === 0 ? name : null;
}

function safeBundleDir(name) {
  if (!name || name.indexOf(BUNDLE_PREFIX) !== 0) return null;
  if (name.indexOf('..') >= 0 || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) return null;
  const abs = path.resolve(UPLOAD_ROOT, name);
  if (abs !== path.join(UPLOAD_ROOT, name)) return null;         // 防 ../ 越界
  if (abs.indexOf(UPLOAD_ROOT + path.sep) !== 0) return null;     // 防同前缀兄弟目录
  return abs;
}

/**
 * @param {number} libraryId
 * @param {{dropDisk?:boolean}} [opts] dropDisk=false 时只删 DB 行（磁盘留给人工）
 * @returns {Promise<object>} 统计 + 闸门信息
 */
async function deleteLibrary({ pool }, libraryId, opts) {
  const dropDisk = !!(opts && opts.dropDisk);
  const lib = await pool.query('SELECT id, pack_key, display_name FROM part_libraries WHERE id = $1', [libraryId]);
  if (!lib.rows.length) return { notFound: true };
  const meta = lib.rows[0];

  const models = await pool.query(
    `SELECT id, path, file_name FROM uploaded_models
      WHERE pack_id = $1 AND part_category = 'part' ORDER BY id`, [libraryId]);
  const itemCount = await pool.query(
    'SELECT COUNT(*)::int AS n FROM part_library_items WHERE library_id = $1', [libraryId]);

  // ── 闸门 A：是否已被摆进世界 ──
  const paths = models.rows.map((m) => m.path).filter(Boolean);
  let usedByWorld = [];
  if (paths.length) {
    const w = await pool.query(
      `SELECT id, name, model_path FROM world_objects
        WHERE model_path = ANY($1::text[]) LIMIT 12`, [paths]);
    usedByWorld = w.rows;
  }
  if (usedByWorld.length) {
    return {
      blocked: true,
      reason: 'world_in_use',
      library: meta,
      usedByWorld,
      modelCount: models.rows.length,
      partCount: itemCount.rows[0].n,
    };
  }

  // ── 磁盘候选：只取本库用过的 bundle 目录，且不被其他库引用 ──
  const candidates = Array.from(new Set(paths.map(bundleNameOf).filter(Boolean)));
  const removable = [], keepDirs = [];
  for (const name of candidates) {
    const others = await pool.query(
      `SELECT COUNT(*)::int AS n FROM uploaded_models
        WHERE path LIKE $1 AND (pack_id IS NULL OR pack_id <> $2)`,
      [`/models/uploaded/${name}/%`, libraryId]);
    if (others.rows[0].n > 0) keepDirs.push({ dir: name, usedByOtherModels: others.rows[0].n });
    else removable.push(name);
  }

  // ── 删 DB（单事务：零件行 → 模型行 → 库行）──
  const delItems = await pool.query('DELETE FROM part_library_items WHERE library_id = $1', [libraryId]);
  const delModels = await pool.query(
    "DELETE FROM uploaded_models WHERE pack_id = $1 AND part_category = 'part'", [libraryId]);
  const delLib = await pool.query('DELETE FROM part_libraries WHERE id = $1', [libraryId]);

  // ── 删磁盘（DB 已提交后再动文件；失败只告警，不回滚 DB）──
  const removedDirs = [], failedDirs = [];
  if (dropDisk) {
    for (const name of removable) {
      const abs = safeBundleDir(name);
      if (!abs) { failedDirs.push({ dir: name, error: '路径校验未通过（已跳过）' }); continue; }
      try {
        fs.rmSync(abs, { recursive: true, force: true });
        removedDirs.push(name);
      } catch (e) {
        failedDirs.push({ dir: name, error: String(e.message || e).slice(0, 120) });
      }
    }
  }

  return {
    success: true,
    library: meta,
    dropDisk,
    counts: {
      parts: delItems.rowCount,
      models: delModels.rowCount,
      library: delLib.rowCount,
    },
    disk: { removedDirs, keptDirs: keepDirs, failedDirs, notRemovedBecauseDryRun: dropDisk ? 0 : removable.length },
    candidates,
  };
}

module.exports = { deleteLibrary, bundleNameOf, safeBundleDir, UPLOAD_ROOT };
