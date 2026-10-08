/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 路径重复斜杠折叠 —— 联邦心跳「双斜杠 404」修复（2026-10-03）
 * ------------------------------------------------------------------
 * 背景（《11-问题核验提示词》C1，逐条实测成立）：
 *   本世界对外广播的 worldUrl **自带尾斜杠**（https://miduo100.com/），
 *   而对端的心跳代码把它直接拼成 `${worldUrl}/api/federation/info`
 *   → 真实请求路径是 `//api/federation/info`（带双斜杠）。
 *   Express 的挂载前缀 `/api/federation` 匹配不上 `//api/federation/...`
 *   → 落到 src/server.js 末尾的兜底 404（`{"error":"Not found"}`，21 字节）。
 *   后果：对方（**以及本世界对自己**）永远判定本世界离线；每 30 秒一次、
 *   无退避，实测约 2880 次/天/来源，两个来源合计约 5760 条 404/天。
 *
 * 两个来源（实测）：
 *   ① 本世界信任表 trusted_worlds 里有一条**指向自身的记录**（URL 带尾斜杠）
 *      → 自己打自己（走公网域名 hairpin 回环，日志里显示为本机公网 IP 101.201.127.65）；
 *   ② B 世界（8.141.102.109）存的是我们广播出去的带斜杠 URL → 它 30 秒打我们一次。
 *
 * 为什么在这里修（而不是改对端、也不动黑名单大文件）：
 *   - 在本端把路径规范化，**两个来源的 404 同时消失，对端无需重新部署**；
 *   - 不需要碰 src/federationSystem.js（黑名单大文件，只读不改）；
 *   - 语义上等价于 nginx 的 `merge_slashes`，但该开关只作用于 location 匹配，
 *     代理转发时仍按原样把 URI 传给 Node（故 Node 侧仍收到双斜杠）。
 *
 * 实现要点（刻意保持最小行为面）：
 *   - **只折叠 path 部分**；query 里的 `//`（例如 ?next=https://x）绝不改动；
 *   - 只处理源格式路径（以 `/` 开头）；`*` 与代理风格绝对 URL（GET http://…）直接放行，
 *     避免误伤 `http://` 里的 `//`；
 *   - **不改 `req.originalUrl`** → 访问日志（services/logger.js 用 originalUrl）
 *     仍记录原始请求，保留原始证据便于日后排查；
 *   - 不做编码/大小写/点段（`..`）归一化，只去多余斜杠。
 *   - 挂载位置：所有路由与 express.static 之前（server.js 中 logger 之后）。
 *
 * 回退：注释掉 server.js 里那一行 app.use(require('./middleware/normalizeSlashes'))
 *      即完全恢复原行为（本文件可留着不删）。
 */

'use strict';

function normalizeSlashes(req, res, next) {
  const raw = req.url || '';
  const qIndex = raw.indexOf('?');
  const rawPath = qIndex === -1 ? raw : raw.slice(0, qIndex);

  // 快速放行：不是源格式路径，或路径里根本没有连续斜杠
  if (rawPath.charAt(0) !== '/' || rawPath.indexOf('//') === -1) {
    return next();
  }

  const collapsed = rawPath.replace(/\/{2,}/g, '/');
  if (collapsed !== rawPath) {
    req.url = collapsed + (qIndex === -1 ? '' : raw.slice(qIndex));
  }
  return next();
}

module.exports = normalizeSlashes;
module.exports.normalizeSlashes = normalizeSlashes;
