/**
 * sfxClient.js —— AI 音效生成客户端（provider_type = 'sfx'）
 *
 * 定位：全项目**音效生成的唯一出口**。跟 llmClient.js 平级但独立——
 *   llmClient  → 文本输出（chat / completion），返回 string
 *   sfxClient  → 二进制音频输出，返回 Buffer
 * 协议和返回契约都不同，硬塞进 llmClient 会把它的适配器体系搞脏。
 *
 * 复用（不重复造轮子）：
 *   - aiProviderService  读 provider 配置 + 解密密钥
 *   - llmProviderResolver 按 purpose='sfx' 选服务商、支持 fallback 链
 *   - ai_call_log       调用账本（复用 llmClient 的写入逻辑）
 *
 * 服务商适配：
 *   doubao_seed_audio（豆包 Seed-Audio 1.0）
 *     POST {base_url}/tts/create
 *     鉴权  X-Api-Key 单头
 *     请求  { model, text_prompt, audio_config:{format,sample_rate,speech_rate,loudness_rate} }
 *     响应  { code, message, audio(base64), duration, original_duration, url }
 *     ⚠️ 返回的是 Base64 字符串，不是二进制流
 *     ⚠️ 音频在服务端保存 7 天，url 有效期 1 小时 → 必须立刻落盘
 *
 * 零新增依赖：Node 18+ 全局 fetch + AbortController（跟 llmClient 一致）。
 */
'use strict';

const providerService = require('./aiProviderService');

const DEFAULT_TIMEOUT_MS = 120000;   // 音效生成比 chat 慢，给足
const DEFAULT_RETRIES = 1;
const RETRY_BASE_MS = 800;
const LOG_ENABLED = process.env.LLM_CALL_LOG !== 'off';
const MAX_ERRMSG = 500;

class SfxError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = 'SfxError';
    this.code = opts.code || 'SFX_ERROR';
    this.status = opts.status || 0;
    this.retryable = !!opts.retryable;
    this.provider = opts.provider || '';
    this.upstreamCode = opts.upstreamCode || '';
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ────────────────────────────── 配置解析 ──────────────────────────────

function asConfigObject(provider) {
  const out = {};
  for (const c of (provider && provider.configs) || []) {
    if (c && c.key) out[c.key] = c.value;
  }
  return out;
}

/** 密钥：SFX 厂商键名不统一（api_key / access_key / token ...） */
function resolveApiKey(cfg) {
  const cand = cfg.api_key || cfg.apiKey || cfg.apikey || cfg.access_key || cfg.secret || cfg.token || cfg.key;
  if (!cand) return '';
  const s = String(cand).trim();
  if (!s || s === '********') return '';
  return s;
}

const OPUS_SPEECH_HOST = 'https://openspeech.bytedance.com';

function resolveBaseUrl(cfg, provider) {
  const raw = cfg.base_url || cfg.endpoint || cfg.api_base || cfg.url || '';
  let url = String(raw || '').trim();
  if (!url && provider) {
    // 豆包语音默认端点
    if (String(provider.provider_name || '').includes('seed_audio')) {
      url = OPUS_SPEECH_HOST + '/api/v3';
    }
  }
  return url.replace(/\/+$/, '');
}

/**
 * 拼完整请求 URL。
 *
 * 用户在后台填 base_url 时很容易填成各种形态：
 *   https://openspeech.bytedance.com/api/v3      （官方文档给的形态）
 *   https://openspeech.bytedance.com             （只填域名）
 *   https://openspeech.bytedance.com/api/v3/tts/create  （直接填了完整端点）
 * 三种都要能认，否则用户填错一个 /api/v3 就 404，而报错信息会是「模型不存在」——
 * 很难往「base_url 填少了」上想。
 *
 * ★ apiPath 参数：别的服务商端点路径不一样（ElevenLabs 是 /v1/sound-generation），
 *   不能一律拼 /api/v3/tts/create。所以：
 *     - apiPath 配了就直接拼在 base_url 后面
 *     - 没配就按豆包语音的规则猜
 */
