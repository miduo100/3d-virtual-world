/**
 * worldLoadingOptimizer.js
 * 加载期性能优化旁路模块（不修改 world.js）
 *
 * 问题：红军模型 416 实例在加载期造成严重卡顿
 *   1. 每个占位符启动一个 setInterval 进度模拟（500ms tick），每 tick 重建
 *      512×128 Canvas 纹理 + dispose 旧纹理 → 定时器风暴 + GPU 纹理分配/释放
 *   2. 流式下载每个 chunk 触发 updateLargeModelProgress → O(n) 扫描 + Canvas 重建
 *   3. 进入瞬间同步创建 416×(nameSprite + progressSprite) 共 800+ 张 Canvas 纹理
 *   4. 高频调试日志刷屏（同步 I/O）
 *
 * 策略（距离抑制 + 节流 + 日志治理）：
 *   - 占位符距玩家 >120m（红军模型全在远处）：不启动模拟、不创建/重建进度
 *     sprite、不创建"完成"sprite；下载字节数仍记录，走近后可显示真实进度
 *   - 近处占位符：250ms 节流合并 sprite 重建
 *   - 加载完成加入场景时触发即时合批扫描（300ms 节流），缩短合批前独立渲染窗口
 *   - 高频调试日志过滤（可通过 window.WorldLoadingOptimizer.setLogFilter(false) 关闭）
 *
 * 挂载方式：world.js 之后引入（window.World 已定义），直接 patch World 原型，
 * 保证在任何加载开始前生效。
 */
