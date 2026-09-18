/**
 * AI Agent 接入 - 行动服务（P4 b/c）
 * 六动作：move/walk_to/rotate/jump/say/interact
 *
 * 红线2：scope 集合不含 teleport/set_position——收到即 REJECTED（不开发任何 teleport action）
 * 红线10：Agent 不允许 set_position 裸接口（移动只能 walk_to/rotate/jump，服务端定速度）
 *
 * 入口：
 *   - WS ACTION 消息（首选，agentWsServer 调用 dispatch）
 *   - HTTP POST /api/agent/v1/action（备用，action.js 路由调用 dispatch）
 *
 * 回执协议：
 *   - ACTION_ACCEPTED { requestId } — 已接收，正在执行（移动类）
 *   - ACTION_COMPLETED { requestId, result } — 执行完成（rotate/jump 瞬时 / walk_to 到达 / say 已广播）
 *   - ACTION_REJECTED { requestId, reason, code } — 校验失败
 */

const movement = require('./agentMovementService');
const permissionService = require('./agentPermissionService');
const tierService = require('./agentTierService');
const presenceBridge = require('./agentPresenceBridge');
const wsServer = require('../websocket/wsServer');
const chatLogService = require('./chatLogService');
const agentConfigService = require('./agentConfigService');

const SAY_MAX_LEN = 200;
const INTERACT_MAX_DISTANCE = 5;             // 互动距离上限 5m
const CHAT_NEARBY_RANGE = 30;

// ==================== 主分发入口 ====================

/**
 * 分发 ACTION 请求
 * @param ctx { connectionId, agent, session, agentWsState? } 上下文
 * @param payload { action, target?, yaw?, text?, targetId?, requestId }
 * @returns { accepted: bool, completed?: bool, result?, reason?, code? }
 */
async function dispatch(ctx, payload) {
  const { agent, session, connectionId } = ctx;
  const action = payload && payload.action;
  const requestId = payload && payload.requestId;

  // 1) action 字段校验
  if (!action || typeof action !== 'string') {
    return reject(requestId, 'missing_action', '缺少 action 字段');
  }

  // 1.5) P8：tier 动作限频（游客拉模式；Key Agent 直接放行沿用既有令牌桶）
  const tier = ctx.tier || tierService.resolveTier(ctx.jwt, ctx.session);
  const rate = tierService.checkActionRate(tier, agent && agent.id, action);
  if (!rate.ok) {
    return reject(requestId, 'rate_limited', `动作过于频繁（${action} 限 ${rate.limit}）`);
  }

  // 2) scope 校验（红线2：FORBIDDEN_SCOPES 含 teleport/set_position）
  //    walk_to 视为 move 的子动作（共享 move scope），故 walk_to 检查 move scope
  const scopeForAction = action === 'walk_to' ? 'move' : action;
  if (!permissionService.isScopeAllowed(agent, scopeForAction)) {
    // 红线：teleport / set_position 永远不在 scope 中，这里直接 REJECTED
    return reject(requestId, 'scope_denied', `动作 ${action} 不在 Agent 权限集中`);
  }

  // 3) 分发到具体动作处理器
  switch (action) {
    case 'move':       return handleMove(ctx, payload);
    case 'walk_to':    return handleWalkTo(ctx, payload);
    case 'rotate':     return handleRotate(ctx, payload);
    case 'jump':       return handleJump(ctx, payload);
    case 'say':        return handleSay(ctx, payload);
    case 'interact':   return handleInteract(ctx, payload);
    default:
      return reject(requestId, 'unknown_action', `未知动作: ${action}`);
  }
}

// ==================== 六动作 ====================

function handleMove(ctx, payload) {
  const { connectionId, agent, session } = ctx;
  const direction = payload.direction || payload.target;
  const result = movement.startMove(connectionId, agent, session, direction);
  if (!result.ok) return reject(payload.requestId, result.error, 'move 启动失败');
  return { accepted: true, requestId: payload.requestId };
}

function handleWalkTo(ctx, payload) {
  const { connectionId, agent, session } = ctx;
  const target = payload.target;
  const result = movement.startWalkTo(connectionId, agent, session, target);
  if (!result.ok) return reject(payload.requestId, result.error, 'walk_to 启动失败');
  if (result.arrivedImmediately) {
    return { completed: true, requestId: payload.requestId, result: { arrived: true } };
  }
  return { accepted: true, requestId: payload.requestId, result: { estimatedMs: result.estimatedMs } };
}

