/**
 * AI Agent 接入 - 元数据路由（P6）
 * 挂载于 /api/agent/v1（公开读，无鉴权）
 *
 * 端点：
 *   GET /capabilities           机器可读能力清单（scopes/actions/ws 消息/push 档位）
 *   GET /openapi.json           OpenAPI 3.0 schema（仅含实际已实现端点，管理员端点不写）
 *   GET /.well-known/virtual-world-agent.json  发现入口（经 server.js 静态路由级挂载）
 *
 * 红线：openapi 必须与实际实现一致——文档里没实现的端点不许写进 openapi。
 */

const express = require('express');
const router = express.Router();

const agentAuth = require('../../agent/agentAuth');
const agentConfigService = require('../../agent/agentConfigService');
const { AGENT_SCOPES, FORBIDDEN_SCOPES, SESSION_TTL_SECONDS } = require('../../agent/agentSchema');

const PROTOCOL_VERSION = 'v1';

// ==================== GET /capabilities ====================

router.get('/capabilities', async (req, res) => {
  try {
    const config = await agentConfigService.getConfig();
    const baseUrl = deriveBaseUrl(req);
    res.json({
      success: true,
      protocolVersion: PROTOCOL_VERSION,
      agentEnabled: config.agentEnabled,
      endpoints: {
        session: baseUrl + '/api/agent/v1/session',
        me: baseUrl + '/api/agent/v1/me',
        revoke: baseUrl + '/api/agent/v1/session/revoke',
        observe: baseUrl + '/api/agent/v1/observe',
        action: baseUrl + '/api/agent/v1/action',
        chatHistory: baseUrl + '/api/agent/v1/chat/history',
        capabilities: baseUrl + '/api/agent/v1/capabilities',
        openapi: baseUrl + '/api/agent/v1/openapi.json',
        federationWorlds: baseUrl + '/api/agent/v1/federation/worlds',
        federationStatus: baseUrl + '/api/agent/v1/federation/status',
        federationTeleportPrepare: baseUrl + '/api/agent/v1/federation/teleport/prepare',
        federationInfo: baseUrl + '/api/agent/federation/info',
        federationAccept: baseUrl + '/api/agent/federation/teleport/accept',
        websocket: baseUrl.replace(/^http/, 'ws') + '/ws/agent',
        wellKnown: baseUrl + '/.well-known/virtual-world-agent.json'
      },
      scopes: {
        allowed: AGENT_SCOPES,
        forbidden: FORBIDDEN_SCOPES
      },
      actions: ['move', 'walk_to', 'rotate', 'jump', 'say', 'interact'],
      pushTiers: {
        default: config.pushDefault,
        options: ['eco', 'standard', 'realtime']
      },
      session: {
        ttlSeconds: SESSION_TTL_SECONDS,
        tokenType: 'Bearer'
      },
      websocket: {
        path: '/ws/agent',
        authMode: 'Bearer in HTTP Authorization header at upgrade',
        inboundMessages: ['SUBSCRIBE', 'UNSUBSCRIBE', 'PING', 'ACTION'],
        outboundMessages: [
          'READY', 'WORLD_SNAPSHOT',
          'ENTITY_ADDED', 'ENTITY_UPDATED', 'ENTITY_REMOVED',
          'ENTITY_MOVEMENT_BATCH', 'CHAT', 'VOICE_MESSAGE',
          'ACTION_ACCEPTED', 'ACTION_COMPLETED', 'ACTION_REJECTED',
          'PONG', 'ERROR'
        ]
      }
    });
  } catch (error) {
    console.error('[Agent meta] /capabilities 失败:', error);
    res.status(500).json({ error: 'capabilities 查询失败', code: 'CAPABILITIES_FAILED' });
  }
});

// ==================== GET /openapi.json ====================

