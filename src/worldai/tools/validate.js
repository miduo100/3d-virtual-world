/**
 * validate —— Tool Validation 双层校验（AI World Brain · Phase 4 · §H.3 · 判据 P3-14）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 第 1 层：JSON Schema（注册表里的 params）——基础类型/必填/范围；
 * 第 2 层：服务端严格校验——不信任 LLM 的任何输出：
 *   · 数值域（NaN / Infinity / 负数 / 超范围一律拒）
 *   · 字符串长度与白名单枚举
 *   · 引用完整性（对象/区域是否存在）在工具实现层做（OBJECT_NOT_FOUND / REGION_NOT_FOUND）
 *
 * ★ 失败返回**结构化错误**（errors[{path,message,got}] + hint），回给 LLM 允许自修 1 次
 *   （自修计数在 LLM 编排层；executor 本身不自动重试——避免无限改参数刷预算）。
 */
'use strict';

function err(path, message, got) {
  return { path, message, got: got === undefined ? null : got };
}

/** 单属性校验（schema 属性：{type, required, min, max, minLength, maxLength, enum, items}） */
function checkProp(path, v, spec, errors) {
  const t = spec.type || 'any';
  if (v === undefined || v === null) {
    if (spec.required) errors.push(err(path, '缺少必填参数', v));
    return;
  }
  if (t === 'number' || t === 'integer') {
    const n = Number(v);
    if (typeof v === 'boolean' || !Number.isFinite(n)) { errors.push(err(path, '必须是有限数值', v)); return; }
    if (t === 'integer' && !Number.isInteger(n)) { errors.push(err(path, '必须是整数', v)); return; }
    if (spec.min !== undefined && n < spec.min) errors.push(err(path, '不能小于 ' + spec.min, v));
    if (spec.max !== undefined && n > spec.max) errors.push(err(path, '不能大于 ' + spec.max, v));
    return;
  }
  if (t === 'string') {
    if (typeof v !== 'string') { errors.push(err(path, '必须是字符串', typeof v)); return; }
    if (spec.minLength !== undefined && v.length < spec.minLength) errors.push(err(path, '长度不能少于 ' + spec.minLength, v.length));
    if (spec.maxLength !== undefined && v.length > spec.maxLength) errors.push(err(path, '长度不能超过 ' + spec.maxLength, v.length));
    if (Array.isArray(spec.enum) && spec.enum.indexOf(v) < 0) errors.push(err(path, '必须是 ' + spec.enum.join('/'), v));
    return;
  }
  if (t === 'boolean') {
    if (typeof v !== 'boolean') errors.push(err(path, '必须是布尔', typeof v));
    return;
  }
  if (t === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(err(path, '必须是对象', Array.isArray(v) ? 'array' : typeof v)); return; }
    // 嵌套属性（一层足够：工具参数都不深）
    const props = spec.properties || {};
    Object.keys(props).forEach((k) => checkProp(path ? path + '.' + k : k, v[k], props[k], errors));
    return;
  }
  if (t === 'array') {
    if (!Array.isArray(v)) { errors.push(err(path, '必须是数组', typeof v)); return; }
    if (spec.maxItems !== undefined && v.length > spec.maxItems) errors.push(err(path, '元素不能超过 ' + spec.maxItems + ' 个', v.length));
    if (spec.items) v.slice(0, 50).forEach((item, i) => checkProp(path + '[' + i + ']', item, spec.items, errors));
    return;
  }
}

/**
 * 校验工具参数。
 * @returns {{ok:true}} | {ok:false, code:'ToolValidation', errors, hint}
 */
function validate(def, params) {
  const errors = [];
  const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
    errors.push(err('', '参数必须是 JSON 对象', Array.isArray(params) ? 'array' : typeof params));
  }
  const schema = def.params || {};
  const props = schema.properties || {};
  Object.keys(props).forEach((k) => checkProp(k, p[k], props[k], errors));
  if (schema.strict !== false) {
    const known = Object.keys(props);
    Object.keys(p).forEach((k) => {
      if (known.indexOf(k) < 0) errors.push(err(k, '未知参数（工具不接受该字段，请删除）', '<value>'));
    });
  }
  if (errors.length) {
    return {
      ok: false,
      code: 'ToolValidation',
      tool: def.name,
      errors: errors.slice(0, 10),
      hint: '参数校验失败：按 errors 逐条修正后重试（LLM 最多自修 1 次，防止刷预算）',
    };
  }
  return { ok: true };
}

module.exports = { validate };
