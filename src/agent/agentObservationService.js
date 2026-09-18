/**
 * AI Agent 接入 - 观察服务（P2）
 * 复用 worldSpatial 的 /around 同口径查询（方框 position_x/z BETWEEN），
 * 但返回字段精简为雷达视图（id/type/name/position/distance），无管理员私有字段、
 * 无 model_path/file_size/geometry_data（AI 不下 GLB，靠 name/type 语义识别物体）。
 *
 * entities 来源：wsServer.getPlayerPositions() 内存（在线人类 + 已入场的 Agent）。
 * P2 阶段 Agent 尚未通过 WS 入场（P3 agentPresenceBridge 才写 playerPositions），
 * 故 self 永远包含在 entities 中（isSelf:true），位置来自 query x/z 或 session.current_position。
 */

const { query } = require('../database/db');

// ==================== 常量 ====================

const MAX_RADIUS = 200;                 // 红线：硬上限 200m（5.4 节）
const DEFAULT_RADIUS = 100;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// ==================== 工具 ====================

function clampRadius(r) {
  const n = Number(r);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RADIUS;
  return Math.min(n, MAX_RADIUS);
}

function clampLimit(l) {
  const n = parseInt(l, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * 观察点解析：query x/z 优先 → session.current_position → (0,0,0)
 * P2 阶段 Agent 无 WS 连接，位置是"观察点"而非"自身位置"；
 * 允许 Agent 用任意坐标探测世界（不强制要求 Agent 已入场）。
 */
function resolvePosition(options, session) {
  const ox = Number(options.x);
  const oz = Number(options.z);
  if (Number.isFinite(ox) && Number.isFinite(oz)) {
    const oy = Number(options.y);
    return { x: ox, y: Number.isFinite(oy) ? oy : 0, z: oz };
  }
  if (session && session.current_position) {
    const p = typeof session.current_position === 'string'
      ? safeParse(session.current_position) : session.current_position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      return { x: p.x, y: Number.isFinite(p.y) ? p.y : 0, z: p.z };
    }
  }
  return { x: 0, y: 0, z: 0 };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * 解析 include 参数（逗号分隔字符串或数组），返回 type 过滤清单
 */
function parseInclude(include) {
  if (!include) return [];
  if (Array.isArray(include)) return include.filter(s => typeof s === 'string');
  if (typeof include === 'string') {
    return include.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// ==================== 查询：world_objects ====================

/**
 * world_objects 方框范围查询（与 worldSpatial /around 同口径：position_x/z BETWEEN）
 * 精简字段：id/type/name/position/distance（无 model_path/file_size/geometry_data 等私有字段）
 */
async function queryObjects(pos, radius, limit, include) {
  const xMin = pos.x - radius, xMax = pos.x + radius;
  const zMin = pos.z - radius, zMax = pos.z + radius;
  const types = parseInclude(include);

  const params = [xMin, xMax, zMin, zMax, pos.x, pos.z];
  let typeClause = '';
  if (types.length > 0) {
    typeClause = ` AND type = ANY($${params.length + 1}::varchar[])`;
    params.push(types);
  }
  params.push(limit);

  // 按到观察点的距离升序（雷达语义：近的先返回），LIMIT 精确截断最近的 N 个
  const result = await query(
    `SELECT id, type, name, position_x, position_y, position_z
     FROM world_objects
     WHERE position_x BETWEEN $1 AND $2
       AND position_z BETWEEN $3 AND $4
       ${typeClause}
     ORDER BY (position_x - $5)^2 + (position_z - $6)^2 ASC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(r => ({
    id: String(r.id),
    type: r.type,
    name: r.name,
    position: { x: r.position_x, y: r.position_y, z: r.position_z },
    distance: round2(dist2D(pos.x, pos.z, r.position_x, r.position_z))
  }));
}

// ==================== 查询：ad_slots（并入 objects，type='ad_slot'）====================

async function queryAdSlots(pos, radius, limit) {
  const xMin = pos.x - radius, xMax = pos.x + radius;
  const zMin = pos.z - radius, zMax = pos.z + radius;

  const result = await query(
    `SELECT id, name, position
     FROM ad_slots
     WHERE is_active = true
       AND (rent_end IS NULL OR rent_end > NOW())
       AND (position->>'x')::float8 BETWEEN $1 AND $2
       AND (position->>'z')::float8 BETWEEN $3 AND $4
     ORDER BY ((position->>'x')::float8 - $5)^2 + ((position->>'z')::float8 - $6)^2 ASC
     LIMIT $7`,
    [xMin, xMax, zMin, zMax, pos.x, pos.z, limit]
  );

  return result.rows.map(r => {
    const p = r.position || {};
    const px = Number(p.x) || 0;
    const py = Number(p.y) || 0;
    const pz = Number(p.z) || 0;
    return {
      id: 'adslot:' + r.id,
      type: 'ad_slot',
      name: r.name || '广告位',
      position: { x: px, y: py, z: pz },
      distance: round2(dist2D(pos.x, pos.z, px, pz))
    };
  });
}

// ==================== 查询：portals ====================

async function queryPortals(pos, radius, limit) {
  const xMin = pos.x - radius, xMax = pos.x + radius;
  const zMin = pos.z - radius, zMax = pos.z + radius;

  const result = await query(
    `SELECT id, name, source_position
     FROM portals
     WHERE is_active = true
       AND (source_position->>'x')::float8 BETWEEN $1 AND $2
       AND (source_position->>'z')::float8 BETWEEN $3 AND $4
     ORDER BY ((source_position->>'x')::float8 - $5)^2 + ((source_position->>'z')::float8 - $6)^2 ASC
     LIMIT $7`,
    [xMin, xMax, zMin, zMax, pos.x, pos.z, limit]
  );

  return result.rows.map(r => {
    const src = r.source_position || {};
    const px = Number(src.x) || 0;
    const py = Number(src.y) || 0;
    const pz = Number(src.z) || 0;
    return {
      id: r.id,
      name: r.name,
      position: { x: px, y: py, z: pz },
      distance: round2(dist2D(pos.x, pos.z, px, pz))
    };
  });
}

// ==================== entities：在线人类 + 本 Agent ====================

/**
 * 从 wsServer.getPlayerPositions() 内存收集半径内的实体（人类 + Agent）。
 * P2 阶段本 Agent 通常不在 playerPositions（未通过 WS 入场），故显式插入 self 条目。
 */
function collectEntities(pos, radius, selfAgent) {
  const entities = [];

  let playerPositions = null;
  try {
    const wsServer = require('../websocket/wsServer');
    playerPositions = wsServer.getPlayerPositions ? wsServer.getPlayerPositions() : null;
  } catch (e) {
    playerPositions = null;
  }

  if (playerPositions && playerPositions.forEach) {
    playerPositions.forEach((p) => {
      if (!p || !p.position) return;
      const d = dist2D(pos.x, pos.z, Number(p.position.x) || 0, Number(p.position.z) || 0);
      if (d > radius) return;
      const isSelf = String(p.characterId) === String(selfAgent.id);
      entities.push({
        id: p.characterId,
        type: p.entityType === 'agent' ? 'agent' : 'human',
        name: p.characterName,
        position: {
          x: Number(p.position.x) || 0,
          y: Number(p.position.y) || 0,
          z: Number(p.position.z) || 0
        },
        distance: round2(d),
        animMode: p.animMode || null,
        isSelf
      });
    });
  }

  // 始终包含 self（P2 阶段 Agent 可能未入 playerPositions）
  const hasSelf = entities.some(e => String(e.id) === String(selfAgent.id));
  if (!hasSelf) {
    entities.push({
      id: selfAgent.id,
      type: 'agent',
      name: selfAgent.name,
      position: { x: pos.x, y: pos.y, z: pos.z },
      distance: 0,
      animMode: null,
      isSelf: true
    });
  }

  return entities;
}

// ==================== self ====================

function shapeSelf(agent, pos) {
  return {
    id: agent.id,
    name: agent.name,
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { yaw: 0 }       // P2 无朝向输入，固定 0
  };
}

// ==================== world 信息（60s 缓存）====================

let worldInfoCache = null;

async function getWorldInfo() {
  if (worldInfoCache && Date.now() - worldInfoCache.at < 60000) {
    return worldInfoCache.value;
  }
  let value = { id: null, name: null };
  try {
    const result = await query(
      `SELECT config_key, config_value FROM system_config
       WHERE config_key IN ('147','20','21','22','148')`
    );
    for (const row of result.rows) {
      if (row.config_key === '147') value.id = row.config_value;
      if (row.config_key === '20') value.name = row.config_value;
      if (row.config_key === '21') value.url = row.config_value;
    }
  } catch (e) { /* non-fatal */ }
  worldInfoCache = { value, at: Date.now() };
  return value;
}

// ==================== 序列号 ====================

let sequenceCounter = 0;
function nextSeq() { return ++sequenceCounter; }

// ==================== 主入口 ====================

/**
 * 执行 observe 查询
 * @param agent       Agent 主体（req.agent）
 * @param session     Agent 会话行（req.agentSession，含 current_position）
 * @param options     { radius, limit, include, x, y, z }
 * @returns { world, self, entities, objects, portals, radius, limit, timestamp, sequence }
 */
async function observe(agent, session, options) {
  const radius = clampRadius(options.radius);
  const limit = clampLimit(options.limit);
  const pos = resolvePosition(options, session);

  const [objects, adSlots, portals, entities, world] = await Promise.all([
    queryObjects(pos, radius, limit, options.include),
    queryAdSlots(pos, radius, limit),
    queryPortals(pos, radius, limit),
    Promise.resolve(collectEntities(pos, radius, agent)),
    getWorldInfo()
  ]);

  // objects 与 ad_slots 合并（ad_slot 作为 type='ad_slot' 的 object，与 /around 一致）
  const allObjects = [...objects, ...adSlots];

  return {
    world,
    self: shapeSelf(agent, pos),
    entities,
    objects: allObjects,
    portals,
    radius,
    limit,
    timestamp: new Date().toISOString(),
    sequence: nextSeq()
  };
}

module.exports = {
  observe,
  MAX_RADIUS,
  DEFAULT_RADIUS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  // 导出工具供测试/复用
  clampRadius,
  clampLimit,
  resolvePosition
};
