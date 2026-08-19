/**
 * worldTextureOptimizer.js v2
 * 主世界页面 GLB 模型优化（独立模块，不改动 world.js 黑名单大文件）
 *
 * v2 升级（解决"内存降了但加载时卡"）：
 *  1. 模型缓存：同 model_path 只下载/解析一次，多实例浅克隆共享 geometry/纹理（GPU 只占一份）
 *     - 实测场景 45 对象 / 42 有路径 / 25 个唯一文件，缓存把解析次数 42 → 25
 *  2. 材质隔离：每实例 clone 独立材质对象，防止 optimizeMaterial 修改污染共享材质
 *  3. 降级分片：Canvas 重采样每帧只做 PER_FRAME_DOWNSCALE 张，让出主线程，避免加载时页面冻结
 *
 * 失败路径修正（v1 遗留风险）：
 *  - 原方法 async 提前 resolve（gltfLoader.parse 回调后才触发 onComplete），
 *    仅靠 result.catch 无法覆盖"parse 失败 / 超时"路径 → 包装 onError 兜底清理 inflight，
 *    防止同一 URL 后续加载复用永远 pending 的 Promise 而卡死。
 *  - rAF 分片在后台 tab 不触发 → nextFrameWithTimeout 加 500ms 兜底，不会永久挂起。
 *
 * 依赖：THREE（页面已加载），World 类（world.js 加载完成，window.World 已导出）
 */
