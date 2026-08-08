/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');
const { loginRateLimiter, registerRateLimiter, onLoginSuccess, onLoginFailure, onRegisterSuccess } = require('../middleware/loginRateLimiter');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] 缺少环境变量 JWT_SECRET，服务器无法启动');
  process.exit(1);
}

// ==================== 公开接口：获取启用状态的安全问题列表 ====================
router.get('/security-questions', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, question_text, sort_order FROM security_questions WHERE is_active = TRUE ORDER BY sort_order, id'
    );
    res.json({ questions: result.rows });
  } catch (error) {
    console.error('[Auth] 获取安全问题列表失败:', error);
    // 如果表不存在则返回默认列表
    res.json({
      questions: [
        { id: 0, question_text: '你的出生日期', sort_order: 1 },
        { id: 0, question_text: '你的手机号', sort_order: 2 },
        { id: 0, question_text: '你的身份证号', sort_order: 3 },
        { id: 0, question_text: '你前女友的名字', sort_order: 4 },
      ]
    });
  }
});

// ==================== 注册（扩展安全问题字段） ====================
router.post('/register', registerRateLimiter(), async (req, res) => {
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

  try {
    const { username, email, password, securityQuestionId, securityAnswer } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!securityQuestionId || !securityAnswer) {
      return res.status(400).json({ error: '请选择安全问题并填写答案' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedAnswer = await bcrypt.hash(securityAnswer, 10);
    const userId = uuidv4();

    await query(
      'INSERT INTO users (id, username, email, password_hash, security_question_id, security_answer) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, username, email, hashedPassword, securityQuestionId, hashedAnswer]
    );

    // Create default character
    const characterId = uuidv4();
    await query(
      'INSERT INTO characters (id, user_id, name) VALUES ($1, $2, $3)',
      [characterId, userId, `${username}`]
    );

    // Create character appearance
    await query(
      'INSERT INTO character_appearance (character_id) VALUES ($1)',
      [characterId]
    );

    // 注册成功记录日志
    await onRegisterSuccess(clientIp, email, username);

    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'User registered successfully',
      token,
      userId,
      characterId,
    });
  } catch (error) {
    console.error(error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ==================== 登录 ====================
router.post('/login', loginRateLimiter('user'), async (req, res) => {
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      await onLoginFailure(username || 'empty', clientIp, 'user', 'empty_credentials');
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const result = await query('SELECT * FROM users WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      await onLoginFailure(username, clientIp, 'user', 'username_not_found');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      await onLoginFailure(username, clientIp, 'user', 'wrong_password');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 登录成功
    await onLoginSuccess(username, clientIp, 'user');

    let charResult = await query(
      'SELECT id FROM characters WHERE user_id = $1 LIMIT 1',
      [user.id]
    );

    // 若因数据不一致没有角色，自动补建一个
    if (charResult.rows.length === 0) {
      const characterId = uuidv4();
      await query(
        'INSERT INTO characters (id, user_id, name) VALUES ($1, $2, $3)',
        [characterId, user.id, `${user.username}`]
      );
      await query(
        'INSERT INTO character_appearance (character_id) VALUES ($1)',
        [characterId]
      );
      charResult = { rows: [{ id: characterId }] };
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      userId: user.id,
      characterId: charResult.rows[0].id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ==================== 获取当前用户信息 ====================
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const result = await query(
      'SELECT id, username, email, role, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ==================== 找回密码步骤1：查询安全问题 ====================
router.post('/forgot-step1', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: '请输入账号' });
    }

    const result = await query(
      `SELECT u.id, u.username, sq.question_text
       FROM users u
       LEFT JOIN security_questions sq ON u.security_question_id = sq.id
       WHERE u.username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      // 不暴露用户是否存在
      return res.status(404).json({ error: '该账号不存在或未设置安全问题' });
    }

    const user = result.rows[0];
    if (!user.question_text) {
      return res.status(400).json({ error: '该账号未设置安全问题，无法找回密码' });
    }

    res.json({
      questionText: user.question_text
    });
  } catch (error) {
    console.error('[ForgotStep1]', error);
    res.status(500).json({ error: '查询失败，请稍后重试' });
  }
});

// ==================== 找回密码步骤2：验证答案 ====================
router.post('/forgot-step2', async (req, res) => {
  try {
    const { username, answer } = req.body;

    if (!username || !answer) {
      return res.status(400).json({ error: '请输入账号和答案' });
    }

    const result = await query(
      'SELECT id, security_answer FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0 || !result.rows[0].security_answer) {
      return res.status(404).json({ error: '该账号未设置安全问题' });
    }

    const user = result.rows[0];
    const answerMatch = await bcrypt.compare(answer, user.security_answer);

    if (!answerMatch) {
      return res.status(401).json({ error: '安全问题答案不正确' });
    }

    // 生成一次性 resetToken（5分钟有效）
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt]
    );

    res.json({
      resetToken: rawToken,
      expiresIn: 300
    });
  } catch (error) {
    console.error('[ForgotStep2]', error);
    res.status(500).json({ error: '验证失败，请稍后重试' });
  }
});

// ==================== 找回密码步骤3：重置密码 ====================
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '密码至少需要6个字符' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 查找有效令牌
    const tokenResult = await query(
      `SELECT prt.id, prt.user_id, prt.expires_at, prt.used
       FROM password_reset_tokens prt
       WHERE prt.token_hash = $1 AND prt.used = FALSE AND prt.expires_at > CURRENT_TIMESTAMP`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: '重置令牌无效或已过期，请重新开始找回流程' });
    }

    const resetRecord = tokenResult.rows[0];

    // 更新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, resetRecord.user_id]);

    // 标记令牌已使用
    await query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [resetRecord.id]);

    res.json({ success: true, message: '密码重置成功，请使用新密码登录' });
  } catch (error) {
    console.error('[ResetPassword]', error);
    res.status(500).json({ error: '密码重置失败，请稍后重试' });
  }
});

module.exports = router;
