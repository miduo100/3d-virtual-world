/**
 * 几何建筑合批器（GeometryBatcher）—— 2026-09-05 卡顿治理方案1
 *
 * 问题：几何建筑每个对象 4~5 个独立 mesh，密集区单视野 300 对象 = 1200+ draw call，
 *       加上其他对象单帧 3000+ calls → 帧时间 80~110ms（十帧级卡顿）。
 *
 * 方案：把静态几何建筑按「几何体内容哈希 + 材质参数签名」合并为 InstancedMesh。
 *       同模板生成的网格字节级相同 → 30 个栅栏合并成 1 个 InstancedMesh。
 *       单视野 1252 网格 → 预期几十个批次。
 *
 * 设计要点：
 * - 只处理静态几何建筑（addGeometryBuilding 路径），threejs_code/上传模型/广告位不参与
 * - 含 custom_config 的对象跳过（逐实例材质覆盖与共享材质冲突）
 * - 含 SkinnedMesh / 多材质 / 超大网格(>3万三角形)的对象跳过（回退真实网格）
 * - 真实克隆不加入 scene（保留在 generatedBuildings 供碰撞/卸载/编辑器流程使用），
 *   由合批器持有 InstancedMesh 渲染
 * - 管理员编辑模式开启时整体还原（unbatchAll），关闭时重新合批（rebatchAll），
 *   保证 TransformControls 选中/移动/删除流程零改动
 * - 卸载对象只移除实例（swap-remove 压缩），不 dispose 共享几何体/材质
 * - 【2026-09-05 方案二】批次级视距裁剪：实例超过 VIEW_CULL_DIST 隐藏（零缩放矩阵），
 *   由占位方块接管"这里有东西"的示意；走近自动恢复。与 worldInstanceMerger_v2 的
 *   200m 视距、world.js 的 400m 数据卸载形成统一分层：
 *   200m 内渲染真模型 / 200~400m 只剩蓝盒 / >400m 数据卸载回收资源
 */
