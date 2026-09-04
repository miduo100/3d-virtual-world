/**
 * worldObjectBounds.js
 * 世界对象包围盒注册表（距离口径统一层）
 *
 * 背景：项目原本所有"距离"判定都把对象锚点（position_x / position_z）当成模型本体，
 * 于是大模型（半径上百米）会出现"人已经站在模型边缘甚至模型内部，模型却被渲染
 * 裁剪成蓝色方块、或被真卸载"的问题。
 *
 * 本模块把距离口径升级为【玩家到模型表面（世界 AABB）的最近距离】：
 *   1. 已加载对象：用真实世界包围盒，点到 AABB 的 clamp 距离（盒内为 0）
 *   2. 未加载对象：回退到同源 model_path 的缓存半径（复制多份场景同样生效）
 *   3. 都没命中：回退到 UNKNOWN_MARGIN 的保守外扩
 *
 * 设计约束：
 *   - 纯旁路模块，不依赖 world.js；未引入时所有调用方自动退回原中心点逻辑
 *   - 包围盒按 matrixWorldNeedsUpdate 惰性重算，稳定态每帧只有一次 Map 查询
 *   - 半径计入上限 RADIUS_CLAMP：防止超大模型变成"永不卸载"撑爆内存
 *
 * 挂载位置：index.html 中 world.js 之后、worldInstanceMerger_v2.js 之前。
 */
