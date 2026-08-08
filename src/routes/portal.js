/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken: auth } = require('../middleware/auth');

// 获取所有传送门
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, u.username as creator_name 
       FROM portals p 
       LEFT JOIN users u ON p.created_by = u.id 
       WHERE p.is_active = true 
       ORDER BY p.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('获取传送门列表失败:', error);
    res.status(500).json({ error: '获取传送门列表失败' });
  }
});

// 根据ID获取单个传送门
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT p.*, u.username as creator_name 
       FROM portals p 
       LEFT JOIN users u ON p.created_by = u.id 
       WHERE p.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '传送门不存在' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('获取传送门详情失败:', error);
    res.status(500).json({ error: '获取传送门详情失败' });
  }
});

// 创建新传送门（需要认证）
router.post('/create', auth, async (req, res) => {
  try {
    const {
      name,
      description,
      source_position,
      target_position,
      target_world_url,
      portal_type = 'local',
      is_bidirectional = true,
      cooldown_seconds = 0,
      required_level = 1
    } = req.body;

    // 验证必填字段
    if (!name || !source_position || !target_position) {
      return res.status(400).json({ error: '缺少必填字段：name, source_position, target_position' });
    }

    // 插入新传送门
    const result = await db.query(
      `INSERT INTO portals 
       (name, description, source_position, target_position, target_world_url, 
        portal_type, is_bidirectional, cooldown_seconds, required_level, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING *`,
      [
        name,
        description,
        JSON.stringify(source_position),
        JSON.stringify(target_position),
        target_world_url,
        portal_type,
        is_bidirectional,
        cooldown_seconds,
        required_level,
        req.userId
      ]
    );

    // 如果是双向传送门，自动创建返回传送门
    if (is_bidirectional && portal_type === 'local') {
      await db.query(
        `INSERT INTO portals 
         (name, description, source_position, target_position, target_world_url, 
          portal_type, is_bidirectional, cooldown_seconds, required_level, created_by) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          `${name} (返回)`,
          description,
          JSON.stringify(target_position),
          JSON.stringify(source_position),
          target_world_url,
          portal_type,
          is_bidirectional,
          cooldown_seconds,
          required_level,
          req.userId
        ]
      );
    }

    res.json({
      message: '传送门创建成功',
      portal: result.rows[0]
    });
  } catch (error) {
    console.error('创建传送门失败:', error);
    res.status(500).json({ error: '创建传送门失败' });
  }
});

// 使用传送门（记录使用日志并检查权限）
router.post('/use', auth, async (req, res) => {
  try {
    const { portal_id, character_id } = req.body;

    if (!portal_id || !character_id) {
      return res.status(400).json({ error: '缺少必填字段：portal_id, character_id' });
    }

    // 获取传送门信息
    const portalResult = await db.query(
      'SELECT * FROM portals WHERE id = $1 AND is_active = true',
      [portal_id]
    );

    if (portalResult.rows.length === 0) {
      return res.status(404).json({ error: '传送门不存在或已禁用' });
    }

    const portal = portalResult.rows[0];

    // 获取角色信息
    const characterResult = await db.query(
      'SELECT level FROM characters WHERE id = $1',
      [character_id]
    );

    if (characterResult.rows.length === 0) {
      return res.status(404).json({ error: '角色不存在' });
    }

    const character = characterResult.rows[0];

    // 检查等级要求
    if (character.level < portal.required_level) {
      return res.status(403).json({ 
        error: `等级不足，需要等级 ${portal.required_level}` 
      });
    }

    // 检查冷却时间
    if (portal.cooldown_seconds > 0) {
      const lastUseResult = await db.query(
        `SELECT used_at FROM portal_logs 
         WHERE portal_id = $1 AND character_id = $2 
         ORDER BY used_at DESC LIMIT 1`,
        [portal_id, character_id]
      );

      if (lastUseResult.rows.length > 0) {
        const lastUseTime = new Date(lastUseResult.rows[0].used_at);
        const now = new Date();
        const cooldownMs = portal.cooldown_seconds * 1000;
        const timeSinceLastUse = now - lastUseTime;

        if (timeSinceLastUse < cooldownMs) {
          const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastUse) / 1000);
          return res.status(429).json({ 
            error: `传送门冷却中，请等待 ${remainingSeconds} 秒` 
          });
        }
      }
    }

    // 记录使用日志
    await db.query(
      'INSERT INTO portal_logs (portal_id, character_id) VALUES ($1, $2)',
      [portal_id, character_id]
    );

    // 返回目标位置和传送门信息
    res.json({
      message: '传送成功',
      target_position: portal.target_position,
      target_world_url: portal.target_world_url,
      portal_type: portal.portal_type
    });
  } catch (error) {
    console.error('使用传送门失败:', error);
    res.status(500).json({ error: '使用传送门失败' });
  }
});

// 更新传送门信息（需要认证，且仅创建者可更新）
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      source_position,
      target_position,
      target_world_url,
      is_active,
      cooldown_seconds,
      required_level
    } = req.body;

    // 检查传送门是否存在且用户是创建者
    const checkResult = await db.query(
      'SELECT created_by FROM portals WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: '传送门不存在' });
    }

    if (checkResult.rows[0].created_by !== req.userId) {
      return res.status(403).json({ error: '只有创建者可以修改传送门' });
    }

    // 构建更新字段
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (source_position !== undefined) {
      updates.push(`source_position = $${paramCount++}`);
      values.push(JSON.stringify(source_position));
    }
    if (target_position !== undefined) {
      updates.push(`target_position = $${paramCount++}`);
      values.push(JSON.stringify(target_position));
    }
    if (target_world_url !== undefined) {
      updates.push(`target_world_url = $${paramCount++}`);
      values.push(target_world_url);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }
    if (cooldown_seconds !== undefined) {
      updates.push(`cooldown_seconds = $${paramCount++}`);
      values.push(cooldown_seconds);
    }
    if (required_level !== undefined) {
      updates.push(`required_level = $${paramCount++}`);
      values.push(required_level);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `UPDATE portals SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    const result = await db.query(query, values);

    res.json({
      message: '传送门更新成功',
      portal: result.rows[0]
    });
  } catch (error) {
    console.error('更新传送门失败:', error);
    res.status(500).json({ error: '更新传送门失败' });
  }
});

// 删除传送门（需要认证，且仅创建者可删除）
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // 检查传送门是否存在且用户是创建者
    const checkResult = await db.query(
      'SELECT created_by FROM portals WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: '传送门不存在' });
    }

    if (checkResult.rows[0].created_by !== req.userId) {
      return res.status(403).json({ error: '只有创建者可以删除传送门' });
    }

    // 软删除：设置 is_active 为 false
    await db.query(
      'UPDATE portals SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    res.json({ message: '传送门删除成功' });
  } catch (error) {
    console.error('删除传送门失败:', error);
    res.status(500).json({ error: '删除传送门失败' });
  }
});

// 获取传送门使用统计
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT 
        COUNT(*) as total_uses,
        COUNT(DISTINCT character_id) as unique_users,
        MAX(used_at) as last_used
       FROM portal_logs
       WHERE portal_id = $1`,
      [id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('获取传送门统计失败:', error);
    res.status(500).json({ error: '获取传送门统计失败' });
  }
});

module.exports = router;
