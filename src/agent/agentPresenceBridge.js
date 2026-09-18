/**
 * Agent 存在桥（P3 核心 · 焊接点）
 * 唯一焊接点：写/删 wsServer.playerPositions（entityType:'agent', isGuest:true），
 * 复用现有 PLAYER_JOINED / PLAYER_LEFT 广播管线。
 *
 * 红线：
 *   - Agent 主键用合成 ID agent:<uuid>（防与真人 UUID 撞键）
 *   - entityType:'agent' 用于①前端 AI 标识 ②不占语音名额
 *   - isGuest:true（Agent 与人共用游客准则）
 *   - 不动 wsServer.js（黑名单贴线文件），只读写 playerPositions Map
 */

const wsServer = require('../websocket/wsServer');

/**
 * Agent WS 连接成功后调用：写 playerPositions + 广播 PLAYER_JOINED
 * @param connectionId  WS 连接 ID（与人类侧同口径，uuid）
 * @param agent        agents 表行（含 id/name/avatar_config）
 * @param session     agent_sessions 行（含 current_position）
 * @param avatar     shapeAvatar 结果（glbUrl/animUrls/...）
 */
function onConnect(connectionId, agent, session, avatar, spawnOverride) {
  const playerPositions = wsServer.getPlayerPositions();
  // spawnOverride：调用方已解析好的出生点（缺陷 J：新会话继承该 Agent 上次位置，防重连瞬移回原点）
  const pos = (spawnOverride && Number.isFinite(spawnOverride.x)) ? spawnOverride : resolveSpawnPosition(session);
  const av = avatar || {};

  playerPositions.set(connectionId, {
    characterId: agent.id,                   // 合成 ID agent:<uuid>
    characterName: agent.name,
    position: pos,
    glbUrl: av.glbUrl || null,
    animUrls: av.animUrls || null,
    weaponConfig: av.weaponConfig || null,
    boneMapConfig: av.boneMapConfig || null,
    weaponSocketConfig: av.weaponSocketConfig || null,
    calibrationConfig: av.calibrationConfig || null,
    isGuest: true,                           // 红线：游客准则
    isSelfContainedBundle: av.isSelfContainedBundle === true,
    entityType: 'agent',                     // 红线6：区分人类/Agent
    lastUpdate: new Date()
  });

  // 广播 PLAYER_JOINED（含 entityType + avatar 六件套，前端复用 addPlayer 加载 GLB）
  wsServer.broadcastToAll({
    type: 'PLAYER_JOINED',
    payload: {
      characterId: agent.id,
      characterName: agent.name,
      position: pos,
      glbUrl: av.glbUrl || null,
      animUrls: av.animUrls || null,
      weaponConfig: av.weaponConfig || null,
      boneMapConfig: av.boneMapConfig || null,
      weaponSocketConfig: av.weaponSocketConfig || null,
      calibrationConfig: av.calibrationConfig || null,
      isGuest: true,
      isSelfContainedBundle: av.isSelfContainedBundle === true,
      entityType: 'agent'                    // 新字段，前端识别 → (AI) + 🤖
    }
  });

  console.log(`[AgentBridge] Agent ${agent.name} (${agent.id}) 已入场 @ ${JSON.stringify(pos)}`);
}

/**
 * Agent WS 断开后调用：广播 PLAYER_LEFT + 删 playerPositions
 *
 * opts.silent（缺陷 B）：被**新连接顶掉**的旧连接走静默清理——只删 playerPositions 表项，
 * 不广播 PLAYER_LEFT。原因是同一 characterId 的新连接已接管：前端按 characterId 管理 avatar，
 * 广播 PLAYER_LEFT 会把刚接管的 avatar 一并删掉（真人端 avatar 闪断）。
 */
