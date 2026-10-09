/**
 * regionService —— 区域 CRUD + 有效自主度计算 + 人工资产清单（Phase 3.5-1）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§C.3 ⑩ + §I.3（三档自主度）+ §Phase 3.5 文件清单。
 *
 * ★ 有效自主度 = min(world_ai_configs.autonomy, world_regions.autonomy)
 *   两级同枚举同序（managed 1 < semi_autonomous 2 < autonomous 3），直接序比较，无映射歧义。
 *   **不设"平台默认档"** —— 每块地的松紧必须由管理员显式选择。
 *
 * ★ autonomy 必填（P35-1）：DB 列刻意无 DEFAULT，API 层强校验"请求体必须含且属于三档"，
 *   否则 400。UI 不预选是为了让管理员真的做一次选择。
 */
'use strict';

const { query } = require('../../database/db');
const guard = require('../tools/ownershipGuard');
const boundsGuard = require('./boundsGuard');
const worldAiConfig = require('../config');

const AUTONOMIES = ['managed', 'semi_autonomous', 'autonomous'];

function bad(code, reason, extra) {
  return Object.assign({ ok: false, code, reason }, extra || {});
}

/** 有效自主度：世界级 × 区域级取更严 */
function effectiveAutonomy(worldAutonomy, regionAutonomy) {
  const w = guard.AUTONOMY_ORDER[worldAutonomy] || 0;
  const r = guard.AUTONOMY_ORDER[regionAutonomy] || 0;
  if (!w) return regionAutonomy || null;
  if (!r) return worldAutonomy;
  return w <= r ? worldAutonomy : regionAutonomy;
}

async function createRegion(input) {
  const p = input || {};
  if (!p.regionKey || !/^[a-z0-9_]{2,60}$/.test(String(p.regionKey))) {
    return bad('REGION_KEY_INVALID', 'regionKey 必须是 2~60 位小写字母/数字/下划线（人类可读机器名，如 east_cafe_block）');
  }
  if (!p.name) return bad('NAME_REQUIRED', '区域必须有名字');
  // ★ P35-1：autonomy 必须显式给
  if (p.autonomy === undefined || p.autonomy === null || p.autonomy === '') {
    return bad('AUTONOMY_REQUIRED', '必须显式选择自主度（managed / semi_autonomous / autonomous）—— UI 不预选，缺省即视为未做选择');
  }
  if (AUTONOMIES.indexOf(String(p.autonomy)) < 0) {
    return bad('AUTONOMY_INVALID', 'autonomy 必须是 managed / semi_autonomous / autonomous 之一');
  }
  const nb = boundsGuard.normalizeBounds(p.bounds);
  if (!nb.ok) return bad(nb.code, nb.reason);
  if (String(p.autonomy) === 'autonomous' && !String(p.notes || '').trim()) {
    return bad('NOTES_REQUIRED', '选 autonomous 必须填授权理由（审计追溯，§I.3）');
  }
  const res = await query(
    `INSERT INTO world_regions
       (region_key, world_id, name, purpose, bounds, autonomy, gridsnap, constraints, gameplay, tags, notes, preferred_provider_id, origin, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ai',$13)
     RETURNING *`,
    [String(p.regionKey), String(p.worldId || ''), String(p.name), p.purpose || null,
      JSON.stringify(nb.bounds), String(p.autonomy),
      JSON.stringify(p.gridsnap || {}), JSON.stringify(p.constraints || {}),
      JSON.stringify(p.gameplay || {}), Array.isArray(p.tags) ? p.tags : [],
      p.notes || null, p.preferredProviderId ? Number(p.preferredProviderId) : null,
      String(p.createdBy || 'admin')]
  );
  return { ok: true, region: res.rows[0] };
}
async function listRegions(worldId) {
  const res = await query(
    `SELECT * FROM world_regions WHERE world_id = $1 AND status <> 'sealed' ORDER BY created_at DESC`,
    [String(worldId)]
  );
  return res.rows || [];
}

