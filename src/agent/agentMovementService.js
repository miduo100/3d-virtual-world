/**
 * AI Agent 接入 - 服务端权威移动（P4 a）
 * 红线：服务器无地面/碰撞数据 → 第一版只做平面地面 y + 边界 + 限速，不做地形贴合
 *
 * 职责：
 *   - walk_to(target)：服务端 5m/s 限速逐帧推进（10Hz setInterval），到达即停 + animMode=idle
 *   - move(direction)：连续位移（持续移动直到 Agent 发 stop 或断线），animMode=walk
 *   - rotate(yaw)：直接设置朝向
 *   - jump()：垂直方向瞬时给一个初速，受重力下落（落地后 animMode 恢复）
 *   - 边界 ±1000m，超出即 clamp
 *   - 平面地面 y：始终 y = spawnY（地面 y），不做地形贴合
 *   - animMode 派生：移动中 walk、停止 idle、跳跃中 jump
 *
 * 推进结果通过 presenceBridge.updatePosition 写入 playerPositions + 广播 POSITION_UPDATE
 * （复用人类侧广播管线，前端不认新类型）
 */

const presenceBridge = require('./agentPresenceBridge');
const agentSessionManager = require('./agentSessionManager');
const agentConfigService = require('./agentConfigService');

// ==================== 物理常量 ====================

const MAX_SPEED = 5;                         // 默认上限（红线：服务端权威定速）
// 缺陷 C 配套（2026-09-19 用户决策"速度应与真人一致"）：速度上限改为后台可配
// agent_max_speed（默认 9 m/s = 真人速度 player.js 0.15/帧 @60fps），热路径读 60s 缓存不查库。
function getMaxSpeed() {
  try {
    const c = agentConfigService.peekConfig();
    if (c && Number.isFinite(c.maxSpeed) && c.maxSpeed > 0) return c.maxSpeed;
  } catch (e) { /* 缓存未热时回落默认 */ }
  return MAX_SPEED;
}
const WORLD_BOUNDARY = 1000;                  // 世界边界 ±1000m（超出 clamp）
const TICK_INTERVAL_MS = 100;                 // 10Hz 推进
const JUMP_INITIAL_VELOCITY = 4;              // 跳跃初速 4 m/s
const GRAVITY = 9.8;                          // 重力 9.8 m/s²
const ARRIVAL_THRESHOLD = 0.5;                // 到达判定距离 0.5m
const GROUND_Y_DEFAULT = 0;                    // 默认地面 y=0

// ==================== 活跃移动任务表 ====================
// key: connectionId → { agent, session, currentPos, currentYaw, mode, target, direction, jumping, jumpVel, intervalId }

const activeMovements = new Map();

// ==================== 公开接口 ====================

/**
 * 开始 walk_to（走到目标点）
 * @param connectionId
 * @param agent      agents 行
 * @param session    agent_sessions 行
 * @param target     { x, z } 目标坐标
 * @returns { ok, error?, estimatedMs? }
 */
