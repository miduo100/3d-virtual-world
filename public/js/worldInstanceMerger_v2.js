/**
 * worldInstanceMerger.js
 * 同源副本 InstancedMesh 合批渲染模块（独立旁路模块，不修改 world.js）
 *
 * 问题背景：
 *   26 个红军模型 × 30 副本 = 780 个独立场景对象，每帧约 7800 次 draw call，
 *   CPU 提交渲染命令成为瓶颈，页面卡死。worldTextureOptimizer 只解决了
 *   "下载/解析去重 + geometry/纹理共享"，渲染时每个 mesh 仍是独立 draw call。
 *
 * 本方案：
 *   按 __texOptSource（模型 URL）分组，同组实例数 ≥ MERGE_THRESHOLD 时，
 *   为采样模型的每个 mesh 生成一个 InstancedMesh，把组内全部实例的世界矩阵
 *   写入 instanceMatrix，然后从场景摘除源克隆体（generatedBuildings 记录保留）。
 *   draw call 从 (实例数 × mesh数) 降为 (组数 × mesh数)，约 -96%。
 *
 * 协同约束（均已核查 world.js 现有逻辑）：
 *   1. 源克隆体物理摘除（parent=null）后：
 *      - updateFrustumCulling 对其设置 visible 无害（不在场景图中不参与渲染）
 *      - unloadObject 的 scene.remove 无害，材质 dispose 无害（InstancedMesh
 *        用独立克隆材质），releaseInstance 引用计数正常，generatedBuildings.delete
 *        会被本模块快照 diff 感知 → 自动重建/解散该组
 *   2. geometry 引用源实例的共享 geometry，绝不 dispose（由 texOpt 缓存
 *      引用计数管理生命周期；组内存活实例保证 refCount>0 不会被释放）
 *   3. SkinnedMesh 用其 geometry 直接渲染 = bind pose，与静止副本当前显示一致
 *   4. r128 InstancedMesh 自身包围球不含实例变换 → frustumCulled=false 防误剔除
 *   5. 阴影全局已禁用，InstancedMesh 的 castShadow/receiveShadow 置 false，
 *      避免未来开启阴影时整组误投影
 * 6. 视距裁剪：每帧按玩家距离更新可见实例数，远距离实例不渲染（顶点+片元双省）
 *
 * 依赖：THREE r128、window.gameWorld（main.js 创建 World 实例后生效）
 */
