/**
 * adminWorldBrain.js — 管理后台「🧠 AI 世界大脑」页面（Phase 2a · 队列项 1）
 *
 * 独立成文件原因：admin.html 黑名单 >500 行，只允许接线式标记（nav/page 容器/分派分支）。
 * 本模块自带 sub-tab bar 与「设置」容器，注入 #page-ai-world-brain（空容器，page-gallery 同款）。
 *
 * 范围（队列项 1）：总闸/世界级自主度/模型参数/用途级 provider_map 选择器/System Prompt/
 *                   预算与风险策略/凭证管理（创建·轮换·暂停·恢复·吊销）。
 * 队列项 2 追加：厂商探活（POST config/test-llm 三档，队列项 2）+ 「📊 用量与健康度」面板（GET /usage）。
 * 不在本项：Runtime 状态机与熔断执行（2b）；区域与建设（3.5）。
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
  const AUTONOMY_DESC = {
    managed: '只按我下的指令干活（委托需手动执行）',
    semi_autonomous: '建完可自己补细节（绿化/路灯），不许拆东西',
    autonomous: '可自己提改动提案（high 风险仍要审批，须谨慎）',
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

  // ==================== DOM 注入（版式 = admin_world_brain_preview.html p6「设置」页签：
  //                      顶部运行状态条 + 两栏（大模型 | 权限与风险）+ System Prompt + 凭证） ====================
  function buildDom() {
    const page = $(PAGE_ID);
    if (!page || page.dataset.awbBuilt === '1') return;
    page.dataset.awbBuilt = '1';

    const style = document.createElement('style');
    style.textContent = [
      '#page-ai-world-brain .awb-topbar{display:flex;align-items:center;gap:14px;background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:10px 16px;margin-bottom:16px;flex-wrap:wrap}',
      '#page-ai-world-brain .awb-dot{width:9px;height:9px;border-radius:50%;background:var(--red);box-shadow:0 0 8px var(--red);display:inline-block}',
      '#page-ai-world-brain .awb-dot.on{background:var(--green);box-shadow:0 0 8px var(--green)}',
      '#page-ai-world-brain .awb-topbar .sp{flex:1}',
      '#page-ai-world-brain .awb-cols{display:grid;grid-template-columns:1.6fr 1fr;gap:12px;margin-bottom:12px}',
      '@media(max-width:1100px){#page-ai-world-brain .awb-cols{grid-template-columns:1fr}}',
      '#page-ai-world-brain .awb-panel{background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:16px}',
      '#page-ai-world-brain .awb-panel h3{font-size:14px;margin-bottom:12px;color:var(--text)}',
      '#page-ai-world-brain .awb-field{margin-bottom:14px}',
      '#page-ai-world-brain .awb-field>label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}',
      '#page-ai-world-brain .awb-inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '#page-ai-world-brain .awb-panel input[type=text],#page-ai-world-brain .awb-panel input[type=number],#page-ai-world-brain .awb-panel select{background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:7px 10px;font:inherit}',
      '#page-ai-world-brain .awb-panel input[type=number]{width:96px}',
      '#page-ai-world-brain .awb-panel textarea{width:100%;background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:10px;color:var(--text);font:inherit;padding:12px;resize:vertical;min-height:84px}',
      '#page-ai-world-brain .awb-tag{font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(0,0,0,0.3);color:var(--muted);display:inline-block}',
      '#page-ai-world-brain .awb-tag.g{background:var(--green-dim);color:var(--green)}',
      '#page-ai-world-brain .awb-tag.a{background:rgba(255,140,0,.12);color:var(--orange)}',
      '#page-ai-world-brain .awb-radio{display:flex;flex-direction:column;gap:8px}',
      '#page-ai-world-brain .awb-radio label{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:10px;cursor:pointer;margin:0}',
      '#page-ai-world-brain .awb-radio label:has(input:checked){border-color:var(--green);background:var(--green-dim)}',
      '#page-ai-world-brain .awb-radio .d{color:var(--muted);font-size:12px}',
      '#page-ai-world-brain .awb-redline{color:var(--muted);font-size:12px;margin-top:10px;line-height:1.7}',
      '#page-ai-world-brain .awb-scope{display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;border:1px solid var(--border);border-radius:10px;padding:3px 9px}',
      '#page-ai-world-brain .awb-msg{padding:6px 12px;border-radius:5px;font-size:12px;display:none}',
      '#page-ai-world-brain details.awb-adv{margin:4px 0 10px}',
      '#page-ai-world-brain details.awb-adv summary{cursor:pointer;color:var(--muted);font-size:12px;margin-bottom:8px}',
    ].join('');
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;margin-bottom:18px;border-bottom:1px solid var(--border);padding-bottom:0;';
    bar.innerHTML = '<button class="sub-tab active" onclick="switchSubTab(\'ai-world-brain\',\'awb-settings\',this)">⚙️ 设置</button>';
    page.appendChild(bar);

    // ── 顶部运行状态条（原型 topbar）──
    const topbar = document.createElement('div');
    topbar.className = 'awb-topbar';
    topbar.innerHTML =
      '<span class="awb-dot" id="awb-dot"></span><b id="awb-run-txt">World AI 已关闭</b>' +
      '<span class="sp"></span>' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">' +
      '<input type="checkbox" id="awb-enabled" style="accent-color:var(--green)"> 启用总闸（enabled）</label>' +
      '<button id="awb-save-btn" style="background:var(--green);color:#08130c;font-weight:600;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;">💾 保存设置</button>' +
      '<div id="awb-save-msg" class="awb-msg"></div>';
    page.appendChild(topbar);

    const wrap = document.createElement('div');
    wrap.id = 'ai-world-brain-sub-awb-settings';
    wrap.className = 'sub-page';
    wrap.innerHTML =
      // ── 两栏：大模型 | 权限与风险（原型 .cols）──
      '<div class="awb-cols">' +
        '<div class="awb-panel"><h3>🤖 大模型</h3>' +
          '<div class="awb-field"><label>Provider（复用现有「系统配置 → 🤖 AI提供商」，本页不存任何 Key）</label>' +
            '<select id="awb-pm-plan" style="width:100%;"></select></div>' +
          '<div class="awb-field"><label>摘要 / 工具选择用哪家（默认跟随规划；规划与工具选择必须同一家）</label>' +
            '<div class="awb-inline"><span class="awb-tag">摘要</span><select id="awb-pm-summary"></select>' +
            '<span class="awb-tag">工具选择</span><select id="awb-pm-tool_select"></select></div></div>' +
          '<div class="awb-field"><label>默认模型（可空 = 跟随所选厂商默认）· 温度 · 单轮最大输出</label>' +
            '<div class="awb-inline"><input type="text" id="awb-model" maxlength="150" placeholder="如 doubao-pro-32k" style="flex:1;min-width:150px;">' +
            '<input type="number" id="awb-temperature" step="0.1" min="0" max="2" title="温度">' +
            '<input type="number" id="awb-max-tokens" step="100" min="100" max="128000" title="单轮最大输出"></div></div>' +
          '<div class="awb-field"><label>每日预算</label>' +
            '<div class="awb-inline">token ≤ <input type="number" id="awb-tokens-per-day" min="1000" step="1000">' +
            'LLM 调用 ≤ <input type="number" id="awb-llm-per-day" min="1"> 次/天</div></div>' +
          '<details class="awb-adv"><summary>▸ 高级参数（单轮工具/物体上限 · 调度间隔 · 上下文窗口）</summary>' +
            '<div class="awb-inline" style="margin-bottom:8px;">单轮工具 ≤ <input type="number" id="awb-tools-per-run" min="1">' +
            ' 单轮物体 ≤ <input type="number" id="awb-new-objects" min="1"></div>' +
            '<div class="awb-inline">观察 <input type="number" id="awb-observe-min" min="1"> 分 · 规划 <input type="number" id="awb-plan-hours" min="1"> 时 · 优化 <input type="number" id="awb-optimize-hours" min="1"> 时 · 上下文窗口 <input type="number" id="awb-context-window" min="1024" placeholder="留空=16k"></div>' +
          '</details>' +
          '<div class="awb-field" style="margin-bottom:0;"><label>熔断</label>' +
            '<span class="awb-tag a">连续 3 次失败自动暂停 + 通知（Phase 2b 生效）</span></div>' +
          '<div class="awb-field" style="margin-top:14px;margin-bottom:0;"><label>厂商探活（三档：连通 / 窗口实测 / 能力）</label>' +
            '<div class="awb-inline"><select id="awb-probe-provider" style="max-width:190px;"></select>' +
            '<button id="awb-probe-btn" style="background:var(--card-bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 12px;cursor:pointer;">🩺 探活</button>' +
            '<span id="awb-probe-out" class="awb-tag">未探活</span></div></div>' +
        '</div>' +
        '<div class="awb-panel"><h3>🛡️ 权限与风险</h3>' +
          '<div class="awb-field"><label>世界级自主度基调（区域可调严，不可调松；实际生效取两者较严）</label>' +
            '<div class="awb-radio">' +
            AUTONOMY.map((a) =>
              '<label><input type="radio" name="awb-autonomy" value="' + a + '">' +
              '<span><b>' + a + '</b><br><span class="d">' + AUTONOMY_DESC[a] + '</span></span></label>').join('') +
            '</div></div>' +
          '<div class="awb-field"><label>风险动作策略（low / medium / high）</label>' +
            '<div class="awb-inline">低 <select id="awb-risk-low"><option value="auto">自动执行</option><option value="approve">需审批</option></select>' +
            ' 中 <select id="awb-risk-medium"><option value="auto">自动执行</option><option value="approve">需审批</option></select>' +
            ' 高 <select id="awb-risk-high"><option value="approve">需审批</option><option value="auto">自动执行</option></select></div></div>' +
          '<div class="awb-field"><label>保护区（代码级硬护栏）</label>' +
            '<div class="awb-inline"><span class="awb-tag g">出生点半径禁建</span><span class="awb-tag g">人工资产只读</span><span class="awb-tag g">传送门/广告位禁删</span></div></div>' +
          '<div class="awb-redline">红线（代码级，不可配置）：AI 不能删改你建的任何东西 · 不能覆盖式搭建 · 不能写代码块 · 不能上传模型 · 不能给自己升自主度。</div>' +
        '</div>' +
      '</div>' +
      // ── System Prompt（全宽）──
      '<div class="awb-panel" style="margin-bottom:12px;"><h3>📝 System Prompt（世界大脑的人设与硬规则）</h3>' +
        '<textarea id="awb-system-prompt" rows="4" maxlength="20000" placeholder="示例：你是创世虚拟世界的管理员 AI，负责按区域规划与建设…"></textarea></div>' +
      // ── 用量与健康度（全宽，读 ai_call_log 聚合）──
      '<div class="awb-panel" style="margin-bottom:12px;"><h3>📊 用量与健康度 <span class="awb-tag">数据源 ai_call_log · 按 Asia/Shanghai 切日</span></h3>' +
        '<div id="awb-usage-box"><small style="color:var(--muted);">加载中…</small></div></div>' +
      // ── 凭证（全宽）──
      '<div class="awb-panel" style="margin-bottom:12px;"><h3>🔑 World AI 凭证 <span class="awb-tag">与 Agent Key 分离 · 明文只显示一次</span></h3>' +
        '<div class="awb-field"><div class="awb-inline">名称 <input type="text" id="awb-cred-name" maxlength="120" placeholder="如 runtime-primary" style="width:180px;">' +
        '<span id="awb-cred-scopes" style="display:flex;gap:6px;flex-wrap:wrap;">' +
        SCOPES.map((s) => '<label class="awb-scope"><input type="checkbox" class="awb-cred-scope" value="' + s + '"' + (s === 'world:observe' || s === 'world:rollback' ? ' checked' : '') + '> ' + s + '</label>').join('') +
        '</span></div></div>' +
        '<button id="awb-cred-create" style="background:var(--green);color:#08130c;font-weight:600;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;">＋ 创建凭证</button>' +
        '<div id="awb-cred-keybox" style="display:none;margin:12px 0;padding:10px;border:1px solid var(--orange);border-radius:10px;background:rgba(255,140,0,0.06);"></div>' +
        '<div id="awb-cred-list" style="margin-top:12px;"></div>' +
      '</div>';
    page.appendChild(wrap);

    $('awb-save-btn').onclick = save;
    $('awb-cred-create').addEventListener('click', () => createCredential());
    $('awb-enabled').addEventListener('change', updateRunDot);
    const probeBtn = $('awb-probe-btn');
    if (probeBtn) probeBtn.addEventListener('click', () => runProbe());
  }

  // ==================== 用量与健康度（只读聚合）====================
  async function loadUsage() {
    const box = $('awb-usage-box');
    if (!box) return;
    try {
      const res = await jreq('GET', API + '/usage?days=7');
      const u = res.usage || {};
      const t = u.today || {};
      const hl = u.health || {};
      const b = u.budgets || {};
      const pct = (a, c) => (c > 0 ? Math.min(100, Math.round((a / c) * 100)) + '%（' + a + '/' + c + '）' : String(a));
      const hlTag = hl.status === 'ok' ? '<span class="awb-tag g">正常</span>'
        : (hl.status === 'idle' ? '<span class="awb-tag">今日无调用</span>' : '<span class="awb-tag a">降级（失败率 ' + (hl.todayFailRate || 0) + '%）</span>');
      const rows = (u.byProvider || []).slice(0, 5).map(p =>
        '<tr><td style="padding:4px 8px;">' + esc(p.provider_name) + '</td>' +
        '<td style="padding:4px 8px;">' + p.calls + ' 次</td>' +
        '<td style="padding:4px 8px;color:' + (p.failed ? 'var(--red)' : 'inherit') + ';">失败 ' + p.failed + '</td>' +
        '<td style="padding:4px 8px;">' + Number(p.tokens || 0) + ' token</td></tr>').join('');
      const errs = (u.recentErrors || []).slice(0, 3).map(e =>
        '<li>' + esc(new Date(e.created_at).toLocaleString()) + ' · ' + esc(e.provider_name || '-') + ' · ' +
        esc(e.error_code || '-') + '：' + esc((e.error_message || '').slice(0, 80)) + '</li>').join('');
      box.innerHTML =
        '<div class="awb-inline" style="margin-bottom:10px;">' + hlTag +
        '<span class="awb-tag">今日调用 ' + (t.calls || 0) + ' 次</span>' +
        '<span class="awb-tag">今日 token ' + (t.tokens || 0) + '</span>' +
        '<span class="awb-tag">今日失败 ' + (t.failed || 0) + '</span>' +
        '<span class="awb-tag">平均耗时 ' + (t.avgLatencyMs || 0) + 'ms</span></div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">预算占用：调用 ' + pct(t.calls || 0, b.llmCallsPerDay) + ' · token ' + pct(t.tokens || 0, b.tokensPerDay) + '</div>' +
        (rows ? '<table style="width:100%;border-collapse:collapse;font-size:12px;"><tr style="color:var(--muted);text-align:left;">' +
          '<th style="padding:4px 8px;">厂商（近 7 天）</th><th style="padding:4px 8px;">调用</th><th style="padding:4px 8px;">失败</th><th style="padding:4px 8px;">token</th></tr>' + rows + '</table>' : '') +
        (errs ? '<ul style="font-size:12px;color:var(--muted);margin:10px 0 0;padding-left:18px;">' + errs + '</ul>' : '');
    } catch (e) {
      box.innerHTML = '<small style="color:var(--muted);">用量读取失败：' + esc(e.message) + '</small>';
    }
  }

  // ==================== 厂商探活（手动触发，成本可控）====================
  async function runProbe() {
    const sel = $('awb-probe-provider');
    const out = $('awb-probe-out');
    if (!out) return;
    const pid = sel && sel.value ? Number(sel.value) : null;
    out.textContent = '探活中…（窗口档最多 4 次小请求）';
    try {
      const res = await jreq('POST', API + '/config/test-llm', { provider_id: pid, purpose: 'plan' });
      const r = res.result || {};
      const c = r.stages && r.stages.connect;
      const w = r.stages && r.stages.window;
      const cap = r.stages && r.stages.capability;
      const bits = [];
      bits.push(c ? (c.ok ? '连通✅' : '连通❌') : '');
      bits.push(w ? (w.ok ? '窗口 ' + w.contextWindowTokens : '窗口未测') : '');
      if (cap) bits.push('tools ' + (cap.tools && cap.tools.supported ? '✅' : '❌') + ' / json ' + (cap.jsonSchema && cap.jsonSchema.supported ? '✅' : '❌'));
      out.textContent = bits.filter(Boolean).join(' · ');
      if (!r.ok && r.diagnosis) {
        showMsg('探活未通过：' + (r.diagnosis.diagnosis || r.diagnosis.code) + (r.diagnosis.hint ? '（' + r.diagnosis.hint + '）' : ''), false);
      } else {
        showMsg('✅ 探活完成' + (r.wroteBack ? '，上下文窗口已回填 ' + r.contextWindowTokens : ''), true);
      }
      await loadUsage();
    } catch (e) {
      out.textContent = '探活失败';
      showMsg('探活失败: ' + e.message, false);
    }
  }

  function updateRunDot() {
    const on = $('awb-enabled') && $('awb-enabled').checked;
    const dot = $('awb-dot');
    if (dot) dot.classList.toggle('on', !!on);
    const txt = $('awb-run-txt');
    if (txt) txt.textContent = on ? 'World AI 已启用' : 'World AI 已关闭';
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
      loadUsage();
    } catch (e) {
      showMsg('加载失败: ' + e.message, false);
    }
  }

  function fillProviderRow(cfg) {
    const map = cfg.providerMap || {};
    PURPOSES.forEach((p) => {
      const sel = $('awb-pm-' + p);
      if (!sel) return;
      const opts = ['<option value="">自动（候选链兜底）</option>']
        .concat(providers.map((pv) => '<option value="' + pv.id + '"' + (Number(map[p]) === Number(pv.id) ? ' selected' : '') + '>' + esc(pv.display_name || pv.provider_name || ('#' + pv.id)) + '</option>'));
      sel.innerHTML = opts.join('');
    });
    // 探活下拉：只列已启用厂商（§H.10.1：不提供"禁用厂商"开关，停用请去 AI 提供商页）
    const ps = $('awb-probe-provider');
    if (ps) {
      ps.innerHTML = ['<option value="">按用途自动选（provider_map → 候选链）</option>']
        .concat(providers.filter((pv) => pv.is_enabled !== false)
          .map((pv) => '<option value="' + pv.id + '">' + esc(pv.display_name || pv.provider_name) + '</option>')).join('');
    }
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
    updateRunDot();
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
    loadUsage,
    runProbe,
  };

  buildDom();
})();
