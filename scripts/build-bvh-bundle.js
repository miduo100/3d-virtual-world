#!/usr/bin/env node
/**
 * 构建 three-mesh-bvh 浏览器 bundle（模型表面碰撞功能依赖）
 *
 * 用法：node scripts/build-bvh-bundle.js
 *
 * - esbuild IIFE 打包 node_modules/three-mesh-bvh → public/js/lib/three-mesh-bvh.min.js
 * - 内部 `import from 'three'` 通过 alias 指向 CJS shim（运行时读 globalThis.THREE，
 *   即 r185 UMD bundle，避免打包两份 three）
 * - 产物校验：vm 沙箱注入真实 three@0.185，验证关键导出存在
 */
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(__dirname, 'bvh_build');
const OUT = path.join(ROOT, 'public', 'js', 'lib', 'three-mesh-bvh.min.js');
const TMP = OUT + '.tmp';

function fail(msg) {
  console.error('FATAL: ' + msg);
  process.exit(1);
}

// ---- 1. 版本校验 ----
const bvhPkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'node_modules', 'three-mesh-bvh', 'package.json'), 'utf8')
);
console.log(`[1/3] three-mesh-bvh@${bvhPkg.version} OK`);
const threeVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'node_modules', 'three', 'package.json'), 'utf8')
).version;
if (!threeVersion.startsWith('0.185.')) {
  fail(`three 版本 ${threeVersion} 非 0.185.x（版本单一来源红线）`);
}

// ---- 2. esbuild 构建 ----
console.log('[2/3] esbuild bundling ...');
esbuild
  .build({
    entryPoints: [path.join(BUILD_DIR, 'entry.js')],
    bundle: true,
    format: 'iife',
    globalName: '__MESH_BVH_BUNDLE__',
    minify: true,
    target: 'es2019',
    platform: 'browser',
    outfile: TMP,
    legalComments: 'none',
    logLevel: 'warning',
    alias: {
      three: path.join(BUILD_DIR, 'three-global-shim.cjs')
    }
  })
  .then(() => {
    fs.renameSync(TMP, OUT);
    const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(1);
    console.log(`  written: js/lib/three-mesh-bvh.min.js (${sizeKB} KB)`);

    // ---- 3. 产物校验（vm 沙箱注入真实 three）----
    console.log('[3/3] verifying bundle ...');
    const vm = require('vm');
    const THREE = require('three');
    const code = fs.readFileSync(OUT, 'utf8');
    const sandbox = { console, THREE };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(code, sandbox, { filename: 'three-mesh-bvh.min.js' });
    const LIB = sandbox.__MESH_BVH_LIB__;
    if (!LIB) fail('bundle 未产出全局 __MESH_BVH_LIB__');
    const need = ['MeshBVH', 'computeBoundsTree', 'disposeBoundsTree', 'acceleratedRaycast'];
    const missing = need.filter((k) => !LIB[k]);
    if (missing.length) fail(`关键导出缺失: ${missing.join(', ')}`);

    // 快速功能冒烟：挂原型扩展后对一个小几何体建 BVH 并 raycast
    THREE.BufferGeometry.prototype.computeBoundsTree = LIB.computeBoundsTree;
    THREE.BufferGeometry.prototype.disposeBoundsTree = LIB.disposeBoundsTree;
    THREE.Mesh.prototype.raycast = LIB.acceleratedRaycast;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.computeBoundsTree();
    const ray = new THREE.Ray(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0));
    const hit = geo.boundsTree.raycastFirst(ray, THREE.DoubleSide);
    if (!hit) fail('BVH raycastFirst 冒烟失败（未命中单位盒）');

    console.log('VERIFIED: exports OK, BVH raycast smoke OK');
    console.log('DONE: js/lib/three-mesh-bvh.min.js 就绪');
  })
  .catch((err) => {
    if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
    fail('esbuild 构建失败: ' + (err && err.message ? err.message : err));
  });
