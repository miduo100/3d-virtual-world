/**
 * constraints 键名归一（Phase 3.5-2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 为什么需要这一层（3.5-2 实施中踩到）：
 *   规格与 DB 里是snake_case（max_objects / forbid_roles / style_family…），
 *   而后台表单与前端习惯 camelCase（maxObjects / forbidRoles / styleFamily）。
 *   两边不一致的典型症状：**预算看起来设了却不生效**（读不到 max_objects → 回落默认值 120）。
 *   故统一在入口归一，DB 内永远只存 snake_case。
 */
'use strict';

const MAP = {
  maxObjects: 'max_objects', maxTris: 'max_tris', maxHeight: 'max_height', maxHeights: 'max_heights',
  allowedRoles: 'allowed_roles', forbidRoles: 'forbid_roles', styleFamily: 'style_family',
  placementPolicy: 'placement_policy', requireInteraction: 'require_interaction',
  maxLlmCalls: 'maxLlmCalls', maxTokens: 'maxTokens', maxWallClockSec: 'maxWallClockSec',
  llmCallsPerDay: 'llmCallsPerDay', tokensPerDay: 'tokensPerDay',
};

/** camelCase → snake_case（已是无歧义的键原样保留；budget 的键不参与映射） */
function normalizeConstraints(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    out[MAP[k] || k] = v;
  }
  return out;
}

module.exports = { normalizeConstraints, MAP };