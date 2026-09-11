/**
 * loadingProgress.js — 世界内顶部加载进度条引擎（任务集口径 + 加载/渲染双分量）
 *
 * 背景（2026-09-05）：两阶段加载重构后旧进度条分母=全图对象数(1071)，实际只加载
 * 半径内约 370 个 → 永远卡在 ~34.5%。
 *
 * 新口径：
 *   - 分母 = 兴趣集（loadingQueue/loadingBatch 内的对象 + 本代已完成任务），
 *     即"当前正在为玩家加载的东西"，全图对象数不再参与计算 → 根治卡 34.5%
 *   - 单对象进度 = 0.7 × 下载字节进度 + 0.3 × 渲染确认（compileAsync 预热后
 *     真实上屏）→ 100% 时保证眼前模型已画到屏幕，而非仅"下载完成"
 *   - 重现：隐藏状态下新入队工作量达阈值（≥3 个 或 ≥2MB 或单对象≥8MB）→ 新一代任务集
 *   - 兜底：单任务 45s 超时强制计完成，绝不堵 100%；下载超时/失败同样由超时收敛
 *
 * 对接钩子（world.js 内，均为一行式）：
 *   LoadingProgress.sync(world)          — 旧 updateLoadingStatus/showLoadingProgress 代理
 *   LoadingProgress.reportBytes(name,b,t)— updateLargeModelProgress 真实下载字节
 *   LoadingProgress.confirmRendered(id)  — _addModelToScene reveal 回调 / 合批路径 / 媒体完成
 */
