/**
 * 用途级 Provider 路由（AI World Brain · Phase 2a · 队列项 2a-2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：AI-World-Brain-架构审查与改造方案.md §H.10.2（四层路由链）/ §H.10.3（用途分工）。
 *
 * 本文件只落地四层链的**第 3 层（用途级映射 provider_map）与第 4 层（候选链兜底）**：
 *   ① 委托级 world_build_missions.provider_id   ← Phase 3.5
 *   ② 区域级 world_regions.preferred_provider_id ← Phase 3.5
 *   ③ 用途级 world_ai_configs.provider_map      ← ★ 本文件
 *   ④ 候选链   llmProviderResolver.candidates()  ← Phase 0 已有，本文件调用
 *
 * 三条禁止（§H.10.4）：不按 block/轮次轮换厂商、不按成本动态竞价、不中途换家
 * （唯一例外是失败 fallback，且必须写 ai_call_log —— 由调用方负责）。
 *
 * 铁律（§H.10.1）：**只存 provider_id 引用，绝不存 Key**；Key 只在「系统配置 → AI提供商」。
 */
'use strict';

const providerService = require('../../services/aiProviderService');
const llmProviderResolver = require('../../services/llmProviderResolver');
const worldAiConfig = require('../config');

const PURPOSE_FALLBACK = ['plan', 'tool_select', 'summary', 'tag'];

/** provider_map 里允许出现的 purpose（前端选择器同款，见 adminWorldBrain.PURPOSES） */
function normalizePurpose(purpose) {
  const p = String(purpose || '').trim();
  return p || 'custom';
}

/** 该 provider 是否可用：启用 + 有未掩码密钥（复用 Phase 0 的判定，保证两条链口径一致） */
function isUsable(provider) {
  if (!provider) return false;
  if (provider.is_enabled === false) return false;
  return llmProviderResolver.hasUsableKey(provider);
}

/**
 * 解析某 purpose 实际该用哪家。
 * @param {string} purpose plan | tool_select | summary | tag | ...
 * @param {object} [opts] { providerMap, worldId } —— 传入 providerMap 可跳过查库（单测/3.5 复用）
 * @returns {Promise<{provider:object|null, source:'provider_map'|'candidates'|'none', reason:string, candidateCount:number}>}
 */
async function resolve(purpose, opts) {
  const p = normalizePurpose(purpose);
  let map = opts && opts.providerMap;
  if (!map) {
    try {
      const row = await worldAiConfig.getConfig(opts && opts.worldId);
      map = (row && row.provider_map) || {};
    } catch (e) {
      map = {};
    }
  }
  const wanted = map && map[p] != null ? Number(map[p]) : null;

  if (wanted) {
    let full = null;
    try { full = await providerService.getProvider(wanted, true); } catch (e) { full = null; }
    if (isUsable(full)) {
      return { provider: full, source: 'provider_map', reason: `provider_map.${p}=${wanted}`, candidateCount: 1 };
    }
    // 配了但不可用（停用/删了/密钥被清）→ 记明原因后落到候选链，绝不静默换家还装作是配置的那家
    const why = !full ? 'provider 不存在'
      : (full.is_enabled === false ? 'provider 已停用'
        : 'provider 没有可用密钥（api_key 为空或仍是 ********）');
    const cands = await safeCandidates(p);
    return {
      provider: cands[0] || null,
      source: cands.length ? 'candidates' : 'none',
      reason: `provider_map.${p}=${wanted} 不可用（${why}），已落到候选链`,
      candidateCount: cands.length,
    };
  }

  const cands = await safeCandidates(p);
  return {
    provider: cands[0] || null,
    source: cands.length ? 'candidates' : 'none',
    reason: cands.length ? `未配置 provider_map.${p}，用候选链首选 ${cands[0].provider_name}` : '没有可用 provider',
    candidateCount: cands.length,
  };
}

/** 解析并直接返回 provider（llmClient.chat({ provider }) 用） */
async function resolveProvider(purpose, opts) {
  const r = await resolve(purpose, opts);
  return r.provider;
}

async function safeCandidates(purpose) {
  try {
    const list = await llmProviderResolver.candidates(purpose);
    return Array.isArray(list) ? list.filter(isUsable) : [];
  } catch (e) {
    console.warn('[worldai/providerRouter] 候选链解析失败:', e.message);
    return [];
  }
}

/**
 * 一次性解析多个用途（后台"健康度/路由预览"与 3.5 的 mission 编排用）。
 * @returns {Promise<{resolutions:Object, byPurpose:Object}>} 结构与 §H.10.2 的 provider_resolution 对齐
 */
async function resolveAll(purposes, opts) {
  const list = Array.isArray(purposes) && purposes.length ? purposes : PURPOSE_FALLBACK;
  const resolutions = {};
  const byPurpose = {};
  for (const p of list) {
    const r = await resolve(p, opts);
    resolutions[p] = r.provider ? r.provider.id : null;
    byPurpose[p] = {
      providerId: r.provider ? r.provider.id : null,
      providerName: r.provider ? (r.provider.display_name || r.provider.provider_name) : null,
      source: r.source,
      reason: r.reason,
    };
  }
  return { resolutions, byPurpose };
}

/**
 * plan 与 tool_select 必须同一家（§H.10.3 硬约束 / P1-14）。
 * 只配一个 = 继承（合法）；两个都配且不同 = 拒绝保存。
 * @returns {{ok:boolean, error?:string}}
 */
function validateProviderMap(map) {
  const m = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  const plan = m.plan == null || m.plan === '' ? null : Number(m.plan);
  const tool = m.tool_select == null || m.tool_select === '' ? null : Number(m.tool_select);
  if (plan && tool && plan !== tool) {
    return {
      ok: false,
      error: 'provider_map：plan（规划）与 tool_select（工具选择）必须配置为同一家厂商 —— ' +
        'plan 产出的布局 JSON 由 tool_select 继续解读，换模型会导致对同一份 plan 的理解漂移（设计约束 §H.10.3）。' +
        `当前 plan=${plan}、tool_select=${tool}。只配置其中一个表示继承，是允许的。`,
    };
  }
  return { ok: true };
}

module.exports = {
  PURPOSE_FALLBACK,
  resolve,
  resolveProvider,
  resolveAll,
  validateProviderMap,
  isUsable,
  normalizePurpose,
};