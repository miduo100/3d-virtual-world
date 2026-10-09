/**
 * budget —— 每轮 / 每日预算（AI World Brain · Phase 4 · §H.7 + §H.10.5 · 判据 P3-9）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 口径（§H.10.5 重启安全）：**查表不查内存**——每日工具数从 world_tool_executions
 *   当日行数取（toolJournal.countToday）；进程重启清内存 = 没有预算。
 *   每轮（run 内）计数由调用方随 ctx 传递（单轮天然随进程结束）。
 * ★ 预算参数读 world_ai_configs.budget（§H.7 默认值在那张表的 DEFAULT 里），本文件不再写一套常量；
 *   protectedSpawnRadius 缺省 30m（§G.5③ 出生点保护，判据 P3-11）。
 */
'use strict';

const worldAiConfig = require('../config');
const toolJournal = require('../journal/toolJournal');
const { query } = require('../../database/db');

const DEFAULTS = {
  toolsPerRun: 12, newObjectsPerRun: 20, toolsPerDay: 200,
  llmCallsPerDay: 60, tokensPerDay: 2000000, wallClockSecPerRun: 180,
  protectedSpawnRadius: 30,
};

function pick(budget) {
  const b = budget && typeof budget === 'object' ? budget : {};
  const out = {};
  Object.keys(DEFAULTS).forEach((k) => {
    const n = Number(b[k]);
    out[k] = Number.isFinite(n) && n > 0 ? n : DEFAULTS[k];
  });
  return out;
}

/**
 * 预算检查。调用方传 runUsed（本轮已执行工具数）。
 * @returns {{ok:true, limits}} | {ok:false, code:'BUDGET_EXHAUSTED', reason, limits}
 */
async function check(worldId, runUsed) {
  const cfg = await worldAiConfig.getConfig(worldId);
  const limits = pick(cfg && cfg.budget);
  const dayUsed = await toolJournal.countToday(worldId);
  if (dayUsed >= limits.toolsPerDay) {
    return {
      ok: false, code: 'BUDGET_EXHAUSTED', limits,
      reason: '今日工具预算已用尽：' + dayUsed + '/' + limits.toolsPerDay
        + '（每日额度查 world_tool_executions 当日计数，重启不重置，§H.10.5）',
    };
  }
  const run = Number(runUsed) || 0;
  if (run >= limits.toolsPerRun) {
    return {
      ok: false, code: 'BUDGET_EXHAUSTED', limits,
      reason: '本轮工具预算已用尽：' + run + '/' + limits.toolsPerRun,
    };
  }
  return { ok: true, limits, dayUsed, runUsed: run };
}

/** 出生点保护（§G.5③）：radius 缺省 30m；spawnPoint 读 world_spawn_point 配置，缺省与真人前端一致 */
async function spawnProtection(worldId) {
  let radius = DEFAULTS.protectedSpawnRadius;
  try {
    const cfg = await worldAiConfig.getConfig(worldId);
    const r = Number(cfg && cfg.budget && cfg.budget.protectedSpawnRadius);
    if (Number.isFinite(r) && r > 0) radius = r;
  } catch (e) { /* 用默认 */ }
  let spawnPoint = { x: 0, y: 0.05, z: 0 };
  try {
    const r = await query(`SELECT config_value FROM system_config WHERE config_key = 'world_spawn_point' LIMIT 1`);
    if (r.rows.length && r.rows[0].config_value) {
      const sp = typeof r.rows[0].config_value === 'string'
        ? JSON.parse(r.rows[0].config_value) : r.rows[0].config_value;
      if (sp && Number.isFinite(Number(sp.x)) && Number.isFinite(Number(sp.z))) {
        spawnPoint = { x: Number(sp.x), y: Number(sp.y) || 0, z: Number(sp.z) };
      }
    }
  } catch (e) { /* 用默认 */ }
  return { radius, spawnPoint };
}

module.exports = { check, spawnProtection, DEFAULTS, pick };
