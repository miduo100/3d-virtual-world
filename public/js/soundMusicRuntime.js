/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundMusicRuntime.js —— 场景背景音的玩家端播放
 *
 * 配置来自 GET /api/sound-scenes/music（公开只读），用 soundManager 的 AudioContext，
 * 不新开 ctx，也不走 sfx 总线——背景音乐不应该被音效音量带着一起变。
 *
 * 两种模式：
 *   loop  循环播放（氛围 BGM），进场淡入，浏览器标签页隐藏时不停（音乐不该因为切后台断掉）
 *   once  进场景播一次（开场音/公告），放完就结束
 *
 * 浏览器策略：AudioContext 初始是 suspended，必须等一次用户手势才能出声。
 *   这里跟着 soundManager.isUnlocked() 走，玩家点「进入世界」那一下就会解锁。
 *
 * 不碰 world.js：自己轮询 gameWorld 就绪，每隔 30 秒复核配置（后台改完不用重进）。
 */
(function () {
  'use strict';

  var S = {
    cfg: null, ctx: null, src: null, gain: null,
    playedOnce: false, lastCheck: 0, started: false, lastUrl: ''
  };

  function log() { console.log.apply(console, ['[Music]'].concat([].slice.call(arguments))); }

  function pickCtx() {
    var sm = window.soundManager;
    if (!sm || typeof sm.getContext !== 'function') return null;
    if (typeof sm.isUnlocked === 'function' && !sm.isUnlocked()) return null;
    var ctx = sm.getContext();
    if (!ctx) return null;
    if (S.ctx !== ctx) { S.ctx = ctx; S.gain = null; }
    return ctx;
  }

  function ensureGain(ctx) {
    if (S.gain) return S.gain;
    S.gain = ctx.createGain();
    S.gain.gain.value = 0.0001;
    S.gain.connect(ctx.destination);
    return S.gain;
  }

  async function fetchCfg() {
    try {
      var r = await fetch('/api/sound-scenes/music');
      if (!r.ok) return;
      var d = await r.json();
      S.cfg = d.music || null;
      S.lastCheck = Date.now();
    } catch (e) { /* 静默 */ }
  }

  function stop(ms) {
    if (!S.src || !S.ctx) { S.src = null; return; }
    try {
      var now = S.ctx.currentTime;
      var g = S.gain;
      if (g) {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
        g.gain.linearRampToValueAtTime(0.0001, now + (ms || 800) / 1000);
      }
      S.src.stop(now + (ms || 800) / 1000 + 0.05);
    } catch (e) {}
    S.src = null;
  }

  async function play() {
    var c = S.cfg;
    if (!c || !c.enabled || !c.url) return;
    if (c.mode === 'once' && S.playedOnce && S.lastUrl === c.url) return;

    var ctx = pickCtx();
    if (!ctx) return;                        // 还没解锁，下次 tick 再试

    stop(300);                               // 换曲子先淡出旧的
    try {
      var res = await fetch(c.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var buf = await ctx.decodeAudioData(await res.arrayBuffer());

      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = (c.mode !== 'once');
      var g = ensureGain(ctx);
      src.connect(g);
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(Math.max(0.0001, c.volume || 0.5),
        ctx.currentTime + Math.max(0.05, c.fadeIn || 2));
      src.start();

      S.src = src;
      S.lastUrl = c.url;
      if (c.mode === 'once') {
        S.playedOnce = true;
        src.onended = function () { if (S.src === src) S.src = null; };
      }
      log('开始播放:', c.url.split('/').pop(), c.mode === 'once' ? '(一次)' : '(循环)');
    } catch (e) {
      log('播放失败（忽略）:', e.message);
    }
  }

  function tick() {
    if (!S.started) return;
    if (Date.now() - S.lastCheck > 30000) fetchCfg();

    var c = S.cfg;
    if (!c || !c.enabled || !c.url) {
      if (S.src) stop(800);
      return;
    }
    // 换曲子 / 从停用变启用 → 重放
    if (!S.src) { play(); return; }
    if (S.lastUrl && S.lastUrl !== c.url) play();
  }

  async function start() {
    await fetchCfg();
    S.started = true;
    setInterval(function () { try { tick(); } catch (e) {} }, 1000);
    log('已启动');
  }

  var waited = 0;
  var waiter = setInterval(function () {
    waited += 500;
    if (window.gameWorld && window.gameWorld.scene) {
      clearInterval(waiter);
      start();
    } else if (waited > 60000) {
      clearInterval(waiter);
    }
  }, 500);

  window.SoundMusicRuntime = {
    reload: fetchCfg,
    stats: function () {
      return { cfg: S.cfg, playing: !!S.src, playedOnce: S.playedOnce };
    }
  };
})();
