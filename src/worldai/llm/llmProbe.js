/**
 * LLM 三档探活（AI World Brain · Phase 2a · 队列项 2a-2 · P1-2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 规格来源：主文档 §Phase 2 验收 P1-2 + §H.9.2 硬约束 3（窗口用实测值回填 context_window_tokens）。
 *
 * 三档：
 *   ① 连通 connect()    —— 一个 16 token 的小对话真调用，证明 Key/模型/端点真的能通；
 *   ② 窗口 window()    —— **max_tokens=1 的单请求**阶梯试探（4k/8k/16k/32k，命中即停），
 *      命中值回填 world_ai_configs.context_window_tokens（只用于装配预算，保守更安全，故不做精确二分）；
 *   ③ 能力 capability() —— tools（function calling）与 json_schema 各一次最小请求。
 *
 * 成本纪律（提示词 §五）：输出恒为 1~32 token；窗口阶梯命中即停；升序最多 4 次；
 * 探活只允许管理员手动触发，绝不在自动循环里调用。
 *
 * ★ 上游账户问题（欠费/无权限/端点关闭）→ 走 llmClient.describeUpstreamError 的结构化诊断，
 *   **绝不 500、绝不空白**（与 Phase 0 P0-5 同口径）。
 */
'use strict';

const llmClient = require('../../services/llmClient');
const providerService = require('../../services/aiProviderService');
const providerRouter = require('./providerRouter');
const worldAiConfig = require('../config');

/**
 * 窗口探测阶梯（token）。
 * ★ 由大到小：命中即停 → 拿到的是"能成功返回的**最大**输入"（§H.9.2 硬约束 3 的口径）。
 *   若升序（4k→32k）探测，命中的是"最小可用值"：豆包实测会被写成 4096，
 *   而装配预算 = 窗口 − 输出预留(8k) 会变成负数 → promptBuilder 每次都直接报错，装配无法工作。
 *   最大 3 次请求（输出恒为 1 token），成本可控。
 */
const WINDOW_LADDER = [16384, 8192, 4096];

const CONNECT_TIMEOUT_MS = 20000;
const WINDOW_TIMEOUT_MS = 45000;
const CAPABILITY_TIMEOUT_MS = 25000;

/** 填充文本：纯 ASCII，按 "4 字符 ≈ 1 token" 构造到目标 token 数 */
function buildFiller(targetTokens) {
  const unit = 'WORLD-AI-CONTEXT-WINDOW-PROBE-0123456789abcdefghijklmnopqrstuvwxyz ';
  const need = Math.max(64, Number(targetTokens) || 64) * 4;
  let s = '';
  while (s.length < need) s += unit;
  return s.slice(0, need);
}

/**
 * 把任意异常翻译成结构化诊断（绝不把上游方言抛给前端）。
 *
 * 两层：
 *   ① 先用 llmClient.describeUpstreamError 认厂商方言（欠费/无模型/Key 失效…）——它认得时才给"可执行"诊断；
 *   ② **认不出来也必须给可读诊断**（P1-2硬要求：绝不 500、绝不空白）——按 HTTP 状态给通用排查提示。
 */
