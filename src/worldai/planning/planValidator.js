/**
 * planValidator —— Plan JSON 校验（AI World Brain · Phase 3）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：§Phase 3 文件清单「Plan JSON Schema + 数值域 + 引用完整性」。
 * 只校验结构，不碰工具语义（工具注册表属 Phase 4）。
 */
'use strict';

const purposePrimitives = require('./purposePrimitives');

const RISKS = ['low', 'medium', 'high'];
const PHASE_COUNT = 5;                 // §Phase 3：AI 生成 5 阶段规划
const MAX_STEPS = 40;
const TOOL_NAME_RE = /^[a-z][a-z0-9_.]{2,59}$/;

/** LLM 输出 Plan JSON 的形状（worldPlanner 的 jsonSchema 与这里同源） */
const PLAN_JSON_SCHEMA = {
  name: 'world_plan',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      overview: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' } },
      phases: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            no: { type: 'integer' },
            title: { type: 'string' },
            purpose: { type: 'string' },
            dependsOn: { type: 'array', items: { type: 'string' } },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tool_name: { type: 'string' },
                  params: { type: 'object' },
                  rationale: { type: 'string' },
                  expected_effect: { type: 'object' },
                  risk_tier: { type: 'string' },
                },
                required: ['tool_name', 'params'],
              },
            },
          },
          required: ['title', 'purpose', 'steps'],
        },
      },
    },
    required: ['title', 'phases'],
  },
};

/**
 * 校验并归一 LLM 产物。@returns {ok, plan?|{title,summary,overview,risks,phases}, errors[]}
 * phases: [{no,title,purpose,dependsOn,steps:[{seq,tool_name,params,rationale,expected_effect,risk_tier}]}]
 */
function validate(raw) {
  const errors = [];
  const title = String(raw && raw.title || '').trim();
  if (title.length < 2 || title.length > 200) errors.push('title 需 2~200 字');
  const phasesIn = Array.isArray(raw && raw.phases) ? raw.phases : [];
  if (phasesIn.length !== PHASE_COUNT) errors.push('必须是 ' + PHASE_COUNT + ' 个阶段（当前 ' + phasesIn.length + '）');

  const phases = [];
  let stepTotal = 0;
  (phasesIn.length > PHASE_COUNT ? phasesIn.slice(0, PHASE_COUNT) : phasesIn).forEach((ph, i) => {
    const no = i + 1;
    const purpose = String(ph.purpose || '').trim();
    const stepsIn = Array.isArray(ph.steps) ? ph.steps : [];
    const steps = [];
    stepsIn.forEach((st, j) => {
      const tool = String(st.tool_name || '').trim();
      if (!TOOL_NAME_RE.test(tool)) { errors.push('阶段' + no + ' 第' + (j + 1) + '步 tool_name 非法: ' + tool.slice(0, 40)); return; }
      if (!st.params || typeof st.params !== 'object' || Array.isArray(st.params)) { errors.push('阶段' + no + ' 第' + (j + 1) + '步 params 必须是对象'); return; }
      const risk = RISKS.indexOf(String(st.risk_tier || 'low')) >= 0 ? String(st.risk_tier) : 'low';
      if (stepTotal >= MAX_STEPS) { errors.push('步骤总数超上限 ' + MAX_STEPS + '（已截断）'); return; }
      stepTotal++;
      steps.push({
        seq: j + 1,
        tool_name: tool,
        params: st.params,
        rationale: st.rationale ? String(st.rationale).slice(0, 500) : null,
        expected_effect: st.expected_effect && typeof st.expected_effect === 'object' ? st.expected_effect : null,
        risk_tier: risk,
      });
    });
    phases.push({
      no,
      title: String(ph.title || ('阶段 ' + no)).slice(0, 120),
      purpose,
      dependsOn: Array.isArray(ph.dependsOn) ? ph.dependsOn.map(String).slice(0, 5) : (purposePrimitives.PRIMITIVES.find((x) => x.key === purpose) || { dependsOn: [] }).dependsOn,
      steps,
    });
  });

  if (errors.length) return { ok: false, errors };

  // 引用完整性：目的原语封闭词表 + 前置依赖序
  const deps = purposePrimitives.depsSatisfied(phases);
  if (!deps.ok) errors.push(deps.error);
  if (!stepTotal) errors.push('规划里没有任何可执行步骤');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    plan: {
      title,
      summary: raw.summary ? String(raw.summary).slice(0, 2000) : null,
      overview: raw.overview ? String(raw.overview).slice(0, 5000) : null,
      risks: Array.isArray(raw.risks) ? raw.risks.map(String).slice(0, 10) : [],
      phases,
    },
    stats: { phases: phases.length, steps: stepTotal },
  };
}

module.exports = { validate, PLAN_JSON_SCHEMA, RISKS, PHASE_COUNT, MAX_STEPS };
