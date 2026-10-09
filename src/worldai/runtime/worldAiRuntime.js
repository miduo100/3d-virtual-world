/**
 * worldAiRuntime —— World AI 常驻状态机 + 熔断 + 调度（AI World Brain · Phase 2b · P1-7/8/9）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§I.2（Runtime 生命周期与崩溃恢复）+ §H.7（熔断默认参数）+ §C.3①（列已在 2a 迁移）。
 *
 * ★ 四条实现口径（照 §I.2 原文）：
 *   1) 状态只存 DB（world_ai_configs.runtime_state），内存不持有权威状态 —— 进程重启天然恢复；
 *   2) 熔断判定挂**真实轮次**（P1-9：优先在 missionRunner 上验）：连续 3 轮异常 →
 *      runtime_state='error' + enabled=false + 审计（§H.7 默认参数）；连续计数在内存、
 *      trip 状态在 DB（restart / 成功一轮都清零）；
 *   3) 调度不用 setInterval（项目教训：主线程繁忙时扎堆），用 setTimeout 链 + .unref()，
 *      每轮开头检查 runtime_state，非 running 自行断链；
 *   4) 单实例：start 用条件 UPDATE（WHERE runtime_state <> 'running'）防双开；MVP 单进程。
 *
 * 调度语义（2b 最小闭环，Phase 3/4 的 plan/step 恢复表尚未建）：
 *   每轮 = 取最旧一条 status='queued' 的建设委托跑 missionRunner.run。
 *   queued = 管理员显式批准自动执行（POST /missions/:id/queue），故不再叠加 autonomy 闸。
 *   崩溃恢复（mission 级等价）：init 时若 runtime_state='running'（上一进程遗留）→
 *   把孤儿 'running' 委托判 failed(interrupted_by_restart) + 重启定时器链续跑。
 *   ★ init() 只由 server 路由挂载点调用（worldAi.js）；验收脚本不得顺手调 init()
 *     （避免测试进程误伤服务器进程的在途委托），要测恢复语义请显式调 recover()。
 */
'use strict';

const { query } = require('../../database/db');
const worldAiConfig = require('../config');
const missionRunner = require('../missions/missionRunner');
const planRunner = require('../planning/planRunner'); // Phase 3：approved Plan 的步骤尝试（P2-6/7）
const logger = require('../../services/logger');

const STATES = ['stopped', 'running', 'paused', 'error'];
const BREAKER_THRESHOLD = 3;                                   // §H.7：连续 3 轮异常
const DEFAULT_INTERVAL_MS = 60 * 1000;
const MIN_INTERVAL_MS = 10 * 1000;
const MAX_INTERVAL_MS = 30 * 60 * 1000;

// ---- 内存态（均非权威：权威在 DB）----
let _timer = null;
let _inFlight = false;
let _consecutiveFailures = 0;
let _intervalMs = DEFAULT_INTERVAL_MS;
let _inited = false;
// 进程内 worldId 覆盖：非 server 进程（验收脚本）拿不到 federationSystem 内存态，
// worldai 配置会回落到 system_config 的占位 UUID（§3.1-3 老坑）——脚本必须显式指定。
let _worldIdOverride = null;

function clampInterval(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(n)));
}

async function readConfig() {
  return worldAiConfig.getConfig(_worldIdOverride || undefined);
}

async function setState(worldId, next, whereStates, extraError) {
  const params = [String(worldId), next];
  let sql = `UPDATE world_ai_configs SET runtime_state = $2::varchar, updated_at = now()`;
  if (extraError !== undefined) { params.push(extraError); sql += `, last_error = $${params.length}`; }
  sql += ` WHERE world_id = $1`;
  if (whereStates && whereStates.length) {
    params.push(whereStates);
    sql += ` AND runtime_state = ANY($${params.length}::varchar[])`;
  }
  sql += ` RETURNING runtime_state`;
  const r = await query(sql, params);
  return r.rows.length ? r.rows[0].runtime_state : null;
}

// ==================== 定时器链（setTimeout + unref，绝不用 setInterval）====================

function clearTimer() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

