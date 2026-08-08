/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');

// ============================================================
// 奖励池管理
// ============================================================

// GET /api/inventory/pools  列出所有奖励池
router.get('/pools', async (req, res) => {
  try {
    const result = await query(`
      SELECT rp.*,
        COUNT(rc.id)                                         AS total_codes,
        COUNT(CASE WHEN rc.is_claimed = FALSE
                    AND (rc.expires_at IS NULL OR rc.expires_at > NOW())
               THEN 1 END)                                   AS available_codes,
        COUNT(CASE WHEN rc.is_claimed = TRUE THEN 1 END)     AS claimed_codes
      FROM reward_pools rp
      LEFT JOIN reward_codes rc ON rc.pool_id = rp.id
      GROUP BY rp.id
      ORDER BY rp.created_at DESC
    `);
    res.json({ pools: result.rows });
  } catch (e) {
    console.error('[pools list]', e);
    res.status(500).json({ error: '获取奖励池失败' });
  }
});

// POST /api/inventory/pools  创建奖励池
router.post('/pools', async (req, res) => {
  try {
    const { poolName, description } = req.body;
    if (!poolName) return res.status(400).json({ error: '奖励池名称不能为空' });
    const id = uuidv4();
    await query(
      'INSERT INTO reward_pools (id, pool_name, description) VALUES ($1,$2,$3)',
      [id, poolName, description || null]
    );
    res.json({ message: '奖励池创建成功', id });
  } catch (e) {
    console.error('[pools create]', e);
    res.status(500).json({ error: '创建奖励池失败' });
  }
});

// DELETE /api/inventory/pools/:id  删除奖励池
router.delete('/pools/:id', async (req, res) => {
  try {
    await query('DELETE FROM reward_pools WHERE id=$1', [req.params.id]);
    res.json({ message: '奖励池已删除' });
  } catch (e) {
    console.error('[pools delete]', e);
    res.status(500).json({ error: '删除奖励池失败' });
  }
});

// ============================================================
// 兑换码导入
// ============================================================

