/**
 * World AI Ops 路由（/api/world-ai/executions|approvals|analytics|snapshot|memories|events）
 * AI World Brain · Phase 4 · §D.2「工具账本 / 审批 / 感知」
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 经 worldAi.js 子路由挂载 → 继承 authenticateAdminToken（server.js 零改动，Phase 2b 先例）。
 * ★ World Tools 本身不是 REST（§D.1）；这里只暴露账本/审批/观测的管理面。
 */
'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../../database/db');
const { logAdminAction } = require('../../middleware/adminAuth');
const worldAiConfig = require('../config');
const toolJournal = require('../journal/toolJournal');
const executor = require('../runtime/executor');
const worldSnapshot = require('../perception/worldSnapshot');
const eventLog = require('../perception/eventLog');
const analytics = require('../perception/analytics');
const memoryService = require('../memory/memoryService');

function wId(req) { return req.query.worldId || null; }

// ── 工具账本 ──────────────────────────────────────────────────────────
router.get('/executions', async (req, res) => {
  try {
    const worldId = wId(req) || (await worldAiConfig.getConfig()).world_id;
    const rows = await toolJournal.list({
      worldId, planId: req.query.planId, toolName: req.query.tool,
      status: req.query.status, limit: req.query.limit,
    });
    res.json({ success: true, executions: rows });
  } catch (e) { res.status(500).json({ error: '读取账本失败: ' + e.message }); }
});

router.get('/executions/:id', async (req, res) => {
  try {
    const row = await toolJournal.findById(req.params.id);
    if (!row) return res.status(404).json({ error: '账本行不存在' });
    res.json({ success: true, execution: row });   // 管理员可见 before/after/undo 全文
  } catch (e) { res.status(500).json({ error: '读取账本失败: ' + e.message }); }
});

// POST /executions/:id/rollback（判据 P3-4）
router.post('/executions/:id/rollback', async (req, res) => {
  try {
    const r = await toolJournal.rollback(req.params.id, req.adminUser);
    if (!r.ok) return res.status(400).json({ success: false, code: r.code, reason: r.reason });
    try {
      await logAdminAction(req.adminUser.id, 'world_ai_execution_rollback', 'world_tool_executions',
        String(req.params.id), JSON.stringify({ tool: r.tool, undoKind: r.undoKind }), req.ip);
    } catch (e) { /* 审计失败不阻断 */ }
    res.json({ success: true, ...r });
  } catch (e) { res.status(500).json({ error: '回滚失败: ' + e.message }); }
});

// ── 审批（tool 级；plan 级在 worldAiPlan）─────────────────────────────
router.get('/approvals', async (req, res) => {
  try {
    const worldId = wId(req) || (await worldAiConfig.getConfig()).world_id;
    const params = [String(worldId)];
    let sql = `SELECT * FROM world_approvals WHERE world_id = $1`;
    if (req.query.status) { params.push(String(req.query.status)); sql += ` AND decision = $` + params.length; }
    else { sql += ` AND decision = 'pending'`; }
    sql += ` ORDER BY created_at ASC LIMIT 100`;
    const rows = (await query(sql, params)).rows;
    res.json({ success: true, approvals: rows });
  } catch (e) { res.status(500).json({ error: '读取审批失败: ' + e.message }); }
});

