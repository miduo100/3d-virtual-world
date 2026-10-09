/**
 * objectiveEvaluator —— 6 种 objective 判定器（AI World Brain · Phase 6 · 分册 §10.2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 铁律：目标完成判定 100% 基于事件流 / 服务端数据，**绝不 LLM 判定**。
 *   reach_region / reach_position / object_interact / talk_to → world_events（+ 真人实时位置兜底）
 *   object_exists → world_objects（按名称 tag 匹配，见 matchObjects）
 *   chat_contains → world_chat_log（事件流只存 len/kw 短哈希，全文在 chat 表）
 * 全部返回 {done, hits, collected?}；同一目标重复评估幂等（由 taskService 的 last_seq 游标保证只看新增）。
 */
'use strict';

const { query } = require('../../database/db');

/** 真人实时位置（websocket playerPositions 懒加载；验收/脚本进程安全） */
function liveHumanPosition(characterId) {
  try {
    const ws = require('../../websocket/wsServer');
    const pp = typeof ws.getPlayerPositions === 'function' ? ws.getPlayerPositions() : null;
    if (!pp) return null;
    for (const entry of pp.values()) {
      if (String(entry.characterId) === String(characterId) && entry.position) {
        return { x: Number(entry.position.x), z: Number(entry.position.z) };
      }
    }
  } catch (e) { /* 脚本进程无 wsServer → 静默 */ }
  return null;
}

function dist2d(a, b) {
  return Math.sqrt((Number(a.x) - Number(b.x)) ** 2 + (Number(a.z) - Number(b.z)) ** 2);
}

/** 区域命中（bounds 形状兼容 eventLog.regionAt 的宽容解析） */
async function inRegion(regionKey, pos) {
  const r = await query(`SELECT bounds FROM world_regions WHERE region_key=$1 AND status <> 'sealed'`, [String(regionKey)]);
  if (!r.rows.length) return false;
  const b = r.rows[0].bounds || {};
  const minX = Number(b.minX !== undefined ? b.minX : b.x), minZ = Number(b.minZ !== undefined ? b.minZ : b.z);
  const maxX = Number(b.maxX !== undefined ? b.maxX : (Number(b.x || 0) + Number(b.width || 0)));
  const maxZ = Number(b.maxZ !== undefined ? b.maxZ : (Number(b.z || 0) + Number(b.depth || 0)));
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return false;
  return pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ;
}

/** 目标位置（npc 表 / 实时玩家） */
async function targetPosition(obj) {
  if (obj.targetType === 'npc' && obj.targetId) {
    const r = await query(`SELECT position FROM npcs WHERE id=$1`, [String(obj.targetId)]);
    if (r.rows.length && r.rows[0].position) return { x: Number(r.rows[0].position.x), z: Number(r.rows[0].position.z) };
    return null;
  }
  if (obj.targetId) {
    const p = liveHumanPosition(obj.targetId);
    if (p) return p;
    try {
      const r = await query(`SELECT current_position FROM agent_sessions WHERE agent_id=$1 ORDER BY updated_at DESC LIMIT 1`, [String(obj.targetId)]);
      if (r.rows.length && r.rows[0].current_position) {
        return { x: Number(r.rows[0].current_position.x), z: Number(r.rows[0].current_position.z) };
      }
    } catch (e) { /* 表不存在等 → 静默 */ }
  }
  return null;
}

/**
 * 判定一个 objective。
 * @param {object} o { objective, actorType, actorId, since(时间), minSeq(事件游标) }
 * @returns {ok:true, done:boolean, hits:number, collected?:string[]}
 */
