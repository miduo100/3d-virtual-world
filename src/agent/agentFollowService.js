/**
 * AI Agent 接入 - 跟随服务（第一轮联测缺陷 C，2026-09-19）
 *
 * 问题：此前只有一次性 walk_to，持续跟随必须客户端高频重发；而每次重发都会
 * cancelMovement + 重建推进任务（agentMovementService:65,68-83）→ 走走停停、
 * 位置与 DB 写放大（联测实测 6 分钟下发 220+ 条 walk_to）。
 *
 * 本模块提供**服务端持续跟随**：一个 follow 指令 = 给目标 id，服务端每 100ms 追一次，
 * 直到 目标消失 / 超时 / 被新指令打断。
 *
 * 契约要点：
 *   - 目标按 **id（characterId）** 定位，不用 name（第 5.4 节：同名是常态）；
 *   - 速度与服务端既有上限一致（movement.MAX_SPEED = 5 m/s），红线10"移动只能服务端定速度"；
 *   - 与 walk_to/move/jump **互斥**（同一连接同一时刻只允许一个移动任务，互相打断并补发回执）；
 *   - 进入 stopDistance 内停住（animMode=idle）但仍保持任务存活，目标一动就继续跟；
 *   - 结束一律补发 ACTION_COMPLETED（reason: arrived / target_lost / timeout / superseded / disconnected）。
 */

const presenceBridge = require('./agentPresenceBridge');
const agentSessionManager = require('./agentSessionManager');
const movement = require('./agentMovementService');

const TICK_MS = 100;                       // 10Hz 推进（与 movement 同口径）
const MAX_SPEED = movement.MAX_SPEED;      // 5 m/s（服务端权威）
const WORLD_BOUNDARY = movement.WORLD_BOUNDARY;
const DEFAULT_STOP_DISTANCE = 2;           // 默认停在 2m 内
const DEFAULT_MAX_DURATION_MS = 60000;     // 默认最长跟 60s
const MIN_STOP_DISTANCE = 0.5;
const MAX_STOP_DISTANCE = 20;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 600000;

// connectionId -> task
const activeFollows = new Map();

// ==================== 公开接口 ====================

/**
 * 开始跟随
 * @param opts { targetId, stopDistance?, maxDurationMs?, requestId?, reply? }
 * @returns { ok, error?, stopDistance?, maxDurationMs? }
 */
function startFollow(connectionId, agent, session, opts) {
  const targetId = opts && opts.targetId;
  if (!targetId) return { ok: false, error: 'missing_targetId' };

  const target = presenceBridge.findByCharacterId(targetId);
  if (!target) return { ok: false, error: 'target_not_found' };

  const stopDistance = clampNum(opts.stopDistance, DEFAULT_STOP_DISTANCE, MIN_STOP_DISTANCE, MAX_STOP_DISTANCE);
  const maxDurationMs = clampNum(opts.maxDurationMs, DEFAULT_MAX_DURATION_MS, MIN_DURATION_MS, MAX_DURATION_MS);

  // 互斥：跟随时取消既有移动任务（walk_to/move）与旧 follow
  // 回执 reason 统一用 superseded（被新指令打断），与 dispatcher 里 follow←walk_to 的方向一致
  movement.cancelMovement(connectionId, 'superseded');
  cancelFollow(connectionId, 'superseded');

  const self = presenceBridge.getEntry(connectionId);
  const task = {
    agent, session, targetId, stopDistance, maxDurationMs,
    requestId: opts.requestId, reply: opts.reply,
    pos: self ? { ...self.position } : { x: 0, y: 0, z: 0 },
    yaw: self ? self.yaw : 0,
    startedAt: Date.now(),
    intervalId: null
  };
  task.intervalId = setInterval(() => tick(connectionId), TICK_MS);
  if (task.intervalId.unref) task.intervalId.unref();
  activeFollows.set(connectionId, task);
  return { ok: true, stopDistance, maxDurationMs, targetName: target.name };
}

/**
 * 取消跟随并补发回执（被 move/walk_to/jump 打断、断线、被新 follow 替换时调用）
 */
function cancelFollow(connectionId, reason) {
  const task = activeFollows.get(connectionId);
  if (!task) return false;
  if (task.intervalId) { clearInterval(task.intervalId); task.intervalId = null; }
  activeFollows.delete(connectionId);
  // 被新 follow 顶替时无需回执（旧 requestId 的完成由调用方按 superseded 语义处理）
  if (task.requestId) notifyCompleted(task, reason || 'interrupted');
  return true;
}

function getTask(connectionId) { return activeFollows.get(connectionId); }
function getActiveCount() { return activeFollows.size; }

// ==================== 推进 ====================

function tick(connectionId) {
  const task = activeFollows.get(connectionId);
  if (!task) return;

  const target = presenceBridge.findByCharacterId(task.targetId);
  if (!target) { finish(connectionId, 'target_lost'); return; }
  if (Date.now() - task.startedAt > task.maxDurationMs) { finish(connectionId, 'timeout'); return; }

  const dx = target.position.x - task.pos.x;
  const dz = target.position.z - task.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist <= task.stopDistance) {
    // 已贴身：停住但保持任务存活（目标再动就继续跟）
    publish(connectionId, task, 'idle');
    return;
  }

  task.yaw = Math.atan2(dx, dz);
  const step = movement.getMaxSpeed() * (TICK_MS / 1000);
  const ratio = Math.min(1, step / dist);
  task.pos.x = clampBoundary(task.pos.x + dx * ratio);
  task.pos.z = clampBoundary(task.pos.z + dz * ratio);
  publish(connectionId, task, 'walk');
}

/** 正常结束（到达?否 / 目标消失 / 超时）：停住 + 回执 */
function finish(connectionId, reason) {
  const task = activeFollows.get(connectionId);
  if (!task) return;
  if (task.intervalId) { clearInterval(task.intervalId); task.intervalId = null; }
  activeFollows.delete(connectionId);
  publish(connectionId, task, 'idle');
  notifyCompleted(task, reason);
}

function publish(connectionId, task, animMode) {
  presenceBridge.updatePosition(connectionId, { ...task.pos }, animMode, { yaw: task.yaw });
  // 同步到 session（断线/换连接重连续位，见 agentSessionManager.getLatestPosition）
  agentSessionManager.updatePosition(task.session.id, task.pos, task.session.isTransient).catch(() => {});
}

function notifyCompleted(task, reason) {
  if (!task || !task.reply) return;
  try { task.reply('ACTION_COMPLETED', { requestId: task.requestId, reason }); } catch (e) { /* ignore */ }
}

// ==================== 工具 ====================

function clampBoundary(v) {
  if (v > WORLD_BOUNDARY) return WORLD_BOUNDARY;
  if (v < -WORLD_BOUNDARY) return -WORLD_BOUNDARY;
  return v;
}

function clampNum(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

module.exports = {
  TICK_MS,
  MAX_SPEED,
  DEFAULT_STOP_DISTANCE,
  DEFAULT_MAX_DURATION_MS,
  startFollow,
  cancelFollow,
  getTask,
  getActiveCount
};
