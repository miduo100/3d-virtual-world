/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 地形配置路由（/api/terrain）
 *
 * ★ 2026-10-18 概念统一：「地块」= 「地形」，一套数据两处入口
 *   - 后台「3D资产 → 🗺️ 地形」与 world_editor 的「🗺️ 地形设置」读写同一张表
 *   - 一块地形 = 名称 + 位置(中心 X/Z) + 面积(宽 × 深) + 基准高度 base_y + 参数(seed/起伏/…)
 *   - 多块地形可同时生效，各自占一块矩形，边界硬接（不做混合）
 *   - 重力恒定 -Y：脚下有地形就落上去，没有地形就一直往下掉（不做无限 0 平面兜底）
 *
 * 鉴权口径：读接口公开（GET），写接口需管理员 token
 */
const express = require('express');
const router = express.Router();
const { query, pool } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');

const TERRAIN_COLS = `id, name, note, is_builtin, is_active, seed, params,
  pos_x, pos_z, width, depth, base_y, priority, color, grid_size,
  zone_enabled, zone_x, zone_z, zone_size, zone_priority, created_at, updated_at`;

// ===== 参数基线 =====
const DEFAULT_PARAMS = Object.freeze({
  version: 1,
  mode: 'bounded',
  worldRadius: 4000,
  edgeWidth: 400,
  edgeMode: 'mountain',      // 地形边缘之外：mountain 升起 / sea 沉下 / cliff / none
  softLimit: 20000,
  outOfBounds: 'hint',
  heightScale: 0,
  roughness: 0.45,
  ridge: 0.3,
  lakeCount: 0,
  lakeSize: 'medium',
  flatRadius: 0,
  waterLevel: -1.5,
  shoreWidth: 2,
  snowLine: 95,
  treeLine: 80,
  forestScale: 220,
  forestCover: 0.52,
  slopeTreeMax: 33,
  slopeRockMin: 45,
  grassDensity: 0.35,
  treeDensity: 0.6,
  chunkSize: 64,
  viewDistance: 256,
  cullDistance: 400,     // 渲染距离：相机到地形边界超过它 → 整块地形不渲染（不占资源）
  lodSegments: [64, 32, 16, 8],
  grassRadius: 48,
  treeRadius: 200,
  materials: { grass: '', dirt: '', rock: '', snow: '' }
});

const DEFAULT_AREA = Object.freeze({
  x: 0, z: 0, width: 2000, depth: 2000, baseY: 0, priority: 0,
  color: '#2d5016', gridSize: 100
});

const ENUMS = {
  mode: ['bounded', 'infinite_safe', 'infinite_full'],
  edgeMode: ['mountain', 'sea', 'cliff', 'none'],
  lakeSize: ['small', 'medium', 'large'],
  outOfBounds: ['hint', 'soft_block', 'teleport']
};

const NUM_RANGES = {
  worldRadius: [500, 20000],
  edgeWidth: [0, 2000],
  softLimit: [1000, 1000000],
  heightScale: [0, 300],
  roughness: [0, 1],
  ridge: [0, 1],
  lakeCount: [0, 8],
  flatRadius: [0, 500],
  waterLevel: [-50, 50],
  shoreWidth: [0, 20],
  snowLine: [0, 400],
  treeLine: [0, 400],
  forestScale: [40, 800],
  forestCover: [0, 1],
  slopeTreeMax: [5, 80],
  slopeRockMin: [5, 89],
  grassDensity: [0, 3],
  treeDensity: [0, 3],
  viewDistance: [96, 1024],
  cullDistance: [64, 4000],
  grassRadius: [0, 120],
  treeRadius: [0, 600]
};

const CHUNK_SIZES = [32, 48, 64, 96, 128, 192, 256];

function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function sanitizeLodSegments(v) {
  const d = DEFAULT_PARAMS.lodSegments;
  if (!Array.isArray(v) || v.length !== 4) return d.slice();
  const out = [];
  for (const item of v) {
    const n = Math.round(Number(item));
    if (!Number.isFinite(n) || n < 2 || n > 128) return d.slice();
    out.push(n);
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i] >= out[i - 1]) return d.slice();
  }
  return out;
}

