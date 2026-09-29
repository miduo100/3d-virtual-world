/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { query } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// 通过该接口可写入的列白名单（安全修复 D2/S2-01）：
// 此前 handler 把请求体的**键名直接拼进 SET 子句**，攻击者可借列名注入读写任意表数据。
const APPEARANCE_COLS = new Set([
  'face_brows', 'face_glasses', 'face_nose', 'face_skin', 'face_ears', 'face_mouth',
  'face_beard', 'face_jaw', 'hair', 'top_wear', 'bottom_wear', 'shoes',
]);

/**
 * 可选身份：GET 保持公开（世界加载/游客浏览依赖公开读），但带 token 时解析出
 * 属主，用于隐藏他人隐私字段（审计 S2-08）。
 */
function optionalAuth(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) return next();
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (!err && user) req.user = user;
    next();
  });
}

/**
 * 属主校验（安全修复 D2）：身份只从 token 派生。
 *
 * 返回 `{ ok, actorUserId }`：
 *   - 请求上下文里**有**已认证身份（生产常态：挂载层 `apiWriteGuard` 要求玩家 JWT）
 *     → 校验 `characters.user_id` 是否等于该身份，不等则 403、角色不存在则 404；
 *   - 上下文里**没有**身份（例如设了 `SECURITY_GUARD_OFF=1` 紧急放行，或该路由被
 *     单独摘掉守卫）→ 保持修复前行为继续执行，**这样保险丝才能完整回退**。
 */
async function checkCharacterOwner(req, res, characterId) {
  const actorUserId = (req.user && req.user.userId) || null;
  if (!actorUserId) return { ok: true, actorUserId: null };

  const result = await query('SELECT user_id FROM characters WHERE id = $1', [characterId]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Character not found' });
    return { ok: false, actorUserId: null };
  }
  if (String(result.rows[0].user_id) !== String(actorUserId)) {
    res.status(403).json({ error: '无权操作该角色' });
    return { ok: false, actorUserId: null };
  }
  return { ok: true, actorUserId };
}

// Get user character
router.get('/character/:characterId', optionalAuth, async (req, res) => {
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

    // 隐私保护（审计 S2-08）：账号邮箱仅对角色属主返回
    const viewerId = (req.user && req.user.userId) || null;
    if (!viewerId || String(character.user_id) !== String(viewerId)) {
      delete character.user_email;
    }

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

    // 安全修复 D2：属主校验（此前匿名可改任意角色外观）
    const owner = await checkCharacterOwner(req, res, characterId);
    if (!owner.ok) return;

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(appearanceData)) {
      // 安全修复 S2-01：列名白名单——非白名单键直接忽略，彻底消除标识符注入
      if (!APPEARANCE_COLS.has(key)) continue;
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

    // 安全修复 D2：属主校验（此前匿名可改任意角色位置）
    const owner = await checkCharacterOwner(req, res, characterId);
    if (!owner.ok) return;

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

    // 安全修复 D2：属主校验（此前匿名可改任意角色重生点）
    const owner = await checkCharacterOwner(req, res, characterId);
    if (!owner.ok) return;

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
