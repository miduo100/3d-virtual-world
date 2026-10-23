/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * loadingPrewarm.js v1 — 加载期「着色器程序预热闸门」（2026-10-22 重建）
 *
 * 问题（实测归因）：
 *   加载期"转视角/走动就卡"的根因不是下载，而是**首次绘制时同步创建着色器程序**：
 *   three 的 program 只在该材质第一次真正 draw call 时创建 + 做 uniform 反射
 *   （ANGLE/D3D11 下单程序 50~340ms 且不可中断）。转视角把一批对象拉进视锥，
 *   它们同一帧一起首绘 → 实测单帧冻结 2939ms（+7 程序）/ 3368ms（+20 程序）。
 *
 * 做法：
 *   在 `scene.add` 处拦截——对象进场景的**当帧**就藏起来（因此本帧渲染不会给它建程序），
 *   然后按**材质**逐帧预热：每帧最多 1 个材质（≈1 个程序 ≈150ms），全部预热完立刻显示。
 *   于是单帧峰值从"一次几十个程序"压到"一个程序"，观感是"模型晚几十~几百毫秒出现"，
 *   而不是"画面死住 2~3 秒"。
 *
 * 为什么按材质而不是按对象：一个对象常含 3~5 个材质，按对象 compile 一帧连建 3~5 个程序
 * （实测 733~1204ms/帧）；按材质则每帧 1 个。
 *
 * 与已有模块的边界（不抢别人的活）：
 *   - placeholderField.reveal 已经自带"隐藏 → compileAsync → 逐程序 getUniforms"的预热，
 *     但它**只能兜住走 reveal 的路径**（本世界对象主路径）。合批/实例化批次（worldInstanceMerger）、
 *     LOD 变体替换（worldLodStandalone）、几何合批（geometryBatcher）、3DGS、threejs_code
 *     都绕开了它——这些才是"loadedDelta=0 却 +20 程序"的来源，本模块专门兜这部分。
 *   - 被 reveal 接管的对象（userData.__pendingReveal）立即放手，不重复预热。
 *   - 本地玩家自己的模型子树整体跳过（显隐由 player.updateCamera 每帧接管）。
 *   - 只有"还有未预热材质"的对象才会被藏；纯复用已有材质的对象直接放行（零观感损失）。
 *   - 加载窗口 ACTIVE_MS（25s）之后完全退出，此后行为与改动前一致。
 *
 * 诊断：window.LoadingPrewarm._diag()
 * 关闭：window.__LOADING_PREWARM_OFF = true（须在页面脚本执行前设置）或改 CFG.ENABLED
 */
