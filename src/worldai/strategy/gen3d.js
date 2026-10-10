/**
 * strategy/gen3d —— 第 4 条生成路径（AI World Brain · Phase 8 · §F.2 路径 4 / Gen3D）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 五层金字塔的最上层：L0 整栋资产 → L1 零件装配 → L2 程序化 → **L3 gen3d**。
 *
 * ★ 与"自动降级"严格区分（§F.2 原文）：
 *   未启用时返回 `unsupported` + 建议换路径，**绝不静默降级**到程序化 ——
 *   否则会出现"以为在生成 3D，其实在建盒子"。调用方必须显式处理 unsupported。
 *
 * 开关：system_config `world_ai_gen3d_enabled`（'true' 才启用，默认关）
 * 厂商：system_config `world_ai_gen3d_provider`（默认 'tripo'；Phase 8 不接真实服务）
 */
'use strict';

const configService = require('../../services/configService');

const ENABLE_KEY = 'world_ai_gen3d_enabled';
const PROVIDER_KEY = 'world_ai_gen3d_provider';
/** 未启用时建议改走的路径（给 LLM 自检用） */
const SUGGEST = ['composite', 'procedural'];

async function isEnabled() {
  try {
    const v = await configService.getConfig(ENABLE_KEY);
    return String(v || '').trim().toLowerCase() === 'true';
  } catch (e) {
    return false;   // 配置不可读 = 未启用（保守）
  }
}

async function providerName() {
  try {
    const v = await configService.getConfig(PROVIDER_KEY);
    return String(v || 'tripo').trim().toLowerCase() || 'tripo';
  } catch (e) {
    return 'tripo';
  }
}

async function config() {
  const enabled = await isEnabled();
  const provider = await providerName();
  return { enabled, provider };
}

/**
 * gen3d 路径规划（供 assetSelector 的 L3 分支与 gen3dTools 共用）
 * @param {object} spec Building Spec（assembly='gen3d'）
 * @returns {Promise<{strategy:'gen3d'|'unsupported', code?, suggest?, provider?, prompt?, reason:string}>}
 */
async function plan(spec) {
  const s = spec || {};
  const c = await config();
  if (!c.enabled) {
    return {
      strategy: 'unsupported',
      code: 'GEN3D_DISABLED',
      suggest: SUGGEST.slice(),
      reason: 'gen3d（3D 生成）未启用，未接入真实生成服务；请改用 composite（零件装配）或 procedural（程序化）'
        + '（开关：system_config.world_ai_gen3d_enabled）',
    };
  }
  const g = s.gen3d && typeof s.gen3d === 'object' ? s.gen3d : {};
  const prompt = String(g.prompt || s.prompt || '').trim().slice(0, 1000);
  if (!prompt) {
    return {
      strategy: 'unsupported',
      code: 'GEN3D_PROMPT_REQUIRED',
      suggest: SUGGEST.slice(),
      reason: 'gen3d 已启用但缺少 prompt（spec.gen3d.prompt）',
    };
  }
  return {
    strategy: 'gen3d',
    provider: c.provider,
    prompt,
    reason: 'gen3d 路径可用（provider=' + c.provider + '）',
  };
}

module.exports = { plan, isEnabled, providerName, config, ENABLE_KEY, PROVIDER_KEY, SUGGEST };
