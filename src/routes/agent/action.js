/**
 * AI Agent 接入 - 行动路由（P4 b · HTTP 备用入口）
 * POST /action
 *
 * 主入口为 WS ACTION 消息（更实时），HTTP 入口用于：
 *   - 简单 Agent 客户端（不支持 WS）的 say/rotate 等瞬时动作
 *   - 自动化测试用例
 *
 * 鉴权：authenticateAgentToken（复用 session.js）
 */

const express = require('express');
const router = express.Router();

const sessionRouter = require('./session');
const authenticateAgentToken = sessionRouter.authenticateAgentToken;
const agentActionService = require('../../agent/agentActionService');

// ==================== POST /action ====================

router.post('/action', authenticateAgentToken, async (req, res) => {
  try {
    // HTTP 入口没有 connectionId（非 WS），无法支持持续移动类动作
    // 仅支持瞬时动作：say / rotate
    const action = req.body && req.body.action;
    if (!['say', 'rotate'].includes(action)) {
      return res.status(400).json({
        error: 'HTTP /action 仅支持 say / rotate 瞬时动作；移动类请用 WS ACTION',
        code: 'HTTP_ACTION_UNSUPPORTED'
      });
    }

    // HTTP 入口无法获取 connectionId（Agent 未通过 WS 连接）；
    // 此处仅做参数校验与 scope 检查，真正的执行需 Agent 在线 WS 才能广播 CHAT
    // → 返回 501 提示 Agent 改用 WS（保持服务端权威移动的一致性）
    if (action === 'say') {
      return res.status(501).json({
        error: 'say 动作必须通过 WS ACTION 发起（需要在线 playerPositions 上下文）',
        code: 'WS_REQUIRED'
      });
    }
    // rotate 也需要 connectionId 才能写入 playerPositions，同样引导走 WS
    return res.status(501).json({
      error: '行动动作必须通过 WS ACTION 发起（服务端权威写入 playerPositions）',
      code: 'WS_REQUIRED'
    });
  } catch (error) {
    console.error('[Agent] /action 失败:', error);
    res.status(500).json({ error: 'action 失败', code: 'ACTION_FAILED' });
  }
});

module.exports = router;
