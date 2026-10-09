/**
 * rewardService —— 奖励服务层（AI World Brain · Phase 6 · §Phase 6 前置#2 + §H.8 缺陷 6）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 用户拍板方案 A（2026-10-09）：
 *   - 真人 actor  → 直接发放：原子认领 reward_code（FOR UPDATE SKIP LOCKED）+ player_inventory 1 行；
 *   - Agent actor → world_reward_grants 幂等登记（红线：不建本地 users 行，写不进背包），
 *     同时原子预留一条 reward_code（is_claimed=TRUE, claimed_by=NULL），Agent 用 say 把码送给真人，
 *     真人凭码走 /api/inventory/redeem 入背包（见 services/rewardRedeem.js）。
 * ★ 原子性：认领码统一走 "SELECT ... FOR UPDATE SKIP LOCKED + UPDATE"，并发不双领；
 *   拾取掉落（pickDrop）用 "UPDATE ... WHERE is_picked=FALSE RETURNING" 单条原子，修 4 处重复实现。
 */
'use strict';

const { query, pool } = require('../../database/db');

function bad(code, reason, extra) {
  return Object.assign({ ok: false, code, reason }, extra || {});
}

/**
 * 原子认领一条兑换码。
 * @returns {ok, code:{id,code,reward_name,...}|null, reason?}
 */
async function claimCode(o) {
  const p = o || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let sel, args;
    if (p.codeId) {
      sel = `SELECT * FROM reward_codes WHERE id=$1 AND is_claimed=FALSE
              AND (expires_at IS NULL OR expires_at > NOW()) FOR UPDATE SKIP LOCKED`;
      args = [String(p.codeId)];
    } else if (p.poolKey) {
      sel = `SELECT rc.* FROM reward_codes rc JOIN reward_pools rp ON rp.id = rc.pool_id
              WHERE rp.pool_name=$1 AND rc.is_claimed=FALSE
                AND (rc.expires_at IS NULL OR rc.expires_at > NOW())
              ORDER BY rc.created_at ASC LIMIT 1 FOR UPDATE OF rc SKIP LOCKED`;
      args = [String(p.poolKey)];
    } else {
      await client.query('ROLLBACK');
      return bad('CODE_SOURCE_REQUIRED', '必须给 codeId 或 poolKey');
    }
    const found = await client.query(sel, args);
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return { ok: true, code: null, reason: '池中无可用兑换码（未领取/未过期）' };
    }
    const row = found.rows[0];
    const upd = await client.query(
      `UPDATE reward_codes SET is_claimed=TRUE, claimed_by=$1, claimed_at=NOW() WHERE id=$2
       RETURNING *`,
      [p.forUserId ? String(p.forUserId) : null, row.id]
    );
    let invId = null;
    if (p.writeInventory && p.forUserId) {
      const inv = await client.query(
        `INSERT INTO player_inventory (id, user_id, code_id) VALUES (gen_random_uuid(),$1,$2)
         ON CONFLICT (user_id, code_id) DO NOTHING RETURNING id`,
        [String(p.forUserId), row.id]
      );
      invId = inv.rows.length ? inv.rows[0].id : null;
    }
    await client.query('COMMIT');
    return { ok: true, code: upd.rows[0], inventoryId: invId, reserved: !p.forUserId };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* 已回滚 */ }
    return bad('CLAIM_FAILED', '认领兑换码失败：' + e.message);
  } finally {
    client.release();
  }
}

/**
 * 发放给某个 Actor（保持 3.5 签名兼容）。
 * @param {object} o { worldId, actorType:'agent'|'human', actorId, interactionId, interactionKey,
 *                     codeId?, code?, poolKey?, count?, regionKey? }
 */
