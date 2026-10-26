/**
 * 空闲期多角度预绘制扫掠器（PreloadSweeper）—— 2026-09-08 转向卡顿治理
 *
 * 根因（2026-09-08 五角度实测诊断）：
 *   着色器程序在加载期只经 compileAsync "链接"，但驱动层原生编译推迟到该程序
 *   第一次真实 draw call（D3D/ANGLE 惰性行为），每个首用程序卡 120~460ms。
 *   视野外对象 visible=false 永不渲染 → 玩家一转向，一批"从未画过的程序"
 *   在转向帧集中首用 → 冻结数秒（实测单帧 3800ms）。
 *
 * 方案：自初始化扫掠器，用【独立相机 + 离屏 RT】绕玩家 8 方位分批瞬渲场景，
 *   把"程序首用"全部消化在加载尾段/空闲期，转向时显存与程序全部是热的。
 *   单次扫掠渲染耗时 >100ms 自动退避；document.hidden 暂停；连续 2 轮无新程序
 *   且加载队列空 → 停止；有新对象到货自动重启。
 *
 * 边界：
 *   - 不复用玩家相机（防状态互扰），不进 world.js（黑名单大文件），零钩子自启动；
 *   - updateFrustumCulling 隐藏的组在扫掠帧临时置可见、渲染后立即还原；
 *   - 编辑模式（buildingManager 管理态）暂停，避免干扰合批/还原流程。
 *
 * 2026-10-26 走路顿挫治理（v3）：卡顿探针实测本扫掠在玩家走动期每 500ms 侵占
 *   一帧 84~341ms（iV 标签），是走路顿挫主因。三项调整：
 *   ① STEP_MS 500→1500、RENDER_SLOW_MS 100→50（84~99ms 扫掠也退避）；
 *   ② 玩家移动（1500ms 内位移 >0.5m）时跳过扫掠步，只在真正站定时扫；
 *   ③ stats() 新增 moveSkips 供诊断验证。代价：边走边加载时部分程序首绘
 *   编译回落到首次真实绘制（与无扫掠时的行为一致），静止后扫掠会补齐。
 */
