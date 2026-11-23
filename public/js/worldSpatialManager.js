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
    // 【2026-11-18 提速】改成「首包拿 total → 其余页并行」：
    // 原来 5 页串行 = 5 × 45ms ≈ 225ms，并行后 ≈ 60ms。
    // 上限 60 页（30000 条）只是防御，实际由 total 决定页数。
    async _fetchAroundAll(x, z, radius, type) {
      const first = await this._fetchAround(x, z, radius, type, 0);
      const head = first.objects || [];
      if (!first.hasMore || head.length === 0) return head;

      const pageSize = head.length;
      const total = Number(first.total) || 0;
      const pages = Math.min(Math.ceil(total / pageSize), 60);
      if (pages <= 1) return head;

      const tasks = [];
      for (let p = 1; p < pages; p++) {
        tasks.push(this._fetchAround(x, z, radius, type, p * pageSize));
      }
      // 单页失败不影响整体（allSettled），缺的那页由后续增量拉取补
      const results = await Promise.allSettled(tasks);
      const rest = [];
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value && r.value.objects) rest.push(...r.value.objects);
      }
      return head.concat(rest);
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
        // 【2026-09-05 卡顿治理】增量拉取的新对象也立即摆上占位方块
        // （全图占位示意的一部分，真模型仍按距离由 updateObjectLoading 入队）
        try {
          if (this.world && typeof this.world.addPlaceholderBuilding === 'function' &&
              window.PlaceholderField && !window.PlaceholderField.has(o.id)) {
            this.world.addPlaceholderBuilding(o.id, o, 'loading');
          }
        } catch (e) { /* 摆放失败不阻断合并 */ }
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
        /**
         * 【2026-11-18 提速】原来这里串行发 8 组请求：
         *   ① 6 个特殊类型各拉一遍（geometry_* / media_* / threejs_code / gaussian_splat）
         *   ② uploaded_model 再拉一遍
         *   ③ 最后再拉一遍「全部类型」
         * ③ 本身就包含所有类型，①② 是纯重复，全靠下面的 deduped 去重收拾，
         * 白花约 0.7 秒。旧注释担心「uploaded_model 太多把其它类型挤出分页」，
         * 但那要单类型超过一页(500)且总量超出翻页上限才成立；800 米内总共约 2000 条、
         * 5 页拉完，不存在挤出。现在只发一请求（内部并行翻页）。
         */
        let json;
        try {
          const all = await this._fetchAroundAll(pos.x, pos.z, INITIAL_RADIUS + BOUNDS_MARGIN);
          json = { success: true, objects: all };
        } catch (e) {
          json = await this._fetchAround(pos.x, pos.z, INITIAL_RADIUS + BOUNDS_MARGIN);
        }
        if (json.success) {
          const seen = new Set();
          const deduped = [];
          for (const o of (json.objects || [])) {
            if (!o || o.id === undefined || seen.has(o.id)) continue;
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
      // 接入 BgThrottle：页面后台时冻结增量轮询（无模块时回退裸 setInterval）
      this.pollTimer = window.BgThrottle
        ? window.BgThrottle.every('wsm.poll', POLL_INTERVAL, () => this._poll())
        : setInterval(() => this._poll(), POLL_INTERVAL);
      console.log('[空间分页] 增量轮询已启动（网格 ' + CELL_SIZE + 'm / 间隔 ' + POLL_INTERVAL + 'ms）');
    }

    stopPolling() {
      if (this.pollTimer) {
        if (window.BgThrottle) window.BgThrottle.cancel('wsm.poll');
        else clearInterval(this.pollTimer);
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