router.get('/openapi.json', async (req, res) => {
  try {
    const baseUrl = deriveBaseUrl(req);
    const config = await agentConfigService.getConfig();
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws/agent';
    res.json(buildOpenApiSpec(baseUrl, wsUrl, config.agentEnabled));
  } catch (error) {
    console.error('[Agent meta] /openapi.json 失败:', error);
    res.status(500).json({ error: 'openapi 生成失败', code: 'OPENAPI_FAILED' });
  }
});

// ==================== .well-known 入口（也挂一份在 router 根，供 server.js 直接挂）====================

router.get('/well-known/virtual-world-agent.json', async (req, res) => {
  try {
    const doc = await buildWellKnown(req);
    res.json(doc);
  } catch (error) {
    console.error('[Agent meta] well-known 失败:', error);
    res.status(500).json({ error: 'well-known 生成失败', code: 'WELLKNOWN_FAILED' });
  }
});

// ==================== 工具：构建 well-known 发现文档 ====================

async function buildWellKnown(req) {
  const baseUrl = deriveBaseUrl(req);
  const config = await agentConfigService.getConfig();

  // worldId / worldName / worldUrl 来源优先级：federationSystem（权威）→ system_config('world_url') → req 推导
  let worldId = null;
  let worldName = null;
  let worldUrl = baseUrl;
  try {
    const federation = require('../../routes/federation').getFederationSystem();
    if (federation) {
      worldId = federation.worldId || null;
      worldName = federation.worldName || null;
      worldUrl = federation.worldUrl || baseUrl;
    }
  } catch (e) { /* federationSystem 未初始化，降级 */ }

  if (!worldUrl || worldUrl === baseUrl) {
    // 降级读 system_config('world_url')
    try {
      const { query } = require('../../database/db');
      const r = await query(`SELECT config_value FROM system_config WHERE config_key = 'world_url'`);
      if (r.rows.length > 0 && r.rows[0].config_value) {
        worldUrl = r.rows[0].config_value.trim() || baseUrl;
      }
    } catch (e) { /* DB 不可用时用 baseUrl */ }
  }
  if (!worldName) {
    try {
      const { query } = require('../../database/db');
      const r = await query(`SELECT config_value FROM system_config WHERE config_key = 'world_name'`);
      if (r.rows.length > 0 && r.rows[0].config_value) {
        worldName = r.rows[0].config_value.trim();
      }
    } catch (e) { /* ignore */ }
  }
  if (!worldName) worldName = process.env.WORLD_NAME || 'Virtual World';

  return {
    success: true,
    protocolVersion: PROTOCOL_VERSION,
    agentEnabled: config.agentEnabled,
    world: {
      id: worldId,
      name: worldName,
      url: worldUrl
    },
    endpoints: {
      apiBase: baseUrl + '/api/agent/v1',
      websocket: baseUrl.replace(/^http/, 'ws') + '/ws/agent',
      capabilities: baseUrl + '/api/agent/v1/capabilities',
      openapi: baseUrl + '/api/agent/v1/openapi.json',
      federationInfo: baseUrl + '/api/agent/federation/info',
      federationTeleportAccept: baseUrl + '/api/agent/federation/teleport/accept'
    },
    auth: {
      apiKeyHeader: 'Authorization: Bearer agk_live_...',
      agentJwtHeader: 'Authorization: Bearer <jwt>',
      sessionEndpoint: '/api/agent/v1/session',
      sessionTtlSeconds: SESSION_TTL_SECONDS
    },
    scopes: {
      allowed: AGENT_SCOPES,
      forbidden: FORBIDDEN_SCOPES
    },
    actions: ['move', 'walk_to', 'rotate', 'jump', 'say', 'interact'],
    pushTiers: ['eco', 'standard', 'realtime'],
    limits: {
      observeRadiusMax: 200,
      observeRateLimitPerSecond: 1,
      sayMaxLength: 200,
      interactMaxDistance: 5,
      movementSpeed: 5,        // m/s, 服务端权威限速
      worldBoundary: 1000,     // ±1000m
      maxAgents: config.maxAgents
    }
  };
}

