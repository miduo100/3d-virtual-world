/**
 * missionService —— 建设委托 CRUD + 状态机 + autonomy_snapshot 固化 + 厂商决议留痕（Phase 3.5-1）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§C.3 ㉑（含三处设计取舍）+ §H.10.2（四层路由链）。
 *
 * ★ autonomy_snapshot 为什么冗余（故意冗余）：
 *   否则管理员中途降权会让一批半成品对象留在世界里，且无法判定该保留哪部分。
 *
 * ★ provider_resolution 为什么在**创建时**就固化（判据 P35-11b）：
 *   重跑同一委托必须"同一把尺子量"，中途换家 = 对同一份 prompt 的理解漂移。
 */
'use strict';

const { query } = require('../../database/db');
const regionService = require('../regions/regionService');
const providerRouter = require('../llm/providerRouter');

const STATUSES = ['draft', 'queued', 'running', 'completed', 'failed', 'rolled_back', 'cancelled'];
const PLACEMENT_POLICY = 'avoid'; // ★ 一期唯一允许取值（§G.5 ②）

function bad(code, reason, extra) {
  return Object.assign({ ok: false, code, reason }, extra || {});
}

/** constraints 白名单 + 归一（placement_policy 强制为 'avoid'） */
function sanitizeConstraints(input) {
  const c = Object.assign({}, input || {});
  if (c.placement_policy !== undefined && String(c.placement_policy) !== PLACEMENT_POLICY) {
    return bad('PLACEMENT_POLICY_FORBIDDEN',
      "placement_policy 一期只允许 '" + PLACEMENT_POLICY + "'；replace/overwrite 不实现、不暴露参数、不出现在 UI（§G.5 ②）");
  }
  c.placement_policy = PLACEMENT_POLICY;
  if (c.max_objects !== undefined) c.max_objects = Math.max(0, Math.floor(Number(c.max_objects) || 0));
  if (c.max_tris !== undefined) c.max_tris = Math.max(0, Math.floor(Number(c.max_tris) || 0));
  if (c.max_height !== undefined) c.max_height = Math.max(0, Number(c.max_height) || 0);
  if (c.style_family !== undefined && c.style_family !== null) c.style_family = String(c.style_family);
  return { ok: true, constraints: c };
}

/**
 * 厂商决议（§H.10.2）：委托手选 → 区域默认 → 世界 provider_map → 候选链。
 * 只存 provider_id 引用，绝不存 Key（§H.10.1 铁律）。
 */
