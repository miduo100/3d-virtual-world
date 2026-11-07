/**
 * templateRegistry —— 建筑模板注册表（M1-2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 职责边界（§K）：
 *   本模块是**纯只读**的。不做数据库访问、不写世界、不调 LLM。
 *   模板 = 一套「墙 + 门窗 + 楼板 + 屋顶（+ 山墙）」的可复现组合。
 *
 * 设计要点：
 *   1. 模板只存「尺寸 + 布局意图」，**不存 edges 坐标** —— 坐标由 buildSpec 按尺寸生成，
 *      避免改了 width/depth 而坐标不同步。
 *   2. capability 区分「能开洞」(enterable) 与「只能堆实心块」(blockout)：
 *      后者做出来是封闭盒子，不能当可进入建筑 —— 这是实测结论，不是猜测。
 *   3. metrics 存的是**实测值**，作为回归基准；不是设计目标。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'templates');

/** 四条边的几何骨架（相对墙中线，单位米）与中文名映射 */
const EDGE_DEFS = [
  { key: 'south', label: '南 +X', a: (w, d) => [-w / 2, -d / 2], b: (w, d) => [w / 2, -d / 2] },
  { key: 'east', label: '东 +Z', a: (w, d) => [w / 2, -d / 2], b: (w, d) => [w / 2, d / 2] },
  { key: 'north', label: '北 −X', a: (w, d) => [w / 2, d / 2], b: (w, d) => [-w / 2, d / 2] },
  { key: 'west', label: '西 −Z', a: (w, d) => [-w / 2, d / 2], b: (w, d) => [-w / 2, -d / 2] },
];

const LABEL_OF = EDGE_DEFS.reduce((m, e) => ((m[e.key] = e.label), m), {});

let _cache = null;

function loadAll() {
  if (_cache) return _cache;
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
  const list = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    list.push(raw);
  }
  _cache = list.sort((a, b) => a.id.localeCompare(b.id));
  return _cache;
}

function listTemplates() {
  return loadAll().map((t) => ({
    id: t.id, name: t.name, style: t.style, capability: t.capability,
    width: t.dimensions.width, depth: t.dimensions.depth, wallHeight: t.dimensions.wallHeight,
    pieceCount: t.metrics && t.metrics.pieceCount,
  }));
}

function getTemplate(id) {
  return loadAll().find((t) => t.id === String(id || '').trim()) || null;
}

/**
 * 把模板展开成求解器可直接消费的 SPEC（edges 坐标 + 中文边名）。
 * @param {string} id
 * @param {object} [overrides] 允许覆盖 { width, depth, wallHeight }（仅当能整除模数）
 * @returns {{ok:true, spec:object} | {ok:false, code:string, reason:string}}
 */
