/**
 * riskGate —— 风险分级 × 审批策略（AI World Brain · Phase 4 · §G.4）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ high = 代码级强制人工审批：**不读 risk_policy、不接受任何 override/force 参数**（不可降级）。
 *   （executor 的实现里 high 由 ownershipGuard 的 HIGH_RISK_NEEDS_APPROVAL 兜底触发；
 *     本模块再把 policy 口径补齐：low/medium 可由管理员配成 approve。）
 * ★ policy 读 world_ai_configs.risk_policy（默认 {"low":"auto","medium":"auto","high":"approve"}）。
 */
'use strict';

const worldAiConfig = require('../config');

const DEFAULT_POLICY = { low: 'auto', medium: 'auto', high: 'approve' };

/**
 * @param {string} riskTier 'low' | 'medium' | 'high'
 * @returns {{action:'execute'}} | {action:'needs_approval', reason}
 */
async function decide(worldId, riskTier) {
  const risk = String(riskTier || 'low');
  // ① high：代码级硬约束，无论 policy 怎么配都要求人工
  if (risk === 'high') {
    return { action: 'needs_approval', reason: 'high 风险动作必须人工批准（§G.4，不可降级、不接受 override）' };
  }
  // ② low/medium：读管理员配置的策略
  let policy = DEFAULT_POLICY;
  try {
    const cfg = await worldAiConfig.getConfig(worldId);
    if (cfg && cfg.risk_policy && typeof cfg.risk_policy === 'object') {
      policy = Object.assign({}, DEFAULT_POLICY, cfg.risk_policy);
    }
  } catch (e) { /* 用默认 */ }
  const rule = policy[risk] === 'approve' ? 'approve' : 'auto';
  if (rule === 'approve') {
    return { action: 'needs_approval', reason: 'risk_policy.' + risk + "='approve'（管理员配置），转人工审批" };
  }
  return { action: 'execute' };
}

module.exports = { decide, DEFAULT_POLICY };
