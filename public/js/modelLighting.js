/**
 * 模型灯光共享模块：配置规范化、世界点光接入与生命周期清理。
 * 配置保存在 custom_config.lighting.lights；offset 始终是模型根节点本地坐标。
 */
(function () {
  'use strict';

  var VERSION = 2;
  // 仅作为面板提示用的参考值：不截断配置，模型想加多少灯都存得下。
  // 真正同时在照的是 MODEL_REAL_LIGHT_SLOTS 个灯槽，其余只有光晕 + 自发光。
  var LIGHTS_WARN_THRESHOLD = 64;
  var WORLD_LIGHTS_PER_OBJECT = 4;
  var MODEL_REAL_LIGHT_SLOTS = 2;
  var MODEL_LIGHT_MAX_DISTANCE = 60;
  var _worldRoots = new Set();
  var _worldTimer = null;
  var _modelCandidates = new Map();
  var _modelSlots = [];
  var _modelSlotScene = null;
  var _modelActive = [];
  var _modelTimer = null;
  var _modelKickTimer = null;
  // 编辑态焦点：管理员选中某盏灯时强制占用一个灯槽，否则第 3 盏灯调参毫无反应
  var _editorFocus = new Map();

  function clamp(v, min, max, fallback) {
    var n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function parseConfig(config) {
    if (!config) return {};
    if (typeof config === 'string') {
      try { return JSON.parse(config) || {}; } catch (e) { return {}; }
    }
    return typeof config === 'object' ? config : {};
  }

  function cloneConfig(config) {
    var parsed = parseConfig(config);
    try { return JSON.parse(JSON.stringify(parsed)); } catch (e) { return {}; }
  }

  function normalizeColor(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return '#' + (value >>> 0).toString(16).padStart(6, '0').slice(-6);
    }
    var s = String(value || '').trim();
    if (!s) return '#ffdca8';
    if (s.charAt(0) !== '#') s = '#' + s;
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '#ffdca8';
  }

  function normalizeLight(raw, index) {
    raw = raw || {};
    var off = raw.offset || raw.position || {};
    return {
      id: String(raw.id || ('light_' + Date.now().toString(36) + '_' + index)),
      type: 'point',
      offset: {
        x: clamp(off.x, -100000, 100000, 0),
        y: clamp(off.y, -100000, 100000, 0),
        z: clamp(off.z, -100000, 100000, 0)
      },
      color: normalizeColor(raw.color),
      intensity: clamp(raw.intensity, 0, 300, 2),
      distance: clamp(raw.distance, 0.1, 500, 12),
      enabled: raw.enabled !== false,
      halo: raw.halo !== false,
      haloSize: clamp(raw.haloSize, 0.1, 10, 1)
    };
  }

  function readLights(config) {
    var lighting = parseConfig(config).lighting;
    if (!lighting || !Array.isArray(lighting.lights)) return [];
    return lighting.lights.map(normalizeLight);
  }

  function writeLights(config, lights) {
    var next = cloneConfig(config);
    var normalized = (lights || []).map(normalizeLight);
    if (!next.lighting || typeof next.lighting !== 'object') next.lighting = { version: VERSION };
    next.lighting.version = VERSION;
    next.lighting.lights = normalized;
    return next;
  }

  function colorHex(color) {
    return parseInt(normalizeColor(color).slice(1), 16);
  }

  function canInstance(config) {
    var parsed = parseConfig(config);
    var keys = Object.keys(parsed);
    if (!keys.length || keys.some(function (k) { return k !== 'lighting'; })) return false;
    // 只要模型级 surfaces 里有启用的发光，就不能合批
    if (window.ModelSurface) return window.ModelSurface._diag(parsed).enabled === 0;
    return true;
  }

  function isRootAlive(root) {
    if (!root) return false;
    var id = root.userData && root.userData.worldObjectId;
    var world = window.gameWorld;
    if (id !== undefined && world && world.generatedBuildings) {
      var entry = world.generatedBuildings.get(id) || world.generatedBuildings.get(String(id));
      return !!(entry && !entry.isPlaceholder && entry.model === root);
    }
    return !!root.parent;
  }

  function ensureModelSlots() {
    var world = window.gameWorld;
    if (!world || !world.scene) return false;
    if (_modelSlotScene && _modelSlotScene !== world.scene) {
      _modelSlots.forEach(function (light) {
        if (light.parent) light.parent.remove(light);
      });
      _modelSlots = [];
      _modelActive = [];
    }
    if (!_modelSlots.length) {
      for (var i = 0; i < MODEL_REAL_LIGHT_SLOTS; i++) {
        var light = new THREE.PointLight(0xffffff, 0, 0, 2);
        light.position.set(0, -1000, 0);
        light.__modelLightSlot = true;
        world.scene.add(light);
        _modelSlots.push(light);
      }
      _modelSlotScene = world.scene;
    }
    if (!_modelTimer) {
      _modelTimer = setInterval(updateModelLights, 250);
    }
    return true;
  }

  function scheduleModelUpdate() {
    if (_modelKickTimer) return;
    _modelKickTimer = setTimeout(function () {
      _modelKickTimer = null;
      updateModelLights();
    }, 0);
  }

  function registerModelLights(root, lights) {
    // 不截断：全部启用的灯都进候选，否则第 5 盏之后连"选中优先占槽"都轮不到
    var candidates = (lights || []).filter(function (l) { return l.enabled; });
    if (!candidates.length) return;
    _modelCandidates.set(root, candidates);
    ensureModelSlots();
    // 世界加载顺序：应用配置 → 加入场景 → 写 worldObjectId / generatedBuildings。
    // 同步刷新会把刚登记的模型误判为已卸载，必须延后到当前加载调用栈结束。
    scheduleModelUpdate();
  }

  function unregisterModelLights(root) {
    if (!_modelCandidates.delete(root)) return;
    _modelActive = _modelActive.filter(function (entry) { return entry.root !== root; });
    updateModelLights();
  }

  function updateModelLights() {
    if (!ensureModelSlots()) return;
    var world = window.gameWorld;
    var p = (window.player && window.player.position) || world.camera && world.camera.position;
    if (!p) return;

    var candidates = [];
    _modelCandidates.forEach(function (lights, root) {
      if (!isRootAlive(root)) {
        _modelCandidates.delete(root);
        return;
      }
      root.updateWorldMatrix(true, false);
      lights.forEach(function (light) {
        var wp = new THREE.Vector3(light.offset.x, light.offset.y, light.offset.z);
        root.localToWorld(wp);
        var dist = wp.distanceTo(p);
        if (dist <= MODEL_LIGHT_MAX_DISTANCE) {
          candidates.push({ root: root, light: light, pos: wp, dist: dist, key: root.uuid + ':' + light.id });
        }
      });
    });
    candidates.sort(function (a, b) { return a.dist - b.dist; });
    var byKey = new Map();
    candidates.forEach(function (c) { byKey.set(c.key, c); });

    // 编辑态：选中的灯无条件占 1 个槽（不受距离排序与滞回影响）
    var focus = null;
    _editorFocus.forEach(function (id, focusRoot) {
      if (!isRootAlive(focusRoot)) { _editorFocus.delete(focusRoot); return; }
      var candidateKey = focusRoot.uuid + ':' + id;
      if (byKey.has(candidateKey)) { focus = byKey.get(candidateKey); return; }
      // 兜底：候选表里没有（id 对不上 / 超过 60 米），仍要让正在编辑的灯占槽
      var list = _modelCandidates.get(focusRoot);
      if (!list) return;
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) !== String(id)) continue;
        var wp = new THREE.Vector3(list[i].offset.x, list[i].offset.y, list[i].offset.z);
        focusRoot.localToWorld(wp);
        focus = { root: focusRoot, light: list[i], pos: wp, dist: wp.distanceTo(p), key: candidateKey };
        break;
      }
    });

    // 滞回：沿用当前灯，只有新灯明显更近（至少近 1 米）才顶替最远灯。
    var active = [];
    if (focus) active.push(focus);
    var focusKey = focus ? focus.key : null;

    _modelActive.forEach(function (entry) {
      if (entry.key === focusKey) return;
      var fresh = byKey.get(entry.key);
      if (fresh && active.length < MODEL_REAL_LIGHT_SLOTS) active.push(fresh);
    });
    candidates.forEach(function (candidate) {
      if (candidate.key === focusKey) return;
      if (active.some(function (a) { return a.key === candidate.key; })) return;
      if (active.length < MODEL_REAL_LIGHT_SLOTS) {
        active.push(candidate);
        return;
      }
      // 编辑中的灯不被顶替
      var worstIndex = -1;
      var worstDist = -1;
      for (var i = 0; i < active.length; i++) {
        if (active[i].key === focusKey) continue;
        if (active[i].dist > worstDist) { worstDist = active[i].dist; worstIndex = i; }
      }
      if (worstIndex >= 0 && candidate.dist + 1 < worstDist) active[worstIndex] = candidate;
    });
    _modelActive = active;

    _modelSlots.forEach(function (slot, index) {
      var entry = active[index];
      if (!entry) {
        slot.intensity = 0;
        slot.position.set(0, -1000, 0);
        return;
      }
      slot.color.set(colorHex(entry.light.color));
      slot.intensity = entry.light.intensity;
      slot.distance = entry.light.distance;
      slot.position.copy(entry.pos);
    });
  }

  /**
   * 编辑态焦点：让选中的灯强制占用一个真实灯槽
   * 不设焦点时，槽位只按"离玩家最近"分配，第 3 盏灯调参毫无反应。
   */
  function setEditorFocus(root, lightId) {
    if (!root) return;
    if (lightId) _editorFocus.set(root, String(lightId));
    else _editorFocus.delete(root);
    scheduleModelUpdate();
  }

  /** 拖动灯泡手柄时同步候选灯位置，避免灯槽停在旧坐标 */
  function updateLightOffset(root, id, position) {
    var list = _modelCandidates.get(root);
    if (!list || !position || id === undefined || id === null) return;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].offset = { x: position.x, y: position.y, z: position.z };
        break;
      }
    }
    scheduleModelUpdate();
  }

  function modelLightStats() {
    return {
      slots: _modelSlots.length,
      candidates: _modelCandidates.size,
      active: _modelActive.length,
      activeIds: _modelActive.map(function (a) { return a.light.id; })
    };
  }

  function cleanup(root) {
    if (!root) return;
    unregisterModelLights(root);
    _editorFocus.delete(root);
    if (window.LightPool) window.LightPool.release(root);
    if (window.ModelSurface) window.ModelSurface.restore(root);
    if (window.ModelHaloField) window.ModelHaloField.unregister(root);
    var previews = [];
    root.traverse(function (node) {
      if (node.__modelLightingPreview) previews.push(node);
    });
    previews.forEach(function (node) {
      if (node.parent) node.parent.remove(node);
    });
    _worldRoots.delete(root);
  }

  function apply(root, config, options) {
    if (!root) return { applied: 0 };
    options = options || {};
    cleanup(root);
    var surface = window.ModelSurface ? window.ModelSurface.apply(root, config) : 0;
    var lights = readLights(config);
    if (!lights.length) return { applied: 0, surface: surface };

    var applied = 0;
    var editor = options.editor === true;
    var limit = editor ? 8 : WORLD_LIGHTS_PER_OBJECT;
    for (var i = 0; i < lights.length && applied < limit; i++) {
      var item = lights[i];
      if (!item.enabled) continue;
      if (editor) {
        var preview = new THREE.PointLight(colorHex(item.color), item.intensity, item.distance, 2);
        preview.__modelLightingPreview = true;
        preview.userData.modelLightId = item.id;
        preview.position.set(item.offset.x, item.offset.y, item.offset.z);
        root.add(preview);
      }
      applied++;
    }
    if (!editor && applied > 0) {
      _worldRoots.add(root);
      registerModelLights(root, lights);
      startWorldSweep();
    }
    if (!editor && window.ModelHaloField && window.gameWorld) {
      window.ModelHaloField.register(root, config, {
        scene: window.gameWorld.scene,
        camera: window.gameWorld.camera
      });
    }
    return { applied: applied, total: lights.length, surface: surface };
  }

  function startWorldSweep() {
    if (_worldTimer) return;
    _worldTimer = setInterval(function () {
      _worldRoots.forEach(function (root) {
        // 合批或 LOD 变体显示时高模根虽被摘出场景，仍是有效灯光锚点。
        if (!isRootAlive(root)) cleanup(root);
      });
    }, 1500);
  }

  function stats() {
    return {
      worldRoots: _worldRoots.size,
      modelLights: modelLightStats(),
      pool: window.LightPool ? window.LightPool.stats() : null
    };
  }

  window.ModelLighting = {
    VERSION: VERSION,
    LIGHTS_WARN_THRESHOLD: LIGHTS_WARN_THRESHOLD,
    MODEL_REAL_LIGHT_SLOTS: MODEL_REAL_LIGHT_SLOTS,
    MODEL_LIGHT_MAX_DISTANCE: MODEL_LIGHT_MAX_DISTANCE,
    parseConfig: parseConfig,
    cloneConfig: cloneConfig,
    normalizeLight: normalizeLight,
    normalizeColor: normalizeColor,
    colorHex: colorHex,
    readLights: readLights,
    writeLights: writeLights,
    // 发光实现在 modelSurface.js；这里保留旧名字供编辑器端和验收脚本调用
    makeSurfaceTarget: function (root, mesh, materialIndex) {
      return window.ModelSurface ? window.ModelSurface.makeTarget(root, mesh, materialIndex) : null;
    },
    applySurfaceGlow: function (root, config) {
      return window.ModelSurface ? window.ModelSurface.apply(root, config) : 0;
    },
    restoreSurface: function (root) {
      if (window.ModelSurface) window.ModelSurface.restore(root);
    },
    canInstance: canInstance,
    isRootAlive: isRootAlive,
    updateModelLights: updateModelLights,
    setEditorFocus: setEditorFocus,
    updateLightOffset: updateLightOffset,
    modelLightStats: modelLightStats,
    apply: apply,
    cleanup: cleanup,
    stats: stats
  };

  // 提前创建固定灯位，使 PBR 材质首次编译就带正确的点光数量，避免首次放灯时全场景重编译。
  var _bootTries = 0;
  (function bootSlots() {
    if (ensureModelSlots()) return;
    if (++_bootTries < 600) setTimeout(bootSlots, 100);
  })();
})();