function startTimer() {
  clearTimer();
  _timer = setTimeout(onTimerTick, _intervalMs);
  if (_timer.unref) _timer.unref(); // 不阻止进程退出
}

async function onTimerTick() {
  _timer = null;
  try { await tick('timer'); } catch (e) { console.warn('[worldAiRuntime] 定时轮异常:', e.message); }
  // 链式续排：每轮 tick 开头已检查 runtime_state，非 running 的轮次自己 skip；这里按当前状态决定是否续排
  try {
    const cfg = await readConfig();
    if (cfg && cfg.runtime_state === 'running') startTimer();
  } catch (e) { /* 读不到配置就断链，安全侧 */ }
}

// ==================== 一轮（调度最小闭环）====================

/**
 * 跑一轮。@param source 'timer' | 'manual'
 * @param opts { injectPlan? } —— 与 missionRunner 同款演练口径（验收/欠费路径），仅手动轮允许
 * @returns {ok, action: 'idle'|'ran'|'skipped', reason?, missionId?, result?}
 */
async function tick(source, opts) {
  const o = opts || {};
  if (_inFlight) return { ok: false, code: 'TICK_IN_PROGRESS', reason: '上一轮还在执行（单飞保护）' };
  _inFlight = true;
  try {
    const cfg = await readConfig();
    if (!cfg) return { ok: false, code: 'NO_CONFIG', reason: 'world_ai_configs 无行' };
    // 记心跳（无论是否 skip，活着就要留痕）
    await query(`UPDATE world_ai_configs SET last_heartbeat_at = now() WHERE world_id = $1`, [String(cfg.world_id)]);
    // 读可调间隔（config.schedule.tick_interval_ms）
    const sched = (cfg.schedule && typeof cfg.schedule === 'object') ? cfg.schedule : {};
    _intervalMs = clampInterval(sched.tick_interval_ms);

    if (!cfg.enabled) return { ok: true, action: 'skipped', reason: '总闸 enabled=false（含熔断自动关闸）' };
    if (cfg.runtime_state !== 'running') return { ok: true, action: 'skipped', reason: 'runtime_state=' + cfg.runtime_state };

    // 取最旧一条排队委托（queued = 管理员显式批准自动执行）
    const q = await query(
      `SELECT id, region_key, title FROM world_build_missions
        WHERE world_id = $1 AND status = 'queued' ORDER BY created_at ASC LIMIT 1`,
      [String(cfg.world_id)]
    );
    if (!q.rows.length) {
      // 无排队委托 → 尝试推进已批准 Plan 的下一步（Phase 3；工具未注册会明确失败并记 memory，
      // 这是预期路径不计熔断——熔断是 LLM 委托轮次的闸，Phase 4 工具执行再纳入轮预算）
      const pa = await planRunner.attemptApprovedPlan(cfg.world_id)
        .catch((e) => ({ ok: false, action: 'plan_error', reason: String(e && e.message).slice(0, 200) }));
      if (pa.action && pa.action !== 'none') return { ok: true, action: pa.action, plan: pa };
      return { ok: true, action: 'idle', reason: '没有排队中的建设委托，也没有待执行的已批准规划' };
    }
    const m = q.rows[0];

    let r;
    try {
      r = await missionRunner.run(m.id, o.injectPlan ? { injectPlan: o.injectPlan } : {});
    } catch (e) {
      r = { ok: false, code: 'RUNNER_THREW', reason: String(e && e.message).slice(0, 300) };
    }

    if (r && r.ok) {
      _consecutiveFailures = 0;
      return { ok: true, action: 'ran', missionId: String(m.id), result: { status: r.status, stats: r.stats } };
    }

    _consecutiveFailures++;
    const reason = (r && (r.reason || r.code)) || 'unknown';
    logger.audit('world_ai_runtime_round_failed', {
      missionId: String(m.id), region: m.region_key, consecutive: _consecutiveFailures, reason: String(reason).slice(0, 200),
    });
    if (_consecutiveFailures >= BREAKER_THRESHOLD) {
      await trip(cfg.world_id, reason);
      return { ok: false, action: 'ran', missionId: String(m.id), code: 'BREAKER_TRIPPED',
        reason: '连续 ' + _consecutiveFailures + ' 轮异常，已熔断：runtime_state=error + enabled=false（§H.7）' };
    }
    return { ok: false, action: 'ran', missionId: String(m.id), code: (r && r.code) || 'ROUND_FAILED',
      reason: String(reason).slice(0, 300), consecutiveFailures: _consecutiveFailures };
  } finally {
    _inFlight = false;
  }
}

