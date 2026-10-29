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

  var VERSION = '1.0.0';
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
      '.fal-dl-row{display:flex;align-items:center;gap:6px;font-size:12px;color:#a9b4c6;cursor:pointer;}'
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

      '<div class="panel-section">',
      '  <div class="panel-section-title">🔗 资产源</div>',
      '  <div class="fal-src-row"><select id="fal-provider"></select></div>',
      '  <div class="fal-license" id="fal-src-license"></div>',
      '</div>',

      '<div class="panel-section">',
      '  <div class="panel-section-title">🔍 搜索（英文关键词更好命中）</div>',
      '  <input type="text" id="fal-q" placeholder="如 car / house / tree / boat，回车搜索">',
      '  <div class="fal-chips" id="fal-chips"></div>',
      '</div>',

      '<div class="panel-section">',
      '  <div class="panel-section-title">🖼️ 结果 <span id="fal-count" style="color:#7d8798;font-weight:400;"></span></div>',
      '  <div class="fal-grid" id="fal-grid"><div class="fal-empty">点上方搜索，或直接切到本面板（默认拉最新 24 件）</div></div>',
      '  <div class="fal-pager"><button id="fal-prev" type="button">← 上一页</button>',
      '    <span id="fal-pageinfo">-</span><button id="fal-next" type="button">下一页 →</button></div>',
      '</div>',

      '<div class="panel-section">',
      '  <div class="panel-section-title">⚖️ 使用方式与许可</div>',
      '  <label class="fal-dl-row"><input type="checkbox" id="fal-remote-only"> 只用远程链接（不下载到本服务器）</label>',
      '  <div class="fal-license" id="fal-dl-tip">',
      '    <b>默认：点一下 = 下载到本服务器并放置</b>。文件存到 public/models/uploaded/free/&lt;源&gt;/&lt;id&gt;.glb，',
      '    并登记进「📂 已上传模型」，之后所有玩家都从本服务器加载，不再请求对方 CDN。<br>',
      '    勾选上面的选项可改为纯远程（热链）：不占本地磁盘，但每次加载都会请求对方 CDN —— ',
      '    世界/玩家多时会给对方造成压力，不建议长期这样用。<br>',
      '    许可：第三方条款把「保留自己的副本并对外提供」视为再分发，对外分发场景需另行取得其平台许可。',
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
        var nav = document.getElementById('nav-free-assets');
        if (nav) nav.classList.add('active');
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
    // 已入库的资产打 ✔（异步，失败不影响使用）
    refreshLocalIds().then(function () { if (state.items.length) renderGrid(); });
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
        navInjected: !!document.getElementById('nav-free-assets'),
        panelInjected: !!document.getElementById('panel-free-assets'),
        panelActive: !!(document.getElementById('panel-free-assets') || {}).classList &&
          document.getElementById('panel-free-assets').classList.contains('active')
      };
    }
  };
})();
