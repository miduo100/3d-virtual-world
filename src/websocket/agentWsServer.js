/**
 * Agent WebSocket 服务器（P3 核心）
 * 连接：wss://host/ws/agent（HTTP upgrade 时读 Authorization Bearer 鉴权，拒绝无 token/过期）
 *
 * 职责：
 *   - handleUpgrade：鉴权（JWT 验签 + jti DB 权威 + agent active）→ wss.handleUpgrade
 *   - onConnection：max_agents 检查 → presenceBridge.onConnect → 发 READY + WORLD_SNAPSHOT
 *   - onMessage：SUBSCRIBE/UNSUBSCRIBE/PING/ACTION（P4 占位）
 *   - 三档推送：eco（无位置流，CHAT 实时）/ standard（ENTITY_ADDED/REMOVED + 1s 聚合位置流）/ realtime（逐条）
 *   - 令牌桶限频：位置>实体>聊天，聊天永不丢（红线11）
 *   - 背压监控：bufferedAmount >1MB 警告、>4MB 断开（红线11）
 *   - 30s 心跳：两周期无 pong terminate（沿用人类侧机制）
 *
 * 红线：不动 wsServer.js（黑名单贴线）；三档/令牌桶/背压全在本文件。
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const agentAuth = require('../agent/agentAuth');
const agentManager = require('../agent/agentManager');
const agentSessionManager = require('../agent/agentSessionManager');
const agentConfigService = require('../agent/agentConfigService');
const presenceBridge = require('../agent/agentPresenceBridge');
const agentActionService = require('../agent/agentActionService');  // P4：六动作分发
const transientSessionManager = require('../agent/agentTransientSessionManager');  // P5：跨世界 transient session
const wsServer = require('./wsServer');

const wss = new WebSocket.Server({ noServer: true });
const activeAgents = new Map();  // connectionId -> state

const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 70000;
const BACKPRESSURE_WARN = Number(process.env.AGENT_BACKPRESSURE_WARN) || (1 * 1024 * 1024);
const BACKPRESSURE_KILL = Number(process.env.AGENT_BACKPRESSURE_KILL) || (4 * 1024 * 1024);
// Agent 空闲超时：N 分钟无任何操作（ACTION/SUBSCRIBE/UNSUBSCRIBE）即断开清场（默认 5 分钟，0=禁用）
const _idleMin = process.env.AGENT_IDLE_TIMEOUT_MINUTES !== undefined ? Number(process.env.AGENT_IDLE_TIMEOUT_MINUTES) : 5;
const AGENT_IDLE_TIMEOUT_MS = (_idleMin > 0 ? _idleMin : 0) * 60 * 1000;
const TOKEN_BUCKET_CAPACITY = 20;
const TOKEN_REFILL_PER_SEC = 10;
const STANDARD_BATCH_INTERVAL_MS = 1000;
const CHAT_NEARBY_RANGE = 30;

// ==================== 鉴权 ====================

async function authenticateUpgrade(request) {
  // 主路径：Authorization: Bearer <jwt>
  let token = null;
  const auth = request.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) {
    token = auth.slice(7).trim();
  }
  // 降级路径：?token=<jwt> 查询参数（P6 增）
  // 浏览器 WHATWG WebSocket 与部分受限运行时不允许设自定义请求头，
  // 查询参数 token 是 WebSocket 鉴权的标准降级模式。
  // JWT TTL 15min，泄露窗口受限；access log 中的 URL 含 token 是已知风险，运营方需保护 log。
  if (!token) {
    try {
      const url = new URL(request.url, 'http://localhost');
      const q = url.searchParams.get('token');
      if (q) token = q.trim();
    } catch (e) { /* ignore URL parse errors */ }
  }
  if (!token) return { ok: false, code: 'AGENT_TOKEN_MISSING' };
  const verified = agentAuth.verifyAgentJwt(token);
  if (!verified.ok) return { ok: false, code: verified.error.toUpperCase() };
  const payload = verified.payload;
  const sessionCheck = await agentSessionManager.verifySession(payload.jti);
  if (!sessionCheck.ok) return { ok: false, code: sessionCheck.error.toUpperCase() };

  // P5: transient session（跨世界联邦传送）——本地无 agents 行，从 session 重建 agent profile
  let agent;
  if (sessionCheck.session.isTransient) {
    agent = transientSessionManager.buildAgentProfile(sessionCheck.session);
    if (!agent) return { ok: false, code: 'AGENT_DISABLED' };
  } else {
    agent = await agentManager.getAgentById(payload.sub);
    if (!agent || agent.status !== 'active') return { ok: false, code: 'AGENT_DISABLED' };
  }
  return { ok: true, payload, session: sessionCheck.session, agent };
}

