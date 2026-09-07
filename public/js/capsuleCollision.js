/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * capsuleCollision.js — 模型表面碰撞（胶囊体 + three-mesh-bvh）
 *
 * 职责：
 *  1. 注册表：收集 has_collision=true 且已加载的模型（自愈扫描 generatedBuildings）；
 *  2. BVH：对注册模型的几何体建 three-mesh-bvh 加速结构（空闲分帧构建）；
 *     - 等比缩放 mesh：复用原几何，BVH 按 geometry 引用计数共享；
 *     - 非等比缩放 mesh（编辑器自由拉伸的几何体）：烘焙世界变换顶点快照（仅 position+index），
 *       BVH 建在世界空间，任意拉伸都精确，生命周期跟随注册项；
 *  3. 查询：
 *     - getGroundHeight(x,y,z)：向下射线取模型真实表面高度（可站上顶面/斜坡/平台）；
 *     - checkCapsule(x,feetY,z)：胶囊体与模型表面是否相交（侧向阻挡）；
 *  4. 排除项：占位符、SkinnedMesh、超大模型（>40万面）。
 *
 * 依赖加载顺序：three.min.js (r185 UMD) → three-mesh-bvh.min.js → 本文件。
 * world.js getGroundHeight / player.js checkSideCollision 是消费方，本模块不反向依赖它们。
 */
