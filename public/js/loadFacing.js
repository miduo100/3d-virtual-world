/**
 * 面向优先加载辅助（LoadFacing）—— 2026-09-08 首屏体验优化
 *
 * 语义：同加载优先级层级内，玩家视野正面（±90° 水平扇区）的对象先加载，
 *   背后扇区延后——玩家转过来的方向总是先"到货"，首屏可玩时间提前。
 *
 * 朝向约定（与 player.js:745-747/:792 注释一致）：
 *   θ = MOUSE.rotationY，视线方向 = (sinθ, 0, cosθ)
 *   相机第三人称摆位 = player − (sinθ,cosθ)·d，视线朝向 (sinθ,cosθ)。
 *
 * 用法（world.js 两处排序比较器内，同层级 tiebreaker）：
 *   const fA = window.LoadFacing.sector(a, pp);
 *   const fB = window.LoadFacing.sector(b, pp);
 *   if (fA !== fB) return fB - fA;   // front(1) 优先于 back(0)
 *
 * 注意：yaw 以 250ms 节流刷新并缓存，单次 sort（毫秒级）内比较器结果自洽；
 *   pp 缺失（玩家未就绪）时一律返回 0，即不做任何偏置，行为与旧排序一致。
 */
(function () {
  'use strict';
  if (window.LoadFacing) return;

  var _yaw = 0;
  var _yawAt = 0;
  var REFRESH_MS = 250;

  function refreshYaw() {
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - _yawAt > REFRESH_MS) {
      _yawAt = now;
      var m = window.MOUSE;
      if (m && typeof m.rotationY === 'number') _yaw = m.rotationY;
    }
  }

  /**
   * 对象相对玩家的扇区分类：1=正面(±90°)，0=背后
   * @param {Object} obj - 带 position_x/position_z 的世界对象
   * @param {THREE.Vector3|null} pp - 玩家位置（null 时返回 0，不偏置）
   */
  function sector(obj, pp) {
    if (!pp || !obj) return 0;
    refreshYaw();
    var dx = (obj.position_x || 0) - pp.x;
    var dz = (obj.position_z || 0) - pp.z;
    var len2 = dx * dx + dz * dz;
    if (len2 < 1) return 1; // 脚下对象按正面处理（马上就要用）
    var fx = Math.sin(_yaw), fz = Math.cos(_yaw);
    // 水平夹角 < 90° ⇔ 归一化点积 > 0
    return (dx * fx + dz * fz) / Math.sqrt(len2) > 0 ? 1 : 0;
  }

  window.LoadFacing = {
    sector: sector,
    /** 手动刷新 yaw 缓存（一般无需调用，sector 自带节流刷新） */
    updateYaw: refreshYaw,
  };
})();