function handleUpgrade(request, socket, head) {
  authenticateUpgrade(request).then(result => {
    if (!result.ok) {
      const status = result.code === 'TOKEN_EXPIRED' ? 403 : 401;
      try { socket.write(`HTTP/1.1 ${status} Unauthorized\r\nConnection: close\r\n\r\n`); } catch (e) {}
      socket.destroy();
      audit('ws_rejected', { code: result.code, ip: request.socket.remoteAddress });
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, result);
    });
  }).catch(err => {
    console.error('[AgentWs] upgrade 鉴权异常:', err.message);
    try { socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n'); } catch (e) {}
    socket.destroy();
  });
}

// ==================== 连接生命周期 ====================

wss.on('connection', async (ws, request, authResult) => {
  const { agent, session, payload: jwt } = authResult;
  const connectionId = uuidv4();

  const config = await agentConfigService.getConfig();
  if (activeAgents.size >= config.maxAgents) {
    try { ws.send(JSON.stringify({ type: 'ERROR', payload: { code: 'MAX_AGENTS_REACHED', message: `在线 Agent 上限 ${config.maxAgents}` } })); } catch (e) {}
    ws.close(1013, 'max agents reached');
    audit('ws_rejected', { code: 'MAX_AGENTS_REACHED', agent: agent.name, active: activeAgents.size, max: config.maxAgents });
    return;
  }

  const avatar = agentManager.shapeAvatar(agent);
  presenceBridge.onConnect(connectionId, agent, session, avatar);

  const state = {
    ws, agent, session, jwt, connectionId,
    pushTier: config.pushDefault,
    movementPush: config.movementPush,
    voiceRelay: config.voiceRelay,
    subscription: { topics: new Set(), radius: 30 },
    lastPong: Date.now(),
    lastActivityAt: Date.now(),
    tokenBucket: { tokens: TOKEN_BUCKET_CAPACITY, lastRefill: Date.now() },
    closed: false
  };
  activeAgents.set(connectionId, state);

  const spawn = resolveSpawn(session);
  safeSend(state, { type: 'READY', payload: { agentId: agent.id, agentName: agent.name, avatar, spawn, pushTier: state.pushTier, movementPush: state.movementPush } });

  const players = Array.from(wsServer.getPlayerPositions().values());
  safeSend(state, { type: 'WORLD_SNAPSHOT', payload: {
    self: { id: agent.id, position: spawn },
    entities: players.map(p => ({ id: p.characterId, type: p.entityType === 'agent' ? 'agent' : 'human', name: p.characterName, position: p.position, animMode: p.animMode || null }))
  }});

  audit('ws_connected', { agent: agent.name, agentId: agent.id, connectionId, pushTier: state.pushTier });

  ws.on('message', (data) => handleMessage(connectionId, ws, data));
  ws.on('close', () => handleClose(connectionId));
  ws.on('pong', () => { if (state) state.lastPong = Date.now(); });
  ws.on('error', (err) => { console.error(`[AgentWs] ${agent.name} ws error:`, err.message); });
});

// ==================== 消息处理 ====================

