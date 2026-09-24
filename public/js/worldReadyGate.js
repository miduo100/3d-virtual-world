/**
 * worldReadyGate.js v1 — 环境就绪闸门（首屏加载丝滑化 Step 1）
 *
 * 判据（实用口径，§4）：
 *   ready = (几何体对象全部已上屏) && (loadingQueue/loadingBatch 中已无 <15MB 对象)
 *           || sinceEnter >= 12000ms   // 硬兜底，防某些世界永不就绪
 *
 * 数据来源（只读）：window.gameWorld 的 allWorldObjects / loadedObjects /
 * loadingQueue / loadingBatch。本模块【零写操作】，不改 world.js 任何状态。
 *
 * API：window.WorldReadyGate = { isReady(), onReady(cb), once(cb), reset(opts), _diag() }
 *  - onReady/once：ready 已发生时注册立即异步触发；未发生时在 ready 时触发
 *  - reset({ timeoutMs })：重置并重新计时（测试用，可缩短兜底超时）
 *
 * 轮询 500ms，接入 BgThrottle（后台冻结）；ready 触发后停止轮询（isReady 锁存）。
 * 另加"连续 2 次确认"（≈1s 稳定窗），防瞬时队列空洞导致误触发。
 */
(function () {
  'use strict';

  var POLL_MS = 500;
  var DEFAULT_TIMEOUT_MS = 12000;
  var STABLE_POLLS = 2;                 // 连续确认次数
  var LARGE_BYTES = 15 * 1024 * 1024;   // 与 world.js LARGE_MODEL_THRESHOLD 同口径
  var THROTTLE_KEY = 'readyGate.poll';

  var startedAt = performance.now();
  var timeoutMs = DEFAULT_TIMEOUT_MS;
  var timer = null;
  var ready = false;
  var reason = null;        // 'ready' | 'timeout' | null
  var tReadyMs = null;
  var stableCount = 0;
  var callbacks = [];
  var lastDiag = _emptyDiag();

  function _emptyDiag() {
    return {
      ready: false, reason: null, tReadyMs: null, sinceEnterMs: 0,
      geometryDone: false, pendingSmallMedium: 0, queueLen: 0, batchLen: 0,
      geometryTotal: 0, geometryLoaded: 0, listReady: false,
      stableCount: 0, timeoutMs: timeoutMs
    };
  }

  function _objSize(o) { return (o && (o.fileSize || o.file_size)) || 0; }

  // 只读快照：计算当前判据各项
  function _snapshot() {
    var d = _emptyDiag();
    d.sinceEnterMs = Math.round(performance.now() - startedAt);
    d.timeoutMs = timeoutMs;
    d.ready = ready; d.reason = reason; d.tReadyMs = tReadyMs; d.stableCount = stableCount;

    var w = window.gameWorld;
    if (!w) return d;
    d.queueLen = w.loadingQueue ? w.loadingQueue.length : 0;
    d.batchLen = w.loadingBatch ? w.loadingBatch.length : 0;
    d.listReady = !!(Array.isArray(w.allWorldObjects) && w.allWorldObjects.length > 0 &&
      w.loadedObjects);
    if (!d.listReady) return d;

    // ① 几何体全部已上屏（全零个几何体视为满足——清单已回且非空）
    var total = 0, loaded = 0;
    for (var i = 0; i < w.allWorldObjects.length; i++) {
      var o = w.allWorldObjects[i];
      if (o && o.type && o.type.indexOf('geometry_') === 0) {
        total++;
        if (w.loadedObjects.has(o.id)) loaded++;
      }
    }
    d.geometryTotal = total;
    d.geometryLoaded = loaded;
    d.geometryDone = loaded >= total;

    // ② 队列 + 批次中 <15MB 的对象数（媒体不走主队列，天然不参与）
    var pending = 0;
    var scan = function (list) {
      if (!list) return;
      for (var j = 0; j < list.length; j++) {
        if (list[j] && _objSize(list[j]) < LARGE_BYTES) pending++;
      }
    };
    scan(w.loadingQueue);
    scan(w.loadingBatch);
    d.pendingSmallMedium = pending;
    return d;
  }

  function _fire(r, diag) {
    ready = true;
    reason = r;
    tReadyMs = Math.round(performance.now() - startedAt);
    diag.ready = true; diag.reason = r; diag.tReadyMs = tReadyMs;
    lastDiag = diag;
    _stopTimer();
    console.log('[ReadyGate] ✅ 环境就绪 reason=' + r + ' tReady=' + tReadyMs + 'ms' +
      ' (几何体 ' + diag.geometryLoaded + '/' + diag.geometryTotal +
      ', 队列剩余小中对象 ' + diag.pendingSmallMedium + ', queueLen=' + diag.queueLen + ')');
    var cbs = callbacks.slice();
    callbacks = [];
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](tReadyMs, r); } catch (e) { console.warn('[ReadyGate] callback 异常:', e); }
    }
  }

  function _tick() {
    if (ready) { _stopTimer(); return; }
    var d = _snapshot();
    lastDiag = d;
    var conditionsMet = d.listReady && d.geometryDone && d.pendingSmallMedium === 0;
    if (conditionsMet) {
      stableCount++;
      if (stableCount >= STABLE_POLLS) { _fire('ready', d); return; }
    } else {
      stableCount = 0;
    }
    if (d.sinceEnterMs >= timeoutMs) {
      _fire('timeout', d);
    }
  }

  function _startTimer() {
    _stopTimer();
    if (window.BgThrottle) {
      timer = window.BgThrottle.every(THROTTLE_KEY, POLL_MS, _tick);
    } else {
      timer = setInterval(_tick, POLL_MS);
    }
  }

  function _stopTimer() {
    if (timer == null) return;
    if (window.BgThrottle) { try { window.BgThrottle.cancel(THROTTLE_KEY); } catch (e) {} }
    else clearInterval(timer);
    timer = null;
  }

  var api = {
    isReady: function () { return ready; },
    onReady: function (cb) {
      if (typeof cb !== 'function') return;
      if (ready) { setTimeout(function () { cb(tReadyMs, reason); }, 0); return; }
      callbacks.push(cb);
    },
    once: function (cb) { api.onReady(cb); }, // ready 本身一次性锁存，once 与 onReady 等价
    reset: function (opts) {
      opts = opts || {};
      ready = false; reason = null; tReadyMs = null; stableCount = 0;
      callbacks = [];
      if (opts.timeoutMs && opts.timeoutMs > 0) timeoutMs = opts.timeoutMs;
      else if (opts.timeoutMs === 0) timeoutMs = DEFAULT_TIMEOUT_MS; // 0=不允许禁用兜底
      startedAt = performance.now();
      lastDiag = _emptyDiag();
      _startTimer();
    },
    _diag: function () {
      var d = _snapshot();
      lastDiag = d;
      return d;
    }
  };

  window.WorldReadyGate = api;
  _startTimer();
})();
