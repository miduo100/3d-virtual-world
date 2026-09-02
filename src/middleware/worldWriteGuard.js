/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 世界内容写操作守卫 —— 仅管理员可写
 *
 * 通道①：普通用户 token（JWT_SECRET 签发），users.role === 'admin'
 *         （由 管理后台 → 用户管理 → 切换角色 设置，见 src/routes/admin.js PUT /users/:userId/role）
 * 通道②：后台账号 adminToken（ADMIN_JWT_SECRET 签发），admin_users 存在且 is_active
 *         （编辑器 world_editor.html / unified_editor.html 与 admin.html 同源，会话里只有 adminToken）
 *
 * 读请求（GET / HEAD / OPTIONS）一律放行：
 *   - 玩家进入世界需要匿名读取 /objects、/state、/spawn-point、/transform-overrides
 *   - 联邦跨域读取不受影响（联邦通信走 /api/federation/*，本就不经过这里）
 */
const jwt = require('jsonwebtoken');
const { query } = require('../database/db');
const { ADMIN_JWT_SECRET } = require('./adminAuth');

function verifyAsync(token, secret) {
  return new Promise((resolve) => {
    if (!token) return resolve(null);
    jwt.verify(token, secret, (err, decoded) => resolve(err ? null : decoded));
  });
}

async function worldWriteGuard(req, res, next) {
  // 读请求放行
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: '未授权：缺少token' });
  }

  // 通道①：被设为管理员的用户
  const user = await verifyAsync(token, process.env.JWT_SECRET);
  if (user && user.userId) {
    try {
      const r = await query('SELECT role FROM users WHERE id = $1', [user.userId]);
      if (r.rows.length && r.rows[0].role === 'admin') {
        req.actor = { kind: 'user', id: String(user.userId) };
        return next();
      }
    } catch (e) {
      console.error('[worldWriteGuard] 用户校验失败:', e.message);
    }
  }

  // 通道②：后台账号
  const admin = await verifyAsync(token, ADMIN_JWT_SECRET);
  if (admin && admin.type === 'admin') {
    try {
      const r = await query('SELECT id, is_active FROM admin_users WHERE id = $1', [admin.adminUserId]);
      if (r.rows.length && r.rows[0].is_active) {
        req.actor = { kind: 'admin', id: String(r.rows[0].id) };
        return next();
      }
    } catch (e) {
      console.error('[worldWriteGuard] 管理员校验失败:', e.message);
    }
  }

  return res.status(403).json({ success: false, error: '需要管理员权限' });
}

module.exports = { worldWriteGuard };
