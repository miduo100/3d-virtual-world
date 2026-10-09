/**
 * taskService —— 任务系统（AI World Brain · Phase 6 · 分册 §10.1~§10.5）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ Phase 6 的任务系统 = **扩展** microQuestService（3.5 种子），不另起炉灶：
 *   microQuestService.advance* 已改为委托本模块（无两套任务系统，§F 冲突清单红线）。
 * 状态机（§10.3）：draft → published →(首个 actor claim)→ active → completed/abandoned/expired；
 *   repeatable 且未达 max_completions → 回 published。cancel → cancelled。
 * 推进：objectives 有序数组逐个完成（objective_index 游标）；事件驱动
 *   （notifyRegionEnter / notifyChat / onInteract → evaluateForActor → objectiveEvaluator），零 LLM。
 * 结算幂等：world_task_progress.reward_granted + rewardService.grantToActor 的 UNIQUE 双保险。
 */
'use strict';

const { query } = require('../../database/db');
const evaluator = require('./objectiveEvaluator');
const eventLog = require('../perception/eventLog');

function bad(code, reason) { return { ok: false, code, reason }; }

/** 目标白名单（§10.2 六种） */
const OBJECTIVE_TYPES = ['reach_region', 'reach_position', 'talk_to', 'object_interact', 'object_exists', 'chat_contains'];

/** 校验 objectives（工具层与 createTask 共用） */
function validateObjectives(objectives) {
  if (!Array.isArray(objectives) || !objectives.length) return { ok: false, reason: 'objectives 必须是非空数组' };
  if (objectives.length > 5) return { ok: false, reason: '目标数 ≤ 5（AI 生成任务的硬约束，§10.4）' };
  for (const obj of objectives) {
    if (!obj || OBJECTIVE_TYPES.indexOf(obj.type) < 0) {
      return { ok: false, reason: '未知 objective 类型：' + String(obj && obj.type) + '（白名单：' + OBJECTIVE_TYPES.join('/') + '）' };
    }
  }
  return { ok: true };
}

/** 创建任务（create_task / create_quest 工具共用核心） */
async function createTask(o) {
  const p = o || {};
  if (!p.title) return bad('TITLE_REQUIRED', '必须给 title');
  const v = validateObjectives(p.objectives);
  if (!v.ok) return bad('OBJECTIVES_INVALID', v.reason);
  const ins = await query(
    `INSERT INTO world_tasks
       (world_id, title, description, type, objectives, region_key, entity_id,
        giver_type, giver_id, status, visibility, repeatable, max_completions,
        reward, conditions, origin, plan_step_id, expires_at, source_template, gameplay_def)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'published',$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19)
     RETURNING *`,
    [String(p.worldId || ''), String(p.title).slice(0, 200), p.description ? String(p.description).slice(0, 1000) : null,
      p.questType === 'main' ? 'main' : 'side', JSON.stringify(p.objectives),
      p.regionKey ? String(p.regionKey) : null, p.entityId ? String(p.entityId) : null,
      p.giverType ? String(p.giverType) : null, p.giverId ? String(p.giverId) : null,
      p.visibility === 'public' || p.visibility === 'human_only' || p.visibility === 'agent_only' ? p.visibility : 'agent_only',
      p.repeatable === true, Number.isInteger(Number(p.maxCompletions)) ? Number(p.maxCompletions) : null,
      JSON.stringify(p.reward || { type: 'reward_codes', count: 1 }),
      JSON.stringify(p.conditions || {}), p.origin === 'human' ? 'human' : 'ai',
      p.planStepId ? String(p.planStepId) : null,
      p.expiresAt ? String(p.expiresAt) : null,
      p.sourceTemplate ? String(p.sourceTemplate) : null,
      p.gameplayDef ? String(p.gameplayDef) : null]
  );
  return { ok: true, task: ins.rows[0] };
}

/** 领取任务（§10.3 claim；UNIQUE(task_id, actor_id) 防重复领） */
async function claimTask(o) {
  const p = o || {};
  if (!p.taskId || !p.actorId) return bad('PARAMS_REQUIRED', '必须给 taskId 与 actorId');
  const actorType = p.actorType === 'human' ? 'human' : 'agent';
  const t = (await query(`SELECT * FROM world_tasks WHERE id=$1`, [String(p.taskId)])).rows[0];
  if (!t) return bad('TASK_NOT_FOUND', '任务不存在：' + p.taskId);
  if (['cancelled', 'expired', 'completed'].indexOf(t.status) >= 0) {
    return bad('TASK_NOT_CLAIMABLE', '任务当前状态不可领取：' + t.status);
  }
  if (t.visibility === 'human_only' && actorType !== 'human') return bad('VISIBILITY_DENIED', '该任务仅真人可领取');
  if (t.visibility === 'agent_only' && actorType !== 'agent') return bad('VISIBILITY_DENIED', '该任务仅 Agent 可领取');
  if (t.max_completions && t.completion_count >= t.max_completions) {
    return bad('COMPLETIONS_EXHAUSTED', '任务已完成次数达上限');
  }
  const ins = await query(
    `INSERT INTO world_task_progress (task_id, actor_type, actor_id, state, status, claimed_at)
     VALUES ($1,$2,$3,'{}','active',NOW())
     ON CONFLICT (task_id, actor_id) DO NOTHING RETURNING *`,
    [t.id, actorType, String(p.actorId)]
  );
  if (!ins.rows.length) {
    const cur = (await query(`SELECT * FROM world_task_progress WHERE task_id=$1 AND actor_id=$2`, [t.id, String(p.actorId)])).rows[0];
    return { ok: true, deduped: true, progress: cur, reason: '该Actor 已领取过此任务（UNIQUE 幂等）' };
  }
  // published → active（首个 actor 领取）
  if (t.status === 'published') {
    await query(`UPDATE world_tasks SET status='active', updated_at=NOW() WHERE id=$1 AND status='published'`, [t.id]);
  }
  try { eventLog.log({ type: 'task_progress', actorType, actorId: p.actorId, targetId: String(t.id), payload: { action: 'claim', title: String(t.title).slice(0, 40) } }); } catch (e) { /* 埋点静默 */ }
  return { ok: true, deduped: false, progress: ins.rows[0], task: t };
}