function startWalkTo(connectionId, agent, session, target, opts) {
  // 校验目标
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) {
    return { ok: false, error: 'invalid_target' };
  }
  // 边界校验
  if (Math.abs(target.x) > WORLD_BOUNDARY || Math.abs(target.z) > WORLD_BOUNDARY) {
    return { ok: false, error: 'out_of_bounds' };
  }

  // 取消既有任务（E：被打断的上一段 walk_to 会收到带 reason 的 ACTION_COMPLETED）
  cancelMovement(connectionId, 'superseded');

  const cur = getCurrentPosition(session, connectionId);
  const dx = target.x - cur.x;
  const dz = target.z - cur.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist <= ARRIVAL_THRESHOLD) {
    return { ok: true, arrivedImmediately: true, estimatedMs: 0 };
  }

  // 服务端地面恒为 GROUND_Y_DEFAULT（服务器无地形/碰撞数据，§9 坑 8）。
  // 缺陷 T2 配套：修复前这里继承 `cur.y`，而 tickJump 的落地判定把"上一 tick 的 y"当地面，
  // 跳跃后 y 会逐次上浮且永不回落（实测 0 → 1.02 → 2.04 累积）→ 继承过来就再也降不下去。
  const groundY = GROUND_Y_DEFAULT;
  const intervalId = setInterval(() => {
    tickWalkTo(connectionId, agent, session, target);
  }, TICK_INTERVAL_MS);
  if (intervalId.unref) intervalId.unref();

  activeMovements.set(connectionId, {
    agent, session,
    currentPos: { ...cur, y: groundY },
    groundY,                                   // T2：客户端据此恢复"垂直偏移"（跳跃可见）
    requestId: opts && opts.requestId,          // E：到达回执用
    reply: opts && opts.reply,                  // E：回执发送器（WS 层注入）
    currentYaw: cur.yaw || 0,
    mode: 'walk_to',
    target: { x: target.x, z: target.z, y: groundY },
    direction: null,
    jumping: false,
    jumpVel: 0,
    intervalId
  });

  const estimatedMs = Math.ceil((dist / getMaxSpeed()) * 1000);
  return { ok: true, estimatedMs };
}

/**
 * 开始 move(direction) 连续移动（直到被新指令打断 / 断线）
 * @param direction { x, z } 归一化方向向量（Agent 责任归一化）
 * @param opts      { requestId, reply } —— v2-3：移动类回执契约（§5.2），
 *                  被打断时补发 ACTION_COMPLETED{reason:'superseded'}、断线时 {reason:'disconnected'}
 */
function startMove(connectionId, agent, session, direction, opts) {
  if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.z)) {
    return { ok: false, error: 'invalid_direction' };
  }
  // 归一化（防止 Agent 超速）
  const mag = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
  if (mag < 1e-6) return { ok: false, error: 'zero_direction' };
  const normDir = { x: direction.x / mag, z: direction.z / mag };

  // v2-3：被这条新指令打断的旧移动任务，其 requestId 同样要收到 superseded 回执
  //（旧实现不传 reason → 'interrupted'，与契约 §5.2 的取值集合不符）
  cancelMovement(connectionId, 'superseded');

  const cur = getCurrentPosition(session, connectionId);
  const groundY = GROUND_Y_DEFAULT;             // 同 startWalkTo：服务端地面恒 0（不继承脏 y）
  const intervalId = setInterval(() => {
    tickMove(connectionId, agent, session, normDir);
  }, TICK_INTERVAL_MS);
  if (intervalId.unref) intervalId.unref();

  activeMovements.set(connectionId, {
    agent, session,
    currentPos: { ...cur, y: groundY },
    groundY,                                   // T2：客户端据此恢复"垂直偏移"（跳跃可见）
    requestId: opts && opts.requestId,          // v2-3：回执用（move 没有"到达"，只在被打断/断线时回执）
    reply: opts && opts.reply,
    currentYaw: cur.yaw || 0,
    mode: 'move',
    target: null,
    direction: normDir,
    jumping: false,
    jumpVel: 0,
    intervalId
  });

  return { ok: true };
}

/**
 * 判断任务是否处于"正在移动"状态（stop 的 wasMoving 判据）
 * 注意：`rotate` 也会留下一个 mode='idle' 的任务对象，它不是移动任务，不应算 moving。
 */
function isMovingTask(task) {
  if (!task) return false;
  if (task.jumping) return true;
  return task.mode === 'move' || task.mode === 'walk_to';
}

/**
 * 停止该连接上的一切移动任务（新增动作 `stop` 的落地实现，缺陷 v2-4）
 *
 * 用户决策 D1-A（2026-09-19）：新增 reason='stopped'。
 *
 * 修复前的问题：本函数只处理 `mode === 'move'`（对 walk_to / jump 无效），且**全项目零调用**；
 * 而 walk_to 最后一条广播是 animMode='walk'，被打断后不补 idle 广播 → 真人端会残留
 * "原地走路"姿态。现在统一为：
 *   清 interval → 摘任务 → 补一次 `idle` 广播（仅移动中才补）→ 给旧 requestId 补
 *   `ACTION_COMPLETED{reason:'stopped'}`。
 * 幂等：无任务（或任务处于 idle 且未跳跃，如 rotate 留下的对象）时返回 `wasMoving:false`，
 * 不广播、不回执。
 *
 * @param reason 传给旧指令的回执 reason，默认 'stopped'（断线清理路径由 cancelMovement 负责）
 */