function buildSpec(id, overrides) {
  const t = getTemplate(id);
  if (!t) return { ok: false, code: 'TEMPLATE_NOT_FOUND', reason: '模板不存在：' + id };

  const o = overrides || {};
  const w = Number(o.width) > 0 ? Number(o.width) : t.dimensions.width;
  const d = Number(o.depth) > 0 ? Number(o.depth) : t.dimensions.depth;
  const h = Number(o.wallHeight) > 0 ? Number(o.wallHeight) : t.dimensions.wallHeight;

  const unit = Number(t.module.wallWidth) || 2;
  if (Math.abs(w % unit) > 1e-6 || Math.abs(d % unit) > 1e-6) {
    return {
      ok: false, code: 'DIM_NOT_MODULAR',
      reason: `尺寸 ${w}×${d} 不是墙件模数 ${unit}m 的整数倍（需吸附到 ${nearest(w, unit)}×${nearest(d, unit)}）`,
    };
  }

  const edges = [];
  for (const e of EDGE_DEFS) {
    const plan = t.layout[e.key];
    if (!Array.isArray(plan) || !plan.length) {
      return { ok: false, code: 'LAYOUT_MISSING', reason: '模板缺少 ' + e.key + ' 边的布局' };
    }
    const len = Math.hypot(e.b(w, d)[0] - e.a(w, d)[0], e.b(w, d)[1] - e.a(w, d)[1]);
    const need = Math.round(len / unit);
    if (need !== plan.length) {
      return {
        ok: false, code: 'LAYOUT_COUNT_MISMATCH',
        reason: `${e.label} 需 ${need} 段（${len}m ÷ ${unit}m），模板给了 ${plan.length} 段`,
      };
    }
    edges.push({ name: e.label, key: e.key, a: e.a(w, d), b: e.b(w, d), plan: plan.slice() });
  }

  return {
    ok: true,
    spec: {
      templateId: t.id,
      name: t.name,
      capability: t.capability,
      width: w, depth: d, wallHeight: h,
      pack: t.pack,
      module: Object.assign({}, t.module),
      parts: Object.assign({}, t.parts),
      edges,
      roof: Object.assign({}, t.roof),
      gable: t.gable ? Object.assign({}, t.gable) : undefined,
      doorSlot: t.doorSlot ? Object.assign({}, t.doorSlot) : undefined,
      // 楼板分层（可选）：[0, 3.125] = 地面层 + 夹层；不传 = 只铺地面（历史行为）
      floorLevels: Array.isArray(t.floorLevels) ? t.floorLevels.slice() : undefined,
      // 门只放哪一排（两层建筑用；不设 = 每排都放门，历史行为）
      doorRow: t.doorRow == null ? undefined : Number(t.doorRow),
      upperDoorSlot: t.upperDoorSlot || undefined,
    },
  };
}

/** 找最接近的模板（不修改模板尺寸，只给差距） */
function findByRequirement(req) {
  const r = req || {};
  const pool = loadAll().filter((t) => {
    if (r.capability && t.capability !== r.capability) return false;
    if (r.style && t.style !== r.style) return false;
    return true;
  });
  if (!pool.length) return { ok: false, code: 'NO_CANDIDATE', reason: '没有符合能力/风格条件的模板' };

  const scored = pool.map((t) => {
    const dw = Math.abs(t.dimensions.width - (Number(r.width) || t.dimensions.width));
    const dd = Math.abs(t.dimensions.depth - (Number(r.depth) || t.dimensions.depth));
    return { template: t, delta: dw + dd, dw, dd };
  }).sort((a, b) => a.delta - b.delta);

  const best = scored[0];
  return {
    ok: true,
    template: best.template,
    exact: best.delta < 1e-6,
    delta: { width: best.dw, depth: best.dd },
    alternatives: scored.slice(1, 3).map((s) => ({ id: s.template.id, name: s.template.name, delta: s.delta })),
    reason: best.delta < 1e-6
      ? '精确匹配'
      : `最接近：${best.template.dimensions.width}×${best.template.dimensions.depth}（差 ${best.dw}×${best.dd}m）`,
  };
}

