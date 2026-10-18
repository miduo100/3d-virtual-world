/**
 * 地形系统（多块地形 + 环形瓦片调度 + LOD + 热更新）
 *
 * ★ 概念：「地形 = 地块」。数据来自 /api/terrain/world → { terrains: [...] }
 *   每块地形 = 中心 (x,z) + 面积 width×depth + 基准高度 baseY + 参数(seed/起伏/…)
 *   - 多块可同时生效，各自占一块矩形；边界硬接（不做混合）
 *   - 地形之外没有地面：物理查询 groundAt() 返回 null → 玩家按 -Y 一直掉
 *   - 全部地形都是纯平且 baseY=0 时（默认地形），不渲染任何瓦片，沿用世界原有平面
 *
 * 对外接口：
 *   TerrainSystem.heightAt(x,z)          → 渲染/工具用高度（永远数值）
 *   TerrainSystem.groundAt(x,z,fromY)    → 物理用（null = 无地面）
 *   TerrainSystem.update(delta)          → 每帧驱动（world.animate 里 1 行）
 *   TerrainSystem.isEnabled() / getTerrains() / debugStats() / refresh()
 */
(function (global) {
  'use strict';

  const API = '/api/terrain/world';
  const FETCH_MS = 60000;
  const SCAN_MS = 250;
  const BUDGET_MS = 6;
  const LOD_FRACTIONS = [0.18, 0.38, 0.65];

  const S = {
    ready: false,
    terrains: [],
    sampler: null,
    scene: null,
    camera: null,
    material: null,
    tiles: new Map(),
    queue: [],
    lastScan: 0,
    lastFetch: 0,
    renderable: false,
    groundDirty: true,
    signature: '',
    stats: { tiles: 0, queued: 0, tris: 0, built: 0, disposed: 0, lastBuildMs: 0 }
  };

  function nowMs() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }
  function getTHREE() { return global.THREE; }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

  function makeSignature(list) {
    const parts = [];
    (list || []).forEach(function (t) {
      const a = t.area || {};
      const p = t.params || {};
      parts.push([t.id, t.seed, a.x, a.z, a.width, a.depth, a.baseY, a.priority,
        p.heightScale, p.roughness, p.ridge, p.snowLine, p.treeLine, p.waterLevel,
        p.slopeTreeMax, p.slopeRockMin, p.chunkSize, p.viewDistance,
        (p.lodSegments || []).join('-')].join(','));
    });
    return parts.join('|');
  }

  async function fetchWorld(force) {
    const t = nowMs();
    if (!force && S.ready && (t - S.lastFetch) < FETCH_MS) return;
    S.lastFetch = t;
    try {
      const res = await fetch(API, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (!j || !j.success) throw new Error('bad payload');
      applyWorld(j);
    } catch (e) {
      if (!S.ready) console.warn('[Terrain] 读取地形失败:', e && e.message);
      S.ready = true;
    }
  }

  function applyWorld(j) {
    const list = Array.isArray(j.terrains) ? j.terrains : [];
    const prevSig = S.signature;

    S.ready = true;
    S.terrains = list;
    S.sampler = global.TerrainHeight.createWorldSampler({ terrains: list });

    // 需要自己渲染瓦片的条件：有地形，且不是"全部纯平在 y=0"
    let needRender = false;
    list.forEach(function (t) {
      const a = t.area || {};
      const p = t.params || {};
      if (num(a.baseY, 0) !== 0 || num(p.heightScale, 0) > 0.5) needRender = true;
    });
    S.renderable = needRender;
    S.signature = makeSignature(list);

    if (S.signature !== prevSig) {
      clearAllTiles();
      S.lastScan = 0;
      console.log('[Terrain] 已应用地形 ' + list.length + ' 块' + (S.renderable ? '' : '（全部纯平，沿用原有平面）'));
      list.forEach(function (t) {
        const a = t.area || {};
        console.log('   · 「' + t.name + '」' + num(a.width, 0) + '×' + num(a.depth, 0) +
          ' @ (' + num(a.x, 0) + ', ' + num(a.z, 0) + ') 基准 Y=' + num(a.baseY, 0) +
          ' 起伏 ' + num(t.params && t.params.heightScale, 0) + 'm 优先 ' + num(a.priority, 0));
      });
    }
    S.groundDirty = true;
  }

  function ensureAttached() {
    if (S.scene && S.camera) return true;
    const w = global.gameWorld;
    if (!w || !w.scene) return false;
    S.scene = w.scene;
    S.camera = w.camera || (global.player && global.player.camera) || null;
    return !!S.scene;
  }

  /** 有起伏/浮空地形时隐藏世界原有 y=0 平面；全部纯平时恢复显示 */
  function syncGroundVisibility() {
    if (!S.scene) return;
    const g = S.scene.getObjectByName('world-ground');
    if (!g) return;
    const want = !S.renderable;
    if (g.visible !== want) {
      g.visible = want;
      console.log('[Terrain] 原有地面 ' + (want ? '已恢复显示' : '已隐藏（由地形瓦片接管）'));
    }
  }

  function getMaterial() {
    if (S.material) return S.material;
    const THREE = getTHREE();
    if (!THREE) return null;
    // 与编辑器（world_editor 的地形预览）统一用 Lambert：PBR 材质在场景强环境光下会发白，
    // 导致"前端地形比编辑器浅一大截"
    S.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: false
    });
    S.material.name = 'terrain-material';
    return S.material;
  }

  function clearAllTiles() {
    const THREE = getTHREE();
    for (const tile of S.tiles.values()) {
      if (tile.mesh && S.scene) S.scene.remove(tile.mesh);
      if (tile.mesh && THREE && tile.mesh.geometry) tile.mesh.geometry.dispose();
      S.stats.disposed++;
    }
    S.tiles.clear();
    S.queue.length = 0;
    S.stats.tiles = 0;
    S.stats.tris = 0;
  }

  function lodForDistance(d, viewDist) {
    if (d <= viewDist * LOD_FRACTIONS[0]) return 0;
    if (d <= viewDist * LOD_FRACTIONS[1]) return 1;
    if (d <= viewDist * LOD_FRACTIONS[2]) return 2;
    return 3;
  }

  function disposeTile(tile) {
    const THREE = getTHREE();
    if (tile.mesh && S.scene) S.scene.remove(tile.mesh);
    if (tile.mesh && THREE && tile.mesh.geometry) tile.mesh.geometry.dispose();
    S.stats.disposed++;
  }

  /** 点到矩形（地形边界）的最近距离（平面距离） */
  function distToRect(x, z, it) {
    const dx = Math.max(it.sx - x, 0, x - it.ex);
    const dz = Math.max(it.sz - z, 0, z - it.ez);
    return Math.hypot(dx, dz);
  }

  /**
   * 当前需要渲染的地形集合：
   * 以"相机到地形边界"的最近距离判断，超过该地形的 cullDistance（渲染距离）就整块不渲染，
   * 不生成任何瓦片、不占任何资源。站在地形里面时距离为 0，永远显示。
   */
  function computeActiveTerrains() {
    const list = S.sampler ? S.sampler.terrains : [];
    const cp = S.camera ? S.camera.position : { x: 0, y: 0, z: 0 };
    const active = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const p = (it.sampler && it.sampler.params) || {};
      // 渲染距离：参数 cullDistance（默认 400m），并受视距上限约束
      const cull = Math.max(64, num(p.cullDistance, 400));
      const dist = distToRect(cp.x, cp.z, it);
      // 浮空地形：还要考虑高度差（站在下层时不加载头顶很远的浮空地形）
      const dy = it.baseY > cp.y ? (it.baseY - cp.y) : 0;
      const d3 = Math.hypot(dist, dy);
      it._dist = d3;
      it._cull = cull;
      if (d3 <= cull) active.push(it);
    }
    return active;
  }

  /** 瓦片中心归属哪块地形（用于按地形卸载） */
  function tileTerrainAt(cx, cz) {
    const it = S.sampler ? S.sampler.pickAt(cx, cz) : null;
    return it ? it.id : null;
  }

  function planTiles() {
    if (!S.renderable || !S.sampler || !S.camera) return;
    // 用"最大视距/瓦片"参数（多块地形可能各配不同，取最大保证一致）
    let chunk = 64, viewDist = 256, segs = [64, 32, 16, 8];
    (S.terrains || []).forEach(function (t) {
      const p = t.params || {};
      const c = Math.max(16, num(p.chunkSize, 64));
      if (c > chunk) chunk = c;
      const v = Math.max(64, num(p.viewDistance, 256));
      if (v > viewDist) viewDist = v;
      if (Array.isArray(p.lodSegments) && p.lodSegments.length === 4) {
        segs = p.lodSegments.map(function (x) { return Math.max(2, num(x, 16)); });
      }
    });

    const cp = S.camera.position;
    const c0x = cp.x;
    const c0z = cp.z;
    const ctx = Math.floor(c0x / chunk);
    const ctz = Math.floor(c0z / chunk);
    const rad = Math.ceil((viewDist + chunk) / chunk);

    // ★ 按"离地形边缘的距离"决定哪些地形参与渲染（太远整块不渲染）
    const activeList = computeActiveTerrains();
    const activeIds = new Set(activeList.map(function (it) { return it.id; }));
    S.activeCount = activeIds.size;

    const need = new Set();
    const wanted = [];

    if (activeIds.size) {
      for (let dz = -rad; dz <= rad; dz++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const tx = ctx + dx;
          const tz = ctz + dz;
          const cx = (tx + 0.5) * chunk;
          const cz = (tz + 0.5) * chunk;
          const d = Math.hypot(cx - c0x, cz - c0z);
          if (d > viewDist + chunk * 0.75) continue;

          // 该瓦片归属的地形必须处于"渲染距离内"，否则不生成
          const tid = tileTerrainAt(cx, cz);
          if (tid == null || !activeIds.has(tid)) continue;

          const key = tx + ',' + tz;
          need.add(key);
          const level = lodForDistance(d, viewDist);

          const cur = S.tiles.get(key);
          if (cur && cur.level === level && cur.terrainId === tid) continue;
          if (cur) {
            disposeTile(cur);
            S.tiles.delete(key);
          }
          wanted.push({ key: key, tx: tx, tz: tz, level: level, dist: d, chunk: chunk, segs: segs, terrainId: tid });
        }
      }
    }

    // 卸载：视野外，或所属地形已超出渲染距离
    for (const [key, tile] of Array.from(S.tiles.entries())) {
      if (!need.has(key) || (tile.terrainId != null && !activeIds.has(tile.terrainId))) {
        disposeTile(tile);
        S.tiles.delete(key);
      }
    }

    if (wanted.length) {
      wanted.sort(function (a, b) { return a.dist - b.dist; });
      const queued = new Set(S.queue.map(function (q) { return q.key; }));
      for (const w of wanted) {
        if (S.tiles.has(w.key) || queued.has(w.key)) continue;
        S.queue.push(w);
      }
    }
    S.stats.tiles = S.tiles.size;
    S.stats.queued = S.queue.length;
  }

  function buildOne(item) {
    const THREE = getTHREE();
    const mat = getMaterial();
    if (!THREE || !mat || !S.scene) return false;
    if (S.tiles.has(item.key)) return true;

    const t0 = nowMs();
    const originX = item.tx * item.chunk;
    const originZ = item.tz * item.chunk;
    const seg = item.segs[item.level];

    let built;
    try {
      built = global.TerrainChunk.buildGeometry(THREE, S.sampler, originX, originZ, item.chunk, seg);
    } catch (e) {
      console.warn('[Terrain] 瓦片生成失败:', item.key, e && e.message);
      return false;
    }

    const mesh = new THREE.Mesh(built.geometry, mat);
    mesh.position.set(originX, 0, originZ);
    mesh.name = 'terrain:' + item.tx + ',' + item.tz;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.userData.__terrainTile = true;
    S.scene.add(mesh);

    S.tiles.set(item.key, {
      key: item.key, tx: item.tx, tz: item.tz, level: item.level,
      terrainId: item.terrainId, mesh: mesh, tris: built.tris
    });
    S.stats.built++;
    S.stats.lastBuildMs = Math.round(nowMs() - t0);
    S.stats.tiles = S.tiles.size;
    S.stats.tris += built.tris;
    return true;
  }

  function pumpQueue() {
    if (!S.queue.length) return;
    const t0 = nowMs();
    while (S.queue.length && (nowMs() - t0) < BUDGET_MS) {
      buildOne(S.queue.shift());
    }
    S.stats.queued = S.queue.length;
  }

  function update(delta) {
    fetchWorld(false);
    if (!ensureAttached()) return;
    if (S.groundDirty) { S.groundDirty = false; syncGroundVisibility(); }
    if (!S.renderable) return;

    const t = nowMs();
    if (t - S.lastScan > SCAN_MS) {
      S.lastScan = t;
      planTiles();
    }
    pumpQueue();
  }

  /** 渲染/工具用：永远返回数值（地形外沿用最近边缘） */
  function heightAt(x, z) {
    if (!S.sampler) return 0;
    try {
      const h = S.sampler.heightAt(x, z);
      return Number.isFinite(h) ? h : 0;
    } catch (e) { return 0; }
  }

  /** 物理用：null = 脚下没有地形（玩家一直掉） */
  function groundAt(x, z, fromY) {
    if (!S.sampler) return 0;   // 没有地形系统时退回老的"0 平面"行为
    try {
      return S.sampler.groundAt(x, z, fromY);
    } catch (e) { return 0; }
  }

  function debugStats() {
    return {
      ready: S.ready,
      count: S.terrains.length,
      activeCount: S.activeCount || 0,
      terrains: S.terrains.map(function (t) {
        const a = t.area || {};
        const p = t.params || {};
        const it = (S.sampler && S.sampler.terrains || []).find(function (x) { return x.id === t.id; });
        return {
          id: t.id, name: t.name, active: t.active,
          x: num(a.x, 0), z: num(a.z, 0), width: num(a.width, 0), depth: num(a.depth, 0),
          baseY: num(a.baseY, 0), priority: num(a.priority, 0),
          h: num(p.heightScale, 0),
          cull: num(p.cullDistance, 400),
          dist: it && Number.isFinite(it._dist) ? Math.round(it._dist) : null,
          rendering: !!(it && Number.isFinite(it._dist) && it._dist <= num(p.cullDistance, 400))
        };
      }),
      renderable: S.renderable,
      tiles: S.tiles.size,
      queued: S.queue.length,
      tris: S.stats.tris,
      built: S.stats.built,
      disposed: S.stats.disposed,
      lastBuildMs: S.stats.lastBuildMs,
      signature: S.signature
    };
  }

  global.TerrainSystem = {
    update: update,
    heightAt: heightAt,
    groundAt: groundAt,
    isEnabled: function () { return S.renderable; },
    getTerrains: function () { return S.terrains; },
    getTerrain: function () { return S.terrains[0] || null; },
    getParams: function () { return (S.terrains[0] && S.terrains[0].params) || null; },
    refresh: function () { return fetchWorld(true); },
    debugStats: debugStats,
    _state: S
  };

  fetchWorld(true);
})(typeof window !== 'undefined' ? window : globalThis);
