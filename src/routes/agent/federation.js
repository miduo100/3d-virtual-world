/**
 * AI Agent 接入 - 联邦传送路由（P5，Agent 客户端调用方）
 * 挂载于 /api/agent/v1/federation（经 src/routes/agent/index.js 挂载）
 *
 * 端点：
 *   POST /federation/teleport/prepare  Agent JWT 鉴权，发起跨世界传送
 *   GET  /federation/worlds           列出可传送的已信任目标世界
 *   GET  /federation/status           查 Agent 自己的传送权限
 *
 * 红线：
 *   - 不在 AGENT_SCOPES 加 teleport scope（那是世界内动作）；联邦传送走独立路由 + can_teleport 字段
 *   - 不动 federation.js 的人类传送路由（红线 b）
 *   - payload principalType:'agent'，不建本地 user/character（红线 c）
 */

const express = require('express');
const router = express.Router();

const { authenticateAgentToken } = require('./session');
const agentTeleportService = require('../../agent/agentTeleportService');

// ==================== POST /teleport/prepare ====================

router.post('/teleport/prepare', authenticateAgentToken, async (req, res) => {
  try {
    const { targetWorldId, context } = req.body;
    if (!targetWorldId || typeof targetWorldId !== 'string') {
      return res.status(400).json({ success: false, error: '缺少 targetWorldId', code: 'MISSING_TARGET_WORLD' });
    }

    // 红线3：agent.can_teleport 必须为 true（管理员显式开启）
    if (req.agent.can_teleport !== true) {
      return res.status(403).json({
        success: false,
        error: 'Agent 未获授权使用联邦传送（can_teleport=false）',
        code: 'AGENT_TELEPORT_NOT_PERMITTED'
      });
    }

    const result = await agentTeleportService.prepareTeleport(req.agent, targetWorldId, context || {});

    res.json({
      success: true,
      handoffToken: result.handoffToken,
      nonce: result.nonce,
      targetWorldUrl: result.targetWorldUrl,
      targetWorldName: result.targetWorldName,
      targetWorldId: result.targetWorldId,
      expiresAt: result.expiresAt,
      // 提示 Agent 客户端下一步：带 handoffToken 调目标世界的 POST /api/agent/federation/teleport/accept
      nextStep: {
        method: 'POST',
        url: result.targetWorldUrl.replace(/\/$/, '') + '/api/agent/federation/teleport/accept',
        body: { handoffToken: result.handoffToken }
      }
    });
  } catch (error) {
    const status = error.code === 'AGENT_TELEPORT_NOT_PERMITTED' ? 403
      : error.code === 'TARGET_WORLD_NOT_TRUSTED' ? 404 : 500;
    console.error('[AgentFederation] prepare 失败:', error.message);
    res.status(status).json({ success: false, error: error.message, code: error.code || 'PREPARE_FAILED' });
  }
});

// ==================== GET /worlds ====================

router.get('/worlds', authenticateAgentToken, async (req, res) => {
  try {
    // 红线 a：只读 federationSystem.trustedWorlds
    const federationSystem = require('../../routes/federation').getFederationSystem();
    if (!federationSystem) {
      return res.json({ success: true, worlds: [] });
    }
    const worlds = Array.from(federationSystem.trustedWorlds.values()).map(w => ({
      id: w.worldId,
      name: w.worldName,
      url: w.worldUrl
    }));
    res.json({ success: true, worlds, canTeleport: req.agent.can_teleport === true });
  } catch (error) {
    console.error('[AgentFederation] worlds 查询失败:', error.message);
    res.status(500).json({ success: false, error: '查询失败' });
  }
});

// ==================== GET /status ====================

router.get('/status', authenticateAgentToken, async (req, res) => {
  res.json({
    success: true,
    canTeleport: req.agent.can_teleport === true,
    homeWorldUrl: req.agent.home_world_url || null,
    agentId: req.agent.id,
    agentName: req.agent.name
  });
});

module.exports = router;
