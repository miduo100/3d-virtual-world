/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 智能动作加载器 (Smart Animation Loader)
 * 功能：根据文件后缀自动选择 GLTFLoader 或 FBXLoader
 * 适用场景：虚拟世界角色动作加载（支持 .glb / .gltf / .fbx）
 *
 * 提取自 world.js _loadPlayerAnimGlb 函数，符合单文件 ≤500 行规范
 */

const AnimLoader = (() => {
  'use strict';

  // ========== 配置 ==========
  // FBXLoader 为 three@0.160.0 的 ESM 模块，必须用 import() 动态加载
  // （其内部对 'three' 的引用由 index.html 的 import map 指向 /js/lib/three-shim.js，
  //  从而复用页面全局 UMD THREE，避免双实例冲突）。
  // 注意：r160 已无 inflate.module.min.js（改用 fflate.module.js），且 FBXLoader 内部
  //  依赖的相对路径（../libs/fflate.module.js、../curves/NURBSCurve.js 等）在本地 three-examples 目录内相对解析。
  const CONFIG = {
    DEBUG: true,
    FBX_LOADER_CDN: '/js/lib/three-examples/loaders/FBXLoader.js'
  };

  // 缓存已创建的 FBXLoader 实例（ESM 导入，不挂全局）
  let _fbxLoaderClass = null;
  let _fbxLoaderInstance = null;
  let _fbxLoaderPromise = null;

  /**
   * 日志输出
   */
  function _log(level, msg, ...args) {
    if (!CONFIG.DEBUG && level === 'debug') return;
    const prefix = '[AnimLoader]';
    switch (level) {
      case 'debug': console.log(prefix, msg, ...args); break;
      case 'info':  console.log(prefix, msg, ...args); break;
      case 'warn':  console.warn(prefix, msg, ...args); break;
      case 'error': console.error(prefix, msg, ...args); break;
    }
  }

  /**
   * 判断文件是否为 FBX 格式
   */
  function isFBXFile(url) {
    return url && url.toLowerCase().endsWith('.fbx');
  }

  /**
   * 判断文件是否为 GLB/GLTF 格式
   */
  function isGLTFFile(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.endsWith('.glb') || lower.endsWith('.gltf');
  }

  /**
   * 异步获取 FBXLoader 实例
   * FBXLoader 是 ESM 模块，必须用 import() 动态加载（不能用普通 <script>）。
   * 其内部对 'three' 的引用由 import map 指向本地 three-shim.js，
   * 复用页面全局 UMD THREE 实例。
   * @returns {Promise<FBXLoader>}
   */
  function _getFBXLoader() {
    // 已成功加载 ESM 类
    if (_fbxLoaderClass) {
      return Promise.resolve(new _fbxLoaderClass());
    }
    // 正在加载中，复用 Promise
    if (_fbxLoaderPromise) {
      return _fbxLoaderPromise.then(() => new _fbxLoaderClass());
    }
    // 动态加载 ESM 版 FBXLoader（import map 负责解析裸 'three' 说明符）
    _fbxLoaderPromise = import(CONFIG.FBX_LOADER_CDN)
      .then((mod) => {
        if (!mod || !mod.FBXLoader) {
          throw new Error('FBXLoader 模块未导出 FBXLoader');
        }
        _fbxLoaderClass = mod.FBXLoader;
        _fbxLoaderInstance = new _fbxLoaderClass();
        _log('info', '✅ FBXLoader 动态加载完成（ESM）');
        return _fbxLoaderInstance;
      })
      .catch((err) => {
        _fbxLoaderPromise = null; // 重置，允许重试
        throw err;
      });
    return _fbxLoaderPromise;
  }

  /**
   * 创建 GLTFLoader 实例（复用项目配置）
   * @returns {THREE.GLTFLoader}
   */
  function _createGLTFLoader() {
    const loader = new THREE.GLTFLoader();
    if (THREE.DRACOLoader) {
      const dracoLoader = new THREE.DRACOLoader();
      dracoLoader.setDecoderPath('/js/libs/draco/');
      loader.setDRACOLoader(dracoLoader);
    }
    return loader;
  }

  /**
   * 检查 FBXLoader 是否可用（同步检查）
   * 注意：ESM 版 FBXLoader 不会挂到全局 THREE，故检查内部缓存的类。
   */
  function isFBXSupported() {
    return !!_fbxLoaderClass || typeof THREE.FBXLoader !== 'undefined';
  }

  /**
   * 核心：智能加载动作文件
   *
   * @param {string} url - 动作文件 URL（支持 .glb / .gltf / .fbx）
   * @param {Object} options - 配置选项
   * @param {THREE.Object3D} options.model - 角色模型（用于重定向）
   * @param {Function} options.onLoaded - 成功回调 (animations: Array) => {}
   * @param {Function} options.onError - 失败回调 (err: Error) => {}
   * @param {Function} options.onProgress - 进度回调 (percent: number) => {}
   */
  function loadAnimFile(url, options = {}) {
    const { model, onLoaded, onError, onProgress } = options;

    if (!url) {
      _log('warn', 'URL 为空');
      if (onError) onError(new Error('动画文件 URL 为空'));
      return;
    }

    // ── 根据文件后缀选择加载器 ──
    const fileIsFBX = isFBXFile(url);
    _log('info', `🎬 使用 ${fileIsFBX ? 'FBXLoader' : 'GLTFLoader'} 加载: ${url}`);

    if (fileIsFBX) {
      // ====== FBX 加载路径 ======
      _getFBXLoader().then((fbxLoader) => {
        fbxLoader.load(
          url,
          (fbxGroup) => {
            // FBX 返回的是 Group，动画在 group.animations 中
            const animations = fbxGroup.animations || [];

            if (!animations.length) {
              _log('warn', `⚠️ FBX 文件无动画数据: ${url}`);
              if (onError) onError(new Error('FBX 文件无动画数据'));
              return;
            }

            _log('info', `✅ FBX 加载成功: ${animations.length} 个动画`);
            if (onLoaded) onLoaded(animations);

            // 清理 FBX 场景（只保留动画数据）
            if (fbxGroup.parent) fbxGroup.parent.remove(fbxGroup);
            fbxGroup.traverse((child) => {
              if (child.geometry) child.geometry.dispose();
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach(m => m.dispose());
                } else {
                  child.material.dispose();
                }
              }
            });
          },
          (xhr) => {
            if (xhr.total > 0 && onProgress) {
              onProgress(Math.round((xhr.loaded / xhr.total) * 100));
            }
          },
          (err) => {
            _log('error', `❌ FBX 加载失败: ${url}`, err);
            if (onError) onError(err);
          }
        );
      }).catch((err) => {
        _log('error', '❌ FBXLoader 初始化失败:', err.message);
        _log('warn', '💡 FBXLoader 通过 ESM 动态加载，请确认 index.html 的 import map 已配置且 CDN 可访问');
        if (onError) onError(err);
      });

    } else {
      // ====== GLB/GLTF 加载路径 ======
      const gltfLoader = _createGLTFLoader();
      gltfLoader.load(
        url,
        (gltf) => {
          const animations = gltf.animations || [];

          if (!animations.length) {
            _log('warn', `⚠️ GLB/GLTF 文件无动画数据: ${url}`);
            if (onError) onError(new Error('GLB/GLTF 文件无动画数据'));
            return;
          }

          _log('info', `✅ GLB/GLTF 加载成功: ${animations.length} 个动画`);
          if (onLoaded) onLoaded(animations);
        },
        (xhr) => {
          if (xhr.total > 0 && onProgress) {
            onProgress(Math.round((xhr.loaded / xhr.total) * 100));
          }
        },
        (err) => {
          _log('error', `❌ GLB/GLTF 加载失败: ${url}`, err);
          if (onError) onError(err);
        }
      );
    }
  }

  // ========== 公共 API ==========
  return {
    loadAnimFile,
    isFBXFile,
    isGLTFFile,
    isFBXSupported,
    CONFIG
  };
})();

// 导出到全局
window.AnimLoader = AnimLoader;
