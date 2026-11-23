/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundMusic.js —— 场景背景音（现在挂在「世界与场景 → 天气控制」里，和天气声音同一处）
 *
 * 干什么：设一段进世界就播的声音。P0 只有一条全局的，够用就好——
 *   循环播放（BGM）或进场景播一次（提示/开场音），音量与淡入可调。
 *   另外支持**直接上传音频文件**，不用先绕到「声音资产」那页处理完再回来选。
 *
 * 数据落点：system_config['ambient_music'] = { enabled, url, mode, volume, fadeIn }
 *   零建表。玩家端读 GET /api/sound-scenes/music（公开只读）。
 * 运行时：public/js/soundMusicRuntime.js（进世界后按配置播放）。
 *
 * 对外：window.SoundMusic.mountInto(container) / .save() / .setSummary()
 */
(function () {
  'use strict';

  var S = { mounted: false, loaded: false, cfg: null, sounds: [], playing: null, ctx: null };

  function token() { try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }
  function baseName(u) { return String(u || '').split('/').pop() || ''; }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }

  async function api(path, opt) {
    var r = await fetch(path, Object.assign({
      headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' }
    }, opt || {}));
    var b = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status));
    return b;
  }

  var CSS = [
    '.sm-card{border:1px solid var(--border);border-radius:8px;padding:13px;margin-top:14px}',
    '.sm-hd{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}',
    '.sm-tt{font-size:13px;color:var(--text)}',
    '.sm-on{margin-left:auto;font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px;cursor:pointer}',
    '.sm-fld{margin-bottom:9px}',
    '.sm-fld label{display:block;font-size:11px;color:var(--muted);margin-bottom:3px}',
    '.sm-fld input,.sm-fld select{width:100%;background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:5px 7px;font-size:12px}',
    '.sm-r2{display:flex;gap:8px}.sm-r2>div{flex:1}',
    '.sm-acts{display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap}',
    '.sm-note{font-size:11px;color:var(--muted);line-height:1.7;margin-top:10px;border-top:1px solid var(--border);padding-top:9px}',
    '.sm-warn{font-size:11px;color:var(--orange);line-height:1.7;margin-top:8px}'
  ].join('\n');

  function render() {
    var box = $('sm-host');
    if (!box) return;
    var c = S.cfg;
    var opts = ['<option value="">— 不播背景音 —</option>'].concat(S.sounds.map(function (s) {
      var sel = (c.url && c.url.indexOf(s.name) >= 0) ? ' selected' : '';
      return '<option value="' + esc(s.url) + '"' + sel + '>' + esc(s.name) + '</option>';
    })).join('');

    box.innerHTML = '<div class="sm-card">' +
      '<div class="sm-hd"><span class="sm-tt">🎵 场景背景音</span>' +
        '<label class="sm-on"><input type="checkbox" id="sm-enabled"' + (c.enabled ? ' checked' : '') + '> 启用</label>' +
      '</div>' +
      '<div class="sm-fld"><label>声音</label><select id="sm-url">' + opts + '</select></div>' +
      '<div class="sm-fld"><label>或填 URL</label><input id="sm-url2" type="text" value="' + esc(c.url || '') + '" placeholder="/uploads/character-templates/sounds/xxx.wav"></div>' +
      '<div class="sm-r2">' +
        '<div class="sm-fld"><label>播放方式</label><select id="sm-mode">' +
          '<option value="loop"' + (c.mode !== 'once' ? ' selected' : '') + '>循环播放（BGM）</option>' +
          '<option value="once"' + (c.mode === 'once' ? ' selected' : '') + '>进场景播一次（开场音）</option>' +
        '</select></div>' +
        '<div class="sm-fld"><label>音量 0~1</label><input id="sm-vol" type="number" min="0" max="1" step="0.05" value="' + c.volume + '"></div>' +
        '<div class="sm-fld"><label>淡入秒数</label><input id="sm-fade" type="number" min="0" max="10" step="0.5" value="' + c.fadeIn + '"></div>' +
      '</div>' +
      '<div class="sm-acts">' +
        '<button class="btn btn-secondary btn-sm" id="sm-upload">⬆ 上传音频文件</button>' +
        '<input type="file" id="sm-file" accept=".mp3,.ogg,.wav,.aac,.m4a" style="display:none">' +
        '<button class="btn btn-secondary btn-sm" id="sm-play">试听</button>' +
        '<button class="btn btn-sm" id="sm-save">保存背景音</button>' +
        '<span style="font-size:11px;color:var(--muted)" id="sm-hint"></span>' +
      '</div>' +
      '<div class="sm-note">进世界后自动播放，玩家不需要点任何东西（浏览器要求先有一次点击才能出声，' +
        '所以第一次点进世界的那个操作就算）。<br>' +
        '「播一次」适合开场白、公告；「循环」适合氛围 BGM。上传的文件直接进素材库，' +
        '也能在「③ 声音资产」里裁切处理。</div>' +
      '</div>';

    $('sm-url').addEventListener('change', function () { if (this.value) $('sm-url2').value = this.value; });
    $('sm-play').addEventListener('click', preview);
    $('sm-save').addEventListener('click', save);
    $('sm-upload').addEventListener('click', function () { $('sm-file').click(); });
    $('sm-file').addEventListener('change', onPickFile);
    updateHint();
  }

  function collect() {
    var url = ($('sm-url2').value || '').trim() || $('sm-url').value;
    return {
      enabled: $('sm-enabled').checked,
      url: url,
      mode: $('sm-mode').value === 'once' ? 'once' : 'loop',
      volume: Math.max(0, Math.min(1, num($('sm-vol').value, 0.5))),
      fadeIn: Math.max(0, Math.min(10, num($('sm-fade').value, 2)))
    };
  }

  function updateHint() {
    var el = $('sm-hint');
    if (!el) return;
    var url = ($('sm-url2').value || '').trim() || $('sm-url').value;
    el.textContent = url ? baseName(url) : '还没选声音';
  }

  /** 上传音频文件：走现有的声音上传接口，落盘后直接设为当前使用 */
  async function onPickFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var hint = $('sm-hint');
    if (hint) hint.textContent = '上传中…';
    try {
      var fd = new FormData();
      fd.append('sound_file', f);
      var r = await fetch('/api/character-templates/upload-sound', { method: 'POST', body: fd });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));

      // 新文件也要出现在下拉里
      if (!S.sounds.some(function (s) { return s.url === d.url; })) {
        S.sounds.push({ name: d.filename, url: d.url });
      }
      S.cfg = S.cfg || { enabled: false, url: '', mode: 'loop', volume: 0.5, fadeIn: 2 };
      S.cfg.url = d.url;
      S.cfg.enabled = true;
      render();
      var h = $('sm-hint');
      if (h) h.textContent = '已上传并选中：' + d.filename + '（' + (d.size / 1024).toFixed(0) + ' KB），点「保存背景音」生效';
    } catch (err) {
      if (hint) hint.textContent = '';
      alert('上传失败：' + err.message);
    } finally {
      e.target.value = '';
    }
  }

  function preview() {
    stopAll();
    var c = collect();
    if (!c.url) { alert('先选一段声音'); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { try { new Audio(c.url).play(); } catch (e) {} return; }
    if (!S.ctx) S.ctx = new AC();
    if (S.ctx.state === 'suspended') { try { S.ctx.resume(); } catch (e) {} }
    var ctx = S.ctx;
    fetch(c.url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
      return ctx.decodeAudioData(ab);
    }).then(function (buf) {
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = (c.mode === 'loop');
      var g = ctx.createGain();
      var now = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(Math.max(0.0001, c.volume), now + Math.max(0.05, c.fadeIn));
      src.connect(g); g.connect(ctx.destination);
      src.start();
      S.playing = src;
      if (!src.loop) src.onended = function () { S.playing = null; };
    }).catch(function (e) { alert('试听失败：' + e.message); });
  }

  function stopAll() {
    if (S.playing) { try { S.playing.stop(); } catch (e) {} }
    S.playing = null;
  }

  async function save() {
    var c = collect();
    if (c.enabled && !c.url) { alert('启用了但没有选声音'); return; }
    try {
      var d = await api('/api/sound-scenes/music', { method: 'PUT', body: JSON.stringify({ music: c }) });
      S.cfg = d.music || c;
      render();
      setSummary();
      if (window.SoundWeatherPanel) window.SoundWeatherPanel.closeModal('music');   // 存完就收
      toast('背景音已保存，进世界就生效');
    } catch (e) { alert('保存失败：' + e.message); }
  }

  /** 摘要行：「🎵 场景背景音　env-city.wav（循环）」 */
  function setSummary() {
    if (!window.SoundWeatherPanel || !S.cfg) return;
    var c = S.cfg;
    if (!c.url) { window.SoundWeatherPanel.setMusicSummary('<b>未设置</b>'); return; }
    var txt = '<i>' + esc(baseName(c.url)) + '</i>（' + (c.mode === 'once' ? '播一次' : '循环') + '）';
    if (!c.enabled) txt = '<b>（已停用）</b>' + esc(baseName(c.url));
    window.SoundWeatherPanel.setMusicSummary(txt);
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = '✅ ' + msg;
    t.style.cssText = 'position:fixed;top:18px;right:18px;background:rgba(0,255,0,0.15);border:1px solid #00ff00;color:#00ff00;padding:7px 12px;border-radius:6px;font-size:12px;z-index:9999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  /** 挂到指定容器（现在是天气控制页的弹窗里） */
  function mountInto(container) {
    if (!container) return;
    if (!S.mounted) {
      var st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      S.mounted = true;
    }
    container.setAttribute('data-mounted', '1');
    container.innerHTML = '<div style="padding:16px;color:var(--muted)">加载中…</div>';
    if (S.loaded) { render(); return; }
    init().then(function () { if (S.loaded) render(); });
  }

  /** 只拉配置、更新摘要行，不渲染界面（页面加载时先跑一次，摘要才有内容） */
  async function init() {
    try {
      var d = await api('/api/sound-scenes/music');
      S.cfg = d.music || { enabled: false, url: '', mode: 'loop', volume: 0.5, fadeIn: 2 };
      var sd = await api('/api/sound-scenes/sounds');
      S.sounds = sd.sounds || [];
      S.loaded = true;
      setSummary();
    } catch (e) { /* 摘要留空，不影响天气声音 */ }
  }

  window.SoundMusic = { mountInto: mountInto, init: init, save: save, stop: stopAll, setSummary: setSummary };
})();
