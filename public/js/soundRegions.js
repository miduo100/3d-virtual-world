/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundRegions.js —— 音效库 ③ 环境声景（声音点位版）
 *
 * 模型：一段声音 + 它自己的坐标 + 可听半径 + 音量。
 *   同一个声音可以放多处（同一段鸟叫，林子里放三处），所以列表的主键是「点位」不是声音。
 *
 * 为什么不再按「区域」：world_regions 里那 17 条全是 AI 建楼的占地框（60×60 之类，
 * 名字是「体检楼/验收别墅」），拿它们挂环境声等于给建筑挂声，概念错了。
 *
 * 数据落点：system_config['ambient_pads']（JSONB 数组），零建表。
 *   单条：{ id, name, url, x, y, z, radius, volume, loop, fadeIn, enabled }
 * 读写：GET/PUT /api/sound-scenes/pads（整份列表替换）
 * 进游戏真正响起来由 soundAmbience.js 负责：玩家坐标进半径淡入，出半径淡出。
 */
(function () {
  'use strict';

  var S = { mounted: false, pads: [], sounds: [], curId: null, filter: 'all', keyword: '' };
  function token() { try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id) { return document.getElementById(id); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function baseName(u) { return String(u || '').split('/').pop() || ''; }

  /** 统一成 X:-106.1 Y:0.0 Z:-33.5 这种能直接贴回去的格式 */
  function coordText(p) {
    var f = function (v) { return (parseFloat(v) || 0).toFixed(1); };
    return 'X:' + f(p.x) + ' Y:' + f(p.y) + ' Z:' + f(p.z);
  }

  /**
   * 解析粘贴进来的坐标。支持：
   *   X:-106.1 Y:0.0 Z:-33.5 / x=1 y=2 z=3 / X: 1, Y: 0, Z: -3
   *   -106.1, 0.0, -33.5   （无标签，按 X,Y,Z 顺序取）
   *   -106.1 -33.5         （只有两个数，当 X,Z，Y 记 0）
   *   X:1 Y:2              （两个带标签的，按老习惯把 Y 当 Z）
   */
  function parseCoord(str) {
    var s = String(str || '');
    var labelled = {};
    var hits = 0;
    var re = /([xyzXYZ])\s*[:=：]\s*(-?\d+(?:\.\d+)?)/g;
    var m;
    while ((m = re.exec(s))) {
      labelled[m[1].toLowerCase()] = parseFloat(m[2]);
      hits++;
    }
    if (hits >= 2 && labelled.x != null) {
      if (labelled.z != null) {
        return { x: labelled.x, y: (labelled.y != null ? labelled.y : 0), z: labelled.z };
      }
      if (labelled.y != null) return { x: labelled.x, y: 0, z: labelled.y };
      return null;
    }
    var nums = (s.match(/-?\d+(?:\.\d+)?/g) || []).map(parseFloat).filter(function (n) { return isFinite(n); });
    if (nums.length >= 3) return { x: nums[0], y: nums[1], z: nums[2] };
    if (nums.length === 2) return { x: nums[0], y: 0, z: nums[1] };
    return null;
  }

  function setCoord(g) {
    if ($('sp-x')) $('sp-x').value = g.x;
    if ($('sp-y')) $('sp-y').value = g.y;
    if ($('sp-z')) $('sp-z').value = g.z;
    if ($('sp-paste')) $('sp-paste').value = coordText(g);
  }

  function syncCoordText() {
    if (!$('sp-paste')) return;
    $('sp-paste').value = coordText({
      x: num($('sp-x').value, 0),
      y: num($('sp-y').value, 0),
      z: num($('sp-z').value, 0)
    });
  }

  function copyCoord() {
    var txt = $('sp-paste') ? $('sp-paste').value : '';
    if (!txt) return;
    var done = function () { flash('已复制 ' + txt); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
      } else {
        fallbackCopy(txt, done);
      }
    } catch (e) { fallbackCopy(txt, done); }
  }

  function fallbackCopy(txt, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch (e) { alert('复制失败，手动选中这段：' + txt); }
  }

  async function api(path, opt) {
    var r = await fetch(path, Object.assign({
      headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' }
    }, opt || {}));
    var b = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status));
    return b;
  }

  var CSS = [
    '.sp-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
    '.sp-bar select,.sp-bar input{background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:4px 7px;font-size:12px}',
    '.sp-bar select{min-width:180px}',
    '.sp-stat{font-size:11px;color:var(--muted)}',
    '.sp-body{display:flex;gap:14px;align-items:flex-start}',
    '.sp-list{flex:1;min-width:0;max-height:520px;overflow-y:auto;border:1px solid var(--border);border-radius:8px}',
    '.sp-item{display:flex;align-items:center;gap:8px;padding:7px 9px;font-size:12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04)}',
    '.sp-item:hover{background:rgba(255,255,255,0.04)}',
    '.sp-item.active{background:rgba(0,255,0,0.09)}',
    '.sp-item.off{opacity:0.45}',
    '.sp-l{flex:1;min-width:0}',
    '.sp-nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}',
    '.sp-meta{display:block;font-size:10px;color:var(--muted);margin-top:2px;font-family:Consolas,Monaco,monospace}',
    '.sp-meta i{color:var(--orange);font-style:normal}',
    '.sp-noaudio{color:#ff6b6b;font-size:10px;border:1px solid rgba(255,107,107,0.4);border-radius:3px;padding:0 4px}',
    '.sp-detail{width:330px;flex-shrink:0}',
    '.sp-card{border:1px solid var(--border);border-radius:8px;padding:12px}',
    '.sp-dt{font-size:13px;font-weight:500;margin-bottom:3px}',
    '.sp-dm{font-size:11px;color:var(--muted);margin-bottom:12px}',
    '.sp-fld{margin-bottom:10px}',
    '.sp-fld label{display:block;font-size:11px;color:var(--muted);margin-bottom:3px}',
    '.sp-fld input,.sp-fld select{width:100%;background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:5px 7px;font-size:12px}',
    '.sp-row2{display:flex;gap:8px}',
    '.sp-row2>div{flex:1}',
    '.sp-row3{display:flex;gap:8px}',
    '.sp-row3>div{flex:1;min-width:0}',
    '.sp-paste-row{display:flex;gap:6px;align-items:center}',
    '.sp-paste-row input{flex:1;min-width:0;font-family:Consolas,Monaco,monospace;font-size:11px}',
    '.sp-paste-row .btn{flex-shrink:0;padding:4px 9px}',
    '.sp-bad{border-color:#ff6b6b !important;box-shadow:0 0 0 1px rgba(255,107,107,0.35)}',
    '.sp-chk{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);margin-bottom:8px}',
    '.sp-chk input{width:auto}',
    '.sp-acts{display:flex;gap:8px;margin-top:12px}',
    '.sp-hint{font-size:11px;color:var(--orange);margin-top:10px;line-height:1.6;border-top:1px solid var(--border);padding-top:9px}',
    '.sp-empty{padding:26px;text-align:center;color:var(--muted);font-size:12px}'
  ].join('\n');

  async function load() {
    var box = $('sp-list');
    try {
      var d = await api('/api/sound-scenes/pads');
      S.pads = d.pads || [];
      var sd = await api('/api/sound-scenes/sounds');
      S.sounds = sd.sounds || [];
    } catch (e) {
      if (box) box.innerHTML = '<div class="sp-empty" style="color:#ff6b6b">加载失败：' + esc(e.message) + '</div>';
      return;
    }
    if (!S.pads.some(function (p) { return p.id === S.curId; })) {
      S.curId = S.pads.length ? S.pads[0].id : null;
    }
    renderAll();
  }

  function visiblePads() {
    return S.pads.filter(function (p) {
      if (S.filter === 'on' && p.enabled === false) return false;
      if (S.filter === 'off' && p.enabled !== false) return false;
      if (S.filter === 'nocover' && p.url) return false;
      if (S.keyword) {
        var hay = (p.name || '') + ' ' + baseName(p.url);
        if (hay.toLowerCase().indexOf(S.keyword.toLowerCase()) < 0) return false;
      }
      return true;
    });
  }

  function renderAll() { renderList(); renderDetail(); renderStat(); }

  function renderStat() {
    // 左侧分区徽标原本是写死的 '0'，这里让它跟着实际点位数走
    var badge = document.querySelector('.sl-section[data-sec="scenes"] .sl-sec-count');
    if (badge) badge.textContent = String(S.pads.length);
    var st = $('sp-stat');
    if (!st) return;
    var on = S.pads.filter(function (p) { return p.enabled !== false; }).length;
    var noAudio = S.pads.filter(function (p) { return !p.url; }).length;
    st.textContent = '共 ' + S.pads.length + ' 个点位 · 启用 ' + on +
      (noAudio ? ' · ' + noAudio + ' 个还没选声音' : '');
  }

  function renderList() {
    var box = $('sp-list');
    if (!box) return;
    var list = visiblePads();
    if (!S.pads.length) {
      box.innerHTML = '<div class="sp-empty">还没有声音点位。用上面的「＋ 添加点位」，再从素材库选一段声音。</div>';
      return;
    }
    if (!list.length) { box.innerHTML = '<div class="sp-empty">没有符合条件的点位</div>'; return; }
    box.innerHTML = list.map(function (p) {
      var title = p.name || baseName(p.url) || '(未命名)';
      var meta = '(' + p.x + ', ' + (p.y != null ? p.y : 0) + ', ' + p.z + ')　半径 <i>' + p.radius + 'm</i>　音量 ' + p.volume;
      var badge = p.url ? '' : '<span class="sp-noaudio">未选声音</span>';
      return '<div class="sp-item' + (p.id === S.curId ? ' active' : '') + (p.enabled === false ? ' off' : '') +
        '" data-id="' + esc(p.id) + '">' +
        '<span class="sp-l">' +
          '<span class="sp-nm" title="' + esc(p.url) + '">' + esc(title) + '</span>' +
          '<span class="sp-meta">' + meta + '</span>' +
        '</span>' + badge + '</div>';
    }).join('');
    box.querySelectorAll('.sp-item').forEach(function (el) {
      el.addEventListener('click', function () {
        if (el.getAttribute('data-id') === S.curId) return;
        collectQuiet();                     // 换点位前先存下当前编辑
        S.curId = el.getAttribute('data-id');
        renderAll();
      });
    });
  }

  function cur() {
    for (var i = 0; i < S.pads.length; i++) if (S.pads[i].id === S.curId) return S.pads[i];
    return null;
  }

  function renderDetail() {
    var box = $('sp-detail');
    if (!box) return;
    var p = cur();
    if (!p) {
      box.innerHTML = '<div class="sp-card"><div class="sp-empty">先在左边选一个点位，<br>或者点上面的「＋ 添加点位」</div></div>';
      return;
    }
    var opts = ['<option value="">— 从素材库选 —</option>'].concat(S.sounds.map(function (s) {
      var sel = (p.url && p.url.indexOf(s.name) >= 0) ? ' selected' : '';
      return '<option value="' + esc(s.url) + '"' + sel + '>' + esc(s.name) + '</option>';
    })).join('');

    box.innerHTML = '<div class="sp-card">' +
      '<div class="sp-dt">' + esc(p.name || baseName(p.url) || '新点位') + '</div>' +
      '<div class="sp-dm">' + esc(baseName(p.url) || '还没选声音') + '</div>' +
      '<div class="sp-fld"><label>声音</label><select id="sp-url-sel">' + opts + '</select></div>' +
      '<div class="sp-fld"><label>或用别的 URL</label><input id="sp-url" type="text" value="' + esc(p.url || '') + '" placeholder="/uploads/character-templates/sounds/xxx.wav"></div>' +
      '<div class="sp-fld"><label>坐标（可直接粘贴 X:-106.1 Y:0.0 Z:-33.5，也认 106.1,0,-33.5）</label>' +
        '<div class="sp-paste-row">' +
          '<input id="sp-paste" type="text" value="' + esc(coordText(p)) + '" placeholder="X:-106.1 Y:0.0 Z:-33.5">' +
          '<button class="btn btn-secondary btn-sm" id="sp-copy" title="复制这个点位的坐标">复制</button>' +
        '</div>' +
      '</div>' +
      '<div class="sp-row3">' +
        '<div class="sp-fld"><label>坐标 X（米）</label><input id="sp-x" type="text" inputmode="decimal" value="' + p.x + '"></div>' +
        '<div class="sp-fld"><label>坐标 Y（高）</label><input id="sp-y" type="text" inputmode="decimal" value="' + (p.y != null ? p.y : 0) + '"></div>' +
        '<div class="sp-fld"><label>坐标 Z（米）</label><input id="sp-z" type="text" inputmode="decimal" value="' + p.z + '"></div>' +
      '</div>' +
      '<div class="sp-row2">' +
        '<div class="sp-fld"><label>可听半径（米）</label><input id="sp-r" type="number" min="1" max="2000" step="1" value="' + p.radius + '"></div>' +
        '<div class="sp-fld"><label>音量 0~1</label><input id="sp-vol" type="number" min="0" max="1" step="0.05" value="' + p.volume + '"></div>' +
      '</div>' +
      '<div class="sp-fld"><label>淡入秒数</label><input id="sp-fade" type="number" min="0.2" max="10" step="0.1" value="' + p.fadeIn + '"></div>' +
      '<div class="sp-chk"><input type="checkbox" id="sp-loop"' + (p.loop !== false ? ' checked' : '') + '><label for="sp-loop" style="margin:0">循环播放</label></div>' +
      '<div class="sp-chk"><input type="checkbox" id="sp-enabled"' + (p.enabled !== false ? ' checked' : '') + '><label for="sp-enabled" style="margin:0">启用这个点位</label></div>' +
      '<div class="sp-acts">' +
        '<button class="btn btn-secondary btn-sm" id="sp-preview">试听</button>' +
        '<button class="btn btn-secondary btn-sm" id="sp-del">删除</button>' +
      '</div>' +
      '<div class="sp-hint">改完要点「保存全部」才写库。距离按 X/Y/Z 三维算：一半半径内是满音量，到边缘衰减到 0。<br>' +
        'Y 是高度——放树上就填树冠高度，放地下室填负数。贴地铺的环境声填 0 即可。</div>' +
      '</div>';

    $('sp-url-sel').addEventListener('change', function () { if (this.value) $('sp-url').value = this.value; });

    // 坐标：粘贴整段就自动拆到 X / Z；单独改 X、Z 则同步回坐标框
    $('sp-paste').addEventListener('input', function () {
      var g = parseCoord(this.value);
      if (g) {
        setCoord(g);
        this.classList.remove('sp-bad');
      } else if (this.value.trim()) {
        this.classList.add('sp-bad');
      } else {
        this.classList.remove('sp-bad');
      }
    });
    $('sp-x').addEventListener('input', absorbOne('sp-x'));
    $('sp-y').addEventListener('input', absorbOne('sp-y'));
    $('sp-z').addEventListener('input', absorbOne('sp-z'));
    $('sp-x').addEventListener('input', syncCoordText);
    $('sp-y').addEventListener('input', syncCoordText);
    $('sp-z').addEventListener('input', syncCoordText);
    $('sp-copy').addEventListener('click', copyCoord);

    $('sp-preview').addEventListener('click', preview);
    $('sp-del').addEventListener('click', removeCur);
  }

  /** 有人会把整段坐标直接粘进 X / Y / Z 输入框，这里接住并拆开 */
  function absorbOne(id) {
    return function () {
      var g = parseCoord(this.value);
      if (g && /[xyzXYZ]\s*[:=：]/.test(this.value)) {
        setCoord(g);
        this.classList.remove('sp-bad');
      }
    };
  }

  /** 把右侧表单写回当前点位（只改内存，不落库） */
  function collect() {
    var p = cur();
    if (!p) return null;
    var url = ($('sp-url').value || '').trim() || $('sp-url-sel').value;
    p.url = url;
    p.name = baseName(url);
    p.x = num($('sp-x').value, 0);
    p.y = num($('sp-y').value, 0);
    p.z = num($('sp-z').value, 0);
    p.radius = Math.max(1, Math.min(2000, num($('sp-r').value, 30)));
    p.volume = Math.max(0, Math.min(1, num($('sp-vol').value, 0.5)));
    p.fadeIn = Math.max(0.2, Math.min(10, num($('sp-fade').value, 2)));
    p.loop = $('sp-loop').checked;
    p.enabled = $('sp-enabled').checked;
    return p;
  }

  function preview() {
    var p = collect();
    if (!p || !p.url) { alert('先选一段声音'); return; }
    try {
      var a = new Audio(p.url);
      a.volume = Math.max(0, Math.min(1, p.volume));
      a.play();
      setTimeout(function () { try { a.pause(); } catch (e) {} }, 5000);
    } catch (e) { alert('这段声音放不出来：' + e.message); }
  }

  function removeCur() {
    var p = cur();
    if (!p) return;
    if (!confirm('删除这个声音点位？')) return;
    S.pads = S.pads.filter(function (x) { return x.id !== p.id; });
    S.curId = S.pads.length ? S.pads[0].id : null;
    renderAll();
    flash('已删除（记得点保存全部）');
  }

  function addPad() {
    collectQuiet();
    var seed = S.sounds.length ? S.sounds[0].url : '';
    var p = {
      id: 'pad_' + Date.now(),
      name: baseName(seed), url: seed,
      x: 0, y: 0, z: 0, radius: 30, volume: 0.5,
      loop: true, fadeIn: 2, enabled: true
    };
    S.pads.push(p);
    S.curId = p.id;
    renderAll();
    flash('已添加，填好坐标后点保存全部');
  }

  /** 切走之前把当前表单写回对象，否则改了坐标点下一个就全丢了 */
  function collectQuiet() {
    if ($('sp-x') && cur()) { try { collect(); } catch (e) {} }
  }

  async function saveAll() {
    collectQuiet();   // ★ 关键：先把右侧表单写回对象，再整份提交（漏了这步会保存旧值）
    var missing = S.pads.findIndex(function (p) { return !p.url; });
    if (missing >= 0) {
      S.curId = S.pads[missing].id;
      renderAll();
      alert('第 ' + (missing + 1) + ' 个点位还没选声音，先选一段再保存。');
      return;
    }
    try {
      var d = await api('/api/sound-scenes/pads', {
        method: 'PUT', body: JSON.stringify({ pads: S.pads })
      });
      S.pads = d.pads || S.pads;
      renderAll();
      flash('已保存，进世界 15 秒内生效');
    } catch (e) { alert('保存失败：' + e.message); }
  }

  function flash(msg) {
    var t = document.createElement('div');
    t.textContent = '✅ ' + msg;
    t.style.cssText = 'position:fixed;top:18px;right:18px;background:rgba(0,255,0,0.15);border:1px solid #00ff00;color:#00ff00;padding:7px 12px;border-radius:6px;font-size:12px;z-index:9999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1900);
  }

  async function mount(container) {
    if (!container) return;
    if (!S.mounted) {
      var st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      S.mounted = true;
    }
    container.innerHTML =
      '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.7">' +
        '在<b style="color:var(--text)">坐标</b>上放一段声音：玩家走进半径就淡入响起，走出去淡出。' +
        '同一段声音可以放多处。<br>给单个建筑/物件挂声音请去「② 模型声源」——这一区只按坐标铺环境声。' +
      '</div>' +
      '<div class="sp-bar">' +
        '<button class="btn btn-sm" id="sp-add">＋ 添加点位</button>' +
        '<select id="sp-filter">' +
          '<option value="all">全部点位</option>' +
          '<option value="on">只看启用的</option>' +
          '<option value="off">只看停用的</option>' +
          '<option value="nocover">只看还没选声音的</option>' +
        '</select>' +
        '<input id="sp-q" type="text" placeholder="搜声音名" style="width:130px">' +
        '<span class="sp-stat" id="sp-stat"></span>' +
        '<span style="flex:1"></span>' +
        '<button class="btn btn-secondary btn-sm" id="sp-refresh">刷新</button>' +
        '<button class="btn btn-sm" id="sp-save">保存全部</button>' +
      '</div>' +
      '<div class="sp-body">' +
        '<div class="sp-list" id="sp-list"><div class="sp-empty">加载中…</div></div>' +
        '<div class="sp-detail" id="sp-detail"></div>' +
      '</div>';

    $('sp-add').addEventListener('click', addPad);
    $('sp-save').addEventListener('click', saveAll);
    $('sp-refresh').addEventListener('click', load);
    $('sp-filter').addEventListener('change', function () { S.filter = this.value; renderList(); });
    var qt;
    $('sp-q').addEventListener('input', function () {
      var v = this.value.trim();
      clearTimeout(qt);
      qt = setTimeout(function () { S.keyword = v; renderList(); }, 250);
    });
    load();
  }

  window.SoundRegions = { mount: mount };
})();
