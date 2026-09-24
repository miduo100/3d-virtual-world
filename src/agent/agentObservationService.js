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

/** 空间距离（3D，含高度差）：2026-09-23 实测 AI 据"水平 4.44m"误判"我就在他旁边"，
 *  实际对方在 9.6m 高的出生台上、根本看不到我。两个口径都如实给出，由 AI 判断隔了几层。 */
function dist3D(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = (ay || 0) - (by || 0), dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
      distance: round2(dist2D(pos.x, pos.z, r.position_x, r.position_z)),
      distance3D: round2(dist3D(pos.x, pos.y, pos.z, r.position_x, r.position_y, r.position_z))
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
      distance: round2(dist2D(pos.x, pos.z, px, pz)),
      distance3D: round2(dist3D(pos.x, pos.y, pos.z, px, py, pz))
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
      distance: round2(dist2D(pos.x, pos.z, px, pz)),
      distance3D: round2(dist3D(pos.x, pos.y, pos.z, px, py, pz))
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
        distance: round2(d),   // 半径过滤口径（水平距离，同 /around；空间距离见 distance3D）
        distance3D: round2(dist3D(pos.x, pos.y, pos.z, Number(p.position.x) || 0, Number(p.position.y) || 0, Number(p.position.z) || 0)),
        // A(2026-09-23)：角色朝向（弧度）——真人上报 avatar.rotation.y，Agent 侧可能裹成 {yaw}，两形态都归一化，拿不到为 null
        yaw: (p.rotation && Number.isFinite(Number(p.rotation.yaw))) ? Number(p.rotation.yaw) : (Number.isFinite(Number(p.rotation)) ? Number(p.rotation) : null),
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
      distance3D: 0,
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
    // 2026-09-23：**你的 y 不是渲染高度**。服务端没有地形数据，Agent 走平面
    // （agentMovementService.GROUND_Y_DEFAULT = 0），真人看到的你在哪一层由客户端贴地决定。
    positionIsServerPlane: true,
    // 有在线连接时用实时朝向（presenceBridge 写入的 rotation 是数字 yaw），否则 0
    rotation: { yaw: Number.isFinite(pos.yaw) ? pos.yaw : 0 }
  };
}

// ==================== world 信息（60s 缓存）====================

/**
 * 世界身份。**2026-09-22 AI 访客体检 [6-2] 修复**：原实现查的键名是
 * `config_key IN ('147','20','21','22','148')`，而真实库（本地与线上都一样）用的是
 * **命名键** `world_id` / `world_name` / `world_url` —— 该查询恒返回 0 行，导致
 * `observe.world` 从写下那天起就恒为 `{id:null,name:null}`：
 *   - MCP `world_observe` 首行显示「世界「未知」（id=?）」，与同一会话的
 *     `world_discover`（「世界「创世虚拟世界」」）自相矛盾；
 *   - AI 失去唯一的结构化“我在哪个世界”来源（跨世界/联邦场景尤其致命）。
 * 因为从未有验收断言检查过 world 字段，所以一直没暴露。
 *
 * 现口径（**与 routes/agent/meta.js 的 well-known、routes/agent/session.js 的 /me 同源**，
 * 避免同一个世界在三个端点上报出两个不同的 id）：
 *   ① federationSystem 内存态（**权威**，well-known 的 `world.id` 与 /me 的 `worldId` 都取自它）
 *   ② system_config 命名键 `world_id`/`world_name`/`world_url`（真实库的键名）
 *   ③ system_config 历史数字键 `147`/`20`/`21`（老库兼容）
 * 读不到就如实返回 null，绝不编造。
 *
 * ⚠️ 优先级不能反：本地库实测 `system_config.world_id` 是 init 脚本里的**占位 UUID**
 * （`550e8400-…`），而 federationSystem 持有真实 id（`world_…`）。若以 DB 为先，observe 会与
 * well-known / /me 报出两个不同 id（验收脚本 W6b/W7 就是这么抓到的）。
 */
let worldInfoCache = null;
let fedWarned = false;              // federationSystem 读取失败只告警一次

// 命名键（现行）→ 历史数字键（老库）→ 返回字段
const WORLD_KEY_ALIASES = {
  'world_id': 'id', '147': 'id',
  'world_name': 'name', '20': 'name',
  'world_url': 'url', '21': 'url'
};

async function getWorldInfo() {
  if (worldInfoCache && Date.now() - worldInfoCache.at < worldInfoCache.ttl) {
    return worldInfoCache.value;
  }

  // ① federationSystem（权威；异步 init，启动初期可能还没就绪）
  let fed = null;
  try {
    // 注意路径层级：本文件在 src/agent/，故是 `../routes/federation`（`../database/db` 同款）。
    // 曾误写成 `../../routes/federation`（解析到工作区根目录）→ MODULE_NOT_FOUND 被下面 catch
    // 静默吞掉，表现为"federation 分支永不生效"且毫无日志。失败只警告一次，不刷屏。
    const federation = require('../routes/federation').getFederationSystem();
    if (federation) {
      fed = {
        id: federation.worldId ? String(federation.worldId).trim() : null,
        name: federation.worldName ? String(federation.worldName).trim() : null,
        url: federation.worldUrl ? String(federation.worldUrl).trim() : null
      };
    }
  } catch (e) {
    // 首次失败告警一次（绝不静默：路径写错与"尚未初始化"必须能区分开）
    if (!fedWarned) { fedWarned = true; console.warn('[Agent observe] federationSystem 不可用，world 将回落 system_config：', e.message); }
  }

  // ② / ③ system_config（命名键优先，历史数字键兜底）
  let db = { id: null, name: null, url: null };
  try {
    const result = await query(
      `SELECT config_key, config_value FROM system_config
       WHERE config_key IN ('world_id','world_name','world_url','147','20','21')`
    );
    for (const row of result.rows) {
      const field = WORLD_KEY_ALIASES[row.config_key];
      if (field && row.config_value != null && row.config_value !== '' && !db[field]) {
        db[field] = String(row.config_value).trim() || null;
      }
    }
  } catch (e) { /* non-fatal：DB 不可用则只用 federationSystem */ }

  const value = {
    id: (fed && fed.id) || db.id,
    name: (fed && fed.name) || db.name,
    url: (fed && fed.url) || db.url
  };

  // federationSystem 未就绪时用短 TTL（5s），就绪后用 60s：
  // 否则启动初期算出的 DB 兜底值会被钉住一分钟（实测会与 well-known 短暂不一致）。
  const fedReady = !!(fed && (fed.id || fed.name || fed.url));
  worldInfoCache = { value, at: Date.now(), ttl: fedReady ? 60000 : 5000 };
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
 * @returns { world, self, entities, objects, portals, distanceSemantics, radius, limit, timestamp, sequence }
 *   entities/objects/portals 每项都带 distance（水平 2D）与 distance3D（空间 3D）
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
    // 距离语义（2026-09-23）：distance=水平(2D，忽略 y)；distance3D=空间(3D)。服务端移动恒为
    // 平面（y=0，无地形数据），真人/AI 的渲染高度由客户端贴地决定 → 小 distance ≠ 同一层。
    distanceSemantics: 'distance=horizontal(2D,ignores y); distance3D=spatial(3D); your own y is a server-side plane estimate(=0), NOT your rendered height (clients snap avatars to terrain), so distance3D involving yourself is an upper bound; all server-side delivery checks (chat/voice/interact) use horizontal distance',
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
