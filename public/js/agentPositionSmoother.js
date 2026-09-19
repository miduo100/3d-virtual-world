/**
 * agentPositionSmoother.js — Agent 位置平滑器（真人双端联测 bug ⑤ 修复）
 *
 * 问题：Agent 移动由服务器以 10Hz 推进并广播 POSITION_UPDATE，前端直接 group.position.set()
 *       → 真人看到 AI "一段一段"地瞬移前进（10 帧/秒的台阶）。
 *
 * 方案：拦截 isAgent 玩家的位置更新，只记录"目标点"；由 rAF 循环以速度上限逐帧逼近，并插值朝向。
 *       逼近过程中照常调用原始 updatePlayerPosition —— 摆臂/行走动画由原始逻辑驱动，
 *       本模块只改变"喂进去的坐标"。
 *
 * ── 2026-09-19 三档联测缺陷 T1 修复：上限不再写死 ──
 * 历史实现把上限写死 5.4 m/s（当年服务端限速 5 m/s）。服务端速度改为后台可配
 * （`agent_max_speed`，联测时=12）后，追赶速度 < 实际速度 → 滞后线性累积，到
 * SNAP_DISTANCE=20 时直接吸附 → 真人看到"慢慢飘 + 突然跳 20m"（实测滞后 max 21.01m、
 * 瞬移 20.70m）。现在两级来源：
 *   ① 配置跟随：安装时与每 60s 拉取 /.well-known/virtual-world-agent.json 的
 *      `limits.movementSpeed`，上限 = max(5.4, 该值 × 1.2)，后台热改速度可跟进；
 *   ② 自适应兜底：按实测"目标点位移速率" EMA 推算需要的最小追速（×1.3 余量），
 *      端点不可用/速度再被临时调高时也能追上。
 * 吸附语义同时收紧：距离超阈值需**连续 N 次目标更新**才判定为大跳变（重连/传送），
 * 避免把"高速直线移动"误判为跳变；超远距离（>60m）仍立即吸附。
 *
 * 作用范围：仅 Agent（group.userData.isAgent === true），人类玩家行为零变化（红线 9）。
 *
 * 暴露全局：window.AgentPositionSmoother（install/uninstall/getStats）
 */
