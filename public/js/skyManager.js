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
    attached: false,
    // 【首屏丝滑化 Step2】天空让路：环境未就绪时重资产天空（HDR）先用程序化渐变占位
    deferred: false,          // 是否处于"占位等待就绪"状态
    deferredSky: null,        // 被让路的真实天空配置
    deferredSince: 0,         // performance.now() 起点占位开始
    placeholderKind: 'none',  // 'gradient' | 'none'
    _placeholderTex: null,    // 占位纹理（替换/重置时 dispose，不进 cache）
    envToken: 0,              // 【二期A】空闲期 PMREM 任务令牌（防旧任务覆盖）
    envPrewarmed: false       // 【二期A】PMREM 着色器是否已预热
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

  /** 生成/清理环境光照（PBR 反射）。
   * 【二期A】PMREM 源降采样：4K EXR → ≤1024 宽的 DataTexture 再生成环境贴图。
   * PMREM 成本 ∝ 分辨率（16×像素差），而环境反射本身被 PMREM 卷积模糊，
   * 1K 源在视觉上无感——实测把"替换天空"瞬间的长任务从 ~2.7s 砍掉大半。 */
  function makeEnvSource(tex) {
    try {
      const img = tex && tex.image;
      if (!img || !img.data || !(img.width > 0) || !(img.height > 0)) return tex; // 非浮点数据（JPG 全景）直接用
      const w = img.width, h = img.height;
      const MAXW = 1024;
      if (w <= MAXW) return tex;
      const ch = Math.floor(img.data.length / (w * h));
      if (ch !== 3 && ch !== 4) return tex;
      const factor = Math.max(2, Math.ceil(w / MAXW));
      const nw = Math.max(1, Math.floor(w / factor)), nh = Math.max(1, Math.floor(h / factor));
      const out = new img.data.constructor(nw * nh * ch);
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          for (let c = 0; c < ch; c++) {
            let sum = 0, n = 0;
            const yEnd = Math.min((y + 1) * factor, h), xEnd = Math.min((x + 1) * factor, w);
            for (let sy = y * factor; sy < yEnd; sy++) {
              for (let sx = x * factor; sx < xEnd; sx++) {
                sum += img.data[(sy * w + sx) * ch + c]; n++;
              }
            }
            out[(y * nw + x) * ch + c] = sum / Math.max(1, n);
          }
        }
      }
      const dt = new THREE.DataTexture(out, nw, nh, ch === 4 ? THREE.RGBAFormat : THREE.RGBFormat, tex.type);
      dt.mapping = THREE.EquirectangularReflectionMapping;
      dt.colorSpace = tex.colorSpace;
      dt.magFilter = THREE.LinearFilter;
      dt.minFilter = THREE.LinearFilter;
      dt.generateMipmaps = false;
      dt.needsUpdate = true;
      return dt;
    } catch (e) {
      return tex; // 降采样失败退回原始纹理
    }
  }

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
      const t0 = performance.now();
      const src = makeEnvSource(state.texture);
      const t1 = performance.now();
      const rt = pmrem.fromEquirectangular(src);
      const t2 = performance.now();
      if (src !== state.texture) src.dispose(); // 降采样副本用完即弃（背景仍用原 4K）
      pmrem.dispose();
      if (state.envRT) state.envRT.dispose();
      state.envRT = rt;
      rt.texture.__skyEnv = true;
      state.scene.environment = rt.texture;
      console.log('[SkyManager] ✨ 环境光照已生成（空闲期，降采样 ' + Math.round(t1 - t0) + 'ms / PMREM ' + Math.round(t2 - t1) + 'ms）');
    } catch (e) {
      warn('生成环境光照失败，已仅保留背景', e);
    }
  }

  /** 【二期A】PMREM 延后空闲期执行：背景同步上屏（纯赋值零成本），
   * 环境光（主线程 GPU 大开销）错峰到 requestIdleCallback，且用 envToken 防旧任务覆盖 */
  function scheduleEnvironment() {
    const token = ++state.envToken;
    const run = () => {
      if (token !== state.envToken) return; // 已被更新的天空/重置取代
      applyEnvironment();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 400);
    }
  }

  /** 【二期A】占位环境光 + PMREM 着色器预热（加载屏内一次性付清两笔成本）：
   *  1. PMREMGenerator 首跑要编译整套卷积着色器（Windows ANGLE 每程序反射
   *     ~160ms，不预热则正式生成时 ~800ms+）；
   *  2. scene.environment 从无到有会让【全体 PBR 材质】带 envmap 重编译
   *     （实测 ~3s 长任务，基线里混在"替换天空"帧间隙中）。加载屏内就挂上
   *     占位 env → 所有材质从首次编译起就带 envmap（只编一次，且处于加载屏
   *     的编译预算摊薄期内）；正式天空到达后仅换纹理引用——envmap 存在性
   *     不变 → 程序缓存键不变 → 零重编译。 */
  function prewarmPmremShaders() {
    if (state.envPrewarmed || !state.renderer || !state.texture || !THREE.PMREMGenerator) return;
    if (!state.sky || !state.sky.use_env) return; // 该天空不产环境光时不预热
    if (!state.scene) return;
    state.envPrewarmed = true;
    try {
      const pmrem = new THREE.PMREMGenerator(state.renderer);
      const rt = pmrem.fromEquirectangular(state.texture);
      pmrem.dispose();
      if (state.envRT) state.envRT.dispose();
      state.envRT = rt;
      rt.texture.__skyEnv = true;
      state.scene.environment = rt.texture;
      console.log('[SkyManager] 🔥 占位环境光已上屏（加载屏内预热 PMREM；正式天空到达后换纹理零重编译）');
    } catch (e) {
      warn('PMREM 预热失败（不影响后续正式生成）', e);
    }
  }

  /** 只装背景（占位阶段用：不生成环境光） */
  function paintBackground() {
    if (!state.scene) return;
    if (state.texture) {
      state.scene.background = state.texture;
    }
    applyTuning();
  }

  /** 把已加载好的纹理装到场景背景上（背景同步；PMREM 延后空闲期） */
  function paint() {
    paintBackground();
    scheduleEnvironment();
  }

  /** 【Step2】程序化渐变占位天空（CanvasTexture，零网络、<5ms） */
  function makeGradientPlaceholder() {
    const w = 512, h = 256;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, '#3d76c9');   // 天顶蓝
    g.addColorStop(0.55, '#9db8d9');   // 中层渐亮
    g.addColorStop(0.62, '#e8e0d0');   // 地平线暖色
    g.addColorStop(1.00, '#8a7f6e');   // 地面暗色
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function disposePlaceholder() {
    if (state._placeholderTex) {
      try { state._placeholderTex.dispose(); } catch (e) { /* 忽略清理异常 */ }
      state._placeholderTex = null;
    }
    if (state.placeholderKind !== 'none') state.placeholderKind = 'none';
  }

  /** 【Step2】就绪后加载被让路的真实天空（复用 loadToken 防旧选择覆盖） */
  function loadDeferredSky(sky) {
    const token = ++state.loadToken;
    state.loading = true;
    loadTexture(sky)
      .then((tex) => {
        if (token !== state.loadToken) return; // 已被更新的选择取代
        const oldPlaceholder = state._placeholderTex;
        state.texture = tex;
        state.deferred = false;
        state.deferredSky = null;
        state.loading = false;
        disposePlaceholder();
        if (oldPlaceholder && state.scene && state.scene.background === oldPlaceholder) {
          state.scene.background = null; // 立即解除占位引用，paint 会装上真纹理
        }
        paint();
        console.log(`🌌 已应用天空：${sky.name || sky.url}（HDR，就绪后替换占位）`);
      })
      .catch((e) => {
        if (token !== state.loadToken) return;
        state.loading = false;
        state.deferred = false;
        state.deferredSky = null;
        disposePlaceholder();
        warn(`天空加载失败（${sky.url}），已回退默认天空`, e);
        resetToDefault();
      });
  }

  /** 【Step2】重资产天空让路：渐变占位立即上屏，注册就绪回调替换 */
  function deferSky(sky) {
    state.sky = sky;              // 防重复触发（applyConfig 的 nextId===curId 早退）
    state.deferred = true;
    state.deferredSky = sky;
    state.deferredSince = performance.now();
    state.loading = false;
    disposePlaceholder();          // 先清旧占位（会把 placeholderKind 复位为 none）
    state.placeholderKind = 'gradient';
    state._placeholderTex = makeGradientPlaceholder();
    state.texture = state._placeholderTex;
    paintBackground(); // 占位阶段只装背景，不生成环境光（PMREM 与高清一起推迟）
    prewarmPmremShaders(); // 【二期A】趁加载屏还在，把 PMREM 着色器编译成本付掉
    console.log('[SkyManager] 🌒 环境未就绪，天空先用程序化渐变占位，就绪后再拉高清 HDR');

    const consume = () => {
      if (!state.deferred || state.deferredSky !== sky) return; // 已被新选择取代
      loadDeferredSky(sky);
    };
    if (window.WorldReadyGate && typeof window.WorldReadyGate.onReady === 'function') {
      window.WorldReadyGate.onReady(consume); // 闸门自带 12s 兜底
    }
    setTimeout(consume, 20000); // 双保险：闸门缺失/异常时 20s 兜底
  }

  /** 回到默认天空（纯色），由 world.js 提供颜色 */
  function resetToDefault() {
    state.sky = null;
    state.texture = null;
    state.deferred = false;
    state.deferredSky = null;
    state.envToken++;      // 【二期A】作废排队中的空闲期 PMREM 任务
    disposePlaceholder();
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

    // 【首屏丝滑化 Step2】重资产天空（HDR EXR 11.75MB 级）在环境就绪前让路：
    // 先程序化渐变占位（零网络），就绪后再拉高清替换，PMREM 一并推迟。
    if (sky.kind === 'hdr' && window.WorldReadyGate && !window.WorldReadyGate.isReady()) {
      deferSky(sky);
      return;
    }

    // 走真实加载：清掉可能残留的延迟占位态（例如占位期间换成了非 HDR 天空）
    if (state.deferred) {
      state.deferred = false;
      state.deferredSky = null;
      state.loading = false;
    }

    const token = ++state.loadToken;
    state.loading = true;
    loadTexture(sky)
      .then((tex) => {
        if (token !== state.loadToken) return; // 已被更新的选择取代
        const hadPlaceholder = !!state._placeholderTex;
        disposePlaceholder();
        state.sky = sky;
        state.texture = tex;
        state.loading = false;
        if (hadPlaceholder && state.scene && state.scene.background && state.scene.background !== tex) {
          state.scene.background = null;
        }
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
        weather: state.weather,
        deferred: state.deferred,
        deferredSince: state.deferred ? Math.round(performance.now() - state.deferredSince) : null,
        placeholderKind: state.placeholderKind
      };
    }
  };

  global.SkyManager = SkyManager;
  if (typeof module !== 'undefined' && module.exports) module.exports = SkyManager;
})(typeof window !== 'undefined' ? window : this);