const GENERIC_BY_STATUS = {
  400: { code: 'UPSTREAM_BAD_REQUEST', diagnosis: '厂商拒绝了这次请求（HTTP 400）：通常是模型名/endpoint 与账号不匹配，或报文格式不被该端点支持', hint: '到「系统配置 → AI提供商」核对该厂商的 base_url 与模型名；豆包需 ep- 接入点、OpenAI 兼容需 /compatible-mode 之类路径' },
  401: { code: 'UPSTREAM_BAD_KEY', diagnosis: '鉴权失败（HTTP 401）：API Key 无效、已过期或没放在正确的配置项里', hint: '回「系统配置 → AI提供商」重新填入密钥并保存' },
  403: { code: 'UPSTREAM_FORBIDDEN', diagnosis: '没有权限（HTTP 403）：Key 有效但无权访问该模型/接口，或账号欠费', hint: '到厂商控制台确认该 Key 的模型权限与账单状态' },
  404: { code: 'UPSTREAM_NO_MODEL', diagnosis: '接口或模型不存在（HTTP 404）：base_url 路径与协议不匹配，或模型名/endpoint_id 写错', hint: '核对 base_url（如 DashScope 兼容模式要带 /compatible-mode/v1）与模型名；豆包要填 ep- 开头的接入点' },
  408: { code: 'UPSTREAM_TIMEOUT', diagnosis: '厂商侧超时（HTTP 408）', hint: '稍后重试' },
  413: { code: 'UPSTREAM_TOO_LARGE', diagnosis: '请求体过大（HTTP 413）', hint: '减小上下文窗口或输出上限' },
  422: { code: 'UPSTREAM_BAD_REQUEST', diagnosis: '厂商拒绝了这次请求（HTTP 422）：参数不合法', hint: '检查模型名与报文结构' },
  429: { code: 'UPSTREAM_RATE_LIMIT', diagnosis: '被厂商限流（HTTP 429）', hint: '降低并发或稍后重试' },
};

function diagnose(e) {
  let status = (e && e.status) || 0;
  if (!status && e && e.code) {
    const m = String(e.code).match(/LLM_HTTP_(\d+)/);
    if (m) status = Number(m[1]);
  }
  let d = null;
  if (status && llmClient.describeUpstreamError) {
    try { d = llmClient.describeUpstreamError(status, (e && e.body) || null); } catch (x) { d = null; }
  }
  if (e && e.diagnosis) {
    d = { code: e.upstreamCode || e.code || 'LLM_ERROR', diagnosis: e.diagnosis, hint: e.hint || null, retryable: !!e.retryable };
  }
  if (!d || !d.diagnosis) {
    // ②兜底：认不出方言也要给可读诊断（P1-2：绝不空白）
    const g = GENERIC_BY_STATUS[status];
    if (g) d = { code: g.code, diagnosis: g.diagnosis, hint: g.hint, retryable: status === 429 || status >= 500 };
    else if (e && e.name === 'LlmTimeoutError') d = { code: 'LLM_TIMEOUT', diagnosis: '调用超时（厂商在规定时间内没返回）', hint: '检查网络，或调大超时；也可先探活窗口档看是否是输入过大', retryable: true };
    else if (status >= 500) d = { code: 'UPSTREAM_SERVER_ERROR', diagnosis: `厂商服务端错误（HTTP ${status}）`, hint: '稍后重试；连续出现说明该厂商当前不可用，可在后台换一家', retryable: true };
    else d = { code: (e && e.code) || 'PROBE_ERROR', diagnosis: `调用失败${status ? '（HTTP ' + status + '）' : ''}：${String((e && e.message) || e || '未知错误').slice(0, 160)}`, hint: '查看服务端日志与厂商控制台', retryable: false };
  }
  return {
    code: d.code || 'PROBE_ERROR',
    status: status || 0,
    message: String((e && e.message) || e || '未知错误').slice(0, 300),
    diagnosis: d.diagnosis || null,
    hint: d.hint || null,
    accountIssue: !!(d && d.diagnosis),
  };
}

/** 档位开关：body.stages 可只跑其中几档（省调用成本） */
function stageList(stages) {
  const all = ['connect', 'window', 'capability'];
  if (!Array.isArray(stages) || !stages.length) return all;
  return all.filter(s => stages.includes(s));
}

async function runConnect(provider, model) {
  const started = Date.now();
  const r = await llmClient.chat({
    provider, model,
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 16, temperature: 0,
    purpose: 'ping', caller: 'world_ai_test_connect',
    retries: 0, timeoutMs: CONNECT_TIMEOUT_MS,
  });
  return {
    ok: true,
    model: r.model, adapter: r.adapter,
    latencyMs: Date.now() - started,
    usage: r.usage,
    sample: String(r.content || '').slice(0, 40),
  };
}

