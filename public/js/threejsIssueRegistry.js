/**
 * 济宁米多信息科技有限公司 版权所有
 * Three.js 代码块「问题知识库」——已知问题的自动检测与处置（2026-09-24 v1.0.0）
 *
 * 目的：把踩过的坑固化成「可被机器识别 + 可自动处置」的条目。
 *   问题库越大，新代码放进来被自动识别/修正的比例越高。
 *
 * 三个作用域（scope）：
 *   code  —— 入库前静态体检（只读源码，admin 预览 / 批量 CLI 使用）
 *   scene —— 运行时对象体检验（世界加载后遍历场景，可自动修复）
 *   delegated —— 已知由其它模块处理（清洗器/世界归一化），知识库只登记不重复执行
 *
 * 动作分级（action）：
 *   auto-fix  —— 可安全自动修复（幂等）
 *   warn      —— 自动识别但需人工判断（提示）
 *   fatal     —— 直接不可用，必须人工处理
 *   delegated —— 已由其它模块自动处理，这里只记录知识
 *
 * 新增条目模板（照抄改字段，追加到文件末尾即可，见 §追加条目）：
 *   E({ id:'ISS-9xxx', scope:'code', category:'resource', severity:'medium', action:'warn',
 *       title:'一句话问题名',
 *       symptom:'用户视角看到的现象',
 *       rootCause:'代码层根因',
 *       detect:function (code) { return 命中时返回细节对象，否则 null; },
 *       fix:null,
 *       hint:'给操作者的处置建议',
 *       firstSeen:'YYYY-MM-DD', samples:['样本文件.html'], fixRef:'相关修复位置' });
 */
