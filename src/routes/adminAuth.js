/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');
const { generateAdminToken, authenticateAdminToken, logAdminAction } = require('../middleware/adminAuth');
const { loginRateLimiter, onLoginSuccess, onLoginFailure, getLockedAccounts, manualUnlock } = require('../middleware/loginRateLimiter');

// 管理员登录（应用速率限制中间件）
router.post('/login', loginRateLimiter('admin'), async (req, res) => {
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

  try {
    const { username, password } = req.body;

    // 验证输入
    if (!username || !password) {
      await onLoginFailure(username || 'empty', clientIp, 'admin', 'empty_credentials');
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    // 查询管理员
    const result = await query(
      'SELECT * FROM admin_users WHERE username = $1',
      [username]
    );

    if (!result.rows.length) {
      await onLoginFailure(username, clientIp, 'admin', 'username_not_found');
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const adminUser = result.rows[0];

    // 检查账号是否激活
    if (!adminUser.is_active) {
      await onLoginFailure(username, clientIp, 'admin', 'account_disabled');
      return res.status(403).json({ error: '账号已被禁用' });
    }

    // 验证密码
    const passwordMatch = await bcrypt.compare(password, adminUser.password_hash);
    if (!passwordMatch) {
      await onLoginFailure(username, clientIp, 'admin', 'wrong_password');
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 登录成功
    await onLoginSuccess(username, clientIp, 'admin');

    // 更新最后登录时间和IP
    const ipAddress = req.ip || req.connection.remoteAddress;
    await query(
      'UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = $1 WHERE id = $2',
      [ipAddress, adminUser.id]
    );

    // 记录登录日志
    await logAdminAction(adminUser.id, 'LOGIN', 'admin_users', adminUser.id, '管理员登录', ipAddress);

    // 生成JWT Token
    const token = generateAdminToken(adminUser);

    res.json({
      success: true,
      token,
      adminUser: {
        id: adminUser.id,
        username: adminUser.username,
        email: adminUser.email,
        full_name: adminUser.full_name
      }
    });
  } catch (error) {
    console.error('管理员登录失败:', error);
    res.status(500).json({ error: '登录失败' });
  }
});

// 验证Token（用于前端检查登录状态）
router.get('/verify', authenticateAdminToken, (req, res) => {
  res.json({
    success: true,
    adminUser: req.adminUser
  });
});

// 修改密码
router.post('/change-password', authenticateAdminToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const adminUserId = req.adminUser.id;

    // 验证输入
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: '当前密码和新密码不能为空' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: '新密码长度不能少于8位' });
    }

    // 获取当前密码哈希
    const result = await query(
      'SELECT password_hash FROM admin_users WHERE id = $1',
      [adminUserId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: '管理员不存在' });
    }

    // 验证当前密码
    const passwordMatch = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: '当前密码错误' });
    }

    // 生成新密码哈希
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // 更新密码
    await query(
      'UPDATE admin_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, adminUserId]
    );

    // 记录操作日志
    const ipAddress = req.ip || req.connection.remoteAddress;
    await logAdminAction(adminUserId, 'CHANGE_PASSWORD', 'admin_users', adminUserId, '修改密码', ipAddress);

    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('修改密码失败:', error);
    res.status(500).json({ error: '修改密码失败' });
  }
});

// 获取管理员信息
router.get('/profile', authenticateAdminToken, (req, res) => {
  res.json({
    success: true,
    adminUser: req.adminUser
  });
});

// 更新管理员信息
router.put('/profile', authenticateAdminToken, async (req, res) => {
  try {
    const { email, full_name } = req.body;
    const adminUserId = req.adminUser.id;

    await query(
      'UPDATE admin_users SET email = $1, full_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [email, full_name, adminUserId]
    );

    // 记录操作日志
    const ipAddress = req.ip || req.connection.remoteAddress;
    await logAdminAction(adminUserId, 'UPDATE_PROFILE', 'admin_users', adminUserId, '更新个人信息', ipAddress);

    res.json({
      success: true,
      message: '信息更新成功'
    });
  } catch (error) {
    console.error('更新信息失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 获取操作日志（仅供管理员查看）
router.get('/action-logs', authenticateAdminToken, async (req, res) => {
  try {
    const { limit = 100 } = req.query;

    const result = await query(
      `SELECT 
        al.*,
        au.username,
        au.full_name
       FROM admin_action_logs al
       LEFT JOIN admin_users au ON al.admin_user_id = au.id
       ORDER BY al.created_at DESC
       LIMIT $1`,
      [parseInt(limit)]
    );

    res.json({
      success: true,
      logs: result.rows
    });
  } catch (error) {
    console.error('获取操作日志失败:', error);
    res.status(500).json({ error: '获取日志失败' });
  }
});

// ============ 登录安全监控 API ============

// 查看当前锁定的账号列表
router.get('/locked-accounts', authenticateAdminToken, async (req, res) => {
  try {
    const accounts = await getLockedAccounts();
    res.json({ success: true, accounts });
  } catch (error) {
    console.error('[RateLimiter] 获取锁定列表失败:', error);
    res.status(500).json({ error: '获取锁定列表失败' });
  }
});

// 手动解锁账号
router.post('/unlock-account', authenticateAdminToken, async (req, res) => {
  try {
    const { username, targetType } = req.body;

    if (!username) {
      return res.status(400).json({ error: '用户名不能为空' });
    }

    const unlockedBy = req.adminUser?.username || 'unknown';
    const success = await manualUnlock(username, targetType || 'user', unlockedBy);

    if (success) {
      await logAdminAction(req.adminUser.id, 'UNLOCK_ACCOUNT', 'account_lockouts', null,
        `解锁账号: ${username} (${targetType || 'user'})`, req.ip);
      res.json({ success: true, message: `账号 ${username} 已解锁` });
    } else {
      res.json({ success: false, message: '未找到该账号的锁定记录' });
    }
  } catch (error) {
    console.error('[RateLimiter] 解锁失败:', error);
    res.status(500).json({ error: '解锁失败' });
  }
});

// 获取登录尝试统计（最近24小时）
router.get('/login-stats/:username', authenticateAdminToken, async (req, res) => {
  try {
    const { username } = req.params;
    const stats = await getLoginStats(username);
    res.json({ success: true, stats });
  } catch (error) {
    console.error('[RateLimiter] 获取统计失败:', error);
    res.status(500).json({ error: '获取统计失败' });
  }
});

module.exports = router;