function stopMove(connectionId, reason) {
  const task = activeMovements.get(connectionId);
  if (!task) return { ok: true, wasMoving: false };
  const wasMoving = isMovingTask(task);
  if (task.intervalId) { clearInterval(task.intervalId); task.intervalId = null; }
  activeMovements.delete(connectionId);
  if (wasMoving) {
    // 位置不变，只把 animMode 切回 idle —— 补广播，防真人端残留 walking 姿态
    publishPosition(connectionId, {
      ...task, mode: 'idle', direction: null, jumping: false, jumpVel: 0
    }, 'idle');
  }
  // 终态回执：walk_to 已到达时任务早已被删除，不会重复发 arrived
  if (task.requestId) notifyCompleted(task, reason || 'stopped');
  return { ok: true, wasMoving };
}

/**
 * 设置朝向（rotate）
 */
function rotate(connectionId, agent, session, yaw) {
  if (!Number.isFinite(yaw)) return { ok: false, error: 'invalid_yaw' };
  let task = activeMovements.get(connectionId);
  if (!task) {
    const cur = getCurrentPosition(session, connectionId);
    task = {
      agent, session,
      currentPos: { ...cur, y: GROUND_Y_DEFAULT },
      groundY: GROUND_Y_DEFAULT,               // T2：垂直偏移基准
      currentYaw: yaw,
      mode: 'idle',
      target: null, direction: null,
      jumping: false, jumpVel: 0,
      intervalId: null
    };
    activeMovements.set(connectionId, task);
  } else {
    task.currentYaw = yaw;
  }
  publishPosition(connectionId, task);
  return { ok: true };
}

/**
 * 跳跃（jump）：垂直方向瞬时给一个初速，重力下落
 * @param opts { requestId, reply } —— v2-3：被打断/断线时补发 ACTION_COMPLETED（契约 §5.2）
 *
 * 注意：jump 可能**复用**已存在的任务对象（例如正在连续 move 的那条）。
 * 复用时绝不覆盖 task 上已有的 requestId —— 那是上一个移动指令尚未发出的回执，
 * 覆盖会让旧指令永远收不到 superseded（v2-3 验收要求）。
 */
function jump(connectionId, agent, session, opts) {
  let task = activeMovements.get(connectionId);
  if (!task) {
    const cur = getCurrentPosition(session, connectionId);
    task = {
      agent, session,
      currentPos: { ...cur, y: GROUND_Y_DEFAULT },
      groundY: GROUND_Y_DEFAULT,               // T2：垂直偏移基准（跳跃的落地高度）
      requestId: opts && opts.requestId,
      reply: opts && opts.reply,
      currentYaw: cur.yaw || 0,
      mode: 'idle',
      target: null, direction: null,
      jumping: false, jumpVel: 0,
      intervalId: null
    };
    activeMovements.set(connectionId, task);
  } else if (!task.requestId && opts && opts.requestId) {
    // 复用既有任务（如 rotate 留下的 idle 任务）：没有待回执的旧指令，可以安全挂上本条
    task.requestId = opts.requestId;
    task.reply = opts.reply;
  }
  if (task.jumping) return { ok: false, error: 'already_jumping' };
  task.jumping = true;
  task.jumpVel = JUMP_INITIAL_VELOCITY;
  if (!task.intervalId) {
    task.intervalId = setInterval(() => tickJump(connectionId), TICK_INTERVAL_MS);
    if (task.intervalId.unref) task.intervalId.unref();
  }
  return { ok: true };
}

/**
 * 取消所有移动任务（Agent WS 断开时调用）
 */