(function () {
  'use strict';

  // ===== 可调参数 =====
  let RADIUS_CLAMP = 300;    // 半径计入上限（米），超出部分不计入距离减免
  // 未加载对象（既无包围盒、也无同源半径）时的保守外扩（米）。
  // 默认 0 = 完全保持原行为（零加载量回归）；调大会让模型更早开始下载，
  // 但世界内所有未加载对象都会提前入队，加载量约按 (1+margin/200)² 增长。
  // 例：WorldObjectBounds.setUnknownMargin(150) 表示"假设未知对象半径 150m"。
  let UNKNOWN_MARGIN = 0;
  let GRACE_MS = 2000;       // 模型加载完成后的裁剪宽限（毫秒），防"下载完反而消失"

  // ===== 状态 =====
  const boxById = new Map();      // id -> { box: Box3, model: Object3D }
  const urlRadiusMap = new Map(); // model_path -> 水平半径（clamp 后，米）
  const urlById = new Map();      // id -> model_path（卸载时定位）
  const metaById = new Map();     // id -> { rawRadius, radius, clamped, at }
  let clampedCount = 0;           // 触发半径封顶的对象数（调试用）

  // ===== 内部工具 =====

  function finiteBox(b) {
    return b && isFinite(b.min.x) && isFinite(b.min.y) && isFinite(b.min.z) &&
      isFinite(b.max.x) && isFinite(b.max.y) && isFinite(b.max.z);
  }

  function urlOf(obj, model) {
    if (obj && typeof obj.model_path === 'string' && obj.model_path) return obj.model_path;
    if (model && model.userData && typeof model.userData.__texOptSource === 'string') {
      return model.userData.__texOptSource;
    }
    return null;
  }

  /** 把 box 收缩到以锚点为中心、半径 RADIUS_CLAMP 的方框内（只在超限时生效） */
  function clampBoxToAnchor(box, cx, cz) {
    box.min.x = Math.max(box.min.x, cx - RADIUS_CLAMP);
    box.max.x = Math.min(box.max.x, cx + RADIUS_CLAMP);
    box.min.z = Math.max(box.min.z, cz - RADIUS_CLAMP);
    box.max.z = Math.min(box.max.z, cz + RADIUS_CLAMP);
    // box 整体落在封顶框之外（锚点在模型外很远处）→ 退化为锚点处的退化盒
    if (box.min.x > box.max.x) box.min.x = box.max.x = cx;
    if (box.min.z > box.max.z) box.min.z = box.max.z = cz;
  }

  // ===== 注册 =====

  /**
   * 计算并缓存对象的世界包围盒。
   * 仅在首次见到、模型被替换、或世界矩阵失效时重算。
   * @param {number|string} id   世界对象 id
   * @param {THREE.Object3D} model 已加入（或曾加入）场景的模型
   * @param {object} obj 世界对象数据行（提供 position_x/z 与 model_path）
   * @returns {THREE.Box3|null}
   */
  function ensure(id, model, obj) {
    if (id === undefined || id === null || !model || !window.THREE) return null;

    const rec = boxById.get(id);
    if (rec && rec.model === model && !model.matrixWorldNeedsUpdate) return rec.box;

    // 必须先刷新整棵子树的 matrixWorld：clone() 后只改了根节点 position，
    // 子网格的 matrixWorld 仍是源模型旧值，直接 setFromObject 会得到错误包围盒
    model.updateWorldMatrix(true, true);

    const box = new THREE.Box3().setFromObject(model);
    if (!finiteBox(box) || box.isEmpty()) return null;

    const cx = (obj && typeof obj.position_x === 'number') ? obj.position_x : (box.min.x + box.max.x) / 2;
    const cz = (obj && typeof obj.position_z === 'number') ? obj.position_z : (box.min.z + box.max.z) / 2;

    // 原始半径（锚点到包围盒四角的最大水平距离），封顶前先记录
    const rawRadius = Math.max(
      Math.hypot(box.min.x - cx, box.min.z - cz),
      Math.hypot(box.min.x - cx, box.max.z - cz),
      Math.hypot(box.max.x - cx, box.min.z - cz),
      Math.hypot(box.max.x - cx, box.max.z - cz)
    );
    const clamped = rawRadius > RADIUS_CLAMP;
    if (clamped) {
      clampBoxToAnchor(box, cx, cz);
      clampedCount++;
    }

    boxById.set(id, { box: box, model: model });

    const radius = Math.min(rawRadius, RADIUS_CLAMP);
    metaById.set(id, { rawRadius: rawRadius, radius: radius, clamped: clamped, at: Date.now() });

    const url = urlOf(obj, model);
    if (url) {
      urlById.set(id, url);
      // 同源取最大半径：避免首个实例是异常缩放的小副本
      const prev = urlRadiusMap.get(url) || 0;
      if (radius > prev) urlRadiusMap.set(url, radius);
    }
    return box;
  }

  function unregister(id) {
    if (id === undefined || id === null) return;
    boxById.delete(id);
    metaById.delete(id);
    urlById.delete(id);
  }

  function invalidate(id) {
    const rec = boxById.get(id);
    if (rec) rec.model = null; // 强制下次重算
  }

  // ===== 距离查询 =====

  /** 未加载对象（无包围盒）时使用的保守半径 */
  function fallbackRadius(obj) {
    const url = urlOf(obj, null) || (obj && obj.__texOptSource);
    if (url && urlRadiusMap.has(url)) return urlRadiusMap.get(url);
    return UNKNOWN_MARGIN;
  }

  /**
   * 玩家到对象表面的水平距离平方（盒内为 0）。
   * 与旧口径（中心点距离平方）单位一致，可直接替换比较。
   */
  function surfaceDistSq(obj, px, pz) {
    const id = obj ? obj.id : undefined;
    const rec = (id !== undefined && id !== null) ? boxById.get(id) : null;
    if (rec) {
      const b = rec.box;
      const dx = Math.max(b.min.x - px, 0, px - b.max.x);
      const dz = Math.max(b.min.z - pz, 0, pz - b.max.z);
      return dx * dx + dz * dz;
    }
    const cx = (obj && typeof obj.position_x === 'number') ? obj.position_x : 0;
    const cz = (obj && typeof obj.position_z === 'number') ? obj.position_z : 0;
    const d = Math.sqrt((px - cx) * (px - cx) + (pz - cz) * (pz - cz)) - fallbackRadius(obj);
    return d > 0 ? d * d : 0;
  }

  function surfaceDist(obj, px, pz) {
    return Math.sqrt(surfaceDistSq(obj, px, pz));
  }

  function centerDist(obj, px, pz) {
    const cx = (obj && typeof obj.position_x === 'number') ? obj.position_x : 0;
    const cz = (obj && typeof obj.position_z === 'number') ? obj.position_z : 0;
    return Math.sqrt((px - cx) * (px - cx) + (pz - cz) * (pz - cz));
  }

  function radiusOf(id) {
    const m = metaById.get(id);
    return m ? m.radius : 0;
  }

  function radiusByUrl(url) {
    return (url && urlRadiusMap.has(url)) ? urlRadiusMap.get(url) : 0;
  }

  // ===== 加载完成宽限 =====
  // 占位符不受视距裁剪，真模型一加载完成就可能被裁 → 观感是"下载完反而消失"。
  // 判据用 world.js 在 _addModelToScene 写入的 model.userData.__addedAt：
  // 只给"本会话中新加入场景"的模型宽限，页面启动时已在场的对象照常裁剪，
  // 避免全量宽限重演加载期卡顿（红军 416 实例那类问题）。

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function isInGrace(entry, model) {
    const m = model || (entry && entry.model);
    if (m && m.userData && typeof m.userData.__addedAt === 'number') {
      return (now() - m.userData.__addedAt) < GRACE_MS;
    }
    return false; // 无入场景时间戳 → 不宽限
  }

  function resetGrace(entry) {
    if (entry && entry.model && entry.model.userData) delete entry.model.userData.__addedAt;
  }

  // ===== 参数与调试 =====

  function stats() {
    return {
      boxes: boxById.size,
      urls: urlRadiusMap.size,
      clamped: clampedCount,
      radiusClamp: RADIUS_CLAMP,
      unknownMargin: UNKNOWN_MARGIN,
      graceMs: GRACE_MS
    };
  }

  function clear() {
    boxById.clear();
    urlRadiusMap.clear();
    urlById.clear();
    metaById.clear();
    clampedCount = 0;
  }

  /** 控制台诊断：打印玩家与每个对象的中心距/表面距/半径/当前状态 */
  function report(world, limit) {
    if (!world) { console.warn('[WorldObjectBounds] report(world) 需要一个 World 实例'); return []; }
    const p = window.player && window.player.position;
    if (!p) { console.warn('[WorldObjectBounds] 找不到 window.player'); return []; }
    const rows = [];
    const list = world.allWorldObjects || [];
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const dc = centerDist(o, p.x, p.z);
      if (dc > (limit || 1200)) continue;
      const sd = surfaceDist(o, p.x, p.z);
      const entry = world.generatedBuildings ? world.generatedBuildings.get(o.id) : null;
      const model = entry && entry.model;
      rows.push({
        id: o.id,
        name: o.name,
        中心距: +dc.toFixed(1),
        表面距: +sd.toFixed(1),
        半径: +radiusOf(o.id).toFixed(1),
        已加载: world.loadedObjects ? world.loadedObjects.has(o.id) : null,
        在场景: model ? !!model.parent : null,
        旧口径_锚点: dc > 400 ? '已卸载' : (dc > 200 ? '只剩蓝块' : '正常'),
        新口径_表面: sd > 400 ? '该卸载' : (sd > 200 ? '该蓝块' : '该显示'),
        改善: (dc > 200 && sd <= 200) ? '✔ 原本被提前裁掉' : ''
      });
    }
    if (console.table) console.table(rows); else console.log(rows);
    return rows;
  }

  window.WorldObjectBounds = {
    ensure: ensure,
    unregister: unregister,
    invalidate: invalidate,
    surfaceDistSq: surfaceDistSq,
    surfaceDist: surfaceDist,
    centerDist: centerDist,
    radiusOf: radiusOf,
    radiusByUrl: radiusByUrl,
    isInGrace: isInGrace,
    resetGrace: resetGrace,
    setClamp: function (v) { RADIUS_CLAMP = Math.max(0, Number(v) || 0); },
    setUnknownMargin: function (v) { UNKNOWN_MARGIN = Math.max(0, Number(v) || 0); },
    setGraceMs: function (v) { GRACE_MS = Math.max(0, Number(v) || 0); },
    stats: stats,
    clear: clear,
    report: report
  };
})();
