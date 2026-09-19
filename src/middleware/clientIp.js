/**
 * 客户端真实 IP 解析（联测修复 D）
 *
 * 背景：P8 的防滥用四件套里两条是按 IP 计数的——「每 IP 签票 10 次/小时」与
 * 「游客每 IP 并发 1 连接」。而原来的取 IP 方式是 `req.ip`（HTTP）与
 * `request.socket.remoteAddress`（WS upgrade）。上线后经 Nginx 反代时，
 * 两者拿到的都是 **Nginx 自己的地址（127.0.0.1）**，后果是：
 *   - 全世界游客共享 10 张票/小时的窗口（第 11 个访客就被 429）
 *   - 全世界同时只允许 1 个游客在线（第二个被 GUEST_IP_CONCURRENCY 拒绝）
 * 本地实测：把 HOST 从 localhost(::1) 换成 127.0.0.1 就能立刻拿到新票，
 * 证明窗口完全按"直连对端地址"分裂。
 *
 * 口径（单层反代，即部署文档里的 Nginx 配置）：
 *   1) 优先 `X-Real-IP`——Nginx `proxy_set_header X-Real-IP $remote_addr` 是**覆写**，
 *      客户端自己送的同名头会被顶掉，最可靠；
 *   2) 其次取 `X-Forwarded-For` 的**最后一段**——部署文档用的是
 *      `proxy_add_x_forwarded_for`（= 客户端原值 + 本机 $remote_addr 追加在后），
 *      所以最后一段才是我们自己的代理看到的真实对端；客户端伪造的值只会落在前面；
 *   3) 都没有则回落 socket 地址（直连/本地开发）。
 *
 * 开关：默认启用。若把服务直接暴露到公网（不走反代），请设 `TRUST_PROXY=false`，
 * 否则客户端可以伪造 X-Real-IP / X-Forwarded-For 绕开限流。
 */

function isTrustProxyEnabled() {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined) return true;              // 默认按"有反代"处理（部署文档方案）
  return !['false', '0', 'off', 'no'].includes(String(raw).trim().toLowerCase());
}

/** Express 侧一次性配置（在 const app = express() 之后立即调用） */
function applyTrustProxy(app) {
  if (!isTrustProxyEnabled()) return false;
  const raw = process.env.TRUST_PROXY;
  const hops = Number(raw);
  app.set('trust proxy', Number.isFinite(hops) && hops > 0 ? hops : 1);
  return true;
}

/** 取 X-Forwarded-For 最后一段（单层反代口径，见文件头注释） */
function lastForwardedFor(headers) {
  const raw = (headers && headers['x-forwarded-for']) || '';
  const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * 通用解析（HTTP req 与 WS upgrade request 通用）
 * @param req express 请求对象 / ws upgrade 的 http.IncomingMessage
 */
function resolveClientIp(req) {
  if (!req) return 'unknown';
  const headers = req.headers || {};
  if (isTrustProxyEnabled()) {
    const real = String(headers['x-real-ip'] || '').trim();
    if (real) return real;
    const xff = lastForwardedFor(headers);
    if (xff) return xff;
  }
  // 直连（或未启用信任代理）：socket 地址
  const sock = req.socket || req.connection;
  return (sock && sock.remoteAddress) || 'unknown';
}

module.exports = { isTrustProxyEnabled, applyTrustProxy, resolveClientIp, lastForwardedFor };
