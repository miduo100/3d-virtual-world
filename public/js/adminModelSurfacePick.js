/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 管理员模式 · 部件发光拾取：点模型表面选部件、写回 surfaces[]（2026-11-05）  v1
 * 依赖：AdminModelLightingTool（root / raycast / 读写配置）、ModelSurface、AdminSelectionOutline
 * 不做：不渲染面板、不管点光源
 * 诊断：window.AdminModelSurfacePick._diag()
 */
(function () {
  'use strict';
  if (window.__ADMIN_LIGHTING_OFF) return;
  if (window.AdminModelSurfacePick) return;

  var picking = false;
  var target = null;
  var listeners = [];
  var recent = [];      // 最近编辑过的部件 id，最近的在前
  var _rc = null;
  var _pt = null;

  function touch(id) {
    if (!id) return;
    recent = recent.filter(function (x) { return x !== id; });
    recent.unshift(id);
    if (recent.length > 12) recent.length = 12;
  }

  function Tool() { return window.AdminModelLightingTool; }

  /** 屏幕事件 → 命中的 mesh 与材质下标（不依赖 Tool 的内部 raycaster） */
  function raycastAt(event) {
    var t = Tool();
    var root = t && t.getRoot();
    var world = window.gameWorld;
    if (!root || !world || !world.camera || !world.renderer) return null;
    if (!_rc) { _rc = new THREE.Raycaster(); _pt = new THREE.Vector2(); }
    root.updateMatrixWorld(true);
    var rect = world.renderer.domElement.getBoundingClientRect();
    _pt.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    _rc.setFromCamera(_pt, world.camera);
    var hits = _rc.intersectObject(root, true).filter(function (h) {
      return h.object.isMesh && h.object.visible !== false &&
        !h.object.userData.isPickProxy && !h.object.userData.__modelLightingHandle;
    });
    if (!hits.length) return null;
    var hit = hits[0];
    return {
      mesh: hit.object,
      materialIndex: hit.face && hit.face.materialIndex ? hit.face.materialIndex : 0
    };
  }

  function notify(text, sub) {
    if (window.UI && UI.showNotification) UI.showNotification(text, sub || '', 2200);
  }

  function fire() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { console.warn('[AdminSurfacePick] 回调失败', e); }
    }
  }

  function onChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  function begin() {
    var t = Tool();
    if (!t || !t.hasTarget()) return false;
    picking = true;
    target = null;
    t.cancelPlace();
    t.clearSelection();
    fire();
    return true;
  }

  function cancel() {
    picking = false;
    fire();
  }

  function clear() {
    target = null;
    var bm = window.gameWorld && window.gameWorld.buildingManager;
    if (window.AdminSelectionOutline) window.AdminSelectionOutline.removeMesh(bm);
    fire();
  }

  /** 由 Tool 的 canvas 点击回调转进来 */
  function pick(event) {
    var t = Tool();
    if (!t || !window.ModelSurface) return;
    var hit = raycastAt(event);
    if (!hit) {
      notify('⚠️ 请点击模型的真实表面', '');
      return;
    }
    if (!window.ModelSurface.supportsEmissive(hit.mesh, hit.materialIndex)) {
      notify('⚠️ 这个材质不支持自发光', '只能用真实灯光照亮它');
      return;
    }
    var root = t.getRoot();
    target = window.ModelSurface.makeTarget(root, hit.mesh, hit.materialIndex);
    var cfg = t.getConfig();
    var existing = cfg ? window.ModelSurface.find(cfg, target) : null;
    if (existing) {
      for (var k in existing) target[k] = existing[k];
    } else {
      // 新部件：点它就是要设发光，默认打开
      target.enabled = true;
    }

    picking = false;
    var bm = window.gameWorld && window.gameWorld.buildingManager;
    if (window.AdminSelectionOutline) window.AdminSelectionOutline.applyToMesh(bm, hit.mesh);

    // 新部件立刻落一条，胶囊里才看得到
    if (!existing) {
      var next = window.ModelSurface.upsert(cfg || {}, target, {});
      t.setConfig(next);
      var saved = window.ModelSurface.find(next, target);
      if (saved) {
        for (var k2 in saved) target[k2] = saved[k2];
        touch(saved.id);
      }
    } else {
      touch(existing.id);
    }
    fire();
  }

  /** 写回一条发光设置（新增或更新），落库交给 Tool 的 setConfig */
  function commit(patch) {
    var t = Tool();
    if (!t || !target || !window.ModelSurface) return;
    var cfg = t.getConfig();
    if (!cfg && cfg !== null) return;
    var next = window.ModelSurface.upsert(cfg || {}, target, patch);
    t.setConfig(next);
    var saved = window.ModelSurface.find(next, target);
    if (saved) for (var k in saved) target[k] = saved[k];
    fire();
  }

  function removeCurrent() {
    var t = Tool();
    if (!t || !target || !window.ModelSurface) return;
    var cfg = t.getConfig();
    if (!cfg) return;
    t.setConfig(window.ModelSurface.remove(cfg, target));
    target = null;
    var bm = window.gameWorld && window.gameWorld.buildingManager;
    if (window.AdminSelectionOutline) window.AdminSelectionOutline.removeMesh(bm);
    fire();
  }

  /** 已配置的部件发光清单（含未启用的），给面板胶囊用 */
  function listSurfaces() {
    var t = Tool();
    if (!t) return [];
    var cfg = t.getConfig();
    return cfg && window.ModelSurface ? window.ModelSurface.read(cfg) : [];
  }

  /** 按 id 选中某个已配置部件，并框住对应 mesh */
  function selectById(id) {
    var list = listSurfaces();
    var hit = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { hit = list[i]; break; }
    }
    if (!hit) return null;
    target = {
      enabled: hit.enabled, color: hit.color, intensity: hit.intensity,
      useMap: hit.useMap, scope: hit.scope, meshName: hit.meshName,
      materialName: hit.materialName, materialIndex: hit.materialIndex,
      path: hit.path, id: hit.id
    };
    var t = Tool();
    var root = t && t.getRoot();
    var bm = window.gameWorld && window.gameWorld.buildingManager;
    if (root && bm && window.AdminSelectionOutline) {
      var found = null;
      root.traverse(function (m) {
        if (found || !m.isMesh) return;
        var probe = window.ModelSurface.makeTarget(root, m, hit.materialIndex);
        if (probe.path === hit.path) found = m;
      });
      if (found) window.AdminSelectionOutline.applyToMesh(bm, found);
      else window.AdminSelectionOutline.removeMesh(bm);
    }
    picking = false;
    touch(hit.id);
    fire();
    return hit;
  }

  /** 当前 + 最近编辑的几个（面板只显示这些，避免 39 个胶囊糊一屏） */
  function recentSurfaces(limit) {
    var list = listSurfaces();
    var map = {};
    for (var i = 0; i < list.length; i++) map[list[i].id] = list[i];
    var out = [];
    var seen = {};
    if (target && map[target.id] && !seen[target.id]) { out.push(map[target.id]); seen[target.id] = 1; }
    for (var j = 0; j < recent.length && out.length < limit; j++) {
      var s = map[recent[j]];
      if (s && !seen[s.id]) { out.push(s); seen[s.id] = 1; }
    }
    return out;
  }

  /** 未进入任何模式时，点已配置发光的部件 → 直接切过去 */
  function handlePlainClick(event) {
    var t = Tool();
    if (!t || !t.getRoot() || !window.ModelSurface) return false;
    var hit = raycastAt(event);
    if (!hit) return false;
    var root = t.getRoot();
    var probe = window.ModelSurface.makeTarget(root, hit.mesh, hit.materialIndex);
    var cfg = t.getConfig();
    var existing = cfg ? window.ModelSurface.find(cfg, probe) : null;
    if (!existing) return false;
    selectById(existing.id);
    return true;
  }

  /** 已启用的部件发光清单 */
  function glowing() {
    var t = Tool();
    if (!t) return [];
    var cfg = t.getConfig();
    if (!cfg || !window.ModelSurface) return [];
    return window.ModelSurface.read(cfg).filter(function (s) { return s.enabled; });
  }


  window.AdminModelSurfacePick = {
    begin: begin,
    cancel: cancel,
    clear: clear,
    pick: pick,
    commit: commit,
    removeCurrent: removeCurrent,
    glowing: glowing,
    listSurfaces: listSurfaces,
    selectById: selectById,
    recentSurfaces: recentSurfaces,
    handlePlainClick: handlePlainClick,
    getTarget: function () { return target; },
    isPicking: function () { return picking; },
    onChange: onChange,
    _diag: function () {
      return { picking: picking, hasTarget: !!target, surfaces: listSurfaces().length };
    }
  };
})();
