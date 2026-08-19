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

    async _fetchAround(x, z, radius) {
      const url = API_BASE + '?x=' + x + '&z=' + z + '&radius=' + radius + '&limit=' + FETCH_LIMIT;
      const resp = await fetch(url);
      const json = await resp.json();
      if (!json.success) {
        throw new Error('spatial API error');
      }
      return json;
    }

    _merge(objects) {
      let added = 0;
      const target = this.world.allWorldObjects;
      for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        if (!o || o.id === undefined || this.loadedIds.has(o.id)) continue;
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
        const json = await this._fetchAround(pos.x, pos.z, INITIAL_RADIUS);
        if (json.success) {
          this._lastCell = this._cellKey(pos.x, pos.z);
          this.loadedCells.add(this._lastCell);
          json.objects.forEach((o) => { if (o.id !== undefined) this.loadedIds.add(o.id); });
          this.startPolling();
          return { success: true, objects: json.objects };
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
        const json = await this._fetchAround(pos.x, pos.z, CELL_SIZE);
        if (json.success) {
          this._lastCell = cell;
          this.loadedCells.add(cell);
          this._merge(json.objects);
        }
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
