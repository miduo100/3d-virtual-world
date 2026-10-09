/**
 * purchaseService —— 商店购买事务化（AI World Brain · Phase 6 · §Phase 6 前置#1 + §H.8 缺陷 5）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 修的三件事（原 shop.js:253-276）：
 *   ① quantity 校验正整数（负数会通过库存判断并给库存加 N）；
 *   ② 单事务 + SELECT ... FOR UPDATE（插单与扣库存之间不再有并发超卖窗口）；
 *   ③ 接 currencyService：按单价×数量原子扣钱包（余额不足 → INSUFFICIENT_FUNDS，库存不加不扣）。
 * 响应形状与原实现保持一致：{ message, orderId, totalPrice } / 400 { error } / 404 { error }。
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { query, pool } = require('../database/db');
const currencyService = require('./currencyService');

/**
 * 购买核心（供路由与并发测试共用）。
 * @param {object} o { buyerId, shopItemId, quantity, idempotencyKey? }
 * @returns {ok, orderId?, totalPrice?, error?, code?}
 */
async function buy(o) {
  const p = o || {};
  const qty = Number(p.quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    return { ok: false, status: 400, error: 'quantity 必须是正整数' };
  }
  const itemRes = await query('SELECT * FROM shop_items WHERE id = $1', [p.shopItemId]);
  if (!itemRes.rows.length) return { ok: false, status: 404, error: 'Item not found' };
  const item = itemRes.rows[0];
  const price = Number(item.price) || 0;
  const totalPrice = Math.round(price * qty * 100) / 100;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 锁商品行（防并发超卖）
    const locked = await client.query('SELECT quantity FROM shop_items WHERE id=$1 FOR UPDATE', [p.shopItemId]);
    if (!locked.rows.length) { await client.query('ROLLBACK'); return { ok: false, status: 404, error: 'Item not found' }; }
    if (Number(locked.rows[0].quantity) < qty) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Not enough quantity' };
    }
    // 原子扣款（钱包 CHECK>=0 + 单条 UPDATE；余额不足整个事务回滚）
    const wd = await currencyService.withdraw({
      ownerType: 'user', ownerId: p.buyerId,
      amount: Math.ceil(totalPrice),
      kind: 'purchase', refType: 'shop_item', refId: String(p.shopItemId),
      idempotencyKey: p.idempotencyKey ? String(p.idempotencyKey) : null,
    });
    if (!wd.ok) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, error: wd.code === 'INSUFFICIENT_FUNDS' ? '余额不足' : ('扣款失败：' + wd.reason) };
    }
    const orderId = uuidv4();
    await client.query(
      `INSERT INTO orders (id, buyer_id, shop_item_id, quantity, total_price, status)
       VALUES ($1,$2,$3,$4,$5,'completed')`,
      [orderId, p.buyerId, p.shopItemId, qty, totalPrice]
    );
    await client.query('UPDATE shop_items SET quantity = quantity - $1 WHERE id = $2', [qty, p.shopItemId]);
    await client.query('COMMIT');
    return { ok: true, orderId, totalPrice, walletBalance: wd.balance };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* 已回滚 */ }
    return { ok: false, status: 500, error: 'Purchase failed: ' + e.message };
  } finally {
    client.release();
  }
}

module.exports = { buy };
