/**
 * monthlyQuestion —— 月报方向性问题的 LLM 生成（AI World Brain · Phase 7b 遗留① · §I.6）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * §I.6：月报必须携带 ≥1 个方向性问题（每月至少一次人机纠偏）。
 * 设计三条纪律：
 *   1) **问题恒在**：确定性模板（fallbackQuestion）兜底 —— 30 天未答自动暂停的机制
 *      绝不能因 LLM 失效而失效；
 *   2) **失败不静默**：LLM 失败时 note 写明原因，随月报落库（后台 questionSource=llm |
 *      fallback 可见），与周计划的 flagged 同款口径；
 *   3) **零旁路**：LLM 必经 promptBuilder（purpose='summary'）+ providerRouter + llmClient
 *      （落 ai_call_log，accountable）。
 *
 * ★ 显式开关：generateMonthlyReport 只有在 opts.llmQuestion=true（runMonthlyTick / 后台补跑
 *   月报）才走 LLM —— 直接调用（phase7b 既有 31 判据、验收裸调）维持纯确定性路径不变。
 */
'use strict';

const promptBuilder = require('../llm/promptBuilder');
const providerRouter = require('../llm/providerRouter');

function parseJsonLoose(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}

/** 确定性兜底问题（自 longTermMission 迁入；问题永远存在是本模块的存在理由） */
function fallbackQuestion(m, phase) {
  return {
    question: '当前阶段「' + (phase ? String(phase.title).slice(0, 60) : '-') + '」目标是：'
      + (phase ? String(phase.goal).slice(0, 200) : '（无）') + '。下月继续按此目标推进，还是调整方向？',
    options: ['继续当前目标', '调整方向（请在备注说明）', '听 AI 的（按数据自行决定）'],
    askedAt: new Date().toISOString(), answered: null,
  };
}

/** 校验 LLM 输出：question 非空 + 恰 3 个非空选项 */
function validateQuestion(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: '不是对象' };
  const question = String(raw.question || '').trim();
  const options = Array.isArray(raw.options) ? raw.options.map((s) => String(s || '').trim()).filter(Boolean) : [];
  if (!question) return { ok: false, reason: '缺少 question' };
  if (question.length > 400) return { ok: false, reason: 'question 过长' };
  if (options.length !== 3) return { ok: false, reason: 'options 必须恰 3 项（got ' + options.length + '）' };
  if (options.some((s) => s.length > 60)) return { ok: false, reason: '选项过长（≤60 字）' };
  return { ok: true, question: { question, options, askedAt: new Date().toISOString(), answered: null } };
}

/** LLM 生成一次（内部；失败 throw，由 resolveMonthlyQuestion 统一降级） */
async function proposeViaLlm(worldId, m, usage, phase) {
  const built = promptBuilder.build({
    purpose: 'summary',
    ctx: {
      world: { name: '本世界', stats: {} },
      task: {
        prompt: '为长期使命的月报生成一个方向性问题，让管理员每月至少纠偏一次。'
          + '使命：' + String(m.statement).slice(0, 400)
          + (phase ? '\n当前阶段目标：' + String(phase.goal).slice(0, 300) : '')
          + '\n本月用量：tokens ' + (usage.tokens || 0) + '，建 ' + (usage.objects || 0) + ' 拆 ' + (usage.demolitions || 0)
          + '\n只输出 JSON：{"question":"...","options":["继续…","调整…（另一种具体方向）","听 AI 的（按数据自行决定）"]}'
          + '\n要求：问题必须具体到本世界的当前阶段（不要空泛），第一个选项=继续，第二个选项=一个可执行的替代方向，第三个选项固定为"听 AI 的（按数据自行决定）"。',
        constraints: {},
      },
      tools: [], allowedTools: null, memories: [], parts: [], history: [], untrusted: [],
      contextWindowTokens: null, nearDist: 0, midDist: 0,
    },
  });
  const router = await providerRouter.resolve('summary', { worldId });
  if (!router.provider) throw new Error('NO_PROVIDER: ' + (router.reason || '没有可用 provider'));
  const chat = await require('../../services/llmClient').chat({
    provider: router.provider, messages: built.messages, temperature: 0.5, maxTokens: 500,
    purpose: 'summary', caller: 'world_ai_mission_monthly_question', timeoutMs: 45000, retries: 1,
  });
  const v = validateQuestion(parseJsonLoose(chat.content));
  if (!v.ok) throw new Error('QUESTION_INVALID: ' + v.reason);
  return v.question;
}

/**
 * 解析月报问题（generateMonthlyReport 唯一入口）。
 * @param {object} opts { injectQuestion?, llmQuestion?, _test_forceLlmFailure? }
 * @returns {Promise<{pendingQuestion:object, source:'injected'|'llm'|'fallback', note:?string}>}
 */
async function resolveMonthlyQuestion(worldId, m, usage, phase, opts) {
  const o = opts || {};
  if (o.injectQuestion) {
    return { pendingQuestion: o.injectQuestion, source: 'injected', note: null };
  }
  if (o.llmQuestion) {
    try {
      if (o._test_forceLlmFailure) throw new Error('TEST_FORCED_LLM_FAILURE');
      const q = await proposeViaLlm(String(worldId), m, usage, phase);
      return { pendingQuestion: q, source: 'llm', note: null };
    } catch (e) {
      // ★ 失败不静默：降级模板 + note 随月报落库（后台可见）；三选恒在
      return {
        pendingQuestion: fallbackQuestion(m, phase), source: 'fallback',
        note: 'LLM 问题生成失败已用模板：' + String(e && e.message).slice(0, 200),
      };
    }
  }
  // 未显式要求 LLM（验收/直接调用）→ 纯确定性路径（行为与 Phase 7b 既有判据零变化）
  return { pendingQuestion: fallbackQuestion(m, phase), source: 'fallback', note: null };
}

module.exports = { resolveMonthlyQuestion, fallbackQuestion, validateQuestion, parseJsonLoose };
