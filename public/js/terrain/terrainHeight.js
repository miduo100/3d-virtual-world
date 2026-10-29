/**
 * 地形高度场（纯函数）
 *
 * ★ 概念：「地形 = 地块」。每块地形是一个三维范围：
 *     中心 (x, z)、面积 width × depth、基准高度 baseY、优先级 priority
 *   多块地形各自独立，边界硬接（不做高度混合）。
 *   地形之外 = 没有地面（重力 -Y，玩家会一直往下掉，这是设计要求）。
 *
 * 两种查询：
 *   heightAt(x, z, clampOutside) → 数值（渲染用；地形外可贴边缘，避免 NaN）
 *   groundAt(x, z, fromY)        → 数值 或 null（物理用；null = 脚下没有地面）
 */
(function (global) {
  'use strict';

  const N = global.TerrainNoise;

  const COL = {
    grass: [0.23, 0.34, 0.15],
    grass2: [0.36, 0.47, 0.22],
    dirt: [0.42, 0.35, 0.24],
    rock: [0.46, 0.44, 0.42],
    snow: [0.90, 0.93, 0.96],
    sand: [0.72, 0.66, 0.46]
  };

  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  /**
   * three 的顶点色按"线性空间"解释，而 COL 里的颜色是按 sRGB 调的。
   * 不做这一步转换，渲染后再经 sRGB 编码会整体发白（前端地形明显比编辑器浅）。
   */
  function srgbToLinear(c) {
    const x = Math.max(0, Math.min(1, c));
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }

  /** 单块地形的高度函数（不含区域判断，也不含 baseY） */
  function createSampler(params, seed) {
    const P = params || {};
    const amp = Math.max(0, num(P.heightScale, 0));
    const rough = Math.max(0, Math.min(1, num(P.roughness, 0.45)));
    const ridgeK = Math.max(0, Math.min(1, num(P.ridge, 0.3)));
    const flatR = Math.max(0, num(P.flatRadius, 0));
    const waterLevel = num(P.waterLevel, -1.5);
    const snowLine = num(P.snowLine, 95);
    const treeLine = num(P.treeLine, 80);
    const slopeRock = num(P.slopeRockMin, 45);
    const slopeTree = num(P.slopeTreeMax, 33);
    const edgeMode = P.edgeMode || 'none';
    const S = (seed | 0) || 1;

    function flatFade(x, z) {
      if (flatR <= 0) return 1;
      const r = Math.hypot(x, z);
      if (r <= flatR * 0.6) return 0;
      if (r >= flatR) return 1;
      return N.smoothstep(flatR * 0.6, flatR, r);
    }

    function heightAt(x, z) {
      if (amp <= 0) return 0;
      // 幅度标定：归一化 fbm 的标准差只有 ~0.25，必须放大后封顶，
      // 否则 heightScale=60 实际起伏不到 2m（表现为"看不见地形"）
      let n1 = N.fbm2(x * 0.00135, z * 0.00135, S, 5, 2.03, 0.5);
      let n2 = N.fbm2(x * 0.0060, z * 0.0060, S + 101, 4, 2.01, 0.5);
      n1 = Math.max(-1, Math.min(1, n1 * 2.8));
      n2 = Math.max(-1, Math.min(1, n2 * 2.6));
      const rid = N.ridged2(x * 0.0021, z * 0.0021, S + 977, 4);
      let h = amp * (n1 * 0.80 + n2 * 0.20 * rough)
            + amp * 0.45 * ridgeK * (rid * 1.9 - 0.35);
      h = h * flatFade(x, z);
      // 边缘形态（可选；默认 none = 地形边缘直接断掉/成悬崖）
      if (edgeMode !== 'none') {
        // 这里的"边缘"由世界采样器按矩形计算，单块采样器不再处理
      }
      return h;
    }

    function slopeAt(x, z, eps) {
      const e = eps || 1.0;
      const hx = heightAt(x + e, z) - heightAt(x - e, z);
      const hz = heightAt(x, z + e) - heightAt(x, z - e);
      const g = Math.hypot(hx, hz) / (2 * e);
      return Math.atan(g) * 180 / Math.PI;
    }

    /** 顶点颜色：按高度 + 坡度混出 草/土/岩/雪/沙 */
    function colorAt(x, z, h, slopeDeg, out) {
      const o = out || [0, 0, 0];
      const slope = slopeDeg == null ? slopeAt(x, z, 1.5) : slopeDeg;
      const jitter = N.fbm2(x * 0.02, z * 0.02, S + 31, 3, 2.0, 0.5);

      const snowStart = snowLine + jitter * 10;
      let wSnow = N.smoothstep(snowStart - 6, snowStart + 10, h);

      let wRock = N.smoothstep(slopeTree, slopeRock, slope) * 0.9
                + N.smoothstep(treeLine + 15, treeLine + 55, h) * 0.55;
      wRock = Math.min(1, wRock);

      // ★ 只有配置了湖泊（lakeCount>0）才画沙带：
      //   否则地形在 0 附近本来就有大片区域，会被误判成"水边沙滩"（整片发黄）
      const lakeCount = Math.max(0, Math.round(Number(P.lakeCount) || 0));
      const shore = lakeCount > 0 ? N.smoothstep(waterLevel + 1.6, waterLevel + 0.15, h) : 0;
      let wDirt = Math.max(shore, N.smoothstep(0.6, 0.95, Math.abs(jitter)) * 0.12);

      let wSnowFinal = Math.min(1, wSnow);
      let wRockFinal = Math.min(1 - wSnowFinal, wRock);
      let wDirtFinal = Math.min(1 - wSnowFinal - wRockFinal, wDirt);
      let wGrass = Math.max(0, 1 - wSnowFinal - wRockFinal - wDirtFinal);

      const g0 = COL.grass, g1 = COL.grass2, r = COL.rock, s = COL.snow, sd = COL.sand;
      // 大斑块（几十米尺度）+ 细斑点，避免整片地形一个塑料绿
      const patch = N.fbm2(x * 0.0055, z * 0.0055, S + 77, 3, 2.0, 0.5);
      const gk = Math.max(0, Math.min(1, 0.5 + patch * 0.95 + jitter * 0.15));
      const gr = g0[0] + (g1[0] - g0[0]) * gk;
      const gg = g0[1] + (g1[1] - g0[1]) * gk;
      const gb = g0[2] + (g1[2] - g0[2]) * gk;

      // 先按 sRGB 混色，再转成线性写入顶点色（否则整体发白）
      o[0] = srgbToLinear(gr * wGrass + sd[0] * wDirtFinal + r[0] * wRockFinal + s[0] * wSnowFinal);
      o[1] = srgbToLinear(gg * wGrass + sd[1] * wDirtFinal + r[1] * wRockFinal + s[1] * wSnowFinal);
      o[2] = srgbToLinear(gb * wGrass + sd[2] * wDirtFinal + r[2] * wRockFinal + s[2] * wSnowFinal);
      return o;
    }

    function isPlantable(x, z) {
      const h = heightAt(x, z);
      if (h <= waterLevel + 0.6) return false;
      if (h >= snowLine + 4) return false;
      if (slopeAt(x, z, 1.5) >= slopeTree) return false;
      return true;
    }

    return {
      params: P,
      seed: S,
      amp, waterLevel, snowLine, treeLine,
      heightAt, slopeAt, colorAt, isPlantable, flatFade
    };
  }

  /**
   * 世界采样器：多块地形（位置 + 面积 + 基准高度），边界硬接
   * @param {{terrains:Array}} world  每项 { id, name, seed, params, area:{x,z,width,depth,baseY,priority} }
   */
  function createWorldSampler(world) {
    const w = world || {};
    let list = Array.isArray(w.terrains) ? w.terrains.slice() : [];
    if (!list.length) {
      // 兼容旧结构 { global, zones }
      if (w.global) list.push(w.global);
      (w.zones || []).forEach(function (z) { list.push(z); });
    }

    const items = [];
    list.forEach(function (t) {
      const a = t.area || {};
      const zz = t.zone || {};
      const width = Number(a.width != null ? a.width : zz.size) || 0;
      const depth = Number(a.depth != null ? a.depth : zz.size) || 0;
      if (!(width > 0 && depth > 0)) return;
      const cx = Number(a.x != null ? a.x : zz.x) || 0;
      const cz = Number(a.z != null ? a.z : zz.z) || 0;
      const baseY = Number(a.baseY != null ? a.baseY : 0) || 0;
      items.push({
        id: t.id,
        name: t.name || '',
        cx: cx, cz: cz, width: width, depth: depth,
        sx: cx - width / 2, ex: cx + width / 2,
        sz: cz - depth / 2, ez: cz + depth / 2,
        baseY: baseY,
        priority: Number(a.priority != null ? a.priority : zz.priority) || 0,
        sampler: createSampler(t.params || {}, t.seed || 1)
      });
    });
    items.sort(function (a, b) { return (b.priority - a.priority) || (a.id - b.id); });

    function pick(x, z) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (x >= it.sx && x <= it.ex && z >= it.sz && z <= it.ez) return it;
      }
      return null;
    }

    // 渲染兜底：地形外贴到最近一块地形的边缘高度（避免 NaN / 突兀的 0 平面）
    function nearest(x, z) {
      let best = null;
      let bestD = Infinity;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const cx = Math.min(it.ex, Math.max(it.sx, x));
        const cz = Math.min(it.ez, Math.max(it.sz, z));
        const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
        if (d < bestD) { bestD = d; best = { it: it, x: cx, z: cz }; }
      }
      return best;
    }

    const empty = createSampler({ heightScale: 0 }, 1);

    return {
      terrains: items,

      hasTerrainAt: function (x, z) { return !!pick(x, z); },
      pickAt: function (x, z) { return pick(x, z); },

      /**
       * 渲染用高度（永远返回数值）
       * @param {boolean} [clampOutside=true] 地形外是否贴最近地形边缘
       */
      heightAt: function (x, z, clampOutside) {
        const it = pick(x, z);
        if (it) return it.baseY + it.sampler.heightAt(x, z);
        if (clampOutside === false) return 0;
        const n = nearest(x, z);
        if (!n) return 0;
        return n.it.baseY + n.it.sampler.heightAt(n.x, n.z);
      },

      /**
       * 物理用：脚下能站的地面高度
       * 返回 null = 该点没有地形（玩家一直往下掉，这是"地形=离散地块"的设计）
       *
       * 【2026-10-28 修复：高处跳下 / 低帧率穿地后永不落地】
       * 旧实现在 h > fromY + 0.6 时返回 null（本意"地形在头顶上方时不算脚下地面"），
       * 但一帧的下落位移超过 0.6m 时，这一帧会直接跨过地面落到地面以下；下一帧
       * h > y + 0.6 恒成立 → 又返回 null → 玩家永久自由落体，只能刷新页面。
       * 触发条件（实测 60fps）：登录角色(GLB，脚底=position.y) 约 17~20m 落差即穿；
       * 低帧率下更敏感（fs=6 时 1m 落差就会穿），因此"加载期刷新后一移动就掉""切大雾
       * 掉帧必掉"都是同一个漏洞。
       * 现在：只要水平位置在这块地形矩形内就返回高度，穿透后下一帧会被
       * player.handleVerticalMovement 的贴地分支自然拉回地表。地形边界之外仍返回 null。
       * 注：若将来做"上下重叠的浮空岛"，这里会把人吸到较高那块上，届时需改用
       *     "上一帧脚底高度"做跨面判定（prevY >= h 才托住）；当前两块地形不重叠，无此问题。
       */
      groundAt: function (x, z) {
        const it = pick(x, z);
        if (!it) return null;
        return it.baseY + it.sampler.heightAt(x, z);
      },

      slopeAt: function (x, z, e) {
        const it = pick(x, z);
        return (it ? it.sampler : empty).slopeAt(x, z, e);
      },
      colorAt: function (x, z, h, s, o) {
        const it = pick(x, z);
        return (it ? it.sampler : empty).colorAt(x, z, h, s, o);
      },
      isPlantable: function (x, z) {
        const it = pick(x, z);
        return it ? it.sampler.isPlantable(x, z) : false;
      },
      pickName: function (x, z) {
        const it = pick(x, z);
        return it ? it.name : null;
      }
    };
  }

  global.TerrainHeight = { createSampler, createWorldSampler, COLORS: COL };
})(typeof window !== 'undefined' ? window : globalThis);
