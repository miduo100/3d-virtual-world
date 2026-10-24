/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * controlsHintGate.js v1 —— 「操作指南」延后显示闸门
 *
 * 要解决的问题（用户截图复现）：
 *   #controls-hint 是 index.html 里的**静态 DOM**，页面一解析出来就 display:flex。
 *   首访有品牌遮罩（loadingMask full 档）盖着看不见；但老玩家免遮档刷新（skip 档）时
 *   没有任何遮罩 → 进世界第一秒就看到指南卡片压在一片**空背景**上（此时 loaded=0、
 *   场景只有体素化占位），观感就是"卡住了、没反应"。
 *
 * 做法（零侵入）：
 *   1. 本模块在 #controls-hint 被解析**之前**注入一条 CSS 把它藏起来（只改样式，不动 DOM）；
 *   2. 等「世界真的出内容」再移除该 CSS，指南自然出现：
 *        LoadingProgress.completedGens >= 1 / displayPct >= 100 / WorldReadyGate.isReady()
 *      都不满足则最多等 MAX_WAIT_MS（8s）兜底显示（宁可晚一点，也别永远不出现）；
 *   3. 期间用户只要**已经操作过**（点画布 / 按游戏键 / 自己关掉指南），就不再把卡片弹出来
 *      —— 免得玩了半天突然跳一个操作指南挡视线。
 *
 * 为什么用"注入 CSS 再移除"而不是 el.style.display = 'none'：
 *   本脚本在 body 早期执行，此时 #controls-hint 还没被解析，拿不到元素；
 *   注入样式表则对"之后才出现的元素"同样生效。
 *
 * 诊断：window.ControlsHintGate._diag()
 * 回退：window.ControlsHintGate.reset() 清 localStorage 无关，仅复位本次闸门状态
 */
(function () {
  'use strict';

  var CFG = {
    TICK_MS: 250,
    MAX_WAIT_MS: 8000     // 兜底：最多藏这么久
  };

  var STYLE_ID = 'controlsHintGateStyle';
  var GAME_KEYS = {
    KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyQ: 1, KeyE: 1, KeyV: 1, KeyP: 1, KeyF: 1,
    Space: 1, ShiftLeft: 1, ShiftRight: 1,
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1
  };

  var startedAt = Date.now();
  var shown = false;
  var userActed = false;
  var reason = null;        // scene | timeout | user | manual
  var tickTimer = null;
  var uiPatched = false;

  /* ---------- 隐藏 / 放行 ---------- */
  function injectHide() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = '#controls-hint{display:none !important}';
    (document.head || document.documentElement).appendChild(s);
  }

  function unlock() {
    var s = document.getElementById(STYLE_ID);
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  /* ---------- 世界是否已出内容 ---------- */
  function sceneHasContent() {
    // 最直接、最快的判据：画布真的在出帧，且已经有若干世界对象上屏
    // （LoadingProgress 的 displayPct 是"下载 0.7 + 渲染确认 0.3"口径，走得很慢，
    //   实测要 5.8s 才到 100；用它当唯一判据会让指南出现得太晚。）
    try {
      var gw = window.gameWorld;
      if (gw && gw.renderer && gw.renderer.info && gw.renderer.info.render.frame > 20 &&
          gw.loadedObjects && gw.loadedObjects.size >= 3) return true;
    } catch (e) { /* ignore */ }
    try {
      var lp = window.LoadingProgress;
      if (lp && typeof lp._diag === 'function') {
        var d = lp._diag();
        if (d && (d.completedGens || 0) >= 1) return true;
        if (d && typeof d.displayPct === 'number' && d.displayPct >= 100) return true;
      }
    } catch (e) { /* ignore */ }
    try {
      var g = window.WorldReadyGate;
      if (g && typeof g.isReady === 'function' && g.isReady()) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function show(why) {
    if (shown) return;
    if (userActed && why !== 'manual') { reason = 'user'; return; }
    shown = true;
    reason = why;
    unlock();
    console.log('[ControlsHintGate] 显示操作指南 reason=' + why +
      ' t=' + Math.round(performance.now()) + 'ms');
  }

  function markUserActed(where) {
    if (userActed) return;
    userActed = true;
    if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
    // 用户已操作：保持隐藏（元素本身若可见则直接隐藏，避免"没弹过却突然出现"）
    unlock();
    try {
      var el = document.getElementById('controls-hint');
      if (el && el.style.display !== 'none') el.style.display = 'none';
    } catch (e) { /* ignore */ }
    console.log('[ControlsHintGate] 用户已操作（' + where + '）→ 不再显示操作指南');
  }

  /* ---------- 包装 UI.hideControlsHint（用户点"开始游戏"/拖拽视角时会调它） ---------- */
  function patchUI() {
    if (uiPatched) return true;
    if (!window.UI || typeof window.UI.hideControlsHint !== 'function') return false;
    var orig = window.UI.hideControlsHint;
    window.UI.hideControlsHint = function () {
      userActed = true;          // 用户主动关 → 后续不再自动弹
      return orig.apply(this, arguments);
    };
    uiPatched = true;
    return true;
  }

  /* ---------- 驱动 ---------- */
  function tick() {
    tickTimer = null;
    if (shown || userActed) return;
    patchUI();

    if (sceneHasContent()) { show('scene'); return; }
    if (Date.now() - startedAt >= CFG.MAX_WAIT_MS) { show('timeout'); return; }
    tickTimer = setTimeout(tick, CFG.TICK_MS);
  }

  /* ---------- 用户操作监听（捕获阶段，不影响原有逻辑） ---------- */
  function bindUserIntent() {
    try {
      document.addEventListener('pointerdown', function (e) {
        var t = e.target;
        // 画布上的点击/拖拽 = 已开始玩；点指南自己的按钮由 UI.hideControlsHint 处理
        if (t && (t.id === 'canvas' || t.tagName === 'CANVAS')) markUserActed('canvas');
      }, true);
    } catch (e) { /* ignore */ }

    try {
      document.addEventListener('keydown', function (e) {
        if (e && GAME_KEYS[e.code]) markUserActed('key:' + e.code);
      }, true);
    } catch (e) { /* ignore */ }
  }

  /* ---------- 启动（解析期立即隐藏） ---------- */
  injectHide();
  bindUserIntent();
  // ui.js 在本模块之后才加载，故延后一拍再尝试包装；tick 里也会兜
  setTimeout(patchUI, 0);
  setTimeout(patchUI, 300);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, CFG.TICK_MS); }, { once: true });
  } else {
    setTimeout(tick, CFG.TICK_MS);
  }

  window.ControlsHintGate = {
    _diag: function () {
      return {
        shown: shown, userActed: userActed, reason: reason,
        uiPatched: uiPatched,
        elapsedMs: Date.now() - startedAt,
        maxWaitMs: CFG.MAX_WAIT_MS,
        hiddenByStyle: !!document.getElementById(STYLE_ID)
      };
    },
    /** 手动放行（调试用） */
    show: function () { show('manual'); return true; },
    /** 复位本次状态（调试用，页面刷新后彻底复原） */
    reset: function () {
      shown = false; userActed = false; reason = null;
      startedAt = Date.now();
      return 'ok';
    }
  };
})();
