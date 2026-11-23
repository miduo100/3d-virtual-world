/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * worldEditorObjectSound.js —— 世界编辑器（world_editor.html）右侧属性面板的「🔊 声音」页签
 *
 * 为什么单独成文件：
 *   world_editor.html 已 9000+ 行，按项目规范业务代码不再往里塞，只做三行接线。
 *
 * 用户诉求（原话）：
 *   "点开场景里的模型，右下角属性面板里给它加一个声音。可以上传一个声音，
 *    或者从音频库里选一个，或者填一个 MP3 的 URL，也能试听。"
 *
 * 数据落点：world_objects.custom_config.audio = { url, radius, minDist, volume, loop, falloff }
 *   和运行时 js/soundRuntime.js 读的字段完全一致 —— 存完进世界就按距离响，不用重启。
 *   读写走 /api/sound-scenes/objects/:id/audio（jsonb_set 只改 audio 键），
 *   不会吃掉模型身上 doors / 材质等其它 custom_config 子配置。
 *
 * ★ 必须同步内存（踩过的坑，别删）：
 *   属性面板的「保存更改」走 /api/world/objects/:id，custom_config 是**整块覆盖**。
 *   如果只写库不同步 obj.data.custom_config，用户随手点一次「保存更改」就会把刚挂的
 *   声音抹掉（反之 custom_config 为空时会写 null，同样抹掉）。所以保存/清除成功后
 *   必须回写内存，custom_config_preview（高级参数改过但未保存）也要一起带上。
 *
 * 接线（world_editor.html）：
 *   1. <script src="js/worldEditorObjectSound.js?v=1"></script>
 *   2. 页签按钮 id=right-tab-sound，内容容器 id=right-props-tab-sound
 *   3. switchRightPropsTab() 里隐藏该容器
 *   4. updateRightPropsPanel(obj) 末尾：window.WorldEditorObjSound.render(obj)
 */
