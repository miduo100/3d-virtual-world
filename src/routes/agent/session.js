/**
 * AI Agent 接入 - 会话路由（P1）
 * POST /session          API Key → 短期 Agent JWT
 * GET  /me               当前 Agent 信息 + avatar + scope
 * POST /session/revoke   吊销当前会话
 * 全部挂在 /api/agent/v1（独立于用户 JWT，红线：不与 /api/auth/* 混用）
 */

const express = require('express');
const router = express.Router();

const agentAuth = require('../../agent/agentAuth');
const agentManager = require('../../agent/agentManager');
const agentSessionManager = require('../../agent/agentSessionManager');
const permissionService = require('../../agent/agentPermissionService');
const agentConfigService = require('../../agent/agentConfigService');
const logger = require('../../services/logger');
// v2-6（2026-09-19 用户决策 D3-A+）：IP 口径统一走 middleware/clientIp（唯一权威实现）。
// 原先这里自带 `req.ip || XFF 第一段` 的兜底，与 guest.js 同源、口径相反（且因 req.ip 恒有值而不可达）
// —— 一并合并，避免留下第二个"取 XFF 第一段"的复制源（那会被用来伪造绕过每 IP 限流）。
const clientIp = require('../../middleware/clientIp');
const {
  extractBearerToken,
  isValidApiKeyFormat,
  SESSION_RATE_LIMIT_PER_MIN
} = require('../../agent/agentSchema');

// ==================== IP 限流（内存滑动窗口，10次/分钟）====================
// 参考 loginRateLimiter 模式；Agent session 不做账号锁定（Key 是 64 位随机数，无暴破意义）

const ipWindow = new Map(); // ip -> [ts]

function rateLimitSession(req, res, next) {
  const ip = clientIp.resolveClientIp(req);
  const now = Date.now();
  const list = (ipWindow.get(ip) || []).filter(ts => now - ts < 60000);
  if (list.length >= SESSION_RATE_LIMIT_PER_MIN) {
    return res.status(429).json({
      error: '请求过于频繁，请稍后再试',
      retryAfter: 60,
      code: 'AGENT_SESSION_RATE_LIMITED'
    });
  }
  list.push(now);
  ipWindow.set(ip, list);
  next();
}

// 定期清理
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of ipWindow.entries()) {
    const alive = list.filter(ts => now - ts < 60000);
    if (alive.length === 0) ipWindow.delete(ip); else ipWindow.set(ip, alive);
  }
}, 5 * 60 * 1000).unref();

// ==================== 配置初始化（惰性，仅一次）====================

let defaultsPromise = null;
function ensureDefaults() {
  if (!defaultsPromise) {
    defaultsPromise = agentConfigService.ensureDefaultConfig().catch(e => {
      console.warn('[Agent] 默认配置初始化失败:', e.message);
    });
  }
  return defaultsPromise;
}

// ==================== Agent JWT 认证中间件 ====================

async function authenticateAgentToken(req, res, next) {
  if (!agentAuth.isConfigured()) {
    return res.status(503).json({ error: 'Agent 功能未启用：缺少 AGENT_JWT_SECRET 配置', code: 'AGENT_SECRET_MISSING' });
  }
  const token = extractBearerToken(req.headers['authorization']);
  if (!token) {
    return res.status(401).json({ error: '未授权：缺少 Agent token', code: 'AGENT_TOKEN_MISSING' });
  }

  // 第一道门：JWT 验签
  // 状态码口径（v2-2，2026-09-19 用户决策 D2-A；**WS 侧 agentWsServer.FORBIDDEN_UPGRADE_CODES 与之逐项一致**）：
  //   401 = 凭据缺失/无效（缺 token、签名错、principalType 不符）
  //   403 = 凭据有效但会话或身份无权（JWT 过期、无会话、已吊销/过期、Agent 停用）
  const verified = agentAuth.verifyAgentJwt(token);
  if (!verified.ok) {
    const status = verified.error === 'token_expired' ? 403 : 401;
    return res.status(status).json({ error: `无效的 Agent token: ${verified.error}`, code: verified.error.toUpperCase() });
  }
  const payload = verified.payload;

  // 第二道门：session（jti）DB 权威校验——吊销/过期即拒
  const sessionCheck = await agentSessionManager.verifySession(payload.jti);
  if (!sessionCheck.ok) {
    return res.status(403).json({ error: `会话无效: ${sessionCheck.error}`, code: sessionCheck.error.toUpperCase() });
  }

  // Agent 仍须处于 active 状态。
  // P5/P8：transient session（跨世界传送）与游客 session（P8 拉模式）本地无 agents 行，
  // 且 agent id 形如 agent:guest:<uuid> 不是合法 UUID，直接查表会抛类型错误
  // → 从 session 行重建 agent profile（与 agentWsServer.authenticateUpgrade 同口径）。
  let agent;
  if (sessionCheck.session.isTransient) {
    agent = require('../../agent/agentTransientSessionManager').buildAgentProfile(sessionCheck.session);
  } else {
    agent = await agentManager.getAgentById(payload.sub);
  }
  if (!agent || agent.status !== 'active') {
    return res.status(403).json({ error: 'Agent 已停用', code: 'AGENT_DISABLED' });
  }

  await agentSessionManager.touchSession(sessionCheck.session.id, sessionCheck.session.isTransient);
  req.agent = agent;
  req.agentJwt = payload;
  req.agentSession = sessionCheck.session;
  next();
}

