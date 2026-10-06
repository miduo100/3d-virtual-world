/**
 * LLM 提供商解析器（AI World Brain · Phase 0）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 解决的三个勘察问题（主文档 §0 发现 1 / §A.2）：
 *   ① 选 provider 靠 3 处硬编码 name map（npc.js / aiSceneGenerator.js / customNpc.js）
 *      → 改成「按 purpose 从库里选」，配置在后台可见可改。
 *   ② `aiProviderService.getDefaultProvider` 是**死代码**（全库零调用者）且
 *      `provider_type = $1` 精确匹配对 'chat,image_to_3d' 这类逗号多值失效
 *      → 这里用 LIKE 匹配并真正复活它（作为 fallback 的第一档）。
 *   ③ 没有 fallback 链：默认 provider 一挂就整条链路断
 *      → 提供 candidates(purpose)：按优先级返回候选，逐个降级。
 *
 * 优先级（从高到低）：
 *   1. system_config 里的 purpose 覆盖（`llm_provider_<purpose>` = provider_id 或 provider_name）
 *   2. 该 purpose 对应的 provider_type 里的 is_default（chat 类）
 *   3. 任何 is_default 且类型匹配
 *   4. 任何启用的类型匹配（按 id 升序，稳定）
 *   5. 任何启用的 chat 类（跨类型兜底）
 * 候选逐个过滤：**必须有可用密钥**（没有密钥的 provider 视为未配置）。
 */
const providerService = require('./aiProviderService');

const PURPOSE_TYPES = {
  plan: ['chat'],
  tool_select: ['chat'],
  summary: ['chat'],
  tag: ['chat'],
  embed: ['embedding'],
  image: ['image_to_3d', 'text_to_3d'],
  ping: ['chat'],
};

async function getPool() {
  const { pool } = require('../database/db');
  return pool;
}

/** purpose → 需要的 provider_type 列表（逗号多值类型用 LIKE 匹配） */
function typesFor(purpose) {
  return PURPOSE_TYPES[purpose] || ['chat'];
}

/** provider 是否有可用密钥（掩码/空值都算没有） */
function hasUsableKey(provider) {
  const cfgs = (provider && provider.configs) || [];
  return cfgs.some(c => c && c.is_sensitive && c.value && c.value !== '********');
}

/** 读 system_config 的 purpose 覆盖（带 60s 内存缓存，避免每轮循环打 DB） */
const overrideCache = { at: 0, map: null };
const OVERRIDE_TTL_MS = 60000;
async function loadOverrides() {
  if (overrideCache.map && Date.now() - overrideCache.at < OVERRIDE_TTL_MS) return overrideCache.map;
  const map = {};
  try {
    const pool = await getPool();
    const r = await pool.query(
      `SELECT config_key, config_value FROM system_config WHERE config_key LIKE 'llm_provider_%'`
    );
    for (const row of r.rows) {
      const purpose = String(row.config_key).slice('llm_provider_'.length);
      if (purpose && row.config_value) map[purpose] = String(row.config_value).trim();
    }
  } catch (e) {
    // 表/键不存在都属正常（未配置就是没有覆盖）
  }
  overrideCache.map = map; overrideCache.at = Date.now();
  return map;
}

/** 主动失效缓存（后台改了 provider 配置后调用） */
function invalidate() { overrideCache.map = null; overrideCache.at = 0; }

/**
 * 取候选 provider 列表（已按优先级排序、已过滤无密钥项）
 * @returns {Promise<Array<object>>} 每项 = aiProviderService.getProvider(id, true) 的结果
 */
async function candidates(purpose) {
  const pool = await getPool();
  const types = typesFor(purpose);
  const overrides = await loadOverrides();

  const r = await pool.query(
    `SELECT id, provider_name, provider_type, is_default
       FROM ai_providers
      WHERE is_enabled = true
      ORDER BY is_default DESC, id ASC`
  );
  let rows = r.rows;

  // purpose 覆盖：把指定 provider 顶到最前（支持 id 或 provider_name）
  const ov = overrides[purpose];
  if (ov) {
    const hit = rows.filter(x => String(x.id) === ov || String(x.provider_name) === ov);
    if (hit.length) rows = [...hit, ...rows.filter(x => !hit.includes(x))];
  }

  // 类型匹配：provider_type 可能是 'chat' 或 'image_to_3d,text_to_3d' 这类逗号多值
  const matchType = (row) => types.some(t => {
    const pt = String(row.provider_type || '').toLowerCase();
    return pt === t || pt.split(',').map(s => s.trim()).includes(t);
  });
  const typed = rows.filter(matchType);
  const rest = rows.filter(x => !typed.includes(x));
  const ordered = [...typed, ...(types.includes('chat') ? [] : rest)];

  // 取详情（含解密后的密钥）并过滤掉未配置的
  const out = [];
  for (const row of ordered) {
    const full = await providerService.getProvider(row.id, true);
    if (full && hasUsableKey(full)) out.push(full);
  }
  return out;
}

/**
 * 取单个（首选）provider —— 绝大多数调用方只需要它
 * @returns {Promise<object|null>}
 */
async function resolveProvider(purpose) {
  const list = await candidates(purpose);
  return list.length ? list[0] : null;
}

/**
 * 带 fallback 的调用：依次尝试候选 provider，前一个失败（可重试类错误）才换下一个。
 * 供 Phase 2+ 的 Runtime 使用；Phase 0 只提供能力，不接管调用点。
 *
 * @param {(provider:object)=>Promise<any>} fn 收到 provider 自行调 llmClient.chat({ provider })
 */
async function withFallback(purpose, fn) {
  const list = await candidates(purpose);
  if (!list.length) {
    const { LlmNoProviderError } = require('./llmClient');
    throw new LlmNoProviderError(`purpose=${purpose} 没有任何可用 provider（检查后台 AI 服务商配置与密钥）`);
  }
  let lastErr = null;
  for (const p of list) {
    try {
      return await fn(p);
    } catch (e) {
      lastErr = e;
      // 参数/鉴权类错误换 provider 也没用，直接抛
      if (e && (e.code === 'LLM_NO_PROVIDER' || e.status === 400 || e.status === 401 || e.status === 403)) throw e;
      console.warn(`[llmProviderResolver] provider ${p.provider_name} 失败，尝试下一个：${e && e.message}`);
    }
  }
  throw lastErr;
}

/** 诊断用：当前每个 purpose 的候选链（后台可展示） */
async function describe() {
  const out = {};
  for (const p of Object.keys(PURPOSE_TYPES)) {
    const list = await candidates(p);
    out[p] = list.map(x => ({ id: x.id, name: x.provider_name, type: x.provider_type, default: x.is_default }));
  }
  return out;
}

module.exports = {
  PURPOSE_TYPES,
  typesFor,
  hasUsableKey,
  candidates,
  resolveProvider,
  withFallback,
  describe,
  invalidate,
  loadOverrides,
};
