/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 🌐 互联网免费模型库（世界编辑器面板）
 * ------------------------------------------------------------------
 * 位置：左侧导航「🗺️ 地形」下方新增一项「🌐 互联网模型库」；右侧对应 #panel-free-assets。
 * 形态：完全自注入（不改 world_editor.html 的既有结构，只多一行 <script>），
 *       并包装 window.switchPanel（它的面板 id 数组是硬编码的，新面板不在其中）。
 *
 * 多源设计（后期接别家只做三步）：
 *   1) 前端 registerProvider({ id, label, homepage, license, classes, search(), glbUrl() })
 *   2) 后端 src/services/freeAssetProviders.js 加一条白名单
 *   3) 面板下拉框自动出现新源（本文件按注册表渲染）
 *
 * 使用口径（2026-10-29 用户决策修正）：
 *   - **默认：点一下 = 下载到本服务器 + 用本地路径放置**。理由是同一件资产会在世界里
 *     被反复加载，世界/玩家一多，全部热链会把第三方 CDN 的请求量放大到对方承受不了；
 *     落本地后所有玩家都从本服务器取，只占少量磁盘（单件 90KB~1MB）。
 *   - 面板提供「只用远程链接（不下载）」开关作为退路（临时试用/对方拒绝下载时用）。
 *   - 许可提示每个浏览器只弹一次（localStorage 记忆），不干扰日常操作。
 *
 * 数据库：**零新表/零新列**。放置写 world_objects；下载入库写 uploaded_models。
 *        来源信息不写 custom_config（写了会让 ModelLighting.canInstance 判 false，
 *        导致该模型被踢出合批 —— 见 worldInstanceMerger_v2.js:134），
 *        溯源直接从 model_path 里的 <id> 反解即可。
 *
 * 诊断：window.FreeAssetLibrary._diag()
 */
