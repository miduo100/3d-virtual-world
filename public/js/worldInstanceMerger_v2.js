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
 * 7. LOD 三带（阶段 4；边界 2026-09-12 改为 30/60/400）：同组内按【玩家到模型表面】距离分带写 count ——
 *      ≤30m 高模 | 30~60m 中模（_mid.glb，缺则回退高模）| 60~400m 低模（_lod.glb，缺则蓝方块）
 *    · 变体由 worldLodAssets.js 异步探测+加载（HEAD 命中才下载），接入同组追加 count=0 的
 *      InstancedMesh，绝不阻塞合批；组解散/重建时丢弃并释放
 *    · 开关关闭（GET /api/config/lod-enabled 为 false）或变体缺失 = 完全维持改动前行为
 *    · 中/低模几何为本模块独占 → 解散时必须 dispose（高模几何仍归 texOpt 引用计数管理）
 *
 * 依赖：THREE r128、window.gameWorld（main.js 创建 World 实例后生效）、window.WorldLodAssets（可选）
 */
(function () {
  'use strict';

  // ===== 配置 =====
  const MERGE_THRESHOLD = 6;    // 同 URL 实例数达到该值才合批
  const SCAN_INTERVAL = 2000;   // 快照 diff 轮询间隔(ms)
  const BOOT_RETRY = 500;       // 等待 gameWorld 实例的重试间隔(ms)
  const MAX_RENDER_DIST = 200;  // 视距裁剪半径（米），仅渲染该距离内的实例
  const CULL_MARK = '__culledByDist'; // 未合批对象被视距裁剪摘除场景的标记

  // ===== LOD 三带（模型 LOD 三版方案 · 阶段 4；分带边界 2026-09-12 起后台可调，默认 30/60/400）=====
  //   ≤near 高模 | near~mid 中模（缺变体回退高模）| mid~far 低模（缺变体回退蓝方块）| >far 蓝方块
  //   开关关闭 或 该组无 _mid/_lod 时 = 完全维持改动前行为（≤200m 高模 / >200m 蓝方块）
  //   距离口径与既有裁剪一致：玩家到【模型表面】的距离（锚点距离 − 同源外接半径）
  //   分带值由 worldLodAssets.fetchEnabled() 从 /api/config/lod-enabled 下发（后台「本世界模型设置」），
  //   每帧动态读取 → 后台改距离并保存后玩家端即时生效，无需刷新
  const LOD_DEFAULT_BANDS = { near: 30, mid: 60, far: 400 };
  function bandNear() {
    const v = window.WorldLodAssets && window.WorldLodAssets.NEAR_DIST;
    return (Number.isFinite(v) && v > 0) ? v : LOD_DEFAULT_BANDS.near;
  }
  function bandMid() {
    const v = window.WorldLodAssets && window.WorldLodAssets.MID_FAR_DIST;
    return (Number.isFinite(v) && v > 0) ? v : LOD_DEFAULT_BANDS.mid;
  }
  function bandFar() {
    const v = window.WorldLodAssets && window.WorldLodAssets.FAR_DIST;
    return (Number.isFinite(v) && v > 0) ? v : LOD_DEFAULT_BANDS.far;
  }
  const LOD_TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'specularMap', 'lightMap'];

  // ===== 状态 =====
  const mergedGroups = new Map(); // url → { group, sourceIds:Set, meshCount, instanceCount, templates, instanceWorlds, instancePositions, lastVisibleCount }
  let scanTimer = null;
  let cullRaf = null;
  let enabled = true;
  const skinnedNotified = new Set(); // 已提示过含蒙皮网格的 url（日志去重）

  // ===== 严格分带修复（2026-09-14）=====
  // candidateCounts：最近一次扫描的 url → 实例数。供 cullUnmerged 在正式合批前
  //   （最长 2s 扫描间隔）预接管中远距个体，消除"先高后低"的闪现渲染。
  // mergeFailedUrls：mergeGroup 模板提取失败的 url —— 候选预接管对其豁免，
  //   防止合批永远不成功的模型被永久钉在占位方块上。
  const candidateCounts = new Map();
  const mergeFailedUrls = new Set();

  const stats = {
    groups: 0,          // 当前合批组数
    instances: 0,       // 当前合批实例总数
    drawCallsSaved: 0,  // 相对独立渲染节省的 draw call（估算）
    rebuilds: 0,         // 重建次数
    culledInstances: 0  // 当前被视距裁剪隐藏的实例数
  };

  const tmp = new THREE.Matrix4();
  const tmp2 = new THREE.Matrix4();
  const playerPos = new THREE.Vector3();
  const _dist = new THREE.Vector3(); // 复用距离计算
  const _quat = new THREE.Quaternion();   // 单位四元数（占位方块不做旋转）
  const _posV = new THREE.Vector3();      // compose 用：位置
  const _scaleV = new THREE.Vector3(1, 1, 1); // compose 用：缩放

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
        relativeMatrix: new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld),
        // 二期「变体复用高模贴图」：变体网格按节点名借用高模材质（名称规则与 gltfpack -kn 一致）
        name: child.name || (child.parent && child.parent.name) || ''
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
      // 顺带注册包围盒：合批源模型被摘出场景后不再走 cullUnmerged 的注册路径，
      // 这里补一次，保证同源半径可用于合批组的表面距离判定
      const B = window.WorldObjectBounds;
      if (B) {
        const entry = world.generatedBuildings.get(instances[i].id);
        B.ensure(instances[i].id, instances[i].model, entry ? entry.data : null);
      }
    }

    const group = new THREE.Group();
    group.name = 'InstancedMerged:' + url;
    const count = instances.length;
    const highIms = [];

    for (let t = 0; t < templates.length; t++) {
      const tpl = templates[t];
      const im = new THREE.InstancedMesh(tpl.geometry, tpl.material, count);
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      im.userData.__lodLevel = 'high';
      for (let k = 0; k < count; k++) {
        tmp.multiplyMatrices(instances[k].model.matrixWorld, tpl.relativeMatrix);
        im.setMatrixAt(k, tmp);
      }
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
      highIms.push(im);
    }

    world.scene.add(group);

    for (let i = 0; i < instances.length; i++) {
      const m = instances[i].model;
      if (m.parent) world.scene.remove(m);
      delete m.userData[CULL_MARK]; // 清除视距裁剪标记，防 unmerge 后误跳过
      // 严格分带（2026-09-14）：清除预接管/散装"加载中"标记。
      // 残留会让 syncFarBoxes 给已由实例渲染的源模型重复画占位方块，
      // 或 unmerge 还原后堵塞 cullUnmerged 的加回路径。
      delete m.userData.__lodPending;
      delete m.userData.__lodCandidatePending;
    }

    const instanceWorlds = [];
    const instancePositions = [];
    for (let i = 0; i < instances.length; i++) {
      instanceWorlds.push(instances[i].model.matrixWorld.clone());
      const pos = new THREE.Vector3();
      pos.setFromMatrixPosition(instances[i].model.matrixWorld);
      instancePositions.push(pos);
    }

    const rec = {
      group,
      url,
      sourceIds: new Set(instances.map((i) => i.id)),
      meshCount: templates.length,
      instanceCount: count,
      templates,
      highIms,
      instanceWorlds,
      instancePositions,
      lastVisibleCount: count,
      // ===== LOD 三带状态（阶段 4）=====
      lod: { mid: null, low: null },                       // { templates, ims }
      bandCache: { high: null, mid: null, low: null },     // 上次写入的三带编号列表（变化才重建矩阵）
      pendingIdx: [],                                      // 「变体加载中」暂不渲染的实例编号（syncFarBoxes 画方块）
      farLimit: MAX_RENDER_DIST,                           // 该组远界：低模就绪才升到 LOD_FAR_DIST
      lodRequested: false
    };
    mergedGroups.set(url, rec);
    refreshStats();
    console.log(`[合批] ${url}: ${count} 实例 × ${templates.length} mesh → ${templates.length} 个 InstancedMesh`);
    requestLodVariants(world, rec);
    return true;
  }

  // ===== LOD 变体异步接入（阶段 4）=====
  function disposeMaterialTextures(mat) {
    const mats = Array.isArray(mat) ? mat : [mat];
    mats.forEach((m) => {
      if (!m) return;
      LOD_TEXTURE_SLOTS.forEach((k) => { if (m[k] && m[k].dispose) m[k].dispose(); });
    });
  }

  /** 释放一棵变体场景（组已解散时的兜底，避免下载白费/显存泄漏） */
  function disposeObject3D(root) {
    if (!root || !root.traverse) return;
    root.traverse((child) => {
      if (!child.isMesh) return;
      if (child.geometry && child.geometry.dispose) child.geometry.dispose();
      disposeMaterialTextures(child.material);
      disposeMaterial(child.material);
    });
  }

  /** 异步探测并加载该组的中/低模（失败静默回退高模） */
  function requestLodVariants(world, rec) {
    const A = window.WorldLodAssets;
    if (!A || !A.isEnabled() || !world.gltfLoader) return;
    if (rec.lodRequested) return;
    rec.lodRequested = true;
    ['mid', 'low'].forEach((level) => {
      A.loadVariant(world.gltfLoader, rec.url, level).then((scene) => {
        if (!scene) return;                                        // 不存在/加载失败 → 用高模兜底
        if (mergedGroups.get(rec.url) !== rec) {                    // 组已解散或重建 → 丢弃并释放
          disposeObject3D(scene);
          return;
        }
        attachLodBand(rec, level, scene);
      }).catch(() => { /* 静默回退 */ });
    });
  }

  /** 把变体模板接入同组（追加初值 count=0 的 InstancedMesh） */
  function attachLodBand(rec, level, scene) {
    try {
      const templates = buildMeshTemplates(scene, rec.url);
      if (!templates.length) { disposeObject3D(scene); return; }

      // 二期「变体复用高模贴图」（2026-09-12 实测：变体各自内嵌整套贴图 → 每模型 3 份显存）：
      // 变体网格按节点名借用高模材质（Material.clone 共享 Texture 对象 → 零额外显存），
      // 变体自带材质与贴图立即 dispose。对不上名的网格回退用自带材质（此时变体文件须仍带贴图）。
      const highByName = new Map();
      rec.templates.forEach((t) => { if (t.name && !highByName.has(t.name)) highByName.set(t.name, t); });
      const sameCount = rec.templates.length === templates.length;
      const sharedFlags = templates.map((tpl, i) => {
        const high = highByName.get(tpl.name) || (sameCount ? rec.templates[i] : null);
        if (!high || !high.material) return false;
        const own = tpl.material;
        tpl.material = cloneMaterial(high.material);
        disposeMaterialTextures(own);   // 变体自带贴图不再需要 → 立即释放显存
        disposeMaterial(own);
        return true;
      });

      const ims = [];
      templates.forEach((tpl, i) => {
        const im = new THREE.InstancedMesh(tpl.geometry, tpl.material, rec.instanceCount);
        im.frustumCulled = false;
        im.castShadow = false;
        im.receiveShadow = false;
        im.count = 0;                       // 由 runCull 按距离分带写入
        im.userData.__lodLevel = level;
        im.userData.__sharedMat = sharedFlags[i]; // 解散时共享材质不 dispose 贴图（贴图归高模所有）
        rec.group.add(im);
        ims.push(im);
      });
      rec.lod[level] = { templates, ims };
      rec.bandCache = { high: null, mid: null, low: null };  // 三带归属已变化 → 强制下帧重算
      if (level === 'low') rec.farLimit = bandFar();         // 低模就绪：远界升到后台配置的低模带
      const sharedN = sharedFlags.filter(Boolean).length;
      console.log(`[LOD] ${level} 带接入 ${rec.url.slice(-32)}：${ims.length} 个 InstancedMesh（复用高模材质 ${sharedN}/${ims.length}）`);
    } catch (e) {
      console.warn('[LOD] 接入变体失败（回退高模）:', e.message);
    }
  }

  function listEquals(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
    return true;
  }

  /** 写入某一带的实例矩阵与 count（编号列表未变化则跳过，避免每帧重写） */
  function writeBand(rec, level, indices, templates, ims) {
    if (listEquals(rec.bandCache[level], indices)) return false;
    const worlds = rec.instanceWorlds;
    for (let t = 0; t < ims.length; t++) {
      const im = ims[t];
      const tpl = templates[t];
      for (let k = 0; k < indices.length; k++) {
        tmp.multiplyMatrices(worlds[indices[k]], tpl.relativeMatrix);
        im.setMatrixAt(k, tmp);
      }
      im.count = indices.length;
      im.instanceMatrix.needsUpdate = true;
    }
    rec.bandCache[level] = indices;
    return true;
  }

  // ===== 解散 =====
  /**
   * 解散合批组
   * @param {boolean} [keepLodAssets] true = 保留已加载的中/低模资源（组即将原地重建），
   *   false = 释放并让缓存失效（组真正消失，如走远被卸载）。
   *   加载期每有实例新增都会重建一次组，若每次都释放+重下，20 个 8MB 变体会被反复下载。
   */
  function unmergeGroup(world, url, restoreSources, keepLodAssets) {
    const rec = mergedGroups.get(url);
    if (!rec) return;
    world.scene.remove(rec.group);
    rec.group.children.forEach((im) => {
      const isLod = im.userData && (im.userData.__lodLevel === 'mid' || im.userData.__lodLevel === 'low');
      if (isLod && !keepLodAssets) {
        // 变体几何由本模块加载且独占（不与高模、texOpt 缓存共享）→ 真正解散时释放，防泄漏
        if (im.geometry && im.geometry.dispose) im.geometry.dispose();
        // 贴图归属：复用高模材质（__sharedMat=true）的贴图属于高模/texOpt 缓存，绝不能 dispose；
        // 仅对仍用变体自带材质（对不上名回退）的网格释放贴图
        if (!im.userData.__sharedMat) disposeMaterialTextures(im.material);
      }
      // 高模几何由 texOpt 缓存引用计数管理，绝不能 dispose；材质为克隆，总是可释放
      disposeMaterial(im.material);
    });
    if (!keepLodAssets && window.WorldLodAssets) {
      window.WorldLodAssets.forget(url);   // 丢引用，下次重建时重新加载
    }
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

    // 严格分带（2026-09-14）：刷新候选计数，供 cullUnmerged 在合批发生前预接管
    candidateCounts.clear();
    groups.forEach((instances, url) => candidateCounts.set(url, instances.length));

    groups.forEach((instances, url) => {
      const rec = mergedGroups.get(url);
      if (rec) {
        const curIds = new Set(instances.map((i) => i.id));
        if (idsEqual(rec.sourceIds, curIds)) return;
        unmergeGroup(world, url, true, true);   // 原地重建：保留已加载的中/低模资源
        stats.rebuilds++;
      }
      if (instances.length >= MERGE_THRESHOLD) {
        if (mergeGroup(world, url, instances)) mergeFailedUrls.delete(url);
        else mergeFailedUrls.add(url);          // 模板提取失败：候选预接管豁免，模型保持独立渲染
      }
    });

    const deadUrls = [];
    mergedGroups.forEach((rec, url) => {
      if (!groups.has(url)) deadUrls.push(url);
    });
    deadUrls.forEach((url) => unmergeGroup(world, url, true, false)); // 真正消失：释放并丢缓存
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

  /** 表面距离平方统一口径（候选预接管与通用裁剪共用；无 WorldObjectBounds 时退回锚点距离） */
  function surfaceDistSqOf(world, id, model, entry, playerPos) {
    const B = window.WorldObjectBounds;
    if (!B) {
      const p = model.position;
      if (!p) return Infinity;
      const dx = p.x - playerPos.x, dy = p.y - playerPos.y, dz = p.z - playerPos.z;
      return dx * dx + dy * dy + dz * dz;
    }
    let obj = entry.data;
    if (!obj) {
      // data 缺失（增量/WebSocket 直入队的对象）时挂一个一次性 stub，避免每帧新建
      obj = entry.__boundsStub || (entry.__boundsStub = { id: id, position_x: 0, position_z: 0 });
    } else if (obj.id === undefined) obj.id = id;
    B.ensure(id, model, obj);
    return B.surfaceDistSq(obj, playerPos.x, playerPos.z);
  }

  function cullUnmerged(world, playerPos, maxDistSq) {
    if (!world || !world.generatedBuildings || !world.scene) return 0;
    const B = window.WorldObjectBounds;
    let hidden = 0;
    const lodOn = !!(window.WorldLodAssets && window.WorldLodAssets.isEnabled());
    // <0 = 候选预接管关闭（LOD 关闭时保持原行为）
    const nearSq = lodOn ? (bandNear() * bandNear()) : -1;

    world.generatedBuildings.forEach((entry, id) => {
      if (!entry || !entry.model) return;
      const model = entry.model;
      // 占位符不参与视距裁剪：只要有模型的位置就保持显示，维持空间内容感
      // （兼容历史上被摘除过、已带 CULL_MARK 的占位符：加回场景）
      if (entry.isPlaceholder) {
        if (!model.parent) world.scene.add(model);
        return;
      }
      const ud = model.userData || {};

      // ===== 严格分带修复（2026-09-14）：合批候选预接管 =====
      // ≥阈值的同源模型在正式合批前（最长 2s 扫描间隔）先按 LOD 分带预接管：
      //   > near → 摘除 + __lodCandidatePending（占位方块由 syncFarBoxes 统一显示），
      //            合批后由三带接管（变体未就绪同样方块，绝不以高模顶替）；
      //   ≤ near → 恢复独立渲染（本就要显示高模）。
      // 合并失败（mergeFailedUrls）或实例数跌破阈值 → 自动恢复独立渲染，
      // >200m 的摘除交还下方通用逻辑，不会出现永久方块。
      let dSq = null;
      if (nearSq >= 0 && ud.__texOptSource) {
        const url = ud.__texOptSource;
        const cand = candidateCounts.get(url) >= MERGE_THRESHOLD
          && !mergedGroups.has(url) && !mergeFailedUrls.has(url);
        if (cand) {
          dSq = surfaceDistSqOf(world, id, model, entry, playerPos);
          if (dSq > nearSq) {
            if (model.parent) world.scene.remove(model);
            ud.__lodCandidatePending = true;
            return;
          }
          if (ud.__lodCandidatePending) {
            delete ud.__lodCandidatePending;
            if (!model.parent) {
              if (ud[CULL_MARK]) delete ud[CULL_MARK];
              world.scene.add(model);
            }
          }
        } else if (ud.__lodCandidatePending && !mergedGroups.has(url)) {
          // 不再是候选：恢复独立渲染（>200m 由下方通用逻辑再摘除）。
          // 已合批 URL 不在此恢复（2026-09-14）：新到货实例由散装模块的上屏钩子
          // 预摘除、等 ≤2s 扫描并入合批组；此处若加回会形成"独立高模裸渲染
          // ≤2s 再变低模"的闪现（低模带观察红军区高模闪的残根）。
          delete ud.__lodCandidatePending;
          if (!model.parent && !ud[CULL_MARK]) world.scene.add(model);
        }
      }

      // ===== 修复（2026-09-24）："隐藏待渲染"标记泄漏自愈 =====
      // 现象：红军集群 364 个深蓝占位方块盖在【已渲染】的士兵身上且永不回收（用户实测）。
      // 成因：__lodCandidatePending / __lodPending 唯一的清理点是 mergeGroup（组创建/重建时），
      //   而 worldLodStandalone.onModelShown（模型上屏钩子）会在【合批之后】才回调——
      //   此时该实例 id 早已在 rec.sourceIds 内，scanAndMerge 的 idsEqual 判定"无变化"
      //   → 组永不重建 → 标记永生 → syncFarBoxes 第 1 段每帧为"已由实例渲染"的模型重复画方块。
      // 判据：该 URL 已合批 且 本实例 id 在该组内 = 合批组正在渲染它 → 标记必须清掉。
      // 位置刻意放在 nearSq/LOD 开关判定之外：关掉 LOD 时 syncFarBoxes 同样会画方块。
      if ((ud.__lodCandidatePending || ud.__lodPending) && ud.__texOptSource && mergedGroups.has(ud.__texOptSource)) {
        const recMerged = mergedGroups.get(ud.__texOptSource);
        if (recMerged && recMerged.sourceIds.has(id)) {
          delete ud.__lodCandidatePending;
          delete ud.__lodPending;
        }
      }

      // 已合批源模型已从场景摘除且不带裁剪标记 → 由合批组 im.count 控制，跳过。
      // 散装LOD 的 __lodPending / 候选的 __lodCandidatePending 两类"隐藏等变体"模型
      // 同样在此跳过——绝不能被通用裁剪加回场景，否则"高模顶替"闪现回归。
      if (!model.parent && !ud[CULL_MARK]) return;

      if (dSq === null) dSq = surfaceDistSqOf(world, id, model, entry, playerPos);
      // 刚加载完成的模型给一段宽限：占位符不受裁剪，真模型一替换上来就被裁，
      // 观感是"下载完反而消失"，这里让它至少显示 GRACE_MS。
      // （候选预接管的"消失"由占位方块衔接，不适用宽限——否则高模闪现回归）
      if (B && dSq > maxDistSq && B.isInGrace(entry, model)) dSq = 0;

      if (dSq <= maxDistSq) {
        // 玩家靠近：加回场景并清除标记
        if (!model.parent) {
          world.scene.add(model);
          delete ud[CULL_MARK];
        }
      } else if (model.parent) {      // 过远：从场景摘除，省渲染开销
        world.scene.remove(model);
        ud[CULL_MARK] = true;
        hidden++;
      }
    });
    return hidden;
  }

  // ===== 统一远距占位方块（任何"当前无真实渲染"的位置都显示）=====
  // 增量 entry.farBox 覆盖不到合批组被裁剪实例（红军 416 在 1140 米全被裁），
  // 也无法覆盖以后新增的任何模型。改为每帧全量重建：
  //   把【被裁剪真模型 + 合批组被裁剪实例】的位置写入共享 InstancedMesh，
  //   全量重建自动自愈（unmerge/卸载后残留自动消失），416 实例仅 1 个 draw call。
  let _farBoxIm = null;
  function ensureFarBoxIm() {
    if (!_farBoxIm) {
      _farBoxIm = new THREE.InstancedMesh(sharedFarBoxGeo(), sharedFarBoxMat(), 8192);
      _farBoxIm.frustumCulled = false;
      _farBoxIm.castShadow = false;
      _farBoxIm.receiveShadow = false;
      _farBoxIm.count = 0;
    }
    return _farBoxIm;
  }

  // 收集所有"当前无真实渲染"的位置并写入共享占位方块，返回方块实例数
  function syncFarBoxes(world, playerPos, maxDistSq) {
    const farBox = ensureFarBoxIm();
    const B = window.WorldObjectBounds;
    let farCount = 0;
    // 1) 未合批真模型：被视距裁剪摘除的（不在场景且带 CULL_MARK），
    //    以及"隐藏等变体"的模型（散装 __lodPending / 候选预接管 __lodCandidatePending）
    if (world && world.generatedBuildings) {
      world.generatedBuildings.forEach((entry, id) => {
        if (!entry || !entry.model || entry.isPlaceholder) return; // 占位符自身显示
        const model = entry.model;
        const ud = model.userData || {};
        if (!model.parent && !ud[CULL_MARK] && !ud.__lodPending && !ud.__lodCandidatePending) return;
        if (model.parent) return;                                  // 正在渲染，跳过
        if (farCount < 8192) {
          // 占位方块按模型半径缩放，大模型在远处也保留体积感（上限 20 倍）
          const s = B ? Math.min(Math.max(B.radiusOf(id) / 10, 1), 20) : 1;
          _posV.set(model.position.x, model.position.y, model.position.z);
          _scaleV.set(s, s, s);
          tmp2.compose(_posV, _quat, _scaleV);
          farBox.setMatrixAt(farCount++, tmp2);
        }
      });
    }
    // 2) 合批组被裁剪实例（红军等）：到模型表面距离 > 该组远界 的实例
    //    远界 = 低模就绪且开关开启时的 400m，否则（=改动前行为）200m
    mergedGroups.forEach((rec) => {
      const positions = rec.instancePositions;
      const r = B ? B.radiusByUrl(rec.url) : 0;
      const s = Math.min(Math.max(r / 10, 1), 20);
      const farLimit = rec.farLimit || MAX_RENDER_DIST;
      for (let i = 0; i < positions.length; i++) {
        const dx = positions[i].x - playerPos.x;
        const dy = positions[i].y - playerPos.y;
        const dz = positions[i].z - playerPos.z;
        const surface = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
        if (surface > farLimit && farCount < 8192) {
          _posV.set(positions[i].x, positions[i].y, positions[i].z);
          _scaleV.set(s, s, s);
          tmp2.compose(_posV, _quat, _scaleV);
          farBox.setMatrixAt(farCount++, tmp2);
        }
      }
    });
    // 2b) 合批组「变体加载中」实例（严格分带，2026-09-14）：目标带变体未就绪
    //     暂不渲染 → 占位方块顶替（取代原先"以高模顶替"的过渡渲染）
    mergedGroups.forEach((rec) => {
      const pend = rec.pendingIdx;
      if (!pend || !pend.length) return;
      const r = B ? B.radiusByUrl(rec.url) : 0;
      const s = Math.min(Math.max(r / 10, 1), 20);
      for (let k = 0; k < pend.length && farCount < 8192; k++) {
        const pos = rec.instancePositions[pend[k]];
        if (!pos) continue;
        _posV.set(pos.x, pos.y, pos.z);
        _scaleV.set(s, s, s);
        tmp2.compose(_posV, _quat, _scaleV);
        farBox.setMatrixAt(farCount++, tmp2);
      }
    });
    farBox.count = farCount;
    farBox.instanceMatrix.needsUpdate = true;
    if (farCount > 0) {
      if (world && world.scene && !farBox.parent) world.scene.add(farBox);
    } else if (farBox.parent) {
      world.scene.remove(farBox);
    }
    return farCount;
  }

  // ===== 视距裁剪 =====
  // 【性能节流】玩家未明显移动时降频：rAF 循环保留（60Hz 计数），但全量重算
  // 只在「移动 >0.5m」或「每 10 帧周期刷新」时执行（周期刷新兜底处理
  // 实例增删/重建等无位移变化，10 帧 ≈ 167ms，远低于视觉感知阈值）
  let _cullRafCount = 0;
  let _lastCullPos = null; // {x,y,z} 上次实际执行重算时的玩家位置
  const CULL_REFRESH_EVERY = 10;   // 无位移时的周期重算间隔（帧）
  const CULL_MOVE_DIST_SQ = 0.25;  // 位移门控阈值（0.5m 的平方）

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
    _cullRafCount++;
    if (_lastCullPos) {
      const dx = player.position.x - _lastCullPos.x;
      const dy = player.position.y - _lastCullPos.y;
      const dz = player.position.z - _lastCullPos.z;
      const moved = (dx * dx + dy * dy + dz * dz) > CULL_MOVE_DIST_SQ;
      if (!moved && (_cullRafCount % CULL_REFRESH_EVERY) !== 0) {
        cullRaf = requestAnimationFrame(runCull);
        return;
      }
    }
    _lastCullPos = { x: player.position.x, y: player.position.y, z: player.position.z };
    playerPos.copy(player.position);
    const maxDistSq = MAX_RENDER_DIST * MAX_RENDER_DIST;
    let totalCulled = 0;

    const world = findWorld();

    // 未合批对象（加载期占位符/独立模型）视距裁剪
    totalCulled += cullUnmerged(world, playerPos, maxDistSq);

    const B = window.WorldObjectBounds;
    const A = window.WorldLodAssets;
    const lodOn = !!(A && A.isEnabled());

    // 合批组分带（先算带，syncFarBoxes 才能拿到最新的 farLimit 与 pendingIdx）
    mergedGroups.forEach((rec) => {
      const positions = rec.instancePositions;
      // 同源实例尺寸一致，用该模型的外接半径把判定从"锚点"改为"模型表面"
      const r = B ? B.radiusByUrl(rec.url) : 0;
      const midReady = !!(rec.lod.mid && rec.lod.mid.ims && rec.lod.mid.ims.length);
      const lowReady = !!(rec.lod.low && rec.lod.low.ims && rec.lod.low.ims.length);
      // 远界：低模就绪 = 后台配置的低模带距离；低模缺失 = 封顶在 min(配置距离, 200m)，
      // 缺失部分的几何由高模兜底渲染（若不封顶，配置拉大时缺低模的组会用高模渲染到很远，
      // 2026-09-12 实测：7 组缺低模导致 232 实例高模渲染、GPU 不降）
      rec.farLimit = !lodOn ? MAX_RENDER_DIST
        : (lowReady ? bandFar() : Math.min(bandFar(), MAX_RENDER_DIST));
      const farLimit = rec.farLimit;

      // 严格分带（2026-09-14）：目标带变体「加载中」（idle/loading，未确认缺失）→
      // 该带实例暂不渲染（占位方块），绝不以高模顶替；
      // 「确认缺失」（state='none'）→ 维持既有失败回退（高模兜底）。
      const midLoading = lodOn && !midReady && A.stateOf(rec.url, 'mid') !== 'none';
      const lowLoading = lodOn && !lowReady && A.stateOf(rec.url, 'low') !== 'none';

      const highIdx = [];
      const midIdx = [];
      const lowIdx = [];
      const pendingIdx = [];
      for (let i = 0; i < positions.length; i++) {
        const dx = positions[i].x - playerPos.x;
        const dy = positions[i].y - playerPos.y;
        const dz = positions[i].z - playerPos.z;
        const surface = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
        // 距离→层级规则（后台 lod_near/mid/far_dist 可配置）唯一权威：WorldLodAssets.resolveBand
        const band = lodOn ? A.resolveBand(surface)
                           : (surface <= MAX_RENDER_DIST ? 'high' : 'none');
        if (band === 'none') continue;                          // 远界外：不渲染（蓝方块表示"这里有东西"）
        if (band === 'low' && surface > farLimit) continue;     // 低模缺失组远界封顶 min(far,200)（二期 D）
        if (band === 'high') { highIdx.push(i); continue; }     // ≤near（或未启用 LOD 时的 ≤200m）
        if (band === 'mid') {
          if (midReady) { midIdx.push(i); continue; }
          if (lowReady) { lowIdx.push(i); continue; }           // 中模缺失 → 低模兜底（既有行为）
          if (midLoading) { pendingIdx.push(i); continue; }     // 中模加载中 → 暂不渲染（方块顶替）
          highIdx.push(i); continue;                            // 中模确认缺失 → 高模回退（既有）
        }
        // band === 'low'
        if (lowReady) { lowIdx.push(i); continue; }
        if (lowLoading) { pendingIdx.push(i); continue; }       // 低模加载中 → 暂不渲染（方块顶替）
        highIdx.push(i);                                        // 低模确认缺失 → 高模兜底（既有）
      }
      rec.pendingIdx = pendingIdx;

      writeBand(rec, 'high', highIdx, rec.templates, rec.highIms);
      if (midReady) writeBand(rec, 'mid', midIdx, rec.lod.mid.templates, rec.lod.mid.ims);
      if (lowReady) writeBand(rec, 'low', lowIdx, rec.lod.low.templates, rec.lod.low.ims);

      const visible = highIdx.length + (midReady ? midIdx.length : 0) + (lowReady ? lowIdx.length : 0);
      rec.lastVisibleCount = visible;
      totalCulled += rec.instanceCount - visible;
    });

    // 统一远距占位方块：任何"当前无真实渲染"的位置都显示，含合批组被裁剪实例
    // 与「变体加载中」暂不渲染的实例（须在分带计算之后，pendingIdx 才是最新值）
    syncFarBoxes(world, playerPos, maxDistSq);

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
        // 保留 LOD 资源：编辑模式往返（unbatch/rebatch）频繁，释放会导致反复重新下载
        Array.from(mergedGroups.keys()).forEach((url) => unmergeGroup(world, url, true, true));
        // 恢复所有被视距裁剪摘除的未合批对象
        world.generatedBuildings.forEach((entry) => {
          if (entry && entry.model && !entry.model.parent) {
            const ud = entry.model.userData || {};
            // 含"隐藏等变体/等合批"标记的模型（__lodPending / __lodCandidatePending）：
            // 禁用合批后无人再接管它们，必须一并还原，否则永久消失只剩方块
            if (ud[CULL_MARK] || ud.__lodCandidatePending || ud.__lodPending) {
              delete ud[CULL_MARK];
              delete ud.__lodCandidatePending;
              delete ud.__lodPending;
              world.scene.add(entry.model);
            }
          }
        });
      }
      console.log('[合批] 已禁用，恢复独立渲染');
    },
    enable: function () {
      enabled = true;
      startTimer();
      startCull();
      const world = findWorld();
      if (world) mergedGroups.forEach((rec) => requestLodVariants(world, rec)); // 重新启用时补齐变体
      console.log('[合批] 已启用');
    },
    /** LOD 三带开关（透传 WorldLodAssets；测试/调试用，正式开关在管理后台） */
    setLodEnabled: function (v) {
      const A = window.WorldLodAssets;
      if (!A) return null;
      const old = A.setEnabled(v);
      const world = findWorld();
      if (v && world) mergedGroups.forEach((rec) => requestLodVariants(world, rec));
      return old;
    },
    /** 调试：查看各组三带状态 */
    debugLod: function () {
      const out = [];
      mergedGroups.forEach((rec, url) => {
        const counts = {};
        rec.group.children.forEach((im) => {
          const lv = (im.userData && im.userData.__lodLevel) || 'unknown';
          counts[lv] = (counts[lv] || 0) + (im.count || 0);
        });
        out.push({
          url: url.slice(-40),
          instances: rec.instanceCount,
          farLimit: rec.farLimit,
          counts,
          pending: rec.pendingIdx ? rec.pendingIdx.length : 0,
          midTemplates: rec.lod.mid ? rec.lod.mid.ims.length : 0,
          lowTemplates: rec.lod.low ? rec.lod.low.ims.length : 0,
        });
      });
      return { lodEnabled: !!(window.WorldLodAssets && window.WorldLodAssets.isEnabled()), groups: out };
    },
    rescan: scanAndMerge,
    /** 三期（散装 LOD）：某 URL 是否已被合批接管（散装模块据此跳过，避免双渲染竞争） */
    isMergedUrl: function (url) { return mergedGroups.has(url); },
    /**
     * 某 URL 的【指定实例】是否已被合批组接管（id 已在 rec.sourceIds 内 = 合批组正在渲染它）。
     * 修复（2026-09-24）：worldLodStandalone.onModelShown 据此避免给"已由实例渲染"的模型
     * 挂 __lodCandidatePending —— 那个标记在合批之后挂上就永远没人清理，会让 syncFarBoxes
     * 重复画深蓝占位方块（红军区实测 364 个方块盖在士兵身上）。
     */
    isMergedInstance: function (url, id) {
      const rec = mergedGroups.get(url);
      return !!(rec && rec.sourceIds.has(id));
    },
    /** 严格分带（2026-09-14）：某 URL 是否为合批候选（实例数达阈值，正被 cullUnmerged 预接管） */
    isCandidateUrl: function (url) { return candidateCounts.get(url) >= MERGE_THRESHOLD; },
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
      unmergeGroup(world, targetUrl, true, true); // 解散该组（随后立即重建，保留 LOD 资源），源模型全部加回场景
      scanAndMerge();                             // 立即重建（被排除的模型不再参与）
      console.log(`[合批] 排除模型 id=${targetId}，组 ${targetUrl.slice(-40)} 已重建为独立渲染`);
      return { ok: true, id: targetId };
    },
    getStats: function () {
      let midGroups = 0;
      let lowGroups = 0;
      mergedGroups.forEach((rec) => {
        if (rec.lod.mid) midGroups++;
        if (rec.lod.low) lowGroups++;
      });
      return Object.assign({}, stats, {
        enabled: enabled,
        threshold: MERGE_THRESHOLD,
        maxDist: MAX_RENDER_DIST,
        lodEnabled: !!(window.WorldLodAssets && window.WorldLodAssets.isEnabled()),
        lodNearDist: bandNear(),
        lodFarDist: bandFar(),
        groupsWithMid: midGroups,
        groupsWithLow: lowGroups
      });
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
