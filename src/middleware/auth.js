/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const jwt = require('jsonwebtoken');
const { query } = require('../database/db');

// JWT token验证中间件
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '未授权：缺少token' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: '无效的token' });
    }
    req.user = user;

    // 滑动续期：剩余有效期不足 1 天时签发新 token（7 天），
    // 前端 api.js 读取 X-Renewed-Token 响应头更新 localStorage，
    // 保证活跃用户永不掉登录
    const RENEW_THRESHOLD_MS = 24 * 60 * 60 * 1000;
    const remaining = user.exp ? user.exp * 1000 - Date.now() : Infinity;
    if (remaining < RENEW_THRESHOLD_MS) {
      try {
        const payload = { userId: user.userId, username: user.username };
        const newToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.setHeader('X-Renewed-Token', newToken);
      } catch (e) {
        // 续签失败不影响本次请求
      }
    }

    next();
  });
}

// 管理员权限验证中间件
async function isAdmin(req, res, next) {
  try {
    const userId = req.user.userId;
    const result = await query('SELECT role FROM users WHERE id = $1', [userId]);

    if (!result.rows.length || result.rows[0].role !== 'admin') {
      return res.status(403).json({ error: '需要管理员权限' });
    }

    next();
  } catch (error) {
    console.error('权限验证失败:', error);
    res.status(500).json({ error: '权限验证失败' });
  }
}

module.exports = {
  authenticateToken,
  isAdmin
};

