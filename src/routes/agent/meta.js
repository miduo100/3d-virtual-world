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
const {
  AGENT_SCOPES,
  FORBIDDEN_SCOPES,
  SESSION_TTL_SECONDS,
  GUEST_SESSION_TTL_SECONDS,
  AGENT_TIER_GUEST,
  AGENT_TIER_KEY,
  GUEST_OBSERVE_MAX_RADIUS,
  KEY_OBSERVE_MAX_RADIUS
} = require('../../agent/agentSchema');
const tierService = require('../../agent/agentTierService');

const PROTOCOL_VERSION = 'v1';

/**
 * 实体标识契约（缺陷 F，2026-09-19 固化）——机器可读版本
 *
 * 来源：第一轮真人联测用户实测指正——世界里同名是常态（多个"米多"），
 * 按 name 定位实体不可靠；唯一标识是 id(=characterId)。
 * 本轮实测再次验证：playerPositions 里同时存在两条同名"米多"（不同 id）与一个
 * id 不带 agent: 前缀的旧 Agent 条目，客户端盲选"最近的 human"会跟错目标。
 */
const ENTITY_IDENTITY = {
  uniqueIdField: 'id',
  aliases: ['characterId'],
  nameIsDisplayOnly: true,
  chatSenderIdEqualsEntityId: true,
  chatIdFields: ['characterId', 'senderId'],
  chatSenderNameField: 'sender',
  duplicateConnectionsDeduped: true,
  dedupeRule: '同一 characterId 有多条连接时，entities 只返回一条（优先带 animMode/最新位置）',
  note: 'entities[].id === characterId 是唯一标识；name 仅供显示（同名是常态）。标准用法：收到 CHAT 先取 characterId/senderId，再在 entities 里按 id 定位说话者。'
};

/**
 * 共享发现段（缺陷 H：/.well-known 与 /capabilities 必须同源同形）
 */
function buildSharedSections(config) {
  return {
    tiers: {
      default: AGENT_TIER_GUEST,
      options: [AGENT_TIER_GUEST, AGENT_TIER_KEY],
      [AGENT_TIER_GUEST]: tierService.describeTier(AGENT_TIER_GUEST),
      [AGENT_TIER_KEY]: tierService.describeTier(AGENT_TIER_KEY)
    },
    scopes: {
      allowed: AGENT_SCOPES,
      forbidden: FORBIDDEN_SCOPES
    },
    // 动作集（2026-09-19 新增 stop，缺陷 v2-4）。⚠️ 本文件共有 **三处**动作清单必须同步：
    // ①此处（capabilities / well-known 共享段）②openapi 的 `x-websocket.actions` ③openapi `/action` 的 requestBody enum。
    actions: ['move', 'walk_to', 'follow', 'rotate', 'jump', 'say', 'interact', 'stop'],
    pushTiers: {
      default: config.pushDefault,
      options: ['eco', 'standard', 'realtime']
    },
    limits: {
      observeRadiusMax: KEY_OBSERVE_MAX_RADIUS,
      observeRadiusMaxGuest: GUEST_OBSERVE_MAX_RADIUS,
      observeRateLimitPerSecond: config.observeRateKey,
      guestObserveIntervalSeconds: 2,
      sayMaxLength: 200,
      interactMaxDistance: 5,
      movementSpeed: config.maxSpeed,          // m/s，后台 agent_max_speed 可配（默认 9 = 真人速度）
      followSpeed: config.followSpeed,         // m/s，后台 agent_follow_speed 可配（默认 8，仅 follow 用）
      worldBoundary: 1000,
      followStopDistanceDefault: 2,
      followMaxDurationMs: 600000,
      maxAgents: config.maxAgents,
      maxConnectionsPerAgent: config.maxConnectionsPerAgent
    },
    entityIdentity: ENTITY_IDENTITY
  };
}

// ==================== GET /capabilities ====================

