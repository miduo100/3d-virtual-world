/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 3D World rendering
class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    
    // 计算FOV，使用水平FOV限制法（防止超宽屏变形）
    const aspectRatio = window.innerWidth / window.innerHeight;
    const maxHorizontalFOV = CONFIG.MAX_HORIZONTAL_FOV || 90;
    const minVerticalFOV = CONFIG.MIN_VERTICAL_FOV || 35;
    
    // 从水平FOV反推垂直FOV
    const horizontalFOVRad = maxHorizontalFOV * (Math.PI / 180);
    const verticalFOVRad = 2 * Math.atan(Math.tan(horizontalFOVRad / 2) / aspectRatio);
    const fov = verticalFOVRad * (180 / Math.PI);
    
    // 设置最小FOV防止过窄
    const finalFOV = Math.max(fov, minVerticalFOV);
    
    console.log(`🖥️ 屏幕宽高比: ${aspectRatio.toFixed(2)}, 水平FOV: ${maxHorizontalFOV}°, 垂直FOV: ${finalFOV.toFixed(1)}°`);
    
    this.camera = new THREE.PerspectiveCamera(
      finalFOV,
      aspectRatio,
      0.1,
      10000
    );
    this.renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: true, // 启用MSAA抗锯齿
      powerPreference: 'high-performance',
      precision: 'mediump', // 提高精度以获得更好的渲染质量
      logarithmicDepthBuffer: true, // 启用对数深度缓冲以减少深度冲突
      stencil: false,
      depth: true,
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    
    // 优化像素比设置，平衡质量和性能
    const fixedRatio = Math.min(window.devicePixelRatio, 1); // 提高像素比以减少锯齿
    this.renderer.setPixelRatio(fixedRatio);
    console.log(`🖥️ 渲染器初始化: ${window.innerWidth}x${window.innerHeight}, 固定像素比: ${fixedRatio}`);
    
    // 启用FXAA抗锯齿作为MSAA的补充
    this.renderer.shadowMap.enabled = false; // 保持阴影禁用以维持性能
    console.log('☀️ 阴影系统: 禁用（平衡性能和质量）');
    
    // 启用伽马校正以获得更准确的颜色
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.physicallyCorrectLights = false;
    
    // 极致性能优化
    this.renderer.sortObjects = false;
    this.renderer.autoClear = true;
    this.renderer.info.autoReset = true; // 自动重置
    this.renderer.clearDepth(); // 清理深度缓冲
    this.renderer.setClearColor(0x87ceeb, 1); // 设置背景颜色
    
    // 完全禁用阴影（消除卡顿的最大元凶）
    this.renderer.shadowMap.enabled = false;
    console.log('☀️ 阴影系统: 完全禁用（极致性能模式）');
    
    // 禁用不必要的渲染特性
    this.renderer.localClippingEnabled = false;
    this.renderer.physicallyCorrectLights = false;
    
    // 启用视锥体剔除（超宽屏性能提升40%）
    this.camera.updateMatrixWorld();
    this.frustum = new THREE.Frustum();
    this.cameraViewProjectionMatrix = new THREE.Matrix4();
    
    // 启用实例化渲染支持
    this.instancedMeshes = new Map(); // 存储实例化网格
    
    // 性能监控
    this.frameCount = 0;
    this.lastFPSCheck = performance.now();
    this.currentFPS = 60;

    // Game objects - Initialize BEFORE setup methods that might use them
    this.players = new Map();
    this.monsters = new Map();
    this.portals = new Map(); // 传送门集合
    this.shops = [];
    this.buildings = [];
    this.generatedBuildings = new Map(); // AI生成的建筑
    this.particles = [];
    this.collisionObjects = []; // Store objects with collision
    this.gltfLoader = new THREE.GLTFLoader(); // GLTF模型加载器
    // 注册 MeshoptDecoder，支持 gltfpack -cc 压缩的 GLB（上传大模型自动压缩后必需）
    this.meshoptDecoder = null;
    import('/js/libs/meshopt/meshopt_decoder.module.js')
      .then(m => {
        this.meshoptDecoder = m.MeshoptDecoder;
        this.gltfLoader.setMeshoptDecoder(m.MeshoptDecoder);
      })
      .catch(err => console.warn('[Meshopt] 解码器加载失败:', err));
    // 配置DRACOLoader，支持Draco压缩的GLB文件
    this.dracoLoader = new THREE.DRACOLoader();
    this.dracoLoader.setDecoderPath('/js/libs/draco/');
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    
    // 技能系统

    this.objLoader = new THREE.OBJLoader(); // OBJ模型加载器
    this.mtlLoader = new THREE.MTLLoader(); // MTL材质加载器
    
    // 加载优化
    this.baseLoadDistance = 200; // 基础加载距离
    this.loadDistance = 200; // 当前加载距离
    this.unloadDistance = 400; // 卸载距离（足够大，防止移动后对象消失）
    this.allWorldObjects = []; // 所有世界对象
    this.loadedObjects = new Set(); // 已加载对象ID
    this.baseBatchSize = 5; // 基础批次大小
    this.batchSize = 5; // 当前批次大小
    this.loadingQueue = []; // 加载队列
    this.loadingBatch = []; // 当前加载批次
    this.loadRetryCount = new Map(); // 对象加载失败重试计数
    this.lastLoadTime = 0; // 上次加载时间
    this.baseLoadInterval = 100; // 加载间隔（ms）
    this.loadInterval = 100; // 当前加载间隔
    this.maxLoadingQueueSize = 200; // 最大加载队列大小
    this._loadedAt = new Map(); // 对象 id → 加载完成时间戳（最短存活时间用）
    this.minObjectLifetimeMs = 60000; // 对象最短存活时间（ms），防阈值边缘反复卸载/重载
    this.objectsPerFrame = 3; // 每帧处理的对象数量
    this.loadingPhase = 'initial'; // 加载阶段：initial, nearby, distant
    this.lastPhaseChange = 0; // 上次阶段变化时间
    this.lastPlayerPosition = null; // 上次玩家位置，用于检测移动
    
    // 帧率适配配置
    this.fpsThresholds = {
      high: 50,  // 高帧率阈值
      medium: 30, // 中帧率阈值
      low: 20    // 低帧率阈值
    };
    this.fpsHistory = []; // 帧率历史
    this.fpsHistorySize = 10; // 帧率历史大小
    
    // LOD配置
    this.lodLevels = [
      { distance: 0, detail: 1.0, name: 'high' },    // 近距离，最高细节
      { distance: 30, detail: 0.8, name: 'medium' },  // 中等距离，中等细节
      { distance: 80, detail: 0.5, name: 'low' },    // 远距离，低细节
      { distance: 120, detail: 0.3, name: 'very_low' } // 极远距离，最低细节
    ];
    
    // LOD模型缓存
    this.lodModels = new Map(); // 存储不同精度的模型
    
    // 对象池
    this.objectPools = {
      particles: [], // 粒子对象池
      placeholders: [] // 占位符对象池
    };
    this.poolSizes = {
      particles: 30, // 粒子池大小（减少）
      placeholders: 5 // 占位符池大小（减少）
    };
    
    // 材质和纹理缓存
    this.materialCache = new Map(); // 材质缓存
    this.textureCache = new Map(); // 纹理缓存
    
    // 模型缓存 - 存储已加载的模型，避免重复加载
    this.modelCache = new Map(); // 模型缓存，key为模型路径，value为模型对象和最后使用时间
    this.maxModelCacheSize = 50; // 保留足够缓存，避免模型被频繁淘汰后重新加载
    
    // 纹理压缩支持
    this.textureLoader = new THREE.TextureLoader();
    this.textureLoader.setCrossOrigin('');
    this.textureLoader.setPath('');
    
    // 预加载核心资源
    this.preloadedResources = new Map();
    this.preloadCoreResources();
    
    // 加载状态管理
    this.loadingStatus = {
      total: 0,
      loaded: 0,
      progress: 0,
      isLoading: false
    };

    // 大模型异步加载管理
    this.LARGE_MODEL_THRESHOLD = 15 * 1024 * 1024; // 15MB 以上算大模型
    this.maxConcurrentLargeModels = 2; // 同时最多加载2个大模型
    this.largeModelQueue = []; // 大模型等待队列
    this.activeLargeLoads = 0; // 当前正在加载的大模型数量
    this.largeModelStates = new Map(); // 大模型加载状态 { element: DOM元素, loaded: xxx, total: xxx }
    this._largeModelHideTimers = new Map(); // 大模型完成后隐藏计时器
    
    // 媒体加载进度跟踪（图片/视频独立面板）
    this._mediaProgressItems = new Map();      // 媒体进度项 {percent, timer}
    this._mediaHideTimers = new Map();         // 媒体完成隐藏计时器
    this._mediaSimIntervals = new Map();       // 媒体进度模拟间隔
    this._mediaSimPct = new Map();             // 媒体模拟进度计数器
    this._mediaRealProgress = new Map();       // 媒体真实进度
    
    // 性能监控
    this.performanceMonitor = {
      frameCount: 0,
      lastFrameTime: performance.now(),
      fps: 60,
      memory: {
        used: 0,
        total: 0
      },
      objects: {
        total: 0,
        visible: 0
      },
      lastReportTime: 0,
      reportInterval: 10000, // 10秒报告一次
      lastPanelUpdate: 0,
      panelUpdateInterval: 1000 // 1秒更新一次面板
    };
    
    // Web Worker
    this.worker = null;
    this.workerCallbacks = new Map();
    this.initWorker();

    // 优先级队列和消息队列（addToPriorityQueue / handleBatchData 依赖）
    this.priorityQueue = [];
    this.messageQueue = [];
    this.isProcessingQueue = false;
    
    // 加载控制
    this.isLoadingBuildings = false; // 防止重复加载建筑
    this._mediaLoadingStarted = false; // 媒体是否已开始加载（阶段式加载控制）
    this._pendingMediaObjects = []; // 待延迟加载的媒体对象

    // 模型缓存系统
    this.modelCacheDB = window.modelCacheDB;


    // Scene setup
    this.setupScene();
    this.setupLighting();
    this.setupTerrain();

    // Camera settings
    this.camera.position.set(0, 5, 10);
    this.camera.lookAt(0, 0, 0);

    // 预热着色器（防止首次移动卡顿）
    this.warmupShaders();

    // 初始化对象池
    this.initObjectPools();

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());

    // Animation loop
    this.animate();

    // 初始化广告位点击交互
    this.initAdSlotInteraction();
    
    // 初始化技能系统

    
    // 异步加载AI生成的建筑（不阻塞初始化）
    setTimeout(() => {
      this.loadGeneratedBuildings().catch(err => {
        console.error('加载生成建筑失败:', err);
      });
    }, 1000);
  }



  setupScene() {
    // Background - 默认晴天蓝天
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, CONFIG.DRAW_DISTANCE, 10000);

    // 天气系统初始化
    this._weather = 'clear'; // clear / rain / snow / fog
    this._weatherParticles = null;
    this._weatherClock = 0;
  }

  // ============ 天气系统 ============

  /**
   * 切换天气
   * @param {'clear'|'rain'|'snow'|'fog'|'storm'} type
   * @param {{intensity?:number, wind?:number}} opts  intensity 0-100, wind 0-100
   */
  setWeather(type, opts = {}) {
    const intensity = Math.min(100, Math.max(0, opts.intensity ?? 50)) / 100; // 0~1
    const wind      = Math.min(100, Math.max(0, opts.wind      ?? 20)) / 100;

    // 相同天气也可能要更新强度，所以不早退
    this._clearWeatherParticles();
    this._weather          = type;
    this._weatherIntensity = intensity;
    this._weatherWind      = wind;

    const SKY_COLORS = {
      clear: 0x87ceeb,
      rain:  0x4a5a6a,
      snow:  0xb0c4d8,
      fog:   0x9aafbf,
      storm: 0x2a3040
    };
    const FOG_COLORS = {
      clear: 0x87ceeb,
      rain:  0x3a4a58,
      snow:  0xc8d8e8,
      fog:   0x8fa8b8,
      storm: 0x20283a
    };

    this.scene.background = new THREE.Color(SKY_COLORS[type] ?? 0x87ceeb);

    if (type === 'fog') {
      // 强度影响雾密度
      this.scene.fog = new THREE.FogExp2(FOG_COLORS.fog, 0.008 + intensity * 0.025);
    } else if (type === 'storm') {
      this.scene.fog = new THREE.FogExp2(FOG_COLORS.storm, 0.012 + intensity * 0.015);
    } else {
      this.scene.fog = new THREE.Fog(
        FOG_COLORS[type] ?? FOG_COLORS.clear,
        CONFIG.DRAW_DISTANCE, 10000
      );
    }

    if (type === 'rain')  this._createRain(intensity, wind);
    if (type === 'snow')  this._createSnow(intensity, wind);
    if (type === 'storm') this._createRain(Math.min(1, intensity * 1.5), wind); // 暴雨

    console.log(`🌤️ 天气切换: ${type} 强度:${Math.round(intensity*100)}% 风力:${Math.round(wind*100)}%`);
  }

  _createRain(intensity = 0.5, wind = 0.2) {
    const COUNT = Math.round(500 + intensity * 2000); // 500~2500
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = Math.random() * 120;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9ab8d0,
      size: 0.12 + intensity * 0.1,
      transparent: true,
      opacity: 0.4 + intensity * 0.3,
      depthWrite: false,
      sizeAttenuation: true
    });
    this._weatherParticles = new THREE.Points(geo, mat);
    this._weatherParticles.userData.type = 'rain';
    this._weatherParticles.userData.wind = wind;
    this._weatherParticles.userData.intensity = intensity;
    this.scene.add(this._weatherParticles);
  }

  _createSnow(intensity = 0.5, wind = 0.2) {
    const COUNT = Math.round(300 + intensity * 1200); // 300~1500
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = Math.random() * 100;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.25 + intensity * 0.25,
      transparent: true,
      opacity: 0.7 + intensity * 0.2,
      depthWrite: false,
      sizeAttenuation: true
    });
    this._weatherParticles = new THREE.Points(geo, mat);
    this._weatherParticles.userData.type = 'snow';
    this._weatherParticles.userData.wind = wind;
    this._weatherParticles.userData.intensity = intensity;
    this.scene.add(this._weatherParticles);
  }

  _updateWeatherParticles(delta) {
    if (!this._weatherParticles) return;
    const pos = this._weatherParticles.geometry.attributes.position;
    const arr = pos.array;
    const count = arr.length / 3;
    const type = this._weatherParticles.userData.type;
    const wind = this._weatherParticles.userData.wind ?? 0.2;
    const intensity = this._weatherParticles.userData.intensity ?? 0.5;

    if (type === 'rain') {
      const speed = 0.4 + intensity * 0.5;
      const windX = wind * 0.15;
      for (let i = 0; i < count; i++) {
        arr[i * 3]     += windX;
        arr[i * 3 + 1] -= speed;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 120;
          arr[i * 3]     = (Math.random() - 0.5) * 200;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 200;
        }
      }
    } else if (type === 'snow') {
      this._weatherClock += delta * 0.001;
      const speed = 0.06 + intensity * 0.1;
      const windX = wind * 0.06;
      for (let i = 0; i < count; i++) {
        arr[i * 3 + 1] -= speed;
        arr[i * 3]     += windX + Math.sin(this._weatherClock + i * 0.5) * 0.025;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 100;
          arr[i * 3]     = (Math.random() - 0.5) * 200;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 200;
        }
      }
    }
    pos.needsUpdate = true;
  }

  _clearWeatherParticles() {
    if (this._weatherParticles) {
      this.scene.remove(this._weatherParticles);
      this._weatherParticles.geometry.dispose();
      this._weatherParticles.material.dispose();
      this._weatherParticles = null;
    }
  }

  setupLighting() {
    // 适中的环境光（无阴影模式）
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // 方向光（不投射阴影）
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight.position.set(100, 100, 50);
    dirLight.castShadow = false; // 完全禁用阴影
    this.scene.add(dirLight);

    // 半球光（补充光照）
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x545454, 0.2);
    this.scene.add(hemiLight);
    
    console.log('💡 光照系统: 无阴影高性能模式');

  }

  setupTerrain() {
    // Ground plane（使用最简材质，但保持颜色）
    const groundGeometry = new THREE.PlaneGeometry(CONFIG.WORLD_SIZE * 2, CONFIG.WORLD_SIZE * 2);
    const groundMaterial = new THREE.MeshBasicMaterial({
      color: 0x2d5016,
      fog: !CONFIG.DISABLE_FOG
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = false;
    ground.castShadow = false;
    ground.matrixAutoUpdate = false;
    ground.updateMatrix();
    this.scene.add(ground);
    
    console.log('🌍 地形初始化: 基础材质，无阴影');

    this.addDefaultEnvironment();
  }

  addGridHelper() {
    const gridHelper = new THREE.GridHelper(CONFIG.WORLD_SIZE * 2, 40, 0x444444, 0x222222);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);
  }

  warmupShaders() {
    console.log('🔥 预热着色器...');
    
    // 强制渲染3帧来编译所有着色器
    for (let i = 0; i < 3; i++) {
      this.renderer.render(this.scene, this.camera);
    }
    
    // 编译场景中所有材质的着色器
    this.renderer.compile(this.scene, this.camera);
    
    console.log('✅ 着色器预热完成');
  }

  /**
   * 将模型安全添加到场景，并延迟编译新着色器
   * 解决：动态加载的模型在渲染循环中触发懒着色器编译导致的卡顿
   * @param {THREE.Object3D} obj - 要添加到场景的对象
   */
  _addModelToScene(obj) {
    // 【修复】SkinnedMesh 去蒙皮：带骨骼动画的模型（如 LittlestTokyo 街道场景）加载后，
    // 骨骼矩阵与顶点不匹配会把顶点渲染到远离 pivot 的位置（产生幻影石头），
    // 且 setFromObject 计算包围盒会包含远处骨骼导致视锥剔除闪烁。
    // 世界对象不使用骨骼动画，统一烘焙为静态网格（顶点固定在 bind pose 位置）。
    this._bakeSkinsToStatic(obj);
    this.scene.add(obj);
    // 记录入场景时刻：合批模块据此给"刚加载完"的模型一段视距裁剪宽限，
    // 避免占位符可见、真模型一替换上来就被裁掉的观感突变
    if (!obj.userData) obj.userData = {};
    obj.userData.__addedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // 批量延迟编译：同一帧内的多次add合并为一次compile
    if (!this._pendingShaderCompile) {
      this._pendingShaderCompile = true;
      requestAnimationFrame(() => {
        try {
          this.renderer.compile(this.scene, this.camera);
        } catch (e) {
          // compile 在某些WebGL上下文状态下可能失败，静默处理
        }
        this._pendingShaderCompile = false;
      });
    }
  }

  /**
   * 将模型树中的 SkinnedMesh 烘焙为静态网格（移除蒙皮与骨骼）
   * - 顶点固定在 bind pose 位置，不再被骨骼矩阵"甩"到远处
   * - 移除骨骼节点，setFromObject 包围盒不再包含远处骨骼（消除视锥剔除闪烁）
   * @param {THREE.Object3D} obj
   */
  _bakeSkinsToStatic(obj) {
    const bones = [];
    obj.traverse((node) => {
      if (node.isBone) {
        bones.push(node);
      } else if (node.isSkinnedMesh) {
        node.skeleton = null;
        node.isSkinnedMesh = false;
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (let i = 0; i < mats.length; i++) {
          if (mats[i]) mats[i].skinning = false;
        }
        if (node.geometry) {
          node.geometry.computeBoundingBox();
          node.geometry.computeBoundingSphere();
        }
      }
    });
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      if (bone.parent) bone.parent.remove(bone);
    }
  }

  /**
   * 初始化对象池
   */
  initObjectPools() {
    console.log('🔧 初始化对象池...');
    
    // 清空现有对象池
    this.objectPools.particles = [];
    this.objectPools.placeholders = [];
    
    // 初始化粒子对象池
    for (let i = 0; i < this.poolSizes.particles; i++) {
      const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      const material = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
      const particle = new THREE.Mesh(geometry, material);
      particle.visible = false;
      this.objectPools.particles.push(particle);
    }
    
    // 初始化占位符对象池
    for (let i = 0; i < this.poolSizes.placeholders; i++) {
      const geometry = new THREE.BoxGeometry(5, 6, 5);
      const material = new THREE.MeshStandardMaterial({
        color: 0x667eea,
        emissive: 0x333366,
        transparent: true,
        opacity: 0.7
      });
      const placeholder = new THREE.Mesh(geometry, material);
      placeholder.visible = false;
      this.objectPools.placeholders.push(placeholder);
    }
    
    console.log(`✅ 对象池初始化完成: 粒子池(${this.objectPools.particles.length}), 占位符池(${this.objectPools.placeholders.length})`);
  }

  /**
   * 从对象池获取对象
   */
  getFromPool(poolName) {
    const pool = this.objectPools[poolName];
    if (!pool || pool.length === 0) {
      return null;
    }
    
    const object = pool.pop();
    object.visible = true;
    // 【修复】清除旧的 userData，防止对象池复用时残留数据（如 worldObjectId）导致误匹配
    object.userData = {};
    return object;
  }

  /**
   * 回收对象到对象池
   */
  recycleToPool(poolName, object) {
    const pool = this.objectPools[poolName];
    if (!pool) return;
    
    // 确保对象池不超过最大大小
    if (pool.length < this.poolSizes[poolName]) {
      object.visible = false;
      // 【修复】从场景中彻底移除，而非仅移到视野外，防止对象池中对象残留在场景图中
      if (object.parent) {
        object.parent.remove(object);
      }
      pool.push(object);
    } else {
      // 如果对象池已满，销毁对象
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
    }
  }

  /**
   * 从缓存获取材质
   */
  getMaterialFromCache(key) {
    return this.materialCache.get(key);
  }

  /**
   * 缓存材质
   */
  cacheMaterial(key, material) {
    this.materialCache.set(key, material);
  }

  /**
   * 从缓存获取纹理
   */
  getTextureFromCache(key) {
    return this.textureCache.get(key);
  }

  /**
   * 缓存纹理
   */
  cacheTexture(key, texture) {
    this.textureCache.set(key, texture);
  }

  /**
   * 清理材质和纹理缓存
   */
  clearMaterialCache() {
    this.materialCache.forEach(material => {
      if (material) material.dispose();
    });
    this.materialCache.clear();
    
    this.textureCache.forEach(texture => {
      if (texture) texture.dispose();
    });
    this.textureCache.clear();
    
    console.log('🧹 材质和纹理缓存已清理');
  }
  
  /**
   * 预加载核心资源
   */
  preloadCoreResources() {
    console.log('🔄 开始预加载核心资源...');
    
    // 预加载常用材质
    const defaultMaterials = {
      defaultBuilding: new THREE.MeshLambertMaterial({ color: 0x8b7355 }),
      defaultGround: new THREE.MeshBasicMaterial({ color: 0x2d5016 }),
      defaultPlayer: new THREE.MeshLambertMaterial({ color: 0x4a90e2 }),
      defaultMonster: new THREE.MeshLambertMaterial({ color: 0xff0000 })
    };
    
    // 缓存预加载的材质
    Object.entries(defaultMaterials).forEach(([key, material]) => {
      this.cacheMaterial(key, material);
    });
    
    // 预加载常用纹理（如果有）
    // 这里可以添加纹理预加载逻辑
    
    console.log('✅ 核心资源预加载完成');
  }
  
  /**
   * 优化模型加载
   */
  optimizeModelLoading(modelPath) {
    // 检查文件类型并返回优化建议
    const extension = modelPath.split('.').pop().toLowerCase();
    
    if (extension === 'obj' || extension === 'fbx') {
      console.warn(`⚠️ 检测到非优化模型格式: ${extension}，建议转换为glb/gltf格式`);
      // 这里可以添加自动转换逻辑
    } else if (extension === 'glb' || extension === 'gltf') {
      console.log(`✅ 检测到优化模型格式: ${extension}`);
    }
    
    return modelPath;
  }
  
  /**
   * 优化纹理加载
   */
  optimizeTextureLoading(texturePath) {
    // 检查纹理格式并返回优化建议
    const extension = texturePath.split('.').pop().toLowerCase();
    
    if (['jpg', 'png'].includes(extension)) {
      console.warn(`⚠️ 检测到未压缩纹理: ${extension}，建议使用basis universal格式`);
      // 这里可以添加纹理压缩逻辑
    } else if (extension === 'basis') {
      console.log(`✅ 检测到压缩纹理: ${extension}`);
    }
    
    return texturePath;
  }
  
  /**
   * 优化材质
   */
  optimizeMaterial(mesh) {
    const mat = mesh.material;
    if (!mat) return;

    // 不替换材质类型，避免丢失贴图通道
    // 对所有贴图通道做纹理参数优化
    const textureMaps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'envMap'];
    textureMaps.forEach(mapKey => {
      if (mat[mapKey]) {
        this.optimizeTexture(mat[mapKey]);
      }
    });

    // 启用材质缓存
    const materialKey = `material_${mat.uuid}`;
    if (!this.materialCache.has(materialKey)) {
      this.cacheMaterial(materialKey, mat);
    }
  }
  
  /**
   * 优化纹理
   */
  optimizeTexture(texture) {
    // 设置纹理参数以提高性能
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    
    // 启用纹理缓存
    const textureKey = `texture_${texture.uuid}`;
    if (!this.textureCache.has(textureKey)) {
      this.cacheTexture(textureKey, texture);
    }
  }
  
  /**
   * 合并几何体（减少Draw Call）
   */
  mergeGeometries(objects) {
    if (objects.length <= 1) return objects;
    
    // 创建一个组来容纳所有对象
    const mergedGroup = new THREE.Group();
    
    objects.forEach(obj => {
      obj.traverse(child => {
        if (child.isMesh) {
          // 优化每个网格的材质
          this.optimizeMaterial(child);
          // 将网格添加到合并组
          mergedGroup.add(child.clone());
        }
      });
    });
    
    console.log(`✅ 合并了 ${objects.length} 个对象到一个组中`);
    
    return [mergedGroup];
  }

  /**
   * 初始化Web Worker
   */
  initWorker() {
    try {
      this.worker = new Worker('js/loadWorker.js');
      
      this.worker.addEventListener('message', (e) => {
        const { type, data, messageId } = e.data;
        
        // 调用回调函数
        if (messageId) {
          this.handleWorkerCallback(messageId, data);
        }
        
        switch (type) {
          case 'modelLoaded':
            this.handleModelLoaded(data);
            break;
          case 'worldObjectsProcessed':
            this.handleWorldObjectsProcessed(data);
            break;
          case 'distancesCalculated':
            this.handleDistancesCalculated(data);
            break;
          default:
            console.log('Unknown worker message type:', type);
        }
      });
      
      this.worker.addEventListener('error', (error) => {
        console.error('Worker error:', error);
      });
      
      console.log('✅ Web Worker 初始化成功');
    } catch (error) {
      console.error('❌ Web Worker 初始化失败:', error);
      // 如果Worker初始化失败，继续使用主线程处理
    }
  }

  /**
   * 向Worker发送消息
   */
  sendToWorker(type, data, callback) {
    if (!this.worker) {
      // 如果Worker不可用，直接在主线程处理
      this.handleWorkerFallback(type, data, callback);
      return;
    }
    
    const messageId = Date.now().toString();
    this.workerCallbacks.set(messageId, callback);
    
    this.worker.postMessage({ type, data, messageId });
  }

  /**
   * 处理Worker回调
   */
  handleWorkerCallback(messageId, data) {
    const callback = this.workerCallbacks.get(messageId);
    if (callback) {
      callback(data);
      this.workerCallbacks.delete(messageId);
    }
  }

  /**
   * 处理模型加载完成
   */
  handleModelLoaded(data) {
    console.log('Worker: Model loaded:', data);
  }

  /**
   * 处理世界对象处理完成
   */
  handleWorldObjectsProcessed(data) {
    console.log('Worker: World objects processed:', data.length);
    // 这里不再设置this.allWorldObjects，因为已经在sendToWorker的回调函数中完成了
    // 这个方法现在只是用于记录日志
    console.log(`✅ 世界对象处理完成，共 ${data.length} 个对象`);
  }

  /**
   * 处理距离计算完成
   */
  handleDistancesCalculated(data) {
    console.log('Worker: Distances calculated for', data.length, 'objects');
    // 这里可以使用计算好的距离数据
  }

  /**
   * Worker不可用时的回退处理
   */
  handleWorkerFallback(type, data, callback) {
    console.log('Worker fallback for:', type);
    // 在主线程中模拟Worker的处理
    setTimeout(() => {
      if (callback) {
        if (type === 'processWorldObjects') {
          // 直接返回原始数据
          callback(data);
        } else {
          callback({ status: 'success' });
        }
      }
    }, 50);
  }

  /**
   * 初始化WebSocket连接
   * 注意：WebSocket连接由main.js中的WSClient管理，这里不再重复创建
   */
  initWebSocket() {
    console.log('WebSocket连接由WSClient管理，跳过重复初始化');
  }

  /**
   * 处理WebSocket消息
   */
  handleWebSocketMessage(message) {
    const { type, data } = message;
    
    switch (type) {
      case 'worldObjects':
        this.handleWorldObjects(data);
        break;
      case 'objectUpdate':
        this.handleObjectUpdate(data);
        break;
      case 'batchData':
        this.handleBatchData(data);
        break;
      default:
        console.log('Unknown WebSocket message type:', type);
    }
  }

  /**
   * 处理世界对象数据
   */
  handleWorldObjects(data) {
    console.log('WebSocket: 收到世界对象数据:', data.length);
    // 去重后添加到优先级队列
    const uniqueObjects = [];
    const objectIds = new Set();
    
    data.forEach(obj => {
      if (!objectIds.has(obj.id)) {
        objectIds.add(obj.id);
        uniqueObjects.push(obj);
      }
    });
    
    console.log('WebSocket: 去重后对象数量:', uniqueObjects.length);
    
    // 存入 allWorldObjects（避免重复）
    uniqueObjects.forEach(obj => {
      if (!this.allWorldObjects.find(o => o.id === obj.id)) {
        this.allWorldObjects.push(obj);
      }
    });
    
    // 初始化加载状态
    this.updateLoadingStatus(0, uniqueObjects.length);
    this.showLoadingProgress();
    
    // 将对象添加到优先级队列
    this.addToPriorityQueue(uniqueObjects);
  }

  /**
   * 处理对象更新
   */
  handleObjectUpdate(data) {
    console.log('WebSocket: 收到对象更新:', data.id);
    // 直接处理对象更新
    this.updateObject(data);
  }

  /**
   * 处理批量数据
   */
  handleBatchData(data) {
    console.log('WebSocket: 收到批量数据:', data.length);
    // 将批量数据添加到消息队列
    this.messageQueue.push(...data);
    if (!this.isProcessingQueue) {
      this.processMessageQueue();
    }
  }

  /**
   * 添加到优先级队列
   */
  addToPriorityQueue(objects) {
    // 计算每个对象的优先级（基于距离）
    const player = window.player;
    if (player) {
      const playerPosition = player.position;
      
      objects.forEach(obj => {
        const objectPosition = {
          x: obj.position_x || 0,
          y: obj.position_y || 0,
          z: obj.position_z || 0
        };
        
        const distance = Math.sqrt(
          Math.pow(playerPosition.x - objectPosition.x, 2) +
          Math.pow(playerPosition.z - objectPosition.z, 2)
        );
        
        // 距离越近，优先级越高
        const priority = 1 / (distance + 1);
        
        this.priorityQueue.push({
          object: obj,
          priority
        });
      });
      
      // 按优先级排序
      this.priorityQueue.sort((a, b) => b.priority - a.priority);
      
      // 处理优先级队列
      this.processPriorityQueue();
    }
  }

  /**
   * 处理优先级队列
   */
  processPriorityQueue() {
    // 🔧 不再直接加载对象，改为转移到主加载队列，由 processLoadingQueue 统一串行处理（batchSize=1）
    while (this.priorityQueue.length > 0) {
      const item = this.priorityQueue.shift();
      const obj = item.object;
      // 过滤已加载、已在队列、已在加载批次中的对象
      if (!this.loadedObjects.has(obj.id) && 
          !this.loadingQueue.some(q => q.id === obj.id) &&
          !this.loadingBatch.some(b => b.id === obj.id)) {
        this.loadingQueue.push(obj);
      }
    }
    
    // 更新加载进度
    const total = this.loadingStatus.total;
    if (total > 0) {
      const loaded = Math.min(this.loadedObjects.size, total);
      this.updateLoadingStatus(loaded, total);
      this.showLoadingProgress();
    }
  }

  /**
   * 处理消息队列
   */
  processMessageQueue() {
    this.isProcessingQueue = true;
    
    // 限制每帧处理的消息数量
    const maxMessagesPerFrame = 10;
    let processed = 0;
    
    while (this.messageQueue.length > 0 && processed < maxMessagesPerFrame) {
      const message = this.messageQueue.shift();
      this.processMessage(message);
      processed++;
    }
    
    // 如果还有消息，下一帧继续处理
    if (this.messageQueue.length > 0) {
      requestAnimationFrame(() => this.processMessageQueue());
    } else {
      this.isProcessingQueue = false;
    }
  }

  /**
   * 处理单个消息
   */
  processMessage(message) {
    // 根据消息类型处理
    switch (message.type) {
      case 'objectAdd':
        this.addObject(message.data);
        break;
      case 'objectRemove':
        this.removeObject(message.data);
        break;
      case 'objectUpdate':
        this.updateObject(message.data);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  /**
   * 加载对象
   */
  loadObject(obj) {
    // 根据对象类型加载
    if (obj.loadMethod) {
      // 防止重复加载
      if (this.loadedObjects.has(obj.id)) return;
      this.loadedObjects.add(obj.id);
      this[obj.loadMethod](obj);
    }
  }

  /**
   * 添加对象
   */
  addObject(obj) {
    // 检查对象是否已存在
    const existingIndex = this.allWorldObjects.findIndex(o => o.id === obj.id);
    if (existingIndex === -1) {
      // 添加对象到世界
      this.allWorldObjects.push(obj);
      console.log(`✅ 添加新对象: ${obj.id} (${obj.name})`);
    } else {
      // 更新现有对象
      this.allWorldObjects[existingIndex] = { ...this.allWorldObjects[existingIndex], ...obj };
      console.log(`🔄 更新现有对象: ${obj.id} (${obj.name})`);
    }
  }

  /**
   * 移除对象
   */
  removeObject(objId) {
    // 从世界中移除对象
    this.allWorldObjects = this.allWorldObjects.filter(obj => obj.id !== objId);
  }

  /**
   * 更新对象
   */
  updateObject(obj) {
    // 更新对象信息
    const index = this.allWorldObjects.findIndex(o => o.id === obj.id);
    if (index !== -1) {
      this.allWorldObjects[index] = { ...this.allWorldObjects[index], ...obj };
    }
  }

  /**
   * 更新帧率历史
   */
  updateFpsHistory() {
    // 添加当前帧率到历史
    this.fpsHistory.push(this.performanceMonitor.fps);
    
    // 保持历史大小
    if (this.fpsHistory.length > this.fpsHistorySize) {
      this.fpsHistory.shift();
    }
  }

  /**
   * 计算平均帧率
   */
  getAverageFps() {
    if (this.fpsHistory.length === 0) return 60;
    
    const sum = this.fpsHistory.reduce((acc, fps) => acc + fps, 0);
    return sum / this.fpsHistory.length;
  }

  /**
   * 根据帧率调整加载策略
   */
  adjustLoadStrategy() {
    const averageFps = this.getAverageFps();
    
    if (averageFps >= this.fpsThresholds.high) {
      // 高帧率，使用激进的加载策略
      this.loadDistance = this.baseLoadDistance * 1.2;
      this.batchSize = Math.min(this.baseBatchSize + 2, 5);
      this.loadInterval = this.baseLoadInterval * 0.8;
    } else if (averageFps >= this.fpsThresholds.medium) {
      // 中帧率，使用默认加载策略
      this.loadDistance = this.baseLoadDistance;
      this.batchSize = this.baseBatchSize;
      this.loadInterval = this.baseLoadInterval;
    } else if (averageFps >= this.fpsThresholds.low) {
      // 低帧率，使用保守的加载策略
      this.loadDistance = this.baseLoadDistance * 0.8;
      this.batchSize = Math.max(this.baseBatchSize - 1, 1);
      this.loadInterval = this.baseLoadInterval * 1.2;
    } else {
      // 极低帧率，使用最保守的加载策略
      this.loadDistance = this.baseLoadDistance * 0.6;
      this.batchSize = 1;
      this.loadInterval = this.baseLoadInterval * 1.5;
    }
  }

  /**
   * 更新加载状态
   */
  updateLoadingStatus(loaded, total) {
    this.loadingStatus.loaded = loaded;
    this.loadingStatus.total = total;
    this.loadingStatus.progress = total > 0 ? (loaded / total) * 100 : 0;
    this.loadingStatus.isLoading = loaded < total;
    
    // 触发加载状态更新事件（简化版）
    if (window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('worldLoadingUpdate', {
        detail: this.loadingStatus
      }));
    }
    
    console.log(`📊 加载进度: ${loaded}/${total} (${this.loadingStatus.progress.toFixed(1)}%)`);
  }

  /**
   * 显示加载进度条
   */
  showLoadingProgress() {
    // 创建加载进度条容器
    if (!document.getElementById('loading-progress-container')) {
      const container = document.createElement('div');
      container.id = 'loading-progress-container';
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '4px';
      container.style.backgroundColor = '#f0f0f0';
      container.style.zIndex = '1000';
      container.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
      document.body.appendChild(container);
      
      // 创建进度条
      const progressBar = document.createElement('div');
      progressBar.id = 'loading-progress-bar';
      progressBar.style.height = '100%';
      progressBar.style.backgroundColor = '#4CAF50';
      progressBar.style.width = '0%';
      progressBar.style.transition = 'width 0.3s ease';
      container.appendChild(progressBar);
      
      // 创建加载文本
      const loadingText = document.createElement('div');
      loadingText.id = 'loading-progress-text';
      loadingText.style.position = 'fixed';
      loadingText.style.top = '10px';
      loadingText.style.left = '50%';
      loadingText.style.transform = 'translateX(-50%)';
      loadingText.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
      loadingText.style.color = 'white';
      loadingText.style.padding = '5px 15px';
      loadingText.style.borderRadius = '15px';
      loadingText.style.zIndex = '1001';
      loadingText.style.fontFamily = 'Arial, sans-serif';
      loadingText.style.fontSize = '12px';
      document.body.appendChild(loadingText);
    }
    
    // 更新进度条
    const progressBar = document.getElementById('loading-progress-bar');
    const loadingText = document.getElementById('loading-progress-text');
    const progress = this.loadingStatus.progress;
    
    progressBar.style.width = `${progress}%`;
    loadingText.textContent = `加载中... ${progress.toFixed(1)}%`;
    
    // 如果加载完成，隐藏加载元素
    if (!this.loadingStatus.isLoading) {
      setTimeout(() => {
        const container = document.getElementById('loading-progress-container');
        const text = document.getElementById('loading-progress-text');
        if (container) container.style.display = 'none';
        if (text) text.style.display = 'none';
      }, 1000);
    } else {
      const container = document.getElementById('loading-progress-container');
      const text = document.getElementById('loading-progress-text');
      if (container) container.style.display = 'block';
      if (text) text.style.display = 'block';
    }
  }

  /**
   * 更新性能监控数据
   */
  updatePerformanceMonitor() {
    const now = performance.now();
    
    // 计算FPS（直接复用 animate() 统计的 currentFPS，不重复计数）
    if (now - this.performanceMonitor.lastFrameTime >= 1000) {
      this.performanceMonitor.fps = this.currentFPS;
      this.performanceMonitor.lastFrameTime = now;
    }
    
    // 每5秒更新一次内存（避免频繁访问 performance.memory 触发GC）
    if (now - (this.performanceMonitor.lastMemoryUpdate || 0) >= 5000) {
      // 检查内存使用（try-catch 防止某些浏览器不支持）
      try {
        if (performance.memory) {
          this.performanceMonitor.memory = {
            used: performance.memory.usedJSHeapSize,
            total: performance.memory.totalJSHeapSize
          };
        }
      } catch (e) { /* 静默忽略 */ }
      
      // 统计对象数量
      this.performanceMonitor.objects = {
        total: this.allWorldObjects.length,
        visible: this.loadedObjects.size
      };
      
      this.performanceMonitor.lastMemoryUpdate = now;
    }
    
    // 定期报告性能数据
    if (now - this.performanceMonitor.lastReportTime >= this.performanceMonitor.reportInterval) {
      this.reportPerformance();
      this.performanceMonitor.lastReportTime = now;
    }
  }

  /**
   * 报告性能数据
   */
  reportPerformance() {
    const memoryUsedMB = (this.performanceMonitor.memory.used / 1024 / 1024).toFixed(2);
    const memoryTotalMB = (this.performanceMonitor.memory.total / 1024 / 1024).toFixed(2);
    
    console.log('📊 性能报告:');
    console.log(`  FPS: ${this.performanceMonitor.fps}`);
    console.log(`  内存使用: ${memoryUsedMB}MB / ${memoryTotalMB}MB`);
    console.log(`  对象数量: ${this.performanceMonitor.objects.visible}/${this.performanceMonitor.objects.total}`);
    
    // 生成优化建议
    this.generateOptimizationSuggestions();
  }

  /**
   * 生成优化建议
   */
  generateOptimizationSuggestions() {
    const suggestions = [];
    
    // 根据FPS生成建议
    if (this.performanceMonitor.fps < 30) {
      suggestions.push('⚠️ FPS过低，建议降低场景复杂度或调整LOD设置');
    }
    
    // 根据内存使用生成建议
    const memoryUsedMB = this.performanceMonitor.memory.used / 1024 / 1024;
    if (memoryUsedMB > 500) {
      suggestions.push('⚠️ 内存使用过高，建议清理材质和纹理缓存');
    }
    
    // 根据对象数量生成建议
    if (this.performanceMonitor.objects.visible > 50) {
      suggestions.push('⚠️ 可见对象过多，建议调整加载距离');
    }
    
    // 显示建议
    if (suggestions.length > 0) {
      console.log('💡 优化建议:');
      suggestions.forEach(suggestion => {
        console.log(`  ${suggestion}`);
      });
    }
  }

  /**
   * 序列化模型为可存储格式
   * @param {THREE.Object3D} model - 模型对象
   * @param {string} modelPath - 模型路径
   * @returns {Promise<ArrayBuffer>} 序列化后的模型数据
   */
  async serializeModel(model, modelPath) {
    // 对于GLTF/GLB模型，我们直接存储原始文件
    // 这里简化处理，实际项目中可能需要更复杂的序列化逻辑
    return null;
  }

  /**
   * 从缓存数据重建模型
   * @param {ArrayBuffer} data - 模型数据
   * @param {string} modelPath - 模型路径
   * @returns {Promise<THREE.Object3D>} 重建的模型对象
   */
  async reconstructModelFromCache(data, modelPath) {
    return new Promise((resolve, reject) => {
      const extension = modelPath.split('.').pop().toLowerCase();
      
      if (extension === 'glb' || extension === 'gltf') {
        // 使用GLTFLoader加载缓存数据
        const loader = new THREE.GLTFLoader();
        loader.setDRACOLoader(this.dracoLoader);
        if (this.meshoptDecoder) loader.setMeshoptDecoder(this.meshoptDecoder);
        const blob = new Blob([data], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        
        loader.load(url, (gltf) => {
          URL.revokeObjectURL(url);
          resolve(gltf.scene);
        }, undefined, (error) => {
          URL.revokeObjectURL(url);
          console.error('Failed to load model from cache:', error);
          resolve(null);
        });
      } else if (extension === 'obj') {
        // OBJ模型处理
        const loader = new THREE.OBJLoader();
        const text = new TextDecoder().decode(data);
        
        try {
          const model = loader.parse(text);
          resolve(model);
        } catch (error) {
          console.error('Failed to parse OBJ model from cache:', error);
          resolve(null);
        }
      } else {
        console.warn('Unsupported model format:', extension);
        resolve(null);
      }
    });
  }

  /**
   * 初始化模型缓存系统
   */
  async initModelCache() {
    try {
      await this.modelCacheDB.init();
      console.log('✅ 模型缓存系统初始化成功');
      
      // 清理过期缓存
      await this.cleanupModelCache();
    } catch (error) {
      console.warn('Failed to initialize model cache:', error);
    }
  }

  /**
   * 清理模型缓存
   */
  async cleanupModelCache() {
    try {
      await this.modelCacheDB.cleanupCache();
      console.log('✅ 模型缓存清理完成');
    } catch (error) {
      console.warn('Failed to cleanup model cache:', error);
    }
  }

  /**
   * 获取模型缓存状态
   */
  async getModelCacheStatus() {
    try {
      const stats = await this.modelCacheDB.getCacheStats();
      console.log('📊 模型缓存状态:', stats);
      return stats;
    } catch (error) {
      console.warn('Failed to get cache status:', error);
      return null;
    }
  }

  /**
   * 显示性能监控面板
   */
  showPerformancePanel() {
    const now = performance.now();

    // 限制面板更新频率
    if (now - this.performanceMonitor.lastPanelUpdate < this.performanceMonitor.panelUpdateInterval) {
      return;
    }

    // 创建性能监控面板
    let panel = document.getElementById('performance-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'performance-panel';
      panel.style.position = 'fixed';
      panel.style.bottom = '20px';
      panel.style.right = '20px';
      panel.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
      panel.style.color = 'white';
      panel.style.padding = '10px';
      panel.style.borderRadius = '5px';
      panel.style.zIndex = '1000';
      panel.style.fontFamily = 'Arial, sans-serif';
      panel.style.fontSize = '12px';
      panel.style.width = '200px';
      panel.style.height = '120px';
      document.body.appendChild(panel);

      // 应用UI控件管理器的配置
      if (window.uiControlManager && window.uiControlManager.initialized) {
        window.uiControlManager.applyControl('performance_monitor', panel);
      }
    }

    const memoryUsedMB = (this.performanceMonitor.memory.used / 1024 / 1024).toFixed(2);
    const memoryTotalMB = (this.performanceMonitor.memory.total / 1024 / 1024).toFixed(2);

    panel.innerHTML = `
      <strong>性能监控</strong><br>
      FPS: ${this.performanceMonitor.fps}<br>
      内存: ${memoryUsedMB}MB / ${memoryTotalMB}MB<br>
      对象: ${this.performanceMonitor.objects.visible}/${this.performanceMonitor.objects.total}<br>
    `;

    this.performanceMonitor.lastPanelUpdate = now;
  }

  addDefaultEnvironment() {
    // 默认环境对象已移除，保持场景干净
    // 您可以通过世界编辑器添加需要的对象
    
    // 初始化默认出生点配置（同步）
    this.spawnConfig = { position: {x:0, y:0.05, z:0} };
    
    // 异步加载真实的出生点位置
    this.loadAndAddSpawnPoint();
  }

  async loadAndAddSpawnPoint() {
    // 【关键】立即创建出生点网格+碰撞体（同步），防止API加载期间玩家穿透
    if (!this.spawnPoint) {
      this._createSpawnPointMesh();
    }

    // 从后端加载真实出生点位置（异步更新）
    try {
      const apiBase = CONFIG.API_BASE || (window.location.origin + '/api');
      const response = await fetch(`${apiBase}/world/spawn-point`);
      const data = await response.json();
      if (data.success && data.spawnPoint && data.spawnPoint.position) {
        const position = data.spawnPoint.position;
        if (position.x !== null && position.y !== null && position.z !== null) {
          const oldSpawnConfig = this.spawnConfig;
          this.spawnConfig = data.spawnPoint;
          console.log('✅ 已加载保存的出生点位置:', this.spawnConfig);
        
        // 更新已存在的出生点网格位置
        if (this.spawnPoint) {
          this.spawnPoint.position.set(
            this.spawnConfig.position.x,
            this.spawnConfig.position.y,
            this.spawnConfig.position.z
          );
          // 同步更新碰撞体位置
          const collider = this.collisionObjects.find(c => c._isSpawnCollider);
          if (collider) {
            collider.position.copy(this.spawnPoint.position);
          }
        }
        
        // 如果玩家还在默认出生点，更新玩家位置
        if (window.player && oldSpawnConfig) {
          const isAtDefaultSpawn = 
            Math.abs(window.player.position.x - oldSpawnConfig.position.x) < 0.1 &&
            Math.abs(window.player.position.z - oldSpawnConfig.position.z) < 0.1;
          
          if (isAtDefaultSpawn) {
            const newPos = this.getSpawnPosition();
            window.player.position.set(newPos.x, newPos.y, newPos.z);
            console.log('🎮 已更新玩家到真实出生点位置:', newPos);
          }
        }
        }
      }
    } catch (error) {
      console.warn('⚠️ 加载出生点配置失败，使用默认位置:', error);
    }
  }

  _createSpawnPointMesh() {
    const spawnGeometry = new THREE.CylinderGeometry(2, 2, 0.1, 32);
    const spawnMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x00aa00,
    });
    const spawn = new THREE.Mesh(spawnGeometry, spawnMaterial);
    spawn.position.set(
      this.spawnConfig.position.x,
      this.spawnConfig.position.y,
      this.spawnConfig.position.z
    );
    spawn.castShadow = true;
    spawn.receiveShadow = true;

    spawn.userData.isSpawnPoint = true;
    spawn.userData.objectId = 'spawn_point';

    this.scene.add(spawn);
    this.spawnPoint = spawn;

    // 注册出生点碰撞体，防止玩家穿透掉落
    this.collisionObjects.push({
      _isSpawnCollider: true,
      type: 'box',
      position: spawn.position.clone(),
      size: { width: 4, height: 0.1, depth: 4 }
    });
    console.log('✅ 已为出生点注册碰撞体');
  }
  
  // 获取出生点位置（供Player使用）
  getSpawnPosition() {
    if (this.spawnConfig && this.spawnConfig.position) {
      return {
        x: this.spawnConfig.position.x,
        y: this.spawnConfig.position.y + 2, // 玩家高度
        z: this.spawnConfig.position.z
      };
    }
    return { x: 0, y: 2, z: 0 }; // 默认位置
  }

  addStaircase() {
    // 楼梯已移除
    // 如需楼梯，请在世界编辑器中使用几何体模板创建
  }

  // Check collision and return the height the player should be at
  getGroundHeight(position) {
    let maxHeight = 0; // Ground level

    // Check collision with all objects
    for (const obj of this.collisionObjects) {
      // 🎯 通用方案：兼容所有类型和所有尺寸格式
      if (!obj.position || !obj.size) continue;

      // 统一读取尺寸（兼容 width/height/depth 和 x/y/z 两种格式）
      const width = obj.size.width ?? obj.size.x ?? 0;
      const height = obj.size.height ?? obj.size.y ?? 0;
      const depth = obj.size.depth ?? obj.size.z ?? 0;

      if (width === 0 || height === 0 || depth === 0) continue;

      const halfWidth = width / 2;
      const halfDepth = depth / 2;

      // Check if player is within the horizontal bounds of this object
      if (
        position.x >= obj.position.x - halfWidth &&
        position.x <= obj.position.x + halfWidth &&
        position.z >= obj.position.z - halfDepth &&
        position.z <= obj.position.z + halfDepth
      ) {
        // ✅ 优先使用 Box3 的精确边界（解决空隙问题）
        let topHeight;
        if (obj.boundingBox) {
          topHeight = obj.boundingBox.max.y;  // 直接取包围盒的最大Y值（精确顶部高度）
        } else {
          // 兼容旧格式：position.y + 半高度
          topHeight = obj.position.y + (height / 2);
        }
        
        if (topHeight > maxHeight && position.y >= topHeight - 1) {
          maxHeight = topHeight;
        }
      }
    }

    return maxHeight;
  }

  removePlayer(characterId) {
    const playerData = this.players.get(characterId);
    if (playerData && playerData.group) {
      // 清理骨骼物理实例
      if (playerData.group.userData && playerData.group.userData.bonePhysics) {
        try { playerData.group.userData.bonePhysics.dispose(); } catch (e) {}
        playerData.group.userData.bonePhysics = null;
      }
      this.scene.remove(playerData.group);
      this.players.delete(characterId);
      console.log(`[World] 已移除玩家 ${characterId}`);
    }
  }

  addPlayer(characterId, characterName, position = { x: 0, y: 0, z: 0 }, isLoggedIn = true, glbUrl = null, weaponConfig = null, boneMapConfig = null, weaponSocketConfig = null, calibrationConfig = null) {
    this.removePlayer(characterId);
    
    // Player character body
    const characterGroup = new THREE.Group();

    // Body (torso)
    const bodyGeometry = new THREE.BoxGeometry(0.6, 1.2, 0.3);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a90e2 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.3;
    body.castShadow = true;
    body.receiveShadow = true;
    characterGroup.add(body);

    // Head (低多边形球体 - 8面)
    // 未登录用户显示灰色，已登录用户显示正常肤色
    const headGeometry = new THREE.SphereGeometry(0.4, 8, 8);
    const headColor = isLoggedIn ? 0xffaa99 : 0x888888; // 灰色表示游客
    const headMaterial = new THREE.MeshStandardMaterial({ color: headColor });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.2;
    head.castShadow = true;
    head.receiveShadow = true;
    characterGroup.add(head);

    // 左臂 (上臂+肘关节+前臂)
    const upperArmGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6);
    const forearmGeometry = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6);
    const armMaterial = new THREE.MeshStandardMaterial({ color: 0xffaa99 });
    
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.38, 0.8, 0); // 肩膀位置
    
    // 左上臂
    const leftUpperArm = new THREE.Mesh(upperArmGeometry, armMaterial);
    leftUpperArm.position.y = -0.25; // 上臂中心
    leftUpperArm.castShadow = true;
    leftArmGroup.add(leftUpperArm);
    
    // 左肘关节
    const leftElbowGroup = new THREE.Group();
    leftElbowGroup.position.set(0, -0.5, 0); // 肘部位置
    
    // 左前臂
    const leftForearm = new THREE.Mesh(forearmGeometry, armMaterial);
    leftForearm.position.y = -0.25; // 前臂中心
    leftForearm.castShadow = true;
    leftElbowGroup.add(leftForearm);
    
    leftArmGroup.add(leftElbowGroup);
    characterGroup.add(leftArmGroup);

    // 右臂 (上臂+肘关节+前臂)
    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.38, 0.8, 0); // 肩膀位置
    
    // 右上臂
    const rightUpperArm = new THREE.Mesh(upperArmGeometry, armMaterial);
    rightUpperArm.position.y = -0.25;
    rightUpperArm.castShadow = true;
    rightArmGroup.add(rightUpperArm);
    
    // 右肘关节
    const rightElbowGroup = new THREE.Group();
    rightElbowGroup.position.set(0, -0.5, 0); // 肘部位置
    
    // 右前臂
    const rightForearm = new THREE.Mesh(forearmGeometry, armMaterial);
    rightForearm.position.y = -0.25;
    rightForearm.castShadow = true;
    rightElbowGroup.add(rightForearm);
    
    rightArmGroup.add(rightElbowGroup);
    characterGroup.add(rightArmGroup);

    // 左腿 (大腿+膝关节+小腿)
    const thighGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 6);
    const calfGeometry = new THREE.CylinderGeometry(0.09, 0.09, 0.6, 6);
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
    
    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.18, -0.3, 0); // 大腿根位置
    
    // 左大腿
    const leftThigh = new THREE.Mesh(thighGeometry, legMaterial);
    leftThigh.position.y = -0.3;
    leftThigh.castShadow = true;
    leftLegGroup.add(leftThigh);
    
    // 左膝关节
    const leftKneeGroup = new THREE.Group();
    leftKneeGroup.position.set(0, -0.6, 0); // 膝盖位置
    
    // 左小腿
    const leftCalf = new THREE.Mesh(calfGeometry, legMaterial);
    leftCalf.position.y = -0.3;
    leftCalf.castShadow = true;
    leftKneeGroup.add(leftCalf);
    
    leftLegGroup.add(leftKneeGroup);
    characterGroup.add(leftLegGroup);

    // 右腿 (大腿+膝关节+小腿)
    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.18, -0.3, 0); // 大腿根位置
    
    // 右大腿
    const rightThigh = new THREE.Mesh(thighGeometry, legMaterial);
    rightThigh.position.y = -0.3;
    rightThigh.castShadow = true;
    rightLegGroup.add(rightThigh);
    
    // 右膝关节
    const rightKneeGroup = new THREE.Group();
    rightKneeGroup.position.set(0, -0.6, 0); // 膝盖位置
    
    // 右小腿
    const rightCalf = new THREE.Mesh(calfGeometry, legMaterial);
    rightCalf.position.y = -0.3;
    rightCalf.castShadow = true;
    rightKneeGroup.add(rightCalf);
    
    rightLegGroup.add(rightKneeGroup);
    characterGroup.add(rightLegGroup);
    
    // 右手武器：仅当 weaponConfig 有效（非 null 且为对象）时才创建
    const hasWeapon = (typeof weaponConfig === 'object' && weaponConfig !== null);
    const _wCfg = hasWeapon ? weaponConfig : {};
    let laserSwordGroup = null;
    let blade = null, glow = null, swordLight = null;
    let swordParticles = null;

    if (hasWeapon) {
      const _bladeColor  = _wCfg.blade_color  ? parseInt(_wCfg.blade_color.replace('#',''), 16) : 0x00ffff;
      const _glowInt     = _wCfg.glow_intensity  ?? 0.8;
      const _bladeLen    = _wCfg.blade_length    ?? 0.8;
      const _hiltColor   = _wCfg.hilt_color   ? parseInt(_wCfg.hilt_color.replace('#',''), 16) : 0x111111;
      const _lightInt    = _wCfg.point_light_intensity ?? 1.5;
      const _particleType= _wCfg.particle_type || 'none';
      const _weaponGlbUrl = _wCfg.glb_url || null;

      laserSwordGroup = new THREE.Group();
      laserSwordGroup.position.set(0, -0.3, 0.1);
      laserSwordGroup.rotation.x = 0;
      laserSwordGroup.rotation.z = 0;

      if (_weaponGlbUrl) {
        // GLB 武器：异步加载后挂到 laserSwordGroup
        const _weaponLoader = new THREE.GLTFLoader();
        _weaponLoader.setDRACOLoader(this.dracoLoader);
        _weaponLoader.load(
          _weaponGlbUrl,
          (gltf) => {
            const wModel = gltf.scene;
            const wSize = _wCfg.size || 1.0;
            wModel.scale.set(wSize, wSize, wSize);
            laserSwordGroup.add(wModel);
            console.log(`⚔️ [weapon] GLB武器已加载: ${_weaponGlbUrl}`);
          },
          undefined,
          (err) => {
            console.warn(`⚔️ [weapon] GLB武器加载失败，降级内置激光剑: ${err.message}`);
            _buildBuiltinLaserSword();
          }
        );
      } else {
        _buildBuiltinLaserSword();
      }

      // 内置激光剑构建函数（可被 GLB 加载失败降级调用）
      function _buildBuiltinLaserSword() {
        // 剑柄
        const hiltGeometry = new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8);
        const hiltMaterial = new THREE.MeshStandardMaterial({ 
          color: _hiltColor,
          metalness: 0.9,
          roughness: 0.1
        });
        const hilt = new THREE.Mesh(hiltGeometry, hiltMaterial);
        hilt.rotation.x = Math.PI / 2;
        hilt.position.z = 0.1;
        hilt.castShadow = true;
        laserSwordGroup.add(hilt);
        
        // 剑刃（激光效果）
        const bladeGeometry = new THREE.CylinderGeometry(0.02, 0.02, _bladeLen, 8);
        const bladeMaterial = new THREE.MeshStandardMaterial({ 
          color: _bladeColor,
          emissive: _bladeColor,
          emissiveIntensity: _glowInt,
          transparent: true,
          opacity: 0.9
        });
        blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
        blade.rotation.x = Math.PI / 2;
        blade.position.z = -(0.1 + _bladeLen / 2);
        blade.castShadow = true;
        laserSwordGroup.add(blade);
        
        // 发光外晕
        const glowGeometry = new THREE.CylinderGeometry(0.04, 0.04, _bladeLen, 8);
        const glowMaterial = new THREE.MeshBasicMaterial({ 
          color: _bladeColor,
          transparent: true,
          opacity: 0.3
        });
        glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.rotation.x = Math.PI / 2;
        glow.position.z = -(0.1 + _bladeLen / 2);
        laserSwordGroup.add(glow);

        // 点光源（照亮周围环境）
        swordLight = new THREE.PointLight(_bladeColor, _lightInt, 3);
        swordLight.position.z = -(0.1 + _bladeLen / 2);
        laserSwordGroup.add(swordLight);
        // 更新 userData 引用（降级时可能已赋过 null）
        characterGroup.userData.swordBlade  = blade;
        characterGroup.userData.swordGlow   = glow;
        characterGroup.userData.swordLight  = swordLight;
      }
      
      // 将光剑添加到右前臂上（而不是角色组）
      rightElbowGroup.add(laserSwordGroup);

      // 常态粒子特效（内置激光剑才有粒子）
      if (!_weaponGlbUrl && _particleType !== 'none') {
        swordParticles = this._createSwordParticles(_particleType, _bladeLen);
        if (swordParticles) {
          swordParticles.position.z = -(0.15 + _bladeLen / 2);
          laserSwordGroup.add(swordParticles);
        }
      }
    }

    // Name label（使用评估高度，模型加载后会重新校准）
    const estimatedHeight = parseFloat(localStorage.getItem('selectedTemplateHeight') || '1.8');
    const nameSprite = this.createNameSprite(characterName, estimatedHeight);
    characterGroup.add(nameSprite);
    characterGroup.userData.nameSprite = nameSprite;

    characterGroup.position.set(position.x, position.y, position.z);
    this.scene.add(characterGroup);

    // 存储动画时间和四肢Group引用（用于旋转）
    characterGroup.userData.animTime = 0;
    characterGroup.userData.leftArm = leftArmGroup;
    characterGroup.userData.rightArm = rightArmGroup;
    characterGroup.userData.leftLeg = leftLegGroup;
    characterGroup.userData.rightLeg = rightLegGroup;
    characterGroup.userData.leftElbow = leftElbowGroup;
    characterGroup.userData.rightElbow = rightElbowGroup;
    characterGroup.userData.leftKnee = leftKneeGroup;
    characterGroup.userData.rightKnee = rightKneeGroup;
    characterGroup.userData.laserSword = laserSwordGroup;   // 无武器时为 null
    characterGroup.userData.weaponGroup = laserSwordGroup;  // 无武器时为 null
    characterGroup.userData.swordBlade = blade;     // 无武器时为 null
    characterGroup.userData.swordGlow  = glow;      // 无武器时为 null
    characterGroup.userData.swordLight = swordLight; // 无武器时为 null
    characterGroup.userData.swordParticles = swordParticles; // 无武器时为 null
    characterGroup.userData.weaponConfig = hasWeapon ? _wCfg : null;  // 无武器时存 null，便于后续判断
    characterGroup.userData.isAttacking = false; // 攻击状态

    this.players.set(characterId, {
      group: characterGroup,
      name: characterName,
      nameSprite: nameSprite, // Store reference to update later
      position,
      health: 100,
      isFlying: false,
    });

    // 如果有远端骨骼/武器配置，提前写入 userData（必须在 _loadPlayerGlb 之前，避免 GLB 缓存时回调先于写入）
    if (boneMapConfig && Object.keys(boneMapConfig).length > 0) {
      characterGroup.userData._remoteBoneMapConfig = boneMapConfig;
    }
    if (weaponSocketConfig && Object.keys(weaponSocketConfig).length > 0) {
      characterGroup.userData._remoteWeaponSocketConfig = weaponSocketConfig;
    }
    if (calibrationConfig && Object.keys(calibrationConfig).length > 0) {
      characterGroup.userData._remoteCalibrationConfig = calibrationConfig;
    }

    // 如果有 GLB 模板，异步加载替换方块人
    if (glbUrl) {
      this._loadPlayerGlb(characterId, characterGroup, nameSprite, glbUrl);
    }

    return characterGroup;
  }

  // 获取角色校准参数
  async _getCharacterCalibration(characterId) {
    try {
      // 首先尝试从character数据中获取校准参数
      const characterData = await API.getCharacter(characterId);
      if (characterData && characterData.character && characterData.character.calibration) {
        console.log(`✅ [Calibration] 从角色数据中获取校准参数:`, characterData.character.calibration);
        return characterData.character.calibration;
      }
      
      // 如果角色数据中没有，尝试从专门的校准API获取
      try {
        const calibrationData = await API.get(`/character-templates/${characterId}/calibration`);
        console.log(`✅ [Calibration] 从校准API获取参数:`, calibrationData);
        return calibrationData;
      } catch (e) {
        console.warn(`⚠️ [Calibration] 校准API调用失败:`, e.message);
        return null;
      }
    } catch (e) {
      console.warn(`⚠️ [Calibration] 获取校准参数失败:`, e.message);
      return null;
    }
  }

  // 加载 GLB 替换玩家方块人
  _loadPlayerGlb(characterId, characterGroup, nameSprite, glbUrl) {
    // 验证 glbUrl 是否有效（防御字符串 "null"：localStorage.setItem(key, null) 会存入 "null"）
    if (!glbUrl || typeof glbUrl !== 'string' || glbUrl.trim() === '' || glbUrl === 'null') {
      console.warn(`[World] 跳过加载玩家 ${characterId} 的 GLB: URL 无效`, glbUrl);
      return;
    }

    const apiBase = CONFIG.API_BASE || (window.location.origin + '/api');
    const url = glbUrl.startsWith('http') ? glbUrl : (apiBase.replace('/api', '') + glbUrl);

    // 再次验证最终 URL
    try {
      new URL(url);
    } catch (e) {
      console.warn(`[World] 跳过加载玩家 ${characterId} 的 GLB: 无效 URL ${url}`);
      return;
    }

    // 如果正在加载相同的URL，跳过重复加载
    if (characterGroup.userData._loadingGlbUrl === url) {
      console.log(`[World] 跳过重复加载玩家 ${characterId} 的 GLB（相同URL正在加载中）`);
      return;
    }
    characterGroup.userData._loadingGlbUrl = url;

    console.log(`[World] 开始加载玩家 ${characterId} 的 GLB: ${url}`);

    // 只有加载自己的模型时才从 localStorage 读取骨骼映射/武器插槽/校准参数。
    // 加载其他玩家模型时优先使用通过 WS 传来的远端配置（_remoteBoneMapConfig/_remoteWeaponSocketConfig），
    // 避免把自己的校准数据错误地应用到别人身上。
    const isSelf = (typeof GAME_STATE !== 'undefined' && characterId === GAME_STATE.characterId);
    let boneMap = {};
    let weaponSocketConfig = {};
    let calibrationData = null;
    if (isSelf) {
      try {
        const bmRaw = localStorage.getItem('selectedTemplateBoneMap');
        if (bmRaw) boneMap = JSON.parse(bmRaw);
      } catch(e) { console.warn('[World] 解析 boneMap 失败', e); }
      try {
        const wsRaw = localStorage.getItem('selectedTemplateWeaponSocket');
        if (wsRaw) weaponSocketConfig = JSON.parse(wsRaw);
      } catch(e) { console.warn('[World] 解析 weaponSocketConfig 失败', e); }
      try {
        const calRaw = localStorage.getItem('selectedTemplateCalibration');
        if (calRaw) {
          const parsed = JSON.parse(calRaw);
          if (parsed && Object.keys(parsed).length > 0) {
            calibrationData = parsed;
            console.log(`[Calibration] 从localStorage读取校准参数:`, calibrationData);
          }
        }
      } catch(e) { console.warn('[World] 解析 calibrationData 失败', e); }

      // 如果localStorage没有校准数据，尝试异步从服务器获取（不阻塞模型加载）
      if (!calibrationData) {
        const templateId = localStorage.getItem('selectedTemplateId');
        if (templateId) {
          this._getCharacterCalibration(templateId).then(data => {
            if (data) {
              characterGroup.userData._pendingCalibration = data;
              console.log(`[Calibration] 服务器校准参数已备用（模型已加载，将在下次fitModel时应用）`);
            }
          }).catch(() => {});
        }
      }
    }
    // 非自己的玩家：读取通过 WS 传来的远端骨骼/武器/校准配置
    if (!isSelf) {
      if (characterGroup.userData._remoteBoneMapConfig) {
        boneMap = characterGroup.userData._remoteBoneMapConfig;
      }
      if (characterGroup.userData._remoteWeaponSocketConfig) {
        weaponSocketConfig = characterGroup.userData._remoteWeaponSocketConfig;
      }
      if (characterGroup.userData._remoteCalibrationConfig) {
        calibrationData = characterGroup.userData._remoteCalibrationConfig;
      }
    }

    // 每次新建独立的 GLTFLoader 实例，绕过共享 loader 的内部 URL 缓存。
    // 原因：THREE.GLTFLoader 单例对相同 URL 会复用同一个 gltf.scene 对象；
    // 当第二个玩家加载同一 GLB 时，add 到自己的 group 会导致 Three.js 把该对象
    // 从第一个玩家的 group 中移走（Object3D 只能有一个 parent），造成"模型被抢走"。
    // 使用独立实例后，每次加载都产生独立的 gltf.scene，各玩家互不影响。
    const _charLoader = new THREE.GLTFLoader();
    _charLoader.setDRACOLoader(this.dracoLoader);
    _charLoader.load(
      url,
      (gltf) => {
        // 加载完成，清除进行中标记
        if (characterGroup.userData._loadingGlbUrl === url) {
          delete characterGroup.userData._loadingGlbUrl;
        }
        // 移除方块人（保留 nameSprite 和 weaponGroup）
        // 先把武器从树中移出，防止被一起删除
        const savedWeaponGroup = characterGroup.userData.weaponGroup || null;
        if (savedWeaponGroup && savedWeaponGroup.parent) {
          savedWeaponGroup.parent.remove(savedWeaponGroup);
        }
        const toRemove = [];
        characterGroup.traverse(child => {
          if (child !== nameSprite && child !== characterGroup) toRemove.push(child);
        });
        toRemove.forEach(c => characterGroup.remove(c));

        // 独立 loader 每次返回全新的 gltf.scene，无需 clone，材质贴图完整保留
        const model = gltf.scene;
        model.position.set(0,0,0);
        model.rotation.set(0,0,0);
        model.scale.set(1,1,1);

        // 加入场景，静态站立（不播动画）
        characterGroup.add(model);

        // ===== 远程模型守卫：加载后复杂度验证 =====
        // 仅对外部跨域模型做复杂度守卫；同源模型（本服务器 UGC 模板）放行
        const _isSameOrigin = (function() {
          try {
            return (new URL(url, window.location.origin)).origin === window.location.origin;
          } catch(e) { return false; }
        })();
        const _relaxMg = window.SelfContainedChar && window.SelfContainedChar.shouldRelaxModelGuard(characterGroup);
        if (!isSelf && window.RemoteModelGuard && !_isSameOrigin && !_relaxMg) {
          try {
            const _mgCheck = window.RemoteModelGuard.validateLoadedModel(model, { characterId, characterGroup, isSelf });
            if (!_mgCheck.safe) {
              console.warn('[World] ⛔ 玩家 ' + characterId + ' 模型复杂度过高: ' + _mgCheck.reason + '，降级为占位符');
              window.RemoteModelGuard.createPlaceholder(characterGroup);
              // 后续 setup（动画/武器/fitModel）继续执行，占位符兼容
            }
          } catch (_mgErr) {
            console.warn('[World] 模型守卫验证异常:', _mgErr.message);
          }
        }

        // 停止并清除旧的动画 mixers（防止旧 model 的动画继续更新）
        if (characterGroup.userData.animMixers) {
          Object.values(characterGroup.userData.animMixers).forEach(m => m && m.stopAllAction());
        }
        if (characterGroup.userData.glbMixer) {
          characterGroup.userData.glbMixer.stopAllAction();
        }
        // 🔧 关键修复：销毁旧的 sharedMixer，防止它绑定到旧模型
        // （切换模板不刷新网页时，sharedMixer 还会指向已移除的旧模型，导致动画不播放）
        if (characterGroup.userData.sharedMixer) {
          console.log('[GLB] 销毁旧的 sharedMixer（防止绑定到旧模型）');
          characterGroup.userData.sharedMixer.stopAllAction();
          characterGroup.userData.sharedMixer = null;
        }
        characterGroup.userData.glbModel = model;
        characterGroup.userData.glbMixer = null;
        characterGroup.userData.walkMixer = null;
        characterGroup.userData.runMixer = null;
        characterGroup.userData.walkAction = null;
        characterGroup.userData.runAction = null;
        characterGroup.userData.animMixers = {};
        characterGroup.userData.animActions = {};
        characterGroup.userData.currentAnimMode = 'idle';
        characterGroup.userData.boneMap = boneMap; // 使用从localStorage读取的骨骼映射

        // ===== 🆕 骨骼平台适配：自动应用平台配置 =====
        // 自包含角色包模式：跳过平台适配，使用源骨骼命名原样播放
        const _skipAdapter = window.SelfContainedChar && window.SelfContainedChar.shouldPlayAsSelfContained(characterGroup);
        if (typeof window.applyBonePlatformAdapter === 'function' && !_skipAdapter) {
          const adapterResult = window.applyBonePlatformAdapter(model, characterGroup, { isSelf: isSelf });
          if (adapterResult && adapterResult.boneMap) {
            // 增强/覆盖 boneMap（平台配置为基础，用户配置优先）
            characterGroup.userData.boneMap = { ...adapterResult.boneMap, ...boneMap };
            console.log('[World] 骨骼平台适配结果:', adapterResult);
          }
          if (adapterResult && adapterResult.calibrationData) {
            // 标记需要应用的平台校准参数
            characterGroup.userData._platformCalibration = adapterResult.calibrationData;
            console.log('[World] 平台校准参数已备用:', adapterResult.calibrationData);
          }
        } else if (_skipAdapter) {
          console.log('[World] 自包含角色包：跳过骨骼平台适配');
        }
        // ===== end 骨骼平台适配 =====

        // 如有内置动画，建立mixer但不播放
        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          characterGroup.userData.glbMixer = mixer;
          if (!this._glbMixers) this._glbMixers = [];
          this._glbMixers.push(mixer);
        }

        // 用独立临时容器 + 逐mesh包围盒 + 单位自动修正
        const fitModel = () => {
          // 【修复】畸形双骨骼链：GLTFLoader 会给重复骨骼名自动加 _N 去重后缀，
          // 若某个 SkinnedMesh 的 skin.joints 指向了副本链，动画轨道（原始名、无后缀）
          // 就永远驱动不到它，身体会停在 bind pose，表现为「手臂扭曲/变形」。
          // 副本骨骼是主骨骼的同名子节点且本地变换为单位矩阵（世界矩阵与主骨骼一致），
          // 因此可安全地把 SkinnedMesh 换绑回主链，inverseBindMatrices 无需重算。
          if (window.DuplicateBoneChainFixer && typeof window.DuplicateBoneChainFixer.fix === 'function') {
            try {
              const _chainFix = window.DuplicateBoneChainFixer.fix(model);
              if (_chainFix && _chainFix.fixed) {
                console.log(`🔗 [BoneChainFix] 已修复畸形双骨骼链：${_chainFix.fixedMeshes} 个 mesh / ${_chainFix.changedBones} 根骨骼换绑到主链（副本骨骼 ${_chainFix.dupBones} 根）`);
              }
            } catch (e) {
              console.warn('[BoneChainFix] 修复异常，已忽略:', e);
            }
          }
          const savedParent = model.parent;
          const tempRoot = new THREE.Object3D();
          tempRoot.add(model);
          model.position.set(0, 0, 0);
          model.rotation.set(0, 0, 0);
          model.scale.set(1, 1, 1);
          model.traverse(c => { c.updateMatrix(); c.updateMatrixWorld(true); });

          // 计算包围盒（区分 SkinnedMesh 和普通 Mesh）
          // 关键修复：SkinnedMesh 用顶点本身（不应用 matrixWorld）算包围盒
          // 原因：SkinnedMesh 渲染时 boneInverse 会抵消 bone.matrixWorld 中的 Armature.scale，
          // 所以渲染时顶点不会被 Armature.scale 缩放。若用 matrixWorld 算包围盒，
          // 会把 Armature.scale(常见为 9) 误算进 maxDim，导致 scale 被错误缩小 N 倍。
          const box = new THREE.Box3();
          const _tmpV = new THREE.Vector3();
          model.traverse(c => {
            if (c.isMesh && c.geometry) {
              if (c.isSkinnedMesh) {
                // SkinnedMesh：用顶点本身（不应用 matrixWorld）
                const pos = c.geometry.attributes.position;
                if (pos) {
                  for (let i = 0; i < pos.count; i++) {
                    _tmpV.fromBufferAttribute(pos, i);
                    box.expandByPoint(_tmpV);
                  }
                }
              } else {
                // 普通 Mesh：用 matrixWorld（保持原逻辑）
                c.geometry.computeBoundingBox();
                const mb = c.geometry.boundingBox.clone();
                mb.applyMatrix4(c.matrixWorld);
                box.union(mb);
              }
            }
          });
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);

          // 缩放到目标高度（Three.js单位是米，无需单位修正）
          const targetH = parseFloat(localStorage.getItem('selectedTemplateHeight') || '1.8');
          const scale = (maxDim > 0.001 ? targetH / maxDim : 1);
          console.log(`✅ [GLB] 玩家${characterId} 原始尺寸=${maxDim.toFixed(4)}米 目标高度=${targetH}米 缩放=${scale.toFixed(4)}`);

          // 先计算基础偏移（基于未缩放的模型，同样区分 SkinnedMesh）
          const nb = new THREE.Box3();
          model.traverse(c => {
            if (c.isMesh && c.geometry) {
              if (c.isSkinnedMesh) {
                const pos = c.geometry.attributes.position;
                if (pos) {
                  for (let i = 0; i < pos.count; i++) {
                    _tmpV.fromBufferAttribute(pos, i);
                    nb.expandByPoint(_tmpV);
                  }
                }
              } else {
                c.geometry.computeBoundingBox();
                const mb = c.geometry.boundingBox.clone();
                mb.applyMatrix4(c.matrixWorld);
                nb.union(mb);
              }
            }
          });
          let offsetX = -((nb.min.x + nb.max.x) / 2);
          let offsetY = -nb.min.y; // 默认包围盒贴地
          let offsetZ = -((nb.min.z + nb.max.z) / 2);

          // 应用校准参数（calibrationData 里的值是模型原始空间的偏移，不带 scale，
          // 后面统一乘 scale，所以这里直接覆盖未缩放的 offset 即可）
          if (calibrationData) {
            console.log(`🎯 [Calibration] 应用校准参数:`, calibrationData);

            // 中心点校准：直接覆盖 offsetX/Z（单位与模型一致，后面统一乘 scale）
            if (calibrationData.centerPoint) {
              offsetX = -calibrationData.centerPoint.x;
              offsetZ = -calibrationData.centerPoint.z;
              console.log(`📏 [Calibration] 中心点校准（未缩放）: (${offsetX.toFixed(4)}, ${offsetZ.toFixed(4)})`);
            }

            // 地面高度校准：groundHeight 是模型最低点到世界0的距离，offsetY = -groundHeight 贴地
            if (calibrationData.groundHeight !== undefined) {
              offsetY = -calibrationData.groundHeight;
              console.log(`📏 [Calibration] 地面高度校准（未缩放）: ${offsetY.toFixed(4)}`);
            }
          }

          // 应用模型缩放
          model.scale.setScalar(scale);
          model.traverse(c => { c.updateMatrix(); c.updateMatrixWorld(true); });

          // 统一缩放偏移值以匹配模型缩放
          offsetX *= scale;
          offsetY *= scale;
          offsetZ *= scale;
          console.log(`📏 [GLB] 应用缩放后的偏移: (${offsetX.toFixed(4)}, ${offsetY.toFixed(4)}, ${offsetZ.toFixed(4)})`);

          if (savedParent) savedParent.add(model);
          else characterGroup.add(model);
          model.position.set(offsetX, offsetY, offsetZ);
          model.traverse(child => {
            if (child.isMesh) {
              child.castShadow = true;
              // 【修复】SkinnedMesh 关闭视锥剔除：动画/骨骼物理每帧驱动顶点，
              // 而 geometry.boundingSphere 是 bind pose 静态计算的，剔除判定与实际渲染位置脱节，
              // 导致他人视角下衣服/眼睛/头随视角/距离变化被误剔除（逐件消失）。
              if (child.isSkinnedMesh) child.frustumCulled = false;
            }
          });

          // 记录 GLB 模型的贴地偏移量，供 player.js 修正 playerHeight
          // GLB 模型原点已通过 offsetY 贴地，characterGroup.position.y 应为 0（地面）
          characterGroup.userData.isGlbLoaded = true;
          characterGroup.userData.glbGroundOffset = offsetY; // 模型内部偏移，已含 scale
          const actualHeight = size.y * scale; // 模型实际高度（排除宽度/深度影响）
          characterGroup.userData.modelHeight = actualHeight;
          console.log(`✅ [GLB] 模型贴地完成，glbGroundOffset=${offsetY.toFixed(4)}，实际高度=${actualHeight.toFixed(2)}米，playerHeight 将自动校正为 0`);

          // 按模型实际高度重新校准昵称 sprite 位置（头顶上方 0.15 单位）
          if (characterGroup.userData.nameSprite) {
            characterGroup.userData.nameSprite.position.y = actualHeight + 0.15;
            console.log(`📛 [GLB] 昵称高度校准: ${(actualHeight + 0.15).toFixed(2)}（实际高度=${actualHeight.toFixed(2)}米）`);
          }

          // ── 武器挂载：若有 rightHand 映射，把武器 Group 挂到对应骨骼 ──
          // 兼容两种数据来源：
          //   1. boneMap.rightHand —— 来自"骨骼绑定"Tab 保存的 selectedTemplateBoneMap
          //   2. weaponSocketConfig.rightHand.boneName —— 来自"武器插槽"Tab 保存的 selectedTemplateWeaponSocket
          const rightHandBoneName = boneMap.rightHand || (weaponSocketConfig.rightHand && weaponSocketConfig.rightHand.boneName) || null;
          if (rightHandBoneName && characterGroup.userData.weaponGroup) {
            let rightHandBone = null;
            model.traverse(n => {
              if (n.isBone && n.name === rightHandBoneName) rightHandBone = n;
              else if (n.isMesh && n.skeleton && n.skeleton.bones) {
                const bone = n.skeleton.bones.find(b => b.name === rightHandBoneName);
                if (bone) rightHandBone = bone;
              }
            });
            if (rightHandBone) {
              const wg = characterGroup.userData.weaponGroup;
              // 先重置位置/旋转（原值是 rightElbowGroup 坐标系下的，挂到骨骼后无效）
              wg.position.set(0, 0, 0);
              wg.rotation.set(0, 0, 0);
              rightHandBone.add(wg);
              
              // 应用武器插槽调整（支持角色编辑器中的配置结构）
              if (weaponSocketConfig.rightHand) {
                // 武器位置调整
                if (weaponSocketConfig.rightHand.position) {
                  wg.position.set(
                    weaponSocketConfig.rightHand.position.x,
                    weaponSocketConfig.rightHand.position.y,
                    weaponSocketConfig.rightHand.position.z
                  );
                  console.log(`🎯 [GLB] 应用武器插槽位置调整: (${weaponSocketConfig.rightHand.position.x.toFixed(2)}, ${weaponSocketConfig.rightHand.position.y.toFixed(2)}, ${weaponSocketConfig.rightHand.position.z.toFixed(2)})`);
                }
                
                // 武器旋转调整
                if (weaponSocketConfig.rightHand.rotation) {
                  wg.rotation.set(
                    weaponSocketConfig.rightHand.rotation.x * Math.PI / 180,
                    weaponSocketConfig.rightHand.rotation.y * Math.PI / 180,
                    weaponSocketConfig.rightHand.rotation.z * Math.PI / 180
                  );
                  console.log(`🎯 [GLB] 应用武器插槽旋转调整: (${weaponSocketConfig.rightHand.rotation.x.toFixed(1)}°, ${weaponSocketConfig.rightHand.rotation.y.toFixed(1)}°, ${weaponSocketConfig.rightHand.rotation.z.toFixed(1)}°)`);
                }
              }
              
              console.log(`⚔️ [GLB] 武器已挂载到右手骨骼「${rightHandBoneName}」`);
            }
          } else if (savedWeaponGroup) {
            // 没有骨骼绑定（如其他玩家），把武器挂回 characterGroup，确保不丢失
            characterGroup.add(savedWeaponGroup);
            savedWeaponGroup.position.set(0.38, 0.8, 0.1); // 右手侧大概位置
            console.log(`⚔️ [GLB] 无骨骼绑定，武器挂回 characterGroup`);
          }

          // ── GLB 加载完成后重新应用武器颜色（覆盖方块人时期的默认颜色）──
          const _wCfgFinal = characterGroup.userData.weaponConfig || {};
          if (characterGroup.userData.swordBlade && _wCfgFinal.blade_color) {
            const _fc = parseInt(_wCfgFinal.blade_color.replace('#',''), 16);
            const _fg = _wCfgFinal.glow_intensity ?? 0.8;
            characterGroup.userData.swordBlade.material.color.setHex(_fc);
            characterGroup.userData.swordBlade.material.emissive.setHex(_fc);
            characterGroup.userData.swordBlade.material.emissiveIntensity = _fg;
            if (characterGroup.userData.swordGlow)  characterGroup.userData.swordGlow.material.color.setHex(_fc);
            if (characterGroup.userData.swordLight) {
              characterGroup.userData.swordLight.color.setHex(_fc);
              characterGroup.userData.swordLight.intensity = _wCfgFinal.point_light_intensity ?? 1.5;
            }
            console.log(`⚔️ [GLB] 武器颜色应用: ${_wCfgFinal.blade_color}`);
          }
          // ── GLB 加载完成后补建粒子特效（addPlayer 时 weaponConfig 为空未创建）──
          const _ptFinal = _wCfgFinal.particle_type || 'none';
          const _blFinal = _wCfgFinal.blade_length ?? 0.8;
          const _laserSword = characterGroup.userData.laserSword;
          if (_ptFinal !== 'none' && _laserSword && !characterGroup.userData.swordParticles) {
            const newParticles = this._createSwordParticles(_ptFinal, _blFinal);
            if (newParticles) {
              newParticles.position.z = -(0.15 + _blFinal / 2);
              _laserSword.add(newParticles);
              characterGroup.userData.swordParticles = newParticles;
              console.log(`✨ [GLB] 武器粒子特效已补建: ${_ptFinal}`);
            }
          }

          // ── 摄像机绑定：若有 camera 映射，用于视角跟随 ──
          const cameraBoneName = boneMap.camera;
          if (cameraBoneName) {
            let cameraBone = null;
            model.traverse(n => {
              if (n.isBone && n.name === cameraBoneName) cameraBone = n;
              else if (n.isMesh && n.skeleton && n.skeleton.bones) {
                const bone = n.skeleton.bones.find(b => b.name === cameraBoneName);
                if (bone) cameraBone = bone;
              }
            });
            if (cameraBone) {
              characterGroup.userData.cameraBone = cameraBone;
              console.log(`📷 [GLB] 摄像机已绑定到骨骼「${cameraBoneName}」`);
            }
          }

          // ── 骨骼物理：Dynamic Bone 风格，头发/尾巴/裙子/胸部等跟随移动飘动 ──
          try {
            if (typeof window.initBonePhysics === 'function' && model) {
              // 参数统一走 public/js/bonePhysicsConfig.js，可在控制台用 window.BonePhysicsTuning 实时热调
              const bp = window.initBonePhysics(model);
              if (bp) {
                characterGroup.userData.bonePhysics = bp;
                console.log('[BonePhysics] ✅ 已为模型启用骨骼物理（头发/尾巴/裙子等将跟随移动飘动）');
              }
            }
          } catch (e) {
            console.warn('[BonePhysics] 初始化异常:', e);
          }
        };
        requestAnimationFrame(fitModel);
        
        // 触发模型加载完成事件
        if (window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('modelLoaded', {
            detail: {
              characterId: characterId,
              model: model,
              characterGroup: characterGroup
            }
          }));
        }

        // 若有等待中的动画 URL（网络慢时模型比动画重试超时还晚加载），立即补加载
        const pending = characterGroup.userData._pendingAnimUrls;
        if (pending) {
          delete characterGroup.userData._pendingAnimUrls;
          Object.entries(pending).forEach(([type, url]) => {
            if (url && url.trim() !== '' && url !== 'null') {
              this._loadPlayerAnimGlb(characterId, type, url);
            }
          });
          console.log(`[GLB] 模型就绪，触发待加载动画: ${Object.keys(pending).join('/')}`);
        }
      },
      undefined,
      (err) => {
        console.warn(`⚠️ [GLB] 玩家模型加载失败 (${url}):`, err);
      }
    );
  }

  // 加载独立动画GLB（walk/run/jump/attack1/hit/death）并绑定到角色骨骼
  _loadPlayerAnimGlb(characterId, type, animUrl, _retryCount = 0) {
    // 🆕 调试日志
    console.log(`[AnimGLB] 🔍 _loadPlayerAnimGlb 被调用: characterId=${characterId}, type=${type}, animUrl=${animUrl}, retry=${_retryCount}`);
    
    const playerData = this.players.get(characterId);
    if (!playerData) return;
    const characterGroup = playerData.group;
    const model = characterGroup.userData.glbModel;
    // 模型还未加载完，最多重试20次（每次500ms = 最多等待10秒）
    if (!model) {
      if (_retryCount < 20) {
        setTimeout(() => this._loadPlayerAnimGlb(characterId, type, animUrl, _retryCount + 1), 500);
      } else {
        // 超时放弃重试，但把 URL 存入 _pendingAnimUrls，等模型加载完后自动触发
        if (!characterGroup.userData._pendingAnimUrls) characterGroup.userData._pendingAnimUrls = {};
        characterGroup.userData._pendingAnimUrls[type] = animUrl;
        console.warn(`⚠️ [AnimGLB] ${type} 等待模型超时，已缓存至 _pendingAnimUrls`);
      }
      return;
    }

    // 验证animUrl的有效性
    if (!animUrl || animUrl.trim() === '') {
      console.warn(`⚠️ [AnimGLB] ${type} 动画URL无效: ${animUrl}`);
      return;
    }

    const apiBase = CONFIG.API_BASE || (window.location.origin + '/api');
    const url = animUrl.startsWith('http') ? animUrl : (apiBase.replace('/api', '') + animUrl);

    // 🎬 动画守卫：下载前检查
    if (window.RemoteAnimGuard) {
      window.RemoteAnimGuard.shouldLoadAnim(url, { characterId, animType: type }).then((check) => {
        if (!check.shouldLoad) {
          console.warn(`⚠️ [AnimGLB] 动画守卫拦截: ${type} (${url}) 原因: ${check.reason}`);
          return;
        }
        if (check.contentLength > 0) window.RemoteAnimGuard.recordLoaded(characterId, check.contentLength);
        _doLoad();
      }).catch((err) => {
        console.warn('[AnimGLB] 动画守卫异常，允许继续加载:', err);
        _doLoad();
      });
    } else {
      _doLoad();
    }

    // 🆕 智能动作加载：自动识别 FBX/GLB/GLTF，选择对应加载器
    // 若 AnimLoader 不可用则回退到原始 GLTFLoader
    const _loadWithAnimLoader = (loaderUrl) => {
      if (window.AnimLoader) {
        AnimLoader.loadAnimFile(loaderUrl, {
          model: model,
          onLoaded: (animations) => {
            if (!animations?.length) {
              console.warn(`⚠️ [AnimGLB] ${type} 动画文件无动画clip: ${loaderUrl}`);
              return;
            }
            // 统一为 { animations } 格式，兼容后续处理逻辑
            const gltf = { animations };
            _processAnimClip(gltf);
          },
          onError: (err) => {
            console.warn(`⚠️ [AnimGLB] ${type} 加载失败 (${loaderUrl}):`, err);
          }
        });
      } else {
        // 降级：使用原始 GLTFLoader
        this.gltfLoader.load(loaderUrl, (gltf) => {
          if (!gltf.animations?.length) {
            console.warn(`⚠️ [AnimGLB] ${type} 动画文件无动画clip: ${loaderUrl}`);
            return;
          }
          _processAnimClip(gltf);
        }, undefined, (err) => {
          console.warn(`⚠️ [AnimGLB] ${type} 加载失败 (${loaderUrl}):`, err);
        });
      }
    };

    // ── 动画处理逻辑（提取为独立函数，避免代码重复） ──
    const _processAnimClip = (gltf) => {
      // 🎬 动画守卫：解析后检查
      let rawClip = gltf.animations[0];
      if (window.RemoteAnimGuard) {
        const v = window.RemoteAnimGuard.validateClip(rawClip, gltf, { characterId, animType: type, url: url });
        if (!v.valid) {
          console.warn(`⚠️ [AnimGLB] 动画守卫拦截 clip: ${type} 原因: ${v.reason}`);
          return;
        }
      }

      // ── 关键修复：mixer 必须绑定到含骨骼的 Armature 节点 ──
      if (!characterGroup.userData.animMixers) characterGroup.userData.animMixers = {};
      if (!characterGroup.userData.animActions) characterGroup.userData.animActions = {};

      let sharedMixer = characterGroup.userData.sharedMixer;
      if (!sharedMixer) {
        let mixerRoot = model;
        model.traverse(n => { if (n.type === 'Object3D' && n.children.some(c => c.isBone)) mixerRoot = n; });
        sharedMixer = new THREE.AnimationMixer(mixerRoot);
        characterGroup.userData.sharedMixer = sharedMixer;
        console.log(`✅ [AnimGLB] 创建共享 mixer，绑定到: ${mixerRoot.name} [${mixerRoot.type}]`);
      }

      let clip = rawClip;

      // 自包含角色包：原样播放，仅过滤根骨骼位移
      const scClip = window.SelfContainedChar
        ? window.SelfContainedChar.processClip(clip, characterGroup, model)
        : null;
      if (scClip) {
        clip = scClip;
      } else {
        // 现有重定向逻辑
        if (window.AnimRetargetHelper) {
          clip = window.AnimRetargetHelper.processAnimClip(clip, model, type) || clip;
        }
        clip.tracks = clip.tracks.filter(t => !t.name.endsWith('.position'));
        // 骨骼约定托底补偿：模型骨骼 rest 约定与动作库标准不一致时
        //（如 UpLeg=X180° vs 标准 Z180°，实测 Kipfel 裙子收起+前倾案），
        // 对 quaternion 轨道逐骨骼做 q'=P×q×K 补偿；标准约定模型零干预
        if (window.AnimConventionCompensator) {
          window.AnimConventionCompensator.processClip(clip, model, type);
        }
      }

      sharedMixer.uncacheClip(clip);

      const isLoop = (type === 'idle' || type === 'walk' || type === 'run');
      const action = sharedMixer.clipAction(clip);
      action.loop = isLoop ? THREE.LoopRepeat : THREE.LoopOnce;
      if (!isLoop) action.clampWhenFinished = true;

      const oldAction = characterGroup.userData.animActions[type];
      if (oldAction) { oldAction.stop(); }

      characterGroup.userData.animMixers[type] = sharedMixer;
      characterGroup.userData.animActions[type] = action;

      if (type === 'walk') { characterGroup.userData.walkMixer = sharedMixer; characterGroup.userData.walkAction = action; }
      if (type === 'run')  { characterGroup.userData.runMixer  = sharedMixer; characterGroup.userData.runAction  = action; }

      characterGroup.userData.currentAnimMixer = sharedMixer;

      console.log(`✅ [AnimGLB] ${type} 动画已加载: ${clip.name} (共享mixer)`);

      // 🔧 关键修复：idle 动画加载完成后，无论当前模式如何都自动播放
      // （修复切换模板后不刷新网页时角色卡在 T-pose 的问题）
      if (type === 'idle') {
        console.log('[AnimGLB] idle 动画加载完成，自动播放');
        action.reset().play();
        characterGroup.userData.currentAnimMode = 'idle';
      }
    };

    const _doLoad = () => {
      // 执行加载
      _loadWithAnimLoader(url);
    };
  }

  // 切换角色动画状态（idle/walk/run/jump/attack1/hit/death）
  // inCombat=true 时：攻击类动画不自动回 idle（由战斗状态机驱动），但仍正常播放
  // onFinished 回调：动画播完后执行（仅一次性动画有效），不传则走默认 idle 逻辑
  _switchPlayerAnim(characterId, mode, { inCombat = false, onFinished = null } = {}) {
    const playerData = this.players.get(characterId);
    if (!playerData) return false;
    const cg = playerData.group;
    const prevMode = cg.userData.currentAnimMode || 'idle';

    const actions = cg.userData.animActions || {};
    // 兼容旧字段
    if (!actions.walk && cg.userData.walkAction) actions.walk = cg.userData.walkAction;
    if (!actions.run  && cg.userData.runAction)  actions.run  = cg.userData.runAction;

    const newAction = actions[mode];
    // 所有独立动画 GLB 共享同一个绑定在角色模型上的 mixer
    const newMixer  = cg.userData.sharedMixer || cg.userData.glbMixer || null;

    // 动画未加载时不改变状态，返回 false 供调用方感知
    if (!newAction || !newMixer) {
      return false;
    }

    // 同一模式处理：
    //   - idle/walk/run：未播放时重启
    //   - 攻击类（inCombat）：强制 reset 重播（连击需要）
    //   - 其他一次性：不重复触发
    const LOOP_MODES = ['idle', 'walk', 'run'];
    if (prevMode === mode) {
      if (LOOP_MODES.includes(mode)) {
        if (!newAction.isRunning()) { newAction.reset(); newAction.enabled = true; newAction.paused = false; newAction.play(); }
      } else if (inCombat) {
        // 连击同一动画 key 循环时强制重播
        newAction.reset(); newAction.enabled = true; newAction.paused = false; newAction.play();
      }
      return true;
    }

    // 清除旧 finished 监听
    if (cg.userData._onAnimFinished) {
      newMixer.removeEventListener('finished', cg.userData._onAnimFinished);
      cg.userData._onAnimFinished = null;
    }

    // 停止旧动画
    // 1. 从攻击类切换到 idle/walk/run：停止所有攻击 action 并重置 weight
    // 2. 攻击→攻击切换：直接 stop 旧 action，不用 fadeOut
    //    （fadeOut 不会清除 interpolant，残留调度器会在后续帧干扰新动作幅度）
    // 3. idle/walk/run 之间：fadeOut 平滑过渡
    if (!LOOP_MODES.includes(prevMode)) {
      // 旧动作是攻击类 → 停止所有非循环 action，彻底清除残留
      Object.entries(actions).forEach(([k, a]) => {
        if (!LOOP_MODES.includes(k) && a) { a.stop(); a.weight = 1; }
      });
    } else {
      // 旧动作是循环类（idle/walk/run）→ fadeOut 平滑
      const prevAction = actions[prevMode];
      if (prevAction && prevAction.isRunning()) prevAction.fadeOut(0.12);
    }

    // 注册 finished 回调（仅一次性动画）
    // 注意：sharedMixer 是所有动画共用的，finished 事件会在任何 action 播完时触发
    // 必须检查 e.action === newAction，避免其他动画播完时误触发
    if (!LOOP_MODES.includes(mode)) {
      const cb = onFinished || (inCombat ? null : () => {
        // 非战斗状态：播完自动回 idle
        if (cg.userData.currentAnimMode === mode) {
          this._switchPlayerAnim(characterId, 'idle');
        }
      });
      if (cb) {
        const wrapped = (e) => {
          // 只响应当前目标 action 的 finished，忽略其他 action
          if (e.action !== newAction) return;
          newMixer.removeEventListener('finished', wrapped);
          cg.userData._onAnimFinished = null;
          cb(e);
        };
        cg.userData._onAnimFinished = wrapped;
        newMixer.addEventListener('finished', wrapped);
      }
    }

    // 播放新动画：先确保 weight=1、enabled、不暂停
    // 攻击→攻击 硬切（不 fadeIn），避免旧action stop后到新action渐入之间出现T字bind pose闪帧
    // 循环类（idle/walk/run）进入时才用 fadeIn 平滑
    newAction.stop();
    newAction.weight = 1;
    newAction.reset(); newAction.enabled = true; newAction.paused = false;
    if (LOOP_MODES.includes(mode)) {
      newAction.fadeIn(0.12).play();
    } else {
      newAction.play();
    }
    cg.userData.currentAnimMixer = newMixer;
    cg.userData.currentAnimMode  = mode;

    // ── 播放动作音效 ──
    if (typeof soundManager !== 'undefined' && soundManager.playAnimSound) {
      soundManager.playAnimSound(mode);
    }

    return true;
  }

  // Helper function to create name sprite
  createNameSprite(characterName, modelHeight = 1.8) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    // 透明背景
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    // 黑色描边提升可读性
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeText(characterName, 128, 36);
    // 白色文字
    ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
    ctx.fillText(characterName, 128, 36);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1.5, 0.375, 1);
    sprite.position.y = modelHeight + 0.15; // 模型头顶上方 0.15 单位（固定间距）
    
    return sprite;
  }

  /**
   * 创建进度数字 sprite（显示在占位符上方）
   * @param {number} value - 进度值（字节数 / 加载中点计数）
   * @param {string} mode - 'bytes'（默认） | 'loading'（显示 "下载中..." + 动画点）
   * @param {number|null} totalBytes - 已知总字节数时显示 ↓ X.X / Y.Y MB 格式
   * @returns {THREE.Sprite} 进度 sprite
   */
  createProgressSprite(value, mode = 'bytes', totalBytes = null) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const formatBytes = (bytes) => {
      const kb = bytes / 1024;
      const mb = bytes / (1024 * 1024);
      if (mb >= 1) return `${mb.toFixed(1)} MB`;
      if (kb >= 1) return `${kb.toFixed(1)} KB`;
      return `${bytes} B`;
    };
    
    let displayText, fillColor;
    
    if (mode === 'loading') {
      // loading 模式：显示 "下载中" + 动画点
      const dots = '.'.repeat(Math.max(1, Math.min(3, value)));
      displayText = totalBytes && totalBytes > 0
        ? `下载中${dots} (${formatBytes(totalBytes)})`
        : `下载中${dots}`;
      fillColor = '#FFD700';
    } else {
      // bytes 模式：智能格式化，如有 totalBytes 显示 X / Y 格式
      if (totalBytes && totalBytes > 0) {
        displayText = `↓ ${formatBytes(value)} / ${formatBytes(totalBytes)}`;
      } else {
        displayText = `↓ ${formatBytes(value)}`;
      }
      fillColor = '#00eeff';
    }
    
    // 绘制进度文字（带总大小时用稍小字体）
    const hasTotal = totalBytes && totalBytes > 0;
    ctx.font = hasTotal ? 'bold 36px Arial' : 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // 粗描边
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 6;
    ctx.strokeText(displayText, 256, 64);
    
    // 颜色填充
    ctx.fillStyle = fillColor;
    ctx.fillText(displayText, 256, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(3.2, 0.7, 1);
    
    return sprite;
  }

  // Update player name
  updatePlayerName(characterId, newName) {
    const playerData = this.players.get(characterId);
    if (playerData) {
      // Update stored name
      playerData.name = newName;
      
      // Remove old name sprite
      if (playerData.nameSprite) {
        playerData.group.remove(playerData.nameSprite);
      }
      
      // Create and add new name sprite（保持模型高度比例）
      const modelHeight = playerData.group.userData.modelHeight || 1.8;
      const newNameSprite = this.createNameSprite(newName, modelHeight);
      playerData.group.add(newNameSprite);
      playerData.nameSprite = newNameSprite;
      playerData.group.userData.nameSprite = newNameSprite;
      
      console.log(`Updated player ${characterId} name to: ${newName}`);
    }
  }

  addMonster(monsterId, monsterType, position = { x: 0, y: 0, z: 0 }, health = null, maxHealth = null) {
    // 如果已存在则跳过
    if (this.monsters.has(monsterId)) return this.monsters.get(monsterId).group;

    const monsterGroup = new THREE.Group();
    monsterGroup.userData.monsterId = monsterId;

    // Monster body (cube with spike appearance)
    const bodyGeometry = new THREE.BoxGeometry(2, 2, 2);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      metalness: 0.6,
      roughness: 0.3,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.monsterId = monsterId;
    monsterGroup.add(body);

    // Eyes
    for (let i = -0.3; i <= 0.3; i += 0.6) {
      const eyeGeometry = new THREE.SphereGeometry(0.2, 16, 16);
      const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00 });
      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eye.position.set(i, 0.5, 1.1);
      eye.userData.monsterId = monsterId;
      monsterGroup.add(eye);
    }

    // y坐标：怪物高度2，中心在y=1时底部刚好踩地面；若y<=0一律设为1
    const px = position.x || 0;
    const py = (position.y > 0) ? position.y : 1;
    const pz = position.z || 0;

    monsterGroup.position.set(px, py, pz);
    this.scene.add(monsterGroup);

    this.monsters.set(monsterId, {
      group: monsterGroup,
      type: monsterType,
      position: { x: px, y: py, z: pz },
      health: health !== null ? health : 50,
      maxHealth: maxHealth !== null ? maxHealth : (health !== null ? health : 50),
    });

    return monsterGroup;
  }

  updatePlayerPosition(characterId, position, isMoving = false, animMode = null, rotation = null) {
    if (this.players.has(characterId)) {
      const player = this.players.get(characterId);
      const group = player.group;
      
      // 计算移动距离判断是否在移动
      const oldPos = player.position;
      const distance = Math.sqrt(
        Math.pow(position.x - oldPos.x, 2) + 
        Math.pow(position.z - oldPos.z, 2)
      );
      const isActuallyMoving = distance > 0.01;
      
      group.position.set(position.x, position.y, position.z);
      player.position = position;
      
      // 同步旋转（如果服务端传了旋转角度）
      if (rotation !== null && rotation !== undefined) {
        group.rotation.y = rotation;
      }
      
      // GLB 模型：使用服务端同步的 animMode 切换动画
      if (group.userData.glbModel) {
        if (animMode) {
          this._switchPlayerAnim(characterId, animMode);
        } else {
          // 无 animMode 时回退到位置推断（walk/idle）
          const inferredMode = isActuallyMoving ? (distance > 0.05 ? 'run' : 'walk') : 'idle';
          this._switchPlayerAnim(characterId, inferredMode);
        }
        return;
      }
      
      // 方块人：行走动画（四肢摆动）
      if (isActuallyMoving && group.userData.leftArm) {
        // 根据移动速度判断是否冲刺（距离大表示移动快）
        const isSprinting = distance > 0.05; // 如果移动距离大，认为在冲刺
        
        // 更新动画时间（加快）
        const animSpeed = isSprinting ? 0.45 : 0.3; // 冲刺时更快
        group.userData.animTime = (group.userData.animTime || 0) + animSpeed;
        const time = group.userData.animTime;
        
        // 摆动幅度（冲刺时幅度也更大）
        const swingMultiplier = isSprinting ? 1.3 : 1.0;
        const armSwing = Math.sin(time) * 0.6 * swingMultiplier;  // 手臂摆动角度
        const legSwing = Math.sin(time) * 0.5 * swingMultiplier;  // 腿部摆动角度
        
        // 手臂摆动（前后相反）
        group.userData.leftArm.rotation.x = armSwing;
        group.userData.rightArm.rotation.x = -armSwing;
        
        // 腿部摆动（前后相反）
        group.userData.leftLeg.rotation.x = -legSwing;
        group.userData.rightLeg.rotation.x = legSwing;
      } else if (group.userData.leftArm) {
        // 静止时重置姿势
        group.userData.leftArm.rotation.x = 0;
        group.userData.rightArm.rotation.x = 0;
        group.userData.leftLeg.rotation.x = 0;
        group.userData.rightLeg.rotation.x = 0;
      }
    }
  }

  updateMonsterPosition(monsterId, position) {
    if (this.monsters.has(monsterId)) {
      const monster = this.monsters.get(monsterId);
      monster.group.position.set(position.x, position.y, position.z);
      monster.position = position;
    }
  }

  removeMonster(monsterId) {
    if (this.monsters.has(monsterId)) {
      const monster = this.monsters.get(monsterId);
      // 移除选中光圈（如果存在）
      if (monster.selectedRing) {
        monster.group.remove(monster.selectedRing);
        monster.selectedRing = null;
      }
      this.scene.remove(monster.group);
      this.monsters.delete(monsterId);

      // Particle effect (death)
      this.createDeathParticles(monster.position);
    }
  }

  /**
   * 显示怪物选中光圈
   * @param {string} monsterId
   */
  showMonsterSelected(monsterId) {
    if (!this.monsters.has(monsterId)) return;
    const monster = this.monsters.get(monsterId);
    if (monster.selectedRing) return; // 已存在则跳过

    const ringGeo = new THREE.RingGeometry(1.2, 1.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.9; // 贴近怪物脚底
    monster.group.add(ring);
    monster.selectedRing = ring;
  }

  /**
   * 隐藏怪物选中光圈
   * @param {string} monsterId
   */
  hideMonsterSelected(monsterId) {
    if (!this.monsters.has(monsterId)) return;
    const monster = this.monsters.get(monsterId);
    if (monster.selectedRing) {
      monster.group.remove(monster.selectedRing);
      monster.selectedRing.geometry.dispose();
      monster.selectedRing.material.dispose();
      monster.selectedRing = null;
    }
  }

  createDeathParticles(position) {
    for (let i = 0; i < 20; i++) {
      // 从对象池获取粒子
      let particle = this.getFromPool('particles');
      
      // 如果对象池没有可用对象，创建新的
      if (!particle) {
        const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const material = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
        particle = new THREE.Mesh(geometry, material);
      }
      
      particle.position.copy(position);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 3,
        (Math.random() - 0.5) * 5
      );

      this.particles.push({
        mesh: particle,
        velocity,
        life: 1,
      });

      this.scene.add(particle);
    }
  }

  updateParticles(delta) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta / 1000;

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        // 回收粒子到对象池
        this.recycleToPool('particles', p.mesh);
        this.particles.splice(i, 1);
      } else {
        p.mesh.position.add(p.velocity.clone().multiplyScalar(delta));
        p.mesh.material.opacity = p.life;
      }
    }
  }

  /**
   * 世界对象到玩家的距离平方（水平面 XZ）
   *
   * 口径说明：优先走 WorldObjectBounds 的【表面距离】（玩家到模型世界包围盒的
   * 最近距离，盒内为 0），解决大模型"人已站在模型边缘/内部，系统却判定为远"
   * 的问题；模块未加载时退回原来的锚点（position_x/z）中心距离，行为不变。
   *
   * @param {object} obj 世界对象数据行
   * @param {number} px 玩家 x
   * @param {number} pz 玩家 z
   * @returns {number} 距离平方
   */
  _surfaceDistSq(obj, px, pz) {
    const B = (typeof window !== 'undefined') ? window.WorldObjectBounds : null;
    if (B && typeof B.surfaceDistSq === 'function') {
      return B.surfaceDistSq(obj, px, pz);
    }
    const dx = px - (obj.position_x || 0);
    const dz = pz - (obj.position_z || 0);
    return dx * dx + dz * dz;
  }

  /**
   * 根据距离动态加载和卸载对象
   */
  updateObjectLoading() {
    // 检查是否正在加载建筑，如果是则跳过，避免冲突
    if (this.isLoadingBuildings) {
      return;
    }
    
    // 获取玩家位置
    const player = window.player;
    if (!player) return;
    
    const playerPosition = player.position;
    const currentTime = performance.now();
    
    // 管理加载阶段（已简化，仅在需要时执行）
    
    // 检查加载队列大小，避免队列过长
    if (this.loadingQueue.length >= this.maxLoadingQueueSize) {
      // 队列已满，跳过添加新对象
    } else {
      // 使用距离平方比较，避免 sqrt 开销
      const loadDistSq = this.loadDistance * this.loadDistance;
      const px = playerPosition.x;
      const pz = playerPosition.z;
      
      for (let i = 0; i < this.allWorldObjects.length; i++) {
        const obj = this.allWorldObjects[i];
        if (this.loadedObjects.has(obj.id)) continue;
        
        // 已失败3次的对象不再重复入队，避免无限重试
        if ((this.loadRetryCount.get(obj.id) || 0) >= 3) continue;
        
        // 距离口径：优先按【玩家到模型表面】判定（WorldObjectBounds），
        // 大模型用锚点判定会导致"人已到模型边上却始终不加载"。
        // 模块缺失时自动退回原中心点逻辑。
        const distSq = this._surfaceDistSq(obj, px, pz);
        
        if (distSq < loadDistSq) {
          const isInQueue = this.loadingQueue.some(q => q.id === obj.id);
          const isInBatch = this.loadingBatch.some(b => b.id === obj.id);
          if (!isInQueue && !isInBatch) {
            this.loadingQueue.push(obj);
            if (this.loadingQueue.length >= this.maxLoadingQueueSize) break;
          }
        }
      }
    }
    
    // 检查是否需要卸载（每次 updateObjectLoading 执行时检查）
    {
      const unloadDistSq = this.unloadDistance * this.unloadDistance;
      const px2 = playerPosition.x;
      const pz2 = playerPosition.z;
      const objectsToUnload = [];
      
      this.allWorldObjects.forEach(obj => {
        if (this.loadedObjects.has(obj.id)) {
          // 最短存活时间：大模型重建代价高（clone + 纹理重传 + 着色器编译），
          // 防止玩家在阈值边缘来回走动造成反复"卸载→重载"的抖振
          const loadedAt = this._loadedAt ? (this._loadedAt.get(obj.id) || 0) : 0;
          if (loadedAt && (Date.now() - loadedAt) < this.minObjectLifetimeMs) return;
          // 同样按【玩家到模型表面】判定，避免大模型在玩家还没离开边缘时就被卸载
          const dSq = this._surfaceDistSq(obj, px2, pz2);
          if (dSq > unloadDistSq) {
            objectsToUnload.push(obj);
          }
        }
      });
      
      for (let i = 0; i < objectsToUnload.length; i++) {
        this.unloadObject(objectsToUnload[i]);
        this.loadedObjects.delete(objectsToUnload[i].id);
      }
    }
    
    // 处理加载队列（移除时间间隔限制，每次都处理）
    this.processLoadingQueue(currentTime);
  }

  /**
   * 更新加载阶段
   */
  updateLoadingPhase(currentTime, playerPosition) {
    // 跟踪玩家位置，用于检测移动
    if (!this.lastPlayerPosition) {
      this.lastPlayerPosition = { ...playerPosition };
    }
    
    // 计算玩家移动距离
    const playerDistance = Math.sqrt(
      Math.pow(playerPosition.x - this.lastPlayerPosition.x, 2) +
      Math.pow(playerPosition.z - this.lastPlayerPosition.z, 2)
    );
    
    // 如果玩家移动超过一定距离，重置加载阶段
    if (playerDistance > 50) {
      this.loadingPhase = 'initial';
      this.lastPhaseChange = currentTime;
      this.lastPlayerPosition = { ...playerPosition };
      console.log('🔄 玩家移动，重置加载阶段到: initial');
      return;
    }
    
    // 基于加载进度切换阶段，而不是固定时间间隔
    switch (this.loadingPhase) {
      case 'initial':
        // 检查100单位内是否还有未加载的对象
        const hasNearbyObjects = this.allWorldObjects.some(obj => {
          const distance = Math.sqrt(
            Math.pow(playerPosition.x - (obj.position_x || 0), 2) +
            Math.pow(playerPosition.z - (obj.position_z || 0), 2)
          );
          return distance < 100 && !this.loadedObjects.has(obj.id);
        });
        
        if (!hasNearbyObjects) {
          this.loadingPhase = 'nearby';
          this.lastPhaseChange = currentTime;
          console.log('🔄 加载阶段切换到: nearby');
        }
        break;
        
      case 'nearby':
        // 检查200单位内是否还有未加载的对象
        const hasMediumObjects = this.allWorldObjects.some(obj => {
          const distance = Math.sqrt(
            Math.pow(playerPosition.x - (obj.position_x || 0), 2) +
            Math.pow(playerPosition.z - (obj.position_z || 0), 2)
          );
          return distance < 200 && !this.loadedObjects.has(obj.id);
        });
        
        if (!hasMediumObjects) {
          this.loadingPhase = 'distant';
          this.lastPhaseChange = currentTime;
          console.log('🔄 加载阶段切换到: distant');
        }
        break;
        
      case 'distant':
        // 检查400单位内是否还有未加载的对象
        const hasDistantObjects = this.allWorldObjects.some(obj => {
          const distance = Math.sqrt(
            Math.pow(playerPosition.x - (obj.position_x || 0), 2) +
            Math.pow(playerPosition.z - (obj.position_z || 0), 2)
          );
          return distance < 400 && !this.loadedObjects.has(obj.id);
        });
        
        if (!hasDistantObjects) {
          // 所有对象都已加载，重置到初始阶段
          this.loadingPhase = 'initial';
          this.lastPhaseChange = currentTime;
          console.log('🔄 加载阶段重置到: initial');
        }
        break;
    }
  }

  /**
   * 处理加载队列，实现并行加载
   */
  processLoadingQueue(currentTime) {
    // 过滤掉已经加载的对象
    const filteredQueue = this.loadingQueue.filter(obj => !this.loadedObjects.has(obj.id));
    
    console.log(`[Queue] 当前队列长度: ${this.loadingQueue.length}, 过滤后: ${filteredQueue.length}, 加载中: ${this.loadingBatch.length}`);
    if (filteredQueue.length === 0) {
      // 清空队列，所有对象都已加载
      this.loadingQueue = [];
      // 更新加载状态为完成
      const totalObjects = this.allWorldObjects.length;
      const loadedObjects = this.loadedObjects.size;
      this.updateLoadingStatus(loadedObjects, totalObjects);
      this.showLoadingProgress();
      return;
    }
    
    // 排序策略：几何模型最优先（无模型文件，最快显示），小模型次之，大模型排最后
    const pp = window.player ? window.player.position : null;
    filteredQueue.sort((a, b) => {
      // 第零优先级：几何模型（无模型文件、纯几何体构建）最优先加载
      const aIsGeom = !a.model_path || a.model_path === '' || (a.type && a.type.startsWith('geometry_'));
      const bIsGeom = !b.model_path || b.model_path === '' || (b.type && b.type.startsWith('geometry_'));
      if (aIsGeom && !bIsGeom) return -1;
      if (!aIsGeom && bIsGeom) return 1;
      
      // 第一优先级：按文件大小分层，小模型全部优先于大模型
      const sizeA = a.file_size || 0;
      const sizeB = b.file_size || 0;
      const aIsLarge = sizeA > this.LARGE_MODEL_THRESHOLD;
      const bIsLarge = sizeB > this.LARGE_MODEL_THRESHOLD;
      
      // 大模型例外：已进入加载半径（按模型表面算）的大模型不再被压到队尾，
      // 否则玩家走到模型跟前，它还在等前面所有小模型加载完（体感"很久才显示"）
      const nearA = aIsLarge && pp && this._surfaceDistSq(a, pp.x, pp.z) < this.loadDistance * this.loadDistance;
      const nearB = bIsLarge && pp && this._surfaceDistSq(b, pp.x, pp.z) < this.loadDistance * this.loadDistance;
      if (nearA && !nearB) return -1;
      if (!nearA && nearB) return 1;
      
      if (!aIsLarge && bIsLarge) return -1;  // a小b大，a优先
      if (aIsLarge && !bIsLarge) return 1;   // a大b小，b优先
      
      // 同一层级内（两个小模型或两个大模型）按距离排序：近的优先
      if (pp) {
        const dax = pp.x - (a.position_x || 0), daz = pp.z - (a.position_z || 0);
        const dbx = pp.x - (b.position_x || 0), dbz = pp.z - (b.position_z || 0);
        const distA = dax*dax + daz*daz;
        const distB = dbx*dbx + dbz*dbz;
        if (distA !== distB) return distA - distB;
      }
      
      // 同层级同距离，按文件大小升序（小优先）
      return sizeA - sizeB;
    });
    
    // 根据当前性能调整批次大小 - 智能动态策略 + 大文件阻塞
    let adjustedBatchSize;
    
    // 🔒 大文件阻塞检查：计算当前活跃下载的总大小（仅排除几何体，它无网络IO）
    const activeDownloadSize = this.loadingBatch.reduce((sum, obj) => {
      if (obj.loadMethod === 'addGeometryBuilding') {
        return sum;  // ✅ 只排除几何体（本地生成）
      }
      // ✅ 媒体对象也计入下载量（图片/视频也有网络IO）
      return sum + (obj.fileSize || obj.file_size || 0);
    }, 0);
    
    // 下一个待加载对象的大小
    const nextObj = filteredQueue[0];
    const nextObjSize = nextObj ? (nextObj.fileSize || nextObj.file_size || 0) : 0;
    const nextObjIsLarge = nextObjSize > 15 * 1024 * 1024; // >15MB
    const nextObjIsSmall = nextObjSize < 2 * 1024 * 1024;   // <2MB 小文件阈值
    
    // 阻塞规则（优化版）：
    // 1. 小文件(<2MB) → 直接放行，不检查阻塞
    // 2. 如果当前有活跃下载且下一个是大文件(>15MB) → 阻塞等待
    // 3. 如果当前活跃下载总和超过20MB且下一个不是小文件 → 阻塞
    const shouldBlockLargeFile = !nextObjIsSmall && (
      (activeDownloadSize > 0 && nextObjIsLarge) ||
      (activeDownloadSize > 20 * 1024 * 1024)
    );
      
    if (shouldBlockLargeFile && this.loadingBatch.length > 0) {
      console.log(`[Queue] ⏸️ 大文件等待: ${nextObj?.name} (${(nextObjSize/1024/1024).toFixed(1)}MB), 当前活跃下载=${(activeDownloadSize/1024/1024).toFixed(1)}MB`);
      return; // 跳过本轮，等待当前批次完成
    }
    
    // 检查队列中对象的类型
    const hasGeometryOnly = filteredQueue.every(o => o.loadMethod === 'addGeometryBuilding');
    const hasSmallGLB = filteredQueue.some(o => {
      const size = o.fileSize || o.file_size || 0;
      return size > 0 && size < 5 * 1024 * 1024 && o.loadMethod === 'addUploadedModel';
    });
    const hasMediaOnly = filteredQueue.every(o => o.loadMethod === 'addMediaObject');
    
    if (hasGeometryOnly) {
      // 纯几何体队列：批量处理（无网络IO，本地生成即可）
      adjustedBatchSize = Math.min(8, filteredQueue.length);
    } else if (hasMediaOnly) {
      // 纯媒体队列：批量处理（视频/图片加载快）
      adjustedBatchSize = Math.min(4, filteredQueue.length);
    } else if (hasSmallGLB && activeDownloadSize < 5 * 1024 * 1024) {
      // 包含小GLB且当前下载量<5MB：允许2个并行下载
      adjustedBatchSize = 2;
    } else {
      // 大GLB或混合类型：串行加载
      adjustedBatchSize = 1;
    }
    
    // 计算当前可以处理的对象数量（考虑当前正在加载的批次）
    const availableSlots = adjustedBatchSize - this.loadingBatch.length;
    
    if (availableSlots > 0) {
      // 一次只取一个对象，确保串行加载（几何体先完成，再加载GLB）
      const obj = filteredQueue.shift();
      console.log(`[Queue] ▶ 启动加载: ${obj.name || obj.id} (${obj.loadMethod}), batchSize=${adjustedBatchSize}, loadingBatch=${this.loadingBatch.length}`);
      if (!obj) return;
      
      this.loadingBatch.push(obj);
      this.loadingQueue = filteredQueue;
      
      const loadSingleObject = async (objToLoad) => {
        try {
          // 先标记为已加载，防止重复入队
          this.loadedObjects.add(objToLoad.id);
          this._loadedAt.set(objToLoad.id, Date.now());
          
          // 防御：loadMethod 缺失或不是函数时（增量分页/WebSocket 直接入队的对象），
          // 按 type 推导加载方法；推导不出则跳过，避免连续失败重试刷屏
          if (typeof this[objToLoad.loadMethod] !== 'function') {
            let resolved = null;
            const t = objToLoad.type;
            if (t && t.startsWith('geometry_')) resolved = 'addGeometryBuilding';
            else if (t === 'generated_building') resolved = 'addGeneratedBuilding';
            else if (t === 'uploaded_model') resolved = 'addUploadedModel';
            else if (t === 'threejs_code') resolved = 'addThreeJSModel';
            else if (t === 'ad_slot') resolved = 'addAdSlotPortal';
            else if (t === 'gaussian_splat') resolved = 'addGaussianSplat';
            else if (t === 'media_image' || t === 'media_video') resolved = 'loadMediaObject';
            if (resolved && typeof this[resolved] === 'function') {
              objToLoad.loadMethod = resolved;
              console.warn(`[Queue] 🔧 为对象 ${objToLoad.name || objToLoad.id} 按 type=${objToLoad.type} 推导加载方法 ${resolved}`);
            } else {
              this.loadingBatch = this.loadingBatch.filter(o => o.id !== objToLoad.id);
              console.warn(`[Queue] ⏭ 跳过对象 ${objToLoad.name || objToLoad.id}（无法解析加载方法 type=${objToLoad.type || '未知'}）`);
              if (this.loadingQueue.length > 0) {
                setTimeout(() => this.processLoadingQueue(currentTime), 0);
              }
              return;
            }
          }
          
          // 异步加载对象
          await this[objToLoad.loadMethod](objToLoad);
          
          // 应用位置覆盖（用于UUID等不在world_objects表中的对象）
          if (this._transformOverrides && this._transformOverrides[objToLoad.id]) {
            const ov = this._transformOverrides[objToLoad.id];
            const entry = this.generatedBuildings.get(objToLoad.id);
            if (entry && entry.model) {
              entry.model.position.set(ov.position_x || 0, ov.position_y || 0, ov.position_z || 0);
              entry.model.rotation.set(ov.rotation_x || 0, ov.rotation_y || 0, ov.rotation_z || 0);
              entry.model.scale.set(ov.scale_x || 1, ov.scale_y || 1, ov.scale_z || 1);
            }
          }
          
          // 加载完成后更新加载状态
          const totalObjects = this.allWorldObjects.length;
          const loadedObjects = this.loadedObjects.size;
          this.updateLoadingStatus(loadedObjects, totalObjects);
          this.showLoadingProgress();
          
          // 从加载批次中移除已完成的对象
          this.loadingBatch = this.loadingBatch.filter(o => o.id !== objToLoad.id);
          console.log(`[Queue] ✓ 加载完成: ${objToLoad.name || objToLoad.id}, 剩余队列=${this.loadingQueue.length}, loadingBatch=${this.loadingBatch.length}`);
          
          // 检查是否所有模型都已加载完成，如果是则启动媒体加载
          // this._checkAndStartMediaLoading(); // ✅ 已废弃：媒体现在在主队列中按顺序加载（几何体→媒体→模型）
          
          // 加载完成后，继续加载下一个对象
          if (this.loadingQueue.length > 0) {
            setTimeout(() => this.processLoadingQueue(currentTime), 0);
          }
          // 成功加载后清除该对象的重试计数
          this.loadRetryCount.delete(objToLoad.id);
        } catch (error) {
          console.error(`❌ 加载对象失败: ${objToLoad.name}`, error);
          // 加载失败时，取消标记
          this.loadedObjects.delete(objToLoad.id);
          this.loadingBatch = this.loadingBatch.filter(o => o.id !== objToLoad.id);
          
          // 失败重试计数，超过3次则跳过该对象，避免无限循环
          const retryCount = (this.loadRetryCount.get(objToLoad.id) || 0) + 1;
          this.loadRetryCount.set(objToLoad.id, retryCount);
          if (retryCount >= 3) {
            console.warn(`[Queue] ⛔ 对象 ${objToLoad.name || objToLoad.id} 已连续失败 ${retryCount} 次，跳过加载`);
          } else {
            console.log(`[Queue] 🔄 对象 ${objToLoad.name || objToLoad.id} 失败第 ${retryCount} 次，允许再次尝试`);
          }
          
          // 失败后也继续加载下一个
          if (this.loadingQueue.length > 0) {
            setTimeout(() => this.processLoadingQueue(currentTime), 0);
          }
        }
      };
      
      loadSingleObject(obj);
    }
  }

  /**
   * 检查是否所有模型都已加载完成，如果是则启动媒体对象加载
   * 阶段式加载策略：模型优先 → 媒体延后，避免带宽竞争
   */
  _checkAndStartMediaLoading() {
    // 如果没有待加载的媒体，直接返回
    if (!this._pendingMediaObjects || this._pendingMediaObjects.length === 0) return;
    
    // 如果媒体已经开始加载，不再重复触发
    if (this._mediaLoadingStarted) return;
    
    // 检查条件：队列为空 且 加载批次为空（所有模型都完成了）
    const isModelLoadingComplete = this.loadingQueue.length === 0 && this.loadingBatch.length === 0;
    
    if (isModelLoadingComplete) {
      this._mediaLoadingStarted = true;
      const mediaCount = this._pendingMediaObjects.length;
      console.log(`🎉 所有模型加载完成！现在启动 ${mediaCount} 个媒体对象的延迟加载`);
      
      // 延迟 100ms 启动媒体加载，让浏览器有时间处理渲染
      setTimeout(() => {
        this.loadMediaObjects(this._pendingMediaObjects);
        this._pendingMediaObjects = []; // 清空引用，释放内存
      }, 100);
    }
  }
  
  /**
   * 估计模型复杂度（基于文件大小，小文件复杂度低优先加载）
   */
  estimateModelComplexity(obj) {
    // 优先使用 file_size（字节数）计算复杂度
    if (obj.file_size && obj.file_size > 0) {
      return obj.file_size / 1024; // 返回 KB 数作为复杂度
    }
    
    // 如果没有 file_size，基于文件类型估算
    let complexity = 2000; // 默认假设 2MB
    
    if (obj.model_path) {
      const extension = obj.model_path.split('.').pop().toLowerCase();
      switch (extension) {
        case 'glb':
        case 'gltf':
          complexity = 2000; // ~2MB
          break;
        case 'obj':
          complexity = 5000; // ~5MB
          break;
        case 'fbx':
          complexity = 8000; // ~8MB
          break;
        default:
          complexity = 1000; // 未知格式
      }
    }
    
    // 几何体类型复杂度最低（没有模型文件）
    if (!obj.model_path || obj.model_path === '' || (obj.type && obj.type.startsWith('geometry_'))) {
      complexity = 10; // 几乎不占空间
    }
    
    return complexity;
  }
  
  /**
   * 根据当前性能调整批次大小
   */
  adjustBatchSize() {
    const averageFps = this.getAverageFps();
    let adjustedBatchSize = this.baseBatchSize;
    
    if (averageFps >= this.fpsThresholds.high) {
      // 高帧率，增加批次大小
      adjustedBatchSize = Math.min(this.baseBatchSize + 5, 15);
    } else if (averageFps >= this.fpsThresholds.medium) {
      // 中帧率，保持默认批次大小
      adjustedBatchSize = Math.min(this.baseBatchSize + 2, 10);
    } else if (averageFps >= this.fpsThresholds.low) {
      // 低帧率，减少批次大小
      adjustedBatchSize = Math.max(this.baseBatchSize, 5);
    } else {
      // 极低帧率，最小批次大小
      adjustedBatchSize = Math.max(this.baseBatchSize - 2, 3);
    }
    
    return adjustedBatchSize;
  }

  /**
   * 卸载对象
   */
  unloadObject(obj) {
    // 清掉存活时间戳，避免 _loadedAt 随反复卸载/重载无限增长
    if (this._loadedAt) this._loadedAt.delete(obj.id);
    
    // 根据对象类型卸载
    switch (obj.type) {
      case 'generated_building':
      case 'uploaded_model':
      case 'geometry_building':
      case 'threejs_code':
        if (this.generatedBuildings.has(obj.id)) {
          const building = this.generatedBuildings.get(obj.id);
          if (building && building.model) {
            // 若该对象正被建筑编辑器的变换控制器选中，先解绑，
            // 避免 TransformControls 悬空导致每帧报错
            const bm = this.buildingManager;
            if (bm && bm.transformControls && bm.transformControls.object === building.model) {
              bm.transformControls.detach();
              if (bm.selectedObject === building.model) bm.selectedObject = null;
              console.log('[World] 卸载对象时已解除变换控制器绑定:', obj.name || obj.id);
            }
            // 从场景中移除
            this.scene.remove(building.model);
            
            // 移除标签并释放纹理
            if (building.model.userData.label) {
              const label = building.model.userData.label;
              this.scene.remove(label);
              if (label.material) {
                if (label.material.map) label.material.map.dispose();
                label.material.dispose();
              }
              building.model.userData.label = null;
            }
            
            // 如果是占位符，回收回对象池
            if (building.isPlaceholder) {
              this.recycleToPool('placeholders', building.model);
            } else {
              // P1: 纹理释放改为引用计数（worldTextureOptimizer 统一管理），
              // 不再直接 dispose mat.map —— 否则会误杀其他实例共享的同源纹理
              if (window.WorldTextureOptimizer && building.model.userData) {
                window.WorldTextureOptimizer.releaseInstance(building.model);
              }
              // Three.js r128 中 clone() 共享 geometry，但材质是独立克隆的
              // 卸载时：只 dispose material 对象本身（隔离克隆，可安全释放），
              // 不 dispose geometry（避免缓存中原始模型变白）；纹理由引用计数归零时统一释放
              building.model.traverse(child => {
                if (child.isMesh) {
                  if (child.material) {
                    if (Array.isArray(child.material)) {
                      child.material.forEach(mat => mat.dispose());
                    } else {
                      child.material.dispose();
                    }
                  }
                  // threejs_code 生成的模型为全新几何体（非上传缓存共享），可安全释放
                  if (building.isThreejsGenerated && child.geometry && child.geometry.dispose) {
                    try { child.geometry.dispose(); } catch (e) {}
                  }
                  // 注意：其余类型不 dispose geometry，因为 geometry 被 modelCache 中原始模型共享
                }
              });
            }
            
            // 从地图中删除
            this.generatedBuildings.delete(obj.id);
            
            // 从碰撞对象中移除，优先使用ID匹配
            this.collisionObjects = this.collisionObjects.filter(collisionObj => 
              collisionObj.id !== obj.id
            );
            
          // 已卸载建筑对象（静默）
          }
        }
        break;
      
      // 其他类型的对象卸载逻辑
      default:
        // 未处理的对象类型，静默跳过
        break;
    }
    
    // 从加载队列和批次中移除
    this.loadingQueue = this.loadingQueue.filter(queueObj => queueObj.id !== obj.id);
    this.loadingBatch = this.loadingBatch.filter(batchObj => batchObj.id !== obj.id);
  }
  
  /**
   * 清理内存
   */
  cleanupMemory() {
    // 材质缓存不再定期全量清理（会导致场景对象变白），改为按需管理
    // if (this.frameCount % 300 === 0) {
    //   this.clearMaterialCache();
    // }
    
    // 清理未使用的对象池（每120帧执行一次）
    if (this.frameCount % 120 === 0) {
      this.cleanupObjectPools();
    }
    
    // 清理实例化网格（每600帧约10秒执行一次）
    if (this.frameCount % 600 === 0) {
      this.cleanupInstancedMeshes();
    }
    
    // 清理LOD模型缓存（每300帧执行一次）
    if (this.frameCount % 300 === 0) {
      this.cleanupLODModels();
    }
    
    // 清理模型缓存（每300帧执行一次）
    if (this.frameCount % 300 === 0) {
      this.cleanupModelCache();
    }
    
    // cleanupUnusedObjects 已由 updateObjectLoading 统一处理，无需重复调用
    // if (this.frameCount % 20 === 0) {
    //   this.cleanupUnusedObjects();
    // }
    
    // 强制垃圾回收（如果可用，每30帧执行一次）
    if (window.gc && this.frameCount % 30 === 0) {
      window.gc();
    }
    
    // 输出内存使用情况（每50帧执行一次）
    if (performance.memory && this.frameCount % 50 === 0) {
      const memoryUsedMB = performance.memory.usedJSHeapSize / 1024 / 1024;
      const memoryTotalMB = performance.memory.totalJSHeapSize / 1024 / 1024;
      // 内存清理完成（静默）
    }
  }
  
  /**
   * 清理模型缓存
   */
  cleanupModelCache() {
    // 限制模型缓存大小
    if (this.modelCache.size > this.maxModelCacheSize) {
      const modelsToRemove = Array.from(this.modelCache.entries())
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
        .slice(0, this.modelCache.size - this.maxModelCacheSize);
      
      modelsToRemove.forEach(([key, item]) => {
        // 只删除缓存引用，不 dispose GPU 资源
        // dispose 会使所有从该模型 clone 出的场景对象材质变白
        this.modelCache.delete(key);
        // P1: 通知 worldTextureOptimizer 同步淘汰同名缓存条目——
        //     引用计数归零时真释放 GPU 资源（远离后内存回落的关键）
        if (window.WorldTextureOptimizer) {
          window.WorldTextureOptimizer.disposeModel(key);
        }
      });
    }
  }
  
  /**
   * 清理LOD模型缓存
   */
  cleanupLODModels() {
    // 限制LOD模型缓存大小
    const maxLODModels = 50;
    if (this.lodModels.size > maxLODModels) {
      const modelsToRemove = Array.from(this.lodModels.entries())
        .slice(0, this.lodModels.size - maxLODModels);
      
      modelsToRemove.forEach(([key, geometry]) => {
        geometry.dispose();
        this.lodModels.delete(key);
      });
      
      console.log(`✅ 清理了 ${modelsToRemove.length} 个LOD模型`);
    }
  }
  
  /**
   * 清理未使用的对象
   */
  cleanupUnusedObjects() {
    // 检查并清理超过卸载距离的对象
    const player = window.player;
    if (player) {
      const objectsToUnload = [];
      
      this.allWorldObjects.forEach(obj => {
        if (this.loadedObjects.has(obj.id)) {
          const objectPosition = {
            x: obj.position_x || 0,
            y: obj.position_y || 0,
            z: obj.position_z || 0
          };
          
          const distance = Math.sqrt(
            Math.pow(player.position.x - objectPosition.x, 2) +
            Math.pow(player.position.z - objectPosition.z, 2)
          );
          
          if (distance > this.unloadDistance) {
            objectsToUnload.push(obj);
          }
        }
      });
      
      // 卸载远距离对象
      objectsToUnload.forEach(obj => {
        this.unloadObject(obj);
        this.loadedObjects.delete(obj.id);
      });
      
      if (objectsToUnload.length > 0) {
        console.log(`✅ 卸载了 ${objectsToUnload.length} 个远距离对象`);
      }
    }
  }
  
  /**
   * 清理对象池
   */
  cleanupObjectPools() {
    // 清理粒子对象池
    while (this.objectPools.particles.length > this.poolSizes.particles) {
      const particle = this.objectPools.particles.pop();
      if (particle.geometry) particle.geometry.dispose();
      if (particle.material) particle.material.dispose();
    }
    
    // 清理占位符对象池
    while (this.objectPools.placeholders.length > this.poolSizes.placeholders) {
      const placeholder = this.objectPools.placeholders.pop();
      if (placeholder.geometry) placeholder.geometry.dispose();
      if (placeholder.material) placeholder.material.dispose();
    }
    
    console.log('✅ 对象池清理完成');
  }
  
  /**
   * 清理实例化网格
   */
  cleanupInstancedMeshes() {
    this.instancedMeshes.forEach((mesh, key) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.instancedMeshes.delete(key);
    });
    
    console.log('✅ 实例化网格清理完成');
  }
  
  /**
   * 优化几何体处理
   */
  optimizeGeometryProcessing() {
    // 已禁用：simplifyDistantObjects 会把远处模型替换为无贴图材质（变白）
    // mergeSimilarObjects 每帧遍历所有建筑，性能开销大
    return;
  }
  
  /**
   * 合并相似物体
   */
  mergeSimilarObjects() {
    // 按类型分组物体
    const objectsByType = new Map();
    
    this.generatedBuildings.forEach((building, id) => {
      if (building.model && building.model.visible) {
        const type = building.data.type || 'unknown';
        if (!objectsByType.has(type)) {
          objectsByType.set(type, []);
        }
        objectsByType.get(type).push(building.model);
      }
    });
    
    // 合并每个类型的物体
    objectsByType.forEach((objects, type) => {
      if (objects.length > 3) { // 至少3个物体才合并
        console.log(`🔄 合并 ${type} 类型的 ${objects.length} 个物体`);
        // 这里可以实现具体的合并逻辑
        // 由于合并可能会影响场景结构，这里仅作为示例
      }
    });
  }
  
  /**
   * 简化远距离物体
   */
  simplifyDistantObjects() {
    const player = window.player;
    if (!player) return;
    
    const playerPosition = player.position;
    
    this.generatedBuildings.forEach((building, id) => {
      if (building.model && building.model.visible) {
        const distance = Math.sqrt(
          Math.pow(playerPosition.x - building.model.position.x, 2) +
          Math.pow(playerPosition.z - building.model.position.z, 2)
        );
        
        // 对于远距离物体，进一步简化
        if (distance > 100) {
          building.model.traverse(child => {
            if (child.isMesh) {
              // 使用最简材质
              if (!child.userData.simplestMaterial) {
                child.userData.simplestMaterial = new THREE.MeshBasicMaterial({
                  color: child.material.color,
                  fog: true
                });
              }
              child.material = child.userData.simplestMaterial;
              
              // 简化几何体
              this.simplifyGeometry(child, 0.2); // 更低的细节级别
            }
          });
        }
      }
    });
  }

  /**
   * 更新视锥体剔除（带包围盒缓存，避免每帧重复计算）
   */
  updateFrustumCulling() {
    // 更新相机的矩阵
    this.camera.updateMatrixWorld();
    
    // 创建视锥体（复用对象，不重复 new）
    if (!this.frustum) {
      this.frustum = new THREE.Frustum();
      this.cameraViewProjectionMatrix = new THREE.Matrix4();
    }
    
    // 更新视锥体
    this.cameraViewProjectionMatrix.multiplyMatrices(
      this.camera.projectionMatrix, 
      this.camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.cameraViewProjectionMatrix);
    
    // 检查所有已加载的建筑（使用缓存Box3，避免每帧 setFromObject 递归遍历）
    this.generatedBuildings.forEach((building, id) => {
      if (building.model) {
        // 缓存包围盒：只在首次或matrixWorld变化时重新计算
        if (!building._cachedBox3 || building.model.matrixWorldNeedsUpdate) {
          building._cachedBox3 = new THREE.Box3().setFromObject(building.model);
        }
        building.model.visible = this.frustum.intersectsBox(building._cachedBox3);
      }
    });
    
    // 检查怪物（缓存包围盒）
    this.monsters.forEach((monster, id) => {
      if (monster.group) {
        if (!monster._cachedBox3 || monster.group.matrixWorldNeedsUpdate) {
          monster._cachedBox3 = new THREE.Box3().setFromObject(monster.group);
        }
        monster.group.visible = this.frustum.intersectsBox(monster._cachedBox3);
      }
    });
    
    // 检查传送门（缓存包围盒）
    this.portals.forEach((portal, id) => {
      if (portal.group) {
        if (!portal._cachedBox3 || portal.group.matrixWorldNeedsUpdate) {
          portal._cachedBox3 = new THREE.Box3().setFromObject(portal.group);
        }
        portal.group.visible = this.frustum.intersectsBox(portal._cachedBox3);
      }
    });
  }

  /**
   * 更新级别细节（LOD）
   */
  updateLOD() {
    // LOD 已禁用：applyLOD 会替换材质导致变白，可见性控制由 updateFrustumCulling 负责
    return;
  }

  /**
   * 应用级别细节到对象
   */
  applyLOD(object, detail) {
    // LOD 材质替换已禁用：将材质替换为 MeshBasicMaterial 会导致模型失去贴图变白
    // 仅通过 updateFrustumCulling 控制可见性即可，无需替换材质
  }

  /**
   * 简化几何体
   */
  simplifyGeometry(mesh, detail) {
    // 存储原始几何体
    if (!mesh.userData.originalGeometry) {
      mesh.userData.originalGeometry = mesh.geometry;
    }
    
    // 确保几何体有uuid
    if (!mesh.geometry.uuid) {
      mesh.geometry.uuid = THREE.MathUtils.generateUUID();
    }
    
    // 根据细节级别创建简化的几何体
    const key = `${mesh.geometry.uuid}_${detail.toFixed(1)}`;
    let simplifiedGeometry = this.lodModels.get(key);
    
    if (!simplifiedGeometry) {
      // 这里使用简化的方法：缩放几何体
      // 实际项目中可以使用几何体简化库，如SimplifyModifier
      simplifiedGeometry = mesh.geometry.clone();
      
      // 简单的几何体简化（示例）
      if (detail < 0.5) {
        // 对于很低的细节级别，可以使用更简单的几何体
        if (mesh.geometry instanceof THREE.BoxGeometry) {
          simplifiedGeometry = new THREE.BoxGeometry(
            mesh.geometry.parameters.width * 0.9,
            mesh.geometry.parameters.height * 0.9,
            mesh.geometry.parameters.depth * 0.9
          );
        } else if (mesh.geometry instanceof THREE.SphereGeometry) {
          simplifiedGeometry = new THREE.SphereGeometry(
            mesh.geometry.parameters.radius,
            Math.max(4, Math.floor(mesh.geometry.parameters.widthSegments * detail)),
            Math.max(2, Math.floor(mesh.geometry.parameters.heightSegments * detail))
          );
        }
      }
      
      // 缓存简化的几何体
      this.lodModels.set(key, simplifiedGeometry);
    }
    
    // 使用简化的几何体
    mesh.geometry = simplifiedGeometry;
  }

  /**
   * 恢复原始几何体
   */
  restoreGeometry(mesh) {
    if (mesh.userData.originalGeometry) {
      mesh.geometry = mesh.userData.originalGeometry;
    }
  }

  /**
   * 创建实例化网格
   */
  createInstancedMesh(key, geometry, material, count) {
    // 检查是否已存在实例化网格
    if (this.instancedMeshes.has(key)) {
      return this.instancedMeshes.get(key);
    }
    
    // 创建实例化网格
    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    instancedMesh.frustumCulled = true; // 启用视锥剔除
    
    // 存储实例化网格
    this.instancedMeshes.set(key, instancedMesh);
    this.scene.add(instancedMesh);
    
    console.log(`✅ 创建实例化网格: ${key} (${count}个实例)`);
    return instancedMesh;
  }

  /**
   * 更新实例化网格的实例
   */
  updateInstancedMesh(instancedMesh, positions, rotations, scales) {
    const dummy = new THREE.Object3D();
    
    for (let i = 0; i < positions.length; i++) {
      dummy.position.set(positions[i].x, positions[i].y, positions[i].z);
      
      if (rotations && rotations[i]) {
        dummy.rotation.set(rotations[i].x, rotations[i].y, rotations[i].z);
      }
      
      if (scales && scales[i]) {
        dummy.scale.set(scales[i].x, scales[i].y, scales[i].z);
      }
      
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    
    instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * 移除实例化网格
   */
  removeInstancedMesh(key) {
    const instancedMesh = this.instancedMeshes.get(key);
    if (instancedMesh) {
      this.scene.remove(instancedMesh);
      instancedMesh.geometry.dispose();
      instancedMesh.material.dispose();
      this.instancedMeshes.delete(key);
      console.log(`✅ 移除实例化网格: ${key}`);
    }
  }

  // ==================== 传送门系统 ====================

  /**
   * 创建传送门3D模型
   * @param {string} portalId - 传送门ID
   * @param {string} name - 传送门名称
   * @param {object} sourcePosition - 源位置 {x, y, z}
   * @param {object} targetPosition - 目标位置 {x, y, z}
   * @param {string} portalType - 传送门类型 (local/remote)
   * @returns {THREE.Group} 传送门模型组
   */
  addPortal(portalId, name, sourcePosition, targetPosition, portalType = 'local') {
    const portalGroup = new THREE.Group();

    // 1. 创建外框 (发光的矩形门框)
    const frameGeometry = new THREE.TorusGeometry(2, 0.15, 16, 32);
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: portalType === 'remote' ? 0xff00ff : 0x00ffff, // 远程传送门为紫色，本地为青色
      emissive: portalType === 'remote' ? 0x8800ff : 0x0088ff,
      emissiveIntensity: 0.8,
      metalness: 0.8,
      roughness: 0.2,
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.rotation.y = Math.PI / 2; // 竖立起来
    portalGroup.add(frame);

    // 2. 创建传送门能量场（半透明旋转圆盘）
    const portalGeometry = new THREE.CircleGeometry(1.9, 32);
    const portalMaterial = new THREE.MeshBasicMaterial({
      color: portalType === 'remote' ? 0xff00ff : 0x00ffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const portalDisc = new THREE.Mesh(portalGeometry, portalMaterial);
    portalDisc.rotation.y = Math.PI / 2;
    portalGroup.add(portalDisc);

    // 3. 添加粒子效果环（发光的小球围绕门框旋转）
    const particleCount = 20;
    const particleGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: portalType === 'remote' ? 0xff88ff : 0x88ffff,
      transparent: true,
      opacity: 0.7,
    });

    const particleRing = [];
    for (let i = 0; i < particleCount; i++) {
      const particle = new THREE.Mesh(particleGeometry, particleMaterial);
      const angle = (i / particleCount) * Math.PI * 2;
      particle.position.set(0, Math.cos(angle) * 2, Math.sin(angle) * 2);
      portalGroup.add(particle);
      particleRing.push({ mesh: particle, angle });
    }

    // 4. 添加点光源（增强发光效果）
    const portalLight = new THREE.PointLight(
      portalType === 'remote' ? 0xff00ff : 0x00ffff,
      2,
      10
    );
    portalGroup.add(portalLight);

    // 5. 创建名称标签
    const nameSprite = this.createPortalNameSprite(name, portalType);
    nameSprite.position.y = 3.5;
    portalGroup.add(nameSprite);

    // 6. 设置传送门位置
    portalGroup.position.set(sourcePosition.x, sourcePosition.y + 2, sourcePosition.z);

    // 7. 添加到场景
    this.scene.add(portalGroup);

    // 8. 存储传送门数据
    this.portals.set(portalId, {
      id: portalId,
      name,
      group: portalGroup,
      sourcePosition,
      targetPosition,
      portalType,
      frame,
      portalDisc,
      particleRing,
      portalLight,
      isActive: true,
      animationTime: 0,
    });

    console.log(`✨ 传送门已创建: ${name} (${portalType})`);
    return portalGroup;
  }

  /**
   * 创建传送门名称标签
   */
  createPortalNameSprite(name, portalType) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // 背景
    ctx.fillStyle = portalType === 'remote' ? 'rgba(128, 0, 255, 0.8)' : 'rgba(0, 136, 255, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 边框
    ctx.strokeStyle = portalType === 'remote' ? '#ff00ff' : '#00ffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

    // 文字
    ctx.fillStyle = '#ffffff';
    ctx.font = 'Bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2 - 10);

    // 类型标识
    ctx.font = 'Bold 24px Arial';
    const typeText = portalType === 'remote' ? '跨服传送门' : '传送门';
    ctx.fillText(typeText, canvas.width / 2, canvas.height / 2 + 30);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(8, 2, 1);

    return sprite;
  }

  /**
   * 更新传送门动画（在主循环中调用）
   * @param {number} delta - 时间增量（毫秒）
   */
  updatePortals(delta) {
    this.portals.forEach((portal) => {
      if (!portal.isActive) return;

      portal.animationTime += delta / 1000;

      // 1. 旋转能量场
      portal.portalDisc.rotation.z += 0.01;

      // 2. 门框脉动发光
      const pulse = Math.sin(portal.animationTime * 2) * 0.3 + 0.7;
      portal.frame.material.emissiveIntensity = pulse;

      // 3. 粒子环旋转
      if (Array.isArray(portal.particleRing)) {
        portal.particleRing.forEach((p) => {
          p.angle += 0.02;
          p.mesh.position.set(
            0,
            Math.cos(p.angle) * 2,
            Math.sin(p.angle) * 2
          );
        });
      } else if (portal.particleRing && portal.particleRing.rotation) {
        // 广告位传送门的单个 Torus 环，原地旋转
        portal.particleRing.rotation.z += 0.02;
      }

      // 4. 光源脉动
      portal.portalLight.intensity = 1 + pulse;
    });
  }

  /**
   * 检查玩家是否接近传送门
   * @param {object} playerPosition - 玩家位置 {x, y, z}
   * @param {number} activationDistance - 激活距离（默认2米）
   * @returns {object|null} 如果接近返回传送门数据，否则返回null
   */
  checkPortalProximity(playerPosition, activationDistance = 2) {
    for (const [portalId, portal] of this.portals) {
      if (!portal.isActive) continue;

      const distance = Math.sqrt(
        Math.pow(playerPosition.x - portal.sourcePosition.x, 2) +
        Math.pow(playerPosition.y - portal.sourcePosition.y, 2) +
        Math.pow(playerPosition.z - portal.sourcePosition.z, 2)
      );

      if (distance < activationDistance) {
        return {
          portalId,
          portal,
          distance,
        };
      }
    }
    return null;
  }

  /**
   * 移除传送门
   * @param {string} portalId - 传送门ID
   */
  removePortal(portalId) {
    const portal = this.portals.get(portalId);
    if (portal) {
      this.scene.remove(portal.group);
      this.portals.delete(portalId);
      console.log(`🚪 传送门已移除: ${portal.name}`);
    }
  }

  /**
   * 获取所有传送门
   * @returns {Map} 传送门集合
   */
  getPortals() {
    return this.portals;
  }

  /**
   * 传送门传送特效
   * @param {object} position - 传送位置
   */
  createTeleportEffect(position) {
    // 创建螺旋上升的光粒子
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 2 * 3; // 3圈螺旋
      const radius = 1.5;
      const height = (i / 30) * 4;

      const geometry = new THREE.SphereGeometry(0.15, 8, 8);
      const material = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 1,
      });
      const particle = new THREE.Mesh(geometry, material);
      
      particle.position.set(
        position.x + Math.cos(angle) * radius,
        position.y + height,
        position.z + Math.sin(angle) * radius
      );

      const velocity = new THREE.Vector3(0, 0.1, 0);

      this.particles.push({
        mesh: particle,
        velocity,
        life: 2, // 2秒寿命
      });

      this.scene.add(particle);
    }
  }

  /**
   * 跨世界传送开始动画
   * @param {object} position - 传送位置
   * @param {function} callback - 动画完成后的回调
   */
  startTeleportAnimation(position, callback) {
    // 创建传送开始的特效：能量球收缩
    const sphereGeometry = new THREE.SphereGeometry(2, 32, 32);
    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.set(position.x, position.y + 1, position.z);
    this.scene.add(sphere);

    // 动画：球体收缩并消失
    const startTime = Date.now();
    const duration = 1000; // 1秒动画

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // 球体收缩
      const scale = 1 - progress;
      sphere.scale.set(scale, scale, scale);
      
      // 透明度降低
      sphere.material.opacity = 0.8 * (1 - progress);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(sphere);
        sphereGeometry.dispose();
        sphereMaterial.dispose();
        if (callback) callback();
      }
    };

    animate();
  }

  /**
   * 跨世界传送结束动画
   * @param {object} position - 传送位置
   */
  endTeleportAnimation(position) {
    // 创建传送结束的特效：能量爆发
    const sphereGeometry = new THREE.SphereGeometry(0.1, 16, 16);
    
    // 爆发粒子
    for (let i = 0; i < 50; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 1,
      });
      const particle = new THREE.Mesh(sphereGeometry, material);
      particle.position.set(position.x, position.y + 1, position.z);
      
      // 随机方向和速度
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 5
      );
      
      this.particles.push({
        mesh: particle,
        velocity,
        life: 1.5,
      });
      
      this.scene.add(particle);
    }
    
    // 创建中心发光效果
    const centerGeometry = new THREE.SphereGeometry(0.5, 32, 32);
    const centerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending
    });
    const centerSphere = new THREE.Mesh(centerGeometry, centerMaterial);
    centerSphere.position.set(position.x, position.y + 1, position.z);
    this.scene.add(centerSphere);
    
    // 中心球体动画
    const startTime = Date.now();
    const duration = 1000;
    
    const animateCenter = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      centerSphere.scale.set(1 + progress * 2, 1 + progress * 2, 1 + progress * 2);
      centerSphere.material.opacity = 1 * (1 - progress);
      
      if (progress < 1) {
        requestAnimationFrame(animateCenter);
      } else {
        this.scene.remove(centerSphere);
        centerGeometry.dispose();
        centerMaterial.dispose();
      }
    };
    
    animateCenter();
  }

  // ==================== 传送门系统结束 ====================

  onWindowResize() {
    const aspectRatio = window.innerWidth / window.innerHeight;
    
    // 使用水平FOV限制法重新计算垂直FOV
    const maxHorizontalFOV = CONFIG.MAX_HORIZONTAL_FOV || 90;
    const minVerticalFOV = CONFIG.MIN_VERTICAL_FOV || 35;
    
    const horizontalFOVRad = maxHorizontalFOV * (Math.PI / 180);
    const verticalFOVRad = 2 * Math.atan(Math.tan(horizontalFOVRad / 2) / aspectRatio);
    const fov = verticalFOVRad * (180 / Math.PI);
    const finalFOV = Math.max(fov, minVerticalFOV);
    
    this.camera.fov = finalFOV;
    this.camera.aspect = aspectRatio;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    
    // 保持固定像素比，提高抗锯齿效果
    const fixedRatio = Math.min(window.devicePixelRatio, 1); // 提高像素比以减少锯齿
    this.renderer.setPixelRatio(fixedRatio);
    
    // 减少日志输出
    if (this.frameCount % 50 === 0) {
      // 窗口调整日志静默
    }
  }

  /**
   * 加载AI生成的建筑模型
   */
  async loadGeneratedBuildings() {
    try {
      // 防止重复加载
      if (this.isLoadingBuildings) {
        console.log('⚠️ 正在加载建筑中，跳过重复调用');
        return;
      }
      
      this.isLoadingBuildings = true;
      const startTime = performance.now();
      console.log('🔄 开始加载生成的建筑...');
      
      // 更新加载状态
      this.updateLoadingStatus(0, 1);
      this.showLoadingProgress();
      
      // 只获取世界对象，不需要获取hunyuan3d/buildings，因为世界对象已经包含了所有已放置的建筑
      // P1: 空间分页——按玩家位置增量拉取，替代一次性全量（返回结构完全兼容）
      let worldObjects;
      if (window.WorldSpatialManager) {
        if (!this._spatialMgr) {
          this._spatialMgr = new window.WorldSpatialManager(this);
        }
        worldObjects = await this._spatialMgr.initialLoad();
      } else {
        // 防御：管理器未加载时回退旧全量接口
        const worldObjectsResponse = await fetch('/api/world/objects');
        worldObjects = await worldObjectsResponse.json();
      }

      if (worldObjects.success) {
        // 获取位置覆盖（用于UUID等不在world_objects表中的对象）
        let transformOverrides = {};
        try {
          const overridesResp = await fetch('/api/world/transform-overrides');
          const overridesData = await overridesResp.json();
          if (overridesData.success && overridesData.overrides) {
            overridesData.overrides.forEach(o => { transformOverrides[o.object_id] = o; });
            console.log(`🔄 加载了 ${Object.keys(transformOverrides).length} 个位置覆盖`);
          }
        } catch (e) {
          console.warn('获取位置覆盖失败:', e.message);
        }
        this._transformOverrides = transformOverrides;

        const generatedBuildingObjects = worldObjects.objects
          .filter(obj => obj.type === 'generated_building');
        
        // 加载所有几何体类型的对象
        const geometryObjects = worldObjects.objects
          .filter(obj => obj.type && obj.type.startsWith('geometry_'));
        
        // 加载上传的模型对象
        const uploadedModelObjects = worldObjects.objects
          .filter(obj => obj.type === 'uploaded_model');
        
        // 加载Three.js生成的模型对象
        const threejsObjects = worldObjects.objects
          .filter(obj => obj.type === 'threejs_code');

        // 加载广告位模型（与上传模型共用加载逻辑）
        const adSlotObjects = worldObjects.objects
          .filter(obj => obj.type === 'ad_slot' && obj.model_path);

        // 加载3DGS高斯场景对象（占位渲染，真实渲染后续接入）
        const gaussianSplatObjects = worldObjects.objects
          .filter(obj => obj.type === 'gaussian_splat');

        // 加载媒体对象（图片/视频）- 延迟加载
        const mediaObjects = worldObjects.objects
          .filter(obj => obj.type === 'media_image' || obj.type === 'media_video');
          
        const totalObjects = generatedBuildingObjects.length + geometryObjects.length + uploadedModelObjects.length + threejsObjects.length + adSlotObjects.length + gaussianSplatObjects.length;
        console.log(`📦 找到 ${totalObjects} 个对象: ${generatedBuildingObjects.length} 建筑, ${geometryObjects.length} 几何体, ${uploadedModelObjects.length} 上传模型, ${threejsObjects.length} Three.js模型, ${adSlotObjects.length} 广告位, ${mediaObjects.length} 媒体对象, ${gaussianSplatObjects.length} 3DGS场景`);

        // 🎯 新策略：几何体 → 媒体 → 模型（三阶段有序加载）
        console.log(`📸 ${mediaObjects.length} 个媒体对象将在几何体完成后立即加载`);

        // 存储所有对象到数组中（媒体对象加入主队列，排在几何体之后、模型之前）
        const allObjects = [
          ...geometryObjects.map(obj => ({ ...obj, loadMethod: 'addGeometryBuilding' })),
          // ✨ 媒体对象加入主队列：几何体完成后立即开始加载媒体
          ...mediaObjects.map(obj => ({ ...obj, loadMethod: 'loadMediaObject' })),
          ...generatedBuildingObjects.map(obj => ({ ...obj, loadMethod: 'addGeneratedBuilding' })),
          ...uploadedModelObjects.map(obj => ({ ...obj, loadMethod: 'addUploadedModel' })),
          ...threejsObjects.map(obj => ({ ...obj, loadMethod: 'addThreeJSModel' })),
          ...adSlotObjects.map(obj => ({ ...obj, loadMethod: 'addAdSlotPortal' })),
          ...gaussianSplatObjects.map(obj => ({ ...obj, loadMethod: 'addGaussianSplat' }))
        ];

        // 清空延迟队列（不再需要延迟加载机制）
        this._pendingMediaObjects = [];

        // 📊 智能优先级排序：[几何体+媒体] > 小GLB > 中GLB > 大GLB（几何体和媒体同级！）
        allObjects.sort((a, b) => {
          // 获取对象大小（字节）
          const sizeA = a.file_size || 0;
          const sizeB = b.file_size || 0;

          // 判断类型
          const aIsGeom = (a.loadMethod === 'addGeometryBuilding');
          const bIsGeom = (b.loadMethod === 'addGeometryBuilding');
          const aIsMedia = (a.loadMethod === 'loadMediaObject'); // ✨ 新增媒体判断
          const bIsMedia = (b.loadMethod === 'loadMediaObject');
          const aIsLarge = sizeA > 15 * 1024 * 1024; // >15MB
          const bIsLarge = sizeB > 15 * 1024 * 1024;
          const aIsMedium = sizeA >= 5 * 1024 * 1024 && sizeA <= 15 * 1024 * 1024; // 5-15MB
          const bIsMedium = sizeB >= 5 * 1024 * 1024 && sizeB <= 15 * 1024 * 1024;

          // ✨ 第1优先级：几何体 + 媒体（合并为同一级别，一起加载！）
          const aIsPriority1 = aIsGeom || aIsMedia;  // 几何体或媒体都是最高优先级
          const bIsPriority1 = bIsGeom || bIsMedia;
          
          if (aIsPriority1 && !bIsPriority1) return -1;  // 几何体/媒体 排前面
          if (!aIsPriority1 && bIsPriority1) return 1;   // GLB模型 排后面

          // 第2-4优先级：GLB模型按大小分级
          const getPriority = (size, isLarge, isMedium) => {
            if (isLarge) return 4;  // 大型GLB排最后
            if (isMedium) return 3; // 中型GLB
            return 2;               // 小型GLB (<5MB)
          };
          
          const priorityA = getPriority(sizeA, aIsLarge, aIsMedium);
          const priorityB = getPriority(sizeB, bIsLarge, bIsMedium);
          
          if (priorityA !== priorityB) return priorityA - priorityB;
          
          // 同级别按大小升序（小文件先加载）
          return sizeA - sizeB;
        });

        console.log(`📊 排序完成: 几何体+媒体=${geometryObjects.length + mediaObjects.length}(同优先级), GLB模型=${allObjects.length - geometryObjects.length - mediaObjects.length}`);
        
        // 使用Worker处理世界对象数据
        this.sendToWorker('processWorldObjects', allObjects, (processedObjects) => {
          // 替换而不是添加，避免对象重复
          this.allWorldObjects = processedObjects;
          console.log(`✅ 已存储 ${this.allWorldObjects.length} 个对象，等待动态加载`);
          
          // 清理已加载的建筑，避免内存泄漏
          this.generatedBuildings.forEach((building, id) => {
            if (building && building.model) {
              this.scene.remove(building.model);
              if (building.model.userData.label) {
                this.scene.remove(building.model.userData.label);
              }
              if (!building.isPlaceholder) {
                building.model.traverse(child => {
                  if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                      if (Array.isArray(child.material)) {
                        child.material.forEach(material => material.dispose());
                      } else {
                        child.material.dispose();
                      }
                    }
                    if (child.material && child.material.map) {
                      child.material.map.dispose();
                    }
                  }
                });
              }
            }
          });
          this.generatedBuildings.clear();
          this.collisionObjects = [];

          // 重新注册出生点碰撞体（如果出生点已创建）
          if (this.spawnPoint) {
            this.collisionObjects.push({
              _isSpawnCollider: true,
              type: 'box',
              position: this.spawnPoint.position.clone(),
              size: { width: 4, height: 0.1, depth: 4 }
            });
          }

          // 清空已加载对象，将 allWorldObjects 填充到加载队列
          this.loadedObjects.clear();
          this.loadingBatch = [];
          
          // 两阶段加载策略：
          // 阶段1：瞬间完成（<100ms）- 为所有有 model_path 的对象放置占位符，几何体建筑直接加载
          // 阶段2：后台异步 - 逐个加载真实模型替换占位符
          
          // 预先为所有有 model_path 的对象放置加载中占位符（蓝色方块+名称标签）
          const modelsWithPath = this.allWorldObjects.filter(obj => 
            obj.model_path && obj.model_path !== '' && 
            !(obj.type && obj.type.startsWith('geometry_'))
          );
          if (modelsWithPath.length > 0) {
            console.log(`🎯 两阶段加载：预先放置 ${modelsWithPath.length} 个模型占位符（几何体建筑将直接加载）`);
            modelsWithPath.forEach(obj => {
              this.addPlaceholderBuilding(obj.id, obj, 'loading');
              this.updateLargeModelProgress(obj.name || '模型', 0);
            });
          }
          
          // 将所有世界对象填充到加载队列，开始动态加载
          this.loadingQueue = [...this.allWorldObjects];
          console.log(`🚀 开始动态加载 ${this.loadingQueue.length} 个对象`);
          
          // 延迟应用位置覆盖（等待所有对象加载完成）
          this._scheduleApplyTransformOverrides();
          
          // 强制垃圾回收（如果可用）
          if (window.gc) {
            window.gc();
          }
          
          // 更新加载状态
          this.updateLoadingStatus(0, this.allWorldObjects.length);
          this.showLoadingProgress();
          this.isLoadingBuildings = false;
        });
      } else {
        this.isLoadingBuildings = false;
      }
    } catch (error) {
      console.error('加载生成建筑失败:', error);
      // 更新加载状态为完成（失败）
      this.updateLoadingStatus(1, 1);
      this.showLoadingProgress();
      this.isLoadingBuildings = false;
    }
  }

  /**
   * 调度应用位置覆盖（等待所有对象加载完成）
   */
  _scheduleApplyTransformOverrides() {
    if (!this._transformOverrides || Object.keys(this._transformOverrides).length === 0) return;
    
    const checkAndApply = () => {
      // 等待加载队列和批次都为空
      if (this.loadingQueue.length > 0 || this.loadingBatch.length > 0) {
        setTimeout(checkAndApply, 500);
        return;
      }
      this._applyTransformOverrides();
    };
    // 首次检查延迟5秒，给对象加载时间
    setTimeout(checkAndApply, 5000);
  }

  /**
   * 应用位置覆盖到场景中匹配的对象
   */
  _applyTransformOverrides() {
    if (!this._transformOverrides) return;
    const overrideIds = Object.keys(this._transformOverrides);
    let applied = 0;

    overrideIds.forEach(objectId => {
      const ov = this._transformOverrides[objectId];

      // 方法1: 在generatedBuildings中查找
      const entry = this.generatedBuildings.get(objectId);
      if (entry && entry.model) {
        // 【修复】跳过有正规数据来源的对象（ad_slots、geometry_buildings等）
        // 这些对象的坐标已从数据库正确加载，不应被override表覆盖
        if (entry._isAdSlot || entry.isGeometry) {
          console.log(`⏭️ 跳过override: ${objectId} (有正规数据来源: ${entry._isAdSlot ? 'adSlot' : 'geometry'})`);
          return;
        }

        entry.model.position.set(ov.position_x || 0, ov.position_y || 0, ov.position_z || 0);
        entry.model.rotation.set(ov.rotation_x || 0, ov.rotation_y || 0, ov.rotation_z || 0);
        entry.model.scale.set(ov.scale_x || 1, ov.scale_y || 1, ov.scale_z || 1);
        applied++;
        return;
      }

      // 方法2: 遍历场景查找匹配的对象
      this.scene.traverse(child => {
        if (child.userData && child.userData.worldObjectId === objectId) {
          // 【修复】同样检查是否为需要跳过的对象类型
          const sceneEntry = this.generatedBuildings.get(objectId);
          if (sceneEntry && (sceneEntry._isAdSlot || sceneEntry.isGeometry)) {
            return; // 已在方法1中跳过，这里再次防护
          }

          // 【修复】是否为媒体对象（图片/视频平面）
          const isMediaObject = !!(child.userData.mediaType);

          child.position.set(ov.position_x || 0, ov.position_y || 0, ov.position_z || 0);
          child.rotation.set(ov.rotation_x || 0, ov.rotation_y || 0, ov.rotation_z || 0);

          if (isMediaObject) {
            // 媒体对象：scale 已编码在 PlaneGeometry 中，不覆盖
            // 仅当 override 中的 scale 与默认值不同且非 (1,1,1) 时才警告
            const ovScaleX = ov.scale_x ?? 1;
            const ovScaleY = ov.scale_y ?? 1;
            const ovScaleZ = ov.scale_z ?? 1;
            if (ovScaleX !== 1 || ovScaleY !== 1 || ovScaleZ !== 1) {
              console.log(`⏭️ 媒体对象 "${child.userData.name}" 跳过 scale 覆盖 (override值: ${ovScaleX}, ${ovScaleY}, ${ovScaleZ}), 保持 (1,1,1)`);
            }
          } else {
            child.scale.set(ov.scale_x || 1, ov.scale_y || 1, ov.scale_z || 1);
          }
          applied++;
        }
      });
    });

    if (applied > 0) {
      console.log(`✅ 已应用 ${applied} 个位置覆盖`);
    }
  }

  /**
   * 从模型缓存获取模型
   */
  async getFromModelCache(modelPath) {
    // 先检查内存缓存
    const cachedItem = this.modelCache.get(modelPath);
    if (cachedItem) {
      // 更新最后使用时间
      cachedItem.lastUsed = Date.now();
      return cachedItem.model;
    }
    
    // 检查本地缓存
    try {
      const cachedData = await this.modelCacheDB.getModel(modelPath);
      if (cachedData) {
        console.log('✅ 从本地缓存加载模型:', modelPath);
        // 从缓存数据重建模型
        const model = await this.reconstructModelFromCache(cachedData, modelPath);
        if (model) {
          // 更新内存缓存
          this.addToModelCache(modelPath, model);
          return model;
        }
      }
    } catch (error) {
      console.warn('Failed to get model from local cache:', error);
    }
    
    return null;
  }

  /**
   * 将模型添加到缓存
   */
  async addToModelCache(modelPath, model) {
    // 检查缓存大小
    if (this.modelCache.size >= this.maxModelCacheSize) {
      // 移除最久未使用的模型
      let oldestKey = null;
      let oldestTime = Infinity;
      
      this.modelCache.forEach((item, key) => {
        if (item.lastUsed < oldestTime) {
          oldestTime = item.lastUsed;
          oldestKey = key;
        }
      });
      
      if (oldestKey) {
        this.modelCache.delete(oldestKey);
      }
    }
    
    // 添加到内存缓存
    this.modelCache.set(modelPath, {
      model: model,
      lastUsed: Date.now()
    });
    
    // 存储到本地缓存
    try {
      const modelData = await this.serializeModel(model, modelPath);
      if (modelData) {
        await this.modelCacheDB.storeModel(modelPath, modelData, {
          type: modelPath.split('.').pop().toLowerCase()
        });
        console.log('✅ 模型已存储到本地缓存:', modelPath);
      }
    } catch (error) {
      console.warn('Failed to store model to local cache:', error);
    }
  }

  /**
   * 添加生成的建筑到场景
   */
  async addGeneratedBuilding(buildingData) {
    const { id, model_path, position_x, position_y, position_z, 
            rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, name } = buildingData;

    if (!model_path) {
      console.warn('建筑模型路径为空:', buildingData);
      return;
    }

    // 检查是否已加载（注意：占位符不算"已加载"，允许替换）
    const existingEntry = this.generatedBuildings.get(id);
    if (existingEntry && !existingEntry.isPlaceholder) {
      console.log('建筑已加载，跳过:', id);
      return;
    }
    // 如果是占位符，继续执行，后续会自动移除并替换
    
    // 检查内存使用情况，如果内存使用过高，跳过加载
    if (performance.memory) {
      const memoryUsedMB = performance.memory.usedJSHeapSize / 1024 / 1024;
      if (memoryUsedMB > 200) {
        console.warn(`⚠️ 内存使用过高 (${memoryUsedMB.toFixed(2)}MB)，跳过加载建筑: ${name}`);
        return;
      }
    }

    // 优化模型加载
    const optimizedModelPath = this.optimizeModelLoading(model_path);
    console.log('开始加载模型文件:', optimizedModelPath);

    // 判断文件类型
    const isOBJ = optimizedModelPath.toLowerCase().endsWith('.obj');
    const isGLTF = optimizedModelPath.toLowerCase().endsWith('.gltf') || optimizedModelPath.toLowerCase().endsWith('.glb');

    // 检查模型缓存中是否存在该模型
    try {
      const cachedModel = await this.getFromModelCache(optimizedModelPath);
      if (cachedModel) {
        console.log('✅ 从缓存加载模型:', optimizedModelPath);
        const model = cachedModel.clone();
        
        // 设置位置
        model.position.set(position_x, position_y, position_z);
        
        // 设置旋转
        model.rotation.set(rotation_x, rotation_y, rotation_z);
        
        // 设置缩放
        model.scale.set(scale_x, scale_y, scale_z);
        
        // 启用阴影
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // 【修复】先移除占位符（如果存在），再添加真实模型
        this.removePlaceholder(id);

        // 添加到场景（预编译着色器，防止渲染循环中懒编译导致卡顿）
        this._addModelToScene(model);
        
        // 设置 userData 用于射线选中的回退匹配
        model.userData.worldObjectId = id;
        model.userData.name = name;
        
        // 保存引用
        this.generatedBuildings.set(id, {
          model,
          data: buildingData
        });

        // 添加碰撞盒（仅当 has_collision 为 true 时）
        if (buildingData.has_collision === true) {
          const box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          box.getSize(size);
          
          // 检查是否已存在相同位置的碰撞对象，使用更精确的判断
          const existingCollisionIndex = this.collisionObjects.findIndex(collisionObj => 
            collisionObj.position && 
            Math.abs(collisionObj.position.x - model.position.x) < 0.01 &&
            Math.abs(collisionObj.position.y - model.position.y) < 0.01 &&
            Math.abs(collisionObj.position.z - model.position.z) < 0.01
          );
          
          if (existingCollisionIndex === -1) {
            this.collisionObjects.push({
              type: 'box',
              id: id, // 添加ID以便后续清理
              position: model.position.clone(),
              size: { 
                width: size.x, 
                height: size.y, 
                depth: size.z 
              }
            });
          }

          // 添加标签
          this.addBuildingLabel(model, name, position_y + size.y + 1);
        }

        console.log(`✅ 建筑 "${name}" 已加载到世界`);
        return; // 从缓存加载后直接返回，避免重复加载
      }
    } catch (error) {
      console.warn('Failed to get model from cache:', error);
    }

    // 处理模型加载成功后的逻辑
    const onModelLoaded = async (model, modelData) => {
      
      // 将模型添加到缓存中
      await this.addToModelCache(optimizedModelPath, model);
      
      // 存储原始模型数据到本地缓存
      if (modelData) {
        try {
          await this.modelCacheDB.storeModel(optimizedModelPath, modelData, {
            type: optimizedModelPath.split('.').pop().toLowerCase()
          });
          console.log('✅ 模型数据已存储到本地缓存:', optimizedModelPath);
        } catch (error) {
          console.warn('Failed to store model data to local cache:', error);
        }
      }
      
      // 创建模型的克隆
      const modelClone = model.clone();
      
      // 设置位置
      modelClone.position.set(position_x, position_y, position_z);
      
      // 设置旋转
      modelClone.rotation.set(rotation_x, rotation_y, rotation_z);
      
      // 设置缩放
      modelClone.scale.set(scale_x, scale_y, scale_z);
      
      // 启用阴影
      modelClone.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          // 优化材质
          this.optimizeMaterial(child);
        }
      });

      // 【修复】先移除占位符（如果存在），再添加真实模型
      this.removePlaceholder(id);

      // 添加到场景（预编译着色器）
      this._addModelToScene(modelClone);
      
      // 设置 userData 用于射线选中的回退匹配
      modelClone.userData.worldObjectId = id;
      modelClone.userData.name = name;
      
      // 保存引用
      this.generatedBuildings.set(id, {
        model: modelClone,
        data: buildingData
      });

      // 添加碰撞盒（仅当 has_collision 为 true 时）
      if (buildingData.has_collision === true) {
        const box = new THREE.Box3().setFromObject(modelClone);
        const size = new THREE.Vector3();
        box.getSize(size);
        
        // 检查是否已存在相同位置的碰撞对象，使用更精确的判断
        const existingCollisionIndex = this.collisionObjects.findIndex(collisionObj => 
          collisionObj.position && 
          Math.abs(collisionObj.position.x - modelClone.position.x) < 0.01 &&
          Math.abs(collisionObj.position.y - modelClone.position.y) < 0.01 &&
          Math.abs(collisionObj.position.z - modelClone.position.z) < 0.01
        );
        
        if (existingCollisionIndex === -1) {
          this.collisionObjects.push({
            type: 'box',
            id: id, // 添加ID以便后续清理
            position: modelClone.position.clone(),
            size: { 
              width: size.x, 
              height: size.y, 
              depth: size.z 
            }
          });
        }

        // 添加标签
        this.addBuildingLabel(modelClone, name, position_y + size.y + 1);
      }

      console.log(`✅ 建筑 "${name}" 已加载到世界`);
    };

    // 加载OBJ模型（Promise包裹，确保异步加载完成才返回）
    if (isOBJ) {
      await new Promise((resolve) => {
      // 尝试两个可能的MTL文件名：1) material.mtl（上传接口的命名）2) 同名.mtl
      const mtlFileName1 = 'material.mtl';
      const mtlFileName2 = optimizedModelPath.substring(optimizedModelPath.lastIndexOf('/') + 1).replace('.obj', '.mtl');
      const basePath = optimizedModelPath.substring(0, optimizedModelPath.lastIndexOf('/') + 1);

      console.log('🔄 加载OBJ模型:', optimizedModelPath);
      console.log('📂 资源目录:', basePath);
      console.log('📂 尝试MTL文件名:', [mtlFileName1, mtlFileName2]);

      // 添加加载超时保护
      let loadingTimeout = setTimeout(() => {
        console.warn(`⚠️ 建筑 "${name}" 加载超时，使用占位符`);
        this.addPlaceholderBuilding(id, buildingData);
        resolve();
      }, 30000); // 30秒超时

      // 尝试加载MTL材质的函数
      const tryLoadMTL = (mtlFileName, callback, errorCallback) => {
        this.mtlLoader.setPath(basePath);
        this.mtlLoader.setResourcePath(basePath); // 纹理文件也在这个目录
        
        this.mtlLoader.load(
          mtlFileName,
          callback,
          undefined,
          errorCallback
        );
      };

      // 先尝试 material.mtl
      tryLoadMTL(
        mtlFileName1,
        (materials) => {
          console.log(`✅ MTL材质加载成功 (${mtlFileName1})`);
          console.log('  - 材质列表:', Object.keys(materials.materials));
          
          // 检查材质中的纹理
          Object.keys(materials.materials).forEach(matName => {
            const mat = materials.materials[matName];
            console.log(`  - 材质 "${matName}":`, {
              map: mat.map ? '有纹理' : '无纹理',
              mapUrl: mat.map ? mat.map.image?.src || '加载中' : 'N/A',
              color: mat.color
            });
            // 优化纹理
            if (mat.map) {
              this.optimizeTexture(mat.map);
            }
          });
          
          // 缓存材质
          const materialCacheKey = `mtl_${basePath}${mtlFileName1}`;
          this.cacheMaterial(materialCacheKey, materials);
          
          // 预加载所有纹理
          materials.preload();
          
          // 等待纹理加载完成
          setTimeout(() => {
            console.log('📸 检查纹理加载状态:');
            Object.keys(materials.materials).forEach(matName => {
              const mat = materials.materials[matName];
              if (mat.map) {
                console.log(`  - "${matName}" 纹理:`, {
                  loaded: mat.map.image?.complete || false,
                  width: mat.map.image?.width || 0,
                  height: mat.map.image?.height || 0,
                  src: mat.map.image?.src || 'unknown'
                });
              }
            });
            
            // 加载OBJ模型
            this.objLoader.setMaterials(materials);
            this.objLoader.load(
              optimizedModelPath,
              (obj) => {
                clearTimeout(loadingTimeout);
                console.log('✅ OBJ模型加载成功（带材质）');
                // 检查并应用材质
                let meshCount = 0;
                obj.traverse((child) => {
                  if (child.isMesh) {
                    meshCount++;
                    console.log(`网格 #${meshCount}:`, {
                      name: child.name,
                      hasMaterial: !!child.material,
                      hasMap: child.material?.map ? true : false,
                      materialType: child.material?.type,
                      color: child.material?.color?.getHexString()
                    });
                    
                    // 确保材质可见
                    if (child.material) {
                      child.material.side = THREE.DoubleSide;
                      child.material.needsUpdate = true;
                      
                      // 优化材质
                      this.optimizeMaterial(child);
                      
                      // 如果没有纹理，设置默认颜色
                      if (!child.material.map) {
                        console.warn(`  ⚠️ 网格 #${meshCount} 没有纹理，设置默认颜色`);
                        child.material.color.setHex(0x8b7355);
                      } else {
                        console.log(`  ✅ 网格 #${meshCount} 有纹理`);
                        // 优化纹理
                        this.optimizeTexture(child.material.map);
                      }
                    }
                  }
                });
                console.log(`总共 ${meshCount} 个网格`);
                onModelLoaded(obj);
                resolve();
              },
              () => {},
              (error) => {
                clearTimeout(loadingTimeout);
                console.error(`加载建筑 "${name}" 失败:`, error);
                this.addPlaceholderBuilding(id, buildingData);
                resolve();
              }
            );
          }, 500); // 等待500ms让纹理加载
        },
        (error) => {
          console.warn(`⚠️ ${mtlFileName1} 加载失败，尝试 ${mtlFileName2}...`);
          
          // 尝试第二个文件名
          if (mtlFileName2 !== mtlFileName1) {
            tryLoadMTL(
              mtlFileName2,
              (materials) => {
                console.log(`✅ MTL材质加载成功 (${mtlFileName2})`);
                console.log('  - 材质列表:', Object.keys(materials.materials));
                
                // 检查材质中的纹理
                Object.keys(materials.materials).forEach(matName => {
                  const mat = materials.materials[matName];
                  console.log(`  - 材质 "${matName}":`, {
                    map: mat.map ? '有纹理' : '无纹理',
                    mapUrl: mat.map ? mat.map.image?.src || '加载中' : 'N/A',
                    color: mat.color
                  });
                  // 优化纹理
                  if (mat.map) {
                    this.optimizeTexture(mat.map);
                  }
                });
                
                // 缓存材质
                const materialCacheKey = `mtl_${basePath}${mtlFileName2}`;
                this.cacheMaterial(materialCacheKey, materials);
                
                // 预加载所有纹理
                materials.preload();
                
                // 等待纹理加载完成
                setTimeout(() => {
                  // 加载OBJ模型
                  this.objLoader.setMaterials(materials);
                  this.objLoader.load(
                    optimizedModelPath,
                    (obj) => {
                      clearTimeout(loadingTimeout);
                      console.log('✅ OBJ模型加载成功（带材质）');
                      // 检查并应用材质
                      let meshCount = 0;
                      obj.traverse((child) => {
                        if (child.isMesh) {
                          meshCount++;
                          console.log(`网格 #${meshCount}:`, {
                            name: child.name,
                            hasMaterial: !!child.material,
                            hasMap: child.material?.map ? true : false,
                            materialType: child.material?.type,
                            color: child.material?.color?.getHexString()
                          });
                          
                          // 确保材质可见
                          if (child.material) {
                            child.material.side = THREE.DoubleSide;
                            child.material.needsUpdate = true;
                            
                            // 优化材质
                            this.optimizeMaterial(child);
                            
                            // 如果没有纹理，设置默认颜色
                            if (!child.material.map) {
                              console.warn(`  ⚠️ 网格 #${meshCount} 没有纹理，设置默认颜色`);
                              child.material.color.setHex(0x8b7355);
                            } else {
                              console.log(`  ✅ 网格 #${meshCount} 有纹理`);
                              // 优化纹理
                              this.optimizeTexture(child.material.map);
                            }
                          }
                        }
                      });
                      console.log(`总共 ${meshCount} 个网格`);
                      onModelLoaded(obj);
                      resolve();
                    },
                    () => {},
                    (error) => {
                clearTimeout(loadingTimeout);
                console.error(`加载建筑 "${name}" 失败:`, error);
                this.addPlaceholderBuilding(id, buildingData);
                resolve();
              }
            );
          }, 500); // 等待500ms让纹理加载
        },
        (error2) => {
                console.warn('⚠️ 所有MTL文件加载失败，使用默认材质');
                loadOBJWithoutMTL();
              }
            );
          } else {
            loadOBJWithoutMTL();
          }
        }
      );

      // 不带MTL加载OBJ的函数
      const loadOBJWithoutMTL = () => {
        this.objLoader.load(
          optimizedModelPath,
          (obj) => {
            clearTimeout(loadingTimeout);
            console.log('✅ OBJ模型加载成功（无材质）');
            obj.traverse((child) => {
              if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({
                  color: 0x8b7355,
                  roughness: 0.8,
                  metalness: 0.2,
                  side: THREE.DoubleSide
                });
              }
            });
            onModelLoaded(obj);
            resolve();
          },
          undefined,
          (error) => {
            clearTimeout(loadingTimeout);
            console.error('❌ OBJ加载失败:', error);
            this.addPlaceholderBuilding(id, buildingData);
            resolve();
          }
        );
      };
      }); // 关闭 OBJ 加载 Promise
    } 
    // 加载GLTF/GLB模型
    else if (isGLTF) {
      const isLarge = this.isLargeModel(buildingData);
      
      // 大模型：先放占位符，跟踪进度，加载完后替换
      if (isLarge) {
        this.addPlaceholderBuilding(id, buildingData, 'loading');
        
        await new Promise((resolve) => {
          this.loadModelWithRealProgress(
            optimizedModelPath,
            name,
            (gltf) => {
              this.removePlaceholder(id);
              gltf.scene.traverse((child) => {
                if (child.isMesh) {
                  this.optimizeMaterial(child);
                  if (child.material.map) {
                    this.optimizeTexture(child.material.map);
                  }
                }
              });
              onModelLoaded(gltf.scene);
              resolve();
            },
            (error) => {
              console.error(`加载大模型 "${name}" 失败:`, error);
              this.addPlaceholderBuilding(id, buildingData, 'failed');
              resolve();
            },
            60000
          );
        });
      } else {
        // 小模型：显示占位符 + 真实进度下载
        this.addPlaceholderBuilding(id, buildingData, 'loading');
        
        await new Promise((resolve) => {
          this.loadModelWithRealProgress(
            optimizedModelPath,
            name,
            (gltf) => {
              this.removePlaceholder(id);
              gltf.scene.traverse((child) => {
                if (child.isMesh) {
                  this.optimizeMaterial(child);
                  if (child.material.map) {
                    this.optimizeTexture(child.material.map);
                  }
                }
              });
              onModelLoaded(gltf.scene);
              resolve();
            },
            (error) => {
              console.error(`加载建筑 "${name}" 失败:`, error);
              this.removePlaceholder(id);
              this.addPlaceholderBuilding(id, buildingData, 'failed');
              resolve();
            },
            30000
          );
        });
      }
    } 
    // 不支持的格式
    else {
      console.error(`不支持的模型格式: ${optimizedModelPath}`);
      this.addPlaceholderBuilding(id, buildingData);
    }
  }

  /**
   * 添加建筑标签
   */
  addBuildingLabel(model, text, height) {
    // 标签已禁用：Canvas Texture 会造成严重内存泄漏
    return;
  }

  /**
   * 添加占位符建筑（status='loading' 时显示加载中蓝色占位符+名称标签，status='failed' 时显示紫色错误占位符）
   */
  addPlaceholderBuilding(id, buildingData, status = 'failed') {
    // 【修复】遍历场景，移除所有同名占位符（防止对象池复用导致的残留）
    const toRemove = [];
    this.scene.traverse((child) => {
      if (child.userData && child.userData.worldObjectId === id &&
          child.userData.isLoadingPlaceholder !== undefined) {
        toRemove.push(child);
      }
    });
    toRemove.forEach(obj => {
      this.scene.remove(obj);
    });

    // 【修复】如果已存在同id的旧占位符，先移除（防止两阶段加载重复创建）
    const existingEntry = this.generatedBuildings.get(id);
    if (existingEntry && existingEntry.isPlaceholder) {
      this.scene.remove(existingEntry.model);
      this.recycleToPool('placeholders', existingEntry.model);
    }

    const { position_x, position_y, position_z, name } = buildingData;
    const isLoading = status === 'loading';
    
    // 从对象池获取占位符
    let placeholder = this.getFromPool('placeholders');
    
    // 如果对象池没有可用对象，创建新的
    if (!placeholder) {
      const geometry = new THREE.BoxGeometry(5, 6, 5);
      const material = new THREE.MeshStandardMaterial({
        color: isLoading ? 0x00ccff : 0x667eea,
        emissive: isLoading ? 0x006688 : 0x333366,
        transparent: true,
        opacity: isLoading ? 0.5 : 0.7
      });
      placeholder = new THREE.Mesh(geometry, material);
    } else {
      // 重设材质颜色
      if (placeholder.material) {
        placeholder.material.color.set(isLoading ? 0x00ccff : 0x667eea);
        placeholder.material.emissive.set(isLoading ? 0x006688 : 0x333366);
        placeholder.material.opacity = isLoading ? 0.5 : 0.7;
      }
    }
    
    placeholder.position.set(position_x, position_y + 3, position_z);
    placeholder.castShadow = true;
    placeholder.receiveShadow = true;
    placeholder.visible = true;
    
    this.scene.add(placeholder);
    
    // 添加名称标签（Canvas纹理+Sprite，避免DOM泄露）
    if (isLoading && name) {
      const label = this.createNameSprite(name);
      if (label) {
        label.position.y = 5; // 放在占位符顶部上方（调高为进度数字留空间）
        placeholder.add(label);
        placeholder.userData.label = label;
      }
      
      // 添加进度数字 sprite（初始显示"下载中"，如有文件大小则显示预期大小）
      const expectedSize = buildingData.file_size || 0;
      const progressSprite = this.createProgressSprite(1, 'loading', expectedSize || null);
      if (progressSprite) {
        progressSprite.position.y = 0;
        placeholder.add(progressSprite);
        placeholder.userData.progressSprite = progressSprite;
      }
      
      // 存储预期文件大小并立即启动模拟进度
      const sanitizedId = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
      const totalBytes = buildingData.file_size || 0;
      console.log('[进度调试-1] addPlaceholderBuilding:', { name, rawFileSize: buildingData.file_size, totalBytes });
      if (!this._modelExpectedBytes) this._modelExpectedBytes = new Map();
      if (totalBytes > 0) this._modelExpectedBytes.set(sanitizedId, totalBytes);
      this._startProgressSimulation(sanitizedId, name, totalBytes);
    }
    
    // 设置 userData 用于射线选中的回退匹配
    placeholder.userData.worldObjectId = id;
    placeholder.userData.name = name;
    placeholder.userData.isLoadingPlaceholder = isLoading;
    
    this.generatedBuildings.set(id, {
      model: placeholder,
      data: buildingData,
      isPlaceholder: true,
      isLoadingPlaceholder: isLoading
    });

    console.log(`📦 占位符: ${name} (${isLoading ? '加载中' : '失败'})`);
  }

  /**
   * 移除占位符并将占位符回收到对象池
   */
  removePlaceholder(id) {
    // 从 generatedBuildings 移除记录的引用
    const entry = this.generatedBuildings.get(id);
    if (entry && entry.isPlaceholder) {
      this.scene.remove(entry.model);
      this.recycleToPool('placeholders', entry.model);
    }

    // 【新增】防御性清理：遍历场景，移除所有匹配 worldObjectId 的占位符对象
    // 防止对象池复用导致残留的"幽灵占位符"（在场景中但不在 generatedBuildings 追踪中）
    const toRemove = [];
    this.scene.traverse((child) => {
      if (child.userData && child.userData.worldObjectId === id &&
          child.userData.isLoadingPlaceholder !== undefined) {
        toRemove.push(child);
      }
    });
    toRemove.forEach(obj => {
      this.scene.remove(obj);
      // 如果这个对象不是 generatedBuildings 里记录的那个，销毁它避免内存泄漏
      if (obj !== (entry && entry.model)) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      }
    });

    this.generatedBuildings.delete(id);
  }

  /**
   * 判断对象是否为大模型（需要后台加载+占位符+进度）
   */
  isLargeModel(buildingData) {
    return (buildingData.file_size || 0) > this.LARGE_MODEL_THRESHOLD;
  }

  /**
   * 判断是否为手机端/平板（宽屏阈值1024，同时识别触摸设备）
   */
  _isMobile() {
    const isSmallScreen = window.innerWidth <= 1024;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    return isSmallScreen || isTouchDevice;
  }

  /**
   * 创建大模型加载进度面板（已废弃：进度改为占位符上方显示）
   */
  createLargeModelPanel() {
    // 不做任何DOM操作，进度通过占位符 sprite 显示
  }

  /**
   * 用 fetch + ReadableStream 真实下载进度加载 GLB 模型
   * 100% 真实字节数，不依赖 THREE.js onProgress
   */
  async loadModelWithRealProgress(url, name, onComplete, onError, timeout = 120000) {
    const sanitizedId = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');

    // 先获取 Content-Length
    let totalBytes = 0;
    try {
      const headResp = await fetch(url, { method: 'HEAD' });
      totalBytes = parseInt(headResp.headers.get('Content-Length')) || 0;
    } catch (e) {}

    if (totalBytes > 0) {
      if (!this._modelExpectedBytes) this._modelExpectedBytes = new Map();
      this._modelExpectedBytes.set(sanitizedId, totalBytes);
    }

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.warn(`⚠️ 模型 "${name}" 加载超时`);
      if (onError) onError(new Error('timeout'));
    }, timeout);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      if (totalBytes === 0) {
        totalBytes = parseInt(response.headers.get('Content-Length')) || 0;
        if (totalBytes > 0) {
          if (!this._modelExpectedBytes) this._modelExpectedBytes = new Map();
          this._modelExpectedBytes.set(sanitizedId, totalBytes);
        }
      }

      const reader = response.body.getReader();
      const chunks = [];
      let loadedBytes = 0;

      while (true) {
        if (timedOut) throw new Error('timeout');
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loadedBytes += value.length;
        this.updateLargeModelProgress(name, loadedBytes, true);
        if (loadedBytes <= 65536) console.log('[进度调试-2] chunk到达:', { name, loadedBytes }); // 只打印前64KB避免刷屏
      }

      if (timedOut) return;
      clearTimeout(timeoutHandle);

      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const arrayBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        arrayBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      this.gltfLoader.parse(
        arrayBuffer.buffer,
        '',
        (gltf) => {
          this._showCompleteOnPlaceholder(name);
          if (onComplete) onComplete(gltf);
        },
        (error) => {
          console.error(`❌ GLTFLoader.parse 失败:`, error);
          if (onError) onError(error);
        }
      );

    } catch (error) {
      if (timedOut) return;
      clearTimeout(timeoutHandle);
      console.error(`❌ 模型 "${name}" fetch 下载失败:`, error);
      if (onError) onError(error);
    }
  }

  /**
   * 更新大模型加载进度（在占位符上方显示下载字节数）
   */
  updateLargeModelProgress(name, value, isRealProgress = false, mode = null) {
    const sanitizedId = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    
    // 全部使用 bytes 模式：存储下载字节数，显示 KB/MB
    if (!this._modelRealBytes) this._modelRealBytes = new Map();
    if (!this._modelExpectedBytes) this._modelExpectedBytes = new Map();
    
    // 存储真实字节数
    if (isRealProgress && value > 0) {
      this._modelRealBytes.set(sanitizedId, value);
    }
    
    const displayValue = value > 0 ? value : (this._modelRealBytes.get(sanitizedId) || 0);
    const totalBytes = this._modelExpectedBytes.get(sanitizedId) || null;
    
    // 查找对应的占位符
    let targetPlaceholder = null;
    for (const [id, entry] of this.generatedBuildings.entries()) {
      if (entry.isPlaceholder && entry.isLoadingPlaceholder && entry.data && entry.data.name === name) {
        targetPlaceholder = entry.model;
        break;
      }
    }
    
    if (!targetPlaceholder) {
      console.log('[进度调试-3] 未找到占位符! 查找name=', name, ' 当前占位符列表:', [...this.generatedBuildings.entries()].filter(e => e[1].isPlaceholder).map(e => e[1].data?.name));
      return;
    }
    
    // displayValue 为 0 且有模拟动画在跑时，不替换 sprite（保持模拟显示）
    if (displayValue === 0 && this._simIntervals && this._simIntervals.has(sanitizedId)) return;
    
    // 更新进度 sprite
    const oldSprite = targetPlaceholder.userData.progressSprite;
    if (oldSprite) {
      targetPlaceholder.remove(oldSprite);
      if (oldSprite.material) {
        if (oldSprite.material.map) oldSprite.material.map.dispose();
        oldSprite.material.dispose();
      }
    }
    
    // 创建新的进度 sprite（默认 bytes 模式，如有 totalBytes 显示 X / Y 格式）
    const newSprite = this.createProgressSprite(displayValue, 'bytes', totalBytes);
    newSprite.position.y = 0;
    targetPlaceholder.add(newSprite);
    targetPlaceholder.userData.progressSprite = newSprite;
    
    // 如果模拟还没启动，启动它（兜底：onProgress 不触发时显示模拟数值）
    if (!this._simIntervals || !this._simIntervals.has(sanitizedId)) {
      this._startProgressSimulation(sanitizedId, name, totalBytes || 0);
    }
  }

  /**
   * 启动进度模拟：当THREE.js onProgress不触发时作为兜底
   * - 知道文件大小：模拟显示下载数值（↓ 1.2 / 3.5 MB）
   * - 不知道文件大小：显示"下载中."动画
   * 真实字节数据到达后自动停止
   */
  _startProgressSimulation(sanitizedId, name, totalBytes = 0) {
    if (!this._simIntervals) this._simIntervals = new Map();
    if (this._simIntervals.has(sanitizedId)) return;
    
    if (totalBytes > 0) {
      // 知道文件大小：模拟下载字节数增长
      const startTime = Date.now();
      const interval = setInterval(() => {
        const realBytes = (this._modelRealBytes && this._modelRealBytes.get(sanitizedId)) || 0;
        if (realBytes > 0) {
          clearInterval(interval);
          this._simIntervals.delete(sanitizedId);
          return;
        }
        
        const elapsed = (Date.now() - startTime) / 1000;
        // 指数衰减曲线：0s→0%, 3s→63%, 6s→86%, 15s→99%
        const progress = 1 - Math.exp(-elapsed / 3);
        const simBytes = Math.round(totalBytes * Math.min(0.95, progress));
        this._updateProgressOnPlaceholder(name, simBytes, 'bytes', totalBytes);
      }, 500);
      
      this._simIntervals.set(sanitizedId, interval);
    } else {
      // 不知道文件大小：显示"下载中"动画
      let dotCount = 1;
      const interval = setInterval(() => {
        const realBytes = (this._modelRealBytes && this._modelRealBytes.get(sanitizedId)) || 0;
        if (realBytes > 0) {
          clearInterval(interval);
          this._simIntervals.delete(sanitizedId);
          return;
        }
        
        dotCount = dotCount >= 3 ? 1 : dotCount + 1;
        this._updateProgressOnPlaceholder(name, dotCount, 'loading');
      }, 400);
      
      this._simIntervals.set(sanitizedId, interval);
    }
  }

  /**
   * 直接在占位符上更新进度数字（不触发模拟逻辑）
   */
  _updateProgressOnPlaceholder(name, value, mode = 'bytes', totalBytes = null) {
    for (const [id, entry] of this.generatedBuildings.entries()) {
      if (entry.isPlaceholder && entry.isLoadingPlaceholder && entry.data && entry.data.name === name) {
        const placeholder = entry.model;
        const oldSprite = placeholder.userData.progressSprite;
        if (oldSprite) {
          placeholder.remove(oldSprite);
          if (oldSprite.material) {
            if (oldSprite.material.map) oldSprite.material.map.dispose();
            oldSprite.material.dispose();
          }
        }
        const newSprite = this.createProgressSprite(value, mode, totalBytes);
        newSprite.position.y = 0;
        placeholder.add(newSprite);
        placeholder.userData.progressSprite = newSprite;
        break;
      }
    }
  }

  /**
   * 停止进度模拟
   */
  _stopProgressSimulation(sanitizedId) {
    if (this._simIntervals && this._simIntervals.has(sanitizedId)) {
      clearInterval(this._simIntervals.get(sanitizedId));
      this._simIntervals.delete(sanitizedId);
    }
  }

  /**
   * 加载完成后在占位符上显示"完成"，然后移除
   */
  _showCompleteOnPlaceholder(name) {
    const sanitizedId = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    this._stopProgressSimulation(sanitizedId);
    if (this._modelRealBytes) this._modelRealBytes.delete(sanitizedId);
    if (this._modelExpectedBytes) this._modelExpectedBytes.delete(sanitizedId);
    
    for (const [id, entry] of this.generatedBuildings.entries()) {
      if (entry.isPlaceholder && entry.isLoadingPlaceholder && entry.data && entry.data.name === name) {
        const placeholder = entry.model;
        const oldSprite = placeholder.userData.progressSprite;
        if (oldSprite) {
          placeholder.remove(oldSprite);
          if (oldSprite.material) {
            if (oldSprite.material.map) oldSprite.material.map.dispose();
            oldSprite.material.dispose();
          }
        }
        // 创建"完成" sprite
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = 'bold 56px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.lineWidth = 6;
        ctx.strokeText('完成', 256, 64);
        ctx.fillStyle = '#4CAF50';
        ctx.fillText('完成', 256, 64);
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(2.8, 0.7, 1);
        sprite.position.y = 0;
        placeholder.add(sprite);
        placeholder.userData.progressSprite = sprite;
        break;
      }
    }
  }

  /**
   * 移动端统一模拟计时器（已废弃：进度改为占位符上方显示，不再需要面板）
   */
  _startMobileProgressSimulation() {
    // 不做任何UI操作，进度通过占位符 sprite 显示
  }

  /**
   * 更新大模型进度面板标题计数（已废弃：不再使用DOM面板）
   */
  _updateLargeModelTitle() {
    // 不做任何操作
  }

  /**
   * 检查大模型进度面板是否为空（已废弃：不再使用DOM面板）
   */
  _checkLargeModelPanelEmpty() {
    // 不做任何操作
  }

  // ========== 媒体(图片/视频)加载进度面板 ==========

  /**
   * 创建媒体加载进度面板（独立面板，显示在左下角）
   */
  createMediaProgressPanel() {
    const existingPanel = document.getElementById('media-progress-panel');
    const isMobile = this._isMobile();
    
    if (existingPanel) {
      const currentMobile = existingPanel.dataset.mobile === 'true';
      if (currentMobile === isMobile) return;
      if (existingPanel.parentNode) {
        existingPanel.parentNode.removeChild(existingPanel);
      }
    }
    
    const panel = document.createElement('div');
    panel.id = 'media-progress-panel';
    panel.dataset.mobile = isMobile ? 'true' : 'false';
    panel.style.cssText = isMobile ? `
      position: fixed; bottom: 20px; right: 6px;
      background: rgba(0,0,0,0.75); color: #fff;
      border-radius: 6px; padding: 6px 10px;
      font-family: Arial, sans-serif; font-size: 11px;
      z-index: 1002; max-width: 140px;
      transition: opacity 0.5s;
      border: 1px solid rgba(255,152,0,0.5);
    ` : `
      position: fixed; bottom: 20px; right: 10px;
      background: rgba(0,0,0,0.85); color: #fff;
      border-radius: 8px; padding: 10px 14px;
      font-family: Arial, sans-serif; font-size: 12px;
      z-index: 1002; max-width: 260px;
      transition: opacity 0.5s;
      border: 1px solid rgba(255,152,0,0.5);
    `;
    
    const title = document.createElement('div');
    title.id = 'media-progress-title';
    title.style.cssText = isMobile
      ? 'font-weight:bold;color:#ff9800;text-align:center;'
      : 'font-weight:bold;margin-bottom:6px;color:#ff9800;';
    title.textContent = isMobile ? '🖼️ 0/0' : '🖼️ 媒体加载 0/0';
    panel.appendChild(title);
    
    const list = document.createElement('div');
    list.id = 'media-progress-list';
    if (isMobile) list.style.display = 'none';
    panel.appendChild(list);
    
    document.body.appendChild(panel);
  }

  /**
   * 更新媒体加载进度面板
   */
  updateMediaProgress(name, percent, isRealProgress = false) {
    this.createMediaProgressPanel();
    const list = document.getElementById('media-progress-list');
    const title = document.getElementById('media-progress-title');
    if (!list || !title) return;
    
    const sanitizedId = 'media_' + name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    
    // 跟踪真实进度
    if (!this._mediaRealProgress) this._mediaRealProgress = new Map();
    if (isRealProgress || percent > (this._mediaRealProgress.get(sanitizedId) || 0)) {
      this._mediaRealProgress.set(sanitizedId, percent);
    }
    if (isRealProgress && this._mediaSimPct) {
      this._mediaSimPct.set(sanitizedId, percent);
    }
    const realPct = this._mediaRealProgress.get(sanitizedId) || 0;
    const displayPct = Math.max(percent, realPct);
    
    // 手机端：只显示整体进度百分比，不创建列表项
    if (this._isMobile()) {
      if (!this._mobileMediaProgress) this._mobileMediaProgress = new Map();
      
      const isNewMedia = !this._mobileMediaProgress.has(sanitizedId);
      this._mobileMediaProgress.set(sanitizedId, displayPct);
      
      if (displayPct >= 100) {
        this._mediaRealProgress.delete(sanitizedId);
      }
      
      if (isNewMedia && displayPct === 0) {
        this._startMobileMediaProgressSimulation();
      }
      
      let totalPct = 0;
      for (const pct of this._mobileMediaProgress.values()) {
        totalPct += pct;
      }
      const avgPct = Math.round(totalPct / this._mobileMediaProgress.size);
      
      title.textContent = `🖼️ 加载中 ${avgPct}%`;
      return;
    }
    
    // 桌面端：创建/更新每个媒体的进度条目
    let itemEl = document.getElementById(`media-progress-${sanitizedId}`);
    if (!itemEl) {
      itemEl = document.createElement('div');
      itemEl.id = `media-progress-${sanitizedId}`;
      itemEl.style.cssText = 'margin:3px 0;transition:opacity 0.5s;';
      itemEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
          <span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</span>
          <span>${displayPct}%</span>
        </div>
        <div style="background:#333;border-radius:3px;height:4px;">
          <div style="background:${displayPct >= 100 ? '#4CAF50' : '#ff9800'};width:${displayPct}%;height:100%;border-radius:3px;transition:width 0.3s;"></div>
        </div>
      `;
      list.appendChild(itemEl);
      
      // 首次调用且进度为0：启动模拟进度
      if (displayPct === 0) {
        this._startMediaProgressSimulation(sanitizedId, name);
      }
    } else {
      const pctSpan = itemEl.querySelector('div > span:last-child');
      if (pctSpan) pctSpan.textContent = displayPct + '%';
      const barDiv = itemEl.querySelector('div:last-child > div');
      if (barDiv) {
        barDiv.style.width = displayPct + '%';
        barDiv.style.background = displayPct >= 100 ? '#4CAF50' : '#ff9800';
      }
    }
    
    // 更新标题计数
    this._updateMediaProgressTitle();
    
    // 100% 时：停止模拟、3秒后淡出移除
    if (displayPct >= 100) {
      this._stopMediaProgressSimulation(sanitizedId);
      
      if (this._mediaHideTimers.has(sanitizedId)) {
        clearTimeout(this._mediaHideTimers.get(sanitizedId));
      }
      const hideTimer = setTimeout(() => {
        const el = document.getElementById(`media-progress-${sanitizedId}`);
        if (el) {
          el.style.opacity = '0';
          setTimeout(() => {
            if (el.parentNode) {
              el.parentNode.removeChild(el);
              if (this._mediaRealProgress) this._mediaRealProgress.delete(sanitizedId);
              this._updateMediaProgressTitle();
              this._checkMediaProgressPanelEmpty();
            }
          }, 500);
        }
      }, 3000);
      this._mediaHideTimers.set(sanitizedId, hideTimer);
    }
  }

  /**
   * 更新媒体进度面板标题
   */
  _updateMediaProgressTitle() {
    const title = document.getElementById('media-progress-title');
    const list = document.getElementById('media-progress-list');
    if (!title || !list) return;
    
    const totalItems = list.children.length;
    const completedItems = Array.from(list.children).filter(el => {
      const spans = el.querySelectorAll('span');
      const lastSpan = spans[spans.length - 1];
      return lastSpan && parseInt(lastSpan.textContent) >= 100;
    }).length;
    title.textContent = `🖼️ 媒体加载 ${completedItems}/${totalItems}`;
  }

  /**
   * 检查媒体进度面板是否为空，为空则隐藏
   */
  _checkMediaProgressPanelEmpty() {
    const list = document.getElementById('media-progress-list');
    if (!list || list.children.length > 0) return;
    
    const panel = document.getElementById('media-progress-panel');
    if (panel) {
      panel.style.opacity = '0';
      setTimeout(() => {
        if (panel.parentNode) {
          panel.parentNode.removeChild(panel);
          if (this._mediaRealProgress) this._mediaRealProgress.clear();
          this._mediaHideTimers.clear();
          // 清理手机端状态和定时器
          if (this._mobileMediaProgress) this._mobileMediaProgress.clear();
          if (this._mobileMediaSimInterval) {
            clearInterval(this._mobileMediaSimInterval);
            this._mobileMediaSimInterval = null;
          }
        }
      }, 500);
    }
  }

  /**
   * 启动媒体进度模拟（兜底）
   */
  _startMediaProgressSimulation(sanitizedId, name) {
    if (!this._mediaSimIntervals) this._mediaSimIntervals = new Map();
    if (!this._mediaSimPct) this._mediaSimPct = new Map();
    if (this._mediaSimIntervals.has(sanitizedId)) return;
    
    this._mediaSimPct.set(sanitizedId, 0);
    
    const interval = setInterval(() => {
      const realPct = (this._mediaRealProgress && this._mediaRealProgress.get(sanitizedId)) || 0;
      if (realPct >= 100) {
        clearInterval(interval);
        this._mediaSimIntervals.delete(sanitizedId);
        return;
      }
      
      const el = document.getElementById(`media-progress-${sanitizedId}`);
      if (!el) {
        clearInterval(interval);
        this._mediaSimIntervals.delete(sanitizedId);
        return;
      }
      
      let simPct = this._mediaSimPct.get(sanitizedId) || 0;
      const inc = simPct < 40 ? 5 : (simPct < 70 ? 3 : (simPct < 90 ? 2 : 1));
      simPct = Math.min(100, simPct + inc);
      this._mediaSimPct.set(sanitizedId, simPct);
      
      const displayPct = Math.max(simPct, realPct);
      
      if (displayPct >= 100) {
        clearInterval(interval);
        this._mediaSimIntervals.delete(sanitizedId);
        this.updateMediaProgress(name, 100);
        return;
      }
      
      const pctSpan = el.querySelector('div > span:last-child');
      if (pctSpan) pctSpan.textContent = displayPct + '%';
      const barDiv = el.querySelector('div:last-child > div');
      if (barDiv) {
        barDiv.style.width = displayPct + '%';
        barDiv.style.background = displayPct >= 100 ? '#4CAF50' : '#ff9800';
      }
      
      this._updateMediaProgressTitle();
    }, 250);
    
    this._mediaSimIntervals.set(sanitizedId, interval);
  }

  /**
   * 停止媒体进度模拟
   */
  _stopMediaProgressSimulation(sanitizedId) {
    if (this._mediaSimIntervals && this._mediaSimIntervals.has(sanitizedId)) {
      clearInterval(this._mediaSimIntervals.get(sanitizedId));
      this._mediaSimIntervals.delete(sanitizedId);
    }
    if (this._mediaSimPct) {
      this._mediaSimPct.delete(sanitizedId);
    }
  }

  /**
   * 移动端媒体统一模拟计时器：每250ms遍历所有媒体进度并刷新标题
   */
  _startMobileMediaProgressSimulation() {
    if (this._mobileMediaSimInterval) return;
    this._mobileMediaSimInterval = setInterval(() => {
      const title = document.getElementById('media-progress-title');
      if (!title || !this._mobileMediaProgress || this._mobileMediaProgress.size === 0) {
        clearInterval(this._mobileMediaSimInterval);
        this._mobileMediaSimInterval = null;
        return;
      }

      let totalPct = 0;
      let allDone = true;
      for (const [id, pct] of this._mobileMediaProgress.entries()) {
        const realPct = (this._mediaRealProgress && this._mediaRealProgress.get(id)) || 0;
        if (realPct >= 100) {
          this._mobileMediaProgress.set(id, 100);
          totalPct += 100;
          continue;
        }
        let simPct = pct < 40 ? pct + 5 : (pct < 70 ? pct + 3 : (pct < 90 ? pct + 2 : pct + 1));
        simPct = Math.min(100, Math.max(simPct, realPct));
        this._mobileMediaProgress.set(id, simPct);
        totalPct += simPct;
        if (simPct < 100) allDone = false;
      }
      const avgPct = Math.round(totalPct / this._mobileMediaProgress.size);

      if (allDone) {
        title.textContent = `✅ ${this._mobileMediaProgress.size}/${this._mobileMediaProgress.size}`;
        clearInterval(this._mobileMediaSimInterval);
        this._mobileMediaSimInterval = null;
        this._mobileMediaProgress.clear();
        setTimeout(() => this._checkMediaProgressPanelEmpty(), 1500);
      } else {
        title.textContent = `🖼️ 加载中 ${avgPct}%`;
      }
    }, 250);
  }

  // ========== 媒体进度面板结束 ==========

  /**
   * 添加上传的模型到场景
   */
  async addUploadedModel(modelData) {
    const { id, model_path, model_type, position_x, position_y, position_z, 
            rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, name } = modelData;

    console.log(`🔍 [addUploadedModel] id=${id} type=${model_type} path=${model_path}`);
    console.log('[进度调试-0] addUploadedModel 收到modelData keys:', Object.keys(modelData), 'file_size=', modelData.file_size);
    if (!model_path) {
      console.warn('模型路径为空:', modelData);
      return;
    }

    // 检查是否已加载（注意：占位符不算"已加载"，允许替换）
    const existingEntry = this.generatedBuildings.get(id);
    if (existingEntry && !existingEntry.isPlaceholder) {
      console.log('模型已加载，跳过:', id);
      return;
    }
    // 如果是占位符，继续执行，后续会自动移除并替换

    // 检查模型缓存中是否存在该模型
    try {
      const cachedModel = await this.getFromModelCache(model_path);
      if (cachedModel) {
        // 验证缓存模型有效性（必须含有mesh，否则是损坏的缓存）
        let meshCount = 0;
        cachedModel.traverse(child => { if (child.isMesh) meshCount++; });
        if (meshCount === 0) {
          console.warn('⚠️ 缓存模型无效（无mesh），清除缓存重新加载:', model_path);
          this.modelCache.delete(model_path);
          try { /* IndexedDB版本已升级，缓存已自动清除 */ } catch(e) {}
          // 继续走下面的加载逻辑
        } else {
        console.log('✅ 从缓存加载模型:', model_path);
        const model = cachedModel.clone();
        // 深克隆材质，保留纹理贴图
        model.traverse((child) => {
          if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) {
              child.material = child.material.map(m => m.clone());
            } else {
              child.material = child.material.clone();
            }
          }
        });
        
        // 设置位置、旋转、缩放
        model.position.set(position_x || 0, position_y || 0, position_z || 0);
        model.rotation.set(rotation_x || 0, rotation_y || 0, rotation_z || 0);
        model.scale.set(scale_x || 1, scale_y || 1, scale_z || 1);

        // 【custom_config】应用用户保存的模型参数
        if (window.CustomConfigApplier) {
          window.CustomConfigApplier.apply(model, {
            type: 'uploaded_model',
            custom_config: modelData.custom_config
          });
        }
        
        // 启用阴影
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // 【修复】移除占位符
        this.removePlaceholder(id);

        // 添加到场景（预编译着色器）
        this._addModelToScene(model);
        console.log('✅ 上传模型已添加到场景:', name);
        
        // 设置 userData 用于射线选中的回退匹配
        model.userData.worldObjectId = id;
        model.userData.name = name;
        
        // 保存引用
        this.generatedBuildings.set(id, {
          model,
          data: modelData
        });

        // 添加碰撞盒（仅当 has_collision 为 true 时）
        if (modelData.has_collision === true) {
          const box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          box.getSize(size);
          
          // 检查是否已存在相同位置的碰撞对象
          const existingCollisionIndex = this.collisionObjects.findIndex(collisionObj => 
            collisionObj.position && 
            Math.abs(collisionObj.position.x - model.position.x) < 0.1 &&
            Math.abs(collisionObj.position.z - model.position.z) < 0.1
          );
          
          if (existingCollisionIndex === -1) {
            this.collisionObjects.push({
              type: 'box',
              position: model.position.clone(),
              size: { 
                width: size.x, 
                height: size.y, 
                depth: size.z 
              }
            });
          }

          // 添加标签
          this.addBuildingLabel(model, name, position_y + size.y + 1);
        }

        return;
        } // end else (meshCount > 0)
      }
    } catch (error) {
      console.error('从缓存加载上传模型失败:', error);
    }

    // 判断文件类型（扩展名优先，避免model_type为null时错误使用OBJLoader加载.glb文件）
    const _ext = model_path.toLowerCase().split('.').pop();
    const isGLTF = _ext === 'glb' || _ext === 'gltf' || model_type === 'gltf';
    const isOBJ = !isGLTF && (_ext === 'obj' || model_type === 'obj' || (!model_type && _ext !== 'glb' && _ext !== 'gltf'));

    // 处理模型加载成功后的逻辑
    const onModelLoaded = (model) => {
      console.log('✅ 上传模型加载成功:', model_path);
      
      // 将模型添加到缓存中（同 URL 仅首次入库，批量副本避免重复序列化+写 IndexedDB）
      if (!this.modelCache.has(model_path)) {
        this.addToModelCache(model_path, model);
      }
      
      // 【性能修复】worldTextureOptimizer 返回的实例已完成克隆+材质隔离，
      // 检测到 __texOptSource 标记时直接复用，跳过二次全树 clone+材质深克隆
      // （批量复制场景下：加载耗时约减半，材质对象数约减半）
      let modelClone;
      if (model.userData && model.userData.__texOptSource) {
        modelClone = model;
      } else {
        // 原路径（OBJ / 未经 texOpt 处理的模型）：克隆 + 材质深隔离
        modelClone = model.clone();
        modelClone.traverse((child) => {
          if (child.isMesh && child.material) {
            // 深克隆材质，避免材质共享导致纹理丢失
            if (Array.isArray(child.material)) {
              child.material = child.material.map(m => m.clone());
            } else {
              child.material = child.material.clone();
            }
          }
        });
      }
      
      // 设置位置、旋转、缩放
      modelClone.position.set(position_x || 0, position_y || 0, position_z || 0);
      modelClone.rotation.set(rotation_x || 0, rotation_y || 0, rotation_z || 0);
      modelClone.scale.set(scale_x || 1, scale_y || 1, scale_z || 1);

      // 【custom_config】应用用户保存的模型参数
      if (window.CustomConfigApplier) {
        window.CustomConfigApplier.apply(modelClone, {
          type: 'uploaded_model',
          custom_config: modelData.custom_config
        });
      }
      
      // 启用阴影
      modelClone.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // 【修复】移除占位符
      this.removePlaceholder(id);

      // 添加到场景（预编译着色器）
      this._addModelToScene(modelClone);
      console.log('✅ 上传模型已添加到场景:', name);
      
      // 设置 userData 用于射线选中的回退匹配
      modelClone.userData.worldObjectId = id;
      modelClone.userData.name = name;
      
      // 保存引用
      this.generatedBuildings.set(id, {
        model: modelClone,
        data: modelData
      });

      // 添加碰撞盒（仅当 has_collision 为 true 时）
      if (modelData.has_collision === true) {
        const box = new THREE.Box3().setFromObject(modelClone);
        const size = new THREE.Vector3();
        box.getSize(size);
        
        // 检查是否已存在相同位置的碰撞对象
        const existingCollisionIndex = this.collisionObjects.findIndex(collisionObj => 
          collisionObj.position && 
          Math.abs(collisionObj.position.x - modelClone.position.x) < 0.1 &&
          Math.abs(collisionObj.position.z - modelClone.position.z) < 0.1
        );
        
        if (existingCollisionIndex === -1) {
          this.collisionObjects.push({
            type: 'box',
            position: modelClone.position.clone(),
            size: { 
              width: size.x, 
              height: size.y, 
              depth: size.z 
            }
          });
        }

        // 添加标签
        this.addBuildingLabel(modelClone, name, position_y + size.y + 1);
      }
    };

    // 加载OBJ模型（Promise包裹，确保异步加载完成才返回）
    if (isOBJ) {
      await new Promise((resolve) => {
      const modelDir = model_path.substring(0, model_path.lastIndexOf('/') + 1);
      
      // 尝试两个可能的MTL文件名：1) material.mtl（上传接口的命名）2) 同名.mtl
      const mtlFileName1 = 'material.mtl';
      const mtlFileName2 = model_path.substring(model_path.lastIndexOf('/') + 1).replace('.obj', '.mtl');

      console.log('🔄 加载OBJ模型:', model_path);
      console.log('📂 资源目录:', modelDir);
      console.log('📂 尝试MTL文件名:', [mtlFileName1, mtlFileName2]);

      // 尝试加载MTL材质的函数
      const tryLoadMTL = (mtlFileName, callback, errorCallback) => {
        this.mtlLoader.setPath(modelDir);
        this.mtlLoader.setResourcePath(modelDir); // 纹理文件也在这个目录
        
        this.mtlLoader.load(
          mtlFileName,
          callback,
          undefined,
          errorCallback
        );
      };

      // 所有OBJ/MTL尝试失败后，尝试用GLTFLoader加载（处理二进制文件被误命名为.obj的情况）
      const tryGLTFAsFallback = () => {
        console.warn('⚠️ OBJ加载全部失败，尝试作为GLTF/GLB加载:', model_path);
        const fallbackLoader = new THREE.GLTFLoader();
        fallbackLoader.setDRACOLoader(this.dracoLoader);
        if (this.meshoptDecoder) fallbackLoader.setMeshoptDecoder(this.meshoptDecoder);
        fallbackLoader.load(
          model_path,
          (gltf) => {
            console.log('✅ Fallback: 作为GLTF加载成功:', model_path);
            onModelLoaded(gltf.scene);
            resolve();
          },
          undefined,
          (err) => {
            console.error('❌ Fallback GLTF也失败:', err);
            this.addPlaceholderBuilding(id, modelData);
            resolve();
          }
        );
      };

      // 不带MTL加载OBJ的函数
      const loadOBJWithoutMTL = () => {
        this.objLoader.load(
          model_path,
          (obj) => {
            console.log('✅ OBJ模型加载成功（无材质）');
            obj.traverse((child) => {
              if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({
                  color: 0xcccccc,
                  roughness: 0.8,
                  metalness: 0.2,
                  side: THREE.DoubleSide
                });
              }
            });
            onModelLoaded(obj);
            resolve();
          },
          undefined,
          (error) => {
            console.error('❌ OBJ加载失败，尝试GLTF fallback:', error);
            tryGLTFAsFallback();
          }
        );
      };

      // 先尝试 material.mtl
      tryLoadMTL(
        mtlFileName1,
        (materials) => {
          console.log(`✅ MTL材质加载成功 (${mtlFileName1})`);
          console.log('  - 材质列表:', Object.keys(materials.materials));
          
          // 检查材质中的纹理路径
          Object.keys(materials.materials).forEach(matName => {
            const mat = materials.materials[matName];
            console.log(`  - 材质 "${matName}":`, {
              hasMap: !!mat.map,
              color: mat.color?.getHexString?.()
            });
          });
          
          materials.preload();
          
          // 等待一下让纹理加载
          setTimeout(() => {
            // 加载OBJ模型
            this.objLoader.setMaterials(materials);
            this.objLoader.load(
              model_path,
              (obj) => {
                console.log('✅ OBJ模型加载成功（带材质）');
                
                // 检查并修复材质
                let meshCount = 0;
                obj.traverse((child) => {
                  if (child.isMesh) {
                    meshCount++;
                    if (child.material) {
                      child.material.side = THREE.DoubleSide;
                      child.material.needsUpdate = true;
                      
                      console.log(`  网格 #${meshCount}:`, {
                        name: child.name,
                        hasMap: !!child.material.map,
                        mapUrl: child.material.map?.image?.src
                      });
                    }
                  }
                });
                
                onModelLoaded(obj);
                resolve();
              },
              undefined,
              (error) => {
                console.error('❌ OBJ加载失败（带材质），尝试GLTF fallback:', error);
                tryGLTFAsFallback();
              }
            );
          }, 300); // 等待300ms让纹理预加载
        },
        (error) => {
          console.warn(`⚠️ ${mtlFileName1} 加载失败，尝试 ${mtlFileName2}...`);
          
          // 尝试第二个文件名
          if (mtlFileName2 !== mtlFileName1) {
            tryLoadMTL(
              mtlFileName2,
              (materials) => {
                    console.log(`✅ MTL材质加载成功 (${mtlFileName2})`);
                materials.preload();
                
                setTimeout(() => {
                  this.objLoader.setMaterials(materials);
                  this.objLoader.load(model_path, (obj) => {
                    obj.traverse((child) => {
                      if (child.isMesh && child.material) {
                        child.material.side = THREE.DoubleSide;
                        child.material.needsUpdate = true;
                      }
                    });
                    onModelLoaded(obj);
                    resolve();
                  }, undefined, (err2) => {
                    console.error('❌ OBJ加载失败（mtl2带材质），尝试GLTF fallback:', err2);
                    tryGLTFAsFallback();
                  });
                }, 300);
              },
              (error2) => {
                console.warn('⚠️ 所有MTL文件加载失败，使用默认材质');
                loadOBJWithoutMTL();
              }
            );
          } else {
            loadOBJWithoutMTL();
          }
        }
      );
      }); // 关闭 OBJ 加载 Promise
    } 
    // 加载GLTF/GLB模型
    else if (isGLTF) {
      console.log('🔄 加载GLTF/GLB模型:', model_path);
      const isLarge = this.isLargeModel(modelData);
      
      if (isLarge) {
        // 大模型：先放占位符，用真实进度下载
        this.addPlaceholderBuilding(id, modelData, 'loading');
        
        await new Promise((resolve) => {
          this.loadModelWithRealProgress(
            model_path,
            name,
            (gltf) => {
              console.log('✅ 大模型GLTF加载成功:', name);
              this.removePlaceholder(id);
              onModelLoaded(gltf.scene);
              resolve();
            },
            (error) => {
              console.error('❌ 大模型GLTF加载失败:', error);
              this.addPlaceholderBuilding(id, modelData, 'failed');
              resolve();
            },
            Math.max(120000, (modelData.file_size || 0) / 1024 / 1024 * 30000)
          );
        });
      } else {
        // 小模型：显示占位符 + 真实进度下载
        this.addPlaceholderBuilding(id, modelData, 'loading');
        
        await new Promise((resolve) => {
          this.loadModelWithRealProgress(
            model_path,
            name,
            (gltf) => {
              console.log('✅ GLTF模型加载成功');
              this.removePlaceholder(id);
              onModelLoaded(gltf.scene);
              resolve();
            },
            (error) => {
              console.error('❌ GLTF加载失败:', error);
              this.addPlaceholderBuilding(id, modelData, 'failed');
              resolve();
            },
            Math.max(120000, (modelData.file_size || 0) / 1024 / 1024 * 30000)
          );
        });
      }
    }
  }

  /**
   * 添加广告位传送门（支持默认视觉 + 模型外观）
   */
  async addAdSlotPortal(adSlotData) {
    const { id, model_path, position_x, position_y, position_z,
            rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z,
            name, portal_type, target_url, target_world_url, target_world_name,
            target_world_id, deep_link } = adSlotData;

    // 检查是否已加载（占位符不算"已加载"，允许替换）
    const existingEntry = this.generatedBuildings.get(id);
    if (existingEntry && !existingEntry.isPlaceholder) {
      console.log('广告位已加载，跳过:', id);
      return;
    }
    // 如果是占位符，继续执行，后续会自动移除并替换

    const pos = new THREE.Vector3(position_x || 0, position_y || 0, position_z || 0);
    const rot = new THREE.Euler(rotation_x || 0, rotation_y || 0, rotation_z || 0);
    const scl = new THREE.Vector3(scale_x || 1, scale_y || 1, scale_z || 1);

    // 存储广告位元数据（供点击交互使用）
    const adMeta = { id, name, portal_type, target_url, target_world_url, target_world_name, target_world_id, deep_link };

    // ===== 情况1：默认传送门（无自定义模型） =====
    if (!model_path || model_path === '__default_portal__') {
      const portalGroup = new THREE.Group();
      portalGroup.name = `adslot_${id}`;

      // 外框
      const frameGeo = new THREE.TorusGeometry(1.2, 0.08, 16, 32);
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x00ccff, emissive: 0x0066ff, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.7 });
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.rotation.x = Math.PI / 2;
      portalGroup.add(frame);

      // 传送门圆盘
      const discGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.02, 32);
      const discMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00aaff, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.6 });
      const disc = new THREE.Mesh(discGeo, discMat);
      portalGroup.add(disc);

      // 粒子环
      const particleGeo = new THREE.TorusGeometry(1.0, 0.03, 8, 32);
      const particleMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
      const particleRing = new THREE.Mesh(particleGeo, particleMat);
      particleRing.rotation.x = Math.PI / 2;
      portalGroup.add(particleRing);

      // 点光源
      const light = new THREE.PointLight(0x00ccff, 0.8, 5);
      portalGroup.add(light);

      // 名称标签
      const nameSprite = this.createNameSprite(name || '广告位');
      nameSprite.position.y = 2;
      portalGroup.add(nameSprite);

      // 类型标签（外链/世界传送/应用）
      const typeLabels = { link: '🔗', world: '🌍', app: '📱' };
      const typeSprite = this.createNameSprite(typeLabels[portal_type] || '🔗');
      typeSprite.position.y = 1.2;
      portalGroup.add(typeSprite);

      portalGroup.position.copy(pos);
      portalGroup.rotation.copy(rot);
      portalGroup.scale.copy(scl);

      // 【修复】移除占位符
      this.removePlaceholder(id);

      this.scene.add(portalGroup);

      // 设置 userData 用于射线选中的回退匹配
      portalGroup.userData.worldObjectId = id;
      portalGroup.userData.name = name;

      // 注册到 generatedBuildings（用于视锥剔除、管理）
      this.generatedBuildings.set(id, { model: portalGroup, data: { ...adSlotData, _meta: adMeta }, _isAdSlot: true });

      // 注册到 portals 集合（复用动画系统）
      this.portals.set(id, {
        id, name, group: portalGroup, isActive: true,
        portalDisc: disc, frame, particleRing, portalLight: light,
        animationTime: 0, sourcePosition: { x: pos.x, y: pos.y, z: pos.z },
        _meta: adMeta, _isAdSlot: true
      });

      // 添加到碰撞检测
      this.collisionObjects.push({ type: 'box', position: pos.clone(), size: { width: 2.4, height: 2.4, depth: 0.5 } });

      console.log(`🚀 默认传送门已创建: ${name} (${portal_type}) 位于 (${pos.x}, ${pos.y}, ${pos.z})`);
      return;
    }

    // ===== 情况2：自定义模型 =====
    try {
      // 先查缓存
      const cachedModel = await this.getFromModelCache(model_path);
      let model;
      if (cachedModel) {
        let meshCount = 0;
        cachedModel.traverse(child => { if (child.isMesh) meshCount++; });
        if (meshCount > 0) {
          model = cachedModel.clone();
          model.traverse(child => {
            if (child.isMesh && child.material) {
              child.material = Array.isArray(child.material) ? child.material.map(m => m.clone()) : child.material.clone();
            }
          });
        }
      }

      if (!model) {
        // 加载模型
        const ext = model_path.toLowerCase().split('.').pop();
        if (ext === 'glb' || ext === 'gltf') {
          model = await new Promise((resolve, reject) => {
            this.gltfLoader.load(model_path, gltf => resolve(gltf.scene), undefined, reject);
          });
        } else {
          // 其他格式回退到 addUploadedModel
          await this.addUploadedModel(adSlotData);
          if (this.generatedBuildings.has(id)) {
            const entry = this.generatedBuildings.get(id);
            entry._meta = adMeta;
            entry._isAdSlot = true;
          }
          return;
        }
      }

      model.position.copy(pos);
      model.rotation.copy(rot);
      model.scale.copy(scl);
      model.traverse(child => {
        if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
      });

      const label = this.createNameSprite(name || '广告位');
      label.position.y = 2;
      model.add(label);

      // 【修复】移除占位符
      this.removePlaceholder(id);

      this._addModelToScene(model);

      // 设置 userData 用于射线选中的回退匹配
      model.userData.worldObjectId = id;
      model.userData.name = name;

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);

      this.generatedBuildings.set(id, { model, data: { ...adSlotData, _meta: adMeta }, _isAdSlot: true });
      this.collisionObjects.push({ type: 'box', position: pos.clone(), size: { width: size.x, height: size.y, depth: size.z } });

      console.log(`🚀 广告位模型加载成功: ${name} (${portal_type})`);
    } catch (err) {
      console.error('广告位模型加载失败，使用默认传送门:', err);
      // 回退到默认传送门
      adSlotData.model_path = '__default_portal__';
      await this.addAdSlotPortal(adSlotData);
    }
  }

  /**
   * 初始化广告位点击交互（调用一次即可）
   */
  initAdSlotInteraction() {
    if (this._adSlotInteractionReady) return;
    this._adSlotInteractionReady = true;

    const canvas = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();

    const onPointerDown = (event) => {
      if (!this.camera) return;
      const mouse = new THREE.Vector2();
      mouse.x = (event.clientX / canvas.clientWidth) * 2 - 1;
      mouse.y = -(event.clientY / canvas.clientHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, this.camera);

      // 收集所有广告位可交互对象
      const targets = [];
      for (const [id, entry] of this.generatedBuildings.entries()) {
        if (entry._isAdSlot && entry.model) {
          targets.push(entry.model);
        }
      }
      // 同时检查 portals 中的广告位
      for (const [id, portal] of this.portals.entries()) {
        if (portal._isAdSlot && portal.group) {
          if (!targets.includes(portal.group)) {
            targets.push(portal.group);
          }
        }
      }

      if (targets.length === 0) return;

      const intersects = raycaster.intersectObjects(targets, true);
      if (intersects.length > 0) {
        // 找到被点击的对象，向上遍历找到顶层 group
        let obj = intersects[0].object;
        let foundId = null;
        let foundMeta = null;

        // 向上查找带有元数据的对象
        for (let i = 0; i < 10 && obj; i++) {
          for (const [id, entry] of this.generatedBuildings.entries()) {
            if (entry.model === obj && entry._isAdSlot && entry.data && entry.data._meta) {
              foundId = id;
              foundMeta = entry.data._meta;
              break;
            }
          }
          if (!foundId) {
            for (const [id, portal] of this.portals.entries()) {
              if (portal.group === obj && portal._isAdSlot && portal._meta) {
                foundId = id;
                foundMeta = portal._meta;
                break;
              }
            }
          }
          if (foundId) break;
          obj = obj.parent;
        }

        if (foundMeta) {
          this.triggerAdSlotAction(foundMeta);
        }
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    console.log('✅ 广告位点击交互已初始化');
  }

  /**
   * 执行广告位操作（link/world/app）
   */
  triggerAdSlotAction(meta) {
    const { portal_type, target_url, target_world_url, target_world_name, target_world_id, deep_link, name } = meta;

    // 外部传送门（link/world/app）需要用户确认
    if (['link', 'world', 'app'].includes(portal_type)) {
      const actionLabel = portal_type === 'link' ? '打开外链' : portal_type === 'world' ? '传送到其他世界' : '拉起应用';
      const targetInfo = portal_type === 'link' ? target_url
        : portal_type === 'world' ? (target_world_name || target_world_url)
        : deep_link || target_url;
      if (!confirm(`即将${actionLabel}\n\n${name}\n${targetInfo || ''}`)) {
        return; // 用户取消
      }
    }

    switch (portal_type) {
      case 'link':
        if (target_url) {
          window.open(target_url, '_blank');
          console.log(`🔗 外链跳转: ${target_url}`);
        }
        break;
      case 'world':
        if (target_world_url) {
          // 携带角色信息跳转到目标世界
          const worldUrl = new URL(target_world_url);
          if (typeof GAME_STATE !== 'undefined' && GAME_STATE.characterId) {
            worldUrl.searchParams.set('characterId', GAME_STATE.characterId);
          }
          window.location.href = worldUrl.toString();
        } else if (target_world_id) {
          // 如果有 world_id 但没 url，使用默认格式
          window.location.href = target_world_id;
        }
        console.log(`🌍 世界传送: ${target_world_name || target_world_url || target_world_id}`);
        break;
      case 'app':
        if (deep_link) {
          // 尝试打开深度链接
          const startTime = Date.now();
          window.location.href = deep_link;
          // 2秒后如果还没跳转，说明未安装APP，降级到网页
          setTimeout(() => {
            if (Date.now() - startTime < 2500 && target_url) {
              window.open(target_url, '_blank');
            }
          }, 2000);
          console.log(`📱 应用拉起: ${deep_link}`);
        }
        break;
      default:
        console.warn('未知广告位类型:', portal_type);
    }

    // 触发展示通知
    if (typeof UI !== 'undefined' && UI.addChatMessage) {
      const actionTexts = { link: '正在打开外链...', world: `正在传送到 ${target_world_name || '目标世界'}...`, app: '正在拉起应用...' };
      UI.addChatMessage('系统', `🚀 ${name}: ${actionTexts[portal_type] || '未知操作'}`);
    }
  }

  /**
   * 添加几何体建筑到场景
   */
  async addGeometryBuilding(worldObject) {
    console.log('添加几何体建筑:', worldObject);
    
    // 检查是否已加载
    if (this.generatedBuildings.has(worldObject.id)) {
      console.log('几何体建筑已加载，跳过:', worldObject.id);
      return;
    }
    
    // 检查模型缓存中是否存在该模型
    const cacheKey = `geometry_${worldObject.name}_${worldObject.type}`;
    try {
      const cachedModel = await this.getFromModelCache(cacheKey);
      if (cachedModel) {
        console.log('✅ 从缓存加载几何体建筑');
        const buildingGroup = cachedModel.clone();
        
        // 应用变换
        buildingGroup.position.set(
          worldObject.position_x || 0, 
          worldObject.position_y || 0, 
          worldObject.position_z || 0
        );
        buildingGroup.rotation.set(
          worldObject.rotation_x || 0, 
          worldObject.rotation_y || 0, 
          worldObject.rotation_z || 0
        );
        buildingGroup.scale.set(
          worldObject.scale_x || 1, 
          worldObject.scale_y || 1, 
          worldObject.scale_z || 1
        );
        
        // 添加到场景（预编译着色器）
        this._addModelToScene(buildingGroup);
        
        // 设置 userData 用于射线选中的回退匹配
        buildingGroup.userData.worldObjectId = worldObject.id;
        buildingGroup.userData.name = worldObject.name;
        
        // 保存到建筑集合
        this.generatedBuildings.set(worldObject.id, {
          model: buildingGroup,
          data: worldObject,
          isGeometry: true
        });
        
        // 添加标签
        this.addBuildingLabel(
          buildingGroup, 
          `🔨 ${worldObject.name}`, 
          worldObject.position_y + 5
        );
        
        // 添加碰撞检测（仅当 has_collision 为 true 时）
        if (worldObject.has_collision === true) {
          const box = new THREE.Box3().setFromObject(buildingGroup);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);  // ✅ 获取包围盒的真实中心点
          
          // 检查是否已存在相同位置的碰撞对象
          const existingCollisionIndex = this.collisionObjects.findIndex(collisionObj => 
            collisionObj.position && 
            Math.abs(collisionObj.position.x - center.x) < 0.1 &&
            Math.abs(collisionObj.position.z - center.z) < 0.1
          );
          
          if (existingCollisionIndex === -1) {
            this.collisionObjects.push({
              type: 'geometry_building',
              id: worldObject.id,
              position: center.clone(),  // ✅ 使用包围盒的真实中心（解决空隙问题）
              boundingBox: box,
              size: size
            });
          }
        }
        
        console.log('✅ 几何体建筑添加成功:', worldObject.name);
        return;
      }
    } catch (error) {
      console.error('从缓存加载几何体建筑失败:', error);
    }
    
    let buildingGroup = null;

    // 判断是否为 geometry_building:{id} 格式，尝试从 API 加载组件数据
    if (worldObject.model_path && worldObject.model_path.startsWith('geometry_building:')) {
      const buildingId = worldObject.model_path.replace('geometry_building:', '');
      if (buildingId) {
        try {
          console.log('🔄 尝试从API加载几何体组件, ID:', buildingId);
          const response = await fetch(`/api/geometry-building/${buildingId}`);
          const data = await response.json();
          if (data.success && data.building && data.building.geometry_data) {
            const geomData = data.building.geometry_data;
            if (geomData.components && geomData.components.length > 0) {
              if (typeof GeometryRenderer !== 'undefined' && GeometryRenderer.renderFromComponents) {
                buildingGroup = GeometryRenderer.renderFromComponents(geomData.components, THREE);
                console.log('✅ 通用组件渲染器加载成功:', worldObject.name, '组件数:', geomData.components.length);
              }
            }
          }
        } catch (e) {
          console.warn('从API加载几何体组件失败，尝试备用方案:', e.message);
        }
      }
    }

    // 如果 model_path 为空但 API 已经返回了 geometry_data，直接使用
    if (!buildingGroup && worldObject.geometry_data) {
      try {
        const geomData = typeof worldObject.geometry_data === 'string'
          ? JSON.parse(worldObject.geometry_data)
          : worldObject.geometry_data;
        if (geomData.components && geomData.components.length > 0 &&
            typeof GeometryRenderer !== 'undefined' && GeometryRenderer.renderFromComponents) {
          buildingGroup = GeometryRenderer.renderFromComponents(geomData.components, THREE);
          console.log('✅ 从附加 geometry_data 加载几何体:', worldObject.name, '组件数:', geomData.components.length);
        }
      } catch (e) {
        console.warn('从 geometry_data 加载几何体失败:', e.message);
      }
    }

    // 最终回退：通过 name 匹配 geometry_buildings API
    // 适用于 model_path 为空且 building_id 为空（后端无法回填）的场景
    if (!buildingGroup && worldObject.name && !worldObject.model_path) {
      try {
        console.log('🔄 尝试通过 name 匹配几何体:', worldObject.name);
        const listRes = await fetch('/api/geometry-building/list');
        const listData = await listRes.json();
        if (listData.success && listData.buildings) {
          // 精确匹配或去掉" (副本)"后缀匹配
          const matched = listData.buildings.find(b =>
            b.name === worldObject.name || b.name === worldObject.name.replace(/ \(副本\)$/, '')
          );
          if (matched && matched.geometry_data) {
            const gd = typeof matched.geometry_data === 'string'
              ? JSON.parse(matched.geometry_data)
              : matched.geometry_data;
            if (gd.components && gd.components.length > 0 &&
                typeof GeometryRenderer !== 'undefined' && GeometryRenderer.renderFromComponents) {
              buildingGroup = GeometryRenderer.renderFromComponents(gd.components, THREE);
              console.log('✅ 通过 name 匹配加载几何体:', worldObject.name, 'ID:', matched.id, '组件数:', gd.components.length);
            }
          }
        }
      } catch (e) {
        console.warn('通过 name 匹配几何体失败:', e.message);
      }
    }

    // 备用：使用旧版 GeometryRenderer（适用于 geometry:xxx 格式的模板对象）
    if (!buildingGroup) {
      try {
        if (typeof GeometryRenderer === 'undefined') {
          console.error('GeometryRenderer未加载！');
          return;
        }
        buildingGroup = GeometryRenderer.loadFromWorldObject(worldObject, THREE);
      } catch (error) {
        console.error('旧版几何体加载失败:', error);
      }
    }

    if (buildingGroup) {
      // 将模型添加到缓存中
      this.addToModelCache(cacheKey, buildingGroup);

      // 创建模型的克隆
      const modelClone = buildingGroup.clone();

      // 应用变换
      modelClone.position.set(
        worldObject.position_x || 0, 
        worldObject.position_y || 0, 
        worldObject.position_z || 0
      );
      modelClone.rotation.set(
        worldObject.rotation_x || 0, 
        worldObject.rotation_y || 0, 
        worldObject.rotation_z || 0
      );
      modelClone.scale.set(
        worldObject.scale_x || 1, 
        worldObject.scale_y || 1, 
        worldObject.scale_z || 1
      );

      // 【custom_config】应用用户保存的几何体样式参数
      if (window.CustomConfigApplier) {
        window.CustomConfigApplier.apply(modelClone, {
          type: 'geometry_building',
          custom_config: worldObject.custom_config
        });
      }

      // 添加到场景（预编译着色器）
      this._addModelToScene(modelClone);

      // 设置 userData 用于射线选中的回退匹配
      modelClone.userData.worldObjectId = worldObject.id;
      modelClone.userData.name = worldObject.name;

      // 保存到建筑集合
      this.generatedBuildings.set(worldObject.id, {
        model: modelClone,
        data: worldObject,
        isGeometry: true
      });

      // 添加标签
      this.addBuildingLabel(
        modelClone, 
        `🔨 ${worldObject.name}`, 
        worldObject.position_y + 5
      );

      // 添加碰撞检测（仅当 has_collision 为 true 时）
      if (worldObject.has_collision === true) {
        const box = new THREE.Box3().setFromObject(modelClone);
        const size = new THREE.Vector3();
        box.getSize(size);

        // 检查是否已存在相同位置的碰撞对象
        const existingCollisionIndex = this.collisionObjects.findIndex(collisionObj => 
          collisionObj.position && 
          Math.abs(collisionObj.position.x - modelClone.position.x) < 0.1 &&
          Math.abs(collisionObj.position.z - modelClone.position.z) < 0.1
        );

        if (existingCollisionIndex === -1) {
          this.collisionObjects.push({
            type: 'geometry_building',
            id: worldObject.id,
            position: modelClone.position.clone(),
            boundingBox: box,
            size: size
          });
        }
      }

      console.log('✅ 几何体建筑添加成功:', worldObject.name);
    }
  }

  /**
   * 显示 Three.js 代码块加载失败的红色提示标志
   */
  _showThreeJSError(id, x, y, z, errorMsg) {
    try {
      const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3333, wireframe: false });
      const box = new THREE.Mesh(geo, mat);
      box.position.set(x || 0, (y || 0) + 0.3, z || 0);

      // 添加文本标签精灵
      var canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('⚠️ 模型加载失败', 128, 25);
      ctx.fillStyle = '#ffcccc';
      ctx.font = '10px Arial';
      ctx.fillText(errorMsg.slice(0, 50), 128, 45);

      var texture = new THREE.CanvasTexture(canvas);
      var spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
      var sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(2, 0.5, 1);
      sprite.position.set(0, 0.5, 0);
      box.add(sprite);

      this.scene.add(box);
      this.generatedBuildings.set(id, {
        group: box, onFrame: null, isError: true, worldObjectId: id
      });
      console.log('⚠️ Three.js 代码块错误标志已显示:', id, errorMsg);
    } catch (e) {
      console.error('显示 Three.js 错误标志失败:', e);
    }
  }

  /**
   * 添加Three.js生成的模型到场景
   */
  async addThreeJSModel(modelData) {
    try {
      const { id, threejs_code, position_x, position_y, position_z, 
              rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, name } = modelData;

      console.log('🎨 添加Three.js模型到场景:', { id, name });

      if (!threejs_code) {
        console.warn('Three.js代码为空:', modelData);
        return;
      }

      // 检查是否已加载
      if (this.generatedBuildings.has(id)) {
        console.log('Three.js模型已存在，跳过:', id);
        return;
      }

      // 检查模型缓存中是否存在该模型
      // 使用代码内容的简单 hash 作为缓存键（避免前缀碰撞）
      let cacheKey = 'threejs_';
      if (threejs_code && threejs_code.length > 0) {
        let hash = 5381;
        const len = Math.min(threejs_code.length, 500);
        for (let i = 0; i < len; i++) {
          hash = ((hash << 5) + hash) + threejs_code.charCodeAt(i);
          hash = hash & hash;
        }
        cacheKey += (hash >>> 0).toString(16) + '_' + threejs_code.length;
      }
      try {
        const cachedModel = await this.getFromModelCache(cacheKey);
        if (cachedModel && modelData.type !== 'threejs_code') {
          console.log('✅ 从缓存加载Three.js模型');
          const modelGroup = cachedModel.clone();
          
          // 应用变换
          modelGroup.position.set(
            position_x || 0, 
            position_y || 0, 
            position_z || 0
          );
          modelGroup.rotation.set(
            rotation_x || 0, 
            rotation_y || 0, 
            rotation_z || 0
          );
          modelGroup.scale.set(
            scale_x || 1, 
            scale_y || 1, 
            scale_z || 1
          );
          
          // 设置阴影
          modelGroup.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          
          // 【修复】移除占位符
          this.removePlaceholder(id);

          // 添加到场景（预编译着色器）
          this._addModelToScene(modelGroup);
          
          // 设置 userData 用于射线选中的回退匹配
          modelGroup.userData.worldObjectId = id;
          modelGroup.userData.name = name;
          
          // 保存引用
          this.generatedBuildings.set(id, {
            model: modelGroup,
            data: modelData
          });
          
          // 添加碰撞体（仅当 has_collision 为 true 时）
          if (modelData.has_collision === true) {
            const box = new THREE.Box3().setFromObject(modelGroup);
            const size = new THREE.Vector3();
            box.getSize(size);
            
            // 检查是否已存在相同位置的碰撞对象
            const existingCollisionIndex = this.collisionObjects.findIndex(collisionObj => 
              collisionObj.position && 
              Math.abs(collisionObj.position.x - modelGroup.position.x) < 0.1 &&
              Math.abs(collisionObj.position.z - modelGroup.position.z) < 0.1
            );
            
            if (existingCollisionIndex === -1) {
              this.collisionObjects.push({
                type: 'threejs_model',
                id: id,
                position: modelGroup.position.clone(),
                boundingBox: box,
                size: size
              });
            }
          }
          
          console.log('✅ Three.js模型添加成功:', name || id);
          return;
        }
      } catch (error) {
        console.error('从缓存加载Three.js模型失败:', error);
      }

      try {
        let modelGroup = null;
        let onFrame = null;

        if (window.ThreeJSCodeRunner) {
          // 统一使用 ThreeJSCodeRunner：既支持 createGeometry 约定写法，也支持独立 Demo 风格代码
          try {
            const result = window.ThreeJSCodeRunner.runThreeJSCode(threejs_code, {
              mode: 'world', THREE: THREE, renderer: this.renderer, camera: this.camera
            });
            if (result.error) {
              console.error('❌ ThreeJSCodeRunner 执行代码出错:', result.error);
              this._showThreeJSError(id, position_x, position_y, position_z, '代码执行错误: ' + (result.error.message || result.error));
              return;
            }
            modelGroup = result.object || null;
            onFrame = result.onFrame || null;
            if (onFrame) {
              this._threejsBlockFrames = this._threejsBlockFrames || [];
              this._threejsBlockFrames.push(onFrame);
            }
          } catch (e) {
            console.error('❌ ThreeJSCodeRunner 运行失败:', e);
          }
        } else {
          console.error('❌ ThreeJSCodeRunner 未加载');
        }

        if (!modelGroup) {
          console.error('❌ ThreeJSCodeRunner 未返回模型对象');
          this._showThreeJSError(id, position_x, position_y, position_z, '代码执行后未生成3D模型');
          return;
        }

        // 应用变换
        modelGroup.position.set(
          position_x || 0,
          position_y || 0,
          position_z || 0
        );
        modelGroup.rotation.set(
          rotation_x || 0,
          rotation_y || 0,
          rotation_z || 0
        );
        modelGroup.scale.set(
          scale_x || 1,
          scale_y || 1,
          scale_z || 1
        );

        // ===== 尺寸归一化：自动缩放适配世界场景 =====
        // 用户代码可能产生 0.001m 的分子模型或 10000m 的城市场景，
        // 通过 Box3 计算自动限制到合理尺寸范围
        (function () {
          try {
            const bbox = new THREE.Box3().setFromObject(modelGroup);
            const bboxCenter = new THREE.Vector3();
            bbox.getCenter(bboxCenter);
            const bboxSize = new THREE.Vector3();
            bbox.getSize(bboxSize);
            const maxDim = Math.max(bboxSize.x, bboxSize.y, bboxSize.z);
            // 【修复】不再强制缩小大模型，保持与编辑器一致的原始尺寸
            if (maxDim > 0 && maxDim < 0.1) {
              // 模型过小（<0.1米），放大到 1 米
              const s = 1 / maxDim;
              modelGroup.scale.multiplyScalar(s);
              console.log('📏 Three.js 模型尺寸归一化：过小 (' + maxDim.toFixed(4) + 'm) → 放大 ×' + s.toFixed(1));
            }
          } catch (e) {
            console.warn('📏 Three.js 模型尺寸归一化跳过:', e.message);
          }
        })();

        // 【custom_config】自动修复粒子白球并应用用户保存的自定义配置
        if (window.CustomConfigApplier) {
          const fixResult = window.CustomConfigApplier.apply(modelGroup, {
            type: 'threejs_code',
            custom_config: modelData.custom_config
          });
          if (fixResult.fixed > 0) {
            console.log('🔧 Three.js 代码块粒子自动修复:', fixResult.fixed, '个粒子系统');
          }
        }

        // 设置阴影
        modelGroup.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // 【修复】移除占位符
        this.removePlaceholder(id);

        // 添加到场景（预编译着色器）
        this._addModelToScene(modelGroup);

        // 设置 userData 用于射线选中的回退匹配
        modelGroup.userData.worldObjectId = id;
        modelGroup.userData.name = name;

        // 保存引用
        this.generatedBuildings.set(id, {
          model: modelGroup,
          data: modelData,
          onFrame: onFrame,
          isThreejsGenerated: true // P6：标记为 Three.js 代码生成，卸载时安全释放几何体
        });

        // 添加碰撞体（仅当 has_collision 为 true 时）
        if (modelData.has_collision === true) {
          const box = new THREE.Box3().setFromObject(modelGroup);
          const size = new THREE.Vector3();
          box.getSize(size);

          // 检查是否已存在相同位置的碰撞对象
          const existingCollisionIndex = this.collisionObjects.findIndex(collisionObj =>
            collisionObj.position &&
            Math.abs(collisionObj.position.x - modelGroup.position.x) < 0.1 &&
            Math.abs(collisionObj.position.z - modelGroup.position.z) < 0.1
          );

          if (existingCollisionIndex === -1) {
            this.collisionObjects.push({
              type: 'threejs_model',
              id: id,
              position: modelGroup.position.clone(),
              boundingBox: box,
              size: size
            });
          }
        }

        console.log('✅ Three.js模型添加成功:', name || id);
      } catch (execError) {
        console.error('❌ 执行Three.js代码失败:', execError);
        console.error('代码片段:', threejs_code.substring(0, 200) + '...');
      }
    } catch (error) {
      console.error('添加Three.js模型失败:', error);
    }
  }

  /**
   * 移除生成的建筑
   */
  removeGeneratedBuilding(id) {
    const building = this.generatedBuildings.get(id);
    if (building) {
      this.scene.remove(building.model);
      
      // 移除标签
      if (building.model.userData.label) {
        this.scene.remove(building.model.userData.label);
      }
      
      // 清理 Three.js 代码块动画回调
      if (building.onFrame && this._threejsBlockFrames) {
        const idx = this._threejsBlockFrames.indexOf(building.onFrame);
        if (idx !== -1) this._threejsBlockFrames.splice(idx, 1);
      }
      
      this.generatedBuildings.delete(id);
      
      // 移除碰撞对象
      this.collisionObjects = this.collisionObjects.filter(obj => 
        obj.position.x !== building.data.position_x ||
        obj.position.z !== building.data.position_z
      );
      
      console.log(`建筑 ${id} 已从世界移除`);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // 使用真实帧间隔，限制最大值防止卡顿后跳变
    const now = performance.now();
    const delta = Math.min((now - (this._lastAnimTime || now)), 100);
    this._lastAnimTime = now;
    
    // ===== 鼠标旋转 + 玩家更新（从 main.js gameLoop 移入，消除双 rAF 竞争）=====
    const playerRef = window.player;
    if (playerRef && window.MOUSE) {
      // 鼠标视角旋转（零延迟模式，直接同步目标值）
      if (window.MOUSE.smoothness === 0) {
        window.MOUSE.rotationX = window.MOUSE.targetRotationX;
        window.MOUSE.rotationY = window.MOUSE.targetRotationY;
      } else {
        const diffX = window.MOUSE.targetRotationX - window.MOUSE.rotationX;
        const diffY = window.MOUSE.targetRotationY - window.MOUSE.rotationY;
        const s = window.MOUSE.smoothness || 0.05;
        window.MOUSE.rotationX += diffX * s;
        window.MOUSE.rotationY += diffY * s;
      }
      // 玩家物理+摄像机更新（必须在渲染前完成，确保视锥体剔除使用最新相机矩阵）
      playerRef.update(delta, this.camera);
      // 调试面板更新
      this._updateDebugPanel(playerRef);
    }
    // 技能系统更新
    if (window.skillsManager) window.skillsManager.update();
    // 建筑管理器更新
    if (this.buildingManager) this.buildingManager.update();
    // ===== 鼠标旋转 + 玩家更新 结束 =====
    
    // 动态加载和卸载对象（每30帧执行一次，大幅减少CPU占用）
    if (this.frameCount % 30 === 0) {
      this.updateObjectLoading();
    }
    
    // 视锥体剔除（每4帧执行一次）
    if (this.frameCount % 4 === 0) {
      this.updateFrustumCulling();
    }
    
    // 级别细节调整（每6帧执行一次）
    if (this.frameCount % 6 === 0) {
      this.updateLOD();
    }
    
    // 几何体处理优化（每15帧执行一次）
    if (this.frameCount % 15 === 0) {
      this.optimizeGeometryProcessing();
    }
    
    // 性能监控（每4帧执行一次）
    if (this.frameCount % 4 === 0) {
      this.updatePerformanceMonitor();
    }
    
    // 显示性能面板（每20帧执行一次）
    if (this.frameCount % 20 === 0) {
      this.showPerformancePanel();
    }
    
    // 减少资源清理频率，每15帧执行一次
    if (this.frameCount % 15 === 0) {
      this.cleanupMemory();
    }
    
    // 帧率适配（每10帧执行一次）
    if (this.frameCount % 10 === 0) {
      this.updateFpsHistory();
      if (this.fpsHistory.length >= this.fpsHistorySize) {
        this.adjustLoadStrategy();
      }
    }
    
    this.updateParticles(delta);
    this.updatePortals(delta);
    this._updateWeatherParticles(delta);
    
    // 技能系统功能暂时禁用，需要初始化SkillSystem
    // // 渲染技能物品
    // this.renderSkillItems(delta / 1000);
    // 
    // // 检测技能物品碰撞
    // if (this.players.size > 0) {
    //   this.players.forEach((playerData) => {
    //     if (playerData.position) {
    //       const pickedSkill = this.checkSkillItemCollision(playerData.position);
    //       if (pickedSkill) {
    //         // 触发技能拾取事件
    //         this.onSkillPickup(playerData.characterId, pickedSkill);
    //       }
    //     }
    //   });
    // }

    // 更新 GLB 角色动画 mixer（每个玩家只更新共享 mixer）
    {
      const dt = delta / 1000;
      this.players.forEach((pd) => {
        const ud = pd.group?.userData;
        if (!ud) return;
        // 内置 glbMixer（模型自带动画时存在）
        if (ud.glbMixer) ud.glbMixer.update(dt);
        // 共享动画 mixer（所有独立动画 GLB 共用，绑定在角色模型上）
        if (ud.sharedMixer && ud.sharedMixer !== ud.glbMixer) ud.sharedMixer.update(dt);
        // 骨骼物理更新（在动画 mixer 之后、渲染之前，驱动头发/尾巴/裙子等飘动）
        if (ud.bonePhysics && typeof ud.bonePhysics.update === 'function') {
          ud.bonePhysics.update(dt);
        }
      });
    }

    // 光剑脉动动画（每4帧执行一次）
    if (this.frameCount % 4 === 0) {
      const now = performance.now();
      this.players.forEach((playerData, charId) => {
        const ud = playerData.group?.userData;
        if (!ud || !ud.swordBlade) return;
        const wCfg = ud.weaponConfig || {};
        const baseGlow = wCfg.glow_intensity ?? 0.8;
        const pulse = 0.85 + Math.sin(now / 500) * 0.15;
        ud.swordBlade.material.emissiveIntensity = baseGlow * pulse;
        // 粒子动画（base层 + skill叠加层各自更新）
        if (ud.swordParticles)      this._animateSwordParticles(ud.swordParticles, now);
        if (ud.swordParticlesSkill) this._animateSwordParticles(ud.swordParticlesSkill, now);
      });
    }
    
    // FPS 监控（仅统计，不调整质量）
    // 注意：frameCount由此处统一自增，updatePerformanceMonitor中只读不写
    this.frameCount++;
    if (now - this.lastFPSCheck >= 1000) {
      this.currentFPS = this.frameCount;
      this.frameCount = 0;
      this.lastFPSCheck = now;
    }

    // 媒体对象更新（视频距离检测，每60帧执行一次）
    if (this.frameCount % 60 === 0 && this._mediaMeshes && this._mediaMeshes.size > 0) {
      const playerPos = this.player ? this.player.position : (
        this.players.size > 0 ? this.players.values().next().value.group?.position : null
      );
      if (playerPos) this.updateMediaObjects(playerPos);
    }

    // 执行 Three.js 代码块自定义动画
    if (this._threejsBlockFrames && this._threejsBlockFrames.length) {
      for (let i = this._threejsBlockFrames.length - 1; i >= 0; i--) {
        try {
          this._threejsBlockFrames[i]();
        } catch (e) {
          console.warn('[ThreeJS] 代码块动画回调出错，移除:', e);
          this._threejsBlockFrames.splice(i, 1);
        }
      }
    }

    // 直接渲染（无额外操作）
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * 调试面板更新（从 main.js 移入，由 animate 驱动）
   */
  _updateDebugPanel(playerRef) {
    if (!playerRef) return;
    if (typeof window.updateCoordDisplay === 'function') {
      window.updateCoordDisplay(playerRef.position);
      return;
    }
    const posEl = document.getElementById('debug-pos');
    if (posEl) {
      posEl.textContent = `X:${playerRef.position.x.toFixed(1)} Y:${playerRef.position.y.toFixed(1)} Z:${playerRef.position.z.toFixed(1)}`;
    }
  }
  
  adjustQuality() {
    const targetFPS = CONFIG.TARGET_FPS || 60;
    const pixelRatio = this.renderer.getPixelRatio();
    const isUltrawide = (window.innerWidth / window.innerHeight) > 2.0;
    
    // 平衡策略：清晰度优先，但保证流畅
    const minRatio = isUltrawide ? 0.75 : 1.0; // 带鱼屏最低0.75（保证清晰）
    const maxRatio = isUltrawide ? 1.5 : (CONFIG.MAX_PIXEL_RATIO || 1.8);
    
    // FPS 低于45，适度降低渲染质量
    if (this.currentFPS < 45 && pixelRatio > minRatio) {
      const newRatio = Math.max(pixelRatio - 0.15, minRatio);
      this.renderer.setPixelRatio(newRatio);
      console.log(`⚡ 自适应降质：像素比 ${pixelRatio.toFixed(2)} → ${newRatio.toFixed(2)}`);
      
      // 降低阴影更新频率
      if (this.shadowUpdateInterval < 5) {
        this.shadowUpdateInterval++;
        // 降低阴影更新频率（静默）
      }
    }
    // FPS 稳定高于58，可以尝试提升质量
    else if (this.currentFPS > 58 && pixelRatio < maxRatio) {
      const newRatio = Math.min(pixelRatio + 0.1, maxRatio);
      this.renderer.setPixelRatio(newRatio);
      console.log(`✨ 自适应提质：像素比 ${pixelRatio.toFixed(2)} → ${newRatio.toFixed(2)}`);
      
      // 提升阴影更新频率（但保持至少每2帧更新）
      if (this.shadowUpdateInterval > 2 && this.currentFPS > 58) {
        this.shadowUpdateInterval--;
        // 提升阴影更新频率（静默）
      }
    }
  }

  getCamera() {
    return this.camera;
  }

  getScene() {
    return this.scene;
  }
  
  // 粒子配置表
  _particleConfig(type) {
    const cfgs = {
      spark:     { count:20, color:0xffffaa, size:0.03, speed:0.06, spread:0.08, life:30 },
      fire:      { count:30, color:0xff5500, size:0.05, speed:0.05, spread:0.06, life:25 },
      ice:       { count:25, color:0xaaddff, size:0.03, speed:0.03, spread:0.05, life:40 },
      lightning: { count:15, color:0xffff44, size:0.04, speed:0.08, spread:0.10, life:15 },
      dark:      { count:20, color:0x8800cc, size:0.05, speed:0.03, spread:0.07, life:50 },
      holy:      { count:25, color:0xffffcc, size:0.04, speed:0.04, spread:0.06, life:35 },
      poison:    { count:20, color:0x44cc44, size:0.04, speed:0.03, spread:0.06, life:45 },
    };
    return cfgs[type] || null;
  }

  _createSwordParticles(type, bladeLen = 0.8) {
    const cfg = this._particleConfig(type);
    if (!cfg) return null;
    const group = new THREE.Group();
    group.userData.particleType = type;
    group.userData.particles = [];
    for (let i = 0; i < cfg.count; i++) {
      const geo = new THREE.SphereGeometry(cfg.size * (0.5 + Math.random() * 0.5), 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.8 });
      const p = new THREE.Mesh(geo, mat);
      p.userData.life = Math.floor(Math.random() * cfg.life);
      p.userData.maxLife = cfg.life;
      p.userData.vx = (Math.random() - 0.5) * cfg.spread;
      p.userData.vy = (Math.random() - 0.5) * cfg.speed + cfg.speed * 0.5;
      p.userData.vz = (Math.random() - 0.5) * cfg.spread;
      p.position.set(
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * bladeLen * 0.5,
        (Math.random() - 0.5) * 0.08
      );
      group.add(p);
      group.userData.particles.push(p);
    }
    group.userData.bladeLen = bladeLen;
    group.userData.cfg = cfg;
    return group;
  }

  _animateSwordParticles(group, now) {
    if (!group || !group.userData.particles) return;
    const cfg = group.userData.cfg;
    const bladeLen = group.userData.bladeLen || 0.8;
    group.userData.particles.forEach(p => {
      p.userData.life++;
      const t = p.userData.life / p.userData.maxLife;
      p.material.opacity = 0.8 * (1 - t);
      p.position.x += p.userData.vx;
      p.position.y += p.userData.vy;
      p.position.z += p.userData.vz;
      if (p.userData.life >= p.userData.maxLife) {
        // 重置粒子
        p.userData.life = 0;
        p.material.opacity = 0.8;
        p.position.set(
          (Math.random() - 0.5) * 0.08,
          (Math.random() - 0.5) * bladeLen * 0.5,
          (Math.random() - 0.5) * 0.08
        );
        p.userData.vx = (Math.random() - 0.5) * cfg.spread;
        p.userData.vy = (Math.random() - 0.5) * cfg.speed + cfg.speed * 0.5;
        p.userData.vz = (Math.random() - 0.5) * cfg.spread;
      }
    });
  }

  // 技能触发：临时切换光剑外观，duration ms 后自动还原
  // 改造：粒子双层架构（base层常驻，skill层独立叠加，互不干扰）
  triggerSkillWeaponFx(characterId, skillFx) {
    const playerData = this.players.get(characterId);
    if (!playerData) return;
    const ud = playerData.group?.userData;
    if (!ud || !ud.swordBlade) return;

    const duration   = parseInt(skillFx.fx_duration) || 2000;
    const fxColor    = skillFx.fx_blade_color;
    const fxGlow     = skillFx.fx_glow_intensity;
    const fxParticle = skillFx.fx_particle_type;
    const wCfg       = ud.weaponConfig || {};

    // 切换剑刃颜色（临时）
    if (fxColor) {
      const c = parseInt(fxColor.replace('#',''), 16);
      ud.swordBlade.material.color.setHex(c);
      ud.swordBlade.material.emissive.setHex(c);
      if (ud.swordGlow) ud.swordGlow.material.color.setHex(c);
      if (ud.swordLight) ud.swordLight.color.setHex(c);
    }
    if (fxGlow != null) {
      ud.swordBlade.material.emissiveIntensity = parseFloat(fxGlow);
    }

    // 【双层粒子】skill层：独立叠加，不影响 base层(swordParticles)
    if (fxParticle && fxParticle !== 'none') {
      // 移除上一个技能粒子层（如果还在）
      if (ud.swordParticlesSkill) {
        ud.laserSword.remove(ud.swordParticlesSkill);
        ud.swordParticlesSkill = null;
      }
      const bladeLen = wCfg.blade_length ?? 0.8;
      const skillParticles = this._createSwordParticles(fxParticle, bladeLen);
      if (skillParticles) {
        skillParticles.position.y = 0.3 + bladeLen / 2;
        ud.laserSword.add(skillParticles);
        ud.swordParticlesSkill = skillParticles;  // skill层单独存储
      }
    }

    // 到期：只还原颜色和skill层粒子，base层(swordParticles)保持不变
    clearTimeout(ud._fxTimer);
    ud._fxTimer = setTimeout(() => {
      const origColor = wCfg.blade_color ? parseInt(wCfg.blade_color.replace('#',''), 16) : 0x00ffff;
      const origGlow  = wCfg.glow_intensity ?? 0.8;
      // 还原颜色
      ud.swordBlade.material.color.setHex(origColor);
      ud.swordBlade.material.emissive.setHex(origColor);
      if (ud.swordGlow) ud.swordGlow.material.color.setHex(origColor);
      if (ud.swordLight) ud.swordLight.color.setHex(origColor);
      ud.swordBlade.material.emissiveIntensity = origGlow;
      // 仅移除 skill层粒子，base层完整保留
      if (ud.swordParticlesSkill) {
        ud.laserSword.remove(ud.swordParticlesSkill);
        ud.swordParticlesSkill = null;
      }
    }, duration);
  }

  // 实时更新角色武器配置（服务器数据回来后调用，刷新内置激光剑颜色+粒子）
  updatePlayerWeaponConfig(characterId, weaponConfig) {
    const playerData = this.players.get(characterId);
    if (!playerData) return;
    const ud = playerData.group?.userData;
    if (!ud) return;
    // 保存新的武器配置
    ud.weaponConfig = weaponConfig;
    const cfg = weaponConfig || {};
    // 若是内置激光剑（有 swordBlade），直接更新颜色
    if (ud.swordBlade) {
      const color = cfg.blade_color ? parseInt(cfg.blade_color.replace('#',''), 16) : 0x00ffff;
      const glow  = cfg.glow_intensity ?? 0.8;
      ud.swordBlade.material.color.setHex(color);
      ud.swordBlade.material.emissive.setHex(color);
      ud.swordBlade.material.emissiveIntensity = glow;
      if (ud.swordGlow) ud.swordGlow.material.color.setHex(color);
      if (ud.swordLight) {
        ud.swordLight.color.setHex(color);
        ud.swordLight.intensity = cfg.point_light_intensity ?? 1.5;
      }
      console.log(`⚔️ [weapon] 武器颜色已更新 #${color.toString(16).padStart(6,'0')} (${cfg.blade_color})`);
    }
    // 更新 base 层粒子（支持类型切换：先移除旧的，再创建新的）
    const ptType = cfg.particle_type || 'none';
    const blLen  = cfg.blade_length ?? 0.8;
    const oldPtType = ud.swordParticles?.userData?.particleType || 'none';
    if (ud.laserSword && ptType !== oldPtType) {
      // 移除旧粒子
      if (ud.swordParticles) {
        ud.laserSword.remove(ud.swordParticles);
        ud.swordParticles = null;
        console.log(`✨ [weapon] 移除旧粒子: ${oldPtType}`);
      }
      // 创建新粒子
      if (ptType !== 'none') {
        const newP = this._createSwordParticles(ptType, blLen);
        if (newP) {
          newP.position.z = -(0.15 + blLen / 2);
          ud.laserSword.add(newP);
          ud.swordParticles = newP;
          console.log(`✨ [weapon] 武器粒子特效已更新: ${ptType}`);
        }
      }
    }
  }

  // 触发角色砍杀动作（传奇世界风格 - 三连击）
  triggerAttackAnimation(characterId) {
    const playerData = this.players.get(characterId);
    if (!playerData || !playerData.group) {
      return;
    }
    
    const characterGroup = playerData.group;
    const userData = characterGroup.userData;
    
    // 如果正在攻击，忽略
    if (userData.isAttacking) {
      return;
    }
    
    userData.isAttacking = true;
    
    // 使用动画系统播放普攻动画（会触发 attack1 音效）
    this._switchPlayerAnim(characterId, 'attack1');
    
    // ── 播放武器挥砍音效 ──
    if (typeof soundManager !== 'undefined' && soundManager.playWeaponSound) {
      soundManager.playWeaponSound('swing');
    }
    
    // 攻击动画结束后重置状态
    setTimeout(() => {
      userData.isAttacking = false;
      // 恢复待机状态
      this._switchPlayerAnim(characterId, 'idle');
    }, 1000); // 假设普攻动画时长为1秒
  }
  
  // 拔剑动画（从背上到右手）- 已禁用，光剑始终在右手
  drawSword(characterGroup, onComplete) {
    // 光剑已经在右手上，无需拔剑动画
    if (onComplete) onComplete();
    
    /* 原拔剑动画已注释
    const userData = characterGroup.userData;
    const drawDuration = 150; // 拔剑150ms
    const startTime = Date.now();
    
    // 保存背上的位置
    const backPos = new THREE.Vector3(-0.1, 0.6, -0.2);
    const backRot = new THREE.Euler(Math.PI, 0, Math.PI * 0.1);
    
    // 右手前臂位置（握在手中）- 改为负数（右侧）
    const handPos = new THREE.Vector3(-0.38, 0.3, 0.3); // 右手前臂位置
    const handRot = new THREE.Euler(-Math.PI * 0.5, 0, 0); // 剑尖朝前
    
    const animateDraw = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / drawDuration, 1);
      const t = progress; // 线性插值
      
      // 剑从背上移动到右手
      userData.laserSword.position.lerpVectors(backPos, handPos, t);
      userData.laserSword.rotation.x = backRot.x + (handRot.x - backRot.x) * t;
      userData.laserSword.rotation.y = backRot.y + (handRot.y - backRot.y) * t;
      userData.laserSword.rotation.z = backRot.z + (handRot.z - backRot.z) * t;
      
      // 右臂配合拔剑动作
      userData.rightArm.rotation.x = -Math.PI * 0.3 * t;
      userData.rightArm.rotation.z = -Math.PI * 0.2 * t; // 改为负数（右侧）
      
      if (progress < 1) {
        requestAnimationFrame(animateDraw);
      } else {
        if (onComplete) onComplete();
      }
    };
    
    animateDraw();
    */
  }
  
  // 收剑动画（从右手到背上）- 已禁用，光剑始终在右手
  sheathSword(characterGroup) {
    // 光剑始终在右手上，无需收剑动画
    console.log('🗡️ 光剑已在右手，无需收剑');
    
    /* 原收剑动画已注释
    const userData = characterGroup.userData;
    const sheathDuration = 200; // 收剑200ms
    const startTime = Date.now();
    
    // 右手位置
    const handPos = userData.laserSword.position.clone();
    const handRot = userData.laserSword.rotation.clone();
    
    // 背上位置
    const backPos = new THREE.Vector3(-0.1, 0.6, -0.2);
    const backRot = new THREE.Euler(Math.PI, 0, Math.PI * 0.1);
    
    const animateSheath = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / sheathDuration, 1);
      const t = progress;
      
      // 剑从右手移回背上
      userData.laserSword.position.lerpVectors(handPos, backPos, t);
      userData.laserSword.rotation.x = handRot.x + (backRot.x - handRot.x) * t;
      userData.laserSword.rotation.y = handRot.y + (backRot.y - handRot.y) * t;
      userData.laserSword.rotation.z = handRot.z + (backRot.z - handRot.z) * t;
      
      // 右臂回到自然位置
      userData.rightArm.rotation.x *= (1 - t);
      userData.rightArm.rotation.z *= (1 - t);
      userData.rightElbow.rotation.x *= (1 - t);
      
      if (progress < 1) {
        requestAnimationFrame(animateSheath);
      } else {
        console.log('🗡️ 收剑完成');
      }
    };
    
    animateSheath();
    */
  }
  
  // 执行攻击动作
  performAttack(characterGroup, comboIndex, originalSwordPos, originalSwordRot, 
    originalRightArmRotation, originalRightElbowRotation, originalBodyRotation) {
    const userData = characterGroup.userData;
    
    // 传奇风格攻击动画参数（快速有力）
    const attackDuration = 300; // 更快的攻击节奏 300ms
    const startTime = Date.now();
    
    // 创建剑光特效
    this.createSlashEffect(characterGroup.position, comboIndex);
    
    // 根据连击次数选择不同的攻击动作
    const animateAttack = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / attackDuration, 1);
      
      // 使用更激进的缓动函数（快进快出）
      const easeProgress = progress < 0.5 
        ? 4 * progress * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      
      // 所有攻击都侧身（身体向右侧45度）
      const sideStance = Math.PI * 0.25; // 45度侧身
      
      if (comboIndex === 1) {
        // 第一击：右上斜劈（从右上到左下）
        if (progress < 0.3) {
          // 蓄力阶段（快速）
          const t = progress / 0.3;
          userData.rightArm.rotation.x = -Math.PI * 0.9 * t;
          userData.rightArm.rotation.z = -Math.PI * 0.3 * t; // 改为负数（右侧）
          userData.rightElbow.rotation.x = -Math.PI * 0.4 * t;
          characterGroup.rotation.y = originalBodyRotation - sideStance * t; // 改为负数（右转）
          userData.laserSword.rotation.x = -Math.PI * 0.5 + Math.PI * 0.2 * t;
        } else {
          // 挥砍阶段（极快）
          const t = (progress - 0.3) / 0.7;
          const strike = Math.pow(t, 2); // 加速挥击
          userData.rightArm.rotation.x = -Math.PI * 0.9 + Math.PI * 1.6 * strike;
          userData.rightArm.rotation.z = -Math.PI * 0.3 + Math.PI * 0.6 * strike; // 向左侧
          userData.rightElbow.rotation.x = -Math.PI * 0.4 + Math.PI * 0.6 * strike;
          characterGroup.rotation.y = originalBodyRotation - sideStance; // 保持右转侧身
          userData.laserSword.rotation.x = -Math.PI * 0.5 + Math.PI * 0.2 - Math.PI * 1.2 * strike;
        }
      } else if (comboIndex === 2) {
        // 第二击：左下上挑（从左下到右上）
        if (progress < 0.3) {
          const t = progress / 0.3;
          userData.rightArm.rotation.x = Math.PI * 0.2 * t;
          userData.rightArm.rotation.z = Math.PI * 0.3 * t; // 改为正数（左侧）
          userData.rightElbow.rotation.x = -Math.PI * 0.3 * t;
          characterGroup.rotation.y = originalBodyRotation - sideStance; // 保持右转
          userData.laserSword.rotation.x = -Math.PI * 0.5 - Math.PI * 0.3 * t;
        } else {
          const t = (progress - 0.3) / 0.7;
          const strike = Math.pow(t, 2);
          userData.rightArm.rotation.x = Math.PI * 0.2 - Math.PI * 1.3 * strike;
          userData.rightArm.rotation.z = Math.PI * 0.3 - Math.PI * 0.5 * strike; // 向右侧
          userData.rightElbow.rotation.x = -Math.PI * 0.3 + Math.PI * 0.5 * strike;
          characterGroup.rotation.y = originalBodyRotation - sideStance; // 保持右转侧身
          userData.laserSword.rotation.x = -Math.PI * 0.5 - Math.PI * 0.3 + Math.PI * 1.0 * strike;
        }
      } else {
        // 第三击：正面重劈（从上到下，最强力）
        if (progress < 0.25) {
          const t = progress / 0.25;
          userData.rightArm.rotation.x = -Math.PI * 1.1 * t; // 举过头顶
          userData.rightElbow.rotation.x = -Math.PI * 0.5 * t;
          userData.laserSword.rotation.x = -Math.PI * 0.5 + Math.PI * 0.4 * t;
          characterGroup.rotation.y = originalBodyRotation - sideStance; // 保持右转
          // 身体后仰蓄力
          characterGroup.rotation.x = -Math.PI * 0.05 * t;
        } else {
          const t = (progress - 0.25) / 0.75;
          const strike = Math.pow(t, 1.5); // 更强的加速
          userData.rightArm.rotation.x = -Math.PI * 1.1 + Math.PI * 1.8 * strike;
          userData.rightElbow.rotation.x = -Math.PI * 0.5 + Math.PI * 0.8 * strike;
          userData.laserSword.rotation.x = -Math.PI * 0.5 + Math.PI * 0.4 - Math.PI * 1.5 * strike;
          characterGroup.rotation.y = originalBodyRotation - sideStance; // 保持右转侧身
          // 身体前倾发力
          characterGroup.rotation.x = -Math.PI * 0.05 + Math.PI * 0.1 * strike;
        }
      }
      
      // 继续动画或重置
      if (progress < 1) {
        requestAnimationFrame(animateAttack);
      } else {
        // 重置姿势（快速回位到待战姿势，保持侧身）
        const resetDuration = 100; // 100ms快速复位
        const resetStart = Date.now();
        
        const resetAnimation = () => {
          const resetElapsed = Date.now() - resetStart;
          const resetProgress = Math.min(resetElapsed / resetDuration, 1);
          
          // 手臂回到待战姿势（右臂微抬，持剑在右手）
          const targetArmX = -Math.PI * 0.3;
          const targetArmZ = -Math.PI * 0.2; // 改为负数（右侧）
          const targetElbowX = -Math.PI * 0.1;
          const targetSwordX = -Math.PI * 0.5; // 剑尖朝前
          
          userData.rightArm.rotation.x += (targetArmX - userData.rightArm.rotation.x) * resetProgress;
          userData.rightArm.rotation.z += (targetArmZ - userData.rightArm.rotation.z) * resetProgress;
          userData.rightElbow.rotation.x += (targetElbowX - userData.rightElbow.rotation.x) * resetProgress;
          userData.laserSword.rotation.x += (targetSwordX - userData.laserSword.rotation.x) * resetProgress;
          
          // 保持右转侧身姿势（不恢复到正面）
          characterGroup.rotation.y = originalBodyRotation - sideStance; // 改为负数
          characterGroup.rotation.x += (0 - characterGroup.rotation.x) * resetProgress;
          
          if (resetProgress < 1) {
            requestAnimationFrame(resetAnimation);
          } else {
            userData.isAttacking = false;
            console.log(`⚔️ ${comboIndex}连击完成（待战姿势）`);
          }
        };
        
        resetAnimation();
      }
    };
    
    // 开始攻击动画
    animateAttack();
    
    console.log(`⚔️ 触发第${comboIndex}连击`);
  }
  
  // 创建剑光特效（传奇风格）
  createSlashEffect(position, comboIndex) {
    // 创建剑光拖尾效果
    const slashGeometry = new THREE.PlaneGeometry(2, 0.3);
    const slashMaterial = new THREE.MeshBasicMaterial({
      color: comboIndex === 3 ? 0xff0000 : 0x00ffff, // 第三击红色，其他青色
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    
    const slash = new THREE.Mesh(slashGeometry, slashMaterial);
    slash.position.copy(position);
    slash.position.y += 1.5;
    
    // 根据连击次数设置不同角度
    if (comboIndex === 1) {
      slash.rotation.z = -Math.PI * 0.25; // 右上到左下
    } else if (comboIndex === 2) {
      slash.rotation.z = Math.PI * 0.25; // 左下到右上
    } else {
      slash.rotation.z = 0; // 正面劈砍
      slash.scale.y = 1.5; // 第三击更大
    }
    
    this.scene.add(slash);
    
    // 动画：剑光快速扩大并消失
    const startTime = Date.now();
    const effectDuration = 200;
    
    const animateSlash = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / effectDuration;
      
      if (progress < 1) {
        slash.scale.x = 1 + progress * 0.5;
        slash.material.opacity = 0.8 * (1 - progress);
        requestAnimationFrame(animateSlash);
      } else {
        this.scene.remove(slash);
        slashGeometry.dispose();
        slashMaterial.dispose();
      }
    };
    
    animateSlash();
  }

  // =====================================================
  // 媒体对象加载系统（图片/视频/iframe）
  // =====================================================

  /**
   * 加载单个媒体对象（用于主队列串行加载）
   * 与 loadMediaObjects() 批量加载配合使用
   */
  async loadMediaObject(mediaObj) {
    try {
      const name = mediaObj.name || mediaObj.id;
      console.log(`🖼️ [媒体-串行] 开始加载: ${name}`);

      // 复用已有的单文件加载逻辑
      await this._loadSingleMedia(mediaObj);

      console.log(`✅ [媒体-串行] 加载完成: ${name}`);
    } catch (error) {
      console.error(`❌ [媒体-串行] 加载失败: ${mediaObj.name}`, error);
    }
  }

  /**
   * 批量加载媒体对象，按优先级排序，并发限制3个
   */
  loadMediaObjects(mediaObjects) {
    if (!mediaObjects || mediaObjects.length === 0) return;

    // 读取上次已加载的URL列表，优先加载
    let loadedUrls = [];
    try { loadedUrls = JSON.parse(localStorage.getItem('media_loaded_urls') || '[]'); } catch(e) {}

    const sorted = [...mediaObjects].sort((a, b) => {
      const aLoaded = loadedUrls.includes(a.model_path) ? 0 : 1;
      const bLoaded = loadedUrls.includes(b.model_path) ? 0 : 1;
      if (aLoaded !== bLoaded) return aLoaded - bLoaded;
      // 次级排序：距出生点近的优先
      const px = this.player ? this.player.position.x : 0;
      const pz = this.player ? this.player.position.z : 0;
      const da = Math.hypot((a.position_x||0) - px, (a.position_z||0) - pz);
      const db = Math.hypot((b.position_x||0) - px, (b.position_z||0) - pz);
      return da - db;
    });

    console.log(`🖼️ 开始延迟加载 ${sorted.length} 个媒体对象`);

    const CONCURRENCY = 3;
    let idx = 0;
    let active = 0;

    const runNext = () => {
      while (active < CONCURRENCY && idx < sorted.length) {
        const obj = sorted[idx++];
        active++;
        this._loadSingleMedia(obj).finally(() => {
          active--;
          runNext();
        });
      }
    };

    // 使用 requestIdleCallback 或 setTimeout 在空闲时加载
    if (window.requestIdleCallback) {
      requestIdleCallback(() => runNext(), { timeout: 5000 });
    } else {
      setTimeout(runNext, 500);
    }
  }

  /**
   * 加载单个媒体对象并添加到场景
   */
  async _loadSingleMedia(obj) {
    const { id, model_path, model_type, type,
            position_x=0, position_y=3, position_z=0,
            rotation_x=0, rotation_y=0, rotation_z=0,
            scale_x=8, scale_y=4.5, name='' } = obj;

    if (!model_path) return;

    let props = {};
    try { props = JSON.parse(obj.properties || '{}'); } catch(e) {}
    
    // 合并 video_props 到 props 中（视频属性优先使用 video_props）
    if (obj.video_props) {
      try {
        const videoProps = typeof obj.video_props === 'string' 
          ? JSON.parse(obj.video_props) 
          : obj.video_props;
        props = { ...props, ...videoProps };
      } catch(e) {
        console.warn('解析video_props失败:', e);
      }
    }

    const w = scale_x || props.width || 8;
    const h = scale_y || props.height || 4.5;

    try {
      if (type === 'media_image') {
        await this._addImagePlane(obj, w, h, props);
      } else if (type === 'media_video') {
        await this._addVideoPlane(obj, w, h, props);
      }
    } catch(e) {
      console.warn(`媒体加载失败 [${name}]:`, e.message);
    }
  }

  /**
   * 添加图片平面到场景
   */
  _addImagePlane(obj, w, h, props) {
    return new Promise((resolve) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xcccccc,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(obj.position_x||0, obj.position_y||3, obj.position_z||0);
      mesh.rotation.set(obj.rotation_x||0, obj.rotation_y||0, obj.rotation_z||0);
      mesh.userData.mediaType = 'image';
      mesh.userData.mediaId = obj.id;
      mesh.userData.mediaUrl = obj.model_path;
      this.scene.add(mesh);

      // 存入媒体对象映射
      if (!this._mediaMeshes) this._mediaMeshes = new Map();
      this._mediaMeshes.set(obj.id, { mesh, obj, type: 'image' });

      // 异步加载纹理
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = 'anonymous';
      
      const name = obj.name || obj.model_path.split('/').pop();
      this.updateMediaProgress(name, 0);  // 开始跟踪
      
      loader.load(
        obj.model_path,
        (tex) => {
          tex.encoding = THREE.sRGBEncoding;
          mat.map = tex;
          mat.color.set(0xffffff);
          mat.opacity = 1;
          mat.needsUpdate = true;
          this.updateMediaProgress(name, 100, true);  // 标记完成
          this._markMediaLoaded(obj.model_path);
          this.removePlaceholder(obj.id);  // 移除占位符
          resolve();
        },
        (progress) => {
          const total = progress.total || 0;
          if (total > 0) {
            const pct = Math.min(99, Math.round((progress.loaded / total) * 100));
            this.updateMediaProgress(name, pct, true);
          }
        },
        () => {
          mat.color.set(0xaa4444);
          mat.opacity = 0.8;
          mat.needsUpdate = true;
          this.updateMediaProgress(name, 0);
          this.removePlaceholder(obj.id);  // 加载失败时也移除占位符
          resolve();
        }
      );
    });
  }

  /**
   * 添加视频平面到场景
   */
  _addVideoPlane(obj, w, h, props) {
    const mediaType = obj.model_type || 'video_direct';

    if (!this._mediaMeshes) this._mediaMeshes = new Map();
    if (!this._videoElements) this._videoElements = new Map();

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ color: 0x111133, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(obj.position_x||0, obj.position_y||3, obj.position_z||0);
    mesh.rotation.set(obj.rotation_x||0, obj.rotation_y||0, obj.rotation_z||0);
    mesh.userData.mediaType = mediaType;
    mesh.userData.mediaId = obj.id;
    mesh.userData.mediaUrl = obj.model_path;
    mesh.userData.mediaProps = props;
    this.scene.add(mesh);
    this._mediaMeshes.set(obj.id, { mesh, obj, type: 'video', mediaType });

    // iframe类型：仅显示平台颜色，不做WebGL纹理
    const iframeColors = {
      iframe_bilibili: 0x00a1d6, iframe_qq: 0xff6600,
      iframe_douyin: 0x161823, iframe_youtube: 0xff0000
    };
    if (iframeColors[mediaType]) {
      mat.color.set(iframeColors[mediaType]);
      return Promise.resolve();
    }

    // 直链视频：创建 VideoTexture（惰性加载，用 Intersection Observer 思路）
    return new Promise(resolve => {
      const video = document.createElement('video');
      video.src = obj.model_path;
      video.crossOrigin = 'anonymous';
      video.loop = props.loop !== false;
      video.muted = props.muted !== false;
      video.playsInline = true;
      video.preload = 'auto';
      video.style.display = 'none';
      document.body.appendChild(video);
      this._videoElements.set(obj.id, video);

      const name = obj.name || obj.model_path.split('/').pop();
      this.updateMediaProgress(name, 0);  // 开始跟踪

      // 监听缓冲进度
      video.addEventListener('progress', () => {
        if (video.buffered.length > 0 && video.duration > 0) {
          const loaded = video.buffered.end(video.buffered.length - 1);
          const pct = Math.round((loaded / video.duration) * 100);
          this.updateMediaProgress(name, Math.min(99, pct), true);
        }
      });

      video.addEventListener('loadeddata', () => {
        this.updateMediaProgress(name, 100, true);
      });

      video.addEventListener('loadedmetadata', () => {
        const vTex = new THREE.VideoTexture(video);
        vTex.encoding = THREE.sRGBEncoding;
        mat.map = vTex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        this._markMediaLoaded(obj.model_path);
        this.removePlaceholder(obj.id);  // 移除占位符
        if (props.autoplay) {
          video.muted = true;
          video.play().catch(() => {});
        }
        resolve();
      }, { once: true });
      
      video.addEventListener('error', () => {
        this.updateMediaProgress(name, 0);
        this.removePlaceholder(obj.id);  // 加载失败时也移除占位符
        resolve();
      }, { once: true });
    });
  }

  /**
   * 记录已加载的媒体URL到localStorage
   */
  _markMediaLoaded(url) {
    try {
      const list = JSON.parse(localStorage.getItem('media_loaded_urls') || '[]');
      if (!list.includes(url)) {
        list.unshift(url);
        if (list.length > 100) list.splice(100);
        localStorage.setItem('media_loaded_urls', JSON.stringify(list));
      }
    } catch(e) {}
  }

  /**
   * 每帧检查：视频与玩家距离，触发/停止播放，空间音效
   * 在主循环的 update() 方法中调用
   */
  updateMediaObjects(playerPosition) {
    if (!this._mediaMeshes || !playerPosition) return;

    const PLAY_DISTANCE = 40;   // 进入此范围显示HUD
    const STOP_DISTANCE = 60;   // 超出此范围暂停

    this._mediaMeshes.forEach(({ mesh, obj, type, mediaType }, id) => {
      if (type !== 'video') return;
      const video = this._videoElements && this._videoElements.get(id);
      if (!video) return;

      const dist = playerPosition.distanceTo(mesh.position);

      // 广告牌模式：始终朝向玩家
      const props = mesh.userData.mediaProps || {};
      if (props.billboard) {
        mesh.lookAt(playerPosition.x, mesh.position.y, playerPosition.z);
      }

      if (dist <= PLAY_DISTANCE && video.paused && !video.muted) {
        // 已被用户解锁声音，自动恢复播放
      } else if (dist > STOP_DISTANCE && !video.paused) {
        video.pause();
      } else if (dist <= PLAY_DISTANCE && video.paused && props.autoplay) {
        video.play().catch(() => {});
      }

      // 空间音量衰减（仅对有AudioContext的视频有效）
      if (this._videoAudioNodes && this._videoAudioNodes.has(id)) {
        const gain = this._videoAudioNodes.get(id);
        const vol = Math.max(0, 1 - dist / STOP_DISTANCE);
        gain.gain.setTargetAtTime(vol, this._audioCtx.currentTime, 0.1);
      }
    });
  }

  /**
   * 为视频开启空间音效（玩家按F键时调用）
   */
  enableVideoSpatialAudio(mediaId) {
    if (!this._videoElements) return false;
    const video = this._videoElements.get(mediaId);
    if (!video) return false;

    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._videoAudioNodes = new Map();
    }
    this._audioCtx.resume();

    if (!this._videoAudioNodes.has(mediaId)) {
      const source = this._audioCtx.createMediaElementSource(video);
      const gain = this._audioCtx.createGain();
      source.connect(gain);
      gain.connect(this._audioCtx.destination);
      this._videoAudioNodes.set(mediaId, gain);
    }
    video.muted = false;
    video.play().catch(() => {});
    return true;
  }
}

// Export World class to global scope
if (typeof window !== 'undefined') {
  window.World = World;
}
