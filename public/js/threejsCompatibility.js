/**
 * 济宁米多信息科技有限公司 版权所有
 * Three.js 代码运行器 - 兼容性层
 *
 * 目标：让用户粘贴的"五花八门"的 Three.js 示例代码（来自网络、教程、demo）
 * 在 world/preview 两种模式下都能尽量不出错地跑起来。
 *
 * 提供：
 *  1. DOM / window 桩增强（querySelector 返回容器、尺寸适配容器等）
 *  2. 外部依赖桩（postprocessing、tweakpane、lil-gui、dat.gui、gsap、@tweenjs/tween.js、stats.js）
 *  3. Three.js 版本差异桥接（outputEncoding/outputColorSpace、THREE.Math→MathUtils 等）
 *  4. world 模式下高阶特性的降级（WebGLRenderTarget、EffectComposer、反射材质等）
 */
(function (global) {
  'use strict';

  function createDummyElement(baseSize) {
    return {
      clientWidth: baseSize.width,
      clientHeight: baseSize.height,
      style: {},
      children: [],
      textContent: '',
      innerHTML: '',
      innerText: '',
      value: '',
      href: '',
      src: '',
      id: '',
      className: '',
      hidden: false,
      appendChild(c) { if (c) this.children.push(c); return c; },
      removeChild(c) {
        const idx = this.children.indexOf(c);
        if (idx >= 0) this.children.splice(idx, 1);
        return c;
      },
      addEventListener() {},
      removeEventListener() {},
      click() {},
      focus() {},
      blur() {},
      getContext() { return null; },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: baseSize.width, height: baseSize.height };
      }
    };
  }

  /**
   * 创建增强版 document 桩
   * @param {HTMLElement|Object} containerEl 真实容器或 dummy 元素
   */
  function createDocStub(containerEl) {
    const dummy = createDummyElement({ width: 800, height: 600 });
    const root = containerEl || dummy;

    // 已知容器类 ID/选择器——返回真实容器（让代码能 appendChild canvas 到预览区）
    var CONTAINER_IDS = ['box', 'canvas', 'canvas-container', 'container', 'app', 'scene', 'webgl', 'renderer'];
    var CONTAINER_SELECTORS = ['#box', '.box', 'canvas', '#canvas', '#canvas-container', '#container', '#app', '#scene', 'body'];

    function isContainerId(id) {
      if (!id) return false;
      return CONTAINER_IDS.indexOf(String(id).toLowerCase()) >= 0;
    }
    function isContainerSelector(sel) {
      if (!sel) return false;
      return CONTAINER_SELECTORS.indexOf(String(sel).toLowerCase()) >= 0;
    }

    return {
      readyState: 'complete',
      getElementById(id) {
        if (isContainerId(id)) return root;
        // 非容器 ID（如 particleCount、toggleClouds）返回无害 dummy
        return dummy;
      },
      querySelector(sel) {
        if (isContainerSelector(sel)) return root;
        // 非容器选择器（如 .loading、.header）返回无害 dummy
        return dummy;
      },
      querySelectorAll(sel) {
        if (isContainerSelector(sel)) return [root];
        return [];
      },
      createElement(tag) {
        if (global.document && typeof global.document.createElement === 'function') {
          try { return global.document.createElement(tag); } catch (e) {}
        }
        return createDummyElement({ width: root.clientWidth || 800, height: root.clientHeight || 600 });
      },
      createElementNS(ns, tag) {
        if (global.document && typeof global.document.createElementNS === 'function') {
          try { return global.document.createElementNS(ns, tag); } catch (e) {}
        }
        const el = createDummyElement({ width: root.clientWidth || 800, height: root.clientHeight || 600 });
        el.tagName = tag;
        el.src = '';
        el.width = 0;
        el.height = 0;
        return el;
      },
      body: root,
      documentElement: root,
      addEventListener(type, listener) {
        if (typeof listener !== 'function') return;
        // DOMContentLoaded / load 事件在预览环境里"已经触发过"，立即执行回调
        // 这解决了 document.addEventListener('DOMContentLoaded', () => { init(); animate(); }) 模式
        if (type === 'DOMContentLoaded' || type === 'load' || type === 'ready') {
          try { listener({ type: type, target: root }); }
          catch (e) { console.warn('[ThreeJSCompat] ' + type + ' 回调执行失败:', e.message || e); }
        }
        // 其他事件（click/resize/keydown 等）静默忽略——预览环境不需要
      },
      removeEventListener() {}
    };
  }

  /**
   * 创建 window 桩
   * @param {Object} size {width,height}
   * @param {Function} rafStub requestAnimationFrame 替代
   * @param {Function} cafStub cancelAnimationFrame 替代
   */
  function createWindowStub(size, rafStub, cafStub) {
    const width = (size && size.width) || 800;
    const height = (size && size.height) || 600;
    return {
      innerWidth: width,
      innerHeight: height,
      devicePixelRatio: 1,
      addEventListener(type, listener) {
        if (typeof listener !== 'function') return;
        // window.onload / window.addEventListener('load', ...) 在预览环境已触发，立即执行
        if (type === 'load' || type === 'DOMContentLoaded') {
          try { listener({ type: type }); }
          catch (e) { console.warn('[ThreeJSCompat] window ' + type + ' 回调执行失败:', e.message || e); }
        }
      },
      removeEventListener() {},
      requestAnimationFrame: typeof rafStub === 'function' ? rafStub : (function (cb) { return 0; }),
      cancelAnimationFrame: typeof cafStub === 'function' ? cafStub : (function () {}),
      location: { href: '' },
      onload: null,
      get THREE() { return global.THREE; }
    };
  }

  // ---- 外部依赖桩 ----

  function makeStatsStub() {
    function Stats() {}
    Stats.prototype.dom = (function () {
      const el = { style: {} };
      if (global.document && global.document.createElement) {
        try { return global.document.createElement('div'); } catch (e) {}
      }
      return el;
    })();
    Stats.prototype.begin = function () {};
    Stats.prototype.end = function () {};
    Stats.prototype.update = function () {};
    Stats.prototype.showPanel = function () {};
    Stats.prototype.setMode = function () {};
    return Stats;
  }

  function makePostprocessingStub() {
    function KawaseBlurPass() {
      this.enabled = true;
    }
    KawaseBlurPass.prototype.setSize = function () {};
    KawaseBlurPass.prototype.render = function () {};
    KawaseBlurPass.prototype.dispose = function () {};

    function EffectComposer() { this.passes = []; }
    EffectComposer.prototype.addPass = function (p) { this.passes.push(p); };
    EffectComposer.prototype.insertPass = function (p, i) { this.passes.splice(i, 0, p); };
    EffectComposer.prototype.removePass = function () {};
    EffectComposer.prototype.setSize = function () {};
    EffectComposer.prototype.setPixelRatio = function () {};
    EffectComposer.prototype.render = function () {};
    EffectComposer.prototype.dispose = function () {};
    EffectComposer.prototype.reset = function () {};

    function RenderPass() { this.enabled = true; }
    RenderPass.prototype.dispose = function () {};

    function OutputPass() { this.enabled = true; }
    OutputPass.prototype.dispose = function () {};

    function UnrealBloomPass() { this.enabled = true; }
    UnrealBloomPass.prototype.dispose = function () {};

    function SMAAPass() { this.enabled = true; }
    SMAAPass.prototype.dispose = function () {};

    return {
      KawaseBlurPass: KawaseBlurPass,
      EffectComposer: EffectComposer,
      RenderPass: RenderPass,
      OutputPass: OutputPass,
      UnrealBloomPass: UnrealBloomPass,
      SMAAPass: SMAAPass
    };
  }

  function makeTweakpaneStub() {
    function Pane() {}
    Pane.prototype.addBinding = function () { return this; };
    Pane.prototype.addButton = function () { return { on: function () { return this; } }; };
    Pane.prototype.addFolder = function () { return new Pane(); };
    Pane.prototype.addTab = function () { return { pages: [] }; };
    Pane.prototype.addInput = function () { return this; };
    Pane.prototype.addMonitor = function () { return this; };
    Pane.prototype.addSeparator = function () { return this; };
    Pane.prototype.addBlade = function () { return this; };
    Pane.prototype.dispose = function () {};
    Pane.prototype.importPreset = function () {};
    Pane.prototype.exportPreset = function () { return {}; };
    Pane.prototype.refresh = function () {};
    return Pane;
  }

  function makeGUIStub() {
    function GUI(opts) {}
    GUI.prototype.add = function () { return this; };
    GUI.prototype.addColor = function () { return this; };
    GUI.prototype.addFolder = function () { return new GUI(); };
    GUI.prototype.addButton = function () { return { onChange: function () { return this; } }; };
    GUI.prototype.open = function () { return this; };
    GUI.prototype.close = function () { return this; };
    GUI.prototype.name = function () { return this; };
    GUI.prototype.title = function () { return this; };
    GUI.prototype.onChange = function () { return this; };
    GUI.prototype.listen = function () { return this; };
    GUI.prototype.destroy = function () {};
    GUI.prototype.dispose = function () {};
    GUI.prototype.remember = function () {};
    return GUI;
  }

  function makeDatGUIStub() {
    function datGUI() {}
    datGUI.prototype.add = function () { return this; };
    datGUI.prototype.addColor = function () { return this; };
    datGUI.prototype.addFolder = function () { return new datGUI(); };
    datGUI.prototype.open = function () {};
    datGUI.prototype.close = function () {};
    datGUI.prototype.destroy = function () {};
    return datGUI;
  }

  function makeGsapStub() {
    const stubTween = {
      to: function () { return this; },
      from: function () { return this; },
      fromTo: function () { return this; },
      set: function () { return this; },
      kill: function () {},
      pause: function () { return this; },
      play: function () { return this; },
      restart: function () { return this; },
      reverse: function () { return this; },
      onComplete: function (cb) { if (typeof cb === 'function') setTimeout(cb, 0); return this; },
      onUpdate: function () { return this; }
    };
    return {
      to: function () { return stubTween; },
      from: function () { return stubTween; },
      fromTo: function () { return stubTween; },
      set: function () { return stubTween; },
      timeline: function () { return stubTween; },
      registerPlugin: function () {},
      Tween: stubTween
    };
  }

  function makeTweenStub() {
    const TWEEN = {
      Tween: function () {},
      Easing: {
        Linear: { None: function () {} },
        Quadratic: { In: function () {}, Out: function () {}, InOut: function () {} },
        Cubic: { In: function () {}, Out: function () {}, InOut: function () {} }
      },
      update: function () {}
    };
    TWEEN.Tween.prototype.to = function () { return this; };
    TWEEN.Tween.prototype.from = function () { return this; };
    TWEEN.Tween.prototype.start = function () { return this; };
    TWEEN.Tween.prototype.stop = function () { return this; };
    TWEEN.Tween.prototype.easing = function () { return this; };
    TWEEN.Tween.prototype.onUpdate = function () { return this; };
    TWEEN.Tween.prototype.onComplete = function (cb) { if (typeof cb === 'function') setTimeout(cb, 0); return this; };
    TWEEN.Tween.prototype.delay = function () { return this; };
    TWEEN.Tween.prototype.yoyo = function () { return this; };
    TWEEN.Tween.prototype.repeat = function () { return this; };
    return TWEEN;
  }

  // ---- Three.js 版本桥接 ----

  /**
   * 在 THREE 原型的基础上补齐一些常见缺失，同时 world 模式下桩化高阶对象
   */
  function patchTHREE(THREE, mode) {
    if (!THREE) return THREE;
    const patched = Object.create(THREE);

    // 兼容旧代码中的 THREE.Math（r148 后已移除，统一指向 MathUtils）
    if (!patched.Math && patched.MathUtils) {
      patched.Math = patched.MathUtils;
    }

    if (mode === 'world') {
      // WebGLRenderTarget 在 world 模式下没有真实渲染意义，返回一个持有 texture 的占位对象
      if (!patched.WebGLRenderTarget || typeof patched.WebGLRenderTarget !== 'function') {
        patched.WebGLRenderTarget = makeWebGLRenderTargetStub(THREE);
      }
      // DepthTexture 占位
      if (!patched.DepthTexture || typeof patched.DepthTexture !== 'function') {
        patched.DepthTexture = function (w, h) {
          this.width = w || 256;
          this.height = h || 256;
          this.image = { width: this.width, height: this.height };
          this.format = THREE.DepthFormat || 1026;
          this.type = THREE.UnsignedShortType || 1018;
        };
      }
    }

    // r133~r160：MeshPhysicalMaterial 新参数占位，避免
    // "THREE.MeshPhysicalMaterial: 'thickness' is not a property of this material"
    try {
      var MPM = patched.MeshPhysicalMaterial || THREE.MeshPhysicalMaterial;
      if (MPM && MPM.prototype) {
        var _mpmProps = ['thickness', 'attenuationColor', 'attenuationDistance', 'ior',
          'specularIntensity', 'specularColor', 'sheen', 'sheenColor', 'sheenRoughness',
          'transmission', 'transmissionMap', 'translucency', 'iridescence', 'iridescenceIOR',
          'iridescenceThicknessRange', 'anisotropy', 'anisotropyRotation', 'dispersion',
          'clearcoat', 'clearcoatRoughness', 'clearcoatMap'];
        _mpmProps.forEach(function (p) {
          if (!(p in MPM.prototype)) {
            try {
              var _initVal = (p === 'attenuationColor' || p.indexOf('Color') >= 0)
                ? new THREE.Color(0xffffff)
                : (/(Map|Texture)$/.test(p) ? null : 0);
              Object.defineProperty(MPM.prototype, p, {
                configurable: true, writable: true, value: _initVal
              });
            } catch (e2) {}
          }
        });
      }
    } catch (e) {}

    // r140+：DataTexture3D 桩构造函数，避免 "is not a constructor"
    if (!patched.DataTexture3D) {
      try {
        patched.DataTexture3D = function (data, width, height, depth) {
          if (THREE.DataTexture) {
            return new THREE.DataTexture(data || null, width || 1, height || 1, THREE.RGBAFormat);
          }
          return { isTexture: true, image: { width: width || 1, height: height || 1 } };
        };
        patched.DataTexture3D.prototype = THREE.DataTexture ? THREE.DataTexture.prototype : {};
      } catch (e) {}
    }

    return patched;
  }

  function makeWebGLRenderTargetStub(THREE) {
    function WebGLRenderTarget(width, height, options) {
      this.width = width || 256;
      this.height = height || 256;
      this.depthBuffer = true;
      this.depthTexture = null;
      this.texture = (THREE && THREE.Texture)
        ? new THREE.Texture()
        : { image: { width: this.width, height: this.height }, isTexture: true };
      this.texture.image = { width: this.width, height: this.height };
      this.options = options || {};
      this.samples = 0;
    }
    WebGLRenderTarget.prototype.setSize = function () {};
    WebGLRenderTarget.prototype.dispose = function () {};
    WebGLRenderTarget.prototype.clone = function () { return new WebGLRenderTarget(this.width, this.height, this.options); };
    return WebGLRenderTarget;
  }

  // ---- 资源加载器桩（防止 undefined is not a constructor）----

  /**
   * TextureLoader 桩：返回带实际像素数据的圆形柔光纹理
   * 解决 world 模式下粒子/精灵等依赖 PointsMaterial.map 的效果变成白色方块的问题
   */
  function makeTextureLoaderStub() {
    function TextureLoader() { this.crossOrigin = ''; }

    let _circleCanvas = null;
    function getCircleTexture() {
      if (_circleCanvas) return _circleCanvas;
      try {
        _circleCanvas = document.createElement('canvas');
        _circleCanvas.width = 64;
        _circleCanvas.height = 64;
        const ctx = _circleCanvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
      } catch (e) {
        _circleCanvas = { width: 1, height: 1 };
      }
      return _circleCanvas;
    }

    TextureLoader.prototype.load = function (url, onLoad, onProgress, onError) {
      const img = getCircleTexture();
      const tex = {
        isTexture: true, image: img, needsUpdate: true,
        wrapS: 1000, wrapT: 1000, magFilter: 1006, minFilter: 1008,
        format: 1023, type: 1009, generateMipmaps: true,
        dispose: function () {},
        clone: function () {
          return {
            isTexture: true, image: img, needsUpdate: true,
            wrapS: 1000, wrapT: 1000, magFilter: 1006, minFilter: 1008,
            format: 1023, type: 1009, generateMipmaps: true,
            dispose: function () {}, clone: function () { return this; }
          };
        }
      };
      if (typeof onLoad === 'function') { try { onLoad(tex); } catch (e) {} }
      return tex;
    };
    TextureLoader.prototype.setCrossOrigin = function () {};
    return TextureLoader;
  }

  /**
   * CubeTextureLoader 桩
   */
  function makeCubeTextureLoaderStub() {
    function CubeTextureLoader() {}
    CubeTextureLoader.prototype.load = function (urls, onLoad, onProgress, onError) {
      const tex = {
        isCubeTexture: true, image: [],
        dispose: function () {}, clone: function () { return this; }
      };
      for (let i = 0; i < 6; i++) { tex.image.push({ width: 1, height: 1 }); }
      if (typeof onLoad === 'function') { try { onLoad(tex); } catch (e) {} }
      return tex;
    };
    return CubeTextureLoader;
  }

  /**
   * RGBELoader（HDR环境光贴图）+ EXRLoader 桩
   */
  function makeHDRLoaderStub() {
    function Loader() { this.setDataType = function () {}; }
    Loader.prototype.load = function (url, onLoad, onProgress, onError) {
      const tex = {
        isTexture: true, mapping: 301, image: { width: 64, height: 64 },
        dispose: function () {}, clone: function () { return this; }
      };
      if (typeof onLoad === 'function') { try { onLoad(tex); } catch (e) {} }
      return tex;
    };
    return { RGBELoader: Loader, EXRLoader: Loader };
  }

  /**
   * PMREMGenerator 桩（world 模式没有真实 renderer）
   */
  function makePMREMGeneratorStub() {
    let _texture = null;
    // 尝试取全局 THREE 构造占位纹理
    function getTHREE() {
      return global.THREE || (typeof THREE !== 'undefined' ? THREE : null);
    }
    function PMREMGenerator(renderer) {
      this._renderer = renderer;
    }
    PMREMGenerator.prototype.fromScene = function (scene, sigma, near, far) {
      const tex = {
        isTexture: true, mapping: 301, image: { width: 256, height: 256 },
        dispose: function () {}, clone: function () { return this; }
      };
      _texture = tex;
      return tex;
    };
    PMREMGenerator.prototype.fromEquirectangular = function (equirectangular) {
      const tex = {
        isTexture: true, mapping: 301, image: { width: 128, height: 128 },
        dispose: function () {}, clone: function () { return this; }
      };
      _texture = tex;
      return tex;
    };
    PMREMGenerator.prototype.fromCubemap = function (cubemap) {
      const tex = {
        isTexture: true, mapping: 301, image: { width: 128, height: 128 },
        dispose: function () {}, clone: function () { return this; }
      };
      _texture = tex;
      return tex;
    };
    PMREMGenerator.prototype.compileEquirectangularShader = function () {};
    PMREMGenerator.prototype.compileCubemapShader = function () {};
    PMREMGenerator.prototype.dispose = function () {};
    return PMREMGenerator;
  }

  /**
   * OBJLoader / FBXLoader / SVGLoader 等桩
   */
  function makeGenericLoaderStub(name) {
    function Loader() {}
    Loader.prototype.load = function (url, onLoad, onProgress, onError) {
      console.warn('[ThreeJSCompat] ' + name + ' 不可用，跳过加载', url);
      if (typeof onError === 'function') { onError(new Error(name + ' 不可用')); }
    };
    return Loader;
  }

  // ---- 构造运行环境桩集合 ----

  /**
   * 构造一个完整的运行环境桩集合
   * @param {Object} opts
   *  - container {HTMLElement}
   *  - mode {'preview'|'world'}
   *  - rafStub {Function}
   *  - cafStub {Function}
   */
  function createRuntimeStubs(opts) {
    opts = opts || {};
    const container = opts.container;
    const mode = opts.mode === 'world' ? 'world' : 'preview';
    const size = container
      ? { width: container.clientWidth || 800, height: container.clientHeight || 600 }
      : { width: 800, height: 600 };

    const dummy = createDummyElement(size);
    const containerEl = container || dummy;

    const docStub = createDocStub(containerEl);
    const windowStub = createWindowStub(size, opts.rafStub, opts.cafStub);

    const pp = makePostprocessingStub();
    const pane = makeTweakpaneStub();
    const lilGui = makeGUIStub();
    const datGui = makeDatGUIStub();
    const stats = makeStatsStub();
    const gsap = makeGsapStub();
    const tween = makeTweenStub();

    // 资源加载器桩
    const TextureLoader = makeTextureLoaderStub();
    const CubeTextureLoader = makeCubeTextureLoaderStub();
    const hdrLoaders = makeHDRLoaderStub();
    const PMREMGenerator = makePMREMGeneratorStub();

    return {
      docStub: docStub,
      windowStub: windowStub,
      containerEl: containerEl,
      Stats: stats,
      Pane: pane,
      GUI: lilGui,
      datGUI: datGui,
      postprocessing: pp,
      gsap: gsap,
      TWEEN: tween,
      KawaseBlurPass: pp.KawaseBlurPass,
      EffectComposer: pp.EffectComposer,
      RenderPass: pp.RenderPass,
      OutputPass: pp.OutputPass,
      // 资源加载器桩
      TextureLoader: TextureLoader,
      CubeTextureLoader: CubeTextureLoader,
      RGBELoader: hdrLoaders.RGBELoader,
      EXRLoader: hdrLoaders.EXRLoader,
      PMREMGenerator: PMREMGenerator,
      // 通用 3D 格式加载器桩
      OBJLoader: makeGenericLoaderStub('OBJLoader'),
      FBXLoader: makeGenericLoaderStub('FBXLoader'),
      SVGLoader: makeGenericLoaderStub('SVGLoader'),
      STLLoader: makeGenericLoaderStub('STLLoader'),
      patchTHREE: function (THREE) { return patchTHREE(THREE, mode); }
    };
  }

  // ---- 代码清洗增强 ----

  /**
   * 增强 import 剥离：
   *  1. 支持多行 import（含 from 或 bare import）
   *  2. 支持 import 后带 as 的默认导入
   *  3. 不处理注释里的 import（先简单处理，够用即可）
   */
  function stripImports(code) {
    if (!code) return '';
    // 匹配 import ... from '...' 或 import '...'，允许跨行
    return code.replace(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"]\s*;?\s*$/gm, '');
  }

  global.ThreeJSCompatibility = {
    createRuntimeStubs: createRuntimeStubs,
    createDocStub: createDocStub,
    createWindowStub: createWindowStub,
    patchTHREE: patchTHREE,
    stripImports: stripImports,
    makeStatsStub: makeStatsStub,
    makePostprocessingStub: makePostprocessingStub,
    makeTweakpaneStub: makeTweakpaneStub,
    makeGUIStub: makeGUIStub,
    makeDatGUIStub: makeDatGUIStub,
    makeGsapStub: makeGsapStub,
    makeTweenStub: makeTweenStub,
    makeWebGLRenderTargetStub: makeWebGLRenderTargetStub
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.ThreeJSCompatibility;
  }
})(typeof window !== 'undefined' ? window : this);
