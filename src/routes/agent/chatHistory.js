/**
 * AI Agent 接入 - 聊天历史路由（P4 d）
 * GET /chat/history?limit=20
 *
 * 用途：AI 断线重连后拉最近消息恢复上下文
 */

const express = require('express');
const router = express.Router();

const sessionRouter = require('./session');
const authenticateAgentToken = sessionRouter.authenticateAgentToken;
const chatLogService = require('../../agent/chatLogService');

// ==================== GET /chat/history ====================

router.get('/chat/history', authenticateAgentToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    // since：增量游标（2026-09-24）。客户端存 nextSince，下次带回来 → 每次只取新增消息。
    const since = Number(req.query.since) > 0 ? Math.floor(Number(req.query.since)) : null;
    const history = await chatLogService.getRecentHistory(limit, since);
    // nextSince = 本次返回的最大 id（只增不减；无新增时原样回传 since）——客户端不必自己算
    const nextSince = history.reduce((m, h) => Math.max(m, Number(h.id) || 0), since || 0);
    res.json({
      success: true,
      history,
      count: history.length,
      since,
      nextSince,
      order: since ? 'asc' : 'desc'
    });
  } catch (error) {
    console.error('[Agent] /chat/history 失败:', error);
    res.status(500).json({ error: '聊天历史查询失败', code: 'CHAT_HISTORY_FAILED' });
  }
});

module.exports = router;
