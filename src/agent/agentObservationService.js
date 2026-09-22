/**
 * AI Agent 接入 - 观察服务（P2）
 * 复用 worldSpatial 的 /around 同口径查询（方框 position_x/z BETWEEN），
 * 但返回字段精简为雷达视图（id/type/name/position/distance），无管理员私有字段、
 * 无 model_path/file_size/geometry_data（AI 不下 GLB，靠 name/type 语义识别物体）。
 *
 * entities 来源：wsServer.getPlayerPositions() 内存（在线人类 + 已入场的 Agent）。
 * P2 阶段 Agent 尚未通过 WS 入场（P3 agentPresenceBridge 才写 playerPositions），
 * 故 self 永远包含在 entities 中（isSelf:true）。
 *
 * 2026-09-18 第一轮真人联测缺陷 A/B 修复：
 *   A) 观察点（self.position 与所有 distance 的原点）改为优先取 playerPositions 中
 *      该 Agent 的**实时位置**，session.current_position 仅作无在线连接时的兜底；
 *   B) entities 按 characterId 去重（同角色多连接只输出一条最优条目），
 *      满足第 5.4 节实体标识契约"entities[].id 唯一"。
 */

const { query } = require('../database/db');
// 🤖 几何体描述默认值推导（名称类型词 → 映射表；库里有值时不生效）
const geometryAgentDesc = require('../services/geometryAgentDesc');

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
 * 实时位置条目打分（用于同角色多连接时挑"活的"那一条）：
 *   ① 带 animMode 的条目 = 真正在推进的连接（移动服务每 tick 会写 animMode）
 *   ② 其次比 lastUpdate 时间
 * animMode 权重远大于时间戳（用 1e15 放大），保证"动的连接"恒胜"静止的出生点连接"。
 */
function scoreEntry(p) {
  if (!p) return -1;
  const animScore = p.animMode ? 1 : 0;
  const ts = p.lastUpdate ? new Date(p.lastUpdate).getTime() : 0;
  return animScore * 1e15 + (Number.isFinite(ts) ? ts : 0);
}

/**
 * 从 playerPositions 取某 Agent 的在线条目（缺陷 A/B 的统一取数点）
 * playerPositions 按 connectionId 存，同一 agentId 可能有多条（多开/重连残留），
 * 故按 scoreEntry 挑最优的一条；无在线连接时返回 null。
 */
function pickLiveEntry(agentId) {
  if (!agentId) return null;
  let playerPositions = null;
  try {
    const wsServer = require('../websocket/wsServer');
    playerPositions = wsServer.getPlayerPositions ? wsServer.getPlayerPositions() : null;
  } catch (e) {
    return null;
  }
  if (!playerPositions || !playerPositions.forEach) return null;
  const target = String(agentId);
  let best = null;
  playerPositions.forEach((p) => {
    if (!p || !p.position || String(p.characterId) !== target) return;
    if (!best || scoreEntry(p) > scoreEntry(best)) best = p;
  });
  return best;
}

/**
 * 观察点解析（2026-09-18 修正 · 缺陷 A）：
 *   ① query x/z（Agent 显式探测某个坐标）
 *   ② **本 Agent 在 playerPositions 的实时位置（WS 连接权威）** ← 新增，A 项修复点
 *   ③ session.current_position（无在线连接时的兜底：断线前最后落库位置）
 *   ④ (0,0,0)
 *
 * 修正前的顺序是 ① → ③ → ④，导致"用第二条只读会话（纯 HTTP、无 WS）调 observe"时
 * self 恒为 (0,0,0)、所有 distance 也以 (0,0,0) 为原点（而同一 agent 在 entities 里
 * 另有真实位置条目），客户端据此算距离必然跑偏（第一轮联测"原地徘徊"的根因之一）。
 * self 与 entities[].distance 共用本函数返回的 pos，故改这一处两者同时修正。
 */
