/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 维护工具脚本 API 路由（主入口）
 * 管理后台"维护工具"菜单下的所有后台接口
 * 
 * 行数: ~170 行，符合 ≤500 行规范
 * 脚本逻辑在 adminMaintenanceScripts.js 中
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');
const scripts = require('./adminMaintenanceScripts');

router.use(authenticateAdminToken);

// ==================== 通用函数 ====================

async function logExecution(scriptId, scriptLabel, category, status, result, affectedRows, errorMsg) {
  try {
    await query(`
      INSERT INTO maintenance_logs (script_id, script_label, category, status, result_summary, result_detail, affected_rows, error_message, finished_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    `, [scriptId, scriptLabel, category, status, result.summary || null,
        result.detail ? JSON.stringify(result.detail) : null,
        affectedRows || 0, errorMsg || null]);
  } catch (e) { console.error('维护日志记录失败:', e.message); }
}

async function updateLog(scriptId, status, result, affectedRows, errorMsg) {
  try {
    await query(`
      UPDATE maintenance_logs SET status=$1, result_summary=$2, result_detail=$3,
        affected_rows=$4, error_message=$5, finished_at=NOW()
      WHERE script_id=$6 AND status='running' AND finished_at IS NULL
      ORDER BY started_at DESC LIMIT 1
    `, [status, result.summary || null, result.detail ? JSON.stringify(result.detail) : null,
        affectedRows || 0, errorMsg || null, scriptId]);
  } catch (e) { console.error('更新维护日志失败:', e.message); }
}

// 包装脚本执行，统一错误处理
async function runScript(handler, res, scriptId) {
  try {
    const result = await handler(logExecution, updateLog);
    res.json(result);
  } catch (error) {
    console.error(`脚本 [${scriptId}] 执行失败:`, error);
    await updateLog(scriptId, 'error', { summary: '执行失败' }, 0, error.message);
    res.status(500).json({ error: error.message });
  }
}

// ==================== 脚本执行路由 ====================

router.post('/cleanup-invalid-model-path', (req, res) =>
  runScript(scripts.cleanupInvalidModelPath, res, scripts.SCRIPT_IDS.CLEANUP_MODEL_PATH));

router.post('/check-broken-references', (req, res) =>
  runScript(scripts.checkBrokenReferences, res, scripts.SCRIPT_IDS.CHECK_REFERENCES));

router.post('/cleanup-orphan-uploads', (req, res) => {
  const dryRun = req.body.confirm !== true;
  runScript((log, update) => scripts.cleanupOrphanUploads(log, update, dryRun), res, scripts.SCRIPT_IDS.CLEANUP_UPLOADS);
});

router.post('/cleanup-orphan-objects', (req, res) =>
  runScript(scripts.cleanupOrphanObjects, res, scripts.SCRIPT_IDS.CLEANUP_ORPHAN_OBJECTS));

router.post('/refresh-geometry-buildings', (req, res) =>
  runScript(scripts.refreshGeometryBuildings, res, scripts.SCRIPT_IDS.REFRESH_GEOMETRY));

router.post('/verify-db-schema', (req, res) =>
  runScript(scripts.verifyDbSchema, res, scripts.SCRIPT_IDS.VERIFY_DB));

// ==================== 日志查询 ====================

router.get('/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const scriptId = req.query.script_id;
    let sql = `SELECT * FROM maintenance_logs`;
    const params = [];
    if (scriptId) { sql += ` WHERE script_id = $1`; params.push(scriptId); }
    sql += ` ORDER BY started_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    const result = await query(sql, params);
    res.json({ logs: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/last-run/:scriptId', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM maintenance_logs WHERE script_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [req.params.scriptId]
    );
    res.json(result.rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/scripts-list', async (req, res) => {
  try {
    const list = scripts.SCRIPTS_LIST.map(s => ({ ...s }));
    for (const s of list) {
      const lastRun = await query(
        `SELECT status, started_at, result_summary FROM maintenance_logs WHERE script_id = $1 ORDER BY started_at DESC LIMIT 1`,
        [s.id]
      );
      s.lastRun = lastRun.rows[0] || null;
    }
    res.json({ scripts: list });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
