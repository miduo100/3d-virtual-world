/**
 * AI Agent 接入 - 行动服务（P4 b/c）
 * 八动作：move/walk_to/follow/rotate/jump/say/interact/stop
 *  （2026-09-19 新增 `follow` 与 `stop`；`stop` = 缺陷 v2-4，用户决策 D1-A）
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
 *   - ACTION_COMPLETED { requestId, result } — 执行完成（rotate/jump 瞬时 / walk_to 到达 / say 已广播 /
 *     stop 停住并带 result.wasMoving）
 *   - ACTION_COMPLETED { requestId, reason } — 移动类被服务端补发的终态回执，
 *     reason ∈ arrived | superseded | stopped | target_lost | timeout | disconnected
 *   - ACTION_REJECTED { requestId, reason, code } — 校验失败
 */

const movement = require('./agentMovementService');
const followService = require('./agentFollowService');   // C：服务端持续跟随
const permissionService = require('./agentPermissionService');
// 红线禁止的动作清单（teleport/set_position/inventory/profile/shop）：
// #7 的未知动作判定必须**排除**它们，让它们继续走下面的 scope 校验报 scope_denied
// （"明确禁止"与"拼写错/不存在"是两种不同信号，不能合并成同一个 code）。
const { FORBIDDEN_SCOPES } = require('./agentSchema');
const tierService = require('./agentTierService');
const presenceBridge = require('./agentPresenceBridge');
const wsServer = require('../websocket/wsServer');
const chatLogService = require('./chatLogService');
const agentConfigService = require('./agentConfigService');

const SAY_MAX_LEN = 200;
const INTERACT_MAX_DISTANCE = 5;             // 互动距离上限 5m
const CHAT_NEARBY_RANGE = 30;

// 八动作白名单（#7 用）。契约同步处：capabilities.actions / openapi x-websocket.actions /
// openapi /action enum / public/llms.txt 的 "WS actions" 行 —— 改这里要同步那几处
// （scripts/accept_agent_discovery_layer.js 的 D6a 与 accept_agent_p6.js 的 P6/P7 会守住）。
const AGENT_ACTIONS = ['move', 'walk_to', 'follow', 'rotate', 'jump', 'say', 'interact', 'stop'];

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

  // 1.2) 未知动作（#7，AI 访客体检 [5-3]）：必须在 scope 校验**之前**判定。
  //   修复前：`fly_to_moon` 这类"不在 scope 集里"的动作先被 scope 校验拦下、报成
  //   `scope_denied`（"不在 Agent 权限集中"），而 AI 拼错动作名（如把 walk_to 写成 walkTo）
  //   会因此理解成"我没有这个权限"从而放弃，而实际只是拼写错；同一个协议里
  //   `observe`（恰好是合法 scope）却走到 switch default 得 unknown_action，两条口径不一致。
  //   现在：不在八动作白名单内、**且不是红线明令禁止的动作** → unknown_action（并回可用清单）；
  //   teleport/set_position/inventory/profile/shop 仍继续走下面的 scope 校验 → scope_denied
  //   （"明确禁止"与"拼写错/不存在"必须能区分：前者该放弃，后者该改拼写）。
  //   注：首版漏了这一步，把 teleport 也吃成了 unknown_action，被本脚本 #7c 判据当场抓到。
  if (!AGENT_ACTIONS.includes(action) && !FORBIDDEN_SCOPES.includes(action)) {
    return reject(requestId, 'unknown_action',
      `未知动作: ${action}；可用动作：${AGENT_ACTIONS.join(' / ')}`);
  }

  // 1.5) P8：tier 动作限频（游客拉模式；Key Agent 直接放行沿用既有令牌桶）
  const tier = ctx.tier || tierService.resolveTier(ctx.jwt, ctx.session);
  const rate = tierService.checkActionRate(tier, agent && agent.id, action);
  if (!rate.ok) {
    return reject(requestId, 'rate_limited', `动作过于频繁（${action} 限 ${rate.limit}）`);
  }

  // 2) scope 校验（红线2：FORBIDDEN_SCOPES 含 teleport/set_position）
  //    walk_to / follow / stop 视为 move 的子动作（共享 move scope，AGENT_SCOPES 无需改动）
  const scopeForAction = (action === 'walk_to' || action === 'follow' || action === 'stop')
    ? 'move' : action;
  if (!permissionService.isScopeAllowed(agent, scopeForAction)) {
    // 红线：teleport / set_position 永远不在 scope 中，这里直接 REJECTED
    return reject(requestId, 'scope_denied', `动作 ${action} 不在 Agent 权限集中`);
  }

  // 2.5) 移动类互斥（缺陷 C）：follow 与 move/walk_to/jump 互相打断
  //      —— 同一连接同一时刻只允许一个移动任务（follow 内部会取消既有移动任务与旧 follow）
  //      注意：`stop` **故意不列在此处** —— 它要取消 follow 并给旧指令发 reason='stopped'
  //      （如果在这里先 cancelFollow，旧 follow 会拿到 'superseded'，语义就不准了）。
  if (action === 'move' || action === 'walk_to' || action === 'jump') {
    followService.cancelFollow(connectionId, 'superseded');
  }

  // 3) 分发到具体动作处理器
  switch (action) {
    case 'move':       return handleMove(ctx, payload);
    case 'walk_to':    return handleWalkTo(ctx, payload);
    case 'follow':     return handleFollow(ctx, payload);
    case 'stop':       return handleStop(ctx, payload);
    case 'rotate':     return handleRotate(ctx, payload);
    case 'jump':       return handleJump(ctx, payload);
    case 'say':        return handleSay(ctx, payload);
    case 'interact':   return handleInteract(ctx, payload);
    default:
      return reject(requestId, 'unknown_action', `未知动作: ${action}`);
  }
}

