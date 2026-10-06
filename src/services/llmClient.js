/**
 * 统一 LLM 客户端（AI World Brain · Phase 0）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 为什么需要它（勘察结论，见主文档 §0 发现 1）：
 *   全库 6 处各写一份裸 axios、4 种互不兼容的 wire format、0 处 function calling、
 *   0 处 token 统计、0 处 streaming/retry。接一个新厂商要改调用代码。
 *   配置层其实已经厂商中立（config_schema 可声明任意 base_url/model）。
 *
 * 一个 `openai-compatible` adapter 顶 OpenAI / DeepSeek / Ollama / vLLM / one-api /
 * 豆包 Ark / DashScope-compatible 七家；Anthropic / Gemini / DashScope 原生各一个。
 *
 * 设计约束（红线）：
 *   ① 不新增任何依赖：用 Node 18+ 全局 fetch + AbortController 实现超时。
 *   ② 不吞错：超时**不重试**并抛 LlmTimeoutError；鉴权/参数错直接抛，不做无谓重试。
 *   ③ 调用账本绝不拖垮主流程：写 ai_call_log 走 fire-and-forget，失败只告警。
 *   ④ 返回值统一归一：{ content, toolCalls, usage, raw } —— 上层不再各写各的解析。
 *   ⑤ 密钥只在服务端解��，绝不进日志（写账本前先脱敏）。
 *
 * 典型用法：
 *   const { chat } = require('./llmClient');
 *   const r = await chat({ purpose: 'summary', messages: [{ role: 'user', content: '你好' }] });
 *   if (r.ok) console.log(r.content, r.usage.totalTokens);
 */
const crypto = require('crypto');
const providerService = require('./aiProviderService');

const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60000);
const DEFAULT_RETRIES = 2;                 // 429 / 5xx / 网络错误的退避重试次数
const RETRY_BASE_MS = Number(process.env.LLM_RETRY_BASE_MS || 800);
const LOG_ENABLED = process.env.LLM_CALL_LOG !== '0';
const MAX_ERRMSG = 300;

// ────────────────────────────── 错误类型 ──────────────────────────────
class LlmError extends Error {
  constructor(message, meta) {
    super(message);
    this.name = 'LlmError';
    Object.assign(this, meta || {});
  }
}
class LlmTimeoutError extends LlmError {
  constructor(ms) { super(`LLM 调用超时（${ms}ms，不重试）`, { code: 'LLM_TIMEOUT', timeoutMs: ms, retryable: false }); this.name = 'LlmTimeoutError'; }
}
class LlmHttpError extends LlmError {
  constructor(status, body, meta) {
    const m = meta || {};
    // 有上游诊断时，message 直接说人话（附带原始 status 便于排查）
    const prefix = m.diagnosis ? `${m.diagnosis}（HTTP ${status}）` : `LLM 返回 HTTP ${status}`;
    super(prefix, Object.assign({ code: 'LLM_HTTP_' + status, status, body }, m));
    this.name = 'LlmHttpError';
  }
}
class LlmNoProviderError extends LlmError {
  constructor(msg) { super(msg || '没有可用的 AI 提供商（ai_providers 无启用项或缺密钥）', { code: 'LLM_NO_PROVIDER', retryable: false }); this.name = 'LlmNoProviderError'; }
}

/**
 * 上游错误诊断翻译。
 *
 * 为什么要这一层：上游厂商的 error.code 是厂商方言（Ark 的 AccountOverdueError /
 * InvalidEndpointOrModel.NotFound / OpenAI 的 insufficient_quota …），
 * 落到用户面前如果只是「AI 功能失败」，排查成本极高。
 * 这里把已知的方言映射成**可执行的中文诊断**（该充值 / 该换模型 / 该换 Key / 该等配额）。
 *
 * 返回 { code, diagnosis, hint, retryable }；无法识别时 diagnosis 为 null（不猜）。
 */
