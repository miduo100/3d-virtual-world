/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * AI 额度限频守卫（安全修复 D3）
 * ------------------------------------------------------------------
 * 用途：给「花真金白银」的 AI 端点（/api/ai/*、/api/ai-factory/*、/api/ai-scene/*、
 *       /api/tripo/* 等）加一个**按 IP 的每小时次数上限**，封堵匿名刷取额度。
 *
 * 关键实现约束（否则会造成灾难性误伤，见《安全修复-开发规划与规范.md》§5.1.4）：
 *   1. **必须复用 `src/middleware/clientIp.js` 的 `resolveClientIp`**
 *      （X-Real-IP → X-Forwarded-For 末段 → socket）。若直接用 `req.ip`，
 *      经 Nginx 反代后全世界会算成同一个 IP，配额退化成"全站 10 次/小时"。
 *   2. **携带有效管理员 token 的请求不计数**：后台批量生成场景 / 切模型是正常操作，
 *      不该被 10 次/小时限制打死（等价于"封匿名刷取、保管理员原体验"）。
 *   3. 超限返回 429 + `{ error, code, retryAfter }`，与项目既有 429 风格一致
 *      （参考 loginRateLimiter / 游客签票）。
 *
 * 开关：
 *   - `AI_QUOTA_PER_HOUR`（默认 10）
 *   - `AI_QUOTA_OFF=1` → 全部放行
 *
 * ⚠️ 依赖部署层：若 3002 仍对公网明文直连（审计 S2-03），客户端可伪造 X-Real-IP
 *    绕过本配额；本守卫是"匿名刷取"的第一道闸，端口收敛（D4）是根治手段。
 */
const jwt = require('jsonwebtoken');
const { resolveClientIp } = require('./clientIp');

const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_PER_HOUR = 10;

/** ip → { start, count }（内存滑动窗口，重启即清空） */
const buckets = new Map();

function isQuotaOff() {
  const raw = String(process.env.AI_QUOTA_OFF || '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

function perHourLimit() {
  const n = Number(process.env.AI_QUOTA_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_PER_HOUR;
}

/** 是否携带**有效**管理员 token（用于豁免配额；仅验签，不查库，避免额外 DB 往返） */
function isAdminRequest(req) {
  const header = (req.headers && req.headers['authorization']) || '';
  const token = header.split(' ')[1];
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    return !!(decoded && decoded.type === 'admin');
  } catch (e) {
    return false;
  }
}

/**
 * 计数并判定是否放行（纯函数式，便于验收脚本直接调用）
 * @returns {{allowed:boolean, skipped?:string, ip?:string, used?:number, limit?:number, retryAfter?:number}}
 */
function check(req) {
  if (isQuotaOff()) return { allowed: true, skipped: 'off' };
  if (isAdminRequest(req)) return { allowed: true, skipped: 'admin' };

  const ip = resolveClientIp(req);
  const limit = perHourLimit();
  const now = Date.now();

  let bucket = buckets.get(ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    bucket = { start: now, count: 0 };
    buckets.set(ip, bucket);
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      ip,
      used: bucket.count,
      limit,
      retryAfter: Math.max(1, Math.ceil((bucket.start + WINDOW_MS - now) / 1000)),
    };
  }

  bucket.count++;
  return { allowed: true, ip, used: bucket.count, limit };
}

/** Express 中间件 */
function middleware(req, res, next) {
  const result = check(req);
  if (result.allowed) return next();

  console.warn(
    `[aiQuotaGuard] 429 ${req.method} ${(req.baseUrl || '') + (req.path || '')} ` +
    `ip=${result.ip} used=${result.used}/${result.limit} retryAfter=${result.retryAfter}s`
  );
  return res.status(429).json({
    error: `请求过于频繁：AI 相关接口限每 IP 每小时 ${result.limit} 次，请稍后重试`,
    code: 'AI_QUOTA_EXCEEDED',
    retryAfter: result.retryAfter,
  });
}

/** 过期桶清理（惰性定时，unref 不阻塞退出） */
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of buckets) {
    if (now - bucket.start >= WINDOW_MS) buckets.delete(ip);
  }
}, 10 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

/** 供验收脚本使用：查看/重置某 IP 计数 */
function peek(ip) {
  const b = buckets.get(ip);
  return b ? { count: b.count, limit: perHourLimit() } : { count: 0, limit: perHourLimit() };
}
function reset(ip) {
  if (ip) buckets.delete(ip);
  else buckets.clear();
}

module.exports = {
  middleware,
  check,
  isAdminRequest,
  isQuotaOff,
  perHourLimit,
  peek,
  reset,
  _buckets: buckets,
};
