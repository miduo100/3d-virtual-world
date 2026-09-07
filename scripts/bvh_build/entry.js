// three-mesh-bvh 浏览器 bundle 入口：整库挂到全局 __MESH_BVH_LIB__
import * as BVH from 'three-mesh-bvh';
const g = typeof globalThis !== 'undefined' ? globalThis : self;
g.__MESH_BVH_LIB__ = BVH;
