/**
 * worldFeedback —— 真人反馈入口（POST /api/world-feedback）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * Phase 7 · 判据 P6-12。**玩家 JWT**（不是管理员）：反馈来自真人玩家，
 * 但内容会进入下一轮规划的 [MEMORY] 段，因此按「不可信内容」处理（feedbackTools 内剥离注入句式）。
 * 写请求同时挂 apiWriteGuard（server.js 挂载行 policy=user）与路由内 authenticateToken（纵深防御）。
 * GET /feedback 是管理员视角的只读回读（挂在 worldAiOps 之外的独立前缀，避免混进管理员路由）。
 */
'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { authenticateAdminToken } = require('../../middleware/adminAuth');
const feedbackTools = require('../tools/feedbackTools');
const worldAiConfig = require('../config');

function myId(req) {
  return req.user && req.user.userId ? String(req.user.userId) : null;
}

// POST /api/world-feedback  { content, category?, regionKey? }（玩家 JWT）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const uid = myId(req);
    if (!uid) return res.status(401).json({ success: false, error: '未授权：缺少玩家 token' });
    const cfg = await worldAiConfig.getConfig();
    if (!cfg) return res.status(503).json({ success: false, error: 'World AI 未初始化' });
    const r = await feedbackTools.submit({
      worldId: cfg.world_id,
      userId: uid,
      content: req.body && req.body.content,
      category: req.body && req.body.category,
      regionKey: req.body && req.body.regionKey,
    });
    res.status(r.ok ? 200 : 400).json({ success: r.ok, ...r });
  } catch (e) {
    console.error('[world-feedback] 提交失败:', e.message);
    res.status(500).json({ success: false, error: '反馈提交失败' });
  }
});

// GET /api/world-feedback?limit= —— 管理员只读回读（验收与调试）
router.get('/', authenticateAdminToken, async (req, res) => {
  try {
    const cfg = await worldAiConfig.getConfig();
    const r = await feedbackTools.recall(cfg ? cfg.world_id : null, req.query.limit);
    res.json({ success: true, items: r.items || [] });
  } catch (e) {
    console.error('[world-feedback] 读取失败:', e.message);
    res.status(500).json({ success: false, error: '读取反馈失败' });
  }
});

module.exports = router;