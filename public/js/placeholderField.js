/**
 * placeholderField.js — 全图占位方块场（InstancedMesh 版）
 * ------------------------------------------------------------------
 * 背景（2026-09-05 卡顿治理）：
 *   旧占位符每个对象独立 new BoxGeometry + MeshStandardMaterial + 名字标签
 *   Sprite + 进度 Sprite，全图 400+ 个占位符 = 1200+ draw call / 800+ 张
 *   CanvasTexture，占位符自身成为卡顿源。
 *
 * 本模块提供：
 *   1. show(id, x, y, z)   —— 全部占位方块共用 1 个 InstancedMesh（1 draw call），
 *                             共享几何体与材质，实例矩阵按需开关（scale=0 隐藏）
 *   2. fadeOutAndHide(id)  —— 渐缩消失（250ms），替代"删盒子/上模型"的硬切换
 *   3. reveal(obj)         —— 真模型进场景后先隐藏 → renderer.compile 预热着色器
 *                             → 下一帧再显示，消除"模型先白闪一下再正常"的观感
 *   4. hideAfterRevealOrTimeout —— 模型确认可见后再渐缩占位方块（600ms 兜底）
 *
 * 依赖：window.THREE（在 three.min.js 之后加载）
 * 挂载：window.PlaceholderField
 */
