/**
 * AI Agent 接入 - 路由总入口（P1）
 * 挂载于 /api/agent/v1（src/server.js 一行挂载）。
 * P2+ 的 observe / action / meta 子路由在此追加，保持小文件结构。
 */

const express = require('express');
const router = express.Router();

const sessionRouter = require('./session');

// 启动告警：独立密钥未配置时拒绝 Agent 功能（不阻断服务器启动）
const agentAuth = require('../../agent/agentAuth');
if (!agentAuth.isConfigured()) {
  console.warn('[Agent] ⚠️ AGENT_JWT_SECRET 未配置，Agent 接入功能将不可用（在 .env 中配置后重启）');
}

router.use('/', sessionRouter);
router.use('/', require('./observe'));   // P2: GET /observe（挂根路径，observe.js 内部声明 /observe 路由）
router.use('/', require('./action'));   // P4: POST /action（备用入口，主入口为 WS ACTION）
router.use('/', require('./chatHistory')); // P4: GET /chat/history（AI 重连恢复上下文）
router.use('/federation', require('./federation')); // P5: Agent 联邦传送（必须在 admin 之前，避免被 authenticateAdminToken 拦截）
router.use('/', require('./meta'));      // P6: capabilities + openapi + well-known（公开无鉴权，必须在 admin 之前——admin.js 内部 router.use(authenticateAdminToken) 是子路由级全局中间件，会拦截所有未匹配路径）
router.use('/', require('./admin'));     // P4: 后台管理（list/create/revoke agents + 配置读写，router.use(authenticateAdminToken) 会拦截所有未被前面匹配的路径——放最后）

module.exports = router;