async function evaluate(o) {
  const obj = o.objective || {};
  const actorId = String(o.actorId || '');
  const since = o.since || new Date(0);
  const minSeq = Number(o.minSeq) || 0;
  const count = Math.max(1, Number(obj.count) || 1);

  // ── reach_region：事件（agent）或实时位置（human/兜底）落在区域内 ──
  if (obj.type === 'reach_region') {
    const ev = await query(
      `SELECT count(*)::int AS n FROM world_events
        WHERE type='entity_enter_region' AND actor_id=$1 AND target_id=$2
          AND seq > $3 AND created_at >= $4`,
      [actorId, String(obj.regionKey || obj.regionId || ''), minSeq, since]);
    if (ev.rows[0].n >= count) return { ok: true, done: true, hits: ev.rows[0].n };
    const live = liveHumanPosition(actorId);
    if (live && await inRegion(obj.regionKey || obj.regionId || '', live)) {
      return { ok: true, done: true, hits: Math.max(1, ev.rows[0].n) };
    }
    return { ok: true, done: false, hits: ev.rows[0].n };
  }

  // ── reach_position：事件位置或实时位置进入半径 ──
  if (obj.type === 'reach_position') {
    const tx = Number(obj.x), tz = Number(obj.z), radius = Math.max(0.5, Number(obj.radius) || 3);
    const ev = await query(
      `SELECT x, z, count(*) OVER () ::int AS n FROM world_events
        WHERE actor_id=$1 AND seq > $2 AND created_at >= $3 AND x IS NOT NULL AND z IS NOT NULL
          AND abs(x-$4) <= $5 AND abs(z-$6) <= $5
        ORDER BY seq DESC LIMIT 20`,
      [actorId, minSeq, since, tx, radius, tz]);
    if (ev.rows.some((r) => dist2d({ x: r.x, z: r.z }, { x: tx, z: tz }) <= radius)) {
      return { ok: true, done: true, hits: ev.rows[0].n };
    }
    const live = liveHumanPosition(actorId);
    if (live && dist2d(live, { x: tx, z: tz }) <= radius) return { ok: true, done: true, hits: 1 };
    return { ok: true, done: false, hits: 0 };
  }

  // ── talk_to：与 N 个不同目标对话。来源：npc_chat_history（npc 目标）+ chat 事件近距（agent/human 目标）──
  if (obj.type === 'talk_to') {
    const collected = new Set();
    let rowCount = 0;
    const needNpc = !obj.targetType || obj.targetType === 'npc';
    if (needNpc) {
      const r = await query(
        `SELECT npc_id::text AS nid FROM npc_chat_history
          WHERE player_id=$1 AND created_at >= $2
            AND ($3::text IS NULL OR npc_id::text = $3) LIMIT 50`,
        [actorId, since, obj.targetId ? String(obj.targetId) : null]);
      rowCount += r.rows.length;
      r.rows.forEach((x) => collected.add('npc:' + x.nid));
    }
    if (!obj.targetType || obj.targetType !== 'npc') {
      const tp = obj.targetId ? await targetPosition(obj) : null;
      const ev = await query(
        `SELECT x, z, target_id FROM world_events
          WHERE type='chat' AND actor_id=$1 AND seq > $2 AND created_at >= $3 ORDER BY seq DESC LIMIT 50`,
        [actorId, minSeq, since]);
      for (const e of ev.rows) {
        if (!obj.targetId) { collected.add('chat:' + (e.target_id || 'any')); continue; }
        if (!tp) continue;
        if (Number.isFinite(Number(e.x)) && Number.isFinite(Number(e.z))
          && dist2d({ x: e.x, z: e.z }, tp) <= Math.max(5, Number(obj.radius) || 5)) {
          collected.add('target:' + String(obj.targetId));
        }
      }
    }
    const wantDistinct = obj.distinct === false ? 1 : Math.max(1, Number(obj.distinctCount || obj.count) || 1);
    // 指定单目标时按"对话次数"计（同目标聊两次算 2）；未指定目标时按"不同目标数"计（去重语义）
    const hits = obj.targetId ? rowCount : collected.size;
    return { ok: true, done: hits >= wantDistinct, hits, collected: [...collected] };
  }

  // ── object_interact：与目标对象/交互点交互 N 次 ──
  if (obj.type === 'object_interact') {
    const key = String(obj.key || obj.interactionKey || '');
    const ev = await query(
      `SELECT count(*)::int AS n, count(DISTINCT coalesce(target_id, world_object_id::text))::int AS d FROM world_events
        WHERE type='object_interact' AND actor_id=$1 AND seq > $2 AND created_at >= $3
          AND ($4::text IS NULL OR target_id = $4 OR payload->>'interactionKey' = $4)`,
      [actorId, minSeq, since, key || null]);
    const wantDistinct = obj.distinct === true;
    const n = wantDistinct ? ev.rows[0].d : ev.rows[0].n;
    return { ok: true, done: n >= count, hits: n };
  }

  // ── object_exists：世界状态断言（按对象名含 tag 计数）──
  if (obj.type === 'object_exists') {
    const tag = String(obj.tag || obj.nameContains || '');
    if (!tag) return { ok: false, done: false, hits: 0, reason: 'object_exists 必须给 tag' };
    const r = await query(
      `SELECT count(*)::int AS n FROM world_objects
        WHERE name ILIKE $1 AND ($2::text IS NULL OR region_id = $2)`,
      ['%' + tag + '%', obj.regionKey || null]);
    return { ok: true, done: r.rows[0].n >= Math.max(1, Number(obj.min) || 1), hits: r.rows[0].n };
  }

  // ── chat_contains：世界聊天命中关键词（world_chat_log 全文，事件流只有短哈希）──
  if (obj.type === 'chat_contains') {
    const kws = Array.isArray(obj.keywords) ? obj.keywords.map(String).slice(0, 5) : [];
    if (!kws.length) return { ok: false, done: false, hits: 0, reason: 'chat_contains 必须给 keywords' };
    const conds = kws.map((_, i) => `message ILIKE $${i + 1}`).join(' OR ');
    // ILIKE 需要通配符才是"包含"语义
    const kwPatterns = kws.map((k) => '%' + k + '%');
    let sql, args;
    if (obj.selfOnly) {
      sql = `SELECT count(*)::int AS n FROM world_chat_log
              WHERE sender_id=$${kws.length + 1} AND created_at >= NOW() - INTERVAL '1 day' AND (${conds})`;
      args = [...kwPatterns, actorId];
    } else {
      sql = `SELECT count(*)::int AS n FROM world_chat_log
              WHERE created_at >= NOW() - INTERVAL '1 day' AND (${conds})`;
      args = kwPatterns.slice();
    }
    const r = await query(sql, args);
    return { ok: true, done: r.rows[0].n >= Math.max(1, Number(obj.min) || 1), hits: r.rows[0].n };
  }

  return { ok: false, done: false, hits: 0, reason: '未知 objective 类型：' + String(obj.type) };
}

module.exports = { evaluate };
