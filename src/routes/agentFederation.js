/**
 * AI Agent 接入 - 联邦传送接收端路由（P5，目标世界侧）
 * 挂载于 /api/agent/federation（src/server.js 一行挂载，独立于 /api/agent/v1）
 *
 * 端点：
 *   POST /teleport/accept   公开端点（handoffToken 自身 RS256 鉴权）
 *   GET  /info              本世界联邦信息（供 Agent 客户端发现）
 *
 * 红线：
 *   b. 不动 federation.js 的 /teleport/receive（人类 email 建号逻辑）
 *   c. 不创建本地 user/character，建 transient session（agent_transient_sessions 表）
 *   d. handoff token nonce 一次性消费
 *   e. handoff token ≤5min + iss/aud 校验
 */

const express = require('express');
const router = express.Router();

const agentTeleportService = require('../agent/agentTeleportService');
const agentConfigService = require('../agent/agentConfigService');
const agentAuth = require('../agent/agentAuth');

// ==================== 本地 securityCheck（等价 federation.js 的，不依赖其内部函数）====================

function localSecurityCheck(req, res, next) {
  // 红线 a：只读 federationSystem（不追加代码到 federationSystem.js）
  const federationSystem = require('./federation').getFederationSystem();
  if (!federationSystem) {
    return res.status(503).json({ success: false, error: '联邦系统未初始化' });
  }
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (federationSystem.isIpAllowed && !federationSystem.isIpAllowed(clientIp)) {
    return res.status(429).json({ success: false, error: '请求过于频繁，请稍后再试' });
  }
  next();
}

// ==================== POST /teleport/accept ====================

router.post('/teleport/accept', localSecurityCheck, async (req, res) => {
  try {
    // 前置：Agent JWT 密钥必须已配置（签发 transient JWT 需要）
    if (!agentAuth.isConfigured()) {
      return res.status(503).json({ success: false, error: 'Agent 功能未启用：缺少 AGENT_JWT_SECRET', code: 'AGENT_SECRET_MISSING' });
    }

    // 前置：总开关（红线：默认关，Agent 功能关闭时拒绝接收联邦传送）
    const config = await agentConfigService.getConfig();
    if (!config.agentEnabled) {
      return res.status(503).json({ success: false, error: 'Agent 接入未开放（agent_enabled=false）', code: 'AGENT_DISABLED_GLOBALLY' });
    }

    const { handoffToken } = req.body;
    if (!handoffToken || typeof handoffToken !== 'string') {
      return res.status(400).json({ success: false, error: '缺少 handoffToken', code: 'MISSING_HANDOFF_TOKEN' });
    }

    // 核心：验证 handoff token + nonce 消费 + 建 transient session + 签发本世界 transient JWT
    const result = await agentTeleportService.acceptTeleport(handoffToken);
    if (!result.ok) {
      const status = result.code === 'NONCE_REPLAY' ? 409
        : result.code === 'HANDOFF_TOKEN_EXPIRED' ? 403
        : result.code === 'SOURCE_WORLD_NOT_TRUSTED' ? 403
        : result.code === 'NOT_AGENT_HANDOFF' ? 400
        : 401;
      return res.status(status).json({ success: false, error: result.error, code: result.code });
    }

    res.json({
      success: true,
      message: `欢迎来自 ${result.sourceWorld.name} 的 Agent ${result.agentName}`,
      transientJwt: result.transientJwt,
      transientJti: result.transientJti,
      expiresAt: result.transientExpiresAt,
      agent: {
        id: result.agentId,
        name: result.agentName,
        avatarConfig: result.avatarConfig,
        homeWorldUrl: result.homeWorldUrl,
        transient: true
      },
      sourceWorld: result.sourceWorld,
      // 提示 Agent 客户端下一步：用 transientJwt 连本世界的 /ws/agent
      nextStep: {
        method: 'WS',
        url: buildWsUrl(req, '/ws/agent'),
        headers: { Authorization: 'Bearer ' + result.transientJwt }
      }
    });
  } catch (error) {
    console.error('[AgentFederation] accept 失败:', error.message);
    res.status(500).json({ success: false, error: '接收 Agent 传送失败' });
  }
});

// ==================== GET /info ====================

router.get('/info', localSecurityCheck, async (req, res) => {
  try {
    const federationSystem = require('./federation').getFederationSystem();
    if (!federationSystem) {
      return res.json({ success: true, agentEnabled: false, message: '联邦系统未初始化' });
    }
    const config = await agentConfigService.getConfig();
    res.json({
      success: true,
      worldId: federationSystem.worldId,
      worldName: federationSystem.worldName,
      worldUrl: federationSystem.worldUrl,
      agentEnabled: config.agentEnabled,
      acceptEndpoint: '/api/agent/federation/teleport/accept',
      wsEndpoint: '/ws/agent'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: '查询失败' });
  }
});

// ==================== 工具 ====================

function buildWsUrl(req, path) {
  const host = req.headers['host'] || req.get('host') || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'wss' : 'ws');
  return `${proto}://${host}${path}`;
}

module.exports = router;