function handleMessage(connectionId, ws, data) {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch (e) {
    safeSendRaw(ws, { type: 'ERROR', payload: { code: 'BAD_JSON' } });
    return;
  }
  const state = activeAgents.get(connectionId);
  if (!state) return;
  const { type, payload } = msg;
  // 操作刷新空闲时钟（PING/PONG 是保活不算操作）
  if (type === 'ACTION' || type === 'SUBSCRIBE' || type === 'UNSUBSCRIBE') state.lastActivityAt = Date.now();
  switch (type) {
    case 'SUBSCRIBE': {
      const topics = Array.isArray(payload && payload.topics) ? payload.topics : [];
      topics.forEach(t => { if (typeof t === 'string') state.subscription.topics.add(t); });
      if (payload && payload.radius && Number.isFinite(payload.radius)) {
        state.subscription.radius = Math.min(200, Math.max(1, Number(payload.radius)));
      }
      safeSend(state, { type: 'SUBSCRIBED', payload: { topics: [...state.subscription.topics], radius: state.subscription.radius } });
      break;
    }
    case 'UNSUBSCRIBE': {
      const topics = Array.isArray(payload && payload.topics) ? payload.topics : [];
      topics.forEach(t => state.subscription.topics.delete(t));
      safeSend(state, { type: 'UNSUBSCRIBED', payload: { topics: [...state.subscription.topics] } });
      break;
    }
    case 'PING':
      safeSendRaw(ws, { type: 'PONG', payload: { t: Date.now() } });
      break;
    case 'ACTION':
      handleAction(connectionId, state, payload);
      break;
    default:
      safeSendRaw(ws, { type: 'ERROR', payload: { code: 'UNKNOWN_TYPE', message: '未知消息类型: ' + type } });
  }
}

function handleClose(connectionId) {
  const state = activeAgents.get(connectionId);
  if (!state) return;
  state.closed = true;
  agentActionService.cleanup(connectionId);   // P4：取消未完成的移动任务
  presenceBridge.onDisconnect(connectionId);
  activeAgents.delete(connectionId);
  audit('ws_disconnected', { agent: state.agent.name, agentId: state.agent.id, connectionId });
}

// ==================== ACTION 分发（P4）====================

async function handleAction(connectionId, state, payload) {
  if (!payload || typeof payload.action !== 'string') {
    safeSendRaw(state.ws, { type: 'ACTION_REJECTED', payload: { requestId: payload && payload.requestId, reason: '缺少 action 字段', code: 'missing_action' } });
    return;
  }
  const ctx = {
    connectionId,
    agent: state.agent,
    session: state.session,
    agentWsState: state
  };
  try {
    const result = await agentActionService.dispatch(ctx, payload);
    if (result.rejected) {
      safeSendRaw(state.ws, { type: 'ACTION_REJECTED', payload: { requestId: result.requestId, reason: result.reason, code: result.code } });
      return;
    }
    if (result.completed) {
      safeSend(state, { type: 'ACTION_COMPLETED', payload: { requestId: result.requestId, result: result.result || {} } }, 'chat');
    } else if (result.accepted) {
      safeSend(state, { type: 'ACTION_ACCEPTED', payload: { requestId: result.requestId, result: result.result || {} } }, 'chat');
      // walk_to 到达时由 movement service 的 publishPosition 触发 POSITION_UPDATE 广播；
      // 完成回执由 movement service 完成时通过 completeCallback 发送（见 startWalkTo 推进结束处）
      // 简化版：到达回执由 Agent 端检测位置不再变化自判（避免双向 callback 复杂性）
    }
  } catch (err) {
    console.error(`[AgentWs] ACTION 异常: ${state.agent.name} action=${payload.action}`, err.message);
    safeSendRaw(state.ws, { type: 'ACTION_REJECTED', payload: { requestId: payload.requestId, reason: '服务端处理异常', code: 'internal_error' } });
  }
}

