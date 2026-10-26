/**
 * 模型灯光共享模块：配置规范化、世界点光接入与生命周期清理。
 * 配置保存在 custom_config.lighting.lights；offset 始终是模型根节点本地坐标。
 */
(function () {
  'use strict';

  var VERSION = 1;
  var MAX_LIGHTS_PER_OBJECT = 32;
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

  function normalizeSurface(raw) {
    if (!raw) return null;
    return {
      enabled: raw.enabled === true,
      color: normalizeColor(raw.color),
      intensity: clamp(raw.intensity, 0, 10, 0.8),
      useMap: raw.useMap !== false,
      scope: raw.scope === 'material' ? 'material' : 'mesh',
      meshName: String(raw.meshName || ''),
      materialName: String(raw.materialName || ''),
      materialIndex: Math.max(0, Math.floor(clamp(raw.materialIndex, 0, 64, 0))),
      path: String(raw.path || '')
    };
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
      intensity: clamp(raw.intensity, 0, 100, 2),
      distance: clamp(raw.distance, 0.1, 500, 12),
      enabled: raw.enabled !== false,
      halo: raw.halo !== false,
      haloSize: clamp(raw.haloSize, 0.1, 10, 1),
      surface: normalizeSurface(raw.surface)
    };
  }

  function readLights(config) {
    var lighting = parseConfig(config).lighting;
    if (!lighting || !Array.isArray(lighting.lights)) return [];
    return lighting.lights.slice(0, MAX_LIGHTS_PER_OBJECT).map(normalizeLight);
  }

  function writeLights(config, lights) {
    var next = cloneConfig(config);
    var normalized = (lights || []).slice(0, MAX_LIGHTS_PER_OBJECT).map(normalizeLight);
    if (!next.lighting || typeof next.lighting !== 'object') next.lighting = { version: VERSION };
    next.lighting.version = VERSION;
    next.lighting.lights = normalized;
    return next;
  }

  function colorHex(color) {
    return parseInt(normalizeColor(color).slice(1), 16);
  }

  var _surfaceRecords = new WeakMap();

  function nodePath(root, node) {
    var parts = [];
    var cur = node;
    while (cur && cur !== root) {
      if (!cur.parent) return '';
      parts.unshift(cur.parent.children.indexOf(cur));
      cur = cur.parent;
    }
    return cur === root ? parts.join('/') : '';
  }

  function makeSurfaceTarget(root, mesh, materialIndex) {
    var mat = Array.isArray(mesh.material) ? mesh.material[materialIndex || 0] : mesh.material;
    return {
      enabled: false, color: '#ffdca8', intensity: 0.8, useMap: true, scope: 'mesh',
      meshName: mesh.name || '', materialName: mat && mat.name || '',
      materialIndex: materialIndex || 0, path: nodePath(root, mesh)
    };
  }

  function restoreSurface(root) {
    var records = _surfaceRecords.get(root);
    if (!records) return;
    records.forEach(function (rec, mesh) {
      mesh.material = rec.original;
      rec.clones.forEach(function (m) { if (m && m.dispose) m.dispose(); });
    });
    _surfaceRecords.delete(root);
  }

  function surfaceTargets(root, surface) {
    var out = [];
    root.traverse(function (mesh) {
      if (!mesh.isMesh || !mesh.material || mesh.userData.isPickProxy || mesh.userData.__modelLightingHandle) return;
      var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(function (mat, index) {
        if (!mat) return;
        if (surface.scope === 'material') {
          if (surface.materialName && mat.name === surface.materialName) out.push({ mesh: mesh, index: index });
        } else if ((surface.path && nodePath(root, mesh) === surface.path) ||
                   (surface.meshName && mesh.name === surface.meshName &&
                    (!surface.materialName || mat.name === surface.materialName))) {
          if (index === surface.materialIndex) out.push({ mesh: mesh, index: index });
        }
      });
    });
    return out;
  }

  function applySurfaceGlow(root, config) {
    restoreSurface(root);
    var applied = 0;
    readLights(config).forEach(function (light) {
      var surface = light.surface;
      if (!surface || !surface.enabled) return;
      surfaceTargets(root, surface).forEach(function (target) {
        var records = _surfaceRecords.get(root);
        if (!records) { records = new Map(); _surfaceRecords.set(root, records); }
        var rec = records.get(target.mesh);
        if (!rec) {
          rec = { original: target.mesh.material, clones: [] };
          records.set(target.mesh, rec);
          if (Array.isArray(target.mesh.material)) {
            var copies = target.mesh.material.slice();
            copies[target.index] = copies[target.index].clone();
            rec.clones.push(copies[target.index]);
            target.mesh.material = copies;
          } else {
            target.mesh.material = target.mesh.material.clone();
            rec.clones.push(target.mesh.material);
          }
        }
        var mat = Array.isArray(target.mesh.material) ? target.mesh.material[target.index] : target.mesh.material;
        if (!mat || !mat.emissive) return;
        mat.emissive.set(colorHex(surface.color));
        mat.emissiveIntensity = surface.intensity;
        if (surface.useMap && mat.map) mat.emissiveMap = mat.map;
        else if (!surface.useMap) mat.emissiveMap = null;
        mat.needsUpdate = true;
        applied++;
      });
    });
    return applied;
  }

  function canInstance(config) {
    var parsed = parseConfig(config);
    var keys = Object.keys(parsed);
    if (!keys.length || keys.some(function (k) { return k !== 'lighting'; })) return false;
    return readLights(parsed).every(function (l) { return !l.surface || !l.surface.enabled; });
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
    var candidates = (lights || []).filter(function (l) { return l.enabled; }).slice(0, WORLD_LIGHTS_PER_OBJECT);
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

    // 滞回：沿用当前灯，只有新灯明显更近（至少近 1 米）才顶替最远灯。
    var active = [];
    _modelActive.forEach(function (entry) {
      var fresh = byKey.get(entry.key);
      if (fresh && active.length < MODEL_REAL_LIGHT_SLOTS) active.push(fresh);
    });
    candidates.forEach(function (candidate) {
      if (active.some(function (a) { return a.key === candidate.key; })) return;
      if (active.length < MODEL_REAL_LIGHT_SLOTS) {
        active.push(candidate);
        return;
      }
      var worstIndex = 0;
      for (var i = 1; i < active.length; i++) {
        if (active[i].dist > active[worstIndex].dist) worstIndex = i;
      }
      if (candidate.dist + 1 < active[worstIndex].dist) active[worstIndex] = candidate;
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
    if (window.LightPool) window.LightPool.release(root);
    restoreSurface(root);
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
    var surface = applySurfaceGlow(root, config);
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
    MAX_LIGHTS_PER_OBJECT: MAX_LIGHTS_PER_OBJECT,
    MODEL_REAL_LIGHT_SLOTS: MODEL_REAL_LIGHT_SLOTS,
    MODEL_LIGHT_MAX_DISTANCE: MODEL_LIGHT_MAX_DISTANCE,
    parseConfig: parseConfig,
    cloneConfig: cloneConfig,
    normalizeLight: normalizeLight,
    normalizeColor: normalizeColor,
    colorHex: colorHex,
    readLights: readLights,
    writeLights: writeLights,
    makeSurfaceTarget: makeSurfaceTarget,
    applySurfaceGlow: applySurfaceGlow,
    restoreSurface: restoreSurface,
    canInstance: canInstance,
    isRootAlive: isRootAlive,
    updateModelLights: updateModelLights,
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
