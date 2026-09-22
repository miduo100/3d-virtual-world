/**
 * geometryAgentDesc.js — 几何体对象的「AI 描述」默认值推导（独立模块，无副作用）
 *
 * 背景（2026-09-22 用户决策）：
 *   几何体对象 365 个，名字形如 `乡村村落_1778144396568_tree_55`
 *   （`{场景}_{时间戳}_{类型词}_{序号}`，可能有 `(副本)` 后缀）。
 *   用户明确：**不做 AI 生成描述**（AI 没见过模型，只会臆测出错误信息）；
 *   几何体走「名称类型词 → 映射表」的确定性推导（名字是生成者自己写的，属事实）。
 *
 * 使用方：
 *   ① scripts/sync_agent_descriptions.js —— 存量回填（只写 NULL 行，绝不覆盖人工值）
 *   ② src/agent/agentObservationService.js —— observe 输出时兜底（覆盖将来任何创建路径，
 *      含 aiSceneGenerator 直插 world_objects 的批量化路径）
 *
 * 优先级铁律：world_objects.agent_description 非空 → 用库里的；为空 → 才用本模块推导。
 */

const MAP = require('../data/geometryDescMap.json');

const TYPE_PREFIX = 'geometry_';
// {场景}_{10位以上时间戳}_{类型词}_{序号}
const NAME_RE = /^(.+?)_\d{10,}_([A-Za-z][A-Za-z0-9]*)_\d+/;
const COPY_SUFFIX_RE = /[（(]副本[）)]\s*$/;

/** 去掉「(副本)」尾巴（复制出来的副本可能叠加多层，需循环剥） */
function stripCopySuffix(name) {
  let s = String(name || '').trim();
  let guard = 0;
  while (COPY_SUFFIX_RE.test(s) && guard++ < 20) {
    s = s.replace(COPY_SUFFIX_RE, '').trim();
  }
  return s;
}

/**
 * 解析几何体对象名称 → { scene, typeWord, index } | null
 * @param {string} rawName world_objects.name
 */
function parseGeometryName(rawName) {
  const name = stripCopySuffix(rawName);
  if (!name) return null;
  const m = name.match(NAME_RE);
  if (!m) return null;
  return { scene: m[1], typeWord: String(m[2]).toLowerCase(), index: m[3], cleaned: name };
}

/** 从 model_path 取类型词：`geometry:tree` / `geometry_building:12`（后者不是类型词） */
function typeWordFromModelPath(modelPath) {
  const p = String(modelPath || '');
  const m = p.match(/^geometry:([A-Za-z][A-Za-z0-9]*)$/);
  return m ? m[1].toLowerCase() : null;
}

/** 是否为「几何体」类对象（geometry_nature / geometry_building / ... ） */
function isGeometryType(type) {
  return typeof type === 'string' && type.startsWith(TYPE_PREFIX);
}

/**
 * 推导 AI 描述（仅几何体类型；命中不了返回 null）
 * @param {object} obj { name, type, model_path }
 * @returns {string|null}
 */
function deriveAgentDescription(obj) {
  if (!obj) return null;
  if (!isGeometryType(obj.type)) return null;

  const byWord = MAP.byTypeWord || {};
  const byName = MAP.byExactName || {};

  // ① 名称里的类型词（最权威：生成者写进名字的）
  const parsed = parseGeometryName(obj.name);
  if (parsed && byWord[parsed.typeWord]) return byWord[parsed.typeWord];

  // ② model_path 里的类型词（如 `geometry:cottage`）
  const mw = typeWordFromModelPath(obj.model_path);
  if (mw && byWord[mw]) return byWord[mw];

  // ③ 整体名字精确匹配（长方体 / 湖泊 / 中世纪城堡 / 未来塔楼 这类无类型词的名字）
  const plain = stripCopySuffix(obj.name);
  if (plain && byName[plain]) return byName[plain];

  // ④ 名字里包含某个类型词（兜底，如 `我的树tree`）
  if (plain) {
    const lower = plain.toLowerCase();
    const words = Object.keys(byWord).sort((a, b) => b.length - a.length);
    for (const w of words) {
      if (new RegExp('\\b' + w + '\\b', 'i').test(lower) || lower.includes('_' + w)) {
        return byWord[w];
      }
    }
  }
  return null;
}

/** 映射表统计（供报告/验收断言） */
function mapStats() {
  return {
    version: MAP.version || 1,
    typeWords: Object.keys(MAP.byTypeWord || {}),
    exactNames: Object.keys(MAP.byExactName || {})
  };
}

/** 断言：类型词是否都有描述（用于自检/验收） */
function validateMap() {
  const problems = [];
  const byWord = MAP.byTypeWord || {};
  for (const [k, v] of Object.entries(byWord)) {
    if (!v || typeof v !== 'string' || v.length < 4) problems.push('typeWord "' + k + '" 描述缺失或过短');
  }
  for (const [k, v] of Object.entries(MAP.byExactName || {})) {
    if (!v || typeof v !== 'string' || v.length < 4) problems.push('exactName "' + k + '" 描述缺失或过短');
  }
  return problems;
}

module.exports = {
  deriveAgentDescription,
  parseGeometryName,
  typeWordFromModelPath,
  stripCopySuffix,
  isGeometryType,
  mapStats,
  validateMap
};
