/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 附近语音中继模块（轻量级 PTT 半双工方案）
 *
 * 协议：
 *   C→S  VOICE_START            按下语音键，请求开麦（服务端判定同时说话人数）
 *   S→C  VOICE_GRANTED          批准 { maxDurationMs, nearbyCount, maxReceivers }
 *   S→C  VOICE_DENIED           拒绝 { reason, speakerCount, nearbyCount, maxReceivers } → 客户端降级文字模式
 *   C→S  VOICE_PROBE            置灰期间定时探测是否恢复
 *   S→C  VOICE_PROBE_RESULT     { allowed, speakerCount, nearbyCount, maxReceivers }
 *   C→S  VOICE_END              松开语音键（腾出说话名额 + 广播停止"正在说话"状态）
 *   C→S  VOICE_MESSAGE          { audio(base64), durationMs } → 中继给 30m 内玩家
 *   S→C  VOICE_STATE            { characterId, characterName, speaking } 头顶🎤指示
 *
 * 同时说话人数上限：system_config.voice_max_receivers（可选 2/3/5/7/8/10，默认3，
 * 管理后台"世界与场景→世界规则"页签设置，60s 缓存内生效无需重启）
 *
 * 判定语义：上限内的人可随时按住说话；第 N+1 个按下者收到 VOICE_DENIED，
 * 有人松开（VOICE_END）、断线或超时后自动腾出名额。
 */

const { query } = require('../database/db');

const VOICE_RANGE = 30;                       // 语音可及半径（米）
const MAX_AUDIO_BASE64_LEN = 2 * 1024 * 1024; // base64 长度上限（60s opus ≈ 240KB，留裕量）
const MAX_DURATION_MS = 61000;                // 单条语音时长上限
const MESSAGE_MIN_INTERVAL_MS = 800;          // 两条语音最小间隔（防刷屏）
const CONFIG_CACHE_TTL = 60000;               // 配置缓存 60s
const ALLOWED_RECEIVER_COUNTS = [2, 3, 5, 7, 8, 10];
const SPEAKER_EXPIRE_MS = MAX_DURATION_MS + 10000; // 说话者超时保护（客户端异常断开未发 VOICE_END 的兜底）

// 由 wsServer.setupWebSocketServer 注入
let _activeConnections = null;
let _playerPositions = null;
let _calculateDistance = null;
let _broadcastToNearby = null;

let _configCache = { value: null, loadedAt: 0 };
const _lastMessageAt = new Map();  // connectionId -> ts（限流）
const _activeSpeakers = new Map(); // connectionId -> { position, characterId, characterName, startedAt } 正在说话的玩家

function init({ activeConnections, playerPositions, calculateDistance, broadcastToNearby }) {
  _activeConnections = activeConnections;
  _playerPositions = playerPositions;
  _calculateDistance = calculateDistance;
  _broadcastToNearby = broadcastToNearby;
}

/**
 * 确保默认配置存在（管理后台"世界规则"页签会读取该项）
 */
async function ensureDefaultConfig() {
  try {
    await query(
      `INSERT INTO system_config (config_key, config_value, description, is_sensitive)
       VALUES ('voice_max_receivers', '3', '附近语音同时说话人数上限（可选 2/3/5/7/8/10，超出者自动切换文字模式）', false)
       ON CONFLICT (config_key) DO NOTHING`
    );
  } catch (error) {
    console.warn('[VoiceRelay] 默认配置写入失败(不影响运行):', error.message);
  }
}

async function _loadConfig() {
  if (_configCache.value && Date.now() - _configCache.loadedAt < CONFIG_CACHE_TTL) {
    return _configCache.value;
  }
  let maxReceivers = 3;
  try {
    const result = await query(
      `SELECT config_value FROM system_config WHERE config_key = 'voice_max_receivers'`
    );
    const n = parseInt(result.rows[0] && result.rows[0].config_value, 10);
    if (ALLOWED_RECEIVER_COUNTS.includes(n)) maxReceivers = n;
  } catch (error) {
    // 读不到配置时用默认值
  }
  _configCache = { value: { maxReceivers }, loadedAt: Date.now() };
  return _configCache.value;
}

/**
 * 计算说话者附近（VOICE_RANGE 内）的其他玩家
 */
function _getNearby(connectionId) {
  const sender = _playerPositions.get(connectionId);
  if (!sender || !sender.position) return { sender: null, nearby: [] };
  const nearby = [];
  _playerPositions.forEach((p, cid) => {
    if (cid === connectionId || !p.position) return;
    const d = _calculateDistance(sender.position, p.position);
    if (d <= VOICE_RANGE) nearby.push({ connectionId: cid, player: p, distance: d });
  });
  return { sender, nearby };
}

/**
 * 清扫超时说话者（客户端崩溃等异常情况收不到 VOICE_END 时的兜底，防止名额被永久占用）
 */
function _sweepExpiredSpeakers() {
  const now = Date.now();
  _activeSpeakers.forEach((info, cid) => {
    if (now - info.startedAt > SPEAKER_EXPIRE_MS) _activeSpeakers.delete(cid);
  });
}

/**
 * 统计某位置附近（VOICE_RANGE 内）正在说话的其他玩家数量
 */
