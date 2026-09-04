/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * worldLock.js - 世界对象锁定/解锁路由
 *
 * 说明：
 *  - 仅支持 world_objects 表中的数字主键对象（ad_slots/custom_npcs 等 UUID 对象不支持锁定）
 *  - 挂载于 /api/world 前缀，受 worldWriteGuard 管理员权限保护
 *  - is_locked 不在 PUT /objects/:id 白名单内，保存属性不会覆盖锁定状态
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');

// 设置对象锁定状态
// PUT /api/world/objects/:id/lock   body: { locked: boolean }
router.put('/objects/:id/lock', async (req, res) => {
  try {
    const { id } = req.params;
    const locked = !!(req.body && req.body.locked);

    if (!/^\d+$/.test(String(id))) {
      return res.status(400).json({ success: false, error: '仅支持 world_objects 中的数字对象 ID' });
    }

    const result = await query(
      'UPDATE world_objects SET is_locked = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_locked',
      [locked, Number(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '对象不存在或不可锁定' });
    }

    res.json({ success: true, id: Number(id), is_locked: result.rows[0].is_locked });
  } catch (error) {
    console.error('[worldLock] 设置锁定状态失败:', error);
    res.status(500).json({ success: false, error: 'Failed to update lock state' });
  }
});

module.exports = router;
