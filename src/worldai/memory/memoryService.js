/**
 * memoryService —— World AI 持久记忆（AI World Brain · Phase 3 · 判据 P2-8）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§C.3⑯（表结构）+ §Phase 3 文件清单「三类记忆 CRUD + 召回 + 压缩 + 遗忘」。
 *
 * 三类 scope：world（世界级事实）/ plan（委托/规划级）/ feedback（人工批注）。
 * ★ 权威在 DB（P2-8 的"restart 后 recall 能取回"= 天然满足：任何进程读同一张表）。
 * 压缩/遗忘的定时任务属 Phase 4（与事件流一起做），本阶段只留 recall 的 TTL 过滤与封顶。
 */
'use strict';

const { query } = require('../../database/db');

const SCOPES = ['world', 'plan', 'feedback'];
const KINDS = ['fact', 'decision', 'lesson', 'preference', 'summary', 'metric_digest'];

/** 写一条记忆（截断 2000 字；importance 1~5） */
async function write(o) {
  const p = o || {};
  if (!p.worldId) return { ok: false, code: 'WORLD_REQUIRED', reason: '缺少 worldId' };
  if (SCOPES.indexOf(p.scope) < 0) return { ok: false, code: 'SCOPE_INVALID', reason: 'scope 必须是 ' + SCOPES.join('/') };
  if (KINDS.indexOf(p.kind) < 0) return { ok: false, code: 'KIND_INVALID', reason: 'kind 必须是 ' + KINDS.join('/') };
  const content = String(p.content || '').trim();
  if (!content) return { ok: false, code: 'CONTENT_REQUIRED', reason: '内容为空' };
  const imp = Math.min(5, Math.max(1, Math.floor(Number(p.importance) || 3)));
  const res = await query(
    `INSERT INTO world_memories (world_id, scope, subject_id, kind, content, importance, tags, source, plan_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [String(p.worldId), p.scope, p.subject_id ? String(p.subject_id).slice(0, 128) : null, p.kind,
      content.slice(0, 2000), imp, Array.isArray(p.tags) ? p.tags.map(String).slice(0, 10) : [],
      ['operator', 'planner', 'human'].indexOf(p.source) >= 0 ? p.source : 'operator',
      p.plan_id || null, p.expires_at || null]
  );
  return { ok: true, memory: res.rows[0] };
}

/**
 * 召回（结构化召回，不做向量——§C.7 结论：记忆量级几千条，结构化足够）。
 * @param {object} o { worldId, scope?, kind?, subjectId?, planId?, limit?, minImportance? }
 */
async function recall(o) {
  const p = o || {};
  if (!p.worldId) return { ok: false, code: 'WORLD_REQUIRED', reason: '缺少 worldId' };
  const params = [String(p.worldId)];
  let sql = `SELECT * FROM world_memories
              WHERE world_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`;
  if (p.scope) { params.push(p.scope); sql += ` AND scope = $${params.length}`; }
  if (p.kind) { params.push(p.kind); sql += ` AND kind = $${params.length}`; }
  if (p.subjectId) { params.push(String(p.subjectId)); sql += ` AND subject_id = $${params.length}`; }
  if (p.planId) { params.push(String(p.planId)); sql += ` AND plan_id = $${params.length}`; }
  if (Number(p.minImportance) > 0) { params.push(Math.floor(Number(p.minImportance))); sql += ` AND importance >= $${params.length}`; }
  sql += ` ORDER BY importance DESC, created_at DESC LIMIT ` + Math.min(50, Math.max(1, Math.floor(Number(p.limit) || 20)));
  const res = await query(sql, params);
  return { ok: true, items: res.rows || [] };
}

/** 删除（人工"这条记错了"） */
async function remove(worldId, id) {
  const res = await query(`DELETE FROM world_memories WHERE world_id = $1 AND id = $2 RETURNING id`, [String(worldId), String(id)]);
  return { ok: res.rows.length > 0, deleted: res.rows.length };
}

module.exports = { write, recall, remove, SCOPES, KINDS };
