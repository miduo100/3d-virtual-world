/**
 * assetSelector —— 资产策略决策（AI World Brain · Phase 5 · §F.2 五层金字塔 + P4-3/P4-4）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 五层金字塔 = 4 个可用策略（L3 外部包 / L4 AI 生成 默认永不启用）：
 *   L0 整栋资产（v_all_models source='uploaded'，单体放置）
 *   L1 零件装配（part_libraries 模数拼装，composite）
 *   L2 程序化（specCompiler → geometry_buildings，兜底）
 * 选择规则：能用上层的不用下层。
 */
'use strict';

const { query } = require('../../database/db');
const tagMapper = require('./canonicalTagMapper');

/** 意图文本/标签 → v_all_models 检索（只走 v_all_models，§A.2 结论：不走 buildings 死表） */
async function searchAssets(o) {
  const opt = o || {};
  const tags = (Array.isArray(opt.tags) && opt.tags.length ? opt.tags : tagMapper.map(opt.text || ''))
    .map((t) => String(t).toLowerCase()).slice(0, 10);
  const limit = Math.min(20, Math.max(1, Math.floor(Number(opt.limit) || 8)));
  if (!tags.length) return { ok: true, tags, items: [] };
  const r = await query(
    `SELECT source, model_id, name, description, model_path, tags, category,
            (CASE WHEN tags && $1::text[] THEN 20 ELSE 0 END
             + CASE WHEN LOWER(name) ~ ANY($2::text[]) THEN 10 ELSE 0 END) AS relevance_score
       FROM v_all_models
      WHERE source = 'uploaded' AND model_path IS NOT NULL
        AND (tags && $1::text[] OR LOWER(name) ~ ANY($2::text[]))
      ORDER BY relevance_score DESC, created_at DESC
      LIMIT $3`,
    [tags, tags.map((t) => '.*' + t + '.*'), limit]
  );
  return { ok: true, tags, items: (r.rows || []).map((row) => ({
    source: row.source, modelId: row.model_id, name: row.name,
    modelPath: row.model_path, tags: row.tags, category: row.category,
    score: Number(row.relevance_score) || 0,
  })) };
}

/** 零件库按角色检索（L1 用；复用 assetSearch 的检索口径，pending_review 天然隐身） */
async function searchPartsByRoles(roles, styleFamily) {
  const assetSearch = require('../tools/assetSearch');
  const r = await assetSearch.searchParts({ roles, styleFamily, limit: 20 });
  const byRole = {};
  for (const item of (r.items || [])) {
    if (!byRole[item.role]) byRole[item.role] = [];
    byRole[item.role].push(item);
  }
  return byRole;
}

/**
 * 策略决策（L0 → L1 → L2；永不返回 L3/L4）。
 * @returns {Promise<{strategy:'asset'|'composite'|'procedural', tags:Array, asset?:object, partsByRole?:object, reason:string}>}
 */
async function decideStrategy(spec) {
  const s = spec || {};
  const text = [s.buildingType, s.name, (s.assetHints && s.assetHints.keywords) || []].flat().filter(Boolean).join(' ');
  const tags = (Array.isArray(s.assetHints && s.assetHints.preferTags) && s.assetHints.preferTags.length
    ? s.assetHints.preferTags : tagMapper.map(text)).slice(0, 10);

  // L0：库里有整栋资产 → 单体放置（复用度最高）
  const assets = await searchAssets({ tags });
  if (assets.items.length) {
    return { strategy: 'asset', tags, asset: assets.items[0], reason: '命中整栋资产（L0）：' + assets.items[0].name };
  }

  // L1：显式 composite 装配（零件库有墙+屋顶才可用）。
  // ★ 规格偏差（§J.3 已声明）：L1 不进 auto 自动链——19 个 Kenney 库常驻时 wall+roof 永远命中，
  //   auto 链里 L1 会吞掉一切降级，P4-4「无匹配 → procedural + memory」将永不触发。
  //   故 L1 装配 = 显式路径（spec.assembly='composite' 或 assemble_building 工具）；auto 链 = L0 → L2。
  if (s.assembly === 'composite') {
    const partsByRole = await searchPartsByRoles(['wall', 'roof']);
    if (partsByRole.wall && partsByRole.wall.length && partsByRole.roof && partsByRole.roof.length) {
      return { strategy: 'composite', tags, partsByRole, reason: '零件库可装配（L1）：wall×' + partsByRole.wall.length + ' roof×' + partsByRole.roof.length };
    }
  }

  // L2：程序化兜底
  return { strategy: 'procedural', tags, reason: '库中无匹配资产（L0/L1 均落空）→ 程序化兜底（L2）' };
}

module.exports = { decideStrategy, searchAssets, searchPartsByRoles };
