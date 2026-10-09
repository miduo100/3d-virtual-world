/**
 * analyticsTools —— ⑦ 数据分析 6 个（AI World Brain · Phase 4 · §D.3⑦）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 全部 low 风险 / world:analyze scope；只读，优先读聚合表（§H.6 聚合优先）。
 * Phase 6 才有的表（活动/任务进度）查询失败时返回空集 + note，绝不 500。
 */
'use strict';

const { query } = require('../../database/db');
const verbRegistry = require('./verbRegistry');
const analytics = require('../perception/analytics');

function def(name, summary, params, impl) {
  verbRegistry.register({
    name, category: 'analytics', risk: 'low', reversible: false,
    scope: 'world:analyze', summary, params, impl,
  });
}

async function safeRows(sql, params, note) {
  try { return { rows: (await query(sql, params)).rows, note: null }; }
  catch (e) { return { rows: [], note: note + '（表未建或查询失败：属 Phase 6 范围）' }; }
}

function registerAll() {
  def('get_player_behavior', '真人行为统计（按事件类型聚合，可按日）',
    { type: 'object', properties: { day: { type: 'string', maxLength: 10 } } },
    async (p, ctx) => {
      const r = await analytics.behavior(ctx.worldId, 'human', p.day);
      return { ok: true, result: r, undoable: false };
    });

  def('get_agent_behavior', 'Agent 行为统计（按事件类型聚合，可按日）',
    { type: 'object', properties: { agentId: { type: 'string', maxLength: 100 }, day: { type: 'string', maxLength: 10 } } },
    async (p, ctx) => {
      const r = await analytics.behavior(ctx.worldId, 'agent', p.day);
      return { ok: true, result: r, undoable: false };
    });

  def('get_area_statistics', '区域日统计（读 world_metrics_daily 聚合）',
    { type: 'object', properties: { day: { type: 'string', maxLength: 10 } } },
    async (p, ctx) => {
      const r = await analytics.regionStats(ctx.worldId, p.day);
      return { ok: true, result: r, undoable: false };
    });

  def('get_activity_statistics', '活动参与统计（world_activity_participants 属 Phase 6）',
    { type: 'object', properties: { activityId: { type: 'string', maxLength: 64 }, day: { type: 'string', maxLength: 10 } } },
    async (p, ctx) => {
      const r = await safeRows(
        `SELECT activity_id, count(*)::int AS n FROM world_activity_participants
          WHERE ($1::varchar IS NULL OR activity_id = $1) GROUP BY 1 LIMIT 50`,
        [p.activityId ? String(p.activityId) : null], 'world_activity_participants');
      return { ok: true, result: { activities: r.rows, note: r.note }, undoable: false };
    });

  def('get_task_statistics', '任务完成统计（world_task_progress 属 Phase 6；world_tasks_mini 现查）',
    { type: 'object', properties: { taskId: { type: 'string', maxLength: 64 }, day: { type: 'string', maxLength: 10 } } },
    async (p, ctx) => {
      const mini = await safeRows(
        `SELECT status, count(*)::int AS n FROM world_tasks_mini GROUP BY 1`, [], 'world_tasks_mini');
      return { ok: true, result: { byStatus: mini.rows, note: mini.note }, undoable: false };
    });

  def('get_economy_statistics', '经济统计（orders 表，Phase 6 前数据量小）',
    { type: 'object', properties: { day: { type: 'string', maxLength: 10 } } },
    async (p, ctx) => {
      const params = [];
      let sql = `SELECT count(*)::int AS orders, COALESCE(sum(total_price), 0) AS revenue
                   FROM orders WHERE TRUE`;
      if (p.day) { params.push(String(p.day).slice(0, 10)); sql += ` AND created_at::date = $1::date`; }
      const r = await safeRows(sql, params, 'orders');
      const row = r.rows[0] || { orders: 0, revenue: 0 };
      return { ok: true, result: { orders: row.orders, revenue: Number(row.revenue) || 0, note: r.note }, undoable: false };
    });
}

module.exports = { registerAll };