function sanitizeParams(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const out = {};
  for (const key of Object.keys(DEFAULT_PARAMS)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const v = src[key];
    if (key === 'lodSegments') { out[key] = sanitizeLodSegments(v); continue; }
    if (key === 'materials') {
      const m = (v && typeof v === 'object') ? v : {};
      out.materials = {
        grass: String(m.grass || '').slice(0, 300),
        dirt: String(m.dirt || '').slice(0, 300),
        rock: String(m.rock || '').slice(0, 300),
        snow: String(m.snow || '').slice(0, 300)
      };
      continue;
    }
    if (ENUMS[key]) {
      out[key] = ENUMS[key].includes(v) ? v : DEFAULT_PARAMS[key];
      continue;
    }
    if (key === 'chunkSize') {
      const n = Number(v);
      out.chunkSize = CHUNK_SIZES.includes(n) ? n : DEFAULT_PARAMS.chunkSize;
      continue;
    }
    if (key === 'version') { out.version = 1; continue; }
    if (NUM_RANGES[key]) {
      const [min, max] = NUM_RANGES[key];
      out[key] = clampNum(v, min, max, DEFAULT_PARAMS[key]);
    }
  }
  return out;
}

function mergeParams(base, override) {
  return Object.assign({}, DEFAULT_PARAMS, base || {}, sanitizeParams(override));
}

/**
 * 位置与范围：{ x, z, width, depth, baseY, priority, color, gridSize }
 * 兼容旧版 { enabled, x, z, size, priority }（zone 语义）：size 同时当宽和深
 */
function sanitizeArea(input, fallback) {
  const cur = Object.assign({}, DEFAULT_AREA, fallback || {});
  const src = (input && typeof input === 'object') ? input : {};

  let x = src.x !== undefined && src.x !== null && src.x !== '' ? Number(src.x) : cur.x;
  let z = src.z !== undefined && src.z !== null && src.z !== '' ? Number(src.z) : cur.z;
  let width = src.width !== undefined && src.width !== null && src.width !== '' ? Number(src.width) : cur.width;
  let depth = src.depth !== undefined && src.depth !== null && src.depth !== '' ? Number(src.depth) : cur.depth;

  // 旧版 zone{size} 兼容
  if ((src.width === undefined || src.width === null) && src.size !== undefined && src.size !== null && src.size !== '') {
    width = Number(src.size);
    if (src.depth === undefined || src.depth === null) depth = Number(src.size);
  }

  const baseY = (src.baseY !== undefined) ? Number(src.baseY) : cur.baseY;
  const priority = (src.priority !== undefined) ? Math.round(Number(src.priority) || 0) : cur.priority;
  const color = /^#[0-9a-fA-F]{6}$/.test(src.color || '') ? src.color : cur.color;
  const gridSize = (src.gridSize !== undefined) ? Math.round(Number(src.gridSize) || 100) : cur.gridSize;

  return {
    x: Number.isFinite(x) ? Math.max(-20000, Math.min(20000, x)) : 0,
    z: Number.isFinite(z) ? Math.max(-20000, Math.min(20000, z)) : 0,
    width: Number.isFinite(width) ? Math.max(100, Math.min(20000, width)) : DEFAULT_AREA.width,
    depth: Number.isFinite(depth) ? Math.max(100, Math.min(20000, depth)) : DEFAULT_AREA.depth,
    baseY: Number.isFinite(baseY) ? Math.max(-5000, Math.min(5000, baseY)) : 0,
    priority: Math.max(-1000, Math.min(1000, priority)),
    color: color,
    gridSize: Math.max(1, Math.min(500, gridSize))
  };
}

function validateName(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return { ok: false, error: '地形名称不能为空' };
  if (s.length > 80) return { ok: false, error: '地形名称不能超过 80 个字符' };
  return { ok: true, value: s };
}

