/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundAssets.js —— 音效库 ③ 声音资产（统一素材仓库）
 *
 * 这里列出 uploads 目录下的**全部**音频（不管它是被谁上传的、被用在哪），
 * 并且每一行都标清楚「这个文件归谁用」：
 *   角色动作 · 待机（zhu跳舞）　　武器音效 · 挥击
 *   模型声源 · 课桌1　　环境声景 · (900, 700, 0) 半径 40m
 *   天气声音 · 风　　场景背景音
 * 归属明细由后端 /api/sound-scenes/assets 一并返回（refs 字段）。
 *
 * 另外提供：按归属筛选、搜文件名、上传新文件、点「编辑」做裁切/增益/淡入淡出。
 */
(function () {
  'use strict';

  var S = { mounted: false, assets: [], filter: 'all', keyword: '' };
  function token() { try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id) { return document.getElementById(id); }

  // 归属分组：g 是后端返回的分组 id
  var GROUPS = {
    anim:    { label: '角色动作',   color: '#85B7EB' },
    weapon:  { label: '武器音效',   color: '#a78bfa' },
    object:  { label: '模型声源',   color: '#5DCAA5' },
    region:  { label: '区域铺底',   color: '#888780' },
    pad:     { label: '环境声景',   color: '#EF9F27' },
    weather: { label: '天气声音',   color: '#f59e0b' },
    music:   { label: '场景背景音', color: '#e879f9' }
  };
  var GROUP_ORDER = ['anim', 'weapon', 'object', 'pad', 'weather', 'music', 'region'];
  var WEATHER_LABEL = { wind: '风', rain: '雨', snow: '雪', fog: '雾', thunder: '雷' };

  var CSS = [
    '.sa-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
    '.sa-bar select,.sa-bar input{background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:4px 7px;font-size:12px}',
    '.sa-bar input{width:150px}',
    '.sa-tb{width:100%;border-collapse:collapse;font-size:12px}',
    '.sa-tb th{text-align:left;font-weight:400;color:var(--muted);font-size:11px;padding:6px 8px;border-bottom:1px solid var(--border)}',
    '.sa-tb td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:top}',
    '.sa-tb tr:hover td{background:rgba(255,255,255,0.03)}',
    '.sa-nm{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sa-num{color:var(--muted);font-size:11px;white-space:nowrap}',
    '.sa-none{color:var(--orange)}',
    '.sa-refs{display:flex;flex-wrap:wrap;gap:4px;max-width:460px}',
    '.sa-tag{font-size:10px;border-radius:3px;padding:1px 6px;border:1px solid;max-width:230px;overflow:hidden;text-overflow:ellipsis}',
    '.sa-tag small{opacity:0.72;overflow:hidden;text-overflow:ellipsis}',
    '.sa-empty{padding:26px;text-align:center;color:var(--muted);font-size:12px}'
  ].join('\n');

  async function api(path, opt) {
    var r = await fetch(path, Object.assign({
      headers: { 'Authorization': 'Bearer ' + token() }
    }, opt || {}));
    var b = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status));
    return b;
  }

  // ─── 归属文案 ───────────────────────────────────────────────

  function keyLabel(g, k) {
    if (g === 'anim' || g === 'weapon') {
      var list = (window.SoundSections && window.SoundSections.keys) ? window.SoundSections.keys(g === 'anim' ? 'anim' : 'weapon') : [];
      for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i].label;
      return k;
    }
    if (g === 'weather') return WEATHER_LABEL[k] || k;
    return '';
  }

  function refTag(r) {
    var g = GROUPS[r.g] || { label: r.g, color: '#888780' };
    var lbl = keyLabel(r.g, r.k);
    var txt = g.label + (lbl ? ' · ' + lbl : '');
    return '<span class="sa-tag" style="color:' + g.color + ';border-color:' + g.color + '55;background:' + g.color + '12" title="' +
      esc((g.label + ' ' + lbl + ' ' + (r.t || '')).trim()) + '">' + esc(txt) +
      (r.t ? ' <small>' + esc(r.t) + '</small>' : '') + '</span>';
  }

  function groupsOf(a) {
    var seen = {};
    (a.refs || []).forEach(function (r) { seen[r.g] = 1; });
    return Object.keys(seen);
  }

  // ─── 加载与渲染 ─────────────────────────────────────────────

  async function load() {
    var box = $('sa-body');
    try {
      var d = await api('/api/sound-scenes/assets');
      S.assets = d.assets || [];
    } catch (e) {
      if (box) box.innerHTML = '<div class="sa-empty" style="color:#ff6b6b">加载失败：' + esc(e.message) + '</div>';
      return;
    }
    render();
  }

  function render() {
    var box = $('sa-body');
    if (!box) return;
    var list = S.assets.filter(function (a) {
      if (S.filter === 'unused') { if ((a.refs || []).length) return false; }
      else if (S.filter !== 'all') { if (groupsOf(a).indexOf(S.filter) < 0) return false; }
      if (S.keyword) {
        var hay = a.name + ' ' + (a.refs || []).map(function (r) { return r.g + ' ' + r.k + ' ' + r.t; }).join(' ');
        if (hay.toLowerCase().indexOf(S.keyword.toLowerCase()) < 0) return false;
      }
      return true;
    });

    var stat = $('sa-stat');
    if (stat) {
      var counts = {};
      S.assets.forEach(function (a) { groupsOf(a).forEach(function (g) { counts[g] = (counts[g] || 0) + 1; }); });
      var parts = GROUP_ORDER.filter(function (g) { return counts[g]; })
        .map(function (g) { return GROUPS[g].label + ' ' + counts[g]; });
      var totalMB = S.assets.reduce(function (s, a) { return s + a.size; }, 0) / 1048576;
      stat.textContent = '共 ' + S.assets.length + ' 个文件 · ' + totalMB.toFixed(2) + ' MB' +
        (parts.length ? ' · ' + parts.join(' / ') : ' · 还没有被任何地方引用');
    }

    if (!list.length) { box.innerHTML = '<div class="sa-empty">没有符合条件的音频</div>'; return; }

    box.innerHTML = '<table class="sa-tb"><thead><tr>' +
      '<th>文件名</th><th>归属</th><th>大小</th><th>修改时间</th><th>操作</th>' +
      '</tr></thead><tbody>' +
      list.map(function (a) {
        var refs = a.refs || [];
        var cell = refs.length
          ? '<div class="sa-refs">' + refs.map(refTag).join('') + '</div>'
          : '<span class="sa-none">未被引用</span>';
        var dt = new Date(a.mtime).toLocaleDateString('zh-CN');
        return '<tr>' +
          '<td class="sa-nm" title="' + esc(a.url) + '">' + esc(a.name) + '</td>' +
          '<td>' + cell + '</td>' +
          '<td class="sa-num">' + (a.size / 1024).toFixed(1) + ' KB</td>' +
          '<td class="sa-num">' + dt + '</td>' +
          '<td style="white-space:nowrap">' +
            '<button class="btn btn-secondary btn-sm" data-url="' + esc(a.url) + '">试听</button> ' +
            '<button class="btn btn-secondary btn-sm" data-edit="' + esc(a.name) + '">编辑</button>' +
          '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';

    box.querySelectorAll('button[data-url]').forEach(function (b) {
      b.addEventListener('click', function () {
        try { new Audio(b.getAttribute('data-url')).play(); } catch (e) {}
      });
    });
    box.querySelectorAll('button[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { openEditor(b.getAttribute('data-edit')); });
    });
  }

  // ─── 上传 ───────────────────────────────────────────────────

  async function onPickFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      var fd = new FormData();
      fd.append('sound_file', f);
      var r = await fetch('/api/character-templates/upload-sound', { method: 'POST', body: fd });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));
      await load();
      toast('已上传：' + d.filename);
    } catch (err) {
      alert('上传失败：' + err.message);
    } finally {
      e.target.value = '';
    }
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = '✅ ' + msg;
    t.style.cssText = 'position:fixed;top:18px;right:18px;background:rgba(0,255,0,0.15);border:1px solid #00ff00;color:#00ff00;padding:7px 12px;border-radius:6px;font-size:12px;z-index:9999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  // ─── 编辑：按需加载编辑器（不进 admin.html，避免主包膨胀）──────
  function loadScript(src, attr) {
    return new Promise(function (resolve, reject) {
      var old = document.querySelector('script[' + attr + ']');
      if (old) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.setAttribute(attr, '1');
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('加载失败：' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadEditor() {
    if (window.SoundEditor && window.SoundWave) return Promise.resolve();
    // 先画布后编辑器：编辑器渲染时就要用到 SoundWave.draw
    return loadScript('js/soundWaveDraw.js?v=1', 'data-sw').then(function () {
      return loadScript('js/soundEditor.js?v=3', 'data-se');
    });
  }

  function openEditor(name) {
    var asset = null;
    for (var i = 0; i < S.assets.length; i++) if (S.assets[i].name === name) { asset = S.assets[i]; break; }
    if (!asset) return;
    loadEditor().then(function () {
      window.SoundEditor.open(asset, function () { load(); });
    }).catch(function (e) { alert(e.message); });
  }

  async function mount(container) {
    if (!container) return;
    if (!S.mounted) {
      var st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      S.mounted = true;
    }
    var gopts = GROUP_ORDER.map(function (g) {
      return '<option value="' + g + '">' + GROUPS[g].label + '</option>';
    }).join('');

    container.innerHTML =
      '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.7">' +
        '这里是所有音频素材的中央仓库——不管它是被谁上传的、被用在哪，都会列在这里。<br>' +
        '每一行的「归属」说明它属于哪一族、用在哪一处（比如「角色动作 · 待机（zhu跳舞）」）。' +
        '点「编辑」可以裁切、调音量、加淡入淡出，改完另存为新文件（不覆盖原件——文件名就是引用键）。' +
      '</div>' +
      '<div class="sa-bar">' +
        '<select id="sa-filter">' +
          '<option value="all">全部归属</option>' + gopts +
          '<option value="unused">未被引用</option>' +
        '</select>' +
        '<input id="sa-q" type="text" placeholder="搜文件名或归属">' +
        '<span class="sa-num" id="sa-stat"></span>' +
        '<span style="flex:1"></span>' +
        '<button class="btn btn-secondary btn-sm" id="sa-upload">⬆ 上传音频</button>' +
        '<input type="file" id="sa-file" accept=".mp3,.ogg,.wav,.aac,.m4a" style="display:none">' +
        '<button class="btn btn-secondary btn-sm" id="sa-refresh">刷新</button>' +
      '</div>' +
      '<div id="sa-body"><div class="sa-empty">加载中…</div></div>';

    $('sa-filter').addEventListener('change', function () { S.filter = this.value; render(); });
    var qt;
    $('sa-q').addEventListener('input', function () {
      var v = this.value.trim();
      clearTimeout(qt);
      qt = setTimeout(function () { S.keyword = v; render(); }, 250);
    });
    $('sa-refresh').addEventListener('click', load);
    $('sa-upload').addEventListener('click', function () { $('sa-file').click(); });
    $('sa-file').addEventListener('change', onPickFile);
    load();
  }

  window.SoundAssets = { mount: mount };
})();
