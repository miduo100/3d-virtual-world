/**
 * modelLod.js（路由）— 模型 LOD 三版方案 管理接口（仅管理后台使用）
 *
 * 挂载：app.use('/api/admin/model-lod', modelLodRoutes)
 * 鉴权：authenticateAdminToken（管理员 token）
 * 接口：
 *   GET  /status    扫描 uploaded_models + 磁盘，返回 总数/已有中模/已有低模/待生成 + 开关状态
 *   POST /generate  批量补齐中低模，body { limit } 默认 3、上限 10
 *
 * 约束：所有失败都返回 JSON（不抛栈），不影响其他接口
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');
const { scanStatus, batchGenerateMissing, batchRegenByConfig } = require('../services/modelLod');

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

router.use(authenticateAdminToken);

/** 读取 LOD 开关（缺省视为开启） */
async function readLodEnabled() {
  const r = await query(`SELECT config_value FROM system_config WHERE config_key = 'lod_enabled'`);
  return !r.rows.length || r.rows[0].config_value !== 'false';
}

// 状态：模型总数 / 已有中模 / 已有低模 / 待生成 + 开关状态
router.get('/status', async (req, res) => {
  try {
    const s = await scanStatus();
    let enabled = true;
    try {
      enabled = await readLodEnabled();
    } catch (e) {
      console.warn('[modelLod] 读取 lod_enabled 失败（按默认开启返回）:', e.message);
    }
    res.json({
      success: true,
      enabled,
      total: s.total,
      midCount: s.midCount,
      lowCount: s.lowCount,
      pending: s.pending,
      lowPolySkipped: s.lowPolySkipped,
      missingSource: s.missingSource,
      dir: s.dir,
      dbError: s.dbError || null,
    });
  } catch (error) {
    console.error('[modelLod] 获取状态失败:', error);
    res.status(500).json({ success: false, error: '获取 LOD 状态失败', details: error.message });
  }
});

// 批量生成：每批最多 limit 个（默认 3，上限 10）
router.post('/generate', async (req, res) => {
  try {
    const raw = parseInt((req.body || {}).limit, 10);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(raw) ? raw : DEFAULT_LIMIT));
    const r = await batchGenerateMissing({ limit });
    console.log(`[modelLod] 批量生成: limit=${limit} processed=${r.processed} succeeded=${r.succeeded} remaining=${r.remaining}`);
    res.json({ success: true, limit, ...r });
  } catch (error) {
    console.error('[modelLod] 批量生成失败:', error);
    res.status(500).json({ success: false, error: '批量生成失败', details: error.message });
  }
});

// 按当前压缩标准重生成违规的存量变体（每批最多 limit 个，默认 3，上限 10）
router.post('/regen', async (req, res) => {
  try {
    const raw = parseInt((req.body || {}).limit, 10);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(raw) ? raw : DEFAULT_LIMIT));
    const r = await batchRegenByConfig({ limit });
    console.log(`[modelLod] 按标准重生成: limit=${limit} processed=${r.processed} succeeded=${r.succeeded} remaining=${r.remaining}`);
    res.json({ success: true, limit, ...r });
  } catch (error) {
    console.error('[modelLod] 按标准重生成失败:', error);
    res.status(500).json({ success: false, error: '按标准重生成失败', details: error.message });
  }
});

module.exports = router;
