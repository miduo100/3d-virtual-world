/**
 * playerModelScheduler.js v1 — 玩家模型/动画调度（首屏加载丝滑化 Step 3.3）
 * ------------------------------------------------------------------
 * 做法照 worldTextureOptimizer 既有模式：包装原型，world.js 文件内容零改动。
 *
 * 包装 2 个入口（§6）：
 *   - World.prototype._loadPlayerGlb   （main.js 首载/REST补载、websocket.js 三路径、
 *                                       world.js addPlayer 尾部——全部经原型，全覆盖）
 *   - World.prototype._loadPlayerAnimGlb（main.js scheduleLoadAnims、websocket.js
 *                                       _loadRemotePlayerAnims）
 * 另加 §0.1-B「让路包装」：World.prototype.processLoadingQueue——玩家模型档在途时
 * 本轮不启动 >15MB 场景对象（只包装，不改 world.js）。
 *
 * 分档放行：
 *   P2 自己  ：gate onReady 后立即放行（闸门自带 12s timeout 兜底；本模块再加 13s
 *              双保险，WorldReadyGate 缺失时直接放行=旧行为）。
 *   P3 远端  ：onReady 后做"视野内"过滤：距离 ≤60m 且（视锥内 或 ≤25m）；
 *              每 2s 重评（BgThrottle）；按距离升序；并发 1。
 *   动画     ：挂在对应玩家上，其模型就绪后立即放行（杜绝 500ms×20 空转重试）；
 *              放行前把动画 URL 注册进 GltfTemplateCache（走 Worker 解析，二期B）。
 *
 * 5 条硬性要求（§6）逐条落实：
 *   1. 放行前绝不写 characterGroup.userData._loadingGlbUrl（world.js 用它做幂等，
 *      提前写会让真加载被判"重复加载中"而跳过）——本模块只读该字段做透传判定。
 *   2. 按 (characterId + 归一化 url) 去重；URL 变化替换任务（旧任务在途则标记 stale，
 *      完成后模型落在旧组上——若玩家已离场，组已脱离场景=不上屏）。
 *   3. 离队/离开视野：排队中直接出队；已发起标记 stale。
 *      （物理限制：GLTFLoader.load 无法 abort 网络，字节仍进 HTTP 缓存，下次秒回。）
 *   4. 兜底：onReady 12s 未触发按 timeout 强制放行自己（闸门+本模块双保险）。
 *   5. _diag() 暴露 { ready, selfState, remoteQueued[], remoteActive, canceled, blocks }。
 */
