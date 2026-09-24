/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');
const voiceRelay = require('./voiceRelay');

let wss = null;

// In-memory player positions for real-time updates
const playerPositions = new Map();
const activeConnections = new Map();

// 未登记连接（断线重连但没重发 PLAYER_JOIN 的"幽灵"）告警去重时间戳
const ghostWarnAt = new Map();

/**
 * 连接已建立但服务器没有它的玩家登记（playerPositions）时的提示。
 * 这类连接发来的位置/模型更新会被静默忽略，对方就"永远看不到它移动"，
 * 排查时极难发现，因此每 30s 打一次日志（前端 wsPresenceGuard 会自动重发
 * PLAYER_JOIN 根治该状态，这里只做可观测性兜底）。
 */
function warnUnregistered(connectionId, type) {
  const now = Date.now();
  const last = ghostWarnAt.get(connectionId) || 0;
  if (now - last < 30000) return;
  ghostWarnAt.set(connectionId, now);
  console.warn(`[WS] ${type} 来自未登记连接（该连接未发 PLAYER_JOIN），已忽略: ${connectionId}`);
}

/**
 * 设置 WebSocket 服务器，附加到现有的 HTTP server 上（共享端口）
 * @param {import('http').Server} httpServer - Express HTTP server 实例
 */
function setupWebSocketServer(httpServer) {
  try {
    // noServer 模式：upgrade 由 upgradeRouter 分发（/ws/agent→agent，其余→人类兜底）
    wss = new WebSocket.Server({ noServer: true });

    wss.on('connection', (ws) => {
      const connectionId = uuidv4();
      activeConnections.set(connectionId, ws);

      // 【内存治理】心跳探活标记（配合 setupWebSocketServer 末尾的全局 ping 定时器）
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

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
        ghostWarnAt.delete(connectionId);
        voiceRelay.handleDisconnect(connectionId);
        
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

    // 注入语音中继模块所需的内部引用（避免循环 require）
    voiceRelay.init({
      activeConnections,
      playerPositions,
      calculateDistance,
      broadcastToNearby,
    });
    voiceRelay.ensureDefaultConfig();

    // 【内存治理】心跳：每 30s ping 一次，两周期无 pong 判死并 terminate。
    // 移动网络半开连接/杀进程等场景不会触发 'close'，playerPositions 中的
    // 僵尸玩家会永久驻留并持续进入新玩家的 WORLD_STATE。terminate 会触发
    // 'close'，接上既有的保存位置/清理/PLAYER_LEFT 广播逻辑。
    const hbTimer = setInterval(() => {
      wss.clients.forEach((client) => {
        if (client.isAlive === false) { client.terminate(); return; }
        client.isAlive = false;
        try { client.ping(); } catch (e) {}
      });
    }, 30000);
    if (hbTimer.unref) hbTimer.unref();
    wss.on('close', () => clearInterval(hbTimer));

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

    case 'PING':
      // 客户端应用层探活（public/js/wsPresenceGuard.js）：立刻回 PONG。
      // 半开连接（TCP 已死但 onclose 不触发）时客户端收不到 PONG，
      // 据此判定链路失效并强制重连——协议层 ping/pong 在浏览器端没有 JS 事件。
      try { ws.send(JSON.stringify({ type: 'PONG', payload: { t: Date.now() } })); } catch (e) {}
      break;

    case 'VOICE_START':
      voiceRelay.handleVoiceStart(connectionId, ws);
      break;

    case 'VOICE_PROBE':
      voiceRelay.handleVoiceProbe(connectionId, ws);
      break;

    case 'VOICE_END':
      voiceRelay.handleVoiceEnd(connectionId, ws);
      break;

    case 'VOICE_MESSAGE':
      voiceRelay.handleVoiceMessage(connectionId, ws, payload);
      break;

    case 'CHAT': {
      // 附近聊天：30m 内玩家可见，带服务端权威 characterId 供头顶气泡定位
      const sender = playerPositions.get(connectionId);
      const text = String(payload.message || '').slice(0, 200).trim();
      if (!text) break;
      const chatMessage = {
        type: 'CHAT',
        payload: {
          sender: (sender && sender.characterName) || payload.sender || '未知',
          characterId: (sender && sender.characterId) || null,
          message: text,
          position: sender ? sender.position : null,   // P4：携带位置供 Agent 距离过滤
          timestamp: new Date(),
        },
      };
      // P4：异步写入聊天记录（不阻塞广播，失败仅日志，chat_log_enabled=false 时跳过）
      const _senderRef = sender;
      const _msgRef = text;
      Promise.resolve().then(() => {
        try {
          const chatLogService = require('../agent/chatLogService');
          return chatLogService.insertLog({
            senderType: 'human',
            senderId: _senderRef && _senderRef.characterId,
            senderName: _senderRef && _senderRef.characterName,
            message: _msgRef,
            position: _senderRef && _senderRef.position
          });
        } catch (e) { /* non-fatal */ }
      }).catch(() => {});
      if (sender && sender.position) {
        // 必须经 module.exports 调用：CHAT 旁路 patch（agentWsServer）替换的是导出属性，
        // 裸调用内部函数会绕过 patch，导致人类消息永远转发不到 Agent
        module.exports.broadcastToNearby(sender.position, 30, chatMessage);
      } else {
        module.exports.broadcastToAll(chatMessage);
      }
      break;
    }

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
  } else {
    warnUnregistered(connectionId, 'MODEL_UPDATE');
    return;
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

  // 同一角色的旧连接残留（断线重连/半开连接被心跳清理前）：若旧连接已死则清掉，
  // 否则 WORLD_STATE 里同一角色会出现两条记录——新加入者会先按旧条建角色、
  // 再被旧条的位置覆盖，出现"复活在旧坐标 / 位置反复回跳"。
  playerPositions.forEach((p, cid) => {
    if (cid === connectionId || !p || p.characterId !== characterId) return;
    const old = activeConnections.get(cid);
    if (!old || old.readyState !== WebSocket.OPEN) {
      playerPositions.delete(cid);
      ghostWarnAt.delete(cid);
      console.log(`♻️ 清理角色 ${characterId} 的旧连接残留: ${cid}`);
    }
  });

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
    .then(async weatherResult => {
      let currentWeather = { type: 'clear', intensity: 50, wind: 20, auto_cycle: false, cycle_interval: 30 };
      if (weatherResult.rows.length > 0) {
        try { currentWeather = JSON.parse(weatherResult.rows[0].config_value); } catch(e) {}
      }
      // 内联当前选中的自定义天空（新进玩家与在线玩家看到一致的天空）
      try {
        const { resolveSky } = require('../routes/sky');
        currentWeather.sky = await resolveSky(currentWeather);
      } catch(e) {}
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

  if (!playerPositions.has(connectionId)) {
    // 断线重连后没重发 PLAYER_JOIN 的连接会一直走到这里：此前是静默丢弃，
    // 表现为"对方完全看不到我移动"，而前端毫无提示（前端已加 wsPresenceGuard 自愈）
    warnUnregistered(connectionId, 'POSITION_UPDATE');
    return;
  }

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

function broadcastToNearby(sourcePosition, range, message, excludeConnectionId = null) {
  const data = JSON.stringify(message);
  let count = 0;

  // 按玩家真实位置计算距离（playerPositions 由 PLAYER_JOIN / POSITION_UPDATE 维护）
  playerPositions.forEach((player, connectionId) => {
    if (excludeConnectionId && connectionId === excludeConnectionId) return;
    if (!player || !player.position) return;
    const distance = calculateDistance(sourcePosition, player.position);
    if (distance <= range) {
      const client = activeConnections.get(connectionId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(data);
        count++;
      }
    }
  });

  return count;
}

/**
 * 距离口径：**水平距离（2D，忽略 y）**。2026-09-23 由 3D 改为 2D，理由：
 *   Agent 的 y 是服务端的**平面估算**（`agentMovementService.GROUND_Y_DEFAULT = 0`，
 *   真实渲染高度由客户端贴地决定），拿它参与 3D 必然算错 —— 本世界地面 y≈0、出生点却
 *   是 9.6m 高的孤立台，AI 站在台面上（服务端 y=0）、真人在台面上，3D 距离凭空多出 9.6m，
 *   say 的 30m 半径实际只剩 28.4m（实测）。
 *   而 Agent 侧所有判定（observe 半径 / follow 停靠 / interact 5m / Agent 间 CHAT 转发）
 *   本来就是 2D —— 这里统一为 2D，让"AI 的距离观"与"服务端判据"一致。
 * 代价：人类聊天与语音也变水平距离 → 楼上楼下会互通（本世界地形平坦，实测影响≈0）。
 */
function calculateDistance(pos1, pos2) {
  const dx = pos1.x - pos2.x;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dz * dz);
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
  getWss: () => wss,                     // P3：noServer 模式下供 upgradeRouter 调 wss.handleUpgrade
};