const UPSTREAM_DIAGNOSIS = [
  { re: /AccountOverdue|overdue balance|欠费/i, code: 'UPSTREAM_OVERDUE', diagnosis: 'AI 厂商账号欠费，调用被拒（与本项目代码无关）', hint: '到厂商控制台充值/结清账单后即可恢复；期间该 provider 不可用，可在后台换成别的服务商' },
  { re: /insufficient_quota|exceeded your current quota|billing|arrearage/i, code: 'UPSTREAM_QUOTA', diagnosis: 'AI 厂商额度/余额不足', hint: '检查控制台配额与账单；或换用其他 provider' },
  { re: /InvalidEndpointOrModel|model or endpoint .* does not exist|model_not_found/i, code: 'UPSTREAM_NO_MODEL', diagnosis: '配置的模型/endpoint 在厂商侧不存在或当前 Key 无权访问', hint: '在厂商控制台确认模型名或 endpoint_id（豆包是 ep- 开头），回后台「AI 服务商」改 model/endpoint_id' },
  { re: /invalid[_ ]?api[_ ]?key|unauthorized|401|invalid authentication/i, code: 'UPSTREAM_BAD_KEY', diagnosis: 'API Key 无效或已过期', hint: '回后台「AI 服务商」重新填入密钥' },
  { re: /permission|forbidden|access denied|403/i, code: 'UPSTREAM_FORBIDDEN', diagnosis: 'Key 无该模型/接口的权限', hint: '在厂商控制台为该 Key 授权目标模型，或改用有权限的 Key' },
  { re: /rate limit|too many requests|429|throttl/i, code: 'UPSTREAM_RATE_LIMIT', diagnosis: '被厂商限流', hint: '降低并发或稍后重试（llmClient 已自动退避重试 2 次）' },
  { re: /context length|maximum context|token.*too long/i, code: 'UPSTREAM_CONTEXT', diagnosis: '输入超出模型上下文长度', hint: '裁剪 prompt 或换长上下文模型' },
];

