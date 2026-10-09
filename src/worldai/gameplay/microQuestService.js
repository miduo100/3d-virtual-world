/**
 * microQuestService —— 极简引导任务（Phase 3.5-2 建立；Phase 6 起为 taskService 的兼容门面）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ Phase 6：任务系统收敛到 taskService（6 种 objective + 状态机 + 幂等结算）。
 *   本文件保留 3.5 的函数签名与返回形状（progressed[]），内部全部委托 taskService
 *   —— **不允许两套任务系统**（§F 冲突清单红线）。createForRegion 的任务形状不变
 *   （agent_only + reach_region/object_interact），但推进/结算走 Phase 6 引擎。
 */
'use strict';

const { query } = require('../../database/db');
const taskService = require('./taskService');

function bad(code, reason) { return { ok: false, code, reason }; }

/** 为区域建一条引导任务（幂等：同 region+title 已有则直接返回）—— 3.5 原样保留 */
async function createForRegion(o) {
  const p = o || {};
  if (!p.regionKey) return bad('REGION_REQUIRED', '必须给 regionKey');
  const title = String(p.title || ('到' + p.regionKey + '采集 3 次'));
  const exist = await query(`SELECT * FROM world_tasks WHERE region_key = $1 AND title = $2 LIMIT 1`, [String(p.regionKey), title]);
  if (exist.rows.length) return { ok: true, task: exist.rows[0], existed: true };
  const objectives = [{
    type: 'reach_region', regionKey: String(p.regionKey), count: 1,
  }, {
    type: 'object_interact', key: String(p.interactionKey || 'reward_grant:mint'), count: Number(p.count) || 3,
  }];
  const res = await query(
    `INSERT INTO world_tasks (world_id, title, description, type, objectives, region_key, status, visibility, reward, origin)
     VALUES ($1,$2,$3,'side',$4,$5,'active','agent_only',$6,'ai') RETURNING *`,
    [String(p.worldId || ''), title, p.description || '（一期仅 AI 游客可完成；真人交互 UI 见 Phase 6）',
      JSON.stringify(objectives), String(p.regionKey), JSON.stringify(p.reward || { type: 'reward_codes', count: 1 })]
  );
  return { ok: true, task: res.rows[0], existed: false };
}

/** 把 taskService 的 results 映射回 3.5 的 progressed 形状（Agent 回复形状零变化） */
function toProgressed(results, fallbackType) {
  return (results || []).map((r) => ({
    taskId: r.taskId, title: r.title, type: fallbackType, done: !!r.done, state: r.state,
  }));
}

/** 推进某Actor 的任务进度（3.5 签名；委托 Phase 6 事件驱动引擎） */
async function advance(o) {
  const p = o || {};
  if (!p.actorId) return bad('ACTOR_REQUIRED', '缺少 actorId');
  const r = await taskService.onInteract({ actorType: p.actorType, actorId: p.actorId });
  if (!r.ok) return r;
  return { ok: true, progressed: toProgressed(r.results, p.event === 'reach_region' ? 'reach_region' : 'object_interact') };
}

/** object_interact 事件入口（interactionService 调用）—— 先落 object_interact 事件再评估 */
async function advanceObjectInteract(o) {
  const p = o || {};
  if (!p.actorId) return bad('ACTOR_REQUIRED', '缺少 actorId');
  try {
    // ★ 必须 await：评估按事件游标读库，事件未落库评估就读不到（首跑实测踩到）
    await require('../perception/eventLog').log({
      type: 'object_interact', actorType: p.actorType === 'human' ? 'human' : 'agent',
      actorId: String(p.actorId), targetId: p.interactionKey ? String(p.interactionKey) : null,
      payload: { interactionKey: String(p.interactionKey || '').slice(0, 60) },
    });
  } catch (e) { /* 埋点静默 */ }
  const r = await taskService.onInteract({ actorType: p.actorType, actorId: p.actorId });
  if (!r.ok) return r;
  return { ok: true, progressed: toProgressed(r.results, 'object_interact') };
}

/** reach_region 事件入口（保留 3.5 签名；Agent 区域事件已由 eventLog 埋点，这里直接评估） */
async function advanceReachRegion(o) {
  const p = o || {};
  if (!p.actorId) return bad('ACTOR_REQUIRED', '缺少 actorId');
  const r = await taskService.notifyRegionEnter({ actorType: p.actorType, actorId: p.actorId });
  if (!r.ok) return r;
  return { ok: true, progressed: toProgressed(r.results, 'reach_region') };
}

async function listTasks(worldId, regionKey) {
  const params = [String(worldId || '')];
  let sql = `SELECT * FROM world_tasks WHERE world_id = $1`;
  if (regionKey) { params.push(String(regionKey)); sql += ` AND region_key = $2`; }
  sql += ` ORDER BY created_at DESC LIMIT 50`;
  const res = await query(sql, params);
  return res.rows || [];
}

module.exports = { OBJECTIVES: taskService.OBJECTIVE_TYPES, createForRegion, advance, advanceObjectInteract, advanceReachRegion, listTasks };