function cancelMovement(connectionId, reason) {
  const task = activeMovements.get(connectionId);
  if (!task) return;
  if (task.intervalId) { clearInterval(task.intervalId); task.intervalId = null; }
  activeMovements.delete(connectionId);
  // E：被新指令打断 / 断线时补发 ACTION_COMPLETED（否则客户端只能靠轮询位置推断）
  if (task.requestId) notifyCompleted(task, reason || 'interrupted');
}

/**
 * 移动类完成回执（缺陷 E）
 * walk_to 的到达 / 被打断 / 超时都通过这里补发 ACTION_COMPLETED { requestId, reason }。
 * 旧客户端收到未知回执会忽略，向后兼容。
 */
function notifyCompleted(task, reason, extra) {
  if (!task || !task.reply) return;
  try { task.reply('ACTION_COMPLETED', Object.assign({ requestId: task.requestId, reason }, extra || {})); } catch (e) { /* ignore */ }
}

// ==================== 推进逻辑 ====================

/** 任务地面高度（T2：服务端地面恒为 GROUND_Y_DEFAULT，跳跃的落地基准） */
function taskGroundY(task) {
  return (task && Number.isFinite(task.groundY)) ? task.groundY : GROUND_Y_DEFAULT;
}

function tickWalkTo(connectionId, agent, session, target) {
  const task = activeMovements.get(connectionId);
  if (!task) return;

  // 跳跃中不推进水平移动（避免空中飞掠）
  if (task.jumping) {
    tickJump(connectionId);
    return;
  }

  const dx = target.x - task.currentPos.x;
  const dz = target.z - task.currentPos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist <= ARRIVAL_THRESHOLD) {
    // 到达：停 + animMode idle + 回执（E：reason='arrived'，客户端不必再轮询位置推断）
    clearInterval(task.intervalId);
    task.intervalId = null;
    task.mode = 'idle';
    task.direction = null;
    publishPosition(connectionId, task, 'idle');
    activeMovements.delete(connectionId);
    notifyCompleted(task, 'arrived', { position: { ...task.currentPos } });
    return;
  }

  // 朝向目标
  task.currentYaw = Math.atan2(dx, dz);
  // 限速推进
  const step = getMaxSpeed() * (TICK_INTERVAL_MS / 1000); // 默认 0.5m/tick（速度可配）
  const ratio = Math.min(1, step / dist);
  task.currentPos.x += dx * ratio;
  task.currentPos.z += dz * ratio;
  // 边界 clamp
  task.currentPos.x = clampBoundary(task.currentPos.x);
  task.currentPos.z = clampBoundary(task.currentPos.z);
  task.currentPos.y = taskGroundY(task);

  publishPosition(connectionId, task, 'walk');
}

function tickMove(connectionId, agent, session, normDir) {
  const task = activeMovements.get(connectionId);
  if (!task) return;

  if (task.jumping) {
    tickJump(connectionId);
    // 跳跃中同时推进水平（保持 jump 前的方向）
  }

  const step = getMaxSpeed() * (TICK_INTERVAL_MS / 1000);
  task.currentPos.x = clampBoundary(task.currentPos.x + normDir.x * step);
  task.currentPos.z = clampBoundary(task.currentPos.z + normDir.z * step);
  task.currentPos.y = taskGroundY(task);
  task.currentYaw = Math.atan2(normDir.x, normDir.z);

  publishPosition(connectionId, task, 'walk');
}

/**
 * 跳跃推进（抛物线）
 *
 * 缺陷 T2/S1 修复（2026-09-19）：原实现 `const groundY = task.currentPos.y` 把**上一 tick 的 y**
 * 当作地面，落地判定 `currentPos.y <= groundY` 于是在"刚过最高点的下一 tick"就成立
 * → 直接钉死在顶点、永远降不回地面，且每次跳跃把地面抬高约 1m
 * （实测 y 序列 0 → 0.4/0.702/0.906/1.012 → 钉在 1.02；再跳一次 1.02 → 钉在 2.04）。
 * 现在落地基准取 task.groundY（服务端地面恒 0），恢复真实抛物线。
 */