(function () {
  'use strict';

  var EVAL_MS = 2000;               // 远端重评间隔（BgThrottle）
  var THROTTLE_KEY = 'pms.eval';
  var REMOTE_MAX_DIST = 60;         // 距离上限（视野内判定）
  var REMOTE_CLOSE_DIST = 25;       // 近距离豁免（不需视锥）
  var LARGE_BYTES = 15 * 1024 * 1024; // 与 world.js LARGE_MODEL_THRESHOLD 同口径
  var SELF_FALLBACK_MS = 13000;     // 闸门缺失/异常时的自救放行
  var LOAD_DONE_FALLBACK_MS = 90000; // 判定"加载已完成"的兜底时长

  var WorldProto = window.World && window.World.prototype;
  if (!WorldProto || typeof WorldProto._loadPlayerGlb !== 'function') {
    console.warn('[PlayerModelScheduler] World._loadPlayerGlb 不存在，模块未启用');
    return;
  }
  if (WorldProto.__pmsInstalled) return; // 防重复安装
  WorldProto.__pmsInstalled = true;

  var origLoadPlayerGlb = WorldProto._loadPlayerGlb;
  var origLoadPlayerAnimGlb = WorldProto._loadPlayerAnimGlb;
  var origProcessLoadingQueue = WorldProto.processLoadingQueue;

  // ---------------- 状态 ----------------
  var gateReady = false;
  var selfTask = null;              // { cid, group, nameSprite, rawUrl, url, state:'held'|'active'|'done', releasedAt, world }
  var remoteQueue = [];             // 同上结构的数组
  var remoteActive = null;
  /** cid -> { type: { cid, type, animUrl } } 模型未就绪被扣住的动画 */
  var animHeld = new Map();
  var canceled = 0;
  var blocks = 0;

  var _frustum = null;
  var _projScreen = null;

  // ---------------- 工具 ----------------
  function log(msg) { console.log('[PMS] ' + msg); }

  /** 复刻 world.js 的最终 URL 解析（apiBase 拼接 + 协议表头修正） */
  function finalUrl(rawUrl) {
    try {
      var apiBase = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE) || (window.location.origin + '/api');
      var url = rawUrl.startsWith('http') ? rawUrl : (apiBase.replace('/api', '') + rawUrl);
      if (window.fixAssetProtocol) url = window.fixAssetProtocol(url);
      return url;
    } catch (e) { return rawUrl; }
  }

  function isSelfId(characterId) {
    return (typeof GAME_STATE !== 'undefined' && characterId === GAME_STATE.characterId);
  }

  function validGlbUrl(glbUrl) {
    return !!(glbUrl && typeof glbUrl === 'string' && glbUrl.trim() !== '' && glbUrl !== 'null');
  }

  /** 模型是否已完成加载（成功=glbModel 就位；失败=锁残留靠时长兜底） */
  function isModelDone(task) {
    if (!task || !task.group) return true;
    var ud = task.group.userData || {};
    if (ud.glbModel) return true;
    if (ud._loadingGlbUrl !== task.url) return true; // 锁已清（完成路径会清，失败不清）
    return (Date.now() - task.releasedAt) > LOAD_DONE_FALLBACK_MS;
  }

  function playerExists(world, cid) {
    return !!(world && world.players && world.players.has(cid));
  }

  // ---------------- 释放（注册缓存 + 调原函数） ----------------
  function releaseTask(task) {
    task.state = 'active';
    task.releasedAt = Date.now();
    if (window.GltfTemplateCache) window.GltfTemplateCache.register(task.url);
    log('放行玩家模型: cid=' + task.cid + ' self=' + (task === selfTask) + ' url=' + task.url);
    origLoadPlayerGlb.call(task.world, task.cid, task.group, task.nameSprite, task.rawUrl);
  }

  // ---------------- 视野过滤 ----------------
  function computeVisibility(group) {
    var gw = window.gameWorld;
    if (!gw || !gw.camera || !group) return { vis: false, dist: Infinity };
    var cam = gw.camera;
    var camPos = cam.position;
    var p = group.position; // characterGroup 直挂 scene，position 即世界坐标
    var dx = p.x - camPos.x, dy = p.y - camPos.y, dz = p.z - camPos.z;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > REMOTE_MAX_DIST) return { vis: false, dist: dist };
    if (dist <= REMOTE_CLOSE_DIST) return { vis: true, dist: dist };
    if (!_frustum) {
      _frustum = new THREE.Frustum();
      _projScreen = new THREE.Matrix4();
    }
    _projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen);
    return { vis: _frustum.containsPoint(p), dist: dist };
  }

  // ---------------- 周期评估（2s） ----------------
  function evalTick() {
    var gw = window.gameWorld;
    if (!gw) return;

    // 1) 自己：active → done 归档
    if (selfTask && selfTask.state === 'active' && isModelDone(selfTask)) {
      selfTask.state = 'done';
    }

    // 2) 远端：清理离队任务；active 完成或离队则释放槽位
    var before = remoteQueue.length;
    remoteQueue = remoteQueue.filter(function (t) {
      if (!playerExists(gw, t.cid)) { canceled++; return false; }
      return true;
    });
    if (before !== remoteQueue.length) {
      log('离队出队 ' + (before - remoteQueue.length) + ' 个远端任务');
    }
    if (remoteActive && (!playerExists(gw, remoteActive.cid) || isModelDone(remoteActive))) {
      if (!playerExists(gw, remoteActive.cid)) {
        remoteActive.stale = true; // 已发起：标记 stale，完成时不上屏（组已脱离场景）
        canceled++;
        log('远端在途任务玩家已离场，标记 stale: cid=' + remoteActive.cid);
      }
      remoteActive = null;
    }

    // 3) 扣住的动画：模型就绪立即放行（含 flushAnims 兜底路径）
    flushReadyAnims(gw);

    // 4) 远端出槽：视野过滤 + 距离升序 + 并发 1
    if (!remoteActive && remoteQueue.length > 0 && gateReady) {
      var candidates = [];
      for (var i = 0; i < remoteQueue.length; i++) {
        var t = remoteQueue[i];
        var pd = gw.players.get(t.cid);
        if (!pd) continue;
        var v = computeVisibility(pd.group);
        if (v.vis) candidates.push({ t: t, dist: v.dist });
      }
      if (candidates.length > 0) {
        candidates.sort(function (a, b) { return a.dist - b.dist; });
        var pick = candidates[0].t;
        remoteQueue = remoteQueue.filter(function (x) { return x !== pick; });
        remoteActive = pick;
        releaseTask(pick);
      }
    }
  }

  /** 模型已就绪的玩家：立即放行其全部被扣动画（"立即"，不空转） */
  function flushReadyAnims(gw) {
    if (animHeld.size === 0) return;
    var readyCids = [];
    animHeld.forEach(function (byType, cid) {
      var pd = gw.players.get(cid);
      if (!pd) { animHeld.delete(cid); canceled++; return; } // 离队：丢弃
      if (pd.group.userData.glbModel) readyCids.push(cid);
    });
    for (var i = 0; i < readyCids.length; i++) {
      releaseAnims(readyCids[i]);
    }
  }

  function releaseAnims(cid) {
    var byType = animHeld.get(cid);
    if (!byType) return;
    animHeld.delete(cid);
    var gw = window.gameWorld;
    var types = Object.keys(byType);
    for (var i = 0; i < types.length; i++) {
      var a = byType[types[i]];
      if (!validGlbUrl(a.animUrl)) continue;
      if (!playerExists(gw, cid)) continue;
      if (window.GltfTemplateCache) window.GltfTemplateCache.register(finalUrl(a.animUrl));
      log('放行动画: cid=' + cid + ' type=' + a.type);
      origLoadPlayerAnimGlb.call(gw, cid, a.type, a.animUrl, 0);
    }
  }

  // ---------------- 包装 1：_loadPlayerGlb ----------------
  WorldProto._loadPlayerGlb = function (characterId, characterGroup, nameSprite, glbUrl) {
    // 模块依赖缺失 → 完全回退旧行为
    if (!window.GltfTemplateCache || !window.WorldReadyGate) {
      return origLoadPlayerGlb.apply(this, arguments);
    }
    if (!validGlbUrl(glbUrl)) {
      return origLoadPlayerGlb.apply(this, arguments); // 无效 URL：交给原函数打日志
    }

    var url = finalUrl(glbUrl);

    // 幂等锁已指向同一 URL（正在加载中）→ 透传给原函数走其早退分支（保留日志语义）
    if (characterGroup.userData._loadingGlbUrl === url) {
      return origLoadPlayerGlb.apply(this, arguments);
    }

    var self = isSelfId(characterId);

    if (self) {
      // 去重：同 cid 重复调用只保留一个任务；URL 变化替换（旧在途的标记 stale）
      if (selfTask && selfTask.cid === characterId && selfTask.url !== url && selfTask.state === 'active') {
        selfTask.stale = true;
        log('自己模型 URL 变化，旧任务标记 stale: ' + selfTask.url + ' → ' + url);
      }
      selfTask = {
        cid: characterId, group: characterGroup, nameSprite: nameSprite,
        rawUrl: glbUrl, url: url, state: 'held', world: this, releasedAt: 0, stale: false
      };
      if (window.WorldReadyGate.isReady()) {
        releaseTask(selfTask);
      } else {
        window.WorldReadyGate.onReady(function () {
          gateReady = true;
          if (selfTask && selfTask.state === 'held' && playerExists(selfTask.world, selfTask.cid)) {
            releaseTask(selfTask);
          }
        });
        setTimeout(function () { // 双保险（规则 4）：闸门异常时 13s 强制放行自己
          if (selfTask && selfTask.state === 'held') {
            gateReady = true;
            log('闸门兜底超时（SELF_FALLBACK），强制放行自己');
            releaseTask(selfTask);
          }
        }, SELF_FALLBACK_MS);
      }
      return;
    }

    // ---- 远端玩家：入队等待视野过滤（含去重/URL 变化替换） ----
    var oldIdx = -1;
    for (var i = 0; i < remoteQueue.length; i++) {
      if (remoteQueue[i].cid === characterId) { oldIdx = i; break; }
    }
    var task = {
      cid: characterId, group: characterGroup, nameSprite: nameSprite,
      rawUrl: glbUrl, url: url, state: 'held', world: this, releasedAt: 0, stale: false
    };
    if (oldIdx >= 0) {
      if (remoteQueue[oldIdx].url === url) return; // 同 URL 重复入队：幂等丢弃
      remoteQueue[oldIdx] = task;                   // URL 变化：替换重排
      log('远端任务 URL 变化重排: cid=' + characterId);
    } else if (remoteActive && remoteActive.cid === characterId) {
      remoteActive.stale = true; // 在途旧 URL：标记 stale，等新任务走完队列
      remoteQueue.push(task);
      log('远端在途任务 URL 变化，旧标记 stale: cid=' + characterId);
    } else {
      remoteQueue.push(task);
    }
    log('远端模型入队: cid=' + characterId + ' queue=' + remoteQueue.length);
  };

  // ---------------- 包装 2：_loadPlayerAnimGlb ----------------
  WorldProto._loadPlayerAnimGlb = function (characterId, type, animUrl, _retryCount) {
    if (!window.GltfTemplateCache || !window.WorldReadyGate) {
      return origLoadPlayerAnimGlb.apply(this, arguments);
    }
    var pd = this.players.get(characterId);
    if (!pd) return origLoadPlayerAnimGlb.apply(this, arguments);

    if (pd.group.userData.glbModel) {
      // 模型已就绪 → 立即放行；动画 URL 注册进模板缓存（走 Worker 解析，
      // 8 个动画 × 主线程解析实测 ~1.9s 长任务整体移出主线程）。动画文件
      // 的"克隆语义"与模型一致：每玩家独立 clip（compensator 就地改 track.values）。
      if (validGlbUrl(animUrl) && window.GltfTemplateCache) {
        window.GltfTemplateCache.register(finalUrl(animUrl));
      }
      return origLoadPlayerAnimGlb.apply(this, arguments);
    }

    // 模型未就绪 → 扣住（等 modelLoaded 事件/评估循环放行；杜绝 500ms×20 空转）
    if (!validGlbUrl(animUrl)) return;
    var byType = animHeld.get(characterId);
    if (!byType) { byType = {}; animHeld.set(characterId, byType); }
    if (byType[type] && byType[type].animUrl === animUrl) return; // 幂等
    byType[type] = { cid: characterId, type: type, animUrl: animUrl };
  };

  // ---------------- 包装 3：processLoadingQueue 让路（§0.1-B） ----------------
  WorldProto.processLoadingQueue = function (currentTime) {
    if (hasActiveLoad()) {
      var head = this.loadingQueue && this.loadingQueue[0];
      if (head) {
        var sz = (head.fileSize || head.file_size) || 0;
        if (sz > LARGE_BYTES) {
          blocks++;
          return; // 本轮不启动 >15MB 场景对象，把带宽让给玩家模型档
        }
      }
    }
    return origProcessLoadingQueue.call(this, currentTime);
  };

  // ---------------- modelLoaded 事件：动画立即放行 ----------------
  window.addEventListener('modelLoaded', function (ev) {
    var cid = ev && ev.detail && ev.detail.characterId;
    if (cid == null) return;
    if (selfTask && selfTask.cid === cid) { selfTask.state = 'done'; }
    if (remoteActive && remoteActive.cid === cid) { remoteActive = null; }
    var gw = window.gameWorld;
    if (gw && gw.players.has(cid)) releaseAnims(cid);
  });

  // ---------------- 状态查询 ----------------
  function hasActiveLoad() {
    return !!(selfTask && selfTask.state === 'active') || !!remoteActive;
  }

  // ---------------- 启动评估循环 ----------------
  if (window.BgThrottle) window.BgThrottle.every(THROTTLE_KEY, EVAL_MS, evalTick);
  else setInterval(evalTick, EVAL_MS);

  if (window.WorldReadyGate) {
    window.WorldReadyGate.onReady(function () { gateReady = true; });
  }

  // ---------------- 对外 API ----------------
  window.PlayerModelScheduler = {
    hasActiveLoad: hasActiveLoad,
    /** 测试/诊断用：立即触发一次评估 */
    evalNow: evalTick,
    _diag: function () {
      return {
        ready: gateReady,
        selfState: selfTask ? { cid: selfTask.cid, state: selfTask.state, url: selfTask.url, stale: !!selfTask.stale } : null,
        remoteQueued: remoteQueue.map(function (t) {
          return { cid: t.cid, url: t.url };
        }),
        remoteActive: remoteActive ? { cid: remoteActive.cid, url: remoteActive.url, stale: !!remoteActive.stale } : null,
        animHeld: (function () {
          var out = [];
          animHeld.forEach(function (byType, cid) {
            out.push({ cid: cid, types: Object.keys(byType) });
          });
          return out;
        })(),
        canceled: canceled,
        blocks: blocks
      };
    }
  };

  console.log('[PlayerModelScheduler] ✅ 已启用（自己=就绪即放行 / 远端=视野过滤·并发1 / 动画=模型就绪即放行 / >15MB 让路）');
})();