async function getRegion(worldId, regionKey) {
  const res = await query(
    `SELECT * FROM world_regions WHERE world_id = $1 AND region_key = $2`,
    [String(worldId), String(regionKey)]
  );
  return (res.rows && res.rows[0]) || null;
}

/** 调自主度（调严立即生效；执行中的委托按 autonomy_snapshot 跑完） */
async function setAutonomy(worldId, regionKey, autonomy, notes) {
  if (AUTONOMIES.indexOf(String(autonomy)) < 0) return bad('AUTONOMY_INVALID', 'autonomy 必须是三档之一');
  const res = await query(
    `UPDATE world_regions
        SET autonomy = $3,
            notes = CASE WHEN $4::text IS NULL THEN notes ELSE $4 END,
            updated_at = NOW()
      WHERE world_id = $1 AND region_key = $2 RETURNING *`,
    [String(worldId), String(regionKey), String(autonomy), notes === undefined ? null : notes]
  );
  if (!res.rows.length) return bad('REGION_NOT_FOUND', '区域不存在：' + regionKey);
  return { ok: true, region: res.rows[0] };
}

async function deleteRegion(worldId, regionKey) {
  const aiLeft = await query(
    `SELECT count(*)::int AS n FROM world_objects WHERE region_id = $1 AND origin = 'ai'`,
    [String(regionKey)]
  );
  const n = aiLeft.rows[0].n;
  if (n > 0) {
    return bad('REGION_NOT_EMPTY', '区域内还有 ' + n + ' 个 AI 产物，请先「一键回滚本批」再删区域（防误删留下无主资产）', { aiObjects: n });
  }
  const res = await query(
    `DELETE FROM world_regions WHERE world_id = $1 AND region_key = $2 RETURNING region_key`,
    [String(worldId), String(regionKey)]
  );
  if (!res.rows.length) return bad('REGION_NOT_FOUND', '区域不存在：' + regionKey);
  return { ok: true, deleted: res.rows[0].region_key };
}

/**
 * 区域内已有资产（判据 P35-17）：后台展示"AI 不能碰这些"。
 * 按空间窗口取（不按 region_id）：既有 1127 行人工资产的 region_id 全是 NULL，
 * 只按 region_id 查会把它们全部漏掉，管理员就看不到真正的保护区。
 */
async function existingAssets(worldId, regionKey) {
  const region = await getRegion(worldId, regionKey);
  if (!region) return { ok: false, code: 'REGION_NOT_FOUND', reason: '区域不存在：' + regionKey };
  const rows = await boundsGuard.loadObstacles(region.bounds, { pad: 4 });
  const list = rows.map((r) => ({
    id: r.id, name: r.name, type: r.type, origin: r.origin || 'human',
    position: { x: r.position_x, y: r.position_y, z: r.position_z },
    aiOwned: r.origin === 'ai',
  }));
  const human = list.filter((x) => x.origin !== 'ai');
  return {
    ok: true,
    regionKey,
    total: list.length,
    humanCount: human.length,
    aiCount: list.length - human.length,
    humanAssets: human,
    all: list,
    notice: '以上人工资产受§C.2 用户红线保护：AI 只读，不能移动/缩放/旋转/删除',
  };
}

/** 世界级 × 区域级 → 有效自主度 */
async function effectiveAutonomyOf(worldId, regionKey) {
  let worldAutonomy = null;
  try {
    const cfg = await worldAiConfig.getConfig(worldId);
    worldAutonomy = cfg && cfg.autonomy;
  } catch (e) { worldAutonomy = null; }
  const region = await getRegion(worldId, regionKey);
  if (!region) return { ok: false, code: 'REGION_NOT_FOUND', reason: '区域不存在：' + regionKey };
  return { ok: true, worldAutonomy, regionAutonomy: region.autonomy, effective: effectiveAutonomy(worldAutonomy, region.autonomy) };
}

module.exports = {
  AUTONOMIES,
  createRegion,
  listRegions,
  getRegion,
  setAutonomy,
  deleteRegion,
  existingAssets,
  effectiveAutonomy,
  effectiveAutonomyOf,
};