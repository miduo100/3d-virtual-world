/**
 * buildingSpec —— Building Spec JSON Schema + 默认值 + 校验（AI World Brain · Phase 5 · §F.2 路径3）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * Spec 是 LLM 与代码之间的唯一契约：LLM 只提意图（类型/风格/预算/seed），
 * 坐标/数量/面数由 specCompiler 按本文件的确定性规则决定（红线 3）。
 */
'use strict';

const SPEC_VERSION = 1;

const PRIMITIVES = ['box', 'sphere', 'cylinder', 'cone', 'torus'];
const ROOF_STYLES = ['flat', 'pyramid', 'gable', 'dome'];
const ENTITY_TYPES = ['building', 'prop', 'npc_host', 'quest_board', 'shop', 'zone', 'decor'];

/** 默认预算（§F.2 路径3 示例值；assetValidator 可被 spec.budget 收紧，不可放宽） */
const HARD_LIMITS = { maxTriangles: 60000, maxComponents: 400 };

/** 补默认值（返回新对象，不改入参） */
function withDefaults(spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const levels = Array.isArray(s.levels) && s.levels.length ? s.levels : [{ floors: 1, heightPerFloor: 3.2 }];
  return {
    specVersion: SPEC_VERSION,
    buildingType: String(s.buildingType || 'house'),
    purpose: String(s.purpose || 'residential'),
    footprint: {
      width: num(s.footprint && s.footprint.width, 6),
      depth: num(s.footprint && s.footprint.depth, 6),
    },
    levels: levels.map((l) => ({
      floors: Math.max(1, Math.floor(num(l.floors, 1))),
      heightPerFloor: num(l.heightPerFloor, 3.2),
    })),
    style: {
      family: String((s.style && s.style.family) || 'classic'),
      palette: Object.assign({ wall: 0xd4a373, accent: 0x87ceeb, roof: 0x8b4513 }, (s.style && s.style.palette) || {}),
      roofStyle: ROOF_STYLES.indexOf(s.style && s.style.roofStyle) >= 0 ? s.style.roofStyle : 'pyramid',
      glazing: String((s.style && s.style.glazing) || 'plain'),
    },
    openings: {
      entrances: Math.max(1, Math.floor(num(s.openings && s.openings.entrances, 1))),
      doorWidth: num(s.openings && s.openings.doorWidth, 1.2),
      windowsPerFloor: Math.max(0, Math.floor(num(s.openings && s.openings.windowsPerFloor, 4))),
      windowWidth: num(s.openings && s.openings.windowWidth, 1.2),
      sillHeight: num(s.openings && s.openings.sillHeight, 1.0),
    },
    assembly: String(s.assembly || 'auto'),
    assetHints: {
      keywords: Array.isArray(s.assetHints && s.assetHints.keywords) ? s.assetHints.keywords.map(String).slice(0, 10) : [],
      preferTags: Array.isArray(s.assetHints && s.assetHints.preferTags) ? s.assetHints.preferTags.map(String).slice(0, 10) : [],
    },
    collider: String(s.collider || 'auto'),
    budget: {
      maxTriangles: Math.min(HARD_LIMITS.maxTriangles, Math.max(100, Math.floor(num(s.budget && s.budget.maxTriangles, HARD_LIMITS.maxTriangles)))),
      maxComponents: Math.min(HARD_LIMITS.maxComponents, Math.max(1, Math.floor(num(s.budget && s.budget.maxComponents, HARD_LIMITS.maxComponents)))),
    },
    seed: Number.isFinite(Number(s.seed)) ? Math.floor(Number(s.seed)) : 20261005,
    name: String(s.name || '').slice(0, 120),
    entityType: ENTITY_TYPES.indexOf(s.entityType) >= 0 ? s.entityType : undefined,
    parts: Array.isArray(s.parts) ? s.parts.slice(0, 100) : undefined,   // 组合规格（specCompiler 消费；不能丢）
  };
}

/** 结构化校验（与 tools/validate.js 同风格：errors[{path,message,got}]） */
function validate(spec) {
  const errors = [];
  const s = spec && typeof spec === 'object' ? spec : null;
  if (!s) { errors.push(err('', 'spec 必须是 JSON 对象', s)); return { ok: false, errors, hint: HINT }; }
  if (s.specVersion !== undefined && Number(s.specVersion) !== SPEC_VERSION) {
    errors.push(err('specVersion', '只支持 ' + SPEC_VERSION, s.specVersion));
  }
  if (typeof s.buildingType !== 'string' || !s.buildingType) errors.push(err('buildingType', '必须是字符串', s.buildingType));
  if (s.entityType !== undefined && ENTITY_TYPES.indexOf(s.entityType) < 0) {
    errors.push(err('entityType', '必须是 ' + ENTITY_TYPES.join('/'), s.entityType));
  }
  const fp = s.footprint;
  if (fp !== undefined) {
    if (!fp || typeof fp !== 'object') errors.push(err('footprint', '必须是对象', fp));
    else {
      if (!isDim(fp.width)) errors.push(err('footprint.width', '必须是 0.5~200 的数值', fp.width));
      if (!isDim(fp.depth)) errors.push(err('footprint.depth', '必须是 0.5~200 的数值', fp.depth));
    }
  }
  if (s.levels !== undefined) {
    if (!Array.isArray(s.levels) || !s.levels.length) errors.push(err('levels', '必须是非空数组', s.levels));
    else s.levels.forEach((l, i) => {
      if (!l || typeof l !== 'object') errors.push(err('levels[' + i + ']', '必须是对象', l));
      else {
        if (!Number.isFinite(Number(l.floors)) || Number(l.floors) < 1 || Number(l.floors) > 30) errors.push(err('levels[' + i + '].floors', '必须是 1~30 整数', l.floors));
        if (!isDim(l.heightPerFloor) || Number(l.heightPerFloor) > 20) errors.push(err('levels[' + i + '].heightPerFloor', '必须是 0.5~20 的数值', l.heightPerFloor));
      }
    });
  }
  if (s.style !== undefined && s.style && ROOF_STYLES.indexOf(s.style.roofStyle) < 0 && s.style.roofStyle !== undefined) {
    errors.push(err('style.roofStyle', '必须是 ' + ROOF_STYLES.join('/'), s.style.roofStyle));
  }
  if (s.budget !== undefined && s.budget) {
    if (Number(s.budget.maxComponents) > HARD_LIMITS.maxComponents) errors.push(err('budget.maxComponents', '不能超过硬上限 ' + HARD_LIMITS.maxComponents, s.budget.maxComponents));
    if (Number(s.budget.maxTriangles) > HARD_LIMITS.maxTriangles) errors.push(err('budget.maxTriangles', '不能超过硬上限 ' + HARD_LIMITS.maxTriangles, s.budget.maxTriangles));
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 10), hint: HINT };
  return { ok: true, spec: withDefaults(s) };
}

const HINT = 'Building Spec 校验失败：按 errors 逐条修正（specVersion=1；footprint/levels/style/openings/budget/seed）';

function isDim(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0.5 && n <= 200;
}
function err(path, message, got) { return { path, message, got: got === undefined ? null : got }; }
function num(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }

module.exports = {
  SPEC_VERSION, PRIMITIVES, ROOF_STYLES, ENTITY_TYPES, HARD_LIMITS,
  withDefaults, validate, HINT,
};