// ==================== 令牌桶 + 背压 ====================

function acquireToken(state, priority) {
  if (priority === 'chat') return true;  // 聊天永不丢
  const now = Date.now();
  const elapsed = (now - state.tokenBucket.lastRefill) / 1000;
  state.tokenBucket.tokens = Math.min(TOKEN_BUCKET_CAPACITY, state.tokenBucket.tokens + elapsed * TOKEN_REFILL_PER_SEC);
  state.tokenBucket.lastRefill = now;
  if (state.tokenBucket.tokens >= 1) { state.tokenBucket.tokens -= 1; return true; }
  return false;
}

function safeSend(state, message, priority) {
  if (!state || state.closed) return;
  if (priority && !acquireToken(state, priority)) return;
  const ws = state.ws;
  if (ws.bufferedAmount > BACKPRESSURE_KILL) {
    console.warn(`[AgentWs] 背压超限断开: ${state.agent.name} bufferedAmount=${ws.bufferedAmount}`);
    ws.close(1011, 'backpressure overflow');
    return;
  }
  if (ws.bufferedAmount > BACKPRESSURE_WARN) {
    console.warn(`[AgentWs] 背压警告: ${state.agent.name} bufferedAmount=${ws.bufferedAmount}`);
  }
  try { ws.send(JSON.stringify(message)); } catch (e) {}
}

function safeSendRaw(ws, message) {
  try {
    if (ws.bufferedAmount > BACKPRESSURE_KILL) { ws.close(1011, 'backpressure overflow'); return; }
    ws.send(JSON.stringify(message));
  } catch (e) {}
}

// ==================== 三档推送 + 心跳 ====================

const entitySnapshot = new Map();  // connectionId -> Map(characterId -> {pos,type,name})

function startPushLoop() {
  setInterval(() => {
    const playerPositions = wsServer.getPlayerPositions();
    for (const [connId, state] of activeAgents.entries()) {
      if (state.closed) continue;
      if (state.pushTier === 'eco') continue;  // eco 无位置流
      const snap = entitySnapshot.get(connId) || new Map();
      const batch = [];
      playerPositions.forEach((p, pConnId) => {
        if (pConnId === connId) return;
        const pos = p.position;
        if (!pos) return;
        const last = snap.get(p.characterId);
        if (!last || last.pos.x !== pos.x || last.pos.z !== pos.z) {
          batch.push({ id: p.characterId, type: p.entityType === 'agent' ? 'agent' : 'human', name: p.characterName, position: pos, animMode: p.animMode || null });
          snap.set(p.characterId, { pos, type: p.entityType, name: p.characterName });
        }
      });
      entitySnapshot.set(connId, snap);

      const currentIds = new Set([...playerPositions.values()].map(p => p.characterId));
      const snapIds = new Set([...snap.keys()]);
      for (const id of currentIds) {
        if (!snapIds.has(id)) {
          const p = [...playerPositions.values()].find(x => x.characterId === id);
          if (p) safeSend(state, { type: 'ENTITY_ADDED', payload: { id, type: p.entityType === 'agent' ? 'agent' : 'human', name: p.characterName, position: p.position } }, 'entity');
        }
      }
      for (const id of snapIds) {
        if (!currentIds.has(id)) { safeSend(state, { type: 'ENTITY_REMOVED', payload: { id } }, 'entity'); snap.delete(id); }
      }

      if (batch.length > 0) {
        if (state.pushTier === 'realtime') {
          batch.forEach(m => safeSend(state, { type: 'ENTITY_UPDATED', payload: m }, 'position'));
        } else {
          safeSend(state, { type: 'ENTITY_MOVEMENT_BATCH', payload: { moves: batch } }, 'position');
        }
      }
    }
  }, STANDARD_BATCH_INTERVAL_MS).unref();
}

