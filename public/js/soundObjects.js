/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundObjects.js —— 音效库 ② 模型声源（S2：配置界面）
 *
 * 给场景物件挂声音：靠近才响，走远消失。
 * 本阶段只做「能填参数并保存」，游戏内真正发声要等 S3 的运行时（soundRuntime.js）。
 *
 * 数据落点：world_objects.custom_config.audio
 *   { url, radius, minDist, volume, loop, falloff }
 *
 * 接口：/api/sound-scenes/*（见 src/routes/soundScenes.js）
 * 独立文件原因：soundLibrary.js 已 452 行，接近 500 红线。
 */
(function () {
  'use strict';

  var S = {
    mounted: false,
    root: null,
    filters: { region_id: '', type: '', hasAudio: '', q: '' },
    offset: 0,
    limit: 20,
    total: 0,
    items: [],
    currentId: null,
    current: null,
    regions: [],
    sounds: [],
    types: []
  };

  var TYPE_LABEL = {
    geometry_terrain: '地形', geometry_building: '几何建筑', custom_model: '自定义模型',
    uploaded_model: '上传模型', npc: 'NPC', monster: '怪物', portal: '传送门',
    ad_slot: '广告位', threejs: 'JS 物体'
  };

  function token() { try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; } }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }

  async function api(path, opt) {
    var r = await fetch(path, Object.assign({
      headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' }
    }, opt || {}));
    var body = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
    return body;
  }

  // ─── 样式 ───────────────────────────────────────────────────

  var CSS = [
    '.so-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}',
    '.so-bar select,.so-bar input{background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:4px 7px;font-size:12px}',
    '.so-bar select{min-width:120px}',
    '.so-bar input{width:120px}',
    '.so-stat{font-size:11px;color:var(--muted)}',
    '.so-body{display:flex;gap:14px;align-items:flex-start}',
    '.so-list{flex:1;min-width:0;max-height:520px;overflow-y:auto;border:1px solid var(--border);border-radius:8px}',
    '.so-item{display:flex;align-items:center;gap:8px;padding:6px 9px;font-size:12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04)}',
    '.so-item:hover{background:rgba(255,255,255,0.04)}',
    '.so-item.active{background:rgba(0,255,0,0.09)}',
    '.so-id{width:44px;color:var(--muted);flex-shrink:0;font-size:11px}',
    '.so-ty{width:64px;color:var(--muted);flex-shrink:0;font-size:11px}',
    '.so-nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.so-pg{display:flex;align-items:center;gap:8px;justify-content:center;padding:7px;font-size:11px;color:var(--muted)}',
    '.so-detail{width:330px;flex-shrink:0}',
    '.so-card{border:1px solid var(--border);border-radius:8px;padding:12px}',
    '.so-dt{font-size:13px;font-weight:500;margin-bottom:2px}',
    '.so-dm{font-size:11px;color:var(--muted);margin-bottom:12px}',
    '.so-fld{margin-bottom:10px}',
    '.so-fld label{display:block;font-size:11px;color:var(--muted);margin-bottom:3px}',
    '.so-fld input,.so-fld select{width:100%;background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:5px 7px;font-size:12px}',
    '.so-row2{display:flex;gap:8px}',
    '.so-row2>div{flex:1}',
    '.so-acts{display:flex;gap:8px;margin-top:12px}',
    '.so-hint{font-size:11px;color:var(--orange);margin-top:10px;line-height:1.6}',
    '.so-empty{padding:26px;text-align:center;color:var(--muted);font-size:12px}'
  ].join('\n');

  // ─── 列表 ───────────────────────────────────────────────────

  async function loadList() {
    var q = [];
    if (S.filters.region_id) q.push('region_id=' + encodeURIComponent(S.filters.region_id));
    if (S.filters.type) q.push('type=' + encodeURIComponent(S.filters.type));
    if (S.filters.hasAudio) q.push('hasAudio=' + S.filters.hasAudio);
    if (S.filters.q) q.push('q=' + encodeURIComponent(S.filters.q));
    q.push('limit=' + S.limit, 'offset=' + S.offset);

    var box = $('so-list');
    if (box) box.innerHTML = '<div class="so-empty">加载中…</div>';
    try {
      var d = await api('/api/sound-scenes/objects?' + q.join('&'));
      S.items = d.items || [];
      S.total = d.total || 0;
      renderList();
    } catch (e) {
      if (box) box.innerHTML = '<div class="so-empty" style="color:#ff6b6b">加载失败：' + esc(e.message) + '</div>';
    }
  }

  function renderList() {
    var box = $('so-list');
    if (!box) return;
    if (!S.items.length) { box.innerHTML = '<div class="so-empty">这个条件下没有物件</div>'; return; }

    var html = S.items.map(function (o) {
      var has = o.audio ? '<span style="color:#5DCAA5;font-size:11px">有声</span>' : '<span style="color:var(--muted);font-size:11px">—</span>';
      return '<div class="so-item' + (S.currentId === o.id ? ' active' : '') + '" data-id="' + o.id + '">' +
        '<span class="so-id">#' + o.id + '</span>' +
        '<span class="so-ty">' + esc(TYPE_LABEL[o.type] || o.type || '?') + '</span>' +
        '<span class="so-nm" title="' + esc(o.name) + '">' + esc(o.name || '(未命名)') + '</span>' +
        has +
        '</div>';
    }).join('');

    var from = S.total ? (S.offset + 1) : 0;
    var to = Math.min(S.offset + S.limit, S.total);
    html += '<div class="so-pg">' +
      '<button class="btn btn-secondary btn-sm" id="so-prev"' + (S.offset <= 0 ? ' disabled' : '') + '>上一页</button>' +
      '<span>' + from + '-' + to + ' / ' + S.total + '</span>' +
      '<button class="btn btn-secondary btn-sm" id="so-next"' + (to >= S.total ? ' disabled' : '') + '>下一页</button>' +
      '</div>';

    box.innerHTML = html;

    box.querySelectorAll('.so-item').forEach(function (el) {
      el.addEventListener('click', function () { selectObject(parseInt(el.getAttribute('data-id'), 10)); });
    });
    var p = $('so-prev'), n = $('so-next');
    if (p) p.addEventListener('click', function () { S.offset = Math.max(0, S.offset - S.limit); loadList(); });
    if (n) n.addEventListener('click', function () { S.offset += S.limit; loadList(); });

    var st = $('so-stat');
    if (st) st.textContent = '共 ' + S.total + ' 个物件';
  }

  // ─── 详情 ───────────────────────────────────────────────────

  async function selectObject(id) {
    S.currentId = id;
    renderList();
    var box = $('so-detail');
    if (box) box.innerHTML = '<div class="so-card"><div class="so-empty">读取中…</div></div>';
    try {
      var d = await api('/api/sound-scenes/objects/' + id);
      S.current = d.object || null;
    } catch (e) {
      S.current = null;
    }
    renderDetail();
  }

  function renderDetail() {
    var box = $('so-detail');
    if (!box) return;
    var o = S.current;
    if (!o) {
      box.innerHTML = '<div class="so-card"><div class="so-empty">从左侧选一个物件</div></div>';
      return;
    }

    var a = o.audio || {};
    var optHtml = ['<option value="">— 选择已上传的音频 —</option>']
      .concat(S.sounds.map(function (s) {
        var sel = (a.url && a.url.indexOf(s.name) >= 0) ? ' selected' : '';
        return '<option value="' + esc(s.url) + '"' + sel + '>' + esc(s.name) + '（' + Math.round(s.size / 1024) + 'KB）</option>';
      })).join('');

    box.innerHTML = '<div class="so-card">' +
      '<div class="so-dt">#' + o.id + '　' + esc(o.name || '(未命名)') + '</div>' +
      '<div class="so-dm">' + esc(TYPE_LABEL[o.type] || o.type || '') + '　区域：' + esc(o.region_id || '未归属') + '</div>' +

      '<div class="so-fld"><label>声音来源</label><select id="so-url-sel">' + optHtml + '</select></div>' +
      '<div class="so-fld"><label>或直接填 URL</label><input id="so-url" type="text" placeholder="/uploads/... 或 http://..." value="' + esc(a.url || '') + '"></div>' +

      '<div class="so-row2">' +
        '<div class="so-fld"><label>最大可听距离（米）</label><input id="so-radius" type="number" min="1" max="200" value="' + (a.radius != null ? a.radius : 15) + '"></div>' +
        '<div class="so-fld"><label>最小距离（米）</label><input id="so-minDist" type="number" min="0" max="50" value="' + (a.minDist != null ? a.minDist : 2) + '"></div>' +
      '</div>' +
      '<div class="so-row2">' +
        '<div class="so-fld"><label>基础音量 0~1</label><input id="so-volume" type="number" min="0" max="1" step="0.05" value="' + (a.volume != null ? a.volume : 0.7) + '"></div>' +
        '<div class="so-fld"><label>衰减方式</label><select id="so-falloff">' +
          '<option value="inverse"' + ((a.falloff || 'inverse') === 'inverse' ? ' selected' : '') + '>平方反比（接近真实）</option>' +
          '<option value="linear"' + (a.falloff === 'linear' ? ' selected' : '') + '>线性</option>' +
        '</select></div>' +
      '</div>' +
      '<div class="so-fld"><label><input id="so-loop" type="checkbox"' + (a.loop ? ' checked' : '') + ' style="width:auto;margin-right:6px">循环播放（喷泉、篝火、车流）</label></div>' +

      '<div class="so-acts">' +
        '<button class="btn btn-secondary btn-sm" id="so-preview">试听</button>' +
        '<button class="btn btn-sm" id="so-save">保存</button>' +
        '<button class="btn btn-secondary btn-sm" id="so-clear">清除</button>' +
      '</div>' +
      '<div class="so-hint">这一版只保存配置，游戏里还不会响。真正发声要等 S3 的运行时（距离衰减 / 同时发声上限）。</div>' +
      '</div>';

    var sel = $('so-url-sel');
    if (sel) sel.addEventListener('change', function () { if (sel.value) $('so-url').value = sel.value; });
    $('so-preview').addEventListener('click', preview);
    $('so-save').addEventListener('click', save);
    $('so-clear').addEventListener('click', clear);
  }

  function preview() {
    var url = ($('so-url') && $('so-url').value || '').trim();
    if (!url) { alert('先选或填一个声音'); return; }
    try { new Audio(url).play(); } catch (e) { alert('播放失败：' + e.message); }
  }

  function collect() {
    var url = ($('so-url').value || '').trim() || ($('so-url-sel').value || '');
    if (!url) throw new Error('还没有选声音');
    return {
      url: url,
      radius: Math.max(1, Math.min(200, parseFloat($('so-radius').value) || 15)),
      minDist: Math.max(0, Math.min(50, parseFloat($('so-minDist').value) || 0)),
      volume: Math.max(0, Math.min(1, parseFloat($('so-volume').value) || 0)),
      falloff: $('so-falloff').value || 'inverse',
      loop: !!$('so-loop').checked
    };
  }

  async function save() {
    if (!S.currentId) return;
    var audio;
    try { audio = collect(); } catch (e) { alert(e.message); return; }
    try {
      var d = await api('/api/sound-scenes/objects/' + S.currentId + '/audio', {
        method: 'PUT', body: JSON.stringify({ audio: audio })
      });
      S.current.audio = d.object.audio;
      flash('已保存');
      var it = S.items.filter(function (x) { return x.id === S.currentId; })[0];
      if (it) it.audio = d.object.audio;
      renderList();
    } catch (e) { alert('保存失败：' + e.message); }
  }

  async function clear() {
    if (!S.currentId) return;
    if (!confirm('清除这个物件的声音配置？')) return;
    try {
      await api('/api/sound-scenes/objects/' + S.currentId + '/audio', {
        method: 'PUT', body: JSON.stringify({ audio: null })
      });
      S.current.audio = null;
      flash('已清除');
      var it = S.items.filter(function (x) { return x.id === S.currentId; })[0];
      if (it) it.audio = null;
      renderList();
      renderDetail();
    } catch (e) { alert('清除失败：' + e.message); }
  }

  function flash(msg) {
    var box = $('so-detail');
    if (!box) return;
    var t = document.createElement('div');
    t.textContent = '✅ ' + msg;
    t.style.cssText = 'position:fixed;top:18px;right:18px;background:rgba(0,255,0,0.15);border:1px solid #00ff00;color:#00ff00;padding:7px 12px;border-radius:6px;font-size:12px;z-index:9999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1600);
  }

  // ─── 挂载 ───────────────────────────────────────────────────

  async function mount(container) {
    if (!container) return;
    S.root = container;

    if (!S.mounted) {
      var style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      S.mounted = true;
    }

    container.innerHTML =
      '<div class="so-bar">' +
        '<select id="so-f-region"><option value="">全部区域</option></select>' +
        '<select id="so-f-type"><option value="">全部类型</option></select>' +
        '<select id="so-f-audio">' +
          '<option value="">全部</option>' +
          '<option value="1">已挂声音</option>' +
          '<option value="0">未挂声音</option>' +
        '</select>' +
        '<input id="so-f-q" type="text" placeholder="搜物件名">' +
        '<span class="so-stat" id="so-stat"></span>' +
      '</div>' +
      '<div class="so-body">' +
        '<div class="so-list" id="so-list"></div>' +
        '<div class="so-detail" id="so-detail"><div class="so-card"><div class="so-empty">从左侧选一个物件</div></div></div>' +
      '</div>';

    $('so-f-region').addEventListener('change', function () { S.filters.region_id = this.value; S.offset = 0; loadList(); });
    $('so-f-type').addEventListener('change', function () { S.filters.type = this.value; S.offset = 0; loadList(); });
    $('so-f-audio').addEventListener('change', function () { S.filters.hasAudio = this.value; S.offset = 0; loadList(); });
    var qt;
    $('so-f-q').addEventListener('input', function () {
      var v = this.value.trim();
      clearTimeout(qt);
      qt = setTimeout(function () { S.filters.q = v; S.offset = 0; loadList(); }, 350);
    });

    // 元数据只在首次挂载时拉
    if (!S.regions.length) {
      try {
        var rg = await api('/api/sound-scenes/regions');
        S.regions = rg.regions || [];
        $('so-f-region').innerHTML = '<option value="">全部区域</option>' +
          S.regions.map(function (r) { return '<option value="' + esc(r.region_key || r.id) + '">' + esc(r.name || r.region_key) + '</option>'; }).join('');
      } catch (e) { /* 区域拉不到不影响主列表 */ }
    }
    if (!S.sounds.length) {
      try { var sd = await api('/api/sound-scenes/sounds'); S.sounds = sd.sounds || []; } catch (e) {}
    }

    loadList();
  }

  window.SoundObjects = { mount: mount };
})();
