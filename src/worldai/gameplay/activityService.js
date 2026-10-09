/**
 * activityService —— 活动生命周期 + 排名 + 幂等结算 + 清场（AI World Brain · Phase 6 · 分册 §11.1/§11.2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 生命周期（§11.2）：scheduled →(手动 announce)→ announced →(start)→ running
 *   →(winWhen 达成)→ settling → finished；任意 → cancelled。
 * winWhen：gameplayDefs 白名单 DSL，判定数据源 = world_events（事件驱动，零 LLM）。
 * 排名与发奖：world_activity_participants.score 排名；发奖幂等（reward_granted + activity.result 双闸）。
 * 清场（P5-9）：spawned_object_ids 走 batchJournal.rollbackBatch（created_by='activity:<id>' 单条 DELETE，天然事务）。
 */
'use strict';

const { query, pool } = require('../../database/db');
const gameplayDefs = require('./gameplayDefs');
const eventLog = require('../perception/eventLog');

function bad(code, reason) { return { ok: false, code, reason }; }

/** 创建活动（scheduled；create_event / create_game 工具共用核心） */
async function createActivity(o) {
  const p = o || {};
  const v = gameplayDefs.validateActivity(p);
  if (!v.ok) return { ok: false, code: 'GAMEPLAY_DEF_INVALID', reason: v.errors.map((e) => e.path + ' ' + e.message).join('; '), errors: v.errors };
  const ins = await query(
    `INSERT INTO world_activities
       (world_id, kind, title, description, region_key, created_by, origin, status,
        schedule, gameplay_def, gameplay_params, rules, win_when, reward, plan_step_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8::jsonb,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14)
     RETURNING *`,
    [String(p.worldId || ''), String(p.kind || 'social_mixer'), String(p.title).slice(0, 200),
      p.description ? String(p.description).slice(0, 1000) : null,
      p.regionKey ? String(p.regionKey) : null,
      String(p.createdBy || 'world_ai').slice(0, 60), p.origin === 'human' ? 'human' : 'ai',
      JSON.stringify(p.schedule || {}), p.gameplayDef ? String(p.gameplayDef) : (p.kind || null),
      JSON.stringify(p.gameplayParams || {}), JSON.stringify(p.rules || {}),
      JSON.stringify(p.winWhen || gameplayDefs.defaultWinWhen(p.kind || 'social_mixer')),
      JSON.stringify(p.reward || null), p.planStepId ? String(p.planStepId) : null]
  );
  return { ok: true, activity: ins.rows[0] };
}

async function findById(id) {
  return (await query(`SELECT * FROM world_activities WHERE id=$1`, [String(id)])).rows[0] || null;
}

/** scheduled → announced（公告广播由调用方/Steward 做，本服务只管状态与事件） */
async function announce(id) {
  const a = await findById(id);
  if (!a) return bad('ACTIVITY_NOT_FOUND', '活动不存在');
  if (a.status !== 'scheduled') return bad('INVALID_TRANSITION', 'scheduled → announced 才合法，当前：' + a.status);
  const r = await query(
    `UPDATE world_activities SET status='announced', scheduled_at=COALESCE(scheduled_at,NOW()), updated_at=NOW()
      WHERE id=$1 AND status='scheduled' RETURNING *`, [a.id]);
  logSafe('activity_participant', a, { action: 'announced' });
  return { ok: true, activity: r.rows[0] };
}

/** announced → running（spawn 物件：world_objects 走 batchJournal 唯一写路径） */
async function start(id, ctx) {
  const a = await findById(id);
  if (!a) return bad('ACTIVITY_NOT_FOUND', '活动不存在');
  if (a.status !== 'announced' && a.status !== 'scheduled') {
    return bad('INVALID_TRANSITION', 'announced/scheduled → running 才合法，当前：' + a.status);
  }
  const c = ctx || {};
  const spawn = (a.gameplay_params && (a.gameplay_params.spawn || a.gameplay_params.spawnPoints)) || null;
  let spawnedIds = [];
  if (spawn && Number(spawn.count) > 0) {
    const count = Math.min(50, Math.floor(Number(spawn.count)));
    const base = Number(spawn.x) || 0, baseZ = Number(spawn.z) || 0;
    const spread = Number(spawn.spread) || 30;
    const tag = 'activity:' + a.id;
    const items = [];
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      items.push({
        type: 'geometry_building', name: (spawn.namePrefix || (a.kind + '_point')) + '_' + (i + 1),
        model_path: spawn.modelPath || null,
        position_x: Math.round((base + Math.cos(ang) * spread) * 100) / 100,
        position_z: Math.round((baseZ + Math.sin(ang) * spread) * 100) / 100,
        partKey: tag + ':' + i,
      });
    }
    const bj = require('../journal/batchJournal');
    const created = await bj.batchCreate(items, {
      regionKey: a.region_key || c.regionKey || null,
      missionId: 'activity:' + a.id, effectiveAutonomy: c.effectiveAutonomy || 'managed',
      approvedRisks: c.approvedRisks || ['high'],
    });
    if (!created.ok) return created;
    spawnedIds = created.ids;
  }
  const r = await query(
    `UPDATE world_activities SET status='running', started_at=NOW(), spawned_object_ids=$2::jsonb, updated_at=NOW()
      WHERE id=$1 AND status IN ('scheduled','announced') RETURNING *`,
    [a.id, JSON.stringify(spawnedIds)]);
  logSafe('activity_started', a, { spawned: spawnedIds.length });
  return { ok: true, activity: r.rows[0], spawnedIds };
}

