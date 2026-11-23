/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundVariants.js —— ① 角色动作的「合成变体」挑选面板
 *
 * ★ 先讲清楚这些声音是什么，别误会：
 *   audioSynth.js 里的 20 个动作音是**写死的配方参数表**（噪声类型 + 滤波 + 包络 + 低频正弦），
 *   用 WebAudio 的 OfflineAudioContext 在**浏览器本地**渲染出来。
 *   没有提示词、没有调用任何 AI、不联网、不花钱，20 个键全部渲染完只要 41ms。
 *
 *   所以这里的「变体」也不是让 AI 重新生成，而是给同一份配方拧 4 个旋钮：
 *     pitch 音高（越低越闷越重）、dur 时长、brightness 明亮度（越高越尖）、gain 音量
 *   听感差别是真实的，但**属于"同一类声音的不同味道"，不是"另一个声音"**。
 *   要"走路声从沙沙变成哒哒"这种级别的不一样，只能上传真素材或接 AI 音效模型。
 *
 * 选中的变体写进 character_templates.anim_sounds[key].synth，
 * 播放端 soundManager._resolveSound() 已经会把 slot.synth 当 overrides 传给合成器，
 * 所以选完玩家那边立刻按新参数出声，不需要改任何播放代码。
 *
 * 对外：window.SoundVariants.open(opts)
 *   opts = { type, key, desc, template, onSaved(field, value) }
 *   template 是当前角色模板对象（要用它的 id 存库、用它的字段读当前变体）
 */
