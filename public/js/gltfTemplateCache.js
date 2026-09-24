/**
 * gltfTemplateCache.js v1 — 同模板多玩家复用（首屏加载丝滑化 Step 3.2）
 * ------------------------------------------------------------------
 * 定位（§7）：浏览器 HTTP 缓存只省"字节"，不省"解析"与"显存"。
 * 同一角色模板 URL 被 N 个玩家加载时：
 *   - 网络字节层：浏览器已覆盖（max-age=2592000, immutable），不归本模块管；
 *   - 解析层（主线程 GLTFLoader.parse）：N → 1；
 *   - 显存层（Texture/Geometry）：N → 1（克隆共享 geometry/texture）。
 *
 * 机制：包装 THREE.GLTFLoader.prototype.load，**只拦截被 register() 过的 URL**
 * （由 playerModelScheduler 在放行玩家模型/动画前注册），场景模型/武器等未注册
 * URL 完全走原路径零影响。
 *  - miss：【二期B】走 Worker 解析（strict：保留骨骼/蒙皮/动画），源 gltf 存入
 *    缓存，向调用方交付【克隆】（源保持纯净，防止第一个玩家的 fitModel/缩放污染源）；
 *    动画 GLB 同走此路径（独立动画文件的 scene 极小，克隆成本可忽略，每玩家独立
 *    clip 的语义与模型一致）；
 *  - hit / 在途等待：交付克隆，不再触发下载与解析；
 *  - 克隆用 SkeletonUtils.clone（蒙皮正确换绑骨骼，vendor 于
 *    /js/lib/three-examples/utils/SkeletonUtils.js）；
 *  - 每位玩家独立克隆 AnimationClip（track.values 深拷贝）——animConventionCompensator
 *    会就地改 track.values，共享 clip 会造成"第二人进来后第一人动画错乱"；
 *  - 每位玩家独立克隆材质（共享纹理引用）——受击闪红/换色等就地改材质的操作
 *    不会跨玩家串扰（§7.3-3 材质隔离）；
 *  - 去重键 = hostname + pathname（忽略 scheme 与 query）——项目已知 http/https
 *    前缀分裂（assetProtocolFix 就是为 Mixed Content 修的），不归一化会白解析两次。
 *
 * LRU 上限（默认 12，可调）：淘汰 = 从 Map 移除条目；**绝不 dispose 共享
 * geometry/texture**（§7.3-5）——克隆仍在引用它们，dispose 会把在场玩家模型弄花。
 * 源 scene 图本身失去引用后由 GC 自然回收。
 *
 * 已知边界（§7.4）：跨世界·不同源世界同模板（域名不同）= 物理上两份文件，不合并；
 * https 页面 ← 源世界只有 http = Mixed Content 被拦，取不到（与缓存无关）。
 */
