/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const jwt = require('jsonwebtoken');
const { query } = require('../database/db');

// 管理员JWT密钥（与用户系统分离）
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
if (!ADMIN_JWT_SECRET) {
  console.error('[FATAL] 缺少环境变量 ADMIN_JWT_SECRET，服务器无法启动');
  process.exit(1);
}

// 生成管理员JWT Token
function generateAdminToken(adminUser) {
  return jwt.sign(
    {
      adminUserId: adminUser.id,
      username: adminUser.username,
      type: 'admin' // 标识为管理员token
    },
    ADMIN_JWT_SECRET,
    { expiresIn: '24h' }
  );
}

// 管理员Token验证中间件
function authenticateAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '未授权：缺少管理员token' });
  }

  jwt.verify(token, ADMIN_JWT_SECRET, async (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: '管理员token已过期，请重新登录' });
      }
      return res.status(403).json({ error: '无效的管理员token' });
    }

    // 验证token类型
    if (decoded.type !== 'admin') {
      return res.status(403).json({ error: '无效的token类型' });
    }

    try {
      // 验证管理员是否存在且激活
      const result = await query(
        'SELECT id, username, email, full_name, is_active FROM admin_users WHERE id = $1',
        [decoded.adminUserId]
      );

      if (!result.rows.length || !result.rows[0].is_active) {
        return res.status(403).json({ error: '管理员账号不存在或已被禁用' });
      }

      // 将管理员信息附加到请求对象
      req.adminUser = result.rows[0];
      next();
    } catch (error) {
      console.error('管理员验证失败:', error);
      res.status(500).json({ error: '验证失败' });
    }
  });
}

// 记录管理员操作日志
async function logAdminAction(adminUserId, action, resource, resourceId, details, ipAddress) {
  try {
    await query(
      `INSERT INTO admin_action_logs (admin_user_id, action, resource, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminUserId, action, resource, resourceId, details, ipAddress]
    );
  } catch (error) {
    console.error('记录管理员操作日志失败:', error);
  }
}

module.exports = {
  generateAdminToken,
  authenticateAdminToken,
  logAdminAction,
  ADMIN_JWT_SECRET
};
