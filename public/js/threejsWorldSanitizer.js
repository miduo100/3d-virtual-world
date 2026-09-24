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

  // 世界模式下允许保留的标准材质标志位（three.js 原生材质均带 is*Material 只读标志，
  // 不受 minified bundle 压缩 constructor.name 影响；r128/r185 three.min.js 下
  // constructor.name 全是短名如 yn/ts/en，用名字匹配会永远失败导致全部材质被误降级）
  const STANDARD_MATERIAL_FLAGS = [
    'isMeshBasicMaterial', 'isMeshLambertMaterial', 'isMeshStandardMaterial',
    'isMeshPhongMaterial', 'isMeshPhysicalMaterial', 'isMeshDepthMaterial',
    'isMeshNormalMaterial', 'isMeshToonMaterial', 'isLineBasicMaterial',
    'isLineDashedMaterial', 'isPointsMaterial', 'isSpriteMaterial',
    'isShaderMaterial', 'isRawShaderMaterial', 'isShadowMaterial'
  ];

  // 判断材质是否为原生标准材质（含其子类实例）
  function isStandardMaterial(mat) {
    if (!mat) return false;
    for (let i = 0; i < STANDARD_MATERIAL_FLAGS.length; i++) {
      if (mat[STANDARD_MATERIAL_FLAGS[i]]) return true;
    }
    return false;
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

  // 世界模式深度状态规范化：
  // 1) 强制参与正常深度遮挡——网上代码常见 depthTest=false 的"X 光"特效（如光柱），
  //    单独看没事，放进共享世界会穿透建筑/地形/角色；
  // 2) 透明材质关闭深度写入，避免自遮挡闪烁。
  function normalizeDepthState(child) {
    if (!child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach(function (mat) {
      if (!mat) return;
      if (mat.depthTest === false) {
        warnOnce('depthTest:' + (mat.constructor && mat.constructor.name), ['[ThreeJSWorldSanitizer] 世界模式强制 depthTest=true（原值 false 会穿透遮挡物）:', mat.constructor && mat.constructor.name]);
        mat.depthTest = true;
      }
      // 透明材质关闭深度写入，避免自遮挡闪烁
      if (mat.transparent === true && mat.depthWrite !== false) {
        mat.depthWrite = false;
      }
    });
  }

  // 世界渲染器启用 logarithmicDepthBuffer（world.js:37），内置材质经着色器块自动适配，
  // 但用户 ShaderMaterial 不含 logdepth 块 → 深度编码与世界其余物体不一致 → 遮挡层级错乱。
  // 这里按 r185 ShaderChunk（USE_LOGARITHMIC_DEPTH_BUFFER / logDepthBufFC / vFragDepth）等价注入，
  // 全部包在 #ifdef 里：渲染器未开 logdepth（如 admin 预览）时编译为空，零副作用。
  function patchShaderLogDepth(mat) {
    if (!mat.isShaderMaterial || mat.isRawShaderMaterial) return;
    const vs = mat.vertexShader || '';
    const fs = mat.fragmentShader || '';
    if (/vFragDepth|LOGARITHMIC_DEPTH|gl_FragDepth/.test(vs + fs)) return; // 已自带处理

    const PARS_V = '#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\nvarying float vFragDepth;\nvarying float vIsPerspective;\n#endif\n';
    const BODY_V = '\n#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\nvFragDepth = 1.0 + gl_Position.w;\nvIsPerspective = projectionMatrix[2][3] == -1.0 ? 1.0 : 0.0;\n#endif\n';
    const PARS_F = '#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )\nuniform float logDepthBufFC;\nvarying float vFragDepth;\nvarying float vIsPerspective;\n#endif\n';
    const BODY_F = '\n#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )\ngl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;\n#endif\n';

    // 顶点：在最后一次 gl_Position 赋值之后插入（多段赋值时取最后一处）
    let lastMatch = null, m;
    const vpRe = /gl_Position\s*=[^;]*;/g;
    while ((m = vpRe.exec(vs)) !== null) lastMatch = m;
    if (!lastMatch) {
      warnOnce('logdepth:no-gl_Position', ['[ThreeJSWorldSanitizer] ShaderMaterial 未找到 gl_Position 赋值，跳过对数深度适配']);
      return;
    }
    const idx = lastMatch.index + lastMatch[0].length;
    mat.vertexShader = PARS_V + vs.slice(0, idx) + BODY_V + vs.slice(idx);

    // 片元：main( 函数体开头插入
    const fmRe = /(void\s+main\s*\(\s*(?:void\s+)?\)\s*\{)/;
    if (!fmRe.test(fs)) {
      warnOnce('logdepth:no-main', ['[ThreeJSWorldSanitizer] ShaderMaterial 片元未找到 main()，跳过对数深度适配']);
      return;
    }
    mat.fragmentShader = PARS_F + fs.replace(fmRe, '$1' + BODY_F);
    mat.needsUpdate = true;
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

      // 2. 处理可渲染对象：Mesh 降级材质；全部规范化深度状态 + ShaderMaterial 对数深度适配
      const isRenderable = child.isMesh || child.isPoints || child.isLine || child.isLineLoop || child.isLineSegments || child.isSprite;
      if (isRenderable && child.material) {
        if (child.isMesh) {
          sanitizeMaterial(child, THREE_);
        }
        normalizeDepthState(child);
        const mats2 = Array.isArray(child.material) ? child.material : [child.material];
        for (let mi = 0; mi < mats2.length; mi++) {
          if (mats2[mi]) patchShaderLogDepth(mats2[mi]);
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
