/**
 * scheduler —— 四类 tick 定时器链（AI World Brain · Phase 7 · §I.1 + 判据 P6-1）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§I.1 顶部那张图（tick_observe 10min / tick_plan 6h / tick_optimize 24h /
 *   tick_idle 30min / event_trigger）+ §I.6 开发注意事项第 1 条（setTimeout 链 + unref）。
 *
 * ★ 四条纪律：
 *   1) **四类 tick 各自独立开关与调频**：读 configs.schedule.<kind>.{enabled, interval_ms}；
 *      缺配置回落文档默认频率；`schedule.tick_interval_ms` 仍是 2b 的**建设委托轮**间隔，
 *      与本文件的四类互不干扰（Phase 2b 语义不许被破坏）。
 *   2) **绝不用 setInterval**（项目铁律：主线程/事件循环繁忙时 setInterval 会扎堆）；
 *      每类一条自己的 setTimeout 链 + .unref()，链首/链尾都查 runtime_state，非 running 自行断链。
 *   3) **单飞**：每类独立 in-flight 闸；慢一轮不会堆积（下一轮排在本轮末尾，不补跑）。
 *   4) **状态不在内存**：开关与频率每次从 DB 读（后台改配置下一轮即生效，重启不丢）。
 *
 * tick_idle 顺带承载 Phase 6 移交给本阶段的两件排队作业（§10.3 / §11.2）：
 *   ①world_tasks 到期（expires_at < now）自动回收为 expired；
 *   ②world_activities 的 scheduled_at 到点自动 announce → start（Phase 6 只有手动端点）。
 */
'use strict';

const worldAiConfig = require('../config');

const KINDS = ['observe', 'plan', 'optimize', 'idle'];
const DEFAULT_INTERVAL_MS = {
  observe: 10 * 60 * 1000,
  plan: 6 * 60 * 60 * 1000,
  optimize: 24 * 60 * 60 * 1000,
  idle: 30 * 60 * 1000,
};
const MIN_INTERVAL_MS = 60 * 1000;          // 1 分钟（再小就是忙轮，配置错误）
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

// 内存态：仅调度 bookkeeping，权威（enabled / runtime_state / schedule）在 DB
const state = {};
for (const k of KINDS) {
  state[k] = { timer: null, inFlight: false, lastRunAt: null, lastResult: null, nextAt: null, runs: 0 };
}
let _started = false;
let _worldIdOverride = null;

function clamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(n)));
}

/** 读某一类的开关与间隔（缺配置回落文档默认；后台改配置下一轮生效） */
function resolveKind(cfg, kind) {
  const sched = (cfg && typeof cfg.schedule === 'object' && cfg.schedule) ? cfg.schedule : {};
  const raw = (sched[kind] && typeof sched[kind] === 'object') ? sched[kind] : {};
  const enabled = raw.enabled === undefined ? true : raw.enabled !== false;
  const intervalMs = clamp(raw.interval_ms) || DEFAULT_INTERVAL_MS[kind];
  return { enabled, intervalMs };
}

async function readConfig() {
  return worldAiConfig.getConfig(_worldIdOverride || undefined);
}

/** 运行闸：总闸 + runtime_state（每轮都查，暂停/停止后链自己断） */
async function gate(cfg) {
  if (!cfg) return { ok: false, reason: 'world_ai_configs 无行' };
  if (!cfg.enabled) return { ok: false, reason: '总闸 enabled=false' };
  if (cfg.runtime_state !== 'running') return { ok: false, reason: 'runtime_state=' + cfg.runtime_state };
  return { ok: true };
}

// ────────────────────────────── tick 实现 ──────────────────────────────

