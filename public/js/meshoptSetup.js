/**
 * meshoptSetup.js — 为 GLTFLoader 实例注册 MeshoptDecoder
 * 支持 gltfpack -cc 压缩的 GLB（上传模型自动压缩后，所有展示入口都需要）
 * 用法：在 new THREE.GLTFLoader() 之后调用 window.setupMeshoptLoader(loader);
 * 解码器缓存复用，多次调用只加载一次；失败仅告警不影响其他加载
 */
(function () {
  var cached = null;

  function getDecoder() {
    if (!cached) {
      cached = import('/js/libs/meshopt/meshopt_decoder.module.js')
        .then(function (m) { return m.MeshoptDecoder; })
        .catch(function (e) {
          console.warn('[Meshopt] 解码器加载失败:', e);
          return null;
        });
    }
    return cached;
  }

  window.setupMeshoptLoader = function (loader) {
    if (!loader || typeof loader.setMeshoptDecoder !== 'function') return;
    getDecoder().then(function (dec) {
      if (dec) loader.setMeshoptDecoder(dec);
    });
  };
})();