router.get('/capabilities', async (req, res) => {
  try {
    const config = await agentConfigService.getConfig();
    const baseUrl = await resolveBaseUrl(req);
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
        wellKnown: baseUrl + '/.well-known/virtual-world-agent.json',
        guestSession: baseUrl + '/api/agent/v1/guest/session'
      },
      // F/H：本段与 /.well-known/virtual-world-agent.json 同源（buildSharedSections），
      // 含 tiers/scopes/actions/pushTiers/limits/entityIdentity——两处字段必须逐字一致。
      ...buildSharedSections(config),
      session: {
        ttlSeconds: SESSION_TTL_SECONDS,
        tokenType: 'Bearer'
      },
      websocket: {
        path: '/ws/agent',
        authMode: 'Bearer in HTTP Authorization header at upgrade',
        inboundMessages: ['SUBSCRIBE', 'UNSUBSCRIBE', 'PING', 'ACTION'],
        // 2026-09-19：移除 'VOICE_MESSAGE' —— Agent 语音中继为"未实现且已决策不做"
        // （用户："AI 目前不用语音，后期用再开发"）。发现端点不宣称不存在的能力，
        // 否则外部客户端会一直等一个永不到来的消息。真做时再连同 capabilities/openapi 一起加回。
        outboundMessages: [
          'READY', 'WORLD_SNAPSHOT',
          'ENTITY_ADDED', 'ENTITY_UPDATED', 'ENTITY_REMOVED',
          'ENTITY_MOVEMENT_BATCH', 'CHAT',
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
    const baseUrl = await resolveBaseUrl(req);
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
  // 权威世界 URL 先取（同时用于 world.url 与 baseUrl 的协议兜底），避免重复读库
  const authoritativeUrl = await resolveAuthoritativeUrl();
  const baseUrl = deriveBaseUrl(req, authoritativeUrl);
  const config = await agentConfigService.getConfig();

  // worldUrl 来源优先级：federationSystem（权威）→ system_config('world_url') → req 推导。
  // 协议对齐：同一份发现文档里 world.url 与 endpoints 必须同协议（线上 bug 的直接症状就是
  // world.url=https 而 endpoints.apiBase=http，文档自相矛盾）——统一取 baseUrl 的协议，host 保留权威值。
  const rawWorldUrl = authoritativeUrl || baseUrl;
  const baseProto = /^([a-z][a-z0-9+.-]*):\/\//i.exec(baseUrl);
  const worldUrl = baseProto ? rawWorldUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, baseProto[1].toLowerCase() + '://') : rawWorldUrl;

  let worldId = null;
  let worldName = null;
  try {
    const federation = require('../../routes/federation').getFederationSystem();
    if (federation) {
      worldId = federation.worldId || null;
      worldName = federation.worldName || null;
    }
  } catch (e) { /* federationSystem 未初始化，降级 */ }

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
      sessionTtlSeconds: SESSION_TTL_SECONDS,
      // P8：无 Key 也能进——公开临时票（拉模式）。API Key = 推流特权，不是进门凭证。
      guestSessionEndpoint: '/api/agent/v1/guest/session',
      guestSessionTtlSeconds: GUEST_SESSION_TTL_SECONDS
    },
    // F/H：与 /capabilities 同源（buildSharedSections），避免两处字段不一致
    ...buildSharedSections(config)
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
      { name: 'guest', description: 'P8: public temporary ticket (pull mode, no API Key)' },
      { name: 'observe', description: 'Spatial radar' },
      { name: 'chat', description: 'Chat history' },
      { name: 'action', description: 'HTTP action fallback (use WS for primary)' },
      { name: 'federation', description: 'Cross-world teleport' },
      { name: 'meta', description: 'Capabilities / OpenAPI / well-known' }
    ],
    paths: {
      '/guest/session': {
        post: {
          tags: ['guest'],
          summary: 'Issue a public temporary Agent ticket (no API Key required)',
          description: 'P8 pull mode: request-response only. No push stream (SUBSCRIBE rejected), observe radius clamped to 30m, actions rate-limited. Rate-limited: 10/hour per IP.',
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: {} } } } },
          responses: {
            200: {
              description: 'Guest ticket issued',
              content: { 'application/json': { schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  token: { type: 'string' },
                  tokenType: { type: 'string', example: 'Bearer' },
                  tier: { type: 'string', example: 'guest-pull' },
                  mode: { type: 'string', example: 'pull' },
                  expiresIn: { type: 'integer', example: 1800 },
                  expiresAt: { type: 'string', format: 'date-time' },
                  agent: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } } } }
                }
              } } }
            },
            429: { description: 'Ticket rate limited', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            503: { description: 'Agent access disabled or secret missing', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      },
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
          description: 'self.position is the **live** position of the calling Agent (falls back to the session position when it has no live WS connection); every distance is measured from it. Rate-limited: `agent_observe_rate_key` (default 1/s) for Key tier, 1 per 2s for guest tier. Radius hard cap: 200m for Key, 30m for guest. Entity identity: `entities[].id` (=== characterId) is the ONLY identifier, `name` is display-only (duplicates by name are normal); `chat.characterId` / `chat/history.senderId` share the same namespace — see `x-entity-identity`.',
          security: [{ AgentJwt: [] }],
          parameters: [
            { name: 'radius', in: 'query', schema: { type: 'number', maximum: 200 }, description: 'Search radius in meters (≤200)' },
            { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Max items per section' },
            { name: 'include', in: 'query', schema: { type: 'string' }, description: 'Comma-separated world_objects.type filter (e.g. uploaded_model,geometry_building,media_image). Omit to return all types. NOTE: filters object types, not response sections — sections are always returned.' },
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
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { action: { type: 'string', enum: ['say', 'rotate', 'move', 'walk_to', 'follow', 'jump', 'interact', 'stop'] } } } } } },
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
      // VOICE_MESSAGE 已于 2026-09-19 移除（Agent 语音中继未实现且不计划做，见 /capabilities 注释同一处说明）
      outbound: ['READY', 'WORLD_SNAPSHOT', 'ENTITY_ADDED', 'ENTITY_UPDATED', 'ENTITY_REMOVED', 'ENTITY_MOVEMENT_BATCH', 'CHAT', 'ACTION_ACCEPTED', 'ACTION_COMPLETED', 'ACTION_REJECTED', 'PONG', 'ERROR'],
      actions: ['move', 'walk_to', 'follow', 'rotate', 'jump', 'say', 'interact', 'stop']
    },
    'x-entity-identity': ENTITY_IDENTITY,
    'x-agent-enabled': agentEnabled
  };
}

