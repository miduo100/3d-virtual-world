/**
 * natureKind —— nature role 内部细分（树/花卉/植物/装饰）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么存在：全库 273 件自然物全被 partClassifier 标成 nature 一个 role，
 * 树/花/岩石/篝火混在一桶——实测 forest 树种混进 campfire_logs、garden 拿不到
 * 花卉（形态上没有「花」可挑）。根治要改 partClassifier + 重导（动作大），
 * 本模块是零迁移的代码层细分：只看 part_key 命名，纯函数。
 *
 * 实测分布（2026-10-14，273 件）：
 *   tree   ~110  tree_* / Environment_PalmTree_* / *_tree
 *   flower   9  flower_*（前缀严格 ^flower_，避免误吞 cauliflower/eggplant）
 *   plant   ~25  plant_* / mushroom_* / pottedPlant / cactus / Prop_Planter
 *   decor  其余  rock/stone/cliff/grass/hill/log/campfire 等
 */
'use strict';

const RE_TREE = /(^|_)(tree|palmtree)(_|\b|$)|^tree|tree(_|$)/i;
const RE_FLOWER = /^flower[_A-Z]?/i;
const RE_PLANT = /^(plant[_/]|mushroom|potted|prop_planter|cactus|cauliflower|eggplant|pumpkin|cabbage|carrot|corn_|tomato|bush|shrub|fern|grass)/i;

/**
 * @param {string} partKey
 * @returns {'tree'|'flower'|'plant'|'decor'}
 */
function kindOf(partKey) {
  const k = String(partKey || '');
  if (RE_FLOWER.test(k)) return 'flower';
  if (RE_TREE.test(k)) return 'tree';
  if (RE_PLANT.test(k)) return 'plant';
  return 'decor';
}

/** 给 LLM 看的形态标签（拼进 PARTS 清单行；与 roof 的「形态=平板/坡屋顶」同一格式） */
function formLabel(partKey) {
  const k = kindOf(partKey);
  if (k === 'tree') return '｜形态=树（forest 槽 partKeys 用）';
  if (k === 'flower') return '｜形态=花卉（garden 槽 flower_types 用）';
  if (k === 'plant') return '｜形态=植物/灌木（garden flower_types 或散点用）';
  return '｜形态=自然装饰（岩石/草皮/杂件，点缀用）';
}

module.exports = { kindOf, formLabel };
