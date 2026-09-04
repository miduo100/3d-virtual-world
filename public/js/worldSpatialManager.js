/**
 * worldSpatialManager.js
 * P1 空间分页管理器：按玩家位置增量拉取世界对象，避免一次性全量加载 5000+ 模型。
 *
 * 设计：
 *  1. initialLoad()：首次围绕玩家位置拉取 INITIAL_RADIUS 半径内的对象，
 *     返回结构与旧 /api/world/objects 兼容（{ success, objects }），
 *     world.js loadGeneratedBuildings 无需改动主体逻辑即可接入。
 *  2. 轮询：玩家跨过 CELL_SIZE 的网格边界时，以当前位置为中心拉取增量，
 *     按 obj.id 去重后合并进 world.allWorldObjects，由 updateObjectLoading
 *     自然完成距离加载（无需改动 world.js 加载循环）。
 *  3. 安全阀：MAX_OBJECTS 上限防止逛遍全图无限拉取。
 *
 * 依赖：window.World（world.js 已导出）、window.player（场景玩家对象）
 */
(function () {
  'use strict';

  const API_BASE = '/api/world/spatial/around';
  const INITIAL_RADIUS = 600;   // 首次拉取半径（米）
  const CELL_SIZE = 400;        // 增量轮询的网格粒度（米）
  // 大模型外扩量（米）：后端按锚点做方框查询，大模型的锚点可能远在模型之外，
  // 不外扩的话玩家走到模型跟前，这条记录还没被拉进 allWorldObjects，永远不会加载
  const BOUNDS_MARGIN = 200;
  const POLL_INTERVAL = 2500;   // 轮询间隔（ms）
  const FETCH_LIMIT = 500;      // 单次请求上限（与后端 MAX_LIMIT 对齐）
  const MAX_OBJECTS = 5000;     // 全图对象安全阀

  class WorldSpatialManager {
    constructor(world) {
      this.world = world;
      this.loadedIds = new Set();     // 已拉取对象 id（去重）
      this.loadedCells = new Set();   // 已拉取网格 key（避免重复请求）
      this.pollTimer = null;
      this.pending = false;           // 请求防重入
      this._lastCell = null;
      this.started = false;
    }

    // ---- 工具 ----

    _cellKey(x, z) {
      const cx = Math.floor(x / CELL_SIZE);
      const cz = Math.floor(z / CELL_SIZE);
      return cx + ',' + cz;
    }

    _playerPos() {
      const p = window.player;
      if (p && p.position && typeof p.position.x === 'number') {
        return { x: p.position.x, z: p.position.z };
      }
      return { x: 0, z: 0 };
    }

    _hitLimit() {
      return this.loadedIds.size >= MAX_OBJECTS;
    }

    // ---- 拉取与合并 ----

    async _fetchAround(x, z, radius, type, offset) {
      let url = API_BASE + '?x=' + x + '&z=' + z + '&radius=' + radius + '&limit=' + FETCH_LIMIT;
      if (offset) url += '&offset=' + offset;
      if (type) url += '&type=' + encodeURIComponent(type);
      const resp = await fetch(url);
      const json = await resp.json();
      if (!json.success) {
        throw new Error('spatial API error');
      }
      return json;
    }

    // 翻页拉取直到 hasMore=false，防止旧对象被 LIMIT 挤出
    async _fetchAroundAll(x, z, radius, type) {
      const result = [];
      let offset = 0;
      for (let i = 0; i < 20; i++) {
        const json = await this._fetchAround(x, z, radius, type, offset);
        const objs = json.objects || [];
        result.push(...objs);
        if (!json.hasMore || objs.length === 0) break;
        offset += objs.length;
      }
      return result;
    }

    // type → loadMethod 映射（与 world.js loadGeneratedBuildings 保持一致）
    // 修复：增量对象绕过 loadGeneratedBuildings 的 loadMethod 赋值，
    // 直接入队会导致 processLoadingQueue 调用 this[undefined] 抛 TypeError
    _resolveLoadMethod(obj) {
      const t = obj && obj.type;
      if (!t) return null;
      if (t.startsWith('geometry_')) return 'addGeometryBuilding';
      switch (t) {
        case 'generated_building': return 'addGeneratedBuilding';
        case 'uploaded_model': return 'addUploadedModel';
        case 'threejs_code': return 'addThreeJSModel';
        case 'ad_slot': return 'addAdSlotPortal';
        case 'gaussian_splat': return 'addGaussianSplat';
        case 'media_image':
        case 'media_video': return 'loadMediaObject';
        default: return null;
      }
    }

    _merge(objects) {
      let added = 0;
      const target = this.world.allWorldObjects;
      for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        if (!o || o.id === undefined || this.loadedIds.has(o.id)) continue;
        if (!o.loadMethod) o.loadMethod = this._resolveLoadMethod(o);
        this.loadedIds.add(o.id);
        target.push(o);
        added++;
      }
      if (added > 0) {
        console.log('[空间分页] 增量合并 ' + added + ' 个新对象，当前共 ' + target.length + ' 个');
      }
      return added;
    }

    // ---- 生命周期 ----

    /**
     * 首次加载（替代 loadGeneratedBuildings 中的全量 fetch）。
     * 返回 { success, objects }，结构与旧 /api/world/objects 完全一致。
     */
    async initialLoad() {
      const pos = this._playerPos();
      try {
        // 1) 专项翻页拉取特殊类型对象（数量少，防止被 uploaded_model 挤出分页）
        const extra = [];
        for (const t of ['geometry_building', 'geometry_nature', 'media_image', 'media_video', 'threejs_code', 'gaussian_splat']) {
          try {
            const objs = await this._fetchAroundAll(pos.x, pos.z, INITIAL_RADIUS + BOUNDS_MARGIN, t);
            extra.push(...objs);
          } catch (e) { /* 单项失败不阻断 */ }
        }
        // 2) uploaded_model 翻页拉全（红军+旧模型都拉回，由 merger 视距裁剪控制渲染）
        try {
          const ups = await this._fetchAroundAll(pos.x, pos.z, INITIAL_RADIUS + BOUNDS_MARGIN, 'uploaded_model');
          extra.push(...ups);
        } catch (e) { /* 失败不阻断 */ }
        // 3) 常规拉取（广告位等）
        const json = await this._fetchAround(pos.x, pos.z, INITIAL_RADIUS + BOUNDS_MARGIN);
        if (json.success) {
          const merged = [...extra, ...(json.objects || [])];
          const seen = new Set();
          const deduped = [];
          for (const o of merged) {
            if (o.id === undefined || seen.has(o.id)) continue;
            seen.add(o.id);
            deduped.push(o);
          }
          this._lastCell = this._cellKey(pos.x, pos.z);
          this.loadedCells.add(this._lastCell);
          deduped.forEach((o) => { if (o.id !== undefined) this.loadedIds.add(o.id); });
          this.startPolling();
          return { success: true, objects: deduped };
        }
        return json;
      } catch (e) {
        console.warn('[空间分页] 首次加载失败，回退全量接口:', e.message);
        // 兜底：退化为旧行为（保证场景可用）
        const resp = await fetch('/api/world/objects');
        return resp.json();
      }
    }

    startPolling() {
      if (this.started || this.pollTimer) return;
      this.started = true;
      this.pollTimer = setInterval(() => this._poll(), POLL_INTERVAL);
      console.log('[空间分页] 增量轮询已启动（网格 ' + CELL_SIZE + 'm / 间隔 ' + POLL_INTERVAL + 'ms）');
    }

    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      this.started = false;
    }

    async _poll() {
      if (this.pending || this._hitLimit()) return;
      const pos = this._playerPos();
      const cell = this._cellKey(pos.x, pos.z);
      // 玩家仍在已拉取的网格内 → 跳过（走动到新网格才拉）
      if (cell === this._lastCell) return;
      this.pending = true;
      try {
        const objs = await this._fetchAroundAll(pos.x, pos.z, CELL_SIZE + BOUNDS_MARGIN);
        this._lastCell = cell;
        this.loadedCells.add(cell);
        this._merge(objs);
      } catch (e) {
        // 拉取失败静默，下一轮重试
        console.warn('[空间分页] 增量拉取失败:', e.message);
      } finally {
        this.pending = false;
      }
    }

    // ---- 调试 ----

    getStats() {
      return {
        loadedIds: this.loadedIds.size,
        loadedCells: this.loadedCells.size,
        worldObjects: this.world.allWorldObjects ? this.world.allWorldObjects.length : 0,
        polling: !!this.pollTimer
      };
    }
  }

  window.WorldSpatialManager = WorldSpatialManager;
})();
