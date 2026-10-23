/**
 * prewarmPreview.js —— P0「加载期预热闸门」原型（实验用，不进入正式实现）
 * -------------------------------------------------------------------------
 * 目的：验证"把着色器 uniform 反射(ANGLE/D3D11 单程序 ~160ms)从首绘帧挪到受控预算内"
 *       能不能消掉 0.7~3.4 秒的单帧冻结。
 *
 * 启用：刷新后访问 http://localhost:3002/?prewarm=1
 * 也可与 ?stall=1 叠加：?stall=1&prewarm=1（同时看帧数据与预热效果）
 *
 * 控制台：
 *   __prewarm.stats()      处理进度/耗时/最大单次
 *   __prewarm.off()        立刻关闭（回落到原始加载逻辑，已入队的对象全部放行）
 *   __prewarm.on()         重新打开
 *   __prewarm.cfg          可调参数（perFrame / budgetMs / idleBudgetMs）
 *
 * 原理：
 *   ① 拦截 World.prototype._addModelToScene —— 模型仍加入场景，但先 visible=false
 *      （不做首绘 ⇒ 不会在渲染线程里触发 uniform 反射）
 *   ② 每帧按预算从队列取对象：临时 visible=true → renderer.compile(obj) →
 *      对新增的 program 逐个 getUniforms() 强制反射 → 保持可见
 *   ③ 遮罩期用大预算(180ms/帧)，撤罩后用极小预算(25ms/帧)避免影响操作
 *
 * 只影响"_addModelToScene"这一条路径，任何异常自动回落原逻辑。
 */