function describeUpstreamError(status, body) {
  const raw = (body && (body.error || body)) || {};
  const code = String(raw.code || raw.type || raw.error_code || '');
  const msg = String(raw.message || raw.msg || (typeof raw === 'string' ? raw : '') || '');
  const hay = code + ' ' + msg;
  for (const d of UPSTREAM_DIAGNOSIS) {
    if (d.re.test(hay)) {
      return { code: d.code, diagnosis: d.diagnosis, hint: d.hint, retryable: false, upstreamCode: code || null };
    }
  }
  return { code: '', diagnosis: null, hint: null, retryable: status === 429 || status >= 500, upstreamCode: code || null };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ────────────────────────── 端点 / 模型 / 适配器判定 ──────────────────────────
const ADAPTER_NAMES = ['openai-compatible', 'anthropic', 'gemini', 'dashscope-legacy'];

/** 从配置里取 base_url（各家字段名不统一） */
function resolveBaseUrl(cfg) {
  const raw = cfg.base_url || cfg.endpoint || cfg.api_base || cfg.apiBase || cfg.url || '';
  return String(raw).trim();
}

/**
 * 适配器判定优先级：
 *   1. 显式 config.adapter / adapter 字段
 *   2. provider_type 精确等于某个 adapter 名
 *   3. base_url 特征（anthropic.com / generativelanguage.googleapis.com / dashscope 的 /api/v1/services/）
 *   4. 兜底 openai-compatible（豆包 Ark / DeepSeek / Ollama / vLLM / one-api 都走这条）
 */
function detectAdapter(cfg, provider) {
  const declared = String(cfg.adapter || (provider && provider.adapter) || '').trim();
  if (ADAPTER_NAMES.includes(declared)) return declared;
  const ptype = String((provider && provider.provider_type) || '').toLowerCase();
  if (ADAPTER_NAMES.includes(ptype)) return ptype;

  const base = resolveBaseUrl(cfg).toLowerCase();
  if (base.includes('anthropic.com')) return 'anthropic';
  if (base.includes('generativelanguage.googleapis.com')) return 'gemini';
  // DashScope 有**两种**协议，必须按 base_url 区分（只看 provider_type 会全错）：
  //   原生   /api/v1/services/aigc/text-generation/generation → dashscope-legacy
  //   兼容   /compatible-mode/v1/chat/completions             → openai-compatible
  if (base.includes('/api/v1/services/aigc/')) return 'dashscope-legacy';
  if (base.includes('dashscope.aliyuncs.com') || base.includes('dashscope-intl')) {
    return /compatible-mode|\/v1\/chat\/completions/.test(base) ? 'openai-compatible' : 'dashscope-legacy';
  }
  if (ptype.includes('anthropic')) return 'anthropic';
  if (ptype.includes('gemini')) return 'gemini';
  if (ptype === 'dashscope-legacy' || ptype === 'dashscope') return 'dashscope-legacy';
  return 'openai-compatible';
}

/**
 * 模型名解析顺序：显式入参 → configs.model → configs.endpoint_id（豆包 Ark 用 ep-xxx）
 * → configs.model_name → provider_name 本身（Ollama 常用 provider 名当模型）
 */
function resolveModel(cfg, explicit, provider) {
  const cand = explicit || cfg.model || cfg.endpoint_id || cfg.model_name || cfg.modelName;
  if (cand) return String(cand);
  return String((provider && (provider.provider_name || '')) || '');
}

/** 密钥解析：apikey / api_key / access_key / secret（部分厂商配置键名不同） */
function resolveApiKey(cfg) {
  const cand = cfg.api_key || cfg.apiKey || cfg.apikey || cfg.access_key || cfg.secret || cfg.token;
  if (!cand) return '';
  const s = String(cand).trim();
  // 掩码值 / 空值不算有密钥
  if (!s || s === '********') return '';
  return s;
}

function asConfigObject(provider) {
  const out = {};
  for (const c of (provider && provider.configs) || []) {
    if (c && c.key) out[c.key] = c.value;
  }
  return out;
}

// ────────────────────────────────── 各家适配器 ──────────────────────────────────
// 每个 adapter 只负责：buildRequest(cfg, req) → { url, headers, body }，以及 parseResponse(json) → { content, toolCalls, usage }
const ADAPTERS = {
  'openai-compatible': {
    build(cfg, req) {
      let url = resolveBaseUrl(cfg);
      if (!url) url = 'https://api.openai.com/v1';
      if (!/\/chat\/completions$/.test(url)) url = url.replace(/\/+$/, '') + '/chat/completions';
      const messages = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      for (const m of req.messages || []) messages.push({ role: m.role, content: m.content });
      const body = { model: req.model, messages, temperature: req.temperature, max_tokens: req.maxTokens };
      if (req.tools && req.tools.length) {
        body.tools = req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } } }));
        body.tool_choice = 'auto';
      }
      if (req.jsonSchema) {
        body.response_format = typeof req.jsonSchema === 'string'
          ? { type: 'json_object' }
          : { type: 'json_schema', json_schema: { name: req.jsonSchema.name || 'result', schema: req.jsonSchema.schema || {}, strict: !!req.jsonSchema.strict } };
      }
      return { url, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.__key}` }, body };
    },
    parse(json) {
      const msg = (json.choices && json.choices[0] && json.choices[0].message) || {};
      const toolCalls = (msg.tool_calls || []).map(tc => ({
        id: tc.id,
        name: (tc.function && tc.function.name) || '',
        arguments: safeParseJson((tc.function && tc.function.arguments) || '{}'),
      }));
      return { content: msg.content == null ? '' : msg.content, toolCalls, usage: normalizeUsage(json.usage) };
    },
  },

  'anthropic': {
    build(cfg, req) {
      let url = resolveBaseUrl(cfg);
      if (!url) url = 'https://api.anthropic.com';
      if (!/\/v1\/messages$/.test(url)) url = url.replace(/\/v1\/messages$/, '').replace(/\/+$/, '') + '/v1/messages';
      const messages = (req.messages || []).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
      const body = {
        model: req.model,
        max_tokens: req.maxTokens || 4096,
        messages,
        temperature: req.temperature,
      };
      if (req.system) body.system = req.system;
      if (req.tools && req.tools.length) {
        body.tools = req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters || { type: 'object', properties: {} } }));
      }
      return {
        url,
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.__key, 'anthropic-version': cfg.anthropic_version || '2023-06-01' },
        body,
      };
    },
    parse(json) {
      const blocks = json.content || [];
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
      const toolCalls = blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, arguments: b.input || {} }));
      return { content: text, toolCalls, usage: normalizeUsage({ input_tokens: json.usage && json.usage.input_tokens, output_tokens: json.usage && json.usage.output_tokens }) };
    },
  },

  gemini: {
    build(cfg, req) {
      let base = resolveBaseUrl(cfg);
      if (!base) base = 'https://generativelanguage.googleapis.com/v1beta';
      base = base.replace(/\/models.*$/, '');
      const url = `${base}/models/${encodeURIComponent(req.model)}:generateContent`;
      const contents = (req.messages || [])
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const body = { contents, generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens } };
      if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
      if (req.jsonSchema) body.generationConfig.responseMimeType = 'application/json';
      return { url: `${url}?key=${encodeURIComponent(cfg.__key)}`, headers: { 'Content-Type': 'application/json' }, body };
    },
    parse(json) {
      const cand = (json.candidates && json.candidates[0]) || {};
      const parts = (cand.content && cand.content.parts) || [];
      const text = parts.filter(p => p.text).map(p => p.text).join('');
      const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({ id: 'fc-' + i, name: p.functionCall.name, arguments: p.functionCall.args || {} }));
      return { content: text, toolCalls, usage: normalizeUsage({ input_tokens: json.usageMetadata && json.usageMetadata.promptTokenCount, output_tokens: json.usageMetadata && json.usageMetadata.candidatesTokenCount }) };
    },
  },

  'dashscope-legacy': {
    build(cfg, req) {
      let url = resolveBaseUrl(cfg);
      if (!url) url = 'https://dashscope.aliyuncs.com';
      if (!/\/services\/aigc\/text-generation\/generation$/.test(url)) {
        if (url.includes('/services/')) url = url.replace(/\/+$/, '');
        else url = url.replace(/\/+$/, '') + '/api/v1/services/aigc/text-generation/generation';
      }
      const messages = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      for (const m of req.messages || []) messages.push({ role: m.role, content: m.content });
      const body = {
        model: req.model,
        input: { messages },
        parameters: { result_format: 'message', temperature: req.temperature, max_tokens: req.maxTokens },
      };
      if (req.jsonSchema) body.parameters.result_format = 'message';
      return { url, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.__key}` }, body };
    },
    parse(json) {
      const msg = (json.output && json.output.choices && json.output.choices[0] && json.output.choices[0].message) || {};
      return { content: msg.content == null ? '' : msg.content, toolCalls: [], usage: normalizeUsage(json.usage) };
    },
  },
};

