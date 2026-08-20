/**
 * 空间分页 API（P1：空间分页 API + 数据库索引 + 卸载真释放）
 *
 * 与 /api/world/objects（全量）的区别：
 *   1. around：按玩家位置返回"周围 radius 米"的对象子集，配合前端按需拉取
 *   2. paged：通用 created_at 分页（走 idx_world_objects_created_at 索引）
 *   3. slots：有效广告位独立小接口
 *
 * 内建三项性能修复：
 *   - geometry_data 一次 ANY 批量查回，消灭 N+1 查询
 *   - file_size 用 fs.promises.stat + 并发限流（不再同步 statSync 卡主线程）
 *   - 全部查询走新增索引（created_at / position 复合）
 *
 * 字段结构保持与 /api/world/objects 完全一致，前端可直接复用加载逻辑。
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const STAT_CONCURRENCY = 20;      // file_size 统计并发上限
const DEFAULT_RADIUS = 500;       // 默认空间半径（米）
const MAX_RADIUS = 5000;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

// 从 world_object 行提取 geometry_buildings.id（优先 model_path 前缀，回退 building_id）
function extractGeometryBuildingId(obj) {
  if (obj.model_path && obj.model_path.startsWith('geometry_building:')) {
    return obj.model_path.replace('geometry_building:', '');
  }
  return obj.building_id != null ? String(obj.building_id) : null;
}

// 批量回填 geometry_data（一次 ANY 查询，消灭 N+1）
async function attachGeometryData(objects) {
  const geomIdSet = new Set();
  objects.forEach((o) => {
    if (o.type === 'geometry_building') {
      const gid = extractGeometryBuildingId(o);
      if (gid) geomIdSet.add(gid);
    }
  });
  if (geomIdSet.size === 0) return;
  const geomIds = [...geomIdSet].map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (geomIds.length === 0) return;
  try {
    const geomResult = await query(
      'SELECT id, geometry_data FROM geometry_buildings WHERE id = ANY($1::int[])',
      [geomIds]
    );
    const geomMap = new Map(geomResult.rows.map((r) => [String(r.id), r.geometry_data]));
    objects.forEach((o) => {
      if (o.type !== 'geometry_building') return;
      const gid = extractGeometryBuildingId(o);
      if (gid && geomMap.has(gid)) o.geometry_data = geomMap.get(gid);
    });
  } catch (err) {
    console.error('批量获取几何体数据失败:', err);
  }
}

// file_size 并发限流补充（只对返回子集计算）
async function attachFileSizes(objects) {
  let index = 0;
  const workers = Array.from({ length: STAT_CONCURRENCY }, async () => {
    while (index < objects.length) {
      const obj = objects[index++];
      if (!obj.model_path || obj.model_path === '__default_portal__') continue;
      const rel = obj.model_path.startsWith('/') ? obj.model_path.slice(1) : obj.model_path;
      try {
        const st = await fsp.stat(path.join(PUBLIC_DIR, rel));
        obj.file_size = st.size;
      } catch (e) {
        // 文件不存在则忽略，file_size 保持 undefined
      }
    }
  });
  await Promise.all(workers);
}

// 广告位 → world_objects 兼容格式（与 src/routes/world.js /objects 保持一致）
function mapAdSlot(slot) {
  return {
    id: slot.id,
    type: 'ad_slot',
    name: slot.name || '广告位',
    model_path: slot.model_url || '__default_portal__',
    position_x: slot.position && slot.position.x ? Number(slot.position.x) : 0,
    position_y: slot.position && slot.position.y ? Number(slot.position.y) : 0,
    position_z: slot.position && slot.position.z ? Number(slot.position.z) : 0,
    rotation_x: slot.rotation && slot.rotation.x ? Number(slot.rotation.x) : 0,
    rotation_y: slot.rotation && slot.rotation.y ? Number(slot.rotation.y) : 0,
    rotation_z: slot.rotation && slot.rotation.z ? Number(slot.rotation.z) : 0,
    scale_x: slot.scale && slot.scale.x ? Number(slot.scale.x) : 1,
    scale_y: slot.scale && slot.scale.y ? Number(slot.scale.y) : 1,
    scale_z: slot.scale && slot.scale.z ? Number(slot.scale.z) : 1,
    portal_type: slot.portal_type || slot.trigger_type,
    trigger_type: slot.trigger_type,
    target_url: slot.target_url,
    target_world_url: slot.target_world_url,
    target_world_name: slot.target_world_name,
    target_world_id: slot.target_world_id,
    deep_link: slot.deep_link,
    model_url: slot.model_url,
    created_at: slot.created_at,
  };
}

function sendError(res, message, error) {
  console.error(error);
  res.status(500).json({ success: false, error: message });
}

// ---------------------------------------------------------------------------
// 接口
// ---------------------------------------------------------------------------

// 空间范围查询：GET /api/world/spatial/around?x=100&z=200&radius=500&type=&limit=200&offset=0
router.get('/around', async (req, res) => {
  try {
    const x = parseFloat(req.query.x);
    const z = parseFloat(req.query.z);
    if (isNaN(x) || isNaN(z)) {
      return res.status(400).json({ success: false, error: 'x/z 参数必须为数字' });
    }
    const radius = Math.min(parseFloat(req.query.radius) || DEFAULT_RADIUS, MAX_RADIUS);
    const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const type = req.query.type;

    const xMin = x - radius;
    const xMax = x + radius;
    const zMin = z - radius;
    const zMax = z + radius;

    // 1. world_objects 方框范围查询（走 idx_world_objects_pos / type_pos）
    const whereClauses = ['position_x BETWEEN $1 AND $2', 'position_z BETWEEN $3 AND $4'];
    const params = [xMin, xMax, zMin, zMax];
    if (type) {
      whereClauses.push(`type = $${params.length + 1}`);
      params.push(type);
    }
    const where = whereClauses.join(' AND ');
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const objectsResult = await query(
      `SELECT * FROM world_objects
       WHERE ${where}
       ORDER BY (type IN ('geometry_nature', 'geometry_building', 'media_image', 'media_video', 'threejs_code', 'gaussian_splat')) DESC, created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset]
    );
    const totalResult = await query(
      `SELECT count(*)::int AS total FROM world_objects WHERE ${where}`,
      params
    );
    const objects = objectsResult.rows;

    // 2. geometry_data 批量回填
    await attachGeometryData(objects);

    // 3. 广告位（有效 + 空间过滤）
    const adSlotsResult = await query(
      `SELECT * FROM ad_slots
       WHERE is_active = TRUE
         AND (rent_end IS NULL OR rent_end > NOW())
         AND (position->>'x')::float8 BETWEEN $1 AND $2
         AND (position->>'z')::float8 BETWEEN $3 AND $4
       ORDER BY created_at DESC`,
      [xMin, xMax, zMin, zMax]
    );
    const adSlotObjects = adSlotsResult.rows.map(mapAdSlot);

    // 4. file_size 并发限流补充
    const allObjects = [...objects, ...adSlotObjects];
    await attachFileSizes(allObjects);

    const total = (totalResult.rows[0] && totalResult.rows[0].total || 0) + adSlotObjects.length;
    const returned = allObjects.length;

    res.json({
      success: true,
      objects: allObjects,
      total,
      hasMore: offset + returned < total,
      radius,
      limit,
      offset,
    });
  } catch (error) {
    sendError(res, 'Failed to query spatial objects', error);
  }
});

// 通用分页：GET /api/world/spatial/paged?page=1&limit=200&type=
router.get('/paged', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (page - 1) * limit;
    const type = req.query.type;

    let where = 'TRUE';
    const params = [];
    if (type) {
      where = 'type = $1';
      params.push(type);
    }

    const objectsResult = await query(
      `SELECT * FROM world_objects
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const totalResult = await query(
      `SELECT count(*)::int AS total FROM world_objects WHERE ${where}`,
      params
    );
    const objects = objectsResult.rows;
    await attachGeometryData(objects);
    await attachFileSizes(objects);

    const total = (totalResult.rows[0] && totalResult.rows[0].total) || 0;
    res.json({
      success: true,
      objects,
      total,
      page,
      limit,
      hasMore: offset + objects.length < total,
    });
  } catch (error) {
    sendError(res, 'Failed to paged world objects', error);
  }
});

// 有效广告位：GET /api/world/spatial/slots
router.get('/slots', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM ad_slots
       WHERE is_active = TRUE
         AND (rent_end IS NULL OR rent_end > NOW())
       ORDER BY created_at DESC`
    );
    res.json({ success: true, slots: result.rows.map(mapAdSlot) });
  } catch (error) {
    sendError(res, 'Failed to fetch ad slots', error);
  }
});

module.exports = router;
