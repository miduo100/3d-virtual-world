/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * sfxKeyProbe.js —— 「这个 Key 到底能不能用来生成音效」的一键探针
 *
 * 为什么需要：
 *   火山有两套服务、两套 Key 体系：
 *     · 火山方舟 Ark   ark.cn-beijing.volces.com   Authorization: Bearer
 *     · 豆包语音      openspeech.bytedance.com      X-Api-Key
 *   方舟控制台的 API Key 权限选「全部」，指的是**方舟项目下的全部资源**，
 *   不包含豆包语音这个**独立云产品**。所以「权限给的是全部」≠「能调语音」。
 *
 *   而且 Ark 的 404 错误码同时覆盖「模型不存在」和「没权限」，光看错误码分不出来。
 *   这个探针用**对照组**的办法把结论坐实：
 *     步骤 1 拿 Key 调方舟 chat → 通了说明 Key 本身有效（排除「Key 填错/已失效」）
 *     步骤 2 拿同一个 Key 调 openspeech → 不通说明缺的是**语音产品权限**，不是 Key 的问题
 *
 * 探针不写库、不改配置，只做只读探测。
 */
'use strict';

const providerService = require('./aiProviderService');

/** 极短的探针提示词：够验通链路，又尽量少计费 */
const PROBE_PROMPT = 'a short soft click';

/**
 * 探一个 Key。
 * @param {string} apiKey  待测的 Key（明文）
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=30000]
 * @returns {Promise<object>} 结论对象
 */
async function probeKey(apiKey, opts = {}) {
  const timeoutMs = opts.timeoutMs || 30000;
  const key = String(apiKey || '').trim();
  const result = {
    ok: false,
    keyLength: key.length,
    steps: [],
    conclusion: '',
    action: '',
  };

  if (!key || key === '********') {
    result.conclusion = '没有可用的 Key';
    result.action = '先在后台填入 API Key';
    return result;
  }
  const call = async (url, init) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
      const raw = Buffer.from(await res.arrayBuffer());
      const ct = String(res.headers.get('content-type') || '');
      let json = null;
      if (ct.includes('json') || /^\s*[{[]/.test(raw.toString('utf8'))) {
        try { json = JSON.parse(raw.toString('utf8')); } catch (e) { json = null; }
      }
      return { status: res.status, json, raw, ct };
    } finally {
      clearTimeout(timer);
    }
  };

  // ── 步骤 1：方舟 chat（对照组，验证 Key 本身有效）──
  // ⚠️ model 不能硬编码模型名：模型会下线（doubao-lite-32k-240828 已是 Shutdown 状态），
  //   硬编码会让对照组误报「Key 无效」。优先用调用方传入的接入点/模型，
  //   拿不到就退而求其次找库里已启用的 chat provider 的 endpoint_id / model。
  let arkOk = false;
  let arkNote = '';
  let arkModel = opts.arkModel || '';
  if (!arkModel) {
    try {
      const all = await providerService.getAllProviders();
      const chatP = (all || []).find(p =>
        p.is_enabled !== false
        && String(p.provider_type || '').split(',').map(t => t.trim()).includes('chat'));
      if (chatP) {
        const full = await providerService.getProvider(chatP.id, true);
        const c = {};
        for (const x of (full.configs || [])) if (x && x.key) c[x.key] = x.value;
        arkModel = c.endpoint_id || c.model || '';
      }
    } catch (e) { /* 找不到就跳过对照组 */ }
  }
  try {
    if (!arkModel) {
      arkNote = '跳过（找不到可用的方舟接入点，无法做对照）';
    } else {
      const r = await call('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: arkModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 4,
        }),
      });
      arkOk = r.status === 200 && !!(r.json && r.json.choices);
      arkNote = arkOk
        ? 'Key 本身有效（方舟对话正常返回，接入点 ' + arkModel + '）'
        : '方舟对话 HTTP ' + r.status + ' ' + String((r.json && (r.json.error && r.json.error.message || r.json.message)) || '').slice(0, 120);
    }
  } catch (e) {
    arkNote = '方舟对话探测异常：' + e.message;
  }
  result.steps.push({ name: '方舟对话（对照组）', ok: arkOk, detail: arkNote });

  // ── 步骤 2：豆包语音 openspeech（真正的测试目标）──
  let speechOk = false;
  let speechNote = '';
  let speechCode = '';
  try {
    const r = await call('https://openspeech.bytedance.com/api/v3/tts/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': key,
        'X-Api-Request-Id': require('crypto').randomUUID(),
      },
      body: JSON.stringify({
        model: 'seed-audio-1.0',
        text_prompt: PROBE_PROMPT,
        audio_config: { format: 'mp3', sample_rate: 24000 },
      }),
    });
    speechCode = r.json && r.json.code != null ? String(r.json.code) : '';
    const hasAudio = !!(r.json && r.json.audio);
    speechOk = r.status === 200 && hasAudio;
    speechNote = speechOk
      ? '豆包语音可用（已实际生成测试音频）'
      : '豆包语音 HTTP ' + r.status + ' ' + speechCode + ' '
        + String((r.json && r.json.message) || '').slice(0, 140);
  } catch (e) {
    speechNote = '豆包语音探测异常：' + e.message;
  }
  result.steps.push({ name: '豆包语音（openspeech）', ok: speechOk, detail: speechNote, code: speechCode });

  // ── 结论 ──
  if (speechOk) {
    result.ok = true;
    result.conclusion = '这个 Key 可以直接用于音效生成';
    result.action = '把它填进后台「豆包音频生成」的 api_key，启用即可';
  } else if (arkOk && speechCode === '45000010') {
    result.conclusion = 'Key 本身有效，但没有豆包语音权限';
    result.action = '两种解法：'
      + '（1）去豆包语音控制台单独建一个 Key（最快）：'
      + 'https://console.volcengine.com/speech/new/setting/apikeys ；'
      + '（2）给这个 Key 所属的 IAM 用户加豆包语音权限策略：'
      + 'https://console.volcengine.com/iam/identitymanage/user 。'
      + '注意「编辑 API Key」里的权限下拉只管方舟项目内的资源，跨产品必须去 IAM 加策略。';
  } else if (!arkOk) {
    result.conclusion = '这个 Key 连方舟对话都调不通 —— Key 本身可能填错了或已失效';
    result.action = '核对 Key 是否复制完整、有没有被禁用或删除';
  } else {
    result.conclusion = '豆包语音返回了非预期错误（code ' + (speechCode || '未知') + '）';
    result.action = '按错误码查文档：https://docs.volcengine.com/docs/6561/2534853?lang=zh';
  }
  return result;
}

/**
 * 探一个已注册的 provider（从库里读 Key，自动解密）。
 * @param {number|string} providerId
 */
async function probeProvider(providerId) {
  const provider = await providerService.getProvider(providerId, true);
  if (!provider) {
    return { ok: false, steps: [], conclusion: 'provider 不存在', action: '' };
  }
  const cfg = {};
  for (const c of (provider.configs || [])) if (c && c.key) cfg[c.key] = c.value;
  const r = await probeKey(cfg.api_key);
  r.providerName = provider.provider_name;
  return r;
}

module.exports = { probeKey, probeProvider, PROBE_PROMPT };