function resolvePosition(options, session, agent) {
  const ox = Number(options.x);
  const oz = Number(options.z);
  if (Number.isFinite(ox) && Number.isFinite(oz)) {
    const oy = Number(options.y);
    return { x: ox, y: Number.isFinite(oy) ? oy : 0, z: oz };
  }
  if (agent && agent.id) {
    const live = pickLiveEntry(agent.id);
    if (live && live.position && Number.isFinite(Number(live.position.x)) && Number.isFinite(Number(live.position.z))) {
      const lr = live.rotation;
      return {
        x: Number(live.position.x),
        y: Number.isFinite(Number(live.position.y)) ? Number(live.position.y) : 0,
        z: Number(live.position.z),
        yaw: typeof lr === 'number' && Number.isFinite(lr) ? lr : 0
      };
    }
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
    `SELECT id, type, name, agent_description, position_x, position_y, position_z
     FROM world_objects
     WHERE position_x BETWEEN $1 AND $2
       AND position_z BETWEEN $3 AND $4
       ${typeClause}
     ORDER BY (position_x - $5)^2 + (position_z - $6)^2 ASC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(r => {
    // 🤖 AI 描述（管理员在编辑器填写，AI 靠它认识物体；截断 300 字防雷达包过大）
    // 库里有值优先（人工填写 / 模型描述继承）；为空且是几何体时，按名称里的类型词推导默认值
    // ——这样任何创建路径（含 aiSceneGenerator 直插、编辑器批量导入）都自动有描述。
    let desc = r.agent_description ? String(r.agent_description) : '';
    if (!desc && geometryAgentDesc.isGeometryType(r.type)) {
      desc = geometryAgentDesc.deriveAgentDescription({ name: r.name, type: r.type }) || '';
    }
    return {
      id: String(r.id),
      type: r.type,
      name: r.name,
      description: desc ? desc.slice(0, 300) : null,
      position: { x: r.position_x, y: r.position_y, z: r.position_z },
      distance: round2(dist2D(pos.x, pos.z, r.position_x, r.position_z))
    };
  });
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

  // 2026-09-22（任务 E1）：补 description —— portals 表本就有该列（后台"传送门"编辑弹窗
  // 的「描述」框可填），此前 observe 没 SELECT 导致 AI 永远读不到，等于白填。
  const result = await query(
    `SELECT id, name, description, source_position
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
      // 🤖 AI 描述（后台传送门编辑弹窗的「描述」框；未填为 null）
      description: r.description ? String(r.description).slice(0, 300) : null,
      position: { x: px, y: py, z: pz },
      distance: round2(dist2D(pos.x, pos.z, px, pz))
    };
  });
}

// ==================== entities：在线人类 + 本 Agent ====================

/**
 * 从 wsServer.getPlayerPositions() 内存收集半径内的实体（人类 + Agent）。
 * P2 阶段本 Agent 通常不在 playerPositions（未通过 WS 入场），故显式插入 self 条目。
 *
 * 缺陷 B 修复（2026-09-18）：playerPositions 按 connectionId 存，同一 characterId 存在
 * 多条连接时会输出同 id 两条（一条真实位置、一条停在出生点的 animMode:null）——
 * 第 5.4 节实体标识契约要求 entities[].id 唯一，故这里按 characterId 去重，
 * 同 id 只保留 scoreEntry 最优的一条（带 animMode / 最新位置）。
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
    const best = new Map();   // characterId -> { raw, entity }
    playerPositions.forEach((p) => {
      if (!p || !p.position) return;
      const d = dist2D(pos.x, pos.z, Number(p.position.x) || 0, Number(p.position.z) || 0);
      if (d > radius) return;
      const id = String(p.characterId);
      const entity = {
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
        isSelf: id === String(selfAgent.id)
      };
      const prev = best.get(id);
      if (!prev || scoreEntry(p) > scoreEntry(prev.raw)) best.set(id, { raw: p, entity });
    });
    best.forEach((v) => entities.push(v.entity));
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
    // 有在线连接时用实时朝向（presenceBridge 写入的 rotation 是数字 yaw），否则 0
    rotation: { yaw: Number.isFinite(pos.yaw) ? pos.yaw : 0 }
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
  // 缺陷 A：传 agent，使观察点优先取 playerPositions 中的实时位置（self 与 distance 共用此 pos）
  const pos = resolvePosition(options, session, agent);

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
  resolvePosition,
  pickLiveEntry
};
