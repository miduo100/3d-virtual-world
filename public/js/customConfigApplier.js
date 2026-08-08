/**
 * 自定义配置应用器 + 粒子自动安全修复
 * 职责：
 *  1. 自动修复代码块中可能导致"白球"的粒子参数
 *  2. 根据 world_objects.custom_config 将用户保存的参数应用到 3D 对象
 * 使用位置：world.js 加载对象后、world_editor.html 预览更新后
 */
(function () {
  'use strict';

  const SAFE_SIZE = 5.0;       // 只处理明显过大的粒子
  const SAFE_OPACITY = 0.95;   // 只处理接近不透明的极端情况
  const DEFAULT_SIZE = 1.0;    // 过大时仍保持可见
  const DEFAULT_OPACITY = 0.6; // 过高时仍保持可见

  // ========== 工具函数 ==========

  function isAdditiveBlending(material) {
    if (!material) return false;
    return material.blending === THREE.AdditiveBlending || material.blending === 2;
  }

  function getColorHex(material) {
    if (!material || !material.color) return 0xffffff;
    return material.color.getHex ? material.color.getHex() : 0xffffff;
  }

  // 创建圆形渐变纹理（所有修复复用同一个）
  let sharedCircleTexture = null;
  function getCircleTexture() {
    if (sharedCircleTexture) return sharedCircleTexture;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    sharedCircleTexture = new THREE.CanvasTexture(canvas);
    sharedCircleTexture.wrapS = THREE.ClampToEdgeWrapping;
    sharedCircleTexture.wrapT = THREE.ClampToEdgeWrapping;
    return sharedCircleTexture;
  }

  // ========== 1. 粒子自动安全修复 ==========

  /**
   * 自动扫描并修复 AdditiveBlending 粒子，防止产生白球
   * @param {THREE.Object3D} root - 代码块根节点
   * @returns {Object} 修复统计
   */
  function autoFixParticles(root) {
    if (!root) return { fixed: 0 };
    let fixedCount = 0;

    root.traverse(function (obj) {
      if (!obj.isPoints || !obj.material) return;
      const m = obj.material;
      if (!isAdditiveBlending(m)) return;

      let changed = false;

      // 过大的 size 会导致粒子重叠变白
      if (m.size > SAFE_SIZE) {
        console.log('[粒子修复] size ' + m.size.toFixed(2) + ' -> ' + DEFAULT_SIZE, obj);
        m.size = DEFAULT_SIZE;
        changed = true;
      }

      // 过高的 opacity 在 AdditiveBlending 下叠加会变白
      if (m.opacity > SAFE_OPACITY) {
        console.log('[粒子修复] opacity ' + m.opacity.toFixed(2) + ' -> ' + DEFAULT_OPACITY, obj);
        m.opacity = DEFAULT_OPACITY;
        changed = true;
      }

      // 如果没有纹理，补上圆形渐变纹理
      if (!m.map) {
        m.map = getCircleTexture();
        m.transparent = true;
        m.alphaTest = 0.05;
        m.depthWrite = false;
        changed = true;
      }

      if (changed) {
        m.needsUpdate = true;
        fixedCount++;
      }
    });

    // 额外修复：真正的旧版“伪粒子”面片（用 Plane/Circle/Ring 或 Sprite 模拟的粒子）
    // 注意：不要把 Box/Cylinder/Cone/Sphere/Octahedron 等建筑几何体误判成粒子
    root.traverse(function (obj) {
      if (!obj.isMesh || !obj.material) return;
      const m = obj.material;
      if (m.map) return;

      // 严格限制为“接近纯白”的面片，避免把浅粉、浅蓝等墙体颜色误判
      const hex = getColorHex(m);
      const r = (hex >> 16) & 255;
      const g = (hex >> 8) & 255;
      const b = hex & 255;
      if (r < 240 || g < 240 || b < 240) return;

      const geo = obj.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) return;

      // 只修复平面/圆环等真正用于模拟粒子的面片
      const type = geo.type || '';
      const isBillboard = /PlaneGeometry|CircleGeometry|RingGeometry/i.test(type);
      if (!isBillboard) return;

      m.map = getCircleTexture();
      m.transparent = true;
      m.alphaTest = 0.05;
      m.depthWrite = false;
      if (m.side === undefined || m.side === THREE.FrontSide) {
        m.side = THREE.DoubleSide;
      }
      m.needsUpdate = true;
    });

    return { fixed: fixedCount };
  }

  // ========== 2. 自定义配置应用 ==========

  /**
   * 应用 custom_config 到 threejs_code 对象
   */
  function applyThreejsCode(root, config) {
    if (!root || !config) return;

    root.traverse(function (obj) {
      if (!obj.isPoints || !obj.material) return;
      const m = obj.material;
      if (!isAdditiveBlending(m)) return;

      if (config.particle) {
        const pc = config.particle;
        if (pc.size !== undefined) {
          m.size = parseFloat(pc.size);
        }
        if (pc.opacity !== undefined) {
          m.opacity = parseFloat(pc.opacity);
        }
        if (pc.color) {
          m.color.setStyle(pc.color);
        }
      }

      // 确保纹理存在
      if (!m.map) {
        m.map = getCircleTexture();
        m.transparent = true;
        m.alphaTest = 0.05;
        m.depthWrite = false;
      }

      m.needsUpdate = true;
    });

    // 保存动画速度到 userData，供 onFrame 回调读取
    if (config.animationSpeed !== undefined) {
      root.userData.animationSpeed = parseFloat(config.animationSpeed);
    }
  }

  /**
   * 应用 custom_config 到上传模型
   */
  function applyUploadedModel(root, config) {
    if (!root || !config) return;

    if (config.castShadow !== undefined) {
      root.traverse(function (child) {
        if (child.isMesh) child.castShadow = !!config.castShadow;
      });
    }
    if (config.receiveShadow !== undefined) {
      root.traverse(function (child) {
        if (child.isMesh) child.receiveShadow = !!config.receiveShadow;
      });
    }

    // 动画速度保存在 userData，由动画系统读取
    if (config.animation) {
      if (config.animation.speed !== undefined) {
        root.userData.animSpeedMultiplier = parseFloat(config.animation.speed);
      }
      if (config.animation.loop !== undefined) {
        root.userData.animLoop = !!config.animation.loop;
      }
    }
  }

  /**
   * 应用 custom_config 到几何体建筑
   */
  function applyGeometryBuilding(root, config) {
    if (!root || !config) return;

    root.traverse(function (obj) {
      if (!obj.isMesh || !obj.material) return;
      const m = obj.material;

      if (config.color) {
        m.color.setStyle(config.color);
      }
      if (config.emissive) {
        if (!m.emissive) m.emissive = new THREE.Color();
        m.emissive.setStyle(config.emissive);
      }
      if (config.emissiveIntensity !== undefined) {
        m.emissiveIntensity = parseFloat(config.emissiveIntensity);
      }
      if (config.wireframe !== undefined) {
        m.wireframe = !!config.wireframe;
      }
      m.needsUpdate = true;
    });
  }

  // 类型 -> 应用函数 映射
  const APPLIERS = {
    'threejs_code': applyThreejsCode,
    'uploaded_model': applyUploadedModel,
    'geometry_building': applyGeometryBuilding
  };

  /**
   * 主入口：自动修复 + 应用配置
   * @param {THREE.Object3D} root - 3D 对象根节点
   * @param {Object} modelData - world_objects 行数据（必须包含 type、custom_config）
   * @returns {Object} { fixResult }
   */
  function apply(root, modelData) {
    if (!root || !modelData) return { fixed: 0 };

    const type = modelData.type;

    // Step 1: 自动安全修复（仅 threejs_code 需要防白球）
    let fixResult = { fixed: 0 };
    if (type === 'threejs_code') {
      fixResult = autoFixParticles(root);
    }

    // Step 2: 应用用户保存的自定义配置
    const config = modelData.custom_config;
    if (config && APPLIERS[type]) {
      try {
        APPLIERS[type](root, config);
      } catch (e) {
        console.error('[CustomConfigApplier] 应用配置失败:', type, e);
      }
    }

    return fixResult;
  }

  // 仅自动修复（用于编辑器预览实时更新）
  function autoFix(root, type) {
    if (!root) return { fixed: 0 };
    if (type === 'threejs_code') return autoFixParticles(root);
    return { fixed: 0 };
  }

  window.CustomConfigApplier = {
    apply,
    autoFix,
    autoFixParticles,
    getCircleTexture
  };

  console.log('✅ CustomConfigApplier 已加载');
})();