/**
 * 模板自检（不渲染、不连数据库）：模数、段数、层高、件引用完整性。
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validate(t) {
  const errors = [];
  const warnings = [];
  const unit = Number(t.module && t.module.wallWidth);
  const ph = Number(t.module && t.module.wallPieceHeight);
  const rows = Number(t.module && t.module.rows);
  const w = Number(t.dimensions && t.dimensions.width);
  const d = Number(t.dimensions && t.dimensions.depth);
  const h = Number(t.dimensions && t.dimensions.wallHeight);

  if (!t.id) errors.push('缺 id');
  if (!['enterable', 'blockout'].includes(t.capability)) errors.push('capability 必须是 enterable | blockout');
  if (!(unit > 0)) errors.push('module.wallWidth 必须 > 0');
  if (!(w > 0) || !(d > 0)) errors.push('dimensions 宽深必须 > 0');
  if (unit > 0 && Math.abs(w % unit) > 1e-6) errors.push(`宽 ${w} 不是模数 ${unit} 的整数倍`);
  if (unit > 0 && Math.abs(d % unit) > 1e-6) errors.push(`深 ${d} 不是模数 ${unit} 的整数倍`);
  if (ph > 0 && rows > 0 && Math.abs(ph * rows - h) > 0.02) {
    errors.push(`层高 ${h} ≠ 件高 ${ph} × ${rows} 排 = ${(ph * rows).toFixed(3)}`);
  }
  if (!t.parts || !t.parts.wall) errors.push('parts.wall 必填');

  for (const e of EDGE_DEFS) {
    const plan = t.layout && t.layout[e.key];
    if (!Array.isArray(plan)) { errors.push(`layout.${e.key} 缺失`); continue; }
    const len = e.key === 'south' || e.key === 'north' ? w : d;
    const need = unit > 0 ? Math.round(len / unit) : 0;
    if (need !== plan.length) errors.push(`layout.${e.key} 需 ${need} 段，给了 ${plan.length} 段`);
    for (const slot of plan) {
      if (slot === 'wall') continue;
      if (!t.parts[slot]) warnings.push(`layout 用到槽位 ${slot}，但 parts.${slot} 未定义（该段会回落成墙）`);
    }
  }

  if (t.capability === 'enterable' && !t.parts.door) {
    warnings.push('capability=enterable 但没配 door 件，做出来没有门');
  }
  if (t.capability === 'blockout') {
    warnings.push('capability=blockout：产出为封闭体块，不可进入（这是设计定位，非缺陷）');
  }
  if (!t.metrics || t.metrics.verifiedAt == null) warnings.push('缺 metrics.verifiedAt，说明尚未实测');

  // 楼板分层（两层建筑）
  if (t.floorLevels !== undefined) {
    if (!Array.isArray(t.floorLevels) || !t.floorLevels.length) {
      errors.push('floorLevels 必须是非空数组（如 [0, 3.125]）');
    } else {
      for (const v of t.floorLevels) {
        const n = Number(v);
        if (!isFinite(n) || n < 0) errors.push(`floorLevels 含非法值 ${v}（必须是 ≥0 的数字，单位米）`);
        else if (h > 0 && n >= h) errors.push(`floorLevels 的 ${n} 不低于层高 ${h}（楼板会穿出屋顶）`);
      }
      if (t.floorLevels.map(Number).indexOf(0) < 0) {
        warnings.push('floorLevels 里没有 0 —— 地面层不铺楼板，进门会看到空洞');
      }
    }
  }

  // 多层建筑：门只放地上那排，其余排换成窗（否则二楼出现悬空门）
  const rowN = Math.max(1, Number(t.module && t.module.rows) || 1);
  // ★ 例外：kenney 那类用 doorSlot.rows 显式声明"门跨哪几排"（4 块拼一扇高门），
  //   这是有意为之，不该按"二楼悬空门"警告。
  if (rowN > 1 && t.parts && t.parts.door && !t.doorSlot) {
    if (t.doorRow == null) {
      warnings.push(`module.rows=${rowN} 但没设 doorRow —— 每排都会放门，二楼会出现悬空门`);
    } else if (Number(t.doorRow) !== 0 && Number(t.doorRow) !== rowN - 1) {
      warnings.push(`doorRow=${t.doorRow} 不是地面排（应为 0），进门会踩空`);
    }
    const up = t.upperDoorSlot || 'window';
    if (!t.parts[up]) warnings.push(`上层门位槽「${up}」在 parts 里没有对应件，会报 SLOT_PART_UNDEFINED`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** 吸附到最近模数（供尺寸策略使用：12.4 → 12） */
function nearest(v, unit) {
  const n = Number(v);
  const u = Number(unit) || 1;
  if (!Number.isFinite(n)) return u;
  return Math.max(u, Math.round(n / u) * u);
}

module.exports = {
  listTemplates, getTemplate, buildSpec, findByRequirement, validate,
  nearest, EDGE_DEFS, LABEL_OF,
};
