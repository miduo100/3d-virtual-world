/**
 * adminWorldBrain.js — 管理后台「🧠 AI 世界大脑」页面（Phase 2a · 队列项 1）
 *
 * 独立成文件原因：admin.html 黑名单 >500 行，只允许接线式标记（nav/page 容器/分派分支）。
 * 本模块自带 sub-tab bar 与「设置」容器，注入 #page-ai-world-brain（空容器，page-gallery 同款）。
 *
 * 范围（队列项 1）：总闸/世界级自主度/模型参数/用途级 provider_map 选择器/System Prompt/
 *                   预算与风险策略/凭证管理（创建·轮换·暂停·恢复·吊销）。
 * 不在本项：config/test-llm 探活、GET /usage 健康度（队列项 2）；区域与建设（3.5）。
 *
 * 铁律（§H.10.1）：厂商与 API Key 只在「系统配置 → 🤖 AI提供商」维护；
 * 本页只写 provider 引用（provider_map），绝不出现 Key 输入框。
 * API：/api/world-ai/{config, credentials, credentials/:id/{rotate,pause,resume}, auth/exchange}
 * 暴露全局：window.adminWorldBrain（switchSubTab 懒加载钩子调 loadSettings）
 */
(function () {
  'use strict';

  const API = '/api/world-ai';
  const PAGE_ID = 'page-ai-world-brain';
  const AUTONOMY = ['managed', 'semi_autonomous', 'autonomous'];
  const AUTONOMY_LABEL = {
    managed: '① managed — 只按我下的指令干活',
    semi_autonomous: '② semi_autonomous — 建完可自己补细节，不许拆东西',
    autonomous: '③ autonomous — 可自己提改动提案（须谨慎）',
  };
  const SCOPES = ['world:observe', 'world:plan', 'world:build', 'world:gameplay', 'world:analyze', 'world:rollback', 'world:configure'];
  const PURPOSES = ['plan', 'tool_select', 'summary'];
  const PURPOSE_LABEL = { plan: '规划（推理最强）', tool_select: '工具选择', summary: '摘要（最便宜）' };

  const $ = (id) => document.getElementById(id);
  const token = () => localStorage.getItem('adminToken') || '';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function jreq(method, url, body) {
    const opts = { method, headers: { 'Authorization': 'Bearer ' + token() } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    let j = null;
    try { j = await r.json(); } catch (e) { /* 非 JSON */ }
    if (!r.ok) throw new Error((j && (j.error || j.message)) || ('HTTP ' + r.status));
    return j || {};
  }

  function showMsg(text, ok) {
    const el = $('awb-save-msg');
    if (!el) return;
    el.style.display = 'block';
    el.style.background = ok ? 'rgba(0,255,0,0.08)' : 'rgba(255,68,68,0.12)';
    el.style.color = ok ? 'var(--green)' : 'var(--red)';
    el.style.border = ok ? '1px solid rgba(0,255,0,0.2)' : '1px solid rgba(255,68,68,0.3)';
    el.textContent = text;
    if (ok) setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  // ==================== DOM 注入 ====================
  function buildDom() {
    const page = $(PAGE_ID);
    if (!page || page.dataset.awbBuilt === '1') return;
    page.dataset.awbBuilt = '1';

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;margin-bottom:18px;border-bottom:1px solid var(--border);padding-bottom:0;';
    bar.innerHTML = '<button class="sub-tab active" onclick="switchSubTab(\'ai-world-brain\',\'awb-settings\',this)">⚙️ 设置</button>';
    page.appendChild(bar);

    const wrap = document.createElement('div');
    wrap.id = 'ai-world-brain-sub-awb-settings';
    wrap.className = 'sub-page';
    wrap.innerHTML = [
      card('awb-基础', '🧠 基础开关', [
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">',
        '  <input type="checkbox" id="awb-enabled"> <b>World AI 总闸（enabled）</b>',
        '</label>',
        '<small style="color:var(--muted);display:block;margin:6px 0 14px;">总闸只做读写与展示；调度/状态机属 Phase 2b。</small>',
        '<div class="form-group"><label>世界级自主度（上限；区域级可更严，实际取两者较严）</label>',
        AUTONOMY.map((a, i) =>
          '<label style="display:flex;align-items:center;gap:6px;margin:4px 0;cursor:pointer;">' +
          '<input type="radio" name="awb-autonomy" value="' + a + '"' + (i === 0 ? '' : '') + '> ' + AUTONOMY_LABEL[a] + '</label>').join(''),
        '</div>',
        '<div class="form-row">',
        '  <div class="form-group"><label>默认模型（model，可空=跟随所选厂商默认）</label><input type="text" id="awb-model" maxlength="150" placeholder="如 doubao-pro-32k"></div>',
        '  <div class="form-group"><label>温度 temperature（0~2）</label><input type="number" id="awb-temperature" step="0.1" min="0" max="2"></div>',
        '  <div class="form-group"><label>单轮最大输出 max_tokens</label><input type="number" id="awb-max-tokens" step="100" min="100" max="128000"></div>',
        '</div>',
      ].join('')),
      card('awb-providers', '🔌 用途级厂商选择（provider_map）', [
        '<small style="color:var(--muted);display:block;margin-bottom:10px;">厂商与 API Key 只在 <b>系统配置 → 🤖 AI提供商</b> 维护；本页只选择「哪个用途用哪一家」。留空 = 自动（候选链兜底）。规划与工具选择必须同一家（P1-14，队列项 2 起强校验）。</small>',
        '<div class="form-row" id="awb-provider-row"></div>',
      ].join('')),
      card('awb-prompt', '📝 System Prompt（世界大脑的人设与硬规则）', [
        '<textarea id="awb-system-prompt" rows="5" style="width:100%;" maxlength="20000" placeholder="示例：你是创世虚拟世界的管理员 AI，负责按区域规划与建设…"></textarea>',
      ].join('')),
      card('awb-risk', '🛡️ 风险策略与预算', [
        '<div class="form-row">',
        '  <div class="form-group"><label>低风险动作</label><select id="awb-risk-low"><option value="auto">自动执行</option><option value="approve">需审批</option></select></div>',
        '  <div class="form-group"><label>中风险动作</label><select id="awb-risk-medium"><option value="auto">自动执行</option><option value="approve">需审批</option></select></div>',
        '  <div class="form-group"><label>高风险动作</label><select id="awb-risk-high"><option value="approve" selected>需审批</option><option value="auto">自动执行</option></select></div>',
        '</div>',
        '<div class="form-row">',
        '  <div class="form-group"><label>单轮工具上限 toolsPerRun</label><input type="number" id="awb-tools-per-run" min="1"></div>',
        '  <div class="form-group"><label>单轮新建物体上限 newObjectsPerRun</label><input type="number" id="awb-new-objects" min="1"></div>',
        '  <div class="form-group"><label>每日 LLM 调用上限 llmCallsPerDay</label><input type="number" id="awb-llm-per-day" min="1"></div>',
        '  <div class="form-group"><label>每日 token 上限 tokensPerDay</label><input type="number" id="awb-tokens-per-day" min="1000" step="1000"></div>',
        '</div>',
        '<div class="form-row">',
        '  <div class="form-group"><label>观察间隔 observeMin（分钟）</label><input type="number" id="awb-observe-min" min="1"></div>',
        '  <div class="form-group"><label>规划间隔 planHours（小时）</label><input type="number" id="awb-plan-hours" min="1"></div>',
        '  <div class="form-group"><label>优化间隔 optimizeHours（小时）</label><input type="number" id="awb-optimize-hours" min="1"></div>',
        '  <div class="form-group"><label>上下文窗口 tokens（可空，队列项2 实测回填）</label><input type="number" id="awb-context-window" min="1024" placeholder="留空=按 16k 保守计"></div>',
        '</div>',
      ].join('')),
      '<div style="display:flex;gap:12px;align-items:center;margin:14px 0 4px;">',
      '  <button class="btn btn-primary" id="awb-save-btn" onclick="window.adminWorldBrain.save()">💾 保存设置</button>',
      '  <div id="awb-save-msg" style="display:none;padding:6px 12px;border-radius:5px;font-size:12px;"></div>',
      '</div>',
      card('awb-cred', '🔑 World AI 凭证（与 Agent Key 分离）', [
        '<small style="color:var(--muted);display:block;margin-bottom:10px;">这是「世界大脑自己」的服务端凭证（world:* scope），不是外部 AI 进场的 Agent Key。明文 Key 只在创建/轮换时显示一次。</small>',
        '<div class="form-row">',
        '  <div class="form-group"><label>凭证名称</label><input type="text" id="awb-cred-name" maxlength="120" placeholder="如 runtime-primary"></div>',
        '  <div class="form-group" style="flex:2;"><label>scope（默认 world:observe + world:rollback）</label>',
        '    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">' +
        SCOPES.map((s) => '<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;"><input type="checkbox" class="awb-cred-scope" value="' + s + '"' + (s === 'world:observe' || s === 'world:rollback' ? ' checked' : '') + '> ' + s + '</label>').join('') +
        '  </div></div>',
        '</div>',
        '<button class="btn btn-primary" id="awb-cred-create" onclick="window.adminWorldBrain.createCredential()">＋ 创建凭证</button>',
        '<div id="awb-cred-keybox" style="display:none;margin:12px 0;padding:10px;border:1px solid var(--yellow, #eab308);border-radius:5px;background:rgba(234,179,8,0.06);"></div>',
        '<div id="awb-cred-list" style="margin-top:14px;"></div>',
      ].join('')),
    ].join('');
    page.appendChild(wrap);

    $('awb-save-btn') && ($('awb-save-btn').onclick = save);
    $('awb-cred-create').addEventListener('click', () => createCredential());
  }

  function card(id, title, inner) {
    return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + title + '</div></div>' + inner + '</div>';
  }

  // ==================== 数据加载 ====================
  let providers = [];

  async function loadSettings() {
    buildDom();
    try {
      const [cfgRes, provRes] = await Promise.all([
        jreq('GET', API + '/config'),
        fetch('/api/ai-providers/providers').then((r) => r.json()).catch(() => ({})),
      ]);
      providers = (provRes && provRes.providers) || [];
      fillProviderRow(cfgRes.config || {});
      fillConfig(cfgRes.config || {});
      await loadCredentials();
    } catch (e) {
      showMsg('加载失败: ' + e.message, false);
    }
  }

  function fillProviderRow(cfg) {
    const row = $('awb-provider-row');
    if (!row) return;
    const map = cfg.providerMap || {};
    row.innerHTML = PURPOSES.map((p) => {
      const opts = ['<option value="">自动（候选链兜底）</option>']
        .concat(providers.map((pv) => '<option value="' + pv.id + '"' + (Number(map[p]) === Number(pv.id) ? ' selected' : '') + '>' + esc(pv.display_name || pv.provider_name || ('#' + pv.id)) + '</option>'));
      return '<div class="form-group"><label>' + PURPOSE_LABEL[p] + '（' + p + '）</label><select id="awb-pm-' + p + '">' + opts.join('') + '</select></div>';
    }).join('');
  }

  function fillConfig(c) {
    $('awb-enabled').checked = !!c.enabled;
    const radio = document.querySelector('input[name="awb-autonomy"][value="' + (AUTONOMY.includes(c.autonomy) ? c.autonomy : 'managed') + '"]');
    if (radio) radio.checked = true;
    $('awb-model').value = c.model || '';
    $('awb-temperature').value = c.temperature != null ? c.temperature : 0.4;
    $('awb-max-tokens').value = c.maxTokens != null ? c.maxTokens : 4000;
    $('awb-system-prompt').value = c.systemPrompt || '';
    const rp = c.riskPolicy || {};
    $('awb-risk-low').value = rp.low || 'auto';
    $('awb-risk-medium').value = rp.medium || 'auto';
    $('awb-risk-high').value = rp.high || 'approve';
    const b = c.budget || {};
    $('awb-tools-per-run').value = b.toolsPerRun != null ? b.toolsPerRun : 12;
    $('awb-new-objects').value = b.newObjectsPerRun != null ? b.newObjectsPerRun : 20;
    $('awb-llm-per-day').value = b.llmCallsPerDay != null ? b.llmCallsPerDay : 60;
    $('awb-tokens-per-day').value = b.tokensPerDay != null ? b.tokensPerDay : 2000000;
    const s = c.schedule || {};
    $('awb-observe-min').value = s.observeMin != null ? s.observeMin : 10;
    $('awb-plan-hours').value = s.planHours != null ? s.planHours : 6;
    $('awb-optimize-hours').value = s.optimizeHours != null ? s.optimizeHours : 24;
    $('awb-context-window').value = c.contextWindowTokens != null ? c.contextWindowTokens : '';
  }

  async function save() {
    const autonomyEl = document.querySelector('input[name="awb-autonomy"]:checked');
    if (!autonomyEl) { showMsg('请选择世界级自主度', false); return; }
    const pm = {};
    PURPOSES.forEach((p) => {
      const el = $('awb-pm-' + p);
      if (el && el.value) pm[p] = Number(el.value);
    });
    const body = {
      enabled: $('awb-enabled').checked,
      autonomy: autonomyEl.value,
      model: $('awb-model').value.trim() || null,
      temperature: Number($('awb-temperature').value),
      max_tokens: Number($('awb-max-tokens').value),
      system_prompt: $('awb-system-prompt').value,
      provider_map: pm,
      risk_policy: {
        low: $('awb-risk-low').value,
        medium: $('awb-risk-medium').value,
        high: $('awb-risk-high').value,
      },
      budget: {
        toolsPerRun: Number($('awb-tools-per-run').value),
        newObjectsPerRun: Number($('awb-new-objects').value),
        llmCallsPerDay: Number($('awb-llm-per-day').value),
        tokensPerDay: Number($('awb-tokens-per-day').value),
      },
      schedule: {
        observeMin: Number($('awb-observe-min').value),
        planHours: Number($('awb-plan-hours').value),
        optimizeHours: Number($('awb-optimize-hours').value),
      },
    };
    const cw = $('awb-context-window').value.trim();
    if (cw) body.context_window_tokens = Number(cw);
    try {
      await jreq('PUT', API + '/config', body);
      showMsg('✅ 已保存', true);
    } catch (e) {
      showMsg('保存失败: ' + e.message, false);
    }
  }

  // ==================== 凭证 ====================
  async function loadCredentials() {
    const box = $('awb-cred-list');
    if (!box) return;
    const res = await jreq('GET', API + '/credentials');
    const list = res.credentials || [];
    if (!list.length) { box.innerHTML = '<small style="color:var(--muted);">暂无凭证</small>'; return; }
    const rows = list.map((c) => {
      const actions = [];
      actions.push('<button class="btn" style="padding:3px 8px;font-size:11px;margin-right:6px;" onclick="window.adminWorldBrain.rotateCredential(\'' + c.id + '\')">轮换</button>');
      if (c.status === 'active') {
        actions.push('<button class="btn" style="padding:3px 8px;font-size:11px;margin-right:6px;" onclick="window.adminWorldBrain.setCredential(\'' + c.id + '\',\'pause\')">暂停</button>');
      } else if (c.status === 'paused') {
        actions.push('<button class="btn" style="padding:3px 8px;font-size:11px;margin-right:6px;" onclick="window.adminWorldBrain.setCredential(\'' + c.id + '\',\'resume\')">恢复</button>');
      }
      actions.push('<button class="btn" style="padding:3px 8px;font-size:11px;color:var(--red);" onclick="window.adminWorldBrain.revokeCredential(\'' + c.id + '\')">吊销</button>');
      const statusColor = c.status === 'active' ? 'var(--green)' : (c.status === 'paused' ? 'var(--yellow,#eab308)' : 'var(--red)');
      return '<tr>' +
        '<td style="padding:6px 8px;">' + esc(c.name) + '</td>' +
        '<td style="padding:6px 8px;font-family:monospace;">' + esc(c.keyPrefix) + '…</td>' +
        '<td style="padding:6px 8px;color:' + statusColor + ';">' + esc(c.status) + '</td>' +
        '<td style="padding:6px 8px;font-size:11px;">' + esc((c.scopes || []).join(', ')) + '</td>' +
        '<td style="padding:6px 8px;font-size:11px;">' + (c.usageCount || 0) + ' 次 / ' + (c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : '—') + '</td>' +
        '<td style="padding:6px 8px;white-space:nowrap;">' + actions.join('') + '</td>' +
        '</tr>';
    }).join('');
    box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
      '<tr style="color:var(--muted);text-align:left;"><th style="padding:6px 8px;">名称</th><th style="padding:6px 8px;">前缀</th><th style="padding:6px 8px;">状态</th><th style="padding:6px 8px;">scope</th><th style="padding:6px 8px;">用量</th><th style="padding:6px 8px;">操作</th></tr>' + rows + '</table>';
  }

  function showPlaintext(title, key) {
    const box = $('awb-cred-keybox');
    box.style.display = 'block';
    box.innerHTML = '<b>⚠️ ' + esc(title) + '（仅显示这一次，请立即保存）</b>' +
      '<div style="margin-top:8px;font-family:monospace;user-select:all;word-break:break-all;background:rgba(0,0,0,0.35);padding:8px;border-radius:4px;">' + esc(key) + '</div>' +
      '<small style="color:var(--muted);display:block;margin-top:6px;">库里只存 bcrypt 哈希，关闭后无法再次查看；丢失只能轮换。</small>';
  }

  async function createCredential() {
    const name = $('awb-cred-name').value.trim();
    if (!name) { showMsg('请填写凭证名称', false); return; }
    const scopes = Array.from(document.querySelectorAll('.awb-cred-scope:checked')).map((el) => el.value);
    try {
      const res = await jreq('POST', API + '/credentials', { name, scopes });
      $('awb-cred-name').value = '';
      if (res.rejectedScopes && res.rejectedScopes.length) {
        showMsg('已创建；以下 scope 被安全策略剔除: ' + res.rejectedScopes.join(', '), true);
      } else {
        showMsg('✅ 凭证已创建', true);
      }
      showPlaintext('新凭证 Key', res.key);
      await loadCredentials();
    } catch (e) {
      showMsg('创建失败: ' + e.message, false);
    }
  }

  async function rotateCredential(id) {
    try {
      const res = await jreq('POST', API + '/credentials/' + id + '/rotate');
      showPlaintext('轮换后的新 Key（旧 Key 已失效）', res.key);
      await loadCredentials();
    } catch (e) { showMsg('轮换失败: ' + e.message, false); }
  }

  async function setCredential(id, action) {
    try {
      await jreq('POST', API + '/credentials/' + id + '/' + action);
      await loadCredentials();
    } catch (e) { showMsg('操作失败: ' + e.message, false); }
  }

  async function revokeCredential(id) {
    if (!window.confirm('吊销后该凭证立即失效（保留审计记录）。确定？')) return;
    try {
      await jreq('DELETE', API + '/credentials/' + id);
      await loadCredentials();
    } catch (e) { showMsg('吊销失败: ' + e.message, false); }
  }

  window.adminWorldBrain = {
    loadSettings,
    save,
    createCredential,
    rotateCredential,
    setCredential,
    revokeCredential,
  };

  buildDom();
})();