// ──────────────────────────────── 归一化工具 ────────────────────────────────
function safeParseJson(s) {
  try { return JSON.parse(s); } catch (e) { return { _raw: String(s).slice(0, 200) }; }
}

/** 各家 usage 字段名不同，统一成 { inputTokens, outputTokens, totalTokens } */
function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const pick = (...keys) => {
    for (const k of keys) { const v = u[k]; if (typeof v === 'number') return v; }
    return 0;
  };
  const inputTokens = pick('input_tokens', 'prompt_tokens', 'promptTokenCount', 'inputTokens');
  const outputTokens = pick('output_tokens', 'completion_tokens', 'candidatesTokenCount', 'outputTokens');
  const totalTokens = pick('total_tokens', 'totalTokens') || (inputTokens + outputTokens);
  return { inputTokens, outputTokens, totalTokens };
}

function maskSecret(s) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= 12) return '***';
  return str.slice(0, 6) + '***' + str.slice(-4);
}

// ──────────────────────────────── 调用账本 ────────────────────────────────
let logQueue = Promise.resolve();
function writeCallLog(row) {
  if (!LOG_ENABLED) return;
  const { pool } = require('../database/db');
  logQueue = logQueue.then(async () => {
    try {
      await pool.query(
        `INSERT INTO ai_call_log
           (purpose, provider_id, provider_name, adapter, model, caller, ok,
            error_code, error_message, input_tokens, output_tokens, total_tokens,
            latency_ms, attempts, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())`,
        [row.purpose || null, row.providerId || null, row.providerName || null, row.adapter || null,
         String(row.model || '').slice(0, 160) || null, row.caller || null, !!row.ok,
         row.errorCode || null, String(row.errorMessage || '').slice(0, MAX_ERRMSG) || null,
         row.usage ? row.usage.inputTokens : 0, row.usage ? row.usage.outputTokens : 0, row.usage ? row.usage.totalTokens : 0,
         row.latencyMs || 0, row.attempts || 1]
      );
    } catch (e) {
      // 表可能还没迁移（首次启动顺序）——只告警一次，绝不影响主流程
      if (!writeCallLog._warned) { writeCallLog._warned = true; console.warn('[llmClient] ai_call_log 写入失败（账本不可用）:', e.message); }
    }
  }).catch(() => {});
  return logQueue;
}

