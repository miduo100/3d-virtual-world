/**
 * 济宁米多信息科技有限公司 版权所有
 * Three.js 代码运行器（全局脚本，依赖 window.THREE）
 *
 * 作用：把用户粘贴的"任意形态 Three.js 代码"标准化运行起来。
 *  - 自动剥离 ESM import 语句
 *  - 自动桩化 DOM / 自带渲染器 / OrbitControls，只保留"形状 + 样式"进场景
 *  - 支持两种写法：
 *      1) 约定写法：代码里定义 function createGeometry(THREE, scene){ ... return obj; }
 *      2) 独立 Demo 写法：自带 scene/renderer/OrbitControls/requestAnimationFrame（蘑菇/朋克风等）
 *
 * 两种模式：
 *  - mode='preview'：用真实渲染器在 container 上渲染，用户看到的就是 demo 原样
 *  - mode='world'  ：桩化渲染器，把生成的网格捕获到一个 Group，供世界/编辑器按位置摆放
 *
 * 返回 { object, onFrame, dispose }
 *  - object  : world 模式下返回被捕获的 Group（可 add 到世界场景）
 *  - onFrame : 每帧调用以驱动动画（Time uniform / requestAnimationFrame 回调）
 *  - dispose : 清理预览循环与 canvas
 */
