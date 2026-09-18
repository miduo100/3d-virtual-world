/**
 * AI Agent 接入 - 聊天记录归档服务（P4 e/f）
 * 每日定时导出昨日记录 → JSONL → gzip → 上传 S3 兼容对象存储 → 保留期到期清理
 *
 * 红线13（防丢铁律）：未成功上传远端的本地数据永不删除；重试 7 次仍失败则保留本地并告警
 *
 * 配置（system_config，agentConfigService）：
 *   chat_log_remote_enabled / chat_log_remote_provider / chat_log_s3_*
 *   chat_log_retention_days / chat_log_upload_hour
 *
 * 启动：server.js 调用 startArchiveLoop()，每 1 小时检查一次 upload_hour 是否到达
 */

const zlib = require('zlib');
const { query } = require('../database/db');
const agentConfigService = require('../agent/agentConfigService');
const chatLogService = require('../agent/chatLogService');

const MAX_RETRY = 7;                          // 重试上限（红线13）
const LOOP_INTERVAL_MS = 60 * 60 * 1000;      // 每小时检查一次
const lastRunHour = new Map();                 // key: 'YYYY-MM-DD' → 已执行的归档日期

let archiveLoop = null;
let awsSdk = null;                             // 惰性加载，避免未安装时报错

// ==================== 启动入口 ====================

function startArchiveLoop() {
  if (archiveLoop) return;
  archiveLoop = setInterval(() => {
    runArchiveCheck().catch(e => console.warn('[ChatArchive] 检查异常:', e.message));
  }, LOOP_INTERVAL_MS);
  if (archiveLoop.unref) archiveLoop.unref();
  console.log('[ChatArchive] 归档循环已启动（每小时检查一次 upload_hour）');
}

function stopArchiveLoop() {
  if (archiveLoop) { clearInterval(archiveLoop); archiveLoop = null; }
}

// ==================== 主流程 ====================

async function runArchiveCheck() {
  const cfg = await agentConfigService.getConfig();
  if (!cfg.chatLogRemoteEnabled) return;       // 远端归档未开
  if (cfg.chatLogRemoteProvider !== 's3') return; // 仅 s3 实现，baidu 预留

  const now = new Date();
  const currentHour = now.getHours();
  if (currentHour !== cfg.chatLogUploadHour) return;

  // 检查今天是否已执行（防同一小时多次触发）
  const todayKey = formatDateKey(now);
  if (lastRunHour.has(todayKey)) return;

  // 归档昨日（00:00 - 24:00）
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const dayStart = new Date(yesterday);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(yesterday);
  dayEnd.setHours(24, 0, 0, 0);

  await archiveDay(dayStart, dayEnd);
  lastRunHour.set(todayKey, true);

  // 保留期到期清理（仅清理已成功归档的行）
  try {
    const cleaned = await chatLogService.cleanupExpired(cfg.chatLogRetentionDays);
    if (cleaned > 0) console.log(`[ChatArchive] 保留期清理：删除 ${cleaned} 条已归档过期本地行`);
  } catch (e) {
    console.warn('[ChatArchive] 保留期清理失败:', e.message);
  }
}

/**
 * 手动触发归档（管理员测试用 · POST /admin/archive/run-now）
 * force 仍尊重 remote_enabled=false（管理员要测上传需先开 remote_enabled）
 */
async function runArchiveNow(dayStr) {
  const cfg = await agentConfigService.getConfig();
  if (!cfg.chatLogRemoteEnabled) {
    return { skipped: 'remote_not_enabled' };
  }
  if (cfg.chatLogRemoteProvider !== 's3') {
    return { skipped: 'provider_not_s3', provider: cfg.chatLogRemoteProvider };
  }

  let dayStart, dayEnd;
  if (dayStr) {
    // 指定日期
    const d = new Date(dayStr);
    if (isNaN(d.getTime())) throw new Error('日期格式无效，需 YYYY-MM-DD');
    dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
    dayEnd = new Date(d); dayEnd.setHours(24, 0, 0, 0);
  } else {
    // 默认昨日
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    dayStart = new Date(yesterday); dayStart.setHours(0, 0, 0, 0);
    dayEnd = new Date(yesterday); dayEnd.setHours(24, 0, 0, 0);
  }
  return archiveDay(dayStart, dayEnd);
}

// ==================== 单日归档 ====================

/**
 * 归档指定日期范围
 * 流程：导出 → JSONL → gzip → 上传 S3 → markArchived → （到期才清理）
 * 防丢铁律：上传失败 → 不调用 markArchived → cleanupExpired 永不删除该日行
 */
