/**
 * worldLodStandalone.js — 散装（唯一文件/未合批）模型 LOD 分带渲染（模型 LOD 三版方案 · 三期）
 *
 * 问题背景：
 *   LOD 系统一~二期只覆盖合批组（worldInstanceMerger_v2）。统计口径修正后实测散装模型
 *   84 对象共 11.42M 面（教室热点 60m 内 3.66M 面）完全不受分带管理。变体文件已备好
 *   （72/74 有 _mid/_lod 且已剥贴图），本模块补上散装的前端渲染路径。
 *
 * 分带（与合批共用后台「本世界模型设置」同一套 near/mid/far，WorldLodAssets getter 动态读取；
 * 距离→层级映射唯一权威 = WorldLodAssets.resolveBand，后台改距离 60s 内免刷新生效）：
 *   ≤ near           高模
 *   near ~ mid       中模（加载中 → 占位方块顶替，确认缺失 → 高模回退）
 *   mid ~ far        低模（加载中 → 占位方块顶替，确认缺失 → 中模/高模回退；
 *                    低模未就绪时远界封顶 min(far, 200)，与合批组一致）
 *   > far（或 >200m）  占位方块：远界内走 PENDING_MARK；超 200m 交还 cullUnmerged 统一蓝方块
 *
 * 严格分带修复（2026-09-14）：
 *   1. 变体「加载中」时不再以高模顶替——高模型摘出场景挂 __lodPending，
 *      占位方块由合批模块 syncFarBoxes 统一显示（消除"先高后低"额外渲染）；
 *   2. 变体「确认缺失/失败冷却」维持既有回退链（低缺→中、中缺→高）；
 *   3. PlaceholderField.reveal 钩子：模型上屏即按当前距离分带，不等 2s 扫描；
 *   4. releaseRec 不再把高模加回场景——被合批接管的源模型加回会造成
 *      "独立高模 + 实例"双渲染且不受分带管理（异常 2 根因之一）；
 *   5. 合批接管/候选 URL 的【新到货实例】在 reveal 上屏瞬间按距离分带预摘除
 *      （2026-09-14 下午）：消除"新实例以独立高模裸渲染 ≤2s（等合批重建）
 *      再变低模"的闪现——这是低模带观察红军区仍见高模闪的残根。
 *
 * 接管语义（与合批源一致，worldInstanceMerger_v2.cullUnmerged 已核查）：
 *   高模型被摘出场景且【不设 __culledByDist 标记】 → cullUnmerged/syncFarBoxes 视为
 *   "已接管，跳过"；恢复高模时 scene.add 回。>200m 时本模块摘除变体并主动设标记，
 *   交还既有裁剪/蓝方块路径。
 *
 * 决策（用户 2026-09-13 拍板，见规范文档 8.2 节）：
 *   1. 变体借高模材质（节点名 Material.clone 共享 Texture → 切换零 shader 编译冻结）
 *   2. 变体懒加载（首次进带才 HEAD+下载）+ LRU 缓存上限（只驱逐未在显示的），绝不全量预载
 *   3. 跳过 SkinnedMesh 模型（保守，防动画冻结）
 *   4. 编辑模式（buildingManager.isAdminMode）暂停并全部还原高模
 *   5. 失败静默回退高模，绝不阻断世界加载
 *
 * 依赖：window.gameWorld、window.player、window.WorldLodAssets、window.WorldObjectBounds、
 *       window.WorldInstanceMerger（仅 isMergedUrl，可选）
 */
