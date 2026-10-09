/**
 * providerFallback —— 委托级跨厂商兜底（AI World Brain · Phase 3.5-3 · 判据 P35-22）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：AI-World-Brain提示词-3 §2.1⑥。Phase 0 的 llmClient 只做**同一家内**的
 * 退避重试，没有跨 provider fallback；本文件补上"失败后取候选链下一家重试一次"。
 *
 * 三条口径（§H.10.3/§H.10.4 的例外条款）：
 *   1) 只允许跨家**一次**（maxAttempts = min(chain, 2)）——绝不做多厂商竞赛/best-of-N；
 *   2) 两次调用都由 llmClient 自动写入 ai_call_log（P35-22 的可追溯依据）；
 *   3) 换家原因由调用方（missionPlanner）通过 onFallback 写进 executed_stats.notes。
 *
 * 哪些失败值得换家（刻意收窄）：
 *   - LlmHttpError 且 retryable（429 / 5xx）——上游过载/限流，换家有意义；
 *   - 网络层错误（fetch failed 等 LlmError 但非 HTTP/超时）——换家有意义；
 *   - 超时（LLM_TIMEOUT）**不换家**：与 llmClient"超时明确不重试"同口径，换家只会翻倍等待；
 *   - 4xx（鉴权/参数错）不换家：请求本身有问题，换家掩盖配置错误。
 */
'use strict';

const llmClient = require('../../services/llmClient');
const providerRouter = require('./providerRouter');
const llmProviderResolver = require('../../services/llmProviderResolver');

/** 候选链 = 首选（决议出的那家）+ 全局候选链去重（按 provider.id，保序） */
async function candidateChain(purpose, primary) {
  const chain = [];
  if (primary && providerRouter.isUsable(primary)) chain.push(primary);
  let cands = [];
  try {
    cands = await llmProviderResolver.candidates(purpose);
    if (!Array.isArray(cands)) cands = [];
  } catch (e) { cands = []; }
  for (const c of cands) {
    if (!providerRouter.isUsable(c)) continue;
    if (chain.some((x) => Number(x.id) === Number(c.id))) continue;
    chain.push(c);
  }
  return chain;
}

/** 该错误是否值得换下一家（见文件头口径） */
function worthFallback(e) {
  if (!e) return false;
  if (e.name === 'LlmTimeoutError' || e.code === 'LLM_TIMEOUT') return false;
  if (e.name === 'LlmNoProviderError' || e.code === 'LLM_NO_PROVIDER') return false;
  if (e.name === 'LlmHttpError') return !!e.retryable;
  return true; // 网络层错误（fetch failed 等）
}

/**
 * 带跨厂商兜底的一次 chat。
 * @param {object} req  透传给 llmClient.chat 的请求（messages/jsonSchema/purpose/caller/missionId...）
 * @param {object} opts { primary（决议出的首选 provider），onFallback({from,to,error})，maxHops? }
 * @returns llmClient.chat 的成功返回 + { fallbackFrom: providerId|null }
 * @throws 全部候选都失败时抛最后一次的错误（与直连 llmClient 同形）
 */
async function chatWithFallback(req, opts) {
  const o = opts || {};
  const purpose = req.purpose || 'plan';
  const chain = await candidateChain(purpose, o.primary);
  if (!chain.length) throw new llmClient.LlmNoProviderError();
  const maxHops = Math.max(1, Number(o.maxHops) || 2); // ★ 首选 + 跨家一次（§H.10.4 例外条款的字面语义）
  let lastErr = null;
  for (let i = 0; i < chain.length && i < maxHops; i++) {
    try {
      const r = await llmClient.chat(Object.assign({}, req, { provider: chain[i] }));
      if (i > 0 && typeof o.onFallback === 'function') {
        try {
          o.onFallback({
            from: chain[0], to: chain[i],
            error: lastErr ? String(lastErr.message).slice(0, 200) : 'unknown',
          });
        } catch (e2) { /* 回调绝不打断主流程 */ }
      }
      return Object.assign({}, r, { fallbackFrom: i > 0 ? chain[0].id : null });
    } catch (e) {
      lastErr = e;
      if (!worthFallback(e) || i === chain.length - 1 || i === maxHops - 1) throw e;
    }
  }
  throw lastErr || new llmClient.LlmError('LLM 调用失败', { code: 'LLM_ERROR' });
}

module.exports = { candidateChain, chatWithFallback, worthFallback };
