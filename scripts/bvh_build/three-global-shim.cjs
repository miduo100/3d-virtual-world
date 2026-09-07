// esbuild alias 目标：three-mesh-bvh 内部 `import ... from 'three'` 全部走这里。
// 浏览器端 three 由 js/lib/three.min.js（r185 UMD）提供，脚本顺序保证加载时已存在。
module.exports =
  (typeof globalThis !== 'undefined' && globalThis.THREE) ? globalThis.THREE : {};
