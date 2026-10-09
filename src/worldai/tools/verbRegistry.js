/**
 * verbRegistry —— World Tool 唯一权威注册表（AI World Brain · Phase 4 · §H.1 第 2 层）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§D.3 工具目录（七类）+ §G.4 风险分级表 + §Phase 4 文件清单。
 *
 * 三条铁律：
 *   ① **never 类工具不存在于注册表**（threejs_code.create / upload_model / raw_sql / eval）
 *      —— 不是"禁用"，是根本没有；register() 对这些名字直接抛错（纵深防御，防将来误注册）。
 *   ② 工具是**函数不是 REST 端点**（§D.1），本表不暴露 HTTP；执行唯一入口 = runtime/executor.js。
 *   ③ 风险等级来自 §G.4，high 类审批不可降级（riskGate 代码级硬约束）。
 *
 * Phase 4 注册 23 个工具（Phase 5/6 的建筑/玩法工具**将来**才进；名字占位即未知工具）：
 *   观察 8（world:observe, low）· 空间建设 9（world:build）· 数据分析 6（world:analyze, low）
 */
'use strict';

/** §G.4 never 类：不存在于注册表（register 抛错 = 双保险） */
const NEVER_TOOLS = ['threejs_code.create', 'upload_model', 'raw_sql', 'eval'];

const registry = new Map();

/**
 * 注册一个工具定义。
 * @param {object} def { name, category, risk:'low'|'medium'|'high', reversible:boolean,
 *                       scope:'world:observe'|..., summary, params:{...schema}, impl:async fn }
 */
function register(def) {
  const d = def || {};
  if (!d.name || typeof d.name !== 'string') throw new Error('verbRegistry: 工具必须有 name');
  if (NEVER_TOOLS.indexOf(d.name) >= 0) {
    throw new Error('verbRegistry: 「' + d.name + '」属 never 类工具，禁止注册（§G.4：不存在于注册表）');
  }
  if (registry.has(d.name)) throw new Error('verbRegistry: 重复注册 ' + d.name);
  if (['low', 'medium', 'high'].indexOf(d.risk) < 0) throw new Error('verbRegistry: ' + d.name + ' 风险等级必须是 low/medium/high');
  registry.set(d.name, {
    name: d.name,
    category: d.category || 'misc',
    risk: d.risk,
    reversible: d.reversible === true,
    scope: d.scope || 'world:build',
    summary: d.summary || '',
    params: d.params || { type: 'object', properties: {}, required: [] },
    guardAction: d.guardAction || null,   // 需过 ownershipGuard 的动词（null = 不碰 world_objects）
    presetTarget: d.presetTarget || null, // Phase 5：'create'=按 x/z 预设 AI 行；'entity'=按 entityId 取部件行作守卫目标
    preValidate: typeof d.preValidate === 'function' ? d.preValidate : null, // Phase 5：executor 校验层之后、impl 之前的预算闸（assetValidator）
    impl: typeof d.impl === 'function' ? d.impl : null,
  });
}

function get(name) { return registry.get(String(name || '')) || null; }
function has(name) { return registry.has(String(name || '')); }
/** 已注册工具的 LLM function calling 清单（名字/风险/参数 schema，不含实现） */
function toLLM() {
  const out = [];
  registry.forEach((d) => out.push({
    name: d.name, category: d.category, risk: d.risk, reversible: d.reversible,
    scope: d.scope, summary: d.summary, params: d.params,
  }));
  return out;
}
function size() { return registry.size; }

module.exports = { register, get, has, toLLM, size, NEVER_TOOLS };