// ==================== 八动作 ====================

/**
 * 新增动作 `stop`（缺陷 v2-4，用户决策 D1-A）
 *
 * 背景：`move` 是持续位移，此前没有干净的停法——客户端只能 ①observe 拿自己坐标再
 * `walk_to` 到自己（会触发一次 `arrived` 回执 + 0.5m 到达阈值），或 ②发另一条移动指令
 * 打断（那等于继续走）。LLM Agent 想"停下看看"会写出绕远路的指令（第一轮联调
 * "你在原地徘徊 / 做了无用的走动"的残留成因之一），`movementService.stopMove()` 曾是
 * 全项目零调用的死代码。
 *
 * 语义：立即终止该连接上的一切移动类任务（move / walk_to / follow），原地切 idle。
 *   - 被打断的那条指令 → `ACTION_COMPLETED { requestId, reason: 'stopped' }`
 *   - stop 自身       → `ACTION_COMPLETED { requestId, result: { wasMoving } }`
 *   - 幂等：无移动任务时也成功（`wasMoving:false`），不报错
 *
 * 契约细节（§9 坑 23）：一条移动任务只挂一个待回执指令，所以回执发的是**旧任务**的
 * requestId，stop 自己的回执单独回；若 walk_to 在 stop 之前已到达，其任务已被删除，
 * 那条 requestId 只会收到过一次 `arrived`，不会重复发。
 */
function handleStop(ctx, payload) {
  const { connectionId } = ctx;
  // 先取消 follow、再取消移动任务：两者各自给旧 requestId 补 reason='stopped'
  const followWasActive = followService.cancelFollow(connectionId, 'stopped');
  const move = movement.stopMove(connectionId, 'stopped');
  const wasMoving = Boolean((move && move.wasMoving) || followWasActive);
  return { completed: true, requestId: payload.requestId, result: { wasMoving } };
}

function handleMove(ctx, payload) {
  const { connectionId, agent, session } = ctx;
  const direction = payload.direction || payload.target;
  // v2-3：与 walk_to 一样注入回执发送器（移动类互斥契约 §5.2）——
  // 连续 move 没有"到达"事件，被新指令打断 / 断线时由 movement service 补发 ACTION_COMPLETED
  const result = movement.startMove(connectionId, agent, session, direction, {
    requestId: payload.requestId, reply: ctx.reply
  });
  if (!result.ok) return reject(payload.requestId, result.error, 'move 启动失败');
  return { accepted: true, requestId: payload.requestId };
}

