/**
 * worldTextureOptimizer.js
 * 主世界页面 GLB 模型纹理降级优化（独立模块，不改动 world.js 黑名单大文件）
 *
 * 背景：编辑器(world_editor.html)已有"纹理降级 4K→1K"方案，内存降低 90%+，
 *       主世界(index.html/world.js)缺失该逻辑，导致 35 个模型 normal 4K 贴图
 *       解码后内存 ≈ 8GB 爆表。
 *
 * 方案：通过包装 World.prototype.loadModelWithRealProgress，在模型解析完成、
 *       onComplete 回调执行前，对 gltf.scene 的所有贴图做 Canvas 重采样降级：
 *       - 所有贴图通道（含 normalMap）超过 maxSize 的降到 maxSize
 *       - 旧纹理 dispose 释放 GPU 内存
 *       - 新纹理继承原纹理的 wrap/filter/encoding/repeat 等参数
 *
 * 依赖：THREE（页面已加载），World 类（world.js 加载完成，window.World 已导出）
 */

(function () {
  'use strict';

  const DEFAULT_MAX_SIZE = 1024; // 目标降级尺寸（与编辑器 EDITOR_TEXTURE_MAX_SIZE 一致）
  const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'specularMap', 'lightMap'];
  let downgradedCount = 0;
  let disposedCount = 0;
  let enabled = true;

  // 纹理降级：把超过 maxSize 的贴图用 Canvas 重采样到目标尺寸
  function downsizeSceneTextures(root, maxSize) {
    if (!root) return;
    const texCache = new Map(); // 旧纹理 → 新纹理（同一纹理被多材质共享时只降级一次）
    root.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((mat) => {
        TEXTURE_SLOTS.forEach((slot) => {
          const tex = mat[slot];
          if (!tex || !tex.image || !tex.image.width || !tex.image.height) return;
          if (Math.max(tex.image.width, tex.image.height) <= maxSize) return;
          let newTex = texCache.get(tex);
          if (!newTex) {
            newTex = downsizeTexture(tex, maxSize);
            if (newTex) {
              texCache.set(tex, newTex);
              downgradedCount++;
              console.log(`[纹理降级] ${slot}: ${tex.image.width}x${tex.image.height} → ${newTex.image.width}x${newTex.image.height}`);
            }
          }
          if (newTex) mat[slot] = newTex;
        });
      });
    });
    // 全部材质替换完成后释放旧纹理（释放 GPU 纹理内存）
    texCache.forEach((newTex, oldTex) => {
      try {
        oldTex.dispose();
        disposedCount++;
      } catch (e) {}
    });
    if (texCache.size > 0) {
      console.log(`[纹理降级] 本次模型降级 ${texCache.size} 张贴图，释放 ${texCache.size} 张旧纹理（累计降级 ${downgradedCount} 张）`);
    }
  }

  function downsizeTexture(texture, maxSize) {
    const img = texture.image;
    try {
      const ratio = maxSize / Math.max(img.width, img.height);
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const newTex = new THREE.CanvasTexture(canvas);
      newTex.wrapS = texture.wrapS;
      newTex.wrapT = texture.wrapT;
      newTex.magFilter = texture.magFilter;
      newTex.minFilter = THREE.LinearMipmapLinearFilter;
      newTex.generateMipmaps = true;
      newTex.encoding = texture.encoding;
      newTex.flipY = texture.flipY;
      newTex.repeat.copy(texture.repeat);
      newTex.offset.copy(texture.offset);
      newTex.rotation = texture.rotation;
      newTex.anisotropy = Math.min(texture.anisotropy || 1, 4);
      newTex.needsUpdate = true;
      return newTex;
    } catch (e) {
      console.warn('[纹理降级] 失败，保留原纹理:', e.message);
      return null;
    }
  }

  // 包装 World.prototype.loadModelWithRealProgress：
  // 在 onComplete 执行前对 gltf.scene 做纹理降级，之后 optimizeMaterial 作用于新纹理
  function patchWorldPrototype() {
    const WorldClass = (typeof window !== 'undefined' && window.World) || (typeof World !== 'undefined' ? World : null);
    if (!WorldClass) {
      console.warn('[纹理降级] World 类未找到，降级未启用');
      return;
    }
    const proto = WorldClass.prototype;
    const origMethod = proto.loadModelWithRealProgress;
    if (!origMethod) {
      console.warn('[纹理降级] loadModelWithRealProgress 不存在，降级未启用');
      return;
    }
    // 防止重复包装
    if (proto.loadModelWithRealProgress.__worldTextureOptimized) {
      console.log('[纹理降级] 已包装，跳过重复包装');
      return;
    }

    proto.loadModelWithRealProgress = function (url, name, onComplete, onError, timeout) {
      const wrappedComplete = (gltf) => {
        if (enabled && gltf && gltf.scene) {
          try {
            downsizeSceneTextures(gltf.scene, DEFAULT_MAX_SIZE);
          } catch (e) {
            console.warn('[纹理降级] 降级异常，使用原模型:', e.message);
          }
        }
        if (typeof onComplete === 'function') onComplete(gltf);
      };
      const result = origMethod.call(this, url, name, wrappedComplete, onError, timeout);
      // 若原方法非 async 返回 Promise，保持兼容
      return result;
    };
    proto.loadModelWithRealProgress.__worldTextureOptimized = true;
    console.log(`[纹理降级] 已启用：World.loadModelWithRealProgress 包装完成，目标尺寸 ${DEFAULT_MAX_SIZE}px（超限贴图自动降级）`);
  }

  // 提供运行时控制接口
  window.WorldTextureOptimizer = {
    downsizeSceneTextures,
    downsizeTexture,
    setEnabled: (v) => { enabled = !!v; },
    getStats: () => ({ downgraded: downgradedCount, disposed: disposedCount, enabled }),
    patch: patchWorldPrototype
  };

  // world.js 同步加载且 window.World 已导出，立即包装
  patchWorldPrototype();

})();