(function () {
  'use strict';

  var VERSION = '1.1.1';   // 1.1.1：整套导入下全量零件（含地形与跨套件借用件），缺件不再静默
  var PER_PAGE = 24;
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var SEARCH_DEBOUNCE_MS = 300;

  var state = {
    started: false,
    providerId: 'polyfork',
    q: '',
    cls: '',
    page: 1,
    total: 0,
    items: [],
    loading: false,
    error: null,
    remoteOnly: false,        // true = 只用远程链接（不下载到本服务器）
    licenseAck: false,        // 许可提示只确认一次（存 localStorage）
    localIds: new Set(),      // 已下载入库的 "provider|id"，用于卡片 ✔ 角标
    placing: false,           // 整条流程（下载 + 放置）进行中
    _placingObject: false,    // 仅放置请求进行中（内部，避免与 placing 互相阻挡）
    lastQueryAt: 0
  };

  var searchCache = new Map();   // key → { at, total, items, coverage }
  var searchTimer = null;

  /* ============================ 工具 ============================ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function authHeaders() {
    try {
      if (typeof window.__editorAuthHeaders === 'function') return window.__editorAuthHeaders();
    } catch (e) { /* ignore */ }
    return {};
  }

  function notify(msg, type) {
    try {
      if (typeof window.showNotification === 'function') { window.showNotification(msg, type || 'info'); return; }
    } catch (e) { /* ignore */ }
    console.log('[freeAssetLibrary]', msg);
  }

  function fmtSize(s) {
    if (!s || typeof s !== 'object') return '';
    var f = function (v) { return (Math.round((Number(v) || 0) * 10) / 10); };
    return f(s.x) + '×' + f(s.y) + '×' + f(s.z) + 'm';
  }

  function fmtTris(n) {
    n = Number(n) || 0;
    return n >= 1000 ? (Math.round(n / 100) / 10) + 'k面' : n + '面';
  }

  /* ======================== 资产源注册表 ======================== */

  var PROVIDERS = {};

  function registerProvider(p) {
    if (!p || !p.id) return;
    PROVIDERS[p.id] = p;
    if (state.started) renderProviderSelect();
  }

  function getProvider(id) {
    return PROVIDERS[id || state.providerId] || null;
  }

  /**
   * 第三方返回的 JSON 一律按不可信处理：只认白名单域名下的 GLB URL，
   * 其余情况一律用 provider 自己拼的 URL（前端这份拼法与后端保持一致）。
   */
  function safeGlbUrl(p, item) {
    var cand = item && item.url;
    if (typeof cand === 'string' && /^https:\/\/polyfork\.dev\/cdn\/[a-z0-9-]+\.glb$/i.test(cand)) return cand;
    return p.glbUrl(item);
  }

  registerProvider({
    id: 'polyfork',
    label: 'Polyfork.dev',
    homepage: 'https://polyfork.dev/',
    license: '免费商用·免署名；禁止再分发文件本体',
    corsDirect: true,
    classes: [
      { k: '', t: '全部' },
      { k: 'prop', t: '道具' },
      { k: 'building', t: '建筑' },
      { k: 'vehicle', t: '载具' },
      { k: 'character', t: '角色' }
    ],
    glbUrl: function (item) {
      return 'https://polyfork.dev/cdn/' + encodeURIComponent(item.id) + '.glb';
    },
    search: async function (opts) {
      var u = new URL('https://polyfork.dev/api/assets');
      u.searchParams.set('free', '1');
      u.searchParams.set('per_page', String(opts.perPage || PER_PAGE));
      u.searchParams.set('page', String(opts.page || 1));
      u.searchParams.set('sort', 'latest');
      if (opts.q) u.searchParams.set('q', String(opts.q).slice(0, 80));
      if (opts.cls) u.searchParams.set('class', String(opts.cls));

      var r = await fetch(u.toString(), { cache: 'no-store' });
      if (!r.ok) throw new Error('搜索失败 HTTP ' + r.status);
      var j = await r.json();
      var items = (j.assets || []).map(function (a) {
        return {
          id: a.id,
          title: a.title || a.id,
          thumb: typeof a.thumbnail === 'string' ? a.thumbnail : '',
          tris: a.triangles || 0,
          cls: a.class || '',
          hasRig: !!a.has_rig,
          size: a.size_m || null,
          url: a.download && a.download.glb
        };
      });
      return { total: j.total || items.length, items: items, coverage: j.coverage || null };
    }
  });

  /* ============================ 样式 ============================ */

  function injectStyle() {
    if (document.getElementById('fal-style')) return;
    var css = [
      '#panel-free-assets .fal-src-row{display:flex;gap:6px;align-items:center;}',
      '#panel-free-assets select,#panel-free-assets input[type=text]{width:100%;padding:6px 8px;border:1px solid var(--border,#2a3444);',
      '  border-radius:6px;background:#11161f;color:#dfe6f2;font-size:12px;}',
      '.fal-license{font-size:11px;color:#8b93a3;line-height:1.6;margin-top:6px;}',
      '.fal-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
      '.fal-chip{padding:4px 10px;border-radius:12px;border:1px solid #2a3444;background:#151b26;color:#a9b4c6;',
      '  font-size:11px;cursor:pointer;user-select:none;}',
      '.fal-chip.active{background:linear-gradient(135deg,#4d7cff,#8a5bff);color:#fff;border-color:transparent;}',
      '.fal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:5px;max-height:46vh;overflow:auto;',
      '  padding:2px;border-radius:8px;background:#0d1219;}',
      '.fal-card{position:relative;display:flex;align-items:center;gap:7px;background:#151b26;border:1px solid #222b3a;',
      '  border-radius:7px;padding:4px;cursor:pointer;transition:border-color .15s,background .15s;}',
      '.fal-card:hover{border-color:#4d7cff;background:#18202c;}',
      '.fal-card.busy{opacity:.5;pointer-events:none;}',
      '.fal-thumb{flex:0 0 48px;width:48px;height:48px;border-radius:5px;background:#0f141c;display:flex;',
      '  align-items:center;justify-content:center;overflow:hidden;}',
      '.fal-thumb img{max-width:100%;max-height:100%;object-fit:contain;display:block;}',
      '.fal-thumb .fal-noimg{font-size:16px;color:#3f4a5c;}',
      '.fal-info{flex:1 1 auto;min-width:0;}',
      '.fal-name{font-size:11px;color:#dfe6f2;line-height:1.25;max-height:2.5em;overflow:hidden;word-break:break-word;}',
      '.fal-meta{font-size:10px;color:#7d8798;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.fal-local{position:absolute;right:5px;top:5px;padding:0 4px;height:14px;line-height:14px;border-radius:7px;',
      '  background:#1f6f43;color:#d8ffe8;font-size:9px;letter-spacing:.5px;pointer-events:none;}',
      '.fal-pager{display:flex;align-items:center;justify-content:space-between;margin-top:8px;font-size:11px;color:#9aa6b8;}',
      '.fal-pager button{padding:3px 10px;border-radius:6px;border:1px solid #2a3444;background:#151b26;color:#cfd8e6;',
      '  cursor:pointer;font-size:11px;}',
      '.fal-pager button:disabled{opacity:.4;cursor:default;}',
      '.fal-empty{padding:18px;text-align:center;color:#7d8798;font-size:12px;line-height:1.7;}',
      '.fal-dl-row{display:flex;align-items:center;gap:6px;font-size:12px;color:#a9b4c6;cursor:pointer;}',
      /* ---- 成套场景 ---- */
      '.fal-tabs{display:flex;gap:6px;margin-bottom:8px;}',
      '.fal-tab{flex:1 1 0;text-align:center;padding:6px 4px;border-radius:7px;border:1px solid #2a3444;',
      '  background:#151b26;color:#a9b4c6;font-size:12px;cursor:pointer;user-select:none;}',
      '.fal-tab.active{background:linear-gradient(135deg,#4d7cff,#8a5bff);color:#fff;border-color:transparent;}',
      '.fal-kit-grid{display:flex;flex-direction:column;gap:5px;max-height:38vh;overflow:auto;padding:2px;',
      '  border-radius:8px;background:#0d1219;}',
      '.fal-kit{display:flex;align-items:center;gap:8px;background:#151b26;border:1px solid #222b3a;',
      '  border-radius:7px;padding:7px 8px;cursor:pointer;transition:border-color .15s,background .15s;}',
      '.fal-kit:hover{border-color:#4d7cff;background:#18202c;}',
      '.fal-kit.sel{border-color:#8a5bff;background:#1b2130;}',
      '.fal-kit-ico{flex:0 0 30px;height:30px;border-radius:6px;background:#0f141c;display:flex;',
      '  align-items:center;justify-content:center;font-size:15px;}',
      '.fal-kit-name{font-size:12px;color:#dfe6f2;line-height:1.3;}',
      '.fal-kit-meta{font-size:10px;color:#7d8798;margin-top:2px;}',
      '.fal-partstrip{display:flex;gap:4px;overflow-x:auto;padding:4px 2px;margin-top:6px;}',
      '.fal-partstrip .fal-thumb{flex:0 0 40px;width:40px;height:40px;}',
      '.fal-kv{display:flex;justify-content:space-between;font-size:11px;color:#9aa6b8;margin-top:3px;}',
      '.fal-kv b{color:#dfe6f2;font-weight:500;}',
      /* 详情块自带深色底：面板分区在部分环境下是浅色底，光靠继承会看不清 */
      '.fal-kit-box{background:#0d1219;border:1px solid #222b3a;border-radius:8px;padding:8px 9px;margin-top:6px;}',
      '.fal-btnrow{display:flex;gap:6px;margin-top:8px;}',
      '.fal-btnrow button{flex:1 1 0;padding:7px 6px;border-radius:7px;border:1px solid #2a3444;',
      '  background:#151b26;color:#cfd8e6;font-size:12px;cursor:pointer;}',
      '.fal-btnrow button.primary{background:linear-gradient(135deg,#4d7cff,#8a5bff);border-color:transparent;color:#fff;}',
      '.fal-btnrow button:disabled{opacity:.45;cursor:default;}',
      '.fal-keyrow{display:flex;gap:6px;margin-top:6px;align-items:center;}',
      '.fal-keyrow button{padding:6px 10px;border-radius:6px;border:1px solid #2a3444;background:#151b26;',
      '  color:#cfd8e6;font-size:11px;cursor:pointer;white-space:nowrap;}'

    ].join('');
    var el = document.createElement('style');
    el.id = 'fal-style';
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ============================ DOM 注入 ============================ */

  function injectNav() {
    if (document.getElementById('nav-free-assets')) return;
    var nav = document.createElement('div');
    nav.className = 'nav-item';
    nav.id = 'nav-free-assets';
    nav.setAttribute('onclick', "switchPanel('free-assets')");
    nav.innerHTML = '🌐<span class="nav-text">互联网</span>' +
      '<span class="nav-tooltip">🌐 互联网免费模型库（Polyfork.dev，在线按需加载）</span>';

    var anchor = document.getElementById('nav-ground');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(nav, anchor.nextSibling);
    else (document.getElementById('sidebar') || document.body).appendChild(nav);
  }

  function injectPanel() {
    if (document.getElementById('panel-free-assets')) return;
    var host = document.getElementById('panel-content') || document.body;
    var div = document.createElement('div');
    div.id = 'panel-free-assets';
    div.className = 'panel-view';
    div.innerHTML = [
      '<div class="panel-title">🌐 互联网免费模型库</div>',

      '<div class="fal-tabs">',
      '  <span class="fal-tab active" data-tab="single">🔍 单个模型</span>',
      '  <span class="fal-tab" data-tab="kit">🧩 成套场景</span>',
      '</div>',

      /* ===================== 单个模型（原有） ===================== */
      '<div id="fal-view-single">',

      '  <div class="panel-section">',
      '    <div class="panel-section-title">🔗 资产源</div>',
      '    <div class="fal-src-row"><select id="fal-provider"></select></div>',
      '    <div class="fal-license" id="fal-src-license"></div>',
      '  </div>',

      '  <div class="panel-section">',
      '    <div class="panel-section-title">🔍 搜索（英文关键词更好命中）</div>',
      '    <input type="text" id="fal-q" placeholder="如 car / house / tree / boat，回车搜索">',
      '    <div class="fal-chips" id="fal-chips"></div>',
      '  </div>',

      '  <div class="panel-section">',
      '    <div class="panel-section-title">🖼️ 结果 <span id="fal-count" style="color:#7d8798;font-weight:400;"></span></div>',
      '    <div class="fal-grid" id="fal-grid"><div class="fal-empty">点上方搜索，或直接切到本面板（默认拉最新 24 件）</div></div>',
      '    <div class="fal-pager"><button id="fal-prev" type="button">← 上一页</button>',
      '      <span id="fal-pageinfo">-</span><button id="fal-next" type="button">下一页 →</button></div>',
      '  </div>',

      '  <div class="panel-section">',
      '    <div class="panel-section-title">⚖️ 使用方式与许可</div>',
      '    <label class="fal-dl-row"><input type="checkbox" id="fal-remote-only"> 只用远程链接（不下载到本服务器）</label>',
      '    <div class="fal-license" id="fal-dl-tip">',
      '      <b>默认：点一下 = 下载到本服务器并放置</b>。文件存到 public/models/uploaded/free/&lt;源&gt;/&lt;id&gt;.glb，',
      '      并登记进「📂 已上传模型」，之后所有玩家都从本服务器加载，不再请求对方 CDN。<br>',
      '      勾选上面的选项可改为纯远程（热链）：不占本地磁盘，但每次加载都会请求对方 CDN —— ',
      '      世界/玩家多时会给对方造成压力，不建议长期这样用。<br>',
      '      许可：第三方条款把「保留自己的副本并对外提供」视为再分发，对外分发场景需另行取得其平台许可。',
      '    </div>',
      '  </div>',

      '</div>',

      /* ===================== 成套场景（新增） ===================== */
      '<div id="fal-view-kit" style="display:none;">',

      '  <div class="panel-section">',
      '    <div class="panel-section-title">🧩 成套场景 <span id="fal-kit-count" style="color:#7d8798;font-weight:400;"></span></div>',
      '    <div class="fal-license">一个套件 = 一整块已经摆好的场景（零件 + 位置 + 朝向）。',
      '      点一个套件 → 放在当前视角前方，不用再一个个挪。</div>',
      '    <div class="fal-kit-grid" id="fal-kit-grid"><div class="fal-empty">正在拉取成套场景…</div></div>',
      '  </div>',

      '  <div class="panel-section" id="fal-kit-detail" style="display:none;"></div>',

      '  <div class="panel-section">',
      '    <div class="panel-section-title">🔑 套件 API key</div>',
      '    <div class="fal-license">对方把「整场景摆放关系」只给已登录账号。免费注册（邮箱即可）后',
      '      在 polyfork.dev/account 建一个 key，粘贴到这里，整个服务器生效。</div>',
      '    <input type="text" id="fal-key" placeholder="pf_...（只保存在本服务器，不会下发到浏览器之外）">',
      '    <div class="fal-keyrow">',
      '      <button id="fal-key-save" type="button">保存 key</button>',
      '      <span class="fal-license" id="fal-key-status"></span>',
      '    </div>',
      '  </div>',

      '</div>'
    ].join('');
    host.appendChild(div);
  }

  /** switchPanel 的面板 id 数组是硬编码的，这里包一层让它认识我们的新面板 */
  function wrapSwitchPanel() {
    if (typeof window.switchPanel !== 'function' || window.switchPanel.__falWrapped) return;
    var orig = window.switchPanel;
    var wrapped = function (name) {
      if (name === 'free-assets') {
        try { orig.call(this, name); } catch (e) { /* ignore */ }
        // 导航高亮由外层 switchPanel 统一处理（它按 nav-<panelName> 匹配，已包含 nav-free-assets）；
        // 这里不再手动 add('active')，否则「再点一次收起面板」时图标会留着高亮。
        var panel = document.getElementById('panel-free-assets');
        if (panel) panel.classList.add('active');
        ensureFirstLoad();
        return;
      }
      return orig.apply(this, arguments);
    };
    wrapped.__falWrapped = true;
    window.switchPanel = wrapped;
  }

  /* ============================ 渲染 ============================ */

  function renderProviderSelect() {
    var sel = document.getElementById('fal-provider');
    if (!sel) return;
    var ids = Object.keys(PROVIDERS);
    sel.innerHTML = ids.map(function (id) {
      var p = PROVIDERS[id];
      return '<option value="' + esc(id) + '">' + esc(p.label) + '</option>';
    }).join('');
    sel.value = state.providerId;
    updateLicenseLine();
  }

  function updateLicenseLine() {
    var p = getProvider();
    var el = document.getElementById('fal-src-license');
    if (el && p) {
      el.innerHTML = '许可：' + esc(p.license) + ' · <a href="' + esc(p.homepage) + '" target="_blank" ' +
        'style="color:#6ea8ff;">官网</a>';
    }
  }

  function renderChips() {
    var box = document.getElementById('fal-chips');
    var p = getProvider();
    if (!box || !p) return;
    box.innerHTML = (p.classes || [{ k: '', t: '全部' }]).map(function (c) {
      var active = String(state.cls || '') === String(c.k || '') ? ' active' : '';
      return '<span class="fal-chip' + active + '" data-cls="' + esc(c.k) + '">' + esc(c.t) + '</span>';
    }).join('');
  }

  function renderGrid() {
    var grid = document.getElementById('fal-grid');
    var count = document.getElementById('fal-count');
    if (!grid) return;
    var p = getProvider();

    if (count) {
      count.textContent = state.loading ? '加载中…'
        : (state.total ? '共 ' + state.total + ' 件' : '');
    }

    if (state.error) {
      grid.innerHTML = '<div class="fal-empty">❌ ' + esc(state.error) +
        '<br><button class="tool-btn" style="margin-top:8px;" onclick="window.FreeAssetLibrary.retry()">重试</button></div>';
      return;
    }
    if (state.loading && !state.items.length) {
      grid.innerHTML = '<div class="fal-empty">正在从 ' + esc(p ? p.label : '') + ' 拉取…</div>';
      return;
    }
    if (!state.items.length) {
      grid.innerHTML = '<div class="fal-empty">没有结果。<br>换个英文关键词，或把分类切回「全部」。</div>';
      return;
    }

    grid.innerHTML = state.items.map(function (it) {
      var thumb = it.thumb
        ? '<img loading="lazy" src="' + esc(it.thumb) + '" alt="" onerror="this.style.display=\'none\';this.parentNode.innerHTML=\'<div class=&quot;fal-noimg&quot;>🧊</div>\'">'
        : '<div class="fal-noimg">🧊</div>';
      var isLocal = state.localIds.has(state.providerId + '|' + it.id);
      var tip = isLocal ? '已在本地库，点击直接放入世界' : '点击：下载到本服务器并放入世界';
      return '<div class="fal-card" data-id="' + esc(it.id) + '" title="' + esc(it.title + '（' + tip + '）') + '">' +
        (isLocal ? '<span class="fal-local" title="已下载入库">✔ 本地</span>' : '') +
        '<div class="fal-thumb">' + thumb + '</div>' +
        '<div class="fal-info">' +
          '<div class="fal-name">' + esc(it.title) + '</div>' +
          '<div class="fal-meta">' + esc(fmtTris(it.tris)) + (it.size ? ' · ' + esc(fmtSize(it.size)) : '') + '</div>' +
        '</div>' +
        '</div>';
    }).join('');

    renderPager();
  }

  function renderPager() {
    var info = document.getElementById('fal-pageinfo');
    var prev = document.getElementById('fal-prev');
    var next = document.getElementById('fal-next');
    var pages = Math.max(1, Math.ceil(state.total / PER_PAGE));
    if (info) info.textContent = '第 ' + state.page + ' / ' + pages + ' 页';
    if (prev) prev.disabled = state.page <= 1 || state.loading;
    if (next) next.disabled = state.page >= pages || state.loading;
  }

  /* ============================ 搜索 ============================ */

  function cacheKey() {
    return [state.providerId, state.q, state.cls, state.page].join('|');
  }

  async function doSearch(force) {
    var p = getProvider();
    if (!p) return;
    var key = cacheKey();
    var hit = searchCache.get(key);
    if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      state.total = hit.total; state.items = hit.items; state.error = null; state.loading = false;
      renderGrid();
      return;
    }

    state.loading = true; state.error = null;
    renderGrid();
    try {
      var res = await p.search({ q: state.q, cls: state.cls, page: state.page, perPage: PER_PAGE });
      state.items = res.items || [];
      state.total = res.total || state.items.length;
      state.coverage = res.coverage || null;
      searchCache.set(key, { at: Date.now(), total: state.total, items: state.items });
      state.lastQueryAt = Date.now();
    } catch (e) {
      state.error = (e && e.message) || '搜索失败';
      state.items = []; state.total = 0;
    } finally {
      state.loading = false;
      renderGrid();
    }
  }

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.q = (document.getElementById('fal-q') || {}).value || '';
      state.page = 1;
      doSearch(false);
    }, SEARCH_DEBOUNCE_MS);
  }

  /* ============================ 放置 ============================ */

  /** 取落点的地面高度：优先当前地形的高度场，取不到则 0 */
  function groundY(x, z) {
    try {
      var list = (typeof terrainList !== 'undefined') ? terrainList : null;  // 编辑器顶层 let 词法绑定
      if (list && list.length && window.TerrainHeight) {
        var tid = (typeof terrainSelectedId !== 'undefined') ? terrainSelectedId : null;
        var t = null, i;
        for (i = 0; i < list.length; i++) { if (String(list[i].id) === String(tid)) { t = list[i]; break; } }
        if (!t) { for (i = 0; i < list.length; i++) { if (list[i].active) { t = list[i]; break; } } }
        if (!t) t = list[0];
        if (t && typeof window.TerrainHeight.createSampler === 'function') {
          var sampler = window.TerrainHeight.createSampler(t.params || {}, t.seed || 1);
          var y = sampler(x, z);
          if (typeof y === 'number' && isFinite(y)) return y;
        }
      }
    } catch (e) { /* 地形不可用就落到 y=0 */ }
    return 0;
  }

  function dropPoint() {
    var px = 0, pz = 20, py = 0;
    try {
      var cam = (typeof camera !== 'undefined') ? camera : null;   // 编辑器顶层 let 词法绑定
      if (cam && cam.position && cam.getWorldDirection && window.THREE) {
        var dir = new window.THREE.Vector3();
        cam.getWorldDirection(dir);
        px = cam.position.x + dir.x * 20;
        pz = cam.position.z + dir.z * 20;
      }
    } catch (e) { /* ignore */ }
    py = groundY(px, pz);
    return { x: Math.round(px * 100) / 100, y: Math.round(py * 1000) / 1000, z: Math.round(pz * 100) / 100 };
  }

  async function placeUrl(glbUrl, title) {
    if (!glbUrl) { notify('❌ 该资产没有可用的 GLB 地址', 'error'); return; }
    // 注意：这里必须用独立的 _placingObject 而不是 state.placing —— 默认流程是
    // 「placeItem 里先下载、再调本函数放置」，此时 state.placing 已为 true，
    // 若共用同一个标志，放置会被自己挡掉（2026-10-29 实测踩到）。
    if (state._placingObject) { notify('正在放置上一个模型，请稍候…', 'info'); return; }
    state._placingObject = true;
    try {
      var pt = dropPoint();
      var body = {
        type: 'uploaded_model',
        name: String(title || '免费模型').slice(0, 120),
        model_path: glbUrl,
        model_type: 'gltf',
        position_x: pt.x, position_y: pt.y, position_z: pt.z,
        rotation_x: 0, rotation_y: 0, rotation_z: 0,
        scale_x: 1, scale_y: 1, scale_z: 1
      };
      var r = await fetch('/api/world/objects', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify(body)
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok || !j || !j.id) {
        throw new Error((j && (j.details || j.error)) || ('HTTP ' + r.status));
      }
      notify('✅ 已放入世界：' + body.name, 'success');

      try { if (typeof window.loadWorldObjects === 'function') await window.loadWorldObjects(); } catch (e) { /* ignore */ }
      setTimeout(function () { focusAndSelect(j.id); }, 300);
    } catch (e) {
      notify('❌ 放置失败：' + ((e && e.message) || e), 'error');
    } finally {
      state._placingObject = false;
    }
  }

  function focusAndSelect(id) {
    try {
      if (typeof window.focusObject === 'function') window.focusObject(id);
      var list = (typeof worldObjects !== 'undefined') ? worldObjects : null;
      if (list && typeof window.selectObject === 'function') {
        var obj = null;
        for (var i = 0; i < list.length; i++) { if (String(list[i].id) === String(id)) { obj = list[i]; break; } }
        if (obj) window.selectObject(obj, false);
      }
      if (typeof window.updateRightObjectList === 'function') window.updateRightObjectList();
    } catch (e) { /* ignore */ }
  }

  /* ============================ 下载入库（默认路径） ============================ */

  /**
   * 默认行为：**先下载到本服务器，再用本地路径放置**。
   * 理由（2026-10-29 用户决策）：一个世界里同一件资产会被反复加载，
   * 若全世界都去热链第三方 CDN，对方的带宽/请求量会被我们放大的世界数量打爆。
   * 因此"点一下"= 落到本服务器 + 本服务器提供给所有玩家。
   *
   * 许可提示只在**每个浏览器第一次**弹一次（localStorage 记忆），不干扰后续操作。
   */
  function ensureLicenseAck() {
    if (state.licenseAck) return true;
    var p = getProvider();
    var ok = window.confirm(
      '将把模型文件下载并保存到本世界服务器：\n' +
      '  public/models/uploaded/free/' + (p ? p.id : state.providerId) + '/<资产id>.glb\n' +
      '之后所有玩家都从本服务器加载，不再请求对方 CDN。\n\n' +
      '许可提醒：' + (p ? p.license : '') + '\n' +
      '第三方条款把「保留自己的副本并对他人提供」视为再分发；\n' +
      '若这个世界要对外分发这些模型，请先取得对方的平台许可。\n\n' +
      '点「确定」表示你已知悉（本浏览器不再提示）。'
    );
    if (ok) {
      state.licenseAck = true;
      try { localStorage.setItem('fal_license_acked', '1'); } catch (e) { /* ignore */ }
    }
    return !!ok;
  }

  /** 下载入库（幂等：已在本地则后端直接复用，秒回） */
  async function importAsset(item) {
    notify('⬇ 正在下载到本服务器…', 'info');
    var r = await fetch('/api/free-assets/import', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ provider: state.providerId, id: item.id, title: item.title })
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.success) throw new Error((j && j.error) || ('HTTP ' + r.status));
    state.localIds.add(state.providerId + '|' + item.id);
    return j;   // { path, size, modelId, reused }
  }

  /** 点击一张卡片：下载（除非勾选"只用远程"）→ 放置 → 聚焦选中 */
  async function placeItem(item, cardEl) {
    if (state.placing) { notify('正在处理上一件，请稍候…', 'info'); return; }
    var p = getProvider();
    var remoteUrl = safeGlbUrl(p, item);

    if (state.remoteOnly) {
      await placeUrl(remoteUrl, item.title);
      return;
    }
    if (!ensureLicenseAck()) return;

    state.placing = true;
    if (cardEl) cardEl.classList.add('busy');
    try {
      var j = null;
      try {
        j = await importAsset(item);
      } catch (e) {
        // 下载失败不阻断流程：问一下是否改用远程链接先放进去
        var fallback = window.confirm('下载到本服务器失败：' + ((e && e.message) || e) +
          '\n\n要先用**远程链接**把它放进世界吗？\n（不占本地磁盘，但每次加载都会请求对方 CDN）');
        if (!fallback) return;
        await placeUrl(remoteUrl, item.title);
        return;
      }
      if (j.reused) {
        notify('✔ 已在本地库，直接放置：' + item.title, 'success');
      } else {
        notify('⬇ 已下载到本服务器（' + Math.round((j.size || 0) / 1024) + 'KB），正在放置…', 'success');
      }
      await placeUrl(j.path, item.title);
      try { if (typeof window.refreshUploadedModels === 'function') await window.refreshUploadedModels(); } catch (e) { /* ignore */ }
      renderGrid();
    } finally {
      state.placing = false;
      if (cardEl) cardEl.classList.remove('busy');
    }
  }

  /** 读一次本地库，给已入库的卡片打 ✔ */
  async function refreshLocalIds() {
    try {
      var r = await fetch('/api/uploaded-models?limit=500&category=all');
      var j = await r.json();
      var re = new RegExp('/models/uploaded/free/([a-z0-9-]+)/([a-z0-9-]+)\\.glb$', 'i');
      (j.models || []).forEach(function (m) {
        var hit = re.exec(String(m.path || ''));
        if (hit) state.localIds.add(hit[1] + '|' + hit[2]);
      });
    } catch (e) { /* 列表失败不影响主流程 */ }
  }

  /* ============================ 成套场景（kit） ============================ */

  /**
   * 一个套件 = 一整块摆好的场景。服务端负责：
   *   1) 取 layout（需要 API key，对方只给已登录账号）；
   *   2) 下载 layout 里真正用到的零件（幂等，已在本地就复用）；
   *   3) 一次批量写 world_objects。
   * 前端只做三件事：选套件、给落点、刷新世界。
   */
  var kitState = {
    loaded: false,
    loading: false,
    kits: [],
    current: null,        // 当前打开的套件详情
    importing: false,
    keyConfigured: false
  };

  function switchTab(tab) {
    var single = document.getElementById('fal-view-single');
    var kit = document.getElementById('fal-view-kit');
    if (single) single.style.display = tab === 'kit' ? 'none' : '';
    if (kit) kit.style.display = tab === 'kit' ? '' : 'none';
    var tabs = document.querySelectorAll('#panel-free-assets .fal-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
    }
    if (tab === 'kit') {
      loadKits(false);
      refreshKeyStatus();
    }
  }

  async function loadKits(force) {
    if (kitState.loading) return;
    if (kitState.loaded && !force) return;
    kitState.loading = true;
    var grid = document.getElementById('fal-kit-grid');
    if (grid) grid.innerHTML = '<div class="fal-empty">正在拉取成套场景…</div>';
    try {
      var r = await fetch('/api/free-assets/kits?provider=' + encodeURIComponent(state.providerId));
      var j = await r.json();
      if (!r.ok || !j.success) throw new Error((j && j.error) || ('HTTP ' + r.status));
      kitState.kits = j.kits || [];
      kitState.loaded = true;
      renderKits();
    } catch (e) {
      if (grid) {
        grid.innerHTML = '<div class="fal-empty">❌ ' + esc((e && e.message) || e) +
          '<br><button class="tool-btn" style="margin-top:8px;" ' +
          'onclick="window.FreeAssetLibrary.reloadKits()">重试</button></div>';
      }
    } finally {
      kitState.loading = false;
    }
  }

  function renderKits() {
    var grid = document.getElementById('fal-kit-grid');
    var count = document.getElementById('fal-kit-count');
    if (count) count.textContent = kitState.kits.length ? '共 ' + kitState.kits.length + ' 套' : '';
    if (!grid) return;
    if (!kitState.kits.length) {
      grid.innerHTML = '<div class="fal-empty">没有可用的成套场景。</div>';
      return;
    }
    grid.innerHTML = kitState.kits.map(function (k) {
      var sel = kitState.current && String(kitState.current.id) === String(k.id) ? ' sel' : '';
      /**
       * placements 来自 composition.placements，为 0 = 对方还没生成场景布局 → 整套导不了。
       * 列表接口拿不到 layout（详情才带），所以用 placements 作为「能不能整套导」的预判标记：
       *   status !== published 且 placements=0 → 还在搭建（例：Three Kingdoms Settlements 22/60）
       *   status === published 且 placements=0 → 已上架但没有布局数据（例：School 60/60）
       */
      var dim = '';
      var meta;
      if (!k.placements) {
        var prog = k.partsPublished + (k.partsPlanned && k.partsPlanned !== k.partsPublished
          ? '/' + k.partsPlanned : '') + ' 件';
        if (k.status && k.status !== 'published') {
          meta = '⏳ 搭建中 ' + prog + ' · 暂不可整套导入';
        } else {
          meta = '⚠️ 无场景布局 · ' + prog + ' · 只能单件用';
        }
        dim = ' style="opacity:.62"';
      } else {
        meta = k.partsPublished + ' 个零件 · ' + k.placements + ' 个摆放点';
        if (k.status && k.status !== 'published') meta += ' · 上架中';
      }
      return '<div class="fal-kit' + sel + '" data-kit="' + esc(k.id) + '" title="' + esc(k.title) + '"' + dim + '>' +
        '<div class="fal-kit-ico">🧩</div>' +
        '<div class="fal-kit-info"><div class="fal-kit-name">' + esc(k.title) + '</div>' +
        '<div class="fal-kit-meta">' + esc(meta) + '</div></div></div>';
    }).join('');
  }

  async function openKit(kitId) {
    var box = document.getElementById('fal-kit-detail');
    if (box) { box.style.display = ''; box.innerHTML = '<div class="fal-empty">正在读取套件详情…</div>'; }
    try {
      var r = await fetch('/api/free-assets/kits/' + encodeURIComponent(kitId) +
        '?provider=' + encodeURIComponent(state.providerId));
      var j = await r.json();
      if (!r.ok || !j.success) throw new Error((j && j.error) || ('HTTP ' + r.status));
      kitState.current = j.kit;
      renderKits();
      renderKitDetail();
    } catch (e) {
      if (box) box.innerHTML = '<div class="fal-empty">❌ 读取失败：' + esc((e && e.message) || e) + '</div>';
    }
  }

  function renderKitDetail() {
    var box = document.getElementById('fal-kit-detail');
    var k = kitState.current;
    if (!box || !k) return;

    var placements = (k.composition && k.composition.placements) || 0;
    var distinct = (k.composition && k.composition.distinct_parts) || (k.parts || []).length;
    var thumbs = (k.parts || []).slice(0, 10).map(function (p) {
      var img = p.thumb
        ? '<img loading="lazy" src="' + esc(p.thumb) + '" alt="" ' +
          'onerror="this.style.display=\'none\';this.parentNode.innerHTML=\'<span class=&quot;fal-noimg&quot;>🧊</span>\'">'
        : '<span class="fal-noimg">🧊</span>';
      return '<div class="fal-thumb" title="' + esc(p.title) + '">' + img + '</div>';
    }).join('');

    var canImport = !!k.layout;
    var statusZh = k.status === 'filling-up' ? '搭建中'
      : (k.status === 'published' ? '已上架' : (k.status || '未知'));
    var hint;
    if (canImport) {
      hint = '整场景摆放关系已取到，可直接导入。';
    } else if (k.needsKey && !k.hasKey) {
      // needsKey = 对方有摆放点数据（composition.placements>0）但 layout 拿不到 → 缺 key
      hint = '⚠️ 还没配置 API key —— 只能看到零件清单，拿不到「谁摆在哪」。<b>先在下面填 key。</b>';
    } else if (k.needsKey && k.hasKey) {
      // 有 key 也有摆放点数据，仍然没 layout → key 本身无效/未激活
      hint = '⚠️ key 已配置但没拿到布局：key 可能无效/未激活，去 polyfork.dev/account 确认一下。';
    } else if (k.status && k.status !== 'published') {
      // composition 为空 + 还在搭建（例：Three Kingdoms Settlements 22/60）→ 对方还没做布局
      hint = '⏳ 这个套件在 Polyfork 上还是「' + esc(statusZh) + '」状态，已上架 ' +
        (k.parts || []).length + ' 个零件，但<b>还没有生成场景布局</b>，所以无法整套导入。' +
        '下面的零件可以单个下载使用；等它上完架再回来试。';
    } else {
      // 已上架但 composition 仍为空（例：School 60/60、Primal Future Armory kit）
      hint = '⚠️ 这个套件已上架（' + (k.parts || []).length +
        ' 个零件），但 Polyfork 没有给出场景布局数据，只能按单件使用。';
    }

    box.innerHTML = [
      '<div class="panel-section-title">🧩 ' + esc(k.title) + '</div>',
      '<div class="fal-kit-box">',
      '  <div class="fal-kv"><span>零件</span><b>' + (k.parts || []).length + ' 个（用到 ' + distinct + ' 个）</b></div>',
      '  <div class="fal-kv"><span>摆放点</span><b>' + (placements || '—') + '</b></div>',
      '</div>',
      '<div class="fal-partstrip">' + thumbs + '</div>',
      '<div class="fal-license" style="margin-top:8px;">' + hint + '</div>',
      '<div class="fal-keyrow" style="margin-top:8px;">',
      '  <span class="fal-license">整体再转</span>',
      '  <input type="text" id="fal-kit-rot" value="0" style="width:56px;padding:4px 6px;border-radius:6px;' +
      'border:1px solid #2a3444;background:#11161f;color:#dfe6f2;font-size:12px;">',
      '  <span class="fal-license">度</span>',
      '  <label class="fal-dl-row" style="margin-left:8px;"><input type="checkbox" id="fal-kit-collision"> 加碰撞</label>',
      '</div>',
      '<div class="fal-btnrow">',
      '  <button type="button" class="' + (canImport ? 'primary' : '') + '" id="fal-kit-import"' +
      (canImport ? '' : ' disabled') + '>📍 整套导入到当前视角</button>',
      '</div>',
      '<div class="fal-license" id="fal-kit-progress"></div>'
    ].join('');

    try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
  }

  function kitProgress(msg) {
    var el = document.getElementById('fal-kit-progress');
    if (el) el.innerHTML = msg || '';
  }

  async function importKit() {
    var k = kitState.current;
    if (!k) return;
    if (kitState.importing) { notify('正在导入上一个套件，请稍候…', 'info'); return; }
    if (!k.layout) {
      /**
       * 不再一律甩锅给 API key（2026-11-12 踩到）：
       * Three Kingdoms Settlements 是 filling-up、composition 为 null、key 明明配好了，
       * 真正原因是对方还没生成场景布局。按实际情况分开报。
       */
      var why;
      if (k.needsKey && !k.hasKey) {
        why = '还没配置 Polyfork API key，拿不到「谁摆在哪」';
      } else if (k.needsKey && k.hasKey) {
        why = 'key 已配置但被拒（可能无效/未激活），拿不到「谁摆在哪」';
      } else if (k.status && k.status !== 'published') {
        why = '这个套件在 Polyfork 上还是「搭建中」，只上架了 ' + (k.parts || []).length +
          ' 个零件，还没生成场景布局 —— 只能按单件使用，等它上完架再来';
      } else {
        why = '这个套件已上架，但 Polyfork 没有给出场景布局数据 —— 只能按单件使用';
      }
      notify('❌ ' + why, 'error');
      return;
    }
    if (!ensureLicenseAck()) return;

    var placements = (k.composition && k.composition.placements) || 0;
    if (placements >= 100 && !window.confirm(
      '即将在「当前视角前方」导入整套「' + k.title + '」：\n' +
      '  · 摆放点 ' + placements + ' 个\n' +
      '  · 会新建同样数量的世界对象（重复导入会重复叠加）\n\n' +
      '确定导入吗？')) return;

    var rotEl = document.getElementById('fal-kit-rot');
    var colEl = document.getElementById('fal-kit-collision');
    var rotateDeg = rotEl ? (Number(rotEl.value) || 0) : 0;
    var hasCollision = !!(colEl && colEl.checked);

    var pt = dropPoint();
    var btn = document.getElementById('fal-kit-import');
    kitState.importing = true;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 导入中…'; }
    kitProgress('正在下载零件并写入世界。零件首次下载，单个约 1~3 秒，请勿关闭页面…');

    var t0 = Date.now();
    try {
      var r = await fetch('/api/free-assets/import-kit', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({
          provider: state.providerId,
          id: k.id,
          x: pt.x, y: pt.y, z: pt.z,
          rotateDeg: rotateDeg,
          hasCollision: hasCollision,
          namePrefix: k.title + ' · '
        })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok || !j.success) {
        if (j && j.code === 'NEED_KEY') {
          kitProgress('⚠️ ' + esc(j.error) + '<br>' + esc(j.hint || ''));
          var keyInput = document.getElementById('fal-key');
          if (keyInput) keyInput.focus();
          return;
        }
        // 把后端收集到的首个零件错误带出来 —— 只回一句"都失败了"没法排查
        var detail = (j && (j.error || j.details)) || ('HTTP ' + r.status);
        if (j && j.partErrors && j.partErrors.length) {
          var e0 = j.partErrors[0];
          detail += '｜首个失败：' + (e0.id || e0.key) + ' → ' + e0.error;
        }
        throw new Error(detail);
      }

      var secs = Math.round((Date.now() - t0) / 100) / 10;
      var reused = (j.models || []).filter(function (m) { return m.reused; }).length;
      var lines = ['✅ 已生成 <b>' + j.created + '</b> 个对象（零件 ' + (j.models || []).length +
        ' 个，其中 ' + reused + ' 个复用本地副本），耗时 ' + secs + ' 秒。'];
      // 整套导入会自动建一个编组，避免 300+ 个零件平铺在对象列表里
      if (j.groupId && j.groupName) {
        lines.push('📦 已自动归入编组「' + esc(j.groupName) + '」，在右侧对象列表里可以折叠/展开。');
      } else if (j.created >= 2) {
        lines.push('⚠️ 自动编组没生效（对象已正常导入，可在对象列表里手动编组）。');
      }

      if (j.hasTerrain) {
        lines.push('🏞️ 地形已随套件落下（kit 自带地面，不会再是悬空场景）。');
      } else if (j.skipped && j.skipped.terrain) {
        lines.push('⚠️ 这个套件没有独立地形资产，' + j.skipped.terrain + ' 处地面程序已跳过。');
      }
      if (j.skipped && j.skipped.noPath) {
        lines.push('⚠️ 有 ' + j.skipped.noPath + ' 处摆放因为零件没下载成功被跳过。');
      }
      if (j.foreignParts && j.foreignParts.length) {
        lines.push('🌿 已一并下载 ' + j.foreignParts.length + ' 个跨套件借用件（草地/树/石头等）。');
      }
      if (j.unresolvedKeys && j.unresolvedKeys.length) {
        lines.push('⚠️ 有 ' + j.unresolvedKeys.length + ' 个零件名没对上资产 id：' +
          j.unresolvedKeys.slice(0, 5).join('、'));
      }
      if (j.partErrors && j.partErrors.length) {
        var pe = j.partErrors[0];
        lines.push('⚠️ ' + j.partErrors.length + ' 个零件下载失败，首个：' + (pe.id || pe.key) + ' → ' + pe.error);
      }
      kitProgress(lines.join('<br>'));
      if (j.complete === false) {
        notify('⚠️ 导入完成但有 ' + (j.partErrors || []).length + ' 个零件失败：' + k.title + '（' + j.created + ' 个对象），可再导一次补齐', 'success');
      } else {
        notify('✅ 套件已导入：' + k.title + '（' + j.created + ' 个对象）', 'success');
      }

      try { if (typeof window.loadWorldObjects === 'function') await window.loadWorldObjects(); } catch (e) { /* ignore */ }
      try { if (typeof window.updateRightObjectList === 'function') window.updateRightObjectList(); } catch (e) { /* ignore */ }
      if (j.firstId) setTimeout(function () { focusAndSelect(j.firstId); }, 400);
    } catch (e) {
      kitProgress('❌ 导入失败：' + esc((e && e.message) || e));
      notify('❌ 导入失败：' + ((e && e.message) || e), 'error');
    } finally {
      kitState.importing = false;
      if (btn) { btn.disabled = false; btn.textContent = '📍 整套导入到当前视角'; }
    }
  }

  /* ---------------- API key ---------------- */

  async function refreshKeyStatus() {
    var el = document.getElementById('fal-key-status');
    try {
      var r = await fetch('/api/free-assets/key-status?provider=' + encodeURIComponent(state.providerId));
      var j = await r.json();
      kitState.keyConfigured = !!(j && j.configured);
      if (el) {
        el.innerHTML = j && j.configured
          ? '✔ 已配置（尾号 ' + esc(j.tail || '****') + (j.fromEnv ? '，来自环境变量' : '') + '）'
          : '✖ 未配置 —— 未配置只能看零件，不能整场景导入';
      }
    } catch (e) {
      if (el) el.textContent = '';
    }
  }

  async function saveKey() {
    var input = document.getElementById('fal-key');
    var key = input ? String(input.value || '').trim() : '';
    if (!key) { notify('请先粘贴 key', 'error'); return; }
    try {
      var r = await fetch('/api/free-assets/key', {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({ provider: state.providerId, key: key })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok || !j.success) throw new Error((j && j.error) || ('HTTP ' + r.status));
      if (input) input.value = '';
      notify('✅ API key 已保存（尾号 ' + (j.tail || '') + '）', 'success');
      await refreshKeyStatus();
      // 重新取一次当前套件，把 layout 拿到手
      if (kitState.current) await openKit(kitState.current.id);
    } catch (e) {
      notify('❌ 保存失败：' + ((e && e.message) || e), 'error');
    }
  }

  /* ============================ 事件绑定 ============================ */

  function bindEvents() {
    var panel = document.getElementById('panel-free-assets');
    if (!panel || panel.__falBound) return;
    panel.__falBound = true;

    panel.addEventListener('change', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === 'fal-provider') {
        state.providerId = t.value;
        state.page = 1;
        renderChips(); updateLicenseLine(); doSearch(false);
      } else if (t.id === 'fal-remote-only') {
        state.remoteOnly = !!t.checked;
      }
    });

    panel.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'fal-q') onSearchInput();
    });

    panel.addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'fal-q' && e.key === 'Enter') {
        clearTimeout(searchTimer);
        state.q = e.target.value || '';
        state.page = 1;
        doSearch(true);
      }
    });

    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;

      // 顶部 tab（单个模型 / 成套场景）
      var tab = t.closest ? t.closest('.fal-tab') : null;
      if (tab) {
        switchTab(tab.getAttribute('data-tab'));
        return;
      }

      // 套件卡片 → 打开详情
      var kitEl = t.closest ? t.closest('.fal-kit') : null;
      if (kitEl) {
        openKit(kitEl.getAttribute('data-kit'));
        return;
      }

      if (t.id === 'fal-kit-import') { importKit(); return; }
      if (t.id === 'fal-key-save') { saveKey(); return; }

      // 分类 chips
      var chip = t.closest ? t.closest('.fal-chip') : null;
      if (chip) {
        state.cls = chip.getAttribute('data-cls') || '';
        state.page = 1;
        renderChips();
        doSearch(false);
        return;
      }

      // 上一页/下一页
      if (t.id === 'fal-prev') {
        if (state.page > 1) { state.page--; doSearch(false); }
        return;
      }
      if (t.id === 'fal-next') {
        if (state.page < Math.ceil(state.total / PER_PAGE)) { state.page++; doSearch(false); }
        return;
      }

      // 卡片 → 下载到本服务器 → 放入世界（勾选"只用远程"时才走热链）
      var card = t.closest ? t.closest('.fal-card') : null;
      if (card) {
        var id = card.getAttribute('data-id');
        var item = state.items.filter(function (x) { return String(x.id) === String(id); })[0];
        if (!item) return;
        placeItem(item, card);
      }
    });
  }

  var firstLoadDone = false;
  function ensureFirstLoad() {
    if (firstLoadDone) return;
    firstLoadDone = true;
    // 【2026-11-12 性能】已入库标记（/api/uploaded-models?limit=500&category=all，约 2 秒）
    // 从页面启动挪到「首次打开资产库面板」——启动时用户根本还没打开这个面板。
    refreshLocalIds().then(function () { if (state.items.length) renderGrid(); });
    doSearch(false);
  }

  /* ============================ 启动 ============================ */

  function start() {
    if (state.started) return;
    state.started = true;
    try { state.licenseAck = localStorage.getItem('fal_license_acked') === '1'; } catch (e) { /* ignore */ }
    injectStyle();
    injectNav();
    injectPanel();
    wrapSwitchPanel();
    renderProviderSelect();
    renderChips();
    bindEvents();
    // 已入库的资产打 ✔ 挪到 ensureFirstLoad（首次打开面板时才请求），
    // 启动阶段不再发 /api/uploaded-models?limit=500（原先约 2 秒）。
    console.log('[freeAssetLibrary] 已启动 v' + VERSION + '（源：' + Object.keys(PROVIDERS).join(',') +
      '，默认：下载到本服务器）');
  }

  function waitDom() {
    if (document.getElementById('panel-content') && document.getElementById('sidebar')) { start(); return; }
    setTimeout(waitDom, 200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitDom);
  else waitDom();

  window.FreeAssetLibrary = {
    version: VERSION,
    providers: PROVIDERS,
    registerProvider: registerProvider,
    open: function () { if (typeof window.switchPanel === 'function') window.switchPanel('free-assets'); },
    search: function (q, cls) {
      state.q = q || '';
      if (cls !== undefined) state.cls = cls || '';
      state.page = 1;
      return doSearch(true);
    },
    retry: function () { return doSearch(true); },
    // 成套场景
    openKits: function () { switchTab('kit'); },
    reloadKits: function () { kitState.loaded = false; return loadKits(true); },
    openKit: function (id) { return openKit(id); },
    importKit: function () { return importKit(); },
    _diag: function () {
      return {
        version: VERSION,
        started: state.started,
        provider: state.providerId,
        providers: Object.keys(PROVIDERS),
        q: state.q, cls: state.cls, page: state.page,
        total: state.total, items: state.items.length,
        loading: state.loading, error: state.error,
        remoteOnly: state.remoteOnly,
        licenseAck: state.licenseAck,
        localIds: state.localIds.size,
        cacheKeys: searchCache.size,
        kitsLoaded: kitState.loaded,
        kits: kitState.kits.length,
        kitCurrent: kitState.current ? kitState.current.id : null,
        kitHasLayout: !!(kitState.current && kitState.current.layout),
        keyConfigured: kitState.keyConfigured,
        navInjected: !!document.getElementById('nav-free-assets'),
        panelInjected: !!document.getElementById('panel-free-assets'),
        panelActive: !!(document.getElementById('panel-free-assets') || {}).classList &&
          document.getElementById('panel-free-assets').classList.contains('active')
      };
    }
  };
})();