async function archiveDay(dayStart, dayEnd, force = false) {
  const cfg = await agentConfigService.getConfig();
  if (!force && (!cfg.chatLogRemoteEnabled || cfg.chatLogRemoteProvider !== 's3')) {
    return { skipped: 'remote_not_enabled' };
  }

  // 1) 查询该日记录
  const rows = await chatLogService.getRange(dayStart, dayEnd);
  if (rows.length === 0) {
    return { skipped: 'no_records', dayStart, dayEnd };
  }

  // 2) JSONL + gzip
  const jsonl = rows.map(r => JSON.stringify({
    id: r.id,
    type: r.sender_type,
    senderId: r.sender_id,
    senderName: r.sender_name,
    message: r.message,
    position: r.position,
    createdAt: r.created_at
  })).join('\n');
  const gzipped = zlib.gzipSync(Buffer.from(jsonl, 'utf-8'));

  // 3) 远端 key：chat-archive/YYYY/MM/DD.jsonl.gz
  const dateStr = dayStart.toISOString().slice(0, 10);
  const [y, m, d] = dateStr.split('-');
  const prefix = (await agentConfigService.getRawConfig()).chat_log_s3_prefix || 'chat-archive';
  const remoteKey = `${prefix}/${y}/${m}/${d}.jsonl.gz`;

  // 4) 上传 S3（重试上限 7 次）
  const uploadResult = await uploadWithRetry(remoteKey, gzipped, MAX_RETRY);
  if (!uploadResult.ok) {
    // 红线13：上传失败 → 不标记 archived → 本地行永不删除
    console.error(`[ChatArchive] 上传失败 ${remoteKey}（重试 ${MAX_RETRY} 次），本地行保留，等待次日重试`);
    return {
      uploaded: false,
      remoteKey,
      records: rows.length,
      error: uploadResult.error
    };
  }

  // 5) 标记已归档（cleanupExpired 才能清理）
  await chatLogService.markArchived(dayStart, dayEnd, remoteKey);

  console.log(`[ChatArchive] 归档成功 ${remoteKey}（${rows.length} 条）`);
  return {
    uploaded: true,
    remoteKey,
    records: rows.length,
    bytes: gzipped.length
  };
}

// ==================== S3 上传（含重试）====================

async function uploadWithRetry(remoteKey, data, maxRetry) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      await uploadToS3(remoteKey, data);
      return { ok: true, attempt };
    } catch (e) {
      lastError = e;
      console.warn(`[ChatArchive] S3 上传失败 attempt=${attempt}/${maxRetry} key=${remoteKey}:`, e.message);
      // 指数退避：1s, 2s, 4s, 8s, 16s, 32s, 64s
      if (attempt < maxRetry) {
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        await sleep(delayMs);
      }
    }
  }
  return { ok: false, error: lastError ? lastError.message : 'unknown' };
}

async function uploadToS3(remoteKey, data) {
  // 惰性加载 @aws-sdk/client-s3（未安装则抛错，外层捕获）
  if (!awsSdk) {
    awsSdk = require('@aws-sdk/client-s3');
  }
  const { S3Client, PutObjectCommand } = awsSdk;

  // 读取配置
  const raw = await agentConfigService.getRawConfig();
  const endpoint = raw.chat_log_s3_endpoint || '';
  const bucket = raw.chat_log_s3_bucket || '';
  const accessKey = await agentConfigService.getSensitiveValue('chat_log_s3_access_key');
  const secretKey = await agentConfigService.getSensitiveValue('chat_log_s3_secret_key');

  if (!bucket) throw new Error('S3 bucket 未配置');
  if (!accessKey || !secretKey) throw new Error('S3 凭据未配置');

  const s3 = new S3Client({
    region: 'us-east-1',     // S3 兼容协议通常不强制 region
    endpoint: endpoint || undefined,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true     // 兼容 MinIO/OSS/COS 路径风格
  });
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: remoteKey,
    Body: data,
    ContentType: 'application/gzip'
  }));
}

// ==================== 工具 ====================

function formatDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 状态查询（诊断）====================

function getStatus() {
  return {
    loopRunning: !!archiveLoop,
    lastRunDays: Array.from(lastRunHour.keys())
  };
}

module.exports = {
  startArchiveLoop,
  stopArchiveLoop,
  runArchiveCheck,
  runArchiveNow,
  archiveDay,
  getStatus,
  MAX_RETRY
};