function tickJump(connectionId) {
  const task = activeMovements.get(connectionId);
  if (!task || !task.jumping) return;
  const groundY = taskGroundY(task);
  const dt = TICK_INTERVAL_MS / 1000;
  task.currentPos.y = (task.currentPos.y || groundY) + task.jumpVel * dt;
  task.jumpVel -= GRAVITY * dt;
  // 落地判定
  if (task.currentPos.y <= groundY) {
    task.currentPos.y = groundY;
    task.jumping = false;
    task.jumpVel = 0;
    // 跳跃结束后，若没有水平移动任务 → 清理 interval
    if (task.mode === 'idle' && !task.direction) {
      if (task.intervalId) { clearInterval(task.intervalId); task.intervalId = null; }
      activeMovements.delete(connectionId);
    }
  }
  publishPosition(connectionId, task, task.jumping ? 'jump' : (task.direction ? 'walk' : 'idle'));
}

// ==================== 工具 ====================

function publishPosition(connectionId, task, animModeOverride) {
  if (!task) return;
  const animMode = animModeOverride || (task.jumping ? 'jump' : (task.direction || task.mode === 'walk_to' ? 'walk' : 'idle'));
  // T2：把"服务端认定的地面高度"一起广播，客户端据此保留 (position.y - baseY) 这段垂直偏移，
  // 否则前端贴地逻辑会把服务器算出的跳跃抬升整个抹平（真人端看不到 AI 起跳）。
  presenceBridge.updatePosition(connectionId, { ...task.currentPos }, animMode, { yaw: task.currentYaw }, taskGroundY(task));
  // 同步位置到 session（断线重连时从该位置恢复）
  agentSessionManager.updatePosition(task.session.id, task.currentPos, task.session.isTransient).catch(() => {});
}

/**
 * 取"当前真实位置"（推进起点）
 *
 * ① playerPositions 实时条目（presenceBridge 每 tick 写入）——**权威**
 * ② session.current_position 兜底（无在线连接时，如跨世界传送刚恢复）
 *
 * 2026-09-19 联测实锤（缺陷 I）：旧实现只取 ②，而 session 行是 WS 连接时读入内存的快照，
 * 之后只在 DB 里更新、内存对象永不刷新 → 每发一条新移动指令，推进起点都会被重置回出生点，
 * Agent 位置出现"从出生点重新走向目标"的循环（实测周期 = 重发间隔 4s，`estimatedMs` 恒按
 * (0,0,0) 起算），真人观感正是"你在原地徘徊 / 不能跟着我走"。
 */
function getCurrentPosition(session, connectionId) {
  if (connectionId) {
    const live = presenceBridge.getEntry(connectionId);
    if (live) {
      return { x: live.position.x, y: live.position.y || GROUND_Y_DEFAULT, z: live.position.z, yaw: live.yaw || 0 };
    }
  }
  if (session && session.current_position) {
    const p = typeof session.current_position === 'string'
      ? safeParse(session.current_position) : session.current_position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      return { x: p.x, y: Number.isFinite(p.y) ? p.y : GROUND_Y_DEFAULT, z: p.z, yaw: p.yaw || 0 };
    }
  }
  return { x: 0, y: GROUND_Y_DEFAULT, z: 0, yaw: 0 };
}

function clampBoundary(v) {
  if (v > WORLD_BOUNDARY) return WORLD_BOUNDARY;
  if (v < -WORLD_BOUNDARY) return -WORLD_BOUNDARY;
  return v;
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

// ==================== 状态查询（诊断用）====================

function getActiveTaskCount() { return activeMovements.size; }
function getTask(connectionId) { return activeMovements.get(connectionId); }

module.exports = {
  MAX_SPEED,
  getMaxSpeed,
  WORLD_BOUNDARY,
  GROUND_Y_DEFAULT,
  TICK_INTERVAL_MS,
  startWalkTo,
  startMove,
  stopMove,
  rotate,
  jump,
  cancelMovement,
  getActiveTaskCount,
  getTask
};
