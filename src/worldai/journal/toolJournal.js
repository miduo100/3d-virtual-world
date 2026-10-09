/**
 * toolJournal —— 工具执行账本（AI World Brain · Phase 4 · §C.3⑤ + §H.1 第 6 层）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§C.3⑤ 表结构 + §Phase 4 文件清单「before/after/undo 记账 + 事务回滚（判据 P3-4）」。
 *
 * 四条纪律：
 *   ① 每次工具执行一行，**被拒也要落行**（status='denied'，判据 P3-9）；被拒行是预算与审计的一部分。
 *   ② 执行前 before_state（新建类 = null）→ 执行后 after_state + undo_payload（结构化逆操作，不是 SQL）。
 *   ③ 回滚 = 事务：undo 应用与账本状态更新同生共死（§3.2-11：undo 失败绝不静默半回滚）。
 *   ④ 幂等键 = plan_step_id（P3-5）：succeeded → 直接复用；proposed → 返回 AWAITING_APPROVAL。
 */
'use strict';

const { query, pool } = require('../../database/db');

const INSERT_COLS = `world_id, plan_id, plan_step_id, tool_name, params, risk_tier, status,
  before_state, after_state, undo_payload, undoable, approval_id, actor, reason, error, result, latency_ms`;

function rowOf(r) { return (r && r.rows && r.rows[0]) || null; }

/** 开一行 executing 账本（before_state 由调用方给：新建类传 null） */
async function startExecution(o) {
  const r = await query(
    `INSERT INTO world_tool_executions (` + INSERT_COLS + `)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'executing',$7::jsonb,NULL,NULL,false,NULL,$8,$9,NULL,NULL,NULL)
     RETURNING *`,
    [String(o.worldId), o.planId || null, o.planStepId || null, String(o.toolName),
      JSON.stringify(o.params || {}), String(o.riskTier || 'low'),
      o.beforeState === undefined ? null : JSON.stringify(o.beforeState),
      String(o.actor || 'world_ai:runtime'), o.reason || null]
  );
  return rowOf(r);
}

/** 成功收尾：after/undo/result 一次写入 */
async function finishSuccess(id, o) {
  const r = await query(
    `UPDATE world_tool_executions
        SET status='succeeded', after_state=$2::jsonb, undo_payload=$3::jsonb, undoable=$4::boolean,
            result=$5::jsonb, latency_ms=$6, finished_at=NOW()
      WHERE id=$1 RETURNING *`,
    [id, JSON.stringify(o.afterState || null), o.undo ? JSON.stringify(o.undo) : null,
      o.undoable === true, JSON.stringify(o.result || {}), Math.max(0, Number(o.latencyMs) || 0)]
  );
  return rowOf(r);
}

/** 失败收尾 */
async function finishFail(id, error, latencyMs) {
  const r = await query(
    `UPDATE world_tool_executions
        SET status='failed', error=$2, latency_ms=$3, finished_at=NOW()
      WHERE id=$1 RETURNING *`,
    [id, String(error || '').slice(0, 1000), Math.max(0, Number(latencyMs) || 0)]
  );
  return rowOf(r);
}

/** 被拒也要落行（P3-9）：validation / 预算 / 守卫拒绝统一走这里 */
async function markDenied(o) {
  const r = await query(
    `INSERT INTO world_tool_executions (` + INSERT_COLS + `)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'denied',NULL,NULL,NULL,false,NULL,$7,$8,$9,NULL,NULL)
     RETURNING *`,
    [String(o.worldId), o.planId || null, o.planStepId || null, String(o.toolName),
      JSON.stringify(o.params || {}), String(o.riskTier || 'low'),
      String(o.actor || 'world_ai:runtime'), o.reason || null, String(o.error || '').slice(0, 1000)]
  );
  return rowOf(r);
}

/** 审批流：execution 停在 proposed，等人工（P3-7） */
async function markProposed(id, approvalId) {
  const r = await query(
    `UPDATE world_tool_executions SET status='proposed', approval_id=$2 WHERE id=$1 RETURNING *`,
    [id, approvalId || null]
  );
  return rowOf(r);
}

async function approveProposed(id) {
  const r = await query(
    `UPDATE world_tool_executions SET status='approved' WHERE id=$1 AND status='proposed' RETURNING *`,
    [id]
  );
  return rowOf(r);
}

async function rejectProposed(id, comment) {
  const r = await query(
    `UPDATE world_tool_executions SET status='denied', error=$2, finished_at=NOW()
      WHERE id=$1 AND status='proposed' RETURNING *`,
    [id, '审批驳回' + (comment ? '：' + String(comment).slice(0, 300) : '')]
  );
  return rowOf(r);
}