(function () {
  'use strict';

  var CFG = {
    DOWNLOAD_SHARE: 0.7,          // 单对象进度中"下载"分量权重
    RENDER_SHARE: 0.3,            // 单对象进度中"渲染确认"分量权重（份额固定，渲染前记 0）
    TASK_TIMEOUT_MS: 45000,       // 加载中任务超时（从进入 loadingBatch 起算）
    QUEUE_TIMEOUT_MS: 240000,     // 排队任务超时（从入队起算，防队列泄漏；串行队列消耗慢不算超时）
    ORPHAN_MS: 20000,             // 【2026-09-11】孤儿任务宽限期：任务不在队列/批次且无渲染确认
                                  // 超过此时长 → 强制完成。兜住一切漏挂确认钩子/被清理放弃的
                                  // 加载路径（每扫常清、重试放弃、未覆盖分支），进度条永不假卡死
    SHOW_MIN_TASKS: 3,            // 重现阈值：未完成任务数 ≥ 3
    SHOW_MIN_WEIGHT: 2 * 1024 * 1024,   // 或未完成字节总量 ≥ 2MB
    SHOW_SINGLE_WEIGHT: 8 * 1024 * 1024,// 或单个对象 ≥ 8MB 立即弹
    HIDE_DELAY_MS: 1000,          // 100% 后延迟淡出
    POLL_MS: 500,                 // 兜底轮询（world.js 钩子为主驱动）
    RECENT_GRACE_MS: 60000,       // 刚渲染完的对象在"重现判定"中的豁免期（防卸载重载闪烁）
    GEOMETRY_WEIGHT: 64 * 1024,   // 无文件对象（几何体/未知大小）的进度权重
    UNKNOWN_DL_CAP: 0.5           // 无 Content-Length 时下载分量封顶比例
  };

  var _tasks = new Map();          // 当前代任务集: id -> task
  var _recentRendered = new Map(); // id -> 渲染确认时刻（重现豁免）
  var _visible = false;
  var _closing = false;            // 本代已 100%，等待淡出；迟到任务走新代判定
  var _completedGens = 0;          // 已完成代数（持久计数，供外部断言/诊断）
  var _hideTimer = null;
  var _displayPct = 0;             // 本代内单调不回退的显示值
  var _pollTimer = null;
  var _lastGenPos = null;          // 上一次弹条时的玩家位置（诊断位移触发用）

  function _objWeight(obj) {
    var t = obj && obj.type ? String(obj.type) : '';
    var fs = (obj && obj.file_size) || 0;
    if (t.indexOf('geometry') === 0) return Math.min(fs || CFG.GEOMETRY_WEIGHT, CFG.GEOMETRY_WEIGHT);
    return fs > 0 ? fs : CFG.GEOMETRY_WEIGHT;
  }

  function _makeTask(id, obj) {
    return {
      id: id,
      obj: obj || null,
      weight: _objWeight(obj),
      bytes: 0,
      total: (obj && obj.file_size) || 0,
      startedAt: Date.now(),
      lastSeenAt: Date.now(),  // 最近一次出现在队列/批次中的时刻（孤儿判定用）
      inBatch: false,   // 已进入 loadingBatch（真正开始加载）
      rendered: false,
      forced: false
    };
  }

  // 下载分量：有 Content-Length 按字节比；无则按已收字节缓升封顶
  function _dlFrac(t) {
    if (t.total > 0) return Math.min(1, t.bytes / t.total);
    if (t.bytes > 0) return Math.min(CFG.UNKNOWN_DL_CAP, (t.bytes / (1024 * 1024)) * 0.25);
    return 0;
  }

  function _compute() {
    var now = Date.now();
    var sumW = 0, sumP = 0, pending = 0, allDone = _tasks.size > 0;
    _tasks.forEach(function (t) {
      // 超时口径：加载中（inBatch）45s；排队等待 240s（串行队列消耗慢不是故障）
      var limit = t.inBatch ? CFG.TASK_TIMEOUT_MS : CFG.QUEUE_TIMEOUT_MS;
      if (!t.rendered && !t.forced && now - t.startedAt > limit) {
        t.forced = true;
        // 可观测性：超时的"最后一个"到底是谁（渲确认钩子未覆盖的加载路径会走到这里）
        try {
          console.warn('[LoadingProgress] task timeout -> force done:',
            'id=' + t.id, 'name=' + (t.obj && t.obj.name), 'type=' + (t.obj && t.obj.type),
            'phase=' + (t.inBatch ? 'loading' : 'queued'),
            'bytes=' + t.bytes + '/' + t.total);
        } catch (e) { /* ignore */ }
      }
      var done = t.rendered || t.forced;
      var frac = done ? 1 : CFG.DOWNLOAD_SHARE * _dlFrac(t);
      sumW += t.weight;
      sumP += frac * t.weight;
      if (!done) { allDone = false; pending++; }
    });
    return { pct: sumW > 0 ? (sumP / sumW) : 1, pending: pending, allDone: allDone };
  }

  // ---------- DOM（复用旧进度条的元素 id，样式不变） ----------

  function _ensureDom() {
    if (!document.getElementById('loading-progress-container')) {
      var container = document.createElement('div');
      container.id = 'loading-progress-container';
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '4px';
      container.style.backgroundColor = '#f0f0f0';
      container.style.zIndex = '1000';
      container.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
      document.body.appendChild(container);

      var progressBar = document.createElement('div');
      progressBar.id = 'loading-progress-bar';
      progressBar.style.height = '100%';
      progressBar.style.backgroundColor = '#4CAF50';
      progressBar.style.width = '0%';
      progressBar.style.transition = 'width 0.3s ease';
      container.appendChild(progressBar);

      var loadingText = document.createElement('div');
      loadingText.id = 'loading-progress-text';
      loadingText.style.position = 'fixed';
      loadingText.style.top = '10px';
      loadingText.style.left = '50%';
      loadingText.style.transform = 'translateX(-50%)';
      loadingText.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
      loadingText.style.color = 'white';
      loadingText.style.padding = '5px 15px';
      loadingText.style.borderRadius = '15px';
      loadingText.style.zIndex = '1001';
      loadingText.style.fontFamily = 'Arial, sans-serif';
      loadingText.style.fontSize = '12px';
      document.body.appendChild(loadingText);
    }
  }

  function _render(pending) {
    var bar = document.getElementById('loading-progress-bar');
    var text = document.getElementById('loading-progress-text');
    if (bar) bar.style.width = _displayPct.toFixed(1) + '%';
    if (text) {
      text.textContent = '加载中... ' + _displayPct.toFixed(1) + '%' +
        (pending > 0 ? '（剩余 ' + pending + ' 个）' : '');
    }
  }

  function _show() {
    _cancelHide();
    _ensureDom();
    var c = document.getElementById('loading-progress-container');
    var t = document.getElementById('loading-progress-text');
    if (c) c.style.display = 'block';
    if (t) t.style.display = 'block';
    _visible = true;
  }

  function _scheduleHide() {
    if (_hideTimer) return;
    _hideTimer = setTimeout(function () {
      _hideTimer = null;
      var c = document.getElementById('loading-progress-container');
      var t = document.getElementById('loading-progress-text');
      if (c) c.style.display = 'none';
      if (t) t.style.display = 'none';
      _visible = false;
      _closing = false;
      _displayPct = 0;
      _completedGens++;
      _tasks.clear(); // 本代结束
    }, CFG.HIDE_DELAY_MS);
  }

  function _cancelHide() {
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  }

  // ---------- 核心同步 ----------

  function sync(w) {
    w = w || window.gameWorld;
    if (!w || !w.allWorldObjects) return;
    var q = w.loadingQueue || [], b = w.loadingBatch || [];

    // 1. 收集当前队列/批次内的对象 id（兴趣集来源；批次单独标记用于超时阶段判定）
    var ids = [], seen = {}, batchSet = {};
    q.forEach(function (o) { var id = o && o.id; if (id != null && !seen[id]) { seen[id] = 1; ids.push(id); } });
    b.forEach(function (o) {
      var id = o && o.id;
      if (id == null) return;
      batchSet[id] = 1;
      if (!seen[id]) { seen[id] = 1; ids.push(id); }
    });
    if (ids.length === 0 && _tasks.size === 0) return; // 空闲快速路径

    // 2. 找出新候选（不在任务集、且不在渲染豁免期）
    var index = null;
    function objOf(id) {
      if (!index) {
        index = {};
        w.allWorldObjects.forEach(function (o) { if (o && o.id != null) index[o.id] = o; });
      }
      return index[id];
    }
    var candidates = [];
    ids.forEach(function (id) {
      if (_tasks.has(id)) return;
      var rr = _recentRendered.get(id);
      if (rr && Date.now() - rr < CFG.RECENT_GRACE_MS) return;
      candidates.push(id);
    });

    // 3. 收编：可见且未闭代时直接并入本代；其余情况需达工作量阈值才开新一代
    //    【2026-09-06 修复】"100.0%（剩余1个）卡死"：旧逻辑在 1 秒淡出窗口内
    //    迟到任务被并入已完成代，显示值被单调锁死在 100% 且淡出被取消，
    //    持续行走时零星任务不断流入 → 永远停在"100% 剩余1个"。
    //    现在 allDone 即闭代（_closing），迟到任务一律走新代阈值判定。
    if (candidates.length > 0) {
      if (_visible && !_closing) {
        candidates.forEach(function (id) { _tasks.set(id, _makeTask(id, objOf(id))); });
      } else {
        var cw = 0, cBig = 0;
        candidates.forEach(function (id) {
          var wt = _objWeight(objOf(id));
          cw += wt; if (wt > cBig) cBig = wt;
        });
        if (candidates.length >= CFG.SHOW_MIN_TASKS || cw >= CFG.SHOW_MIN_WEIGHT || cBig >= CFG.SHOW_SINGLE_WEIGHT) {
          // 【弹条打点】新一代加载触发时记录现场：玩家位置、距上次弹条的位移、
          // 候选对象的近/远分布（far>0 = 距离过滤异常；位移大 = 位置漂移/被推挤触发）
          var _px = null, _pz = null, _drift = null, _near = 0, _far = 0, _names = [];
          try {
            var _pp = window.player && window.player.position;
            if (_pp) {
              _px = +_pp.x.toFixed(1); _pz = +_pp.z.toFixed(1);
              if (_lastGenPos) {
                _drift = +Math.sqrt(Math.pow(_px - _lastGenPos.x, 2) + Math.pow(_pz - _lastGenPos.z, 2)).toFixed(1);
              }
              _lastGenPos = { x: _px, z: _pz };
            }
            candidates.forEach(function (id) {
              var o = objOf(id);
              if (!o || !_pp) return;
              var dx = (o.position_x || 0) - _pp.x, dz = (o.position_z || 0) - _pp.z;
              if (dx * dx + dz * dz < 250 * 250) _near++; else _far++;
            });
            candidates.slice(0, 3).forEach(function (id) {
              var o = objOf(id);
              if (o) _names.push((o.name || o.id) + '[' + (o.type || '?') + ']');
            });
          } catch (e) { /* 诊断日志绝不影响主流程 */ }
          console.log('[LoadingProgress] 新一代加载: ' + candidates.length + '个 / ' +
            (cw / 1048576).toFixed(1) + 'MB, 玩家(' + _px + ',' + _pz + ')' +
            (_drift != null ? ', 距上次弹条移动 ' + _drift + 'm' : '') +
            ', 候选近/远=' + _near + '/' + _far +
            (_names.length ? ', 样例: ' + _names.join(', ') : ''));
          _cancelHide();
          _closing = false;
          _tasks.clear();
          _displayPct = 0;
          candidates.forEach(function (id) { _tasks.set(id, _makeTask(id, objOf(id))); });
          _show();
        }
        // 不达阈值：不弹条，对象照常静默加载（完成后 confirmRendered 进豁免表）
      }
    }

    // 3.5 任务从排队转入加载中（进入 loadingBatch）：重置超时时钟起点
    for (var bid in batchSet) {
      var bt = _tasks.get(bid);
      if (bt && !bt.inBatch) { bt.inBatch = true; bt.startedAt = Date.now(); }
    }

    // 3.6 【2026-09-11】孤儿任务对账：仍在队列/批次中的任务刷新"最后可见"时刻；
    // 不在队列/批次、又迟迟没有渲染确认的任务 = 被清理/放弃/漏挂钩子的加载路径，
    // 超过 ORPHAN_MS 宽限期直接强制完成——宁可早关条（模型继续渐进出现），
    // 也绝不让进度条假卡死
    var _now = Date.now();
    _tasks.forEach(function (t, tid) {
      if (seen[tid]) { t.lastSeenAt = _now; return; }
      if (t.rendered || t.forced) return;
      var _lastSeen = t.lastSeenAt || t.startedAt;
      if (_now - _lastSeen > CFG.ORPHAN_MS) {
        t.forced = true;
        try {
          console.warn('[LoadingProgress] 孤儿任务强制完成（不在队列/批次且无渲染确认）:',
            'id=' + tid, 'name=' + (t.obj && t.obj.name), 'type=' + (t.obj && t.obj.type),
            'unseenMs=' + (_now - _lastSeen));
        } catch (e) { /* 诊断日志绝不影响主流程 */ }
      }
    });

    if (!_visible || _tasks.size === 0) return;

    // 4. 计算并渲染
    var st = _compute();
    if (st.allDone) {
      _displayPct = 100;
      _render(0);
      _closing = true;      // 闭代：此后迟到任务走新代阈值判定
      _scheduleHide();
    } else {
      // 有未完成任务时显示值钳制 ≤99.4%——绝不出现"100% 还剩 N 个"的矛盾态
      _displayPct = Math.min(99.4, Math.max(_displayPct, st.pct * 100));
      _render(st.pending);
      _cancelHide();
    }
  }

  // ---------- 对外钩子 ----------

  // 真实下载字节上报（world.js updateLargeModelProgress，按对象名匹配任务）
  function reportBytes(name, bytes, total) {
    if (!name) return;
    var hit = null;
    _tasks.forEach(function (t) {
      if (!hit && t.obj && t.obj.name === name) hit = t;
    });
    if (!hit) return;
    if (bytes > hit.bytes) hit.bytes = bytes;
    if (total > 0) hit.total = total;
  }

  // 渲染确认（reveal 回调 / 合批成功 / 媒体加载完成）
  function confirmRendered(id) {
    if (id == null) return;
    _recentRendered.set(id, Date.now());
    if (_recentRendered.size > 600) {
      var cutoff = Date.now() - CFG.RECENT_GRACE_MS;
      _recentRendered.forEach(function (ts, k) { if (ts < cutoff) _recentRendered.delete(k); });
    }
    var t = _tasks.get(id);
    if (t) t.rendered = true;
  }

  // 显式失败（可选钩子；超时兜底已覆盖绝大多数场景）
  function fail(id) {
    var t = _tasks.get(id);
    if (t) t.forced = true;
  }

  function _startPoll() {
    if (_pollTimer) return;
    var pollFn = function () {
      try { sync(window.gameWorld); } catch (e) { /* 静默：进度条绝不影响主流程 */ }
    };
    // 接入 BgThrottle：页面后台时冻结进度轮询（无模块时回退裸 setInterval）
    _pollTimer = window.BgThrottle
      ? window.BgThrottle.every('lp.poll', CFG.POLL_MS, pollFn)
      : setInterval(pollFn, CFG.POLL_MS);
  }

  // ---------- 导出 ----------
  window.LoadingProgress = {
    sync: sync,
    reportBytes: reportBytes,
    confirmRendered: confirmRendered,
    fail: fail,
    isRendered: function (id) { return _recentRendered.has(id); },
    _diag: function () {
      var arr = [];
      _tasks.forEach(function (t) {
        arr.push({
          id: t.id, name: t.obj && t.obj.name, weight: t.weight,
          bytes: t.bytes, total: t.total,
          rendered: t.rendered, forced: t.forced,
          ageMs: Date.now() - t.startedAt
        });
      });
      return { visible: _visible, displayPct: _displayPct, completedGens: _completedGens, tasks: arr };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startPoll);
  } else {
    _startPoll();
  }
})();
