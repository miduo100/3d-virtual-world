/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');

// ============================================================
// 广告位（Ad Slots）管理接口
// trigger_type: 'link' | 'teleport'
// ============================================================

// GET /api/shop/ad-slots  列出所有广告位
router.get('/ad-slots', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM ad_slots ORDER BY created_at DESC'
    );
    res.json({ adSlots: result.rows });
  } catch (error) {
    console.error('[ad-slots list]', error);
    res.status(500).json({ error: '获取广告位列表失败' });
  }
});

// GET /api/shop/ad-slots/active  获取当前有效的广告位（供游戏世界渲染）
router.get('/ad-slots/active', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM ad_slots
       WHERE is_active = TRUE
         AND (rent_end IS NULL OR rent_end > NOW())
       ORDER BY created_at DESC`
    );
    res.json({ adSlots: result.rows });
  } catch (error) {
    console.error('[ad-slots active]', error);
    res.status(500).json({ error: '获取有效广告位失败' });
  }
});

// POST /api/shop/ad-slots  创建广告位
// portalType: 'link'(外链) | 'world'(世界传送) | 'app'(应用拉起)
router.post('/ad-slots', async (req, res) => {
  try {
    const {
      name, renterName,
      position, rotation, scale,
      modelUrl,
      portalType, targetUrl,
      targetWorldId, targetWorldUrl, targetWorldName,
      deepLink,
      rentStart, rentEnd
    } = req.body;

    // 兼容旧字段 triggerType -> portalType
    const pt = portalType || req.body.triggerType || 'link';

    if (!name) return res.status(400).json({ error: '广告位名称不能为空' });
    if (!['link', 'world', 'app'].includes(pt)) {
      return res.status(400).json({ error: 'portalType 必须是 link、world 或 app' });
    }
    if (pt === 'link' && !targetUrl) {
      return res.status(400).json({ error: 'link 类型必须填写目标链接' });
    }
    if (pt === 'world' && !targetWorldId && !targetWorldUrl) {
      return res.status(400).json({ error: 'world 类型必须选择目标世界' });
    }
    if (pt === 'app' && !deepLink) {
      return res.status(400).json({ error: 'app 类型必须填写深度链接' });
    }

    const id = uuidv4();
    await query(
      `INSERT INTO ad_slots
         (id, name, renter_name, position, rotation, scale, model_url,
          trigger_type, portal_type, target_url, target_world_url, target_world_name,
          target_world_id, deep_link,
          rent_start, rent_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        name,
        renterName || null,
        JSON.stringify(position || { x: 0, y: 0, z: 0 }),
        JSON.stringify(rotation || { x: 0, y: 0, z: 0 }),
        JSON.stringify(scale || { x: 1, y: 1, z: 1 }),
        modelUrl || null,
        pt,                               // trigger_type 兼容
        pt,                               // portal_type 新字段
        targetUrl || null,
        targetWorldUrl || null,
        targetWorldName || null,
        targetWorldId || null,
        deepLink || null,
        rentStart || null,
        rentEnd || null
      ]
    );

    res.json({ message: '广告位创建成功', id });
  } catch (error) {
    console.error('[ad-slots create]', error);
    res.status(500).json({ error: '创建广告位失败' });
  }
});

