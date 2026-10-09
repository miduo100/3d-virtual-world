/**
 * microQuestService —— 极简引导任务（Phase 3.5-2 · 只有 2 种 objective）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 3.5 文件清单「引导任务：2 种 objective（reach_region / object_interact）」
 * + §C.3 ⑪⑫。一期刻意只做 2 种：多了就得配条件系统，那是 Phase 6 的 taskService。
 *
 * objectives 形状（简化到能一眼看懂）：
 *   [{ type:'reach_region', regionKey:'east_cafe_block', count:1 },
 *    { type:'object_interact', key:'reward_grant:mint', count:3 }]
 *
 * 幂等：world_task_progress UNIQUE(task_id, actor_id) —— 一人一任务一条进行中记录。
 */
'use strict';

const { query } = require('../../database/db');

const OBJECTIVES = ['reach_region', 'object_interact'];

function bad(code, reason) { return { ok: false, code, reason }; }

/** 为区域建一条引导任务（幂等：同 region+title 已有则直接返回） */
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

/** 推进某Actor 的任务进度（两种 objective 统一入口） */
async function advance(o) {
  const p = o || {};
  if (!p.actorId) return bad('ACTOR_REQUIRED', '缺少 actorId');
  const actorType = p.actorType === 'human' ? 'human' : 'agent';
  const tasks = await query(
    `SELECT * FROM world_tasks
      WHERE status = 'active' AND visibility = 'agent_only'
        AND ($1::text IS NULL OR region_key = $1)
      ORDER BY created_at DESC LIMIT 10`,
    [p.regionKey || null]
  );
  const progressed = [];
  for (const t of tasks.rows) {
    const objectives = Array.isArray(t.objectives) ? t.objectives : [];
    const pr = await query(
      `INSERT INTO world_task_progress (task_id, actor_type, actor_id, state, status)
       VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (task_id, actor_id) DO UPDATE SET state = EXCLUDED.state
       RETURNING *`,
      [t.id, actorType, String(p.actorId), JSON.stringify({ steps: {}, hits: 0 })]
    );
    const row = pr.rows[0];
    const state = Object.assign({ steps: {}, hits: 0 }, row.state || {});
    const type = p.event === 'reach_region' ? 'reach_region' : 'object_interact';
    const want = objectives.find((x) => x.type === type
      && (type === 'reach_region' || !x.key || x.key === p.interactionKey));
    if (!want) continue;
    const key = type === 'reach_region' ? 'reach_region' : ('object_interact:' + (p.interactionKey || ''));
    state.hits = (state.hits || 0) + 1;
    state.steps[key] = Math.min(Number(want.count) || 1, (state.steps[key] || 0) + 1);
    const done = objectives.every((x) => {
      const k = x.type === 'reach_region' ? 'reach_region' : ('object_interact:' + (x.key || ''));
      return (state.steps[k] || 0) >= (Number(x.count) || 1);
    });
    await query(
      `UPDATE world_task_progress SET state = $2, status = $3, completed_at = $4 WHERE id = $1`,
      [row.id, JSON.stringify(state), done ? 'completed' : 'active', done ? new Date() : null]
    );
    if (done) {
      await query(`UPDATE world_tasks SET completion_count = completion_count + 1 WHERE id = $1`, [t.id]);
    }
    progressed.push({ taskId: t.id, title: t.title, type, done, state });
  }
  return { ok: true, progressed };
}

/** object_interact 事件入口（interactionService 调用） */
async function advanceObjectInteract(o) {
  return advance(Object.assign({}, o, { event: 'object_interact' }));
}

/** reach_region 事件入口（Agent 进入区域时调用；Phase 4 的 runtime 触发） */
async function advanceReachRegion(o) {
  return advance(Object.assign({}, o, { event: 'reach_region' }));
}

async function listTasks(worldId, regionKey) {
  const params = [String(worldId || '')];
  let sql = `SELECT * FROM world_tasks WHERE world_id = $1`;
  if (regionKey) { params.push(String(regionKey)); sql += ` AND region_key = $2`; }
  sql += ` ORDER BY created_at DESC LIMIT 50`;
  const res = await query(sql, params);
  return res.rows || [];
}

module.exports = { OBJECTIVES, createForRegion, advance, advanceObjectInteract, advanceReachRegion, listTasks };