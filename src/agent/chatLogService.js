/**
 * AI Agent 接入 - 聊天记录服务（P4 d）
 * world_chat_log 表：玩家/Agent 间 30m 附近聊天持久化（语音只存元数据不存音频）
 *
 * 写入点：wsServer.js CHAT 分支一次异步 INSERT（不阻塞广播，失败仅日志）
 * 读取点：GET /api/agent/v1/chat/history（AI 重连恢复上下文）
 *
 * 红线13：未成功归档的本地数据永不删除；保留期到期清除只针对已成功归档的行
 */

const { query } = require('../database/db');
const agentConfigService = require('./agentConfigService');

// ==================== 写入 ====================

/**
 * 异步写入一条聊天记录（不阻塞广播）
 * 失败仅日志（红线：聊天记录失败不阻断正常广播）
 * chat_log_enabled=false 时直接跳过
 */
async function insertLog({ senderType, senderId, senderName, message, position }) {
  try {
    const cfg = await agentConfigService.getConfig();
    if (!cfg.chatLogEnabled) return;

    const text = String(message || '').slice(0, 200);
    if (!text) return;

    const posJson = (position && (Number.isFinite(position.x) || Number.isFinite(position.z)))
      ? JSON.stringify({ x: position.x || 0, y: position.y || 0, z: position.z || 0 })
      : null;

    await query(
      `INSERT INTO world_chat_log (sender_type, sender_id, sender_name, message, position)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        senderType === 'agent' ? 'agent' : 'human',
        senderId ? String(senderId).slice(0, 80) : null,
        String(senderName || '未知').slice(0, 100),
        text,
        posJson
      ]
    );
  } catch (e) {
    // 失败仅打日志，不阻断广播
    console.warn('[ChatLog] 写入失败（不影响广播）:', e.message);
  }
}

// ==================== 读取 ====================

/**
 * 读取聊天记录（GET /chat/history）
 * 返回 [{ id, senderType, senderId, senderName, message, position, createdAt }]
 *
 * @param sinceId 增量游标（2026-09-24，用户决策）：只取 `id > sinceId` 的**新增**消息。
 *   为什么必须有它：游客档收不到推送，只能轮询本接口；而原来只有"最近 N 条"，于是每来
 *   1 条新消息，客户端都会把同一批 N 条重新拉一遍 —— 同一批消息被重复拉 N 次，游客 AI 一多
 *   就把 DB 压力放大 N 倍，客户端还得自造去重（上一版 ai-live 为此写了两套去重表）。
 *   有游标后每次只取新增（通常 0~1 条）：**既是"AI 能自动接话"的前提，也是减压开关**。
 *   排序口径：缺省（无 since）保持历史行为 created_at DESC（最新在前）；since 分支按
 *   id ASC（最旧的新消息在前），客户端顺序消费并推进游标 —— 不重、不漏、不乱序。
 */
async function getRecentHistory(limit = 20, sinceId = null) {
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
  const since = Number(sinceId) > 0 ? Math.floor(Number(sinceId)) : null;
  const cols = 'id, sender_type, sender_id, sender_name, message, position, created_at';
  const result = since
    ? await query(`SELECT ${cols} FROM world_chat_log WHERE id > $2 ORDER BY id ASC LIMIT $1`, [safeLimit, since])
    : await query(`SELECT ${cols} FROM world_chat_log ORDER BY created_at DESC LIMIT $1`, [safeLimit]);
  return result.rows.map(r => ({
    id: r.id,
    senderType: r.sender_type,
    senderId: r.sender_id,
    senderName: r.sender_name,
    message: r.message,
    position: r.position,
    createdAt: r.created_at
  }));
}

/**
 * 读取指定日期范围（用于归档导出）
 * 返回完整行数组（含 id 用于后续清理）
 */
async function getRange(startDate, endDate) {
  const result = await query(
    `SELECT id, sender_type, sender_id, sender_name, message, position, created_at
     FROM world_chat_log
     WHERE created_at >= $1 AND created_at < $2
     ORDER BY created_at ASC`,
    [startDate, endDate]
  );
  return result.rows;
}

// ==================== 清理（保留期到期）====================

/**
 * 删除已成功归档的本地行（保留期到期）
 * 红线13：未成功归档的本地数据永不删除 → 仅清理 archived=true 的行
 *   archived 标记由 chatArchiveService 在远端上传成功后写入 chat_log_archived 表
 */
async function cleanupExpired(retentionDays) {
  const cfg = retentionDays ? null : await agentConfigService.getConfig();
  const days = retentionDays || cfg.chatLogRetentionDays;
  const result = await query(
    `DELETE FROM world_chat_log
     WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
       AND id IN (SELECT log_id FROM chat_log_archived WHERE archived_at IS NOT NULL)`,
    [String(days)]
  );
  return result.rowCount;
}

// ==================== 归档标记表（P4 e）====================

/**
 * 标记某日的聊天记录已成功归档（远端上传成功后调用）
 * 防丢铁律：未标记的行 cleanupExpired 永不删除
 */
async function markArchived(dayStart, dayEnd, remoteKey) {
  // 创建 chat_log_archived 表（幂等，第一次调用时）
  await query(`
    CREATE TABLE IF NOT EXISTS chat_log_archived (
      id BIGSERIAL PRIMARY KEY,
      log_id BIGINT NOT NULL,
      archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      remote_key TEXT,
      UNIQUE(log_id)
    )`);
  // 标记该范围所有行
  const result = await query(
    `INSERT INTO chat_log_archived (log_id, remote_key)
     SELECT id, $3 FROM world_chat_log
     WHERE created_at >= $1 AND created_at < $2
       AND id NOT IN (SELECT log_id FROM chat_log_archived)
     ON CONFLICT (log_id) DO NOTHING`,
    [dayStart, dayEnd, remoteKey]
  );
  return result.rowCount;
}

module.exports = {
  insertLog,
  getRecentHistory,
  getRange,
  cleanupExpired,
  markArchived
};
