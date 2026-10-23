/**
 * skipGatePreview.js —— 「跳过就绪闸门」预览（实验用）
 *
 * 启用：http://localhost:3002/?skipgate=1
 * 作用：把 WorldReadyGate 强制置为"已就绪"，让等它的三处立刻放行：
 *   - playerModelScheduler（自己角色 / 远端角色放行）
 *   - skyManager（真 HDR 天空换装）
 *   - loadingMask（撤罩判据之一）
 *
 * 只覆写对外方法 isReady / onReady / once（内部状态与轮询不变，零副作用），
 * 用于验证"12 秒纯计时兜底"到底吃掉了多少首屏时间。
 */
(function () {
  'use strict';
  if (window.__skipGate) return;

  function force() {
    var g = window.WorldReadyGate;
    if (!g) return false;
    if (g.__forced) return true;
    g.__forced = true;
    var t0 = performance.now();
    g.isReady = function () { return true; };
    g.onReady = function (cb) {
      if (typeof cb === 'function') setTimeout(function () { try { cb(0, 'forced'); } catch (e) {} }, 0);
    };
    g.once = g.onReady;
    console.log('%c[SkipGatePreview] ReadyGate 已强制放行（' + Math.round(performance.now()) + 'ms）',
      'color:#0a0;font-weight:bold');
    window.__skipGate = { forcedAt: t0, readyAt: Math.round(performance.now()) };
    return true;
  }

  var timer = setInterval(function () {
    if (force()) { clearInterval(timer); timer = null; }
  }, 50);
  force();
})();
