/**
 * AI Agent 接入 - 权限服务（P1）
 * 游客级白名单（红线2）：scope 集合中不存在 teleport，收到即拒。
 * 本模块是服务端权威校验的唯一来源，前端拦截不作为安全边界。
 */

const { AGENT_SCOPES, FORBIDDEN_SCOPES } = require('./agentSchema');

/**
 * 获取 Agent 的 scope 列表。
 * P1 阶段：所有 active Agent 统一游客级白名单；
 * can_teleport 即使为 true 也不发放 teleport scope（红线3：字段预留，逻辑不实现）。
 */
function getScopesForAgent(agent) {
  if (!agent || agent.status !== 'active') return [];
  // 游客级白名单副本
  return AGENT_SCOPES.slice();
}

/**
 * 校验单个 scope 是否被允许
 */
function isScopeAllowed(agent, scope) {
  if (FORBIDDEN_SCOPES.includes(scope)) return false;
  return getScopesForAgent(agent).includes(scope);
}

/**
 * 批量过滤：返回请求 scopes 中被允许的部分与被拒绝的部分
 */
function filterScopes(agent, requestedScopes) {
  const allowed = [];
  const rejected = [];
  const list = Array.isArray(requestedScopes) ? requestedScopes : [];
  for (const s of list) {
    if (typeof s === 'string' && isScopeAllowed(agent, s)) {
      if (!allowed.includes(s)) allowed.push(s);
    } else {
      rejected.push(s);
    }
  }
  return { allowed, rejected };
}

/**
 * 描述当前权限模型（GET /me 展示用）
 */
function describePermissions(agent) {
  return {
    level: 'guest',                    // 游客级准则（红线2）
    scopes: getScopesForAgent(agent),
    canTeleport: false,                // 永远 false，can_teleport 字段仅 DB 预留
    notes: 'Agent 与人类游客共用同一套行为准则；传送类动作不在权限集中'
  };
}

module.exports = {
  getScopesForAgent,
  isScopeAllowed,
  filterScopes,
  describePermissions
};