async function grantToActor(o) {
  const p = o || {};
  if (!p.actorType || !p.actorId) return bad('ACTOR_REQUIRED', '必须给 actorType 与 actorId');
  if (!p.interactionKey) return bad('INTERACTION_KEY_REQUIRED', '缺少 interactionKey（幂等键的一环）');
  const count = Math.max(1, Math.floor(Number(p.count) || 1));

  // 幂等闸：world_reward_grants 唯一键（两类 actor 都走同一张登记表）
  const res = await query(
    `INSERT INTO world_reward_grants
       (world_id, actor_type, actor_id, interaction_id, interaction_key, region_key, code_id, code, count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (actor_type, actor_id, interaction_key) DO NOTHING
     RETURNING id, code, count`,
    [String(p.worldId || ''), String(p.actorType), String(p.actorId),
      p.interactionId || null, String(p.interactionKey), p.regionKey || null,
      p.codeId || null, p.code || null, count]
  );
  if (!res.rows || !res.rows.length) {
    return { ok: true, granted: false, deduped: true, row: null, notice: '该Actor 对此交互点已领过，不重复发（幂等）' };
  }
  const grantRow = res.rows[0];

  // 真人：直接进背包（原子认领 + player_inventory）
  if (String(p.actorType) === 'human') {
    let picked = null;
    if (p.codeId) picked = await claimCode({ codeId: p.codeId, forUserId: p.actorId, writeInventory: true });
    else if (p.poolKey) picked = await claimCode({ poolKey: p.poolKey, forUserId: p.actorId, writeInventory: true });
    else if (p.code) picked = { ok: true, code: { code: p.code }, inventoryId: null, passthrough: true };
    if (picked && !picked.ok) return picked;
    return {
      ok: true, granted: true, deduped: false, row: grantRow,
      code: picked && picked.code ? picked.code.code : (p.code || null),
      inventoryId: picked ? picked.inventoryId : null,
      notice: picked && picked.code ? '已发进背包' : '已登记（池中暂无可用兑换码，稍后可补发）',
    };
  }

  // Agent：原子预留一条码（claimed_by=NULL），Agent 用 say 把码送给真人，真人凭码 redeem
  let reserved = null;
  if (p.codeId) reserved = await claimCode({ codeId: p.codeId });
  else if (p.poolKey) reserved = await claimCode({ poolKey: p.poolKey });
  const codeText = (reserved && reserved.code && reserved.code.code) || p.code || null;
  if (codeText && !grantRow.code) {
    await query(`UPDATE world_reward_grants SET code=$1, code_id=$2 WHERE id=$3`,
      [codeText, reserved && reserved.code ? reserved.code.id : (p.codeId || null), grantRow.id]);
  }
  return {
    ok: true, granted: true, deduped: false, row: grantRow,
    code: codeText,
    notice: codeText
      ? '已登记并预留兑换码：Agent 可用 say 把码送给真人，真人凭码在背包页兑换'
      : '已登记（池中暂无可用兑换码）',
  };
}

/** 任务结算发奖（taskService 调用）。reward = {type:'reward_codes', poolKey?, count?} */
async function grantTaskReward(o) {
  const p = o || {};
  if (!p.taskId || !p.actorType || !p.actorId) return bad('ACTOR_REQUIRED', '必须给 taskId/actorType/actorId');
  const reward = p.reward && typeof p.reward === 'object' ? p.reward : { type: 'reward_codes', count: 1 };
  return grantToActor({
    worldId: p.worldId,
    actorType: p.actorType, actorId: p.actorId,
    interactionKey: 'task:' + String(p.taskId),
    poolKey: reward.poolKey || null,
    codeId: reward.codeId || null,
    code: reward.code || null,
    count: Number(reward.count) || 1,
    regionKey: p.regionKey || null,
  });
}

/**
 * 原子拾取掉落物（合并 inventory.js pick / mark-pick 重复实现，§H.8 缺陷 6）。
 * @returns {ok, drop?, alreadyPicked?, expired?, inventoryId?}
 */
async function pickDrop(dropId, userId, opts) {
  const o = opts || {};
  if (!dropId || !userId) return bad('PARAMS_REQUIRED', 'dropId 与 userId 必填');
  const upd = await query(
    `UPDATE world_drops SET is_picked=TRUE, picked_by=$1, picked_at=NOW()
      WHERE id=$2 AND is_picked=FALSE AND expires_at > NOW()
      RETURNING *`,
    [String(userId), String(dropId)]
  );
  if (!upd.rows.length) {
    const cur = await query(`SELECT is_picked, expires_at FROM world_drops WHERE id=$1`, [String(dropId)]);
    if (!cur.rows.length) return bad('DROP_NOT_FOUND', '掉落物不存在');
    if (cur.rows[0].is_picked) return { ok: false, code: 'ALREADY_PICKED', reason: '该物品已被拾取' };
    return { ok: false, code: 'EXPIRED', reason: '掉落物已过期消失' };
  }
  const drop = upd.rows[0];
  // 原子认领码 + （可选）进背包
  const claimed = await claimCode({ codeId: drop.code_id, forUserId: o.writeInventory ? String(userId) : null, writeInventory: !!o.writeInventory });
  if (!claimed.ok) return claimed;
  return {
    ok: true,
    drop,
    inventoryId: claimed.inventoryId || null,
    claimedBy: o.writeInventory ? String(userId) : null,
  };
}

async function listGrants(actorType, actorId) {
  const res = await query(
    `SELECT * FROM world_reward_grants WHERE actor_type = $1 AND actor_id = $2 ORDER BY created_at DESC LIMIT 50`,
    [String(actorType), String(actorId)]
  );
  return res.rows || [];
}

module.exports = { grantToActor, grantTaskReward, claimCode, pickDrop, listGrants };