(function (global) {
  'use strict';

  var THREE = global.THREE;

  // ===== 可调参数 =====
  var BOX_W = 5, BOX_H = 6, BOX_D = 5;      // 占位方块尺寸（与旧版一致）
  var BOX_Y_OFFSET = 3;                      // 盒子中心相对对象锚点抬高（与旧版一致）
  var MAX_INSTANCES = 2000;                  // 实例容量（world_objects 全图 + 增量余量）
  var FADE_MS = 250;                         // 渐缩时长
  var REVEAL_TIMEOUT_MS = 5000;              // "模型可见后再藏盒子"的兜底超时
                                             // （2026-09-09 从 600ms 提高：超多 mesh 模型预热可能达数秒，
                                             //   盒子提前收掉会留下一片空白，反而更像"模型没加载"）

  // —— 预热批编译参数（2026-09-09）——
  // 旧实现"每帧只编译 1 个 mesh"对多 mesh 模型是灾难：world_objects id=8392
  //（model-1788498327710-939035107_dec.glb）2784 mesh / 仅 100 材质，逐 mesh 分帧
  // = 2784 帧 ≈ 40~50 秒才显现。故改为：批编译 + 批大小自适应 + 单模型总时长上限。
  var MIN_CHUNK = 8;                         // 每批最小 mesh 数
  var MAX_CHUNK = 1024;                      // 每批最大 mesh 数
  var BUDGET_MS = 60;                        // 单批耗时预算（超预算则缩小批）
  var REVEAL_MAX_MS = 5000;                  // 单模型预热总时长上限：超时先显示、后台继续编译
  var adaptiveChunk = MIN_CHUNK;             // 自适应批大小（跨模型保留经验值）

  // ===== 状态 =====
  var mesh = null;                 // InstancedMesh
  var idToIndex = new Map();       // worldObjectId -> instance index
  var freeIndices = [];            // 可复用的实例槽位
  var nextIndex = 0;
  var fadeAnims = new Map();       // index -> { start, onDone }
  var rafRunning = false;
  var pendingReveal = [];          // 等待预热显示的模型
  var revealScheduled = false;

  // ===== 内部：实例矩阵工具 =====
  var _m = null, _q = null, _v = null, _s = null, _zero = null;

  function ensureMath() {
    if (!_m) {
      _m = new THREE.Matrix4();
      _q = new THREE.Quaternion();
      _v = new THREE.Vector3();
      _s = new THREE.Vector3();
      _zero = new THREE.Vector3(0, 0, 0);
    }
  }

  function setInstanceMatrix(index, x, y, z, scale) {
    ensureMath();
    _v.set(x, y + BOX_Y_OFFSET, z);
    _s.set(scale, scale, scale);
    _m.compose(_v, _q.identity(), _s);
    mesh.setMatrixAt(index, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ===== 内部：渐缩动画循环（只在有动画时跑） =====
  function tickFades() {
    if (fadeAnims.size === 0) { rafRunning = false; return; }
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var done = [];
    fadeAnims.forEach(function (anim, index) {
      var t = Math.min((now - anim.start) / FADE_MS, 1);
      var scale = (1 - t) * 1.0; // 1 → 0
      // 保持该实例位置：从记录的锚点重设矩阵
      setInstanceMatrix(index, anim.x, anim.y, anim.z, scale);
      if (t >= 1) done.push(index);
    });
    for (var i = 0; i < done.length; i++) {
      var idx = done[i];
      var anim = fadeAnims.get(idx);
      fadeAnims.delete(idx);
      releaseIndex(idx);
      if (anim.onDone) { try { anim.onDone(); } catch (e) {} }
    }
    if (fadeAnims.size > 0) requestAnimationFrame(tickFades);
    else rafRunning = false;
  }

  function startFadeLoop() {
    if (!rafRunning) { rafRunning = true; requestAnimationFrame(tickFades); }
  }

  function allocIndex() {
    if (freeIndices.length > 0) return freeIndices.pop();
    if (nextIndex < MAX_INSTANCES) return nextIndex++;
    return -1; // 容量耗尽：静默降级（不摆新盒子，不影响加载）
  }

  function releaseIndex(index) {
    // 位置归零缩放已由调用方设置；归还槽位
    if (index >= 0 && index < MAX_INSTANCES) freeIndices.push(index);
  }

  // ===== 对外 API =====

  /**
   * 初始化（首次调用时自动完成，也可显式调用）
   * @param {THREE.Scene} scene
   */
  function init(scene) {
    if (mesh || !scene || !THREE) return;
    var geometry = new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D);
    var material = new THREE.MeshStandardMaterial({
      color: 0x00ccff,
      emissive: 0x006688,
      transparent: true,
      opacity: 0.5
    });
    mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
    mesh.frustumCulled = false;      // 实例遍布全图，按整体包围球剔除会整场消失
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.count = MAX_INSTANCES;      // 固定 count，用 scale=0 隐藏未用实例
    // 全部实例初始化为 scale=0（不可见）
    ensureMath();
    _s.set(0, 0, 0);
    _v.set(0, 0, 0);
    _m.compose(_v, _q.identity(), _s);
    for (var i = 0; i < MAX_INSTANCES; i++) mesh.setMatrixAt(i, _m);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.isPlaceholderField = true;
    scene.add(mesh);
  }

  /**
   * 摆出（或刷新）一个占位方块
   * @param {number|string} id worldObjectId
   * @param {number} x/y/z 对象锚点（y 通常为 0，盒子中心自动 +3）
   */
  function show(id, x, y, z) {
    if (id === undefined || id === null) return false;
    if (!mesh) return false;
    var index = idToIndex.get(id);
    if (index === undefined) {
      index = allocIndex();
      if (index < 0) return false;
      idToIndex.set(id, index);
    }
    // 若该实例正在渐缩，取消动画（原地恢复）
    fadeAnims.delete(index);
    setInstanceMatrix(index, x || 0, y || 0, z || 0, 1);
    return true;
  }

  /** 立即隐藏（无动画） */
  function hide(id) {
    var index = idToIndex.get(id);
    if (index === undefined) return false;
    fadeAnims.delete(index);
    setInstanceMatrix(index, 0, 0, 0, 0);
    idToIndex.delete(id);
    releaseIndex(index);
    return true;
  }

  /** 渐缩隐藏（250ms），结束后释放槽位；onDone 可选 */
  function fadeOutAndHide(id, onDone) {
    var index = idToIndex.get(id);
    if (index === undefined) { if (onDone) onDone(); return false; }
    if (!mesh) return false;
    // 从当前实例矩阵读回锚点
    ensureMath();
    mesh.getMatrixAt(index, _m);
    _m.decompose(_v, _q, _s);
    fadeAnims.set(index, { start: (typeof performance !== 'undefined' ? performance.now() : Date.now()), x: _v.x, y: _v.y - BOX_Y_OFFSET, z: _v.z, onDone: onDone });
    idToIndex.delete(id);
    startFadeLoop();
    return true;
  }

  /** 是否正摆着 */
  function has(id) {
    return idToIndex.has(id);
  }

  function shownCount() {
    return idToIndex.size;
  }

  // ===== 真模型"预热后显示"（防首帧白闪） =====

  /**
   * 模型先隐藏 → 着色器编译预热（同帧多个模型合并一次 compile）→
   * 下一帧统一显示。编译期间 updateFrustumCulling 依据
   * userData.__pendingReveal 跳过可见性覆盖。
   * @param {THREE.Object3D} obj 刚加入场景的真模型
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Camera} camera
   * @param {THREE.Scene} scene
   * @param {Function} onShown 模型确认可见后的回调（用于渐缩占位方块）
   */
  function reveal(obj, renderer, camera, scene, onShown) {
    if (!obj) { if (onShown) onShown(obj); return; }
    if (!THREE || !renderer || !renderer.compileAsync) {
      // 降级：无 compileAsync（理论不会发生，r185 有）直接显示
      try { if (renderer && scene && camera) renderer.compile(scene, camera); } catch (e) {}
      if (onShown) onShown(obj);
      return;
    }
    obj.visible = false;
    if (!obj.userData) obj.userData = {};
    obj.userData.__pendingReveal = true;
    pendingReveal.push({ obj: obj, onShown: onShown, renderer: renderer, camera: camera, scene: scene });

    // 【2026-09-09】批编译 + 批大小自适应（见 MIN_CHUNK 处注释）
    if (!revealScheduled) {
      revealScheduled = true;
      requestAnimationFrame(revealTick);
    }
  }

  function nowMs() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function programCount(renderer) {
    try {
      return (renderer && renderer.info && renderer.info.programs) ? renderer.info.programs.length : -1;
    } catch (e) { return -1; }
  }

  function revealTick() {
    var item = pendingReveal.shift();
    if (!item) { revealScheduled = false; return; }

    var startedAt = nowMs();
    var shown = false;

    var showNow = function () {
      if (shown) return;
      shown = true;
      item.obj.visible = true;
      item.obj.userData.__pendingReveal = false;
      if (item.onShown) { try { item.onShown(item.obj); } catch (e) {} }
    };

    var nextItem = function () {
      // 让出一帧，给纹理上传等首帧准备工作留时间，再处理下一个模型
      requestAnimationFrame(function () {
        if (pendingReveal.length > 0) revealTick();
        else revealScheduled = false;
      });
    };

    var targets = [];
    if (item.obj.isMesh) targets.push(item.obj);
    item.obj.traverse(function (o) { if (o.isMesh && o !== item.obj) targets.push(o); });
    if (targets.length === 0) { showNow(); nextItem(); return; }

    var idx = 0;
    var step = function () {
      if (idx >= targets.length) { showNow(); nextItem(); return; }
      // 预热超时：先上屏（宁可首帧略卡，也不让用户对着空地久等），剩余在后台继续编译
      if (!shown && nowMs() - startedAt > REVEAL_MAX_MS) showNow();

      var end = Math.min(idx + adaptiveChunk, targets.length);
      var batch = targets.slice(idx, end);
      idx = end;

      var t0 = nowMs();
      var pBefore = programCount(item.renderer);
      // 临时容器承载整批 mesh：renderer.compile 只 traverse children 收集材质
      //（内部用 Set 去重），一次调用完成整批预热，避免 N 个独立轮询循环。
      var holder = new THREE.Group();
      holder.children = batch;

      var done = function () {
        holder.children = [];
        var cost = nowMs() - t0;
        var added = programCount(item.renderer) - pBefore;
        if (added === 0) adaptiveChunk = MAX_CHUNK;   // 全是缓存命中 → 全速推进
        else if (cost > BUDGET_MS) adaptiveChunk = Math.max(MIN_CHUNK, Math.floor(adaptiveChunk / 2));
        else if (cost < BUDGET_MS * 0.4) adaptiveChunk = Math.min(MAX_CHUNK, adaptiveChunk * 2);
        if (idx < targets.length) requestAnimationFrame(step);
        else { showNow(); nextItem(); }
      };

      try {
        item.renderer.compileAsync(holder, item.camera, item.scene).then(done, done);
      } catch (e) { done(); }
    };
    step();
  }

  /**
   * 占位方块"等模型可见后再渐缩"：
   * removePlaceholder 调用时真模型往往尚未进场景（entry 仍是占位条目），
   * 因此只挂 REVEAL_TIMEOUT_MS 兜底定时器；真模型进场景后由
   * _addModelToScene 的 reveal 回调调 fadeOutAndHide(id) 提前触发。
   * 两个路径谁先到谁生效（fadeOutAndHide 对已移除 id 安全 no-op）。
   * @param {number|string} id
   * @param {THREE.Object3D} model 可选：真模型（当前实现未用，保留签名）
   */
  function hideAfterRevealOrTimeout(id, model) {
    setTimeout(function () {
      fadeOutAndHide(id);
    }, REVEAL_TIMEOUT_MS);
  }

  /** dispose（页面卸载用） */
  function dispose() {
    if (mesh && mesh.parent) mesh.parent.remove(mesh);
    if (mesh) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    mesh = null;
    idToIndex.clear();
    freeIndices.length = 0;
    nextIndex = 0;
    fadeAnims.clear();
    pendingReveal.length = 0;
  }

  global.PlaceholderField = {
    init: init,
    show: show,
    hide: hide,
    fadeOutAndHide: fadeOutAndHide,
    has: has,
    shownCount: shownCount,
    pendingCount: function () { return pendingReveal.length; },
    _debug: function () { return { adaptiveChunk: adaptiveChunk, pending: pendingReveal.length }; },
    reveal: reveal,
    hideAfterRevealOrTimeout: hideAfterRevealOrTimeout,
    dispose: dispose
  };
})(typeof window !== 'undefined' ? window : this);
