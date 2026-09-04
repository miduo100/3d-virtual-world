// Three.js r185 UMD bundle 构建入口（构建源料，勿在页面直接引用）
// 构建命令：node scripts/build-three-r185.js
// 产物：public/js/lib/three.min.js（IIFE, global-name=THREE, minified）
//
// 设计要点（见《Three.js-r185-升级规划与规范.md》4.1/4.2/4.3 A 层）：
// 1. 唯一版本来源 = node_modules/three@0.185，核心与 examples/jsm 打成单文件，
//    恢复 r128 时代 "全局 window.THREE + THREE.xxx 加载器命名空间" 形态，
//    index.html / admin.html 动态注入数组等硬编码路径零改动切换。
// 2. A 层垫片：补 r148/r152 移除的旧别名与常量，防止用户粘贴的 r128 代码
//    直接 throw；行为级兼容（encoding→colorSpace 等）由 B 层
//    threejsCompatibility.js / threejsCodeRunner.js 负责。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// 展开为普通对象（esbuild IIFE globalName 导出即此对象）
const NS = Object.assign({}, THREE);

// examples 加载器挂回命名空间（r128 全局形态契约）
NS.GLTFLoader = GLTFLoader;
NS.DRACOLoader = DRACOLoader;
NS.OBJLoader = OBJLoader;
NS.MTLLoader = MTLLoader;
NS.OrbitControls = OrbitControls;
NS.TransformControls = TransformControls;
NS.FBXLoader = FBXLoader;

// ===== A 层垫片：旧别名/常量兜底（仅防 throw，不实现旧行为）=====
if (NS.MathUtils && !NS.Math) NS.Math = NS.MathUtils;        // THREE.Math → MathUtils（r148 移除）
if (NS.sRGBEncoding === undefined) NS.sRGBEncoding = 3001;   // r152 移除的旧常量，保留数字语义
if (NS.LinearEncoding === undefined) NS.LinearEncoding = 3000;

// 显式挂全局 window.THREE。
// 原因：esbuild IIFE 的 globalName 载体拿到的是模块导出对象（含 default 包装），
// 因此 globalName 仅作占位（__THREE_R185__），真正的 THREE 命名空间在此挂载。
const g = typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : undefined;
if (g) g.THREE = NS;

export default NS;