(function () {
  'use strict';

  // ===== 配置 =====
  const MERGE_THRESHOLD = 6;    // 同 URL 实例数达到该值才合批
  const SCAN_INTERVAL = 2000;   // 快照 diff 轮询间隔(ms)
  const BOOT_RETRY = 500;       // 等待 gameWorld 实例的重试间隔(ms)
  const MAX_RENDER_DIST = 200;  // 视距裁剪半径（米），仅渲染该距离内的实例
  const CULL_MARK = '__culledByDist'; // 未合批对象被视距裁剪摘除场景的标记

  // ===== 状态 =====
  const mergedGroups = new Map(); // url → { group, sourceIds:Set, meshCount, instanceCount, templates, instanceWorlds, instancePositions, lastVisibleCount }
  let scanTimer = null;
  let cullRaf = null;
  let enabled = true;
  const skinnedNotified = new Set(); // 已提示过含蒙皮网格的 url（日志去重）

  const stats = {
    groups: 0,          // 当前合批组数
    instances: 0,       // 当前合批实例总数
    drawCallsSaved: 0,  // 相对独立渲染节省的 draw call（估算）
    rebuilds: 0,         // 重建次数
    culledInstances: 0  // 当前被视距裁剪隐藏的实例数
  };

  const tmp = new THREE.Matrix4();
  const playerPos = new THREE.Vector3();
  const _dist = new THREE.Vector3(); // 复用距离计算

  function findWorld() {
    return (typeof window !== 'undefined' && window.gameWorld) || null;
  }

  // ===== 工具 =====
  function cloneMaterial(mat) {
    if (Array.isArray(mat)) return mat.map((m) => (m ? m.clone() : null));
    return mat ? mat.clone() : null;
  }

  function disposeMaterial(mat) {
    if (Array.isArray(mat)) {
      mat.forEach((m) => { if (m && m.dispose) m.dispose(); });
    } else if (mat && mat.dispose) {
      mat.dispose();
    }
  }

  function idsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) { if (!b.has(v)) return false; }
    return true;
  }

  // ===== 分组收集 =====
  function collectGroups(world) {
    const groups = new Map();
    world.generatedBuildings.forEach((entry, id) => {
      if (!entry || !entry.model) return;
      if (entry.isPlaceholder) return;
      const model = entry.model;
      const url = model.userData && model.userData.__texOptSource;
      if (!url) return;
      if (model.userData && model.userData.__excludeFromMerge) return; // 已排除编辑的模型不参与合批
      if (entry.data && entry.data.custom_config) return;
      if (entry.data && entry.data.model_path && entry.data.model_path !== url) return;
      if (!groups.has(url)) groups.set(url, []);
      groups.get(url).push({ id, model });
    });
    return groups;
  }

  // ===== mesh 模板提取 =====
  function buildMeshTemplates(sample, url) {
    sample.updateMatrixWorld(true);
    const rootInverse = new THREE.Matrix4().copy(sample.matrixWorld).invert();
    const templates = [];
    let aborted = false;

    sample.traverse((child) => {
      if (aborted || !child.isMesh || !child.geometry) return;
      const mat = child.material;
      if (Array.isArray(mat) && (!child.geometry.groups || !child.geometry.groups.length)) {
        aborted = true;
        return;
      }
      if (child.isSkinnedMesh && !skinnedNotified.has(url)) {
        skinnedNotified.add(url);
        console.log('[合批] 检测到蒙皮网格（bind pose 渲染）:', url);
      }
      templates.push({
        geometry: child.geometry,
        material: cloneMaterial(mat),
        relativeMatrix: new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld)
      });
    });
    return aborted ? [] : templates;
  }

  // ===== 合批 =====
  function mergeGroup(world, url, instances) {
    const templates = buildMeshTemplates(instances[0].model, url);
    if (!templates.length) return false;

    for (let i = 0; i < instances.length; i++) {
      instances[i].model.updateMatrixWorld(true);
    }

    const group = new THREE.Group();
    group.name = 'InstancedMerged:' + url;
    const count = instances.length;

    for (let t = 0; t < templates.length; t++) {
      const tpl = templates[t];
      const im = new THREE.InstancedMesh(tpl.geometry, tpl.material, count);
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      for (let k = 0; k < count; k++) {
        tmp.multiplyMatrices(instances[k].model.matrixWorld, tpl.relativeMatrix);
        im.setMatrixAt(k, tmp);
      }
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
    }

    world.scene.add(group);

    for (let i = 0; i < instances.length; i++) {
      const m = instances[i].model;
      if (m.parent) world.scene.remove(m);
      delete m.userData[CULL_MARK]; // 清除视距裁剪标记，防 unmerge 后误跳过
    }

    const instanceWorlds = [];
    const instancePositions = [];
    for (let i = 0; i < instances.length; i++) {
      instanceWorlds.push(instances[i].model.matrixWorld.clone());
      const pos = new THREE.Vector3();
      pos.setFromMatrixPosition(instances[i].model.matrixWorld);
      instancePositions.push(pos);
    }

    mergedGroups.set(url, {
      group,
      sourceIds: new Set(instances.map((i) => i.id)),
      meshCount: templates.length,
      instanceCount: count,
      templates,
      instanceWorlds,
      instancePositions,
      lastVisibleCount: count
    });
    refreshStats();
    console.log(`[合批] ${url}: ${count} 实例 × ${templates.length} mesh → ${templates.length} 个 InstancedMesh`);
    return true;
  }

  // ===== 解散 =====
  function unmergeGroup(world, url, restoreSources) {
    const rec = mergedGroups.get(url);
    if (!rec) return;
    world.scene.remove(rec.group);
    rec.group.children.forEach((im) => disposeMaterial(im.material));
    if (restoreSources) {
      world.generatedBuildings.forEach((entry, id) => {
        if (rec.sourceIds.has(id) && entry && entry.model && !entry.model.parent) {
          world.scene.add(entry.model);
        }
      });
    }
    mergedGroups.delete(url);
    refreshStats();
  }

  // ===== 快照 diff 主循环 =====
  function scanAndMerge() {
    const world = findWorld();
    if (!world || !world.generatedBuildings || !world.scene) return;
    if (!enabled) return;

    const groups = collectGroups(world);

    groups.forEach((instances, url) => {
      const rec = mergedGroups.get(url);
      if (rec) {
        const curIds = new Set(instances.map((i) => i.id));
        if (idsEqual(rec.sourceIds, curIds)) return;
        unmergeGroup(world, url, true);
        stats.rebuilds++;
      }
      if (instances.length >= MERGE_THRESHOLD) {
        mergeGroup(world, url, instances);
      }
    });

    const deadUrls = [];
    mergedGroups.forEach((rec, url) => {
      if (!groups.has(url)) deadUrls.push(url);
    });
    deadUrls.forEach((url) => unmergeGroup(world, url, true));
  }

  // ===== 未合批对象视距裁剪（加载期占位符 + 尚未合批的独立模型）=====
  // 红军模型加载完成前占位符全量显示、加载完成后合批前独立全量渲染，是
  // 加载期卡顿的根源。此函数把视距裁剪提前到整个加载周期：
  //   距离 ≤ MAX_RENDER_DIST → 保持在场景（可见）
  //   距离 >  MAX_RENDER_DIST → 从场景摘除（不渲染），玩家走近自动加回
  // 用"摘除/加回"而非 visible，避免 world.js updateFrustumCulling 每 4 帧
  // 覆盖 model.visible 造成的竞争。
  // ===== 远距占位 box（真模型被视距裁剪摘除时，用轻量方块标识"这里有东西"）=====
  // 共享几何体/材质（全部实例复用，无额外显存），保证"不渲染的位置也有内容感"
  let _farBoxGeo = null, _farBoxMat = null;
  function sharedFarBoxGeo() {
    if (!_farBoxGeo) _farBoxGeo = new THREE.BoxGeometry(5, 6, 5);
    return _farBoxGeo;
  }
  function sharedFarBoxMat() {
    if (!_farBoxMat) _farBoxMat = new THREE.MeshBasicMaterial({ color: 0x0066ff, transparent: true, opacity: 0.7 });
    return _farBoxMat;
  }

  function cullUnmerged(world, playerPos, maxDistSq) {
    if (!world || !world.generatedBuildings || !world.scene) return 0;
    let hidden = 0;
    world.generatedBuildings.forEach((entry) => {
      if (!entry || !entry.model) return;
      const model = entry.model;
      // 占位符不参与视距裁剪：只要有模型的位置就保持显示，维持空间内容感
      // （兼容历史上被摘除过、已带 CULL_MARK 的占位符：加回场景）
      if (entry.isPlaceholder) {
        if (!model.parent) world.scene.add(model);
        return;
      }
      // 已合批源模型已从场景摘除且不带裁剪标记 → 由合批组 im.count 控制，跳过
      if (!model.parent && !model.userData[CULL_MARK]) return;
      const p = model.position;
      if (!p) return;
      const dx = p.x - playerPos.x, dy = p.y - playerPos.y, dz = p.z - playerPos.z;
      if (dx * dx + dy * dy + dz * dz <= maxDistSq) {
        // 玩家靠近：加回场景并清除标记，同时撤下"远距占位 box"
        if (!model.parent) {
          world.scene.add(model);
          delete model.userData[CULL_MARK];
        }
        if (entry.farBox && entry.farBox.parent) world.scene.remove(entry.farBox);
      } else if (model.parent) {      // 过远：从场景摘除，省渲染开销
        world.scene.remove(model);
        model.userData[CULL_MARK] = true;
        // 没渲染的位置也要有"这里有东西"的标识：放置轻量远距占位 box
        if (!entry.farBox) {
          entry.farBox = new THREE.Mesh(sharedFarBoxGeo(), sharedFarBoxMat());
          entry.farBox.position.copy(model.position);
        }
        if (!entry.farBox.parent) world.scene.add(entry.farBox);
        hidden++;
      }
    });
    return hidden;
  }

  // ===== 视距裁剪 =====
  function runCull() {
    if (!enabled) {
      cullRaf = requestAnimationFrame(runCull);
      return;
    }
    const player = (typeof window !== 'undefined' && window.player) || null;
    if (!player || !player.position) {
      cullRaf = requestAnimationFrame(runCull);
      return;
    }
    playerPos.copy(player.position);
    const maxDistSq = MAX_RENDER_DIST * MAX_RENDER_DIST;
    let totalCulled = 0;

    // 未合批对象（加载期占位符/独立模型）视距裁剪
    totalCulled += cullUnmerged(findWorld(), playerPos, maxDistSq);

    mergedGroups.forEach((rec) => {
      const positions = rec.instancePositions;
      const visibleIndices = [];
      for (let i = 0; i < positions.length; i++) {
        const dx = positions[i].x - playerPos.x;
        const dy = positions[i].y - playerPos.y;
        const dz = positions[i].z - playerPos.z;
        if (dx * dx + dy * dy + dz * dz <= maxDistSq) {
          visibleIndices.push(i);
        }
      }
      const count = visibleIndices.length;
      if (count === rec.lastVisibleCount) {
        totalCulled += rec.instanceCount - count;
        return;
      }
      const group = rec.group;
      const worlds = rec.instanceWorlds;
      for (let t = 0; t < group.children.length; t++) {
        const im = group.children[t];
        const tpl = rec.templates[t];
        for (let k = 0; k < count; k++) {
          tmp.multiplyMatrices(worlds[visibleIndices[k]], tpl.relativeMatrix);
          im.setMatrixAt(k, tmp);
        }
        im.count = count;
        im.instanceMatrix.needsUpdate = true;
      }
      rec.lastVisibleCount = count;
      totalCulled += rec.instanceCount - count;
    });
    stats.culledInstances = totalCulled;
    cullRaf = requestAnimationFrame(runCull);
  }

  function startCull() {
    if (cullRaf) cancelAnimationFrame(cullRaf);
    cullRaf = requestAnimationFrame(runCull);
  }

  function stopCull() {
    if (cullRaf) { cancelAnimationFrame(cullRaf); cullRaf = null; }
  }

  function refreshStats() {
    stats.groups = mergedGroups.size;
    let instances = 0;
    let saved = 0;
    mergedGroups.forEach((rec) => {
      instances += rec.instanceCount;
      saved += rec.instanceCount * rec.meshCount - rec.meshCount;
    });
    stats.instances = instances;
    stats.drawCallsSaved = saved;
  }

  // ===== 生命周期 =====
  function startTimer() {
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = setInterval(scanAndMerge, SCAN_INTERVAL);
  }

  function stopTimer() {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  }

  function boot() {
    if (findWorld()) {
      startTimer();
      startCull();
      console.log(`[合批] 实例合批模块已启动：阈值 ${MERGE_THRESHOLD}，扫描间隔 ${SCAN_INTERVAL}ms，视距 ${MAX_RENDER_DIST}m`);
    } else {
      setTimeout(boot, BOOT_RETRY);
    }
  }

  // ===== 对外接口 =====
  window.WorldInstanceMerger = {
    disable: function () {
      enabled = false;
      stopTimer();
      stopCull();
      const world = findWorld();
      if (world) {
        Array.from(mergedGroups.keys()).forEach((url) => unmergeGroup(world, url, true));
        // 恢复所有被视距裁剪摘除的未合批对象
        world.generatedBuildings.forEach((entry) => {
          if (entry && entry.model && entry.model.userData[CULL_MARK] && !entry.model.parent) {
            world.scene.add(entry.model);
            delete entry.model.userData[CULL_MARK];
          }
        });
      }
      console.log('[合批] 已禁用，恢复独立渲染');
    },
    enable: function () {
      enabled = true;
      startTimer();
      startCull();
      console.log('[合批] 已启用');
    },
    rescan: scanAndMerge,
    /** 把指定模型从合批组排除并恢复独立渲染（供编辑模式选中被合批对象时调用） */
    excludeModel: function (model) {
      const world = findWorld();
      if (!world || !world.generatedBuildings) return { ok: false, reason: 'no world' };
      let targetId = null;
      world.generatedBuildings.forEach((entry, id) => { if (entry.model === model) targetId = id; });
      if (targetId === null) return { ok: false, reason: 'id not found' };
      let targetUrl = null;
      mergedGroups.forEach((rec, url) => { if (rec.sourceIds.has(targetId)) targetUrl = url; });
      if (!targetUrl) return { ok: false, reason: 'not in merged group' };
      model.userData.__excludeFromMerge = true;  // 防 2 秒后扫描重新合批
      unmergeGroup(world, targetUrl, true);       // 解散该组，源模型全部加回场景
      scanAndMerge();                             // 立即重建（被排除的模型不再参与）
      console.log(`[合批] 排除模型 id=${targetId}，组 ${targetUrl.slice(-40)} 已重建为独立渲染`);
      return { ok: true, id: targetId };
    },
    getStats: function () {
      return Object.assign({}, stats, { enabled: enabled, threshold: MERGE_THRESHOLD, maxDist: MAX_RENDER_DIST });
    },
    /** 调试：手动触发一次裁剪并返回结果 */
    debugCull: function () {
      const player = (typeof window !== 'undefined' && window.player) || null;
      if (!player || !player.position) return { error: 'no player' };
      playerPos.copy(player.position);
      const maxDistSq = MAX_RENDER_DIST * MAX_RENDER_DIST;
      const results = [];
      mergedGroups.forEach((rec, url) => {
        const positions = rec.instancePositions;
        const visibleIndices = [];
        for (let i = 0; i < positions.length; i++) {
          const dx = positions[i].x - playerPos.x;
          const dy = positions[i].y - playerPos.y;
          const dz = positions[i].z - playerPos.z;
          if (dx * dx + dy * dy + dz * dz <= maxDistSq) visibleIndices.push(i);
        }
        results.push({ url: url.slice(-40), total: positions.length, visible: visibleIndices.length, firstPos: positions[0] ? [Math.round(positions[0].x), Math.round(positions[0].y), Math.round(positions[0].z)] : null });
      });
      let unmergedTotal = 0, unmergedHidden = 0;
      const world = findWorld();
      if (world && world.generatedBuildings) {
        world.generatedBuildings.forEach((entry) => {
          if (!entry || !entry.model) return;
          unmergedTotal++;
          if (entry.model.userData[CULL_MARK]) unmergedHidden++;
        });
      }
      return {
        playerPos: [Math.round(playerPos.x), Math.round(playerPos.y), Math.round(playerPos.z)],
        results,
        unmerged: { total: unmergedTotal, hidden: unmergedHidden }
      };
    }
  };

  boot();
})();