(function () {
  'use strict';

  // ---- 环境守卫 ----
  if (typeof THREE === 'undefined') {
    console.warn('[CapsuleCollision] THREE 未就绪，模块禁用');
    window.CapsuleCollision = { isEnabled: function () { return false; } };
    return;
  }
  var LIB = window.__MESH_BVH_LIB__;
  if (!LIB || !LIB.MeshBVH) {
    console.warn('[CapsuleCollision] three-mesh-bvh bundle 未加载，模块禁用');
    window.CapsuleCollision = { isEnabled: function () { return false; } };
    return;
  }

  // 挂 BVH 原型扩展（three-mesh-bvh 标准用法）
  THREE.BufferGeometry.prototype.computeBoundsTree = LIB.computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = LIB.disposeBoundsTree;
  THREE.Mesh.prototype.raycast = LIB.acceleratedRaycast;

  // ---- 常量 ----
  var SWEEP_INTERVAL_MS = 2000;      // 自愈扫描周期
  var RAY_UP = 1.2;                  // 射线起点高于脚底的偏移
  var RAY_LOOKAHEAD = 4;             // 脚底向下的探测距离（覆盖帧内下落位移）
  var STEP_UP = 1.0;                 // 登步容差（与旧 AABB 逻辑一致）
  var MAX_TRIS_PER_MODEL = 600000;   // 超大模型跳过 BVH（走 AABB 兜底）；BVH 空闲分帧构建

  // 注册表：id -> ModelRec
  var REG = new Map();
  // geometry BVH 引用计数：uuid -> {count, building}
  var BVH_REFS = new Map();
  // BVH 构建队列（空闲分帧，防大模型建树卡帧）
  var buildQueue = [];
  var buildScheduled = false;
  // 面数超限的模型 id（本会话内不再重试，防日志刷屏）
  var TRI_LIMIT_FAILED = new Set();
  var initialized = false;
  var _lastCheck = null; // 最近一次 checkCapsule 的内部追踪（诊断用）

  // ---- 复用临时对象（查询热路径零分配目标）----
  var _v1 = new THREE.Vector3();
  var _v2 = new THREE.Vector3();
  var _v3 = new THREE.Vector3();
  var _n1 = new THREE.Vector3();
  var _triPoint = new THREE.Vector3();
  var _capPoint = new THREE.Vector3();
  var _inv = new THREE.Matrix4();
  var _ray = new THREE.Ray();
  var _seg = new THREE.Line3();
  var _segLocal = new THREE.Line3();
  var _box = new THREE.Box3();

  // ==================== BVH 构建（空闲分帧） ====================

  function _processBuildQueue() {
    buildScheduled = false;
    var deadline = (typeof performance !== 'undefined') ? performance.now() + 8 : Infinity;
    while (buildQueue.length > 0 && performance.now() < deadline) {
      var item = buildQueue.shift();
      try {
        if (!item.geometry.boundsTree && item.geometry.attributes.position) {
          item.geometry.computeBoundsTree();
        }
        if (item.onDone) item.onDone();
      } catch (e) {
        console.warn('[CapsuleCollision] BVH 构建失败:', e && e.message);
      }
    }
    if (buildQueue.length > 0) _scheduleBuild();
  }

  function _scheduleBuild() {
    if (buildScheduled) return;
    buildScheduled = true;
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(_processBuildQueue, { timeout: 500 });
    } else {
      setTimeout(_processBuildQueue, 16);
    }
  }

  function _flushCallbacks(rec) {
    var cbs = rec.callbacks || [];
    rec.callbacks = [];
    for (var i = 0; i < cbs.length; i++) {
      if (cbs[i]) cbs[i]();
    }
  }

  function _acquireBVH(geometry, onDone) {
    var uuid = geometry.uuid;
    var rec = BVH_REFS.get(uuid);
    if (rec) {
      rec.count++;
      if (geometry.boundsTree) {
        if (onDone) onDone(); // BVH 已就绪
      } else {
        // BVH 构建中：挂回调，构建完成后统一触发（绝不能丢弃）
        if (!rec.callbacks) rec.callbacks = [];
        if (onDone) rec.callbacks.push(onDone);
        if (!rec.building) {
          rec.building = true;
          buildQueue.push({ geometry: geometry, onDone: function () {
            rec.building = false;
            _flushCallbacks(rec);
          } });
          _scheduleBuild();
        }
      }
      return true;
    }
    if (!geometry.attributes.position || geometry.attributes.position.count < 3) return false;
    var recNew = { count: 1, building: true, callbacks: onDone ? [onDone] : [] };
    BVH_REFS.set(uuid, recNew);
    buildQueue.push({ geometry: geometry, onDone: function () {
      recNew.building = false;
      _flushCallbacks(recNew);
    } });
    _scheduleBuild();
    return true;
  }

  function _releaseBVH(geometry) {
    var rec = BVH_REFS.get(geometry.uuid);
    if (!rec) return;
    rec.count--;
    if (rec.count <= 0) {
      BVH_REFS.delete(geometry.uuid);
      try {
        if (geometry.boundsTree) geometry.disposeBoundsTree();
      } catch (e) { /* geometry 可能已被销毁，忽略 */ }
    }
  }

  // 私有 BVH（烘焙几何专用，生命周期跟随注册项，无共享引用计数）
  function _buildPrivateBVH(geometry, onDone) {
    buildQueue.push({ geometry: geometry, onDone: onDone });
    _scheduleBuild();
  }

  // ==================== 世界缩放判定与烘焙 ====================

  var _IDENTITY = new THREE.Matrix4();

  // 世界矩阵三列长度 ≈ 相等视为等比缩放
  function _isWorldScaleUniform(m) {
    var e = m.elements;
    var sx = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
    var sy = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
    var sz = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);
    var avg = (sx + sy + sz) / 3;
    if (avg < 1e-9) return false;
    return Math.abs(sx - sy) / avg < 0.02 &&
           Math.abs(sy - sz) / avg < 0.02 &&
           Math.abs(sx - sz) / avg < 0.02;
  }

  function _worldScaleAvg(m) {
    var e = m.elements;
    return (Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) +
            Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]) +
            Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10])) / 3;
  }

  /**
   * 把 mesh 的顶点按当前世界变换烘焙成一份"仅供碰撞"的几何快照
   * （只含 position + index，无 UV/法线/材质，内存 ≈ 12 字节/顶点）。
   * 用于非等比缩放的 mesh：BVH 直接建在世界空间上，任意拉伸都精确。
   */
  function _bakeWorldGeometry(mesh) {
    var src = mesh.geometry;
    var pos = src.attributes.position;
    mesh.updateWorldMatrix(true, false);
    var m = mesh.matrixWorld;
    var n = pos.count;
    var arr = new Float32Array(n * 3);
    var v = new THREE.Vector3();
    for (var i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      arr[i * 3] = v.x;
      arr[i * 3 + 1] = v.y;
      arr[i * 3 + 2] = v.z;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    if (src.index) g.setIndex(src.index.clone());
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  // ==================== 注册 ====================

  /**
   * 注册一个模型参与表面碰撞。
   * 返回 true=已注册（含排队建 BVH），false=不适合（蒙皮/超大等）。
   * - 合批几何建筑（__geometryBatched，源模型已摘出场景）作为静态快照注册；
   * - 世界缩放非等比的 mesh（编辑器自由拉伸的几何体）烘焙世界变换快照，
   *   BVH 直接建在世界空间，任意拉伸都精确。
   */
  function registerModel(id, model) {
    if (!id || !model || REG.has(id)) return REG.has(id);
    var isStaticSnapshot = !!model.userData.__geometryBatched;

    var meshRecs = [];
    var totalTris = 0;
    model.updateMatrixWorld(true);
    model.traverse(function (child) {
      if (!child.isMesh || child.isSkinnedMesh) return;
      var geom = child.geometry;
      if (!geom || !geom.attributes || !geom.attributes.position) return;
      var tris = (geom.index ? geom.index.count : geom.attributes.position.count) / 3;
      if (tris < 1) return;
      totalTris += tris;
      // 逐 mesh 判定世界缩放：非等比 → 烘焙；等比 → 复用原几何共享 BVH
      var baked = !_isWorldScaleUniform(child.matrixWorld);
      meshRecs.push({ mesh: child, geometry: geom, baked: baked });
    });

    if (meshRecs.length === 0) return false;
    if (totalTris > MAX_TRIS_PER_MODEL) {
      // 记忆失败：自愈扫描不再每 2s 重试刷屏（卸载后重新加载同一模型仍会被此记忆拦截，
      // 因为面数不会变化；如需重试可调 CapsuleCollision._recs 或刷新页面）
      TRI_LIMIT_FAILED.add(id);
      console.warn('[CapsuleCollision] 模型面数 ' + Math.round(totalTris) + ' 超限，跳过表面碰撞: id=' + id + '（仅提示一次）');
      return false;
    }

    var pending = 0;
    var modelRec = { id: id, model: model, meshes: meshRecs, ready: 0, staticSnapshot: isStaticSnapshot };
    meshRecs.forEach(function (mr) {
      mr.aabb = new THREE.Box3();
      mr.hasBVH = false;
      var done = function () {
        mr.hasBVH = true;
        modelRec.ready++;
      };
      if (mr.baked) {
        // 私有世界空间快照：矩阵全为单位阵，半径换算系数 = 1
        mr.geometry = _bakeWorldGeometry(mr.mesh);
        mr.uniformScale = 1;
        mr.worldMatrix = _IDENTITY;
        mr.invMatrix = _IDENTITY;
        mr.aabb.copy(mr.geometry.boundingBox);
        mr.private = true;
        _buildPrivateBVH(mr.geometry, done);
        pending++;
      } else {
        mr.uniformScale = _worldScaleAvg(mr.mesh.matrixWorld);
        mr.worldMatrix = mr.mesh.matrixWorld; // 活引用（模型被移动时自动跟随）
        mr.aabbMatrix = new Float32Array(16);
        mr.invMatrix = new THREE.Matrix4();
        var ok = _acquireBVH(mr.geometry, done);
        if (!ok) mr.disabled = true;
        else pending++;
      }
    });
    if (pending === 0) return false;

    REG.set(id, modelRec);
    return true;
  }

  function unregisterModel(id) {
    var rec = REG.get(id);
    if (!rec) return false;
    rec.meshes.forEach(function (mr) {
      if (mr.private) {
        try {
          if (mr.geometry.boundsTree) mr.geometry.disposeBoundsTree();
        } catch (e) { /* 忽略 */ }
        mr.geometry.dispose();
      } else {
        _releaseBVH(mr.geometry);
      }
    });
    REG.delete(id);
    return true;
  }

  function clear() {
    Array.from(REG.keys()).forEach(unregisterModel);
  }

  // ==================== 变换缓存与粗筛 ====================

  // 校验单个 mesh 的世界变换缓存；矩阵变了就重算 AABB 与逆矩阵（烘焙快照无需跟踪）
  function _validateTransform(mr) {
    if (mr.baked) return;
    var mw = mr.mesh.matrixWorld;
    var el = mw.elements;
    var cache = mr.aabbMatrix;
    for (var i = 0; i < 16; i++) {
      if (cache[i] !== el[i]) break;
      if (i === 15) return; // 完全一致，缓存有效
    }
    for (var j = 0; j < 16; j++) cache[j] = el[j];
    mr.invMatrix.copy(mw).invert();
    mr.aabb.setFromObject(mr.mesh);
    mr.hasTransform = true;
  }

  // 收集点/线段附近的候选 mesh（世界 AABB 粗筛）
  function _collectNear(px, py, pz, pad) {
    var out = [];
    REG.forEach(function (modelRec) {
      var model = modelRec.model;
      // 不在场景中的模型：合批静态快照仍参与碰撞；其余（视距摘除等）跳过
      if (!model.parent && !modelRec.staticSnapshot) return;
      for (var k = 0; k < modelRec.meshes.length; k++) {
        var mr = modelRec.meshes[k];
        if (mr.disabled || !mr.hasBVH) continue;
        _validateTransform(mr);
        _box.copy(mr.aabb);
        _box.expandByScalar(pad);
        if (px >= _box.min.x && px <= _box.max.x &&
            py >= _box.min.y && py <= _box.max.y &&
            pz >= _box.min.z && pz <= _box.max.z) {
          out.push(mr);
        }
      }
    });
    return out;
  }

  // ==================== 查询 API ====================

  /**
   * 向下射线取模型真实表面高度。
   * @returns {number|null} 表面 y 值；无命中/无注册模型返回 null
   */
  function getGroundHeight(x, y, z) {
    if (REG.size === 0) return null;
    var originY = y + RAY_UP;
    var bottomY = y - RAY_LOOKAHEAD; // 只探测脚底下方有限距离（帧内下落距离有限）
    // 粗筛以射线段中点为圆心（起点高于模型时按起点选会漏）
    var midY = (originY + bottomY) / 2;
    var pad = (originY - bottomY) / 2 + 0.5;
    var candidates = _collectNear(x, midY, z, pad);
    if (candidates.length === 0) return null;

    var best = null;

    for (var i = 0; i < candidates.length; i++) {
      var mr = candidates[i];
      var geom = mr.geometry;
      var bt = geom.boundsTree;
      if (!bt) continue;

      // 世界 → 本地（等比缩放，方向变换后归一即可）
      _v1.set(x, originY, z).applyMatrix4(mr.invMatrix);
      _v2.set(0, -1, 0).transformDirection(mr.invMatrix);
      _ray.origin.copy(_v1);
      _ray.direction.copy(_v2);

      // FrontSide：只命中"从上方可见"的外表面。
      // DoubleSide 会让盒内部底面也被命中，玩家站在盒旁（水平脚印内、垂直在盒外）时被抬升。
      var hits = bt.raycast(_ray, THREE.FrontSide);
      for (var h = 0; h < hits.length; h++) {
        // 本地点 → 世界点
        _v3.copy(hits[h].point).applyMatrix4(mr.worldMatrix);
        var surfY = _v3.y;
        // 只接受 [脚底-探测距离, 脚底+登步容差] 区间的表面（排除头顶天花板）
        if (surfY <= y + STEP_UP && surfY >= bottomY && (best === null || surfY > best)) {
          best = surfY;
        }
      }
    }
    return best;
  }

  /**
   * 胶囊体 vs 模型表面相交测试（侧向阻挡）。
   * @param {number} x,z 水平位置；feetY 脚底高度
   * @param {number} height 胶囊总高（默认 1.8）；radius 胶囊半径（默认 0.3）
   * @returns {boolean} 是否相交
   */
  function checkCapsule(x, feetY, z, height, radius) {
    if (REG.size === 0) return false;
    height = height || 1.8;
    radius = radius || 0.3;

    // 胶囊线段（世界）：脚底 + 半径 → 顶 - 半径
    _seg.start.set(x, feetY + radius, z);
    _seg.end.set(x, feetY + height - radius, z);

    var midY = feetY + height / 2;
    var candidates = _collectNear(x, midY, z, height);
    _lastCheck = { x: x, feetY: feetY, z: z, candidates: candidates.length, tris: 0, filtered: 0, minDist: 99 };
    if (candidates.length === 0) return false;

    for (var i = 0; i < candidates.length; i++) {
      var mr = candidates[i];
      var bt = mr.geometry.boundsTree;
      if (!bt) continue;

      // 世界 → 本地：等比缩放下胶囊仍是胶囊（烘焙快照即世界空间，恒等变换）
      _v1.copy(_seg.start).applyMatrix4(mr.invMatrix);
      _v2.copy(_seg.end).applyMatrix4(mr.invMatrix);
      _segLocal.start.copy(_v1);
      _segLocal.end.copy(_v2);
      var localRadius = radius / Math.abs(mr.uniformScale || 1);

      _box.makeEmpty();
      _box.expandByPoint(_segLocal.start);
      _box.expandByPoint(_segLocal.end);
      _box.expandByScalar(localRadius);

      var hit = false;
      bt.shapecast({
        intersectsBounds: function (b) { return b.intersectsBox(_box); },
        intersectsTriangle: function (tri) {
          var dist = tri.closestPointToSegment(_segLocal, _triPoint, _capPoint);
          if (_lastCheck) {
            _lastCheck.tris++;
            if (dist < _lastCheck.minDist) _lastCheck.minDist = +dist.toFixed(4);
          }
          if (dist >= localRadius) return false;
          // 用三角面朝向判定可踏性：朝上的面（含 ≤60° 斜坡）可踏，不侧向阻挡；
          // 垂直墙面/悬崖（法线近水平）与倒挂面（法线朝下）一律阻挡。
          // 不能用接触点高度过滤——垂直墙面与胶囊线段平行，接触点 y 恰在
          // feetY+0.3 边界上，浮点误差会随机放行穿墙（已踩坑）。
          tri.getNormal(_n1);
          _n1.transformDirection(mr.worldMatrix);
          if (_n1.y > 0.5) {
            if (_lastCheck) _lastCheck.filtered++;
            return false;
          }
          hit = true;
          return true; // 命中即短路
        }
      });
      if (hit) return true;
    }
    return false;
  }

  function isEnabled() {
    return REG.size > 0;
  }

  // ==================== 自愈扫描（对账 generatedBuildings） ====================

  // 模型已被胶囊表面碰撞接管后，移除其整盒 AABB：
  // 否则镂空结构（城堡庭院/拱门）上空会出现"隐形盖板"，也无法从拱门下穿过
  function _removeAabbFor(world, id, entry) {
    if (!world.collisionObjects) return;
    var d = entry.data || {};
    var px = d.position_x, pz = d.position_z;
    world.collisionObjects = world.collisionObjects.filter(function (c) {
      if (c.id === id) return false; // 几何建筑碰撞盒带 id
      if (c.anchor && typeof px === 'number' &&
          Math.abs(c.anchor.x - px) < 0.1 && Math.abs(c.anchor.z - pz) < 0.1) {
        return false; // uploaded_model 碰撞盒按锚点匹配
      }
      return true;
    });
  }

  function sweep() {
    var world = window.gameWorld;
    if (!world || !world.generatedBuildings) return;
    world.generatedBuildings.forEach(function (entry, id) {
      if (!entry || entry.isPlaceholder) return;
      if (!entry.model || !entry.data) return;
      if (entry.data.has_collision !== true) return;
      if (TRI_LIMIT_FAILED.has(id)) return; // 面数超限已提示过，不再重试
      if (!REG.has(id)) {
        if (registerModel(id, entry.model)) {
          _removeAabbFor(world, id, entry);
        }
      }
    });
    // 注销已卸载的对象
    Array.from(REG.keys()).forEach(function (id) {
      if (!world.generatedBuildings.has(id)) {
        unregisterModel(id);
        TRI_LIMIT_FAILED.delete(id); // 重新加载后允许重新评估
      }
    });
  }

  // ==================== 诊断 ====================

  function diag() {
    var meshes = 0, bvhReady = 0, baked = 0;
    REG.forEach(function (rec) {
      meshes += rec.meshes.length;
      bvhReady += rec.ready;
      rec.meshes.forEach(function (mr) { if (mr.baked) baked++; });
    });
    return {
      models: REG.size,
      meshes: meshes,
      bvhReady: bvhReady,
      baked: baked,
      buildQueue: buildQueue.length,
      bvhRefs: BVH_REFS.size,
      stepUp: STEP_UP,
      rayUp: RAY_UP,
      lastCheck: _lastCheck
    };
  }

  // 逐 mesh 诊断（排查碰撞错位用）
  function dump(id) {
    var rec = REG.get(id);
    if (!rec) return null;
    return rec.meshes.map(function (mr) {
      return {
        baked: !!mr.baked,
        hasBVH: !!mr.geometry.boundsTree,
        uniformScale: +((mr.uniformScale || 1).toFixed(3)),
        aabb: {
          x: [+mr.aabb.min.x.toFixed(2), +mr.aabb.max.x.toFixed(2)],
          y: [+mr.aabb.min.y.toFixed(2), +mr.aabb.max.y.toFixed(2)],
          z: [+mr.aabb.min.z.toFixed(2), +mr.aabb.max.z.toFixed(2)]
        }
      };
    });
  }

  // ---- 导出 ----
  window.CapsuleCollision = {
    registerModel: registerModel,
    unregisterModel: unregisterModel,
    clear: clear,
    getGroundHeight: getGroundHeight,
    checkCapsule: checkCapsule,
    isEnabled: isEnabled,
    sweep: sweep,
    _diag: diag,
    _dump: dump,
    _recs: function (id) { var r = REG.get(id); return r ? r.meshes : null; }
  };

  initialized = true;
  console.log('[CapsuleCollision] v2 模块已加载（胶囊 + BVH 表面碰撞）');
  setInterval(sweep, SWEEP_INTERVAL_MS);
})();
