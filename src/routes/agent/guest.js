/**
 * AI Agent 接入 - 游客临时票路由（P8 拉模式）
 * POST /guest/session —— 公开端点，无需 API Key
 *
 * 设计前提（用户定稿）：上线初期真正的风险是"没人来"而非"滥用"。
 * 拉模式天然自限流：不请求服务器零开销，请求频率被限频钳死，滥用最坏情况有上界。
 * API Key 因此升级为"实时推流特权"凭证，而不是进门凭证。
 *
 * 防滥用四件套（全为低成本件，先上便宜的，观察后加码）：
 *   ① 每 IP 签票 10 次/小时
 *   ② 每 IP 并发 1 连接（WS 侧 agentWsServer 执行）
 *   ③ 动作限频（observe 1/2s、say 1/5s、移动类 1/2s）
 *   ④ 空闲超时踢出（复用既有 AGENT_IDLE_TIMEOUT_MINUTES，默认 5min）
 * 共享 max_agents 总闸，不另设游客配额。
 *
 * 红线：游客永不获得推流（SUBSCRIBE 拒绝）与 30m 以上观察半径。
 */

const express = require('express');
const router = express.Router();

const agentAuth = require('../../agent/agentAuth');
const tierService = require('../../agent/agentTierService');
const transientSessionManager = require('../../agent/agentTransientSessionManager');
const agentConfigService = require('../../agent/agentConfigService');
const agentSchema = require('../../agent/agentSchema');
const logger = require('../../services/logger');
// v2-6（2026-09-19 用户决策 D3-A+）：**IP 口径只允许有一处权威实现**。
// 本文件原先自带一份 `clientIp()`，取 X-Forwarded-For 的**第一段**——与
// `middleware/clientIp.js` 的"X-Real-IP 优先 → XFF 最后一段"口径**相反**
// （D2 联测修复的成果：单层反代下最后一段才是我们代理看到的真实对端）；
// 且在本地因 `req.ip` 恒有值 → 那个 XFF 分支**不可达**（死代码）。
// 风险：一旦被复制到别的端点，就变成"客户端伪造 XFF 第一段绕开每 IP 限流"
// （游客 10 张票/小时、每 IP 1 连接）——与 D2 修复方向完全相反。
const clientIp = require('../../middleware/clientIp');

// ==================== POST /guest/session ====================

router.post('/guest/session', async (req, res) => {
  const ip = clientIp.resolveClientIp(req);
  try {
    // 0) 前置：独立密钥（缺则全部 Agent 功能不可用）
    if (!agentAuth.isConfigured()) {
      return res.status(503).json({
        error: 'Agent 功能未启用：缺少 AGENT_JWT_SECRET 配置',
        code: 'AGENT_SECRET_MISSING'
      });
    }

    // 1) 前置：总开关（红线 6：默认关）
    const config = await agentConfigService.getConfig();
    if (!config.agentEnabled) {
      return res.status(503).json({
        error: 'Agent 接入未开放（agent_enabled=false）',
        code: 'AGENT_DISABLED_GLOBALLY'
      });
    }

    // 2) 签票限流：每 IP 每小时 10 次
    const ticket = tierService.checkTicketRate(ip);
    if (!ticket.ok) {
      logger.access({ kind: 'ticket', result: 'rate_limited', ip });
      return res.status(429).json({
        error: '签票过于频繁，请稍后再试',
        retryAfter: ticket.retryAfterSec,
        code: 'GUEST_TICKET_RATE_LIMITED'
      });
    }

    // 3) 签发游客身份 + 30min 临时票
    const { agentId, agentName } = agentAuth.buildGuestIdentity();
    const worldId = await agentAuth.getWorldId();
    const { token, jti, expiresAt } = agentAuth.issueGuestAgentJwt({ agentId, agentName, worldId });
    await transientSessionManager.createGuestSession({ jti, agentId, agentName, expiresAt });

    logger.access({ kind: 'ticket', result: 'issued', agentId, ip, tier: agentSchema.AGENT_TIER_GUEST });
    logger.audit('guest_ticket_issued', { agentId, agentName, jti, ip, expiresAt });

    res.json({
      success: true,
      token,
      tokenType: 'Bearer',
      tier: agentSchema.AGENT_TIER_GUEST,
      mode: 'pull',
      expiresIn: agentAuth.GUEST_SESSION_TTL_SECONDS,
      expiresAt,
      agent: { id: agentId, name: agentName, scopes: agentSchema.AGENT_SCOPES },
      tierInfo: tierService.describeTier(agentSchema.AGENT_TIER_GUEST),
      ticketRemaining: ticket.remaining
    });
  } catch (error) {
    console.error('[Agent] 游客签票失败:', error);
    logger.opsError('游客签票失败', { ip, error: error.message });
    res.status(500).json({ error: '游客签票失败' });
  }
});

module.exports = router;
