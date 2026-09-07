/**
 * entitySleepManager.js —— 远程角色按距离休眠（卡顿治理：无人区资源占用）
 *
 * 背景：world.js 的 players Map 只在对方断线时清理（removePlayer 仅由
 * PLAYER_LEAVE 触发），animate 主循环对每个远程玩家每帧更新 glbMixer /
 * sharedMixer / bonePhysics（约 0.5-2ms/人/帧），与距离无关。玩家传送到
 * 无人区后，2km 外的在线角色动画解算照常烧 CPU。
 *
 * 本模块：
 *   - 每秒扫描 players，按「本地玩家-远程角色」距离 + 滞回区间打
 *     group.userData._sleeping 标记（>80m 睡 / <60m 醒，防边界抖动）；
 *   - world.js 的 mixer 更新块读 isSleeping(pd) 跳过动画/骨骼物理更新
 *     （只停时间推进，不 dispose、不动 visible —— 与 updateFrustumCulling
 *     的视锥可见性互不干扰；远处角色本来就不可见，冻结姿态无感知）；
 *   - 动画状态切换（playAnim 等事件驱动调用）不在休眠拦截范围内，
 *     唤醒后自动以最新动作继续播放。
 *
 * 明确排除：
 *   - 本地玩家自己（GAME_STATE.characterId）永不休眠；
 *   - 怪物不处理：客户端无每帧解算（位置由服务器 POSITION_UPDATE 驱动），
 *     视锥剔除已覆盖，无可休眠的 CPU 开销；
 *   - 传送落地后 window.player.position 跳变 >0.5s 内由下一次扫描自然重判。
 *
 * 依赖：window.gameWorld / window.player / window.GAME_STATE（main.js 提供）
 */
(function () {
  'use strict';

  var SLEEP_DIST_SQ = 80 * 80; // 超过该距离（平方）→ 休眠
  var WAKE_DIST_SQ = 60 * 60;  // 小于该距离（平方）→ 唤醒（滞回 20m）
  var SCAN_MS = 1000;

  function isSleeping(pd) {
    var ud = pd && pd.group && pd.group.userData;
    return !!(ud && ud._sleeping);
  }

  function scan() {
    var world = window.gameWorld;
    var p = window.player;
    if (!world || !world.players || !p || !p.position) return;
    var selfId = window.GAME_STATE && window.GAME_STATE.characterId;
    var px = p.position.x, py = p.position.y, pz = p.position.z;

    world.players.forEach(function (pd, cid) {
      var ud = pd && pd.group && pd.group.userData;
      if (!ud) return;
      if (cid === selfId) return; // 本地玩家永不休眠
      var g = pd.group.position;
      if (!g) return;
      var dx = g.x - px, dy = g.y - py, dz = g.z - pz;
      var distSq = dx * dx + dy * dy + dz * dz;
      if (!ud._sleeping) {
        if (distSq > SLEEP_DIST_SQ) {
          ud._sleeping = true;
        }
      } else if (distSq < WAKE_DIST_SQ) {
        ud._sleeping = false;
      }
    });
  }

  // 扫描定时器接入 BgThrottle（后台时无需休眠判定），无模块则裸 setInterval
  function start() {
    var fn = function () { try { scan(); } catch (e) { /* 绝不影响主流程 */ } };
    if (window.BgThrottle) window.BgThrottle.every('esm.scan', SCAN_MS, fn);
    else setInterval(fn, SCAN_MS);
  }
  start();

  window.EntitySleepManager = {
    isSleeping: isSleeping,
    _diag: function () {
      var world = window.gameWorld;
      var out = { total: 0, sleeping: 0, awake: 0 };
      if (!world || !world.players) return out;
      world.players.forEach(function (pd, cid) {
        var ud = pd && pd.group && pd.group.userData;
        if (!ud) return;
        out.total++;
        if (ud._sleeping) out.sleeping++; else out.awake++;
      });
      return out;
    }
  };
})();
