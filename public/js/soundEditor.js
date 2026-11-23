/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundEditor.js —— ⑤ 声音资产的波形编辑器（鼠标拖着调 + 边听边改）
 *
 * 交互（照音频软件的直觉来）：
 *   · 在波形上按住拖 → 框出要留的片段（拖完自动循环播放）
 *   · 选中区左右两条竖线 → 拖动改裁切边界
 *   · 选中区中间按住拖 → 整段平移
 *   · 增益是滑杆，拖动时正在播的声音跟着变大变小（不用重播）
 *   · 「压接缝」一键给首尾加淡入淡出，灭掉循环点的「咔哒」
 *   · 满意了点「另存为新文件」
 *
 * 为什么纯前端：本机和服务端都没装 ffmpeg，为「裁一刀、调个音量」装一套 + 维护路径不值得。
 *
 * 为什么只「另存为新文件」不「覆盖原文件」：
 *   文件名就是引用键——角色模板 anim_sounds / 物件 custom_config.audio /
 *   环境声点位 ambient_pads / 天气 audio_weather 存的都是 url 里的文件名。
 *   覆盖同名文件等于所有引用瞬间换声音，误操作代价太大。
 *
 * 对外：window.SoundEditor.open(asset, onSaved)
 */
(function () {
  'use strict';

  var MIN_LEN = 0.05;      // 选区最短 0.05 秒，防止拖成一条线
  var HIT_PX = 9;          // 抓手判定半径

  var S = {
    ctx: null, buf: null, asset: null, onSaved: null,
    start: 0, end: 0, gain: 1, fadeIn: 0, fadeOut: 0,
    loop: true, autoPlay: true,
    playSrc: null, playGain: null,
    drag: null, cvW: 640, statTimer: null, playTimer: null
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function ac() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!S.ctx) S.ctx = new AC();
    if (S.ctx.state === 'suspended') { try { S.ctx.resume(); } catch (e) {} }
    return S.ctx;
  }

  var CSS = [
    '.se-mask{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9998;display:flex;align-items:center;justify-content:center}',
    '.se-panel{width:720px;max-width:95vw;max-height:94vh;overflow:auto;background:#12181f;border:1px solid var(--border);border-radius:10px;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,0.6)}',
    '.se-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}',
    '.se-name{font-size:13px;color:var(--text);font-weight:500}',
    '.se-meta{font-size:11px;color:var(--muted)}',
    '.se-x{margin-left:auto;background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;padding:0 4px}',
    '.se-x:hover{color:var(--red)}',
    '.se-wave{border:1px solid var(--border);border-radius:6px;overflow:hidden;background:#0a0e13;position:relative}',
    '.se-wave canvas{display:block;width:100%;height:118px;cursor:crosshair;touch-action:none}',
    '.se-gainrow{display:flex;align-items:center;gap:9px;margin-top:9px}',
    '.se-gainrow label{font-size:11px;color:var(--muted);flex-shrink:0}',
    '.se-gainrow input[type=range]{flex:1;accent-color:#00ff00;cursor:pointer}',
    '.se-gainval{font-size:11px;color:var(--text);font-family:Consolas,Monaco,monospace;width:52px;text-align:right;flex-shrink:0}',
    '.se-rows{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px}',
    '.se-fld label{display:block;font-size:10px;color:var(--muted);margin-bottom:2px}',
    '.se-fld input{width:100%;background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 6px;font-size:11px}',
    '.se-stat{font-size:11px;color:var(--muted);margin-top:9px;line-height:1.7;font-family:Consolas,Monaco,monospace}',
    '.se-stat b{color:var(--text);font-weight:500}',
    '.se-warn{color:var(--orange)}',
    '.se-bad{color:#ff6b6b}',
    '.se-ok{color:#5DCAA5}',
    '.se-acts{display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap}',
    '.se-chk{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer}',
    '.se-chk input{accent-color:#00ff00;cursor:pointer}',
    '.se-tip{font-size:11px;color:var(--muted);line-height:1.75;margin-top:10px;border-top:1px solid var(--border);padding-top:9px}',
    '.se-tip kbd{background:rgba(255,255,255,0.08);border:1px solid var(--border);border-radius:3px;padding:0 4px;font-size:10px;font-family:Consolas,monospace}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('se-css')) return;
    var st = document.createElement('style');
    st.id = 'se-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ─── 打开 ───────────────────────────────────────────────────

  async function open(asset, onSaved) {
    injectCss();
    stopPlay();
    S.asset = asset; S.onSaved = onSaved; S.buf = null;
    S.start = 0; S.end = 0; S.gain = 1; S.fadeIn = 0; S.fadeOut = 0;

    var mask = document.createElement('div');
    mask.className = 'se-mask';
    mask.innerHTML = '<div class="se-panel" id="se-panel"></div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });

    $('se-panel').innerHTML = '<div style="padding:26px;color:var(--muted);font-size:12px">正在解码 ' + esc(asset.name) + ' …</div>';

    try {
      var ctx = ac();
      if (!ctx) throw new Error('浏览器不支持 WebAudio');
      var r = await fetch(asset.url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var ab = await r.arrayBuffer();
      S.buf = await ctx.decodeAudioData(ab);
    } catch (e) {
      $('se-panel').innerHTML = '<div style="padding:26px;color:#ff6b6b;font-size:12px">解码失败：' + esc(e.message) + '</div>';
      return;
    }

    S.end = Math.round(S.buf.duration * 100) / 100;
    renderBody();
  }

  function close() {
    stopPlay();
    if (S.statTimer) { clearTimeout(S.statTimer); S.statTimer = null; }
    var m = document.querySelector('.se-mask');
    if (m) m.remove();
  }

  function renderBody() {
    var b = S.buf;
    var panel = $('se-panel');
    if (!panel) return;
    panel.innerHTML =
      '<div class="se-hd">' +
        '<span class="se-name">' + esc(S.asset.name) + '</span>' +
        '<span class="se-meta">' + b.duration.toFixed(2) + ' 秒 · ' + (S.asset.size / 1024).toFixed(1) + ' KB · ' +
          (b.numberOfChannels > 1 ? '立体声' : '单声道') + ' ' + b.sampleRate + 'Hz · 被引用 ' +
          (S.asset.used > 0 ? S.asset.used + ' 处' : '0 处') + '</span>' +
        '<button class="se-x" id="se-x">✕</button>' +
      '</div>' +
      '<div class="se-wave"><canvas id="se-cv"></canvas></div>' +
      '<div class="se-gainrow">' +
        '<label>音量</label>' +
        '<input type="range" id="se-gain-r" min="0" max="300" step="1" value="100">' +
        '<span class="se-gainval" id="se-gain-v">1.00×</span>' +
      '</div>' +
      '<div class="se-rows">' +
        '<div class="se-fld"><label>起点（秒）</label><input id="se-start" type="number" min="0" step="0.01" value="0"></div>' +
        '<div class="se-fld"><label>终点（秒）</label><input id="se-end" type="number" min="0" step="0.01" value="' + S.end + '"></div>' +
        '<div class="se-fld"><label>淡入（秒）</label><input id="se-fi" type="number" min="0" step="0.02" value="0"></div>' +
        '<div class="se-fld"><label>淡出（秒）</label><input id="se-fo" type="number" min="0" step="0.02" value="0"></div>' +
      '</div>' +
      '<div class="se-stat" id="se-stat"></div>' +
      '<div class="se-acts">' +
        '<button class="btn btn-secondary btn-sm" id="se-play">▶ 试听</button>' +
        '<label class="se-chk"><input type="checkbox" id="se-loop" checked> 循环</label>' +
        '<label class="se-chk"><input type="checkbox" id="se-auto" checked> 拖完自动放</label>' +
        '<button class="btn btn-secondary btn-sm" id="se-seam">压接缝</button>' +
        '<button class="btn btn-secondary btn-sm" id="se-reset">重置</button>' +
        '<span style="flex:1"></span>' +
        '<button class="btn btn-sm" id="se-save">满意了，另存为新文件</button>' +
      '</div>' +
      '<div class="se-tip">' +
        '<kbd>在波形上拖</kbd> 框出要留的片段　<kbd>拖左右竖线</kbd> 微调边界　<kbd>拖选区中间</kbd> 整段平移<br>' +
        '拖动音量滑杆时，正在循环的声音会实时变大变小。「压接缝」给首尾加一点淡入淡出，' +
        '消掉循环点的「咔哒」。<br>' +
        '保存是<b>另存一份新文件</b>，不覆盖原件——文件名就是引用键，覆盖会让所有用到它的地方瞬间换声音。' +
      '</div>';

    $('se-x').addEventListener('click', close);
    $('se-play').addEventListener('click', function () { if (S.playSrc) stopPlay(); else playRegion(); });
    $('se-save').addEventListener('click', saveAs);
    $('se-seam').addEventListener('click', autoSeam);
    $('se-reset').addEventListener('click', reset);
    $('se-loop').addEventListener('change', function () {
      S.loop = this.checked;
      if (S.playSrc) playRegion();       // 立刻按新设置重开
    });
    $('se-auto').addEventListener('change', function () { S.autoPlay = this.checked; });

    $('se-gain-r').addEventListener('input', function () {
      S.gain = Math.max(0.05, this.value / 100);
      $('se-gain-v').textContent = S.gain.toFixed(2) + '×';
      // 正在播就实时改音量节点，不用重播
      if (S.playGain) S.playGain.gain.value = S.gain;
      queueStat();
    });

    ['se-start', 'se-end', 'se-fi', 'se-fo'].forEach(function (id) {
      $(id).addEventListener('input', readInputs);
    });

    bindCanvas();
    readInputs();
    // 尺寸定了再画，否则 clientWidth 是 0
    requestAnimationFrame(function () { draw(); });
  }

  // ─── 画布：拖动交互 ─────────────────────────────────────────

  function bindCanvas() {
    var cv = $('se-cv');
    if (!cv) return;

    cv.addEventListener('pointerdown', function (e) {
      if (!S.buf) return;
      var rect = cv.getBoundingClientRect();
      S.cvW = rect.width;
      var px = e.clientX - rect.left;
      var t = xToTime(px);
      var dur = S.buf.duration;
      var x0 = timeToX(S.start), x1 = timeToX(S.end);
      // 整段都选中时，「中间」没有富余可拖，这时应该理解为重新框一段
      var fullSel = (S.start <= 0.001 && S.end >= dur - 0.001);

      var mode;
      if (Math.abs(px - x0) <= HIT_PX) mode = 'l';
      else if (Math.abs(px - x1) <= HIT_PX) mode = 'r';
      else if (!fullSel && px > x0 && px < x1) mode = 'move';
      else mode = 'new';

      S.drag = { mode: mode, downX: px, downT: t, s0: S.start, e0: S.end, anchor: t, moved: false };
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      draw(); syncInputs();
    });

    cv.addEventListener('pointermove', function (e) {
      var rect = cv.getBoundingClientRect();
      var px = e.clientX - rect.left;

      if (!S.drag) {                       // 只是悬停，换个光标提示能抓
        S.cvW = rect.width;
        var x0 = timeToX(S.start), x1 = timeToX(S.end);
        cv.style.cursor = (Math.abs(px - x0) <= HIT_PX || Math.abs(px - x1) <= HIT_PX) ? 'ew-resize'
          : (px > x0 && px < x1 ? 'grab' : 'crosshair');
        return;
      }

      var t = xToTime(px);
      var dur = S.buf.duration;
      if (Math.abs(px - S.drag.downX) > 2) S.drag.moved = true;

      if (S.drag.mode === 'l') {
        S.start = clamp(Math.min(t, S.end - MIN_LEN), 0, dur);
      } else if (S.drag.mode === 'r') {
        S.end = clamp(Math.max(t, S.start + MIN_LEN), 0, dur);
      } else if (S.drag.mode === 'new') {
        // 从按下的点往两边拉都行
        var a = S.drag.anchor;
        var lo = Math.min(a, t), hi = Math.max(a, t);
        S.start = clamp(lo, 0, Math.max(0, dur - MIN_LEN));
        S.end = clamp(Math.max(hi, S.start + MIN_LEN), 0, dur);
      } else {
        var shift = t - S.drag.downT;
        var len = S.drag.e0 - S.drag.s0;
        var ns = clamp(S.drag.s0 + shift, 0, dur - len);
        S.start = ns; S.end = ns + len;
      }
      draw(); syncInputs(); queueStat();
      e.preventDefault();
    });

    cv.addEventListener('pointerup', function (e) {
      if (!S.drag) return;
      var moved = S.drag.moved;
      S.drag = null;
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
      updateStat();
      if (moved && S.autoPlay) playRegion();   // 松手就听
    });

    cv.addEventListener('pointercancel', function () { S.drag = null; });
  }

  function xToTime(px) {
    return clamp(px / (S.cvW || 1), 0, 1) * (S.buf ? S.buf.duration : 0);
  }
  function timeToX(t) {
    return ((t / (S.buf ? S.buf.duration : 1)) || 0) * S.cvW;
  }

  /** 拖动时把秒数写回输入框，别让数字和波形对不上 */
  function syncInputs() {
    if ($('se-start')) $('se-start').value = S.start.toFixed(2);
    if ($('se-end')) $('se-end').value = S.end.toFixed(2);
  }

  function readInputs() {
    var dur = S.buf ? S.buf.duration : 0;
    S.start = clamp(num($('se-start').value, 0), 0, dur);
    S.end = clamp(num($('se-end').value, dur), 0, dur);
    if (S.end <= S.start) S.end = Math.min(dur, S.start + MIN_LEN);
    S.fadeIn = clamp(num($('se-fi').value, 0), 0, dur);
    S.fadeOut = clamp(num($('se-fo').value, 0), 0, dur);
    draw();
    queueStat();
  }

  function reset() {
    S.start = 0;
    S.end = Math.round(S.buf.duration * 100) / 100;
    S.gain = 1; S.fadeIn = 0; S.fadeOut = 0;
    $('se-start').value = 0;
    $('se-end').value = S.end;
    $('se-fi').value = 0;
    $('se-fo').value = 0;
    $('se-gain-r').value = 100;
    $('se-gain-v').textContent = '1.00×';
    if (S.playGain) S.playGain.gain.value = 1;
    readInputs();
  }

  /** 一键压接缝：给首尾各加 40 毫秒（或选区 1/8）的淡入淡出 */
  function autoSeam() {
    var len = S.end - S.start;
    var f = Math.min(0.08, Math.max(0.02, len / 8));
    S.fadeIn = f; S.fadeOut = f;
    $('se-fi').value = f.toFixed(2);
    $('se-fo').value = f.toFixed(2);
    readInputs();
    if (S.autoPlay) playRegion();
  }

  // ─── 处理链：裁切 → 淡入淡出 →（可选）增益 ──────────────────

  function process(applyGain) {
    var b = S.buf;
    var sr = b.sampleRate;
    var i0 = Math.max(0, Math.floor(S.start * sr));
    var i1 = Math.min(b.length, Math.floor(S.end * sr));
    if (i1 <= i0) i1 = Math.min(b.length, i0 + 1);
    var len = i1 - i0;
    var g = applyGain ? S.gain : 1;
    var chs = [];

    for (var c = 0; c < b.numberOfChannels; c++) {
      var src = b.getChannelData(c);
      var out = new Float32Array(len);
      for (var i = 0; i < len; i++) out[i] = src[i0 + i] * g;

      var fi = Math.min(len, Math.floor(S.fadeIn * sr));
      for (var a = 0; a < fi; a++) out[a] *= (a / fi);

      var fo = Math.min(len, Math.floor(S.fadeOut * sr));
      var from = len - fo;
      for (var z = from; z < len; z++) out[z] *= (1 - (z - from) / Math.max(1, fo));

      chs.push(out);
    }

    var peak = 0;
    for (var k = 0; k < chs.length; k++) {
      var ch = chs[k];
      for (var j = 0; j < ch.length; j++) {
        var v = ch[j] < 0 ? -ch[j] : ch[j];
        if (v > peak) peak = v;
      }
    }
    var seam = chs.length ? Math.abs(chs[0][0] - chs[0][chs[0].length - 1]) : 0;
    return { chs: chs, sr: sr, len: len, peak: peak * (applyGain ? 1 : S.gain), seam: seam };
  }

  function queueStat() {
    if (S.statTimer) return;
    S.statTimer = setTimeout(function () { S.statTimer = null; updateStat(); }, 70);
  }

  function updateStat() {
    var el = $('se-stat');
    if (!el || !S.buf) return;
    var p = process(false);
    var secs = p.len / p.sr;
    var peakCls = p.peak > 1 ? 'se-bad' : (p.peak > 0.95 ? 'se-warn' : 'se-ok');
    var seamCls = p.seam > 0.08 ? 'se-warn' : 'se-ok';
    el.innerHTML =
      '选区 <b>' + S.start.toFixed(2) + ' → ' + S.end.toFixed(2) + '</b> 秒　' +
      '时长 <b>' + secs.toFixed(2) + '</b> 秒　' +
      '峰值 <b class="' + peakCls + '">' + p.peak.toFixed(3) + '</b>' +
      (p.peak > 1 ? ' <span class="se-bad">← 会削顶，音量拉小点</span>' : '') +
      '　接缝 <b class="' + seamCls + '">' + p.seam.toFixed(3) + '</b>' +
      (p.seam > 0.08 ? ' <span class="se-warn">← 循环会有咔哒，点「压接缝」</span>' : '');
  }

  // ─── 绘制（像素活交给 soundWaveDraw.js，这里只传状态）─────────

  function draw() {
    var cv = $('se-cv');
    if (!cv || !S.buf || !window.SoundWave) return;
    S.cvW = cv.clientWidth || S.cvW;      // 交互换算要用，别让它停在默认值
    window.SoundWave.draw(cv, {
      buf: S.buf, start: S.start, end: S.end,
      fadeIn: S.fadeIn, fadeOut: S.fadeOut, height: 118
    });
  }

  // ─── 试听：循环 + 实时音量 ──────────────────────────────────

  function stopPlay() {
    if (S.playSrc) { try { S.playSrc.stop(); } catch (e) {} }
    S.playSrc = null;
    S.playGain = null;
    var b = $('se-play');
    if (b) b.textContent = '▶ 试听';
  }

  function playRegion() {
    stopPlay();
    var ctx = ac();
    if (!ctx) return;
    var p = process(false);
    var buf = ctx.createBuffer(p.chs.length, p.len, p.sr);
    for (var c = 0; c < p.chs.length; c++) {
      if (buf.copyToChannel) buf.copyToChannel(p.chs[c], c);
      else buf.getChannelData(c).set(p.chs[c]);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = S.loop;
    var g = ctx.createGain();
    g.gain.value = S.gain;
    src.connect(g); g.connect(ctx.destination);
    src.start();
    S.playSrc = src; S.playGain = g;
    if (!S.loop) {
      src.onended = function () { if (S.playSrc === src) stopPlay(); };
    }
    var btn = $('se-play');
    if (btn) btn.textContent = '■ 停止';
  }

  // ─── 导出 wav + 上传 ────────────────────────────────────────

  function toWav(chs, sr) {
    var nch = chs.length;
    var len = chs[0].length;
    var dataLen = len * nch * 2;
    var buf = new ArrayBuffer(44 + dataLen);
    var v = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, nch, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, dataLen, true);
    var off = 44;
    for (var i = 0; i < len; i++) {
      for (var c = 0; c < nch; c++) {
        var s = chs[c][i];
        s = s > 1 ? 1 : (s < -1 ? -1 : s);
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  async function saveAs() {
    stopPlay();
    var btn = $('se-save');
    var p = process(true);
    if (p.peak > 1 && !confirm('峰值 ' + p.peak.toFixed(2) + ' 已经削顶，导出的声音会失真。仍然保存？')) return;
    if (p.len / p.sr < 0.2 && !confirm('裁完只有 ' + (p.len / p.sr).toFixed(2) + ' 秒，太短了。仍然保存？')) return;

    var base = String(S.asset.name || 'sound').replace(/\.[^.]+$/, '');
    var fd = new FormData();
    // 浏览器端先封成 WAV 传上去，服务端统一压缩（WAV → MP3 单声道 32kbps）。
    // 压缩规则在 soundStore.js，与上传、AI 入库共用一套判定。
    fd.append('sound_file', toWav(p.chs, p.sr), base + '-edit.wav');

    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      var r = await fetch('/api/character-templates/upload-sound', { method: 'POST', body: fd });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));
      if (typeof S.onSaved === 'function') S.onSaved(d);
      close();
      // 提示里带上体积变化：让用户知道服务端压过
      var msg = '已另存：' + d.filename;
      if (d.compressed && d.ratio) {
        msg += '（' + fmtKB(d.originalSize) + ' → ' + fmtKB(d.size) + '，省到 1/' + d.ratio + '）';
      }
      toast(msg);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '满意了，另存为新文件';
      alert('保存失败：' + e.message);
    }
  }

  function fmtKB(n) {
    if (n == null) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = '✅ ' + msg;
    t.style.cssText = 'position:fixed;top:18px;right:18px;background:rgba(0,255,0,0.15);border:1px solid #00ff00;color:#00ff00;padding:7px 12px;border-radius:6px;font-size:12px;z-index:9999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  }

  window.SoundEditor = { open: open, close: close };
})();
