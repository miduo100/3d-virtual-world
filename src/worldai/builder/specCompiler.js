/**
 * specCompiler —— spec → components[]（AI World Brain · Phase 5 · ★§F.2 唯一必须新建的核心抽象）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * geometryBuilder（22 模板 + buildFromSpec）是它的后端；本文件负责：
 *   ① 通用 Building Spec（footprint/levels/style/openings）→ geometryBuilder.buildFromSpec
 *   ② 显式 spec.parts[]（templateId+params，可 repeat 展开）→ 逐 part 生成并合并 components
 *   ③ 确定性：随机项只走 geometryBuilder.seededRandom（禁 Math.random；P4-1/P4-2）
 * 预算校验不在这里（assetValidator 在 executor 校验层之后、impl 之前统一把关）。
 */
'use strict';

const geometryBuilder = require('../../services/geometryBuilder');

/** repeat 展开：{axis:'x'|'y'|'z', count, step} → 副本偏移（确定性） */
function expandRepeat(part) {
  const r = part && part.repeat;
  if (!r || !Number.isFinite(Number(r.count)) || Number(r.count) <= 1) return [part];
  const axis = ['x', 'y', 'z'].indexOf(String(r.axis)) >= 0 ? String(r.axis) : 'x';
  // ★ 编译期只防爆炸（1000）；400 预算由 assetValidator 在 preValidate 统一 DENY（P4-9）
  const count = Math.min(1000, Math.max(1, Math.floor(Number(r.count))));
  const step = Number(r.step) || 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    const pos = Object.assign({}, part.position || {});
    pos[axis] = (Number(pos[axis]) || 0) + step * i;
    out.push(Object.assign({}, part, {
      position: pos,
      partKey: count > 1 ? (String(part.partKey || 'part') + '_' + (i + 1)) : String(part.partKey || 'part'),
    }));
  }
  return out;
}

/** 单 part（templateId）→ { name, components }；params 注入 seed（模板忽略 seed 也不影响编译本身） */
function compileTemplatePart(part, seed) {
  const tpl = String(part.templateId || '');
  const params = Object.assign({}, part.params || {}, { seed });
  const built = geometryBuilder.generateBuilding(tpl, params);   // 未知模板会 throw → 上层接成结构化错误
  return built;
}

/**
 * 编译 spec → components[]。
 * @returns {{ok:true, name, components:Array, meta:{compCount, trisEstimate, seed, mode}}}
 *          | {ok:false, code, errors:[{path,message,got}], hint}
 */
function compile(spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const seed = Number.isFinite(Number(s.seed)) ? Math.floor(Number(s.seed)) : 20261005;
  try {
    // ① 显式 parts（组合规格，整体编译为一个 components 集合）
    if (Array.isArray(s.parts) && s.parts.length) {
      const bad = s.parts.find((p) => !p || !p.templateId);
      if (bad !== undefined) {
        return { ok: false, code: 'SPEC_COMPILE', errors: [{ path: 'parts', message: '组合 part 缺 templateId', got: (bad && bad.partKey) || null }], hint: '组合模式每个 part 必须给 templateId（assetKey 走 assemble_building 装配路径）' };
      }
      const components = [];
      const name = String(s.name || s.buildingType || '组合建筑');
      s.parts.forEach((raw) => {
        for (const part of expandRepeat(raw)) {
          const built = compileTemplatePart(part, seed);
          const off = part.position || {};
          for (const c of (built.components || [])) {
            const cc = Object.assign({}, c);
            if (cc.position) {
              cc.position = {
                x: (Number(cc.position.x) || 0) + (Number(off.x) || 0),
                y: (Number(cc.position.y) || 0) + (Number(off.y) || 0),
                z: (Number(cc.position.z) || 0) + (Number(off.z) || 0),
              };
            }
            components.push(cc);
          }
        }
      });
      if (!Array.isArray(components)) return components; // 上面的结构化错误提前返回
      const assetValidator = require('./assetValidator');
      const stats = { compCount: components.length, tris: components.reduce((n, c) => n + assetValidator.triEstimate(c), 0) };
      return { ok: true, name, components, meta: Object.assign({ seed, mode: 'parts' }, stats) };
    }
    // ② 通用规格（footprint/levels/style/openings）→ buildFromSpec
    const built = geometryBuilder.buildFromSpec(s);
    const assetValidator = require('./assetValidator');
    const stats = { compCount: built.components.length, tris: built.components.reduce((n, c) => n + assetValidator.triEstimate(c), 0) };
    return { ok: true, name: built.name, components: built.components, meta: Object.assign({ seed, mode: 'generic' }, stats) };
  } catch (e) {
    return {
      ok: false, code: 'SPEC_COMPILE',
      errors: [{ path: 'parts.templateId', message: String(e && e.message).slice(0, 200), got: null }],
      hint: '编译失败：检查 templateId 是否在 geometryBuilder.getTemplateSchema() 内',
    };
  }
}

/** 模板参数清单（LLM 生成 spec.parts 前先读它） */
function getTemplateSchema() {
  return geometryBuilder.getTemplateSchema();
}

module.exports = { compile, getTemplateSchema, expandRepeat };