/** 熔断（§H.7）：error + 关总闸 + 审计。状态与"关闸"都落 DB，重启不会悄悄复活 */
async function trip(worldId, reason) {
  await query(
    `UPDATE world_ai_configs
        SET runtime_state = 'error', enabled = false,
            last_error = $2, updated_at = now()
      WHERE world_id = $1`,
    [String(worldId), ('连续 ' + BREAKER_THRESHOLD + ' 轮异常，已熔断：' + String(reason).slice(0, 260)).slice(0, 500)]
  );
  clearTimer();
  logger.audit('world_ai_runtime_breaker_tripped', { worldId: String(worldId), consecutive: _consecutiveFailures, reason: String(reason).slice(0, 200) });
  console.warn('[worldAiRuntime] 熔断触发：', String(reason).slice(0, 120));
}

// ==================== 状态机（P1-7 / P1-8）====================

/** Start（P1-8：enabled=false 拒绝；条件 UPDATE 防双开） */
async function start(opts) {
  const o = opts || {};
  if (Number(o.intervalMs) > 0) _intervalMs = clampInterval(o.intervalMs);
  const cfg = await readConfig();
  if (!cfg) return { ok: false, code: 'NO_CONFIG', reason: 'world_ai_configs 无行' };
  if (!cfg.enabled) {
    return { ok: false, code: 'RUNTIME_DISABLED',
      reason: 'World AI 总闸 enabled=false：先在后台打开总闸再 Start（P1-8；熔断后同样要人工重新开闸）' };
  }
  const prev = cfg.runtime_state;
  if (prev === 'running') return { ok: false, code: 'ALREADY_RUNNING', reason: 'Runtime 已在 running（条件 UPDATE 防双开）' };
  const now = await setState(cfg.world_id, 'running', STATES.filter((s) => s !== 'running'), null);
  if (!now) return { ok: false, code: 'TRANSITION_FAILED', reason: '状态写入失败（当前=' + prev + '）' };
  await query(`UPDATE world_ai_configs SET last_heartbeat_at = now() WHERE world_id = $1`, [String(cfg.world_id)]);
  startTimer();
  logger.audit('world_ai_runtime_started', { worldId: String(cfg.world_id), from: prev, intervalMs: _intervalMs });
  return { ok: true, state: 'running', from: prev, intervalMs: _intervalMs };
}

async function pause() {
  const cfg = await readConfig();
  const now = await setState(cfg.world_id, 'paused', ['running']);
  if (!now) return { ok: false, code: 'INVALID_TRANSITION', reason: '只有 running 可以 pause（当前=' + (cfg && cfg.runtime_state) + '）' };
  // 定时器链不拆：下一轮 tick 读到 paused 自行 skip（= 当前轮走完后停下一轮，§I.2 Pause 语义）
  logger.audit('world_ai_runtime_paused', { worldId: String(cfg.world_id) });
  return { ok: true, state: 'paused' };
}

async function resume() {
  const cfg = await readConfig();
  const now = await setState(cfg.world_id, 'running', ['paused']);
  if (!now) return { ok: false, code: 'INVALID_TRANSITION', reason: '只有 paused 可以 resume（当前=' + (cfg && cfg.runtime_state) + '）' };
  startTimer();
  logger.audit('world_ai_runtime_resumed', { worldId: String(cfg.world_id) });
  return { ok: true, state: 'running' };
}

async function stop() {
  const cfg = await readConfig();
  const now = await setState(cfg.world_id, 'stopped', ['running', 'paused', 'error']);
  clearTimer();
  if (now) logger.audit('world_ai_runtime_stopped', { worldId: String(cfg.world_id), from: now });
  return { ok: true, state: 'stopped', from: now || (cfg && cfg.runtime_state) };
}

