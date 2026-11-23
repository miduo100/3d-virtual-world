/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 模型部位发光：surfaces[] 读写、v1 迁移、材质克隆与恢复（2026-11-05）  v1
 * 依赖：THREE、ModelLighting 的配置工具（colorHex / writeLights 不依赖本模块）
 * 不做：不管点光源、不管灯槽调度（在 modelLighting.js）
 * 诊断：window.ModelSurface._diag(config)
 *
 * 数据结构 v2：发光从"每盏灯带一份"提升为模型级独立数组
 *   lighting.surfaces = [{ id, enabled, color, intensity, useMap, scope, meshName, materialName, materialIndex, path }]
 * v1 旧数据（light.surface）在读取时自动迁移，写一次即升级。
 */
(function () {
  'use strict';
  if (window.ModelSurface) return;

  var VERSION = 2;

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
    try { return JSON.parse(JSON.stringify(parseConfig(config))); } catch (e) { return {}; }
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

  function normalizeSurface(raw, index) {
    if (!raw) return null;
    return {
      id: String(raw.id || ('surf_' + Date.now().toString(36) + '_' + (index || 0))),
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

  /** 读 surfaces；没有就按 v1 结构把 light.surface 抽出来 */
  function readSurfaces(config) {
    var lighting = parseConfig(config).lighting;
    if (!lighting) return [];
    if (Array.isArray(lighting.surfaces)) {
      return lighting.surfaces.map(normalizeSurface).filter(Boolean);
    }
    var out = [];
    if (Array.isArray(lighting.lights)) {
      lighting.lights.forEach(function (raw, i) {
        var legacy = raw && raw.surface;
        if (!legacy || legacy.enabled !== true) return;
        out.push(normalizeSurface({
          id: 'surf_mig_' + i,
          enabled: true,
          color: legacy.color,
          intensity: legacy.intensity,
          useMap: legacy.useMap,
          scope: legacy.scope,
          meshName: legacy.meshName,
          materialName: legacy.materialName,
          materialIndex: legacy.materialIndex,
          path: legacy.path
        }, i));
      });
    }
    return out;
  }

  /** 写 surfaces，并把 v1 遗留在 lights[].surface 上的一份清掉 */
  function writeSurfaces(config, surfaces) {
    var next = cloneConfig(config);
    if (!next.lighting || typeof next.lighting !== 'object') next.lighting = { version: VERSION };
    next.lighting.version = VERSION;
    next.lighting.surfaces = (surfaces || []).map(normalizeSurface).filter(Boolean);
    if (Array.isArray(next.lighting.lights)) {
      next.lighting.lights = next.lighting.lights.map(function (light) {
        if (!light || typeof light !== 'object') return light;
        var copy = JSON.parse(JSON.stringify(light));
        delete copy.surface;
        return copy;
      });
    }
    return next;
  }

  function sameTarget(a, b) {
    if (!a || !b) return false;
    if (a.path && b.path) return a.path === b.path && a.materialIndex === b.materialIndex;
    return a.meshName === b.meshName &&
      a.materialName === b.materialName &&
      a.materialIndex === b.materialIndex;
  }

  /** 新增或更新一条部位发光，返回新 config */
  function upsertSurface(config, target, patch) {
    var list = readSurfaces(config);
    var hit = null;
    for (var i = 0; i < list.length; i++) {
      if (sameTarget(list[i], target)) { hit = list[i]; break; }
    }
    if (hit) {
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) hit[k] = patch[k];
    } else {
      var merged = { enabled: true, color: '#ffdca8', intensity: 0.8, useMap: true, scope: 'mesh' };
      for (var a in target) if (Object.prototype.hasOwnProperty.call(target, a)) merged[a] = target[a];
      for (var b in patch) if (Object.prototype.hasOwnProperty.call(patch, b)) merged[b] = patch[b];
      list.push(merged);
    }
    return writeSurfaces(config, list);
  }

  function removeSurface(config, target) {
    var list = readSurfaces(config).filter(function (s) { return !sameTarget(s, target); });
    return writeSurfaces(config, list);
  }

  function findSurface(config, target) {
    var list = readSurfaces(config);
    for (var i = 0; i < list.length; i++) if (sameTarget(list[i], target)) return list[i];
    return null;
  }

  // ---------------- 材质应用 ----------------

  var _records = new WeakMap();

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

  /** 由点击命中的 mesh 生成一条 target（还没保存） */
  function makeTarget(root, mesh, materialIndex) {
    var idx = materialIndex || 0;
    var mat = Array.isArray(mesh.material) ? mesh.material[idx] : mesh.material;
    return {
      enabled: false, color: '#ffdca8', intensity: 0.8, useMap: true, scope: 'mesh',
      meshName: mesh.name || '',
      materialName: (mat && mat.name) || '',
      materialIndex: idx,
      path: nodePath(root, mesh)
    };
  }

  function targetsOf(root, surface) {
    var out = [];
    root.traverse(function (mesh) {
      if (!mesh.isMesh || !mesh.material) return;
      if (mesh.userData.isPickProxy || mesh.userData.__modelLightingHandle) return;
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

  function restore(root) {
    var records = _records.get(root);
    if (!records) return;
    records.forEach(function (rec, mesh) {
      mesh.material = rec.original;
      rec.clones.forEach(function (m) { if (m && m.dispose) m.dispose(); });
    });
    _records.delete(root);
  }

  /** 按 surfaces[] 应用发光，只克隆命中的材质，返回应用数量 */
  function apply(root, config) {
    if (!root) return 0;
    restore(root);
    var applied = 0;
    readSurfaces(config).forEach(function (surface) {
      if (!surface.enabled) return;
      targetsOf(root, surface).forEach(function (target) {
        var records = _records.get(root);
        if (!records) { records = new Map(); _records.set(root, records); }
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
        mat.emissive.set(parseInt(normalizeColor(surface.color).slice(1), 16));
        mat.emissiveIntensity = surface.intensity;
        if (surface.useMap && mat.map) mat.emissiveMap = mat.map;
        else if (!surface.useMap) mat.emissiveMap = null;
        mat.needsUpdate = true;
        applied++;
      });
    });
    return applied;
  }

  /** 该材质是否支持自发光（给面板提示用） */
  function supportsEmissive(mesh, materialIndex) {
    if (!mesh || !mesh.material) return false;
    var mat = Array.isArray(mesh.material) ? mesh.material[materialIndex || 0] : mesh.material;
    return !!(mat && mat.emissive);
  }

  /** 已被部件发光接管的材质 uuid 集合（给整模型发光跳过用） */
  function appliedMaterialUuids(root) {
    var out = new Set();
    var records = _records.get(root);
    if (!records) return out;
    records.forEach(function (rec) {
      rec.clones.forEach(function (m) { if (m && m.uuid) out.add(m.uuid); });
    });
    return out;
  }

  window.ModelSurface = {
    VERSION: VERSION,
    read: readSurfaces,
    write: writeSurfaces,
    upsert: upsertSurface,
    remove: removeSurface,
    find: findSurface,
    makeTarget: makeTarget,
    targetsOf: targetsOf,
    restore: restore,
    apply: apply,
    supportsEmissive: supportsEmissive,
    appliedMaterialUuids: appliedMaterialUuids,
    _diag: function (config) {
      var list = readSurfaces(config);
      return { total: list.length, enabled: list.filter(function (s) { return s.enabled; }).length };
    }
  };
})();
