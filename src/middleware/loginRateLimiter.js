/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */

/**
 * 登录速率限制中间件
 *
 * 四层防护：
 *   1) IP 级别频率限制（内存滑动窗口）
 *   2) 账号级别失败计数 + 自动锁定
 *   3) 渐进式响应延迟（防时序攻击 + 拖慢暴力）
 *   4) 安全告警日志
 *
 * 使用方式：
 *   const { loginRateLimiter } = require('../middleware/loginRateLimiter');
 *   router.post('/login', loginRateLimiter('admin'), async (req, res) => { ... });
 *
 * 参数：
 *   - 'admin':  5次/分钟 IP，3次失败锁定60分钟，第2次失败起延迟
 *   - 'user':   5次/分钟 IP，5次失败锁定30分钟，第3次失败起延迟
 */

const { query } = require('../database/db');

// ======================== 配置常量 ========================

const POLICIES = {
  admin: {
    type: 'admin',
    maxPerMinute: 5,           // 每分钟最多5次
    maxPerHour: 15,            // 每小时最多15次
    maxFailures: 3,            // 3次失败即锁定
    lockMinutes: 60,           // 锁定60分钟
    delayStartAt: 2,           // 第2次失败起延迟
    delayStep: 2,              // 每次+2秒
    ipWindowSec: 60,
    ipWindowCount: 5,
    ipHourWindowSec: 3600,
    ipHourWindowCount: 15
  },
  user: {
    type: 'user',
    maxPerMinute: 5,
    maxPerHour: 15,
    maxFailures: 5,
    lockMinutes: 30,
    delayStartAt: 3,
    delayStep: 2,
    ipWindowSec: 60,
    ipWindowCount: 5,
    ipHourWindowSec: 3600,
    ipHourWindowCount: 15
  },
  register: {
    type: 'register',
    maxPerMinute: 2,           // 注册更严格：每分钟最多2次
    maxPerHour: 5,             // 每小时最多5次
    maxPerDay: 10,             // 每天最多10次
    delayStartAt: 2,           // 第2次请求起开始延迟
    delayStep: 3,              // 每次+3秒（比登录更激进）
    emailWindowMin: 30,        // 同一邮箱30分钟内只能注册1次
    ipWindowSec: 60,
    ipWindowCount: 2,
    ipHourWindowSec: 3600,
    ipHourWindowCount: 5
  }
};

// ======================== 内存状态 ========================

// IP 请求追踪: { "ip": { minute: [{ts}], hour: [{ts}] } }
const ipTracker = new Map();

// 每10分钟清理一次过期记录
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipTracker.entries()) {
    data.minute = data.minute.filter(ts => now - ts < 60000);
    data.hour = data.hour.filter(ts => now - ts < 3600000);
    if (data.minute.length === 0 && data.hour.length === 0) {
      ipTracker.delete(ip);
    }
  }
}, 600000);

// ======================== 工具函数 ========================

function getClientIp(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection?.remoteAddress || 'unknown';
}

/**
 * 延迟指定毫秒
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 检查账号是否处于锁定状态
 */
