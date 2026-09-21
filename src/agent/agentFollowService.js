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
 *   - 速度由服务端定（后台 `agent_follow_speed`，默认 8 m/s，兜底 5），红线10"移动只能服务端定速度"；
 *   - 与 walk_to/move/jump **互斥**（同一连接同一时刻只允许一个移动任务，互相打断并补发回执）；
 *   - 跟随约束是「距离」而非「位置」（2026-09-20 用户口径）：离目标 stopDistance 米即可，方位随意、
 *     允许波动。目标点 = 目标沿「我当前所在方位」外推 stopDistance —— 与目标朝向**无关**，
 *     所以目标转身/转视角时目标点不动、移动方向稳定、不会绕圈（旧实现以"目标身后"为基准 → 追着绕 → 抖）。
 *     多跟随者按槽位在该方位上做常量小偏移，避免全部挤在同一点（缺陷 T9/v2-5：原实现实测间距 0.00m）。
 *   - 行为参数：
 *     ① 距离**死区**（stopDistance + INNER_SLACK 内完全不动）—— 目标主动靠近时不后退，也不走一步停一步；
 *     ② 速度曲线 + 加速度限制（越远越快、接近减速、起步渐快）—— 有反应时间，不急起急停；
 *     ③ 朝向 = **移动方向**（与真人一致："往前走的那个方向就是前"），限速平滑；停下保持朝向、不突然转身；
 *     ④ 目标短暂消失有宽限期（真人刷新页面/WS 重连不中断跟随）；
 *   - 结束一律补发 ACTION_COMPLETED（reason: arrived / target_lost / timeout / superseded / disconnected）。
 */

const presenceBridge = require('./agentPresenceBridge');
const agentSessionManager = require('./agentSessionManager');
const movement = require('./agentMovementService');
const agentConfigService = require('./agentConfigService');

/** 跟随速度上限（热路径：读 60s 缓存，不查库）；后台改 agent_follow_speed 后秒级生效 */
function getFollowSpeed() {
  try {
    const c = agentConfigService.peekConfig();
    if (c && Number.isFinite(c.followSpeed) && c.followSpeed > 0) return c.followSpeed;
  } catch (e) { /* 缓存未热：回落旧行为 */ }
  return DEFAULT_MAX_SPEED;
}