/** 幂等查询（P3-5）：同一 plan_step_id 的 succeeded / proposed 行 */
async function findByIdempotentKey(planStepId) {
  if (!planStepId) return null;
  const r = await query(
    `SELECT * FROM world_tool_executions
      WHERE plan_step_id = $1 AND status IN ('succeeded','proposed')
      ORDER BY id DESC LIMIT 1`,
    [String(planStepId)]
  );
  return rowOf(r);
}

async function findById(id) {
  const r = await query(`SELECT * FROM world_tool_executions WHERE id = $1`, [Number(id)]);
  return rowOf(r);
}

/** 列表（worldAiOps 路由用） */
async function list(o) {
  const p = o || {};
  const params = [String(p.worldId)];
  let sql = `SELECT id, world_id, plan_id, plan_step_id, tool_name, risk_tier, status, undoable,
                    approval_id, actor, reason, error, latency_ms, created_at, finished_at
               FROM world_tool_executions WHERE world_id = $1`;
  if (p.planId) { params.push(String(p.planId)); sql += ` AND plan_id = $` + params.length; }
  if (p.toolName) { params.push(String(p.toolName)); sql += ` AND tool_name = $` + params.length; }
  if (p.status) { params.push(String(p.status)); sql += ` AND status = $` + params.length; }
  sql += ` ORDER BY id DESC LIMIT ` + Math.min(200, Math.max(1, Math.floor(Number(p.limit) || 50)));
  const r = await query(sql, params);
  return r.rows || [];
}

/** 每日工具计数（budget.js 用；查表不查内存，§H.10.5） */
async function countToday(worldId) {
  const r = await query(
    `SELECT count(*)::int AS n FROM world_tool_executions
      WHERE world_id = $1 AND created_at >= date_trunc('day', NOW())`,
    [String(worldId)]
  );
  return (rowOf(r) || { n: 0 }).n;
}

/**
 * 回滚一条执行（判据 P3-4）。事务：undo 应用与账本状态同生共死。
 * undo_payload 结构（本阶段 4 种）：
 *   {kind:'delete_world_object', id}
 *   {kind:'delete_region', worldId, regionKey}
 *   {kind:'restore_world_object', id, cols:{position_x,...}}   —— 改动类恢复前置值
 *   {kind:'restore_region', id, cols:{name,...}}
 */
async function rollback(id, admin) {
  const exec = await findById(id);
  if (!exec) return { ok: false, code: 'EXECUTION_NOT_FOUND', reason: '账本行不存在：' + id };
  if (exec.status !== 'succeeded') {
    return { ok: false, code: 'NOT_ROLLBACKABLE', reason: '只有 succeeded 的执行可回滚，当前 status=' + exec.status };
  }
  if (exec.undoable === false || !exec.undo_payload) {
    return { ok: false, code: 'NOT_UNDOABLE', reason: '该工具不可自动回滚（删除类请走审计记录人工处理）' };
  }
  const undo = exec.undo_payload;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (undo.kind === 'delete_world_object') {
      const del = await client.query(`DELETE FROM world_objects WHERE id = $1 RETURNING id`, [Number(undo.id)]);
      if (!del.rows.length) throw new Error('undo 目标对象已不存在：#' + undo.id);
    } else if (undo.kind === 'delete_region') {
      const del = await client.query(
        `DELETE FROM world_regions WHERE world_id = $1 AND region_key = $2 RETURNING region_key`,
        [String(undo.worldId), String(undo.regionKey)]);
      if (!del.rows.length) throw new Error('undo 目标区域已不存在：' + undo.regionKey);
    } else if (undo.kind === 'restore_world_object' || undo.kind === 'restore_region') {
      const cols = undo.cols || {};
      const keys = Object.keys(cols);
      if (!keys.length) throw new Error('undo restore 缺少 cols');
      const sets = [];
      const params = [];
      keys.forEach((k) => { params.push(cols[k]); sets.push(k + ' = $' + params.length); });
      params.push(Number(undo.id));
      const table = undo.kind === 'restore_region' ? 'world_regions' : 'world_objects';
      const upd = await client.query(
        `UPDATE ` + table + ` SET ` + sets.join(', ') + ` WHERE id = $` + params.length + ` RETURNING id`,
        params);
      if (!upd.rows.length) throw new Error('undo 目标行已不存在：#' + undo.id);
    } else {
      throw new Error('未知 undo_payload.kind：' + undo.kind);
    }
    await client.query(
      `UPDATE world_tool_executions SET status='rolled_back', finished_at=NOW() WHERE id=$1`, [exec.id]);
    await client.query('COMMIT');
    return { ok: true, executionId: exec.id, tool: exec.tool_name, undoKind: undo.kind };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* 已回滚 */ }
    return { ok: false, code: 'ROLLBACK_FAILED', reason: '回滚失败并已整体回退（无半成品）：' + e.message };
  } finally {
    client.release();
  }
}

module.exports = {
  startExecution, finishSuccess, finishFail,
  markDenied, markProposed, approveProposed, rejectProposed,
  findByIdempotentKey, findById, list, countToday, rollback,
};
