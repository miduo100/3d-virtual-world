/**
 * 济宁米多信息科技有限公司 版权所有
 * Three.js 代码规范化管道
 *
 * 在用户代码进入运行器之前，执行一系列安全、兼容的修正操作。
 * 每一步都记录修复内容，以便向用户展示诊断信息。
 *
 * 管道规则：
 *  1. 全角安全字符修正（仅分号/逗号/空格/零宽/BOM，不碰引号）
 *  2. HTML 实体反转义
 *  3. 不可见字符清理
 *  4. 老版 Three.js API 文本桥接
 *  5. export 剥离
 *  6. 敏感模式检测（fetch/XHR/cookie 等）
 *
 * 提供：
 *  1. normalize(code, opts)   — 完整规范化，返回 { code, fixes }
 *  2. normalizeSafe(code) — 仅安全规则，返回 { code, fixes }
 */
(function (global) {
  'use strict';

  // ---------- 全角字符映射（仅安全字符，不碰引号） ----------
  var SAFE_FULLWIDTH_MAP = {
    '\uff1b': ';',   // 全角分号 ；
    '\uff0c': ',',   // 全角逗号 ，
    '\uff08': '(',   // 全角左括号（
    '\uff09': ')',   // 全角右括号）
    '\u3000': ' ',   // 全角空格
    '\u00a0': ' ',   // 不间断空格 &nbsp;
    '\u200b': '',    // 零宽空格
    '\u200c': '',    // 零宽连字符
    '\u200d': '',    // 零宽断字符
    '\ufeff': '',    // BOM
    '\uff3d': '[',   // 全角左方括号【
    '\uff3e': ']',   // 全角右方括号】
    '\uff5b': '{',   // 全角左大括号｛
    '\uff5d': '}'    // 全角右大括号｝
  };

  // ---------- HTML 实体映射 ----------
  var HTML_ENTITY_MAP = {
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&#x27;': "'"
  };

  // ---------- Three.js API 桥接（方向：高版本 → 本系统基线 r128） ----------
  // 本系统运行在 three r128（2021年），AI 生成的代码多为 r152+/r160。
  // 将新 API 文本降级为 r128 原生写法，使其在 r128 上直接运行（无需 Polyfill 兜底）。
  var LEGACY_API_REPLACEMENTS = [
    // r152+ → r128（新色彩管理 API 降级）
    [/\boutputColorSpace\b/g, 'outputEncoding'],                  // renderer.outputColorSpace → outputEncoding
    [/\bcolorSpace\b/g, 'encoding'],                            // texture.colorSpace → texture.encoding
    [/\bTHREE\.SRGBColorSpace\b/g, 'THREE.sRGBEncoding'],       // 常量
    [/\bTHREE\.LinearSRGBColorSpace\b/g, 'THREE.LinearEncoding'],
    [/\bTHREE\.NoColorSpace\b/g, 'THREE.LinearEncoding'],
    [/\bTHREE\.RGBEColorSpace\b/g, 'THREE.RGBEFormat'],
    [/\bTHREE\.LinearDisplayP3ColorSpace\b/g, 'THREE.LinearEncoding'],
    [/\bTHREE\.DisplayP3ColorSpace\b/g, 'THREE.sRGBEncoding'],
    [/\bTHREE\.AgXToneMapping\b/g, 'THREE.ACESFilmicToneMapping'],
    [/\bTHREE\.NeutralToneMapping\b/g, 'THREE.ACESFilmicToneMapping'],
    [/\bTHREE\.KhronosTransparencyExampleToneMapping\b/g, 'THREE.ACESFilmicToneMapping'],
    // r125- 极老代码 → r128（升级到基线，使其在 r128 原生运行）
    [/\.addAttribute\s*\(/g, '.setAttribute('],                  // geometry.addAttribute → setAttribute
    [/\bTHREE\.Math\./g, 'THREE.MathUtils.'],                  // 旧命名空间
    [/\bTHREE\.Geometry\b(?!Utils)/g, 'THREE.BufferGeometry'], // 已废弃几何体（仅替换引用，渲染效果需用户升级代码）
  ];

  // ---------- 敏感模式（用于安全警告） ----------
  var SENSITIVE_PATTERNS = [
    { pattern: /\bfetch\s*\(/g, name: 'fetch()', risk: 'high' },
    { pattern: /\bXMLHttpRequest\b/g, name: 'XMLHttpRequest', risk: 'high' },
    { pattern: /\bdocument\.cookie\b/g, name: 'document.cookie', risk: 'high' },
    { pattern: /\blocalStorage\b/g, name: 'localStorage', risk: 'high' },
    { pattern: /\bsessionStorage\b/g, name: 'sessionStorage', risk: 'high' },
    { pattern: /\beval\s*\(/g, name: 'eval()', risk: 'high' },
    { pattern: /\bnew\s+Worker\s*\(/g, name: 'new Worker()', risk: 'medium' },
    { pattern: /\bimport\s*\(/g, name: 'import() 动态导入', risk: 'medium' },
    { pattern: /\brequire\s*\(/g, name: 'require()', risk: 'medium' },
    { pattern: /\batob\s*\(/g, name: 'atob()', risk: 'low' },
    { pattern: /\bbtoa\s*\(/g, name: 'btoa()', risk: 'low' },
    { pattern: /\bnew\s+WebSocket\s*\(/g, name: 'new WebSocket()', risk: 'medium' },
  ];

  // ---------- 不可用语法检测（TypeScript/JSX等） ----------
  var UNSUPPORTED_SYNTAX = [
    { pattern: /function\s+\w+\s*\([^)]*:\s*\w+[^)]*\)\s*:\s*\w+\s*\{/g, name: 'TypeScript 类型注解（函数）', severity: 'error' },
    { pattern: /:\s*(number|string|boolean|void|any|null|undefined)\s*[,=;)}]/g, name: 'TypeScript 类型注解（变量）', severity: 'warning' },
    { pattern: /<(mesh|group|boxGeometry|sphereGeometry|ambientLight|directionalLight|perspectiveCamera)\b[^>]*\/>/gi, name: 'JSX/React Three Fiber 语法', severity: 'error' },
  ];

  /**
   * 执行规范化，返回 { code, fixes }
   * @param {string} code - 原始代码
   * @param {object} opts
   *   opts.aggressive - 是否启用激进修正（默认 true）
   *   opts.stripExports - 是否剥离 export 语句（默认 true）
   *   opts.stripImports - 是否剥离 import 语句（默认 true，调用方兼容性处理）
   *   opts.stripTypeScript - 是否将 TypeScript 转译为 JavaScript（默认 true）
   *   opts.detectSensitive - 是否检测敏感模式（默认 true）
   *   opts.detectUnsupported - 是否检测不可用语法（默认 true）
   */
  function normalize(code, opts) {
    opts = opts || {};
    if (!code || typeof code !== 'string') return { code: '', fixes: [] };
    var fixes = [];
    var result = code;

    // 规则 1: 全角安全字符修正
    var fullwidthResult = fixFullwidthSafe(result);
    if (fullwidthResult.count > 0) {
      result = fullwidthResult.text;
      fixes.push({ rule: 'fullwidth_safe', count: fullwidthResult.count, description: '全角字符修正 ×' + fullwidthResult.count + '（分号/逗号/空格/零宽）' });
    }

    // 规则 2: HTML 实体反转义
    var entityResult = decodeHTMLEntities(result);
    if (entityResult.count > 0) {
      result = entityResult.text;
      fixes.push({ rule: 'html_entity', count: entityResult.count, description: 'HTML 实体反转义 ×' + entityResult.count, details: entityResult.details });
    }

    // 规则 3: 不可见字符清理（再次确保）
    var cleanResult = cleanInvisible(result);
    if (cleanResult.count > 0) {
      result = cleanResult.text;
      fixes.push({ rule: 'invisible_chars', count: cleanResult.count, description: '不可见字符清理 ×' + cleanResult.count });
    }

    // 规则 4: 老版 Three.js API 桥接
    if (opts.aggressive !== false) {
      var legacyResult = bridgeLegacyAPI(result);
      if (legacyResult.count > 0) {
        result = legacyResult.text;
        fixes.push({ rule: 'legacy_api', count: legacyResult.count, description: '老版 Three.js API 桥接 ×' + legacyResult.count, details: legacyResult.details });
      }
    }

    // 规则 4b: TypeScript → JavaScript 转译（在 export 剥离之前，因为 TS 的 export type 需要先处理）
    if (opts.stripTypeScript !== false) {
      var tsResult = stripTypeScript(result);
      if (tsResult.count > 0) {
        result = tsResult.text;
        fixes.push({ rule: 'strip_typescript', count: tsResult.count, description: 'TypeScript → JavaScript 转译' + (tsResult.method ? ' (' + tsResult.method + ')' : '') });
      }
    }

    // 规则 5: export 剥离
    var exportedEntries = [];
    if (opts.stripExports !== false) {
      var exportResult = stripExports(result);
      if (exportResult.count > 0) {
        result = exportResult.text;
        fixes.push({ rule: 'strip_exports', count: exportResult.count, description: '剥离 export 语句 ×' + exportResult.count });
      }
      exportedEntries = exportResult.exportedFunctions || [];
      // 入口名回写：导出的函数名以 var __export_entries 形式嵌入代码尾部，
      // 使"admin 预规范化 → 运行器二次规范化 → 存库后再预览"全链路中入口信息不丢失
      if (exportedEntries.length > 0 && result.indexOf('__export_entries') < 0) {
        result += '\nvar __export_entries = ' + JSON.stringify(exportedEntries) + ';';
      }
    }

    // 规则 5b: import 剥离 + 变量自动声明（P3，让 ESM import 的代码也能在 new Function 中运行）
    if (opts.stripImports !== false) {
      var decl = autoDeclareImports(result);
      var importStripped = decl.code.replace(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"]\s*;?\s*$/gm, '');
      if (importStripped !== result || decl.stubs.length > 0) {
        result = importStripped;
        fixes.push({
          rule: 'strip_imports',
          count: decl.stubs.length || 1,
          description: '剥离 import 语句' + (decl.stubs.length ? ' 并自动声明 ' + decl.stubs.length + ' 个变量' : '')
        });
      }
    }

    // 规则 6: 敏感模式检测
    if (opts.detectSensitive !== false) {
      var sensitiveWarnings = detectSensitive(result);
      if (sensitiveWarnings.length > 0) {
        fixes.push({ rule: 'sensitive_detect', count: sensitiveWarnings.length, description: '检测到 ' + sensitiveWarnings.length + ' 处敏感模式', details: sensitiveWarnings });
      }
    }

    // 规则 7: 不可用语法检测
    if (opts.detectUnsupported !== false) {
      var unsupportedWarnings = detectUnsupported(result);
      if (unsupportedWarnings.length > 0) {
        fixes.push({ rule: 'unsupported_syntax', count: unsupportedWarnings.length, description: '检测到 ' + unsupportedWarnings.length + ' 处不兼容语法', details: unsupportedWarnings });
      }
    }

    return { code: result, fixes: fixes, exportedEntries: exportedEntries };
  }

  /**
   * 仅安全规范化（不含激进规则如 legacy_api）
   */
  function normalizeSafe(code) {
    return normalize(code, { aggressive: false, stripExports: true, stripImports: true, stripTypeScript: true });
  }

  // ========== 内部函数 ==========

  function fixFullwidthSafe(text) {
    var count = 0;
    var result = text;
    Object.keys(SAFE_FULLWIDTH_MAP).forEach(function (char) {
      var before = result.length;
      result = result.split(char).join(SAFE_FULLWIDTH_MAP[char]);
      var diff = (before - result.length) / Math.max(1, char.length);
      count += diff;
    });
    return { text: result, count: Math.round(count) };
  }

  function decodeHTMLEntities(text) {
    var count = 0;
    var result = text;
    // &amp; 必须最后处理
    var order = ['&lt;', '&gt;', '&quot;', '&#39;', '&apos;', '&#x27;', '&amp;'];
    var details = [];
    order.forEach(function (entity) {
      var before = result;
      var parts = result.split(entity);
      if (parts.length > 1) {
        var cnt = parts.length - 1;
        count += cnt;
        details.push({ entity: entity, replacement: HTML_ENTITY_MAP[entity], count: cnt });
        result = parts.join(HTML_ENTITY_MAP[entity]);
      }
    });
    return { text: result, count: count, details: details };
  }

  function cleanInvisible(text) {
    var count = 0;
    var result = text.replace(/[\u200b\u200c\u200d\ufeff\u200e\u200f]/g, function () {
      count++;
      return '';
    });
    return { text: result, count: count };
  }

  function bridgeLegacyAPI(text) {
    var count = 0;
    var result = text;
    var details = [];
    LEGACY_API_REPLACEMENTS.forEach(function (item) {
      var matches = result.match(item[0]);
      if (matches) {
        count += matches.length;
        details.push({ api: item[0].toString(), count: matches.length });
        result = result.replace(item[0], item[1]);
      }
    });
    // 检测 THREE.Geometry（仅检测，不替换——已废弃无法桥接）
    var geoMatch = result.match(/\bTHREE\.Geometry\b/g);
    if (geoMatch) {
      details.push({ api: 'THREE.Geometry', count: geoMatch.length, fatal: true, suggestion: '此代码使用了已废弃的 THREE.Geometry（2019年前的写法），请换一份 2020 年后的 Three.js 示例代码' });
    }
    return { text: result, count: count, details: details };
  }

  function stripExports(text) {
    var count = 0;
    var result = text;

    // export type { X, Y } / export interface { ... }（TypeScript 类型导出，整行删除）
    result = result.replace(/^\s*export\s+type\s*\{[^}]*\}\s*;?\s*$/gm, function () {
      count++;
      return '';
    });

    // export type / export interface 块（多行，用大括号深度匹配）
    result = result.replace(/^\s*export\s+(type|interface)\s+\w+[\s\S]*?\}\s*;?\s*$/gm, function () {
      count++;
      return '';
    });
    // 单行 export type X = ...;
    result = result.replace(/^\s*export\s+type\s+\w+\s*=[^;]*;\s*$/gm, function () {
      count++;
      return '';
    });

    // export default X / export default function / export default class
    //   function/class: 保留关键字，转为表达式赋值给 __export_default
    //   表达式: 直接赋值给 __export_default
    result = result.replace(/^\s*export\s+default\s+(function|class|async\s+function)?\s*/gm, function (match, keyword) {
      count++;
      if (keyword) {
        return 'var __export_default = ' + keyword + ' ';
      }
      return 'var __export_default = ';
    });

    // export { a, b, c } / export { a as b }
    result = result.replace(/^\s*export\s*\{([^}]*)\}\s*$/gm, function () {
      count++;
      return '// export stripped';
    });

    // export const/let/var/function/class
    //   当 keyword 为 function/async function 时，捕获函数名供 runner 作为入口候选
    var exportedFuncs = [];
    result = result.replace(/^\s*export\s+(const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm, function (match, keyword, name) {
      count++;
      if (keyword === 'function' || keyword === 'async function') {
        exportedFuncs.push(name);
      }
      return keyword + ' ' + name;
    });

    return { text: result, count: count, exportedFunctions: exportedFuncs };
  }

  /**
   * TypeScript → JavaScript 转译
   *
   * 优先使用 @babel/standalone（若页面已加载）进行完整 TS→JS 转译，
   * 可处理类型注解、interface、type alias、as const、satisfies、! 断言等所有 TS 语法。
   *
   * 若 Babel 未加载或解析失败，则使用逐行扫描 + 正则兜底：
   *   - export type / export interface / type / interface 块（大括号深度匹配）
   *   - export type { ... } 类型导出
   *   - 行内类型注解 : Type
   *   - as const / as Type
   *   - satisfies Type
   *   - 非空断言 !
   *
   * @returns { text, count, method }
   */
  function stripTypeScript(code) {
    if (!code) return { text: code, count: 0 };

    // 优先：Babel 转译（对纯 JS 也是安全的 no-op）
    if (typeof Babel !== 'undefined' && Babel && Babel.transform) {
      try {
        var out = Babel.transform(code, {
          filename: 'snippet.ts',
          presets: [['typescript', { allowDeclareFields: true }]],
          sourceType: 'module',
          retainLines: true
        });
        if (out.code && out.code !== code) {
          return { text: out.code, count: 1, method: 'babel' };
        }
        // Babel 输出与输入相同 = 纯 JS，无需处理
        if (out.code === code) return { text: code, count: 0 };
      } catch (e) {
        // Babel 解析失败，走正则兜底
        console.warn('[ThreeJSCodeNormalizer] Babel 转译失败，回退正则兜底:', e && e.message);
      }
    }

    // Babel 不可用 — 检测是否包含 TS 语法（避免对纯 JS 误伤）
    var hasTS =
      /export\s+(type|interface|enum)\b/.test(code) ||
      /^\s*(type|interface|enum)\s+\w+/m.test(code) ||
      /:\s*(string|number|boolean|void|any|null|undefined|never|unknown|object)\b/.test(code) ||
      /\b(const|let|var)\s+\w+\s*:\s*[A-Za-z_$][\w$.]*/.test(code) ||        // 变量类型注解
      /\b(const|let|var)\s+\{[^}]*\}\s*:\s*[A-Za-z_$][\w$.]*/.test(code) ||  // 解构类型
      /\)\s*:\s*[A-Za-z_$][\w$.]*/.test(code) ||                              // 返回类型
      /\(\s*\w+\s*(?:\?\s*)?:\s*[A-Za-z_$][\w$.]*/.test(code) ||              // 函数参数类型
      /^\s+\w+[!?]?\s*:\s*(?:(?:string|number|boolean|void|any|null|undefined|never|unknown|object)\b|[A-Za-z_$][\w$.]*(?:<[^>]+>|\[\]))/m.test(code) ||                   // 类属性类型（收窄：仅 TS 关键字或泛型/数组形式，避免误伤对象字面量行尾属性）
      /\bas\s+const\b/.test(code) ||
      /\bsatisfies\s+/.test(code) ||
      /\b(function|class)\s+\w+\s*<[^>]+>/.test(code);                        // 泛型声明
    if (!hasTS) return { text: code, count: 0 };

    // 正则兜底：逐行扫描移除 TS 语法
    var result = code;
    var changed = false;

    // 1. 逐行扫描：移除 export type / export interface / type / interface / enum 块
    var lines = result.split('\n');
    var outLines = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^\s*(export\s+)?(type|interface)\s+\w+/.test(line) &&
          !/^\s*(export\s+)?type\s+\w+\s*=\s*[^{;]*;?\s*$/.test(line)) {
        var depth = 0, foundBrace = false;
        while (i < lines.length) {
          var bl = lines[i];
          for (var ci = 0; ci < bl.length; ci++) {
            if (bl[ci] === '{') { depth++; foundBrace = true; }
            if (bl[ci] === '}') { depth--; }
          }
          i++;
          if (foundBrace && depth <= 0) break;
          if (!foundBrace && /;\s*$/.test(bl)) break;
        }
        changed = true;
        continue;
      }
      if (/^\s*export\s+type\s*\{[^}]*\}\s*;?\s*$/.test(line)) { i++; changed = true; continue; }
      if (/^\s*type\s+\w+\s*=[^{};]*;\s*$/.test(line)) { i++; changed = true; continue; }
      // enum 块
      if (/^\s*(export\s+)?enum\s+\w+/.test(line)) {
        var ed = 0, efb = false;
        while (i < lines.length) {
          var el = lines[i];
          for (var ec = 0; ec < el.length; ec++) {
            if (el[ec] === '{') { ed++; efb = true; }
            if (el[ec] === '}') { ed--; }
          }
          i++;
          if (efb && ed <= 0) break;
        }
        changed = true;
        continue;
      }
      outLines.push(line);
      i++;
    }
    result = outLines.join('\n');

    // 2. 移除类型注解（仅在声明上下文中，避免误伤对象字面量/switch-case）

    // 2a. 可选参数标记: param?: Type → param: Type（仅后跟已知类型时）
    result = result.replace(
      /\b(\w+)\?\s*:\s*(?=(?:string|number|boolean|void|any|null|undefined|never|unknown|object|THREE\.\w+|[A-Za-z_$][\w$.]*|\{[^{}]*\}))/g,
      '$1:'
    );

    // 2b. 变量声明: const x: Type = ... → const x = ...
    //     支持: 泛型 Type<T>, 数组 Type[], 联合 Type | null, 内联对象类型
    result = result.replace(
      /\b(const|let|var)\s+(\w+)\s*:\s*(?:[A-Za-z_$][\w$.]*(?:<[^>]*>)?(?:\[\])*(?:\s*\|[^=;,\n]+)?|\{[^{}]*\})/g,
      '$1 $2'
    );

    // 2c. 解构声明: const { x, y }: Type = ... → const { x, y } = ...
    result = result.replace(
      /\b(const|let|var)\s+(\{[^}]*\})\s*:\s*[A-Za-z_$][\w$.]*(?:<[^>]*>)?/g,
      '$1 $2'
    );

    // 2d. 函数返回类型: ): Type { 或 ): Type => → ) {
    //     支持: 关键字（含联合）、泛型 Type<T>、数组 Type[]；同时匹配 { 和 =>
    //     收窄：裸标识符不再视为类型——与三目运算 cond ? f(): g => h 中的合法 JS 值无法区分
    result = result.replace(
      /\)\s*:\s*(?:(?:string|number|boolean|void|any|null|undefined|never|unknown|object)(?:\[\])*(?:\s*\|\s*(?:string|number|boolean|void|any|null|undefined|never|unknown|object)(?:\[\])*)*|[A-Za-z_$][\w$.]*(?:<[^>]+>|\[\])+)\s*(?=\{|=>)/g,
      ') '
    );

    // 2d-extra. 对象字面量返回类型: ): { prop: Type; ... } { / ): { prop: Type; ... } =>
    //     例如: function makeCanvas(w, h): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    result = result.replace(
      /\)\s*:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*(?=\{|=>)/g,
      ') '
    );

    // 2e-pre. 剥离回调类型参数: param: (args) => RetType → param
    //     回调类型中的括号会干扰 2e 的 [^()]* 参数匹配，必须在此前处理
    //     支持单层嵌套括号，例如: cb: (inner: (x: number) => void) => void
    //     收窄：返回类型仅认关键字（含联合/数组后缀）或泛型/数组形式，并要求以 , ) ; 或行尾结束——
    //     避免把 { cb: (a) => a * 2 } 这类合法的箭头函数属性值误删成 { cb * 2 }
    result = result.replace(
      /(\w+)\s*:\s*\(([^()]|\([^()]*\))*\)\s*=>\s*(?:(?:string|number|boolean|void|any|null|undefined|never|unknown|object)(?:\[\])*(?:\s*\|\s*(?:string|number|boolean|void|any|null|undefined|never|unknown|object)(?:\[\])*)*|[A-Za-z_$][\w$.]*(?:<[^>]+>|\[\])+)\s*(?=[,);]|$)/gm,
      '$1'
    );

    // 2e. 函数参数: (param: Type, ...) → (param, ...)
    //     支持: 关键字, 泛型 Type<T>, 数组 Type[], 联合, 内联对象类型, 带默认值的参数
    //     限定在 function / 方法 / 箭头函数参数列表内，避免误伤对象字面量
    //     收窄：裸标识符/成员表达式（含 THREE.X）不再视为类型——push({ x: y })、
    //     new THREE.PointsMaterial({ blending: THREE.AdditiveBlending }) 这类合法调用不会被误改
    result = result.replace(
      /(\bfunction(?:\s+\w+)?\s*\(|\b\w+\s*\(|=\s*\()([^()]*)(\)[^()]*(?:\{|=>))/g,
      function(match, prefix, params, suffix) {
        var cleaned = params.replace(
          /\b(\w+)\s*:\s*(?:string|number|boolean|void|any|null|undefined|never|unknown|object|[A-Za-z_$][\w$.]*(?:<[^>]+>|\[\])|\{[^{}]*\}|'[^'\n]*'|"[^"\n]*")(?:\[\])*(?:\s*\|\s*(?:null|undefined|string|number|boolean|void|any|never|unknown|object|[A-Za-z_$][\w$.]*(?:<[^>]+>|\[\])|\{[^{}]*\}|'[^'\n]*'|"[^"\n]*"))*\s*(?=[,)=]|$)/g,
          '$1'
        );
        return prefix + cleaned + suffix;
      }
    );

    // 2f. 类属性类型: (缩进的) prop: Type; / prop: Type = / prop!: Type; → prop; / prop =
    //     支持: 关键字（含联合）、泛型 Type<T>、数组 Type[]
    //     收窄：裸标识符/成员表达式不再视为类型——initialY: cloud.position.y、
    //     blending: THREE.AdditiveBlending 这类对象字面量行尾属性是合法 JS，绝不能剥成属性简写
    //     注意：内联对象类型已拆到 2f-obj 单独处理，不再混入本规则
    result = result.replace(
      /^(\s+)(\w+)[!?]?\s*:\s*(?:(?:string|number|boolean|void|any|null|undefined|never|unknown|object)(?:\[\])*(?:\s*\|\s*(?:string|number|boolean|void|any|null|undefined|never|unknown|object)(?:\[\])*)*|[A-Za-z_$][\w$.]*(?:<[^>]+>|\[\])+)\s*(?=[;=]|$)/gm,
      '$1$2'
    );

    // 2f-obj. 类属性内联对象类型: prop: { a: number; b: string }; → prop;
    //     收窄：仅限单行且必须以分号结尾——对象字面量属性值（如 parameters: { roughnessMap: ... }）
    //     是合法 JS，常跨多行或以逗号/右括号结束；[^{}] 可跨行匹配 + 多行 $ 断言会把
    //     合法对象值误剥成属性简写（狐狸思考代码块 parameters is not defined 的根因）。
    //     分号结尾在对象字面量中非法，可确定性区分 TS 类属性类型。
    result = result.replace(
      /^(\s+)(\w+)[!?]?\s*:\s*\{[^{}\n]*\}\s*(?=;)/gm,
      '$1$2'
    );

    // 2g. 泛型声明: function foo<T>( → function foo(  /  class Foo<T> → class Foo
    result = result.replace(/\b(function\s+\w+)\s*<[^>]+>(?=\()/g, '$1 ');
    result = result.replace(/\b(class\s+\w+)\s*<[^>]+>/g, '$1 ');

    // 3. as const / as Type / as Namespace.Type（支持数组和泛型）
    result = result.replace(/\s+as\s+const\b/g, '');
    result = result.replace(/\s+as\s+(?:[A-Z]\w*|[A-Za-z_$]\w*(?:\.[A-Za-z_$]\w*)+)(?:<[^>]*>)?(?:\[\])*\b/g, '');

    // 4. satisfies Type / satisfies Namespace.Type（支持数组和泛型）
    result = result.replace(/\s+satisfies\s+(?:[A-Z]\w*|[A-Za-z_$]\w*(?:\.[A-Za-z_$]\w*)+)(?:<[^>]*>)?(?:\[\])*\b/g, '');

    // 5. 非空断言 expr! → expr（! 前缀是 \w/]/) 的必然是后缀断言，排除 !== 避免误伤）
    result = result.replace(/(\w|\]|\))\!(?!\s*=)/g, '$1');

    // 6. 泛型函数调用 func<T>(args) → func(args)
    result = result.replace(/(\w)<[A-Z]\w*>(?=\()/g, '$1');

    // 检测是否有实际变化
    var inlineChanged = code !== result;
    if (changed || inlineChanged) {
      return { text: result, count: 1, method: 'regex' };
    }
    return { text: code, count: 0 };
  }

  /**
   * 自动检测代码中的清洗选项（替代手动复选框）
   *
   * 根据代码内容自动判断哪些部分需要剥离：
   *   - stripImport:   检测到 import 语句
   *   - stripRenderer: 检测到 new THREE.WebGLRenderer
   *   - stripControls: 检测到 new OrbitControls
   *   - stripDOMBox:   检测到 document.getElementById/querySelector（容器查找）
   *     注意：不再因 document.createElement 触发——Canvas 纹理生成（createElement('canvas')）
   *     是合法的建模代码，误删会导致保存后的代码块运行时报 canvas is not defined
   *   - stripLog:      始终 false（console 调试信息保留，运行器有桩化兜底）
   */
  function autoDetectCleanOptions(code) {
    if (!code || typeof code !== 'string') {
      return { stripImport: true, stripRenderer: false, stripControls: false, stripDOMBox: false, stripLog: false };
    }
    return {
      stripImport:   /^\s*import\s/m.test(code),
      stripRenderer: /new\s+THREE\.WebGLRenderer\b/.test(code),
      stripControls: /new\s+OrbitControls\b/.test(code),
      stripDOMBox:   /document\.(getElementById|querySelector)\b/.test(code),
      stripLog:      false
    };
  }

  function detectSensitive(text) {
    var warnings = [];
    SENSITIVE_PATTERNS.forEach(function (item) {
      var matches = text.match(item.pattern);
      if (matches) {
        warnings.push({ name: item.name, count: matches.length, risk: item.risk });
      }
    });
    return warnings;
  }

  function detectUnsupported(text) {
    var warnings = [];
    UNSUPPORTED_SYNTAX.forEach(function (item) {
      var matches = text.match(item.pattern);
      if (matches) {
        warnings.push({ name: item.name, count: matches.length, severity: item.severity });
      }
    });
    return warnings;
  }

  /**
   * 从 import 语句中收集导入的标识符，并在代码顶部注入"自动声明"，
   * 使剥离 import 后，用户代码里对这些名字的引用不再报 "is not defined"。
   *
   * 声明规则（不覆盖已存在的绑定）：
   *   var X = (typeof X !== 'undefined') ? X : (THREE.X || function(){});
   * 运行器会把常见类（OrbitControls/GLTFLoader/RoomEnvironment 等）作为
   * new Function 的参数传入，所以 typeof X 通常是已定义的，会原样保留；
   * 对于未作为参数传入的名字，则从 THREE 命名空间兜底，最后退化为 no-op 桩函数。
   *
   * @returns { code, stubs } code 为"声明 + 原始代码（含 import 行）"，调用方需再剥离 import 行
   */
  function autoDeclareImports(code) {
    var stubs = [];
    var m;

    // 1) 命名导入 import { A, B as C } from 'x'
    var namedRe = /^\s*import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/gm;
    while ((m = namedRe.exec(code)) !== null) {
      m[1].split(',').forEach(function (pairRaw) {
        var pair = pairRaw.trim();
        if (!pair) return;
        var parts = pair.split(/\s+as\s+/);
        var orig = (parts[0] || '').trim();
        var alias = (parts[1] || orig).trim();
        if (!alias || !/^[A-Za-z_$][\w$]*$/.test(alias)) return;
        stubs.push('var ' + alias + ' = (typeof ' + alias + " !== 'undefined') ? " + alias + ' : (THREE.' + orig + ' || function(){});');
      });
    }

    // 2) 默认导入 import Default from 'x'
    var defaultRe = /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]+['"]\s*;?\s*$/gm;
    while ((m = defaultRe.exec(code)) !== null) {
      var name = m[1].trim();
      stubs.push('var ' + name + ' = (typeof ' + name + " !== 'undefined') ? " + name + ' : THREE;');
    }

    // 3) 命名空间导入 import * as NS from 'x'（THREE 已由运行器提供，跳过）
    var nsRe = /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]+['"]\s*;?\s*$/gm;
    while ((m = nsRe.exec(code)) !== null) {
      var ns = m[1].trim();
      if (ns === 'THREE') continue;
      stubs.push('var ' + ns + ' = (typeof ' + ns + " !== 'undefined') ? " + ns + ' : THREE;');
    }

    if (stubs.length === 0) return { code: code, stubs: [] };
    var decl = '/* 自动声明的导入变量（运行器已提供常见类，其余从 THREE 命名空间兜底） */\n' + stubs.join('\n') + '\n';
    return { code: decl + code, stubs: stubs };
  }

  global.ThreeJSCodeNormalizer = {
    normalize: normalize,
    normalizeSafe: normalizeSafe,
    fixFullwidthSafe: fixFullwidthSafe,
    decodeHTMLEntities: decodeHTMLEntities,
    bridgeLegacyAPI: bridgeLegacyAPI,
    stripExports: stripExports,
    stripTypeScript: stripTypeScript,
    autoDetectCleanOptions: autoDetectCleanOptions,
    autoDeclareImports: autoDeclareImports,
    LEGACY_API_REPLACEMENTS: LEGACY_API_REPLACEMENTS,
    SENSITIVE_PATTERNS: SENSITIVE_PATTERNS,
    UNSUPPORTED_SYNTAX: UNSUPPORTED_SYNTAX
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.ThreeJSCodeNormalizer;
  }
})(typeof window !== 'undefined' ? window : this);
