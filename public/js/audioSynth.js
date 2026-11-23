/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * audioSynth.js —— 程序化动作音效合成器（零素材兜底层）
 *
 * 设计原则（重要，改动前先读）：
 *   1. 只作为「兜底」：角色模板里配了自定义音效就优先用自定义，本模块只在没有配置时出声。
 *   2. 绝不抛异常：任何一步失败都返回 null，调用方静默降级，不影响原有播放链路。
 *   3. 不阻塞主线程：用 OfflineAudioContext 离线渲染，结果按「配方 hash」缓存复用；
 *      20 个键只渲染一次，与角色数量无关（11 个角色共享同一份缓存）。
 *   4. 首屏零网络请求：不读任何音频文件，纯代码生成。
 *
 * 配方参数来自音频方案（AUD-002 / AUD-003）：
 *   - placeholder=true 的是「占位音」——金属摩擦、稳态嗡鸣、死亡这几类程序合成做不出真质感，
 *     但为了保证新角色上传后不静音，先用低频、低音量、不刺耳的占位音顶上，后期人工替换。
 *   - 占位音统一压到很低（outGain 0.42~0.5），绝不会盖住其他声音。
 *
 * 对外 API：
 *   window.audioSynth.getCached(type, key, overrides) -> AudioBuffer | null
 *   window.audioSynth.ensure(type, key, overrides)    -> Promise<AudioBuffer | null>（去重）
 *   window.audioSynth.prewarm([{type,key}...])        -> void（空闲时串行预热）
 *   window.audioSynth.has(type, key)                  -> boolean
 *   window.audioSynth.isPlaceholder(type, key)        -> boolean
 *   type: 'anim' | 'weapon'
 */