async function runWindow(provider, model, ladder) {
  const tried = [];
  for (const step of ladder) {
    const prompt = buildFiller(step);
    try {
      await llmClient.chat({
        provider, model,
        messages: [{ role: 'user', content: '请只回复一个字：好\n\n' + prompt }],
        maxTokens: 1, temperature: 0,
        purpose: 'ping', caller: 'world_ai_test_window',
        retries: 0, timeoutMs: WINDOW_TIMEOUT_MS,
      });
      tried.push({ tokens: step, ok: true });
      return { ok: true, contextWindowTokens: step, tried, note: '命中即停（保守值，仅用于装配预算）' };
    } catch (e) {
      const d = diagnose(e);
      tried.push({ tokens: step, ok: false, code: d.code, status: d.status });
      // 账户/权限/端点类问题：换更大的输入也一定失败，直接停并给诊断
      if (d.accountIssue || d.status === 401 || d.status === 403) {
        return { ok: false, contextWindowTokens: null, tried, diagnosis: d };
      }
      // 其它（429/5xx/超时/网络）：不算"窗口不够"，继续下一档但不再多试
    }
  }
  return {
    ok: false, contextWindowTokens: null, tried,
    diagnosis: { code: 'WINDOW_PROBE_UNRESOLVED', diagnosis: '窗口探测未得出结论（多为网络抖动或限流）', hint: '稍后重试；未回填时装配按保守 16k 计算' },
  };
}

async function runCapability(provider, model) {
  const out = { tools: null, jsonSchema: null };
  try {
    const r = await llmClient.chat({
      provider, model,
      messages: [{ role: 'user', content: '请调用 noop 工具。' }],
      tools: [{ name: 'noop', description: '探活用空工具', parameters: { type: 'object', properties: {} } }],
      maxTokens: 32, temperature: 0,
      purpose: 'ping', caller: 'world_ai_test_cap_tools',
      retries: 0, timeoutMs: CAPABILITY_TIMEOUT_MS,
    });
    out.tools = { supported: true, calledBack: Array.isArray(r.toolCalls) && r.toolCalls.length > 0 };
  } catch (e) {
    const d = diagnose(e);
    // ★ 不中断：能力档的两项探测互相独立（不支持 tools ≠ 不支持 json_schema），
    //   即使是账户级失败也要把 json_schema 的结论带回去，便于一次看清。
    out.tools = { supported: false, code: d.code, status: d.status, diagnosis: d.diagnosis };
  }
  try {
    const r = await llmClient.chat({
      provider, model,
      messages: [{ role: 'user', content: '返回 ok=true 的 JSON。' }],
      jsonSchema: { name: 'probe', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } },
      maxTokens: 32, temperature: 0,
      purpose: 'ping', caller: 'world_ai_test_cap_json',
      retries: 0, timeoutMs: CAPABILITY_TIMEOUT_MS,
    });
    out.jsonSchema = { supported: true, sample: String(r.content || '').slice(0, 60) };
  } catch (e) {
    const d = diagnose(e);
    out.jsonSchema = { supported: false, code: d.code, status: d.status, diagnosis: d.diagnosis };
  }
  return out;
}

/**
 * 主入口：跑指定档位并汇总。
 * @param {object} o { providerId?, model?, purpose?, stages?, ladder?, writeBack? }
 * @returns {Promise<object>} 永远 resolve；失败时 ok=false + diagnosis，绝不抛上游方言
 */
