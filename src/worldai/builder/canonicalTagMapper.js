/**
 * canonicalTagMapper —— 中文意图 → 规范标签（AI World Brain · Phase 5 · §A.2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§A.2「modelMatcher.extractKeywords 按空格切中文 → 近乎失效」
 * → World AI 专用小模块："市政厅" → ['civic','government']。
 *
 * 设计：封闭词表（词典查表，不猜），命中即加标签；未命中词原样透传（ASCII 词）。
 * partRole 映射供 assetSelector 打分与 buildingTools 的 part_role 校验用。
 */
'use strict';

/** 中文/英文意图 → 规范标签（purpose 级） */
const TAG_MAP = [
  ['市政厅', ['civic', 'government', 'public']],
  ['政府', ['civic', 'government']],
  ['议会', ['civic', 'government']],
  ['法院', ['civic', 'government']],
  ['住宅', ['residential']],
  ['房子', ['residential', 'house']],
  ['房屋', ['residential', 'house']],
  ['公寓', ['residential', 'apartment']],
  ['别墅', ['residential', 'house']],
  ['小屋', ['residential', 'cottage']],
  ['农舍', ['residential', 'cottage', 'farm']],
  ['商店', ['commerce', 'shop']],
  ['商场', ['commerce', 'shop']],
  ['市场', ['commerce', 'market']],
  ['超市', ['commerce', 'shop']],
  ['餐厅', ['commerce', 'dining']],
  ['咖啡', ['commerce', 'dining']],
  ['酒馆', ['commerce', 'dining']],
  ['旅馆', ['commerce', 'inn']],
  ['银行', ['commerce', 'bank', 'civic']],
  ['办公', ['office']],
  ['写字楼', ['office']],
  ['大楼', ['office', 'building']],
  ['大厦', ['office', 'building']],
  ['工厂', ['industrial', 'factory']],
  ['仓库', ['industrial', 'warehouse']],
  ['车间', ['industrial', 'factory']],
  ['学校', ['education', 'school']],
  ['学院', ['education', 'school']],
  ['大学', ['education', 'school']],
  ['图书馆', ['education', 'cultural']],
  ['博物馆', ['cultural', 'museum']],
  ['医院', ['civic', 'hospital']],
  ['车站', ['transport', 'station']],
  ['教堂', ['cultural', 'temple']],
  ['城堡', ['castle', 'medieval']],
  ['城墙', ['castle', 'wall']],
  ['塔', ['tower']],
  ['灯塔', ['tower', 'landmark']],
  ['水井', ['well', 'prop']],
  ['桥', ['bridge']],
  ['围栏', ['fence']],
  ['树', ['nature', 'tree']],
  ['森林', ['nature', 'forest']],
  ['岩石', ['nature', 'rock']],
  ['石头', ['nature', 'rock']],
  ['花', ['nature', 'flower']],
  ['花园', ['nature', 'garden']],
  ['公园', ['nature', 'park']],
  ['湖', ['nature', 'lake']],
  ['路灯', ['light', 'street']],
  ['喷泉', ['landmark', 'fountain']],
  ['雕像', ['landmark', 'statue']],
  ['纪念碑', ['landmark', 'monument']],
  ['车库', ['industrial', 'garage']],
  ['警局', ['civic', 'government']],
  ['消防', ['civic', 'government']],
  ['邮局', ['civic', 'public']],
];

/** part_role 词表（world_entity_parts.part_role 白名单，§C.3⑧） */
const PART_ROLES = ['wall', 'roof', 'door', 'window', 'column', 'light', 'sign', 'trim',
  'floor', 'stairs', 'fence', 'prop', 'nature', 'base'];

/** 中文词 → part_role（装配规格用） */
const ROLE_MAP = [
  ['墙', 'wall'], ['wall', 'wall'],
  ['顶', 'roof'], ['檐', 'roof'], ['roof', 'roof'],
  ['门', 'door'], ['door', 'door'],
  ['窗', 'window'], ['window', 'window'],
  ['柱', 'column'], ['column', 'column'],
  ['灯', 'light'], ['light', 'light'],
  ['招牌', 'sign'], ['牌', 'sign'], ['sign', 'sign'],
  ['线脚', 'trim'], [' trim', 'trim'], ['trim', 'trim'],
  ['地板', 'floor'], ['地砖', 'floor'], ['floor', 'floor'],
  ['梯', 'stairs'], ['stairs', 'stairs'],
  ['栏', 'fence'], ['fence', 'fence'],
  ['树', 'nature'], ['tree', 'nature'], ['岩', 'nature'], ['nature', 'nature'],
  ['底座', 'base'], ['基座', 'base'], ['base', 'base'],
];

/**
 * 文本 → 规范标签数组（去重、保序）。
 * 未命中任何中文词时，把文本里 ASCII 连续段作为透传标签（供 v_all_models ILIKE 兜底）。
 */
function map(text) {
  const s = String(text || '');
  const tags = [];
  for (const [word, mapped] of TAG_MAP) {
    if (s.indexOf(word) >= 0) {
      for (const t of mapped) if (tags.indexOf(t) < 0) tags.push(t);
    }
  }
  if (!tags.length) {
    const ascii = s.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) || [];
    for (const a of ascii.slice(0, 5)) if (tags.indexOf(a) < 0) tags.push(a);
  }
  return tags;
}

/** 文本（如 "南墙 wall_south"）→ part_role；未命中返回 'prop' */
function mapRole(text) {
  const s = String(text || '').toLowerCase();
  for (const [word, role] of ROLE_MAP) {
    const w = word.trim();
    if (w && s.indexOf(w.toLowerCase()) >= 0) return role;
  }
  return 'prop';
}

module.exports = { map, mapRole, TAG_MAP, PART_ROLES };