// ==================== 工具：权威世界入口 URL / baseUrl 推导 ====================

/**
 * 读取"权威世界入口 URL"（协议一致性兜底）：federationSystem.worldUrl（内存态，权威）
 * → system_config('world_url') → null（纯靠 req 推导）。反代转发给 Node 的是 http 明文，
 * 漏配 X-Forwarded-Proto 时 req 侧永远推不出 https（encrypted 恒 false），站点入口 URL 在此。
 */
async function resolveAuthoritativeUrl() {
  try {
    const federation = require('../../routes/federation').getFederationSystem();
    if (federation && federation.worldUrl) return String(federation.worldUrl).trim();
  } catch (e) { /* federationSystem 未初始化，降级 */ }
  try {
    const { query } = require('../../database/db');
    const r = await query(`SELECT config_value FROM system_config WHERE config_key = 'world_url'`);
    if (r.rows.length > 0 && r.rows[0].config_value) return r.rows[0].config_value.trim() || null;
  } catch (e) { /* DB 不可用，降级 */ }
  return null;
}

/** 三处发现端点统一入口（加固集中在 deriveBaseUrl 一处，勿各写一份） */
async function resolveBaseUrl(req) {
  return deriveBaseUrl(req, await resolveAuthoritativeUrl());
}

/**
 * 从 req 推导 baseUrl。协议优先级：① x-forwarded-proto（多段取第一段）
 * ② req.protocol（已 applyTrustProxy）③ 连接加密状态 ④ 权威 URL 兜底
 * （站点入口是 https 时，反代到 Node 的 http 只是内部事实，覆盖推导结果）。
 * 主机优先级：x-forwarded-host → host → 权威 host（推导 host 为回环或与权威相同时）。
 * WS 端点由调用方以 `baseUrl.replace(/^http/, 'ws')` 派生（https→wss、http→ws），协议只在此处改一处。
 */
function deriveBaseUrl(req, authoritativeUrl) {
  const head = (v) => String(v || '').split(',')[0].trim();
  let proto = head(req.headers['x-forwarded-proto']);
  if (!proto) proto = (req.protocol === 'https' || (req.connection && req.connection.encrypted)) ? 'https' : 'http';
  let host = head(req.headers['x-forwarded-host']) || req.headers['host'] || (req.get && req.get('host')) || 'localhost';

  try {
    const authoritative = new URL(authoritativeUrl);
    if (authoritative.protocol === 'https:' && proto === 'http') proto = 'https';
    const authHost = authoritative.host;
    if (authHost && (host === authHost || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host))) host = authHost;
  } catch (e) { /* 无权威 URL 或非法值：按 req 推导结果使用 */ }

  return `${proto}://${host}`;
}

// ==================== 导出（同时供 server.js 直接调 buildWellKnown）====================

module.exports = router;
// deriveBaseUrl / resolveAuthoritativeUrl 导出供 agentFederation.js 复用（协议口径只此一处）
Object.assign(module.exports, { buildWellKnown, deriveBaseUrl, resolveAuthoritativeUrl, PROTOCOL_VERSION });