function buildUrl(baseUrl, apiPath) {
  const b = String(baseUrl || '').replace(/\/+$/, '');
  if (!b) return '';
  // 显式指定了路径（或 base_url 本身就是完整端点）
  if (apiPath) {
    const p = String(apiPath);
    if (/^https?:\/\//i.test(p)) return p;
    return b + (p.startsWith('/') ? p : '/' + p);
  }
  // 已经填了完整端点
  if (/\/tts\/create$/.test(b)) return b;
  // 填到 api/v3 这一层
  if (/\/api\/v3$/.test(b)) return b + '/tts/create';
  // 只填了域名或路径，补全
  if (/\/api\/v\d+$/.test(b)) return b + '/tts/create';
  return b + '/api/v3/tts/create';
}

/**
 * 鉴权头。
 * 各家不一样：
 *   x-api-key   豆包语音 openspeech      X-Api-Key: <key>
 *   bearer      火山方舟 ark              Authorization: Bearer <key>
 *   xi-api-key  ElevenLabs                xi-api-key: <key>
 */
function authHeader(authMode, apiKey) {
  switch (authMode) {
    case 'bearer':
      return { Authorization: 'Bearer ' + apiKey };
    case 'xi-api-key':
      return { 'xi-api-key': apiKey };
    case 'x-api-key':
    default:
      return { 'X-Api-Key': apiKey };
  }
}

function resolveModel(cfg, explicit, provider) {
  // 模型标识：ElevenLabs 叫 model_id，豆包/方舟叫 model。
  // 优先用显式入参，其次按「哪个 provider 形态」取，避免两条链路的字段名互相串味。
  const cand = explicit
    || (cfg.model && !cfg.model_id ? cfg.model : null)
    || cfg.model_id
    || cfg.model
    || cfg.model_name
    || cfg.modelName;
  if (cand) return String(cand);
  return 'seed-audio-1.0';
}

// ────────────────────────────── 调用账本 ──────────────────────────────
// 与 llmClient.writeCallLog 同构：fire-and-forget，失败不阻断主流程
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
            latency_ms, attempts, mission_id, region_key, context_meta, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,0,$10,$11,$12,$13,$14,NOW())`,
        [row.purpose || null, row.providerId || null, row.providerName || null, row.adapter || null,
         String(row.model || '').slice(0, 160) || null, row.caller || null, !!row.ok,
         row.errorCode || null, String(row.errorMessage || '').slice(0, MAX_ERRMSG) || null,
         row.latencyMs || 0, row.attempts || 1,
         row.missionId || null, row.regionKey || null,
         row.contextMeta ? JSON.stringify(row.contextMeta) : null]
      );
    } catch (e) {
      if (!writeCallLog._warned) {
        writeCallLog._warned = true;
        console.warn('[sfxClient] ai_call_log 写入失败（账本不可用）:', e.message);
      }
    }
  }).catch(() => {});
  return logQueue;
}

// ────────────────────────── 上游错误诊断 ──────────────────────────

/** 把上游的各种错误翻译成「用户看得懂、能动手」的提示 */
function describeUpstreamError(status, body) {
  const code = body && (body.code != null ? String(body.code) : (body.error && body.error.code ? String(body.error.code) : ''));
  const msg = body && (body.message || (body.error && body.error.message)) || '';
  let diagnosis = '';
  let hint = '';

  if (code === '45000010' || /Invalid X-Api-Key/i.test(msg)) {
    diagnosis = 'API Key 无效';
    hint = '豆包语音的 Key 与火山方舟的 Key 不是同一套。请到「豆包语音控制台 → API Key 管理」获取，并确认已填入后台「豆包音频生成」的 api_key。';
  } else if (status === 403) {
    diagnosis = '没有该模型的访问权限';
    hint = '请到火山引擎控制台确认账号已开通 seed-audio-1.0 的使用权限（部分模型需提交申请）。';
  } else if (status === 404) {
    diagnosis = '模型或接口地址不存在';
    hint = '确认 base_url 填的是 https://openspeech.bytedance.com/api/v3（豆包语音），不是火山方舟 ark.cn-beijing.volces.com。';
  } else if (status === 429) {
    diagnosis = '请求过于频繁或额度不足';
    hint = '稍后重试；若持续失败请检查火山引擎账户余额与限流配额。';
  } else if (status >= 500) {
    diagnosis = '上游服务暂时不可用';
    hint = '豆包侧服务波动，稍后重试。';
  }
  return { upstreamCode: code, diagnosis, hint, actionable: !!diagnosis };
}

// ────────────────────────────── 核心生成 ──────────────────────────────

/**
 * 生成音效。
 * @param {object} o
 * @param {string}  o.prompt        提示词（音效描述）
 * @param {number} [o.durationSec]  期望时长（秒），写进提示词里引导模型
 * @param {number} [o.sampleRate]   输出采样率，默认 44100
 * @param {string} [o.format]       输出格式 mp3/wav/pcm/ogg_opus，默认 mp3
 * @param {string} [o.model]        覆盖 provider 配置里的模型
 * @param {object} [o.provider]     指定 provider；不给则 resolver 按 purpose='sfx' 选
 * @param {number} [o.providerId]
 * @param {number} [o.timeoutMs] [o.retries]
 * @param {string} [o.caller]       调用方标识（写账本）
 * @returns {Promise<{ok:boolean, buffer:Buffer, format:string, durationSec:number, providerName:string, model:string, latencyMs:number, attempts:number, raw:object}>}
 */
async function generate(o = {}) {
  const started = Date.now();
  const purpose = 'sfx';
  const caller = o.caller || 'sfxGenerate';
  const retries = Number.isInteger(o.retries) ? o.retries : DEFAULT_RETRIES;
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : DEFAULT_TIMEOUT_MS;

  const prompt = String(o.prompt || '').trim();
  if (!prompt) {
    throw new SfxError('提示词不能为空', { code: 'SFX_BAD_REQUEST' });
  }

  // 1) 解析 provider
  let provider = null;
  if (o.provider) provider = o.provider;
  else if (o.providerId != null) provider = await providerService.getProvider(o.providerId, true);
  else {
    const resolver = require('./llmProviderResolver');
    provider = await resolver.resolveProvider(purpose);
  }
  if (!provider) {
    throw new SfxError(
      '没有可用的音效生成服务商。请到后台「AI 服务商 → 文字转音效」配置 API Key 并启用。',
      { code: 'SFX_NO_PROVIDER' }
    );
  }
  if (provider.is_enabled === false) {
    throw new SfxError(
      `音效生成服务商「${provider.display_name || provider.provider_name}」未启用`,
      { code: 'SFX_NO_PROVIDER' }
    );
  }

  const cfg = asConfigObject(provider);
  const apiKey = resolveApiKey(cfg);
  if (!apiKey) {
    throw new SfxError(
      `音效生成服务商「${provider.display_name || provider.provider_name}」没有可用密钥（api_key 为空或仍是 ********）`,
      { code: 'SFX_NO_PROVIDER' }
    );
  }

  const baseUrl = resolveBaseUrl(cfg, provider);
  if (!baseUrl) {
    throw new SfxError('音效生成服务商缺少 base_url 配置', { code: 'SFX_BAD_CONFIG' });
  }
  const url = buildUrl(baseUrl, cfg.api_path || cfg.apiPath);
  if (!url) {
    throw new SfxError('音效生成服务商缺少 base_url 配置', { code: 'SFX_BAD_CONFIG' });
  }
  const model = resolveModel(cfg, o.model, provider);
  const format = String(o.format || cfg.format || 'mp3');
  const sampleRate = Number(o.sampleRate || cfg.sample_rate || 44100);

  // 2) 组请求体
  //    时长引导：Seed-Audio 没有独立的 duration 参数，靠提示词描述 + 末尾时间标记控制
  const dur = Number(o.durationSec) > 0 ? Number(o.durationSec) : 0;
  let textPrompt = prompt;
  if (dur > 0 && !/\d+\s*(秒|second)/i.test(textPrompt)) {
    textPrompt = textPrompt.replace(/\s*$/, '') + `, ${dur} seconds`;
  }

  const body = {
    model,
    text_prompt: textPrompt,
    audio_config: {
      format,
      sample_rate: sampleRate,
    },
  };
  if (o.speechRate != null) body.audio_config.speech_rate = Number(o.speechRate);
  if (o.loudnessRate != null) body.audio_config.loudness_rate = Number(o.loudnessRate);

  // 鉴权方式与请求体形态：按 base_url 自动判定
  //
  // 豆包音频生成有两条可能的接入路径，字段名和鉴权头都不一样：
  //
  //  A) 豆包语音 openspeech（官方文档写法）
  //     URL   POST https://openspeech.bytedance.com/api/v3/tts/create
  //     鉴权  X-Api-Key: <key>（单头）
  //     请求  { model, text_prompt, audio_config:{format,sample_rate} }
  //     响应  { code, message, audio(base64), duration, url }
  //
  //  B) 火山方舟 ark（如果该模型在方舟有接入点）
  //     URL   POST https://ark.cn-beijing.volces.com/api/v3/<音频端点>
  //     鉴权  Authorization: Bearer <key>
  //     请求  { model, prompt / text_prompt, ... }
  //     响应  可能是 { audio(base64) } / { audio_url } / 纯二进制
  //
  //  C) ElevenLabs SFX（音效专用模型）
  //     URL   POST https://api.elevenlabs.io/v1/sound-generation
  //     鉴权  xi-api-key: <key>
  //     请求  { text, duration_seconds, prompt_influence, loop, model_id, output_format }
  //     响应  纯二进制音频流
  //
  // 用户在后台填 base_url 就能决定走哪条；也可用配置项 auth_mode 强制指定。
  //
  // ⚠️ 方舟的 API 域名是 **volces.com**（ark.cn-beijing.volces.com），
  //   不是 volcengine.com（那是火山引擎主站/控制台域名）。
  //   两个都判一下，防止用户填任一种都能识别。
  const isArk = /ark\.[a-z0-9.-]*volces\.com/i.test(baseUrl)
    || /(^|\/\/)ark\./i.test(baseUrl);
  const isEleven = /(^|\/\/)api\.elevenlabs\.io/i.test(baseUrl);
  const authMode = String(cfg.auth_mode || '').trim().toLowerCase()
    || (isArk ? 'bearer' : (isEleven ? 'xi-api-key' : 'x-api-key'));

  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    authHeader(authMode, apiKey)
  );
  if (authMode !== 'xi-api-key') {
    headers['X-Api-Request-Id'] = o.requestId || require('crypto').randomUUID();
  }

  // 方舟侧可能认 prompt，openspeech 认 text_prompt —— 两个都带上，多余字段上游会忽略
  if (authMode === 'bearer') {
    body.prompt = textPrompt;
  }

  // ★ ElevenLabs 用另一套请求体字段名（不是豆包的 text_prompt / audio_config）
  if (isEleven || authMode === 'elevenlabs') {
    delete body.text_prompt;
    delete body.audio_config;
    // ElevenLabs 用 model_id 而不是 model
    delete body.model;
    body.text = prompt;
    const dur = Number(o.durationSec) > 0 ? Number(o.durationSec) : null;
    if (dur) body.duration_seconds = Math.max(0.5, Math.min(30, dur));
    if (o.promptInfluence != null) body.prompt_influence = Number(o.promptInfluence);
    if (o.loop != null) body.loop = !!o.loop;
    // model_id 存在哪都行：cfg.model_id（ElevenLabs 配置项）或 cfg.eleven_model_id
    const elevenModel = cfg.model_id || cfg.eleven_model_id;
    if (elevenModel) body.model_id = String(elevenModel);
    // output_format 决定编码与码率：mp3_22050_32 体积最小（3 秒约 12KB）
    body.output_format = cfg.output_format || 'mp3_22050_32';
  }

  // 3) 发送 + 退避重试
  let attempts = 0;
  let lastErr = null;
  while (attempts <= retries) {
    attempts++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      // 先按二进制读，再看是不是 JSON —— 有些端点直接返回音频流
      const rawBuf = Buffer.from(await res.arrayBuffer());
      const ct = String(res.headers.get('content-type') || '');
      const text = rawBuf.toString('utf8');
      let json = null;
      const looksJson = ct.includes('json') || /^\s*[{[]/.test(text);
      if (looksJson) {
        try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { _raw: text.slice(0, 500) }; }
      }

      if (!res.ok) {
        const diag = describeUpstreamError(res.status, json || {});
        const retryable = res.status === 429 || res.status >= 500;
        const msg = (json && (json.message || (json.error && json.error.message)))
          || (json && json._raw) || ('HTTP ' + res.status);
        lastErr = new SfxError(
          (diag.diagnosis ? diag.diagnosis + '：' : '') + msg,
          { code: 'SFX_HTTP_' + res.status, status: res.status, retryable, provider: provider.provider_name,
            upstreamCode: diag.upstreamCode }
        );
        lastErr.diagnosis = diag.diagnosis;
        lastErr.hint = diag.hint;
        if (retryable && attempts <= retries) { await sleep(RETRY_BASE_MS * Math.pow(2, attempts - 1)); continue; }
        break;
      }

      // 业务错误码：HTTP 200 但 code != 0 也是失败
      if (json && json.code != null && Number(json.code) !== 0) {
        const diag = describeUpstreamError(res.status, json);
        lastErr = new SfxError(
          (diag.diagnosis ? diag.diagnosis + '：' : '') + (json.message || ('code ' + json.code)),
          { code: 'SFX_UPSTREAM_' + json.code, status: res.status, retryable: false,
            provider: provider.provider_name, upstreamCode: diag.upstreamCode }
        );
        lastErr.diagnosis = diag.diagnosis;
        lastErr.hint = diag.hint;
        break;
      }

      // 4) 取音频 —— 兼容多种返回形态：
      //    ① { audio: "<base64>" }      openspeech 官方形态
      //    ② { audio_url / url: "http" } 部分端点给临时链接
      //    ③ 直接返回二进制流            content-type: audio/*
      let buffer = null;
      if (json && json.audio) {
        buffer = Buffer.from(String(json.audio), 'base64');
      } else if (json && (json.audio_url || json.url)) {
        const dl = await fetch(json.audio_url || json.url);
        if (!dl.ok) throw new SfxError('音频下载失败：HTTP ' + dl.status, { code: 'SFX_DOWNLOAD_FAILED', status: dl.status, retryable: true, provider: provider.provider_name });
        buffer = Buffer.from(await dl.arrayBuffer());
      } else if (ct.includes('audio/') || (rawBuf.length > 100 && !looksJson)) {
        // ③ 二进制流
        buffer = rawBuf;
      }
      if (!buffer || !buffer.length) {
        lastErr = new SfxError('上游没有返回音频数据', { code: 'SFX_EMPTY_AUDIO', retryable: false, provider: provider.provider_name });
        break;
      }

      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      const meta = json || {};
      writeCallLog({
        purpose, providerId: provider.id, providerName: provider.provider_name,
        adapter: 'seed-audio', model, caller, ok: true,
        latencyMs, attempts,
        contextMeta: { durationSec: meta.duration || null, originalDuration: meta.original_duration || null, format, sampleRate, authMode },
      });
      return {
        ok: true,
        buffer,
        format,
        sampleRate,
        durationSec: Number(meta.duration) || (Number(meta.original_duration) || null),
        originalDurationSec: Number(meta.original_duration) || null,
        providerName: provider.provider_name,
        providerId: provider.id,
        model,
        authMode,
        latencyMs,
        attempts,
        raw: meta,
      };
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        const te = new SfxError('音效生成超时（' + timeoutMs + 'ms）', { code: 'SFX_TIMEOUT', provider: provider.provider_name });
        writeCallLog({ purpose, providerId: provider.id, providerName: provider.provider_name, adapter: 'seed-audio', model, caller, ok: false, errorCode: te.code, errorMessage: te.message, latencyMs: Date.now() - started, attempts });
        throw te;
      }
      if (e instanceof SfxError) { lastErr = e; if (!e.retryable || attempts > retries) break; }
      else {
        lastErr = new SfxError('网络错误：' + (e && e.message ? e.message : String(e)), { code: 'SFX_NETWORK', retryable: true, provider: provider.provider_name });
      }
      if (attempts > retries) break;
      await sleep(RETRY_BASE_MS * Math.pow(2, attempts - 1));
    }
  }

  const msg = lastErr && lastErr.message ? lastErr.message : '未知错误';
  writeCallLog({
    purpose, providerId: provider.id, providerName: provider.provider_name, adapter: 'seed-audio',
    model, caller, ok: false, errorCode: (lastErr && lastErr.code) || 'SFX_ERROR',
    errorMessage: msg, latencyMs: Date.now() - started, attempts,
  });
  throw lastErr instanceof SfxError ? lastErr : new SfxError(msg, { code: 'SFX_ERROR' });
}

/**
 * 探活（后台「测试连接」用）：生成一个极短的音效，只验链路通不通。
 * 注意：这会真的调一次生成接口，**会产生费用**。
 */
async function ping(o = {}) {
  return generate(Object.assign({
    purpose: 'sfx', caller: 'ping',
    prompt: 'a short soft click',
    durationSec: 1,
    format: 'mp3',
    sampleRate: 24000,
    timeoutMs: 60000,
    retries: 0,
  }, o));
}

module.exports = {
  generate,
  ping,
  SfxError,
  describeUpstreamError,
};
