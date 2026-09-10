/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 联邦世界注册可达性检查器
 *
 * 设计原则（中心世界零压力）：
 *   第 0 道：子世界发送前自检（本模块的 classifyUrlHost，请求根本不发出）
 *   第 1 道：中心世界静态拒绝（私网/非法 URL 只做字符串判定，零网络 I/O）
 *   第 2 道：回拨验证（仅对"声称公网"的请求，受开关 + 并发闸限制，默认并发 ≤3）
 *
 * 被两个场景共用：
 *   - 子世界（centralWorldConnector / config 路由）：发前自检
 *   - 中心世界（federation 路由 /register-client、/handshake）：接收侧拦截
 *
 * 配置（system_config，带 60s 缓存）：
 *   federation_registration_verify   'on'(默认)/'off'  关闭后跳过回拨（等效选项X）
 *   federation_verify_timeout_ms     默认 3000
 * 环境变量：
 *   FEDERATION_ALLOW_PRIVATE=1       仅测试用：放行私网地址（单机双实例联调）
 */

const os = require('os');
const axios = require('axios');
const { query } = require('../database/db');

// ===== 配置缓存 =====
const CONFIG_CACHE_MS = 60 * 1000;
let _configCache = { at: 0, verify: 'on', timeoutMs: 3000 };

async function _loadConfig() {
  const now = Date.now();
  if (now - _configCache.at < CONFIG_CACHE_MS) return _configCache;
  let verify = 'on';
  let timeoutMs = 3000;
  try {
    const r = await query(
      `SELECT config_key, config_value FROM system_config
       WHERE config_key IN ('federation_registration_verify','federation_verify_timeout_ms')`
    );
    for (const row of r.rows) {
      if (row.config_key === 'federation_registration_verify') verify = String(row.config_value).trim().toLowerCase() || 'on';
      if (row.config_key === 'federation_verify_timeout_ms') {
        const n = parseInt(row.config_value, 10);
        if (Number.isFinite(n) && n >= 1000 && n <= 30000) timeoutMs = n;
      }
    }
  } catch {
    // 数据库不可用时使用默认值（不影响启动/请求处理）
  }
  _configCache = { at: now, verify, timeoutMs };
  return _configCache;
}

// ===== 私网/非法地址判定 =====

/** IPv4 字符串 → 32 位整数；非法返回 null */
function _ipv4ToInt(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const o = parseInt(m[i], 10);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

/** 是否落在 CIDR 网段内 */
function _inCidr(host, base, bits) {
  const ip = _ipv4ToInt(host);
  if (ip === null) return false;
  const baseInt = _ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

function _isPrivateIpv6(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1' || h === '::') return true;
  // fc00::/7 (ULA) 与 fe80::/10 (link-local)
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  return false;
}

/**
 * 判定 worldUrl 的 host 类别
 * @returns {{ type: 'invalid'|'private'|'public', host: string }}
 */
function classifyUrlHost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { type: 'invalid', host: '' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { type: 'invalid', host: parsed.hostname };
  }
  let host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return { type: 'invalid', host: '' };

  // 本机名 / localhost / mDNS
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { type: 'private', host };
  }
  if (host === os.hostname().toLowerCase()) {
    return { type: 'private', host };
  }

  // IPv4 私网网段（数值比较，杜绝 172.168.x.x 之类误判）
  if (_ipv4ToInt(host) !== null) {
    const privateRanges = [
      ['127.0.0.0', 8],   // 环回
      ['10.0.0.0', 8],    // A 类私网
      ['172.16.0.0', 12], // B 类私网（172.16.0.0 ~ 172.31.255.255）
      ['192.168.0.0', 16],// C 类私网
      ['169.254.0.0', 16],// 链路本地
      ['0.0.0.0', 8],     // 未指定地址
      ['100.64.0.0', 10]  // 运营商级 NAT（CGNAT，外部不可直达）
    ];
    for (const [base, bits] of privateRanges) {
      if (_inCidr(host, base, bits)) return { type: 'private', host };
    }
    return { type: 'public', host };
  }

  // IPv6
  if (host.includes(':')) {
    return { type: _isPrivateIpv6(host) ? 'private' : 'public', host };
  }

  // 其余视为公网域名
  return { type: 'public', host };
}