(function (global) {
  'use strict';

  function getTHREE() {
    return global.THREE || (typeof THREE !== 'undefined' ? THREE : null);
  }

  // 是否加载了兼容性模块（DOM/外部库/Three.js版本桥接）
  const hasCompat = typeof ThreeJSCompatibility !== 'undefined';

  // world 模式下用于模拟 setInterval/setTimeout 的 ID 与清除状态
  let timerIdCounter = 0;
  const clearedTimers = new Set();

  // 去除 ESM import 行（new Function 不支持 import）
  function stripImports(code) {
    if (hasCompat && ThreeJSCompatibility.stripImports) {
      return ThreeJSCompatibility.stripImports(code);
    }
    return code.replace(/^\s*import\s+[^;]*?;?\s*$/gm, '');
  }

  // 按清洗开关规范化代码（仅影响存储，不影响运行——运行侧靠桩化保证只留形状+样式）
  function cleanThreeJSCode(code, opts) {
    opts = opts || {};
    let out = code;
    if (opts.stripImport !== false) {
      out = out.replace(/^\s*import\s+[^;]*?;?\s*$/gm, '');
    }
    if (opts.stripRenderer) {
      out = out.replace(/^\s*(const|let|var)\s+\w+\s*=\s*new\s+THREE\.WebGLRenderer\s*\([^)]*\)\s*;?\s*$/gm, '');
      out = out.replace(/^\s*\w+\.setSize\s*\([^)]*\)\s*;?\s*$/gm, '');
      out = out.replace(/^\s*\w+\.setPixelRatio\s*\([^)]*\)\s*;?\s*$/gm, '');
      out = out.replace(/^\s*\w+\.setClearColor\s*\([^)]*\)\s*;?\s*$/gm, '');
      out = out.replace(/^\s*\w+\.setAnimationLoop\s*\([^)]*\)\s*;?\s*$/gm, '');
    }
    if (opts.stripControls) {
      out = out.replace(/^\s*(const|let|var)\s+\w+\s*=\s*new\s+OrbitControls\s*\([^)]*\)\s*;?\s*$/gm, '');
      out = out.replace(/^\s*\w+\.enableDamping\s*=\s*[^;]*;?\s*$/gm, '');
      out = out.replace(/^\s*\w+\.autoRotate\s*=\s*[^;]*;?\s*$/gm, '');
      out = out.replace(/^\s*\w+\.target\.set\s*\([^)]*\)\s*;?\s*$/gm, '');
    }
    if (opts.stripDOMBox) {
      out = out.replace(/^\s*(const|let|var)\s+\w+\s*=\s*document\.getElementById\s*\([^)]*\)\s*;?\s*$/gm, '');
      out = out.replace(/^\s*(const|let|var)\s+\w+\s*=\s*document\.createElement\s*\([^)]*\)\s*;?\s*$/gm, '');
      out = out.replace(/^\s*\w+\.appendChild\s*\([^)]*\)\s*;?\s*$/gm, '');
      out = out.replace(/^\s*\w+\.addEventListener\s*\([^)]*\)\s*;?\s*$/gm, '');
    }
    if (opts.stripLog) {
      out = out.replace(/^\s*console\.\w+\s*\([^)]*\)\s*;?\s*$/gm, '');
    }
    return out;
  }

  // ---- Smart Proxy：终极兜底，访问 THREE 上不存在的属性返回"智能桩" ----
  function makeSmartStub(name) {
    const str = String(name);
    // 首字母大写的构造函数：返回可调用的桩类（不会崩溃）
    if (/^[A-Z]/.test(str)) {
      function Stub() {}
      Stub.prototype.isStub = true;
      Stub.prototype.clone = function () { return this; };
      Stub.prototype.copy = function () { return this; };
      Stub.prototype.dispose = function () {};
      Stub.prototype.update = function () {};
      Stub.prototype.render = function () {};
      return Stub;
    }
    // 全大写常量：返回数字 0（THREE.SomeConst 不会是 undefined）
    if (/^[A-Z_0-9]+$/.test(str)) return 0;
    // 其余：返回 undefined（让 if 判断走 else 分支，不崩溃）
    return undefined;
  }

  function makeSmartProxy(target) {
    if (!target || typeof Proxy === 'undefined') return target;
    return new Proxy(target, {
      get(t, prop) {
        if (typeof prop === 'symbol') return t[prop];
        if (prop in t) return t[prop];
        // 缓存到 target，避免每次访问都新建桩
        const stub = makeSmartStub(prop);
        try { t[prop] = stub; } catch (e) {}
        return stub;
      },
      has() { return true; },
      set(t, prop, val) { try { t[prop] = val; } catch (e) {} return true; }
    });
  }

  // 渲染器桩（world 模式用，不产生真实画面，只收集 onFrame）
  function makeStubRenderer(captureFrameRef) {
    function StubRenderer() {
      this.domElement = global.document ? global.document.createElement('canvas') : { style: {} };
      this.shadowMap = { enabled: false, type: 0, autoUpdate: true };
      this.outputColorSpace = '';
      this.outputEncoding = '';
      this.toneMapping = 0;
      this.toneMappingExposure = 1;
      this.info = { render: {}, memory: {} };
      this.capabilities = { isWebGL2: false };
      this.xr = { enabled: false };
      this.autoClear = true;
      this.state = { buffers: { depth: { setMask: function () {} } } };
    }
    StubRenderer.prototype.setSize = function () {};
    StubRenderer.prototype.setPixelRatio = function () {};
    StubRenderer.prototype.setClearColor = function () {};
    StubRenderer.prototype.setAnimationLoop = function (fn) {
      if (typeof fn === 'function') captureFrameRef.cb = fn;
    };
    StubRenderer.prototype.compile = function () {};
    StubRenderer.prototype.render = function () {};
    StubRenderer.prototype.dispose = function () {};
    StubRenderer.prototype.setRenderTarget = function () {};
    return StubRenderer;
  }

  // 简易相机桩
  function makeDummyCamera(THREE) {
    return new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  }

  function makeControlsStub(THREE) {
    function C() {
      this.target = new THREE.Vector3();
      this.enableDamping = false;
      this.autoRotate = false;
      this.dampingFactor = 0.05;
      this.rotateSpeed = 1;
    }
    C.prototype.update = function () {};
    C.prototype.dispose = function () {};
    return C;
  }

  function makeGUIStub() {
    function G() {}
    G.prototype.add = function () { return this; };
    G.prototype.addColor = function () { return this; };
    G.prototype.addFolder = function () { return this; };
    G.prototype.open = function () {};
    G.prototype.close = function () {};
    G.prototype.name = function () { return this; };
    G.prototype.onChange = function () { return this; };
    return G;
  }

  function makeEffectComposerStub(THREE) {
    function EC() {
      this.passes = [];
      this.renderToScreen = true;
    }
    EC.prototype.addPass = function (p) { this.passes.push(p); };
    EC.prototype.setSize = function () {};
    EC.prototype.render = function () {};
    EC.prototype.dispose = function () {};
    return EC;
  }

  function makePassStub() {
    function P() { this.enabled = true; }
    return P;
  }

  /**
   * 运行代码
   * @param {string} code
   * @param {object} options { mode:'preview'|'world', THREE, container, clean }
   * @returns {{object:Object3D|null, onFrame:Function, dispose:Function, error:Error|null}}
   */
  function runThreeJSCode(code, options) {
    options = options || {};
    const THREE = options.THREE || getTHREE();
    if (!THREE) return { object: null, onFrame: function () {}, dispose: function () {}, error: new Error('THREE 未加载') };

    const mode = options.mode === 'world' ? 'world' : 'preview';
    const frameRef = { cb: null };
    let previewRAF = 0;
    let previewRunning = false;

    // 捕获组（world 模式）
    const captureScene = new THREE.Group();
    captureScene.name = '__threejs_capture__';

    // requestAnimationFrame 收集器（不真正递归，交给宿主循环驱动）
    function captureRAF(cb) {
      if (typeof cb === 'function') frameRef.cb = cb;
      return 0;
    }
    function noopCancel() {}

    // DOM / 环境桩（优先使用兼容性模块，回退到内置简易桩）
    let compatStubs = null;
    if (hasCompat) {
      compatStubs = ThreeJSCompatibility.createRuntimeStubs({
        container: options.container,
        mode: mode,
        rafStub: captureRAF,
        cafStub: noopCancel
      });
    }
    const dummyEl = {
      clientWidth: 800, clientHeight: 600, style: {},
      appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {},
      getContext() { return null; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
    };
    const containerEl = (mode === 'preview' && options.container) ? options.container : (compatStubs ? compatStubs.containerEl : dummyEl);
    var _dummyFallback = {
      style: {}, textContent: '', innerHTML: '', value: '', children: [],
      appendChild(c) { return c; }, removeChild(c) { return c; },
      addEventListener() {}, removeEventListener() {}, getContext() { return null; }
    };
    var _containerIds = ['box', 'canvas', 'canvas-container', 'container', 'app', 'scene'];
    const docStub = compatStubs ? compatStubs.docStub : {
      readyState: 'complete',
      getElementById(id) {
        if (id && _containerIds.indexOf(String(id).toLowerCase()) >= 0) return containerEl;
        return _dummyFallback;
      },
      createElement(tag) { return global.document ? global.document.createElement(tag) : dummyEl; },
      querySelector(sel) {
        if (sel) {
          var s = String(sel).toLowerCase();
          if (s === '#box' || s === '#canvas' || s === '#canvas-container' || s === '#container' || s === 'body') return containerEl;
        }
        return _dummyFallback;
      },
      querySelectorAll() { return []; },
      body: containerEl,
      addEventListener(type, listener) {
        if (typeof listener === 'function' && (type === 'DOMContentLoaded' || type === 'load')) {
          try { listener({ type: type }); } catch (e) {}
        }
      },
      removeEventListener() {}
    };

    const windowStub = compatStubs ? compatStubs.windowStub : {
      innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
      addEventListener(type, listener) {
        if (typeof listener === 'function' && (type === 'load' || type === 'DOMContentLoaded')) {
          try { listener({ type: type }); } catch (e) {}
        }
      },
      removeEventListener() {},
      requestAnimationFrame: captureRAF,
      cancelAnimationFrame: noopCancel,
      location: { href: '' },
      onload: null,
      THREE: THREE
    };

    // 计时器桩：world 模式下不触发真实异步定时器，避免后台残留；
    // 但为了让初始化类代码（如用 setInterval 创建飞线）能完整执行，
    // setInterval 会同步连续执行最多 MAX_INTERVAL_RUNS 次回调，setTimeout 执行一次。
    const MAX_INTERVAL_RUNS = 20;
    const timerStubs = mode === 'world' ? {
      setInterval: function (fn, delay, ...args) {
        let count = 0;
        let id = ++timerIdCounter;
        function tick() {
          if (count >= MAX_INTERVAL_RUNS || clearedTimers.has(id)) return;
          count++;
          if (typeof fn === 'function') {
            try { fn.apply(global, args); } catch (e) { console.warn('[ThreeJSCodeRunner] setInterval 回调执行失败:', e); }
          }
          // 本次回调未清除则继续下一次
          if (count < MAX_INTERVAL_RUNS && !clearedTimers.has(id)) {
            tick();
          }
        }
        tick();
        return id;
      },
      setTimeout: function (fn, delay, ...args) {
        if (typeof fn === 'function') {
          try { fn.apply(global, args); } catch (e) { console.warn('[ThreeJSCodeRunner] setTimeout 回调执行失败:', e); }
        }
        return 0;
      },
      clearInterval: function (id) { if (id) clearedTimers.add(id); },
      clearTimeout: function (id) { if (id) clearedTimers.add(id); }
    } : {
      setInterval: global.setInterval,
      setTimeout: global.setTimeout,
      clearInterval: global.clearInterval,
      clearTimeout: global.clearTimeout
    };

    // ===== 安全桩化（world 模式下隔离用户代码对浏览器 API 的裸访问）=====
    // 注意：new Function 参数名遮蔽同名全局变量，但未列在参数列表里的全局符号
    // 会穿透访问到真实浏览器 API（如裸用 fetch/localStorage/navigator）。
    // 这段桩化解决"存储型 XSS"威胁面——管理员保存的代码在所有玩家端执行。
    const securityStubs = mode === 'world' ? {
      fetch: function () { console.warn('[ThreeJSCodeRunner] fetch 在世界模式下已被拦截'); return Promise.reject(new Error('fetch blocked')); },
      XMLHttpRequest: function () { console.warn('[ThreeJSCodeRunner] XMLHttpRequest 在世界模式下不可用'); },
      localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { }, clear: function () { }, get length() { return 0; }, key: function () { return null; } },
      sessionStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { }, clear: function () { }, get length() { return 0; }, key: function () { return null; } },
      evalFn: function () { console.warn('[ThreeJSCodeRunner] eval 在世界模式下已被禁用'); },
      Worker: function () { console.warn('[ThreeJSCodeRunner] Worker 在世界模式下不可用'); },
      WebSocket: function () { console.warn('[ThreeJSCodeRunner] WebSocket 在世界模式下不可用'); },
      AudioCtor: function () { this.play = function () { }; this.pause = function () { }; },
      ImageCtor: function () { this.onload = null; this.onerror = null; },
      navigator: { userAgent: 'ThreeJSCodeRunner', platform: '', onLine: true, language: 'en' },
      alertFn: function () { },
      confirmFn: function () { return false; },
      promptFn: function () { return null; },
      atob: function () { return ''; },
      btoa: function () { return ''; },
      indexedDB: undefined,
      Notification: undefined
    } : {
      fetch: global.fetch ? global.fetch.bind(global) : function () { },
      XMLHttpRequest: global.XMLHttpRequest,
      localStorage: global.localStorage,
      sessionStorage: global.sessionStorage,
      evalFn: global.eval,
      Worker: global.Worker,
      WebSocket: global.WebSocket,
      AudioCtor: global.Audio,
      ImageCtor: global.Image,
      navigator: global.navigator || {},
      alertFn: global.alert,
      confirmFn: global.confirm,
      promptFn: global.prompt,
      atob: global.atob,
      btoa: global.btoa,
      indexedDB: global.indexedDB,
      Notification: global.Notification
    };

    // 构造器捕获容器（preview 模式决策树用）
    var capturedScenes = [];
    var capturedRenderers = [];
    var capturedCameras = [];
    var userHasRenderLoop = false;   // 用户代码调用了真实 renderer.setAnimationLoop
    var fallbackRenderer = null;     // 兜底创建的渲染器（dispose 时清理）
    var fallbackControls = null;     // 兜底创建的控制器（dispose 时清理）

    // THREE2 = 继承原型，按需覆盖
    const THREE2 = hasCompat ? ThreeJSCompatibility.patchTHREE(THREE, mode) : Object.create(THREE);
    const THREE3 = makeSmartProxy(THREE2); // P2：Smart Proxy 兜底，未知 API 不崩溃
    if (mode === 'world') {
      THREE2.WebGLRenderer = makeStubRenderer(frameRef);
      THREE2.Scene = function () { return captureScene; };           // 让 new THREE.Scene() 指向捕获组
      THREE2.PerspectiveCamera = function () { return makeDummyCamera(THREE); };
    } else {
      // ★ preview 模式：拦截核心构造器，捕获用户代码创建的 Scene/Renderer/Camera 实例，
      // 供执行完毕后的决策树选择最优渲染方式（透明包装：返回真实实例，instanceof/原型链不受影响）
      var __BaseScene = THREE2.Scene || THREE.Scene;
      if (__BaseScene) {
        THREE2.Scene = function Scene() {
          var s = new __BaseScene();
          capturedScenes.push(s);
          return s;
        };
        THREE2.Scene.prototype = __BaseScene.prototype;
      }

      var __BaseRdr = THREE2.WebGLRenderer || THREE.WebGLRenderer;
      if (__BaseRdr) {
        THREE2.WebGLRenderer = function WebGLRenderer(params) {
          var r = new __BaseRdr(params);
          capturedRenderers.push(r);
          // ★ 包装 setAnimationLoop：标记用户已自建渲染循环，防止兜底逻辑重复创建渲染器
          try {
            var origSAL = r.setAnimationLoop.bind(r);
            r.setAnimationLoop = function (fn) {
              if (typeof fn === 'function') userHasRenderLoop = true;
              return origSAL(fn);
            };
          } catch (e) {}
          return r;
        };
        THREE2.WebGLRenderer.prototype = __BaseRdr.prototype;
      }

      var __BaseCam = THREE2.PerspectiveCamera || THREE.PerspectiveCamera;
      if (__BaseCam) {
        THREE2.PerspectiveCamera = function PerspectiveCamera(fov, aspect, near, far) {
          var c = new __BaseCam(fov, aspect, near, far);
          capturedCameras.push(c);
          return c;
        };
        THREE2.PerspectiveCamera.prototype = __BaseCam.prototype;
      }

      var __BaseOrthoCam = THREE2.OrthographicCamera || THREE.OrthographicCamera;
      if (__BaseOrthoCam) {
        THREE2.OrthographicCamera = function OrthographicCamera(l, r, t, b, n, f) {
          var c = new __BaseOrthoCam(l, r, t, b, n, f);
          capturedCameras.push(c);
          return c;
        };
        THREE2.OrthographicCamera.prototype = __BaseOrthoCam.prototype;
      }
    }

    // ★ 跨版本材质参数适配（两种模式都生效）：
    // r128 的 MeshPhysicalMaterial.sheen 是 Color|null，高版本(r132+)改为 number(强度)+sheenColor。
    // 用户代码若按高版本传 sheen: 0.4（数字），r128 会把数字直接传给 vec3 uniform 导致
    // 渲染循环每帧崩溃（uniform3fv: must have callable @@iterator）。按运行时版本探测并转换。
    var __BasePhysMat = THREE2.MeshPhysicalMaterial || THREE.MeshPhysicalMaterial;
    if (__BasePhysMat) {
      var __sheenIsColor = false;
      try {
        var __probe = new __BasePhysMat();
        __sheenIsColor = (__probe.sheen === null) || (__probe.sheen && __probe.sheen.isColor);
        if (__probe.dispose) __probe.dispose();
      } catch (e) {}
      if (__sheenIsColor) {
        THREE2.MeshPhysicalMaterial = function MeshPhysicalMaterial(params) {
          if (params && typeof params.sheen === 'number') {
            params = Object.assign({}, params);
            var sheenIntensity = params.sheen;
            var sheenTint = params.sheenColor !== undefined ? params.sheenColor : 0xffffff;
            try {
              params.sheen = new THREE.Color(sheenTint).multiplyScalar(sheenIntensity);
            } catch (e) {
              params.sheen = new THREE.Color(0x000000);
            }
            delete params.sheenColor;
            delete params.sheenRoughness; // r128 无此属性，删除避免告警噪音
          }
          return new __BasePhysMat(params);
        };
        THREE2.MeshPhysicalMaterial.prototype = __BasePhysMat.prototype;
      }
    }
    const ControlsStub = makeControlsStub(THREE);
    THREE2.OrbitControls = THREE.OrbitControls || ControlsStub;
    THREE2.GLTFLoader = THREE.GLTFLoader || function () {
      this.setDRACOLoader = function () {};
      this.load = function (url, onLoad) { console.warn('[ThreeJSCodeRunner] GLTFLoader 不可用，跳过加载', url); };
    };
    THREE2.DRACOLoader = THREE.DRACOLoader || function () { this.setDecoderPath = function () {}; this.preload = function () {}; };
    THREE2.RoomEnvironment = THREE.RoomEnvironment || function () { return new THREE.Scene(); };

    // 资源加载器桩（由 ThreeJSCompatibility 模块提供，兜底 undefined is not a constructor）
    if (compatStubs) {
      THREE2.TextureLoader = THREE.TextureLoader || compatStubs.TextureLoader;
      THREE2.CubeTextureLoader = THREE.CubeTextureLoader || compatStubs.CubeTextureLoader;
      THREE2.RGBELoader = THREE.RGBELoader || compatStubs.RGBELoader;
      THREE2.EXRLoader = THREE.EXRLoader || compatStubs.EXRLoader;
      THREE2.PMREMGenerator = THREE.PMREMGenerator || compatStubs.PMREMGenerator;
      THREE2.OBJLoader = THREE.OBJLoader || compatStubs.OBJLoader;
      THREE2.FBXLoader = THREE.FBXLoader || compatStubs.FBXLoader;
      THREE2.SVGLoader = THREE.SVGLoader || compatStubs.SVGLoader;
      THREE2.STLLoader = THREE.STLLoader || compatStubs.STLLoader;
    }

    // preview 模式下优先使用页面已加载的真实库；world 模式下始终用桩
    const realPostprocessing = (mode === 'preview' && global.postprocessing) ? global.postprocessing : null;
    const realStats = (mode === 'preview' && global.Stats && typeof global.Stats === 'function') ? global.Stats : null;

    // tweakpane UMD 暴露形式不一：可能是 window.Pane / window.Tweakpane / window.Tweakpane.Pane
    function resolvePaneGlobal() {
      if (mode !== 'preview') return null;
      if (global.Pane && typeof global.Pane === 'function' && global.Pane.prototype && typeof global.Pane.prototype.addBinding === 'function') {
        return global.Pane;
      }
      if (global.Tweakpane) {
        if (typeof global.Tweakpane === 'function' && global.Tweakpane.prototype && typeof global.Tweakpane.prototype.addBinding === 'function') {
          return global.Tweakpane;
        }
        if (global.Tweakpane.Pane && typeof global.Tweakpane.Pane === 'function') {
          return global.Tweakpane.Pane;
        }
        if (global.Tweakpane.default && typeof global.Tweakpane.default === 'function') {
          return global.Tweakpane.default;
        }
      }
      return null;
    }
    const realTweakpane = resolvePaneGlobal();

    const GUIStub = compatStubs ? compatStubs.GUI : makeGUIStub();
    const EffectComposerStub = (realPostprocessing && realPostprocessing.EffectComposer) ? realPostprocessing.EffectComposer : (compatStubs ? compatStubs.EffectComposer : makeEffectComposerStub(THREE));
    const RenderPassStub = (realPostprocessing && realPostprocessing.RenderPass) ? realPostprocessing.RenderPass : (compatStubs ? compatStubs.RenderPass : makePassStub());
    const OutputPassStub = (realPostprocessing && realPostprocessing.OutputPass) ? realPostprocessing.OutputPass : (compatStubs ? compatStubs.OutputPass : makePassStub());
    const KawaseBlurPassStub = (realPostprocessing && realPostprocessing.KawaseBlurPass) ? realPostprocessing.KawaseBlurPass : (compatStubs ? compatStubs.KawaseBlurPass : makePassStub());
    const PaneStub = realTweakpane ? realTweakpane : (compatStubs ? compatStubs.Pane : function () { this.addBinding = function () { return this; }; });
    const StatsStub = realStats ? realStats : (compatStubs ? compatStubs.Stats : function () { this.update = function () {}; this.dom = { style: {} }; });
    const postprocessingStub = compatStubs ? compatStubs.postprocessing : {
      KawaseBlurPass: KawaseBlurPassStub,
      EffectComposer: EffectComposerStub,
      RenderPass: RenderPassStub,
      OutputPass: OutputPassStub
    };
    const gsapStub = compatStubs ? compatStubs.gsap : { to: function () { return { onComplete: function () { return this; } }; } };
    const tweenStub = compatStubs ? compatStubs.TWEEN : { Tween: function () { this.to = function () { return this; }; } };

    // 先交给 normalizer 做全量规范化（全角修正 / API 降级 / import 变量自动声明）
    // 该步骤幂等：admin 端已规范化过的代码再次执行也安全
    let codeToRun = code;
    let exportedEntries = [];
    if (typeof ThreeJSCodeNormalizer !== 'undefined' && ThreeJSCodeNormalizer.normalize) {
      try {
        const norm = ThreeJSCodeNormalizer.normalize(code, {
          aggressive: true, stripExports: true, stripImports: true, stripTypeScript: true
        });
        codeToRun = norm.code;
        exportedEntries = norm.exportedEntries || [];
      } catch (ne) {
        console.warn('[ThreeJSCodeRunner] normalizer 失败，回退原始代码:', ne && ne.message);
      }
    }

    const cleaned = stripImports(codeToRun);

    // 入口函数候选列表：export 导出的函数优先；
    // 其次扫描顶层 create*/build*/make* 函数声明（兜底：兼容修复前已保存、丢失 export 信息的代码块，
    // create 组优先于 build 组，避免 buildMaterials 之类的辅助函数抢占入口）；
    // 最后是常见入口名
    var __fnScanRe = /^function\s+((?:create|build|make)[A-Z][\w$]*)\s*\(/gm;
    var __scanCreate = [], __scanBuild = [], __scanMake = [];
    var __fnm;
    while ((__fnm = __fnScanRe.exec(cleaned)) !== null) {
      if (/^create/.test(__fnm[1])) __scanCreate.push(__fnm[1]);
      else if (/^build/.test(__fnm[1])) __scanBuild.push(__fnm[1]);
      else __scanMake.push(__fnm[1]);
    }
    var __entryCandidates = exportedEntries.concat(__scanCreate, __scanBuild, __scanMake, [
      'createBike','createModel','createScene','createObject','createMesh','createGroup',
      'createCharacter','createVehicle','createSculpt','createFigure','createAsset',
      'buildModel','buildScene','buildBike','buildCharacter',
      'makeModel','makeScene','makeBike',
      'main','init','setup','start','run'
    ]);
    var __entryListStr = JSON.stringify(__entryCandidates);

    let createGeometry = null;
    let runError = null;
    const __execSource = function (src) {
      const executeCode = new Function(
        'THREE', 'OrbitControls', 'GLTFLoader', 'DRACOLoader', 'RoomEnvironment',
        'EffectComposer', 'RenderPass', 'OutputPass', 'KawaseBlurPass',
        'GUI', 'Pane', 'Stats', 'Tweakpane',
        'postprocessing', 'tweakpane', 'lilGUI', 'datGUI', 'gsap', 'TWEEN',
        'fetch', 'XMLHttpRequest', 'localStorage', 'sessionStorage',
        'evalFn', 'Worker', 'WebSocket', 'AudioCtor', 'ImageCtor',
        'navigator', 'alertFn', 'confirmFn', 'promptFn',
        'atob', 'btoa', 'indexedDB', 'Notification',
        'document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame',
        'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout',
        src + '\n;var __entry = null;' +
        'var __ens = [];' +
        'if (typeof __export_entries !== "undefined" && Object.prototype.toString.call(__export_entries) === "[object Array]") { for (var __xi = 0; __xi < __export_entries.length; __xi++) __ens.push(__export_entries[__xi]); }' +
        'var __ns = ' + __entryListStr + ';' +
        'for (var __ei = 0; __ei < __ns.length; __ei++) { if (__ens.indexOf(__ns[__ei]) < 0) __ens.push(__ns[__ei]); }' +
        'if (typeof createGeometry === "function") __entry = createGeometry;' +
        'else if (typeof __export_default === "function") __entry = __export_default;' +
        'else {' +
        '  for (var __ni = 0; __ni < __ens.length; __ni++) {' +
        '    try { var __fn = eval(__ens[__ni]); if (typeof __fn === "function") { __entry = __fn; break; } } catch(__ne) {}' +
        '  }' +
        '}' +
        'return __entry;'
      );
      return executeCode(
        THREE3, THREE3.OrbitControls, THREE3.GLTFLoader, THREE3.DRACOLoader, THREE3.RoomEnvironment,
        EffectComposerStub, RenderPassStub, OutputPassStub, KawaseBlurPassStub,
        GUIStub, PaneStub, StatsStub, PaneStub,
        postprocessingStub, PaneStub, GUIStub, function () {}, gsapStub, tweenStub,
        securityStubs.fetch, securityStubs.XMLHttpRequest, securityStubs.localStorage, securityStubs.sessionStorage,
        securityStubs.evalFn, securityStubs.Worker, securityStubs.WebSocket, securityStubs.AudioCtor, securityStubs.ImageCtor,
        securityStubs.navigator, securityStubs.alertFn, securityStubs.confirmFn, securityStubs.promptFn,
        securityStubs.atob, securityStubs.btoa, securityStubs.indexedDB, securityStubs.Notification,
        docStub, windowStub, captureRAF, noopCancel,
        timerStubs.setInterval, timerStubs.setTimeout, timerStubs.clearInterval, timerStubs.clearTimeout
      );
    };
    try {
      createGeometry = __execSource(cleaned);
    } catch (e) {
      // ReferenceError 自愈：AI 生成代码常漏声明 GUI 参数对象（如 parameters）。
      // 抛出 "X is not defined" 即证明该标识符在作用域内无声明（顶层 let/const 会报 TDZ 而非此错），
      // 因此在代码头部注入 var X = {} 桩重试一次是安全的，不会与已有声明冲突。
      const __refMatch = (e && (e.name === 'ReferenceError' || /ReferenceError/.test(String(e))))
        ? /([A-Za-z_$][\w$]*) is not defined/.exec(e.message || String(e)) : null;
      if (__refMatch) {
        try {
          createGeometry = __execSource('var ' + __refMatch[1] + ' = {};\n' + cleaned);
          console.warn('[ThreeJSCodeRunner] 检测到未声明变量 ' + __refMatch[1] + '，已注入空对象桩并重试成功');
        } catch (e2) {
          runError = e2;
          console.error('[ThreeJSCodeRunner] 执行失败:', e2);
        }
      } else {
        runError = e;
        console.error('[ThreeJSCodeRunner] 执行失败:', e);
      }
    }

    let object = null;
    if (mode === 'world') {
      if (typeof createGeometry === 'function') {
        try {
          const g = createGeometry(THREE, captureScene);
          if (g) captureScene.add(g);
        } catch (e) {
          console.error('[ThreeJSCodeRunner] createGeometry 调用失败:', e);
        }
      }

      // 世界模式下只保留模型，清洗灯光/反射/环境等副作用
      if (typeof ThreeJSWorldSanitizer !== 'undefined' && ThreeJSWorldSanitizer.sanitize) {
        ThreeJSWorldSanitizer.sanitize(captureScene, THREE);
      }

      object = captureScene;
    }

    // 帧回调时间戳（用户动画函数可能依赖 time 参数）
    function nowTs() {
      return (global.performance && typeof global.performance.now === 'function') ? global.performance.now() : Date.now();
    }

    // preview 模式：启动自己的渲染循环驱动 onFrame
    if (mode === 'preview') {
      var pvContainer = options.container;

      // ★ Canvas 救援：无论走哪条路径，确保用户创建的 renderer 的 canvas 在容器内可见
      // （用户可能忘了 appendChild，或 append 到了桩元素/真实 body 上）
      if (pvContainer) {
        for (var cri = 0; cri < capturedRenderers.length; cri++) {
          var cr = capturedRenderers[cri];
          try {
            if (cr && cr.domElement && cr.domElement.parentNode !== pvContainer) {
              pvContainer.appendChild(cr.domElement);
              if (typeof cr.setSize === 'function') cr.setSize(pvContainer.clientWidth || 800, pvContainer.clientHeight || 600);
            }
          } catch (e) {}
        }
      }

      // ★ 通用兜底（决策树）：代码没有自建渲染循环时，自动创建预览环境
      if (!frameRef.cb && !userHasRenderLoop && pvContainer) {
        try {
          // 1) 确定要渲染的 Scene：优先选拦截到的子节点最多的 Scene
          var pvScene = null;
          for (var si = 0; si < capturedScenes.length; si++) {
            var sc = capturedScenes[si];
            if (sc && sc.children && sc.children.length > 0) {
              if (!pvScene || sc.children.length > pvScene.children.length) pvScene = sc;
            }
          }
          // 没有有内容的拦截 Scene → 新建并调用入口函数
          if (!pvScene) {
            pvScene = new THREE.Scene();
            if (typeof createGeometry === 'function') {
              try {
                var pvObj = createGeometry(THREE3, pvScene);
                if (pvObj && typeof pvObj.then === 'function') {
                  // 异步入口函数（内部 await GLTFLoader 等）：resolve 后再加入
                  pvObj.then(function (obj) {
                    try {
                      if (obj && obj.isObject3D) pvScene.add(obj);
                    } catch (e) {}
                  }).catch(function (e) {
                    console.error('[ThreeJSCodeRunner] 异步入口函数失败:', e);
                  });
                } else if (pvObj && pvObj.isScene) {
                  // 入口函数直接返回 Scene：替换渲染场景，避免 Scene 嵌套
                  pvScene = pvObj;
                } else if (pvObj && pvObj.isObject3D) {
                  pvScene.add(pvObj);
                }
              } catch (ce) {
                console.error('[ThreeJSCodeRunner] 入口函数调用失败:', ce);
              }
            }
          }

          var pvW = pvContainer.clientWidth || 800;
          var pvH = pvContainer.clientHeight || 600;

          // 2) Renderer：优先复用用户创建的，否则新建
          var pvRenderer = capturedRenderers.length > 0 ? capturedRenderers[capturedRenderers.length - 1] : null;
          if (!pvRenderer) {
            pvRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            pvRenderer.setPixelRatio(global.devicePixelRatio || 1);
            pvContainer.appendChild(pvRenderer.domElement);
            fallbackRenderer = pvRenderer;
          } else if (pvRenderer.domElement && pvRenderer.domElement.parentNode !== pvContainer) {
            pvContainer.appendChild(pvRenderer.domElement);
          }
          try { pvRenderer.setSize(pvW, pvH); } catch (e) {}
          try { pvRenderer.setClearColor(0x1a1a2e, 1); } catch (e) {}

          // 3) Camera：优先复用用户创建的；记录是否用户相机（决定是否自动适配/挂控制器）
          var isUserCamera = capturedCameras.length > 0;
          var pvCamera = isUserCamera ? capturedCameras[capturedCameras.length - 1] : null;
          if (!pvCamera) {
            pvCamera = new THREE.PerspectiveCamera(50, pvW / pvH, 0.1, 1000);
          }
          try {
            if (typeof pvCamera.aspect === 'number') {
              pvCamera.aspect = pvW / pvH;
              pvCamera.updateProjectionMatrix();
            }
          } catch (e) {}

          // 4) 补灯光（场景里没有任何光源时）
          var hasLight = false;
          try { pvScene.traverse(function (c) { if (c.isLight) hasLight = true; }); } catch (e) {}
          if (!hasLight) {
            try {
              pvScene.add(new THREE.AmbientLight(0xffffff, 0.6));
              var pvDir = new THREE.DirectionalLight(0xffffff, 0.8);
              pvDir.position.set(5, 10, 5);
              pvScene.add(pvDir);
            } catch (e) {}
          }

          // 5) 自动适配相机：仅在相机处于默认位置（原点）时执行，不覆盖用户手动定位
          var isDefaultPos = false;
          try { isDefaultPos = pvCamera.position.lengthSq() < 0.001; } catch (e) {}
          if (isDefaultPos) {
            try {
              var pvBox = new THREE.Box3().setFromObject(pvScene);
              if (!pvBox.isEmpty()) {
                var pvSize = pvBox.getSize(new THREE.Vector3());
                var pvCenter = pvBox.getCenter(new THREE.Vector3());
                var pvMaxDim = Math.max(pvSize.x, pvSize.y, pvSize.z) || 1;
                var pvFov = (pvCamera.fov || 50) * (Math.PI / 180);
                var pvDist = (pvMaxDim / 2) / Math.tan(pvFov / 2) * 1.45;
                pvCamera.position.set(pvCenter.x + pvDist, pvCenter.y + pvDist * 0.7, pvCenter.z + pvDist);
                pvCamera.lookAt(pvCenter);
              } else {
                // 场景暂无内容（可能异步加载中）：给一个通用视角，模型出现后可见
                pvCamera.position.set(5, 3.5, 5);
                pvCamera.lookAt(0, 0, 0);
              }
            } catch (e) {}
          }

          // 6) OrbitControls：仅在我们自己创建了相机时挂载（用户自建相机大概率已自建控制器，避免争抢）
          var pvControls = null;
          if (!isUserCamera && THREE.OrbitControls) {
            try {
              pvControls = new THREE.OrbitControls(pvCamera, pvRenderer.domElement);
              pvControls.enableDamping = true;
              pvControls.dampingFactor = 0.05;
              fallbackControls = pvControls;
            } catch (oce) {}
          }

          // 7) 设置渲染循环（持续渲染：异步加载完成的模型会自动出现，无需 hasRenderable 前置检查）
          frameRef.cb = function () {
            if (pvControls) pvControls.update();
            pvRenderer.render(pvScene, pvCamera);
          };
        } catch (pve) {
          console.error('[ThreeJSCodeRunner] 兜底预览创建失败:', pve);
        }
      }

      previewRunning = true;
      const loop = function (t) {
        if (!previewRunning) return;
        if (frameRef.cb) {
          try { frameRef.cb(typeof t === 'number' ? t : nowTs()); } catch (e) { console.error('[ThreeJSCodeRunner] 逐帧执行出错:', e); }
        }
        previewRAF = global.requestAnimationFrame ? global.requestAnimationFrame(loop) : 0;
      };
      loop(nowTs());
    }

    return {
      object: object,
      onFrame: function () { if (frameRef.cb) { try { frameRef.cb(nowTs()); } catch (e) {} } },
      dispose: function () {
        previewRunning = false;
        if (previewRAF && global.cancelAnimationFrame) global.cancelAnimationFrame(previewRAF);
        // 清理 preview 模式下注入的 canvas 元素（防止救援链堆积）
        if (mode === 'preview') {
          if (fallbackControls) { try { fallbackControls.dispose(); } catch (e) {} fallbackControls = null; }
          if (fallbackRenderer) { try { fallbackRenderer.dispose(); } catch (e) {} fallbackRenderer = null; }
          const container = options.container;
          if (container && typeof container.innerHTML !== 'undefined') {
            container.innerHTML = '';
          }
        }
      },
      error: runError
    };
  }

  global.ThreeJSCodeRunner = {
    runThreeJSCode: runThreeJSCode,
    cleanThreeJSCode: cleanThreeJSCode,
    stripImports: stripImports
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.ThreeJSCodeRunner;
  }
})(typeof window !== 'undefined' ? window : this);
