/**
 * analytics —— 区域热度 / 参与率（AI World Brain · Phase 4 · §C.3⑮ world_metrics_daily）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§H.6「聚合优先：区域热度用日聚合表，不扫原始轨迹」。
 * 6 个指标键：visits / dwell_sec / interactions / chat_count / economy / task_completion。
 * ★ dwell_sec 一期为 0（无轨迹数据；真人位置埋点刻意不做，Phase 6 再补）。
 */
'use strict';

const { query } = require('../../database/db');

const GLOBAL_REGION = '00000000-0000-0000-0000-000000000000';
const METRIC_KEYS = ['visits', 'dwell_sec', 'interactions', 'chat_count', 'economy', 'task_completion'];

/** 重算某日指标（从 world_events 聚合 → upsert world_metrics_daily） */
async function recomputeDaily(worldId, day) {
  const d = normalizeDay(day);
  const params = [String(worldId), d];

  // 全局行
  const g = await query(
    `SELECT
       count(*) FILTER (WHERE type = 'entity_enter_region')::int AS visits,
       count(*) FILTER (WHERE type = 'object_interact')::int AS interactions,
       count(*) FILTER (WHERE type = 'chat')::int AS chat_count,
       count(*) FILTER (WHERE type = 'task_completed')::int AS task_completion,
       COALESCE(sum(CASE WHEN type = 'economy' THEN COALESCE((payload->>'totalPrice')::numeric, 0) END), 0) AS economy
      FROM world_events
      WHERE world_id = $1 AND created_at::date = $2::date`,
    params
  );
  const row = g.rows[0] || {};
  const globalVals = {
    visits: row.visits || 0,
    dwell_sec: 0,
    interactions: row.interactions || 0,
    chat_count: row.chat_count || 0,
    economy: Number(row.economy) || 0,
    task_completion: row.task_completion || 0,
  };
  await upsert(worldId, d, GLOBAL_REGION, globalVals);

  // 区域行（enter_region 事件 target_id = regionKey → 必须映射成 world_regions.id 的 UUID）
  const rr = await query(
    `SELECT target_id AS region_key,
            count(*) FILTER (WHERE type = 'entity_enter_region')::int AS visits,
            count(*) FILTER (WHERE type = 'object_interact')::int AS interactions,
            count(*) FILTER (WHERE type = 'chat')::int AS chat_count
       FROM world_events
      WHERE world_id = $1 AND created_at::date = $2::date
        AND type IN ('entity_enter_region','object_interact','chat')
        AND target_id IS NOT NULL
      GROUP BY 1`,
    params
  );
  // ★ Phase 7 修：region_id 列是 UUID，直接塞 region_key 会整轮抛错（"invalid input syntax for uuid"）；
  //   这里一次查全量映射表，未登记的 key 归全局哨兵行（不丢数据也不炸整轮）。
  const keyList = (rr.rows || []).map((r) => String(r.region_key));
  const idMap = {};
  if (keyList.length) {
    const ir = await query(`SELECT region_key, id FROM world_regions WHERE region_key = ANY($1::varchar[])`, [keyList]);
    for (const row of ir.rows || []) idMap[String(row.region_key)] = row.id;
  }
  for (const r of rr.rows || []) {
    await upsert(worldId, d, idMap[String(r.region_key)] || GLOBAL_REGION, {
      visits: r.visits || 0, dwell_sec: 0, interactions: r.interactions || 0,
      chat_count: r.chat_count || 0, economy: 0, task_completion: 0,
    });
  }
  return { ok: true, day: d, global: globalVals, regions: (rr.rows || []).length };
}

async function upsert(worldId, day, regionId, vals) {
  for (const k of METRIC_KEYS) {
    //dwell_sec 由 presenceEmitter 增量累加（Phase 7）；这里取 GREATEST 防重算把它抹成 0
    const onConflict = k === 'dwell_sec'
      ? 'DO UPDATE SET metric_value = GREATEST(EXCLUDED.metric_value, world_metrics_daily.metric_value), computed_at = NOW()'
      : 'DO UPDATE SET metric_value = EXCLUDED.metric_value, computed_at = NOW()';
    await query(
      `INSERT INTO world_metrics_daily (day, world_id, region_id, metric_key, metric_value)
       VALUES ($1::date, $2, $3::uuid, $4, $5)
       ON CONFLICT (day, world_id, region_id, metric_key)
       ` + onConflict,
      [day, String(worldId), regionId, k, vals[k]]
    );
  }
}

/** 增量写日聚合（Phase 7 presenceEmitter 用：dwell_sec / visits 都是累加口径） */
async function bumpMetrics(worldId, day, regionId, metricKey, delta) {
  const add = Number(delta) || 0;
  if (!add) return { ok: true, skipped: true };
  const d = normalizeDay(day);
  await query(
    `INSERT INTO world_metrics_daily (day, world_id, region_id, metric_key, metric_value)
     VALUES ($1::date, $2, $3::uuid, $4, $5)
     ON CONFLICT (day, world_id, region_id, metric_key)
     DO UPDATE SET metric_value = world_metrics_daily.metric_value + EXCLUDED.metric_value, computed_at = NOW()`,
    [d, String(worldId), regionId || GLOBAL_REGION, String(metricKey), add]
  );
  return { ok: true, added: add };
}

/** 读某日区域统计（analyticsTools.get_area_statistics 用） */
async function regionStats(worldId, day) {
  const d = normalizeDay(day);
  const r = await query(
    `SELECT region_id, metric_key, metric_value FROM world_metrics_daily
      WHERE world_id = $1 AND day = $2::date ORDER BY region_id, metric_key`,
    [String(worldId), d]
  );
  const byRegion = {};
  for (const row of r.rows || []) {
    const key = row.region_id === GLOBAL_REGION ? '(global)' : row.region_id;
    if (!byRegion[key]) byRegion[key] = {};
    byRegion[key][row.metric_key] = Number(row.metric_value);
  }
  return { ok: true, day: d, metrics: METRIC_KEYS, byRegion };
}

/** 行为统计（get_player_behavior / get_agent_behavior 共用） */
async function behavior(worldId, actorType, day) {
  const params = [String(worldId), actorType];
  let sql = `SELECT type, count(*)::int AS n FROM world_events WHERE world_id = $1 AND actor_type = $2`;
  if (day) { params.push(normalizeDay(day)); sql += ` AND created_at::date = $` + params.length + `::date`; }
  sql += ` GROUP BY type ORDER BY n DESC`;
  const r = await query(sql, params);
  const byType = {};
  let total = 0;
  for (const row of r.rows || []) { byType[row.type] = row.n; total += row.n; }
  return { ok: true, actorType, byType, total, day: day || null };
}

function normalizeDay(day) {
  if (!day) return new Date().toISOString().slice(0, 10);
  const s = String(day).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

module.exports = { recomputeDaily, regionStats, behavior, bumpMetrics, METRIC_KEYS, GLOBAL_REGION };
