/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * sfxDiagnoseRoute.js —— 音效生成接入诊断
 *
 * 为什么需要这个接口：
 *   音效生成的失败模式太隐蔽——Key 填了、配置校验通过，但真正调用才报错。
 *   而报错的成因有好几种（Key 无效 / 没开通语音权限 / 模型没邀测 / base_url 填错），
 *   每种的解法都不一样。用户不该去猜。
 *   这个接口一次把所有可能性跑一遍，直接给出「下一步该去哪做什么」。
 *
 * 挂载：server.js  app.use('/api/sound-scenes/sfx', ...) 内部
 * 鉴权：管理员
 */
'use strict';

const express = require('express');
const { authenticateAdminToken } = require('../middleware/adminAuth');
const providerService = require('../services/aiProviderService');
const sfxClient = require('../services/sfxClient');
const sfxKeyProbe = require('../services/sfxKeyProbe');

const router = express.Router();

/** 语音产品的开通入口（诊断结果里直接给出，省得用户自己找） */
const CONSOLE_LINKS = {
  speechConsole: 'https://console.volcengine.com/speech/new/',
  speechApiKeys: 'https://console.volcengine.com/speech/new/setting/apikeys',
  iamUsers: 'https://console.volcengine.com/iam/identitymanage/user',
  arkApiKeys: 'https://ark.volcengine.com/region:cn-beijing/apiKey',
};

/**
 * GET /api/sound-scenes/sfx/diagnose
 * 诊断音效生成的接入状态，逐项给结论。
 */
router.get('/diagnose', authenticateAdminToken, async (req, res) => {
  const checks = [];

  // ① 找出所有 sfx 类型的 provider（不管启用与否——禁用了也是要诊断的对象）
  let sfxRows = [];
  try {
    const all = await providerService.getAllProviders();
    sfxRows = (all || []).filter(p =>
      String(p.provider_type || '').split(',').map(t => t.trim()).includes('sfx'));
  } catch (e) {
    checks.push({ name: '读取服务商配置', ok: false, detail: e.message });
  }

  checks.push({
    name: '音效服务商已注册',
    ok: sfxRows.length > 0,
    detail: sfxRows.length
      ? '找到 ' + sfxRows.length + ' 条 sfx provider：' + sfxRows.map(p => p.provider_name).join(', ')
      : '数据库里没有 provider_type=sfx 的记录（跑一下迁移脚本 add_sfx_provider_doubao_seed_audio.sql）',
  });

  if (!sfxRows.length) {
    return res.json({
      success: false, ok: false, checks, links: CONSOLE_LINKS,
      summary: '还没有注册音效服务商，跑一下迁移脚本 add_sfx_provider_doubao_seed_audio.sql',
    });
  }

  // ② 取第一条（多注册时以第一条为准，后台可切换）
  let provider = null;
  try {
    provider = await providerService.getProvider(sfxRows[0].id, true);
  } catch (e) {
    checks.push({ name: '读取服务商配置', ok: false, detail: e.message });
  }

  if (provider) {
    const cfg = {};
    for (const c of (provider.configs || [])) if (c && c.key) cfg[c.key] = c.value;

    checks.push({
      name: '音效服务商已启用',
      ok: provider.is_enabled !== false,
      detail: provider.is_enabled === false
        ? '「' + (provider.display_name || provider.provider_name) + '」当前是禁用状态，请在后台点「启用」'
        : '「' + (provider.display_name || provider.provider_name) + '」已启用',
    });

    const hasKey = !!(cfg.api_key && cfg.api_key !== '********');
    checks.push({
      name: '已填写 API Key',
      ok: hasKey,
      detail: hasKey
        ? '已填（' + String(cfg.api_key).length + ' 字符）'
        : '后台「AI 服务商 → 文字转音效 → 豆包音频生成」的 api_key 还是空的',
    });

    checks.push({
      name: 'API 地址',
      ok: true,
      detail: (cfg.base_url || 'https://openspeech.bytedance.com/api/v3')
        + '（豆包语音控制台的 Key 用这个地址，不要填火山方舟的 ark.cn-beijing.volces.com）',
    });

    // ③ 真实调用（只在「已启用 + 有 Key」时才试，否则没意义）
    if (hasKey && provider.is_enabled !== false) {
      try {
        const r = await sfxClient.ping({ provider });
        checks.push({
          name: '真实调用测试',
          ok: true,
          detail: '成功！已实际生成 1 秒测试音频'
            + (r.durationSec ? '，时长 ' + Number(r.durationSec).toFixed(1) + ' 秒' : '')
            + '，耗时 ' + r.latencyMs + 'ms',
        });
      } catch (e) {
        const diag = e && e.diagnosis ? e.diagnosis : '';
        const hint = e && e.hint ? e.hint : '';
        checks.push({
          name: '真实调用测试',
          ok: false,
          detail: (diag ? diag + '：' : '') + (e && e.message ? e.message : '调用失败')
            + (hint ? '　→　' + hint : ''),
          errorCode: e && e.code ? e.code : '',
        });
      }
    } else {
      checks.push({
        name: '真实调用测试',
        ok: false,
        detail: '跳过（' + (!hasKey ? '还没填 Key' : '服务商未启用') + '）',
      });
    }
  }

  const allOk = checks.every(c => c.ok);
  res.json({
    success: allOk,
    ok: allOk,
    checks,
    links: CONSOLE_LINKS,
    summary: allOk
      ? '音效生成已就绪，可以去「音效库 → ④ AI 生成声音」生成第一条'
      : '按上面标红（❌）的项逐个处理，处理完再点一次「测试连接」',
  });
});

/**
 * POST /api/sound-scenes/sfx/probe-key
 * body: { apiKey }  或 { fromProvider: 'bytedance_doubao' }（复用库里某个 provider 的 Key）
 *
 * 探针：用「对照组」的办法判断一把 Key 到底能不能生成音效。
 *   步骤1 调方舟 chat → 通了 = Key 本身有效
 *   步骤2 调豆包语音    → 不通 = 缺的是语音产品权限（不是 Key 的问题）
 *
 * ⚠️ 步骤2 会真实生成一段极短测试音频，**产生少量费用**。
 */
router.post('/probe-key', authenticateAdminToken, async (req, res) => {
  const body = req.body || {};
  let apiKey = String(body.apiKey || '').trim();

  // 从库里复用某个 provider 的 Key（比如想试现有的方舟 Key 能不能用）
  if (!apiKey && body.fromProvider) {
    try {
      const all = await providerService.getAllProviders();
      const hit = (all || []).find(p => p.provider_name === body.fromProvider);
      if (hit) {
        const full = await providerService.getProvider(hit.id, true);
        const cfg = {};
        for (const c of (full.configs || [])) if (c && c.key) cfg[c.key] = c.value;
        apiKey = String(cfg.api_key || '').trim();
      }
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请提供 apiKey 或 fromProvider' });
  }

  try {
    const r = await sfxKeyProbe.probeKey(apiKey);
    res.json(Object.assign({ success: r.ok }, r));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
