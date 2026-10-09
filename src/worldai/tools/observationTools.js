/**
 * observationTools —— ① 世界观察 8 个（AI World Brain · Phase 4 · §D.3①）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 读为主，全部 low 风险 / world:observe scope；守卫对读一律放行（§G.5①）。
 * get_players / get_agents 复用 wsServer 的 playerPositions（进程内懒加载，脚本进程里为空表不报错）。
 */
'use strict';

const { query } = require('../../database/db');
const verbRegistry = require('./verbRegistry');
const worldSnapshot = require('../perception/worldSnapshot');

function def(name, summary, params, impl) {
  verbRegistry.register({
    name, category: 'observation', risk: 'low', reversible: false,
    scope: 'world:observe', summary, params, impl,
  });
}

function registerAll() {
  def('observe_world', '世界聚合快照（受控字节预算；含 regions/hotspots/coldspots/integrity）',
    { type: 'object', strict: false, properties: { maxBytes: { type: 'integer', min: 300, max: 65536 } } },
    async (p, ctx) => {
      const r = await worldSnapshot.build({ worldId: ctx.worldId, maxBytes: p.maxBytes });
      return { ok: true, result: { snapshot: r.snapshot, bytes: r.bytes, dropped: r.dropped }, undoable: false };
    });

  def('get_world_state', '全量结构化世界状态（区域 + 各类对象/玩家/事件计数）',
    { type: 'object', properties: {} },
    async (p, ctx) => {
      const regions = (await query(`SELECT region_key, name, autonomy, bounds, status FROM world_regions WHERE status <> 'sealed' ORDER BY created_at DESC`, [])).rows;
      const c = (await query(
        `SELECT (SELECT count(*)::int FROM world_objects) AS objects,
                (SELECT count(*)::int FROM world_objects WHERE origin='ai') AS ai_objects,
                (SELECT count(*)::int FROM world_events WHERE created_at >= NOW() - INTERVAL '24 hours') AS events_24h,
                (SELECT count(*)::int FROM world_approvals WHERE decision='pending') AS approvals_pending`, [])).rows[0];
      return { ok: true, result: { regions, counts: c }, undoable: false };
    });

  def('get_world_map', '区域网格 + 对象密度热力（zoom 1~5）',
    { type: 'object', properties: { zoom: { type: 'integer', min: 1, max: 5 } } },
    async (p, ctx) => {
      const cell = Math.max(25, 400 / Math.pow(2, (p.zoom || 3) - 1));
      const r = await query(
        `SELECT floor(position_x / $1)::int AS gx, floor(position_z / $1)::int AS gz, count(*)::int AS n
           FROM world_objects GROUP BY 1, 2 ORDER BY n DESC LIMIT 200`, [cell]);
      return { ok: true, result: { cellSize: cell, cells: r.rows }, undoable: false };
    });

  def('get_world_objects', '对象列表（按类型/区域过滤，分页）',
    { type: 'object', properties: {
      type: { type: 'string', maxLength: 40 },
      regionId: { type: 'string', maxLength: 60 },
      limit: { type: 'integer', min: 1, max: 200 },
      offset: { type: 'integer', min: 0 },
    } },
    async (p, ctx) => {
      const params = [];
      let sql = `SELECT id, type, name, origin, region_id, position_x, position_y, position_z, is_locked
                   FROM world_objects WHERE TRUE`;
      if (p.type) { params.push(String(p.type)); sql += ` AND type = $` + params.length; }
      if (p.regionId) { params.push(String(p.regionId)); sql += ` AND region_id = $` + params.length; }
      sql += ` ORDER BY id LIMIT ` + Math.min(200, Math.floor(Number(p.limit) || 50)) + ` OFFSET ` + Math.max(0, Math.floor(Number(p.offset) || 0));
      const rows = (await query(sql, params)).rows;
      return { ok: true, result: { objects: rows, count: rows.length }, undoable: false };
    });

  def('get_players', '在线真人列表（复用 wsServer playerPositions）',
    { type: 'object', properties: { onlineOnly: { type: 'boolean' } } },
    async (p, ctx) => {
      const list = onlineEntries('human');
      return { ok: true, result: { players: list, count: list.length }, undoable: false };
    });

  def('get_agents', '在线 Agent 列表 + 活跃度',
    { type: 'object', properties: { onlineOnly: { type: 'boolean' } } },
    async (p, ctx) => {
      const list = onlineEntries('agent');
      let registered = 0;
      try { registered = (await query(`SELECT count(*)::int AS n FROM agents WHERE active = true`, [])).rows[0].n; } catch (e) { /* 表缺列等 */ }
      return { ok: true, result: { agents: list, online: list.length, registered }, undoable: false };
    });

  def('get_npcs', 'NPC 列表（可按区域过滤）',
    { type: 'object', properties: { regionId: { type: 'string', maxLength: 60 } } },
    async (p, ctx) => {
      let rows;
      try {
        rows = p.regionId
          ? (await query(`SELECT id, name FROM custom_npcs WHERE region_id = $1 LIMIT 100`, [String(p.regionId)])).rows
          : (await query(`SELECT id, name FROM custom_npcs LIMIT 100`, [])).rows;
      } catch (e) { rows = []; }
      return { ok: true, result: { npcs: rows, count: rows.length }, undoable: false };
    });

  def('get_statistics', '在线/对象/事件/任务汇总（range: 1h|24h|7d）',
    { type: 'object', properties: { range: { type: 'string', enum: ['1h', '24h', '7d'] } } },
    async (p, ctx) => {
      const iv = p.range === '1h' ? '1 hour' : (p.range === '7d' ? '7 days' : '24 hours');
      const r = (await query(
        `SELECT count(*)::int AS events,
                count(DISTINCT actor_id)::int AS actors
           FROM world_events WHERE created_at >= NOW() - INTERVAL '` + iv + `'`, [])).rows[0];
      const t = (await query(`SELECT count(*)::int AS n FROM world_tasks_mini WHERE status = 'completed'`, []).catch(() => ({ rows: [{ n: 0 }] }))).rows[0];
      return { ok: true, result: { range: p.range || '24h', events: r.events, actors: r.actors, tasksCompleted: t.n }, undoable: false };
    });
}

/** playerPositions 安全读取（脚本进程里 wsServer 未启动 → 空表） */
function onlineEntries(kind) {
  try {
    const wsServer = require('../../websocket/wsServer');
    const map = typeof wsServer.getPlayerPositions === 'function' ? wsServer.getPlayerPositions() : null;
    if (!map || !map.forEach) return [];
    const out = [];
    map.forEach((entry, cid) => {
      if (!entry) return;
      const isAgent = entry.entityType === 'agent';
      if ((kind === 'agent') !== isAgent) return;
      out.push({
        connectionId: String(cid).slice(0, 24),
        characterId: entry.characterId ? String(entry.characterId).slice(0, 50) : null,
        name: entry.characterName ? String(entry.characterName).slice(0, 50) : null,
        position: entry.position || null,
        animMode: entry.animMode || null,
      });
    });
    return out.slice(0, 100);
  } catch (e) { return []; }
}

module.exports = { registerAll };