const TICK_MS = 100;                       // 10Hz 推进（与 movement 同口径）
// 【2026-09-20 联测 v2】跟随速度改为**后台可配** `agent_follow_speed`（1~20，默认 8）：
//   - 原实现写死 5 m/s（= movement.MAX_SPEED），也不受 agent_max_speed 影响，用户在世界里
//     实测"跟不上、太慢"，且改速度必须改代码重启 → 现改为每 tick 读 60s 缓存，后台改完秒级生效；
//   - 与 walk_to/move 的 agent_max_speed 解耦（跟随略慢于真人更自然，两者可分别调）；
//   - 缓存未热 / 读失败时回落 movement.MAX_SPEED（5 m/s），行为与旧版一致。
const DEFAULT_MAX_SPEED = movement.MAX_SPEED;   // 5 m/s 兜底（服务端权威）
const WORLD_BOUNDARY = movement.WORLD_BOUNDARY;
const GROUND_Y = movement.GROUND_Y_DEFAULT;
const DEFAULT_STOP_DISTANCE = 2;           // 默认停在 2m 内
const DEFAULT_MAX_DURATION_MS = 60000;     // 默认最长跟 60s
const MIN_STOP_DISTANCE = 0.5;
const MAX_STOP_DISTANCE = 20;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 600000;
// 【2026-09-20 语义修正 · 用户明确】跟随约束是「距离」而不是「位置」：
//   "它只要离我有 8 米就行了，不是一个固定的位置…哪怕这个范围有一点波动也没问题"
// 因此站位基准从"目标朝向的反方向（身后）"改为「我当前相对目标的方位」——
//   · 目标转身/转视角不再牵动站位点 → 移动方向稳定、不绕圈（旧实现是"哆嗦/左右摆"的根因）
//   · 单跟随者偏移恒为 0 → 目标点就在"我这一侧 8m 处"，直线走近即达，不需要绕到身后
//   · 多跟随者按槽位在该方位上做常量小偏移，避免全部挤在同一点（偏移恒定、不随时间绕）
// 另：缺陷 T9 的 `Math.min(RING_RADIUS=1.5, stopDistance)` 曾把任何 ≥1.5 的停靠距离压成 1.5m，已修。
const RING_SLOTS = 8;                      // 槽位数（多跟随者错开用）
const SLOT_SPREAD = Math.PI;               // 多跟随者展开扇区；单跟随者（slot=0）偏移为 0
const SLOT_ORDER = [0, 1, -1, 2, -2, 3, -3, 4];  // 槽位 → 展开序号（0 = 不偏移）
const YAW_TURN_RATE = Math.PI * 1.5;       // 朝向限速（270°/s）：朝向 = 移动方向，仅防极端瞬转
// ---- 速度 / 距离行为参数 ----
const INNER_SLACK = 1.5;                   // 距离死区（m）：与目标距离 ≤ stopDistance+该值 时完全不动（不后退）
const DIST_GAIN = 0.8;                     // 距离 → 期望速度 系数（越远越快，接近自动减速）
const ACCEL = 3.0;                         // 加速度（m/s²）：去掉急起急停
const MIN_MOVE_SPEED = 0.4;                // 期望速度低于此值直接停（防慢速"爬行抖动"）
// 目标短暂消失的宽限期：真人刷新页面 / WS 重连 / 心跳清理旧连接都会让 playerPositions 里的条目
// 消失几百毫秒~几秒。原实现当场 finish(target_lost)，长跟随（10 分钟）因此经常莫名中断。
// 宽限期内原地等待，目标回来（同 characterId 新连接）就继续跟；超时才真的判 target_lost。
const TARGET_LOST_GRACE_MS = 8000;
const IDLE_EPSILON = 0.25;                 // 到位判定（m）

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
    // 地面恒为 GROUND_Y（服务器无地形；也不继承可能被旧 jump 缺陷污染的 y）
    pos: self ? { x: self.position.x, y: GROUND_Y, z: self.position.z } : { x: 0, y: GROUND_Y, z: 0 },
    yaw: self ? self.yaw : 0,
    slot: assignSlot(agent && agent.id, targetId),   // T9：环形槽位（首个跟随者=正后方；多跟随者扇区错开）
    // 跟随运行状态：当前速度（做加速度限制，避免瞬时启停）/ 目标丢失计时（宽限期用）
    speed: 0,
    lostSince: null,
    startedAt: Date.now(),
    intervalId: null
  };
  task.intervalId = setInterval(() => tick(connectionId), TICK_MS);
  if (task.intervalId.unref) task.intervalId.unref();
  activeFollows.set(connectionId, task);
  return { ok: true, stopDistance, maxDurationMs, targetName: target.name, slot: task.slot };
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
  if (!target) {
    // 目标短暂消失（真人刷新页面 / WS 重连 / 心跳清旧连接）：宽限期内原地等待，回来就继续跟
    if (task.lostSince == null) task.lostSince = Date.now();
    if (Date.now() - task.lostSince > TARGET_LOST_GRACE_MS) { finish(connectionId, 'target_lost'); return; }
    task.speed = 0;
    publish(connectionId, task, 'idle');
    return;
  }
  task.lostSince = null;
  if (Date.now() - task.startedAt > task.maxDurationMs) { finish(connectionId, 'timeout'); return; }

  const dt = TICK_MS / 1000;

  // ① 与目标的实际距离（死区判定用：距离已在停靠范围内就完全不动）
  const toTargetX = target.position.x - task.pos.x;
  const toTargetZ = target.position.z - task.pos.z;
  const distToTarget = Math.sqrt(toTargetX * toTargetX + toTargetZ * toTargetZ);

  // ② 死区：距离已进入 stopDistance + INNER_SLACK 之内 → 原地不动。
  //    承担两件事：a) 目标主动走近时【不后退】（真人不会因为对方靠近就躲）；
  //    b) 取代硬到位判定 → 距离有弹性（用户："哪怕有一点波动也没问题"）。
  //    朝向保持上次值：真人停下不会突然转身，这里也不重算（旧实现在此"转脸看目标"→ 抽动来源之一）。
  if (distToTarget <= task.stopDistance + INNER_SLACK) {
    task.speed = 0;
    publish(connectionId, task, 'idle');
    return;
  }

  // ③ 目标点 = 目标沿「我当前所在方位」外推 stopDistance（不是"目标身后"！）
  //    【关键】该方位由"我相对目标的位置"决定，与目标朝向无关 —— 目标转身/转视角时
  //    目标点不动，所以移动方向稳定、不会绕圈。单跟随者偏移恒为 0，目标点就是我这一侧的 8m 点。
  const bearing = Math.atan2(task.pos.x - target.position.x, task.pos.z - target.position.z);
  const slotOrder = SLOT_ORDER[(task.slot || 0) % RING_SLOTS];
  const angle = bearing + slotOrder * (SLOT_SPREAD / RING_SLOTS);
  const goalX = target.position.x + Math.sin(angle) * task.stopDistance;
  const goalZ = target.position.z + Math.cos(angle) * task.stopDistance;

  const dx = goalX - task.pos.x;
  const dz = goalZ - task.pos.z;
  const distGoal = Math.sqrt(dx * dx + dz * dz);

  // ④ 速度曲线 + 加速度限制：越远越快、接近时自然减速，起步由慢到快（有"反应时间"的观感）
  const desired = Math.min(getFollowSpeed(), Math.max(distGoal - IDLE_EPSILON, 0) * DIST_GAIN);

  // 注意：这里必须判【期望速度】而不是【当前速度】——当前速度是从 0 逐步爬升的，
  // 用 current < MIN_MOVE_SPEED 会把刚开始加速的 tick 直接清零，导致速度永远爬不起来（跟不动）。
  if (desired < MIN_MOVE_SPEED || distGoal < 1e-4) {
    // 期望速度已小到无意义（快站到位了）：停住但保持任务存活，目标再动就继续跟
    task.speed = 0;
    publish(connectionId, task, 'idle');
    return;
  }
  task.speed = approach(task.speed, desired, ACCEL * dt);

  const ratio = Math.min(1, (task.speed * dt) / distGoal);
  task.pos.x = clampBoundary(task.pos.x + dx * ratio);
  task.pos.z = clampBoundary(task.pos.z + dz * ratio);

  // ⑤ 朝向 = 移动方向（与真人一致："往前走的那个方向就是前"），限速仅防极端瞬转。
  const wantYaw = Math.atan2(dx, dz);
  task.yaw = (task.yaw == null) ? wantYaw : turnToward(task.yaw, wantYaw, YAW_TURN_RATE * dt);
  publish(connectionId, task, 'walk');
}

