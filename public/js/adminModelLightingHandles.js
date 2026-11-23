/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 管理员模式模型灯光 · 灯泡手柄：双层球 + 遮挡感知（2026-11-04）  v2
 * 依赖：THREE、ModelLighting.colorHex
 * 不做：不持有编辑状态（root / selectedId 全由调用方传入），不绑事件
 * 诊断：window.AdminModelLightingHandles._diag(handles)
 *
 * 为什么是两层：
 *   内层核心球 depthTest=true  → 在模型外面是实心球，拖进模型里会被真实遮住
 *   外壳 depthTest=false + BackSide → 永远可见的淡轮廓，保证"看不见也能找到"
 * 于是"在外面"和"闷在里面"在屏幕上长得不一样，靠视觉就能判断深度。
 */
(function () {
  'use strict';
  if (window.__ADMIN_LIGHTING_OFF) return;
  if (window.AdminModelLightingHandles) return;

  var INSIDE_COLOR = 0x8fb8ff;   // 在模型内部时外壳偏冷色
  var SHELL_OPACITY_OUT = 0.26;
  var SHELL_OPACITY_IN = 0.55;

  var _geo = null;
  var _box = null;
  var _tmp = null;
  var _wp = null;
  var _ws = null;

  function geo() {
    if (!_geo) _geo = new THREE.SphereGeometry(1, 12, 8);
    return _geo;
  }

  function colorHex(color) {
    if (window.ModelLighting && window.ModelLighting.colorHex) return window.ModelLighting.colorHex(color);
    return 0xffffff;
  }

  /** 模型自身的包围盒，排除灯泡手柄 */
  function modelBox(root) {
    if (!_box) { _box = new THREE.Box3(); _tmp = new THREE.Box3(); }
    _box.makeEmpty();
    root.updateWorldMatrix(true, true);
    root.traverse(function (o) {
      if (o.userData && o.userData.__modelLightingHandle) return;
      if (!o.isMesh) return;
      var g = o.geometry;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox) return;
      _tmp.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      _box.union(_tmp);
    });
    return _box;
  }

  /** 按灯列表建手柄：core 是手柄本体，shell 是永远可见的轮廓 */
  function create(root, lights) {
    var out = [];
    for (var i = 0; i < lights.length; i++) {
      var item = lights[i];
      if (!item.enabled) continue;

      var core = new THREE.Mesh(geo(), new THREE.MeshBasicMaterial({
        color: colorHex(item.color),
        transparent: true, opacity: 0.95,
        depthTest: true, depthWrite: false
      }));
      core.name = '__model_light_' + item.id;
      core.renderOrder = 10000;
      core.userData.__modelLightingHandle = true;
      core.userData.modelLightId = item.id;
      core.userData.baseColor = item.color;
      core.position.set(item.offset.x, item.offset.y, item.offset.z);

      var shell = new THREE.Mesh(geo(), new THREE.MeshBasicMaterial({
        color: colorHex(item.color),
        transparent: true, opacity: SHELL_OPACITY_OUT,
        depthTest: false, depthWrite: false, side: THREE.BackSide
      }));
      shell.renderOrder = 10001;
      shell.raycast = function () {};
      shell.userData.__modelLightingHandle = true;   // 包围盒计算也要跳过它
      core.add(shell);

      root.add(core);
      out.push(core);
    }
    return out;
  }

  /** 销毁手柄；若正被 gizmo 挂着先 detach */
  function destroy(handles, tc) {
    if (tc) {
      var tcObj = tc.object;
      if (tcObj && tcObj.userData && tcObj.userData.__modelLightingHandle) tc.detach();
    }
    for (var i = 0; i < handles.length; i++) {
      var h = handles[i];
      for (var j = h.children.length - 1; j >= 0; j--) {
        var c = h.children[j];
        if (c.material) c.material.dispose();
        h.remove(c);
      }
      if (h.parent) h.parent.remove(h);
      if (h.material) h.material.dispose();
    }
    return [];
  }

  function find(handles, id) {
    for (var i = 0; i < handles.length; i++) {
      if (handles[i].userData.modelLightId === id) return handles[i];
    }
    return null;
  }

  /** 颜色 / 透明度跟随配置，选中态用白色 */
  function syncStyles(handles, lights, selectedId) {
    for (var i = 0; i < handles.length; i++) {
      var h = handles[i];
      var item = null;
      for (var j = 0; j < lights.length; j++) {
        if (lights[j].id === h.userData.modelLightId) { item = lights[j]; break; }
      }
      if (!item) continue;
      h.material.color.set(colorHex(h.userData.modelLightId === selectedId ? '#ffffff' : item.color));
      h.material.opacity = item.enabled ? 0.95 : 0.35;
    }
  }

  /**
   * 手柄尺寸随相机距离自适应，同时判断是否被模型包住。
   * 由 Tool 的 150ms 定时器驱动，不进 animate。
   */
  function resize(handles, root, camera, selectedId) {
    if (!root || !camera || !handles.length) return;
    if (!_wp) { _wp = new THREE.Vector3(); _ws = new THREE.Vector3(); }
    var box = modelBox(root);
    root.getWorldScale(_ws);

    for (var i = 0; i < handles.length; i++) {
      var h = handles[i];
      h.getWorldPosition(_wp);
      var r = Math.min(0.65, Math.max(0.08, _wp.distanceTo(camera.position) * 0.012));
      if (h.userData.modelLightId === selectedId) r *= 1.35;
      h.scale.set(
        r / Math.max(_ws.x, 0.0001),
        r / Math.max(_ws.y, 0.0001),
        r / Math.max(_ws.z, 0.0001)
      );

      var shell = h.children[0];
      if (shell && shell.material) {
        var inside = box.containsPoint(_wp);
        if (inside) {
          shell.material.color.set(INSIDE_COLOR);
          shell.material.opacity = SHELL_OPACITY_IN;
        } else {
          shell.material.color.copy(h.material.color);
          shell.material.opacity = SHELL_OPACITY_OUT;
        }
        h.userData.insideModel = inside;
      }
    }
  }

  function disposeGeo() {
    if (_geo) { _geo.dispose(); _geo = null; }
  }

  window.AdminModelLightingHandles = {
    create: create,
    destroy: destroy,
    find: find,
    syncStyles: syncStyles,
    resize: resize,
    disposeGeo: disposeGeo,
    _diag: function (handles) {
      if (!handles) return { count: 0, inside: 0 };
      var inside = 0;
      for (var i = 0; i < handles.length; i++) if (handles[i].userData.insideModel) inside++;
      return { count: handles.length, inside: inside };
    }
  };
})();
