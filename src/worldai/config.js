/**
 * World AI 配置（world_ai_configs，每世界一行）
 * Phase 2a · 队列项 1 —— 设计来源：AI-World-Brain-架构审查与改造方案.md §C.3 ①
 *
 * 边界（§K.5）：API Key 永不落这张表；provider_id / provider_map 只存引用。
 * 字段校验白名单在 sanitizePatch()，未知字段一律丢弃（零回归：老调用不受影响）。
 */
const { query } = require('../database/db');

const AUTONOMY_LEVELS = ['managed', 'semi_autonomous', 'autonomous'];
const VALID_SCOPES = [
  'world:observe', 'world:plan', 'world:build',
  'world:gameplay', 'world:analyze', 'world:rollback', 'world:configure',
];
// 代码级硬拒（§G.2）：即使最高管理员显式配置也不入库
const FORBIDDEN_SCOPES = [
  'world:raw_sql', 'world:shell', 'world:http', 'world:eval',
  'world:ownership', 'world:security', 'world:federation', 'world:admin',
];

// 允许通过 PUT 更新的列（白名单；runtime_state/heartbeat 由 runtime 管，2a 不可写）
const UPDATABLE_FIELDS = [
  'enabled', 'provider_id', 'model', 'system_prompt', 'temperature', 'max_tokens',
  'allowed_scopes', 'risk_policy', 'autonomy', 'provider_map',
  'context_window_tokens', 'budget', 'schedule',
];

/** world_id 解析：federationSystem（内存权威）→ system_config('world_id') → 'default'
 *  ★ 进程内调用（非server 进程，如验收脚本）拿不到 federationSystem 内存态，会回落到
 *    system_config('world_id') 的**初始化占位 UUID**；这类调用必须显式传 worldId 参数。 */
async function getWorldId() {
  try {
    const fed = require('../routes/federation');
    const getFederationSystem = fed && typeof fed.getFederationSystem === 'function' ? fed.getFederationSystem : null;
    const sys = getFederationSystem && getFederationSystem();
    if (sys && sys.worldId) return String(sys.worldId);
  } catch (e) { /* federation 未初始化属常态，走兜底 */ }
  try {
    const r = await query(`SELECT config_value FROM system_config WHERE config_key = 'world_id' LIMIT 1`);
    if (r.rows.length && r.rows[0].config_value) return String(r.rows[0].config_value);
  } catch (e) { /* 表不存在等，走兜底 */ }
  return 'default';
}

/** 读取配置（不存在则创建默认行）；返回行对象 */
async function getConfig(worldId) {
  const wid = worldId || await getWorldId();
  await query(
    `INSERT INTO world_ai_configs (world_id) VALUES ($1) ON CONFLICT (world_id) DO NOTHING`,
    [wid]
  );
  const r = await query(`SELECT * FROM world_ai_configs WHERE world_id = $1`, [wid]);
  return r.rows[0] || null;
}

/** 更新配置：返回更新后的行；patch 含非法值时抛 ValidationError */
async function updateConfig(patch, worldId) {
  const wid = worldId || await getWorldId();
  await getConfig(wid); // 确保行存在
  const clean = sanitizePatch(patch); // { sets:[{col,value}], errors:[] }
  if (clean.errors.length) {
    const err = new Error('参数校验失败: ' + clean.errors.join('; '));
    err.statusCode = 400;
    throw err;
  }
  // P1-14（§H.10.3 硬约束）：plan 与 tool_select 都配且不同 → 拒绝保存
  // 放在 sanitizePatch 之后：只有通过白名单与类型校验的 provider_map 才参与跨字段校验。
  // 只配一个 = 继承（合法），两者都不配 = 全走候选链（合法）。
  if (clean.sets.some((s) => s.col === 'provider_map')) {
    const { validateProviderMap } = require('./llm/providerRouter');
    const check = validateProviderMap(patch ? patch.provider_map : {});
    if (!check.ok) {
      const err = new Error(check.error);
      err.statusCode = 400;
      throw err;
    }
  }
  if (!clean.sets.length) {
    const r = await query(`SELECT * FROM world_ai_configs WHERE world_id = $1`, [wid]);
    return r.rows[0];
  }
  const sets = clean.sets.map((s, i) => `${s.col} = $${i + 1}`);
  const vals = clean.sets.map(s => s.value);
  const r = await query(
    `UPDATE world_ai_configs SET ${sets.join(', ')}, updated_at = now() WHERE world_id = $${vals.length + 1} RETURNING *`,
    [...vals, wid]
  );
  return r.rows[0];
}

