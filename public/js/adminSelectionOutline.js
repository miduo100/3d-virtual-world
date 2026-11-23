/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 管理员模式选中框：单位立方体线框 + 包围盒计算（2026-11-04）  v1
 * 依赖：THREE、buildingManager 实例（读取 world.scene / selectedObject / _selectionBox）
 * 不做：不做拾取、不改材质；buildingManager 只在 addHighlight/removeHighlight 里各调一行
 * 诊断：window.AdminSelectionOutline._diag()
 *
 * 为什么不用 THREE.BoxHelper：它的 update() 走 Box3.setFromObject，
 * 而 setFromObject 不看 visible，藏在模型下的灯泡手柄照样会被算进包围盒。
 */
(function () {
  'use strict';
  if (window.__ADMIN_LIGHTING_OFF) return;
  if (window.AdminSelectionOutline) return;

  var _geo = null;

  /** 单位立方体线框（-1..1，边长 2），用 scale 套到任意包围盒 */
  function getGeo() {
    if (_geo) return _geo;
    var v = [
      -1, -1, -1, 1, -1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, -1, 1, -1, -1, 1, -1, -1, -1, -1,
      -1, -1, 1, 1, -1, 1, 1, -1, 1, 1, 1, 1, 1, 1, 1, -1, 1, 1, -1, 1, 1, -1, -1, 1,
      -1, -1, -1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1, 1, -1, 1, 1, 1, -1, 1, -1, -1, 1, 1
    ];
    _geo = new THREE.BufferGeometry();
    _geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return _geo;
  }

  /** 累加模型所有网格的包围盒，跳过灯泡手柄 */
  function computeBounds(object) {
    var box = new THREE.Box3();
    var tmp = new THREE.Box3();
    object.updateWorldMatrix(true, true);
    object.traverse(function (child) {
      if (child.userData && child.userData.__modelLightingHandle) return;
      if (!child.isMesh && !child.isPoints && !child.isLine) return;
      var g = child.geometry;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox) return;
      tmp.copy(g.boundingBox).applyMatrix4(child.matrixWorld);
      box.union(tmp);
    });
    return box;
  }

  function applyBox(line, box3) {
    if (!line || !box3 || box3.isEmpty()) return;
    var center = box3.getCenter(new THREE.Vector3());
    var size = box3.getSize(new THREE.Vector3());
    line.position.copy(center);
    line.scale.set(
      Math.max(size.x, 0.01) / 2,
      Math.max(size.y, 0.01) / 2,
      Math.max(size.z, 0.01) / 2
    );
  }

  function apply(bm, object) {
    if (!bm || !bm.world || !bm.world.scene) return;
    remove(bm);
    if (!object) return;
    var line = new THREE.LineSegments(getGeo(), new THREE.LineBasicMaterial({
      color: 0x66ccff, depthTest: false, transparent: true, opacity: 0.9
    }));
    line.name = '__adminSelectionBox';
    line.renderOrder = 999;
    line.raycast = function () {};  // 不参与拾取，避免挡住点击
    applyBox(line, computeBounds(object));
    // 必须挂 scene：挂到模型下会跟着模型缩放一起缩
    bm.world.scene.add(line);
    bm._selectionBox = line;
  }

  function update(bm) {
    if (!bm || !bm._selectionBox || bm._boxUpdateRAF || !bm.selectedObject) return;
    bm._boxUpdateRAF = requestAnimationFrame(function () {
      bm._boxUpdateRAF = null;
      var line = bm._selectionBox;
      if (!line || !bm.selectedObject) return;
      applyBox(line, computeBounds(bm.selectedObject));
    });
  }

  function remove(bm, object) {
    if (!bm) return;
    var line = bm._selectionBox;
    if (line) {
      if (line.parent) line.parent.remove(line);
      // 几何是模块级共享的，只销毁材质
      if (line.material) line.material.dispose();
      bm._selectionBox = null;
    }
    if (bm._boxUpdateRAF) {
      cancelAnimationFrame(bm._boxUpdateRAF);
      bm._boxUpdateRAF = null;
    }
    // 清掉旧实现可能残留的标记
    if (object && typeof object.traverse === 'function') {
      object.traverse(function (child) {
        if (child.userData && child.userData.originalEmissive !== undefined) {
          delete child.userData.originalEmissive;
        }
      });
    }
  }

  /** 部件级选中框：橙色细线，紧贴单个 mesh（与模型青蓝大框区分） */
  function applyToMesh(bm, mesh) {
    if (!bm || !bm.world || !bm.world.scene) return;
    removeMesh(bm);
    if (!mesh) return;
    mesh.updateWorldMatrix(true, false);
    var box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;
    var line = new THREE.LineSegments(getGeo(), new THREE.LineBasicMaterial({
      color: 0xffab40, depthTest: false, transparent: true, opacity: 0.95
    }));
    line.name = '__adminMeshBox';
    line.renderOrder = 998;
    line.raycast = function () {};
    applyBox(line, box);
    bm.world.scene.add(line);
    bm._meshBox = line;
  }

  function removeMesh(bm) {
    if (!bm) return;
    var line = bm._meshBox;
    if (!line) return;
    if (line.parent) line.parent.remove(line);
    if (line.material) line.material.dispose();
    bm._meshBox = null;
  }

  window.AdminSelectionOutline = {
    apply: apply,
    update: update,
    remove: remove,
    applyToMesh: applyToMesh,
    removeMesh: removeMesh,
    _computeBounds: computeBounds,
    _diag: function (bm) {
      return {
        hasBox: !!(bm && bm._selectionBox),
        scale: bm && bm._selectionBox ? bm._selectionBox.scale.toArray() : null
      };
    }
  };
})();