/** observe：世界快照 + 日聚合重算（只读感知，不写世界） */
async function tickObserve(cfg) {
  const snapshotMod = require('../perception/worldSnapshot');
  const analytics = require('../perception/analytics');
  const worldId = String(cfg.world_id);
  const snap = await snapshotMod.build({ worldId, maxBytes: 6000 })
    .catch((e) => ({ ok: false, code: 'SNAPSHOT_FAILED', reason: String(e && e.message).slice(0, 200) }));
  const d = new Date();
  const today = d.toISOString().slice(0, 10);
  const yesterday = new Date(d.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const agg = await analytics.recomputeDaily(worldId, today)
    .catch((e) => ({ ok: false, code: 'AGG_FAILED', reason: String(e && e.message).slice(0, 200) }));
  const aggY = await analytics.recomputeDaily(worldId, yesterday).catch(() => null);
  const bytes = snap && snap.bytes ? snap.bytes : (snap && snap.snapshot ? String(snap.snapshot).length : 0);
  return {
    ok: true, action: 'observed', snapshotBytes: bytes, snapshotOk: !!(snap && snap.ok !== false),
    regions: (agg && agg.regions) || 0, recomputed: aggY ? [today, yesterday] : [today],
  };
}

/** plan：推进已批准 Plan（每 tick 最多一步，与 2b 的 tick 同一入口语义） */
async function tickPlan(cfg) {
  const planRunner = require('../planning/planRunner');
  const r = await planRunner.attemptApprovedPlan(String(cfg.world_id));
  return { ok: true, action: r.action || 'none', planId: r.planId || null, stepId: r.stepId || null };
}

/** optimize：5 条确定性规则 + 到期 A/B 判定（规则先行，LLM 解读默认关） */
async function tickOptimize(cfg) {
  const optimizer = require('../analytics/optimizer');
  return optimizer.runOptimizeCycle(String(cfg.world_id), { source: 'tick_optimize' });
}

/** idle：真人位置采样埋点 + 两件排队作业（任务到期回收 / 活动到点自动开跑） */
async function tickIdle(cfg) {
  const presence = require('../perception/presenceEmitter');
  const worldId = String(cfg.world_id);
  const sampled = await presence.sample(worldId)
    .catch((e) => ({ ok: false, code: 'PRESENCE_FAILED', reason: String(e && e.message).slice(0, 200) }));
  const house = await runHousekeeping(worldId);
  return {
    ok: true, action: 'idle_maintenance',
    presence: sampled && sampled.ok ? { players: sampled.players, entered: sampled.entered, dwellSec: sampled.dwellSec } : { ok: false },
    housekeeping: house,
  };
}

/**
 * 排队作业（Phase 6 移交）：任务到期回收 + 活动到点自动 announce/start。
 * 状态迁移全部走既有服务层（状态机唯一真源），本函数只负责「到点没有」这件事。
 */
async function runHousekeeping(worldId) {
  const out = { expiredTasks: 0, startedActivities: 0, errors: [] };
  try {
    const r = await require('../../database/db').query(
      `UPDATE world_tasks SET status='expired', updated_at=NOW()
        WHERE world_id=$1 AND status IN ('published','active') AND expires_at IS NOT NULL AND expires_at < NOW()
        RETURNING id`, [String(worldId)]);
    out.expiredTasks = r.rowCount || 0;
  } catch (e) { out.errors.push('expire_tasks:' + String(e && e.message).slice(0, 120)); }
  try {
    const activityService = require('../gameplay/activityService');
    const due = await require('../../database/db').query(
      `SELECT id FROM world_activities
        WHERE world_id=$1 AND status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()
        ORDER BY scheduled_at ASC LIMIT 5`, [String(worldId)]);
    for (const row of due.rows || []) {
      const ann = await activityService.announce(row.id);
      if (!ann.ok) { out.errors.push('announce:' + ann.code); continue; }
      const st = await activityService.start(row.id, { effectiveAutonomy: 'managed', approvedRisks: ['high'] });
      if (st.ok) out.startedActivities += 1;
      else out.errors.push('start:' + st.code);
    }
  } catch (e) { out.errors.push('activities:' + String(e && e.message).slice(0, 120)); }
  return out;
}

const HANDLERS = { observe: tickObserve, plan: tickPlan, optimize: tickOptimize, idle: tickIdle };

// ────────────────────────────── 定时器链 ──────────────────────────────

function clearTimer(kind) {
  const s = state[kind];
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  s.nextAt = null;
}

function scheduleNext(kind, intervalMs) {
  const s = state[kind];
  clearTimer(kind);
  s.timer = setTimeout(async () => {
    s.timer = null;
    await runOnce(kind, 'timer');
  }, intervalMs);
  if (s.timer.unref) s.timer.unref();
  s.nextAt = new Date(Date.now() + intervalMs).toISOString();
}

/** 跑一轮某一类 tick（定时 / 手动 / 事件触发同款）；返回 {ok, action, reason} */
async function runOnce(kind, source, opts) {
  const s = state[kind];
  if (KINDS.indexOf(kind) < 0) return { ok: false, code: 'KIND_UNKNOWN', reason: '未知 tick 类型：' + kind };
  if (s.inFlight) return { ok: false, action: 'skipped', code: 'IN_FLIGHT', reason: '上一轮 ' + kind + ' 还在执行（单飞）' };
  s.inFlight = true;
  let result;
  try {
    const cfg = await readConfig();
    const g = await gate(cfg);
    if (!g.ok) {
      result = { ok: true, action: 'skipped', reason: g.reason };
    } else {
      const conf = resolveKind(cfg, kind);
      if (!conf.enabled && source === 'timer') {
        result = { ok: true, action: 'skipped', reason: kind + ' tick 已关闭（configs.schedule.' + kind + '.enabled=false）' };
      } else {
        result = await HANDLERS[kind](cfg, opts || {});
      }
      // 链式续排：只有 running 才续（§I.2 Pause/Stop 语义 = 走完当前轮就停）
      const after = await readConfig().catch(() => null);
      if (after && after.enabled && after.runtime_state === 'running') {
        const conf2 = resolveKind(after, kind);
        if (conf2.enabled || source !== 'timer') scheduleNext(kind, conf2.intervalMs);
      }
    }
  } catch (e) {
    result = { ok: false, action: 'failed', code: 'TICK_THREW', reason: String(e && e.message).slice(0, 300) };
  } finally {
    s.inFlight = false;
    s.lastRunAt = new Date().toISOString();
    s.lastResult = result;
    s.runs += 1;
  }
  return result;
}

/** 启动四类链（幂等）；runtime 状态机 start / resume 时调用 */
async function start() {
  const cfg = await readConfig();
  if (!cfg) return { ok: false, code: 'NO_CONFIG' };
  _started = true;
  for (const kind of KINDS) {
    const conf = resolveKind(cfg, kind);
    if (conf.enabled) scheduleNext(kind, conf.intervalMs);
  }
  return { ok: true, started: KINDS.filter((k) => !!state[k].timer) };
}

/** 停掉全部链（runtime stop 时调用；状态机在 DB，这里只清计时器） */
function stop() {
  _started = false;
  for (const kind of KINDS) clearTimer(kind);
  return { ok: true };
}

/** 事件触发（§I.1 event_trigger）：立刻跑一轮，不改变频率设定 */
async function trigger(kind, reason) {
  return runOnce(kind, 'event', { reason: reason || null });
}

/** 后台面板与验收用：四类 tick 的当前配置与最近一轮结果 */
async function getStatus() {
  const cfg = await readConfig();
  const out = {
    started: _started,
    runtimeState: cfg ? cfg.runtime_state : null,
    enabled: cfg ? cfg.enabled : null,
    kinds: {},
  };
  for (const kind of KINDS) {
    const conf = resolveKind(cfg, kind);
    const s = state[kind];
    out.kinds[kind] = {
      enabled: conf.enabled, intervalMs: conf.intervalMs, timerActive: !!s.timer, inFlight: s.inFlight,
      lastRunAt: s.lastRunAt, lastResult: s.lastResult, nextAt: s.nextAt, runs: s.runs,
    };
  }
  return out;
}

module.exports = {
  KINDS, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS,
  start, stop, trigger, runOnce, getStatus, runHousekeeping, resolveKind,
  useWorldId: function (id) { _worldIdOverride = id ? String(id) : null; },
};