(function () {
  'use strict';

  const MAX_TRIS_PER_MESH = 30000;   // 超过则不合批（避免大模型哈希耗时）
  const INIT_CAP = 16;               // 批次初始容量
  const VIEW_CULL_DIST = 200;        // 实例视距裁剪半径（米），与 MAX_RENDER_DIST 对齐
  const SHOW_HYST = 10;              // 显示迟滞（米），防阈值边缘闪烁

  function GeometryBatcher() {
    this._scene = null;
    this._root = null;          // 所有 InstancedMesh 的父组
    this._batches = new Map();  // batchKey -> { im, count, cap, slotOwner, slotMat, slotHidden }
    this._byId = new Map();     // worldObjectId -> { model, worldObject, anchor, hidden, entries: [{batch, slot}] }
    this.editMode = false;
    this._v = null;
    this._cq = null;            // 临时四元数（视距隐藏时分解/重组矩阵用）
    this._cs = null;
    this._cm = null;
    this._culledCount = 0;      // 当前被视距裁剪隐藏的对象数（调试用）
    this._cullFrame = 0;
    this._cullRaf = null;
    this._prewarmSet = new Set();   // 待预热编译的 InstancedMesh（按批次去重）
    this._prewarmTimer = null;
  }

  GeometryBatcher.prototype._ensureInit = function () {
    if (this._root) return true;
    const T = window.THREE;
    const scene = window.gameWorld && window.gameWorld.scene;
    if (!T || !scene) return false;
    this._scene = scene;
    this._root = new T.Group();
    this._root.name = '__geometryBatchRoot__';
    this._root.userData.__batchRoot = true;
    scene.add(this._root);
    this._v = new T.Vector3();
    this._cq = new T.Quaternion();
    this._cs = new T.Vector3();
    this._cm = new T.Matrix4();
    // 自愈对账：每 2 秒收掉「真实模型已加载却仍摆着」的占位方块残留
    // （覆盖各路径竞态：加载完成早于摆盒、增量摆盒重扫等）
    if (!this._sweepTimer) {
      // 接入 BgThrottle：页面后台时冻结扫场定时器（无模块时回退裸 setInterval）
      const sweepFn = () => {
        try { this._sweepPlaceholders(); } catch (e) {}
      };
      this._sweepTimer = window.BgThrottle
        ? window.BgThrottle.every('gb.sweep', 2000, sweepFn)
        : setInterval(sweepFn, 2000);
    }
    // 【方案二】批次视距裁剪循环：每 5 帧一次（约 12Hz），按玩家距离隐藏/恢复实例
    if (!this._cullRaf && typeof requestAnimationFrame === 'function') {
      const loop = () => {
        this._cullRaf = requestAnimationFrame(loop);
        if ((this._cullFrame++ % 5) !== 0) return;
        try { this._cullTick(); } catch (e) {}
      };
      this._cullRaf = requestAnimationFrame(loop);
    }
    console.log('[GeometryBatcher] ✅ 初始化完成');
    return true;
  };

  /** 取主渲染器（预热编译用） */
  GeometryBatcher.prototype._getRenderer = function () {
    return (window.gameWorld && window.gameWorld.renderer) || window.renderer || null;
  };

  /**
   * 【2026-09-06 首载卡顿治理】新批次材质预热。
   * 实测根因（用户 dumpSlow 数据）：首见材质在第一次 draw call 内被 D3D 驱动
   * 同步编译，renderCPU 单帧高达 2161ms。新批次创建后改走 compileAsync
   * （WebGL2 KHR_parallel_shader_compile），把编译成本从 draw call 挪到空闲期。
   * 同一 batchKey 的 InstancedMesh 只预热一次；无 compileAsync 的旧渲染器静默跳过。
   */
  GeometryBatcher.prototype._queuePrewarm = function (im) {
    if (!im || this._prewarmSet.has(im)) return;
    this._prewarmSet.add(im);
    if (this._prewarmTimer) return;
    const self = this;
    const run = function () {
      self._prewarmTimer = null;
      const r = self._getRenderer();
      const list = Array.from(self._prewarmSet);
      self._prewarmSet.clear();
      if (!r || typeof r.compileAsync !== 'function' || list.length === 0) return;
      for (let i = 0; i < list.length; i++) {
        try { Promise.resolve(r.compileAsync(list[i])).catch(function () {}); } catch (e) {}
      }
    };
    this._prewarmTimer = (typeof requestIdleCallback === 'function')
      ? requestIdleCallback(run, { timeout: 1000 })
      : setTimeout(run, 300);
  };

  /** 把某槽位的实例矩阵同步到 InstancedMesh（隐藏态=清零旋转/缩放块、保留平移） */
  GeometryBatcher.prototype._applySlot = function (batch, slot) {
    this._cm.copy(batch.slotMat[slot]);
    if (batch.slotHidden[slot]) {
      // 零缩放实例不被渲染；不走 decompose（r185 对 det=0 矩阵会返回单位缩放）
      const el = this._cm.elements;
      el[0] = el[1] = el[2] = 0;
      el[4] = el[5] = el[6] = 0;
      el[8] = el[9] = el[10] = 0;
    }
    batch.im.setMatrixAt(slot, this._cm);
    batch.im.instanceMatrix.needsUpdate = true;
  };

  /** 隐藏/恢复一个对象的全部实例，并同步占位方块替身 */
  GeometryBatcher.prototype._setEntryHidden = function (entry, hidden) {
    if (entry.hidden === hidden) return;
    entry.hidden = hidden;
    for (let i = 0; i < entry.entries.length; i++) {
      const e = entry.entries[i];
      e.batch.slotHidden[e.slot] = hidden;
      this._applySlot(e.batch, e.slot);
    }
    this._culledCount += hidden ? 1 : -1;
    const PF = window.PlaceholderField;
    if (PF) {
      const a = entry.anchor;
      if (hidden) PF.show(entry.worldObject.id, a.x, a.y, a.z);
      else PF.fadeOutAndHide(entry.worldObject.id);
    }
  };

  /** 视距裁剪：按玩家到对象锚点的水平距离隐藏/恢复（带迟滞防闪烁） */
  GeometryBatcher.prototype._cullTick = function () {
    if (this.editMode || this._byId.size === 0) return;
    const p = window.player && window.player.position;
    if (!p) return;
    const hideD2 = VIEW_CULL_DIST * VIEW_CULL_DIST;
    const showD2 = (VIEW_CULL_DIST - SHOW_HYST) * (VIEW_CULL_DIST - SHOW_HYST);
    this._byId.forEach((entry) => {
      const dx = p.x - entry.anchor.x;
      const dz = p.z - entry.anchor.z;
      const d2 = dx * dx + dz * dz;
      if (!entry.hidden) {
        if (d2 > hideD2) this._setEntryHidden(entry, true);
      } else if (d2 < showD2) {
        this._setEntryHidden(entry, false);
      }
    });
  };

  /** 对象当前是否处于视距隐藏态（供 _sweepPlaceholders 等外部对账使用） */
  GeometryBatcher.prototype.isCulled = function (id) {
    const e = this._byId.get(id);
    return !!(e && e.hidden);
  };

  GeometryBatcher.prototype._sweepPlaceholders = function () {
    const w = window.gameWorld;
    const PF = window.PlaceholderField;
    if (!w || !PF || !w.loadedObjects || !w.generatedBuildings) return;
    w.loadedObjects.forEach((v, id) => {
      if (!PF.has(id)) return;
      // 【方案二】合批实例被视距裁剪隐藏时，占位方块就是它的替身，不能收
      if (this.isCulled(id)) return;
      const entry = w.generatedBuildings.get(id);
      if (entry && !entry.isPlaceholder && entry.model) {
        PF.fadeOutAndHide(id);
      }
    });
  };

  /** 几何体内容哈希（FNV-1a over index/position/normal/uv 字节） */
  function hashGeometry(geo) {
    if (geo.userData && geo.userData.__batchHash) return geo.userData.__batchHash;
    let h = 0x811c9dc5;
    const mix = (attr) => {
      if (!attr) return;
      const a = attr.array;
      if (!a || !a.byteLength) return;
      let off = a.byteOffset || 0;
      const u8 = new Uint8Array(a.buffer, off, a.byteLength);
      for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    };
    mix(geo.index);
    mix(geo.attributes.position);
    mix(geo.attributes.normal);
    mix(geo.attributes.uv);
    h = (h ^ (geo.attributes.position ? geo.attributes.position.count : 0)) >>> 0;
    const key = 'g' + h.toString(36);
    try { geo.userData.__batchHash = key; } catch (e) {}
    return key;
  }

  /** 材质参数签名（参数相同即视为可共享） */
  function matSig(m) {
    return [
      m.type,
      m.color ? m.color.getHexString() : '',
      m.emissive ? m.emissive.getHexString() : '',
      m.opacity, m.transparent ? 1 : 0, m.wireframe ? 1 : 0,
      m.side, m.metalness, m.roughness,
      m.map ? ('map' + m.map.uuid) : '',
      m.emissiveMap ? 'em' : '', m.alphaMap ? 'am' : '',
      m.emissiveIntensity
    ].join('|');
  }

  /** 扩容：重建更大容量的 InstancedMesh 并迁移数据 */
  GeometryBatcher.prototype._grow = function (batch) {
    const T = window.THREE;
    const newCap = batch.cap * 2;
    const im = new T.InstancedMesh(batch.im.geometry, batch.im.material, newCap);
    im.instanceMatrix.setUsage(T.DynamicDrawUsage);
    im.castShadow = batch.im.castShadow;
    im.receiveShadow = batch.im.receiveShadow;
    // 迁移
    const old = batch.im;
    batch.im = im;   // _applySlot 依赖 batch.im 指向新网格
    for (let i = 0; i < batch.count; i++) {
      this._applySlot(batch, i);
    }
    im.count = batch.count;
    this._root.remove(old);
    if (old.dispose) old.dispose();
    this._root.add(im);
    batch.cap = newCap;
  };

  /** 分配一个槽位（自动扩容），返回槽位号；同步建立规范矩阵/隐藏态槽位 */
  GeometryBatcher.prototype._allocSlot = function (batch) {
    if (batch.count >= batch.cap) this._grow(batch);
    const slot = batch.count++;
    batch.slotMat[slot] = new window.THREE.Matrix4();
    batch.slotHidden[slot] = false;
    return slot;
  };

  /** 释放槽位（swap-remove 压缩），并把末尾槽位的规范矩阵/隐藏态/归属同步搬移 */
  GeometryBatcher.prototype._freeSlot = function (batch, slot) {
    const last = batch.count - 1;
    if (slot !== last) {
      const moved = batch.slotOwner[last];
      batch.slotOwner[slot] = moved;
      batch.slotMat[slot].copy(batch.slotMat[last]);
      batch.slotHidden[slot] = batch.slotHidden[last];
      if (moved) {
        const movedEntry = this._byId.get(moved.id);
        if (movedEntry) {
          const me = movedEntry.entries.find(e => e.batch === batch && e.slot === last);
          if (me) me.slot = slot;
        }
      }
      this._applySlot(batch, slot);
    }
    batch.count--;
    batch.im.count = batch.count;
    batch.slotOwner.length = batch.count;
    batch.slotMat.length = batch.count;
    batch.slotHidden.length = batch.count;
    if (batch.im.computeBoundingSphere) batch.im.computeBoundingSphere();
  };

  /**
   * 尝试把一个几何建筑并入批次
   * @returns {boolean} true=已合批（调用方不要再 scene.add）；false=不合批（走原流程）
   */
  GeometryBatcher.prototype.tryBatch = function (model, worldObject) {
    try {
      if (this.editMode) return false;
      if (!this._ensureInit()) return false;
      const T = window.THREE;
      if (!model || !worldObject || !worldObject.id) return false;
      if (worldObject.custom_config) return false;                       // 逐实例材质覆盖与共享材质冲突
      if (this._byId.has(worldObject.id)) return false;

      model.updateMatrixWorld(true);

      // 【方案二】记录对象锚点（模型根世界位置），供视距裁剪判定与蓝盒替身摆位
      model.matrixWorld.decompose(this._v, this._cq, this._cs);
      const anchorX = this._v.x, anchorY = this._v.y, anchorZ = this._v.z;

      // 收集网格并做资格检查
      const meshes = [];
      let ok = true;
      model.traverse((o) => {
        if (!ok || !o.isMesh || !o.geometry || !o.material) return;
        if (o.isSkinnedMesh || o.isInstancedMesh) { ok = false; return; }
        if (Array.isArray(o.material)) { ok = false; return; }          // 多材质组不合批
        if (o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) { ok = false; return; }
        const tri = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
        if (tri > MAX_TRIS_PER_MESH) { ok = false; return; }
        meshes.push(o);
      });
      if (!ok || meshes.length === 0) return false;

      const entries = [];
      for (const mesh of meshes) {
        const batchKey = hashGeometry(mesh.geometry) + '|' + matSig(mesh.material);
        let batch = this._batches.get(batchKey);
        if (!batch) {
          const im = new T.InstancedMesh(mesh.geometry, mesh.material, INIT_CAP);
          im.instanceMatrix.setUsage(T.DynamicDrawUsage);
          im.castShadow = mesh.castShadow;
          im.receiveShadow = mesh.receiveShadow;
          im.count = 0;
          im.name = 'batch_' + batchKey.slice(0, 12);
          this._root.add(im);
          batch = { im: im, count: 0, cap: INIT_CAP, slotOwner: [], slotMat: [], slotHidden: [] };
          this._batches.set(batchKey, batch);
          this._queuePrewarm(im);   // 新批次材质预热，消除首帧 draw call 内的驱动同步编译
        }
        const slot = this._allocSlot(batch);
        batch.slotMat[slot].copy(mesh.matrixWorld);   // 规范矩阵（隐藏态由 _applySlot 派生）
        this._applySlot(batch, slot);
        batch.im.count = batch.count;
        if (batch.im.computeBoundingSphere) batch.im.computeBoundingSphere();
        batch.slotOwner[slot] = { id: worldObject.id };
        entries.push({ batch: batch, slot: slot });
      }

      const entry = { model: model, worldObject: worldObject, entries: entries,
        anchor: { x: anchorX, y: anchorY, z: anchorZ }, hidden: false };
      this._byId.set(worldObject.id, entry);
      model.userData.__geometryBatched = true;
      // 已并入批次：真实克隆必须从场景摘除（否则会双重渲染）
      if (model.parent) model.parent.remove(model);
      // 【方案二】入批即判距：远处对象合批后立刻隐藏（蓝盒替身），避免关闭编辑模式/重合批时闪现
      const _p = window.player && window.player.position;
      if (_p) {
        const ddx = _p.x - anchorX, ddz = _p.z - anchorZ;
        if (ddx * ddx + ddz * ddz > VIEW_CULL_DIST * VIEW_CULL_DIST) {
          this._setEntryHidden(entry, true);
        }
      }
      return true;
    } catch (e) {
      console.warn('[GeometryBatcher] tryBatch 失败，回退真实网格:', e);
      return false;
    }
  };

  /** 卸载对象时移除其所有实例 */
  GeometryBatcher.prototype.unregister = function (id) {
    const entry = this._byId.get(id);
    if (!entry) return false;
    // 从大到小释放槽位，避免 swap 搬移时索引失效
    entry.entries.sort((a, b) => b.slot - a.slot);
    for (const e of entry.entries) {
      this._freeSlot(e.batch, e.slot);
    }
    if (entry.model) entry.model.userData.__geometryBatched = false;
    if (entry.hidden) this._culledCount--;
    this._byId.delete(id);
    return true;
  };

  GeometryBatcher.prototype.isBatched = function (id) {
    return this._byId.has(id);
  };

  /** 编辑模式开启：全部还原为真实网格（保证 TransformControls 等流程不变） */
  GeometryBatcher.prototype.unbatchAll = function () {
    this.editMode = true;
    let n = 0;
    this._byId.forEach((entry) => {
      // 【方案二】被视距裁剪隐藏的对象，其蓝盒替身由真实网格（或 cullUnmerged
      // 摘除后 merger_v2 的远距方块）接管，先渐缩收掉
      if (entry.hidden) {
        this._culledCount--;
        entry.hidden = false;
        if (window.PlaceholderField) window.PlaceholderField.fadeOutAndHide(entry.worldObject.id);
      }
      if (entry.model && !entry.model.parent) {
        this._scene.add(entry.model);
        n++;
      }
      if (entry.model) entry.model.userData.__geometryBatched = false;
    });
    this._byId.clear();
    // 清空批次
    this._batches.forEach((batch) => {
      this._root.remove(batch.im);
      if (batch.im.dispose) batch.im.dispose();
    });
    this._batches.clear();
    if (n > 0) console.log('[GeometryBatcher] 编辑模式：已还原 ' + n + ' 个合批对象为真实网格');
  };

  /** 编辑模式关闭：重新扫描 generatedBuildings 并合批 */
  GeometryBatcher.prototype.rebatchAll = function () {
    this.editMode = false;
    const w = window.gameWorld;
    if (!w || !w.generatedBuildings) return;
    let n = 0;
    w.generatedBuildings.forEach((building, id) => {
      if (!building || !building.isGeometry || !building.model) return;
      if (building.isPlaceholder) return;
      if (building.model.userData.__geometryBatched) return;
      if (this.tryBatch(building.model, building.data)) n++;
    });
    if (n > 0) console.log('[GeometryBatcher] 编辑模式关闭：重新合批 ' + n + ' 个对象');
  };

  GeometryBatcher.prototype.stats = function () {
    let objects = this._byId.size;
    let batches = 0, instances = 0;
    this._batches.forEach((b) => { batches++; instances += b.count; });
    return { batchedObjects: objects, batches: batches, instances: instances,
      culled: this._culledCount, cullDist: VIEW_CULL_DIST, editMode: this.editMode };
  };

  window.GeometryBatcher = new GeometryBatcher();
})();
