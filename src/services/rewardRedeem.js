/**
 * rewardRedeem —— 真人凭码兑换入背包（AI World Brain · Phase 6 · 用户拍板方案 A）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * Agent 领奖只登记（world_reward_grants，无 users 行写不进背包），Agent 用 say 把码送给真人；
 * 真人拿码走 POST /api/inventory/redeem（玩家 JWT）→ 本模块 → player_inventory。
 *
 * 可兑换的码 = is_claimed=FALSE，或 is_claimed=TRUE 且 claimed_by IS NULL（Agent 路径预留的码：
 * 认识码即 entitlement，第一个凭码来兑的真人得到它）；已被某真人认领的码不可再兑（防双花）。
 * 幂等：同一 user 对同一码重复兑换 → deduped，不报错不重复入包。
 */
'use strict';

const { query, pool } = require('../database/db');

function bad(code, reason) { return { ok: false, code, reason }; }

async function redeemByCode(userId, rawCode) {
  const code = String(rawCode || '').trim();
  if (!userId) return bad('USER_REQUIRED', '缺少用户身份');
  if (!code) return bad('CODE_REQUIRED', '缺少兑换码');
  if (code.length > 500) return bad('CODE_INVALID', '兑换码格式不正确');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT * FROM reward_codes WHERE code=$1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
      [code]
    );
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return bad('CODE_NOT_FOUND', '兑换码不存在');
    }
    const row = found.rows[0];
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return bad('CODE_EXPIRED', '兑换码已过期');
    }
    if (row.is_claimed && row.claimed_by) {
      if (String(row.claimed_by) === String(userId)) {
        // 已是自己的 → 幂等成功
        const inv0 = await client.query(
          `SELECT id FROM player_inventory WHERE user_id=$1 AND code_id=$2`, [String(userId), row.id]);
        await client.query('COMMIT');
        return { ok: true, deduped: true, alreadyOwned: true, inventoryId: inv0.rows.length ? inv0.rows[0].id : null, item: pubItem(row) };
      }
      await client.query('ROLLBACK');
      return bad('CODE_ALREADY_CLAIMED', '兑换码已被领取');
    }
    const upd = await client.query(
      `UPDATE reward_codes SET is_claimed=TRUE, claimed_by=$1, claimed_at=NOW() WHERE id=$2 RETURNING *`,
      [String(userId), row.id]
    );
    const inv = await client.query(
      `INSERT INTO player_inventory (id, user_id, code_id) VALUES (gen_random_uuid(),$1,$2)
       ON CONFLICT (user_id, code_id) DO NOTHING RETURNING id`,
      [String(userId), row.id]
    );
    await client.query('COMMIT');
    return {
      ok: true, deduped: false,
      inventoryId: inv.rows.length ? inv.rows[0].id : null,
      item: pubItem(upd.rows[0]),
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* 已回滚 */ }
    return bad('REDEEM_FAILED', '兑换失败：' + e.message);
  } finally {
    client.release();
  }
}

function pubItem(row) {
  return {
    rewardName: row.reward_name, rewardDesc: row.reward_desc,
    code: row.code, platformUrl: row.platform_url, codeId: row.id,
  };
}

module.exports = { redeemByCode };
