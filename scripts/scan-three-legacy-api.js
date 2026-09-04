#!/usr/bin/env node
/**
 * scan-three-legacy-api.js — Three.js r185 升级前全仓旧 API 扫描器（阶段 0 工具）
 *
 * 规范依据：《Three.js-r185-升级规划与规范.md》第 2.3 节 + 第六节阶段 0
 * 用法：node scripts/scan-three-legacy-api.js [--verbose]
 *
 * 扫描范围：public/**、src/**、scripts/**（排除 vendor/备份/二进制目录）
 *   - .js 文件全文按行扫描
 *   - .html 文件同样按行扫描（覆盖内联 <script>——第三轮查漏的根因修复）
 *
 * 结果分区（对应升级策略 A/B/C 三层）：
 *   [BUSINESS]  业务代码区 —— must fix（C 层显式修点）
 *   [SHIM]      运行时垫片区 —— 允许存在旧 API（B 层，处理用户粘贴代码）
 *   [VENDOR]    旧 vendor 区 —— 阶段 1 整体替换，不逐行修（A 层）
 *
 * 输出：控制台英文报告（避免 PowerShell GBK 乱码）+ 退出码
 *   exit 0 = 业务区无 must-fix 命中；exit 1 = 有命中；exit 2 = 扫描器自身错误
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ---------- 扫描范围与排除 ----------

const SCAN_DIRS = ['public', 'src', 'scripts'];
const SCAN_EXTS = new Set(['.js', '.mjs', '.html']);
const SKIP_DIRS = new Set([
  'node_modules', 'models', 'uploads', 'generated', 'images',
  'css', 'i18n', 'partials', 'scenes', 'gallery_content', 'uploaded'
]);
// vendor 区：旧库文件本体（阶段 1 整体替换，不逐行修）
const VENDOR_FILES = new Set([
  'public/js/lib/three.min.js',
  'public/js/lib/GLTFLoader.js',
  'public/js/lib/DRACOLoader.js',
  'public/js/lib/OBJLoader.js',
  'public/js/lib/MTLLoader.js',
  'public/js/lib/OrbitControls.js',
  'public/js/lib/TransformControls.js',
  'public/js/lib/three-examples/loaders/FBXLoader.js',
  'public/js/lib/three-examples/curves/NURBSUtils.js',
  'public/js/lib/three-examples/curves/NURBSCurve.js',
]);
// 垫片区：B 层运行时兼容（允许为用户代码保留旧 API 判断/改写）
const SHIM_FILES = new Set([
  'public/js/threejsCompatibility.js',
  'public/js/threejsCodeRunner.js',
  'public/js/threejsCodeNormalizer.js',
  'public/js/threejsWorldSanitizer.js',
  'public/js/lib/three-shim.js',
]);
// 本扫描器自身
const SELF = path.relative(ROOT, __filename).replace(/\\/g, '/');

// ---------- 模式库 ----------

/**
 * id: 唯一标识
 * re: 行级匹配正则
 * sev: 'fix' = 业务区必须修 / 'info' = 知晓即可
 * note: r185 状态说明
 */
