/**
 * 零件库回收站（软删除 / 恢复 / 清空）
 *
 * 三段式，缺一不可：
 *   移入回收站  softDelete()  —— status='deleted' + 记 prev_status/deleted_at；**磁盘文件保留**
 *   恢复        restore()     —— status 回到 prev_status（没有则 active）
 *   清空        purgeTrash()  —— 真正删 DB 行 + 删磁盘目录，释放空间，**不可恢复**
 *
 * 为什么磁盘只在「清空」时删：软删时删磁盘会让「恢复」变成空壳（零件行指向 404 文件），
 * 而保留磁盘正是回收站存在的意义——用户改主意时能完整恢复。
 *
 * 全部按 id / pack_id 精确定位；清空时逐库过 partLibraryDeleter 的两个闸门
 * （世界引用 / 跨库目录共用），被拦的库**跳过并如实回报**，其余照删。
 */
const { deleteLibrary } = require('./partLibraryDeleter');

const DELETED = 'deleted';

/** 移入回收站（软删除）。已归档的库被删后，恢复时回到 archived。 */
async function softDelete(pool, libraryId) {
  const r = await pool.query(
    `UPDATE part_libraries
        SET prev_status = status, status = $1, deleted_at = NOW(), updated_at = NOW()
      WHERE id = $2 AND status <> $1
      RETURNING id, pack_key, display_name, prev_status, status, deleted_at`,
    [DELETED, libraryId]);
  if (!r.rows.length) {
    const exists = await pool.query('SELECT id, status FROM part_libraries WHERE id = $1', [libraryId]);
    if (!exists.rows.length) return { notFound: true };
    return { alreadyTrashed: true, library: exists.rows[0] };
  }
  const counts = await pool.query(
    'SELECT COUNT(*)::int AS parts FROM part_library_items WHERE library_id = $1', [libraryId]);
  return { success: true, library: r.rows[0], partCount: counts.rows[0].parts };
}

/** 从回收站恢复 */
async function restore(pool, libraryId) {
  const r = await pool.query(
    `UPDATE part_libraries
        SET status = COALESCE(prev_status, 'active'), prev_status = NULL,
            deleted_at = NULL, updated_at = NOW()
      WHERE id = $1 AND status = $2
      RETURNING id, pack_key, display_name, status`,
    [libraryId, DELETED]);
  if (!r.rows.length) return { notFoundOrNotTrashed: true };
  return { success: true, library: r.rows[0] };
}

/** 回收站清单：含零件数与磁盘占用（用 uploaded_models.file_size 汇总，够快且够用） */
async function trashList(pool) {
  const libs = await pool.query(
    `SELECT l.id, l.pack_key, l.display_name, l.prev_status, l.deleted_at,
            (SELECT COUNT(*)::int FROM part_library_items i WHERE i.library_id = l.id) AS part_count,
            (SELECT COUNT(*)::int FROM uploaded_models u
              WHERE u.pack_id = l.id AND u.part_category = 'part') AS model_count,
            (SELECT COALESCE(SUM(u.file_size),0) FROM uploaded_models u
              WHERE u.pack_id = l.id AND u.part_category = 'part') AS bytes
       FROM part_libraries l
      WHERE l.status = $1
      ORDER BY l.deleted_at DESC NULLS LAST, l.id DESC`,
    [DELETED]);
  const totals = libs.rows.reduce(
    (a, l) => ({ libs: a.libs + 1, parts: a.parts + l.part_count, bytes: a.bytes + Number(l.bytes || 0) }),
    { libs: 0, parts: 0, bytes: 0 });
  return { libraries: libs.rows, totals };
}

/**
 * 清空回收站。
 * @param {{dropDisk?:boolean}} opts dropDisk 默认 **true** —— "清空回收站"的用户意图就是释放空间
 */
async function purgeTrash(pool, opts) {
  const dropDisk = !(opts && opts.dropDisk === false);
  const list = await trashList(pool);
  const purged = [], blocked = [], failed = [];
  for (const l of list.libraries) {
    let r;
    try {
      r = await deleteLibrary({ pool }, l.id, { dropDisk });
    } catch (e) {
      failed.push({ id: l.id, name: l.display_name, error: String(e.message || e).slice(0, 140) });
      continue;
    }
    if (r.notFound) continue;
    if (r.blocked) { blocked.push({ id: l.id, name: l.display_name, reason: r.reason, usedByWorld: r.usedByWorld }); continue; }
    purged.push({
      id: l.id, name: l.display_name, parts: r.counts.parts, models: r.counts.models,
      removedDirs: (r.disk && r.disk.removedDirs) || [],
    });
  }
  return {
    success: true,
    dropDisk,
    totals: list.totals,
    purged, blocked, failed,
    diskFreed: purged.reduce((n, p) => n + p.removedDirs.length, 0),
  };
}

module.exports = { DELETED, softDelete, restore, trashList, purgeTrash };