(function () {
  'use strict';

  const DEFAULT_MAX_SIZE = 1024;       // 目标降级尺寸
  const MAX_MODEL_CACHE = 32;          // 缓存条目上限，超限淘汰最旧（仅移除引用，不 dispose——geometry 可能正被场景实例共享）
  const PER_FRAME_DOWNSCALE = 2;       // 每帧最多降级的贴图数（防主线程冻结）
  const FRAME_WAIT_TIMEOUT = 500;      // 后台 tab rAF 不触发时的兜底等待(ms)
  const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'specularMap', 'lightMap'];

  const modelCache = new Map();        // url → { scene, lastUsed }（缓存原件，不直接进场景）
  const inflight = new Map();          // url → Promise<scene>（并发去重）
  let downgradedCount = 0;
  let disposedCount = 0;
  let cacheHitCount = 0;
  let enabled = true;

  // ===== 安全浅克隆：共享 geometry/material 引用，userData 避免 JSON 深拷贝（GLB extras 可能含不可序列化内容） =====
  function cloneShallow(root) {
    const savedUserData = root.userData;
    root.userData = null; // Object3D.clone() 会对 userData 做 JSON 深拷贝，置空规避循环引用/函数异常
    const clone = root.clone();
    root.userData = savedUserData;      // 恢复原件
    clone.userData = savedUserData || {}; // 共享引用（调用方会覆盖 worldObjectId/name，不影响原件）
    clone.children = [];
    for (let i = 0; i < root.children.length; i++) {
      clone.add(cloneShallow(root.children[i]));
    }
    return clone;
  }

  // 材质隔离：克隆整棵树的材质对象（共享纹理），防外部修改污染共享材质
  function isolateMaterials(root) {
    root.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      if (Array.isArray(child.material)) {
        child.material = child.material.map((m) => m.clone());
      } else {
        child.material = child.material.clone();
      }
    });
  }

  // ===== 单张贴图降级（同步，单张耗时 30~100ms，故由外层分片调度） =====
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
      console.warn('[纹理降级] 单张贴图降级失败，保留原纹理:', e.message);
      return null;
    }
  }

  // rAF 让帧 + 超时兜底（后台 tab 不触发 rAF 时最多等 ms 毫秒继续，避免永久挂起）
  function nextFrameWithTimeout(ms) {
    return new Promise((resolve) => {
      let rafId = 0;
      const timer = setTimeout(() => {
        if (rafId) cancelAnimationFrame(rafId);
        resolve();
      }, ms);
      rafId = requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // ===== 场景纹理降级（分片异步，每帧最多 PER_FRAME_DOWNSCALE 张） =====
  async function downsizeSceneTextures(root, maxSize) {
    if (!root) return;
    // 收集需要降级的纹理（按 texture 对象去重，多材质共享时只降级一次）
    const texSet = new Set();
    root.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((mat) => {
        TEXTURE_SLOTS.forEach((slot) => {
          const tex = mat[slot];
          if (tex && tex.image && tex.image.width && tex.image.height &&
              Math.max(tex.image.width, tex.image.height) > maxSize) {
            texSet.add(tex);
          }
        });
      });
    });
    if (texSet.size === 0) return;

    // 分片降级（rAF 让出主线程，页面不冻结；后台 tab 有超时兜底）
    const oldTexs = [...texSet];
    const newTexMap = new Map();
    for (let i = 0; i < oldTexs.length; i++) {
      const oldTex = oldTexs[i];
      const newTex = downsizeTexture(oldTex, maxSize);
      if (newTex) {
        newTexMap.set(oldTex, newTex);
        downgradedCount++;
        console.log(`[纹理降级] ${oldTex.image.width}x${oldTex.image.height} → ${newTex.image.width}x${newTex.image.height}（累计 ${downgradedCount} 张）`);
      }
      if ((i + 1) % PER_FRAME_DOWNSCALE === 0 && i + 1 < oldTexs.length) {
        await nextFrameWithTimeout(FRAME_WAIT_TIMEOUT);
      }
    }

    // 替换材质引用（共享纹理时多材质同时更新）
    root.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((mat) => {
        TEXTURE_SLOTS.forEach((slot) => {
          const oldTex = mat[slot];
          if (oldTex && newTexMap.has(oldTex)) mat[slot] = newTexMap.get(oldTex);
        });
      });
    });

    // 释放旧纹理（GPU 内存）
    newTexMap.forEach((_newTex, oldTex) => {
      try { oldTex.dispose(); disposedCount++; } catch (e) {
        console.warn('[纹理降级] 旧纹理释放失败:', e && e.message);
      }
    });
    console.log(`[纹理降级] 本次降级 ${newTexMap.size} 张，释放旧纹理 ${newTexMap.size} 张（累计降级 ${downgradedCount} / 释放 ${disposedCount}）`);
  }

  // ===== 缓存管理 =====
  // 条目结构：{ scene, lastUsed, refCount, dead }
  //  - refCount：当前场景中引用此缓存的实例数（makeInstance +1 / releaseInstance -1）
  //  - dead：已被 LRU 淘汰但仍有实例引用，等引用归零时真释放（disposeScene）
  function cacheGet(url) {
    const entry = modelCache.get(url);
    if (entry && !entry.dead) {
      entry.lastUsed = Date.now();
      return entry.scene;
    }
    return null;
  }
  function evictLRU() {
    // 优先驱逐无实例引用的最旧条目（可立即真释放 GPU 资源）
    let oldestKey = null, oldestTime = Infinity;
    modelCache.forEach((v, k) => {
      if (v.refCount === 0 && !v.dead && v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldestKey = k;
      }
    });
    if (oldestKey) {
      const entry = modelCache.get(oldestKey);
      disposeScene(entry.scene);
      modelCache.delete(oldestKey);
      console.log(`[纹理优化] 缓存超限，真释放最旧: ${oldestKey}（剩余 ${modelCache.size}）`);
      return;
    }
    // 全部都有实例引用：标记最旧为 dead（不可再命中，引用归零时真释放）
    let oldestKey2 = null, oldestTime2 = Infinity;
    modelCache.forEach((v, k) => {
      if (!v.dead && v.lastUsed < oldestTime2) { oldestTime2 = v.lastUsed; oldestKey2 = k; }
    });
    if (oldestKey2) {
      modelCache.get(oldestKey2).dead = true;
      console.log(`[纹理优化] 缓存超限，标记最旧待释放（引用未归零）: ${oldestKey2}`);
    }
  }
  function cacheSet(url, scene) {
    if (modelCache.size >= MAX_MODEL_CACHE) evictLRU();
    modelCache.set(url, { scene, lastUsed: Date.now(), refCount: 0, dead: false });
  }

  // ===== 构造给调用方的实例（clone + 材质隔离，缓存原件永不直接进场景） =====
  // v3: 实例记录来源 url（__texOptSource）+ 引用计数 +1，供 releaseInstance 归零真释放
  function makeInstance(scene, url) {
    const inst = cloneShallow(scene);
    isolateMaterials(inst);
    if (url) {
      // 复制一份 userData 再附加来源，避免污染缓存原件的共享 userData
      inst.userData = { ...(inst.userData || {}), __texOptSource: url };
      const entry = modelCache.get(url);
      if (entry) entry.refCount++;
    }
    return inst;
  }

  // ===== 释放实例：引用计数 -1，归零且条目已死亡（dead）时真释放 GPU 资源 =====
  function releaseInstance(inst) {
    if (!inst || !inst.userData) return false;
    const url = inst.userData.__texOptSource;
    if (!url) return false;
    const entry = modelCache.get(url);
    if (!entry || entry.refCount <= 0) return false;
    entry.refCount--;
    if (entry.dead && entry.refCount === 0) {
      disposeScene(entry.scene);
      modelCache.delete(url);
      console.log(`[纹理优化] 僵尸缓存最后引用释放，真释放 GPU 资源: ${url}`);
      return true;
    }
    return false;
  }

  // ===== 真释放：dispose 场景内全部 geometry + 纹理 + 材质 =====
  function disposeScene(scene) {
    if (!scene) return;
    try {
      scene.traverse((child) => {
        if (!child.isMesh) return;
        if (child.geometry) {
          try { child.geometry.dispose(); } catch (e) {}
        }
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          if (!mat) return;
          TEXTURE_SLOTS.forEach((slot) => {
            const tex = mat[slot];
            if (tex) {
              try { tex.dispose(); } catch (e) {}
            }
          });
          try { mat.dispose(); } catch (e) {}
        });
      });
    } catch (e) {
      console.warn('[纹理优化] 真释放场景资源失败:', e.message);
    }
  }

  // ===== 强制释放某 url 的缓存（外部调用：world.js cleanupModelCache 淘汰时） =====
  function disposeModel(url) {
    if (!url) return { released: false, reason: 'no-url' };
    const entry = modelCache.get(url);
    if (!entry) return { released: false, reason: 'not-in-cache' };
    if (entry.refCount > 0) {
      // 仍有实例引用：标记死亡，等最后一个实例释放时真释放
      entry.dead = true;
      return { released: false, reason: 'still-referenced', refCount: entry.refCount };
    }
    disposeScene(entry.scene);
    modelCache.delete(url);
    console.log(`[纹理优化] 强制释放缓存: ${url}`);
    return { released: true };
  }

  // ===== 包装 World.prototype.loadModelWithRealProgress =====
  function patchWorldPrototype() {
    const WorldClass = (typeof window !== 'undefined' && window.World) || (typeof World !== 'undefined' ? World : null);
    if (!WorldClass) {
      console.warn('[纹理优化] World 类未找到，优化未启用');
      return;
    }
    const proto = WorldClass.prototype;
    const origMethod = proto.loadModelWithRealProgress;
    if (typeof origMethod !== 'function') {
      console.warn('[纹理优化] loadModelWithRealProgress 不存在，优化未启用');
      return;
    }
    if (proto.loadModelWithRealProgress.__worldTextureOptimizedV2) {
      console.log('[纹理优化] 已包装 v2，跳过重复包装');
      return;
    }

    proto.loadModelWithRealProgress = function (url, name, onComplete, onError, timeout) {
      // 1. 缓存命中：直接克隆返回（不再下载/解析/降级）
      const cached = enabled ? cacheGet(url) : null;
      if (cached) {
        cacheHitCount++;
        console.log(`[纹理优化] 缓存命中: ${url}（累计复用 ${cacheHitCount} 次）`);
        if (typeof onComplete === 'function') onComplete({ scene: makeInstance(cached, url), animations: [] });
        return Promise.resolve();
      }

      // 2. 同一 URL 已有并发加载：复用同一个 Promise
      if (inflight.has(url)) {
        return inflight.get(url).then((scene) => {
          if (typeof onComplete === 'function') onComplete({ scene: makeInstance(scene, url), animations: [] });
        }).catch((e) => {
          if (typeof onError === 'function') onError(e);
        });
      }

      // 3. 首次加载：降级完成后入缓存，onComplete 收到克隆实例
      const p = new Promise((resolve, reject) => {
        const wrappedComplete = async (gltf) => {
          try {
            if (enabled && gltf && gltf.scene) {
              await downsizeSceneTextures(gltf.scene, DEFAULT_MAX_SIZE);
            }
            if (enabled && gltf && gltf.scene) cacheSet(url, gltf.scene);
            resolve(gltf && gltf.scene);
            if (typeof onComplete === 'function') {
              onComplete({ scene: makeInstance(gltf.scene, url), animations: (gltf && gltf.animations) || [] });
            }
          } catch (e) {
            console.warn('[纹理优化] 降级异常，回退原模型:', e.message);
            resolve(gltf && gltf.scene);
            if (typeof onComplete === 'function') onComplete(gltf);
          }
        };
        const wrappedError = (e) => {
          // 关键：所有失败路径（fetch 失败 / parse 失败 / 超时）都清掉 inflight，
          // 否则同一 URL 后续加载会复用永远 pending 的 Promise 而卡死
          inflight.delete(url);
          if (typeof onError === 'function') onError(e);
          reject(e);
        };
        try {
          const result = origMethod.call(this, url, name, wrappedComplete, wrappedError, timeout);
          if (result && typeof result.catch === 'function') {
            result.catch((e) => {
              inflight.delete(url);
              if (typeof onError === 'function') onError(e);
              reject(e);
            });
          }
        } catch (e) {
          wrappedError(e);
        }
      });
      inflight.set(url, p);
      // 防 unhandled rejection（调用方通常不消费返回值，只依赖自己的 onError 回调）
      p.finally(() => inflight.delete(url)).catch(() => {});
      return p;
    };
    proto.loadModelWithRealProgress.__worldTextureOptimizedV2 = true;
    console.log(`[纹理优化] v2 已启用：模型缓存(上限 ${MAX_MODEL_CACHE}) + 材质隔离 + 分片降级(每帧 ${PER_FRAME_DOWNSCALE} 张，目标 ${DEFAULT_MAX_SIZE}px)`);
  }

  // 运行时控制接口
  window.WorldTextureOptimizer = {
    downsizeSceneTextures,
    downsizeTexture,
    makeInstance,
    releaseInstance,
    disposeModel,
    setEnabled: (v) => { enabled = !!v; },
    getStats: () => ({
      downgraded: downgradedCount,
      disposed: disposedCount,
      cacheHit: cacheHitCount,
      cacheSize: modelCache.size,
      refCountTotal: [...modelCache.values()].reduce((s, v) => s + v.refCount, 0),
      deadCount: [...modelCache.values()].filter((v) => v.dead).length,
      enabled
    }),
    patch: patchWorldPrototype
  };

  // world.js 同步加载且 window.World 已导出，立即包装
  patchWorldPrototype();
})();