function shapeRow(r) {
  return {
    id: r.id,
    name: r.name,
    note: r.note || '',
    builtin: !!r.is_builtin,
    active: !!r.is_active,
    seed: Number(r.seed),
    params: r.params || {},
    // 位置与范围（"地形 = 地块"）
    area: {
      x: r.pos_x == null ? 0 : Number(r.pos_x),
      z: r.pos_z == null ? 0 : Number(r.pos_z),
      width: r.width == null ? DEFAULT_AREA.width : Number(r.width),
      depth: r.depth == null ? DEFAULT_AREA.depth : Number(r.depth),
      baseY: r.base_y == null ? 0 : Number(r.base_y),
      priority: r.priority == null ? 0 : Number(r.priority),
      color: r.color || DEFAULT_AREA.color,
      gridSize: r.grid_size == null ? 100 : Number(r.grid_size)
    },
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

// ===== 读接口（公开）=====

router.get('/list', async (req, res) => {
  try {
    const r = await query(
      `SELECT ${TERRAIN_COLS} FROM terrains ORDER BY is_active DESC, priority DESC, is_builtin DESC, id ASC`
    );
    res.json({ success: true, terrains: r.rows.map(shapeRow), defaults: DEFAULT_PARAMS, defaultArea: DEFAULT_AREA });
  } catch (e) {
    console.error('[terrain] list 失败:', e.message);
    res.status(500).json({ success: false, error: '读取地形列表失败' });
  }
});

// 当前生效的"主地形"（优先级最高 / 内置）—— 兼容旧前端
router.get('/active', async (req, res) => {
  try {
    const r = await query(
      `SELECT ${TERRAIN_COLS} FROM terrains WHERE is_active = TRUE
        ORDER BY priority DESC, is_builtin DESC, id ASC LIMIT 1`
    );
    res.set('Cache-Control', 'no-store');
    if (!r.rows.length) return res.json({ success: true, terrain: null, defaults: DEFAULT_PARAMS });
    res.json({ success: true, terrain: shapeRow(r.rows[0]) });
  } catch (e) {
    console.error('[terrain] active 失败:', e.message);
    res.status(500).json({ success: false, error: '读取当前地形失败' });
  }
});

/**
 * 世界端使用的完整地形集合：所有生效地形（含位置/面积/base_y）
 * 世界端 60 秒轮询（不要缓存）
 */
router.get('/world', async (req, res) => {
  try {
    const r = await query(
      `SELECT ${TERRAIN_COLS} FROM terrains WHERE is_active = TRUE
        ORDER BY priority DESC, is_builtin DESC, id ASC`
    );
    res.set('Cache-Control', 'no-store');
    const terrains = r.rows.map(shapeRow);
    // 兼容旧字段：global = 第一条（主地形），zones = 其余
    res.json({
      success: true,
      terrains: terrains,
      global: terrains[0] || null,
      zones: terrains.slice(1),
      defaults: DEFAULT_PARAMS
    });
  } catch (e) {
    console.error('[terrain] world 失败:', e.message);
    res.status(500).json({ success: false, error: '读取世界地形失败' });
  }
});

router.get('/:id(\\d+)', async (req, res) => {
  try {
    const r = await query(`SELECT ${TERRAIN_COLS} FROM terrains WHERE id = $1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, error: '地形不存在' });
    res.json({ success: true, terrain: shapeRow(r.rows[0]) });
  } catch (e) {
    console.error('[terrain] get 失败:', e.message);
    res.status(500).json({ success: false, error: '读取地形失败' });
  }
});

// ===== 写接口（管理员）=====

// 新建地形：{ name, note?, from?, seed?, params?, area? }（area 也接受旧 zone 结构）
router.post('/', authenticateAdminToken, async (req, res) => {
  const nm = validateName(req.body && req.body.name);
  if (!nm.ok) return res.status(400).json({ success: false, error: nm.error });

  try {
    const body = req.body || {};
    let baseSeed = 1;
    let baseParams = DEFAULT_PARAMS;

    const from = body.from;
    if (from && from !== 'default') {
      const b = await query('SELECT seed, params FROM terrains WHERE id = $1', [Number(from)]);
      if (!b.rows.length) return res.status(400).json({ success: false, error: '模板地形不存在' });
      baseSeed = Number(b.rows[0].seed);
      baseParams = b.rows[0].params || DEFAULT_PARAMS;
    }

    const seedRaw = Number(body.seed);
    const seed = Number.isFinite(seedRaw) && seedRaw > 0
      ? Math.min(2147483647, Math.floor(seedRaw))
      : baseSeed;

    const params = mergeParams(baseParams, body.params);
    const note = String(body.note || '').slice(0, 200);
    const area = sanitizeArea(body.area || body.zone || null, DEFAULT_AREA);

    const r = await query(
      `INSERT INTO terrains (name, note, is_builtin, is_active, seed, params,
                             pos_x, pos_z, width, depth, base_y, priority, color, grid_size)
       VALUES ($1,$2,FALSE,FALSE,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${TERRAIN_COLS}`,
      [nm.value, note, seed, JSON.stringify(params),
        area.x, area.z, area.width, area.depth, area.baseY, area.priority, area.color, area.gridSize]
    );
    res.json({ success: true, terrain: shapeRow(r.rows[0]) });
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ success: false, error: '已存在同名地形，请换一个名称' });
    }
    console.error('[terrain] create 失败:', e.message);
    res.status(500).json({ success: false, error: '新建地形失败' });
  }
});

router.put('/:id(\\d+)', authenticateAdminToken, async (req, res) => {
  try {
    const cur = await query(`SELECT ${TERRAIN_COLS} FROM terrains WHERE id = $1`, [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ success: false, error: '地形不存在' });
    const row = cur.rows[0];
    if (row.is_builtin) {
      return res.status(403).json({ success: false, error: '内置默认地形不可修改（可复制一份再改）' });
    }

    const body = req.body || {};
    let name = row.name;
    if (body.name !== undefined) {
      const nm = validateName(body.name);
      if (!nm.ok) return res.status(400).json({ success: false, error: nm.error });
      name = nm.value;
    }
    const note = body.note !== undefined ? String(body.note || '').slice(0, 200) : row.note;
    const seed = body.seed !== undefined
      ? Math.min(2147483647, Math.max(1, Math.floor(Number(body.seed) || row.seed)))
      : Number(row.seed);
    const params = body.params !== undefined ? mergeParams(row.params, body.params) : row.params;

    const prevArea = {
      x: row.pos_x == null ? 0 : Number(row.pos_x),
      z: row.pos_z == null ? 0 : Number(row.pos_z),
      width: row.width == null ? DEFAULT_AREA.width : Number(row.width),
      depth: row.depth == null ? DEFAULT_AREA.depth : Number(row.depth),
      baseY: row.base_y == null ? 0 : Number(row.base_y),
      priority: row.priority == null ? 0 : Number(row.priority),
      color: row.color || DEFAULT_AREA.color,
      gridSize: row.grid_size == null ? 100 : Number(row.grid_size)
    };
    const area = (body.area !== undefined || body.zone !== undefined)
      ? sanitizeArea(body.area || body.zone, prevArea)
      : prevArea;

    const r = await query(
      `UPDATE terrains SET name=$1, note=$2, seed=$3, params=$4::jsonb,
              pos_x=$5, pos_z=$6, width=$7, depth=$8, base_y=$9, priority=$10,
              color=$11, grid_size=$12, updated_at=NOW()
        WHERE id=$13 RETURNING ${TERRAIN_COLS}`,
      [name, note, seed, JSON.stringify(params),
        area.x, area.z, area.width, area.depth, area.baseY, area.priority,
        area.color, area.gridSize, req.params.id]
    );
    res.json({ success: true, terrain: shapeRow(r.rows[0]) });
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ success: false, error: '已存在同名地形，请换一个名称' });
    }
    console.error('[terrain] update 失败:', e.message);
    res.status(500).json({ success: false, error: '保存地形失败' });
  }
});

router.delete('/:id(\\d+)', authenticateAdminToken, async (req, res) => {
  try {
    const cur = await query(`SELECT ${TERRAIN_COLS} FROM terrains WHERE id = $1`, [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ success: false, error: '地形不存在' });
    if (cur.rows[0].is_builtin) {
      return res.status(403).json({ success: false, error: '内置默认地形不可删除' });
    }
    if (cur.rows[0].is_active) {
      return res.status(409).json({ success: false, error: '该地形正在生效，请先停用再删除' });
    }
    await query('DELETE FROM terrains WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[terrain] delete 失败:', e.message);
    res.status(500).json({ success: false, error: '删除地形失败' });
  }
});

/** 让地形生效（多块可同时生效，各自占一块区域） */
router.post('/:id(\\d+)/activate', authenticateAdminToken, async (req, res) => {
  try {
    const r = await query(
      `UPDATE terrains SET is_active = TRUE, updated_at = NOW() WHERE id = $1 RETURNING ${TERRAIN_COLS}`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: '地形不存在' });
    res.json({ success: true, terrain: shapeRow(r.rows[0]) });
  } catch (e) {
    console.error('[terrain] activate 失败:', e.message);
    res.status(500).json({ success: false, error: '启用地形失败' });
  }
});

/** 让地形停止生效（该区域变成"没有地形"，玩家会掉下去） */
router.post('/:id(\\d+)/deactivate', authenticateAdminToken, async (req, res) => {
  try {
    const r = await query(
      `UPDATE terrains SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING ${TERRAIN_COLS}`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: '地形不存在' });
    res.json({ success: true, terrain: shapeRow(r.rows[0]) });
  } catch (e) {
    console.error('[terrain] deactivate 失败:', e.message);
    res.status(500).json({ success: false, error: '停用地形失败' });
  }
});

module.exports = router;
module.exports.DEFAULT_PARAMS = DEFAULT_PARAMS;
module.exports.DEFAULT_AREA = DEFAULT_AREA;