(function () {
  'use strict';

  const DEFAULT_MAX_SPEED = 5.4;   // 兜底上限（= 旧行为；服务端配置不可用时使用）
  const MIN_MAX_SPEED = 5.4;       // 下限：低于此值就追不上任何服务端速度
  const MAX_MAX_SPEED = 30;        // 上限：防御异常观测值把追赶速度推到离谱
  const SPEED_MARGIN = 1.2;        // 配置跟随余量（上限 = 服务端速度 × 该系数）
  const ADAPT_MARGIN = 1.3;        // 自适应余量
  const CONFIG_TTL_MS = 60000;     // 服务端速度配置刷新周期（与后台 60s 缓存同口径）
  const SNAP_DISTANCE = 20;        // m，超过则视为大跳变（重连/传送）候选
  const SNAP_PERSIST_EVENTS = 3;   // 需连续 N 次目标更新仍超阈值才吸附（≈300ms @10Hz）
  const SNAP_HARD_DISTANCE = 60;   // m，超过则无条件吸附
  const ARRIVE_EPSILON = 0.01;     // m
  const MAX_PLAUSIBLE_RATE = 40;   // m/s，超过视为跳变样本，不参与自适应

  let gameWorld = null;
  let origUpdate = null;
  let installed = false;
  let rafId = 0;
  let lastTs = 0;
  let configTimer = 0;

  // ---- 速度上限三源：配置 / 实测 / 兜底 ----
  let configSpeed = null;          // 服务端 limits.movementSpeed
  let configFetchedAt = 0;
  let observedSpeed = 0;           // 实测目标点位移速率（EMA）
  let effectiveMaxSpeed = DEFAULT_MAX_SPEED;

  // ---- 诊断计数 ----
  let snapCount = 0;
  let lastSnap = null;             // { distance, hard }
  let maxObservedLag = 0;          // 目标点与显示点的最大滞后（诊断用）

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

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /** 重新计算生效上限：max(配置跟随, 自适应兜底) → 夹取到 [MIN, MAX] */
  function recomputeLimit() {
    const fromConfig = (Number.isFinite(configSpeed) && configSpeed > 0)
      ? configSpeed * SPEED_MARGIN : 0;
    const fromObserved = observedSpeed > 0 ? observedSpeed * ADAPT_MARGIN : 0;
    effectiveMaxSpeed = clamp(Math.max(MIN_MAX_SPEED, fromConfig, fromObserved), MIN_MAX_SPEED, MAX_MAX_SPEED);
  }

  /** 拉取服务端 Agent 最大移动速度（公开端点，无需鉴权）；失败保留兜底值 */
  function refreshServerSpeed() {
    if (Date.now() - configFetchedAt < CONFIG_TTL_MS) return;
    configFetchedAt = Date.now();
    try {
      fetch('/.well-known/virtual-world-agent.json', { cache: 'no-store' })
        .then(r => r.json())
        .then(j => {
          const v = j && j.limits && Number(j.limits.movementSpeed);
          if (Number.isFinite(v) && v > 0) {
            if (v !== configSpeed) {
              configSpeed = v;
              recomputeLimit();
              console.log(`[AgentSmoother] 服务端速度 ${v} m/s → 追赶上限 ${effectiveMaxSpeed.toFixed(1)} m/s`);
            }
          }
        })
        .catch(() => { /* 端点不可用：靠自适应兜底 */ });
    } catch (e) { /* fetch 不可用（老浏览器）：靠自适应兜底 */ }
  }

  function step(ts) {
    rafId = requestAnimationFrame(step);
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.1, (ts - lastTs) / 1000);   // 上限 100ms，防切后台瞬移
    lastTs = ts;
    if (!gameWorld || !origUpdate) return;

    const limit = effectiveMaxSpeed;
    for (const [cid, t] of tracks.entries()) {
      if (!isAgent(cid)) { tracks.delete(cid); continue; }
      const d = dist2D(t.cur, t.target);
      if (d > maxObservedLag) maxObservedLag = d;
      const yChanged = t.cur.y !== t.target.y;
      if (d <= ARRIVE_EPSILON) {
        // 注意：t.arrived 只表示"水平方向已到位"。纯垂直变化（跳跃/落地）必须照常下发，
        // 否则 Agent 原地起跳时真人端一点变化都看不到（T2 验收实测 Δ0 的真实原因）。
        if (!t.arrived || yChanged) {
          t.cur = clonePos(t.target);
          const argsStop = t.lastArgs.slice();
          argsStop[0] = cid;
          argsStop[1] = clonePos(t.cur);
          while (argsStop.length < 5) argsStop.push(undefined);
          argsStop[4] = t.yaw;
          origUpdate.apply(gameWorld, argsStop);
          t.arrived = true;
        }
        continue;
      }
      t.arrived = false;
      const maxStep = limit * dt;
      const ratio = d <= maxStep ? 1 : maxStep / d;
      t.cur.x += (t.target.x - t.cur.x) * ratio;
      t.cur.z += (t.target.z - t.cur.z) * ratio;
      // Y 直接跟随（服务器端已做贴地 + 垂直偏移，见 websocket.js snapAgentPosition），
      // 不做平滑避免上下抖动；跳跃的抬升因此是即时可见的。
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

  /**
   * 目标点是否为大跳变（重连/传送）：需连续 N 次超阈值，超远立即判定。
   * @returns 判定为跳变时返回 { distance, hard }，否则 null
   */
  function decideSnap(t, target) {
    const jump = dist2D(t.cur, target);
    if (jump <= SNAP_DISTANCE) { t.snapStreak = 0; return null; }
    if (jump > SNAP_HARD_DISTANCE) { t.snapStreak = 0; return { distance: jump, hard: true }; }
    t.snapStreak = (t.snapStreak || 0) + 1;
    return t.snapStreak >= SNAP_PERSIST_EVENTS ? { distance: jump, hard: false } : null;
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
          arrived: true,
          snapStreak: 0,
          lastTargetAt: 0
        });
        return origUpdate.call(this, cid, position, ...rest);
      }

      // 自适应兜底：按"目标点位移速率"更新 EMA（跳变样本不参与）
      const now = performance.now();
      if (existing.lastTargetAt) {
        const dtSec = (now - existing.lastTargetAt) / 1000;
        if (dtSec > 0.005 && dtSec < 1.5) {
          const rate = dist2D(existing.target, target) / dtSec;
          if (rate > 1 && rate < MAX_PLAUSIBLE_RATE) {
            observedSpeed = observedSpeed > 0 ? (observedSpeed * 0.7 + rate * 0.3) : rate;
            recomputeLimit();
          }
        }
      }
      existing.lastTargetAt = now;

      const snap = decideSnap(existing, target);
      if (snap) {
        existing.snapStreak = 0;
        existing.cur = clonePos(target);
        snapCount++;
        lastSnap = { distance: Number(snap.distance.toFixed(2)), hard: snap.hard };
      }
      existing.target = target;
      existing.animMode = rest[1];
      existing.rotation = rest[2];
      existing.lastArgs = [cid, position, ...rest];
      // 目标更新不立即落位 —— 交给 rAF 逼近（保留摆臂动画）
      return undefined;
    };

    installed = true;
    refreshServerSpeed();
    if (!configTimer) {
      configTimer = setInterval(refreshServerSpeed, CONFIG_TTL_MS);
      if (configTimer.unref) configTimer.unref();   // Node 环境（验收脚本）下不阻塞退出
    }
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
    if (configTimer) { clearInterval(configTimer); configTimer = 0; }
    installed = false;
  }

  // gameWorld 由 main.js 异步创建，轮询等待（不依赖脚本加载顺序）
  const bootTimer = setInterval(() => {
    if (install()) {
      clearInterval(bootTimer);
      console.log(`[AgentSmoother] 已安装（仅作用于 Agent；上限跟随服务端配置，当前 ${effectiveMaxSpeed.toFixed(1)}m/s）`);
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
        // 生效上限（r3 验收断言用）：应 ≥ 服务端 limits.movementSpeed
        maxSpeed: Number(effectiveMaxSpeed.toFixed(2)),
        configSpeed,
        observedSpeed: Number(observedSpeed.toFixed(2)),
        snaps: snapCount,
        maxObservedLag: Number(maxObservedLag.toFixed(2)),
        lastSnap: lastSnap ? { hard: lastSnap.hard } : null
      };
    }
  };
})();
