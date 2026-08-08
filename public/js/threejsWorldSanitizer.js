/**
 * 济宁米多信息科技有限公司 版权所有
 * Three.js 世界模式场景清洗器
 *
 * 作用：世界模式下 Three.js 代码块只应保留模型本身，
 *  所有灯光、反射、环境效果、GUI、自有渲染器等场景副作用
 *  全部清洗或降级，避免污染世界场景。
 */
(function (global) {
  'use strict';

  const THREE = global.THREE;

  // 世界模式下允许保留的标准材质清单
  const STANDARD_MATERIALS = new Set([
    'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshStandardMaterial',
    'MeshPhongMaterial', 'MeshPhysicalMaterial', 'MeshDepthMaterial',
    'MeshNormalMaterial', 'MeshToonMaterial', 'LineBasicMaterial',
    'LineDashedMaterial', 'PointsMaterial', 'SpriteMaterial',
    'ShaderMaterial', 'RawShaderMaterial', 'ShadowMaterial'
  ]);

  // 判断材质是否为原生标准材质
  function isStandardMaterial(mat) {
    if (!mat) return false;
    const name = mat.constructor && mat.constructor.name;
    return STANDARD_MATERIALS.has(name);
  }

  // 已警告过的材质名（按会话去重，避免同类材质每个网格警告一次导致刷屏）
  const _warnedMatNames = new Set();
  // 已清洗过 NaN 的几何体（避免重复扫描）
  const _nanCleanedGeoms = new Set();

  function warnOnce(key, args) {
    if (_warnedMatNames.has(key)) return;
    _warnedMatNames.add(key);
    console.warn.apply(console, args);
  }

  // 清洗几何体数值属性中的 NaN/Infinity（AI 生成代码常见除零/undefined 参与计算），
  // 否则 computeBoundingSphere 得到 NaN 半径，导致视锥剔除异常（模型时隐时现）
  function sanitizeGeometryNaN(child) {
    const geom = child.geometry;
    if (!geom || !geom.attributes || !geom.uuid) return;
    if (_nanCleanedGeoms.has(geom.uuid)) return;
    _nanCleanedGeoms.add(geom.uuid);
    const attrs = geom.attributes;
    for (const key in attrs) {
      const attr = attrs[key];
      const arr = attr && attr.array;
      if (!arr || typeof arr.length !== 'number' || typeof arr[0] === 'string') continue;
      if (!(arr instanceof Float32Array) && !(arr instanceof Float64Array)) continue;
      let fixed = false;
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) { arr[i] = 0; fixed = true; }
      }
      if (fixed) {
        attr.needsUpdate = true;
        geom.boundingSphere = null;
        geom.boundingBox = null;
        try { geom.computeBoundingSphere(); } catch (e) {}
        console.warn('[ThreeJSWorldSanitizer] 已清洗几何体 NaN 顶点:', child.name || child.type || '未命名', '(' + key + ')');
      }
    }
  }

  // 将非标准材质降级为 MeshStandardMaterial，尽量保留颜色/贴图
  function downgradeMaterial(mat, THREE) {
    const fallback = new THREE.MeshStandardMaterial();
    try {
      fallback.copy(mat);
    } catch (e) {
      // copy 失败时手动复制常见属性
      if (mat.color) fallback.color = mat.color.clone();
      if (mat.map) fallback.map = mat.map;
      if (mat.roughness !== undefined) fallback.roughness = mat.roughness;
      if (mat.metalness !== undefined) fallback.metalness = mat.metalness;
      if (mat.opacity !== undefined) fallback.opacity = mat.opacity;
      if (mat.transparent !== undefined) fallback.transparent = mat.transparent;
      if (mat.side !== undefined) fallback.side = mat.side;
      if (mat.emissive) fallback.emissive = mat.emissive.clone();
      if (mat.emissiveIntensity !== undefined) fallback.emissiveIntensity = mat.emissiveIntensity;
    }
    try { mat.dispose(); } catch (e) {}
    return fallback;
  }

  // 遍历材质（单材质或数组），降级非标准材质
  function sanitizeMaterial(child, THREE) {
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    let changed = false;
    const newMats = mats.map(function (mat) {
      if (!mat) return mat;
      if (isStandardMaterial(mat)) return mat;

      const name = mat.constructor && mat.constructor.name;
      warnOnce('downgrade:' + name, ['[ThreeJSWorldSanitizer] 世界模式降级非标准材质:', name]);
      changed = true;
      return downgradeMaterial(mat, THREE);
    });

    if (changed) {
      child.material = newMats.length === 1 ? newMats[0] : newMats;
    }
  }

  // 世界模式下强制点/线/精灵参与正常深度遮挡，避免被建筑/角色看穿
  function normalizeDepthState(child) {
    if (!child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach(function (mat) {
      if (!mat) return;
      if (mat.depthTest === false) {
        warnOnce('depthTest:' + (mat.constructor && mat.constructor.name), ['[ThreeJSWorldSanitizer] 世界模式强制点/线/精灵 depthTest=true，避免被遮挡物看穿:', mat.constructor && mat.constructor.name]);
        mat.depthTest = true;
      }
      // 透明材质关闭深度写入，避免自遮挡闪烁
      if (mat.transparent === true && mat.depthWrite !== false) {
        mat.depthWrite = false;
      }
    });
  }

  /**
   * 清洗对象：删除灯光、降级非标准材质
   * @param {THREE.Object3D} root
   * @param {THREE} THREERef 可选，默认 window.THREE
   */
  function sanitize(root, THREERef) {
    if (!root || typeof root.traverse !== 'function') return;
    const THREE_ = THREERef || global.THREE;
    if (!THREE_) {
      console.warn('[ThreeJSWorldSanitizer] THREE 未加载，跳过清洗');
      return;
    }

    const toRemove = [];

    root.traverse(function (child) {
      // 1. 删除所有灯光
      if (child.isLight) {
        toRemove.push(child);
        return;
      }

      // 2. 处理可渲染对象：Mesh 降级材质；点/线/精灵只规范化深度状态
      const isRenderable = child.isMesh || child.isPoints || child.isLine || child.isLineLoop || child.isLineSegments || child.isSprite;
      if (isRenderable && child.material) {
        if (child.isMesh) {
          sanitizeMaterial(child, THREE_);
        } else {
          normalizeDepthState(child);
        }
      }

      // 3. 清洗几何体 NaN 顶点（修复 boundingSphere 半径 NaN 导致的剔除异常）
      if (isRenderable && child.geometry) {
        sanitizeGeometryNaN(child);
      }
    });

    toRemove.forEach(function (light) {
      if (light.parent) light.parent.remove(light);
    });
  }

  global.ThreeJSWorldSanitizer = {
    sanitize: sanitize
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.ThreeJSWorldSanitizer;
  }
})(typeof window !== 'undefined' ? window : this);
