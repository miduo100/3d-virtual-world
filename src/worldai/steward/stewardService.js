/**
 * stewardService —— 世界管家 Steward（AI World Brain · Phase 5 · 可选项，§B.2 三类主体）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 定位：世界的化身（有实体），本质 = agents 表一行（role 标记在 description 前缀 [steward]），
 * 走既有 /ws/agent 的 8 动作（替身 scope），**零世界写权、零新机制**（复用 agents +
 * agent_api_keys + avatar_config）。
 * 总闸：system_config('world_ai_steward_enabled')，默认 'false'（保守）。
 */
'use strict';

const { query } = require('../../database/db');

const STEWARD_NAME = 'world_steward';
const STEWARD_TAG = '[steward]';

async function isEnabled() {
  try {
    const r = await query(`SELECT config_value FROM system_config WHERE config_key = 'world_ai_steward_enabled' LIMIT 1`);
    return String((r.rows[0] && r.rows[0].config_value) || 'false') === 'true';
  } catch (e) {
    return false;
  }
}

async function setEnabled(v) {
  const val = v === true || v === 'true' ? 'true' : 'false';
  await query(
    `INSERT INTO system_config (config_key, config_value) VALUES ('world_ai_steward_enabled', $1)
     ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = NOW()`,
    [val]
  );
  return val === 'true';
}

async function findSteward() {
  const r = await query(`SELECT * FROM agents WHERE name = $1 LIMIT 1`, [STEWARD_NAME]);
  return r.rows[0] || null;
}

/**
 * 确保管家存在（幂等）。已存在则复用（不重发 Key——明文 Key 只在创建时返回一次）。
 * @returns {{ok:boolean, created:boolean, agent:object, apiKey?:{key,keyPrefix}, reason?}}
 */
async function ensureSteward(opts) {
  const o = opts || {};
  if (!(await isEnabled())) {
    return { ok: false, code: 'STEWARD_DISABLED', reason: 'world_ai_steward_enabled=false（默认关）：先在后台/配置打开总闸' };
  }
  const exist = await findSteward();
  if (exist) return { ok: true, created: false, agent: exist };
  const agentManager = require('../../agent/agentManager');
  const { agent, apiKey } = await agentManager.createAgent({
    name: STEWARD_NAME,
    description: STEWARD_TAG + ' 世界管家（Phase 5 自动创建；仅替身 scope，无世界写权）',
    homeWorldUrl: o.homeWorldUrl || null,
    avatarConfig: o.avatarConfig || {},
    pushTier: 'standard',
  });
  return { ok: true, created: true, agent, apiKey };
}

async function status() {
  const enabled = await isEnabled();
  const agent = await findSteward();
  return {
    enabled,
    exists: !!agent,
    agent: agent ? { id: agent.id, name: agent.name, status: agent.status, pushTier: agent.push_tier, createdAt: agent.created_at } : null,
    scopes: '替身 6 scope（进场/说话/走动等 /ws/agent 动作）；无任何 world:build / world 写权',
  };
}

module.exports = { ensureSteward, status, isEnabled, setEnabled, STEWARD_NAME };