async function resolveProvider(worldId, mission, region) {
  const purpose = 'plan';
  let providerId = mission && mission.provider_id ? Number(mission.provider_id) : null;
  let source = 'mission';
  if (!providerId && region && region.preferred_provider_id) {
    providerId = Number(region.preferred_provider_id);
    source = 'region';
  }
  if (providerId) {
    const r = await providerRouter.resolve(purpose, { providerMap: { plan: providerId }, worldId });
    const resolved = r.provider ? r.provider.id : null;
    return {
      ok: !!resolved, resolutions: { plan: resolved }, byPurpose: { plan: { providerId: resolved, source: r.source, reason: r.reason } },
      source: resolved ? source : 'none', reason: r.reason,
    };
  }
  const r = await providerRouter.resolveAll(['plan', 'tool_select', 'summary'], { worldId });
  return {
    ok: !!r.byPurpose.plan.providerId,
    resolutions: r.resolutions,
    byPurpose: r.byPurpose,
    source: r.byPurpose.plan.source === 'provider_map' ? 'world' : (r.byPurpose.plan.source || 'none'),
    reason: r.byPurpose.plan.reason,
  };
}
/** 新建建设委托（= 用户说的"新建任务"） */
async function createMission(input) {
  const p = input || {};
  if (!p.regionKey) return bad('REGION_REQUIRED', '必须指定区域（regionKey）');
  if (!p.prompt || !String(p.prompt).trim()) return bad('PROMPT_REQUIRED', '必须写一句话诉求');
  if (!p.createdBy) return bad('CREATOR_REQUIRED', '建设委托必须记录发起人（管理员 username）');
  const region = await regionService.getRegion(p.worldId, p.regionKey);
  if (!region) return bad('REGION_NOT_FOUND', '区域不存在：' + p.regionKey);
  const sc = sanitizeConstraints(p.constraints);
  if (!sc.ok) return sc;

  // autonomy_snapshot：建委托那一刻的有效自主度（§C.3㉑）
  const eff = await regionService.effectiveAutonomyOf(p.worldId, p.regionKey);

  const row = {
    world_id: String(p.worldId), region_key: String(p.regionKey),
    title: String(p.title || String(p.prompt).slice(0, 40)),
    prompt: String(p.prompt),
    provider_id: p.providerId ? Number(p.providerId) : null,
  };
  const resolution = await resolveProvider(p.worldId, row, region);

  const res = await query(
    `INSERT INTO world_build_missions
       (world_id, region_key, title, prompt, constraints, budget, autonomy_snapshot, status, provider_id, provider_resolution, origin, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,'ai',$10)
     RETURNING *`,
    [row.world_id, row.region_key, row.title, row.prompt,
      JSON.stringify(sc.constraints), JSON.stringify(p.budget || {}),
      String(eff.effective || 'managed'), row.provider_id,
      JSON.stringify(Object.assign({ decidedAt: new Date().toISOString() }, resolution.byPurpose || {})),
      String(p.createdBy)]
  );
  return { ok: true, mission: res.rows[0], autonomySnapshot: eff.effective, providerResolution: resolution };
}

async function getMission(id) {
  const res = await query(`SELECT * FROM world_build_missions WHERE id = $1`, [String(id)]);
  return (res.rows && res.rows[0]) || null;
}

async function listMissions(worldId, regionKey) {
  const params = [String(worldId)];
  let sql = `SELECT * FROM world_build_missions WHERE world_id = $1`;
  if (regionKey) { params.push(String(regionKey)); sql += ` AND region_key = $2`; }
  sql += ` ORDER BY created_at DESC LIMIT 100`;
  const res = await query(sql, params);
  return res.rows || [];
}

async function setStatus(id, status, extra) {
  if (STATUSES.indexOf(String(status)) < 0) return bad('STATUS_INVALID', 'status 必须是 ' + STATUSES.join('|'));
  const res = await query(
    `UPDATE world_build_missions
        SET status = $2::varchar,
            started_at  = COALESCE(started_at,  CASE WHEN $2::varchar = 'running' THEN NOW() ELSE NULL END),
            finished_at = CASE WHEN $2::varchar IN ('completed','failed','rolled_back','cancelled') THEN NOW() ELSE finished_at END,
            executed_stats = CASE WHEN $3::jsonb IS NULL THEN executed_stats ELSE $3::jsonb END
      WHERE id = $1 RETURNING *`,
    [String(id), String(status), extra && extra.stats ? JSON.stringify(extra.stats) : null]
  );
  if (!res.rows.length) return bad('MISSION_NOT_FOUND', '委托不存在：' + id);
  return { ok: true, mission: res.rows[0] };
}

/** 写回 plan（人工可编辑后保存；执行前必须过围栏与占位校验） */
async function savePlan(id, plan) {
  const res = await query(
    `UPDATE world_build_missions SET plan = $2 WHERE id = $1 RETURNING id, plan`,
    [String(id), JSON.stringify(plan || {})]
  );
  if (!res.rows.length) return bad('MISSION_NOT_FOUND', '委托不存在：' + id);
  return { ok: true, plan: res.rows[0].plan };
}

module.exports = {
  STATUSES,
  PLACEMENT_POLICY,
  sanitizeConstraints,
  resolveProvider,
  createMission,
  getMission,
  listMissions,
  setStatus,
  savePlan,
};