/**
 * StallProbe v1 —— 只读卡顿归因探针（主世界 / 世界编辑器通用）
 * ------------------------------------------------------------------
 * 用途：找出"到底卡在哪一帧、那一帧在干什么"。
 *   逐帧记录：帧间隔 / draw call / 三角 / 程序数 / 纹理数 / 几何数
 *   长帧自动快照：当时渲染统计 + 前 1.2 秒内的热点函数耗时 + 玩家位置朝向
 *   Long Task 观察：浏览器侧任务粒度
 *   报告自动给结论：着色器编译 / 纹理上传 / 渲染提交 / 模型解析 / 环境问题
 *
 * 控制台安装（一行）：
 *   fetch('/js/stallProbe.js?t=' + Date.now()).then(r => r.text()).then(t => eval(t))
 *
 * 命令：
 *   __stall.help()
 *   __stall.mark('转视角')    可选打点
 *   __stall.report()          出报告（复制发人）
 *   __stall.dump()            返回纯文本报告（配合 copy(__stall.dump())）
 *   __stall.reset()           清空样本重来
 *   __stall.uninstall()       卸载全部计时壳
 *
 * 只读：不改变任何游戏逻辑，仅在原函数外层加 try/finally 计时壳，返回值原样透传。
 */
(function () {
  'use strict';

  if (window.__stall && window.__stall.__installed) {
    console.warn('[StallProbe] 已安装 ' + window.__stall.version + '。重装请先 __stall.uninstall()');
    return;
  }

  var CFG = {
    version: 'v1',
    longMs: 50,            // 长帧阈值
    maxFrames: 40000,
    maxLong: 600,
    maxEv: 6000,
    evLookBackMs: 1200,    // 长帧归因回看窗口
    suspendMs: 10000,      // 超过此帧间隔视为后台挂起/系统休眠，不计入统计
    windowMs: 5000,        // 报告分段窗口
    installRetryMs: 500,
    installMaxMs: 180000
  };

  var perf = (window.performance && performance.now) ? function () { return performance.now(); } : function () { return Date.now(); };
  var nowWall = function () { return Date.now(); };

  // ---------------- 采样容器 ----------------
  var frames = [];        // {t,dt,calls,tris,progs,texs,geoms,dProg,dTex,dGeo,suspend}
  var longFrames = [];
  var evs = [];           // {t,name,ms}
  var marks = [];         // {t,label}
  var longTasks = [];     // {start,dur,name}
  var installed = {};
  var rendererRef = null;
  var startAt = perf();
  var seen = { progs: 0, texs: 0, geoms: 0 };
  var evDropped = 0;
  var frameDropped = 0;

  function pushEv(name, ms) {
    evs.push({ t: perf(), name: name, ms: ms });
    if (evs.length > CFG.maxEv) { evs.splice(0, 2000); evDropped += 2000; }
  }

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }

  // ---------------- 环境信息 ----------------
  function getGameWorld() {
    try { if (typeof gameWorld !== 'undefined' && gameWorld) return gameWorld; } catch (e) {}
    return window.gameWorld || null;
  }

  function gpuName() {
    try {
      var r = rendererRef || (getGameWorld() && getGameWorld().renderer);
      var gl = r && r.getContext && r.getContext();
      if (!gl) return null;
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    } catch (e) { return null; }
  }

  function playerInfo() {
    var g = getGameWorld();
    var p = window.player || (g && g.player) || null;
    var pos = null, yaw = null;
    if (p && p.position) pos = [r2(num(p.position.x)), r2(num(p.position.y)), r2(num(p.position.z))];
    var cam = (g && g.camera) || window.camera;
    if (cam) {
      try {
        var d = cam.getWorldDirection(new (window.THREE ? THREE.Vector3 : Object)());
        yaw = r1(Math.atan2(d.x, d.z) * 180 / Math.PI);
      } catch (e) {
        if (cam.rotation) yaw = r1(num(cam.rotation.y) * 180 / Math.PI);
      }
    }
    return { pos: pos, yaw: yaw };
  }

  function sceneStats() {
    var g = getGameWorld();
    var out = { objects: null, buildings: null, players: null, queue: null };
    try {
      if (g) {
        if (g.scene && g.scene.children) out.objects = g.scene.children.length;
        if (g.generatedBuildings && g.generatedBuildings.size !== undefined) out.buildings = g.generatedBuildings.size;
        if (g.players && g.players.size !== undefined) out.players = g.players.size;
        if (g.loadingQueue && g.loadingQueue.length !== undefined) out.queue = g.loadingQueue.length;
      }
    } catch (e) {}
    return out;
  }

  // ---------------- 计时壳 ----------------
  function wrap(obj, name, label, opts) {
    opts = opts || {};
    if (!obj || typeof obj[name] !== 'function') return false;
    if (obj[name].__sp) return false;
    var orig = obj[name];
    var wrapper = function () {
      var t0 = perf();
      var ret;
      try {
        ret = orig.apply(this, arguments);
      } catch (err) {
        pushEv(label, perf() - t0);
        throw err;
      }
      pushEv(label, perf() - t0);
      if (opts.trackAsync && ret && typeof ret.then === 'function') {
        var t1 = perf();
        ret.then(function (v) { pushEv(label + '#async', perf() - t1); return v; },
                 function (e) { pushEv(label + '#async', perf() - t1); throw e; });
      }
      return ret;
    };
    wrapper.__sp = 1;
    obj[name] = wrapper;
    installed[label] = (installed[label] || 0) + 1;
    return true;
  }

  var installTimer = null, installStart = 0;

  function tryInstall() {
    var g = getGameWorld();

    if (g && g.renderer && rendererRef !== g.renderer) {
      rendererRef = g.renderer;
      if (wrap(g.renderer, 'render', 'renderer.render')) {
        wrap(g.renderer, 'compile', 'renderer.compile');
        wrap(g.renderer, 'compileAsync', 'renderer.compileAsync', { trackAsync: true });
        console.log('[StallProbe] renderer 计时已挂载');
      }
    }

    // World 原型方法（对已创建与后续实例都生效）
    var W = window.World;
    if (W && W.prototype) {
      ['updateObjectLoading', 'processLoadingQueue', 'updateFrustumCulling',
       'unloadObject', '_addModelToScene', 'addThreeJSModel', 'loadModelWithRealProgress']
        .forEach(function (n) {
          wrap(W.prototype, n, 'World.' + n, { trackAsync: n === 'loadModelWithRealProgress' });
        });
    } else if (g) {
      ['updateObjectLoading', 'processLoadingQueue', 'updateFrustumCulling',
       'unloadObject', '_addModelToScene', 'addThreeJSModel']
        .forEach(function (n) { wrap(g, n, 'World.' + n); });
    }

    // 加载相关模块
    if (window.GltfWorkerClient && typeof window.GltfWorkerClient.parseBuffer === 'function') {
      wrap(window.GltfWorkerClient, 'parseBuffer', 'GltfWorkerClient.parseBuffer', { trackAsync: true });
    }
    if (window.GeometryBatcher) {
      wrap(window.GeometryBatcher, 'tryBatch', 'GeometryBatcher.tryBatch');
      wrap(window.GeometryBatcher, 'rebatchAll', 'GeometryBatcher.rebatchAll');
    }
    if (window.WorldInstanceMerger) {
      wrap(window.WorldInstanceMerger, 'tryMerge', 'Merger.tryMerge');
      wrap(window.WorldInstanceMerger, 'scanAndMerge', 'Merger.scanAndMerge');
    }
    if (window.PlaceholderField) {
      wrap(window.PlaceholderField, 'reveal', 'PlaceholderField.reveal', { trackAsync: true });
    }
    if (window.WorldLodStandalone) {
      wrap(window.WorldLodStandalone, 'runFrame', 'LodStandalone.runFrame');
    }

    // 编辑器页（window 上的函数声明）
    ['updateRangeLoading', 'pumpGlbParse', 'updateRightPropsPanel', 'refreshPropsPanels',
     'loadGlbModel', 'processGlbQueue', 'loadWorldObjects', 'renderFromComponents']
      .forEach(function (n) {
        if (typeof window[n] === 'function') wrap(window, n, n, { trackAsync: n === 'loadGlbModel' });
      });

    // 慢请求
    if (window.fetch && !window.fetch.__sp) {
      var of = window.fetch;
      var wf = function () {
        var t0 = perf(), url = '';
        try { url = String(arguments[0] && arguments[0].url ? arguments[0].url : arguments[0]); } catch (e) {}
        var p = of.apply(this, arguments);
        if (p && p.then) {
          p.then(function () {
            var ms = perf() - t0;
            if (ms > 300) pushEv('fetch ' + r1(ms) + 'ms ' + url.slice(-60), 0);
          }, function () {});
        }
        return p;
      };
      wf.__sp = 1;
      window.fetch = wf;
      installed['window.fetch'] = 1;
    }

    var n = Object.keys(installed).length;
    if (n > 0 && perf() - installStart > 2000) {
      // 稳定挂上后降低轮询频率
    }
  }

  // ---------------- 帧循环 ----------------
  var lastT = perf();
  function tick() {
    var t = perf();
    var dt = t - lastT;
    lastT = t;

    var r = rendererRef;
    var f = { t: t, dt: dt, calls: 0, tris: 0, progs: 0, texs: 0, geoms: 0, dProg: 0, dTex: 0, dGeo: 0, suspend: 0 };
    if (r && r.info) {
      try {
        f.calls = r.info.render.calls | 0;
        f.tris = r.info.render.triangles | 0;
        f.progs = r.info.programs ? r.info.programs.length : 0;
        f.texs = r.info.memory.textures | 0;
        f.geoms = r.info.memory.geometries | 0;
        f.dProg = f.progs - seen.progs;
        f.dTex = f.texs - seen.texs;
        f.dGeo = f.geoms - seen.geoms;
        seen.progs = f.progs; seen.texs = f.texs; seen.geoms = f.geoms;
      } catch (e) {}
    }

    if (dt > CFG.suspendMs) f.suspend = 1;

    frames.push(f);
    if (frames.length > CFG.maxFrames) { frames.splice(0, 5000); frameDropped += 5000; }

    if (!f.suspend && dt >= CFG.longMs) recordLong(f);

    requestAnimationFrame(tick);
  }

  function nearestMark(t) {
    for (var i = marks.length - 1; i >= 0; i--) {
      if (marks[i].t <= t) return marks[i].label + ' +' + r1((t - marks[i].t) / 1000) + 's';
    }
    return null;
  }

  function recordLong(f) {
    var since = f.t - CFG.evLookBackMs;
    var rel = [];
    for (var i = evs.length - 1; i >= 0; i--) {
      if (evs[i].t < since) break;
      rel.push(evs[i]);
    }
    rel.reverse();

    var aggr = {};
    rel.forEach(function (e) { aggr[e.name] = (aggr[e.name] || 0) + e.ms; });
    var top = Object.keys(aggr).sort(function (a, b) { return aggr[b] - aggr[a]; }).slice(0, 5)
      .map(function (k) { return k + ' ' + Math.round(aggr[k]) + 'ms'; });

    var pi = playerInfo();
    longFrames.push({
      t: f.t, dt: r1(f.dt), calls: f.calls, tris: f.tris,
      progs: f.progs, texs: f.texs, geoms: f.geoms,
      dProg: f.dProg, dTex: f.dTex, dGeo: f.dGeo,
      pos: pi.pos, yaw: pi.yaw,
      top: top, mark: nearestMark(f.t),
      ev: rel.slice(-12).map(function (e) { return e.name + ':' + Math.round(e.ms); })
    });
    if (longFrames.length > CFG.maxLong) longFrames.shift();
  }

  // ---------------- Long Task ----------------
  var ltSupported = false;
  try {
    if (window.PerformanceObserver) {
      var po = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (en) {
          longTasks.push({ start: en.startTime, dur: r1(en.duration), name: en.name || 'task' });
        });
        if (longTasks.length > 400) longTasks.splice(0, 200);
      });
      try { po.observe({ type: 'longtask', buffered: true }); }
      catch (e1) { po.observe({ entryTypes: ['longtask'] }); }
      ltSupported = true;
    }
  } catch (e) {}

  // ---------------- 统计 ----------------
  function pct(arr, p) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var i = Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)));
    return a[i];
  }

  function liveFrames() {
    return frames.filter(function (f) { return !f.suspend; });
  }

  function segments(list) {
    if (!list.length) return [];
    var t0 = list[0].t, out = [], cur = null;
    list.forEach(function (f) {
      var k = Math.floor((f.t - t0) / CFG.windowMs);
      if (!cur || cur.k !== k) {
        cur = { k: k, from: (k * CFG.windowMs / 1000).toFixed(0), dts: [], long: 0, calls: [], dProg: 0, dTex: 0, dGeo: 0, max: 0 };
        out.push(cur);
      }
      cur.dts.push(f.dt);
      if (f.dt >= CFG.longMs) cur.long++;
      if (f.dt > cur.max) cur.max = f.dt;
      cur.calls.push(f.calls);
      cur.dProg += f.dProg; cur.dTex += f.dTex; cur.dGeo += f.dGeo;
    });
    return out;
  }

  // ---------------- 结论 ----------------
  function diagnose(list, eAgg) {
    var out = [];
    if (!list.length) { out.push('样本为空：请先操作复现卡顿再 report()'); return out; }
    var dur = (list[list.length - 1].t - list[0].t) / 1000;
    var longN = list.filter(function (f) { return f.dt >= CFG.longMs; }).length;
    var longRate = longN / list.length;

    var longWithProg = 0, longWithTex = 0, longNoHint = 0;
    longFrames.forEach(function (lf) {
      var hit = false;
      if (lf.dProg > 0) { longWithProg++; hit = true; }
      if (lf.dTex > 0) { longWithTex++; hit = true; }
      if (!hit) longNoHint++;
    });

    var topEv = Object.keys(eAgg).sort(function (a, b) { return eAgg[b].total - eAgg[a].total; })[0];
    var renderShare = eAgg['renderer.render'] ? eAgg['renderer.render'].total / Math.max(1, dur * 1000) : 0;

    if (longRate < 0.02 && longN < 5) {
      out.push('长帧很少：这段时间基本不卡（长帧 ' + longN + ' 个 / ' + list.length + ' 帧），可能没复现到，请对准最卡的场景再采一次。');
    }
    if (longWithProg >= Math.max(2, longFrames.length * 0.4)) {
      out.push('主因疑似【着色器程序编译】：' + longWithProg + '/' + longFrames.length + ' 个长帧期间 程序数(+dProg) 增加 → 新材质首帧编译（D3D 单程序可达 50~300ms），属"新对象/新材质第一次进入视野"。');
    }
    if (longWithTex >= Math.max(2, longFrames.length * 0.4)) {
      out.push('主因疑似【纹理上传】：' + longWithTex + '/' + longFrames.length + ' 个长帧期间 纹理数(+dTex) 增加 → GPU 上传贴图（大图/4K 首见）。');
    }
    if (longNoHint >= Math.max(2, longFrames.length * 0.5)) {
      out.push('多数长帧期间 程序数/纹理数 都没变化 → 不是首帧编译：看下面"热点函数"哪一项耗时高。');
    }
    var longNoEvent = longFrames.filter(function (lf) { return !lf.ev || lf.ev.length === 0; }).length;
    if (longNoEvent >= 2) {
      out.push('有 ' + longNoEvent + ' 个长帧期间我们没捕捉到任何 JS 事件（连 renderer.render 都没跑）→ 主线程被"看不见的东西"占住：GC / 浏览器合成光栅化 / GPU 阻塞 / 其它扩展脚本。这类帧请关掉 DevTools、换干净 Chrome 复测对比。');
    }
    if (renderShare > 0.6) {
      out.push('renderer.render 占用 ' + (renderShare * 100).toFixed(0) + '% 墙钟时间 → 渲染提交本身是瓶颈（draw call / 三角过多），看长帧里的 calls 与 tris。');
    }
    var loadEv = ['World.updateObjectLoading', 'World.processLoadingQueue', 'GltfWorkerClient.parseBuffer',
                  'GltfWorkerClient.parseBuffer#async', 'loadGlbModel', 'pumpGlbParse', 'updateRangeLoading']
      .filter(function (k) { return eAgg[k] && eAgg[k].total > 300; });
    if (loadEv.length) {
      out.push('加载链耗时显著：' + loadEv.map(function (k) { return k + ' ' + Math.round(eAgg[k].total) + 'ms'; }).join('、') + ' → 主线程在解析/组装模型。');
    }
    if (topEv) out.push('耗时第一的热点函数：' + topEv + '（合计 ' + Math.round(eAgg[topEv].total) + 'ms，最大单次 ' + eAgg[topEv].max + 'ms）');
    return out;
  }

  // ---------------- 报告 ----------------
  function buildReport() {
    var all = frames.slice();
    var list = liveFrames();
    var dur = list.length ? (list[list.length - 1].t - list[0].t) / 1000 : 0;
    var dts = list.map(function (f) { return f.dt; });
    var g = getGameWorld();
    var ss = sceneStats();

    var eAgg = {};
    evs.forEach(function (e) {
      var a = eAgg[e.name] || (eAgg[e.name] = { count: 0, total: 0, max: 0, list: [] });
      a.count++; a.total += e.ms; if (e.ms > a.max) a.max = e.ms; a.list.push(e.ms);
    });
    Object.keys(eAgg).forEach(function (k) { eAgg[k].p95 = r1(pct(eAgg[k].list, 0.95)); delete eAgg[k].list; });

    var L = [];
    L.push('===== StallProbe ' + CFG.version + ' 报告 =====');
    L.push('页面: ' + location.href);
    L.push('UA: ' + navigator.userAgent);
    L.push('GPU: ' + (gpuName() || '(取不到)') + ' | DPR=' + (window.devicePixelRatio || 1) + ' | 视口=' + innerWidth + 'x' + innerHeight);
    L.push('采样时长: ' + r1(dur) + 's | 有效帧: ' + list.length + ' | 挂起帧(后台/休眠): ' + (frames.length - list.length) + ' | 被丢弃旧帧: ' + frameDropped);
    L.push('当前: calls=' + (rendererRef && rendererRef.info ? rendererRef.info.render.calls : '?') +
      ' tris=' + (rendererRef && rendererRef.info ? rendererRef.info.render.triangles : '?') +
      ' progs=' + (rendererRef && rendererRef.info && rendererRef.info.programs ? rendererRef.info.programs.length : '?') +
      ' texs=' + (rendererRef && rendererRef.info ? rendererRef.info.memory.textures : '?') +
      ' geoms=' + (rendererRef && rendererRef.info ? rendererRef.info.memory.geometries : '?'));
    L.push('场景: 顶层children=' + ss.objects + ' 已登记对象=' + ss.buildings + ' players=' + ss.players + ' 加载队列=' + ss.queue);
    if (window.performance && performance.memory) {
      L.push('JSHeap: ' + r1(performance.memory.usedJSHeapSize / 1048576) + 'MB');
    }
    L.push('已挂载计时: ' + Object.keys(installed).join(', '));
    L.push('');

    L.push('-- 帧时间 --');
    L.push('p50=' + r1(pct(dts, 0.5)) + 'ms p90=' + r1(pct(dts, 0.9)) + 'ms p95=' + r1(pct(dts, 0.95)) +
      'ms p99=' + r1(pct(dts, 0.99)) + 'ms max=' + r1(pct(dts, 0.999)) + 'ms');
    L.push('长帧(>=' + CFG.longMs + 'ms): ' + dts.filter(function (d) { return d >= CFG.longMs; }).length +
      ' | >100ms: ' + dts.filter(function (d) { return d >= 100; }).length +
      ' | >200ms: ' + dts.filter(function (d) { return d >= 200; }).length +
      ' | >500ms: ' + dts.filter(function (d) { return d >= 500; }).length);
    L.push('');

    L.push('-- 按 ' + (CFG.windowMs / 1000) + 's 分段（找最卡的一段）--');
    L.push('段起(s)\t帧数\t平均\tsharp50\t最长\t长帧数\tΔprog\tΔtex\tΔgeo\t平均calls');
    segments(list).forEach(function (s) {
      L.push(s.from + '\t' + s.dts.length + '\t' + r1(s.dts.reduce(function (a, b) { return a + b; }, 0) / s.dts.length) +
        '\t' + r1(pct(s.dts, 0.5)) + '\t' + r1(s.max) + '\t' + s.long + '\t' + s.dProg + '\t' + s.dTex + '\t' + s.dGeo +
        '\t' + Math.round(s.calls.reduce(function (a, b) { return a + b; }, 0) / s.calls.length));
    });
    L.push('');

    L.push('-- 最长 ' + Math.min(12, longFrames.length) + ' 帧明细 --');
    var topL = longFrames.slice().sort(function (a, b) { return b.dt - a.dt; }).slice(0, 12);
    topL.forEach(function (f, i) {
      L.push('#' + (i + 1) + ' dt=' + f.dt + 'ms calls=' + f.calls + ' tris=' + f.tris +
        ' +prog=' + f.dProg + ' +tex=' + f.dTex + ' +geo=' + f.dGeo +
        ' pos=' + (f.pos ? f.pos.join(',') : '?') + ' yaw=' + f.yaw +
        (f.mark ? ' | 打点: ' + f.mark : ''));
      L.push('    前1.2s热点: ' + (f.top && f.top.length ? f.top.join(' | ') : '(无)'));
      L.push('    事件序列: ' + (f.ev && f.ev.length ? f.ev.join(' → ') : '(无)'));
    });
    L.push('');

    L.push('-- 热点函数聚合（全时段）--');
    L.push('名称\t次数\t合计ms\t最大ms\tp95ms\t占墙钟');
    Object.keys(eAgg).sort(function (a, b) { return eAgg[b].total - eAgg[a].total; }).slice(0, 20).forEach(function (k) {
      var isAsync = k.indexOf('#async') >= 0;
      L.push(k + '\t' + eAgg[k].count + '\t' + Math.round(eAgg[k].total) + '\t' + r1(eAgg[k].max) + '\t' + eAgg[k].p95 +
        '\t' + (isAsync ? '异步等待(不占主线程)' : r1(eAgg[k].total / Math.max(1, dur * 1000) * 100) + '%'));
    });
    if (evDropped) L.push('(事件环形缓冲溢出丢弃 ' + evDropped + ' 条)');
    L.push('');

    if (ltSupported) {
      L.push('-- Long Task (浏览器主线程任务) --');
      var lt = longTasks.slice().sort(function (a, b) { return b.dur - a.dur; }).slice(0, 10);
      L.push('共 ' + longTasks.length + ' 个; 最长: ' + (lt.length ? lt.map(function (x) { return x.dur + 'ms' + (x.name && x.name !== 'self' ? '(' + x.name + ')' : ''); }).join(', ') : '无'));
      L.push('');
    }

    L.push('-- 自动结论 --');
    diagnose(list, eAgg).forEach(function (s) { L.push('· ' + s); });
    L.push('');
    L.push('提示: copy(__stall.dump()) 可把本报告复制到剪贴板。');

    return { text: L.join('\n'), eAgg: eAgg, longFrames: longFrames, frames: all };
  }

  function report() {
    var r = buildReport();
    console.log(r.text);
    if (r.longFrames.length) {
      console.log('%c[StallProbe] 长帧明细表', 'color:#0a0;font-weight:bold');
      console.table(r.longFrames.slice().sort(function (a, b) { return b.dt - a.dt; }).slice(0, 15).map(function (f) {
        return { dt: f.dt, calls: f.calls, tris: f.tris, dProg: f.dProg, dTex: f.dTex,
                 pos: f.pos ? f.pos.join(',') : '', yaw: f.yaw, 归因: (f.top || []).join(' | ') };
      }));
    }
    return r.text;
  }

  // ---------------- 对外 API ----------------
  window.__stall = {
    __installed: true,
    version: CFG.version,
    help: function () {
      console.log([
        '[StallProbe] 命令：',
        '  __stall.mark("标签")   打点（配合长帧明细看"卡在哪个操作后"）',
        '  __stall.report()       打印报告',
        '  copy(__stall.dump())   复制报告到剪贴板',
        '  __stall.reset()        清空样本重新开始',
        '  __stall.uninstall()    卸载全部计时壳',
        '  __stall.cfg            查看/修改阈值（如 __stall.cfg.longMs = 80）'
      ].join('\n'));
      return 'ok';
    },
    mark: function (label) {
      var t = perf();
      marks.push({ t: t, label: String(label || 'mark') });
      if (marks.length > 200) marks.shift();
      console.log('[StallProbe] 打点 ' + label);
      return 'ok';
    },
    report: report,
    dump: function () { return buildReport().text; },
    reset: function () {
      frames = []; longFrames = []; evs = []; marks = []; longTasks = []; evDropped = 0; frameDropped = 0;
      seen = { progs: 0, texs: 0, geoms: 0 }; startAt = perf();
      console.log('[StallProbe] 样本已清空');
      return 'ok';
    },
    uninstall: function () {
      if (installTimer) { clearInterval(installTimer); installTimer = null; }
      window.__stall = undefined;
      console.log('[StallProbe] 已卸载（计时壳保留到本次页面刷新；刷新后彻底恢复）');
      return 'ok';
    },
    cfg: CFG
  };

  // ---------------- 启动 ----------------
  installStart = perf();
  tryInstall();
  installTimer = setInterval(function () {
    tryInstall();
    if (perf() - installStart > CFG.installMaxMs) { clearInterval(installTimer); installTimer = null; }
  }, CFG.installRetryMs);
  requestAnimationFrame(tick);

  console.log('%c[StallProbe ' + CFG.version + '] 已开始记录', 'color:#0a0;font-weight:bold');
  console.log('  操作复现卡顿 → __stall.report() → copy(__stall.dump()) 把报告发出来');
  console.log('  已挂载: ' + Object.keys(installed).join(', ') + (Object.keys(installed).length ? '' : '(renderer 尚未创建，自动重试中)'));
})();
