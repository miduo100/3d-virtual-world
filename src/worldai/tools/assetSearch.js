/**
 * assetSearch —— 零件库检索（Phase 3.5-2 · 只读工具，判据 P35-13）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§D.3 ①（search_assets 为只读工具，不计入写权限）+ §Phase 3.5 判据 P35-13。
 *
 * 为什么单独成文件（§K.3 提取法）：检索口径（style_family 优先、role 过滤、pending_review 隐身）
 * 是"事实"，planner 与后台都要用，不能各写一份 SQL 出现两种答案。
 *
 * ★ 硬约束：只返回 status='active' 的库 —— pending_review 对 AI **完全隐身**（§C.3⑲）。
 */
'use strict';

const { query } = require('../../database/db');

const DEFAULT_LIMIT = 12;

function arr(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * 按 role / style_family / 关键字检索零件。
 * @param {object} o { roles:[], forbidRoles:[], styleFamily, keyword, limit, worldId }
 * @returns {Promise<{ok:boolean, items:Array, total:number, notice:string}>}
 */
async function searchParts(o) {
  const opt = o || {};
  const roles = arr(opt.roles).map(String);
  const forbid = arr(opt.forbidRoles).map(String);
  const limit = Math.min(50, Math.max(1, Number(opt.limit) || DEFAULT_LIMIT));
  const params = [];
  const where = [`l.status = 'active'`, `l.deleted_at IS NULL`];
  if (roles.length) { params.push(roles); where.push(`i.part_role = ANY($${params.length})`); }
  if (forbid.length) { params.push(forbid); where.push(`NOT (i.part_role = ANY($${params.length}))`); }
  if (opt.styleFamily) { params.push(String(opt.styleFamily)); where.push(`l.style_family = $${params.length}`); }
  if (opt.packs && (Array.isArray(opt.packs) ? opt.packs : [opt.packs]).length) {
    params.push((Array.isArray(opt.packs) ? opt.packs : [opt.packs]).map(String));
    where.push(`l.pack_key = ANY($${params.length})`);
  }
  if (opt.keyword) {
    params.push('%' + String(opt.keyword) + '%');
    where.push(`(i.part_key ILIKE $${params.length} OR i.part_subtype ILIKE $${params.length})`);
  }
  params.push(limit);
  // ★ 按库轮转采样（round-robin）：每个库先各出 1 件再进入第二轮，防止单一大库
  //   （如 302 件的 road_tiles）按 id 顺序霸占全部候选——曾实测 24 个候选全是
  //   roadTile_001~024，LLM 无墙无门可用只能编造键名 → 全部 unknownPart → 0 块/0 件。
  //   有明确 roles/style/keyword 过滤时过滤条件已收窄，轮转同样适用且无害。
  const res = await query(
    `SELECT part_key, part_role, part_subtype, grid_w, grid_h, grid_d,
            collidable, stack_rule, repeat_allowed, metadata,
            metadata->'ldraw'->>'title' AS ldraw_title,
            pack_key, style_family, priority, model_path
       FROM (
         SELECT i.part_key, i.part_role, i.part_subtype, i.grid_w, i.grid_h, i.grid_d,
                i.collidable, i.stack_rule, i.repeat_allowed, i.metadata,
                l.pack_key, l.style_family, l.priority, u.path AS model_path,
                row_number() OVER (PARTITION BY l.id ORDER BY i.id) AS rn
           FROM part_library_items i
           JOIN part_libraries l ON l.id = i.library_id
           JOIN uploaded_models u ON u.id = i.model_id
          WHERE ${where.join(' AND ')}
       ) t
      ORDER BY t.rn ASC, t.priority ASC, t.pack_key ASC
      LIMIT $${params.length}`,
    params
  );
  // ★ grid 兜底不能用 `|| 1`（2026-10-12）：零厚度平板（Roof_2x2 / floor / top，实测 12 件）
  //   的 grid_h 就是 0，`0 || 1` 会把它抬成 1 → prompt 里 AI 看到"2×1×2"，分不清这是平板
  //   还是高屋顶，直接导致"坡屋顶/平板"引导失效（AI 以为 Roof_2x2 就是高屋顶）。
  const numOr = (v, d) => { const n = Number(v); return (isFinite(n) && n >= 0) ? n : d; };
  const items = (res.rows || []).map((r) => ({
    partKey: r.part_key,
    // ★ LDraw 编号件（3001 等）的语义名（"Brick 2 x 4"）——编号本身对 AI 无意义，
    //   不透出 title 它永远挑不出乐高件（2026-10-15）
    title: r.ldraw_title || null,
    role: r.part_role,
    subtype: r.part_subtype,
    grid: [numOr(r.grid_w, 1), numOr(r.grid_h, 1), numOr(r.grid_d, 1)],
    pack: r.pack_key,
    styleFamily: r.style_family,
    modelPath: r.model_path,
    tris: r.metadata && r.metadata.tris ? r.metadata.tris : null,
  }));
  return {
    ok: true,
    items,
    total: items.length,
    notice: '只返回 status=active 的库；pending_review 对 AI 完全隐身',
  };
}

/** 按 partKey 精确取（planner 校验产物用；不存在即视为非法引用） */
async function getPart(partKey) {
  const res = await query(
    `SELECT i.part_key, i.part_role, i.grid_w, i.grid_h, i.grid_d, u.path AS model_path
       FROM part_library_items i
       JOIN part_libraries l ON l.id = i.library_id
       JOIN uploaded_models u ON u.id = i.model_id
      WHERE i.part_key = $1 AND l.status = 'active' AND l.deleted_at IS NULL
      LIMIT 1`,
    [String(partKey)]
  );
  return (res.rows && res.rows[0]) || null;
}

module.exports = { searchParts, getPart, DEFAULT_LIMIT };