/** 加入活动（UNIQUE 幂等） */
async function join(id, actorType, actorId) {
  const a = await findById(id);
  if (!a) return bad('ACTIVITY_NOT_FOUND', '活动不存在');
  if (['announced', 'running'].indexOf(a.status) < 0) return bad('NOT_JOINABLE', '活动当前不可加入：' + a.status);
  const max = Number(a.rules && a.rules.maxParticipants) || 50;
  const cnt = await query(`SELECT count(*)::int AS n FROM world_activity_participants WHERE activity_id=$1`, [a.id]);
  if (cnt.rows[0].n >= max) return bad('FULL', '参与人数已达上限 ' + max);
  const ins = await query(
    `INSERT INTO world_activity_participants (activity_id, actor_type, actor_id)
     VALUES ($1,$2,$3) ON CONFLICT (activity_id, actor_id) DO NOTHING RETURNING *`,
    [a.id, actorType === 'human' ? 'human' : 'agent', String(actorId)]);
  logSafe('activity_participant', a, { actorId: String(actorId).slice(0, 40), joined: !!ins.rows.length });
  return { ok: true, deduped: !ins.rows.length, participant: ins.rows[0] || null };
}

/** 进度记分（object_interact 落在活动物件上时由 taskService 侧通知调用） */
async function bumpScore(id, actorId, n) {
  const add = Math.max(1, Math.floor(Number(n) || 1));
  const r = await query(
    `UPDATE world_activity_participants SET score = score + $2
      WHERE activity_id=$1 AND actor_id=$3 RETURNING score`,
    [String(id), add, String(actorId)]);
  return { ok: r.rows.length > 0, score: r.rows.length ? Number(r.rows[0].score) : 0 };
}

/** running 活动的 winWhen 判定（事件驱动）→ 达成则 settle */
async function tick(id, ctx) {
  const a = await findById(id);
  if (!a) return bad('ACTIVITY_NOT_FOUND', '活动不存在');
  if (a.status !== 'running') return { ok: true, settled: false, status: a.status, reason: '仅 running 活动判定 winWhen' };
  const since = a.started_at || a.created_at;
  const conds = Array.isArray(a.win_when) && a.win_when.length ? a.win_when : gameplayDefs.defaultWinWhen(a.kind);
  let met = true;
  for (const c of conds) {
    const where = c.where || {};
    const args = [since];
    let sql = `SELECT count(*)::int AS n FROM world_events WHERE created_at >= $1 AND type='` + String(c.event) + `'`;
    if (where.objectTag) { args.push('%' + where.objectTag + '%'); sql += ` AND payload->>'objectTag' ILIKE $` + args.length; }
    if (where.interactionKey) { args.push(String(where.interactionKey)); sql += ` AND (target_id=$` + args.length + ` OR payload->>'interactionKey'=$` + args.length + `)`; }
    if (where.regionKey) { args.push(String(where.regionKey)); sql += ` AND target_id=$` + args.length; }
    const r = await query(sql, args);
    if (r.rows[0].n < Math.max(1, Number(c.count) || 1)) { met = false; break; }
  }
  if (!met) return { ok: true, settled: false, status: 'running', reason: 'winWhen 未达成' };
  return settle(id, ctx);
}