// ==================== POST /session ====================

router.post('/session', rateLimitSession, async (req, res) => {
  try {
    await ensureDefaults();

    // 前置：独立密钥必须已配置
    if (!agentAuth.isConfigured()) {
      return res.status(503).json({ error: 'Agent 功能未启用：缺少 AGENT_JWT_SECRET 配置', code: 'AGENT_SECRET_MISSING' });
    }

    // 前置：总开关（红线：默认关）
    const config = await agentConfigService.getConfig();
    if (!config.agentEnabled) {
      return res.status(503).json({ error: 'Agent 接入未开放（agent_enabled=false）', code: 'AGENT_DISABLED_GLOBALLY' });
    }

    // API Key 解析
    const apiKey = extractBearerToken(req.headers['authorization']);
    if (!apiKey || !isValidApiKeyFormat(apiKey)) {
      audit('session_rejected', { reason: 'bad_key_format', ip: req.ip });
      return res.status(401).json({ error: '未授权：API Key 格式无效', code: 'AGENT_KEY_INVALID' });
    }

    // Key → Agent
    const found = await agentManager.findAgentByApiKey(apiKey);
    if (!found) {
      audit('session_rejected', { reason: 'key_not_found', ip: req.ip });
      return res.status(401).json({ error: '未授权：API Key 无效', code: 'AGENT_KEY_INVALID' });
    }
    const { agent, keyRow } = found;

    if (agent.status !== 'active') {
      audit('session_rejected', { reason: 'agent_disabled', agent: agent.name });
      return res.status(403).json({ error: 'Agent 已停用', code: 'AGENT_DISABLED' });
    }
    if (keyRow.expires_at && new Date(keyRow.expires_at).getTime() <= Date.now()) {
      audit('session_rejected', { reason: 'key_expired', agent: agent.name });
      return res.status(401).json({ error: 'API Key 已过期', code: 'AGENT_KEY_EXPIRED' });
    }

    // 签发
    const scopes = permissionService.getScopesForAgent(agent);
    const worldId = await agentAuth.getWorldId();
    const { token, jti, expiresAt } = agentAuth.issueAgentJwt(agent, scopes, worldId);
    await agentSessionManager.createSession({ agentId: agent.id, jti, worldId, expiresAt });

    audit('session_issued', { agent: agent.name, agentId: agent.id, jti, ip: req.ip, expiresAt });
    res.json({
      success: true,
      token,
      tokenType: 'Bearer',
      expiresIn: agentAuth.SESSION_TTL_SECONDS,
      expiresAt,
      agent: { id: agent.id, name: agent.name, scopes }
    });
  } catch (error) {
    console.error('[Agent] session 签发失败:', error);
    res.status(500).json({ error: 'session 签发失败' });
  }
});

// ==================== GET /me ====================

router.get('/me', authenticateAgentToken, async (req, res) => {
  try {
    const { agent, agentJwt, agentSession } = req;
    res.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        status: agent.status,
        avatar: agentManager.shapeAvatar(agent)
      },
      session: {
        jti: agentSession.jti,
        issuedAt: agentSession.issued_at,
        expiresAt: agentSession.expires_at,
        lastSeen: agentSession.last_seen
      },
      permissions: permissionService.describePermissions(agent),
      worldId: agentJwt.worldId
    });
  } catch (error) {
    console.error('[Agent] /me 查询失败:', error);
    res.status(500).json({ error: '查询失败' });
  }
});

// ==================== POST /session/revoke ====================

router.post('/session/revoke', authenticateAgentToken, async (req, res) => {
  try {
    const { agent, agentJwt } = req;
    const revoked = await agentSessionManager.revokeSession(agentJwt.jti);
    audit('session_revoked', { agent: agent.name, agentId: agent.id, jti: agentJwt.jti });
    res.json({ success: true, revoked: Boolean(revoked) });
  } catch (error) {
    console.error('[Agent] session 吊销失败:', error);
    res.status(500).json({ error: '吊销失败' });
  }
});

// ==================== 审计日志（P8：三分流 audit.log）====================

function audit(event, data) {
  logger.audit(event, { scope: 'agent-auth', ...data });
}

// 导出认证中间件供 observe/action 等子路由复用（P2+）
router.authenticateAgentToken = authenticateAgentToken;

module.exports = router;
