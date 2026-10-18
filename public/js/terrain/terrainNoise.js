/**
 * 确定性噪声（地形专用）
 * - 无第三方依赖，无 Math.random，同 seed 逐位一致
 * - value noise + fbm + ridged，足够做丘陵/山地，成本低（纯 JS）
 */
(function (global) {
  'use strict';

  // 32 位整数哈希：同输入必得同输出
  function hash2i(ix, iz, seed) {
    let h = (ix | 0) * 374761393 + (iz | 0) * 668265263 + ((seed | 0) * 1274126177);
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296; // [0,1)
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  // 2D value noise，返回 [-1, 1]
  function value2(x, z, seed) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = smooth(x - x0);
    const fz = smooth(z - z0);
    const a = hash2i(x0, z0, seed);
    const b = hash2i(x0 + 1, z0, seed);
    const c = hash2i(x0, z0 + 1, seed);
    const d = hash2i(x0 + 1, z0 + 1, seed);
    const top = a + (b - a) * fx;
    const bot = c + (d - c) * fx;
    return (top + (bot - top) * fz) * 2 - 1;
  }

  /** 分形叠加，返回 [-1,1]（实测标准差约 0.25，需要放大使用） */
  function fbm2(x, z, seed, octaves, lacunarity, gain) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    const oct = Math.max(1, Math.min(8, octaves || 4));
    const lac = lacunarity || 2.0;
    const g = gain == null ? 0.5 : gain;
    for (let i = 0; i < oct; i++) {
      sum += value2(x * freq, z * freq, seed + i * 131) * amp;
      norm += amp;
      amp *= g;
      freq *= lac;
    }
    return norm > 0 ? sum / norm : 0;
  }

  /** 山脊噪声，返回 [0,1] */
  function ridged2(x, z, seed, octaves) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    const oct = Math.max(1, Math.min(6, octaves || 4));
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(value2(x * freq, z * freq, seed + i * 977));
      sum += n * n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.05;
    }
    return norm > 0 ? sum / norm : 0;
  }

  function rand2(ix, iz, seed) {
    return hash2i(ix, iz, seed ^ 0x9e3779b9);
  }

  function smoothstep(a, b, x) {
    if (a === b) return x < a ? 0 : 1;
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  global.TerrainNoise = { hash2i, value2, fbm2, ridged2, rand2, smoothstep };
})(typeof window !== 'undefined' ? window : globalThis);
