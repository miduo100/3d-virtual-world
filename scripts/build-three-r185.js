#!/usr/bin/env node
/**
 * 构建 Three.js r185 UMD bundle 并占用旧文件名（阶段 1 核心）
 *
 * 用法：node scripts/build-three-r185.js
 *
 * 做四件事（可重复执行，幂等）：
 *  1. 校验 node_modules/three 版本为 0.185.x；
 *  2. esbuild 打包 public/js/lib/three-r185/entry.js → IIFE(globalName=THREE) minified，
 *     先写临时文件，构建成功后才替换 public/js/lib/three.min.js；
 *  3. 首次替换前把旧 r128 文件移入 public/js/lib/_backup_r128/（存在即跳过，绝不覆盖备份）；
 *  4. 6 个加载器文件 stub 化（GLTFLoader/DRACOLoader/OBJLoader/MTLLoader/
 *     OrbitControls/TransformControls），原文件同样先入 _backup_r128/。
 *
 * 产物校验：vm 沙箱加载 bundle，验证 REVISION=185 与 7 个加载器类挂载。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'public', 'js', 'lib');
const ENTRY = path.join(LIB, 'three-r185', 'entry.js');
const OUT = path.join(LIB, 'three.min.js');
const TMP = OUT + '.tmp';
const BACKUP_DIR = path.join(LIB, '_backup_r128');

const STUB_FILES = [
  'GLTFLoader.js',
  'DRACOLoader.js',
  'OBJLoader.js',
  'MTLLoader.js',
  'OrbitControls.js',
  'TransformControls.js'
];
const STUB_MARK = '[r185-stub]';
const STUB_TEMPLATE = (name) =>
  `// ${STUB_MARK} ${name} has been merged into js/lib/three.min.js (THREE.${name}).\n` +
  `// This file is kept as a no-op stub so legacy <script src="js/lib/${name}"> refs do not 404.\n` +
  `// Rebuild: node scripts/build-three-r185.js\n`;

function fail(msg) {
  console.error('FATAL: ' + msg);
  process.exit(1);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function backupOnce(relName) {
  const src = path.join(LIB, relName);
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dst = path.join(BACKUP_DIR, relName);
  if (fs.existsSync(dst)) {
    console.log(`  backup exists, skip: _backup_r128/${relName}（绝不覆盖备份）`);
    return false;
  }
  fs.copyFileSync(src, dst);
  console.log(`  backed up: js/lib/${relName} -> js/lib/_backup_r128/${relName}`);
  return true;
}

// ---- 1. 版本校验 ----
const threePkgPath = path.join(ROOT, 'node_modules', 'three', 'package.json');
if (!fs.existsSync(threePkgPath)) fail('node_modules/three 不存在，请先 npm install');
const threeVersion = JSON.parse(fs.readFileSync(threePkgPath, 'utf8')).version;
if (!threeVersion.startsWith('0.185.')) {
  fail(`node_modules/three 版本为 ${threeVersion}，期望 0.185.x（版本单一来源红线）`);
}
console.log(`[1/5] three@${threeVersion} OK`);

// ---- 2. esbuild 构建（写临时文件）----
console.log('[2/5] esbuild bundling ...');
esbuild
  .build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    globalName: '__THREE_R185__',
    minify: true,
    target: 'es2019',
    platform: 'browser',
    outfile: TMP,
    legalComments: 'none',
    logLevel: 'warning',
    // DRACOLoader 等模块顶层使用 new URL(path, import.meta.url)，
    // IIFE 格式下 import.meta 会被替换为 {}，导致加载即抛 "Invalid URL"。
    // 用 banner 注入实体 __threeBundleBaseURI__（经典脚本真实 URL；bundle 位于 js/lib/，
    // "../libs/draco/*" 恰好解析到项目本地 /js/libs/draco/）；非浏览器环境回退占位 base。
    banner: {
      js:
        'var __threeBundleBaseURI__=(typeof document!=="undefined"&&document.currentScript&&document.currentScript.src)||"https://three-r185.invalid/bundle.js";'
    },
    define: {
      'import.meta.url': '__threeBundleBaseURI__'
    }
  })
  .then(() => {
    // ---- 3. 备份旧 three.min.js 并替换 ----
    console.log('[3/5] replacing js/lib/three.min.js ...');
    const outExisted = fs.existsSync(OUT);
    if (outExisted) backupOnce('three.min.js');
    fs.renameSync(TMP, OUT);
    const sizeMB = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
    console.log(`  written: js/lib/three.min.js (${sizeMB} MB, sha256=${sha256(OUT)})`);

    // ---- 4. 加载器 stub 化 ----
    console.log('[4/5] stubbing legacy loader files ...');
    for (const name of STUB_FILES) {
      const p = path.join(LIB, name);
      if (fs.existsSync(p)) {
        const cur = fs.readFileSync(p, 'utf8');
        if (cur.includes(STUB_MARK)) {
          console.log(`  already stub: ${name}`);
          continue;
        }
        backupOnce(name);
      }
      fs.writeFileSync(p, STUB_TEMPLATE(name.replace(/\.js$/, '')));
      console.log(`  stubbed: js/lib/${name}`);
    }

    // ---- 5. 产物校验（vm 沙箱加载）----
    console.log('[5/5] verifying bundle ...');
    const code = fs.readFileSync(OUT, 'utf8');
    const sandbox = {
      console,
      self: undefined,
      window: undefined,
      document: undefined,
      URL,
      TextDecoder,
      TextEncoder,
      Blob,
      atob,
      btoa
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(code, sandbox, { filename: 'three.min.js' });
    const T = sandbox.THREE;
    if (!T) fail('bundle 未产出全局 THREE');
    if (T.REVISION !== '185') fail(`REVISION=${T.REVISION}，期望 185`);
    const classes = ['GLTFLoader', 'DRACOLoader', 'OBJLoader', 'MTLLoader', 'OrbitControls', 'TransformControls', 'FBXLoader'];
    const missing = classes.filter((c) => typeof T[c] !== 'function');
    if (missing.length) fail(`加载器未挂载: ${missing.join(', ')}`);
    if (T.Math !== T.MathUtils) fail('A 层垫片 THREE.Math 别名缺失');
    if (T.sRGBEncoding !== 3001 || T.LinearEncoding !== 3000) fail('A 层垫片旧常量缺失');
    if (T.SRGBColorSpace === undefined) fail('SRGBColorSpace 缺失（r185 本体异常）');

    console.log('VERIFIED: REVISION=185, loaders=7/7, A-layer aliases OK');
    console.log('DONE: r185 bundle 已占用 js/lib/three.min.js 旧文件名');
  })
  .catch((err) => {
    if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
    fail('esbuild 构建失败: ' + (err && err.message ? err.message : err));
  });
