/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 管理员模式模型灯光 · 3D 交互层：放灯拾取、灯泡手柄、拖动、删除（2026-11-04）  v1
 * 依赖：ModelLighting（数据与渲染）、buildingManager（选中对象与 TransformControls）、UI（通知）
 * 不做：不画面板、不管保存请求、不动运行时灯池调度
 * 诊断：window.AdminModelLightingTool._diag()
 */
(function () {
  'use strict';
  if (window.__ADMIN_LIGHTING_OFF) return;
  if (window.AdminModelLightingTool) return;

  var DEFAULT_COLOR = '#ffdca8';
  var DEFAULT_INTENSITY = 40;
  var DEFAULT_DISTANCE = 16;

  var bm = null;            // buildingManager 实例
  var root = null;          // 当前编辑的模型根节点
  var entry = null;         // generatedBuildings 条目（含 data.custom_config）
  var handles = [];         // 灯泡手柄
  var selectedId = null;
  var placing = false;
  var raycaster = null;
  var pointer = null;
  var sizeTimer = null;
  var bound = false;
  var draggingNow = false;

  function Bus() { return window.AdminModelLightingBus; }

  function notify(text, sub) {
    if (Bus()) Bus().notify(text, sub);
  }

  // ---------------- 数据 ----------------

  function entryOf(obj) {
    if (!obj || !obj.userData) return null;
    var id = obj.userData.worldObjectId;
    if (id === undefined || id === null) return null;
    var store = bm && bm.world && bm.world.generatedBuildings;
    if (!store) return null;
    return store.get(id) || store.get(String(id)) || null;
  }

  function dataOf() {
    return entry && entry.data ? entry.data : null;
  }

  function lights() {
    var d = dataOf();
    return d && window.ModelLighting ? window.ModelLighting.readLights(d.custom_config) : [];
  }

  function supported(obj) {
    if (!obj || typeof obj.traverse !== 'function') return false;
    var e = entryOf(obj);
    return !!(e && e.data && e.data.type === 'uploaded_model');
  }

  function fireChange() {
    if (Bus()) Bus().fire();
  }

  function markDirty() {
    if (Bus()) Bus().markDirty();
  }

  // ---------------- 渲染 ----------------

  /** 应用配置到模型：走 world 模式，复用固定灯槽，绝不挂独立 PointLight */
  function applyAll(rebuild) {
    if (!root || !window.ModelLighting) return;
    var d = dataOf();
    if (!d) return;
    try {
      window.ModelLighting.apply(root, d.custom_config, { world: true });
      if (window.ModelLighting.setEditorFocus) {
        window.ModelLighting.setEditorFocus(root, selectedId);
      }
    } catch (e) {
      console.warn('[AdminLighting] 应用灯光配置失败', e);
    }
    if (rebuild !== false) buildHandles();
  }

  function saveLights(list) {
    var d = dataOf();
    if (!d || !window.ModelLighting) return;
    d.custom_config = window.ModelLighting.writeLights(d.custom_config, list);
    applyAll(true);
    fireChange();
    markDirty();
  }

  // ---------------- 手柄 ----------------

  function H() { return window.AdminModelLightingHandles; }

  function removeHandles() {
    if (!H()) { handles = []; return; }
    handles = H().destroy(handles, bm && bm.transformControls);
  }

  function buildHandles() {
    removeHandles();
    if (!root || !H()) return;
    handles = H().create(root, lights());
    updateHandleSizes();
    syncHandleStyles();
    if (selectedId) attachGizmo();
  }

  function attachGizmo() {
    if (!bm || !bm.transformControls) return;
    var h = H() ? H().find(handles, selectedId) : null;
    if (!h) return;
    bm.transformControls.setMode('translate');
    bm.transformControls.attach(h);
  }

  function syncHandleStyles() {
    if (H()) H().syncStyles(handles, lights(), selectedId);
  }

  function updateHandleSizes() {
    if (!H() || !root || !bm) return;
    H().resize(handles, root, bm.camera, selectedId);
  }

  // ---------------- 选中灯 ----------------

  function select(id) {
    selectedId = id;
    placing = false;
    syncHandleStyles();
    attachGizmo();
    if (window.ModelLighting && window.ModelLighting.setEditorFocus) {
      window.ModelLighting.setEditorFocus(root, selectedId);
    }
    fireChange();
  }

  function clearSelection() {
    selectedId = null;
    placing = false;
    syncHandleStyles();
    if (bm && bm.transformControls && root) bm.transformControls.attach(root);
    if (window.ModelLighting && window.ModelLighting.setEditorFocus) {
      window.ModelLighting.setEditorFocus(root, null);
    }
    fireChange();
  }

  function deleteSelected() {
    if (!selectedId) return;
    var list = lights().filter(function (l) { return l.id !== selectedId; });
    selectedId = null;
    saveLights(list);
    if (bm && bm.transformControls && root) bm.transformControls.attach(root);
  }

  // ---------------- 放灯 ----------------

  function setPointer(event) {
    if (!bm || !bm.renderer) return;
    var rect = bm.renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, bm.camera);
  }

  function visibleChain(node) {
    var cur = node;
    while (cur) {
      if (!cur.visible) return false;
      if (cur === root) return true;
      cur = cur.parent;
    }
    return false;
  }

  function addAt(event) {
    if (!root || !window.ModelLighting) return;
    // 切到后台标签页时 rAF 被节流，matrixWorld 会滞后导致 raycast 落空
    root.updateMatrixWorld(true);
    setPointer(event);
    var hits = raycaster.intersectObject(root, true).filter(function (h) {
      return h.object.isMesh && !h.object.userData.isPickProxy &&
        !h.object.userData.__modelLightingHandle && visibleChain(h.object);
    });
    if (!hits.length) {
      notify('⚠️ 请点击模型的真实表面', '');
      return;
    }
    var hit = hits[0];
    var point = hit.point.clone();
    if (hit.face) {
      var normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      point.addScaledVector(normal, 0.12);
    }
    root.updateWorldMatrix(true, false);
    var local = root.worldToLocal(point);

    var list = lights();
    var id = 'light_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1000);
    list.push(window.ModelLighting.normalizeLight({
      id: id, offset: local, color: DEFAULT_COLOR,
      intensity: DEFAULT_INTENSITY, distance: DEFAULT_DISTANCE
    }, list.length));
    placing = false;
    saveLights(list);
    select(id);

    var maxPerObject = window.ModelLighting.MODEL_REAL_LIGHT_SLOTS || 4;
    var dcfg = dataOf();
    var hasGlow = !!(dcfg && window.ModelSurface && window.ModelSurface._diag(dcfg.custom_config).enabled > 0);
    var hint = hasGlow ? '点击部位已发光，可拖动灯泡调整位置' : '想让这个部位发光？点「调部件发光」再点它';
    if (list.length > maxPerObject) {
      notify('💡 已添加第 ' + list.length + ' 盏灯',
        '超出 ' + maxPerObject + ' 盏的部分只有自发光和光晕，不占真实灯槽');
    } else {
      notify('💡 已添加灯光', hint);
    }
  }

  // ---------------- 供 adminModelSurfacePick 调用 ----------------

  function getConfig() {
    var d = dataOf();
    return d ? d.custom_config : null;
  }

  function setConfig(cfg) {
    var d = dataOf();
    if (!d) return;
    d.custom_config = cfg;
    applyAll(false);
    fireChange();
    markDirty();
  }

  /**
   * 把当前模型的 custom_config 写回世界物件（2026-11-25）
   * 供部件删除等模块复用，口径与面板的「保存」完全一致（PUT /api/world/objects/:id）
   * @returns {Promise} 成功 resolve 接口返回，失败 reject Error
   */
  function saveConfig() {
    var d = dataOf();
    if (!d) return Promise.reject(new Error('没有可保存的模型'));
    var id = d.id || (root && root.userData && root.userData.worldObjectId);
    if (!id) return Promise.reject(new Error('缺少物件 id'));
    return fetch('/api/world/objects/' + id, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: JSON.stringify({ custom_config: d.custom_config })
    }).then(function (r) {
      return r.json();
    }).then(function (res) {
      if (!res || !res.success) throw new Error((res && res.error) || '保存失败');
      return res;
    });
  }

  function beginPlace() {
    if (!root) return false;
    placing = true;
    if (window.AdminModelSurfacePick) window.AdminModelSurfacePick.cancel();
    if (window.AdminModelPartDelete) window.AdminModelPartDelete.cancel();
    selectedId = null;
    if (bm && bm.transformControls) bm.transformControls.detach();
    fireChange();
    return true;
  }

  function cancelPlace() {
    placing = false;
    fireChange();
  }

  // ---------------- 事件 ----------------

  function onClick(event) {
    if (!root || !bm || !bm.renderer) return;
    if (event.target !== bm.renderer.domElement) return;
    if (bm.transformControls && bm.transformControls.dragging) return;

    // 部件删除模式（2026-11-25）：优先级最高，点哪隐藏哪，抢在其他拾取之前
    var partDel = window.AdminModelPartDelete;
    if (partDel && partDel.isActive()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      partDel.pick(event);
      return;
    }

    var picker = window.AdminModelSurfacePick;
    if (picker && picker.isPicking()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      picker.pick(event);
      return;
    }

    if (placing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      addAt(event);
      return;
    }
    if (handles.length) {
      setPointer(event);
      var hits = raycaster.intersectObjects(handles, false);
      if (hits.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        select(hits[0].object.userData.modelLightId);
        return;
      }
    }

    // 没点中手柄：若点到的是已配置发光的部件，直接切过去（不用先点按钮）
    if (picker && picker.handlePlainClick(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function onKeyDown(event) {
    if (!root) return;
    var tag = event.target && event.target.tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;

    // 必须抢在 buildingManager 的 window 监听之前（它会把 Delete 当成删除整个模型）
    if (event.key === 'Escape') {
      if (window.AdminModelPartDelete && window.AdminModelPartDelete.isActive()) {
        event.preventDefault(); event.stopImmediatePropagation();
        window.AdminModelPartDelete.cancel();
        return;
      }
      if (placing) {
        event.preventDefault(); event.stopImmediatePropagation(); cancelPlace(); return;
      }
      if (window.AdminModelSurfacePick && window.AdminModelSurfacePick.isPicking()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.AdminModelSurfacePick.cancel();
        return;
      }
      if (selectedId) {
        event.preventDefault(); event.stopImmediatePropagation(); clearSelection(); return;
      }
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      deleteSelected();
    }
  }

  /** 拖动中：只同步内存与灯槽位置，不重绘面板（每帧 render 会卡） */
  function onDragChange() {
    if (!bm || !bm.transformControls) return;
    var handle = bm.transformControls.object;
    if (!handle || !handle.userData || !handle.userData.__modelLightingHandle) return;
    draggingNow = true;
    var id = handle.userData.modelLightId;
    var list = lights().map(function (l) {
      if (l.id === id) l.offset = { x: handle.position.x, y: handle.position.y, z: handle.position.z };
      return l;
    });
    var d = dataOf();
    if (!d || !window.ModelLighting) return;
    d.custom_config = window.ModelLighting.writeLights(d.custom_config, list);
    // 松手时 buildingManager 的 saveChanges 已被旁路包装拦住，保存由面板防抖负责
    if (window.ModelLighting.updateLightOffset) {
      window.ModelLighting.updateLightOffset(root, id, handle.position);
    }
  }

  /** 松手：重绘一次并标记落库 */
  function onDragEnd(event) {
    if (event && event.value) return;
    if (!draggingNow) return;
    draggingNow = false;
    fireChange();
    markDirty();
  }

  // ---------------- 生命周期 ----------------

  function cleanupCurrent() {
    placing = false;
    if (window.AdminModelSurfacePick) window.AdminModelSurfacePick.cancel();
    // 换模型时退出部件删除模式，避免对着新模型误删
    if (window.AdminModelPartDelete) window.AdminModelPartDelete.cancel();
    if (window.AdminSelectionOutline) window.AdminSelectionOutline.removeMesh(bm);
    removeHandles();
    selectedId = null;
    if (root && window.ModelLighting) {
      if (window.ModelLighting.setEditorFocus) window.ModelLighting.setEditorFocus(root, null);
      if (window.ModelHaloField) window.ModelHaloField.unregister(root);
      var d = dataOf();
      if (d) window.ModelLighting.apply(root, d.custom_config, { world: true });
    }
    root = null;
    entry = null;
  }

  function sync() {
    if (!bm) return;
    var obj = bm.selectedObject;
    if (obj === root) return;
    if (root) cleanupCurrent();
    if (!supported(obj)) {
      root = null;
      entry = null;
      fireChange();
      return;
    }
    root = obj;
    entry = entryOf(obj);
    applyAll(true);
    fireChange();
  }

  /** 旁路包装：拖灯手柄时不要保存模型变换（原文件 0 改动） */
  function patchSave() {
    if (!bm || bm.__adminLightingSavePatched) return;
    var orig = bm.saveChanges.bind(bm);
    bm.saveChanges = function () {
      var tc = bm.transformControls;
      if (tc && tc.object && tc.object.userData && tc.object.userData.__modelLightingHandle) {
        return Promise.resolve(true);
      }
      return orig.apply(null, arguments);
    };
    bm.__adminLightingSavePatched = true;
  }

  /** 旁路包装：选中/取消选中后同步编辑态（原文件 0 改动） */
  function patchSelection() {
    if (!bm || bm.__adminLightingSelectPatched) return;
    var origSelect = bm.selectObject.bind(bm);
    bm.selectObject = function (obj) {
      var r = origSelect(obj);
      try { sync(); } catch (e) { console.warn('[AdminLighting] 选中同步失败', e); }
      return r;
    };
    var origDeselect = bm.deselectObject.bind(bm);
    bm.deselectObject = function () {
      cleanupCurrent();
      var r = origDeselect();
      fireChange();
      return r;
    };
    bm.__adminLightingSelectPatched = true;
  }

  function attach(manager) {
    if (bound) return true;
    if (!manager || !manager.renderer || typeof THREE === 'undefined') return false;
    if (!window.AdminModelLightingHandles) return false;
    bm = manager;
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    bm.renderer.domElement.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
    if (bm.transformControls) {
      bm.transformControls.addEventListener('objectChange', onDragChange);
      bm.transformControls.addEventListener('dragging-changed', onDragEnd);
    }
    patchSave();
    patchSelection();
    sizeTimer = setInterval(updateHandleSizes, 150);
    bound = true;
    return true;
  }

  function detach() {
    if (!bound) return;
    cleanupCurrent();
    if (bm && bm.renderer) bm.renderer.domElement.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    if (bm && bm.transformControls) {
      bm.transformControls.removeEventListener('objectChange', onDragChange);
      bm.transformControls.removeEventListener('dragging-changed', onDragEnd);
    }
    if (sizeTimer) { clearInterval(sizeTimer); sizeTimer = null; }
    if (H()) H().disposeGeo();
    bound = false;
  }

  window.AdminModelLightingTool = {
    attach: attach,
    detach: detach,
    sync: sync,
    isReady: function () { return bound; },
    hasTarget: function () { return !!root; },
    getLights: lights,
    getSelectedId: function () { return selectedId; },
    getSelected: function () {
      var list = lights();
      for (var i = 0; i < list.length; i++) if (list[i].id === selectedId) return list[i];
      return null;
    },
    selectLight: select,
    clearSelection: clearSelection,
    beginPlace: beginPlace,
    cancelPlace: cancelPlace,
    isPlacing: function () { return placing; },
    getRoot: function () { return root; },
    getConfig: getConfig,
    setConfig: setConfig,
    saveConfig: saveConfig,

    deleteSelected: deleteSelected,
    refresh: function () { applyAll(true); },
    onChange: function (cb) { if (Bus()) Bus().onChange(cb); },
    onDirty: function (cb) { if (Bus()) Bus().onDirty(cb); },
    _diag: function () {
      return {
        bound: bound,
        target: !!(root && root.userData && root.userData.worldObjectId),
        objectId: root && root.userData && root.userData.worldObjectId,
        lights: lights().length,
        handles: handles.length,
        selectedId: selectedId,
        placing: placing,
        slots: window.ModelLighting ? window.ModelLighting.modelLightStats() : null
      };
    }
  };
})();
