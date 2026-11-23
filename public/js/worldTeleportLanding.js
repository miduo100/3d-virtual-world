/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * worldTeleportLanding.js — 传送落地门控：人到、地未到时不许往下掉（2026-11-06）  v1
 * 诊断：window.WorldTeleportLanding._diag()
 *
 * 为什么独立成文件（对齐《开发规范-代码组织与文件边界》）：
 *  - player.js 1844 行 ≥1000 = 冻结档；world.js 9109 行冻结；portalManager.js 559 行只许接线。
 *    故本模块用「旁路包装」包住 Player.prototype.handleVerticalMovement，存量文件 0 改动（§1.4 处置法 3）。
 *  - 与 adminFlyToggle.js 同为 Player 原型包装：本模块必须排在它之后加载（index.html），
 *    这样本包装在最外层，飞行/缓降时把控制权原样让回去。
 *
 * 解决什么（2026-11-06 与策凌讨论确认）：
 *  传送门 / 坐标传送只改 position，目标地点的模型与碰撞往往还在加载队列里，
 *  world.getGroundHeight() 返回 null → handleVerticalMovement 里 targetY = -Infinity
 *  → 一路走"空中"分支累加重力 → 掉到 y < -50 才被"掉出世界"兜底送回出生点
 *  （表现为：传过去，人往下掉，几秒后又被弹回出生点）。
 *
 * 做法（不用"重力缓生效"，直接贴合）：
 *  1. 每帧对比玩家位置，单帧位移超过 JUMP_DIST 即认定"发生了传送"（不依赖任何调用点通知，
 *     teleportThroughPortal / portalManager / respawn / 出生点更新 全部自动覆盖）；
 *  2. 传送后冻结垂直方向（不累加重力、不播 jump 动画），每帧探一次脚下地面；
 *  3. 连续 SETTLE_FRAMES 帧探到同一高度（容差 SETTLE_EPS）→ 直接贴合地面 + 立刻恢复重力；
 *  4. TIMEOUT_MS 内始终没有地面 → 退回传送前位置并提示，不留人在虚空里。
 *
 * 关闭本模块：window.__TELEPORT_LANDING_OFF = true（需在脚本加载前设置）。
 * 临时调参：window.WorldTeleportLanding.cfg.JUMP_DIST = 5（飞行距离等特殊场景用）。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.WorldTeleportLanding) return;                 // 幂等：重复引入不二次初始化
  if (window.__TELEPORT_LANDING_OFF) {
    console.log('[TeleportLanding] 已按 __TELEPORT_LANDING_OFF 关闭');
    return;
  }

  var CFG = {
    JUMP_DIST: 3.0,            // 单帧位移 > 此值视为传送（正常冲刺每帧约 0.25m，跳跃 0.8m）
    SETTLE_FRAMES: 2,          // 连续探到同一高度的帧数才算"地面就绪"
    SETTLE_EPS: 0.2,           // 高度稳定容差（m）
    TIMEOUT_MS: 8000,          // 等待地面上限；超时退回传送前位置
    SUPPRESS_MS: 2000,         // 回退后多久不再识别跳变（防"回退→再触发"死循环）
    MAX_TRIGGERS: 5,           // 10 秒内最多触发次数
    TRIGGER_WINDOW_MS: 10000
  };

  var stats = {
    triggers: 0,     // 识别到传送并开启门控的次数
    settled: 0,      // 成功贴合的次数
    fallbacks: 0,    // 超时回退次数
    lastWaitMs: 0,   // 最近一次等待耗时
    lastReason: ''   // 'settled' | 'timeout'
  };

  function nowMs() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  function round2(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
  }

  function log() {
    if (!window.console || !console.log) return;
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[TeleportLanding]');
    console.log.apply(console, a);
  }

  /** 脚下地面高度；null = 没有地面（地形之外且没有模型碰撞） */
  function groundY(player) {
    if (!player || !player.world || typeof player.world.getGroundHeight !== 'function') return null;
    try {
      var g = player.world.getGroundHeight(player.position);
      return (g !== null && isFinite(g)) ? g : null;
    } catch (e) {
      return null;   // 查询异常按"还没探到"处理，继续等，不把异常抛进主循环
    }
  }

  /** 脚底相对 position.y 的偏移：GLB 角色原点已在脚底，方块人脚底在 group 下方 1.5 */
  function footOffset(player) {
    var ud = player.worldObject && player.worldObject.userData;
    return (ud && ud.isGlbLoaded) ? 0 : 1.5;
  }

  function newState() {
    return {
      prevX: null, prevY: null, prevZ: null,   // 上一帧位置（null = 还没建基线）
      active: false,                            // 是否正在等地面
      startedAt: 0,
      fromX: 0, fromY: 0, fromZ: 0,             // 传送前位置（超时回退用）
      lastGh: null,
      probes: 0,
      suppressUntil: 0,
      triggerTimes: []
    };
  }

  function begin(player, st, now) {
    st.active = true;
    st.startedAt = now;
    // 注意用 !== null 判断，不能用 || ：坐标恰为 0 时 0 是 falsy，
    // 会把回退点错写成传送后的位置（新玩家从原点传送时必现）。
    st.fromX = (st.prevX !== null) ? st.prevX : player.position.x;
    st.fromY = (st.prevY !== null) ? st.prevY : player.position.y;
    st.fromZ = (st.prevZ !== null) ? st.prevZ : player.position.z;
    st.lastGh = null;
    st.probes = 0;

    st.triggerTimes.push(now);
    while (st.triggerTimes.length && now - st.triggerTimes[0] > CFG.TRIGGER_WINDOW_MS) {
      st.triggerTimes.shift();
    }
    stats.triggers++;

    player.velocity.set(0, 0, 0);
    player.isGrounded = true;   // 当作"站着"，否则 updateWalkingAnimation 会切到 jump 定格

    log('开启门控 ← 从 (' + round2(st.fromX) + ', ' + round2(st.fromY) + ', ' + round2(st.fromZ) +
      ') 到 (' + round2(player.position.x) + ', ' + round2(player.position.y) + ', ' + round2(player.position.z) + ')');
  }

  /**
   * 门控每帧推进
   * @returns {boolean} true = 本帧已接管垂直方向，调用方不要再跑原逻辑
   */
  function tick(player, st, now) {
    // 玩家进入飞行/缓降：控制权交回 adminFlyToggle 的包装，门控作废
    if (player.isFlying || player._flyLanding) {
      st.active = false;
      log('玩家进入飞行，放弃门控');
      return false;
    }

    var gh = groundY(player);

    if (gh !== null) {
      // 高度稳定才算数：躲开"模型刚插入场景、matrixWorld / BVH 还没刷"时的错误高度
      if (st.lastGh !== null && Math.abs(gh - st.lastGh) < CFG.SETTLE_EPS) {
        st.probes++;
      } else {
        st.probes = 1;
      }
      st.lastGh = gh;

      if (st.probes >= CFG.SETTLE_FRAMES) {
        player.position.y = gh + footOffset(player);
        player.velocity.y = 0;
        player.isGrounded = true;
        st.active = false;

        stats.settled++;
        stats.lastWaitMs = Math.round(now - st.startedAt);
        stats.lastReason = 'settled';
        st.prevX = player.position.x;
        st.prevY = player.position.y;
        st.prevZ = player.position.z;

        log('地面就绪，已贴合 y=' + round2(player.position.y) + '（等待 ' + stats.lastWaitMs + 'ms）');
      }
      return true;
    }

    // 脚下还没有地面：冻住垂直方向，既不落也不飘
    player.velocity.y = 0;
    player.isGrounded = true;

    var waited = now - st.startedAt;
    if (waited > CFG.TIMEOUT_MS) {
      player.position.set(st.fromX, st.fromY, st.fromZ);
      player.velocity.set(0, 0, 0);
      player.isGrounded = true;
      st.active = false;
      st.suppressUntil = now + CFG.SUPPRESS_MS;   // 别把这次回退本身再当成传送

      stats.fallbacks++;
      stats.lastReason = 'timeout';
      st.prevX = player.position.x;
      st.prevY = player.position.y;
      st.prevZ = player.position.z;

      console.warn('[TeleportLanding] 落点 ' + Math.round(waited) + 'ms 内没有加载出地面，已退回传送前位置');
      if (typeof UI !== 'undefined' && UI.addChatMessage) {
        UI.addChatMessage('系统', '⚠️ 目标位置加载超时，已退回原地');
      }
    }
    return true;
  }

  function patch() {
    var P = window.Player;
    if (!P || !P.prototype) return false;

    var proto = P.prototype;
    if (proto.__teleportLandingPatched) return true;
    if (typeof proto.handleVerticalMovement !== 'function') {
      console.warn('[TeleportLanding] Player 原型缺少 handleVerticalMovement，落地门控不装配');
      return false;
    }

    var orig = proto.handleVerticalMovement;

    proto.handleVerticalMovement = function (delta) {
      var p = this.position;
      if (!p) return orig.call(this, delta);

      var st = this.__tlState;
      if (!st) {
        st = newState();
        this.__tlState = st;
      }

      var now = nowMs();

      // 第一帧只建基线：玩家刚创建时位置本来就会从初始点跳到出生点，不当作传送
      if (st.prevX === null) {
        st.prevX = p.x; st.prevY = p.y; st.prevZ = p.z;
        return orig.call(this, delta);
      }

      // 飞行/缓降：交给 adminFlyToggle 处理，这里只同步基线
      if (this.isFlying || this._flyLanding) {
        st.active = false;
        st.prevX = p.x; st.prevY = p.y; st.prevZ = p.z;
        return orig.call(this, delta);
      }

      // 传送识别：单帧位移过大即认定"有人改了 position"
      if (!st.active) {
        var dx = p.x - st.prevX;
        var dy = p.y - st.prevY;
        var dz = p.z - st.prevZ;
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist > CFG.JUMP_DIST && now > st.suppressUntil) {
          var recent = 0;
          for (var i = 0; i < st.triggerTimes.length; i++) {
            if (now - st.triggerTimes[i] < CFG.TRIGGER_WINDOW_MS) recent++;
          }
          if (recent < CFG.MAX_TRIGGERS) {
            begin(this, st, now);
          } else {
            log('10 秒内传送过于频繁，本次不做落地门控');
          }
        }
      }

      if (st.active) {
        var handled = tick(this, st, now);
        st.prevX = p.x; st.prevY = p.y; st.prevZ = p.z;
        if (handled) return;
      }

      st.prevX = p.x; st.prevY = p.y; st.prevZ = p.z;
      return orig.call(this, delta);
    };

    proto.__teleportLandingPatched = true;
    log('已装配到 Player.prototype.handleVerticalMovement');
    return true;
  }

  // Player 由 player.js 先加载；若顺序异常则短轮询补齐
  var tries = 0;
  function tryInstall() {
    if (patch()) return;
    if (++tries > 20) {
      console.warn('[TeleportLanding] 等待 window.Player 超时（20 次），落地门控未生效');
      return;
    }
    setTimeout(tryInstall, 250);
  }
  tryInstall();

  window.WorldTeleportLanding = {
    cfg: CFG,

    /**
     * 显式入口：明确知道"这是一次传送"时可直接调用（不依赖跳变识别）。
     * 目前所有传送入口靠跳变识别已可覆盖，此 API 留给以后新增的入口。
     */
    teleport: function (player, x, y, z) {
      if (!player || !player.position) return false;
      var st = player.__tlState || (player.__tlState = newState());
      st.prevX = player.position.x;
      st.prevY = player.position.y;
      st.prevZ = player.position.z;
      player.position.set(x, y, z);
      begin(player, st, nowMs());
      return true;
    },

    _diag: function () {
      return {
        enabled: true,
        patched: !!(window.Player && window.Player.prototype && window.Player.prototype.__teleportLandingPatched),
        triggers: stats.triggers,
        settled: stats.settled,
        fallbacks: stats.fallbacks,
        lastWaitMs: stats.lastWaitMs,
        lastReason: stats.lastReason,
        active: (window.player && window.player.__tlState) ? window.player.__tlState.active : null,
        activeWaitMs: (window.player && window.player.__tlState && window.player.__tlState.active)
          ? Math.round(nowMs() - window.player.__tlState.startedAt) : 0,
        cfg: CFG
      };
    }
  };
})();