async function isAccountLocked(username, targetType) {
  const result = await query(
    `SELECT id, reason, unlock_at
     FROM account_lockouts
     WHERE username = $1
       AND target_type = $2
       AND (unlock_at IS NULL OR unlock_at > NOW())
     ORDER BY locked_at DESC
     LIMIT 1`,
    [username, targetType]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

/**
 * 统计最近窗口内的失败次数
 */
async function countRecentFailures(username, windowMinutes) {
  const result = await query(
    `SELECT COUNT(*) AS cnt
     FROM login_attempts
     WHERE username = $1
       AND success = FALSE
       AND created_at > NOW() - ($2 || ' minutes')::INTERVAL`,
    [username, String(windowMinutes)]
  );
  return parseInt(result.rows[0]?.cnt || '0', 10);
}

/**
 * 记录登录尝试
 */
async function recordAttempt(username, ipAddress, targetType, success, reason) {
  await query(
    `INSERT INTO login_attempts (username, ip_address, target_type, success, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [username, ipAddress, targetType, success, reason || null]
  );
}

/**
 * 自动锁定账号
 */
async function lockAccount(username, targetType, lockMinutes, reason) {
  const unlockAt = lockMinutes
    ? new Date(Date.now() + lockMinutes * 60000).toISOString()
    : null;

  await query(
    `INSERT INTO account_lockouts (username, target_type, locked_by, reason, unlock_at)
     VALUES ($1, $2, 'auto', $3, $4)`,
    [username, targetType, reason || 'too many failed attempts', unlockAt]
  );
}

/**
 * 获取IP窗口内请求次数
 */
function getIpWindowCount(ip, windowMs) {
  const data = ipTracker.get(ip);
  if (!data) return 0;
  const now = Date.now();
  if (windowMs <= 60000) {
    return data.minute.filter(ts => now - ts < windowMs).length;
  }
  return data.hour.filter(ts => now - ts < windowMs).length;
}

/**
 * 记录IP请求
 */
function recordIpRequest(ip) {
  const now = Date.now();
  let data = ipTracker.get(ip);
  if (!data) {
    data = { minute: [], hour: [] };
    ipTracker.set(ip, data);
  }
  data.minute.push(now);
  data.hour.push(now);
}

// ======================== 主中间件工厂 ========================

function loginRateLimiter(targetType) {
  const policy = POLICIES[targetType];
  if (!policy) {
    throw new Error(`Unknown rate limit target type: ${targetType}`);
  }

  return async function(req, res, next) {
    const clientIp = getClientIp(req);
    const username = req.body?.username?.trim();

    // ---- 第1层: IP 级别频率限制 ----
    recordIpRequest(clientIp);

    // 每分钟限制
    const minuteCount = getIpWindowCount(clientIp, policy.ipWindowSec * 1000);
    if (minuteCount > policy.ipWindowCount) {
      console.warn(`[RateLimiter] IP ${clientIp} 超过每分钟请求限制 (${minuteCount}/${policy.ipWindowCount})`);
      return res.status(429).json({
        error: '请求过于频繁，请稍后再试',
        retryAfter: 60,
        code: 'RATE_LIMITED_IP_MINUTE'
      });
    }

    // 每小时限制
    const hourCount = getIpWindowCount(clientIp, policy.ipHourWindowSec * 1000);
    if (hourCount > policy.ipHourWindowCount) {
      console.warn(`[RateLimiter] IP ${clientIp} 超过每小时请求限制 (${hourCount}/${policy.ipHourWindowCount})`);
      return res.status(429).json({
        error: '请求过于频繁，请一小时后重试',
        retryAfter: 3600,
        code: 'RATE_LIMITED_IP_HOUR'
      });
    }

    // ---- 第2层: 账号锁定检查 ----
    if (username) {
      const lockInfo = await isAccountLocked(username, policy.type);
      if (lockInfo) {
        console.warn(`[RateLimiter] 账号 ${username} 处于锁定状态`);
        await recordAttempt(username, clientIp, policy.type, false, 'account_locked');

        const retryAfter = lockInfo.unlock_at
          ? Math.max(0, Math.ceil((new Date(lockInfo.unlock_at).getTime() - Date.now()) / 1000))
          : null;

        return res.status(423).json({
          error: retryAfter
            ? `账号已被临时锁定，请在 ${Math.ceil(retryAfter / 60)} 分钟后重试`
            : '账号已被锁定，请联系管理员',
          retryAfter,
          code: 'ACCOUNT_LOCKED'
        });
      }

      // ---- 第3层: 渐进式延迟 ----
      const recentFails = await countRecentFailures(username, policy.lockMinutes);
      if (recentFails >= policy.delayStartAt) {
        const delaySeconds = (recentFails - policy.delayStartAt + 1) * policy.delayStep;
        console.log(`[RateLimiter] 渐进延迟 ${delaySeconds}s (账号: ${username}, 最近失败: ${recentFails})`);
        await delay(delaySeconds * 1000);
      }
    }

    // ---- 放行 ----
    next();
  };
}

/**
 * 登录成功后的清理：重置失败计数（记录成功尝试）
 */
async function onLoginSuccess(username, ipAddress, targetType) {
  await recordAttempt(username, ipAddress, targetType, true, null);
}

/**
 * 登录失败后的记录：累计失败次数，必要时锁定
 */
async function onLoginFailure(username, ipAddress, targetType, reason) {
  const policy = POLICIES[targetType];
  if (!policy) return;

  await recordAttempt(username, ipAddress, targetType, false, reason || 'invalid_credentials');

  const recentFails = await countRecentFailures(username, policy.lockMinutes);

  if (recentFails >= policy.maxFailures) {
    // 检查是否已被锁定（防止重复锁定）
    const lockInfo = await isAccountLocked(username, policy.type);
    if (lockInfo) return;

    await lockAccount(username, policy.type, policy.lockMinutes,
      `连续失败 ${recentFails} 次（阈值 ${policy.maxFailures}）自动锁定 ${policy.lockMinutes} 分钟`
    );

    console.warn(`[RateLimiter] 账号 ${username} 已被自动锁定 ${policy.lockMinutes} 分钟 (失败 ${recentFails} 次)`);
  }
}

/**
 * 手动解锁账号（管理员调用）
 */
async function manualUnlock(username, targetType, unlockedBy) {
  const result = await query(
    `UPDATE account_lockouts
     SET unlock_at = NOW(),
         unlocked_by = $3,
         unlocked_at = NOW()
     WHERE username = $1
       AND target_type = $2
       AND (unlock_at IS NULL OR unlock_at > NOW())`,
    [username, targetType, unlockedBy]
  );
  return result.rowCount > 0;
}

/**
 * 获取当前锁定的账号列表
 */
async function getLockedAccounts() {
  const result = await query(
    `SELECT id, username, target_type, locked_by, reason,
            locked_at, unlock_at
     FROM account_lockouts
     WHERE unlock_at IS NULL OR unlock_at > NOW()
     ORDER BY locked_at DESC`
  );
  return result.rows;
}

/**
 * 获取账号的登录失败统计
 */
async function getLoginStats(username) {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE success = FALSE) AS failed_count,
       COUNT(*) FILTER (WHERE success = TRUE) AS success_count,
       MAX(created_at) AS last_attempt_at
     FROM login_attempts
     WHERE username = $1
       AND created_at > NOW() - INTERVAL '24 hours'`,
    [username]
  );
  return result.rows[0] || { failed_count: 0, success_count: 0, last_attempt_at: null };
}

// ======================== 注册专用工具函数 ========================

/**
 * 检查邮箱是否在窗口期内已被使用注册
 */
async function isEmailRecentlyUsed(email, windowMinutes) {
  const result = await query(
    `SELECT COUNT(*) AS cnt
     FROM users
     WHERE email = $1
       AND created_at > NOW() - ($2 || ' minutes')::INTERVAL`,
    [email, String(windowMinutes)]
  );
  return parseInt(result.rows[0]?.cnt || '0', 10) > 0;
}

/**
 * 检测可疑用户名（注册机通常生成的模式）
 */
function isSuspiciousUsername(username) {
  if (!username) return false;

  // 1. 纯随机字符串（含大量数字和字母混合，长度异常）
  const randomPattern = /^[a-z0-9]{8,}$/i;
  const hasRepeatedChars = /(.)\1{3,}/; // 连续4个相同字符

  // 2. 包含明显恶意模式
  const suspiciousPrefixes = ['test', 'spam', 'bot', 'hack', 'admin', 'root', 'sql'];
  const lowerUser = username.toLowerCase();

  for (const prefix of suspiciousPrefixes) {
    if (lowerUser.startsWith(prefix) && /\d{3,}$/.test(lowerUser)) {
      return true; // test123, bot001, spam999 等
    }
  }

  // 3. 纯随机字符串 + 重复字符
  if (randomPattern.test(username) && hasRepeatedChars.test(username)) {
    return true;
  }

  // 4. 10位以上纯数字用户名
  if (/^\d{10,}$/.test(username)) {
    return true;
  }

  return false;
}

/**
 * 记录注册尝试日志
 */
async function logRegistrationAttempt(ip, email, username, success, reason) {
  try {
    await query(
      `INSERT INTO login_attempts (username, ip_address, target_type, success, reason)
       VALUES ($1, $2, 'register', $3, $4)`,
      [username || 'unknown', ip, success, reason || null]
    );
  } catch (e) {
    console.warn('[RegisterLimiter] 记录注册日志失败:', e.message);
  }
}

// ======================== 注册速率限制中间件 ========================

function registerRateLimiter() {
  const policy = POLICIES.register;

  return async function(req, res, next) {
    const clientIp = getClientIp(req);
    const { username, email } = req.body;

    // ---- 第1层: IP 级别频率限制 ----
    recordIpRequest(clientIp);

    // 每分钟限制
    const minuteCount = getIpWindowCount(clientIp, policy.ipWindowSec * 1000);
    if (minuteCount > policy.ipWindowCount) {
      console.warn(`[RegisterLimiter] IP ${clientIp} 超过每分钟注册限制 (${minuteCount}/${policy.ipWindowCount})`);
      await logRegistrationAttempt(clientIp, email || 'unknown', username || 'unknown', false, 'ip_minute_limit');
      return res.status(429).json({
        error: '注册过于频繁，请60秒后重试',
        retryAfter: 60,
        code: 'REGISTER_RATE_LIMITED'
      });
    }

    // 每小时限制
    const hourCount = getIpWindowCount(clientIp, policy.ipHourWindowSec * 1000);
    if (hourCount > policy.ipHourWindowCount) {
      console.warn(`[RegisterLimiter] IP ${clientIp} 超过每小时注册限制 (${hourCount}/${policy.ipHourWindowCount})`);
      await logRegistrationAttempt(clientIp, email || 'unknown', username || 'unknown', false, 'ip_hour_limit');
      return res.status(429).json({
        error: '注册过于频繁，请一小时后重试',
        retryAfter: 3600,
        code: 'REGISTER_RATE_LIMITED_HOUR'
      });
    }

    // ---- 第2层: 邮箱频率限制（防止换IP注册同一邮箱） ----
    if (email && policy.emailWindowMin > 0) {
      try {
        const emailUsed = await isEmailRecentlyUsed(email, policy.emailWindowMin);
        if (emailUsed) {
          console.warn(`[RegisterLimiter] 邮箱 ${email} 在 ${policy.emailWindowMin} 分钟内已注册过`);
          await logRegistrationAttempt(clientIp, email, username || 'unknown', false, 'email_recently_used');
          return res.status(429).json({
            error: `该邮箱最近已注册，请${policy.emailWindowMin}分钟后重试`,
            retryAfter: policy.emailWindowMin * 60,
            code: 'EMAIL_RECENTLY_USED'
          });
        }
      } catch (dbErr) {
        console.error('[RegisterLimiter] 邮箱检查失败:', dbErr.message);
        // 数据库错误不阻塞注册（避免单点故障）
      }
    }

    // ---- 第3层: 用户名模式检测 ----
    if (username && isSuspiciousUsername(username)) {
      console.warn(`[RegisterLimiter] 检测到可疑用户名: ${username} (IP: ${clientIp})`);
      await logRegistrationAttempt(clientIp, email || 'unknown', username, false, 'suspicious_username');

      let detail = '用户名包含异常字符模式';
      if (/(.)(\1){3,}/.test(username)) {
        detail = '用户名包含连续 4 个及以上相同字符，请拆分或替换';
      } else if (['test','spam','bot','hack','admin','root','sql'].some(p => username.toLowerCase().startsWith(p) && /\d{3,}$/.test(username))) {
        detail = '用户名包含敏感前缀 + 数字组合，请使用普通用户名';
      } else if (/^\d{10,}$/.test(username)) {
        detail = '用户名不能为 10 位以上纯数字';
      } else if (/^[a-z0-9]{8,}$/i.test(username)) {
        detail = '用户名疑似随机字符串，请使用有意义的用户名';
      }

      return res.status(400).json({
        error: '用户名格式不符合要求，请使用3-20位正常字符',
        detail: detail,
        code: 'SUSPICIOUS_USERNAME'
      });
    }

    // ---- 第4层: 渐进式延迟（拖慢自动化脚本） ----
    const requestCount = getIpWindowCount(clientIp, policy.ipHourWindowSec * 1000);
    if (requestCount >= policy.delayStartAt) {
      const delaySeconds = (requestCount - policy.delayStartAt + 1) * policy.delayStep;
      console.log(`[RegisterLimiter] 渐进延迟 ${delaySeconds}s (IP: ${clientIp}, 请求次数: ${requestCount})`);
      await delay(delaySeconds * 1000);
    }

    // ---- 放行 ----
    next();
  };
}

/**
 * 注册成功后记录日志
 */
async function onRegisterSuccess(ip, email, username) {
  await logRegistrationAttempt(ip, email, username, true, null);
}

module.exports = {
  loginRateLimiter,
  registerRateLimiter,
  onLoginSuccess,
  onLoginFailure,
  onRegisterSuccess,
  manualUnlock,
  getLockedAccounts,
  getLoginStats,
  POLICIES
};