function onDisconnect(connectionId, opts) {
  const playerPositions = wsServer.getPlayerPositions();
  const p = playerPositions.get(connectionId);
  if (!p) return;

  const silent = Boolean(opts && opts.silent);
  if (!silent) {
    wsServer.broadcastToAll({
      type: 'PLAYER_LEFT',
      payload: {
        characterId: p.characterId,
        characterName: p.characterName,
        lastPosition: p.position
      }
    });
  }

  playerPositions.delete(connectionId);
  console.log(`[AgentBridge] Agent ${p.characterName} (${p.characterId}) 已离场${silent ? '（被新连接接管，静默清理）' : ''}`);
}

/**
 * 读取某连接在 playerPositions 里的实时条目（返回副本，避免调用方误改共享对象）
 * 用途：移动服务取"当前真实位置"——session 快照只在 WS 连接时读过一次，不能当推进起点。
 * 返回 { position:{x,y,z}, yaw, animMode } 或 null
 */
function getEntry(connectionId) {
  const playerPositions = wsServer.getPlayerPositions();
  const p = playerPositions.get(connectionId);
  if (!p || !p.position) return null;
  let yaw = 0;
  if (typeof p.rotation === 'number' && Number.isFinite(p.rotation)) yaw = p.rotation;
  else if (p.rotation && Number.isFinite(p.rotation.yaw)) yaw = p.rotation.yaw;
  return {
    position: { x: Number(p.position.x) || 0, y: Number(p.position.y) || 0, z: Number(p.position.z) || 0 },
    yaw,
    animMode: p.animMode || null
  };
}

/**
 * 按 characterId 找实时实体条目（follow 目标定位用；第 5.4 节契约：唯一标识是 id，不是 name）
 * playerPositions 按 connectionId 存，同角色多连接时取"带 animMode/最新"的那条。
 * 返回 { connectionId, position:{x,y,z}, yaw, animMode, name, entityType } 或 null
 */
function findByCharacterId(characterId) {
  if (!characterId) return null;
  const playerPositions = wsServer.getPlayerPositions();
  if (!playerPositions || !playerPositions.forEach) return null;
  const target = String(characterId);
  let bestCid = null, best = null, bestScore = -1;
  playerPositions.forEach((p, cid) => {
    if (!p || !p.position || String(p.characterId) !== target) return;
    const ts = p.lastUpdate ? new Date(p.lastUpdate).getTime() : 0;
    const score = (p.animMode ? 1e15 : 0) + (Number.isFinite(ts) ? ts : 0);
    if (score > bestScore) { bestScore = score; bestCid = cid; best = p; }
  });
  if (!best) return null;
  const e = getEntry(bestCid);
  return {
    connectionId: bestCid,
    position: e ? e.position : { x: 0, y: 0, z: 0 },
    yaw: e ? e.yaw : 0,
    animMode: e ? e.animMode : null,
    name: best.characterName,
    entityType: best.entityType === 'agent' ? 'agent' : 'human'
  };
}

/**
 * 更新 Agent 位置（POSITION_UPDATE 推进时调用，复用人类侧广播）
 */
function updatePosition(connectionId, position, animMode, rotation) {
  const playerPositions = wsServer.getPlayerPositions();
  const p = playerPositions.get(connectionId);
  if (!p) return;
  p.position = position;
  if (animMode !== undefined) p.animMode = animMode;
  if (rotation !== undefined) p.rotation = rotation;
  p.lastUpdate = new Date();

  // 前端协议：rotation 必须是数字（world.js 直接 group.rotation.y = rotation）。
  // 若把对象 {yaw} 原样广播，客户端 rotation.y 被赋成对象 → 矩阵 NaN → 模型隐身。
  let rotOut = null;
  if (typeof rotation === 'number' && Number.isFinite(rotation)) {
    rotOut = rotation;
  } else if (rotation && typeof rotation === 'object' && Number.isFinite(rotation.yaw)) {
    rotOut = rotation.yaw;
  }

  wsServer.broadcastToAll({
    type: 'POSITION_UPDATE',
    payload: {
      characterId: p.characterId,
      position,
      animMode: animMode || null,
      rotation: rotOut
    }
  });
}

function resolveSpawnPosition(session) {
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

module.exports = { onConnect, onDisconnect, updatePosition, getEntry, findByCharacterId };