// POST /api/inventory/pools/:id/import  批量导入兑换码
// body: { codes: [ { code, rewardName, rewardDesc, platformUrl, expiresAt } ] }
router.post('/pools/:id/import', async (req, res) => {
  try {
    const { id: poolId } = req.params;
    const { codes } = req.body;
    if (!Array.isArray(codes) || !codes.length) {
      return res.status(400).json({ error: 'codes 不能为空数组' });
    }

    // 验证奖励池存在
    const poolRes = await query('SELECT id FROM reward_pools WHERE id=$1', [poolId]);
    if (!poolRes.rows.length) return res.status(404).json({ error: '奖励池不存在' });

    let imported = 0;
    let skipped = 0;
    for (const item of codes) {
      if (!item.code || !item.rewardName) { skipped++; continue; }
      const id = uuidv4();
      try {
        await query(
          `INSERT INTO reward_codes (id, pool_id, code, reward_name, reward_desc, platform_url, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, poolId, item.code.trim(), item.rewardName, item.rewardDesc || null, item.platformUrl || null, item.expiresAt || null]
        );
        imported++;
      } catch (dupErr) {
        skipped++; // 重复 code 跳过
      }
    }

    res.json({ message: `导入完成：成功 ${imported} 条，跳过 ${skipped} 条`, imported, skipped });
  } catch (e) {
    console.error('[import codes]', e);
    res.status(500).json({ error: '导入失败' });
  }
});

// GET /api/inventory/pools/:id/codes  查看某奖励池的码列表
router.get('/pools/:id/codes', async (req, res) => {
  try {
    const result = await query(
      `SELECT rc.*, u.username AS claimed_by_name
       FROM reward_codes rc
       LEFT JOIN users u ON u.id = rc.claimed_by
       WHERE rc.pool_id = $1
       ORDER BY rc.created_at DESC`,
      [req.params.id]
    );
    res.json({ codes: result.rows });
  } catch (e) {
    console.error('[pool codes]', e);
    res.status(500).json({ error: '获取码列表失败' });
  }
});

// ============================================================
// 世界掉落物（供游戏客户端查询）
// ============================================================

// GET /api/inventory/drops  获取当前世界有效掉落物（未被拾取且未过期）
router.get('/drops', async (req, res) => {
  try {
    const result = await query(`
      SELECT wd.id, wd.position, wd.expires_at,
             rc.reward_name
      FROM world_drops wd
      JOIN reward_codes rc ON rc.id = wd.code_id
      WHERE wd.is_picked = FALSE AND wd.expires_at > NOW()
      ORDER BY wd.dropped_at DESC
    `);
    res.json({ drops: result.rows });
  } catch (e) {
    console.error('[drops]', e);
    res.status(500).json({ error: '获取掉落物失败' });
  }
});

// POST /api/inventory/drops/:dropId/pick  拾取掉落物
// body: { userId }
router.post('/drops/:dropId/pick', async (req, res) => {
  try {
    const { dropId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId 必填' });

    // 查询掉落物
    const dropRes = await query(
      `SELECT wd.*, rc.reward_name, rc.reward_desc, rc.code, rc.platform_url
       FROM world_drops wd
       JOIN reward_codes rc ON rc.id = wd.code_id
       WHERE wd.id = $1`,
      [dropId]
    );
    if (!dropRes.rows.length) return res.status(404).json({ error: '掉落物不存在' });

    const drop = dropRes.rows[0];
    if (drop.is_picked) return res.status(400).json({ error: '该物品已被拾取' });
    if (new Date(drop.expires_at) < new Date()) return res.status(400).json({ error: '掉落物已过期消失' });

    // 标记掉落物已被拾取
    await query(
      'UPDATE world_drops SET is_picked=TRUE, picked_by=$1, picked_at=NOW() WHERE id=$2',
      [userId, dropId]
    );
    // 标记兑换码已领取
    await query(
      'UPDATE reward_codes SET is_claimed=TRUE, claimed_by=$1, claimed_at=NOW() WHERE id=$2',
      [userId, drop.code_id]
    );
    // 加入背包
    const invId = uuidv4();
    await query(
      `INSERT INTO player_inventory (id, user_id, code_id) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, code_id) DO NOTHING`,
      [invId, userId, drop.code_id]
    );

    res.json({
      message: '拾取成功',
      item: {
        id: invId,
        rewardName: drop.reward_name,
        rewardDesc: drop.reward_desc,
        code: drop.code,
        platformUrl: drop.platform_url,
      }
    });
  } catch (e) {
    console.error('[pick drop]', e);
    res.status(500).json({ error: '拾取失败' });
  }
});

// POST /api/inventory/drops/:dropId/mark-picked  只标记掉落物已拾取（不写背包，供家园世界模式使用）
// body: { userId }
router.post('/drops/:dropId/mark-picked', async (req, res) => {
  try {
    const { dropId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId 必填' });

    // 查询掉落物
    const dropRes = await query(
      `SELECT wd.*, rc.reward_name, rc.reward_desc, rc.code, rc.platform_url, rc.id AS code_id_val
       FROM world_drops wd
       JOIN reward_codes rc ON rc.id = wd.code_id
       WHERE wd.id = $1`,
      [dropId]
    );
    if (!dropRes.rows.length) return res.status(404).json({ error: '掉落物不存在' });

    const drop = dropRes.rows[0];
    if (drop.is_picked) return res.status(400).json({ error: '该物品已被拾取' });
    if (new Date(drop.expires_at) < new Date()) return res.status(400).json({ error: '掉落物已过期消失' });

    // 标记掉落物已被拾取
    await query(
      'UPDATE world_drops SET is_picked=TRUE, picked_by=$1, picked_at=NOW() WHERE id=$2',
      [userId, dropId]
    );
    // 标记兑换码已领取（claimed_by 记录本地userId，仅供当前世界统计）
    await query(
      'UPDATE reward_codes SET is_claimed=TRUE, claimed_by=$1, claimed_at=NOW() WHERE id=$2',
      [userId, drop.code_id]
    );

    res.json({
      message: '标记成功',
      item: {
        rewardName:  drop.reward_name,
        rewardDesc:  drop.reward_desc,
        code:        drop.code,
        platformUrl: drop.platform_url,
        codeId:      drop.code_id,
      }
    });
  } catch (e) {
    console.error('[mark-picked]', e);
    res.status(500).json({ error: '标记失败' });
  }
});

// POST /api/inventory/remote-add  跨世界远程写入背包（家园世界模式：奖励从外部世界回传到家园世界）
// body: { homeUserId, rewardName, rewardDesc, code, platformUrl, sourceWorldUrl }
// 安全验证：通过 Authorization Bearer token 验证调用者身份
router.post('/remote-add', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const { homeUserId, rewardName, rewardDesc, code, platformUrl, sourceWorldUrl } = req.body;
    if (!homeUserId || !rewardName || !code) {
      return res.status(400).json({ error: 'homeUserId、rewardName、code 必填' });
    }

    // 验证 token 与 homeUserId 匹配（直接查 users 表，避免引入 jwt 依赖）
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const secret = process.env.JWT_SECRET;
        const decoded = jwt.verify(token, secret);
        if (decoded.userId !== homeUserId && decoded.id !== homeUserId) {
          return res.status(403).json({ error: 'token 与 homeUserId 不匹配' });
        }
      } catch (jwtErr) {
        return res.status(401).json({ error: 'token 无效' });
      }
    } else {
      return res.status(401).json({ error: '缺少 Authorization token' });
    }

    // 验证用户存在
    const userRes = await query('SELECT id FROM users WHERE id=$1', [homeUserId]);
    if (!userRes.rows.length) return res.status(404).json({ error: '用户不存在' });

    // 查找或创建奖励码记录（跨世界奖励用 code 字段关联，pool_id 用特殊标识）
    let codeId;
    const existCode = await query('SELECT id FROM reward_codes WHERE code=$1', [code]);
    if (existCode.rows.length) {
      codeId = existCode.rows[0].id;
    } else {
      // 奖励码在家园世界不存在，动态创建（标记来源世界）
      // 先确保有一个 remote_rewards 奖励池
      let poolId;
      const poolRes = await query("SELECT id FROM reward_pools WHERE pool_name='remote_rewards' LIMIT 1");
      if (poolRes.rows.length) {
        poolId = poolRes.rows[0].id;
      } else {
        poolId = uuidv4();
        await query(
          "INSERT INTO reward_pools (id, pool_name, description) VALUES ($1,'remote_rewards','跨世界回传奖励池')",
          [poolId]
        );
      }
      codeId = uuidv4();
      await query(
        `INSERT INTO reward_codes (id, pool_id, code, reward_name, reward_desc, platform_url, is_claimed, claimed_by, claimed_at)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,NOW())`,
        [codeId, poolId, code, rewardName, rewardDesc || null, platformUrl || null, homeUserId]
      );
    }

    // 写入玩家背包（幂等：同一 code 不重复写入）
    const invId = uuidv4();
    const result = await query(
      `INSERT INTO player_inventory (id, user_id, code_id) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, code_id) DO NOTHING`,
      [invId, homeUserId, codeId]
    );

    const inserted = result.rowCount > 0;
    console.log(`[remote-add] homeUserId=${homeUserId} code=${code} from=${sourceWorldUrl || '?'} inserted=${inserted}`);

    res.json({
      message: inserted ? '奖励已写入家园世界背包' : '奖励已存在（幂等）',
      inserted,
      item: { rewardName, rewardDesc, code, platformUrl }
    });
  } catch (e) {
    console.error('[remote-add]', e);
    res.status(500).json({ error: '远程写入背包失败' });
  }
});

// ============================================================
// 玩家背包
// ============================================================

// GET /api/inventory/bag/:userId  获取玩家背包
router.get('/bag/:userId', async (req, res) => {
  try {
    const result = await query(
      `SELECT pi.id, pi.acquired_at, pi.is_used, pi.used_at,
              rc.reward_name, rc.reward_desc, rc.code, rc.platform_url, rc.expires_at
       FROM player_inventory pi
       JOIN reward_codes rc ON rc.id = pi.code_id
       WHERE pi.user_id = $1
       ORDER BY pi.acquired_at DESC`,
      [req.params.userId]
    );
    res.json({ items: result.rows });
  } catch (e) {
    console.error('[bag]', e);
    res.status(500).json({ error: '获取背包失败' });
  }
});

// POST /api/inventory/bag/:itemId/use  标记物品为已使用
// body: { userId }
router.post('/bag/:itemId/use', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId } = req.body;
    await query(
      `UPDATE player_inventory SET is_used=TRUE, used_at=NOW()
       WHERE id=$1 AND user_id=$2`,
      [itemId, userId]
    );
    res.json({ message: '已标记为使用' });
  } catch (e) {
    console.error('[use item]', e);
    res.status(500).json({ error: '操作失败' });
  }
});

// ============================================================
// 后台发放记录
// ============================================================

// GET /api/inventory/admin/issued  管理后台查看所有发放记录
router.get('/admin/issued', async (req, res) => {
  try {
    const result = await query(`
      SELECT pi.id, pi.acquired_at, pi.is_used, pi.used_at,
             u.username,
             rc.reward_name, rc.code, rc.pool_id,
             rp.pool_name
      FROM player_inventory pi
      JOIN users u ON u.id = pi.user_id
      JOIN reward_codes rc ON rc.id = pi.code_id
      JOIN reward_pools rp ON rp.id = rc.pool_id
      ORDER BY pi.acquired_at DESC
      LIMIT 200
    `);
    res.json({ records: result.rows });
  } catch (e) {
    console.error('[admin issued]', e);
    res.status(500).json({ error: '获取发放记录失败' });
  }
});

module.exports = router;
