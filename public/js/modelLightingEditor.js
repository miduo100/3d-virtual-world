/**
 * 世界编辑器模型灯光：表面放灯、手柄点选/拖动/删除、参数预览与保存。
 * 依赖 ModelLighting 及 world_editor.html 的全局编辑器对象。
 */
(function () {
  'use strict';

  var _obj = null;
  var _placing = false;
  var _bindingSurface = false;
  var _selectedId = null;
  var _handles = [];
  var _panel = null;
  var _saveTimer = null;
  var _raycaster = null;
  var _pointer = null;
  var _sphere = null;
  var _patched = false;
  var _ready = false;
  var _lastSurfaceApplied = 0;

  function notify(text, type) {
    if (typeof showNotification === 'function') showNotification(text, type || 'info');
  }
  function supported(obj) {
    if (!obj || !obj.mesh || !obj.data || obj.data.type !== 'uploaded_model') return false;
    return !(window.EditorObjectLock && window.EditorObjectLock.isLocked(obj));
  }
  function lights(obj) {
    return obj && obj.data ? window.ModelLighting.readLights(obj.data.custom_config) : [];
  }
  function setLights(obj, list) {
    if (!obj || !obj.data) return;
    obj.data.custom_config = window.ModelLighting.writeLights(obj.data.custom_config, list);
    if (obj.data.custom_config_preview) {
      obj.data.custom_config_preview = window.ModelLighting.writeLights(obj.data.custom_config_preview, list);
    }
  }
  function selectedLight() {
    var list = lights(_obj);
    for (var i = 0; i < list.length; i++) if (list[i].id === _selectedId) return list[i];
    return null;
  }
  function status(text) {
    var el = document.getElementById('ml-status');
    if (el) el.textContent = text;
  }
  function saveNow() {
    if (!_obj) return;
    clearTimeout(_saveTimer);
    _saveTimer = null;
    var target = _obj;
    status('正在保存…');
    Promise.resolve(window.saveObjectToDatabase(target)).then(function (ok) {
      status(ok ? '已保存到模型配置' : '保存失败，请重试');
      if (!ok) notify('灯光保存失败', 'error');
    }).catch(function (e) {
      status('保存失败：' + e.message);
      notify('灯光保存失败：' + e.message, 'error');
    });
  }
  function queueSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveNow, 500);
    status('有修改，等待保存…');
  }

  function removeHandles() {
    if (typeof transformControls !== 'undefined' && transformControls.object &&
        transformControls.object.userData.__modelLightingHandle) {
      transformControls.detach();
    }
    _handles.forEach(function (h) {
      if (h.parent) h.parent.remove(h);
      if (h.material) h.material.dispose();
    });
    _handles = [];
    if (_obj && _obj.mesh && window.ModelHaloField) window.ModelHaloField.unregister(_obj.mesh);
  }

  function buildHandles(skipSurfaceRebuild) {
    removeHandles();
    if (!supported(_obj)) return;
    if (!skipSurfaceRebuild) {
      _lastSurfaceApplied = window.ModelLighting.applySurfaceGlow(_obj.mesh, _obj.data.custom_config);
    }
    if (window.ModelHaloField) {
      window.ModelHaloField.register(_obj.mesh, _obj.data.custom_config, { scene: scene, camera: camera });
    }
    var previews = 0;
    lights(_obj).forEach(function (item) {
      var handle = new THREE.Mesh(_sphere, new THREE.MeshBasicMaterial({
        color: window.ModelLighting.colorHex(item.color),
        transparent: true, opacity: 0.9, depthTest: false, depthWrite: false
      }));
      handle.name = '__model_light_' + item.id;
      handle.renderOrder = 10001;
      handle.userData.__modelLightingHandle = true;
      handle.userData.modelLightId = item.id;
      handle.position.set(item.offset.x, item.offset.y, item.offset.z);
      if (item.enabled && previews < 8) {
        var lamp = new THREE.PointLight(window.ModelLighting.colorHex(item.color), item.intensity, item.distance, 2);
        lamp.name = '__model_light_preview';
        handle.add(lamp);
        previews++;
      }
      _obj.mesh.add(handle);
      _handles.push(handle);
    });
    updateHandleSizes();
    syncHandleStyles();
  }

  function updateHandleSizes() {
    if (_obj && typeof worldObjects !== 'undefined' && worldObjects.indexOf(_obj) === -1) {
      removeHandles();
      window.ModelLighting.restoreSurface(_obj.mesh);
      _obj = null;
      _selectedId = null;
      _placing = false;
      _bindingSurface = false;
      if (_panel) _panel.innerHTML = '';
      return;
    }
    if (!_obj || !camera) return;
    var ws = new THREE.Vector3();
    var wp = new THREE.Vector3();
    _obj.mesh.getWorldScale(ws);
    _handles.forEach(function (h) {
      h.getWorldPosition(wp);
      var radius = Math.min(0.65, Math.max(0.08, wp.distanceTo(camera.position) * 0.012));
      if (h.userData.modelLightId === _selectedId) radius *= 1.35;
      h.scale.set(radius / Math.max(ws.x, 0.0001), radius / Math.max(ws.y, 0.0001), radius / Math.max(ws.z, 0.0001));
    });
  }

  function syncHandleStyles() {
    _handles.forEach(function (h) {
      var item = lights(_obj).find(function (x) { return x.id === h.userData.modelLightId; });
      if (!item) return;
      h.material.color.set(window.ModelLighting.colorHex(h.userData.modelLightId === _selectedId ? '#ffffff' : item.color));
      h.material.opacity = item.enabled ? 0.95 : 0.35;
      var lamp = h.children.find(function (c) { return c.isPointLight; });
      if (lamp) {
        lamp.color.set(window.ModelLighting.colorHex(item.color));
        lamp.intensity = item.intensity;
        lamp.distance = item.distance;
        lamp.visible = item.enabled;
      }
    });
  }

  function renderPanel() {
    if (!_panel) return;
    var list = lights(_obj);
    var item = selectedLight();
    var html = '<div class="right-prop-group" style="border-top:1px solid rgba(255,255,255,.14);margin-top:12px;padding-top:12px;">' +
      '<div class="right-prop-label">模型灯光（' + list.length + '）</div>' +
      '<button type="button" data-ml="add" class="tool-btn" style="width:100%;margin-bottom:8px;">' +
      (_placing ? '取消放灯' : '在模型表面添加灯光') + '</button>' +
      '<div style="font-size:11px;color:#999;margin-bottom:8px;">' +
      (_placing ? '请点击模型表面放置；Esc 取消' : '灯光跟随模型，复制模型时一起复制') + '</div>';
    if (list.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">';
      list.forEach(function (l, i) {
        html += '<button type="button" data-ml-select="' + l.id + '" class="tool-btn" style="font-size:11px;padding:4px 7px;' +
          (l.id === _selectedId ? 'background:#667eea;color:#fff;' : '') + '">灯 ' + (i + 1) + '</button>';
      });
      html += '</div>';
    }
    if (item) {
      var surf = item.surface || { enabled: false, color: item.color, intensity: 0.8, useMap: true, scope: 'mesh' };
      html += '<div class="right-prop-label">选中灯光</div>' +
        '<label style="display:block;font-size:11px;margin:6px 0;">颜色 <input data-ml-field="color" type="color" value="' + item.color + '" style="float:right;"></label>' +
        '<label style="display:block;font-size:11px;margin:10px 0;">亮度 <input data-ml-field="intensity" type="range" min="0" max="20" step="0.1" value="' + item.intensity + '" style="width:100%;"></label>' +
        '<label style="display:block;font-size:11px;margin:10px 0;">范围 <input data-ml-field="distance" type="range" min="0.5" max="100" step="0.5" value="' + item.distance + '" style="width:100%;"></label>' +
        '<label style="display:block;font-size:11px;margin:8px 0;"><input data-ml-field="enabled" type="checkbox" ' + (item.enabled ? 'checked' : '') + '> 启用照明</label>' +
        '<label style="display:block;font-size:11px;margin:8px 0;"><input data-ml-field="halo" type="checkbox" ' + (item.halo ? 'checked' : '') + '> 显示光晕（合批）</label>' +
        '<label style="display:block;font-size:11px;margin:8px 0;">光晕大小 <input data-ml-field="haloSize" type="range" min="0.2" max="3" step="0.1" value="' + item.haloSize + '" style="width:100%;"></label>' +
        '<div class="right-prop-label" style="margin-top:12px;">点击部位发光</div>' +
        '<label style="display:block;font-size:11px;margin:8px 0;"><input data-ml-field="surfaceEnabled" type="checkbox" ' + (surf.enabled ? 'checked' : '') + '> 让放置部位发光</label>' +
        '<label style="display:block;font-size:11px;margin:6px 0;">发光颜色 <input data-ml-field="surfaceColor" type="color" value="' + surf.color + '" style="float:right;"></label>' +
        '<label style="display:block;font-size:11px;margin:8px 0;">发光强度 <input data-ml-field="surfaceIntensity" type="range" min="0" max="5" step="0.05" value="' + surf.intensity + '" style="width:100%;"></label>' +
        '<label style="display:block;font-size:11px;margin:8px 0;">范围 <select data-ml-field="surfaceScope" style="float:right;"><option value="mesh" ' + (surf.scope === 'mesh' ? 'selected' : '') + '>当前部件</option><option value="material" ' + (surf.scope === 'material' ? 'selected' : '') + '>同材质部件</option></select></label>' +
        '<label style="display:block;font-size:11px;margin:8px 0;"><input data-ml-field="surfaceUseMap" type="checkbox" ' + (surf.useMap ? 'checked' : '') + '> 用自身贴图发光</label>' +
        '<button type="button" data-ml="bindSurface" class="tool-btn" style="width:100%;margin:6px 0;">' + (_bindingSurface ? '请点击模型表面…' : '重新选取发光部位') + '</button>' +
        '<div style="display:flex;gap:6px;"><button type="button" data-ml="save" class="tool-btn" style="flex:1;">保存</button>' +
        '<button type="button" data-ml="delete" class="tool-btn" style="flex:1;background:#a43d4a;color:#fff;">删除灯光</button></div>';
    }
    html += '<div id="ml-status" style="font-size:10px;color:#888;margin-top:7px;">修改后自动保存</div></div>';
    _panel.innerHTML = html;
  }

  function selectLight(id) {
    _selectedId = id;
    _placing = false;
    _bindingSurface = false;
    syncHandleStyles();
    var handle = _handles.find(function (h) { return h.userData.modelLightId === id; });
    if (handle) {
      transformControls.setMode('translate');
      transformControls.attach(handle);
    }
    if (typeof switchRightPropsTab === 'function') switchRightPropsTab('advanced');
    renderPanel();
  }

  function clearLightSelection() {
    if (_selectedId) _selectedId = null;
    _placing = false;
    _bindingSurface = false;
    syncHandleStyles();
  }

  function syncPanel(obj) {
    if (!supported(obj)) {
      removeHandles();
      if (_obj && _obj.mesh) window.ModelLighting.restoreSurface(_obj.mesh);
      _obj = null;
      _selectedId = null;
      _placing = false;
      _bindingSurface = false;
      if (_panel) _panel.innerHTML = '';
      return;
    }
    if (_obj !== obj) {
      removeHandles();
      if (_obj && _obj.mesh) window.ModelLighting.restoreSurface(_obj.mesh);
      _obj = obj;
      _selectedId = null;
      _placing = false;
      _bindingSurface = false;
    }
    buildHandles();
    if (_selectedId && transformControls.object !== _handles.find(function (h) { return h.userData.modelLightId === _selectedId; })) {
      var h = _handles.find(function (x) { return x.userData.modelLightId === _selectedId; });
      if (h) transformControls.attach(h);
    }
    renderPanel();
  }

  function setPointer(event) {
    var rect = renderer.domElement.getBoundingClientRect();
    _pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    _raycaster.setFromCamera(_pointer, camera);
  }
  function visibleChain(node, root) {
    var cur = node;
    while (cur) {
      if (!cur.visible) return false;
      if (cur === root) return true;
      cur = cur.parent;
    }
    return false;
  }
  function pickSurface(event) {
    setPointer(event);
    var hits = _raycaster.intersectObject(_obj.mesh, true).filter(function (h) {
      return h.object.isMesh && !h.object.userData.isPickProxy &&
        !h.object.userData.__modelLightingHandle && visibleChain(h.object, _obj.mesh);
    });
    if (!hits.length) { notify('请点击模型的真实表面', 'warning'); return null; }
    return hits[0];
  }
  function addAt(event) {
    if (!_obj) return;
    var hit = pickSurface(event);
    if (!hit) return;
    var point = hit.point.clone();
    if (hit.face) {
      var normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      point.addScaledVector(normal, 0.12);
    }
    _obj.mesh.updateWorldMatrix(true, false);
    var local = _obj.mesh.worldToLocal(point);
    var materialIndex = hit.face && hit.face.materialIndex ? hit.face.materialIndex : 0;
    var surface = window.ModelLighting.makeSurfaceTarget(_obj.mesh, hit.object, materialIndex);
    // 默认让刚点中的部位发光，避免"放了灯但看不出任何变化"；面板可随时关闭。
    surface.enabled = true;
    surface.color = '#ffdca8';
    var list = lights(_obj);
    var id = 'light_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1000);
    list.push(window.ModelLighting.normalizeLight({ id: id, offset: local, color: '#ffdca8', intensity: 6, distance: 16, surface: surface }, list.length));
    setLights(_obj, list);
    _placing = false;
    buildHandles();
    selectLight(id);
    queueSave();
    if (_lastSurfaceApplied > 0) {
      notify('已添加灯光，点击部位已发光（' + _lastSurfaceApplied + ' 个材质）；可拖动灯泡图标', 'success');
    } else {
      notify('已添加照明灯，但该部位材质不支持自发光；请调整灯位置或改用同材质发光', 'warning');
    }
  }

  function bindSurfaceAt(event) {
    var hit = pickSurface(event);
    if (!hit) return;
    var item = selectedLight();
    if (!item) return;
    var materialIndex = hit.face && hit.face.materialIndex ? hit.face.materialIndex : 0;
    item.surface = window.ModelLighting.makeSurfaceTarget(_obj.mesh, hit.object, materialIndex);
    item.surface.enabled = true;
    item.surface.color = item.color;
    setLights(_obj, lights(_obj).map(function (l) { return l.id === item.id ? item : l; }));
    _bindingSurface = false;
    buildHandles();
    selectLight(item.id);
    queueSave();
  }

  function onPointerDown(event) {
    if (!_ready || event.button !== 0 || (transformControls && transformControls.dragging)) return;
    if (_placing || _bindingSurface) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (_bindingSurface) bindSurfaceAt(event); else addAt(event);
      return;
    }
    if (!_handles.length) return;
    setPointer(event);
    var hits = _raycaster.intersectObjects(_handles, false);
    if (hits.length) {
      event.preventDefault(); event.stopImmediatePropagation();
      selectLight(hits[0].object.userData.modelLightId);
    }
  }

  function onKeyDown(event) {
    var tag = event.target && event.target.tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (event.target && event.target.isContentEditable)) return;
    if (event.key === 'Escape' && (_placing || _bindingSurface || _selectedId)) {
      event.preventDefault(); event.stopImmediatePropagation();
      clearLightSelection();
      if (_obj) { transformControls.attach(_obj.mesh); renderPanel(); }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && _selectedId) {
      event.preventDefault(); event.stopImmediatePropagation();
      deleteSelectedLight();
    }
  }

  function deleteSelectedLight() {
    if (!_selectedId) return;
    setLights(_obj, lights(_obj).filter(function (l) { return l.id !== _selectedId; }));
    _selectedId = null;
    buildHandles();
    if (_obj) transformControls.attach(_obj.mesh);
    renderPanel();
    queueSave();
  }

  function updateFromPanel(target) {
    var item = selectedLight();
    if (!item) return;
    var field = target.getAttribute('data-ml-field');
    if (field === 'color') item.color = target.value;
    if (field === 'intensity') item.intensity = Number(target.value);
    if (field === 'distance') item.distance = Number(target.value);
    if (field === 'enabled') item.enabled = target.checked;
    if (field === 'halo') item.halo = target.checked;
    if (field === 'haloSize') item.haloSize = Number(target.value);
    if (field.indexOf('surface') === 0) {
      item.surface = item.surface || { enabled: false, color: item.color, intensity: 0.8, useMap: true, scope: 'mesh', meshName: '', materialName: '', materialIndex: 0, path: '' };
      if (field === 'surfaceEnabled') item.surface.enabled = target.checked;
      if (field === 'surfaceColor') item.surface.color = target.value;
      if (field === 'surfaceIntensity') item.surface.intensity = Number(target.value);
      if (field === 'surfaceScope') item.surface.scope = target.value;
      if (field === 'surfaceUseMap') item.surface.useMap = target.checked;
    }
    setLights(_obj, lights(_obj).map(function (l) { return l.id === item.id ? item : l; }));
    buildHandles(field.indexOf('surface') !== 0);
    var handle = _handles.find(function (h) { return h.userData.modelLightId === item.id; });
    if (handle) transformControls.attach(handle);
    queueSave();
  }

  function bindPanel() {
    _panel.addEventListener('click', function (e) {
      var select = e.target.closest('[data-ml-select]');
      if (select) { selectLight(select.getAttribute('data-ml-select')); return; }
      var action = e.target.closest('[data-ml]');
      if (!action || !_obj) return;
      var name = action.getAttribute('data-ml');
      if (name === 'add') {
        _placing = !_placing;
        _bindingSurface = false;
        _selectedId = null;
        transformControls.detach();
        renderPanel();
      } else if (name === 'bindSurface') {
        _bindingSurface = !_bindingSurface;
        _placing = false;
        transformControls.detach();
        renderPanel();
      } else if (name === 'save') saveNow();
      else if (name === 'delete') deleteSelectedLight();
    });
    _panel.addEventListener('input', function (e) {
      if (e.target.matches('[data-ml-field]') && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') updateFromPanel(e.target);
    });
    _panel.addEventListener('change', function (e) {
      if (e.target.matches('[data-ml-field]') && (e.target.type === 'checkbox' || e.target.tagName === 'SELECT')) updateFromPanel(e.target);
    });
  }

  function patchEditor() {
    if (_patched) return;
    var oldPanel = window.updateRightPropsPanel;
    window.updateRightPropsPanel = function (obj) {
      var result = oldPanel.apply(this, arguments);
      try { syncPanel(obj); } catch (e) { console.error('[ModelLightingEditor] 面板同步失败', e); }
      return result;
    };
    var oldSelection = window.updateSelection;
    window.updateSelection = function () {
      clearLightSelection();
      var result = oldSelection.apply(this, arguments);
      if (typeof selectedObjects !== 'undefined' && selectedObjects.length !== 1) syncPanel(null);
      return result;
    };
    var oldMode = window.setEditMode;
    window.setEditMode = function (mode) {
      var result = oldMode.apply(this, arguments);
      if (_selectedId) selectLight(_selectedId);
      return result;
    };
    var oldSave = window.saveObjectToDatabase;
    window.saveObjectToDatabase = function (obj) {
      if (obj && obj.data && obj.data.custom_config_preview && obj.data.custom_config) {
        obj.data.custom_config_preview.lighting = window.ModelLighting.cloneConfig(obj.data.custom_config).lighting;
      }
      return oldSave.apply(this, arguments);
    };
    transformControls.addEventListener('objectChange', function () {
      var handle = transformControls.object;
      if (!handle || !handle.userData.__modelLightingHandle) return;
      var id = handle.userData.modelLightId;
      var list = lights(_obj).map(function (l) {
        if (l.id === id) l.offset = { x: handle.position.x, y: handle.position.y, z: handle.position.z };
        return l;
      });
      setLights(_obj, list);
      // 松手时编辑器既有 autoSaveObjectTransform 会保存该模型，避免重复请求。
      status('灯光位置已更新，松手后保存');
    });
    _patched = true;
  }

  function init() {
    if (_ready || typeof scene === 'undefined' || !scene || !renderer || !camera ||
        typeof transformControls === 'undefined' || !window.ModelLighting) return false;
    var host = document.getElementById('right-props-tab-advanced');
    if (!host || typeof window.updateRightPropsPanel !== 'function' ||
        typeof window.updateSelection !== 'function' || typeof window.saveObjectToDatabase !== 'function') return false;
    _raycaster = new THREE.Raycaster();
    _pointer = new THREE.Vector2();
    _sphere = new THREE.SphereGeometry(1, 12, 8);
    _panel = document.createElement('div');
    _panel.id = 'model-lighting-editor';
    host.appendChild(_panel);
    bindPanel();
    patchEditor();
    renderer.domElement.addEventListener('click', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    setInterval(updateHandleSizes, 150);
    _ready = true;
    if (typeof selectedObjects !== 'undefined' && selectedObjects.length === 1) syncPanel(selectedObjects[0]);
    return true;
  }

  var tries = 0;
  (function waitReady() {
    if (init()) return;
    if (++tries < 200) setTimeout(waitReady, 250);
  })();

  window.ModelLightingEditor = {
    _diag: function () {
      return { ready: _ready, objectId: _obj && _obj.id, placing: _placing,
        selectedLightId: _selectedId, handles: _handles.length, lights: lights(_obj).length,
        surfaceApplied: _lastSurfaceApplied, halo: window.ModelHaloField ? window.ModelHaloField.stats() : null };
    },
    beginAdd: function () { _placing = true; renderPanel(); },
    selectLight: selectLight,
    saveNow: saveNow
  };
})();
