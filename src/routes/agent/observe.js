/**
 * AI Agent 接入 - 观察路由（P2）
 * GET /observe?radius=&include=&limit=&x=&y=&z=
 *
 * 鉴权：authenticateAgentToken（复用 session.js，双门 JWT+jti DB 权威）
 * 限频：每 Agent 1Hz（eco 档红线），超频 429
 * scope：必须有 observe（游客级白名单已含，缺失即拒）
 * 返回：{ world, self, entities, objects, portals, radius, limit, timestamp, sequence }
 */

const express = require('express');
const router = express.Router();

const observationService = require('../../agent/agentObservationService');
const sessionRouter = require('./session');
const authenticateAgentToken = sessionRouter.authenticateAgentToken;

// ==================== 1Hz 限频（per agentId，eco 档）====================

const OBSERVE_RATE_LIMIT_PER_SEC = 1;          // eco 档：每秒 1 次
const observeWindow = new Map();               // agentId -> [ts]

function rateLimitObserve(req, res, next) {
  const agentId = req.agent ? req.agent.id : 'unknown';
  const now = Date.now();
  const list = (observeWindow.get(agentId) || []).filter(ts => now - ts < 1000);
  if (list.length >= OBSERVE_RATE_LIMIT_PER_SEC) {
    const oldest = list[0];
    const retryAfterMs = 1000 - (now - oldest);
    return res.status(429).json({
      error: '观察请求过于频繁（eco 档限 1Hz）',
      retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      code: 'AGENT_OBSERVE_RATE_LIMITED'
    });
  }
  list.push(now);
  observeWindow.set(agentId, list);
  next();
}

// 定期清理过期窗口
setInterval(() => {
  const now = Date.now();
  for (const [id, list] of observeWindow.entries()) {
    const alive = list.filter(ts => now - ts < 1000);
    if (alive.length === 0) observeWindow.delete(id); else observeWindow.set(id, alive);
  }
}, 60 * 1000).unref();

// ==================== GET /observe ====================

router.get('/observe', authenticateAgentToken, rateLimitObserve, async (req, res) => {
  try {
    // scope 校验：必须有 observe
    const scopes = (req.agentJwt && req.agentJwt.scopes) || [];
    if (!scopes.includes('observe')) {
      return res.status(403).json({
        error: '缺少 observe scope',
        code: 'SCOPE_DENIED'
      });
    }

    // 解析 query 参数
    const opts = {
      radius: req.query.radius,
      limit: req.query.limit,
      include: req.query.include,
      x: req.query.x !== undefined ? Number(req.query.x) : undefined,
      y: req.query.y !== undefined ? Number(req.query.y) : undefined,
      z: req.query.z !== undefined ? Number(req.query.z) : undefined
    };

    const result = await observationService.observe(req.agent, req.agentSession, opts);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Agent] /observe 失败:', error);
    res.status(500).json({ error: 'observe 失败', code: 'OBSERVE_FAILED' });
  }
});

module.exports = router;