(function () {
  'use strict';

  var THREE = window.THREE;
  if (!THREE || !THREE.GLTFLoader) {
    console.warn('[GltfTemplateCache] THREE.GLTFLoader 不存在，模块未启用');
    return;
  }

  var LRU_CAP = 12;                    // 可调（8~16，§7.3-5）
  var SKELETON_UTILS_URL = '/js/lib/three-examples/utils/SkeletonUtils.js?v=1';

  /** key -> { state:'loading'|'ready', source, waiters:[{onLoad,onError}], lastUsed } */
  var store = new Map();
  /** 被调度器注册过的 key（玩家模板 URL 名单；未注册的 URL 不拦截） */
  var managed = new Set();

  var stats = {
    hitCount: 0,          // 从缓存交付（含在途等待合并）的次数
    missCount: 0,         // 触发真实加载的次数
    parseCount: 0,        // 真实解析次数（= missCount）
    sharedInstances: 0,   // 交付出去的克隆实例数
    evictions: 0
  };

  // ---------- key 归一化：hostname + pathname（忽略 scheme 与 query） ----------
  function keyOf(url) {
    try {
      var u = new URL(String(url), window.location.href);
      return u.host + u.pathname;
    } catch (e) {
      return String(url);
    }
  }

  // ---------- SkeletonUtils 动态加载（一次性） ----------
  var _suPromise = null;
  function ensureSkeletonUtils() {
    if (window.__vendorSkeletonUtils) return Promise.resolve(window.__vendorSkeletonUtils);
    if (!_suPromise) {
      _suPromise = import(SKELETON_UTILS_URL).then(function (m) {
        window.__vendorSkeletonUtils = m;
        return m;
      }).catch(function (e) {
        _suPromise = null;
        throw e;
      });
    }
    return _suPromise;
  }

  // ---------- 每位玩家独立克隆材质（共享纹理引用，§7.2 材质隔离） ----------
  function isolateMaterials(scene) {
    scene.traverse(function (o) {
      if (o.isMesh || o.isSkinnedMesh) {
        if (Array.isArray(o.material)) {
          o.material = o.material.map(function (m) { return m.clone(); });
        } else if (o.material) {
          o.material = o.material.clone();
        }
      }
    });
  }

  // ---------- 交付克隆（异步，保持原 load 回调的异步语义） ----------
  function deliverClone(entry, onLoad, onError) {
    ensureSkeletonUtils().then(function (SU) {
      var scene, animations;
      try {
        scene = SU.clone(entry.source.scene);
        isolateMaterials(scene);
        // AnimationClip.clone 深拷贝 times/values —— 满足"每人动画必须克隆"（§7.3-2）
        animations = (entry.source.animations || []).map(function (c) { return c.clone(); });
      } catch (e) {
        if (onError) setTimeout(function () { onError(e); }, 0);
        console.warn('[GltfTemplateCache] 克隆失败，回退原始加载:', e && e.message);
        return;
      }
      stats.sharedInstances++;
      entry.shared++;
      entry.lastUsed = Date.now();
      setTimeout(function () {
        try { onLoad({ scene: scene, animations: animations }); }
        catch (e) { console.error('[GltfTemplateCache] 调用方 onLoad 异常:', e); }
      }, 0);
    }).catch(function (e) {
      if (onError) setTimeout(function () { onError(e); }, 0);
    });
  }

  // ---------- LRU ----------
  function evictIfNeeded() {
    while (store.size > LRU_CAP) {
      var oldestKey = null, oldest = Infinity;
      store.forEach(function (e, k) {
        if (e.state === 'loading') return; // 在途不淘汰
        if (e.lastUsed < oldest) { oldest = e.lastUsed; oldestKey = k; }
      });
      if (oldestKey == null) break;
      store.delete(oldestKey);
      stats.evictions++;
      // 禁止 dispose 共享 geometry/texture —— 克隆仍在引用（§7.3-5）
    }
  }

  // ---------- 包装 THREE.GLTFLoader.prototype.load ----------
  var origLoad = THREE.GLTFLoader.prototype.load;
  /** 【二期B】玩家模板专用 Worker 实例（与场景 GLB 队列隔离——实测共享 Worker 时
   * 在线玩家 28MB 模型 + 场景大 GLB 会把小角色模型排队挤到 +7s）。
   * 模块加载即创建（Worker 启动=importScripts three.min.js 860KB，冷启动成本
   * 落在加载屏期并行完成，首个玩家模型解析时零等待）。 */
  var playerWorker = (window.GltfWorkerClient && typeof window.GltfWorkerClient.create === 'function')
    ? window.GltfWorkerClient.create()
    : null;
  function ensurePlayerWorker() {
    if (playerWorker) return playerWorker;
    if (window.GltfWorkerClient && typeof window.GltfWorkerClient.create === 'function') {
      playerWorker = window.GltfWorkerClient.create();
    }
    return playerWorker;
  }
  /** 【二期B】miss 路径改走 Worker 解析（strict：保留骨骼/蒙皮/动画），
   * 把主线程解析长任务（28MB 模板实测 ~2.7s）整体移出主线程；
   * worker 不可序列化时 parseBuffer 内部自动回落主线程 parse（与旧 origLoad 等价）。 */
  function parseViaWorker(url, loaderInstance) {
    var client = ensurePlayerWorker() || window.GltfWorkerClient;
    if (!client) return Promise.reject(new Error('no worker client'));
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.arrayBuffer();
    }).then(function (buf) {
      return client.parseBuffer(buf, {
        strict: true,
        maxTexSize: Infinity,          // 玩家模型纹理不降级（§7.3-6）
        fallbackLoader: loaderInstance // 兜底用调用方自己的 loader（已配 Draco）
      });
    });
  }

  THREE.GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
    var key = keyOf(url);
    if (!managed.has(key)) {
      return origLoad.call(this, url, onLoad, onProgress, onError); // 场景/武器等：原路径
    }

    var entry = store.get(key);
    if (entry && entry.state === 'ready') {
      stats.hitCount++;
      entry.hits++;
      deliverClone(entry, onLoad, onError);
      return;
    }
    if (entry && entry.state === 'loading') {
      // 在途合并：等首个加载完成后一起收克隆（不再发起第二次下载/解析）
      stats.hitCount++;
      entry.hits++;
      entry.waiters.push({ onLoad: onLoad, onError: onError });
      return;
    }

    // miss：解析一次（本调用方与后续等待者都收克隆，源保持纯净）
    stats.missCount++;
    stats.parseCount++;
    var e = { state: 'loading', source: null, waiters: [], lastUsed: Date.now(), parses: 1, hits: 0, shared: 0, viaWorker: null };
    store.set(key, e);

    var useWorker = !!(window.GltfWorkerClient && window.fetch);
    var settled = false;
    var onParsed = function (result) {
      if (settled || store.get(key) !== e) return;
      settled = true;
      e.source = { scene: result.scene, animations: result.animations || [] };
      e.viaWorker = !!result.__viaWorker;
      e.state = 'ready';
      e.lastUsed = Date.now();
      deliverClone(e, onLoad, onError);
      var ws = e.waiters.splice(0);
      for (var i = 0; i < ws.length; i++) deliverClone(e, ws[i].onLoad, ws[i].onError);
      evictIfNeeded();
    };
    var onParseError = function (err) {
      if (settled || store.get(key) !== e) return;
      settled = true;
      store.delete(key);
      if (onError) onError(err);
      var ws = e.waiters.splice(0);
      for (var i = 0; i < ws.length; i++) { if (ws[i].onError) ws[i].onError(err); }
    };

    if (useWorker) {
      parseViaWorker(url, this).then(onParsed, onParseError);
    } else {
      // Worker 基建缺失：回落原 GLTFLoader.load（旧路径）
      origLoad.call(this, url, function (gltf) {
        onParsed({ scene: gltf.scene, animations: gltf.animations || [], __viaWorker: false });
      }, onProgress, onParseError);
    }
  };

  window.GltfTemplateCache = {
    /** 调度器在放行玩家模型/动画加载前注册 URL（此后该 URL 的 GLTFLoader.load 走缓存） */
    register: function (url) {
      if (!url) return;
      managed.add(keyOf(url));
    },
    setLruCap: function (n) { LRU_CAP = Math.max(1, n | 0); },
    /** 诊断/断言用（§7.3-7）。keys[] 含 per-key 统计（同模板去重断言按 key 判定，
     *  不受真实在线玩家其他模板影响） */
    _diag: function () {
      var keys = [];
      store.forEach(function (e, k) {
        keys.push({ key: k, state: e.state, waiters: e.waiters.length, ageMs: Date.now() - e.lastUsed, parses: e.parses || 0, hits: e.hits || 0, shared: e.shared || 0, viaWorker: e.viaWorker === null ? null : !!e.viaWorker });
      });
      return {
        hitCount: stats.hitCount,
        missCount: stats.missCount,
        parseCount: stats.parseCount,
        sharedInstances: stats.sharedInstances,
        estimatedSavedParses: stats.hitCount,
        evictions: stats.evictions,
        lruCap: LRU_CAP,
        managedCount: managed.size,
        workerStats: playerWorker ? playerWorker.stats() : null,
        keys: keys
      };
    }
  };

  console.log('[GltfTemplateCache] ✅ 已启用（同模板复用：解析/显存 N→1，LRU=' + LRU_CAP + '）');
})();