function startHeartbeat() {
  setInterval(() => {
    const now = Date.now();
    for (const [, state] of activeAgents.entries()) {
      if (state.closed) continue;
      // 空闲超时：无操作超时即断开，presenceBridge.onDisconnect 会清 playerPositions 并广播 PLAYER_LEFT
      if (AGENT_IDLE_TIMEOUT_MS > 0 && now - state.lastActivityAt > AGENT_IDLE_TIMEOUT_MS) {
        console.warn(`[AgentWs] 空闲超时断开(>${AGENT_IDLE_TIMEOUT_MS / 60000}min): ${state.agent.name}`);
        audit('ws_idle_timeout', { agent: state.agent.name, agentId: state.agent.id, connectionId: state.connectionId });
        try { state.ws.close(1001, 'idle timeout'); } catch (e) { try { state.ws.terminate(); } catch (e2) {} }
        continue;
      }
      if (now - state.lastPong > HEARTBEAT_TIMEOUT_MS) {
        console.warn(`[AgentWs] 心跳超时断开: ${state.agent.name}`);
        try { state.ws.terminate(); } catch (e) {}
        continue;
      }
      try { state.ws.ping(); } catch (e) {}
    }
  }, HEARTBEAT_INTERVAL_MS).unref();
}

// ==================== CHAT 旁路（monkey-patch broadcastToAll + broadcastToNearby）====================

let chatPatchInstalled = false;
function installChatPatch() {
  if (chatPatchInstalled) return;
  chatPatchInstalled = true;

  // 同时拦截 broadcastToAll 与 broadcastToNearby：人类 CHAT 走 broadcastToNearby（30m），
  // Agent say 也走 broadcastToNearby，故两者都要拦截才能让订阅 chat 的 Agent 收到。
  const origBroadcast = wsServer.broadcastToAll;
  wsServer.broadcastToAll = function (message) {
    origBroadcast.call(wsServer, message);
    forwardChatToAgents(message, null);
  };

  const origNearby = wsServer.broadcastToNearby;
  wsServer.broadcastToNearby = function (sourcePos, range, message, excludeConnId) {
    origNearby.call(wsServer, sourcePos, range, message, excludeConnId);
    forwardChatToAgents(message, sourcePos);
  };
}

function forwardChatToAgents(message, sourcePos) {
  if (!message || message.type !== 'CHAT' || !message.payload) return;
  const chat = message.payload;
  // 若 message 已带 position（P4 say 由 agentActionService 写入），用它；否则用调用方传入的 sourcePos
  const refPos = chat.position || sourcePos;
  for (const [, state] of activeAgents.entries()) {
    if (state.closed || !state.subscription.topics.has('chat')) continue;
    const myPos = wsServer.getPlayerPositions().get(state.connectionId);
    if (!myPos || !myPos.position) continue;
    // 30m 附近口径（与人类侧一致）
    const dist = calcDist(myPos.position, refPos || myPos.position);
    if (dist <= CHAT_NEARBY_RANGE) safeSend(state, { type: 'CHAT', payload: chat }, 'chat');
  }
}

function calcDist(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a.x || 0) - (b.x || 0), dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dz * dz);
}

// ==================== 启动 ====================

let started = false;
function start() {
  if (started) return;
  started = true;
  startPushLoop();
  startHeartbeat();
  installChatPatch();
  console.log('[AgentWs] Agent WebSocket 服务已启动（推送/心跳/CHAT 旁路）');
}

// ==================== 工具 ====================

function resolveSpawn(session) {
  if (session && session.current_position) {
    const p = typeof session.current_position === 'string' ? safeParse(session.current_position) : session.current_position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return { x: p.x, y: Number.isFinite(p.y) ? p.y : 0, z: p.z };
  }
  return { x: 0, y: 0, z: 0 };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function audit(event, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), scope: 'agent-ws', event, ...data }));
}

function getActiveCount() { return activeAgents.size; }

module.exports = { handleUpgrade, start, getActiveCount, AGENT_WS_PATH: '/ws/agent' };