(function () {
  'use strict';

  var CFG = {
    /* 【默认关闭 / 2026-10-22】开启后能把加载期"首绘同步建程序"的冻结从 ~2.9s 压到 ~1.4s，
       但它**藏起来等预热**的行为会和两个既有机制打架（实测）：
         ① LoadingProgress 的"渲染确认"靠 reveal 回调，被我们接管的对象不回调 → 进度条卡住不涨；
         ② 几何体建筑要等 reveal 之后才计入 loadedObjects → WorldReadyGate 迟迟不就绪。
       所以要先让 placeholderField / loadingProgress / worldInstanceMerger 与本模块协作
       （接管时同步 confirmRendered、几何体路径排除、批次创建交给 adopt()），再打开。
       临时启用：控制台 window.__LOADING_PREWARM_ON = true 要在脚本执行前设置，
                 或把 ENABLED 改 true 后强刷。 */
    ENABLED: false,
    ACTIVE_MS: 25000,     // 加载窗口
    ONE_PER_FRAME: true,  // 每帧只预热 1 个材质
    WARN_MS: 400          // 单材质耗时告警阈值
  };

  var startedAt = 0, lastScanAt = 0, active = true, attached = false, running = false;
  var revealWrapped = false, revealOwner = null, protoAddWrapped = false;
  var queue = [];              // [{ obj, mats:[mat], idx, t }]
  var seen = new Map();        // obj -> 上次接管时的材质签名（材质被替换后允许再次接管）
  var warmedMats = new Set();  // 「材质 × 对象特征」键
  var stats = {
    intake: 0, queued: 0, warmed: 0, shared: 0, skipped: 0, released: 0,
    mats: 0, programs: 0, texInit: 0, reIntake: 0,
    lastWarmMs: 0, maxWarmMs: 0, frames: 0, scanned: 0
  };

  /** 材质签名：用于识别"对象后来被换了材质"（LOD 借材质 / 合批替换），需要重新预热 */
  function matSig(obj) {
    var m = obj && obj.material;
    if (!m) return '';
    if (Array.isArray(m)) {
      var s = [];
      for (var i = 0; i < m.length; i++) s.push(m[i] && m[i].uuid);
      return s.join(',');
    }
    return m.uuid || '';
  }

  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
  function world() { return window.gameWorld || null; }

  var warned = {};
  function warnOnce(tag, e) {
    if (warned[tag]) return;
    warned[tag] = true;
    console.warn('[LoadingPrewarm] ' + tag + ' 异常（已忽略，仅提示一次）:', e && (e.message || e));
  }

  /** 程序键 ≈ 材质 + 对象特征（蒙皮/实例化/顶点色/点线各自生成不同 program） */
  function matKey(mat, obj) {
    return mat.uuid + '|' +
      (obj.isSkinnedMesh ? 's' : '') + (obj.isInstancedMesh ? 'i' : '') +
      (mat.vertexColors ? 'v' : '') + (obj.isPoints ? 'p' : '') + (obj.isLine ? 'l' : '');
  }

  function isRenderable(obj) {
    return !!(obj && (obj.isMesh || obj.isSkinnedMesh || obj.isPoints || obj.isLine || obj.isSprite));
  }

  function hasMaterial(obj) { return !!(obj && obj.material); }

  function inLocalPlayer(obj) {
    var root = window.player && window.player.worldObject;
    if (!root) return false;
    var cur = obj, guard = 0;
    while (cur && guard++ < 64) {
      if (cur === root) return true;
      cur = cur.parent;
    }
    return false;
  }

  function programList(renderer) {
    try {
      var ps = renderer.info.programs;
      return ps ? Array.prototype.slice.call(ps) : [];
    } catch (e) { return []; }
  }

  /** 接管单个可渲染对象：算出未预热材质 → 立即隐藏（本帧渲染就不会建程序）→ 入队 */
  function intakeOne(obj) {
    if (!active) return;
    if (!isRenderable(obj) || !hasMaterial(obj)) return;
    if (inLocalPlayer(obj)) return;
    if (obj.userData && obj.userData.__pendingReveal) return;  // reveal 已接管
    stats.intake++;
    var list = Array.isArray(obj.material) ? obj.material : [obj.material];
    var pending = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m) continue;
      if (!warmedMats.has(matKey(m, obj))) pending.push(m);
    }
    if (!pending.length) { stats.shared++; return; }           // 材质都热过 → 直接放行
    if (!obj.userData) obj.userData = {};
    obj.userData.__pwHold = true;
    obj.userData.__pendingReveal = true;   // 视锥剔除会跳过带该标记的对象
    obj.visible = false;
    queue.push({ obj: obj, mats: pending, idx: 0, t: now() });
    stats.queued++;
  }

  /** 接管一棵子树：容器（Group/合批批次根）要展开到可渲染子节点逐个处理 */
  function intakeTree(obj) {
    if (!obj) return;
    if (isRenderable(obj)) { intakeOne(obj); return; }
    if (typeof obj.traverse !== 'function') return;
    obj.traverse(function (child) {
      if (child !== obj && isRenderable(child)) intakeOne(child);
    });
  }

  /** 预热材质用到的贴图：run 时首次使用才上传显存，4K 贴图单张就是几十 ms；提前 initTexture 摊掉 */
  var warmedTex = new WeakSet();
  function warmTextures(renderer, mat) {
    if (!mat || typeof renderer.initTexture !== 'function') return;
    var keys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
      'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap', 'specularMap',
      'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap',
      'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap',
      'iridescenceThicknessMap', 'anisotropyMap'];
    for (var i = 0; i < keys.length; i++) {
      var tex = mat[keys[i]];
      if (!tex || warmedTex.has(tex)) continue;
      warmedTex.add(tex);
      try { renderer.initTexture(tex); stats.texInit++; } catch (e) { /* 单张贴图失败不影响其余 */ }
    }
  }

  /** 预热单个材质：临时改成单材质 + 可见 → compile（只建这一个程序）→ getUniforms → 还原 */
  function warmMaterial(renderer, camera, rec) {
    var obj = rec.obj;
    if (!obj || !obj.parent) return true;    // 已离场：当作完成
    var mat = rec.mats[rec.idx];
    var orig = obj.material;
    var t0 = now();
    var before = programList(renderer);
    try {
      obj.material = mat;
      obj.visible = true;                    // compile 走 traverseVisible，必须先可见
      renderer.compile(obj, camera);
      var after = programList(renderer);
      for (var i = before.length; i < after.length; i++) {
        var pr = after[i];
        if (pr && typeof pr.getUniforms === 'function') {
          try { pr.getUniforms(); } catch (e) { /* 单程序失败不影响其余 */ }
        }
      }
      stats.programs += Math.max(0, after.length - before.length);
      warmTextures(renderer, mat);           // 贴图也在这里上传掉（否则首绘仍会卡）
    } catch (e) { /* 预热失败也要让它显示 */ }
    obj.material = orig;
    var cost = now() - t0;
    stats.lastWarmMs = Math.round(cost);
    if (cost > stats.maxWarmMs) stats.maxWarmMs = Math.round(cost);
    if (cost > CFG.WARN_MS) console.warn('[LoadingPrewarm] 单材质预热耗时偏高: ' + stats.lastWarmMs + 'ms');
    rec.idx++;
    return rec.idx >= rec.mats.length;
  }

  function release(obj) {
    if (!obj) return;
    obj.visible = true;
    try {
      if (obj.userData) {
        delete obj.userData.__pendingReveal;
        delete obj.userData.__pwHold;
      }
    } catch (e) { /* ignore */ }
    stats.released++;
  }

  function drain(renderer, camera) {
    if (!queue.length) return;
    var n = CFG.ONE_PER_FRAME ? 1 : queue.length;
    while (n-- > 0 && queue.length) {
      var rec = queue[0];
      if (!rec.obj || !rec.obj.parent) { queue.shift(); continue; }
      // 期间被 placeholderField.reveal 接管的，交还给它（它会自己预热并揭示）
      if (rec.obj.userData && rec.obj.userData.__pendingReveal && rec.obj.userData.__pwHold !== true) {
        queue.shift();
        stats.skipped++;
        continue;
      }
      var done = warmMaterial(renderer, camera, rec);
      if (!done) continue;
      queue.shift();
      for (var i = 0; i < rec.mats.length; i++) {
        try { warmedMats.add(matKey(rec.mats[i], rec.obj)); } catch (e) {}
      }
      stats.warmed++;
      if (rec.obj.userData && rec.obj.userData.__pendingReveal && rec.obj.userData.__pwHold !== true) {
        // 已被 reveal 接管：保持隐藏，让它自己揭示
        stats.skipped++;
      } else {
        release(rec.obj);
      }
    }
  }

  /**
   * 兜底扫描（每 8 帧）：
   *  ① 接管"模块挂载前就已进场景"、还没处理过的对象；
   *  ② 处理"材质后来被替换"的对象（LOD 借材质 / 合批替换 → 会新建程序，必须重新预热）；
   *  ③ 给已热材质补做贴图上传（贴图是最贵的部分：实测单帧 26 张上传 = 2.9 秒冻结）。
   */
  function scan(w, t) {
    var scene = w && w.scene;
    if (!scene) return;
    lastScanAt = t || now();
    stats.scanned++;
    var renderer = w.renderer;
    scene.traverse(function (obj) {
      if (!isRenderable(obj) || !hasMaterial(obj)) return;
      if (!obj.visible) return;
      if (obj.userData && obj.userData.__pwHold === true) return;   // 已在预热队列
      if (inLocalPlayer(obj)) return;
      var sig = matSig(obj);
      var prev = seen.get(obj);
      if (prev === sig) return;                                     // 材质没变化：无需处理
      var wasKnown = (prev !== undefined);
      seen.set(obj, sig);
      if (wasKnown) stats.reIntake++;
      intakeTree(obj);
      if (renderer) {
        var list = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && warmedMats.has(matKey(list[i], obj))) warmTextures(renderer, list[i]);
        }
      }
    });
  }

  function revealAll() {
    while (queue.length) {
      var rec = queue.shift();
      if (rec && rec.obj && rec.obj.userData && rec.obj.userData.__pwHold === true) release(rec.obj);
    }
  }

  function stop() {
    active = false;
    revealAll();
    running = false;
    console.log('[LoadingPrewarm] 加载窗口结束：预热 ' + stats.warmed + ' 个对象 / ' +
      stats.programs + ' 个程序，单次最大 ' + stats.maxWarmMs + 'ms');
  }

  function tick() {
    if (!active) { running = false; return; }
    running = true;
    stats.frames++;
    var t = now();
    if (t - startedAt > CFG.ACTIVE_MS) { stop(); return; }
    var w = world();
    if (w) {
      wrapRevealPath();
      if (!attached && w.scene) hookScene(w.scene);
      if (w.renderer && w.camera) {
        hookRender(w.renderer, w);                // 主路径：render 之前扫描 + 预热
        if (stats.frames % 8 === 0) scan(w, t);   // rAF 兜底（render 未被调用时也不会停摆）
        drain(w.renderer, w.camera);
      }
    }
    requestAnimationFrame(tick);
  }

  /**
   * 关键拦截点：对象进场景的当帧即隐藏，保证它不会在本帧渲染里建程序。
   * 唯一例外 = 走 placeholderField.reveal 的对象（world._addModelToScene 主路径）：
   * 它自己会"隐藏 → 分批编译 → 逐程序反射 → 揭示"，本模块必须放手，
   * 否则把子节点藏了会让它的 compile 遍历不到（traverseVisible 遇隐即止）。
   * 通过包装 _addModelToScene 得知"这一次 add 属于 reveal 路径"（不改 world.js）。
   */
  /** 该对象此刻是否真的挂在世界场景里（GLTFLoader 组装阶段也在 add，不能接管那些） */
  function isInScene(obj) {
    var scene = window.gameWorld && window.gameWorld.scene;
    if (!scene) return false;
    var cur = obj, guard = 0;
    while (cur && guard++ < 128) {
      if (cur === scene) return true;
      cur = cur.parent;
    }
    return false;
  }

  function hookScene(scene) {
    if (attached || !scene || typeof scene.add !== 'function') return;
    /* 拦截 scene.add 不够：合批/LOD 批次是 `batchGroup.add(im)` 加到"已在场景里的 Group"上，
       scene.add 根本不会触发。所以挂到 Object3D.prototype.add 上，但只接管
       "加完之后确实已经挂在世界场景里" 的对象（否则会误伤 GLTFLoader 组装阶段的层级）。 */
    var origAdd = scene.add;
    scene.add = function () {
      var r = origAdd.apply(this, arguments);
      try {
        for (var i = 0; i < arguments.length; i++) {
          var o = arguments[i];
          if (o && revealOwner === o) continue;   // reveal 路径：交给 placeholderField
          intakeTree(o);
        }
      } catch (e) { /* 预热绝不能影响场景装配 */ }
      return r;
    };

    var THREE = window.THREE;
    if (THREE && THREE.Object3D && THREE.Object3D.prototype && !protoAddWrapped) {
      var origProtoAdd = THREE.Object3D.prototype.add;
      if (!Object.prototype.hasOwnProperty.call(origProtoAdd, '__loadingPrewarmWrapped')) {
        var patched = function () {
          var r = origProtoAdd.apply(this, arguments);
          if (active) {
            try {
              for (var i = 0; i < arguments.length; i++) {
                var o = arguments[i];
                if (!o || revealOwner === o) continue;
                if (o.userData && (o.userData.__pwHold || o.userData.__pendingReveal)) continue;
                if (!isInScene(o)) continue;      // 还没挂进世界场景（Loader 组装阶段）→ 不接管
                intakeTree(o);
              }
            } catch (e) { /* 预热绝不能影响场景装配 */ }
          }
          return r;
        };
        patched.__loadingPrewarmWrapped = true;
        THREE.Object3D.prototype.add = patched;
      }
      protoAddWrapped = true;
    }

    attached = true;
    console.log('[LoadingPrewarm] ✅ 已挂载 add 拦截（scene.add + Object3D.add，加载期逐材质预热，窗口 ' +
      Math.round(CFG.ACTIVE_MS / 1000) + 's）');
  }

  /**
   * 最关键的时序修正：把"扫描 + 预热"放到 **renderer.render 之前**。
   * 只靠 requestAnimationFrame 回调的话，我们的 tick 永远排在世界 animate（内含 render）
   * 之后 → 本帧才被换材质/点亮的对象已经画过了（程序已经在 render 里建好，冻结已发生）。
   * 包装 render 后，同一帧内先扫描预热、再绘制，才真正拦得住。
   */
  function hookRender(renderer, w) {
    if (!renderer || renderer.__pwHooked) return;
    var orig = renderer.render;
    renderer.render = function (scene, camera) {
      if (active) {
        var t = now();
        try { if (t - lastScanAt >= CFG.SCAN_MS) scan(w, t); } catch (e) { warnOnce('scan', e); }
        try { drain(this, camera || w.camera); } catch (e) { warnOnce('drain', e); }
      }
      return orig.apply(this, arguments);
    };
    renderer.__pwHooked = true;
  }

  /** 包装 World.prototype._addModelToScene：只为标出"这次 add 会被 reveal 接管" */
  function wrapRevealPath() {
    if (revealWrapped) return;
    var proto = window.World && window.World.prototype;
    if (!proto || typeof proto._addModelToScene !== 'function') return;
    var orig = proto._addModelToScene;
    proto._addModelToScene = function (obj) {
      revealOwner = obj;
      try { return orig.apply(this, arguments); }
      finally { revealOwner = null; }
    };
    revealWrapped = true;
  }

  function boot() {
    if (!(CFG.ENABLED || window.__LOADING_PREWARM_ON) || window.__LOADING_PREWARM_OFF) {
      console.log('[LoadingPrewarm] 未启用（默认关闭，见文件头说明）');
      return;
    }
    if (startedAt) return;
    startedAt = now();
    requestAnimationFrame(tick);
  }

  window.LoadingPrewarm = {
    start: boot,
    stop: function () { stop(); },
    /** 诊断：当前场景里"可见、但材质没被预热过"的对象（= 渲染时会新建程序的漏网对象） */
    _leaks: function (limit) {
      var out = [];
      var scene = window.gameWorld && window.gameWorld.scene;
      if (!scene) return out;
      scene.traverse(function (obj) {
        if (out.length >= (limit || 20)) return;
        if (!isRenderable(obj) || !hasMaterial(obj) || !obj.visible) return;
        var list = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (var i = 0; i < list.length; i++) {
          var m = list[i];
          if (m && !warmedMats.has(matKey(m, obj))) {
            out.push({ name: (obj.name || obj.type) + '#' + obj.id, mat: (m.name || m.type) + '/' + (m.uuid || '').slice(0, 6) });
            return;
          }
        }
      });
      return out;
    },
    _diag: function () {
      return {
        active: active, attached: attached, running: running,
        queue: queue.length, mats: warmedMats.size,
        intake: stats.intake, queued: stats.queued, warmed: stats.warmed,
        shared: stats.shared, skipped: stats.skipped, released: stats.released,
        programs: stats.programs, lastWarmMs: stats.lastWarmMs, maxWarmMs: stats.maxWarmMs,
        elapsedMs: startedAt ? Math.round(now() - startedAt) : 0, activeMs: CFG.ACTIVE_MS
      };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
