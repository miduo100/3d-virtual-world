/**
 * logger.js — 日志三分流（P8 前置基建）
 *
 * 三通道，各自独立文件、独立保留期、按天轮转：
 *   access.log  JSONL  HTTP 请求 / WS 连断 / 签票              保留 7 天
 *   ops.log     人读    启停 / 迁移 / Agent 生命周期 / 归档 / 错误  保留 30 天
 *   audit.log   JSONL  登录 / 创建停用 Agent / 发 Key / 改配置 / 拉黑  长期保留（365 天）
 *
 * 设计要点：
 *   - 按天轮转不靠定时器：每次写入用当天日期算文件名，跨天自动新建文件（无需重启）。
 *   - 写入串行化：每通道一条 Promise 队列，避免并发 appendFile 交叉写坏行。
 *   - 写盘失败只 console.error，绝不抛异常拖垮业务（日志是旁路，不是关键路径）。
 *   - 黑名单原则：旧大文件里的 console.log 不迁移，只在新增/改造点使用本模块。
 *
 * 用法：
 *   const logger = require('./services/logger');
 *   logger.start();                       // 启动时一次
 *   app.use(logger.httpMiddleware());     // Express 访问日志（过滤 /health）
 *   logger.access({ kind:'ws', event:'connect', ... });
 *   logger.ops('Agent WS 服务已启动', { path: '/ws/agent' });
 *   logger.audit('session_issued', { agent: 'x', ip: '1.2.3.4' });
 */

const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

const RETENTION_DAYS = {
  access: 7,
  ops: 30,
  audit: Number(process.env.AUDIT_LOG_RETENTION_DAYS) || 365
};

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// 每通道一条写队列（Promise 链），保证串行 append
const queues = { access: Promise.resolve(), ops: Promise.resolve(), audit: Promise.resolve() };
let cleanupTimer = null;
let started = false;

// ==================== 基础 ====================

function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function filePath(channel, date) {
  return path.join(LOG_DIR, `${channel}-${dayKey(date || new Date())}.log`);
}

function ts() { return new Date().toISOString(); }

function clientIp(req) {
  return req.ip
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress)
    || 'unknown';
}

function enqueue(channel, line) {
  const file = filePath(channel);
  queues[channel] = queues[channel]
    .then(() => fsp.appendFile(file, line + '\n', 'utf8'))
    .catch((e) => { console.error(`[logger] 写入 ${channel} 失败:`, e.message); });
  return queues[channel];
}

// ==================== 三通道 API ====================

/** access：结构化单行 JSON（机器消费） */
function access(fields) {
  return enqueue('access', JSON.stringify({ ts: ts(), ...fields }));
}

/** ops：人读单行（时间 + 级别 + 消息 + key=value） */
function ops(message, fields, level) {
  let line = `${ts()} [${level || 'INFO'}] ${message}`;
  if (fields && typeof fields === 'object') {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      line += ` ${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`;
    }
  }
  return enqueue('ops', line);
}

function opsError(message, fields) { return ops(message, fields, 'ERROR'); }
function opsWarn(message, fields) { return ops(message, fields, 'WARN'); }

/** audit：敏感操作，结构化 JSONL，长期保留 */
function audit(event, fields) {
  return enqueue('audit', JSON.stringify({ ts: ts(), event, ...fields }));
}

// ==================== Express 访问日志中间件 ====================

const SILENT_PATHS = new Set(['/health', '/api/health', '/favicon.ico']);

function httpMiddleware() {
  return function loggerHttpMiddleware(req, res, next) {
    const startAt = Date.now();
    res.on('finish', () => {
      const p = (req.originalUrl || req.url || '').split('?')[0];
      if (SILENT_PATHS.has(p)) return;
      access({
        kind: 'http',
        method: req.method,
        path: p,
        status: res.statusCode,
        ms: Date.now() - startAt,
        ip: clientIp(req)
      });
    });
    next();
  };
}

// ==================== 维护 ====================

async function cleanupOnce() {
  let entries;
  try { entries = await fsp.readdir(LOG_DIR); } catch (e) { return 0; }
  const now = Date.now();
  let removed = 0;
  for (const name of entries) {
    const m = /^(access|ops|audit)-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
    if (!m) continue;
    const ageDays = (now - new Date(m[2] + 'T00:00:00').getTime()) / 86400000;
    if (ageDays <= RETENTION_DAYS[m[1]]) continue;
    try { await fsp.unlink(path.join(LOG_DIR, name)); removed++; } catch (e) { /* 已删或无权限 */ }
  }
  return removed;
}

function start() {
  if (started) return;
  started = true;
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
  cleanupOnce().then((n) => {
    if (n > 0) ops('日志过期清理完成', { removed: n });
  }).catch(() => {});
  cleanupTimer = setInterval(() => { cleanupOnce().catch(() => {}); }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
  ops('日志系统已启动', { dir: LOG_DIR, retention: JSON.stringify(RETENTION_DAYS) });
}

function stop() {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
  started = false;
}

module.exports = {
  LOG_DIR,
  RETENTION_DAYS,
  start,
  stop,
  access,
  ops,
  opsError,
  opsWarn,
  audit,
  httpMiddleware,
  cleanupOnce,
  // 测试/诊断用
  _dayKey: dayKey,
  _filePath: filePath,
  _clientIp: clientIp
};