router.post('/approvals/:id/approve', async (req, res) => {
  try {
    const ar = (await query(`SELECT * FROM world_approvals WHERE id = $1`, [String(req.params.id)])).rows[0];
    if (!ar) return res.status(404).json({ error: '审批不存在' });
    if (ar.decision !== 'pending') return res.status(400).json({ code: 'ALREADY_DECIDED', error: '该审批已决定：' + ar.decision });
    const payload = ar.payload || {};
    const executionId = payload.executionId;
    if (!executionId) return res.status(400).json({ code: 'NO_EXECUTION', error: '该审批不指向工具执行（plan 级请走 /plans/:id/approve）' });
    await query(
      `UPDATE world_approvals SET decision='approved', decided_by=$2, decided_at=NOW(), comment=$3 WHERE id=$1`,
      [ar.id, req.adminUser.id, (req.body && req.body.comment) || null]
    );
    const r = await executor.resume(executionId, { decidedBy: req.adminUser.username });
    // 同步 plan step（若有）
    if (payload.planStepId) {
      if (r.ok) {
        await query(
          `UPDATE world_plan_steps SET status='done', execution_id=$2, result=$3::jsonb, finished_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [String(payload.planStepId), r.executionId, JSON.stringify(r.result || {})]
        );
      } else {
        await query(
          `UPDATE world_plan_steps SET status='failed', error=$2, finished_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [String(payload.planStepId), String((r.code || '') + ' ' + (r.reason || '')).slice(0, 500)]
        );
      }
    }
    try {
      await logAdminAction(req.adminUser.id, 'world_ai_tool_approve', 'world_approvals',
        String(ar.id), JSON.stringify({ tool: payload.tool, ok: r.ok, executionId }), req.ip);
    } catch (e) { /* ignore */ }
    res.json({ success: r.ok, code: r.code || null, reason: r.reason || null, execution: r.ok ? { id: r.executionId, result: r.result } : null });
  } catch (e) { res.status(500).json({ error: '审批执行失败: ' + e.message }); }
});

router.post('/approvals/:id/reject', async (req, res) => {
  try {
    const ar = (await query(`SELECT * FROM world_approvals WHERE id = $1`, [String(req.params.id)])).rows[0];
    if (!ar) return res.status(404).json({ error: '审批不存在' });
    if (ar.decision !== 'pending') return res.status(400).json({ code: 'ALREADY_DECIDED', error: '该审批已决定：' + ar.decision });
    await query(
      `UPDATE world_approvals SET decision='rejected', decided_by=$2, decided_at=NOW(), comment=$3 WHERE id=$1`,
      [ar.id, req.adminUser.id, (req.body && req.body.comment) || null]
    );
    const payload = ar.payload || {};
    if (payload.executionId) await toolJournal.rejectProposed(payload.executionId, (req.body && req.body.comment) || null);
    if (payload.planStepId) {
      await query(
        `UPDATE world_plan_steps SET status='rejected', error=$2, finished_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [String(payload.planStepId), '工具审批被驳回' + ((req.body && req.body.comment) ? '：' + String(req.body.comment).slice(0, 200) : '')]
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: '驳回失败: ' + e.message }); }
});

// ── 感知 ─────────────────────────────────────────────────────────────
router.get('/snapshot', async (req, res) => {
  try {
    const worldId = wId(req) || (await worldAiConfig.getConfig()).world_id;
    const r = await worldSnapshot.build({ worldId, maxBytes: req.query.maxBytes });
    res.json({ success: true, ...r });
  } catch (e) { res.status(500).json({ error: '构建快照失败: ' + e.message }); }
});

router.get('/analytics/regions', async (req, res) => {
  try {
    const worldId = wId(req) || (await worldAiConfig.getConfig()).world_id;
    const r = await analytics.regionStats(worldId, req.query.day);
    res.json({ success: true, ...r });
  } catch (e) { res.status(500).json({ error: '读取区域统计失败: ' + e.message }); }
});

router.post('/analytics/recompute', async (req, res) => {
  try {
    const worldId = wId(req) || (await worldAiConfig.getConfig()).world_id;
    const r = await analytics.recomputeDaily(worldId, req.body && req.body.day);
    res.json({ success: true, ...r });
  } catch (e) { res.status(500).json({ error: '重算失败: ' + e.message }); }
});

router.get('/memories', async (req, res) => {
  try {
    const worldId = wId(req) || (await worldAiConfig.getConfig()).world_id;
    const r = await memoryService.recall({
      worldId, scope: req.query.scope, kind: req.query.kind, limit: req.query.limit,
    });
    res.json({ success: r.ok, ...r });
  } catch (e) { res.status(500).json({ error: '读取记忆失败: ' + e.message }); }
});

// GET /events?tail=<seq>&limit= —— 事件流游标增量（P3-13 的管理面）
router.get('/events', async (req, res) => {
  try {
    const worldId = wId(req) || (await worldAiConfig.getConfig()).world_id;
    const r = await eventLog.tail(worldId, req.query.tail, req.query.limit);
    res.json({ success: true, ...r });
  } catch (e) { res.status(500).json({ error: '读取事件失败: ' + e.message }); }
});

module.exports = router;
