/**
 * goalService —— 世界目标 CRUD（AI World Brain · Phase 3 · §C.3②）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 */
'use strict';

const { query } = require('../../database/db');

function bad(code, reason) { return { ok: false, code, reason }; }

/** 唯一主目标：置 primary 时取消其他 primary */
async function createGoal(o) {
  const p = o || {};
  if (!p.worldId) return bad('WORLD_REQUIRED', '缺少 worldId');
  const title = String(p.title || '').trim();
  if (title.length < 2 || title.length > 200) return bad('TITLE_INVALID', '标题 2~200 字');
  const arr = (v) => Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20) : [];
  if (p.isPrimary) await query(`UPDATE world_goals SET is_primary = false WHERE world_id = $1`, [String(p.worldId)]);
  const res = await query(
    `INSERT INTO world_goals (world_id, title, vision, hard_rules, soft_prefs, is_primary, source, approved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [String(p.worldId), title, p.vision ? String(p.vision).slice(0, 5000) : null,
      arr(p.hardRules), arr(p.softPrefs), !!p.isPrimary,
      ['human', 'ai_proposal'].indexOf(p.source) >= 0 ? p.source : 'human', p.approvedBy || null]
  );
  return { ok: true, goal: res.rows[0] };
}

async function listGoals(worldId) {
  const res = await query(`SELECT * FROM world_goals WHERE world_id = $1 ORDER BY is_primary DESC, created_at DESC`, [String(worldId)]);
  return { ok: true, goals: res.rows || [] };
}

async function getGoal(worldId, id) {
  const res = await query(`SELECT * FROM world_goals WHERE world_id = $1 AND id = $2`, [String(worldId), String(id)]);
  return res.rows[0] || null;
}

/** 人工编辑目标（P2-4「改目标」） */
async function updateGoal(worldId, id, patch) {
  const cur = await getGoal(worldId, id);
  if (!cur) return bad('GOAL_NOT_FOUND', '目标不存在');
  const p = patch || {};
  const arr = (v) => Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20) : null;
  if (p.isPrimary) await query(`UPDATE world_goals SET is_primary = false WHERE world_id = $1`, [String(worldId)]);
  const res = await query(
    `UPDATE world_goals SET
       title       = COALESCE($3, title),
       vision      = COALESCE($4, vision),
       hard_rules  = COALESCE($5, hard_rules),
       soft_prefs  = COALESCE($6, soft_prefs),
       is_primary  = CASE WHEN $7::boolean IS NULL THEN is_primary ELSE $7::boolean END,
       updated_at  = NOW()
     WHERE world_id = $1 AND id = $2 RETURNING *`,
    [String(worldId), String(id),
      p.title !== undefined ? String(p.title).trim().slice(0, 200) || null : null,
      p.vision !== undefined ? String(p.vision || '').slice(0, 5000) : null,
      p.hardRules !== undefined ? arr(p.hardRules) : null,
      p.softPrefs !== undefined ? arr(p.softPrefs) : null,
      p.isPrimary === undefined ? null : !!p.isPrimary]
  );
  return { ok: true, goal: res.rows[0] };
}

module.exports = { createGoal, listGoals, getGoal, updateGoal };