/** Restart = Stop + 清内存态（熔断计数）+ Start（Start 闸门照走：enabled=false 时仍拒，P1-8） */
async function restart(opts) {
  await stop();
  _consecutiveFailures = 0; // 清熔断计数（§I.2 Restart 原文）
  return start(opts);
}

/** 手动触发一轮（调试用）。允许 running / paused（paused 下手动轮是显式调试动作）；必须总闸开着 */
async function tickNow(opts) {
  const cfg = await readConfig();
  if (!cfg) return { ok: false, code: 'NO_CONFIG', reason: 'world_ai_configs 无行' };
  if (!cfg.enabled) return { ok: false, code: 'RUNTIME_DISABLED', reason: '总闸 enabled=false（熔断后需人工开闸）' };
  if (cfg.runtime_state !== 'running' && cfg.runtime_state !== 'paused') {
    return { ok: false, code: 'NOT_TICKABLE', reason: 'runtime_state=' + cfg.runtime_state + '（只有 running/paused 可手动触发一轮）' };
  }
  return tick('manual', opts);
}

// ==================== 崩溃恢复 + 诊断 =====================

/**
 * 崩溃恢复（mission 级等价，2b 版）：上一进程遗留 runtime_state='running' 时
 * ①孤儿 running 委托判 failed(interrupted_by_restart)；②重启定时器链续跑。
 * 幂等：只有从 DB 读到 running 才动作；error/paused/stopped 一律不动（熔断不静默复活）。
 */
async function recover() {
  const cfg = await readConfig();
  if (!cfg) return { ok: false, code: 'NO_CONFIG' };
  if (cfg.runtime_state !== 'running') {
    return { ok: true, action: 'none', reason: 'runtime_state=' + cfg.runtime_state + '（无需恢复）' };
  }
  const orphan = await query(
    `UPDATE world_build_missions
        SET status = 'failed',
            executed_stats = COALESCE(executed_stats, '{}'::jsonb) || '{"error":"interrupted_by_restart"}'::jsonb
      WHERE world_id = $1 AND status = 'running'
      RETURNING id`,
    [String(cfg.world_id)]
  );
  startTimer();
  logger.audit('world_ai_runtime_recovered', { worldId: String(cfg.world_id), interruptedMissions: orphan.rows.map((r) => String(r.id)) });
  return { ok: true, action: 'recovered', interruptedMissions: orphan.rows.map((r) => String(r.id)), state: 'running' };
}

/** 进程启动初始化（由 worldAi.js 挂载点调用，server 路径专属）：崩溃恢复 + 幂等 */
function init() {
  if (_inited) return;
  _inited = true;
  recover().catch((e) => console.warn('[worldAiRuntime] 启动恢复失败（不影响服务器启动）:', e.message));
}

function getDiag() {
  return {
    timerActive: !!_timer,
    tickIntervalMs: _intervalMs,
    inFlight: _inFlight,
    consecutiveFailures: _consecutiveFailures,
    breakerThreshold: BREAKER_THRESHOLD,
  };
}

/** 完整状态（路由 GET /runtime 用） */
async function getStatus() {
  const cfg = await readConfig();
  return {
    worldId: cfg ? cfg.world_id : null,
    runtimeState: cfg ? cfg.runtime_state : null,
    enabled: cfg ? cfg.enabled : null,
    lastHeartbeatAt: cfg ? cfg.last_heartbeat_at : null,
    lastError: cfg ? cfg.last_error : null,
    diag: getDiag(),
  };
}

/** 验收/诊断用：进程内直接读连续失败计数（不落库，重启即清，与"trip 状态在 DB"口径一致） */
function peekConsecutiveFailures() { return _consecutiveFailures; }

module.exports = {
  STATES,
  BREAKER_THRESHOLD,
  useWorldId: function (id) { _worldIdOverride = id ? String(id) : null; },
  init,
  recover,
  start,
  pause,
  resume,
  stop,
  restart,
  tick,
  tickNow,
  getStatus,
  getDiag,
  peekConsecutiveFailures,
};
