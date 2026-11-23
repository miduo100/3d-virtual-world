/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundLibrary.js —— 后台「音效库」（五分区骨架 + 角色动作区已实现）
 *
 * 为什么独立成文件：admin.html 已 11580 行，按项目 500 行红线只能「引用」，
 * 本文件自注入导航项与页面 DOM，admin.html 仅保留 2 行 script。
 *
 * 五个分区（按「声音用在哪」划分，最后一个是素材仓库）：
 *   ① actions  角色动作  20 个槽位 × 每个角色      ← 本版已实现
 *   ② objects  模型声源  场景物件，靠近才响          ← 骨架
 *   ③ scenes   环境声景  区域 / 地形，进入铺底        ← 骨架
 *   ④ weather  天气联动  雨/风/雪/雷，跟随天气参数    ← 骨架
 *   ⑤ assets   声音资产  合成 / 上传 / AI 的仓库      ← 骨架
 *
 * 依赖：window.audioSynth（audioSynth.js，需先加载）
 */
(function () {
  'use strict';

  var PAGE_ID = 'sound-library';

  // ─── i18n 工具：i18n 未就绪时一律回退中文，绝不显示裸 key ───
  function tr(key, fallback) {
    try {
      var i18n = window.i18n;
      if (i18n && i18n.initialized) {
        var v = i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch (e) { /* ignore */ }
    return fallback;
  }

  // 渲染后统一翻译：applyAdminTranslations 内部是全量遍历 [data-i18n]，无副作用
  function translateTree() {
    try {
      if (window.i18n && window.i18n.initialized && typeof window.applyAdminTranslations === 'function') {
        window.applyAdminTranslations();
      }
    } catch (e) { /* ignore */ }
  }

  // ─── 槽位定义（对齐 character_templates.anim_sounds / weapon_sounds）──

  // 槽位定义挪到 soundSections.js（纯数据），这里只取引用，守住 500 行
  // 注意：必须是函数而不是加载时常量 —— 文案要跟随当前语言，切语言后重新取值才生效
  function animKeys() { return window.SoundSections.keys('anim'); }
  function weaponKeys() { return window.SoundSections.keys('weapon'); }

  // 五个分区的定义与文案在 soundSections.js（纯数据，独立以守住 500 行红线）
  function sections() {
    return (typeof window.SoundSections !== 'undefined' && window.SoundSections)
      ? window.SoundSections.list()
      : [{ id: 'actions', label: '① 角色动作', count: '20', ready: true, intro: '' }];
  }

  var COLOR = {
    custom: '#85B7EB', synth: '#888780', placeholder: '#EF9F27', muted: 'transparent', none: '#5F5E5A'
  };

  var state = {
    templates: [], currentId: '', tpl: null,
    filter: 'all', keyword: '', section: 'actions'
  };

  // ─── 基础工具 ───────────────────────────────────────────────

  function token() {
    try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 与 soundManager._normalizeSlot 保持一致 */
  function normalizeSlot(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v ? { urls: [v] } : null;
    if (Array.isArray(v)) {
      var arr = v.filter(function (x) { return typeof x === 'string' && x; });
      return arr.length ? { urls: arr } : null;
    }
    if (typeof v === 'object') {
      var urls = [];
      if (Array.isArray(v.urls)) urls = v.urls.filter(function (x) { return typeof x === 'string' && x; });
      else if (typeof v.url === 'string' && v.url) urls = [v.url];
      return { urls: urls, muted: !!v.muted, volume: v.volume, synth: v.synth };
    }
    return null;
  }

  function asObject(v) {
    if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch (e) { return {}; } }
    return v || {};
  }

  // ─── 核心判定：某个槽位实际在播什么 ─────────────────────────

  function resolveSlot(type, key, desc, animSounds, weaponSounds) {
    // ★ 2026-11-05 待机：用户要求「空着、不出声」
    //   放在最前面判断 —— 哪怕库里已经存过 idle 的 mp3，也一律显示成空着，
    //   避免界面写「你上传的文件」但实际不播（soundManager 里 idle 已硬静音）。
    if (type === 'anim' && key === 'idle') {
      return {
        source: 'off',
        title: tr('adminSound.slotEmptyTitle', '空着（不出声）'),
        sub: tr('adminSound.slotEmptySub', '待机不配音；动作结束回待机不会再响一声'),
        color: COLOR.none
      };
    }

    var dict = (type === 'weapon') ? weaponSounds : animSounds;
    var slot = normalizeSlot(dict ? dict[key] : null);

    if (slot && slot.muted) {
      return { source: 'muted', title: tr('adminSound.mutedBadge', '已静音'), sub: tr('adminSound.slotMutedSub', '你手动关掉了这个声音'), color: COLOR.muted };
    }
    if (slot && slot.urls && slot.urls.length) {
      var name = slot.urls[0].split('/').pop() || slot.urls[0];
      var extra = slot.urls.length > 1 ? tr('adminSound.slotVariantSuffix', '（共 {{n}} 个变体）').replace('{{n}}', slot.urls.length) : '';
      return { source: 'custom', title: name, sub: tr('adminSound.slotCustomSub', '你上传的文件') + extra, color: COLOR.custom, url: slot.urls[0] };
    }
    var synth = (typeof window !== 'undefined') ? window.audioSynth : null;
    if (synth && synth.has && synth.has(type, key)) {
      var ph = !!(synth.isPlaceholder && synth.isPlaceholder(type, key));
      var ov = slot && slot.synth ? slot.synth : null;
      var sub = ph ? tr('adminSound.slotPlaceholderSub', '合成不出真质感，建议后续替换为真实素材')
                   : tr('adminSound.slotSynthSub', '系统自动生成，不需要上传');
      if (ov) {
        sub = tr('adminSound.slotOverrideSub', '已选变体（音高 ×{{pitch}}　明亮 ×{{bright}}）')
          .replace('{{pitch}}', ov.pitch || 1).replace('{{bright}}', ov.brightness || 1);
      }
      return {
        source: ph ? 'placeholder' : 'synth',
        title: tr('adminSound.slotSynthPrefix', '合成音 · ') + (ph ? tr('adminSound.slotPlaceholderWrap', '占位（{{desc}}）').replace('{{desc}}', desc) : desc),
        sub: sub,
        color: ph ? COLOR.placeholder : COLOR.synth
      };
    }
    return { source: 'none', title: tr('adminSound.slotUnknown', '未知'), sub: tr('adminSound.slotUnknownSub', '该键没有可用的声音'), color: COLOR.none };
  }

  // ─── 试听 ───────────────────────────────────────────────────

  var actx = null;
  var _fileAudio = null;

  function ensureCtx() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { actx = new AC(); } catch (e) { return null; }
    }
    if (actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
    return actx;
  }

  function playBuffer(buf) {
    var ctx = ensureCtx();
    if (!ctx || !buf) return;
    try {
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g = ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g); g.connect(ctx.destination);
      src.start(0);
    } catch (e) { console.warn('[音效库] 播放失败:', e.message); }
  }

  function playFile(url) {
    if (_fileAudio) { try { _fileAudio.pause(); } catch (e) {} }
    _fileAudio = new Audio(url);
    _fileAudio.volume = 0.9;
    _fileAudio.play().catch(function (e) { console.warn('[音效库] 文件试听失败:', e.message); });
  }

  async function preview(type, key, desc) {
    if (!state.tpl) return;
    var row = resolveSlot(type, key, desc, asObject(state.tpl.anim_sounds), asObject(state.tpl.weapon_sounds));
    if (row.source === 'custom' && row.url) { playFile(row.url); return; }
    if (row.source === 'muted' || row.source === 'none' || row.source === 'off') return;
    var synth = window.audioSynth;
    if (!synth) { console.warn('[音效库] audioSynth 未加载'); return; }
    playBuffer(synth.getCached(type, key) || await synth.ensure(type, key));
  }

  // ─── 数据 ───────────────────────────────────────────────────

  async function api(path) {
    var r = await fetch(path, { headers: { 'Authorization': 'Bearer ' + token() } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function loadTemplates() {
    try {
      var data = await api('/api/character-templates');
      state.templates = data.templates || [];
      var sel = document.getElementById('sl-tpl-select');
      if (sel) {
        sel.innerHTML = state.templates.length
          ? state.templates.map(function (t) {
              return '<option value="' + esc(t.id) + '">' + esc(t.name || tr('adminSound.unnamedTpl', '(未命名)')) + '</option>';
            }).join('')
          : '<option value="">' + esc(tr('adminSound.noTemplates', '（没有角色模板）')) + '</option>';
        if (state.templates.length) {
          state.currentId = state.templates[0].id;
          sel.value = state.currentId;
          await loadTemplate(state.currentId);
        }
      }
    } catch (e) {
      var box = document.getElementById('sl-rows');
      if (box) box.innerHTML = '<div style="padding:20px;color:#ff6b6b">加载模板列表失败：' + esc(e.message) + '</div>';
    }
  }

  async function loadTemplate(id) {
    if (!id) return;
    state.currentId = id;
    try {
      var data = await api('/api/character-templates/' + encodeURIComponent(id));
      state.tpl = data.template || null;
    } catch (e) {
      state.tpl = null;
      console.warn('[音效库] 读取模板失败:', e.message);
    }
    renderRows();
  }

  // ─── ① 角色动作区渲染 ───────────────────────────────────────

  function renderStats() {
    var el = document.getElementById('sl-stats');
    if (!el) return;
    if (!state.tpl) { el.textContent = ''; return; }
    var anim = asObject(state.tpl.anim_sounds), wpn = asObject(state.tpl.weapon_sounds);
    var c = { custom: 0, synth: 0, placeholder: 0, muted: 0, none: 0, off: 0 };
    var ak = animKeys(), wk = weaponKeys();
    ak.forEach(function (k) { c[resolveSlot('anim', k.key, k.desc, anim, wpn).source]++; });
    wk.forEach(function (k) { c[resolveSlot('weapon', k.key, k.desc, anim, wpn).source]++; });
    el.innerHTML = tr('adminSound.statsTotal', '共 20 项') + ' · ' +
      '<span style="color:#888780">' + tr('adminSound.statsSynth', '合成') + ' ' + c.synth + '</span> · ' +
      '<span style="color:#EF9F27">' + tr('adminSound.statsPlaceholder', '占位') + ' ' + c.placeholder + '</span> · ' +
      '<span style="color:#85B7EB">' + tr('adminSound.statsCustom', '自定义') + ' ' + c.custom + '</span>' +
      (c.off ? ' · <span style="color:#888780">' + tr('adminSound.statsEmpty', '空着') + ' ' + c.off + '</span>' : '') +
      (c.muted ? ' · <span style="color:#888">' + tr('adminSound.statsMuted', '静音') + ' ' + c.muted + '</span>' : '');
  }

  function rowHtml(type, item, anim, wpn) {
    var r = resolveSlot(type, item.key, item.desc, anim, wpn);
    if (state.filter === 'placeholder' && r.source !== 'placeholder') return '';
    if (state.filter === 'custom' && r.source !== 'custom') return '';
    if (state.keyword) {
      var hay = (item.label + ' ' + item.key + ' ' + r.title + ' ' + r.sub).toLowerCase();
      if (hay.indexOf(state.keyword.toLowerCase()) < 0) return '';
    }
    var isOff = (r.source === 'off');
    var dotStyle = (r.source === 'muted' || isOff)
      ? 'background:transparent;border:1px solid #5F5E5A'
      : 'background:' + r.color;
    // 待机没有可听的东西，按钮直接禁用，避免点了没反应像坏了
    var btns = isOff
      ? '<button class="btn btn-secondary btn-sm" disabled title="' + esc(tr('adminSound.idleMuteTitle', '按你的要求待机静音')) + '" style="opacity:.35;cursor:not-allowed">' + esc(tr('adminSound.mutedBadge', '已静音')) + '</button>'
      : '<button class="btn btn-secondary btn-sm" data-play="' + type + '" data-key="' + esc(item.key) + '" data-desc="' + esc(item.desc) + '">' + esc(tr('adminSound.btnPreview', '试听')) + '</button>' +
        '<button class="btn btn-secondary btn-sm" data-var="' + type + '" data-key="' + esc(item.key) + '" data-desc="' + esc(item.desc) + '">' + esc(tr('adminSound.btnVariants', '变体')) + '</button>';
    return '<div class="sl-row">' +
      '<span class="sl-dot" style="' + dotStyle + '"></span>' +
      '<span class="sl-name">' + esc(item.label) + '</span>' +
      '<span class="sl-title">' + esc(r.title) + '</span>' +
      '<span class="sl-sub">' + esc(r.sub) + '</span>' +
      btns +
      '</div>';
  }

  function renderRows() {
    var box = document.getElementById('sl-rows');
    if (!box) return;
    if (!state.tpl) {
      box.innerHTML = '<div style="padding:28px;color:var(--muted);text-align:center">' + esc(tr('adminSound.pickTemplateFirst', '请先在上方选择一个角色模板')) + '</div>';
      renderStats();
      return;
    }
    var anim = asObject(state.tpl.anim_sounds), wpn = asObject(state.tpl.weapon_sounds);
    var ak = animKeys(), wk = weaponKeys();
    var html = '<div class="sl-group">' + esc(tr('adminSound.groupAnim', '角色动作')) + ' · ' + ak.length + ' ' + esc(tr('adminSound.unitItems', '项')) + '</div>';
    html += ak.map(function (k) { return rowHtml('anim', k, anim, wpn); }).join('');
    html += '<div class="sl-group">' + esc(tr('adminSound.groupWeapon', '武器音效')) + ' · ' + wk.length + ' ' + esc(tr('adminSound.unitItems', '项')) + '</div>';
    html += wk.map(function (k) { return rowHtml('weapon', k, anim, wpn); }).join('');
    box.innerHTML = html || '<div style="padding:28px;color:var(--muted);text-align:center">' + esc(tr('adminSound.filterEmpty', '当前筛选条件下没有内容')) + '</div>';
    renderStats();
    box.querySelectorAll('button[data-play]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        preview(btn.getAttribute('data-play'), btn.getAttribute('data-key'), btn.getAttribute('data-desc'));
      });
    });
    box.querySelectorAll('button[data-var]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openVariants(btn.getAttribute('data-var'), btn.getAttribute('data-key'), btn.getAttribute('data-desc'));
      });
    });
  }

  // ─── ① 合成变体：面板与存库都在 soundVariants.js，这里只接线 ──

  function openVariants(type, key, desc) {
    var tpl = state.tpl;
    if (!tpl) return;
    loadScriptOnce('js/soundVariants.js?v=1').then(function () {
      window.SoundVariants.open({
        type: type, key: key, desc: desc, template: tpl,
        onSaved: function (field, val) { tpl[field] = val; renderRows(); }
      });
    }).catch(function (e) { alert(e.message); });
  }

  // ─── 分区切换 ───────────────────────────────────────────────

  function placeholderHtml(sec) {
    return (window.SoundSections && window.SoundSections.placeholderHtml)
      ? window.SoundSections.placeholderHtml(sec)
      : '';
  }

  // 分区模块按需加载：admin.html 只静态引用 soundObjects，其余切到才拉，避免引用行膨胀
  // 2026-11-03：objects（模型声源）和 weather（天气联动）已从音效库移除——
  //   前者由统一编辑器的对象属性承接，后者搬进「世界与场景 → 天气控制」。
  var PANE_MODULES = {
    scenes:  { global: 'SoundRegions', src: 'js/soundRegions.js?v=6' },
    assets:  { global: 'SoundAssets',  src: 'js/soundAssets.js?v=4' },
    // ★ AI 生成声音：按需加载，不进主包（跟 soundEditor.js 一个套路）
    aigen:   { global: 'SoundAIGen',   src: 'js/soundAIGen.js?v=1' }
  };

  function loadScriptOnce(src) {
    return new Promise(function (resolve, reject) {
      var exist = document.querySelector('script[data-sl="' + src + '"]');
      if (exist) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.setAttribute('data-sl', src);
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('加载失败: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function mountPane(id) {
    var mod = PANE_MODULES[id];
    if (!mod) return;
    var box = document.getElementById('sl-pane-' + id);
    if (!box || box.getAttribute('data-mounted')) return;
    box.setAttribute('data-mounted', '1');
    loadScriptOnce(mod.src).then(function () {
      var M = window[mod.global];
      if (M && typeof M.mount === 'function') M.mount(box);
      else box.innerHTML = '<div style="padding:20px;color:#ff6b6b">模块未就绪：' + mod.global + '</div>';
    }).catch(function (e) {
      box.setAttribute('data-mounted', '');
      box.innerHTML = '<div style="padding:20px;color:#ff6b6b">' + esc(e.message) + '</div>';
    });
  }

  function switchSection(id) {
    state.section = id;
    document.querySelectorAll('#sl-sections .sl-section').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-sec') === id);
    });
    document.querySelectorAll('.sl-pane').forEach(function (el) {
      el.classList.toggle('active', el.id === 'sl-pane-' + id);
    });
    if (id === 'actions' && !state.templates.length) loadTemplates();
    mountPane(id);
  }

  function renderSections() {
    var box = document.getElementById('sl-sections');
    if (!box) return;
    box.innerHTML = sections().map(function (s) {
      return '<div class="sl-section' + (s.id === state.section ? ' active' : '') + '" data-sec="' + s.id + '">' +
        '<span class="sl-sec-label">' + esc(s.label) + '</span>' +
        '<span class="sl-sec-count">' + esc(s.count) + '</span>' +
        '</div>';
    }).join('');
    box.querySelectorAll('.sl-section').forEach(function (el) {
      el.addEventListener('click', function () { switchSection(el.getAttribute('data-sec')); });
    });
  }

  // ─── 页面构建 ───────────────────────────────────────────────

  var PAGE_CSS = [
    '.sl-body{display:flex;gap:14px;align-items:flex-start}',
    '.sl-sections{width:158px;flex-shrink:0;display:flex;flex-direction:column;gap:4px;border-right:1px solid var(--border);padding-right:12px}',
    '.sl-section{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:7px 9px;border-radius:7px;cursor:pointer;font-size:12px;color:var(--muted);border-left:2px solid transparent}',
    '.sl-section:hover{background:rgba(255,255,255,0.04)}',
    '.sl-section.active{background:rgba(0,255,0,0.08);color:var(--text);border-left-color:var(--green)}',
    '.sl-sec-count{font-size:11px;color:var(--muted)}',
    '.sl-content{flex:1;min-width:0}',
    '.sl-pane{display:none}',
    '.sl-pane.active{display:block}',
    '.sl-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
    '.sl-toolbar select{background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:5px 8px;font-size:12px;min-width:190px}',
    '.sl-toolbar input{background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:5px 8px;font-size:12px;width:140px}',
    '.sl-group{font-size:12px;color:var(--green);font-weight:600;margin:12px 0 5px;padding-bottom:4px;border-bottom:1px solid rgba(0,255,0,0.15)}',
    '.sl-row{display:flex;align-items:center;gap:10px;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,0.05)}',
    '.sl-row:hover{background:rgba(255,255,255,0.03)}',
    '.sl-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}',
    '.sl-name{width:62px;flex-shrink:0;font-size:12px;color:var(--text)}',
    '.sl-title{flex:1;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sl-sub{width:210px;flex-shrink:0;font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sl-ph{padding:18px 4px}',
    '.sl-ph-title{font-size:15px;font-weight:500;color:var(--text);margin-bottom:6px}',
    '.sl-ph-intro{font-size:13px;color:var(--text);line-height:1.7;margin-bottom:14px}',
    '.sl-ph-sub{font-size:12px;color:var(--green);margin-bottom:6px}',
    '.sl-ph-list{margin:0;padding-left:18px;font-size:12px;color:var(--muted);line-height:1.9}',
    '.sl-ph-eta{margin-top:14px;font-size:11px;color:var(--orange);border-top:1px solid var(--border);padding-top:10px}',
    '@media(max-width:1100px){.sl-sub{display:none}}'
  ].join('\n');

  function buildPage() {
    if (document.getElementById('page-' + PAGE_ID)) return;

    var style = document.createElement('style');
    style.textContent = PAGE_CSS;
    document.head.appendChild(style);

    var panes = sections().map(function (s) {
      if (s.id === 'actions') {
        return '<div class="sl-pane active" id="sl-pane-actions">' +
          '<div class="sl-toolbar">' +
            '<span style="font-size:12px;color:var(--muted)" data-i18n="adminSound.tplLabel">角色模板</span>' +
            '<select id="sl-tpl-select"></select>' +
            '<span id="sl-stats" style="font-size:12px;color:var(--muted)"></span>' +
            '<span style="flex:1"></span>' +
            '<select id="sl-filter">' +
              '<option value="all" data-i18n="adminSound.filterAll">全部</option>' +
              '<option value="placeholder" data-i18n="adminSound.filterPlaceholder">只看占位（待替换）</option>' +
              '<option value="custom" data-i18n="adminSound.filterCustom">只看自定义</option>' +
            '</select>' +
            '<input id="sl-search" type="text" placeholder="搜索动作名" data-i18n-placeholder="adminSound.searchPlaceholder">' +
          '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-bottom:8px;line-height:1.7">' +
            '<span data-i18n="adminSound.legendLabel">色点：</span>' +
            '<span style="color:#888780" data-i18n="adminSound.legendSynth">灰=合成</span>　' +
            '<span style="color:#EF9F27" data-i18n="adminSound.legendPlaceholder">黄=占位（建议替换）</span>　' +
            '<span style="color:#85B7EB" data-i18n="adminSound.legendCustom">蓝=你上传的</span>　' +
            '<span data-i18n="adminSound.legendMute">空=静音</span>' +
          '</div>' +
          '<div id="sl-rows"></div>' +
        '</div>';
      }
      // 有独立模块的分区留空容器（由模块自己渲染）；其余显示占位说明
      if (PANE_MODULES[s.id]) {
        return '<div class="sl-pane" id="sl-pane-' + s.id + '" data-native="1"></div>';
      }
      return '<div class="sl-pane" id="sl-pane-' + s.id + '">' + placeholderHtml(s) + '</div>';
    }).join('');

    var page = document.createElement('div');
    page.id = 'page-' + PAGE_ID;
    page.className = 'page';
    page.innerHTML =
      '<div class="card">' +
        '<div class="card-header">' +
          '<div class="card-title" data-i18n="admin.pgSound-library">🔊 音效库</div>' +
          '<div style="font-size:12px;color:var(--muted)" data-i18n="admin.pgSound-librarySub">按「声音用在哪」分成三区。模型声音去统一编辑器配，天气声音和背景音乐去「世界与场景 → 天气控制」</div>' +
        '</div>' +
        '<div class="sl-body">' +
          '<div class="sl-sections" id="sl-sections"></div>' +
          '<div class="sl-content">' + panes + '</div>' +
        '</div>' +
      '</div>';

    var anchor = document.querySelector('.page');
    (anchor ? anchor.parentElement : document.body).appendChild(page);

    renderSections();
    translateTree();

    var sel = page.querySelector('#sl-tpl-select');
    if (sel) sel.addEventListener('change', function () { loadTemplate(sel.value); });
    var flt = page.querySelector('#sl-filter');
    if (flt) flt.addEventListener('change', function () { state.filter = flt.value; renderRows(); });
    var inp = page.querySelector('#sl-search');
    if (inp) inp.addEventListener('input', function () { state.keyword = inp.value.trim(); renderRows(); });
  }

  function injectNav() {
    if (document.getElementById('sl-nav-item')) return;
    var nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    var divider = document.createElement('div');
    divider.className = 'nav-divider';
    var label = document.createElement('div');
    label.className = 'nav-section-label';
    label.setAttribute('data-i18n', 'admin.audio');   // 中文兜底，切英文时由 applyAdminTranslations 刷新
    label.textContent = '音频';
    var item = document.createElement('div');
    item.className = 'nav-item';
    item.id = 'sl-nav-item';
    item.setAttribute('onclick', "showPage('" + PAGE_ID + "')");
    item.innerHTML = '<span class="icon">🔊</span><span data-i18n="admin.soundLibrary">音效库</span>';
    // 必须追加到末尾：admin.html 的 navKeys 按 DOM 顺序硬对齐，插中间会让后续翻译整体错位
    nav.appendChild(divider);
    nav.appendChild(label);
    nav.appendChild(item);
    translateTree();
  }

  function hookShowPage() {
    if (window.__slShowPageHooked) return;
    window.__slShowPageHooked = true;
    var orig = window.showPage;
    window.showPage = function (name) {
      if (typeof orig === 'function') orig.apply(window, arguments);
      if (name === PAGE_ID) {
        var t = document.getElementById('pageTitle');
        var s = document.getElementById('pageSubtitle');
        if (t) t.textContent = tr('admin.pgSound-library', '🔊 音效库');
        if (s) s.textContent = tr('admin.pgSound-librarySub', '按「声音用在哪」分成三区。模型声音去统一编辑器配，天气声音和背景音乐去「世界与场景 → 天气控制」');
        if (state.section === 'actions' && !state.templates.length) loadTemplates();
      }
    };
  }

  function boot() {
    try {
      buildPage();
      injectNav();
      hookShowPage();
      // 切换语言后重渲染分区与行，文案才会跟着变（data-i18n 那部分由 applyAdminTranslations 负责）
      if (window.i18n && typeof window.i18n.onLocaleChange === 'function') {
        window.i18n.onLocaleChange(function () {
          try {
            renderSections();
            if (state.tpl) renderRows();
          } catch (e) { /* ignore */ }
        });
      }
      console.log('[音效库] 已就绪（五分区，导航项在侧栏「音频」分组）');
    } catch (e) {
      console.error('[音效库] 初始化失败:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