/**
 * 事件驱动推进：评估某 actor 的所有进行中任务。
 * @param {object} o { actorType, actorId }
 */
async function evaluateForActor(o) {
  const p = o || {};
  if (!p.actorId) return bad('ACTOR_REQUIRED', '缺少 actorId');
  const actorType = p.actorType === 'human' ? 'human' : 'agent';
  // 隐式登记（保持 3.5 语义：任务对可见的 actor 自动开始计进度，无需显式 claim；
  // 显式 claim 只是提前登记 + published→active 状态机入口。UNIQUE 保证一人一任务一行。）
  try {
    await query(
      `INSERT INTO world_task_progress (task_id, actor_type, actor_id, state, status, claimed_at)
       SELECT id, $1::varchar, $2::varchar, '{}', 'active', NOW() FROM world_tasks
        WHERE status IN ('published','active')
          AND (visibility = 'public'
               OR ($1::text = 'agent' AND visibility = 'agent_only')
               OR ($1::text = 'human' AND visibility = 'human_only'))
       ON CONFLICT (task_id, actor_id) DO NOTHING`,
      [actorType, String(p.actorId)]);
  } catch (e) { /* 登记失败不阻断评估 */ }
  const rows = (await query(
    `SELECT t.*, pr.id AS progress_id, pr.state, pr.objective_index, pr.last_seq, pr.claimed_at, pr.reward_granted
       FROM world_task_progress pr JOIN world_tasks t ON t.id = pr.task_id
      WHERE pr.actor_type=$1 AND pr.actor_id=$2 AND pr.status='active'
      ORDER BY pr.claimed_at ASC LIMIT 10`,
    [actorType, String(p.actorId)]
  )).rows;
  const results = [];
  for (const row of rows) {
    const r = await evaluateProgressRow(row, actorType, p.actorId);
    results.push(r);
  }
  return { ok: true, results };
}

/** 评估单个进行中任务（有序目标逐个推进 + 完成结算） */
async function evaluateProgressRow(row, actorType, actorId) {
  const objectives = Array.isArray(row.objectives) ? row.objectives : [];
  const state = Object.assign({ steps: {} }, row.state || {});
  // ★ 推进口径：并行累计（与 3.5 microQuest 语义一致，P35-15d 兼容）——
  //   所有目标独立按事件计数；全部达成才 completed（§10.2 的"有序数组"体现为展示顺序，
  //   判定不互相阻塞，否则"先交互后进区域"这类自然顺序会被卡住）。
  let idx = Number(row.objective_index) || 0;
  let advanced = false;
  for (let i = 0; i < objectives.length; i++) {
    const obj = objectives[i];
    const key = obj.type + ':' + String(obj.regionKey || obj.key || obj.targetId || obj.tag || i);
    if ((state.steps[key] || 0) >= (Number(obj.count) || 1)) continue; // 已达成
    const r = await evaluator.evaluate({
      objective: obj, actorType, actorId,
      since: new Date(0), minSeq: Number(row.last_seq) || 0,
    });
    if (!r.ok) continue;
    // ★ 累计制（与 3.5 语义一致）：游标只取新增事件，命中数累加进 state
    state.steps[key] = (state.steps[key] || 0) + r.hits;
    if ((state.steps[key] || 0) >= (Number(obj.count) || 1)) advanced = true;
  }
  // 第一个未达成目标的位置（objective_index 保留"进度展示"语义）
  idx = objectives.findIndex((obj, i) => {
    const key = obj.type + ':' + String(obj.regionKey || obj.key || obj.targetId || obj.tag || i);
    return (state.steps[key] || 0) < (Number(obj.count) || 1);
  });
  if (idx < 0) idx = objectives.length;
  const done = idx >= objectives.length;
  // 游标每轮必推进（否则同一事件会被重复累计）
  const minSeqNow = await currentMaxSeq();
  await query(
    `UPDATE world_task_progress
        SET state=$2, objective_index=$3, last_seq=$4,
            status=$5, completed_at=$6
      WHERE id=$1`,
    [row.progress_id, JSON.stringify(state), idx, minSeqNow,
      done ? 'completed' : 'active', done ? new Date() : null]
  );
  let settlement = null;
  if (done && !row.reward_granted) {
    settlement = await settleTask({ task: row, actorType, actorId, progressId: row.progress_id });
  }
  if (advanced || done) {
    try {
      eventLog.log({ type: done ? 'task_completed' : 'task_progress', actorType, actorId: String(actorId),
        targetId: String(row.id), payload: { objectiveIndex: idx, title: String(row.title).slice(0, 40) } });
    } catch (e) { /* 埋点静默 */ }
  }
  return { taskId: row.id, title: row.title, objectiveIndex: idx, done, advanced, state, settlement };
}