// ==================== 工具：构建 OpenAPI 3.0 schema（仅含实际已实现端点）====================

function buildOpenApiSpec(baseUrl, wsUrl, agentEnabled) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Virtual World Agent API',
      version: PROTOCOL_VERSION,
      description: 'HTTP API for AI Agents to enter the virtual world. WebSocket is the primary channel for real-time events/actions; HTTP endpoints cover session, observation, and federation teleport handoff.',
      contact: { name: 'Virtual World', url: baseUrl }
    },
    servers: [{ url: baseUrl + '/api/agent/v1', description: 'Agent API v1' }],
    components: {
      securitySchemes: {
        AgentApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'Use API Key (format: `Bearer agk_live_<64-hex>`) only for POST /session.'
        },
        AgentJwt: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Agent JWT (15min TTL). Obtained from POST /session.'
        },
        HandoffToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'RS256 handoff token issued by source world via POST /federation/teleport/prepare. Used only at target world POST /api/agent/federation/teleport/accept.'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { success: { type: 'boolean', example: false }, error: { type: 'string' }, code: { type: 'string' } },
          required: ['error', 'code']
        }
      }
    },
    tags: [
      { name: 'session', description: 'API Key → Agent JWT' },
      { name: 'observe', description: 'Spatial radar' },
      { name: 'chat', description: 'Chat history' },
      { name: 'action', description: 'HTTP action fallback (use WS for primary)' },
      { name: 'federation', description: 'Cross-world teleport' },
      { name: 'meta', description: 'Capabilities / OpenAPI / well-known' }
    ],
    paths: {
      '/session': {
        post: {
          tags: ['session'],
          summary: 'Exchange API Key for short-lived Agent JWT',
          description: 'Rate-limited: 10/min per IP. Refused when agent_enabled=false.',
          security: [{ AgentApiKey: [] }],
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: {} } } } },
          responses: {
            200: {
              description: 'JWT issued',
              content: { 'application/json': { schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  token: { type: 'string' },
                  tokenType: { type: 'string', example: 'Bearer' },
                  expiresIn: { type: 'integer', example: 900 },
                  expiresAt: { type: 'string', format: 'date-time' },
                  agent: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } } } }
                }
              } } }
            },
            401: { description: 'Invalid API Key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            429: { description: 'Rate limited', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            503: { description: 'Agent disabled globally (agent_enabled=false)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      },
      '/me': {
        get: {
          tags: ['session'],
          summary: 'Current Agent info + avatar + scope',
          security: [{ AgentJwt: [] }],
          responses: {
            200: { description: 'OK' },
            401: { description: 'Token missing/invalid', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            403: { description: 'Session expired/revoked or agent disabled', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      },
      '/session/revoke': {
        post: {
          tags: ['session'],
          summary: 'Revoke the current Agent session',
          security: [{ AgentJwt: [] }],
          responses: { 200: { description: 'Revoked' }, 403: { description: 'Invalid session' } }
        }
      },
      '/observe': {
        get: {
          tags: ['observe'],
          summary: 'Spatial radar: nearby entities / objects / portals',
          description: 'Rate-limited: 1Hz per agent (eco tier). Radius hard cap: 200m.',
          security: [{ AgentJwt: [] }],
          parameters: [
            { name: 'radius', in: 'query', schema: { type: 'number', maximum: 200 }, description: 'Search radius in meters (≤200)' },
            { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Max items per section' },
            { name: 'include', in: 'query', schema: { type: 'string' }, description: 'Comma-separated: entities,objects,portals' },
            { name: 'x', in: 'query', schema: { type: 'number' }, description: 'Override observer x (defaults to current position)' },
            { name: 'y', in: 'query', schema: { type: 'number' } },
            { name: 'z', in: 'query', schema: { type: 'number' } }
          ],
          responses: {
            200: { description: 'OK' },
            403: { description: 'SCOPE_DENIED (missing observe scope) or rate-limited', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            429: { description: 'Observe rate limit (1Hz)' }
          }
        }
      },
      '/chat/history': {
        get: {
          tags: ['chat'],
          summary: 'Recent chat messages (for AI reconnect context)',
          security: [{ AgentJwt: [] }],
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
          responses: { 200: { description: 'OK' } }
        }
      },
      '/action': {
        post: {
          tags: ['action'],
          summary: 'HTTP fallback entry (limited; primary is WS ACTION)',
          description: 'Returns 501 WS_REQUIRED for all actions. Use WebSocket /ws/agent ACTION message instead.',
          security: [{ AgentJwt: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { action: { type: 'string', enum: ['say', 'rotate', 'move', 'walk_to', 'jump', 'interact'] } } } } } },
          responses: { 501: { description: 'WS_REQUIRED — use /ws/agent ACTION instead', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } }
        }
      },
      '/capabilities': {
        get: { tags: ['meta'], summary: 'Machine-readable capability list (public, no auth)', responses: { 200: { description: 'OK' } } }
      },
      '/openapi.json': {
        get: { tags: ['meta'], summary: 'OpenAPI 3.0 schema (public, no auth)', responses: { 200: { description: 'OK' } } }
      },
      '/federation/worlds': {
        get: { tags: ['federation'], summary: 'List trusted target worlds (requires can_teleport=true to actually use)', security: [{ AgentJwt: [] }], responses: { 200: { description: 'OK' } } }
      },
      '/federation/status': {
        get: { tags: ['federation'], summary: "Agent's own teleport permission", security: [{ AgentJwt: [] }], responses: { 200: { description: 'OK' } } }
      },
      '/federation/teleport/prepare': {
        post: {
          tags: ['federation'],
          summary: 'Initiate cross-world teleport (source world side)',
          description: 'Requires can_teleport=true. Returns handoffToken + nextStep URL.',
          security: [{ AgentJwt: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { targetWorldId: { type: 'string' }, context: { type: 'object' } }, required: ['targetWorldId'] } } } },
          responses: { 200: { description: 'OK' }, 403: { description: 'AGENT_TELEPORT_NOT_PERMITTED or TARGET_WORLD_NOT_TRUSTED' }, 404: { description: 'Target world not trusted' } }
        }
      }
    },
    'x-websocket': {
      url: wsUrl,
      authMode: 'Bearer in HTTP Authorization header at upgrade time',
      inbound: ['SUBSCRIBE', 'UNSUBSCRIBE', 'PING', 'ACTION'],
      outbound: ['READY', 'WORLD_SNAPSHOT', 'ENTITY_ADDED', 'ENTITY_UPDATED', 'ENTITY_REMOVED', 'ENTITY_MOVEMENT_BATCH', 'CHAT', 'VOICE_MESSAGE', 'ACTION_ACCEPTED', 'ACTION_COMPLETED', 'ACTION_REJECTED', 'PONG', 'ERROR'],
      actions: ['move', 'walk_to', 'rotate', 'jump', 'say', 'interact']
    },
    'x-agent-enabled': agentEnabled
  };
}

// ==================== 工具：从 req 推导 baseUrl ====================

function deriveBaseUrl(req) {
  // 优先信任反代/原请求协议（Nginx 配置 X-Forwarded-Proto / Host）
  const proto = req.headers['x-forwarded-proto'] || (req.connection && req.connection.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers['host'] || (req.get && req.get('host')) || 'localhost';
  return `${proto}://${host}`;
}

// ==================== 导出（同时供 server.js 直接调 buildWellKnown）====================

module.exports = router;
module.exports.buildWellKnown = buildWellKnown;
module.exports.PROTOCOL_VERSION = PROTOCOL_VERSION;