const PATTERNS = [
  {
    id: 'outputEncoding',
    re: /\.outputEncoding\s*=|renderer\.outputEncoding/,
    sev: 'fix',
    note: 'removed in r152 -> renderer.outputColorSpace'
  },
  {
    id: 'physicallyCorrectLights',
    re: /physicallyCorrectLights/,
    sev: 'fix',
    note: 'renamed useLegacyLights in r149, removed since r165'
  },
  {
    id: 'useLegacyLights',
    re: /useLegacyLights/,
    sev: 'fix',
    note: 'removed since r165, physical lighting is the only mode'
  },
  {
    id: 'sRGBEncoding',
    re: /sRGBEncoding|LinearEncoding|GammaEncoding|RGBEEncoding|RGBM7Encoding|RGBM16Encoding/,
    sev: 'fix',
    note: 'removed in r152 -> colorSpace constants (SRGBColorSpace etc.)'
  },
  {
    id: 'texture.encoding',
    re: /\.encoding\s*=/,
    sev: 'fix',
    note: 'Texture.encoding removed in r152 -> Texture.colorSpace'
  },
  {
    id: 'THREE.Math',
    re: /THREE\.Math\b(?!Utils)/,
    sev: 'fix',
    note: 'renamed MathUtils in r112, alias removed in r148'
  },
  {
    id: 'uv2',
    re: /uv2/,
    sev: 'fix',
    note: 'renamed uv1 in r151 (aoMap/lightMap channel)'
  },
  {
    id: 'PCFSoftShadowMap',
    re: /PCFSoftShadowMap/,
    sev: 'fix',
    note: 'deprecated since r181 -> PCFShadowMap (now soft as well)'
  },
  {
    id: 'THREE.Clock',
    re: /new\s+THREE\.Clock\b|THREE\.Clock\b/,
    sev: 'fix',
    note: 'deprecated since r183 -> THREE.Timer'
  },
  {
    id: 'examples-js-refs',
    re: /examples\/js\//,
    sev: 'fix',
    note: 'examples/js removed in r148 -> examples/jsm (ESM only)'
  },
  {
    id: 'cdn-three-version',
    re: /(?:cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net)\/[^"']*three[@/]0\.(\d+)\./,
    sev: 'fix',
    note: 'CDN three must be replaced by local vendor bundle (any version)'
  },
  {
    id: 'THREE.Geometry',
    re: /new\s+THREE\.Geometry\b/,
    sev: 'fix',
    note: 'removed in r141 -> BufferGeometry'
  },
  {
    id: 'morphTargets-prop',
    re: /\.morphTargets\s*=/,
    sev: 'fix',
    note: 'material.morphTargets removed in r130'
  },
  {
    id: 'getInverse',
    re: /\.getInverse\(/,
    sev: 'fix',
    note: 'deprecated since r122 -> matrix.copy(m).invert()'
  },
  {
    id: 'Euler.DefaultOrder',
    re: /Euler\.DefaultOrder|Object3D\.DefaultUp|Object3D\.DefaultMatrixAutoUpdate/,
    sev: 'fix',
    note: 'renamed to UPPER_SNAKE constants in r148'
  },
  {
    id: 'boneTransform',
    re: /\.boneTransform\(/,
    sev: 'fix',
    note: 'SkinnedMesh.boneTransform renamed applyBoneTransform in r150'
  },
  {
    id: 'XHRLoader',
    re: /XHRLoader/,
    sev: 'fix',
    note: 'renamed FileLoader long ago'
  },
  {
    id: 'AmbientLightProbe',
    re: /AmbientLightProbe|HemisphereLightProbe/,
    sev: 'fix',
    note: 'removed in r156 -> AmbientLight / HemisphereLight'
  },
  {
    id: 'parseAnimation',
    re: /parseAnimation\(/,
    sev: 'fix',
    note: 'AnimationClip.parseAnimation deprecated since r174'
  },
  {
    id: 'RGBFormat',
    re: /RGBFormat|UnsignedShort565Type/,
    sev: 'fix',
    note: 'removed in r136 -> RGBAFormat'
  },
  // ---- info 级：知晓即可，不强修 ----
  {
    id: 'CanvasTexture',
    re: /new\s+THREE\.CanvasTexture\(/,
    sev: 'info',
    note: 'phase-4 check: set colorSpace = SRGBColorSpace for visual correctness'
  },
  {
    id: 'VideoTexture',
    re: /new\s+THREE\.VideoTexture\(/,
    sev: 'info',
    note: 'phase-4 check: colorSpace review recommended'
  },
];

// ---------- 工具 ----------

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.error('[warn] cannot read dir: ' + dir + ' (' + e.message + ')');
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === '_backup_r128') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(full, out);
    } else if (SCAN_EXTS.has(path.extname(ent.name).toLowerCase())) {
      out.push(full);
    }
  }
}

function zoneOf(rel) {
  if (VENDOR_FILES.has(rel)) return 'VENDOR';
  if (SHIM_FILES.has(rel)) return 'SHIM';
  return 'BUSINESS';
}

// ---------- 主流程 ----------

function main() {
  const verbose = process.argv.includes('--verbose');
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);

  const hits = []; // { zone, file, line, patternId, note, text }
  let scanned = 0;
  let scannedLines = 0;

  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (rel === SELF) continue;
    let content;
    try {
      content = fs.readFileSync(f, 'utf8');
    } catch (e) {
      console.error('[warn] cannot read: ' + rel + ' (' + e.message + ')');
      continue;
    }
    scanned++;
    const lines = content.split(/\r?\n/);
    scannedLines += lines.length;
    const zone = zoneOf(rel);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 2000) continue; // 压缩单行文件（three.min.js 等）按信息级处理
      for (const p of PATTERNS) {
        if (p.re.test(line)) {
          hits.push({
            zone, file: rel, line: i + 1, patternId: p.id,
            note: p.note,
            text: line.trim().slice(0, 160)
          });
        }
      }
    }
  }

  // 汇总
  const byZone = { BUSINESS: [], SHIM: [], VENDOR: [] };
  for (const h of hits) byZone[h.zone].push(h);

  console.log('=== Three.js r185 legacy API scan ===');
  console.log('files scanned: ' + scanned + ', lines: ' + scannedLines);
  console.log('');

  for (const zone of ['BUSINESS', 'SHIM', 'VENDOR']) {
    const list = byZone[zone];
    console.log('--- [' + zone + '] hits: ' + list.length + ' ---');
    // 按模式聚合计数
    const byPattern = {};
    for (const h of list) {
      byPattern[h.patternId] = byPattern[h.patternId] || [];
      byPattern[h.patternId].push(h);
    }
    const ids = Object.keys(byPattern).sort();
    for (const id of ids) {
      const group = byPattern[id];
      const sev = PATTERNS.find(p => p.id === id).sev;
      console.log('  [' + sev.toUpperCase() + '] ' + id + ' x' + group.length + '  // ' + group[0].note);
      if (verbose || zone === 'BUSINESS') {
        for (const h of group) {
          console.log('      ' + h.file + ':' + h.line + '  ' + h.text);
        }
      } else if (!verbose) {
        // 非 verbose 时业务区以外只展示前 3 个位置
        for (const h of group.slice(0, 3)) {
          console.log('      ' + h.file + ':' + h.line + '  ' + h.text);
        }
        if (group.length > 3) console.log('      ... and ' + (group.length - 3) + ' more');
      }
    }
    console.log('');
  }

  const mustFix = byZone.BUSINESS.filter(h =>
    PATTERNS.find(p => p.id === h.patternId).sev === 'fix'
  );
  console.log('=== SUMMARY ===');
  console.log('BUSINESS must-fix: ' + mustFix.length);
  console.log('BUSINESS info:     ' + (byZone.BUSINESS.length - mustFix.length));
  console.log('SHIM (allowed):    ' + byZone.SHIM.length);
  console.log('VENDOR (replace):  ' + byZone.VENDOR.length);

  process.exit(mustFix.length > 0 ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error('[FATAL] ' + (e && e.stack ? e.stack : e));
  process.exit(2);
}