/** settling → finished：排名 + 幂等发奖 + 清场 */
async function settle(id, ctx) {
  const c = ctx || {};
  const a = await findById(id);
  if (!a) return bad('ACTIVITY_NOT_FOUND', '活动不存在');
  if (a.status === 'finished') {
    return { ok: true, settled: true, deduped: true, result: a.result, reason: '活动已结算过（幂等）' };
  }
  if (a.status !== 'running' && a.status !== 'announced' && a.status !== 'scheduled') {
    return bad('INVALID_TRANSITION', '当前状态不可结算：' + a.status);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(`SELECT status FROM world_activities WHERE id=$1 FOR UPDATE`, [a.id]);
    if (!lock.rows.length) { await client.query('ROLLBACK'); return bad('ACTIVITY_NOT_FOUND', '活动不存在'); }
    if (lock.rows[0].status === 'finished') {
      await client.query('COMMIT');
      return { ok: true, settled: true, deduped: true, reason: '并发结算被幂等闸拦下' };
    }
    await client.query(`UPDATE world_activities SET status='settling', settling_at=NOW(), updated_at=NOW() WHERE id=$1`, [a.id]);
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* 已回滚 */ }
    return bad('SETTLE_FAILED', '进入结算失败：' + e.message);
  } finally {
    client.release();
  }

  // 排名（score 降序）
  const parts = (await query(
    `SELECT * FROM world_activity_participants WHERE activity_id=$1 ORDER BY score DESC, joined_at ASC LIMIT 100`, [a.id])).rows;
  const ranking = parts.map((p, i) => ({ rank: i + 1, actorType: p.actor_type, actorId: p.actor_id, score: Number(p.score) }));

  // 幂等发奖（每参与者一次）
  const reward = a.reward || { type: 'reward_codes', poolKey: (a.gameplay_params && a.gameplay_params.rewardPoolKey) || null, count: 1 };
  let grantedCount = 0;
  const rewardService = require('./rewardService');
  for (const p of parts) {
    if (p.reward_granted) continue;
    const g = await rewardService.grantToActor({
      worldId: a.world_id, actorType: p.actor_type, actorId: p.actor_id,
      interactionKey: 'activity:' + a.id,
      poolKey: reward.poolKey || null, codeId: reward.codeId || null, code: reward.code || null,
      count: Number(reward.count) || 1, regionKey: a.region_key,
    });
    if (g.ok && g.granted) {
      grantedCount += 1;
      await query(`UPDATE world_activity_participants SET reward_granted=TRUE WHERE id=$1`, [p.id]);
    }
  }

  // 清场（P5-9）：本活动 spawn 的对象全删（created_by='activity:<id>' 单条 DELETE = 事务）
  let cleaned = 0;
  {
    const bj = require('../journal/batchJournal');
    const rb = await bj.rollbackBatch('activity:' + a.id, { regionKey: a.region_key || '' });
    cleaned = rb.ok ? rb.deleted : 0;
  }

  const result = { ranking, stats: { participants: parts.length, granted: grantedCount, cleaned } };
  const upd = await query(
    `UPDATE world_activities SET status='finished', finished_at=NOW(), result=$2::jsonb,
       reward_summary=$3::jsonb, updated_at=NOW()
      WHERE id=$1 AND status='settling' RETURNING *`,
    [a.id, JSON.stringify(result), JSON.stringify({ poolKey: reward.poolKey || null, granted: grantedCount })]);
  logSafe('activity_finished', a, { participants: parts.length, granted: grantedCount, cleaned });
  return { ok: true, settled: true, deduped: false, activity: upd.rows[0], result };
}

async function cancel(id, reason) {
  const r = await query(
    `UPDATE world_activities SET status='cancelled', updated_at=NOW() WHERE id=$1 AND status <> 'finished' RETURNING id`,
    [String(id)]);
  if (!r.rows.length) return bad('NOT_CANCELLABLE', '活动不存在或已结束');
  return { ok: true, activityId: r.rows[0].id, reason: String(reason || '').slice(0, 200) };
}

async function listActivities(o) {
  const p = o || {};
  const params = [String(p.worldId || '')];
  let sql = `SELECT * FROM world_activities WHERE world_id=$1`;
  if (p.status) { params.push(String(p.status)); sql += ` AND status=$` + params.length; }
  sql += ` ORDER BY created_at DESC LIMIT 50`;
  return (await query(sql, params)).rows || [];
}

/** 物件交互 → 活动记分（spawn 物件被交互时由 interactionService/evaluate 侧调用） */
async function onSpawnedInteract(worldObjectIdOrKey, actorId) {
  try {
    const rows = (await query(
      `SELECT id FROM world_activities WHERE status='running' AND jsonb_array_length(spawned_object_ids) > 0`)).rows;
    for (const a of rows) {
      const ids = [];
      const r2 = await query(`SELECT spawned_object_ids FROM world_activities WHERE id=$1`, [a.id]);
      (r2.rows[0].spawned_object_ids || []).forEach((x) => ids.push(Number(x)));
      if (ids.indexOf(Number(worldObjectIdOrKey)) >= 0) await bumpScore(a.id, actorId, 1);
    }
  } catch (e) { /* 静默 */ }
}

function logSafe(type, a, payload) {
  try {
    eventLog.log({ type, actorType: 'agent', actorId: 'world_ai', targetId: String(a.id).slice(0, 40), payload });
  } catch (e) { /* 静默 */ }
}

module.exports = { createActivity, announce, start, join, tick, settle, cancel, bumpScore, listActivities, findById, onSpawnedInteract };