async function currentMaxSeq() {
  const r = await query(`SELECT coalesce(max(seq),0)::bigint AS s FROM world_events`);
  return Number(r.rows[0].s);
}

/** 任务完成结算（发奖幂等：reward_granted + grantToActor UNIQUE 双保险） */
async function settleTask(o) {
  const p = o || {};
  let task = p.task;
  if (!task && p.taskId) task = (await query(`SELECT * FROM world_tasks WHERE id=$1`, [String(p.taskId)])).rows[0];
  if (!task || !p.actorType || !p.actorId) return { ok: false, code: 'PARAMS_REQUIRED' };
  const pr = p.progressId
    ? (await query(`SELECT * FROM world_task_progress WHERE id=$1`, [p.progressId])).rows[0]
    : (await query(`SELECT * FROM world_task_progress WHERE task_id=$1 AND actor_id=$2`, [task.id, String(p.actorId)])).rows[0];
  if (!pr) return { ok: false, code: 'PROGRESS_NOT_FOUND' };
  if (pr.reward_granted) {
    return { ok: true, granted: false, deduped: true, reason: '该任务对该Actor 已发过奖（幂等）' };
  }
  const g = await require('./rewardService').grantTaskReward({
    worldId: task.world_id, taskId: task.id,
    actorType: p.actorType, actorId: p.actorId,
    reward: task.reward, regionKey: task.region_key,
  });
  if (!g.ok) return g;
  await query(`UPDATE world_task_progress SET reward_granted=TRUE WHERE id=$1`, [pr.id]);
  await query(
    `UPDATE world_tasks SET completion_count = completion_count + 1, updated_at=NOW() WHERE id=$1`, [task.id]);
  // repeatable 且未达上限 → 回 published 开启下一轮（§10.3）
  if (task.repeatable && (!task.max_completions || task.completion_count + 1 < task.max_completions)) {
    await query(`UPDATE world_tasks SET status='published' WHERE id=$1 AND status='active'`, [task.id]);
  } else {
    await query(`UPDATE world_tasks SET status='completed' WHERE id=$1 AND status='active'`, [task.id]);
  }
  return { ok: true, granted: g.granted, deduped: g.deduped || false, code: g.code || null, grant: g };
}

// ── 事件通知入口（eventLog 埋点 fire-and-forget 调用；全部静默失败）────────

async function notifyRegionEnter(o) {
  try { await evaluateForActor({ actorType: o.actorType, actorId: o.actorId }); } catch (e) { /* 静默 */ }
}
async function notifyChat(o) {
  try { await evaluateForActor({ actorType: o.actorType, actorId: o.actorId }); } catch (e) { /* 静默 */ }
}
/** object_interact 事件入口（interactionService 调用） */
async function onInteract(o) {
  return evaluateForActor(o);
}

/** 任务列表（管理面 / 真人 UI 共用） */
async function listTasks(o) {
  const p = o || {};
  const params = [String(p.worldId || '')];
  let sql = `SELECT * FROM world_tasks WHERE world_id=$1`;
  if (p.visibility) { params.push(String(p.visibility)); sql += ` AND visibility=$` + params.length; }
  if (p.status) { params.push(String(p.status)); sql += ` AND status=$` + params.length; }
  sql += ` ORDER BY created_at DESC LIMIT 50`;
  return (await query(sql, params)).rows || [];
}

async function getProgress(taskId, actorId) {
  const r = await query(`SELECT * FROM world_task_progress WHERE task_id=$1 AND actor_id=$2`, [String(taskId), String(actorId)]);
  return r.rows[0] || null;
}

/** 取消任务（cancel_task 工具） */
async function cancelTask(o) {
  const p = o || {};
  if (!p.taskId) return bad('TASK_ID_REQUIRED', '必须给 taskId');
  const r = await query(
    `UPDATE world_tasks SET status='cancelled', updated_at=NOW() WHERE id=$1 AND status IN ('published','active')
     RETURNING id`, [String(p.taskId)]);
  if (!r.rows.length) return bad('NOT_CANCELLABLE', '任务不存在或状态不可取消');
  return { ok: true, taskId: r.rows[0].id };
}

module.exports = {
  OBJECTIVE_TYPES, validateObjectives,
  createTask, claimTask, evaluateForActor, settleTask,
  notifyRegionEnter, notifyChat, onInteract,
  listTasks, getProgress, cancelTask,
};