function handleRotate(ctx, payload) {
  const { connectionId, agent, session } = ctx;
  const yaw = Number(payload.yaw);
  if (!Number.isFinite(yaw)) return reject(payload.requestId, 'invalid_yaw', 'yaw 必须为数字');
  movement.rotate(connectionId, agent, session, yaw);
  return { completed: true, requestId: payload.requestId, result: { yaw } };
}

function handleJump(ctx, payload) {
  const { connectionId, agent, session } = ctx;
  const result = movement.jump(connectionId, agent, session);
  if (!result.ok) return reject(payload.requestId, result.error, 'jump 失败');
  return { accepted: true, requestId: payload.requestId };
}

async function handleSay(ctx, payload) {
  const { connectionId, agent, session } = ctx;
  const text = String(payload.text || payload.message || '').slice(0, SAY_MAX_LEN).trim();
  if (!text) return reject(payload.requestId, 'empty_message', '消息为空');

  // 取 Agent 当前位置（presenceBridge 已写入 playerPositions）
  const playerPositions = wsServer.getPlayerPositions();
  const myEntry = playerPositions.get(connectionId);
  const myPos = myEntry ? myEntry.position : null;
  if (!myPos) return reject(payload.requestId, 'no_position', '无法获取当前位置');

  // 走 CHAT 管线（30m 附近投递，与人类侧一致）
  const chatMessage = {
    type: 'CHAT',
    payload: {
      sender: agent.name,
      characterId: agent.id,
      message: text,
      position: myPos,                  // 关键：携带位置供 chatBubbles / Agent 距离过滤
      timestamp: new Date()
    }
  };
  wsServer.broadcastToNearby(myPos, CHAT_NEARBY_RANGE, chatMessage);

  // 异步写入聊天记录（不阻塞，失败仅日志）
  chatLogService.insertLog({
    senderType: 'agent',
    senderId: agent.id,
    senderName: agent.name,
    message: text,
    position: myPos
  }).catch(() => {});

  return { completed: true, requestId: payload.requestId, result: { delivered: true } };
}

function handleInteract(ctx, payload) {
  const { connectionId, agent, session } = ctx;
  const targetId = payload.targetId;
  if (!targetId) return reject(payload.requestId, 'missing_targetId', '缺少 targetId');

  // 距离校验：target 必须在 5m 内（用 playerPositions 找 target 的当前位置）
  const playerPositions = wsServer.getPlayerPositions();
  const myEntry = playerPositions.get(connectionId);
  if (!myEntry || !myEntry.position) {
    return reject(payload.requestId, 'no_position', '无法获取当前位置');
  }
  // 在 playerPositions 中查找 target
  let targetPos = null;
  playerPositions.forEach(p => {
    if (p.characterId === targetId) targetPos = p.position;
  });
  // TODO: 也可扩展到 objects 表的距离查询（worldSpatial /around 同口径）
  if (!targetPos) {
    return reject(payload.requestId, 'target_not_found', `目标 ${targetId} 不在附近`);
  }
  const dist = calcDist(myEntry.position, targetPos);
  if (dist > INTERACT_MAX_DISTANCE) {
    return reject(payload.requestId, 'too_far', `目标距离 ${dist.toFixed(1)}m，超出互动上限 ${INTERACT_MAX_DISTANCE}m`);
  }

  // 第一版：仅返回互动接受（具体互动语义由 P6 SDK 与具体场景定义）
  return { completed: true, requestId: payload.requestId, result: { targetId, distance: dist } };
}

// ==================== 工具 ====================

function reject(requestId, code, reason) {
  return { rejected: true, requestId, code, reason };
}

function calcDist(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a.x || 0) - (b.x || 0), dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dz * dz);
}

// ==================== 停止 / 取消（WS 断开时调用）====================

function cleanup(connectionId) {
  movement.cancelMovement(connectionId);
}

module.exports = {
  dispatch,
  cleanup,
  SAY_MAX_LEN,
  INTERACT_MAX_DISTANCE
};