// PUT /api/shop/ad-slots/:id  更新广告位
router.put('/ad-slots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, renterName,
      position, rotation, scale,
      modelUrl,
      portalType, triggerType, targetUrl,
      targetWorldId, targetWorldUrl, targetWorldName,
      deepLink,
      rentStart, rentEnd,
      isActive
    } = req.body;

    const pt = portalType || triggerType;
    if (pt && !['link', 'world', 'app'].includes(pt)) {
      return res.status(400).json({ error: 'portalType 必须是 link、world 或 app' });
    }

    await query(
      `UPDATE ad_slots SET
         name = COALESCE($1, name),
         renter_name = COALESCE($2, renter_name),
         position = COALESCE($3, position),
         rotation = COALESCE($4, rotation),
         scale = COALESCE($5, scale),
         model_url = COALESCE($6, model_url),
         trigger_type = COALESCE($7, trigger_type),
         portal_type = COALESCE($7, portal_type),
         target_url = COALESCE($8, target_url),
         target_world_url = COALESCE($9, target_world_url),
         target_world_name = COALESCE($10, target_world_name),
         target_world_id = COALESCE($11, target_world_id),
         deep_link = COALESCE($12, deep_link),
         rent_start = COALESCE($13, rent_start),
         rent_end = COALESCE($14, rent_end),
         is_active = COALESCE($15, is_active),
         updated_at = NOW()
       WHERE id = $16`,
      [
        name || null,
        renterName !== undefined ? renterName : null,
        position ? JSON.stringify(position) : null,
        rotation ? JSON.stringify(rotation) : null,
        scale ? JSON.stringify(scale) : null,
        modelUrl !== undefined ? modelUrl : null,
        pt || null,
        targetUrl !== undefined ? targetUrl : null,
        targetWorldUrl !== undefined ? targetWorldUrl : null,
        targetWorldName !== undefined ? targetWorldName : null,
        targetWorldId !== undefined ? targetWorldId : null,
        deepLink !== undefined ? deepLink : null,
        rentStart || null,
        rentEnd || null,
        isActive !== undefined ? isActive : null,
        id
      ]
    );

    res.json({ message: '广告位更新成功' });
  } catch (error) {
    console.error('[ad-slots update]', error);
    res.status(500).json({ error: '更新广告位失败' });
  }
});

// DELETE /api/shop/ad-slots/:id  删除广告位
router.delete('/ad-slots/:id', async (req, res) => {
  try {
    await query('DELETE FROM ad_slots WHERE id = $1', [req.params.id]);
    res.json({ message: '广告位已删除' });
  } catch (error) {
    console.error('[ad-slots delete]', error);
    res.status(500).json({ error: '删除广告位失败' });
  }
});

// ============================================================
// 兼容旧接口（Create shop / add item / purchase 等）
// ============================================================

// Create shop
router.post('/create', async (req, res) => {
  try {
    const { merchantId, shopName, position } = req.body;
    const shopId = uuidv4();
    await query(
      'INSERT INTO shops (id, merchant_id, shop_name, position) VALUES ($1, $2, $3, $4)',
      [shopId, merchantId, shopName, JSON.stringify(position)]
    );
    res.json({ message: 'Shop created', shopId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create shop' });
  }
});

// Add item to shop
router.post('/add-item', async (req, res) => {
  try {
    const { shopId, itemName, description, price, quantity, modelUrl } = req.body;
    const itemId = uuidv4();
    await query(
      `INSERT INTO shop_items (id, shop_id, item_name, description, price, quantity, model_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [itemId, shopId, itemName, description, price, quantity, modelUrl]
    );
    res.json({ message: 'Item added to shop', itemId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// Get shop details
router.get('/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const shopResult = await query('SELECT * FROM shops WHERE id = $1', [shopId]);
    if (shopResult.rows.length === 0) return res.status(404).json({ error: 'Shop not found' });
    const itemsResult = await query(
      'SELECT * FROM shop_items WHERE shop_id = $1 AND quantity > 0', [shopId]
    );
    res.json({ shop: shopResult.rows[0], items: itemsResult.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch shop' });
  }
});

// Get all shops in world
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT id, shop_name, position FROM shops');
    res.json({ shops: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch shops' });
  }
});

// Purchase item
router.post('/purchase', async (req, res) => {
  try {
    const { buyerId, shopItemId, quantity } = req.body;
    const itemResult = await query('SELECT price, quantity FROM shop_items WHERE id = $1', [shopItemId]);
    if (itemResult.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    const item = itemResult.rows[0];
    if (item.quantity < quantity) return res.status(400).json({ error: 'Not enough quantity' });
    const totalPrice = item.price * quantity;
    const orderId = uuidv4();
    await query(
      `INSERT INTO orders (id, buyer_id, shop_item_id, quantity, total_price, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderId, buyerId, shopItemId, quantity, totalPrice, 'completed']
    );
    await query('UPDATE shop_items SET quantity = quantity - $1 WHERE id = $2', [quantity, shopItemId]);
    res.json({ message: 'Purchase successful', orderId, totalPrice });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Purchase failed' });
  }
});

module.exports = router;
