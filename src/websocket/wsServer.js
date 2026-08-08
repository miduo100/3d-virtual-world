/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');

let wss = null;

// In-memory player positions for real-time updates
const playerPositions = new Map();
const activeConnections = new Map();

/**
 * 设置 WebSocket 服务器，附加到现有的 HTTP server 上（共享端口）
 * @param {import('http').Server} httpServer - Express HTTP server 实例
 */
function setupWebSocketServer(httpServer) {
  try {
    wss = new WebSocket.Server({ server: httpServer });

    wss.on('connection', (ws) => {
      const connectionId = uuidv4();
      activeConnections.set(connectionId, ws);

      console.log(`Client connected: ${connectionId}`);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          handleMessage(connectionId, ws, data);
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });

      ws.on('close', async () => {
        // 保存用户最后位置（下线时停留在当前位置）
        const playerData = playerPositions.get(connectionId);
        if (playerData && playerData.characterId && playerData.position) {
          try {
            await query(
              `UPDATE characters 
               SET last_position = $1, 
                   last_online = CURRENT_TIMESTAMP 
               WHERE id = $2`,
              [JSON.stringify(playerData.position), playerData.characterId]
            );
            console.log(`💾 保存玩家 ${playerData.characterName} 最后位置:`, playerData.position);
          } catch (error) {
            console.error('保存玩家位置失败:', error);
          }
        }
        
        activeConnections.delete(connectionId);
        playerPositions.delete(connectionId);
        
        // 广播玩家离线
        if (playerData) {
          broadcastToAll({
            type: 'PLAYER_LEFT',
            payload: {
              characterId: playerData.characterId,
              characterName: playerData.characterName,
              lastPosition: playerData.position,
            },
          });
        }
        
        console.log(`Client disconnected: ${connectionId}`);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });

    console.log(`WebSocket server attached to HTTP server (shared port)`);
  } catch (error) {
    console.warn('WebSocket server setup failed, continuing without WebSocket:', error.message);
  }
}

function handleMessage(connectionId, ws, data) {
  const { type, payload } = data;

  switch (type) {
    case 'PLAYER_JOIN':
      handlePlayerJoin(connectionId, ws, payload);
      break;

    case 'POSITION_UPDATE':
      handlePositionUpdate(connectionId, payload);
      break;

    case 'SKILL_CAST':
      handleSkillCast(connectionId, payload);
      break;

    case 'MONSTER_ATTACK':
      handleMonsterAttack(connectionId, payload);
      break;

    case 'VOICE_COMMAND':
      handleVoiceCommand(connectionId, payload);
      break;

    case 'CHAT':
      broadcastToAll({
        type: 'CHAT',
        payload: {
          sender: payload.sender,
          message: payload.message,
          timestamp: new Date(),
        },
      });
      break;

    case 'PORTAL_CREATE':
      handlePortalCreate(connectionId, payload);
      break;

    case 'PORTAL_TELEPORT':
      handlePortalTeleport(connectionId, payload);
      break;

    case 'REQUEST_PORTALS':
      handleRequestPortals(connectionId, ws);
      break;

    case 'MODEL_UPDATE':
      handleModelUpdate(connectionId, payload);
      break;

    default:
      console.log('Unknown message type:', type);
  }
}

/**
 * 处理玩家模型URL更新（当客户端异步补全GLB URL后发送）
 * 更新服务器内存中的 glbUrl，并广播给其他在线玩家
 */
function handleModelUpdate(connectionId, payload) {
  const { characterId, glbUrl, animUrls, isSelfContainedBundle } = payload;
  if (playerPositions.has(connectionId)) {
    const p = playerPositions.get(connectionId);
    p.glbUrl = glbUrl || null;
    if (animUrls) p.animUrls = animUrls;
    p.isSelfContainedBundle = isSelfContainedBundle === true;
  }
  // 广播给所有其他玩家，让他们刷新该玩家的模型和动画
  broadcastToAll({
    type: 'MODEL_UPDATE',
    payload: {
      characterId,
      glbUrl: glbUrl || null,
      animUrls: animUrls || null,
      isSelfContainedBundle: isSelfContainedBundle === true,
    },
  });
}

function handlePlayerJoin(connectionId, ws, payload) {
  const { characterId, characterName, position, glbUrl, animUrls, weaponConfig, boneMapConfig, weaponSocketConfig, calibrationConfig, isGuest, isSelfContainedBundle } = payload;

  playerPositions.set(connectionId, {
    characterId,
    characterName,
    position,
    glbUrl: glbUrl || null,
    animUrls: animUrls || null,
    weaponConfig: weaponConfig || null,
    boneMapConfig: boneMapConfig || null,
    weaponSocketConfig: weaponSocketConfig || null,
    calibrationConfig: calibrationConfig || null,
    isGuest: isGuest || false,
    isSelfContainedBundle: isSelfContainedBundle === true,
    lastUpdate: new Date(),
  });

  // Notify all players (含 glbUrl + animUrls + 武器配置 + 校准配置 + 游客标记 + 自包含包标记)
  broadcastToAll({
    type: 'PLAYER_JOINED',
    payload: {
      characterId,
      characterName,
      position,
      glbUrl: glbUrl || null,
      animUrls: animUrls || null,
      weaponConfig: weaponConfig || null,
      boneMapConfig: boneMapConfig || null,
      weaponSocketConfig: weaponSocketConfig || null,
      calibrationConfig: calibrationConfig || null,
      isGuest: isGuest || false,
      isSelfContainedBundle: isSelfContainedBundle === true,
    },
  });

  // Send current world state to new player (含已在线玩家的 glbUrl 和当前天气)
  // 异步读取当前天气配置
  query('SELECT config_value FROM game_config WHERE config_key = \'world_weather\'')
    .then(weatherResult => {
      let currentWeather = { type: 'clear', intensity: 50, wind: 20, auto_cycle: false, cycle_interval: 30 };
      if (weatherResult.rows.length > 0) {
        try { currentWeather = JSON.parse(weatherResult.rows[0].config_value); } catch(e) {}
      }
      ws.send(JSON.stringify({
        type: 'WORLD_STATE',
        payload: {
          players: Array.from(playerPositions.values()),
          weather: currentWeather,
          timestamp: new Date(),
        },
      }));
    })
    .catch(() => {
      ws.send(JSON.stringify({
        type: 'WORLD_STATE',
        payload: {
          players: Array.from(playerPositions.values()),
          weather: { type: 'clear', intensity: 50, wind: 20 },
          timestamp: new Date(),
        },
      }));
    });
}