/**
 * 分配环形槽位（T9）：以 agentId 哈希为起点，避开"同一目标上已被占用的槽位"。
 * 用哈希而非"加入顺序"是为了让同一 Agent 每次 follow 都落在同一侧（观感稳定），
 * 只有当哈希位被占时才顺延到下一个空位。
 */
function assignSlot(agentId, targetId) {
  const used = new Set();
  for (const [, t] of activeFollows.entries()) {
    if (t.targetId === targetId && Number.isInteger(t.slot)) used.add(t.slot);
  }
  // 首个跟随者固定用"正后方"槽位（SLOT_ORDER[0] 的偏移量为 0）——单个 AI 跟人时站正后方最自然；
  // 后续跟随者再按哈希取样并顺延到空位，保留"同一 Agent 每次都落同一侧"的稳定性。
  if (!used.has(0)) return 0;
  const base = hash32(String(agentId || '')) % RING_SLOTS;
  for (let i = 1; i < RING_SLOTS; i++) {
    const s = (base + i) % RING_SLOTS;
    if (!used.has(s)) return s;
  }
  return base;   // 槽位用尽（>8 个跟随者）：退回哈希位，允许重叠
}

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
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
  // baseY：跟随时恒为地面（客户端据此恢复垂直偏移；跟随本身不产生垂直位移，T2 口径统一）
  presenceBridge.updatePosition(connectionId, { ...task.pos }, animMode, { yaw: task.yaw }, GROUND_Y);
  // 同步到 session（断线/换连接重连续位，见 agentSessionManager.getLatestPosition）
  agentSessionManager.updatePosition(task.session.id, task.pos, task.session.isTransient).catch(() => {});
}

function notifyCompleted(task, reason) {
  if (!task || !task.reply) return;
  try { task.reply('ACTION_COMPLETED', { requestId: task.requestId, reason }); } catch (e) { /* ignore */ }
}

// ==================== 工具 ====================

/** 角度限速逼近（取最短转向、处理 ±π 环绕）—— 朝向平滑用 */
function turnToward(current, target, maxDelta) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** 以固定步长逼近目标值（模拟加减速，避免瞬时启停） */
function approach(current, target, step) {
  if (current < target) return Math.min(current + step, target);
  if (current > target) return Math.max(current - step, target);
  return target;
}

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
  MAX_SPEED: DEFAULT_MAX_SPEED,   // 兼容旧引用（值 = 兜底速度 5 m/s）
  DEFAULT_MAX_SPEED,
  getFollowSpeed,                 // 生效速度（后台 agent_follow_speed 可配）
  DEFAULT_STOP_DISTANCE,
  DEFAULT_MAX_DURATION_MS,
  startFollow,
  cancelFollow,
  getTask,
  getActiveCount
};