(function () {
  'use strict';

  var API_LIB = '/api/sound-scenes/sounds';
  var API_OBJ = '/api/sound-scenes/objects/';
  var API_UPLOAD = '/api/character-templates/upload-sound';
  var SOUND_DIR = '/uploads/character-templates/sounds/';
  var MAX_UPLOAD_MB = 20;

  var S = {
    obj: null,
    curId: null,      // 当前已渲染的对象 id，用来判断要不要重建 DOM
    audio: null,      // 当前对象已挂的声音（内存态）
    sounds: null,     // 音频库缓存
    libLoading: false,
    saving: false,
    uploading: false,
    previewEl: null,
    ctx: null
  };

  // ─── 小工具 ────────────────────────────────────────────────

  function token() {
    try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; }
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fileName(u) { return String(u || '').split('/').pop().split('?')[0] || ''; }
  function fmtSize(b) {
    b = Number(b) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function tip(msg, type) {
    if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info');
    else console.log('[ObjectSound]', msg);
  }
  function isSavedId(id) { return /^\d+$/.test(String(id || '')); }

  // 只认真正的音频地址，避免把网页链接当音频
  function isAudioUrl(u) {
    var s = String(u || '').trim();
    if (!s) return false;
    if (/^data:audio\//i.test(s)) return true;
    if (!/^(https?:)?\/\//i.test(s) && s.charAt(0) !== '/') return false;
    return /\.(mp3|ogg|wav|m4a|aac|flac|opus)(\?.*)?$/i.test(s) || /\/uploads\//.test(s);
  }

  // ─── 样式（只注入一次，深色面板口径与 .right-prop-* 一致）────

  var CSS = [
    '#right-props-tab-sound{padding-bottom:4px}',
    '.weos-sub{font-size:11px;line-height:1.6;color:rgba(255,255,255,0.5);margin-bottom:10px}',
    '.weos-fld{margin-bottom:10px}',
    '.weos-lab{font-size:11px;font-weight:600;color:rgba(255,255,255,0.6);margin-bottom:5px;display:flex;align-items:center;justify-content:space-between;gap:6px}',
    '.weos-lab .weos-on{font-weight:400;color:#5DCAA5;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.weos-in{width:100%;padding:7px 9px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:rgba(255,255,255,0.08);color:#fff;font-size:12px;outline:none}',
    '.weos-in:focus{border-color:#667eea;background:rgba(255,255,255,0.12)}',
    '.weos-in::placeholder{color:rgba(255,255,255,0.35)}',
    'select.weos-in{cursor:pointer}',
    'select.weos-in option{background:#2b2b3f;color:#fff}',
    '.weos-row{display:flex;gap:6px}',
    '.weos-row>*{flex:1;min-width:0}',
    '.weos-badge{font-size:10px;margin-top:4px;line-height:1.5;min-height:13px}',
    '.weos-badge.ok{color:#5DCAA5}',
    '.weos-badge.warn{color:#EF9F27}',
    '.weos-badge.err{color:#f87171}',
    '.weos-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
    '.weos-btn{flex:1;min-width:62px;padding:6px 8px;border:1px solid rgba(255,255,255,0.18);border-radius:6px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.85);font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}',
    '.weos-btn:hover:not(:disabled){background:rgba(255,255,255,0.16);color:#fff}',
    '.weos-btn:disabled{opacity:0.5;cursor:default}',
    '.weos-btn.primary{background:linear-gradient(135deg,#11998e,#38ef7d);border:none;color:#08251f}',
    '.weos-btn.danger:hover:not(:disabled){background:rgba(248,113,113,0.18);border-color:rgba(248,113,113,0.6);color:#fca5a5}',
    '.weos-adv{margin-top:2px}',
    '.weos-adv>summary{font-size:11px;color:rgba(255,255,255,0.5);cursor:pointer;list-style:none;padding:4px 0}',
    '.weos-adv>summary::-webkit-details-marker{display:none}',
    '.weos-adv>summary:before{content:"▸ ";color:rgba(255,255,255,0.4)}',
    '.weos-adv[open]>summary:before{content:"▾ "}',
    '.weos-adv-body{padding-top:6px}',
    '.weos-switch{display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-top:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.08)}',
    '.weos-switch span{font-size:12px;color:rgba(255,255,255,0.8)}',
    '.weos-sw{position:relative;width:38px;height:21px;flex:0 0 auto}',
    '.weos-sw input{opacity:0;width:0;height:0;position:absolute}',
    '.weos-sw i{position:absolute;inset:0;background:rgba(255,255,255,0.2);border-radius:21px;transition:.2s;cursor:pointer}',
    '.weos-sw i:before{content:"";position:absolute;width:15px;height:15px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}',
    '.weos-sw input:checked+i{background:#38ef7d}',
    '.weos-sw input:checked+i:before{transform:translateX(17px)}',
    '.weos-note{font-size:10px;line-height:1.6;color:rgba(255,255,255,0.35);margin-top:9px}',
    '.weos-empty{padding:24px 8px;text-align:center;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.5)}',
    '.weos-empty b{color:#EF9F27;font-weight:600}'
  ].join('\n');

  function injectCss() {
    if ($('weos-css')) return;
    var st = document.createElement('style');
    st.id = 'weos-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ─── 入口：选中对象时由 updateRightPropsPanel 调 ────────────

  function render(obj) {
    var box = $('right-props-tab-sound');
    if (!box) return;

    if (!obj) {
      stopPreview();
      S.obj = null; S.curId = null; S.audio = null;
      box.innerHTML = '<div class="weos-empty">先选中一个对象</div>';
      return;
    }

    injectCss();

    // 同一对象重复刷新：不重建 DOM，否则用户正在填的 URL 会被清掉
    if (S.curId === obj.id && $('weos-url')) {
      S.obj = obj;
      return;
    }

    stopPreview();
    S.obj = obj;
    S.curId = obj.id;
    S.audio = readAudioFromObj(obj);

    build(box);

    if (!isSavedId(obj.id)) {
      box.innerHTML = '<div class="weos-empty">这个对象还没存进数据库，<br><b>先点上方「保存更改」</b>，<br>再回来挂声音。</div>';
      return;
    }
    if (!token()) {
      box.innerHTML = '<div class="weos-empty">需要管理员登录<br>才能给模型挂声音</div>';
      return;
    }

    fillForm(S.audio);
    loadLibrary(false);
  }

  /** 从内存对象读已有的音频配置（world_objects.custom_config.audio） */
  function readAudioFromObj(obj) {
    var cc = obj && obj.data ? obj.data.custom_config : null;
    if (typeof cc === 'string') {
      try { cc = JSON.parse(cc); } catch (e) { cc = null; }
    }
    var a = cc && typeof cc === 'object' ? cc.audio : null;
    if (typeof a === 'string') {
      try { a = JSON.parse(a); } catch (e) { a = null; }
    }
    return (a && typeof a === 'object') ? a : null;
  }

  /**
   * 保存/清除后把 audio 同步回内存，避免「保存更改」整块覆盖 custom_config 时丢声音。
   * preview 存在说明高级参数改过还没保存，也要一起带上，否则同样会丢。
   */
  function syncMemory(obj, audio) {
    if (!obj) return;
    if (!obj.data) obj.data = {};

    function merge(target) {
      var cc = target;
      if (typeof cc === 'string') {
        try { cc = JSON.parse(cc); } catch (e) { cc = {}; }
      }
      if (!cc || typeof cc !== 'object') cc = {};
      if (audio) cc.audio = audio;
      else delete cc.audio;
      return Object.keys(cc).length ? cc : null;
    }

    obj.data.custom_config = merge(obj.data.custom_config);
    if (obj.data.custom_config_preview && typeof obj.data.custom_config_preview === 'object') {
      var pv = merge(obj.data.custom_config_preview);
      obj.data.custom_config_preview = pv || {};
    }
    // 音频走独立接口已经落库，这里让「保存更改」不再出现"配置未保存"的错觉
    S.audio = audio || null;
  }

  // ─── DOM ─────────────────────────────────────────────────

  function build(box) {
    var libOpts = '<option value="">— 载入中… —</option>';
    box.innerHTML =
      '<div class="weos-sub">给这个模型挂一段声音：玩家走近才响，走远自动消失。</div>' +

      '<div class="weos-fld">' +
        '<div class="weos-lab"><span>🎵 从音频库选</span></div>' +
        '<select class="weos-in" id="weos-lib">' + libOpts + '</select>' +
        '<div class="weos-acts">' +
          '<button class="weos-btn" id="weos-refresh" type="button">🔄 刷新库</button>' +
          '<button class="weos-btn" id="weos-upload" type="button">📁 上传新音频</button>' +
        '</div>' +
        '<input type="file" id="weos-file" accept="audio/*,.mp3,.ogg,.wav,.m4a,.aac" style="display:none">' +
      '</div>' +

      '<div class="weos-fld">' +
        '<div class="weos-lab"><span>🔗 或填音频地址</span><span class="weos-on" id="weos-on"></span></div>' +
        '<input class="weos-in" id="weos-url" type="text" placeholder="https://…/xxx.mp3 或 /uploads/…">' +
        '<div class="weos-badge" id="weos-badge"></div>' +
      '</div>' +

      '<div class="weos-fld">' +
        '<div class="weos-lab"><span>播放参数</span><span class="weos-on" style="color:rgba(255,255,255,0.4)">可听距离 m ｜ 音量 0~1</span></div>' +
        '<div class="weos-row">' +
          '<input class="weos-in" id="weos-radius" type="number" min="1" max="300" step="1" placeholder="可听距离 m">' +
          '<input class="weos-in" id="weos-vol" type="number" min="0" max="1" step="0.05" placeholder="音量 0~1">' +
        '</div>' +
      '</div>' +

      '<div class="weos-switch">' +
        '<span>🔁 循环播放</span>' +
        '<label class="weos-sw"><input type="checkbox" id="weos-loop" checked><i></i></label>' +
      '</div>' +

      '<details class="weos-adv">' +
        '<summary>高级（衰减方式 / 最近距离）</summary>' +
        '<div class="weos-adv-body">' +
          '<div class="weos-row">' +
            '<input class="weos-in" id="weos-mind" type="number" min="0" max="100" step="0.5" placeholder="最近距离 m">' +
            '<select class="weos-in" id="weos-fall">' +
              '<option value="inverse">平方反比衰减</option>' +
              '<option value="linear">线性衰减</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
      '</details>' +

      '<div class="weos-acts" style="margin-top:12px">' +
        '<button class="weos-btn primary" id="weos-save" type="button">💾 保存声音</button>' +
        '<button class="weos-btn" id="weos-play" type="button">▶ 试听</button>' +
        '<button class="weos-btn danger" id="weos-clear" type="button">🗑 清除</button>' +
      '</div>' +
      '<div class="weos-note">只改声音，不动模型其它配置；存完进世界按距离响。</div>';

    $('weos-lib').addEventListener('change', function () {
      if (this.value) { $('weos-url').value = this.value; updateBadge(); }
    });
    $('weos-url').addEventListener('input', updateBadge);
    $('weos-refresh').addEventListener('click', function () { loadLibrary(true); });
    $('weos-upload').addEventListener('click', function () { $('weos-file').click(); });
    $('weos-file').addEventListener('change', onPickFile);
    $('weos-play').addEventListener('click', preview);
    $('weos-save').addEventListener('click', save);
    $('weos-clear').addEventListener('click', clear);
  }

  /** 回填已有配置 */
  function fillForm(a) {
    if (!$('weos-url')) return;
    var url = (a && a.url) || '';
    $('weos-url').value = url;
    $('weos-radius').value = (a && a.radius != null) ? a.radius : 15;
    $('weos-vol').value = (a && a.volume != null) ? a.volume : 0.7;
    $('weos-mind').value = (a && a.minDist != null) ? a.minDist : 2;
    $('weos-loop').checked = !a || a.loop !== false;   // 默认循环：喷泉/篝火这类居多
    $('weos-fall').value = (a && a.falloff === 'linear') ? 'linear' : 'inverse';
    $('weos-on').textContent = url ? '已挂：' + fileName(url) : '';
    if (url) $('weos-on').style.color = '#5DCAA5';
    updateBadge();
  }

  function updateBadge() {
    var b = $('weos-badge');
    var u = ($('weos-url').value || '').trim();
    if (!b) return;
    if (!u) { b.textContent = ''; b.className = 'weos-badge'; return; }
    if (isAudioUrl(u)) {
      // 站内文件没有跨域问题；外链一定要注意：试听走 <audio> 不受 CORS 限制，
      // 但游戏运行时 soundRuntime 是 fetch + decodeAudioData，没开 CORS 就听不到。
      if (/^(https?:)?\/\//i.test(u) && u.indexOf(location.origin) !== 0) {
        b.textContent = '⚠️ 外链音频：试听能响，进世界需对方服务器允许跨域（CORS），稳妥做法是上传到音频库';
        b.className = 'weos-badge warn';
      } else {
        b.textContent = '✅ 音频地址';
        b.className = 'weos-badge ok';
      }
      return;
    }
    if (/^(https?:)?\/\//i.test(u)) { b.textContent = 'ℹ️ 将按音频尝试加载'; b.className = 'weos-badge warn'; }
    else { b.textContent = '⚠️ 需要 http(s) 链接或站内 /uploads/ 路径'; b.className = 'weos-badge err'; }
  }

  // ─── 音频库 ───────────────────────────────────────────────

  async function loadLibrary(force) {
    if (S.libLoading) return;
    if (S.sounds && !force) { renderLibrary(); return; }
    S.libLoading = true;
    var btn = $('weos-refresh');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 读取中'; }
    try {
      var r = await fetch(API_LIB, { headers: { 'Authorization': 'Bearer ' + token() } });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      S.sounds = Array.isArray(d.sounds) ? d.sounds : [];
    } catch (e) {
      S.sounds = S.sounds || [];
      tip('读取音频库失败：' + e.message, 'error');
    } finally {
      S.libLoading = false;
      if (btn) { btn.disabled = false; btn.textContent = '🔄 刷新库'; }
      renderLibrary();
    }
  }

  function renderLibrary() {
    var sel = $('weos-lib');
    if (!sel) return;
    var cur = ($('weos-url').value || '').trim();
    var list = S.sounds || [];
    var html = '<option value="">— 不挂声音 —</option>';
    if (!list.length) {
      html += '<option value="" disabled>（库里还没有音频，点下面的上传）</option>';
    } else {
      list.forEach(function (s) {
        var sel2 = (cur && (cur === s.url || cur.indexOf(s.name) >= 0)) ? ' selected' : '';
        html += '<option value="' + esc(s.url) + '"' + sel2 + '>' +
          esc(s.name) + '　' + fmtSize(s.size) + '</option>';
      });
    }
    sel.innerHTML = html;
  }

  // ─── 上传 ─────────────────────────────────────────────────

  async function onPickFile(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';           // 允许重复选同一个文件
    if (!f) return;
    if (f.size > MAX_UPLOAD_MB * 1024 * 1024) {
      tip('音频超过 ' + MAX_UPLOAD_MB + 'MB，请先压缩', 'error');
      return;
    }
    if (!/\.(mp3|ogg|wav|m4a|aac)$/i.test(f.name)) {
      tip('只支持 mp3 / ogg / wav / m4a / aac', 'error');
      return;
    }
    if (S.uploading) return;
    S.uploading = true;

    var btn = $('weos-upload');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 上传中…'; }
    try {
      var fd = new FormData();
      fd.append('sound_file', f);
      // 注意：不设 Content-Type，FormData 自己带 multipart boundary
      var r = await fetch(API_UPLOAD, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token() },
        body: fd
      });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));

      var url = d.url || (SOUND_DIR + d.filename);
      $('weos-url').value = url;
      updateBadge();
      await loadLibrary(true);
      var sel = $('weos-lib');
      if (sel) sel.value = url;
      var extra = d.compressed ? '（已压到 ' + fmtSize(d.size) + '）' : '（' + fmtSize(d.size) + '）';
      tip('已上传：' + (d.filename || f.name) + extra, 'success');
    } catch (err) {
      tip('上传失败：' + err.message, 'error');
    } finally {
      S.uploading = false;
      if (btn) { btn.disabled = false; btn.textContent = '📁 上传新音频'; }
    }
  }

  // ─── 试听 ─────────────────────────────────────────────────

  function stopPreview() {
    if (S.previewEl) {
      try { S.previewEl.pause(); } catch (e) {}
      S.previewEl = null;
    }
    var b = $('weos-play');
    if (b && b.dataset.playing === '1') { b.dataset.playing = '0'; b.textContent = '▶ 试听'; }
  }

  function preview() {
    var btn = $('weos-play');
    // 正在放 → 再点一下停
    if (btn && btn.dataset.playing === '1') { stopPreview(); return; }

    var url = currentUrl();
    if (!url) { tip('先选一段声音，或填一个音频地址', 'warning'); return; }

    stopPreview();
    var a = new Audio();
    a.preload = 'auto';
    a.src = url;
    a.loop = $('weos-loop').checked;
    a.volume = clamp01(parseFloat($('weos-vol').value), 0.7);

    a.onerror = function () {
      stopPreview();
      tip('无法播放：链接不是可直接播放的音频（或被跨域拦截了）', 'error');
    };
    a.onended = function () { if (S.previewEl === a) stopPreview(); };

    var p = a.play();
    if (p && p.catch) {
      p.catch(function (err) {
        stopPreview();
        tip('播放被拒绝：' + (err && err.message ? err.message : '浏览器策略'), 'error');
      });
    }
    S.previewEl = a;
    if (btn) { btn.dataset.playing = '1'; btn.textContent = '⏹ 停止'; }
  }

  function clamp01(v, dft) {
    v = parseFloat(v);
    if (!isFinite(v)) return dft;
    return Math.max(0, Math.min(1, v));
  }

  function currentUrl() {
    var u = ($('weos-url').value || '').trim();
    if (u) return u;
    var sel = $('weos-lib');
    return sel ? (sel.value || '').trim() : '';
  }

  // ─── 保存 / 清除 ──────────────────────────────────────────

  function collect() {
    var url = currentUrl();
    if (!url) return null;
    var radius = parseFloat($('weos-radius').value);
    var vol = parseFloat($('weos-vol').value);
    var mind = parseFloat($('weos-mind').value);
    return {
      url: url,
      radius: Math.max(1, Math.min(300, isFinite(radius) ? radius : 15)),
      minDist: Math.max(0, Math.min(100, isFinite(mind) ? mind : 2)),
      volume: Math.max(0, Math.min(1, isFinite(vol) ? vol : 0.7)),
      loop: !!$('weos-loop').checked,
      falloff: $('weos-fall').value === 'linear' ? 'linear' : 'inverse'
    };
  }

  async function put(audio) {
    var obj = S.obj;
    var r = await fetch(API_OBJ + encodeURIComponent(obj.id) + '/audio', {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ audio: audio })
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  }

  async function save() {
    if (S.saving || !S.obj) return;
    if (!isSavedId(S.obj.id)) { tip('对象还没保存到数据库，先点「保存更改」', 'warning'); return; }

    var a = collect();
    if (!a) { tip('先选一段声音，或填一个音频地址', 'warning'); return; }
    if (!isAudioUrl(a.url)) {
      tip('这个地址看起来不是音频文件，确认后再保存', 'warning');
    }

    S.saving = true;
    setBusy(true);
    try {
      var d = await put(a);
      var saved = (d.object && d.object.audio) || a;
      syncMemory(S.obj, saved);
      $('weos-on').textContent = '已挂：' + fileName(saved.url);
      $('weos-on').style.color = '#5DCAA5';
      tip('声音已保存，进世界就按距离响', 'success');
    } catch (e) {
      tip('保存失败：' + e.message, 'error');
    } finally {
      S.saving = false;
      setBusy(false);
    }
  }

  async function clear() {
    if (S.saving || !S.obj) return;
    if (!isSavedId(S.obj.id)) return;
    if (!S.audio && !currentUrl()) { tip('这个对象本来就没挂声音', 'info'); return; }
    if (!window.confirm('清除这个模型的声音？')) return;

    S.saving = true;
    setBusy(true);
    try {
      await put(null);
      syncMemory(S.obj, null);
      if ($('weos-url')) $('weos-url').value = '';
      if ($('weos-lib')) $('weos-lib').value = '';
      $('weos-on').textContent = '';
      updateBadge();
      tip('声音已清除', 'success');
    } catch (e) {
      tip('清除失败：' + e.message, 'error');
    } finally {
      S.saving = false;
      setBusy(false);
    }
  }

  function setBusy(b) {
    ['weos-save', 'weos-clear', 'weos-play'].forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = !!b;
    });
    var sb = $('weos-save');
    if (sb) sb.textContent = b ? '⏳ 处理中…' : '💾 保存声音';
  }

  window.WorldEditorObjSound = {
    render: render,
    _state: S
  };
})();