function handleWalkTo(ctx, payload) {
  const { connectionId, agent, session } = ctx;
  const target = payload.target;
  // E：把回执发送器注入移动任务，到达/被打断时由 movement service 补发 ACTION_COMPLETED
  const result = movement.startWalkTo(connectionId, agent, session, target, {
    requestId: payload.requestId, reply: ctx.reply
  });
  if (!result.ok) return reject(payload.requestId, result.error, 'walk_to 启动失败');
  if (result.arrivedImmediately) {
    return { completed: true, requestId: payload.requestId, result: { arrived: true, reason: 'arrived' } };
  }
  return { accepted: true, requestId: payload.requestId, result: { estimatedMs: result.estimatedMs } };
}

/**
 * C：跟随（持续目标）——follow { targetId, stopDistance=2, maxDurationMs=60000 }
 * 服务端每 100ms 追一次目标；进入 stopDistance 内停住；目标消失/超时/被新指令打断即结束并回执。
 */
function handleFollow(ctx, payload) {
  const { connectionId, agent, session } = ctx;
  const targetId = payload.targetId || (payload.target && payload.target.id);
  // B：失败时必须能自诊断（回显 id + 附近候选），否则 AI 只能拿同一个错 id 反复重试
  if (!targetId) return rejectTarget(payload.requestId, ctx, 'follow', 'missing_targetId', null);
  const result = followService.startFollow(connectionId, agent, session, {
    targetId,
    stopDistance: payload.stopDistance,
    maxDurationMs: payload.maxDurationMs,
    requestId: payload.requestId,
    reply: ctx.reply
  });
  if (!result.ok) {
    if (result.error === 'target_not_found') {
      return rejectTarget(payload.requestId, ctx, 'follow', 'target_not_found', targetId);
    }
    return reject(payload.requestId, result.error, `follow 启动失败：${result.error}`);
  }
  return {
    accepted: true, requestId: payload.requestId,
    result: { targetId, targetName: result.targetName, stopDistance: result.stopDistance, maxDurationMs: result.maxDurationMs }
  };
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
  // v2-3：同上——jump 被打断/断线时补发 ACTION_COMPLETED（movement.jump 内部负责不覆盖旧 requestId）
  const result = movement.jump(connectionId, agent, session, {
    requestId: payload.requestId, reply: ctx.reply
  });
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
      // ② 名字牌（2026-09-24）：标明"这条是 AI 说的"。缺省（人类侧不发这个字段）按真人处理，
      // 故**不必改黑名单里的 wsServer.js**，向后兼容。用途：①来访 AI 认出对面是 AI 同伴，
      // 才能按 ai_talk_mode 决定怎么聊（用户要求：AI 之间也可以对话）②真人端/日志区分人机。
      senderType: 'agent',
      characterId: agent.id,
      message: text,
      position: myPos,                  // 关键：携带位置供 chatBubbles / Agent 距离过滤
      timestamp: new Date()
    }
  };
  // 2026-09-23（AI 访客实访暴露）：回执必须反映**真实收件人数**。
  // 原实现把 `delivered` 写死成 true，而它调用的 broadcastToNearby 本来就 return count
  // （只是被 agentWsServer 的 CHAT patch 吞掉过，已一并修好）——于是 AI 分不清
  // "有人听见"和"对着空气说话"：实测 AI 只能另开一个真实浏览器才能确认真人看没看见它。
  // recipients = 30m 内**实际收到**这条消息的连接数（真人 WS + 已订阅 chat 的别的 Agent，
  // 不含发送者自己）；recipients === 0 即"这句话没人/没有 Agent 听见"。
  const recipients = Number(wsServer.broadcastToNearby(myPos, CHAT_NEARBY_RANGE, chatMessage)) || 0;

  // 异步写入聊天记录（不阻塞，失败仅日志）
  chatLogService.insertLog({
    senderType: 'agent',
    senderId: agent.id,
    senderName: agent.name,
    message: text,
    position: myPos
  }).catch(() => {});

  return { completed: true, requestId: payload.requestId, result: { delivered: recipients > 0, recipients } };
}

