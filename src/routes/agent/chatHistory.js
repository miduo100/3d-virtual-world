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
    const history = await chatLogService.getRecentHistory(limit);
    res.json({
      success: true,
      history,
      count: history.length
    });
  } catch (error) {
    console.error('[Agent] /chat/history 失败:', error);
    res.status(500).json({ error: '聊天历史查询失败', code: 'CHAT_HISTORY_FAILED' });
  }
});

module.exports = router;