(function (global) {
  'use strict';

  const REGISTRY_VERSION = '1.1.0';
  const ENTRIES = [];
  const SESSION_FINDINGS = [];

  // ======================= 词条配置层（数据与逻辑分离） =======================
  // 清单型规则的数据全部走这里：新加载器 / 已删除 API / 灯光类名 / 允许的外链域名 /
  // 阈值 / 规则启停，都可在后台可视化增删，改完即时生效，无需改代码或发版。
  const DEFAULT_CONFIG = {
    loaders: ['GLTFLoader', 'DRACOLoader', 'OBJLoader', 'MTLLoader', 'FBXLoader', 'VOXLoader',
      'TextureLoader', 'CubeTextureLoader', 'FileLoader', 'ImageBitmapLoader', 'Loader',
      'AudioLoader', 'BufferGeometryLoader'],
    deadApi: ['THREE.Geometry', 'THREE.Face3', 'RGBFormat', 'THREE.VertexColors', 'THREE.ImageUtils',
      'THREE.UniformsUtils', 'THREE.TextGeometry', 'THREE.PlaneBufferGeometry', 'THREE.BoxBufferGeometry',
      'THREE.SphereBufferGeometry', 'THREE.CylinderBufferGeometry', 'THREE.Math'],
    lights: ['AmbientLight', 'DirectionalLight', 'PointLight', 'SpotLight', 'HemisphereLight', 'RectAreaLight'],
    externalHostsAllow: [],           // 允许的外链域名（命中即不报 ISS-1002）
    thresholds: { bigGeometry: 1000, bigDimension: 50, timers: 1, minObjectDim: 0.5 },
    rulesDisabled: [],                // 临时停用的规则编号
    notes: ''
  };

  let CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  let configMeta = { loaded: false, updatedAt: null, source: 'default' };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function applyConfig(partial) {
    const merged = clone(DEFAULT_CONFIG);
    if (partial && typeof partial === 'object') {
      ['loaders', 'deadApi', 'lights', 'externalHostsAllow', 'rulesDisabled'].forEach(function (k) {
        if (Array.isArray(partial[k]) && partial[k].length) merged[k] = partial[k].slice();
      });
      if (partial.thresholds && typeof partial.thresholds === 'object') {
        Object.keys(merged.thresholds).forEach(function (tk) {
          const v = Number(partial.thresholds[tk]);
          if (Number.isFinite(v) && v > 0) merged.thresholds[tk] = v;
        });
      }
      if (typeof partial.notes === 'string') merged.notes = partial.notes;
    }
    CONFIG = merged;
    return CONFIG;
  }

  function getConfig() { return CONFIG; }
  function getConfigMeta() { return configMeta; }

  const CONFIG_CACHE_KEY = 'threejs_issue_config_cache_v1';

  // 拉取后台配置（公开端点），失败静默回落默认值；成功则写入本地缓存供下次首屏即时可用
  function loadConfig(opts) {
    opts = opts || {};
    if (typeof fetch !== 'function') return Promise.resolve(CONFIG);
    const url = '/api/threejs-issues/config' + (opts.bust ? '?t=' + Date.now() : '');
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success) {
          applyConfig(d.config);
          configMeta = { loaded: true, updatedAt: d.updatedAt || null, source: d.config ? 'server' : 'default' };
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ config: CONFIG, updatedAt: d.updatedAt || null, at: Date.now() }));
            }
          } catch (e) {}
        }
        return CONFIG;
      })
      .catch(function () { return CONFIG; });
  }

  // 首屏即时可用：先读本地缓存（同步），再异步刷新
  function bootstrap() {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(CONFIG_CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached && cached.config) {
            applyConfig(cached.config);
            configMeta = { loaded: true, updatedAt: cached.updatedAt, source: 'cache' };
          }
        }
      } catch (e) {}
    }
    loadConfig();
  }

  function E(entry) {
    if (!entry || !entry.id || !entry.title) throw new Error('[IssueRegistry] 条目缺少 id/title');
    if (ENTRIES.some(function (e) { return e.id === entry.id; })) {
      console.warn('[IssueRegistry] 重复条目 id，已忽略:', entry.id);
      return null;
    }
    ENTRIES.push(entry);
    return entry;
  }

  function list() { return ENTRIES.slice(); }
  function get(id) { return ENTRIES.filter(function (e) { return e.id === id; })[0] || null; }

  // ======================= 代码级条目（入库前静态体检） =======================

  E({
    id: 'ISS-1001', scope: 'code', category: 'structure', severity: 'medium', action: 'delegated',
    title: '顶层 await（同步 Function 无法执行）',
    symptom: '代码在预览/世界里报 SyntaxError: await is only valid in async functions',
    rootCause: '网上示例多是 ESM 模块，允许顶层 await；代码块执行环境用同步 Function 构造',
    detect: function (code) { return /^\s*(?:await\b|(?:const|let|var)\s+[\w$]+\s*=\s*await\b)/m.test(code) ? {} : null; },
    fixRef: 'threejsCodeRunner 执行层 AsyncFunction 兜底（2026-09-24）',
    hint: '已自动改用 AsyncFunction 执行，无需处理；若效果需同步返回对象则建议改写为回调/入口函数',
    firstSeen: '2026-09-24', samples: ['展台.html']
  });

  E({
    id: 'ISS-1002', scope: 'code', category: 'resource', severity: 'medium', action: 'warn',
    title: '外链资源依赖（世界模式会被拦截或降级为占位贴图）',
    symptom: '贴图变白色/渐变、模型不出现、控制台出现 "fetch blocked"',
    rootCause: '资源指向外部域名（常为个人 GitHub Pages），世界模式安全桩拦截网络请求、TextureLoader 走渐变纹理桩',
    detect: function (code) {
      const urls = code.match(/https?:\/\/[^\s'"`)]+/g);
      if (!urls) return null;
      const allow = CONFIG.externalHostsAllow || [];
      const hosts = {};
      urls.forEach(function (u) {
        const h = u.replace(/^https?:\/\//, '').split('/')[0];
        if (allow.indexOf(h) >= 0) return; // 后台已放行的域名
        hosts[h] = (hosts[h] || 0) + 1;
      });
      return Object.keys(hosts).length ? { count: urls.length, hosts: Object.keys(hosts) } : null;
    },
    hint: '按流程 2.3 节做资源本地化（下载到 public/ 并改为相对路径），否则只能接受占位观感',
    firstSeen: '2026-09-24', samples: ['草地.html', '光柱.html', '代码云.html', '展台.html']
  });

  E({
    id: 'ISS-1003', scope: 'code', category: 'loader', severity: 'medium', action: 'warn',
    title: '使用了运行环境未内置的 Loader',
    symptom: '模型不显示、无报错（加载器被万能桩吞掉）',
    rootCause: 'r185 bundle 只内置部分加载器，未知 Loader 落到万能桩 → new 成功但 load 什么都不做',
    detect: function (code) {
      // 内置加载器白名单来自后台配置（CONFIG.loaders）：本地化一个新加载器后，
      // 后台加一行名字即不再报警告，无需改代码
      const BUILTIN = CONFIG.loaders || [];
      const missing = {};
      const re = /new\s+([A-Z][A-Za-z0-9]*Loader)\s*\(/g;
      let m;
      while ((m = re.exec(code)) !== null) {
        if (BUILTIN.indexOf(m[1]) < 0) missing[m[1]] = true;
      }
      return Object.keys(missing).length ? { loaders: Object.keys(missing) } : null;
    },
    hint: '把加载器本地化（参照 VOXLoader.js 的做法）或改走 GLTFLoader 管线',
    firstSeen: '2026-09-24', samples: ['城堡.html']
  });

  E({
    id: 'ISS-1004', scope: 'code', category: 'structure', severity: 'high', action: 'warn',
    title: '悬空引用（使用了未声明的 renderer/controls 等）',
    symptom: 'console 报 "renderer is not defined" / "controls is not defined"，代码块整体不可用',
    rootCause: '历史存库清洗会删除声明行但保留引用；或人工删掉了初始化段',
    detect: function (code) {
      const dangling = [];
      ['renderer', 'controls', 'camera', 'scene'].forEach(function (name) {
        const used = new RegExp('\\b' + name + '\\b').test(code);
        const declared = new RegExp('(?:var|let|const)\\s+' + name + '\\b|\\b' + name + '\\s*=|function\\s*\\w*\\s*\\([^)]*\\b' + name + '\\b').test(code);
        if (used && !declared) dangling.push(name);
      });
      return dangling.length ? { names: dangling } : null;
    },
    hint: '重新粘贴原始代码保存一次（2026-09-24 起存库不再删代码），或补上缺失的声明',
    firstSeen: '2026-09-24', samples: ['草地.html', '光柱.html']
  });

  E({
    id: 'ISS-1005', scope: 'code', category: 'layering', severity: 'medium', action: 'delegated',
    title: 'depthTest=false（X 光式特效）',
    symptom: '特效穿透建筑/地形/角色，出现在所有物体前面',
    rootCause: '单文件示例里 depthTest=false 观感更好，放进共享世界破坏遮挡关系',
    detect: function (code) { return /depthTest\s*[:=]\s*false/.test(code) ? {} : null; },
    fixRef: 'threejsWorldSanitizer.normalizeDepthState（Mesh 也覆盖，2026-09-24）',
    hint: '运行时已自动强制 depthTest=true，无需处理',
    firstSeen: '2026-09-24', samples: ['光柱.html']
  });

  E({
    id: 'ISS-1006', scope: 'code', category: 'api', severity: 'high', action: 'fatal',
    title: '使用了已删除的旧 API',
    symptom: '报错 "THREE.Xxx is not a constructor" 或几何/材质异常',
    rootCause: '示例代码停留在 r152 以前，相关 API 已被移除',
    detect: function (code) {
      // 已删除 API 清单来自后台配置（CONFIG.deadApi）：发现新的废弃 API 时加一行即可
      const DEAD = CONFIG.deadApi || [];
      const hits = DEAD.filter(function (k) {
        try { return new RegExp('\\b' + k.replace(/\./g, '\\.') + '\\b').test(code); } catch (e) { return false; }
      });
      return hits.length ? { api: hits } : null;
    },
    hint: '手工改写为新 API（见 r185 升级文档的 API 对照），normalizer 只能处理其中一部分',
    firstSeen: '2026-09-24', samples: []
  });

  E({
    id: 'ISS-1007', scope: 'code', category: 'structure', severity: 'low', action: 'delegated',
    title: 'TypeScript 语法',
    symptom: '语法错误或类型标注被误剥导致变量未定义',
    rootCause: '示例来自 TS 项目；Babel 未加载时走正则兜底，覆盖有限',
    detect: function (code) {
      return /:\s*(?:string|number|boolean|any|void|unknown)\b|interface\s+\w+\s*\{|\bas\s+[A-Z]\w*/.test(code) ? {} : null;
    },
    fixRef: 'ThreeJSCodeNormalizer.stripTypeScript',
    hint: '已自动剥离；若出现 "X is not defined" 说明剥离误伤，需手工清理后重新保存',
    firstSeen: '2026-09-24', samples: []
  });

  E({
    id: 'ISS-1008', scope: 'code', category: 'performance', severity: 'low', action: 'warn',
    title: '定时器驱动动画 / 渲染循环内高频分配',
    symptom: '世界内卡顿、帧率波动，或物体在无人观察时仍在跑逻辑',
    rootCause: '示例用 setInterval 驱动 uniform 或每帧创建对象，未接入渲染循环 delta',
    detect: function (code) {
      const timers = (code.match(/setInterval\s*\(/g) || []).length;
      const limit = (CONFIG.thresholds && CONFIG.thresholds.timers) || 1;
      return timers >= limit ? { timers: timers } : null;
    },
    hint: '世界模式会把 setInterval 收编为同步执行 20 次（不残留真实定时器）；建议手工改为渲染循环驱动',
    firstSeen: '2026-09-24', samples: ['代码云.html']
  });

  E({
    id: 'ISS-1009', scope: 'code', category: 'structure', severity: 'high', action: 'warn',
    title: '无入口函数且不产生场景对象',
    symptom: '预览空白、世界内什么都没出现，且无报错',
    rootCause: '代码是纯函数声明/工具片段，或只有副作用又不创建 Object3D；world 模式拿不到可挂载对象',
    detect: function (code) {
      const hasEntry = /^\s*function\s+((?:create|build|make|init|setup)[A-Za-z0-9_$]*)\s*\(/m.test(code) ||
        /\b__export_entries\b/.test(code);
      const createsObject = /new\s+THREE\.(?:Mesh|Group|Points|Line|Sprite|Scene|InstancedMesh|SkinnedMesh)\b/.test(code) ||
        /\.add\s*\(/.test(code);
      return (!hasEntry && !createsObject) ? {} : null;
    },
    hint: '为代码包一个 create*/build*/make* 入口函数并 return Object3D（世界模式据此挂载）',
    firstSeen: '2026-09-24', samples: []
  });

  E({
    id: 'ISS-1010', scope: 'code', category: 'lighting', severity: 'low', action: 'delegated',
    title: '代码自带灯光',
    symptom: '世界内亮度与预期不符（或完全不生效）',
    rootCause: '世界模式统一删灯（避免污染全场光照），代码自带的灯会被移除',
    detect: function (code) {
      // 灯光类名清单来自后台配置（CONFIG.lights）
      const names = (CONFIG.lights || []).join('|');
      if (!names) return null;
      try { return new RegExp('new\\s+THREE\\.(?:' + names + ')\\b').test(code) ? {} : null; } catch (e) { return null; }
    },
    fixRef: 'threejsWorldSanitizer：世界模式删除全部 isLight',
    hint: '需要自发光请用 MeshBasic/ShaderMaterial 或 emissive，不要依赖自带灯光',
    firstSeen: '2026-09-24', samples: ['代码云.html', '城堡.html']
  });

  E({
    id: 'ISS-1011', scope: 'code', category: 'scale', severity: 'low', action: 'delegated',
    title: '尺寸超出世界尺度（>50m 会被自动缩小）',
    symptom: '对象大得离谱、把视野压垮，或与周围建筑比例失调',
    rootCause: '示例按自身尺度建模（米级/微距/城市级），进世界未换算',
    detect: function (code) {
      const limit = (CONFIG.thresholds && CONFIG.thresholds.bigGeometry) || 1000;
      const re = new RegExp('(?:BoxGeometry|SphereGeometry|CylinderGeometry|PlaneGeometry)\\s*\\(\\s*(\\d{' +
        String(limit).length + ',})');
      const big = code.match(re);
      if (!big) return null;
      return Number(big[1]) >= limit ? { sample: big[0] } : null;
    },
    fixRef: 'world.js addThreeJSModel 尺寸归一化（>50m 等比缩到 50m；<0.1m 放大到 1m）',
    hint: '运行时已自动缩放；若比例仍不合适，用编辑器的缩放手柄微调',
    firstSeen: '2026-09-24', samples: ['小区.html']
  });

  // ======================= 场景级条目（运行时体检验 + 自动修复） =======================

  E({
    id: 'ISS-0001', scope: 'scene', category: 'layering', severity: 'high', action: 'auto-fix',
    title: '材质 depthTest=false 导致穿透遮挡物',
    symptom: '特效穿透建筑/地形，出现在所有物体之前（X 光效果）',
    rootCause: '示例代码的刻意 hack（单场景看着好），共享世界里破坏遮挡',
    detect: function (ctx) {
      const hits = [];
      ctx.root.traverse(function (o) {
        if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) { if (m && m.depthTest === false) hits.push(m); });
      });
      return hits.length ? { materials: hits.length } : null;
    },
    fix: function (ctx, detail) {
      let n = 0;
      ctx.root.traverse(function (o) {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        mats.forEach(function (m) { if (m && m.depthTest === false) { m.depthTest = true; n++; } });
      });
      return '已强制 ' + n + ' 个材质 depthTest=true';
    },
    firstSeen: '2026-09-24', samples: ['光柱.html'], fixRef: 'threejsWorldSanitizer.normalizeDepthState'
  });

  E({
    id: 'ISS-0002', scope: 'scene', category: 'layering', severity: 'high', action: 'auto-fix',
    title: 'ShaderMaterial 缺对数深度适配（遮挡层级错乱）',
    symptom: '自定义着色器的特效与场景其他物体的前后关系错乱',
    rootCause: '世界渲染器 logarithmicDepthBuffer=true，内置材质有着色器块适配，用户 ShaderMaterial 没有 → 深度编码不一致',
    detect: function (ctx) {
      const hits = [];
      ctx.root.traverse(function (o) {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        mats.forEach(function (m) {
          if (!m || !m.isShaderMaterial || m.isRawShaderMaterial) return;
          const src = (m.vertexShader || '') + (m.fragmentShader || '');
          // 已自带处理（含 `#include <logdepthbuf_*>` 形式，否则会重复声明变量导致编译失败）
          if (/vFragDepth|LOGARITHMIC_DEPTH|gl_FragDepth|logdepthbuf_/i.test(src)) return;
          if (!/gl_Position\s*=/.test(m.vertexShader || '')) return;
          if (!/void\s+main\s*\(/.test(m.fragmentShader || '')) return;
          hits.push(m);
        });
      });
      return hits.length ? { materials: hits.length } : null;
    },
    fix: function (ctx, detail) {
      // 【2026-09-24 收敛】sanitizer 已加载时委托其 patchShaderLogDepth —— 单一实现，
      // 同时获得"先校验后提交"（不留半成品）与容忍 `void main() /*c*/ {` 的正则；
      // 未加载（如 unified_editor 只引 registry+runner）时走下面的本地回退实现。
      const S = (typeof window !== 'undefined') ? window.ThreeJSWorldSanitizer : null;
      if (S && typeof S.patchShaderLogDepth === 'function') {
        let nd = 0;
        ctx.root.traverse(function (o) {
          const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          mats.forEach(function (m) {
            if (!m || !m.isShaderMaterial || m.isRawShaderMaterial) return;
            const before = m.vertexShader;
            S.patchShaderLogDepth(m);
            if (m.vertexShader !== before) nd++;
          });
        });
        return '已为 ' + nd + ' 个 ShaderMaterial 注入对数深度兼容代码（委托 sanitizer）';
      }
      const PARS_V = '#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\nvarying float vFragDepth;\nvarying float vIsPerspective;\n#endif\n';
      const BODY_V = '\n#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\nvFragDepth = 1.0 + gl_Position.w;\nvIsPerspective = projectionMatrix[2][3] == -1.0 ? 1.0 : 0.0;\n#endif\n';
      const PARS_F = '#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )\nuniform float logDepthBufFC;\nvarying float vFragDepth;\nvarying float vIsPerspective;\n#endif\n';
      const BODY_F = '\n#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )\ngl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;\n#endif\n';
      let n = 0;
      ctx.root.traverse(function (o) {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        mats.forEach(function (m) {
          if (!m || !m.isShaderMaterial || m.isRawShaderMaterial) return;
          const vs = m.vertexShader || '', fs = m.fragmentShader || '';
          // 收敛：守卫与 sanitizer 对齐（含 include <logdepthbuf_*> 形式也要跳过，否则重复声明 varying）
          if (/vFragDepth|LOGARITHMIC_DEPTH|gl_FragDepth|logdepthbuf_/i.test(vs + fs)) return;
          let last = null, mm;
          const re = /gl_Position\s*=[^;]*;/g;
          while ((mm = re.exec(vs)) !== null) last = mm;
          if (!last) return;
          const idx = last.index + last[0].length;
          // 【2026-09-24 收敛】片元 main 容忍 `)` 与 `{` 之间的注释；两端都校验通过才一起提交
          // （旧写法 fs.replace 未命中时仍赋 PARS_F → 半成品：VS 已注入 / FS 未注入）
          const fmRe = /(void\s+main\s*\(\s*(?:void\s*)?\)\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:\/\/[^\n]*\n\s*)?\{)/;
          if (!fmRe.test(fs)) return;
          const nextVs = PARS_V + vs.slice(0, idx) + BODY_V + vs.slice(idx);
          const nextFs = PARS_F + fs.replace(fmRe, '$1' + BODY_F);
          m.vertexShader = nextVs;
          m.fragmentShader = nextFs;
          m.needsUpdate = true;
          n++;
        });
      });
      return '已为 ' + n + ' 个 ShaderMaterial 注入对数深度兼容代码';
    },
    firstSeen: '2026-09-24', samples: ['代码云.html'], fixRef: 'threejsWorldSanitizer.patchShaderLogDepth'
  });

  E({
    id: 'ISS-0010', scope: 'scene', category: 'scale', severity: 'medium', action: 'delegated',
    title: '尺寸远小于世界尺度（微缩模型等于隐形）',
    symptom: '对象放进世界后完全看不到，但控制台无报错、对象确实存在',
    rootCause: '示例按微距相机建模（如城堡样本 setScalar(0.0015) → 仅 0.18m）',
    detect: function (ctx) {
      const THREE_ = ctx.THREE || global.THREE;
      if (!THREE_ || !THREE_.Box3) return null;
      const box = new THREE_.Box3().setFromObject(ctx.root);
      if (!isFinite(box.min.x)) return null;
      const s = new THREE_.Vector3(); box.getSize(s);
      const maxDim = Math.max(s.x, s.y, s.z);
      const limit = (CONFIG.thresholds && CONFIG.thresholds.minObjectDim) || 0.5;
      return (maxDim > 0 && maxDim < limit) ? { maxDim: Math.round(maxDim * 1000) / 1000, limit: limit } : null;
    },
    fixRef: 'world.js addThreeJSModel 尺寸归一化（< 最小可见尺寸 → 放大到 1m；阈值后台可调）',
    hint: '运行时已自动放大到 1 米；若比例仍不合适，用编辑器缩放手柄调整',
    firstSeen: '2026-09-24', samples: ['城堡.html']
  });

  E({
    id: 'ISS-0003', scope: 'scene', category: 'content', severity: 'high', action: 'warn',
    title: '执行成功但零渲染物（空对象）',
    symptom: '世界里什么都看不到，但也没有任何报错',
    rootCause: '依赖缺失（外部资源/未内置加载器/WASM）、异步等待未完成、或代码只创建了非渲染对象',
    detect: function (ctx) {
      let renderables = 0;
      ctx.root.traverse(function (o) {
        if (o.isMesh || o.isPoints || o.isLine || o.isSprite || o.isInstancedMesh) renderables++;
      });
      return renderables === 0 ? {} : null;
    },
    fix: null,
    hint: '检查 ISS-1002/ISS-1003 命中项；确认入口函数有 return Object3D；异步资源需本地化',
    firstSeen: '2026-09-24', samples: ['城堡.html', '教学楼.html', '展台.html']
  });

  E({
    id: 'ISS-0004', scope: 'scene', category: 'data', severity: 'medium', action: 'delegated',
    title: 'NaN 顶点（包围球半径 NaN → 视锥剔除异常"时隐时现"）',
    symptom: '模型随视角出现/消失，或整体不显示',
    rootCause: 'AI 生成/除零计算产生非有限顶点值',
    detect: function () { return null; }, // 由清洗器全量扫描，避免重复遍历
    fixRef: 'threejsWorldSanitizer.sanitizeGeometryNaN',
    hint: '运行时已自动把非有限顶点置 0 并重算包围球',
    firstSeen: '2026-09-24', samples: []
  });

  E({
    id: 'ISS-0005', scope: 'scene', category: 'material', severity: 'low', action: 'delegated',
    title: '非标准材质（自定义/第三方材质类）',
    symptom: '材质表现异常或报错',
    rootCause: '示例引入自定义材质类，世界渲染器未必兼容',
    detect: function () { return null; }, // 由清洗器统一降级
    fixRef: 'threejsWorldSanitizer.sanitizeMaterial → MeshStandardMaterial',
    hint: '运行时已自动降级为标准材质（保留颜色/贴图/透明度）',
    firstSeen: '2026-09-24', samples: []
  });

  // ======================= 执行器 =======================

  function emptyStat() { return { high: 0, medium: 0, low: 0, info: 0 }; }

  // 规则启停（后台可视化开关）
  function isDisabled(id) { return (CONFIG.rulesDisabled || []).indexOf(id) >= 0; }

  // 剥注释后再做检测，避免注释掉的代码产生误报
  // （例：代码云.html 把 `// vertexColors: THREE.VertexColors` 注释掉仍被旧 API 规则误命中）。
  // 保留 `http://` 这类字符串：行注释正则要求 `//` 前不是冒号。
  function stripComments(code) {
    return String(code || '')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  function auditCode(code, opts) {
    const findings = [];
    const scan = stripComments(code);
    const ctxOpts = Object.assign({ raw: String(code || '') }, opts || {});
    ENTRIES.forEach(function (e) {
      if (e.scope !== 'code' || typeof e.detect !== 'function') return;
      if (isDisabled(e.id)) return;
      let detail = null;
      try { detail = e.detect(scan, ctxOpts); } catch (err) { detail = { detectError: String(err && err.message || err) }; }
      if (!detail) return;
      findings.push({ id: e.id, title: e.title, category: e.category, severity: e.severity, action: e.action, detail: detail, hint: e.hint });
    });
    return { findings: findings, passed: findings.filter(function (f) { return f.action !== 'fatal'; }).length === findings.length };
  }

  function auditScene(root, THREE, opts) {
    opts = opts || {};
    const findings = [];
    if (!root || typeof root.traverse !== 'function') return { findings: findings, fixed: [] };
    const ctx = { root: root, THREE: THREE || global.THREE, opts: opts };
    ENTRIES.forEach(function (e) {
      if (e.scope !== 'scene' || typeof e.detect !== 'function') return;
      if (isDisabled(e.id)) return;
      let detail = null;
      try { detail = e.detect(ctx); } catch (err) { detail = null; }
      if (!detail) return;
      let fixResult = null;
      if (e.action === 'auto-fix' && typeof e.fix === 'function') {
        try { fixResult = e.fix(ctx, detail); } catch (err) { fixResult = '修复失败: ' + (err && err.message || err); }
      }
      findings.push({
        id: e.id, title: e.title, category: e.category, severity: e.severity,
        action: e.action, detail: detail, fixed: !!fixResult, fixResult: fixResult, hint: e.hint
      });
    });
    findings.forEach(function (f) { SESSION_FINDINGS.push({ at: Date.now(), scope: 'scene', id: f.id, fixed: f.fixed }); });
    if (findings.length && opts.silent !== true) logFindings(findings, 'scene');
    return { findings: findings, fixed: findings.filter(function (f) { return f.fixed; }) };
  }

  function logFindings(findings, scope) {
    const icon = { 'auto-fix': '🔧', warn: '⚠️', fatal: '🚫', delegated: 'ℹ️' };
    findings.forEach(function (f) {
      const tag = '[' + f.id + ']';
      const msg = icon[f.action] + ' ' + tag + ' ' + f.title + (f.fixResult ? ' → ' + f.fixResult : '') + (f.hint ? '｜建议: ' + f.hint : '');
      if (f.action === 'fatal') console.error(msg);
      else if (f.severity === 'high') console.warn(msg);
      else console.log(msg);
    });
    if (scope === 'scene' && typeof window !== 'undefined') window.__threejsIssueLast = findings;
  }

  function report() {
    const byId = {};
    SESSION_FINDINGS.forEach(function (f) { byId[f.id] = (byId[f.id] || 0) + 1; });
    return { registryVersion: REGISTRY_VERSION, entries: ENTRIES.length, sessionHits: byId, total: SESSION_FINDINGS.length };
  }

  function stats() {
    const s = { total: ENTRIES.length, byScope: {}, bySeverity: emptyStat(), byAction: {} };
    ENTRIES.forEach(function (e) {
      s.byScope[e.scope] = (s.byScope[e.scope] || 0) + 1;
      s.bySeverity[e.severity] = (s.bySeverity[e.severity] || 0) + 1;
      s.byAction[e.action] = (s.byAction[e.action] || 0) + 1;
    });
    return s;
  }

  const API = {
    version: REGISTRY_VERSION,
    list: list,
    get: get,
    stats: stats,
    auditCode: auditCode,
    auditScene: auditScene,
    report: report,
    add: E,
    logFindings: logFindings,
    // 词条配置层（后台可视化维护）
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    loadConfig: loadConfig,
    applyConfig: applyConfig,
    getConfig: getConfig,
    getConfigMeta: getConfigMeta,
    isDisabled: isDisabled,
    SEVERITY_ORDER: { high: 0, medium: 1, low: 2, info: 3 }
  };

  global.ThreeJSIssueRegistry = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  // 浏览器环境自举：先读本地缓存、再拉后台配置（Node/CLI 不执行）
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try { bootstrap(); } catch (e) {}
  }
})(typeof window !== 'undefined' ? window : globalThis);