// ===== 回拨验证（带并发闸）=====

const MAX_CONCURRENT_VERIFIES = 3;
let _activeVerifies = 0;
const _verifyQueue = [];

/** 进入并发闸；闸满则排队，返回释放函数 */
function _acquireSlot() {
  return new Promise((resolve) => {
    const tryStart = () => {
      if (_activeVerifies < MAX_CONCURRENT_VERIFIES) {
        _activeVerifies++;
        resolve(() => {
          _activeVerifies--;
          const next = _verifyQueue.shift();
          if (next) next();
        });
      } else {
        _verifyQueue.push(tryStart);
      }
    };
    tryStart();
  });
}

/**
 * 回拨验证：访问 {worldUrl}/api/federation/info，校验 worldId 一致
 * 单次超时 timeoutMs，失败重试 1 次
 * @returns {{ ok: boolean, code: 'reachable'|'unreachable'|'worldid_mismatch' }}
 */
async function verifyReachability(worldUrl, expectedWorldId, timeoutMs) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const release = await _acquireSlot();
    try {
      const resp = await axios.get(`${worldUrl.replace(/\/+$/, '')}/api/federation/info`, {
        timeout: timeoutMs,
        validateStatus: (s) => s < 500,
        maxRedirects: 2
      });
      if (resp.status === 200 && resp.data && resp.data.success) {
        const remoteId = resp.data.world && resp.data.world.worldId;
        if (remoteId === expectedWorldId) {
          return { ok: true, code: 'reachable' };
        }
        return { ok: false, code: 'worldid_mismatch' };
      }
    } catch {
      // 超时/连接失败 → 重试一次
    } finally {
      release();
    }
  }
  return { ok: false, code: 'unreachable' };
}

// ===== 汇总入口 =====

/**
 * 注册资格检查（中心世界接收侧 / 子世界发送侧通用）
 * 判定顺序：格式 → 私网（零 I/O）→ 回拨（受开关+并发闸）
 * @param {object} worldConfig - { worldId, worldName, worldUrl, publicKey }
 * @returns {Promise<{allowed: boolean, code: string, message: string}>}
 */
async function checkRegistration(worldConfig) {
  if (!worldConfig || !worldConfig.worldUrl) {
    return { allowed: false, code: 'invalid_url', message: '缺少 worldUrl' };
  }
  const url = String(worldConfig.worldUrl).trim();
  const cls = classifyUrlHost(url);

  if (cls.type === 'invalid') {
    return { allowed: false, code: 'invalid_url', message: `worldUrl 格式非法: "${url}"` };
  }

  const allowPrivate = process.env.FEDERATION_ALLOW_PRIVATE === '1';
  if (cls.type === 'private' && !allowPrivate) {
    return {
      allowed: false,
      code: 'private_url',
      message: `世界地址 "${url}" 为内网/本机地址，其他用户无法访问，拒绝联邦注册。` +
               '请配置公网域名或端口映射后，在管理后台重新保存世界设置。'
    };
  }

  // 公网地址 → 回拨验证（受开关控制）
  const cfg = await _loadConfig();
  if (cfg.verify !== 'on') {
    return { allowed: true, code: 'verify_disabled', message: '' };
  }

  const result = await verifyReachability(url, worldConfig.worldId, cfg.timeoutMs);
  if (!result.ok) {
    const msg = result.code === 'worldid_mismatch'
      ? `回拨验证失败：${url} 返回的 worldId 与注册请求不符（防伪造）`
      : `回拨验证失败：中心世界无法访问你声明的地址 ${url}（超时 ${cfg.timeoutMs}ms×2），请确认防火墙/端口映射`;
    return { allowed: false, code: result.code, message: msg };
  }
  return { allowed: true, code: 'reachable', message: '' };
}

module.exports = {
  classifyUrlHost,
  verifyReachability,
  checkRegistration,
  // 仅供测试
  _resetConfigCache: () => { _configCache = { at: 0, verify: 'on', timeoutMs: 3000 }; }
};
