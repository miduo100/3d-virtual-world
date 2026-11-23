/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundWeather.js —— 天气声音配置（挂在「世界与场景 → 天气控制」里）
 *
 * ★ 2026-11-03 搬家：原为音效库「④ 天气联动」。天气音要跟「下雨了/起风了」一起生效，
 *   所以移到天气控制子页。页面只要有一个 id="weather-sound-host" 的空容器，本文件会自动挂上去；
 *   页面上只留一行摘要，四张卡片在弹窗里（壳在 soundWeatherPanel.js），免得把页面撑高。
 * 声音跟着天气参数连续变化：风速→风声音量；雨强→雨声音量；雾→全局低通；雷暴→随机滚雷。
 * ★ 每种天气有自己的「候选池」，不是一个混在一起的大下拉：一个类型下放几个候选，
 *   点一下换当前那个，不够就「再生成 3 个变体」。候选存 config[key].candidates，
 *   当前是 config[key].url（删掉当前项自动顺延第一个）。运行时只读 url，多出的字段不关心。
 *
 * 数据落点：system_config['audio_weather']；当前天气来自 game_config.world_weather。
 * 试听按该项「最大音量」放，风额外套按风速插值的低通；雾没有声音所以没有试听。
 */
(function () {
  'use strict';

  var S = { mounted: false, config: null, current: null, sounds: [], busy: '', host: null };
  function token() { try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
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

  var DEFAULTS = {
    wind:    { enabled: true,  url: '', candidates: [], maxVolume: 0.7, freqFrom: 300, freqTo: 1800 },
    rain:    { enabled: true,  url: '', candidates: [], maxVolume: 0.8 },
    snow:    { enabled: false, url: '', candidates: [], maxVolume: 0.2 },
    fog:     { enabled: true,  url: '', candidates: [], maxVolume: 0.5, lowpassFrom: 20000, lowpassTo: 1800 },
    thunder: { enabled: true,  url: '', candidates: [], minGap: 8, maxGap: 25, volume: 0.8 }
  };

  var SOUNDED = ['wind', 'rain', 'snow', 'fog', 'thunder'];

  var CSS = [
    '.sw-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}',
    '.sw-card{border:1px solid var(--border);border-radius:8px;padding:11px}',
    '.sw-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
    '.sw-tt{font-size:12px;font-weight:500}',
    '.sw-sw{font-size:11px;color:var(--muted)}',
    '.sw-fld{margin-bottom:7px}',
    '.sw-fld label{display:block;font-size:11px;color:var(--muted);margin-bottom:2px}',
    '.sw-fld input{width:100%;background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 6px;font-size:11px}',
    '.sw-r2{display:flex;gap:6px}.sw-r2>div{flex:1}',
    '.sw-pool{border:1px solid rgba(255,255,255,0.07);border-radius:6px;margin-bottom:8px;overflow:hidden}',
    '.sw-pool-hd{display:flex;align-items:center;gap:6px;padding:4px 7px;background:rgba(255,255,255,0.03);font-size:10px;color:var(--muted)}',
    '.sw-pool-row{display:flex;align-items:center;gap:6px;padding:5px 7px;font-size:11px;border-top:1px solid rgba(255,255,255,0.05);cursor:pointer}',
    '.sw-pool-row:hover{background:rgba(255,255,255,0.04)}.sw-pool-row.on{background:rgba(0,255,0,0.08)}',
    '.sw-pool-row.on .sw-pool-nm{color:var(--text)}',
    '.sw-radio{width:8px;height:8px;border-radius:50%;border:1px solid var(--border);flex-shrink:0}',
    '.sw-pool-row.on .sw-radio{background:#00ff00;border-color:#00ff00;box-shadow:0 0 5px rgba(0,255,0,0.6)}',
    '.sw-pool-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}',
    '.sw-mini{background:none;border:1px solid var(--border);border-radius:3px;color:var(--muted);font-size:10px;padding:1px 5px;cursor:pointer;flex-shrink:0}',
    '.sw-mini:hover{color:var(--text);border-color:var(--green)}.sw-pool-empty{padding:8px;font-size:11px;color:var(--muted)}',
    '.sw-pool-acts{display:flex;gap:5px;padding:6px 7px;border-top:1px solid rgba(255,255,255,0.05);align-items:center;flex-wrap:wrap}',
    '.sw-pool-acts select{flex:1;min-width:0;background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:3px 5px;font-size:10px}',
    '.sw-note{font-size:10px;color:var(--muted);line-height:1.5;margin-top:5px}',
    '.sw-acts{display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap}',
    '.sw-play-on{background:rgba(0,255,0,0.15) !important;border-color:var(--green) !important;color:#00ff00 !important}',
    '.sw-busy{color:var(--orange)}'
  ].join('\n');

  async function load() {
    try {
      var d = await api('/api/sound-scenes/weather-audio');
      S.config = {};
      Object.keys(DEFAULTS).forEach(function (k) {
        S.config[k] = Object.assign({}, DEFAULTS[k], (d.config && d.config[k]) || {});
        if (!Array.isArray(S.config[k].candidates)) S.config[k].candidates = [];
        // 老数据只有 url：补进候选池，免得列表里空着但实际在播
        var c = S.config[k].candidates;
        if (S.config[k].url && c.indexOf(S.config[k].url) < 0) c.unshift(S.config[k].url);
      });
      S.current = d.current || null;
      var sd = await api('/api/sound-scenes/sounds');
      S.sounds = sd.sounds || [];
    } catch (e) {
      var box = $('sw-grid');
      if (box) box.innerHTML = '<div style="padding:20px;color:#ff6b6b">加载失败：' + esc(e.message) + '</div>';
      return;
    }
    renderSummary();
    if (window.SoundWeatherPanel && window.SoundWeatherPanel.isOpen('weather')) render();
  }

  // ─── 试听（按该项音量 / 滤波放，不是裸放文件）───────────────
  var P = { ctx: null, src: null, gain: null, key: null, timer: null };

  function ensureCtx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!P.ctx) P.ctx = new AC();
    if (P.ctx.state === 'suspended') { try { P.ctx.resume(); } catch (e) {} }
    return P.ctx;
  }

  function setPlayLabel(key, on) {
    var b = $('sw-' + key + '-play');
    if (!b) return;
    b.textContent = on ? '停止' : '试听';
    if (on) b.classList.add('sw-play-on'); else b.classList.remove('sw-play-on');
  }

  function stopPreview() {
    var old = P.key;
    P.key = null;
    if (P.src) { try { P.src.stop(); } catch (e) {} }
    P.src = null; P.gain = null;
    if (old) setPlayLabel(old, false);
  }

  function channelVolume(key) {
    var map = { wind: 'sw-wind-vol', rain: 'sw-rain-vol', snow: 'sw-snow-vol', fog: 'sw-fog-vol', thunder: 'sw-thunder-vol' };
    var el = $(map[key]);
    var v = el ? parseFloat(el.value) : NaN;
    return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.7;
  }

  function channelFilter(key) {
    if (key !== 'wind') return null;
    var raw = (($('sw-wind-freq') || {}).value || '300-1800').split('-');
    var a = parseInt(raw[0], 10) || 300;
    var b = parseInt(raw[1], 10) || 1800;
    var w = (S.current && S.current.wind != null) ? S.current.wind : 50;
    return a + (b - a) * (w / 100);
  }

  function preview(key, url) {
    if (P.key === key) { stopPreview(); return; }
    stopPreview();
    // 取值顺序：行级「听」传进来的 → 当前绑定的那条 → 下拉框选中项。
    // 【2026-11-15】原来「下拉框」排在「当前绑定」前面，只要下拉有选项，
    //   卡片上的「试听」就永远播下拉第一项，而不是真正在用的那条（上传后尤其明显：
    //   新文件进了候选池就从下拉里消失，下拉第一项换成别人的声音）。
    //   现在把 cfg.url 提到前面，下拉只作为「池子空着时先试听」的兜底。
    var pick = url
      || ((S.config[key] || {}).url || '')
      || (($('sw-' + key + '-add') || {}).value || '');
    if (!pick) { alert('先在下拉框里选一段声音，再点试听'); return; }
    var u = pick;

    var ctx = ensureCtx();
    if (!ctx) { try { new Audio(u).play(); } catch (e) {} return; }

    var vol = channelVolume(key);
    var freq = channelFilter(key);

    fetch(u)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (ab) { return ctx.decodeAudioData(ab); })
      .then(function (buf) {
        if (P.key) return;
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = (key !== 'thunder');
        var g = ctx.createGain();
        g.gain.value = 0.0001;
        if (freq) {
          var f = ctx.createBiquadFilter();
          f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = 0.7;
          src.connect(f); f.connect(g);
        } else {
          src.connect(g);
        }
        g.connect(ctx.destination);
        src.start();
        g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.25);
        P.src = src; P.gain = g; P.key = key;
        setPlayLabel(key, true);
        if (key === 'thunder') src.onended = function () { if (P.src === src) stopPreview(); };
      })
      .catch(function (e) { alert('试听失败：' + e.message); });
  }

  // ─── 上传（天气面板里直接传，不用跳去音效库）──────────────────

  /**
   * 传完就进本类型的候选池并设为当前——少一步点击。
   * 传错了就点回候选池里原来那条，不需要「撤销」。
   *
   * 落点：素材库 public/uploads/character-templates/sounds/（后端会自动压 WAV→MP3 32kbps），
   * 所以传一次，天气声音 / 场景背景音 / 环境声点位 三处都能选到。
   */
  function onPickFile(key, input) {
    var f = input.files && input.files[0];
    if (!f) return;
    if (!window.SoundWeatherUpload) { alert('缺少 soundWeatherUpload.js，暂时无法上传'); return; }

    var btn = document.querySelector('[data-upload="' + key + '"]');
    var lastTxt = btn ? btn.textContent : '';
    if (btn) { btn.textContent = '上传中…'; btn.disabled = true; }

    collectAll();   // 先把卡片里正在编辑的数字收回内存，后面 render 才不会丢

    window.SoundWeatherUpload.upload(f)
      .then(function (d) {
        var url = d.url;
        var nm = d.filename || baseName(url);
        if (!S.sounds.some(function (s) { return s.url === url; })) {
          S.sounds.unshift({ name: nm, url: url, size: d.size });
        }
        var cfg = S.config[key];
        if (cfg.candidates.indexOf(url) < 0) cfg.candidates.push(url);
        cfg.url = url;
        render();
        toast('已上传并设为当前：' + nm + '（' + Math.round((d.size || 0) / 1024) + 'KB），记得点「保存全部」');
      })
      .catch(function (e) { alert('上传失败：' + e.message); })
      .then(function () {
        // render() 重建过整块 DOM，原来那个按钮节点已经不在文档里，得重新取一个复位
        var b2 = document.querySelector('[data-upload="' + key + '"]');
        if (b2) { b2.textContent = lastTxt || '⬆ 上传'; b2.disabled = false; }
        input.value = '';   // 清空，同一个文件才能重复选
      });
  }

  // ─── 渲染 ───────────────────────────────────────────────────

  function poolHtml(key) {
    return window.SoundWeatherCard.pool(key, S.config[key], S.sounds);
  }

  function card(key, title, note, body, enabled) {
    return window.SoundWeatherCard.card(key, title, note, body, enabled);
  }

  function render() {
    var c = S.config;
    var grid = $('sw-grid');
    if (!grid) return;
    grid.innerHTML =
      card('wind', '风', '风速 0→100 驱动音量，频率随速度升高（风越急越尖）',
        poolHtml('wind') +
        '<button class="btn btn-secondary btn-sm" id="sw-wind-play">试听</button>' +
        '<div class="sw-r2" style="margin-top:7px">' +
          '<div class="sw-fld"><label>最大音量</label><input id="sw-wind-vol" type="number" min="0" max="1" step="0.05" value="' + c.wind.maxVolume + '"></div>' +
          '<div class="sw-fld"><label>频率范围 Hz</label><input id="sw-wind-freq" type="text" value="' + c.wind.freqFrom + '-' + c.wind.freqTo + '"></div>' +
        '</div>', c.wind.enabled) +

      card('rain', '雨', '雨强 0→100 驱动雨声音量；雨越大越密',
        poolHtml('rain') +
        '<button class="btn btn-secondary btn-sm" id="sw-rain-play">试听</button>' +
        '<div class="sw-fld" style="margin-top:7px"><label>最大音量</label><input id="sw-rain-vol" type="number" min="0" max="1" step="0.05" value="' + c.rain.maxVolume + '"></div>',
        c.rain.enabled) +

      card('snow', '雪', '雪是安静的，只加极轻的风噪',
        poolHtml('snow') +
        '<button class="btn btn-secondary btn-sm" id="sw-snow-play">试听</button>' +
        '<div class="sw-fld" style="margin-top:7px"><label>最大音量</label><input id="sw-snow-vol" type="number" min="0" max="1" step="0.05" value="' + c.snow.maxVolume + '"></div>',
        c.snow.enabled) +

      card('fog', '雾', '雾天专属的环境声 + 全场变闷（低通）',
        poolHtml('fog') +
        '<button class="btn btn-secondary btn-sm" id="sw-fog-play">试听</button>' +
        '<div class="sw-r2" style="margin-top:7px">' +
          '<div class="sw-fld"><label>雾声音量</label><input id="sw-fog-vol" type="number" min="0" max="1" step="0.05" value="' + c.fog.maxVolume + '"></div>' +
          '<div class="sw-fld"><label>晴天高频上限 Hz</label><input id="sw-fog-from" type="number" min="500" max="22050" value="' + c.fog.lowpassFrom + '"></div>' +
          '<div class="sw-fld"><label>浓雾降到 Hz</label><input id="sw-fog-to" type="number" min="200" max="22050" value="' + c.fog.lowpassTo + '"></div>' +
        '</div>' +
        '<div class="sw-note">雾浓度在两个频率之间连续插值；雾专属声音的音量随雾浓度升高。不想听雾的声音就别选。</div>', c.fog.enabled) +

      card('thunder', '雷', '雷暴天气随机播放滚雷，带延迟（远处的雷先看到闪电再听到）',
        poolHtml('thunder') +
        '<button class="btn btn-secondary btn-sm" id="sw-thunder-play">试听</button>' +
        '<div class="sw-r2" style="margin-top:7px">' +
          '<div class="sw-fld"><label>间隔最短 秒</label><input id="sw-thunder-min" type="number" min="2" max="120" value="' + c.thunder.minGap + '"></div>' +
          '<div class="sw-fld"><label>最长 秒</label><input id="sw-thunder-max" type="number" min="3" max="300" value="' + c.thunder.maxGap + '"></div>' +
        '</div>' +
        '<div class="sw-fld"><label>音量</label><input id="sw-thunder-vol" type="number" min="0" max="1" step="0.05" value="' + c.thunder.volume + '"></div>',
        c.thunder.enabled) +

      '<div style="grid-column:1/-1" class="sw-acts">' +
        '<button class="btn btn-sm" id="sw-save">保存全部</button>' +
        '<span class="sw-busy" id="sw-busy"></span>' +
        '<span style="font-size:11px;color:var(--muted)">试听按「最大音量」播放；游戏里由风速/雨强实时压低，所以实际会更轻</span>' +
      '</div>';

    bind();
  }

  function bind() {
    $('sw-save').addEventListener('click', save);

    SOUNDED.forEach(function (k) {
      var b = $('sw-' + k + '-play');
      if (b) b.addEventListener('click', function () { preview(k); });
    });

    // 下拉框旁边那个 ▶：专播「还没加进候选池」的选中项，不影响当前在用的那条
    document.querySelectorAll('[data-trysel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-trysel');
        var u = ($('sw-' + k + '-add') || {}).value;
        if (!u) { alert('素材库里没有别的声音可试听了'); return; }
        preview(k, u);
      });
    });

    // ⬆ 上传：按钮只负责代开文件选择框，真正的上传在 onPickFile 里
    document.querySelectorAll('[data-upload]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inp = $('sw-' + b.getAttribute('data-upload') + '-file');
        if (inp) inp.click();
      });
    });

    // 上传落盘后要刷新下拉和候选池，所以文件选择框每次 render 都重新挂
    SOUNDED.forEach(function (k) {
      var inp = $('sw-' + k + '-file');
      if (inp && !inp.getAttribute('data-bound')) {
        inp.setAttribute('data-bound', '1');
        inp.addEventListener('change', function () { onPickFile(k, inp); });
      }
    });

    document.querySelectorAll('[data-cur]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.hasAttribute('data-try') || e.target.hasAttribute('data-drop')) return;
        collectAll();
        S.config[el.getAttribute('data-cur')].url = el.getAttribute('data-url');
        render();
      });
    });

    document.querySelectorAll('[data-try]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        preview(b.getAttribute('data-try'), b.getAttribute('data-url'));
      });
    });

    document.querySelectorAll('[data-drop]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var k = b.getAttribute('data-drop'), u = b.getAttribute('data-url');
        collectAll();
        var cfg = S.config[k];
        cfg.candidates = cfg.candidates.filter(function (x) { return x !== u; });
        if (cfg.url === u) cfg.url = cfg.candidates[0] || '';
        stopPreview();
        render();
      });
    });

    document.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-add');
        var sel = $('sw-' + k + '-add');
        var u = sel && sel.value;
        if (!u) { alert('素材库里没有可加的音频了，试试「再生成 3 个」'); return; }
        collectAll();
        var cfg = S.config[k];
        if (cfg.candidates.indexOf(u) < 0) cfg.candidates.push(u);
        if (!cfg.url) cfg.url = u;
        render();
      });
    });

  }


  // ─── 收集与保存 ─────────────────────────────────────────────

  /** 把 DOM 上的数字/开关写回 S.config，避免 render 时丢掉正在编辑的值 */
  function collectAll() {
    var c = S.config;
    if (!c || !$('sw-wind-vol')) return;
    c.wind.enabled = $('sw-wind-on').checked;
    c.wind.maxVolume = num($('sw-wind-vol').value, 0.7);
    var freq = ($('sw-wind-freq').value || '300-1800').split('-');
    c.wind.freqFrom = parseInt(freq[0], 10) || 300;
    c.wind.freqTo = parseInt(freq[1], 10) || 1800;

    c.rain.enabled = $('sw-rain-on').checked;
    c.rain.maxVolume = num($('sw-rain-vol').value, 0.8);

    c.snow.enabled = $('sw-snow-on').checked;
    c.snow.maxVolume = num($('sw-snow-vol').value, 0.2);

    c.fog.enabled = $('sw-fog-on').checked;
    c.fog.maxVolume = num($('sw-fog-vol').value, 0.5);
    c.fog.lowpassFrom = parseInt($('sw-fog-from').value, 10) || 20000;
    c.fog.lowpassTo = parseInt($('sw-fog-to').value, 10) || 1800;

    c.thunder.enabled = $('sw-thunder-on').checked;
    c.thunder.minGap = parseInt($('sw-thunder-min').value, 10) || 8;
    c.thunder.maxGap = parseInt($('sw-thunder-max').value, 10) || 25;
    c.thunder.volume = num($('sw-thunder-vol').value, 0.8);
  }

  function clamp01(v, d) { return isFinite(v) ? Math.max(0, Math.min(1, v)) : d; }

  async function save() {
    collectAll();
    var c = S.config;
    var cfg = {
      wind: {
        enabled: c.wind.enabled, url: c.wind.url, candidates: c.wind.candidates,
        maxVolume: clamp01(c.wind.maxVolume, 0.7),
        freqFrom: c.wind.freqFrom || 300, freqTo: c.wind.freqTo || 1800
      },
      rain: { enabled: c.rain.enabled, url: c.rain.url, candidates: c.rain.candidates, maxVolume: clamp01(c.rain.maxVolume, 0.8) },
      snow: { enabled: c.snow.enabled, url: c.snow.url, candidates: c.snow.candidates, maxVolume: clamp01(c.snow.maxVolume, 0.2) },
      fog: { enabled: c.fog.enabled, url: c.fog.url, candidates: c.fog.candidates, maxVolume: clamp01(c.fog.maxVolume, 0.5), lowpassFrom: c.fog.lowpassFrom || 20000, lowpassTo: c.fog.lowpassTo || 1800 },
      thunder: {
        enabled: c.thunder.enabled, url: c.thunder.url, candidates: c.thunder.candidates,
        minGap: c.thunder.minGap || 8, maxGap: c.thunder.maxGap || 25,
        volume: clamp01(c.thunder.volume, 0.8)
      }
    };
    try {
      await api('/api/sound-scenes/weather-audio', { method: 'PUT', body: JSON.stringify({ config: cfg }) });
      S.config = Object.assign({}, c, cfg);
      renderSummary();
      if (window.SoundWeatherPanel) window.SoundWeatherPanel.closeModal('weather');   // 存完就收，别挡着下面的广播按钮
      toast('已保存');
    } catch (e) { alert('保存失败：' + e.message); }
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = '✅ ' + msg;
    t.style.cssText = 'position:fixed;top:18px;right:18px;background:rgba(0,255,0,0.15);border:1px solid #00ff00;color:#00ff00;padding:7px 12px;border-radius:6px;font-size:12px;z-index:9999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1700);
  }

  async function mount(container) {
    if (!container) return;
    S.host = container;
    if (!S.mounted) {
      var st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      S.mounted = true;
    }
    if (!window.SoundWeatherPanel) {
      container.innerHTML = '<div style="color:#ff6b6b;font-size:12px">缺少 soundWeatherPanel.js，声音配置无法展开</div>';
      return;
    }
    // 页面上只留一行摘要，四张卡片挪进弹窗——否则会把天气控制页撑高七八百像素
    window.SoundWeatherPanel.mountEntry(container, openPanel);
    if (window.SoundMusic) window.SoundMusic.init();   // 只拉配置填摘要，界面在弹窗里再渲染

    // 所在容器被藏起来时停掉试听（子页只是 display:none，没有生命周期回调）
    if (!P.timer) {
      P.timer = setInterval(function () {
        if (!P.key) return;
        if (!S.host || S.host.offsetParent === null) stopPreview();
      }, 800);
    }
    load();
  }

  /** 两个入口各弹各的：kind = 'weather' | 'music' */
  function openPanel(kind) {
    if (!window.SoundWeatherPanel) return;
    window.SoundWeatherPanel.openModal(kind);
    if (kind === 'music') {
      var mh = $('sm-host');
      if (mh && !mh.getAttribute('data-mounted') && window.SoundMusic) {
        window.SoundMusic.mountInto(mh);
      }
      return;
    }
    render();
  }

  /** 一行摘要：风 ✓ env-wind · 雨 ✓ env-water · 雪 — · 雷 — */
  function renderSummary() {
    if (!S.config || !window.SoundWeatherPanel) return;
    var names = { wind: '风', rain: '雨', snow: '雪', fog: '雾', thunder: '雷' };
    // 雾单独在后面拼（它可能只开低通没声音），所以这里先滤掉
    var bits = SOUNDED.filter(function (k) { return k !== 'fog'; }).map(function (k) {
      var c = S.config[k] || {};
      if (!c.url) return names[k] + ' <b>—</b>';
      if (c.enabled === false) return names[k] + ' <b>（停用）</b>' + esc(baseName(c.url));
      return names[k] + ' <i>' + esc(baseName(c.url)) + '</i>';
    });
    var fog = S.config.fog || {};
    var fogTxt = fog.url
      ? (fog.enabled === false ? '<b>（停用）</b>' + esc(baseName(fog.url)) : '<i>' + esc(baseName(fog.url)) + '</i>')
      : (fog.enabled === false ? '<b>关</b>' : '<i>低通</i>');
    window.SoundWeatherPanel.setSummary(bits.join('　·　') + '　·　雾 ' + fogTxt);
  }

  window.SoundWeather = { mount: mount };

  // 自动挂载：页面里存在 #weather-sound-host 就挂上去（天气控制子页就是这么接的），
  // 这样 admin.html 只需要一个空 div + 一个 script 标签，不用改那边的业务代码。
  function autoMount() {
    var host = document.getElementById('weather-sound-host');
    if (host && !host.getAttribute('data-mounted')) {
      host.setAttribute('data-mounted', '1');
      mount(host);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    setTimeout(autoMount, 0);
  }
})();
