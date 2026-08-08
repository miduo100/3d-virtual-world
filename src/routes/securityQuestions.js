/**
 * 济宁米多信息科技有限公司 版权所有
 * 安全问题管理后台 CRUD 接口
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');

// 中间件：管理员认证
router.use(authenticateAdminToken);

// GET - 获取所有安全问题（含使用人数统计）
router.get('/security-questions', async (req, res) => {
  try {
    const result = await query(`
      SELECT sq.*, COUNT(u.id)::INT AS usage_count
      FROM security_questions sq
      LEFT JOIN users u ON u.security_question_id = sq.id
      GROUP BY sq.id
      ORDER BY sq.sort_order, sq.id
    `);
    res.json({ questions: result.rows });
  } catch (error) {
    console.error('[SecurityQuestions] 获取列表失败:', error);
    res.status(500).json({ error: '获取安全问题列表失败' });
  }
});

// POST - 添加新安全问题
router.post('/security-questions', async (req, res) => {
  try {
    const { question_text, sort_order } = req.body;

    if (!question_text || !question_text.trim()) {
      return res.status(400).json({ error: '问题文本不能为空' });
    }

    const trimmed = question_text.trim();
    if (trimmed.length > 200) {
      return res.status(400).json({ error: '问题文本不能超过200个字符' });
    }

    // 查重
    const existing = await query('SELECT id FROM security_questions WHERE question_text = $1', [trimmed]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: '该安全问题已存在' });
    }

    const result = await query(
      'INSERT INTO security_questions (question_text, sort_order) VALUES ($1, $2) RETURNING *',
      [trimmed, sort_order || 0]
    );

    res.json({ success: true, question: result.rows[0] });
  } catch (error) {
    console.error('[SecurityQuestions] 添加失败:', error);
    res.status(500).json({ error: '添加安全问题失败' });
  }
});

// PUT - 编辑安全问题文本
router.put('/security-questions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { question_text, sort_order, is_active } = req.body;

    const existing = await query('SELECT * FROM security_questions WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: '安全问题不存在' });
    }

    // 构建更新字段
    const updates = [];
    const values = [id];
    let idx = 2;

    if (question_text !== undefined) {
      const trimmed = question_text.trim();
      if (!trimmed) return res.status(400).json({ error: '问题文本不能为空' });
      if (trimmed.length > 200) return res.status(400).json({ error: '问题文本不能超过200个字符' });
      updates.push(`question_text = $${idx++}`);
      values.push(trimmed);
    }
    if (sort_order !== undefined) {
      updates.push(`sort_order = $${idx++}`);
      values.push(sort_order);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const result = await query(
      `UPDATE security_questions SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );

    res.json({ success: true, question: result.rows[0] });
  } catch (error) {
    console.error('[SecurityQuestions] 编辑失败:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: '该安全问题文本已存在' });
    }
    res.status(500).json({ error: '编辑安全问题失败' });
  }
});

// DELETE - 删除安全问题（有用户使用的禁止删除）
router.delete('/security-questions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 检查是否有人使用
    const usage = await query(
      'SELECT COUNT(*)::INT AS cnt FROM users WHERE security_question_id = $1',
      [id]
    );

    if (usage.rows[0].cnt > 0) {
      return res.status(400).json({
        error: `该安全问题有 ${usage.rows[0].cnt} 个用户正在使用，无法删除。请先引导用户更换安全问题后再试。`
      });
    }

    await query('DELETE FROM security_questions WHERE id = $1', [id]);
    res.json({ success: true, message: '安全问题已删除' });
  } catch (error) {
    console.error('[SecurityQuestions] 删除失败:', error);
    res.status(500).json({ error: '删除安全问题失败' });
  }
});

module.exports = router;