function handlePositionUpdate(connectionId, payload) {
  const { position, characterId, animMode, rotation } = payload;

  if (playerPositions.has(connectionId)) {
    const player = playerPositions.get(connectionId);
    player.position = position;
    if (animMode !== undefined) player.animMode = animMode;
    if (rotation !== undefined) player.rotation = rotation;
    player.lastUpdate = new Date();

    // Broadcast position to nearby players
    broadcastToAll({
      type: 'POSITION_UPDATE',
      payload: {
        characterId,
        position,
        animMode: animMode || null,
        rotation: rotation !== undefined ? rotation : null,
      },
    });
  }
}

function handleSkillCast(connectionId, payload) {
  const { characterId, skillId, targetPosition, skillEffect } = payload;

  broadcastToAll({
    type: 'SKILL_CAST',
    payload: {
      characterId,
      skillId,
      targetPosition,
      skillEffect,
      timestamp: new Date(),
    },
  });
}

function handleMonsterAttack(connectionId, payload) {
  const { monsterId, targetCharacterId, damage } = payload;

  broadcastToAll({
    type: 'MONSTER_ATTACK',
    payload: {
      monsterId,
      targetCharacterId,
      damage,
      timestamp: new Date(),
    },
  });
}

function handleVoiceCommand(connectionId, payload) {
  const { characterId, command, recognizedText } = payload;

  // Broadcast voice command to all players (for immersion)
  broadcastToAll({
    type: 'VOICE_COMMAND',
    payload: {
      characterId,
      command,
      recognizedText,
      timestamp: new Date(),
    },
  });

  // Check if it matches any skill trigger
  // This would call the skill detection API
}

function broadcastToAll(message) {
  const data = JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function broadcastToNearby(sourcePosition, range, message) {
  const data = JSON.stringify(message);
  let count = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // Calculate distance (simplified)
      const distance = calculateDistance(sourcePosition, { x: 0, y: 0, z: 0 });
      if (distance <= range) {
        client.send(data);
        count++;
      }
    }
  });

  return count;
}

function calculateDistance(pos1, pos2) {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ==================== 传送门WebSocket处理 ====================

/**
 * 处理传送门创建通知
 */
function handlePortalCreate(connectionId, payload) {
  const { portalId, name, sourcePosition, targetPosition, portalType } = payload;

  console.log(`🌀 传送门创建: ${name} (${portalType})`);

  // 广播传送门创建事件给所有玩家
  broadcastToAll({
    type: 'PORTAL_CREATED',
    payload: {
      portalId,
      name,
      sourcePosition,
      targetPosition,
      portalType,
      timestamp: new Date(),
    },
  });
}

/**
 * 处理传送门传送事件
 */
function handlePortalTeleport(connectionId, payload) {
  const { characterId, portalId, fromPosition, toPosition } = payload;

  console.log(`✨ 玩家传送: ${characterId} 通过传送门 ${portalId}`);

  // 更新玩家位置
  if (playerPositions.has(connectionId)) {
    const player = playerPositions.get(connectionId);
    player.position = toPosition;
    player.lastUpdate = new Date();
  }

  // 广播传送事件（其他玩家会看到传送特效）
  broadcastToAll({
    type: 'PORTAL_TELEPORT',
    payload: {
      characterId,
      portalId,
      fromPosition,
      toPosition,
      timestamp: new Date(),
    },
  });
}

/**
 * 处理请求传送门列表
 */
async function handleRequestPortals(connectionId, ws) {
  try {
    // 从数据库获取所有活跃的传送门
    const result = await query(
      `SELECT id, name, source_position, target_position, portal_type, 
              target_world_url, required_level, cooldown_seconds
       FROM portals 
       WHERE is_active = true 
       ORDER BY created_at DESC`
    );

    // 发送传送门列表给请求的客户端
    ws.send(JSON.stringify({
      type: 'PORTALS_LIST',
      payload: {
        portals: result.rows,
        timestamp: new Date(),
      },
    }));

    console.log(`📋 发送传送门列表: ${result.rows.length} 个传送门`);
  } catch (error) {
    console.error('❌ 获取传送门列表失败:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      payload: {
        message: '获取传送门列表失败',
        error: error.message,
      },
    }));
  }
}

// ==================== 传送门WebSocket处理结束 ====================

module.exports = {
  setupWebSocketServer,
  broadcastToAll,
  broadcastToNearby,
  getPlayerPositions: () => playerPositions,
};
