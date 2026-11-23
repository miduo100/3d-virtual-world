/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * editorObjectSound.js —— 统一编辑器里的「对象声音」属性块
 *
 * 为什么要有这个文件：
 *   原来「音效库 → ② 模型声源」里给物件挂声音，但那一页是 4329 个物件的列表，
 *   名字大多一样、也看不出位置，选哪个全靠猜。正确做法就是用户说的——
 *   在编辑器里点中那个模型，在它的属性面板里配。
 *
 * 怎么接进编辑器（只加 1 行接线，不往 8190 行的 unified_editor.html 里写业务代码）：
 *   updatePropertiesPanel() 末尾加： if (window.EditorObjectSound) window.EditorObjectSound.onSelect(selectedObjects[0]);
 *
 * 数据落点：world_objects.custom_config.audio = { url, radius, minDist, volume, loop, falloff }
 *   —— 和运行时 soundRuntime.js 读的字段完全一致，所以存完进游戏就按距离响。
 * 读写接口复用 /api/sound-scenes/objects/:id/audio（jsonb_set 只改 audio 键，
 *   不会吃掉模型身上的 doors / 材质等其它 custom_config 子配置）。
 */
(function () {
  'use strict';

  var S = { obj: null, sounds: null, audio: null, busy: false, ctx: null, src: null };

  function token() { try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }
  function baseName(u) { return String(u || '').split('/').pop() || ''; }

  var CSS = [
    '.eos{margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}',
    '.eos-tt{font-size:12px;color:var(--text);margin-bottom:3px}',
    '.eos-sub{font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:8px}',
    '.eos-fld{margin-bottom:7px}',
    '.eos-fld label{display:block;font-size:11px;color:var(--muted);margin-bottom:2px}',
    '.eos-fld input,.eos-fld select{width:100%;background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 6px;font-size:11px}',
    '.eos-r2{display:flex;gap:6px}.eos-r2>div{flex:1}',
    '.eos-acts{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}',
    '.eos-btn{background:rgba(0,0,0,0.35);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:11px;padding:3px 9px;cursor:pointer}',
    '.eos-btn:hover{border-color:var(--green);color:#00ff00}',
    '.eos-btn.primary{background:rgba(0,255,0,0.12);border-color:rgba(0,255,0,0.5);color:#00ff00}',
    '.eos-note{font-size:10px;color:var(--muted);line-height:1.6;margin-top:6px}',
    '.eos-warn{font-size:11px;color:var(--orange);line-height:1.6}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('eos-css')) return;
    var st = document.createElement('style');
    st.id = 'eos-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function block() {
    var panel = document.getElementById('properties-panel');
    if (!panel) return null;
    var b = document.getElementById('eos-block');
    if (!b) {
      injectCss();
      b = document.createElement('div');
      b.id = 'eos-block';
      b.className = 'eos';
      panel.appendChild(b);
    }
    return b;
  }

  // ─── 选中对象时刷新 ─────────────────────────────────────────

  function onSelect(obj) {
    S.obj = obj || null;
    S.audio = null;
    var b = block();
    if (!b) return;

    if (!token()) {
      b.innerHTML = '<div class="eos-tt">🔊 声音</div><div class="eos-warn">需要管理员登录才能给模型挂声音。</div>';
      return;
    }
    if (!S.obj || !S.obj.id) {
      b.innerHTML = '<div class="eos-tt">🔊 声音</div>' +
        '<div class="eos-warn">这个模型还没存进数据库，先点上面的「✅ 应用更改」保存，再回来挂声音。</div>';
      return;
    }

    b.innerHTML = '<div class="eos-tt">🔊 声音</div><div class="eos-sub">正在读取…</div>';
    loadAudio(S.obj.id);
  }

  async function loadAudio(id) {
    try {
      var r = await fetch('/api/sound-scenes/objects/' + encodeURIComponent(id), {
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      S.audio = (d.object && d.object.audio) || null;
    } catch (e) {
      S.audio = null;
    }
    if (!S.sounds) {
      try {
        var rs = await fetch('/api/sound-scenes/sounds', { headers: { 'Authorization': 'Bearer ' + token() } });
        var ds = await rs.json();
        S.sounds = (ds && ds.sounds) || [];
      } catch (e) { S.sounds = []; }
    }
    render();
  }

  function render() {
    var b = block();
    if (!b) return;
    var a = S.audio || {};
    var opts = ['<option value="">— 不挂声音 —</option>'].concat((S.sounds || []).map(function (s) {
      var sel = (a.url && a.url.indexOf(s.name) >= 0) ? ' selected' : '';
      return '<option value="' + esc(s.url) + '"' + sel + '>' + esc(s.name) + '</option>';
    })).join('');

    b.innerHTML = '<div class="eos-tt">🔊 声音' +
        (a.url ? '　<span style="font-size:10px;color:#5DCAA5">已挂：' + esc(baseName(a.url)) + '</span>' : '') + '</div>' +
      '<div class="eos-sub">这个模型靠近才会响，走出距离就消失。</div>' +
      '<div class="eos-fld"><label>声音</label><select id="eos-sel">' + opts + '</select></div>' +
      '<div class="eos-fld"><label>或填 URL</label><input id="eos-url" type="text" value="' + esc(a.url || '') + '" placeholder="/uploads/character-templates/sounds/xxx.wav"></div>' +
      '<div class="eos-r2">' +
        '<div class="eos-fld"><label>可听距离（米）</label><input id="eos-radius" type="number" min="1" max="300" value="' + (a.radius != null ? a.radius : 15) + '"></div>' +
        '<div class="eos-fld"><label>音量 0~1</label><input id="eos-vol" type="number" min="0" max="1" step="0.05" value="' + (a.volume != null ? a.volume : 0.7) + '"></div>' +
      '</div>' +
      '<div class="eos-r2">' +
        '<div class="eos-fld"><label>最近距离（米）</label><input id="eos-mind" type="number" min="0" max="100" value="' + (a.minDist != null ? a.minDist : 2) + '"></div>' +
        '<div class="eos-fld"><label>衰减</label><select id="eos-fall">' +
          '<option value="inverse"' + ((a.falloff || 'inverse') === 'inverse' ? ' selected' : '') + '>平方反比</option>' +
          '<option value="linear"' + (a.falloff === 'linear' ? ' selected' : '') + '>线性</option>' +
        '</select></div>' +
      '</div>' +
      '<div class="eos-fld"><label style="display:flex;align-items:center;gap:5px"><input type="checkbox" id="eos-loop"' +
        (a.loop !== false ? ' checked' : '') + ' style="width:auto"> 循环播放（喷泉、篝火）</label></div>' +
      '<div class="eos-acts">' +
        '<button class="eos-btn" id="eos-play">试听</button>' +
        '<button class="eos-btn primary" id="eos-save">保存声音</button>' +
        '<button class="eos-btn" id="eos-clear">清除</button>' +
      '</div>' +
      '<div class="eos-note">存完进世界就按距离响，不用重启。这里只改声音，不会动模型的其它配置。</div>';

    $('eos-sel').addEventListener('change', function () { if (this.value) $('eos-url').value = this.value; });
    $('eos-play').addEventListener('click', preview);
    $('eos-save').addEventListener('click', save);
    $('eos-clear').addEventListener('click', clear);
  }

  // ─── 试听（按当前距离/音量放，不是裸放）─────────────────────

  function preview() {
    if (S.src) { try { S.src.stop(); } catch (e) {} S.src = null; }
    var url = ($('eos-url').value || '').trim() || $('eos-sel').value;
    if (!url) { alert('先选一段声音'); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { try { new Audio(url).play(); } catch (e) {} return; }
    if (!S.ctx) S.ctx = new AC();
    if (S.ctx.state === 'suspended') { try { S.ctx.resume(); } catch (e) {} }
    var ctx = S.ctx;
    fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
      return ctx.decodeAudioData(ab);
    }).then(function (buf) {
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = $('eos-loop').checked;
      var g = ctx.createGain();
      g.gain.value = Math.max(0, Math.min(1, parseFloat($('eos-vol').value) || 0.7));
      src.connect(g); g.connect(ctx.destination);
      src.start();
      S.src = src;
      if (!src.loop) src.onended = function () { S.src = null; };
    }).catch(function (e) { alert('试听失败：' + e.message); });
  }

  // ─── 保存 / 清除 ───────────────────────────────────────────

  function collect() {
    var url = ($('eos-url').value || '').trim() || $('eos-sel').value;
    if (!url) return null;
    return {
      url: url,
      radius: Math.max(1, Math.min(300, parseFloat($('eos-radius').value) || 15)),
      minDist: Math.max(0, Math.min(100, parseFloat($('eos-mind').value) || 2)),
      volume: Math.max(0, Math.min(1, parseFloat($('eos-vol').value) || 0.7)),
      loop: $('eos-loop').checked,
      falloff: $('eos-fall').value === 'linear' ? 'linear' : 'inverse'
    };
  }

  async function put(audio) {
    var r = await fetch('/api/sound-scenes/objects/' + encodeURIComponent(S.obj.id) + '/audio', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: audio })
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  }

  async function save() {
    if (S.busy || !S.obj) return;
    var a = collect();
    if (!a) { alert('先选一段声音'); return; }
    S.busy = true;
    try {
      var d = await put(a);
      S.audio = (d.object && d.object.audio) || a;
      render();
      toast('已保存，进世界就按距离响');
    } catch (e) {
      alert('保存失败：' + e.message);
    } finally { S.busy = false; }
  }

  async function clear() {
    if (S.busy || !S.obj) return;
    if (!confirm('清除这个模型的声音？')) return;
    S.busy = true;
    try {
      await put(null);
      S.audio = null;
      render();
      toast('已清除');
    } catch (e) {
      alert('清除失败：' + e.message);
    } finally { S.busy = false; }
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = '✅ ' + msg;
    t.style.cssText = 'position:fixed;top:18px;right:18px;background:rgba(0,255,0,0.15);border:1px solid #00ff00;color:#00ff00;padding:7px 12px;border-radius:6px;font-size:12px;z-index:99999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  window.EditorObjectSound = { onSelect: onSelect };
})();