// ──────────────────────────────── 主调用 ────────────────────────────────
/**
 * @param {object} o
 * @param {number|string} [o.providerId]   指定 provider；不给则由 resolver 按 purpose 选
 * @param {string}  [o.model]
 * @param {Array<{role,content}>} o.messages
 * @param {string}  [o.system]
 * @param {number}  [o.temperature] [o.maxTokens]
 * @param {Array}   [o.tools]       OpenAI 形状 [{name,description,parameters}]
 * @param {object|string} [o.jsonSchema]
 * @param {string}  [o.purpose]      plan | tool_select | summary | tag | custom ...
 * @param {string}  [o.caller]       调用方标识（写账本用）
 * @param {number}  [o.timeoutMs] [o.retries]
 * @returns {Promise<{ok:boolean, content:string, toolCalls:Array, usage:object, raw:*, adapter:string, attempts:number, latencyMs:number, providerId:*, providerName:string, model:string, error?:string, errorCode?:string}>}
 */
async function chat(o) {
  const started = Date.now();
  const purpose = o.purpose || 'custom';
  const caller = o.caller || '';
  const retries = Number.isInteger(o.retries) ? o.retries : DEFAULT_RETRIES;
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : DEFAULT_TIMEOUT_MS;

  // 1) 解析 provider
  let provider = null;
  if (o.provider !== undefined && o.provider !== null) provider = o.provider;
  else if (o.providerId !== undefined && o.providerId !== null) provider = await providerService.getProvider(o.providerId, true);
  else {
    const resolver = require('./llmProviderResolver');
    const picked = await resolver.resolveProvider(purpose);
    if (!picked) throw new LlmNoProviderError();
    provider = picked;
  }
  if (!provider) throw new LlmNoProviderError();
  if (provider.is_enabled === false) throw new LlmNoProviderError(`提供商「${provider.display_name || provider.provider_name}」未启用`);

  const cfg = asConfigObject(provider);
  const apiKey = resolveApiKey(cfg);
  if (!apiKey) throw new LlmNoProviderError(`提供商「${provider.display_name || provider.provider_name}」没有可用密钥（api_key 为空或仍是 ********）`);
  cfg.__key = apiKey;

  const adapterName = detectAdapter(cfg, provider);
  const adapter = ADAPTERS[adapterName];
  const model = resolveModel(cfg, o.model, provider);

  const req = {
    model,
    messages: o.messages || [],
    system: o.system,
    temperature: Number.isFinite(o.temperature) ? o.temperature : 0.3,
    maxTokens: Number(o.maxTokens) > 0 ? Number(o.maxTokens) : 2000,
    tools: o.tools,
    jsonSchema: o.jsonSchema,
  };
  const built = adapter.build(cfg, req);

  // 2) 发送 + 退避重试（429 / 5xx / 网络错误；**超时与 4xx 不重试**）
  let attempts = 0;
  let lastErr = null;
  while (attempts <= retries) {
    attempts++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(built.url, {
        method: 'POST',
        headers: built.headers,
        body: JSON.stringify(built.body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { _raw: text.slice(0, 500) }; }

      if (!res.ok) {
        const diag = describeUpstreamError(res.status, json);
        const retryable = res.status === 429 || res.status >= 500;
        lastErr = new LlmHttpError(res.status, json, {
          retryable, provider: provider.provider_name,
          // 上游方言 → 可执行诊断（用户/AI 看到的不是裸 403）
          upstreamCode: diag.upstreamCode,
          diagnosis: diag.diagnosis, hint: diag.hint, actionable: !!diag.diagnosis,
        });
        if (retryable && attempts <= retries) { await sleep(RETRY_BASE_MS * Math.pow(2, attempts - 1)); continue; }
        throw lastErr;
      }

      const parsed = adapter.parse(json);
      const latencyMs = Date.now() - started;
      const out = {
        ok: true, content: parsed.content, toolCalls: parsed.toolCalls, usage: parsed.usage,
        raw: json, adapter: adapterName, attempts, latencyMs,
        providerId: provider.id, providerName: provider.provider_name, model,
      };
      writeCallLog({ purpose, providerId: provider.id, providerName: provider.provider_name, adapter: adapterName, model, caller, ok: true, usage: parsed.usage, latencyMs, attempts });
      return out;
    } catch (e) {
      clearTimeout(timer);
      // 超时：明确不重试（重试只会拖长用户等待）
      if (e && (e.name === 'AbortError' || e.code === 'LLM_TIMEOUT')) {
        const te = new LlmTimeoutError(timeoutMs);
        te.provider = provider.provider_name;
        writeCallLog({ purpose, providerId: provider.id, providerName: provider.provider_name, adapter: adapterName, model, caller, ok: false, errorCode: te.code, errorMessage: te.message, latencyMs: Date.now() - started, attempts });
        throw te;
      }
      lastErr = e;
      const retryable = e instanceof LlmHttpError ? !!e.retryable : true;   // 网络层错误（fetch failed）可重试
      if (!retryable || attempts > retries) break;
      await sleep(RETRY_BASE_MS * Math.pow(2, attempts - 1));
    }
  }

  const msg = lastErr && lastErr.message ? lastErr.message : '未知错误';
  writeCallLog({ purpose, providerId: provider.id, providerName: provider.provider_name, adapter: adapterName, model, caller, ok: false, errorCode: (lastErr && lastErr.code) || 'LLM_ERROR', errorMessage: msg, latencyMs: Date.now() - started, attempts });
  throw lastErr instanceof LlmError
    ? lastErr
    : new LlmError(msg, { code: 'LLM_ERROR', provider: provider.provider_name, cause: lastErr });
}

/** 只做探活（后台「测试连接」用）：发一个 1 字的 user 消息 */
async function ping(o) {
  return chat(Object.assign({ maxTokens: 16, temperature: 0, purpose: 'ping', caller: 'ping' }, o, {
    messages: [{ role: 'user', content: 'ping' }],
  }));
}

module.exports = {
  chat,
  ping,
  // 以下为测试与其它模块复用
  ADAPTERS,
  ADAPTER_NAMES,
  detectAdapter,
  describeUpstreamError,
  resolveBaseUrl,
  resolveModel,
  resolveApiKey,
  normalizeUsage,
  maskSecret,
  LlmError,
  LlmTimeoutError,
  LlmHttpError,
  LlmNoProviderError,
  version: 1,
  __testing: { sleep, writeCallLog },
};