(function () {
  'use strict';

  var S = { opts: null, salt: 0, picks: [], ctx: null, playing: null, current: null, field: 'anim_sounds', hasCustom: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }

  function ac() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!S.ctx) S.ctx = new AC();
    if (S.ctx.state === 'suspended') { try { S.ctx.resume(); } catch (e) {} }
    return S.ctx;
  }

  // ─── 确定性随机：同一个 key 每次打开得到同一批变体，点「换一批」才换 ──

  function seedOf(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 一趟 = 原始 + 3 个变体；salt 变了就是另一批 */
  function makePicks(type, key, salt) {
    var r = rng(seedOf(type + '|' + key) + salt * 7919);
    var out = [{ ov: null, tag: '原始配方', hint: '系统默认，没有额外调整' }];
    var names = ['A', 'B', 'C'];
    for (var i = 0; i < 3; i++) {
      var ov = {
        pitch: +(0.78 + r() * 0.55).toFixed(2),
        dur: +(0.85 + r() * 0.45).toFixed(2),
        brightness: +(0.6 + r() * 0.95).toFixed(2),
        gain: +(0.85 + r() * 0.3).toFixed(2)
      };
      out.push({ ov: ov, tag: '变体 ' + names[i], hint: describe(ov) });
    }
    return out;
  }

  function describe(ov) {
    var bits = [];
    if (ov.pitch < 0.9) bits.push('更低沉');
    else if (ov.pitch > 1.15) bits.push('更尖细');
    if (ov.brightness < 0.85) bits.push('更闷');
    else if (ov.brightness > 1.25) bits.push('更脆亮');
    if (ov.dur < 0.95) bits.push('更短促');
    else if (ov.dur > 1.15) bits.push('拖得更长');
    if (ov.gain > 1.05) bits.push('更响');
    if (!bits.length) bits.push('细微差别，听一遍对比');
    return bits.join(' · ');
  }

  function sameOv(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.pitch === b.pitch && a.dur === b.dur && a.brightness === b.brightness && a.gain === b.gain;
  }

  // ─── 面板 ───────────────────────────────────────────────────

  var CSS = [
    '.sv-mask{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9997;display:flex;align-items:center;justify-content:center}',
    '.sv-panel{width:560px;max-width:94vw;max-height:90vh;overflow:auto;background:#12181f;border:1px solid var(--border);border-radius:10px;padding:16px}',
    '.sv-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:4px}',
    '.sv-tt{font-size:13px;color:var(--text);font-weight:500}',
    '.sv-sub{font-size:11px;color:var(--muted)}',
    '.sv-x{margin-left:auto;background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;padding:0 4px}',
    '.sv-x:hover{color:var(--red)}',
    '.sv-list{margin-top:10px;border:1px solid var(--border);border-radius:7px;overflow:hidden}',
    '.sv-item{display:flex;align-items:center;gap:9px;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px}',
    '.sv-item:last-child{border-bottom:none}',
    '.sv-item:hover{background:rgba(255,255,255,0.03)}',
    '.sv-item.on{background:rgba(0,255,0,0.07)}',
    '.sv-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;border:1px solid var(--border)}',
    '.sv-item.on .sv-dot{background:#00ff00;border-color:#00ff00;box-shadow:0 0 6px rgba(0,255,0,0.6)}',
    '.sv-l{flex:1;min-width:0}',
    '.sv-nm{display:block;color:var(--text)}',
    '.sv-hint{display:block;font-size:10px;color:var(--muted);margin-top:2px}',
    '.sv-num{font-size:10px;color:#6b7684;font-family:Consolas,monospace;flex-shrink:0}',
    '.sv-acts{display:flex;gap:8px;margin-top:12px;align-items:center}',
    '.sv-tip{font-size:11px;color:var(--muted);line-height:1.75;margin-top:10px;border-top:1px solid var(--border);padding-top:9px}',
    '.sv-warn{font-size:11px;color:var(--orange);line-height:1.7;margin-top:8px;background:rgba(255,140,0,0.08);border:1px solid rgba(255,140,0,0.25);border-radius:6px;padding:7px 9px}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('sv-css')) return;
    var st = document.createElement('style');
    st.id = 'sv-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function open(opts) {
    injectCss();
    close();
    S.opts = opts;
    S.salt = 0;

    var field = (opts.type === 'weapon') ? 'weapon_sounds' : 'anim_sounds';
    var dict = asObj(opts.template ? opts.template[field] : null);
    var slot = normSlot(dict[opts.key]);
    S.field = field;
    S.current = (slot && slot.synth) ? slot.synth : null;
    S.hasCustom = !!(slot && slot.urls && slot.urls.length);
    S.picks = makePicks(opts.type, opts.key, S.salt);

    var mask = document.createElement('div');
    mask.className = 'sv-mask';
    mask.innerHTML = '<div class="sv-panel" id="sv-panel"></div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    render();
  }

  // ─── 读写模板字段（接口是整表覆盖，其余键原样带回去）─────────

  function asObj(v) {
    if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch (e) { return {}; } }
    return v || {};
  }

  function normSlot(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v ? { urls: [v] } : null;
    if (Array.isArray(v)) { var a = v.filter(function (x) { return typeof x === 'string' && x; }); return a.length ? { urls: a } : null; }
    if (typeof v === 'object') {
      var urls = Array.isArray(v.urls) ? v.urls.filter(function (x) { return typeof x === 'string' && x; })
        : (typeof v.url === 'string' && v.url ? [v.url] : []);
      return { urls: urls, muted: !!v.muted, volume: v.volume, synth: v.synth };
    }
    return null;
  }

  function token() { try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; } }

  async function applyPick(ov) {
    var tpl = S.opts.template;
    if (!tpl || !tpl.id) { alert('没有当前模板，无法保存'); return; }
    var dict = Object.assign({}, asObj(tpl[S.field]));
    var cur = dict[S.opts.key];
    var obj = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? Object.assign({}, cur)
      : (typeof cur === 'string' && cur ? { urls: [cur] } : {});
    if (ov) obj.synth = ov; else delete obj.synth;
    if (Object.keys(obj).length) dict[S.opts.key] = obj; else delete dict[S.opts.key];

    var payload = {};
    payload[S.field] = dict;
    try {
      var r = await fetch('/api/character-templates/' + encodeURIComponent(tpl.id) +
        (S.opts.type === 'weapon' ? '/weapon-sounds' : '/anim-sounds'), {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var b = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status));
      S.current = ov;
      if (typeof S.opts.onSaved === 'function') S.opts.onSaved(S.field, b[S.field]);
      render();
      toast(ov ? '已保存，玩家那边下次播就是这个味道' : '已恢复原始配方');
    } catch (e) {
      alert('保存失败：' + e.message);
    }
  }

  function close() {
    stop();
    var m = document.querySelector('.sv-mask');
    if (m) m.remove();
  }

  function render() {
    var o = S.opts;
    var p = $('sv-panel');
    if (!p || !o) return;

    p.innerHTML =
      '<div class="sv-hd">' +
        '<span class="sv-tt">' + esc(o.desc || o.key) + ' · 合成变体</span>' +
        '<span class="sv-sub">' + esc(o.type === 'weapon' ? '武器音效' : '角色动作') + ' · ' + esc(o.key) + '</span>' +
        '<button class="sv-x" id="sv-x">✕</button>' +
      '</div>' +
      (S.hasCustom
        ? '<div class="sv-warn">这个槽位已经上传了自定义音频文件。播放时<b>自定义文件优先于合成音</b>，' +
          '所以在这里选的变体不会生效——除非先去把那个文件清掉。</div>'
        : '') +
      '<div class="sv-list">' +
        S.picks.map(function (pk, i) {
          var on = sameOv(pk.ov, S.current);
          return '<div class="sv-item' + (on ? ' on' : '') + '">' +
            '<span class="sv-dot"></span>' +
            '<span class="sv-l">' +
              '<span class="sv-nm">' + esc(pk.tag) + '</span>' +
              '<span class="sv-hint">' + esc(pk.hint) + '</span>' +
            '</span>' +
            (pk.ov ? '<span class="sv-num">' + pk.ov.pitch + '/' + pk.ov.brightness + '</span>' : '<span class="sv-num">默认</span>') +
            '<button class="btn btn-secondary btn-sm" data-play="' + i + '">试听</button>' +
            '<button class="btn btn-sm" data-pick="' + i + '">选用</button>' +
            '</div>';
        }).join('') +
      '</div>' +
      '<div class="sv-acts">' +
        '<button class="btn btn-secondary btn-sm" id="sv-roll">换一批</button>' +
        '<button class="btn btn-secondary btn-sm" id="sv-reset">恢复原始配方</button>' +
        '<span style="flex:1"></span>' +
        '<span class="sv-sub" id="sv-now">' + (S.current ? '当前：已选变体' : '当前：原始配方') + '</span>' +
      '</div>' +
      '<div class="sv-tip">' +
        '这些不是 AI 重新生成的，是同一份合成配方换了参数：音高 / 时长 / 明亮度 / 音量。' +
        '所以差别是「同一种声音的不同味道」，不会变成另一种声音。<br>' +
        '选完立刻写进角色模板，玩家那边下次播这个动作就是这个味道。' +
      '</div>';

    $('sv-x').addEventListener('click', close);
    $('sv-roll').addEventListener('click', function () {
      S.salt++;
      S.picks = makePicks(S.opts.type, S.opts.key, S.salt);
      stop();
      render();
    });
    $('sv-reset').addEventListener('click', function () {
      S.current = null;
      applyPick(null);
    });

    p.querySelectorAll('button[data-play]').forEach(function (b) {
      b.addEventListener('click', function () { play(S.picks[+b.getAttribute('data-play')]); });
    });
    p.querySelectorAll('button[data-pick]').forEach(function (b) {
      b.addEventListener('click', function () {
        var pk = S.picks[+b.getAttribute('data-pick')];
        applyPick(pk.ov);
      });
    });
  }

  // ─── 试听 ───────────────────────────────────────────────────

  function stop() {
    if (S.playing) { try { S.playing.stop(); } catch (e) {} }
    S.playing = null;
  }

  function play(pk) {
    var synth = window.audioSynth;
    if (!synth || !synth.ensure) { alert('合成器没加载（audioSynth.js）'); return; }
    stop();
    var ctx = ac();
    if (!ctx) return;

    var cached = synth.getCached(S.opts.type, S.opts.key, pk.ov);
    if (cached) { blast(cached); return; }
    synth.ensure(S.opts.type, S.opts.key, pk.ov).then(function (buf) {
      if (buf) blast(buf);
    });
  }

  function blast(buf) {
    var ctx = ac();
    if (!ctx || !buf) return;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g); g.connect(ctx.destination);
    src.start();
    S.playing = src;
    src.onended = function () { if (S.playing === src) S.playing = null; };
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = '✅ ' + msg;
    t.style.cssText = 'position:fixed;top:18px;right:18px;background:rgba(0,255,0,0.15);border:1px solid #00ff00;color:#00ff00;padding:7px 12px;border-radius:6px;font-size:12px;z-index:9999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  window.SoundVariants = { open: open, close: close };
})();
