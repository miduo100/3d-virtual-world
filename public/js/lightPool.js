/**
 * 点光灯池（LightPool）—— 2026-09-05 卡顿治理
 *
 * 根因：传送门/广告位/光剑的点光随对象加载卸载、玩家进出而动态增删。
 * three.js 的着色器程序按 NUM_POINT_LIGHTS 等光照状态缓存，灯数每变一次，
 * 场景内所有可视材质的程序都要用新灯数重新编译（D3D 下每个 50~250ms）。
 * 实测单次进出灯区导致 33 个程序重编译 → 主线程冻结 8.2 秒。
 *
 * 方案：启动时把固定数量（POOL_SIZE）的点光常驻场景（intensity=0 停泊在远处），
 * 业务代码通过 acquire()/release() 租用灯而不增删灯 → NUM_POINT_LIGHTS 恒定，
 * 着色器程序只编译一次，灯数变化引发的编译风暴彻底消失。
 *
 * 用法：
 *   const light = window.LightPool.acquire(ownerGroup, { color, intensity, distance, anchorPos });
 *   // 灯本体常驻 scene 根节点，通过 ownerGroup 内的锚点对象每帧同步世界坐标
 *   window.LightPool.release(ownerGroup);        // 按 owner 释放
 *   window.LightPool.releaseLight(light);        // 按灯引用释放
 *   window.LightPool.update();                   // 主循环每帧调用（同步跟随位置）
 *   window.LightPool.stats();                    // { size, inUse }
 *
 * acquire 返回 null 时（THREE 未就绪等），调用方应回退为直接 new PointLight 的旧行为。
 */
(function () {
  'use strict';

  const POOL_SIZE = 12;   // 常驻点光数量（涵盖：光剑×玩家数 + 附近传送门/广告位）
  const PARK_Y = -1000;   // 停泊高度（地下，不可见）

  function LightPool() {
    this._inited = false;
    this._scene = null;
    this._slots = [];
    this._v = null; // 复用的临时向量
  }

  LightPool.prototype.init = function (scene) {
    if (this._inited) return true;
    if (!scene || !window.THREE) return false;
    this._scene = scene;
    this._v = new window.THREE.Vector3();
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new window.THREE.PointLight(0xffffff, 0, 0, 2);
      light.position.set(0, PARK_Y, 0);
      light.__poolLight = true;
      scene.add(light);
      this._slots.push({ light: light, used: false, owner: null, anchor: null, acquiredAt: 0 });
    }
    this._inited = true;
    console.log('[LightPool] ✅ 点光灯池就绪：' + POOL_SIZE + ' 盏常驻，灯数从此恒定（不再触发挥着器重编译风暴）');
    return true;
  };

  /**
   * 租用一盏点光
   * @param {THREE.Object3D} owner - 归属组（释放时按它匹配；灯的跟随锚点挂在它内部）
   * @param {Object} opts - { color, intensity, distance, anchorPos:{x,y,z} }
   * @returns {THREE.PointLight|null} null 表示池不可用，调用方回退旧行为
   */
  LightPool.prototype.acquire = function (owner, opts) {
    opts = opts || {};
    const scene = this._scene || (window.gameWorld && window.gameWorld.scene);
    if (!this.init(scene)) return null;
    const T = window.THREE;

    let slot = null;
    for (let i = 0; i < this._slots.length; i++) {
      if (!this._slots[i].used) { slot = this._slots[i]; break; }
    }
    if (!slot) {
      // 池满：回收最早租出的灯（LRU）
      slot = this._slots[0];
      for (let i = 1; i < this._slots.length; i++) {
        if (this._slots[i].acquiredAt < slot.acquiredAt) slot = this._slots[i];
      }
      if (slot.anchor && slot.anchor.parent) slot.anchor.parent.remove(slot.anchor);
      console.warn('[LightPool] 池满（' + POOL_SIZE + '），回收最早租用的灯');
    } else if (slot.anchor && slot.anchor.parent) {
      slot.anchor.parent.remove(slot.anchor);
    }

    // 跟随锚点：挂在 owner 组内部（随组移动），灯本体常驻 scene 根
    const anchor = new T.Object3D();
    if (opts.anchorPos) {
      anchor.position.set(opts.anchorPos.x || 0, opts.anchorPos.y || 0, opts.anchorPos.z || 0);
    }
    if (owner && owner.isObject3D) owner.add(anchor);

    slot.used = true;
    slot.owner = owner || null;
    slot.anchor = anchor;
    slot.acquiredAt = performance.now();

    const light = slot.light;
    light.color.setHex(opts.color != null ? opts.color : 0xffffff);
    light.intensity = opts.intensity != null ? opts.intensity : 1;
    light.distance = opts.distance != null ? opts.distance : 0;
    return light;
  };

  LightPool.prototype._freeSlot = function (slot) {
    slot.used = false;
    slot.owner = null;
    slot.acquiredAt = 0;
    if (slot.anchor) {
      if (slot.anchor.parent) slot.anchor.parent.remove(slot.anchor);
      slot.anchor = null;
    }
    slot.light.intensity = 0;
    slot.light.distance = 0;
    slot.light.position.set(0, PARK_Y, 0);
  };

  /** 按归属组释放（该组内租用的所有灯都释放） */
  LightPool.prototype.release = function (owner) {
    if (!this._inited || !owner) return;
    for (let i = 0; i < this._slots.length; i++) {
      if (this._slots[i].used && this._slots[i].owner === owner) {
        this._freeSlot(this._slots[i]);
      }
    }
  };

  /** 按灯引用释放 */
  LightPool.prototype.releaseLight = function (light) {
    if (!this._inited || !light || !light.__poolLight) return false;
    for (let i = 0; i < this._slots.length; i++) {
      if (this._slots[i].light === light && this._slots[i].used) {
        this._freeSlot(this._slots[i]);
        return true;
      }
    }
    return false;
  };

  /** 主循环每帧调用：把停泊的灯同步到各自锚点的世界坐标 */
  LightPool.prototype.update = function () {
    if (!this._inited) return;
    for (let i = 0; i < this._slots.length; i++) {
      const s = this._slots[i];
      if (s.used && s.anchor) {
        s.anchor.getWorldPosition(this._v);
        s.light.position.copy(this._v);
      }
    }
  };

  LightPool.prototype.stats = function () {
    let inUse = 0;
    for (let i = 0; i < this._slots.length; i++) { if (this._slots[i].used) inUse++; }
    return { size: POOL_SIZE, inUse: inUse };
  };

  window.LightPool = new LightPool();
})();