async function probe(o) {
  const opts = o || {};
  const stages = stageList(opts.stages);
  const result = {
    ok: false,
    providerId: null,
    providerName: null,
    model: null,
    adapter: null,
    stages: {},
    contextWindowTokens: null,
    wroteBack: false,
    diagnosis: null,
    hint: null,
    startedAt: new Date().toISOString(),
  };

  // 1) 取 provider：显式 providerId → 否则按 purpose 走用途级路由（§H.10.2）
  let provider = null;
  if (opts.providerId) {
    provider = await providerService.getProvider(Number(opts.providerId), true);
    result.routeSource = 'explicit';
    if (!provider) {
      result.diagnosis = { code: 'PROVIDER_NOT_FOUND', diagnosis: `找不到 provider_id=${opts.providerId}`, hint: '到「系统配置 → AI提供商」确认该厂商仍在库中' };
      return result;
    }
  } else {
    const r = await providerRouter.resolve(opts.purpose || 'plan');
    provider = r.provider;
    result.routeSource = r.source;
    result.reason = r.reason;
    if (!provider) {
      result.diagnosis = { code: 'NO_PROVIDER', diagnosis: '没有任何可用 provider（未启用或缺密钥）', hint: '到「系统配置 → AI提供商」启用厂商并填入密钥' };
      return result;
    }
  }
  result.providerId = provider.id;
  result.providerName = provider.display_name || provider.provider_name;

  if (provider.is_enabled === false) {
    result.diagnosis = { code: 'PROVIDER_DISABLED', diagnosis: `厂商「${result.providerName}」已停用`, hint: '启用后再探活（World AI 页不提供停用开关，请到 AI 提供商页操作）' };
    return result;
  }

  // 2) 逐档执行
  const model = opts.model || null;
  let fatal = null;

  if (stages.includes('connect')) {
    try {
      result.stages.connect = await runConnect(provider, model);
      result.model = result.stages.connect.model;
      result.adapter = result.stages.connect.adapter;
    } catch (e) {
      const d = diagnose(e);
      result.stages.connect = { ok: false, ...d };
      result.diagnosis = d;
      result.hint = d.hint;
      fatal = e; // 连通都不通，后两档没有意义
    }
  }

  if (!fatal && stages.includes('window')) {
    try {
      const w = await runWindow(provider, model, Array.isArray(opts.ladder) && opts.ladder.length ? opts.ladder : WINDOW_LADDER);
      result.stages.window = w;
      if (w.ok) {
        result.contextWindowTokens = w.contextWindowTokens;
        try {
          const cur = await worldAiConfig.getConfig();
          if (!cur || Number(cur.context_window_tokens) !== Number(w.contextWindowTokens)) {
            await worldAiConfig.updateConfig({ context_window_tokens: w.contextWindowTokens });
            result.wroteBack = true;
          }
        } catch (e) {
          result.stages.window.writeBackError = e.message;
        }
      } else {
        result.diagnosis = result.diagnosis || w.diagnosis;
        result.hint = (w.diagnosis && w.diagnosis.hint) || result.hint;
      }
    } catch (e) {
      const d = diagnose(e);
      result.stages.window = { ok: false, ...d };
      result.diagnosis = result.diagnosis || d;
    }
  }

  if (!fatal && stages.includes('capability')) {
    try {
      result.stages.capability = await runCapability(provider, model);
    } catch (e) {
      const d = diagnose(e);
      result.stages.capability = { ok: false, ...d };
      if (!result.diagnosis) { result.diagnosis = d; result.hint = d.hint; }
    }
  }

  // 3) 汇总：有档位成功且无账户级阻断即算通
  const anyOk = Object.keys(result.stages).some(k => result.stages[k] && result.stages[k].ok === true);
  const accountBlocked = !!(result.diagnosis && result.diagnosis.accountIssue);
  result.ok = anyOk && !accountBlocked;
  if (!result.ok && !result.diagnosis) {
    result.diagnosis = { code: 'PROBE_FAILED', diagnosis: '探活未通过', hint: '查看各档明细' };
  }
  result.stagesRun = stages;
  return result;
}

module.exports = {
  probe,
  buildFiller,
  diagnose,
  stageList,
  WINDOW_LADDER,
};