(function () {
  'use strict';

  // ===== 配置 =====
  var MAX_RENDER_DIST = 200;    // 与 worldInstanceMerger_v2 一致的硬裁剪（既有行为，不新增配置）
  var SCAN_INTERVAL = 2000;     // 注册/清理轮询间隔（与合批扫描同节奏）
  var BOOT_RETRY = 500;
  var LRU_CAP_DEFAULT = 24;     // 变体展示对象缓存上限（中+低合计）
  var CULL_MARK = '__culledByDist';
  // 「变体加载中，暂以占位方块顶替」标记（严格分带修复，2026-09-14）：
  // 高模型被摘出场景且带此标记 → 合批模块 cullUnmerged 跳过（绝不加回），
  // syncFarBoxes 统一画占位方块。变体就绪（showVariant）或玩家走近 ≤near
  // （showHigh）时清除并恢复，失败冷却时按既有回退链恢复高/中模。
  var PENDING_MARK = '__lodPending';
  // 变体失败冷却（三期会话3机动，2026-09-13）：此前 variantNone 为永久标记，
  // 瞬时失败（服务器重启窗口/网络抖动）会让该模型永久回退高模直到刷新页面。
  // 改为冷却重试：60s 后允许再次请求（资源侧另有 404/错误分级 TTL 防刷网络）。
  var VARIANT_RETRY_MS = 60 * 1000;

  function findWorld() { return window.gameWorld || null; }
  function lodOn() { return !!(window.WorldLodAssets && window.WorldLodAssets.isEnabled()); }
  function bandNear() {
    var v = window.WorldLodAssets && window.WorldLodAssets.NEAR_DIST;
    return (Number.isFinite(v) && v > 0) ? v : 30;
  }
  function bandMid() {
    var v = window.WorldLodAssets && window.WorldLodAssets.MID_FAR_DIST;
    return (Number.isFinite(v) && v > 0) ? v : 60;
  }
  function editing() {
    var g = findWorld();
    var bm = g && g.buildingManager;
    return !!(bm && (bm.adminMode || bm.isAdminMode));
  }

  // ===== 状态 =====
  var recs = new Map();          // id → rec { id,url,model,entry,state,variants,requested,noneUntil,skipped,lastUse,dist }
  var scanTimer = null;
  var cullRaf = null;
  var enabled = true;
  var lruCap = LRU_CAP_DEFAULT;
  var booted = false;
  var _lastCullPos = null;
  var _frame = 0;
  var _lastRunAt = 0;

  var LEVELS = ['mid', 'low'];

  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  // ===== 变体构建 / 释放 =====
  function disposeMat(mat) {
    if (Array.isArray(mat)) mat.forEach(function (m) { if (m && m.dispose) m.dispose(); });
    else if (mat && mat.dispose) mat.dispose();
  }
  function disposeMatTextures(mat) {
    var SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'specularMap', 'lightMap'];
    var mats = Array.isArray(mat) ? mat : [mat];
    mats.forEach(function (m) {
      if (!m) return;
      SLOTS.forEach(function (k) { if (m[k] && m[k].dispose) m[k].dispose(); });
    });
  }

  /**
   * 构建某一带的展示对象：缓存场景 clone(true)（几何共享），材质按节点名借高模。
   * 变体含 SkinnedMesh / 无网格 → 返回 null（调用方记冷却，60s 后重试）。
   */
  function buildVariant(rec, level, scene) {
    var clone = scene.clone(true);
    var hasMesh = false;
    clone.traverse(function (c) {
      if (c.isMesh) hasMesh = true;
      if (c.isSkinnedMesh) hasMesh = false; // 蒙皮变体一律不用（保守）
    });
    if (!hasMesh) return null;

    // 高模网格 → 材质映射（按节点名；gltfpack -kn 保留名，与合批 attachLodBand 同规则）
    var highByName = new Map();
    rec.model.traverse(function (c) {
      if (c.isMesh && c.name && !highByName.has(c.name)) highByName.set(c.name, c);
    });

    var matsToDispose = [];      // 借高模的克隆材质（dispose 材质本身，贴图归高模）
    var ownTexMats = [];         // 对不上名仍用变体自带的材质（贴图归变体，需一并释放）
    clone.traverse(function (c) {
      if (!c.isMesh) return;
      var own = c.material;
      var src = c.name ? highByName.get(c.name) : null;
      if (src && src.material) {
        c.material = Array.isArray(src.material)
          ? src.material.map(function (m) { return m ? m.clone() : null; })
          : src.material.clone();
        disposeMatTextures(own);   // 变体自带贴图立即释放（零额外显存）
        disposeMat(own);
        matsToDispose.push(c.material);
      } else {
        ownTexMats.push(own);
      }
      c.frustumCulled = true;      // 独立网格，包围球有效，正常视锥剔除
    });

    var group = new THREE.Group();
    group.name = 'LodStandalone:' + level + ':' + rec.id;
    group.add(clone);
    return { group: group, matsToDispose: matsToDispose, ownTexMats: ownTexMats };
  }

  /** 懒加载请求（首次进带才发起；结果缓存于 rec.variants；失败进入冷却，60s 后自动重试） */
  function requestVariant(world, rec, level) {
    var A = window.WorldLodAssets;
    if (!A || !world || !world.gltfLoader || rec.requested[level]) return;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (now < (rec.noneUntil[level] || 0)) return;                   // 冷却期内不重复请求
    rec.requested[level] = true;
    A.loadVariant(world.gltfLoader, rec.url, level).then(function (scene) {
      rec.requested[level] = false;
      if (!scene) { rec.noneUntil[level] = now + VARIANT_RETRY_MS; return; }  // 无变体/失败 → 冷却后重试
      if (recs.get(rec.id) !== rec) return;                          // 条目已失效（卸载/换模型）
      var built = buildVariant(rec, level, scene);
      if (!built) { rec.noneUntil[level] = now + VARIANT_RETRY_MS; return; }  // 蒙皮等结构性拒绝 → 同样冷却重试
      rec.variants[level] = built;
    }).catch(function () {
      rec.requested[level] = false;
      rec.noneUntil[level] = now + VARIANT_RETRY_MS;
    });
  }

  /** 释放某一带展示对象（几何为变体独占可 dispose；借高模的克隆材质只 dispose 材质不 dispose 贴图） */
  function disposeVariant(rec, level, world) {
    var v = rec.variants[level];
    if (!v) return;
    delete rec.variants[level];
    if (world && v.group.parent) world.scene.remove(v.group);
    v.group.traverse(function (c) {
      if (c.isMesh && c.geometry && c.geometry.dispose) c.geometry.dispose();
    });
    v.matsToDispose.forEach(disposeMat);
    v.ownTexMats.forEach(function (m) { disposeMatTextures(m); disposeMat(m); });
  }

  /** LRU：超过上限时驱逐最旧的【未在显示】变体；整组清空时丢 WorldLodAssets 缓存 */
  function evictIfNeeded(world) {
    var held = [];
    recs.forEach(function (r) {
      LEVELS.forEach(function (lv) { if (r.variants[lv]) held.push({ rec: r, level: lv }); });
    });
    if (held.length <= lruCap) return;
    var evictable = held.filter(function (h) { return h.rec.state !== h.level; })
      .sort(function (a, b) { return a.rec.lastUse - b.rec.lastUse; });
    var need = held.length - lruCap;
    for (var i = 0; i < evictable.length && need > 0; i++, need--) {
      var rec = evictable[i].rec;
      disposeVariant(rec, evictable[i].level, world);
      if (!rec.variants.mid && !rec.variants.low) {
        if (window.WorldLodAssets) window.WorldLodAssets.forget(rec.url);
        rec.requested = {};
        rec.noneUntil = {};   // 冷却也一并清零：下次进带立即重新探测
      }
    }
  }

  // ===== 显示切换 =====
  /** 清除本模块与候选预接管的"隐藏待渲染"标记（恢复高模/切显变体时调用） */
  function clearPending(m) {
    if (m && m.userData) {
      delete m.userData[PENDING_MARK];
      delete m.userData.__lodCandidatePending;
    }
  }

  /** 恢复高模（仅当模型是被本模块摘除的——无 CULL_MARK；被 cullUnmerged 裁掉的由它自己加回） */
  function showHigh(rec, world) {
    if (rec.state !== 'high') {
      var v = rec.variants[rec.state];
      if (v && v.group.parent) world.scene.remove(v.group);
      rec.state = 'high';
    }
    var m = rec.model;
    clearPending(m);
    if (m && !m.parent && !(m.userData && m.userData[CULL_MARK])) world.scene.add(m);
  }

  /** 切显变体：高模摘出场景（不设标记），变体按高模本地变换摆入 */
  function showVariant(rec, world, level) {
    var v = rec.variants[level];
    if (!v) return false;
    if (rec.state !== level) {
      if (rec.state !== 'high' && rec.variants[rec.state] && rec.variants[rec.state].group.parent) {
        world.scene.remove(rec.variants[rec.state].group);
      }
      var m = rec.model;
      var g = v.group;
      g.position.copy(m.position);
      g.quaternion.copy(m.quaternion);
      g.scale.copy(m.scale);
      clearPending(m);                           // 高模摘除且变体接管渲染，"隐藏等变体"标记作废
      if (m.parent) world.scene.remove(m);       // 不设 CULL_MARK → cullUnmerged/syncFarBoxes 自动跳过
      if (m.userData) delete m.userData[CULL_MARK];
      world.scene.add(g);
      rec.state = level;
    }
    rec.lastUse = (window.performance && performance.now) ? performance.now() : Date.now();
    return true;
  }

  /** >200m：摘除变体并设裁剪标记，交还既有 cullUnmerged/syncFarBoxes（蓝方块）路径 */
  function passivateFar(rec, world) {
    if (rec.state === 'high') return;
    var v = rec.variants[rec.state];
    if (v && v.group.parent) world.scene.remove(v.group);
    rec.state = 'high';
    var m = rec.model;
    if (m && !m.parent && m.userData) m.userData[CULL_MARK] = true;
  }

  /**
   * 变体加载中：摘除高模 + PENDING_MARK，占位方块由合批模块 syncFarBoxes 统一显示。
   * 修复异常 1/3——严禁在目标带变体就绪前继续以高模渲染（"先高后低"的额外消耗源）。
   */
  function hidePending(rec, world) {
    var m = rec.model;
    if (!m) return;
    if (m.userData) m.userData[PENDING_MARK] = true;
    if (m.parent) world.scene.remove(m);
  }

  /**
   * 超出后台配置远界（仍在 200m 硬裁剪内）：收起当前显示并转占位方块。
   * 严格按后台 far 生效——「超出远界只显示占位方块」（此前散装低模无视 far
   * 一律渲染到 200m，far 配置小于 200 时不生效）。
   */
  function suppressBeyondFar(rec, world) {
    if (rec.state !== 'high') {
      var v = rec.variants[rec.state];
      if (v && v.group.parent) world.scene.remove(v.group);
      rec.state = 'high';
    }
    hidePending(rec, world);
  }

  function restoreAll(world) {
    if (!world) return;
    recs.forEach(function (rec) {
      if (rec.skipped) return;
      // state!=='high'（变体在显）或处于 pending 隐藏 → 恢复高模显示
      var pending = rec.model && rec.model.userData && rec.model.userData[PENDING_MARK];
      if (rec.state !== 'high' || pending) showHigh(rec, world);
    });
  }

  // ===== 注册扫描（2s 轮询，与合批扫描同节奏） =====
  function releaseRec(world, rec, entryGone) {
    LEVELS.forEach(function (lv) { disposeVariant(rec, lv, world); });
    if (window.WorldLodAssets) window.WorldLodAssets.forget(rec.url);
    clearPending(rec.model);
    // 修复（2026-09-14，异常 2「始终固定高模」来源之一）：不再把高模加回场景——
    //   · entryGone：对象已卸载，加回即泄漏渲染；
    //   · 被合批接管/成为合批候选：源模型归合批模块管理，加回会形成
    //     "独立高模 + 实例渲染"叠加，且该独立高模型不受任何分带管理
    //     （永远高模直到 200m 被裁）。
    recs.delete(rec.id);
  }

  /** 注册单个散装模型（scanNow 轮询与「模型上屏即评估」钩子共用） */
  function registerEntry(world, id, entry) {
    var M = window.WorldInstanceMerger;
    if (!entry || !entry.model || entry.isPlaceholder || recs.has(id)) return;
    var m = entry.model;
    var url = m.userData && m.userData.__texOptSource;
    if (!url) return;                                           // 几何建筑/媒体/threejs 代码等
    if (M && M.isMergedUrl && M.isMergedUrl(url)) return;       // 合批组管理
    if (M && M.isCandidateUrl && M.isCandidateUrl(url)) return; // 合批候选（cullUnmerged 预接管）
    if (entry.data && entry.data.custom_config) return;
    if (entry.data && entry.data.model_path && entry.data.model_path !== url) return;
    if (m.userData && m.userData.__excludeFromMerge) return;    // 编辑中模型

    var rec = {
      id: id, url: url, model: m, entry: entry,
      state: 'high', variants: {}, requested: {}, noneUntil: {},
      skipped: null, lastUse: 0, dist: 0
    };
    var skinned = false;
    m.traverse(function (c) { if (c.isSkinnedMesh) skinned = true; });
    if (skinned) rec.skipped = 'skinned';                        // 决策 4：保守跳过
    recs.set(id, rec);
  }

  function scanNow() {
    var world = findWorld();
    if (!world || !world.generatedBuildings || !world.scene) return;
    var M = window.WorldInstanceMerger;

    // 清理：条目消失 / 换模型 / 被合批接管或成为合批候选
    recs.forEach(function (rec, id) {
      var entry = world.generatedBuildings.get(id);
      var gone = !entry || !entry.model || entry.model !== rec.model;
      var takeover = false;
      if (!gone && M) {
        takeover = !!(M.isMergedUrl && M.isMergedUrl(rec.url)) ||
                   !!(M.isCandidateUrl && M.isCandidateUrl(rec.url));
      }
      if (gone || takeover) releaseRec(world, rec, gone);
    });

    // 注册新散装模型
    world.generatedBuildings.forEach(function (entry, id) {
      registerEntry(world, id, entry);
    });

    evictIfNeeded(world);
  }

  // ===== 每帧分带（节流与合批一致：位移 >0.5m 或每 10 帧） =====
  /**
   * 单条目分带更新（runFrame 循环与「模型上屏即评估」钩子共用）。
   * 严格分带语义（2026-09-14）：
   *   · 高模只在 ≤near 带渲染；near~200m 内目标带变体「加载中」→ 摘高模挂
   *     PENDING_MARK（占位方块顶替），「确认缺失/失败冷却」→ 既有回退链
   *     （低模缺失用中模，中模缺失用高模）；
   *   · 变体在显时升级方向（低→中/高）未就绪保持当前较低层级等待（无额外 GPU 消耗）。
   */
  function updateRec(rec, id, world, p, near, mid, now) {
    if (rec.skipped) return;
    var m = rec.model;
    if (!m || rec.entry.model !== m) return;                    // 交给下轮扫描重建

    // 表面距离（与合批/裁剪同口径）
    var d;
    var B = window.WorldObjectBounds;
    if (B) {
      var obj = rec.entry.data;
      if (!obj) obj = rec.entry.__boundsStub || (rec.entry.__boundsStub = { id: id, position_x: 0, position_z: 0 });
      else if (obj.id === undefined) obj.id = id;
      B.ensure(id, m, obj);
      d = Math.sqrt(B.surfaceDistSq(obj, p.x, p.z));
    } else {
      d = Math.sqrt((m.position.x - p.x) * (m.position.x - p.x) + (m.position.z - p.z) * (m.position.z - p.z));
    }
    rec.dist = d;

    var A = window.WorldLodAssets;
    // 远界（与合批组一致）：低模就绪 = 后台配置 far；低模未就绪/缺失 = min(far, 200)
    var farCfg = (A && Number.isFinite(A.FAR_DIST) && A.FAR_DIST > 0) ? A.FAR_DIST : MAX_RENDER_DIST;
    var farLimit = rec.variants.low ? farCfg : Math.min(farCfg, MAX_RENDER_DIST);

    if (rec.state !== 'high') {
      // 变体在显：本模块按后台分带接管
      if (d > MAX_RENDER_DIST) { passivateFar(rec, world); return; }
      if (d > farLimit) { suppressBeyondFar(rec, world); return; }  // 超远界：占位方块
      if (d <= near) { showHigh(rec, world); return; }
      // 距离→层级唯一权威规则（后台可配置）
      var want = (A && A.resolveBand) ? A.resolveBand(d) : (d <= mid ? 'mid' : 'low');
      if (want !== 'mid' && want !== 'low') want = (d <= mid) ? 'mid' : 'low'; // 防御
      if (!rec.variants[want]) {
        requestVariant(world, rec, want);
        // 冷却（确认缺失/失败）→ 既有回退链：低模缺失用中模
        if (now < (rec.noneUntil[want] || 0)) {
          if (want === 'low' && rec.variants.mid) showVariant(rec, world, 'mid');
          return;
        }
        return;                                                 // 加载中：保持当前较低层级等待
      }
      if (rec.state !== want) showVariant(rec, world, want);
      else rec.lastUse = now;
    } else {
      // 高模在显
      if (d > MAX_RENDER_DIST) return;                          // cullUnmerged 管（摘除+蓝方块）
      if (d > farLimit) { hidePending(rec, world); return; }    // 超远界：摘高模 + 占位方块
      if (d <= near) { showHigh(rec, world); return; }          // 就近恢复（可能此前处于 pending 隐藏）
      var want2 = (A && A.resolveBand) ? A.resolveBand(d) : (d <= mid ? 'mid' : 'low');
      if (want2 !== 'mid' && want2 !== 'low') want2 = (d <= mid) ? 'mid' : 'low'; // 防御
      if (!rec.variants[want2]) {
        requestVariant(world, rec, want2);
        // 冷却（确认缺失/失败）→ 维持既有回退：中模就绪先用中模，否则保持高模
        if (now < (rec.noneUntil[want2] || 0)) {
          if (want2 === 'low' && rec.variants.mid) showVariant(rec, world, 'mid');
          else showHigh(rec, world);
          return;
        }
        // 加载中 → 摘除高模 + PENDING_MARK（占位方块顶替），严禁高模顶替
        hidePending(rec, world);
        return;
      }
      showVariant(rec, world, want2);
    }
  }

  function runFrame() {
    cullRaf = requestAnimationFrame(runFrame);
    var world = findWorld();
    var player = window.player;
    if (!enabled || !world || !world.scene || !player || !player.position) { _lastCullPos = null; return; }
    if (!lodOn() || editing()) { restoreAll(world); _lastCullPos = null; return; }

    _frame++;
    var p = player.position;
    var moved = false;
    if (_lastCullPos) {
      var dx = p.x - _lastCullPos.x, dy = p.y - _lastCullPos.y, dz = p.z - _lastCullPos.z;
      moved = (dx * dx + dy * dy + dz * dz) > 0.25;
    }
    if (!moved && (_frame % 10) !== 0) return;
    _lastCullPos = { x: p.x, y: p.y, z: p.z };
    _lastRunAt = nowMs();

    var near = bandNear(), mid = bandMid();
    recs.forEach(function (rec, id) {
      updateRec(rec, id, world, p, near, mid, _lastRunAt);
    });
  }

  // ===== 生命周期 =====
  /**
   * 模型上屏即评估（修复异常 3「先高后低」的首帧闪现，2026-09-14）：
   * 包装 PlaceholderField.reveal 的 onShown 回调——模型一确认可见就立刻注册并按
   * 当前距离分带（必要时立即摘除高模挂 PENDING_MARK / 发起变体请求），
   * 不再等 2s 扫描 + 10 帧节流后才发现"它在低模带"。
   */
  function onModelShown(o) {
    try {
      var world = findWorld();
      if (!world || !world.generatedBuildings || !o || !o.userData) return;
      var wid = o.userData.worldObjectId;
      if (wid === undefined || wid === null) return;
      var entry = world.generatedBuildings.get(wid);
      if (!entry) return;
      registerEntry(world, wid, entry);
      var rec = recs.get(wid);
      if (!rec) {
        // 闪现修复（2026-09-14 下午）：合批接管/合批候选 URL 的【新到货实例】。
        // registerEntry 会跳过这类 URL → 没人摘它 → 通用裁剪 ≤200m 让它以独立
        // 高模渲染，直到下一次 scanAndMerge（最长 2s）把它并入合批组——
        // 这就是"先闪一下高模再变低模"的残根。此处在上屏瞬间（reveal 的
        // showNow 同步回调，下一帧渲染前）按当前距离分带：非高模带立即摘除
        // 挂 __lodCandidatePending（占位方块由 syncFarBoxes 统一显示），
        // ≤near 保持独立渲染（高模本来就是正确层级）。
        var M2 = window.WorldInstanceMerger;
        var url2 = o.userData.__texOptSource;
        if (M2 && url2 && lodOn() && !editing() &&
            !o.userData.__excludeFromMerge &&
            !(entry.data && entry.data.custom_config) &&
            !(entry.data && entry.data.model_path && entry.data.model_path !== url2)) {
          var takeover = (M2.isMergedUrl && M2.isMergedUrl(url2)) ||
                         (M2.isCandidateUrl && M2.isCandidateUrl(url2));
          if (takeover) {
            var player2 = window.player;
            if (player2 && player2.position) {
              var d2 = Infinity;
              var B2 = window.WorldObjectBounds;
              if (B2) {
                var obj2 = entry.data || (entry.__boundsStub || (entry.__boundsStub = { id: wid, position_x: 0, position_z: 0 }));
                if (obj2.id === undefined) obj2.id = wid;
                B2.ensure(wid, o, obj2);
                d2 = Math.sqrt(B2.surfaceDistSq(obj2, player2.position.x, player2.position.z));
              }
              var A2 = window.WorldLodAssets;
              var band2 = (A2 && A2.resolveBand) ? A2.resolveBand(d2) : 'high';
              if (band2 !== 'high') {
                if (o.parent) world.scene.remove(o);
                o.userData.__lodCandidatePending = true;   // cullUnmerged 跳过 + syncFarBoxes 画方块
              }
            }
          }
        }
        return;
      }
      if (rec.skipped) return;
      var player = window.player;
      if (!player || !player.position || !lodOn() || editing()) return;
      updateRec(rec, wid, world, player.position, bandNear(), bandMid(), nowMs());
    } catch (e) { /* 绝不影响模型上屏链路 */ }
  }

  function hookReveal() {
    var pf = window.PlaceholderField;
    if (!pf || !pf.reveal || pf.__lodStandaloneHooked) return;
    pf.__lodStandaloneHooked = true;
    var orig = pf.reveal;
    pf.reveal = function (obj, renderer, camera, scene, onShown) {
      var wrapped = onShown
        ? function (o) { onShown(o); onModelShown(o); }
        : function (o) { onModelShown(o); };
      try {
        return orig.call(this, obj, renderer, camera, scene, wrapped);
      } catch (e) {
        return orig.call(this, obj, renderer, camera, scene, onShown);
      }
    };
  }

  function boot() {
    if (findWorld()) {
      booted = true;
      hookReveal();
      scanNow();
      scanTimer = setInterval(scanNow, SCAN_INTERVAL);
      cullRaf = requestAnimationFrame(runFrame);
      console.log('[散装LOD] 已启动：分带与合批共用，变体懒加载+LRU上限 ' + lruCap);
    } else {
      setTimeout(boot, BOOT_RETRY);
    }
  }

  // ===== 对外接口 =====
  window.WorldLodStandalone = {
    isEnabled: function () { return enabled; },
    setEnabled: function (v) {
      enabled = !!v;
      if (!enabled) restoreAll(findWorld());
      console.log('[散装LOD] 开关:', enabled ? '开启' : '关闭（全部高模）');
      return enabled;
    },
    setLruCap: function (n) {
      lruCap = Math.max(1, Math.floor(Number(n) || LRU_CAP_DEFAULT));
      evictIfNeeded(findWorld());
      return lruCap;
    },
    rescan: scanNow,
    restoreAll: function () { restoreAll(findWorld()); },
    getStats: function () {
      var reg = 0, skipped = 0, heldMid = 0, heldLow = 0, dispMid = 0, dispLow = 0;
      recs.forEach(function (r) {
        reg++;
        if (r.skipped) { skipped++; return; }
        if (r.variants.mid) heldMid++;
        if (r.variants.low) heldLow++;
        if (r.state === 'mid') dispMid++;
        if (r.state === 'low') dispLow++;
      });
      return {
        enabled: enabled, registered: reg, skipped: skipped,
        held: heldMid + heldLow, heldMid: heldMid, heldLow: heldLow,
        displayedMid: dispMid, displayedLow: dispLow,
        lruCap: lruCap,
        lodEnabled: lodOn(), editing: editing(),
        /** 诊断：分带循环活性（每帧全量重算计数 / 最近一次执行时刻） */
        frames: _frame, lastRunAt: Math.round(_lastRunAt)
      };
    },
    /** 调试：逐条目状态（id 可选过滤） */
    debug: function (id) {
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      var rows = [];
      recs.forEach(function (r) {
        if (id !== undefined && String(r.id) !== String(id)) return;
        rows.push({
          id: r.id,
          url: (r.url || '').slice(-36),
          state: r.skipped ? ('skipped:' + r.skipped) : r.state,
          dist: Math.round(r.dist),
          midReady: !!r.variants.mid,
          lowReady: !!r.variants.low,
          /** 冷却中（上次失败，到期自动重试）：剩余秒数，0 = 可立即重试 */
          cooling: {
            mid: Math.max(0, Math.ceil(((r.noneUntil.mid || 0) - now) / 1000)),
            low: Math.max(0, Math.ceil(((r.noneUntil.low || 0) - now) / 1000))
          },
          modelInScene: !!(r.model && r.model.parent),
          /** 模型被本模块摘除、等变体就绪（占位方块顶替中） */
          pending: !!(r.model && r.model.userData && r.model.userData.__lodPending),
          lastUse: r.lastUse ? Math.round(r.lastUse) : 0
        });
      });
      return rows;
    }
  };

  boot();
})();
