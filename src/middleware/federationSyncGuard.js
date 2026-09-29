/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 联邦用户同步守卫（安全修复 D5② / 审计 S2-02）
 * ------------------------------------------------------------------
 * 背景（《二次安全审计报告-2026-09-28》S2-02）：
 *   `POST /api/federation/sync-user` 只做 IP 限速，**不验签**，而 handler 会执行
 *   `UPDATE users SET username=$1, email=$2, role=$3 WHERE id=$4`（userId 来自请求体）——
 *   攻击者只需从**匿名可读**的 `GET /api/federation/worlds` 取一个真实受信 worldId，
 *   就能把**任意用户**改成 `role='admin'`（提权）或改成自己的邮箱（配合找回密码劫持账号）。
 *
 * 本守卫（挂载层，`src/routes/federation.js` 1184 行零改动）做四道拦截：
 *   ① 缺少 `sourceWorldId` → 400；
 *   ② 请求体出现 `userData.user.role`（外部世界永远不允许指定角色权限）→ 400；
 *   ③ 来源世界不在本世界信任表 → 403；
 *   ④ 目标用户**已存在且不是联邦创建账号**（`password_hash !== 'FEDERATED_USER'`）→ 403：
 *      真实的本地账号绝不能被一次「无签名」的跨世界调用改写（这一步直接堵掉
 *      「改 email → 找回密码 → 账号劫持」这个最实用的利用链）。
 *
 * 放行的一次同步会打一条 info 日志（worldId / userId），拒绝会打 warn。
 *
 * 回退：`SECURITY_GUARD_OFF=1` 全放行；或摘掉 server.js 挂载行里的本中间件。
 *
 * 说明：完整的根治方案是让 `/sync-user` 携带**源世界私钥签名 + nonce 一次性消费**
 *      （对齐 `src/agent/agentTeleportService.js` 的 RS256 口径），属二期；本守卫是
 *      在不触碰大文件、不引入签名协商的前提下的一期止损。
 */
const { query } = require('../database/db');

// ⚠️ 必须是**绝对路径**：本中间件挂在 `app.use('/api/federation', ...)`，
// 此时 req.baseUrl='/api/federation'、req.path='/sync-user'（Express 会 strip 挂载前缀）。
const SYNC_PATH = '/api/federation/sync-user';

function isGuardOff() {
  const raw = String(process.env.SECURITY_GUARD_OFF || '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

/** 取联邦系统单例（模块加载时可能还是 null，必须每次调用时取当前值） */
function getFederationSystem() {
  try {
    return require('../routes/federation').getFederationSystem();
  } catch (e) {
    return null;
  }
}

/** 来源世界是否受信任：优先内存态（权威），回落数据库 */
async function isTrustedWorld(sourceWorldId) {
  const system = getFederationSystem();
  if (system && system.trustedWorlds && typeof system.trustedWorlds.has === 'function') {
    return system.trustedWorlds.has(sourceWorldId);
  }
  const result = await query(
    'SELECT 1 FROM trusted_worlds WHERE world_id = $1 AND enabled = true',
    [sourceWorldId]
  );
  return result.rows.length > 0;
}

function hasRoleAssignment(userData) {
  if (!userData || typeof userData !== 'object') return false;
  if (userData.role !== undefined) return true;
  const user = userData.user;
  return !!(user && typeof user === 'object' && user.role !== undefined);
}

async function federationSyncGuard(req, res, next) {
  const absPath = (req.baseUrl || '') + (req.path || '');
  if (absPath !== SYNC_PATH || req.method !== 'POST') return next();
  if (isGuardOff()) return next();

  const body = req.body || {};
  const { userId, sourceWorldId, userData } = body;

  // ① 参数完整性
  if (!userId || !sourceWorldId) {
    console.warn(`[federationSyncGuard] 400 缺少 userId/sourceWorldId`);
    return res.status(400).json({ success: false, error: '缺少必要的用户信息参数' });
  }

  // ② 外部世界永远不允许指定角色权限（提权面）
  if (hasRoleAssignment(userData)) {
    console.warn(`[federationSyncGuard] 400 拒绝 role 赋值 sourceWorldId=${sourceWorldId} userId=${userId}`);
    return res.status(400).json({
      success: false,
      error: '联邦同步不允许指定用户角色权限',
      code: 'FEDERATION_ROLE_FORBIDDEN',
    });
  }

  try {
    // ③ 来源世界必须在信任表内
    if (!(await isTrustedWorld(sourceWorldId))) {
      console.warn(`[federationSyncGuard] 403 未信任来源世界 sourceWorldId=${sourceWorldId}`);
      return res.status(403).json({
        success: false,
        error: '未信任的源世界',
        code: 'FEDERATION_SOURCE_UNTRUSTED',
      });
    }

    // ④ 已存在的真实账号不可被无签名的联邦调用改写
    const existing = await query('SELECT id, password_hash FROM users WHERE id = $1', [userId]);
    if (existing.rows.length > 0 && existing.rows[0].password_hash !== 'FEDERATED_USER') {
      console.warn(`[federationSyncGuard] 403 拒绝改写本地账号 userId=${userId} sourceWorldId=${sourceWorldId}`);
      return res.status(403).json({
        success: false,
        error: '本地账号不允许通过联邦同步修改',
        code: 'FEDERATION_LOCAL_ACCOUNT_PROTECTED',
      });
    }

    console.log(`[federationSyncGuard] 放行同步 userId=${userId} sourceWorldId=${sourceWorldId}`);
  } catch (e) {
    // 守卫自身异常不阻断联邦链路（保持与 handler 原有容错风格一致），但必须留痕
    console.error('[federationSyncGuard] 校验异常，按原逻辑放行:', e.message);
  }

  return next();
}

module.exports = { federationSyncGuard, isTrustedWorld, hasRoleAssignment };