(function () {
  'use strict';

  var PROGRESS_DIST = 120;   // 进度显示/模拟作用半径（米），与合批视距裁剪一致
  var THROTTLE_MS = 250;     // 进度 sprite 重建节流窗口
  var LOG_FILTER = /^(\[Queue\]|\[进度调试|\[addUploadedModel\]|\[cull\]|🔍 \[addUploadedModel\]|📦 占位符|✅ (上传模型|大模型GLTF加载成功|GLTF模型加载成功|Fallback)|🔄 尝试从API加载几何体组件|总共 \d+ 个网格)/;
  var patched = false;

  /** 计算点到玩家位置的平方距离；玩家不存在时返回 0（视为近处，安全降级） */
  function distSqToPlayer(x, y, z) {
    var p = (typeof window !== 'undefined' && window.player) || null;
    if (!p || !p.position) return 0;
    var dx = x - p.position.x, dy = y - p.position.y, dz = z - p.position.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** 按名称查找 loading 中的占位符模型 */
  function findPlaceholderModel(world, name) {
    var target = null;
    if (!world || !world.generatedBuildings) return null;
    world.generatedBuildings.forEach(function (entry) {
      if (!target && entry.isPlaceholder && entry.isLoadingPlaceholder &&
          entry.data && entry.data.name === name) target = entry.model;
    });
    return target;
  }

  /** 判断占位符模型是否在进度作用半径之外 */
  function isFarFromPlayer(model) {
    if (!model || !model.position) return false;
    return distSqToPlayer(model.position.x, model.position.y, model.position.z) > PROGRESS_DIST * PROGRESS_DIST;
  }

  /** 节流检查：同 key 在 THROTTLE_MS 窗口内只放行一次 */
  function throttle(world, key) {
    if (!world.__progThrottle) world.__progThrottle = new Map();
    var now = Date.now();
    var last = world.__progThrottle.get(key) || 0;
    if (now - last < THROTTLE_MS) return false;
    world.__progThrottle.set(key, now);
    return true;
  }

  function patchWorldProto() {
    var World = window.World;
    if (!World || patched) return;
    patched = true;

    // ===== 1. 占位符创建：远处 loading 占位符跳过 name/progress sprite =====
    var origAddPh = World.prototype.addPlaceholderBuilding;
    World.prototype.addPlaceholderBuilding = function (id, buildingData, status) {
      var far = status === 'loading' && buildingData &&
        distSqToPlayer(buildingData.position_x, buildingData.position_y, buildingData.position_z) > PROGRESS_DIST * PROGRESS_DIST;
      var origName = this.createNameSprite, origProg = this.createProgressSprite;
      if (far) {
        // 临时替换为 no-op：远处占位符只保留 box（由合批模块视距裁剪摘除，不渲染）
        this.createNameSprite = function () { return null; };
        this.createProgressSprite = function () { return null; };
      }
      try {
        return origAddPh.call(this, id, buildingData, status);
      } finally {
        this.createNameSprite = origName;
        this.createProgressSprite = origProg;
      }
    };

    // ===== 2. 进度模拟：远处不启动定时器 =====
    var origStartSim = World.prototype._startProgressSimulation;
    World.prototype._startProgressSimulation = function (sanitizedId, name, totalBytes) {
      if (isFarFromPlayer(findPlaceholderModel(this, name))) {
        // 清理可能遗留的模拟（占位符从近处移动到远处的情况）
        this._stopProgressSimulation(sanitizedId);
        return;
      }
      return origStartSim.call(this, sanitizedId, name, totalBytes);
    };

    // ===== 3. 下载进度更新：远处只记字节不重建 sprite；近处节流 =====
    var origUpdate = World.prototype.updateLargeModelProgress;
    World.prototype.updateLargeModelProgress = function (name, value, isRealProgress, mode) {
      var world = this;
      var target = findPlaceholderModel(world, name);
      if (isFarFromPlayer(target)) {
        // 远处：仍记录真实字节数（玩家走近后可显示真实进度），但不重建 sprite
        if (isRealProgress && value > 0) {
          var sid = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
          if (!world._modelRealBytes) world._modelRealBytes = new Map();
          world._modelRealBytes.set(sid, value);
        }
        return;
      }
      if (!throttle(world, name)) return;
      return origUpdate.call(world, name, value, isRealProgress, mode);
    };

    // ===== 4. 模拟 tick 直接更新：远处跳过 + 节流 =====
    var origUpdPh = World.prototype._updateProgressOnPlaceholder;
    World.prototype._updateProgressOnPlaceholder = function (name, value, mode, totalBytes) {
      var world = this;
      if (isFarFromPlayer(findPlaceholderModel(world, name))) return;
      if (!throttle(world, name)) return;
      return origUpdPh.call(world, name, value, mode, totalBytes);
    };

    // ===== 5. 完成 sprite：远处跳过 =====
    var origComplete = World.prototype._showCompleteOnPlaceholder;
    World.prototype._showCompleteOnPlaceholder = function (name) {
      var world = this;
      if (isFarFromPlayer(findPlaceholderModel(world, name))) {
        var sid = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
        world._stopProgressSimulation(sid); // 停止遗留模拟
        if (world.__progThrottle) world.__progThrottle.delete(name);
        return; // 远处不创建"完成"sprite
      }
      return origComplete.call(world, name);
    };

    // ===== 6. 加载完成加入场景 → 即时合批扫描（300ms 节流）=====
    var origAddScene = World.prototype._addModelToScene;
    World.prototype._addModelToScene = function (obj) {
      var ret = origAddScene.call(this, obj);
      if (window.WorldInstanceMerger && window.WorldInstanceMerger.rescan) {
        var world = this;
        if (!world.__mergeRescanTimer) {
          world.__mergeRescanTimer = setTimeout(function () {
            world.__mergeRescanTimer = null;
            try { window.WorldInstanceMerger.rescan(); } catch (e) { /* 防御 */ }
          }, 300);
        }
      }
      return ret;
    };

  }

  // ===== 日志治理（可开关）=====
  var logFilterOn = true;
  function installLogFilter() {
    if (!window.console) return;
    var origLog = window.console.log;
    window.console.log = function () {
      if (logFilterOn && arguments.length && typeof arguments[0] === 'string' &&
          LOG_FILTER.test(arguments[0])) return;
      origLog.apply(window.console, arguments);
    };
  }

  // ===== 启动：world.js 已加载（window.World 可用）即 patch，早于任何加载流程 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      patchWorldProto();
      installLogFilter();
    });
  } else {
    patchWorldProto();
    installLogFilter();
  }

  window.WorldLoadingOptimizer = {
    setLogFilter: function (on) { logFilterOn = !!on; },
    isPatched: function () { return patched; }
  };
})();
