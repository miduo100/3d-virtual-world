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

// ==================== 物理常量 ====================

const MAX_SPEED = 5;                         // 5 m/s（红线：服务端权威定速）
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
function startWalkTo(connectionId, agent, session, target) {
  // 校验目标
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) {
    return { ok: false, error: 'invalid_target' };
  }
  // 边界校验
  if (Math.abs(target.x) > WORLD_BOUNDARY || Math.abs(target.z) > WORLD_BOUNDARY) {
    return { ok: false, error: 'out_of_bounds' };
  }

  const cur = getCurrentPosition(session);
  const dx = target.x - cur.x;
  const dz = target.z - cur.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist <= ARRIVAL_THRESHOLD) {
    return { ok: true, arrivedImmediately: true, estimatedMs: 0 };
  }

  // 取消既有任务
  cancelMovement(connectionId);

  const groundY = cur.y || GROUND_Y_DEFAULT;
  const intervalId = setInterval(() => {
    tickWalkTo(connectionId, agent, session, target, groundY);
  }, TICK_INTERVAL_MS);
  if (intervalId.unref) intervalId.unref();

  activeMovements.set(connectionId, {
    agent, session,
    currentPos: { ...cur, y: groundY },
    currentYaw: cur.yaw || 0,
    mode: 'walk_to',
    target: { x: target.x, z: target.z, y: groundY },
    direction: null,
    jumping: false,
    jumpVel: 0,
    intervalId
  });

  const estimatedMs = Math.ceil((dist / MAX_SPEED) * 1000);
  return { ok: true, estimatedMs };
}

/**
 * 开始 move(direction) 连续移动（直到 stop / cancel / 断线）
 * @param direction { x, z } 归一化方向向量（Agent 责任归一化）
 */
function startMove(connectionId, agent, session, direction) {
  if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.z)) {
    return { ok: false, error: 'invalid_direction' };
  }
  // 归一化（防止 Agent 超速）
  const mag = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
  if (mag < 1e-6) return { ok: false, error: 'zero_direction' };
  const normDir = { x: direction.x / mag, z: direction.z / mag };

  cancelMovement(connectionId);

  const cur = getCurrentPosition(session);
  const groundY = cur.y || GROUND_Y_DEFAULT;
  const intervalId = setInterval(() => {
    tickMove(connectionId, agent, session, normDir, groundY);
  }, TICK_INTERVAL_MS);
  if (intervalId.unref) intervalId.unref();

  activeMovements.set(connectionId, {
    agent, session,
    currentPos: { ...cur, y: groundY },
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
 * 停止连续移动（move 模式专用，walk_to 自动到点停止）
 */
function stopMove(connectionId) {
  const task = activeMovements.get(connectionId);
  if (!task || task.mode !== 'move') return { ok: true, wasNotMoving: true };
  // 保留任务对象但停止推进（AnimMode=idle）
  clearInterval(task.intervalId);
  task.mode = 'idle';
  task.direction = null;
  // 派发一次位置 + idle 状态
  publishPosition(connectionId, task);
  // 释放任务表项（已 idle）
  activeMovements.delete(connectionId);
  return { ok: true };
}

/**
 * 设置朝向（rotate）
 */
function rotate(connectionId, agent, session, yaw) {
  if (!Number.isFinite(yaw)) return { ok: false, error: 'invalid_yaw' };
  let task = activeMovements.get(connectionId);
  if (!task) {
    const cur = getCurrentPosition(session);
    task = {
      agent, session,
      currentPos: { ...cur, y: cur.y || GROUND_Y_DEFAULT },
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
 */
function jump(connectionId, agent, session) {
  let task = activeMovements.get(connectionId);
  if (!task) {
    const cur = getCurrentPosition(session);
    task = {
      agent, session,
      currentPos: { ...cur, y: cur.y || GROUND_Y_DEFAULT },
      currentYaw: cur.yaw || 0,
      mode: 'idle',
      target: null, direction: null,
      jumping: false, jumpVel: 0,
      intervalId: null
    };
    activeMovements.set(connectionId, task);
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
function cancelMovement(connectionId) {
  const task = activeMovements.get(connectionId);
  if (!task) return;
  if (task.intervalId) { clearInterval(task.intervalId); task.intervalId = null; }
  activeMovements.delete(connectionId);
}

// ==================== 推进逻辑 ====================

function tickWalkTo(connectionId, agent, session, target, groundY) {
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
    // 到达：停 + animMode idle
    clearInterval(task.intervalId);
    task.intervalId = null;
    task.mode = 'idle';
    task.direction = null;
    publishPosition(connectionId, task, 'idle');
    activeMovements.delete(connectionId);
    return;
  }

  // 朝向目标
  task.currentYaw = Math.atan2(dx, dz);
  // 限速推进
  const step = MAX_SPEED * (TICK_INTERVAL_MS / 1000); // 0.5m/tick
  const ratio = Math.min(1, step / dist);
  task.currentPos.x += dx * ratio;
  task.currentPos.z += dz * ratio;
  // 边界 clamp
  task.currentPos.x = clampBoundary(task.currentPos.x);
  task.currentPos.z = clampBoundary(task.currentPos.z);
  task.currentPos.y = groundY;

  publishPosition(connectionId, task, 'walk');
}

function tickMove(connectionId, agent, session, normDir, groundY) {
  const task = activeMovements.get(connectionId);
  if (!task) return;

  if (task.jumping) {
    tickJump(connectionId);
    // 跳跃中同时推进水平（保持 jump 前的方向）
  }

  const step = MAX_SPEED * (TICK_INTERVAL_MS / 1000);
  task.currentPos.x = clampBoundary(task.currentPos.x + normDir.x * step);
  task.currentPos.z = clampBoundary(task.currentPos.z + normDir.z * step);
  task.currentPos.y = groundY;
  task.currentYaw = Math.atan2(normDir.x, normDir.z);

  publishPosition(connectionId, task, 'walk');
}

function tickJump(connectionId) {
  const task = activeMovements.get(connectionId);
  if (!task || !task.jumping) return;
  const groundY = task.currentPos.y; // 跳起前的地面 y
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
  presenceBridge.updatePosition(connectionId, { ...task.currentPos }, animMode, { yaw: task.currentYaw });
  // 同步位置到 session（断线重连时从该位置恢复）
  agentSessionManager.updatePosition(task.session.id, task.currentPos, task.session.isTransient).catch(() => {});
}

function getCurrentPosition(session) {
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
  WORLD_BOUNDARY,
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
