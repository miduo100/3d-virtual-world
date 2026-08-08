/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// Get user character
router.get('/character/:characterId', async (req, res) => {
  try {
    const { characterId } = req.params;

    const charResult = await query(
      `SELECT c.*, u.email AS user_email 
       FROM characters c 
       LEFT JOIN users u ON c.user_id = u.id 
       WHERE c.id = $1`,
      [characterId]
    );

    if (charResult.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const character = charResult.rows[0];

    // Get appearance
    const appearanceResult = await query(
      'SELECT * FROM character_appearance WHERE character_id = $1',
      [characterId]
    );

    // Get equipment
    const equipmentResult = await query(
      'SELECT * FROM equipment WHERE character_id = $1',
      [characterId]
    );

    // Get skills
    const skillsResult = await query(
      'SELECT * FROM skills WHERE character_id = $1',
      [characterId]
    );

    res.json({
      character,
      appearance: appearanceResult.rows[0] || {},
      equipment: equipmentResult.rows,
      skills: skillsResult.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch character' });
  }
});

// Update character appearance
router.post('/character/:characterId/appearance', async (req, res) => {
  try {
    const { characterId } = req.params;
    const appearanceData = req.body;

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(appearanceData)) {
      updateFields.push(`${key} = $${paramCount}`);
      updateValues.push(value);
      paramCount++;
    }

    updateFields.push(`updated_at = $${paramCount}`);
    updateValues.push(new Date());
    updateValues.push(characterId);

    const sql = `
      UPDATE character_appearance 
      SET ${updateFields.join(', ')} 
      WHERE character_id = $${paramCount + 1}
      RETURNING *
    `;

    const result = await query(sql, updateValues);

    res.json({
      message: 'Appearance updated',
      appearance: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update appearance' });
  }
});

// Update character position
router.post('/character/:characterId/position', async (req, res) => {
  try {
    const { characterId } = req.params;
    const { position } = req.body;

    await query(
      'UPDATE characters SET position = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(position), characterId]
    );

    res.json({ message: 'Position updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update position' });
  }
});

// Update character profile (name, realname, bio + user email)
router.put('/character/:characterId/profile', authenticateToken, async (req, res) => {
  try {
    const { characterId } = req.params;
    const { name, realname, bio, email } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: '昵称不能为空' });
    }

    // 先获取 character 关联的 user_id
    const charResult = await query(
      'SELECT user_id FROM characters WHERE id = $1',
      [characterId]
    );

    if (charResult.rows.length === 0) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const userId = charResult.rows[0].user_id;

    // 更新 characters 表
    const updateResult = await query(
      `UPDATE characters SET name = $1, realname = $2, bio = $3, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $4 RETURNING *`,
      [name.trim(), realname || null, bio || null, characterId]
    );

    // 同时更新 users 表的 email
    if (email !== undefined && email !== null) {
      await query(
        'UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [email.trim() || null, userId]
      );
    }

    res.json({ success: true, character: updateResult.rows[0] });
  } catch (error) {
    console.error('[API] 更新个人资料失败:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Set respawn point
router.post('/character/:characterId/respawn-point', async (req, res) => {
  try {
    const { characterId } = req.params;
    const { respawnPoint } = req.body;

    await query(
      'UPDATE characters SET respawn_point = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(respawnPoint), characterId]
    );

    res.json({ message: 'Respawn point set' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to set respawn point' });
  }
});

module.exports = router;