(function () {
  'use strict';
  if (window.PreloadSweeper) return;

  var DIRS = 8;                 // 水平方位数
  var VIS_CHUNK = 2;            // 每次扫掠只强制显示 2 个隐藏对象（ANGLE 下每程序反射 ~160ms，必须摊薄）
  var STEP_MS = 1500;           // 每个方位的间隔（2026-10-26 走路顿挫治理：500→1500，降低扫掠对交互帧的侵占）
  var ROUND_GAP_MS = 2000;      // 两个整轮之间的间隔
  var SUPERVISOR_MS = 3000;     // 状态巡检间隔
  var BACKOFF_MS = 1500;        // 单次渲染过慢时的退避
  var RENDER_SLOW_MS = 50;      // 单次扫掠渲染耗时阈值（2026-10-26：100→50，84~99ms 的扫掠同样会卡手，也要退避）
  var MOVE_EPS = 0.5;           // 玩家移动判定阈值（米）：距上次扫掠位移超该值 = 在移动，本步跳过
  var RT_SIZE = 256;            // 离屏渲染目标尺寸（程序编译与尺寸无关）

  var st = {
    supervisor: null,
    active: false,
    busy: false,
    dir: 0,
    cleanRounds: 0,
    roundPrograms: 0,          // 本轮累计的新程序数
    lastLoadedCount: -1,
    lastX: null,               // 上次扫掠时的玩家位置（移动检测：玩家走路时暂停扫掠）
    lastZ: null,
    cam: null,
    rt: null,
    stepTimer: null,
    lastRenderMs: 0
  };

  function gw() { return window.gameWorld; }
  function ready() {
    var g = gw();
    return !!(g && g.renderer && g.scene && g.camera && window.player && window.player.position && window.THREE);
  }
  function editing() {
    var bm = gw() && gw().buildingManager;
    return !!(bm && (bm.adminMode || bm.isAdminMode));
  }
  function loadBusy() {
    var g = gw();
    if (!g) return false;
    return (g.loadingQueue && g.loadingQueue.length > 0) || (g.loadingBatch && g.loadingBatch.length > 0);
  }

  function ensureAssets() {
    var g = gw();
    var T = window.THREE;
    if (st.cam && st.rt) return true;
    try {
      var c = g.camera;
      st.cam = new T.PerspectiveCamera(c.fov, c.aspect, c.near, c.far);
      st.cam.rotation.order = 'YXZ';
      st.cam.layers.mask = c.layers.mask;
      st.rt = new T.WebGLRenderTarget(RT_SIZE, RT_SIZE);
      return true;
    } catch (e) { return false; }
  }

  /**
   * 收集"被视锥剔除隐藏"的可渲染组（扫掠前临时置可见，渲染后还原）
   * 只处理 updateFrustumCulling 控制的三类：建筑/怪物/传送门
   */
  function collectHidden() {
    var g = gw();
    var hidden = [];
    try {
      g.generatedBuildings.forEach(function (b) {
        if (b && b.model && !b.model.visible && !(b.model.userData && b.model.userData.__pendingReveal)) {
          hidden.push(b.model);
        }
      });
      g.monsters.forEach(function (m) { if (m && m.group && !m.group.visible) hidden.push(m.group); });
      g.portals.forEach(function (p) { if (p && p.group && !p.group.visible) hidden.push(p.group); });
    } catch (e) { /* 集合缺失时忽略 */ }
    return hidden;
  }

  var chunkOffset = 0; // 隐藏对象分块轮转游标（防止每次都取同一批）

  /** 执行一步扫掠：只强制显示 CH 个隐藏对象并渲染一帧；返回本步新增程序数 */
  function sweepOne() {
    var g = gw();
    if (!ensureAssets()) return 0;
    var before = g.renderer.info.programs ? g.renderer.info.programs.length : 0;

    // 1) 只取 CH 个隐藏对象置可见（一次全量会把这些对象的程序创建挤进同一帧 → Bo 爆发）
    var hidden = collectHidden();
    var chunk = [];
    if (hidden.length > 0) {
      for (var i = 0; i < VIS_CHUNK && i < hidden.length; i++) {
        var o = hidden[(chunkOffset + i) % hidden.length];
        o.visible = true;
        chunk.push(o);
      }
      chunkOffset = (chunkOffset + VIS_CHUNK) % hidden.length;
    }

    // 2) 独立相机摆到玩家头顶，朝当前方位（yaw=θ+π 使 forward=(sinθ,cosθ)，与玩家视线同向约定）
    var p = window.player.position;
    var yaw = (st.dir * Math.PI * 2) / DIRS;
    st.cam.position.set(p.x, p.y + 1.6, p.z);
    st.cam.rotation.set(-0.25, yaw + Math.PI, 0);
    st.cam.aspect = g.camera.aspect;
    st.cam.updateProjectionMatrix();

    // 3) 离屏渲染一帧（触发首用程序的驱动编译 + 几何/纹理首用上传）
    var t0 = performance.now();
    try {
      g.renderer.setRenderTarget(st.rt);
      g.renderer.render(g.scene, st.cam);
      g.renderer.setRenderTarget(null);
    } catch (e) { /* 渲染态异常时静默跳过本步 */ }
    st.lastRenderMs = performance.now() - t0;

    // 4) 还原可见性（updateFrustumCulling 每 4 帧重算，还原可防状态漂移）
    for (var j = 0; j < chunk.length; j++) chunk[j].visible = false;

    var after = g.renderer.info.programs ? g.renderer.info.programs.length : 0;
    st.dir = (st.dir + 1) % DIRS;
    if (st.dir === 0) st.roundPrograms = 0; // 新一轮开始（计数已在轮内累计）
    return Math.max(0, after - before);
  }

  function startStepping() {
    if (st.stepTimer || st.active) return;
    st.active = true;
    st.cleanRounds = 0;
    st.stepTimer = setInterval(function () {
      if (st.busy || !ready() || document.hidden || editing()) return;
      // 2026-10-26 玩家移动暂停：走路时每半秒一次的离屏编译渲染正是顿挫元凶，
      // 扫掠只在玩家真正站定时进行（v4 卡顿探针实证：iV 标签单次 84~341ms）。
      try {
        var pp = window.player.position;
        if (st.lastX !== null && (Math.abs(pp.x - st.lastX) > MOVE_EPS || Math.abs(pp.z - st.lastZ) > MOVE_EPS)) {
          st.lastX = pp.x; st.lastZ = pp.z;
          st.moveSkips = (st.moveSkips || 0) + 1; // 诊断口：因玩家移动跳过的步数
          return; // 玩家在移动：本步跳过（步进计时器继续跑，静止后自动恢复扫掠）
        }
        st.lastX = pp.x; st.lastZ = pp.z;
      } catch (e) { /* 位置读取失败按静止处理 */ }
      st.busy = true;
      var added = 0;
      try { added = sweepOne(); } catch (e) { /* 不让扫掠杀死主循环 */ }
      st.busy = false;
      st.roundPrograms += added;

      // 一轮结束：判收敛
      if (st.dir === 0) {
        if (st.roundPrograms === 0 && !loadBusy()) {
          st.cleanRounds++;
          if (st.cleanRounds >= 2) { stopStepping('converged'); return; }
        } else {
          st.cleanRounds = 0;
        }
      }
    }, st.lastRenderMs > RENDER_SLOW_MS ? BACKOFF_MS : STEP_MS);
  }

  function stopStepping(reason) {
    if (st.stepTimer) { clearInterval(st.stepTimer); st.stepTimer = null; }
    st.active = false;
    try { console.log('[PreloadSweeper] 扫掠暂停（' + reason + '），有新对象到货将自动重启'); } catch (e) {}
  }

  // 巡检：需要时启动扫掠
  st.supervisor = setInterval(function () {
    if (!ready() || document.hidden) return;
    var g = gw();
    var loaded = g.loadedObjects ? g.loadedObjects.size : 0;
    var grew = st.lastLoadedCount >= 0 && loaded > st.lastLoadedCount;
    st.lastLoadedCount = loaded;
    if (editing()) { if (st.active) stopStepping('editing'); return; }
    // reveal 逐模型预热进行中时不启动（reveal 自己会把程序创建摊到每帧，
    // 扫掠此时并行反而会在单帧里集中创建大量程序 → Bo 爆发）
    var revealBusy = window.PlaceholderField && window.PlaceholderField.pendingCount ? window.PlaceholderField.pendingCount() > 0 : false;
    if (st.active && revealBusy) { stopStepping('reveal-busy'); return; }
    if (!st.active && !revealBusy && (loadBusy() || grew)) startStepping();
  }, SUPERVISOR_MS);

  window.PreloadSweeper = {
    /** 手动触发一次完整 8 方位扫掠（诊断用） */
    sweepAll: function () {
      if (!ready()) return 'not-ready';
      var before = gw().renderer.info.programs.length;
      for (var i = 0; i < DIRS; i++) sweepOne();
      return { newPrograms: gw().renderer.info.programs.length - before, lastRenderMs: Math.round(st.lastRenderMs) };
    },
    stats: function () {
      return { active: st.active, dir: st.dir, cleanRounds: st.cleanRounds, lastRenderMs: Math.round(st.lastRenderMs), moveSkips: st.moveSkips || 0 };
    },
  };
})();
