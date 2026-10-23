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
 *
 * ── 2026-10-22「天空加载卡顿」治理（v6）──────────────────────────────
 * 实测根因（真机 GTX960 + 世界静止后测量）：
 *   ① three 的 program 缓存键包含 envMapCubeUVHeight（WebGLPrograms.js:64/443），
 *      而 PMREM 输出高度 = 4 × 2^floor(log2(源宽/4))。改前 EXR 走降采样（源 1024
 *      → env 高 1024），PNG/JPG 却被直接跳过（源 4096 → env 高 4096）—— 两种天空
 *      混用会让【全体 PBR 材质】重编译一次：实测 +29 个程序 / 最长帧 1060ms。
 *   ② scene.environment 从 null → 非 null 同样触发全体重组（回默认天空时反向再来一遍）。
 * 治理两件套（都刻意做成"只在确实用到环境光时才生效"，保证默认路径零影响）：
 *   A. 所有天空（EXR/PNG/JPG）的 PMREM 源统一到 1024×512 → env 高度恒为 1024，
 *      换天空只换纹理引用/重建同尺寸 env → 零重编译（实测最长帧 1060ms → 81~102ms）。
 *   B. 一旦建立过环境光就不再置 null：需要"关掉环境光"时改
 *      scene.environmentIntensity = 0（该值不进程序缓存键），避免反向再重编译一次。
 *   ⚠ 故意不提前挂"常驻占位环境光"：实测会让首屏所有 PBR 材质多编译一轮、把场景收尾
 *     从 ~14s 拖到 ~21s（超过天空 15s 兜底，回归项 S3a）。默认天空 / use_env=false 的
 *     世界全程不碰 scene.environment，与改前 100% 一致。
 * 剩余成本（与光照无关）：EXR 解码约 1.1s（首次加载某张 EXR 时一次性）。
 */
