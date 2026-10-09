/**
 * rewardService —— 发放物品码（Phase 3.5-2 · 极简玩法，无货币）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 重要口径（3.5-2 实施中发现的缺口）：
--   player_inventory.user_id 有 FK → users(id)，而 Agent **没有 users 行**（红线：不建本地用户），
--   所以"Agent 领物品码 → player_inventory +1"字面上做不到。
--   本阶段：**只登记不发放**（写 world_reward_grants），真正进背包留给 Phase 6。
 *   幂等靠唯一键 (actor_type, actor_id, interaction_key)：重复 interact 不重复发。
 *
 * 本模块 Phase 6 会扩展成"真发放"（届时再决定是补users 行还是走真人代领），故接口保持 grantToActor。
 */
'use strict';

const { query } = require('../../database/db');

function bad(code, reason, extra) {
  return Object.assign({ ok: false, code, reason }, extra || {});
}

/**
 * 发放给某个 Actor。
 * @param {object} o { worldId, actorType:'agent'|'human', actorId, interactionId, interactionKey,
 *                     codeId?, code?, count?, regionKey? }
 */
async function grantToActor(o) {
  const p = o || {};
  if (!p.actorType || !p.actorId) return bad('ACTOR_REQUIRED', '必须给 actorType 与 actorId');
  if (!p.interactionKey) return bad('INTERACTION_KEY_REQUIRED', '缺少 interactionKey（幂等键的一环）');
  const count = Math.max(1, Math.floor(Number(p.count) || 1));
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
  const granted = !!(res.rows && res.rows.length);
  return {
    ok: true,
    granted,
    deduped: !granted,
    row: res.rows && res.rows[0] ? res.rows[0] : null,
    notice: granted ? '已登记领取（本阶段只登记不发放，见 rewardService 文件头）' : '该Actor 对此交互点已领过，不重复发（幂等）',
  };
}

async function listGrants(actorType, actorId) {
  const res = await query(
    `SELECT * FROM world_reward_grants WHERE actor_type = $1 AND actor_id = $2 ORDER BY created_at DESC LIMIT 50`,
    [String(actorType), String(actorId)]
  );
  return res.rows || [];
}

module.exports = { grantToActor, listGrants };