(function () {
  'use strict';

  if (window.__prewarm) { console.warn('[PrewarmPreview] 已安装'); return; }

  var CFG = {
    perFrame: 1,            // 每帧最多处理几个对象（v2：实测单个对象可达 400ms，必须 1 个起）
    budgetMs: 150,          // 加载遮罩期每帧预算
    idleBudgetMs: 20,       // 撤罩后每帧预算
    maxHoldMs: 8000,        // 单个对象最多被压多久（防"模型不出现"）
    maxQueue: 4000
  };

  var state = {
    on: true, queue: [], done: 0, skipped: 0,
    spentMs: 0, maxSingleMs: 0, maxFrameMs: 0,
    startedAt: performance.now(), installed: false
  };

  function now() { return performance.now(); }

  // 遮罩是否还盖着（盖着时预热用户看不见，可以放大预算）
  function masked() {
    try {
      var lm = window.LoadingMask;
      if (lm && typeof lm.isFastEntry === 'function' && lm.isFastEntry()) return false;
      var m = document.getElementById('loadingMask');
      if (!m) return false;
      var cs = getComputedStyle(m);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05;
    } catch (e) { return false; }
  }

  // 强制反射：compile 只链接不读 uniform，必须对新增 program 调 getUniforms()
  function reflectNewPrograms(renderer, before) {
    var progs = (renderer.info && renderer.info.programs) || null;
    if (!progs) return 0;
    var n = 0;
    for (var i = before; i < progs.length; i++) {
      var p = progs[i];
      if (p && typeof p.getUniforms === 'function') {
        try { p.getUniforms(); n++; } catch (e) {}
      }
    }
    return n;
  }

  function warmOne(item) {
    var obj = item.obj, w = item.world;
    var r = w.renderer, cam = w.camera, scene = w.scene;
    if (!obj || !obj.parent) return;

    var t0 = now();
    var before = (r.info && r.info.programs) ? r.info.programs.length : 0;

    // compile 用 traverseVisible，必须临时可见才能被遍历到。
    // 本函数与渲染同处一次任务内，中间不会插入绘制，故不会误首绘。
    obj.visible = true;
    try { obj.updateWorldMatrix(true, true); } catch (e) {}
    try { r.compile(obj, cam, scene); } catch (e) {}
    reflectNewPrograms(r, before);

    var ms = now() - t0;
    state.spentMs += ms;
    state.done++;
    if (ms > state.maxSingleMs) state.maxSingleMs = ms;

    // 与 reveal 路径等价的后处理：收占位方块 + 渲染确认
    var ud = obj.userData || {};
    var wid = ud.worldObjectId;
    if (wid !== undefined && wid !== null) {
      try { if (window.PlaceholderField) window.PlaceholderField.fadeOutAndHide(wid); } catch (e) {}
      try { if (window.LoadingProgress) window.LoadingProgress.confirmRendered(wid); } catch (e) {}
    }
    ud.__pwPending = false;
  }

  function pump() {
    requestAnimationFrame(pump);
    if (!state.on || state.queue.length === 0) return;

    var budget = masked() ? CFG.budgetMs : CFG.idleBudgetMs;
    var frameStart = now();
    var n = 0;
    while (state.queue.length && n < CFG.perFrame) {
      if (now() - frameStart >= budget) break;
      // 压太久的对象强制放行，避免"模型一直不出现"
      var head = state.queue[0];
      if (head && (now() - head.at) > CFG.maxHoldMs) { state.queue.shift(); warmOne(head); state.skipped++; break; }
      var t1 = now();
      warmOne(state.queue.shift());
      n++;
      if (now() - t1 > budget) break;   // 单个就超预算：本帧立刻收手
    }
    var fm = now() - frameStart;
    if (fm > state.maxFrameMs) state.maxFrameMs = fm;
  }

  // ---------------- 拦截 _addModelToScene ----------------
  var origAdd = null;

  function install() {
    var W = window.World;
    if (!W || !W.prototype || typeof W.prototype._addModelToScene !== 'function') return false;
    if (W.prototype._addModelToScene.__pw) return true;

    origAdd = W.prototype._addModelToScene;
    W.prototype._addModelToScene = function (obj) {
      if (!state.on || !obj || state.queue.length > CFG.maxQueue) {
        return origAdd.call(this, obj);
      }
      try {
        // 复刻原逻辑的前半段（去蒙皮 + 入场景 + 时间戳），但先隐藏、不 reveal
        if (typeof this._bakeSkinsToStatic === 'function') this._bakeSkinsToStatic(obj);
        this.scene.add(obj);
        obj.userData = obj.userData || {};
        obj.userData.__addedAt = now();
        obj.userData.__pwPending = true;
        obj.visible = false;
        state.queue.push({ obj: obj, world: this, at: now() });
        // 进度条口径不变：数据已就绪就确认，避免"卡 28%"那类回归
        var wid = obj.userData.worldObjectId;
        if (wid !== undefined && wid !== null && window.LoadingProgress) {
          try { window.LoadingProgress.confirmRendered(wid); } catch (e) {}
        }
        return undefined;
      } catch (e) {
        console.warn('[PrewarmPreview] 拦截异常，回落原逻辑:', e && e.message);
        try { obj.visible = true; } catch (e2) {}
        return origAdd.call(this, obj);
      }
    };
    W.prototype._addModelToScene.__pw = 1;
    state.installed = true;
    console.log('%c[PrewarmPreview] 预热闸门已接管 _addModelToScene（每帧预算 ' + CFG.budgetMs + 'ms 遮罩期 / ' + CFG.idleBudgetMs + 'ms 撤罩后）', 'color:#0a0;font-weight:bold');
    return true;
  }

  // 轮询安装（World 定义晚于本脚本）
  var installTimer = setInterval(function () {
    if (install()) { clearInterval(installTimer); installTimer = null; }
  }, 100);
  install();
  requestAnimationFrame(pump);

  window.__prewarm = {
    cfg: CFG,
    stats: function () {
      var elapsed = (now() - state.startedAt) / 1000;
      var s = {
        installed: state.installed,
        on: state.on,
        queued: state.queue.length,
        warmed: state.done,
        spentMs: Math.round(state.spentMs),
        avgMs: state.done ? +(state.spentMs / state.done).toFixed(1) : 0,
        maxSingleMs: Math.round(state.maxSingleMs),
        maxFrameMs: Math.round(state.maxFrameMs),
        elapsedSec: +elapsed.toFixed(1)
      };
      console.log('[PrewarmPreview] ' + JSON.stringify(s));
      return s;
    },
    off: function () {
      state.on = false;
      // 放行残留：全部显示（不影响渲染）
      var rel = 0;
      while (state.queue.length) {
        var it = state.queue.shift();
        try { it.obj.visible = true; } catch (e) {}
        rel++;
      }
      console.log('[PrewarmPreview] 已关闭，放行残留 ' + rel + ' 个对象');
      return rel;
    },
    on: function () { state.on = true; console.log('[PrewarmPreview] 已开启'); }
  };
})();
