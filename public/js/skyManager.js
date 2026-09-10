/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * skyManager.js — 自定义天空（全景图 JPG/PNG、HDR EXR）管理
 *
 * 设计要点：
 *  1. 天空库由管理后台维护（/api/sky），选中项随天气配置（sky 字段）下发；
 *     sky = null / kind = 'default' 即「默认天空」= 系统原有纯色背景行为（零回归）。
 *  2. 选中自定义天空后，所有天气都用它做背景，天气改为控制
 *     backgroundIntensity（明暗）与 backgroundBlurriness（朦胧）+ 原有雾/粒子，
 *     从而实现「天气配合天空」而不是互相打架。
 *  3. HDR 走惰性 import EXRLoader（不用 exr 时零下载），use_env 时用 PMREM 生成环境光照。
 *  4. 任何加载失败都回退默认纯色并 console.warn，绝不让世界变黑屏（绝不静默失败）。
 */
(function (global) {
  'use strict';

  const THREE = global.THREE;

  // 天气 → 天空纹理的明暗/朦胧调参（仅对自定义天空生效）
  const WEATHER_TUNE = {
    clear: { intensity: 1.00, blurriness: 0.00 },
    rain:  { intensity: 0.50, blurriness: 0.15 },
    snow:  { intensity: 0.85, blurriness: 0.10 },
    fog:   { intensity: 0.70, blurriness: 0.35 },
    storm: { intensity: 0.40, blurriness: 0.20 }
  };

  const state = {
    scene: null,
    renderer: null,
    sky: null,          // 当前选中的天空对象（null = 默认天空）
    weather: 'clear',   // 当前天气类型
    texture: null,      // 当前背景纹理
    envRT: null,        // PMREM 环境贴图 RenderTarget
    loading: false,
    loadToken: 0,       // 防止并发加载互相覆盖
    cache: new Map(),   // url -> texture
    attached: false
  };

  function warn(msg, err) {
    console.warn('[SkyManager] ' + msg + (err ? '：' + (err.message || err) : ''));
  }

  function attach(scene, renderer) {
    if (scene) state.scene = scene;
    if (renderer) state.renderer = renderer;
    state.attached = !!(state.scene && state.renderer);
  }

  /** 应用天气调参（明暗/朦胧），只对纹理背景生效 */
  function applyTuning() {
    if (!state.scene) return;
    const tune = WEATHER_TUNE[state.weather] || WEATHER_TUNE.clear;
    if (state.scene.background && state.scene.background.isTexture) {
      state.scene.backgroundIntensity = tune.intensity;
      state.scene.backgroundBlurriness = tune.blurriness;
    } else {
      state.scene.backgroundIntensity = 1;
      state.scene.backgroundBlurriness = 0;
    }
  }

  /** 生成/清理环境光照（PBR 反射） */
  function applyEnvironment() {
    if (!state.scene) return;
    const need = !!(state.sky && state.sky.use_env && state.texture && state.renderer && THREE.PMREMGenerator);
    if (!need) {
      if (state.envRT) {
        state.envRT.dispose();
        state.envRT = null;
      }
      if (state.scene.environment && state.scene.environment.__skyEnv) {
        state.scene.environment = null;
      }
      return;
    }
    try {
      const pmrem = new THREE.PMREMGenerator(state.renderer);
      const rt = pmrem.fromEquirectangular(state.texture);
      pmrem.dispose();
      if (state.envRT) state.envRT.dispose();
      state.envRT = rt;
      rt.texture.__skyEnv = true;
      state.scene.environment = rt.texture;
    } catch (e) {
      warn('生成环境光照失败，已仅保留背景', e);
    }
  }

  /** 把已加载好的纹理装到场景背景上 */
  function paint() {
    if (!state.scene) return;
    if (state.texture) {
      state.scene.background = state.texture;
    }
    applyTuning();
    applyEnvironment();
  }

  /** 回到默认天空（纯色），由 world.js 提供颜色 */
  function resetToDefault() {
    state.sky = null;
    state.texture = null;
    applyEnvironment(); // 清掉 environment
    if (state.scene) {
      state.scene.backgroundIntensity = 1;
      state.scene.backgroundBlurriness = 0;
    }
  }

  function loadTexture(sky) {
    if (state.cache.has(sky.url)) return Promise.resolve(state.cache.get(sky.url));

    if (sky.kind === 'hdr') {
      // 惰性加载 EXRLoader：只有真的用了 EXR 天空才会下载这 86KB
      return import('/js/lib/three-examples/loaders/EXRLoader.js')
        .then((mod) => {
          const loader = new mod.EXRLoader();
          return new Promise((resolve, reject) => {
            loader.load(sky.url, resolve, undefined, reject);
          });
        })
        .then((tex) => {
          tex.mapping = THREE.EquirectangularReflectionMapping;
          tex.colorSpace = THREE.LinearSRGBColorSpace; // HDR 是线性数据
          tex.needsUpdate = true;
          state.cache.set(sky.url, tex);
          return tex;
        });
    }

    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(sky.url, resolve, undefined, reject);
    }).then((tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      state.cache.set(sky.url, tex);
      return tex;
    });
  }

  /**
   * 应用天空配置（由 world.js 的 setWeather 调用）
   * @param {object|null|undefined} sky  下发的天空对象；undefined 表示不改动
   * @param {string} [weatherType]
   */
  function applyConfig(sky, weatherType) {
    if (weatherType) state.weather = weatherType;

    // 载荷里没有 sky 字段（旧广播/前端本地切天气）→ 保持当前天空，只更新天气调参
    if (sky === undefined) { applyTuning(); return; }

    const nextId = sky && sky.id ? sky.id : 'default';
    const curId = state.sky && state.sky.id ? state.sky.id : 'default';
    if (nextId === curId && state.sky) { applyTuning(); return; }

    if (!sky || sky.kind === 'default' || !sky.url) {
      resetToDefault();
      applyTuning();
      return;
    }

    const token = ++state.loadToken;
    state.loading = true;
    loadTexture(sky)
      .then((tex) => {
        if (token !== state.loadToken) return; // 已被更新的选择取代
        state.sky = sky;
        state.texture = tex;
        state.loading = false;
        paint();
        console.log(`🌌 已应用天空：${sky.name || sky.url}（${sky.kind === 'hdr' ? 'HDR' : '全景图'}）`);
      })
      .catch((e) => {
        if (token !== state.loadToken) return;
        state.loading = false;
        warn(`天空加载失败（${sky.url}），已回退默认天空`, e);
        resetToDefault();
      });
  }

  /**
   * world.js 用：取当前背景
   * @param {number} fallbackColorHex  默认天空的纯色（随天气变化）
   * @returns {THREE.Texture|THREE.Color}
   */
  function getBackground(fallbackColorHex) {
    if (state.texture) return state.texture;
    return new THREE.Color(fallbackColorHex === undefined ? 0x87ceeb : fallbackColorHex);
  }

  /** WS 迟迟不下发天气时的兜底：主动拉一次天气配置 */
  function fetchFallback() {
    setTimeout(() => {
      if (!state.attached || state.sky) return;
      fetch('/api/config/weather')
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg) => {
          if (cfg && cfg.sky !== undefined) applyConfig(cfg.sky, cfg.type);
        })
        .catch(() => {});
    }, 3000);
  }

  const SkyManager = {
    attach,
    applyConfig,
    getBackground,
    fetchFallback,
    setWeather: function (type) { state.weather = type; applyTuning(); },
    WEATHER_TUNE,
    _diag: function () {
      return {
        attached: state.attached,
        sky: state.sky ? { id: state.sky.id, name: state.sky.name, kind: state.sky.kind, use_env: state.sky.use_env } : null,
        hasTexture: !!state.texture,
        backgroundIsTexture: !!(state.scene && state.scene.background && state.scene.background.isTexture),
        intensity: state.scene ? state.scene.backgroundIntensity : null,
        blurriness: state.scene ? state.scene.backgroundBlurriness : null,
        hasEnvironment: !!(state.scene && state.scene.environment),
        loading: state.loading,
        weather: state.weather
      };
    }
  };

  global.SkyManager = SkyManager;
  if (typeof module !== 'undefined' && module.exports) module.exports = SkyManager;
})(typeof window !== 'undefined' ? window : this);