(function (global) {
  'use strict';

  const THREE = global.THREE;

  /* 【免遮档直通（2026-10-22）A 方案】天空**不和小模型抢带宽**：
     高清 HDR（本世界 EXR 约 11.75MB）比周围几百个小模型的总和还大，进来就拉会把
     "先几何/地块 → 再小模型" 的顺序顶掉。所以免遮档下改为「第一代场景加载收尾后再拉」，
     用户先看到世界，天空随后安静地换。
     仍保留"先占位 env 再换真"的顺序 —— 这条能省掉 scene.environment 从无到有导致
     全体 PBR 材质换程序重编译的 ~3s。 */
  const SCENE_SETTLE_POLL_MS = 500;   // 场景收尾轮询节拍
  const FAST_HDR_MAX_WAIT_MS = 15000; // 兜底：最多等这么久，之后无条件拉（别让灰天拖太久）

  function isFastEntry() {
    try {
      return !!(global.LoadingMask && typeof global.LoadingMask.isFastEntry === 'function' &&
        global.LoadingMask.isFastEntry());
    } catch (e) { return false; }
  }

  /** 场景"第一代加载"是否已收尾：进度条到 100% / 完成过一代 / 就绪闸门就绪 */
  function sceneSettled() {
    try {
      const lp = global.LoadingProgress;
      if (lp && typeof lp._diag === 'function') {
        const d = lp._diag();
        if (d && ((d.completedGens || 0) >= 1)) return true;
        if (d && typeof d.displayPct === 'number' && d.displayPct >= 100) return true;
      }
    } catch (e) { /* ignore */ }
    try {
      if (global.WorldReadyGate && global.WorldReadyGate.isReady()) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /* 【2026-10-22】环境光照源统一尺寸：
     env 高度是 three 程序缓存键的一部分，源尺寸不一致 = 换天空时全体 PBR 材质重编译。
     统一到 1024×512（equirect 2:1）后，env 高度恒为 1024（cubeSize=1024/4=256，高度=4×256）。
     注意：不要随意调小（512 会改变 env 高度 → 反而触发一次全量重编译；已实测无收益）。 */
  const ENV_SRC_W = 1024;
  const ENV_SRC_H = 512;

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
    // 【v6 决策】这里刻意 **不** 提前挂"常驻占位环境光"：
    // 实测它会让场景全部 PBR 材质多编译一轮带 envmap 的程序，首屏从 ~14s 拖到 ~21s，
    // 进而让天空的 15s 兜底先于场景收尾触发（回归项 S3a）。默认天空（use_env=false）
    // 的世界根本不需要环境光，故保持 scene.environment = null，行为与改前完全一致。
    // 真正解决卡顿的是：① env 源尺寸统一（换天空零重编译）② 用过环境光后不再置 null。
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

  /** 生成 PMREM 源纹理：把任意天空纹理统一成 ENV_SRC_W × ENV_SRC_H。
   * 【v6 关键修复】改前只有 DataTexture（EXR）走降采样，PNG/JPG 被 `!img.data` 直接
   * 放过 → 4K 源让 PMREM 输出高度变成 4096，与 EXR 的 1024 混用即触发全体材质重编译。
   * 现在两条分支都收敛到同一尺寸，env 高度恒为 1024。
   * EXR 分支的输出尺寸与改前完全一致（4096 → 1024），视觉零变化。 */
  function makeEnvSource(tex) {
    try {
      const img = tex && tex.image;
      if (!img || !(img.width > 0) || !(img.height > 0)) return tex;
      const w = img.width, h = img.height;

      // ① DataTexture（EXR / HDR）：盒式降采样到目标尺寸（已是目标尺寸则原样使用）
      if (img.data) {
        if (w === ENV_SRC_W && h === ENV_SRC_H) return tex;
        const ch = Math.floor(img.data.length / (w * h));
        if (ch !== 3 && ch !== 4) return tex;
        const fw = Math.max(1, Math.floor(w / ENV_SRC_W));
        const fh = Math.max(1, Math.floor(h / ENV_SRC_H));
        const nw = Math.max(1, Math.min(ENV_SRC_W, Math.ceil(w / fw)));
        const nh = Math.max(1, Math.min(ENV_SRC_H, Math.ceil(h / fh)));
        const out = new img.data.constructor(nw * nh * ch);
        for (let y = 0; y < nh; y++) {
          for (let x = 0; x < nw; x++) {
            for (let c = 0; c < ch; c++) {
              let sum = 0, n = 0;
              const yEnd = Math.min((y + 1) * fh, h), xEnd = Math.min((x + 1) * fw, w);
              for (let sy = y * fh; sy < yEnd; sy++) {
                for (let sx = x * fw; sx < xEnd; sx++) {
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
      }

      // ② 普通纹理（PNG / JPG 全景）：canvas 缩到目标尺寸
      if (w === ENV_SRC_W && h === ENV_SRC_H) return tex;
      if (typeof document === 'undefined') return tex; // 无 DOM 环境（理论不可达）保底
      const cv = document.createElement('canvas');
      cv.width = ENV_SRC_W;
      cv.height = ENV_SRC_H;
      const ctx = cv.getContext('2d');
      if (!ctx) return tex;
      ctx.drawImage(img, 0, 0, ENV_SRC_W, ENV_SRC_H);
      const ct = new THREE.CanvasTexture(cv);
      ct.mapping = THREE.EquirectangularReflectionMapping;
      ct.colorSpace = tex.colorSpace;
      ct.magFilter = THREE.LinearFilter;
      ct.minFilter = THREE.LinearFilter;
      ct.generateMipmaps = false;
      ct.needsUpdate = true;
      return ct;
    } catch (e) {
      return tex; // 降采样失败退回原始纹理（不阻断天空）
    }
  }

  function applyEnvironment() {
    if (!state.scene) return;
    const need = !!(state.sky && state.sky.use_env && state.texture && state.renderer && THREE.PMREMGenerator);
    if (!need) {
      // 【v6】改前这里会把 environment 置 null 并释放 envRT，导致【全体 PBR 材质】
      // 反向重编译一次（实测 ~1s）。现在改为：**保留已有环境贴图，只把强度关到 0**
      // （environmentIntensity 不进 three 的程序缓存键，改它不触发重编译）——
      // 观感等价、程序缓存键不变。资源不释放，下次切回带环境光的天空可原地复用。
      // 注意：从未有过 env 的世界（如默认天空 / use_env=false）scene.environment
      // 本来就是 null，这里什么都不会发生，行为与改前 100% 一致。
      if (state.scene.environment && state.scene.environment.__skyEnv) setEnvIntensity(0);
      return;
    }
    try {
      const pmrem = new THREE.PMREMGenerator(state.renderer);
      const t0 = performance.now();
      const src = makeEnvSource(state.texture);
      const t1 = performance.now();
      const rt = withFrameGuard(function () { return pmrem.fromEquirectangular(src); });
      const t2 = performance.now();
      if (src !== state.texture) src.dispose(); // 降采样副本用完即弃（背景仍用原 4K）
      pmrem.dispose();
      const oldRT = state.envRT;
      state.envRT = rt;
      rt.texture.__skyEnv = true;
      state.scene.environment = rt.texture;
      setEnvIntensity(1);
      if (oldRT) oldRT.dispose(); // 新 env 上屏后再释放旧的
      console.log('[SkyManager] ✨ 环境光照已生成（空闲期，降采样 ' + Math.round(t1 - t0) +
        'ms / PMREM ' + Math.round(t2 - t1) + 'ms / env 高 ' +
        (rt.texture.image ? rt.texture.image.height : '?') + 'px）');
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

  /** 【v6】设置环境光强度（该值不进 three 的程序缓存键，改它不会触发重编译）。
   *  旧内核没有 environmentIntensity 字段时静默跳过，退回"不设"行为。 */
  function setEnvIntensity(v) {
    if (!state.scene) return;
    try {
      const cur = Number(state.scene.environmentIntensity);
      if (!isFinite(cur) || Math.abs(cur - v) > 1e-6) state.scene.environmentIntensity = v;
    } catch (e) { /* 忽略 */ }
  }

  /** 【v6】PMREM 执行期间保护 renderer.info.render.frame。
   *  PMREMGenerator 内部会连续 render 多次（6 面 + 多级模糊），frame 会凭空 +N；
   *  而 loadingMask 用"frame 是否推进 + frame≥3"判断画布是否已出画 —— 不保护会让
   *  遮罩在真正出画前提前撤下（2026-10-08 修过的"撤罩后黑屏"会回归）。 */
  function withFrameGuard(fn) {
    const info = state.renderer && state.renderer.info;
    const saved = (info && info.render) ? info.render.frame : null;
    try {
      return fn();
    } finally {
      if (saved !== null && info && info.render) info.render.frame = saved;
    }
  }

  /** 【二期A / v6】占位环境光 + PMREM 着色器预热（加载屏内一次性付清两笔成本）：
   *  1. PMREMGenerator 首跑要编译整套卷积着色器（Windows ANGLE 每程序反射
   *     ~160ms，不预热则正式生成时 ~800ms+）；
   *  2. scene.environment 从无到有会让【全体 PBR 材质】带 envmap 重编译。
   *     加载屏内就挂上占位 env → 所有材质从首次编译起就带 envmap（只编一次）；
   *     正式天空到达后仅换纹理引用 —— envmap 存在性不变 → 程序缓存键不变 → 零重编译。
   *
   *  【v6】关键约束：
   *   · 只为 use_env=true 的天空预热（use_env=false 的世界全程不碰 scene.environment，
   *     首屏行为与改前 100% 一致 —— 提前挂常驻 env 会让首屏多编译一轮、把场景收尾
   *     拖过天空的 15s 兜底，实测回归项 S3a）。
   *   · 占位源必须走 makeEnvSource 归一尺寸，与正式 env 一样是 1024 → env 高恒 1024，
   *     否则"占位→正式"还会重编译一次。 */
  function prewarmPmremShaders() {
    if (state.envPrewarmed || !state.renderer || !state.texture || !THREE.PMREMGenerator) return;
    if (!state.sky || !state.sky.use_env) return; // 该天空不产环境光时不预热
    if (!state.scene) return;
    state.envPrewarmed = true;
    try {
      const pmrem = new THREE.PMREMGenerator(state.renderer);
      const src = makeEnvSource(state.texture); // 归一 1024×512，与正式 env 同尺寸
      const rt = withFrameGuard(function () { return pmrem.fromEquirectangular(src); });
      pmrem.dispose();
      if (src !== state.texture) src.dispose();
      if (state.envRT) state.envRT.dispose();
      state.envRT = rt;
      rt.texture.__skyEnv = true;
      state.scene.environment = rt.texture;
      setEnvIntensity(1);
      console.log('[SkyManager] 🔥 占位环境光已上屏（加载屏内预热 PMREM；正式天空到达后换纹理零重编译，env 高 ' +
        (rt.texture.image ? rt.texture.image.height : '?') + 'px）');
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
    if (isFastEntry()) {
      // 【免遮档直通 · A 方案】天空让路给小模型：等第一代场景加载收尾后再拉高清
      const waitStart = Date.now();
      const poll = function () {
        if (!state.deferred || state.deferredSky !== sky) return; // 已被新选择取代
        if (sceneSettled()) { consume(); return; }
        if (Date.now() - waitStart >= FAST_HDR_MAX_WAIT_MS) {
          console.log('[SkyManager] ⏱ 免遮档直通：等场景收尾超过 ' +
            (FAST_HDR_MAX_WAIT_MS / 1000) + 's，直接拉高清 HDR');
          consume();
          return;
        }
        setTimeout(poll, SCENE_SETTLE_POLL_MS);
      };
      console.log('[SkyManager] ⚡ 免遮档直通：天空让路给小模型，场景加载收尾后再拉高清 HDR');
      setTimeout(poll, SCENE_SETTLE_POLL_MS);
    } else if (window.WorldReadyGate && typeof window.WorldReadyGate.onReady === 'function') {
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
        // 【v6】环境光照诊断：envHeight 是 three 程序缓存键的一部分，一旦有 env 就应恒为 1024
        envHeight: (state.scene && state.scene.environment && state.scene.environment.image)
          ? state.scene.environment.image.height : 0,
        envIntensity: state.scene ? state.scene.environmentIntensity : null,
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
