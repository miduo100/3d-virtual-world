/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * skyPresets.js — 程序化天空预设（零网络、零图片文件）
 *
 * 设计要点：
 *  1. 纯计算生成 2:1 等距柱状全景（equirect），直接当 scene.background 纹理用，
 *     与现有 HDR/全景图走完全相同的链路（懒加载 → 缓存 → PMREM → 天气调参）。
 *  2. 噪声用整数格点 hash，x 方向按行周期化（period 随经度弧长收放），
 *     保证左右边缘严格无缝，且天顶附近不会出现螺旋拉伸。
 *  3. 六款预设只在四个旋钮上有差别：云覆盖率、云对比度、太阳高度角、星点密度。
 *  4. 本文件同时可在 Node 下 require（供离线出图预览脚本使用），
 *     因此不依赖 THREE / DOM，只吃参数吐 Uint8ClampedArray。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SkyPresets = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // ============================ 预设参数表 ============================
  // zenith/horizon/ground : 垂直渐变三段色（sRGB）
  // cloudLight/cloudDark  : 云受光面 / 背光面
  // sun: { el 高度角(度, 90=天顶, 0=地平线, 负=地平线下), az 方位角, glow 光晕强度, glowRadius }
  // cloudCover 0~1        : 云量覆盖率
  // cloudSoft             : 云边缘柔和度（阴天要大，晴天要锐）
  // cloudLitBase/Range    : 云受光基准亮度 / 朝向太阳的增益
  // haze                  : 地平线大气雾带强度
  // stars 0~1             : 星点密度
  const PRESETS = [
    {
      key: 'clear', name: '晴天', i18n: 'sky.preset.clear',
      zenith: '#2e6bc4', horizon: '#c8e4f2', ground: '#4e5b66',
      cloudLight: '#ffffff', cloudDark: '#aebecd',
      sun: { el: 52, az: 140, glow: 0.30, glowRadius: 0.10 },
      cloudCover: 0.20, cloudSoft: 1.2, cloudLitBase: 0.64, cloudLitRange: 0.30,
      haze: 0.42, stars: 0,
      cloudXPeriod: 6, cloudYPeriod: 7, cloudOctaves: 5
    },
    {
      key: 'cloudy', name: '多云', i18n: 'sky.preset.cloudy',
      zenith: '#4a76ad', horizon: '#c2d3e0', ground: '#4a5762',
      cloudLight: '#f7fafc', cloudDark: '#8b9daf',
      sun: { el: 40, az: 125, glow: 0.18, glowRadius: 0.13 },
      cloudCover: 0.56, cloudSoft: 1.8, cloudLitBase: 0.52, cloudLitRange: 0.36,
      haze: 0.48, stars: 0,
      cloudXPeriod: 7, cloudYPeriod: 8, cloudOctaves: 5
    },
    {
      key: 'overcast', name: '阴天', i18n: 'sky.preset.overcast',
      zenith: '#6d7985', horizon: '#9dabb6', ground: '#5c646b',
      cloudLight: '#b0bac3', cloudDark: '#8b939b',
      sun: { el: 26, az: 100, glow: 0.04, glowRadius: 0.30 },
      cloudCover: 0.95, cloudSoft: 2.4, cloudLitBase: 0.50, cloudLitRange: 0.08,
      haze: 0.60, stars: 0, cloudShade: 0.10, cloudNoiseGain: 1.35,
      cloudXPeriod: 5, cloudYPeriod: 6, cloudOctaves: 4
    },
    {
      key: 'dusk', name: '黄昏', i18n: 'sky.preset.dusk',
      zenith: '#1b2450', horizon: '#ff9b52', ground: '#33282c',
      cloudLight: '#ffd2a4', cloudDark: '#7a5560',
      sun: { el: 2.5, az: 95, glow: 0.32, glowRadius: 0.11 },
      cloudCover: 0.36, cloudSoft: 2.0, cloudLitBase: 0.42, cloudLitRange: 0.42,
      haze: 0.78, stars: 0, gradPow: 0.92,
      cloudXPeriod: 6, cloudYPeriod: 7, cloudOctaves: 5
    },
    {
      key: 'night', name: '夜晚', i18n: 'sky.preset.night',
      zenith: '#08111f', horizon: '#22395c', ground: '#080c14',
      cloudLight: '#38425c', cloudDark: '#101520',
      sun: { el: -8, az: 90, glow: 0, glowRadius: 0.2 },
      cloudCover: 0.10, cloudSoft: 1.6, cloudLitBase: 0.30, cloudLitRange: 0.10,
      haze: 0.22, stars: 0.55,
      cloudXPeriod: 6, cloudYPeriod: 7, cloudOctaves: 4
    },
    {
      key: 'starry', name: '星空', i18n: 'sky.preset.starry',
      zenith: '#03060f', horizon: '#122036', ground: '#050912',
      cloudLight: '#2a3348', cloudDark: '#0f1520',
      sun: { el: -25, az: 90, glow: 0, glowRadius: 0.2 },
      cloudCover: 0, cloudSoft: 1.0, cloudLitBase: 0.2, cloudLitRange: 0,
      haze: 0.16, stars: 1.0,
      cloudXPeriod: 6, cloudYPeriod: 7, cloudOctaves: 4
    }
  ];

  const BY_KEY = {};
  PRESETS.forEach(function (p) { BY_KEY[p.key] = p; });

  // ============================ 基础工具 ============================
  function hexToRgb(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function smoothstep(e0, e1, x) {
    const d = e1 - e0;
    const t = clamp01(d === 0 ? (x < e0 ? 0 : 1) : (x - e0) / d);
    return t * t * (3 - 2 * t);
  }

  // ============================ 噪声 ============================
  // 整数格点 hash；period 只作用于 x（经度），保证左右边缘严格无缝
  function hash2(ix, iy, period) {
    let x = ix % period;
    if (x < 0) x += period;
    let h = (Math.imul(x, 374761393) + Math.imul(iy, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }

  function vnoise(x, y, period) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const p = (period | 0) || 1;
    const a = hash2(ix, iy, p);
    const b = hash2(ix + 1, iy, p);
    const c = hash2(ix, iy + 1, p);
    const d = hash2(ix + 1, iy + 1, p);
    const t1 = a + (b - a) * ux;
    const t2 = c + (d - c) * ux;
    return t1 + (t2 - t1) * uy;
  }

  // 分形叠加：每层频率与周期同步翻倍，首尾仍无缝
  function fbm(x, y, period, octaves, gain) {
    let sum = 0, amp = 1, norm = 0, px = x, py = y, p = period;
    for (let i = 0; i < octaves; i++) {
      sum += amp * vnoise(px, py, p);
      norm += amp;
      amp *= gain;
      px *= 2; py *= 2; p *= 2;
    }
    return sum / norm;
  }

  // ============================ 主渲染 ============================
  /**
   * 生成一张 equirect 天空。
   * @param {string} key   预设 key
   * @param {number} [W]   宽（默认 1024）
   * @param {number} [H]   高（默认 W/2）
   * @returns {{data: Uint8ClampedArray, width: number, height: number}}
   */
  function render(key, W, H) {
    const preset = BY_KEY[key];
    if (!preset) throw new Error('未知天空预设: ' + key);
    const w = W || 1024;
    const h = H || Math.round(w / 2);

    const zc = hexToRgb(preset.zenith);
    const hc = hexToRgb(preset.horizon);
    const gc = hexToRgb(preset.ground);
    const cl = hexToRgb(preset.cloudLight);
    const cd = hexToRgb(preset.cloudDark);
    const sc = hexToRgb(preset.sunColor || '#ffffff');

    const data = new Uint8ClampedArray(w * h * 4);

    // 太阳在 equirect 上的位置
    const sunV = 0.5 - preset.sun.el / 180;
    const sunU = (((preset.sun.az % 360) + 360) % 360) / 360;
    const hasGlow = preset.sun.glow > 0;
    const hasCloud = preset.cloudCover > 0;
    const hasStars = preset.stars > 0;
    const starThresh = 0.99965 - preset.stars * 0.0011;
    const softSpan = preset.cloudSoft * 0.10;
    // 云量 → 噪声阈值（fbm 均值约 0.5，阈值越高出云越少）
    const cloudThresh = 0.72 - preset.cloudCover * 0.48;
    // 云厚度暗化：阴天云层平坦，不该有强烈明暗（预设可覆盖）
    const cloudShade = preset.cloudShade === undefined ? 0.28 : preset.cloudShade;
    // 天空垂直渐变指数：越大 = 地平线暖色往上延伸越高（黄昏需要）
    const gradPow = preset.gradPow === undefined ? 0.62 : preset.gradPow;
    // 云本身噪声起伏强度：阴天要靠它做出云层的厚度起伏，否则一片死平
    const cloudNoiseGain = preset.cloudNoiseGain === undefined ? 0.45 : preset.cloudNoiseGain;

    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;
      const el = (0.5 - v) * Math.PI;                    // +π/2 天顶 → 0 地平线 → -π/2 天底
      const sinT = Math.sin(v * Math.PI);                 // 该行的经度弧长系数
      const sinSafe = sinT > 0.05 ? sinT : 0.05;

      // ---- 基础天空色（逐行算一次，避免每像素重复插值）----
      let base;
      if (el >= 0) {
        const up = Math.sin(el);                          // 1 天顶 → 0 地平线
        base = mix(hc, zc, Math.pow(up, gradPow));
        const hazeT = Math.pow(1 - up, 9) * preset.haze;  // 地平线大气雾带
        base = mix(base, hc, hazeT);
      } else {
        // 地平线以下：快速收到远景地面色（实际会被地形遮住，只为过渡自然）
        const dn = -el / (Math.PI / 2);
        base = mix(hc, gc, smoothstep(0, 0.22, dn));
      }

      // ---- 云的采样周期固定不变 ----
      // 等距柱状投影在极点（天顶）是奇点：若按经度弧长缩放周期，云会被撕成横条；
      // 因此周期恒定，改为让云在天顶附近淡出（真实天空天顶云本就稀疏）。
      const xPeriod = preset.cloudXPeriod;

      // 云的高度带（v=0 天顶 → 0.5 地平线），一路铺到地平线再柔和收敛
      const band = hasCloud
        ? smoothstep(0.08, 0.19, v) * (1 - smoothstep(0.475, 0.5, v))
        : 0;

      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w;
        const i = (y * w + x) * 4;

        let r = base[0], g = base[1], b = base[2];

        // 与太阳的球面角距（经度按弧长压缩，避免极点失真）
        let du = u - sunU;
        if (du > 0.5) du -= 1; else if (du < -0.5) du += 1;
        const duR = Math.abs(du) * Math.PI * sinSafe;
        const dvR = (v - sunV) * Math.PI;
        const sdist = Math.sqrt(duR * duR + dvR * dvR);

        // ---- 太阳光晕 ----
        if (hasGlow && sdist < 1.2) {
          const glow = Math.exp(-(sdist * sdist) / (2 * preset.sun.glowRadius * preset.sun.glowRadius)) * preset.sun.glow;
          if (glow > 0.002) {
            r += sc[0] * glow;
            g += sc[1] * glow;
            b += sc[2] * glow;
          }
        }

        // ---- 云 ----
        if (band > 0.002) {
          const nx = u * xPeriod;
          const ny = v * preset.cloudYPeriod;
          const n = fbm(nx, ny, xPeriod, preset.cloudOctaves, 0.5);
          // 靠近地平线的云更密（真实天空越贴近地平线云层越拥挤）
          const localThresh = cloudThresh - smoothstep(0.18, 0.48, v) * 0.07;
          let cov = smoothstep(localThresh, localThresh + softSpan, n) * band;
          if (cov > 0.004) {
            // 受光程度：离太阳越近越亮 + 噪声起伏 - 云越厚底部越暗（体积感）
            const lit = clamp01(
              preset.cloudLitBase +
              (1 - smoothstep(0, 1.6, sdist)) * preset.cloudLitRange +
              (n - 0.5) * cloudNoiseGain -
              smoothstep(0.55, 1.0, cov) * cloudShade
            );
            const cc = mix(cd, cl, lit);
            r = r * (1 - cov) + cc[0] * cov;
            g = g * (1 - cov) + cc[1] * cov;
            b = b * (1 - cov) + cc[2] * cov;
          }
        }

        // ---- 星点（确定性：同样参数每次生成结果一致）----
        if (hasStars && v < 0.47) {
          const sh = hash2(x, y, w);
          if (sh > starThresh) {
            const bright = Math.pow((sh - starThresh) / (1 - starThresh), 0.55);
            const ext = 0.35 + 0.65 * (1 - smoothstep(0.26, 0.47, v)); // 近地平线大气消光
            const s = (0.30 + 0.70 * bright) * ext * 255;
            r += s * 0.94;
            g += s * 0.96;
            b += s;
          }
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }

    return { data: data, width: w, height: h };
  }

  /** 浏览器侧：转成 canvas（供 THREE.CanvasTexture 使用） */
  function toCanvas(key, W, H) {
    const out = render(key, W, H);
    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(out.width, out.height);
    img.data.set(out.data);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function get(key) { return BY_KEY[key] || null; }

  /** 天气调参时用的雾色，避免夜景天空配亮蓝雾穿帮 */
  function fogColorHex(key) {
    const p = BY_KEY[key];
    return p ? p.horizon : null;
  }

  return { PRESETS: PRESETS, get: get, render: render, toCanvas: toCanvas, fogColorHex: fogColorHex };
});
