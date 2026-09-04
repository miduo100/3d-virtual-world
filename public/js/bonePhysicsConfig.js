/**
 * BonePhysicsConfig —— 骨骼物理参数集中配置 + 运行时热调
 * ------------------------------------------------------------------
 * 职责：
 *   1. 集中管理 bone-physics.js 的全部参数（PHYSICS_PATTERNS / DEFAULT_OPTIONS）。
 *   2. 提供 window.BonePhysicsTuning，可在浏览器控制台实时改参数并热应用到
 *      所有已创建的 BonePhysics 实例，无需改代码、无需刷新页面。
 *
 * 加载顺序：必须在 public/js/bone-physics.js 之前引入（index.html 已保证）。
 *
 * 控制台用法：
 *   BonePhysicsTuning.get()                 // 查看当前参数
 *   BonePhysicsTuning.set({elasticity:5})   // 实时改参数（所有实例立即生效）
 *   BonePhysicsTuning.reset()               // 恢复新默认值
 *   BonePhysicsTuning.legacy()              // 回到改动前的旧观感（A/B 对比）
 *   BonePhysicsTuning.off() / .on()         // 一键开关物理
 *   BonePhysicsTuning.diag()                // 每个实例的骨骼偏移诊断
 */
(function () {
  'use strict';

  // ===== 物理骨骼匹配（收紧版） =====
  // 移除原版 /dress/ /cloth/ /coat/ /hem/ /twin/ /muscle/：
  // 这些会把「裙子/衣服的主体根骨」一起纳入物理，是裙摆整片大幅摆动的元凶；
  // /hem/ 还会误中 "them"。'ear' 仍用词边界 \b（避免误伤 ForeArm）。
  var PHYSICS_PATTERNS = [
    /hair/i, /tail/i, /skirt/i, /cape/i, /ribbon/i, /bun/i, /breast/i,
    /ahoge/i, /kemomimi/i, /bell/i, /fringe/i, /bang/i,
    /\bear\b/i, /tassel/i, /sash/i, /ponytail/i
  ];

  // ===== 默认参数（2026-09 摆动调优后口径） =====
  // 目标观感：静止几乎不动；走动/转向明显但自然；0.3~0.5s 收敛；跑动不卷不飞。
  var DEFAULT_OPTIONS = {
    enabled: true,
    gravity: 4.0,           // 世界单位/秒²。静止下垂量 ≈ gravity*dt²/k ≈ 2cm（含蓄重量感）
    damping: 0.32,          // 每 1/60s 保留 (1-d) 速度；配合 elasticity=3.5 → 阻尼比 ζ≈0.7
    stiffness: 18,          // 距离约束强度（1/s）。15→18，链更不易被拉长
    elasticity: 3.5,        // 回拉强度（1/s）→ 时间常数 ≈0.29s，2% 收敛 ≈0.40s（原 1.2 → 1.5s+ 反复荡）
    iterations: 1,          // 距离约束迭代次数
    maxAngle: 35,           // 单骨最大转角（度）。原 110° 会让 3~5 节链叠加成 440°，直接卷成一圈
    maxAngleRoot: 18,       // 链根段最大转角（度，更严格）：它一转整条链都跟着转，最易甩到身前
    maxOffsetRatio: 0.45,   // 粒子相对动画位置的最大偏移 = ratio × restLen（尺度无关，防飞起）
    maxOffsetRootRatio: 0.25,
    moveFollow: 0.97,       // 角色整体平移跟随比例：1.0=完全跟随(无拖尾) / 0.97≈跑动5cm拖尾 / 0.90=强拖尾
    teleportSpeed: 60,      // 单帧位移速度 > 60 单位/s 判定为传送/重生，粒子直接吸附重置
    scaleNormalize: true,   // 按角色骨架高度归一化重力（fitModel 已把玩家归一到 ~1.8m，模板间观感一致）
    rootInPhysics: false,   // 根骨骼（父非物理）是否也参与物理摆动
    // 名称分组参数：先匹配的组覆盖默认参数（数值按新 elasticity/damping 口径重标定）
    groups: [
      // 胸部：轻微弹抖、回弹快、转角极小
      { match: /breast/i,   gravity: 1.5, damping: 0.45, elasticity: 8.0, stiffness: 26, maxAngle: 15, rootInPhysics: true },
      // 马尾 / 尾巴：明显拖拽，允许稍大摆幅
      { match: /(ponytail|_tail|tail\.)/i, gravity: 5.0, damping: 0.30, elasticity: 3.0, stiffness: 14, maxAngle: 40, maxOffsetRatio: 0.50 },
      // 头发：跑动时向后自然拖尾、不卷不飞
      { match: /hair/i,     gravity: 4.0, damping: 0.32, elasticity: 4.0, stiffness: 18, maxAngle: 40, maxOffsetRatio: 0.45 },
      // 裙子：轻重力 + 强回拉 + 小转角，静止贴合绑定造型，转动才飘
      { match: /skirt/i,    gravity: 2.0, damping: 0.38, elasticity: 4.5, stiffness: 20, maxAngle: 22, maxOffsetRatio: 0.30 },
      // 呆毛：轻、弹、灵动
      { match: /ahoge/i,    gravity: 2.5, damping: 0.25, elasticity: 5.0, stiffness: 22, maxAngle: 45, maxOffsetRatio: 0.55 },
      // 兽耳：轻微摆动
      { match: /(kemomimi|kemo_ear|kemoear)/i, gravity: 1.5, damping: 0.35, elasticity: 5.5, stiffness: 22, maxAngle: 25 },
      // 丝带 / 铃铛 / 披风：轻盈飘动
      { match: /(ribbon|bell|cape)/i, gravity: 4.0, damping: 0.24, elasticity: 2.6, stiffness: 15, maxAngle: 45, maxOffsetRatio: 0.50 }
    ]
  };

  // 出厂默认（reset 用），与 DEFAULT_OPTIONS 深拷贝隔离
  var _factory = JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
  var _instances = []; // 已创建且未 dispose 的 BonePhysics 实例

  function _prune() {
    for (var i = _instances.length - 1; i >= 0; i--) {
      if (!_instances[i]._alive) _instances.splice(i, 1);
    }
  }

  window.BonePhysicsConfig = {
    PATTERNS: PHYSICS_PATTERNS,
    DEFAULTS: DEFAULT_OPTIONS,
    _register: function (inst) {
      _prune();
      if (_instances.indexOf(inst) < 0) _instances.push(inst);
    },
    _unregister: function (inst) {
      var i = _instances.indexOf(inst);
      if (i >= 0) _instances.splice(i, 1);
    }
  };

  // ===== 运行时热调入口 =====
  window.BonePhysicsTuning = {
    version: '2.0',
    get: function () {
      return JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
    },
    set: function (patch) {
      if (!patch || typeof patch !== 'object') return DEFAULT_OPTIONS;
      Object.keys(patch).forEach(function (k) {
        if (k === 'groups' && Array.isArray(patch[k])) {
          DEFAULT_OPTIONS.groups = JSON.parse(JSON.stringify(patch[k]));
        } else {
          DEFAULT_OPTIONS[k] = patch[k];
        }
      });
      _prune();
      _instances.forEach(function (i) {
        try { i.refreshOptions(); } catch (e) { console.warn('[BonePhysics] 热更新失败', e); }
      });
      console.log('[BonePhysics] 参数已热更新（实例数 ' + _instances.length + '）', patch);
      return JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
    },
    reset: function () {
      Object.keys(_factory).forEach(function (k) {
        if (Array.isArray(_factory[k])) DEFAULT_OPTIONS[k] = JSON.parse(JSON.stringify(_factory[k]));
        else DEFAULT_OPTIONS[k] = _factory[k];
      });
      _prune();
      _instances.forEach(function (i) {
        try { i.refreshOptions(); } catch (e) {}
      });
      console.log('[BonePhysics] 参数已恢复出厂默认');
      return JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
    },
    off: function () { return window.BonePhysicsTuning.set({ enabled: false }); },
    on: function () { return window.BonePhysicsTuning.set({ enabled: true }); },
    // 一键回到改动前的旧观感，用于 A/B 对比
    legacy: function () {
      return window.BonePhysicsTuning.set({
        gravity: 4.0, damping: 0.15, stiffness: 15, elasticity: 1.2,
        maxAngle: 110, maxAngleRoot: 110,
        maxOffsetRatio: 0, maxOffsetRootRatio: 0, moveFollow: 0
      });
    },
    diag: function () {
      _prune();
      return _instances.map(function (inst) {
        try { return inst.diag(); }
        catch (e) { return { ok: false, error: String(e) }; }
      });
    }
  };
})();