function _getActiveSpeakerCountNear(position, excludeConnectionId) {
  let count = 0;
  _activeSpeakers.forEach((info, cid) => {
    if (cid === excludeConnectionId || !info.position) return;
    if (_calculateDistance(position, info.position) <= VOICE_RANGE) count++;
  });
  return count;
}

function _send(ws, type, payload) {
  try {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, payload }));
  } catch (error) { /* 忽略发送失败 */ }
}

/**
 * 按下语音键：判定附近正在说话的人数是否已达上限
 */
async function handleVoiceStart(connectionId, ws) {
  const { maxReceivers } = await _loadConfig();
  const { sender, nearby } = _getNearby(connectionId);
  _sweepExpiredSpeakers();

  if (!sender) {
    _send(ws, 'VOICE_DENIED', { reason: '尚未加入世界', speakerCount: 0, nearbyCount: 0, maxReceivers });
    return;
  }

  const speakerCount = _getActiveSpeakerCountNear(sender.position, connectionId);
  if (speakerCount >= maxReceivers) {
    _send(ws, 'VOICE_DENIED', {
      reason: '同时说话人数已达上限',
      speakerCount,
      nearbyCount: nearby.length,
      maxReceivers,
    });
    return;
  }

  // 登记为正在说话（VOICE_END / 断线 / 超时后腾出名额）
  _activeSpeakers.set(connectionId, {
    position: sender.position,
    characterId: sender.characterId,
    characterName: sender.characterName,
    startedAt: Date.now(),
  });

  _send(ws, 'VOICE_GRANTED', {
    maxDurationMs: MAX_DURATION_MS,
    nearbyCount: nearby.length,
    maxReceivers,
  });

  // 通知附近玩家：此人正在说话（头顶🎤）
  _broadcastToNearby(
    sender.position,
    VOICE_RANGE,
    {
      type: 'VOICE_STATE',
      payload: {
        characterId: sender.characterId,
        characterName: sender.characterName,
        speaking: true,
      },
    },
    connectionId
  );
}

/**
 * 置灰期间定时探测：正在说话人数恢复到上限内则允许重新点亮语音键
 */
async function handleVoiceProbe(connectionId, ws) {
  const { maxReceivers } = await _loadConfig();
  const { sender, nearby } = _getNearby(connectionId);
  _sweepExpiredSpeakers();
  const speakerCount = sender ? _getActiveSpeakerCountNear(sender.position, connectionId) : 0;
  const allowed = !!sender && speakerCount < maxReceivers;
  _send(ws, 'VOICE_PROBE_RESULT', {
    allowed,
    speakerCount,
    nearbyCount: nearby.length,
    maxReceivers,
  });
}

/**
 * 松开语音键：腾出说话名额 + 通知附近玩家停止"正在说话"指示
 */
function handleVoiceEnd(connectionId) {
  _activeSpeakers.delete(connectionId);
  const { sender, nearby } = _getNearby(connectionId);
  if (!sender || !sender.position) return;
  _broadcastToNearby(
    sender.position,
    VOICE_RANGE,
    {
      type: 'VOICE_STATE',
      payload: {
        characterId: sender.characterId,
        characterName: sender.characterName,
        speaking: false,
      },
    },
    connectionId
  );
}

/**
 * 中继整段语音（base64 opus）给 30m 内玩家（不含说话者）
 */
async function handleVoiceMessage(connectionId, ws, payload) {
  const now = Date.now();
  const last = _lastMessageAt.get(connectionId) || 0;
  if (now - last < MESSAGE_MIN_INTERVAL_MS) return;
  _lastMessageAt.set(connectionId, now);

  const { sender, nearby } = _getNearby(connectionId);
  if (!sender) return;

  const audio = typeof payload.audio === 'string' ? payload.audio : '';
  const durationMs = parseInt(payload.durationMs, 10) || 0;
  if (!audio || audio.length > MAX_AUDIO_BASE64_LEN) return;
  if (durationMs <= 0 || durationMs > MAX_DURATION_MS) return;

  const message = {
    type: 'VOICE_MESSAGE',
    payload: {
      characterId: sender.characterId,
      characterName: sender.characterName,
      audio,
      durationMs,
      timestamp: new Date(),
    },
  };

  let sent = 0;
  nearby.forEach(({ connectionId: cid }) => {
    const client = _activeConnections.get(cid);
    if (client && client.readyState === 1) {
      try {
        client.send(JSON.stringify(message));
        sent++;
      } catch (error) { /* 忽略单个客户端失败 */ }
    }
  });

  console.log(`🎤 语音中继: ${sender.characterName} → ${sent} 人 (${Math.round(durationMs / 1000)}s)`);
}

/**
 * 玩家断开时清理限流与说话者状态
 */
function handleDisconnect(connectionId) {
  _lastMessageAt.delete(connectionId);
  _activeSpeakers.delete(connectionId);
}

module.exports = {
  init,
  ensureDefaultConfig,
  handleVoiceStart,
  handleVoiceProbe,
  handleVoiceEnd,
  handleVoiceMessage,
  handleDisconnect,
  VOICE_RANGE,
};