/** PATCH 白名单 + 逐字段校验（供 updateConfig 与验收复用） */
function sanitizePatch(patch) {
  const sets = [];
  const errors = [];
  if (!patch || typeof patch !== 'object') return { sets, errors };
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in patch)) continue;
    const v = patch[field];
    switch (field) {
      case 'enabled':
        if (typeof v !== 'boolean') { errors.push('enabled 必须是布尔'); break; }
        sets.push({ col: 'enabled', value: v }); break;
      case 'provider_id':
        if (v !== null && v !== undefined && (!Number.isInteger(v) || v <= 0)) { errors.push('provider_id 必须是正整数或 null'); break; }
        sets.push({ col: 'provider_id', value: v === undefined ? null : v }); break;
      case 'model':
        if (v !== null && (typeof v !== 'string' || v.length > 150)) { errors.push('model 需为 ≤150 字符的字符串'); break; }
        sets.push({ col: 'model', value: v === undefined ? null : v }); break;
      case 'system_prompt':
        if (v !== null && (typeof v !== 'string' || v.length > 20000)) { errors.push('system_prompt 需为 ≤20000 字符的字符串'); break; }
        sets.push({ col: 'system_prompt', value: v === undefined ? null : v }); break;
      case 'temperature': {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 2) { errors.push('temperature 需在 0~2'); break; }
        sets.push({ col: 'temperature', value: n }); break;
      }
      case 'max_tokens': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 100 || n > 128000) { errors.push('max_tokens 需为 100~128000 的整数'); break; }
        sets.push({ col: 'max_tokens', value: n }); break;
      }
      case 'autonomy':
        if (!AUTONOMY_LEVELS.includes(v)) { errors.push('autonomy 必须是 ' + AUTONOMY_LEVELS.join('/')); break; }
        sets.push({ col: 'autonomy', value: v }); break;
      case 'allowed_scopes': {
        if (!Array.isArray(v)) { errors.push('allowed_scopes 必须是数组'); break; }
        const forbidden = v.filter(s => FORBIDDEN_SCOPES.includes(s));
        if (forbidden.length) { errors.push('scope 不允许: ' + forbidden.join(',')); break; }
        const unknown = v.filter(s => !VALID_SCOPES.includes(s));
        if (unknown.length) { errors.push('未知 scope: ' + unknown.join(',')); break; }
        sets.push({ col: 'allowed_scopes', value: v }); break;
      }
      case 'provider_map': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push('provider_map 必须是对象'); break; }
        const bad = Object.entries(v).filter(([, pv]) => !Number.isInteger(pv) || pv <= 0);
        if (bad.length) { errors.push('provider_map 的值必须是正整数 provider_id'); break; }
        sets.push({ col: 'provider_map', value: JSON.stringify(v) }); break;
      }
      case 'context_window_tokens':
        if (v !== null && (!Number.isInteger(v) || v < 1024 || v > 2000000)) { errors.push('context_window_tokens 需为 1024~2000000 的整数或 null'); break; }
        sets.push({ col: 'context_window_tokens', value: v === undefined ? null : v }); break;
      case 'risk_policy': case 'budget': case 'schedule': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(field + ' 必须是对象'); break; }
        sets.push({ col: field, value: JSON.stringify(v) }); break;
      }
      default: break;
    }
  }
  return { sets, errors };
}

/** scope 过滤（§G.2 代码级硬拒）：禁止名单一律剔除，未知剔除；返回 {kept, rejected} */
function filterScopes(scopes) {
  const arr = Array.isArray(scopes) ? scopes : [];
  const kept = [];
  const rejected = [];
  for (const s of arr) {
    if (typeof s !== 'string') continue;
    if (FORBIDDEN_SCOPES.includes(s) || !VALID_SCOPES.includes(s)) rejected.push(s);
    else if (!kept.includes(s)) kept.push(s);
  }
  return { kept, rejected };
}

module.exports = {
  getWorldId,
  getConfig,
  updateConfig,
  sanitizePatch,
  filterScopes,
  AUTONOMY_LEVELS,
  VALID_SCOPES,
  FORBIDDEN_SCOPES,
  UPDATABLE_FIELDS,
};