function handleInteract(ctx, payload) {
  const { connectionId, agent, session } = ctx;
  const targetId = payload.targetId;
  if (!targetId) return rejectTarget(payload.requestId, ctx, 'interact', 'missing_targetId', null);

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
    return rejectTarget(payload.requestId, ctx, 'interact', 'target_not_found', targetId);
  }
  const dist = calcDist(myEntry.position, targetPos);
  if (dist > INTERACT_MAX_DISTANCE) {
    return reject(payload.requestId, 'too_far', `目标距离 ${dist.toFixed(1)}m，超出互动上限 ${INTERACT_MAX_DISTANCE}m`);
  }

  // 第一版：仅返回互动接受（具体互动语义由 P6 SDK 与具体场景定义）
  return { completed: true, requestId: payload.requestId, result: { targetId, distance: dist } };
}

// ==================== 工具 ====================

function reject(requestId, code, reason, extra) {
  // extra：B（2026-09-23）新增，用于把 targetId / candidates 一起回给 AI（可选自纠）。
  return { rejected: true, requestId, code, reason, ...(extra || {}) };
}

function calcDist(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a.x || 0) - (b.x || 0), dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * 附近实体候选（按水平距离升序，与 interact/observe 的判距同口径）。
 *
 * B（2026-09-23 AI 访客实访暴露）：AI 用 targetId 调 follow/interact 失败时，回执只有一句
 * "follow 启动失败"——既不回显它请求的 id，也不告诉它"附近有谁"，于是 AI 会拿同一个错 id
 * 反复重试。当场实测：世界里有**两个「米多」**，AI 凭聊天栏记忆拿了另一个的 id 去 follow。
 * 修好后 AI 一次就能换成对的 id，不必再把"人不在/我瞎了/id 错了"三种情况混在一起猜。
 */
function nearbyCandidates(connectionId, limit = 5) {
  const positions = wsServer.getPlayerPositions ? wsServer.getPlayerPositions() : null;
  if (!positions || !positions.forEach) return [];
  const me = positions.get(connectionId);
  const out = [];
  positions.forEach((p) => {
    if (!p || !p.position || !p.characterId) return;
    const d = me && me.position ? calcDist(me.position, p.position) : null;
    out.push({
      id: String(p.characterId),
      name: p.characterName || null,
      type: p.entityType === 'agent' ? 'agent' : 'human',
      distance: d === null ? null : Math.round(d * 10) / 10
    });
  });
  out.sort((a, b) => (a.distance === null ? Infinity : a.distance) - (b.distance === null ? Infinity : b.distance));
  return out.slice(0, limit);
}

/** 候选实体摘要（写进 reason：HTTP /api/agent/v1/action 与 WS ACTION_REJECTED 两条路都能看到） */
function describeCandidates(ctx) {
  const candidates = nearbyCandidates(ctx && ctx.connectionId);
  if (!candidates.length) {
    return { candidates, text: '附近没有任何实体（这里可能真的没人，或对方超出你的观察半径）' };
  }
  const text = candidates
    .map(c => `${c.name || '(无名)'} id=${c.id}${c.distance === null ? '' : ' ' + c.distance + 'm'}`)
    .join('；');
  return { candidates, text };
}

/** targetId 缺失/找不到时的统一回执：回显请求 id + 附近候选，让 AI 自己换 id 重试 */
function rejectTarget(requestId, ctx, action, code, targetId) {
  const hint = describeCandidates(ctx);
  const asked = targetId ? `你请求的 id=${targetId} ` : '';
  return reject(
    requestId, code,
    `${action} 失败：${asked}不在附近。实体 id 随会话变化，请用最近一次 observe 的 entities[].id 重发。附近实体：${hint.text}`,
    { targetId: targetId || null, candidates: hint.candidates }
  );
}

// ==================== 停止 / 取消（WS 断开时调用）====================

function cleanup(connectionId) {
  followService.cancelFollow(connectionId, 'disconnected');
  movement.cancelMovement(connectionId, 'disconnected');
}

module.exports = {
  dispatch,
  cleanup,
  SAY_MAX_LEN,
  INTERACT_MAX_DISTANCE
};
