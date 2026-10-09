/**
 * interactionService —— 交互点判定 + 派发（Phase 3.5-2 · 仅 Agent 侧）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 3.5 文件清单「30m 内交互点判定 + 派发（仅 Agent 侧）」+ 判据 P35-15/16。
 *
 * ★ 一期口径（写进代码，避免被当成故障）：
 *   **真人玩家 interact 服务端不响应**（P35-16）——真人交互 UI 属Phase 6。
 *   后台 UI 必须写明这一点，否则管理员会以为"采集点坏了"。
 */
'use strict';

const { query } = require('../../database/db');
const rewardService = require('./rewardService');
const microQuestService = require('./microQuestService');

/** 硬上限：即便交互点 radius 配错，也不会把 30m 以外的东西当成可交互 */
const MAX_RADIUS = 30;

function dist2d(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dz = Number(a.z) - Number(b.z);
  return Math.sqrt(dx * dx + dz * dz);
}

/** 在某点附近找可交互点（≤ min(radius, 30m)） */
async function findNearby(position, opts) {
  const o = opts || {};
  const params = [Number(position.x) || 0, Number(position.z) || 0];
  let sql = `SELECT * FROM world_interactions
              WHERE enabled = true
                AND (position->>'x')::double precision IS NOT NULL
                AND abs((position->>'x')::double precision - $1) <= $3
                AND abs((position->>'z')::double precision - $2) <= $3`;
  params.push(MAX_RADIUS);
  if (o.regionKey) { params.push(String(o.regionKey)); sql += ` AND region_key = $${params.length}`; }
  sql += ` ORDER BY id LIMIT 20`;
  const res = await query(sql, params);
  const list = (res.rows || []).map((r) => {
    const p = r.position || {};
    const d = dist2d(position, { x: p.x, z: p.z });
    return {
      id: r.id, key: r.key, label: r.label, type: r.interaction_type,
      position: p, distance: Math.round(d * 100) / 100,
      radius: Math.min(Number(r.radius) || 3, MAX_RADIUS),
      reachable: d <= Math.min(Number(r.radius) || 3, MAX_RADIUS),
    };
  });
  return { ok: true, items: list, maxRadius: MAX_RADIUS };
}

/**
 * 派发一次交互。
 * @param {object} o { actorType, actorId, position, interactionKey?, worldId, regionKey? }
 */
async function interact(o) {
  const p = o || {};
  if (p.actorType !== 'agent' && p.actorType !== 'human') {
    return { ok: false, code: 'ACTOR_TYPE_INVALID', reason: 'actorType 必须是 agent 或 human' };
  }
  // Phase 6（用户拍板②）：真人交互前端 worldInteractions.js 已上线，真人路径开放；
  // 服务端判定口径与 Agent 完全一致（同一 findNearby + reachable 判定），无任何放水。
  if (!p.actorId) return { ok: false, code: 'ACTOR_REQUIRED', reason: '缺少 actorId' };
  const near = await findNearby(p.position || { x: 0, z: 0 }, { regionKey: p.regionKey });
  const target = p.interactionKey
    ? near.items.find((i) => i.key === p.interactionKey)
    : near.items.filter((i) => i.reachable)[0];
  if (!target) {
    return { ok: false, code: 'NO_INTERACTION_IN_RANGE', reason: '附近没有可交互的点（判定半径 ≤ ' + MAX_RADIUS + 'm）', nearby: near.items };
  }
  if (!target.reachable) {
    return { ok: false, code: 'TOO_FAR', reason: '距离 ' + target.distance + 'm 超出该交互点半径 ' + target.radius + 'm', nearby: near.items };
  }

  const row = await query(`SELECT * FROM world_interactions WHERE id = $1`, [target.id]);
  const it = row.rows[0];
  let reward = null;
  if (it.interaction_type === 'reward_grant') {
    const pl = it.payload || {};
    reward = await rewardService.grantToActor({
      worldId: p.worldId || it.world_id,
      actorType: p.actorType, actorId: p.actorId,
      interactionId: it.id, interactionKey: it.interaction_type + ':' + it.key,
      regionKey: it.region_key, code: pl.code || null, codeId: pl.codeId || null,
      poolKey: pl.poolKey || null,
      count: Number(pl.count) || 1,
    });
  }

  const quest = await microQuestService.advanceObjectInteract({
    worldId: p.worldId || it.world_id, actorType: p.actorType, actorId: p.actorId,
    regionKey: it.region_key, interactionKey: it.interaction_type + ':' + it.key,
  });

  return { ok: true, interaction: target, reward, quest, notice: reward && reward.deduped ? '重复 interact：奖励幂等，未重复发' : '' };
}

module.exports = { findNearby, interact, MAX_RADIUS };