/**
 * meshoptSetup.js — 为 GLTFLoader 实例注册 MeshoptDecoder
 * 支持 gltfpack -cc 压缩的 GLB（上传模型自动压缩后，所有展示入口都需要）
 * 用法：在 new THREE.GLTFLoader() 之后调用 window.setupMeshoptLoader(loader);
 * 解码器缓存复用，多次调用只加载一次；失败仅告警不影响其他加载
 */
(function () {
  var cached = null;   // 解码器实例（就绪后缓存）
  var pending = null;  // 加载中的 Promise

  function getDecoder() {
    if (cached) return Promise.resolve(cached);
    if (!pending) {
      pending = import('/js/libs/meshopt/meshopt_decoder.module.js')
        .then(function (m) {
          cached = (m && m.MeshoptDecoder) || null;
          return cached;
        })
        .catch(function (e) {
          console.warn('[Meshopt] 解码器加载失败:', e);
          pending = null;
          return null;
        });
    }
    return pending;
  }

  window.setupMeshoptLoader = function (loader) {
    if (!loader || typeof loader.setMeshoptDecoder !== 'function') return;
    // 解码器已就绪 → 同步注册（关键！parse 是同步的，不能等微任务）
    if (cached) { loader.setMeshoptDecoder(cached); return; }
    getDecoder().then(function (dec) {
      if (dec) loader.setMeshoptDecoder(dec);
    });
  };

  // 返回解码器就绪 Promise：parse 前 await 一次，确保 cached 有值后再同步注册
  window.ensureMeshoptReady = function () {
    return getDecoder();
  };

  // 页面加载即预热解码器（本地模块，下载快；避免首个 meshopt 模型解析时现场等）
  getDecoder();
})();
