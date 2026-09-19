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
const tierService = require('../../agent/agentTierService');
const agentConfigService = require('../../agent/agentConfigService');   // D：observe 采样率可配
const { AGENT_TIER_KEY } = require('../../agent/agentSchema');
const sessionRouter = require('./session');
const authenticateAgentToken = sessionRouter.authenticateAgentToken;

/**
 * P8：解析请求 tier（JWT payload 优先，缺省按会话兜底），挂到 req.tier 供后续中间件使用。
 * 必须在 authenticateAgentToken 之后执行（依赖 req.agentJwt / req.agentSession）。
 */
function resolveTier(req, res, next) {
  req.tier = tierService.resolveTier(req.agentJwt, req.agentSession);
  next();
}

// ==================== 限频（P8：按 tier 分级）====================
// Key Agent：默认 1 次/秒（P2 既定口径），可由 system_config `agent_observe_rate_key` 调高到 10 次/秒
//（缺陷 D：闭环跟随需要更高采样率；默认值 1 = 行为与修复前完全一致，向后兼容）
// 游客 Agent：1 次/2 秒（拉模式天然自限流，不请求服务器零开销；不受该键影响）

const OBSERVE_RATE_LIMIT_DEFAULT = 1;          // 默认 Key Agent：每秒 1 次
const observeWindow = new Map();               // agentId -> [ts]

/** 读取 Key 档采样率（热路径读 60s 缓存，未热则回落默认 1） */
function keyRatePerSec() {
  try {
    const c = agentConfigService.peekConfig();
    if (c && Number.isFinite(c.observeRateKey) && c.observeRateKey > 0) return c.observeRateKey;
  } catch (e) { /* ignore */ }
  return OBSERVE_RATE_LIMIT_DEFAULT;
}

function rateLimitObserve(req, res, next) {
  const tier = req.tier || AGENT_TIER_KEY;
  // 游客走 tierService 的专用限频（1 次/2s），Key Agent 走可配采样率
  if (tierService.isGuest(tier)) {
    const agentId = req.agent ? req.agent.id : 'unknown';
    const r = tierService.checkActionRate(tier, agentId, 'observe');
    if (!r.ok) {
      return res.status(429).json({
        error: `观察请求过于频繁（游客拉模式限 ${r.limit}）`,
        retryAfter: Math.max(1, Math.ceil(r.retryAfterMs / 1000)),
        code: 'GUEST_OBSERVE_RATE_LIMITED'
      });
    }
    return next();
  }

  const limit = keyRatePerSec();
  const agentId = req.agent ? req.agent.id : 'unknown';
  const now = Date.now();
  const list = (observeWindow.get(agentId) || []).filter(ts => now - ts < 1000);
  if (list.length >= limit) {
    const oldest = list[0];
    const retryAfterMs = 1000 - (now - oldest);
    return res.status(429).json({
      error: `观察请求过于频繁（当前限 ${limit}Hz，可用 agent_observe_rate_key 调整）`,
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

router.get('/observe', authenticateAgentToken, resolveTier, rateLimitObserve, async (req, res) => {
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
      // P8 红线 2：游客观察半径硬钳 30m（请求更大的值静默收敛，不报错）
      radius: tierService.clampObserveRadius(req.tier, req.query.radius),
      limit: req.query.limit,
      include: req.query.include,
      x: req.query.x !== undefined ? Number(req.query.x) : undefined,
      y: req.query.y !== undefined ? Number(req.query.y) : undefined,
      z: req.query.z !== undefined ? Number(req.query.z) : undefined
    };

    const result = await observationService.observe(req.agent, req.agentSession, opts);

    // 联测修复 C：observe 是拉模式客户端唯一且最频繁的"我还活着"信号，
    // 原口径下 HTTP 请求不刷新空闲时钟 → 纯拉模式客户端必在 5 分钟后被踢。
    // 懒加载避免 agentWsServer ⇄ 路由的循环依赖；WS 未启动时静默忽略。
    try { require('../../websocket/agentWsServer').touchActivityByAgent(req.agent.id); } catch (e) { /* ignore */ }

    res.json({ success: true, tier: req.tier, ...result });
  } catch (error) {
    console.error('[Agent] /observe 失败:', error);
    res.status(500).json({ error: 'observe 失败', code: 'OBSERVE_FAILED' });
  }
});

module.exports = router;