(function () {
  'use strict';

  /** 配方版本号：修改任一配方后 +1，旧缓存自动失效 */
  var VERSION = 2;
  var DEFAULT_SR = 44100;

  /**
   * 配方字段说明
   *   noise   : 'white' | 'brown' | 'pink'
   *   filter  : { type, freq, q, freqEnd? }   freqEnd 存在时做扫频
   *   sine    : { from, to, gain? }           低频体感层（仅 ≤120Hz，避免电子味）
   *   env     : { a, d, s, r } 秒
   *   dur     : 总时长（秒）
   *   outGain : 输出音量（占位音压得很低）
   */
  var RECIPES = {
    anim: {
      // ── 达标：噪声为主体 + 双段包络，听感可用 ──
      // ★ 2026-11-05 idle 已去掉（用户要求「待机不出声」）：
      //   旧配方是一段 1.8s 的褐噪轻呼吸，每次动作结束回到待机就响一次，很突兀。
      //   这里连"未知键兜底"一起挡住（见 SILENT_KEYS），否则删掉配方还会落到 __fallback。
      walk:        { noise: 'white', filter: { type: 'bandpass', freq: 800,  q: 1.2 },                        env: { a: 0.002, d: 0.06, s: 0, r: 0.08 },    dur: 0.25, outGain: 0.85 },
      run:         { noise: 'white', filter: { type: 'bandpass', freq: 1100, q: 1.0 },                        env: { a: 0.002, d: 0.09, s: 0, r: 0.12 },    dur: 0.32, outGain: 0.90 },
      jump:        { noise: 'white', filter: { type: 'bandpass', freq: 600,  q: 1.5, freqEnd: 1800 },          env: { a: 0.003, d: 0.08, s: 0, r: 0.10 },    dur: 0.35, outGain: 0.80 },
      land:        { noise: 'brown', filter: { type: 'lowpass',  freq: 250,  q: 0.9 }, sine: { from: 70, to: 55, gain: 0.45 }, env: { a: 0.002, d: 0.15, s: 0, r: 0.20 }, dur: 0.40, outGain: 0.90 },
      attack1:     { noise: 'white', filter: { type: 'bandpass', freq: 700,  q: 0.8, freqEnd: 1600 },          env: { a: 0.004, d: 0.07, s: 0, r: 0.09 },    dur: 0.22, outGain: 0.85 },
      attack2:     { noise: 'white', filter: { type: 'bandpass', freq: 1600, q: 0.8, freqEnd: 700 },           env: { a: 0.004, d: 0.08, s: 0, r: 0.10 },    dur: 0.26, outGain: 0.85 },
      attack3:     { noise: 'brown', filter: { type: 'bandpass', freq: 500,  q: 0.9, freqEnd: 1400 },          env: { a: 0.005, d: 0.12, s: 0, r: 0.14 },    dur: 0.35, outGain: 0.95 },
      attack_slash:{ noise: 'white', filter: { type: 'highpass', freq: 2000, q: 0.7 },                         env: { a: 0.003, d: 0.045, s: 0, r: 0.06 },   dur: 0.15, outGain: 0.75 },
      attack_stab: { noise: 'white', filter: { type: 'bandpass', freq: 900,  q: 1.6, freqEnd: 2600 },          env: { a: 0.003, d: 0.05, s: 0, r: 0.07 },    dur: 0.18, outGain: 0.80 },
      attack_swing:{ noise: 'brown', filter: { type: 'lowpass',  freq: 500,  q: 0.9 }, sine: { from: 90, to: 90, gain: 0.25 }, env: { a: 0.004, d: 0.13, s: 0, r: 0.15 }, dur: 0.30, outGain: 0.90 },
      hit:         { noise: 'white', filter: { type: 'bandpass', freq: 1500, q: 1.5 }, sine: { from: 110, to: 70, gain: 0.40 }, env: { a: 0.002, d: 0.07, s: 0, r: 0.11 }, dur: 0.25, outGain: 0.85 },

      // ── 占位：合成做不出真质感，先顶上保证不静音，后期人工替换 ──
      death:       { noise: 'brown', filter: { type: 'lowpass',  freq: 200,  q: 0.7 }, sine: { from: 55, to: 48, gain: 0.40 }, env: { a: 0.008, d: 0.06, s: 0.35, r: 0.90 }, dur: 1.40, outGain: 0.45, placeholder: true },
      draw_sword:  { noise: 'white', filter: { type: 'bandpass', freq: 2400, q: 1.6 },                         env: { a: 0.003, d: 0.09, s: 0, r: 0.12 },    dur: 0.28, outGain: 0.42, placeholder: true },
      sheath:      { noise: 'white', filter: { type: 'bandpass', freq: 1500, q: 2.2 },                         env: { a: 0.004, d: 0.11, s: 0.08, r: 0.16 }, dur: 0.32, outGain: 0.42, placeholder: true },

      // 未知键兜底
      __fallback:  { noise: 'brown', filter: { type: 'lowpass',  freq: 800,  q: 0.8 },                         env: { a: 0.002, d: 0.12, s: 0, r: 0.15 },    dur: 0.25, outGain: 0.50 }
    },
    weapon: {
      swing:       { noise: 'white', filter: { type: 'bandpass', freq: 400, q: 0.9, freqEnd: 1400 },           env: { a: 0.005, d: 0.14, s: 0, r: 0.16 },    dur: 0.38, outGain: 0.95 },
      hit_impact:  { noise: 'pink',  filter: { type: 'bandpass', freq: 900, q: 1.0 }, sine: { from: 120, to: 95, gain: 0.40 }, env: { a: 0.002, d: 0.045, s: 0, r: 0.08 }, dur: 0.18, outGain: 0.45, placeholder: true },
      draw:        { noise: 'pink',  filter: { type: 'lowpass',  freq: 600, q: 0.8, freqEnd: 1200 },           env: { a: 0.025, d: 0.10, s: 0.5, r: 0.15 },  dur: 0.45, outGain: 0.42, placeholder: true },
      sheath:      { noise: 'white', filter: { type: 'bandpass', freq: 3200, q: 1.4 },                         env: { a: 0.005, d: 0.14, s: 0.05, r: 0.22 }, dur: 0.38, outGain: 0.38, placeholder: true },
      equip_hum:   { noise: 'brown', filter: { type: 'lowpass',  freq: 400,  q: 0.7 }, sine: { from: 90, to: 90, gain: 0.18 }, env: { a: 0.06, d: 0.02, s: 1.0, r: 0.06 }, dur: 4.00, outGain: 0.35, placeholder: true, loop: true },
      __fallback:  { noise: 'brown', filter: { type: 'lowpass',  freq: 800,  q: 0.8 },                         env: { a: 0.002, d: 0.12, s: 0, r: 0.15 },    dur: 0.25, outGain: 0.50 }
    }
  };

  var cache = Object.create(null);    // hash -> AudioBuffer
  var pending = Object.create(null);  // hash -> Promise
  var queue = [];                     // 预热队列
  var draining = false;

  // ─── 噪声生成 ───────────────────────────────────────────────

  function fillNoise(ch, type) {
    var i, len = ch.length, w;
    if (type === 'pink') {
      // Paul Kellet 近似粉噪
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (i = 0; i < len; i++) {
        w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        ch[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (type === 'brown') {
      // 泄漏积分褐噪（低频更厚，适合脚步/落地/闷响）
      var last = 0;
      for (i = 0; i < len; i++) {
        w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        ch[i] = last * 3.5;
      }
    } else {
      for (i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    }
  }

  // ─── 包络 ───────────────────────────────────────────────────

  function applyEnv(param, env, dur) {
    var a = Math.max(0.001, env.a || 0.003);
    var d = Math.max(0.001, env.d || 0.05);
    var s = (typeof env.s === 'number') ? env.s : 0;
    var r = Math.max(0.005, env.r || 0.05);
    // 包络比总时长还长时按比例压缩，避免时间线冲突抛错
    if (a + d + r > dur) {
      var k = dur / (a + d + r);
      a = Math.max(0.001, a * k);
      d = Math.max(0.001, d * k);
      r = Math.max(0.005, r * k);
    }
    try {
      param.setValueAtTime(0.0001, 0);
      param.exponentialRampToValueAtTime(1, a);
      param.exponentialRampToValueAtTime(Math.max(0.0001, s), a + d);
      var relStart = Math.max(a + d, dur - r);
      if (relStart >= dur - 0.002) relStart = Math.max(a + d, dur * 0.9);
      if (relStart > a + d) param.setValueAtTime(Math.max(0.0001, s), relStart);
      param.exponentialRampToValueAtTime(0.0001, dur);
    } catch (e) { /* 时间线异常交给外层的降级处理 */ }
  }

  /** 首尾淡入淡出，消除波形硬切的 "咔" 声 */
  function fadeInOut(buffer, sec) {
    try {
      var ch = buffer.getChannelData(0);
      var n = Math.min(Math.floor(sec * buffer.sampleRate), Math.floor(ch.length / 2));
      for (var i = 0; i < n; i++) {
        var k = i / n;
        ch[i] *= k;
        ch[ch.length - 1 - i] *= k;
      }
    } catch (e) { /* ignore */ }
  }

  // ─── 配方与缓存键 ───────────────────────────────────────────

  // 明确「静音键」：这些动作一律不出声，连 __fallback 都不兜（2026-11-05 用户要求）
  // idle 一旦落到 __fallback 就会变成一声短闷响，比原来更怪，所以必须在这里挡死
  var SILENT_KEYS = { anim: { idle: true } };

  function pickRecipe(type, key) {
    var silent = SILENT_KEYS[type];
    if (silent && silent[key]) return null;
    var set = RECIPES[type] || RECIPES.anim;
    return set[key] || set.__fallback || RECIPES.anim.__fallback;
  }

  function hashOf(type, key, ov) {
    var s = type + '|' + key + '|v' + VERSION;
    if (ov) s += '|' + (ov.pitch || 1) + ',' + (ov.dur || 1) + ',' + (ov.brightness || 1) + ',' + (ov.gain || 1);
    return s;
  }

  // ─── 渲染 ───────────────────────────────────────────────────

  function renderRecipe(type, key, overrides) {
    return new Promise(function (resolve) {
      var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) { resolve(null); return; }
      var rec = pickRecipe(type, key);
      if (!rec) { resolve(null); return; }

      var o = overrides || {};
      var dur = Math.max(0.02, rec.dur * (o.dur || 1));
      var pitch = o.pitch || 1;
      var bright = o.brightness || 1;
      var len, ctx;

      try {
        len = Math.max(1, Math.ceil(dur * DEFAULT_SR));
        ctx = new OAC(1, len, DEFAULT_SR);
      } catch (e) { resolve(null); return; }

      try {
        // 噪声源
        var buf = ctx.createBuffer(1, len, DEFAULT_SR);
        fillNoise(buf.getChannelData(0), rec.noise);
        var src = ctx.createBufferSource();
        src.buffer = buf;

        // 包络 + 输出
        var envGain = ctx.createGain();
        applyEnv(envGain.gain, rec.env, dur);
        var outGain = ctx.createGain();
        var base = (typeof rec.outGain === 'number') ? rec.outGain : 1;
        outGain.gain.value = base * (o.gain || 1);

        var head = src;
        if (rec.filter) {
          var flt = ctx.createBiquadFilter();
          flt.type = rec.filter.type;
          flt.Q.value = rec.filter.q || 1;
          var f0 = Math.min(20000, Math.max(20, rec.filter.freq * pitch * bright));
          flt.frequency.setValueAtTime(f0, 0);
          if (rec.filter.freqEnd) {
            var f1 = Math.min(20000, Math.max(20, rec.filter.freqEnd * pitch * bright));
            flt.frequency.exponentialRampToValueAtTime(f1, dur * 0.8);
          }
          head.connect(flt);
          head = flt;
        }
        head.connect(envGain);
        envGain.connect(outGain);
        outGain.connect(ctx.destination);

        // 低频体感层（仅用于落地/受击/死亡这类需要"重量"的音）
        if (rec.sine) {
          var osc = ctx.createOscillator();
          osc.type = 'sine';
          var sg = ctx.createGain();
          sg.gain.value = (rec.sine.gain == null ? 0.3 : rec.sine.gain);
          osc.frequency.setValueAtTime(Math.max(20, rec.sine.from * pitch), 0);
          if (rec.sine.to && rec.sine.to !== rec.sine.from) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, rec.sine.to * pitch), dur * 0.6);
          }
          osc.connect(sg);
          sg.connect(envGain);
          osc.start(0);
          osc.stop(dur);
        }

        src.start(0);
        src.stop(dur);

        ctx.startRendering().then(function (rendered) {
          fadeInOut(rendered, 0.005);
          resolve(rendered);
        })['catch'](function () { resolve(null); });
      } catch (e) {
        resolve(null);
      }
    });
  }

  // ─── 对外接口 ───────────────────────────────────────────────

  function getCached(type, key, ov) {
    try { return cache[hashOf(type, key, ov)] || null; } catch (e) { return null; }
  }

  function ensure(type, key, ov) {
    var h;
    try { h = hashOf(type, key, ov); } catch (e) { return Promise.resolve(null); }
    if (cache[h]) return Promise.resolve(cache[h]);
    if (pending[h]) return pending[h];
    pending[h] = renderRecipe(type, key, ov).then(function (b) {
      delete pending[h];
      if (b) cache[h] = b;
      return b;
    })['catch'](function () {
      delete pending[h];
      return null;
    });
    return pending[h];
  }

  function prewarm(list) {
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t || !t.type || !t.key) continue;
      var h = hashOf(t.type, t.key, null);
      if (cache[h]) continue;
      var dup = false;
      for (var j = 0; j < queue.length; j++) {
        if (queue[j].type === t.type && queue[j].key === t.key) { dup = true; break; }
      }
      if (!dup) queue.push({ type: t.type, key: t.key });
    }
    drain();
  }

  function drain() {
    if (draining || queue.length === 0) return;
    draining = true;
    var step = function () {
      if (queue.length === 0) { draining = false; return; }
      var t = queue.shift();
      ensure(t.type, t.key, null).then(function () {
        var next = function () { step(); };
        if (window.requestIdleCallback) window.requestIdleCallback(next, { timeout: 2000 });
        else setTimeout(next, 30);
      });
    };
    if (window.requestIdleCallback) window.requestIdleCallback(step, { timeout: 1500 });
    else setTimeout(step, 60);
  }

  function has(type, key) {
    return !!(RECIPES[type] && RECIPES[type][key]);
  }

  function isPlaceholder(type, key) {
    var r = RECIPES[type] && RECIPES[type][key];
    return !!(r && r.placeholder);
  }

  window.audioSynth = {
    version: VERSION,
    has: has,
    isPlaceholder: isPlaceholder,
    getCached: getCached,
    ensure: ensure,
    prewarm: prewarm,
    recipes: RECIPES,
    // 调试用：主动渲染一次并返回
    render: function (type, key, ov) { return renderRecipe(type, key, ov); }
  };
})();
