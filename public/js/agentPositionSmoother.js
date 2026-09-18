/**
 * agentPositionSmoother.js — Agent 位置平滑器（真人双端联测 bug ⑤ 修复）
 *
 * 问题：Agent 移动由服务器以 10Hz 推进并广播 POSITION_UPDATE，前端直接 group.position.set()
 *       → 真人看到 AI "一段一段"地瞬移前进（10 帧/秒的台阶）。
 *
 * 方案：拦截 isAgent 玩家的位置更新，只记录"目标点"；由 rAF 循环以速度上限（5.4 m/s，
 *       略高于服务端 5 m/s 限速，保证追得上不滞后）逐帧逼近，并插值朝向。
 *       逼近过程中照常调用原始 updatePlayerPosition —— 摆臂/行走动画由原始逻辑驱动，
 *       本模块只改变"喂进去的坐标"。
 *
 * 作用范围：仅 Agent（group.userData.isAgent === true），人类玩家行为零变化（红线 9）。
 * 快照超大跳变（>20m，如重连/传送恢复）直接吸附，避免长距离"漂移"。
 *
 * 暴露全局：window.AgentPositionSmoother（install/uninstall/getStats）
 */
(function () {
  'use strict';

  const MAX_SPEED = 5.4;        // m/s，略高于服务端 5m/s 限速
  const SNAP_DISTANCE = 20;     // m，超过则直接吸附（重连/大跳变）
  const ARRIVE_EPSILON = 0.01;  // m

  let gameWorld = null;
  let origUpdate = null;
  let installed = false;
  let rafId = 0;
  let lastTs = 0;

  /** characterId -> { target:{x,y,z}, cur:{x,y,z}, yaw, lastArgs:[] } */
  const tracks = new Map();

  function isAgent(cid) {
    if (!gameWorld || !gameWorld.players) return false;
    const pd = gameWorld.players.get(cid);
    return !!(pd && pd.group && pd.group.userData && pd.group.userData.isAgent);
  }

  function clonePos(p) {
    return { x: p.x || 0, y: p.y || 0, z: p.z || 0 };
  }

  function dist2D(a, b) {
    const dx = a.x - b.x, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function shortestAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function step(ts) {
    rafId = requestAnimationFrame(step);
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.1, (ts - lastTs) / 1000);   // 上限 100ms，防切后台瞬移
    lastTs = ts;
    if (!gameWorld || !origUpdate) return;

    for (const [cid, t] of tracks.entries()) {
      if (!isAgent(cid)) { tracks.delete(cid); continue; }
      const d = dist2D(t.cur, t.target);
      if (d <= ARRIVE_EPSILON) {
        if (!t.arrived) {
          t.cur = clonePos(t.target);
          origUpdate.call(gameWorld, cid, clonePos(t.cur), false, t.animMode, t.rotation);
          t.arrived = true;
        }
        continue;
      }
      t.arrived = false;
      const maxStep = MAX_SPEED * dt;
      const ratio = d <= maxStep ? 1 : maxStep / d;
      t.cur.x += (t.target.x - t.cur.x) * ratio;
      t.cur.z += (t.target.z - t.cur.z) * ratio;
      // Y 直接跟随（服务器端已做贴地 + 偏移），不做平滑避免上下抖动
      t.cur.y = t.target.y;

      // 朝向：朝移动方向插值（无位移时保持上次朝向）
      if (d > 0.001) {
        const wantYaw = Math.atan2(t.target.x - t.cur.x, t.target.z - t.cur.z);
        t.yaw += shortestAngle(t.yaw, wantYaw) * Math.min(1, dt * 8);
      }
      const args = t.lastArgs.slice();
      args[0] = cid;
      args[1] = clonePos(t.cur);
      // updatePlayerPosition(characterId, position, isSelf, animMode, rotation)
      if (args.length < 5) { while (args.length < 5) args.push(undefined); }
      args[4] = t.yaw;
      origUpdate.apply(gameWorld, args);
    }
  }

  function install() {
    if (installed) return true;
    gameWorld = window.gameWorld;
    if (!gameWorld || typeof gameWorld.updatePlayerPosition !== 'function') return false;
    if (gameWorld.__agentSmootherPatched) return true;

    origUpdate = gameWorld.updatePlayerPosition;
    gameWorld.__agentSmootherOrigUpdate = origUpdate;
    gameWorld.__agentSmootherPatched = true;

    gameWorld.updatePlayerPosition = function (cid, position, ...rest) {
      if (!position || !isAgent(cid)) {
        return origUpdate.call(this, cid, position, ...rest);
      }
      const target = clonePos(position);
      const existing = tracks.get(cid);
      if (!existing) {
        // 首次出现：直接落位，避免从旧位置"飘"过去
        tracks.set(cid, {
          target,
          cur: clonePos(target),
          yaw: typeof rest[2] === 'number' ? rest[2] : 0,
          animMode: rest[1],
          rotation: rest[2],
          lastArgs: [cid, position, ...rest],
          arrived: true
        });
        return origUpdate.call(this, cid, position, ...rest);
      }
      const jump = dist2D(existing.cur, target);
      if (jump > SNAP_DISTANCE) {
        existing.cur = clonePos(target);
      }
      existing.target = target;
      existing.animMode = rest[1];
      existing.rotation = rest[2];
      existing.lastArgs = [cid, position, ...rest];
      // 目标更新不立即落位 —— 交给 rAF 逼近（保留摆臂动画）
      return undefined;
    };

    installed = true;
    if (!rafId) rafId = requestAnimationFrame(step);
    return true;
  }

  function uninstall() {
    if (!installed || !gameWorld) return;
    gameWorld.updatePlayerPosition = origUpdate;
    gameWorld.__agentSmootherPatched = false;
    tracks.clear();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    installed = false;
  }

  // gameWorld 由 main.js 异步创建，轮询等待（不依赖脚本加载顺序）
  const bootTimer = setInterval(() => {
    if (install()) {
      clearInterval(bootTimer);
      console.log('[AgentSmoother] 已安装（仅作用于 Agent，5.4m/s 上限逼近）');
    }
  }, 300);

  window.addEventListener('beforeunload', () => { clearInterval(bootTimer); });

  window.AgentPositionSmoother = {
    install,
    uninstall,
    getStats() {
      return {
        installed,
        tracking: tracks.size,
        maxSpeed: MAX_SPEED
      };
    }
  };
})();
