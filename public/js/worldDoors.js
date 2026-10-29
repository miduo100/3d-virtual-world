/**
 * worldDoors —— 世界里的门可以按 F 开关（前端旁路模块 · world.js 零改动）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 能力：
 *   ① 自动识别：模型里名字叫 door / gate 的节点（其子树有 Mesh、尺寸像门）即可开关
 *      —— 不写死模型 URL，以后新放同类房子自动生效；door-mount/frame/hinge 视为支架不转
 *   ② 走近 5m 内显示「F 开门 / F 关门」，按 F 绕竖直轴缓动 ±90°（朝远离玩家的一侧开）
 *   ③ 开关后调用 CapsuleCollision.refresh(id) 重建碰撞 —— 否则门开了人还是撞空气墙
 *   ④ 状态持久化读 world_objects.custom_config.doors（API 已随对象下发）；
 *      开关走 POST /api/world-doors/toggle，服务端校验位置并广播 DOOR_STATE 给附近玩家
 *   ⑤ 带门的模型打 __excludeFromMerge，防止同 URL ≥6 个时被合批成 InstancedMesh（门就转不动了）
 *
 * 诊断口：window.WorldDoors._diag() / .list() / .toggle(objectId, doorId, open)
 */
(function () {
  'use strict';

  const VERSION = 'v1.0.2';
  const SCAN_MS = 2000;         // 扫描新入场模型
  const PROMPT_TICK_MS = 200;   // 提示/距离刷新
  const PROMPT_RADIUS = 5;      // 提示半径（米）
  const ANIM_MS = 420;          // 开合动画时长
  const OPEN_ANGLE = Math.PI / 2;

  // 只认门类节点名；door-mount / door-frame / hinge 是支架与合页本体，不能转
  const DOOR_RE = /^(door|doors|gate|gates)([-_][a-z0-9]+)*$/i;
  const FIXTURE_RE = /(mount|frame|hinge|handle|knob|lock|sign|bell)/i;

  const state = {
    registry: new Map(),   // objectId -> { model, doors: [door] }
    nearest: null,         // { door, dist }
    busy: false,
    lastScanAt: 0,
    lastPromptAt: 0,
    lastError: null,
    remoteApplied: 0,
    patched: false,
  };

  let promptEl = null, toastEl = null;
  const anims = [];  // { door, from, to, start, done }

  // ── 工具 ────────────────────────────────────────────────────────────
  function T() { return window.THREE; }
  function token() { return localStorage.getItem('token') || ''; }
  function characterId() {
    return localStorage.getItem('characterId')
      || (window.GAME_STATE && window.GAME_STATE.characterId)
      || '';
  }
  function playerPos() {
    try {
      const p = window.player && window.player.position;
      return p ? { x: p.x, y: p.y, z: p.z } : null;
    } catch (e) { return null; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function ensureDom() {
    if (document.getElementById('wd-prompt')) return;
    const style = document.createElement('style');
    style.textContent = [
      '#wd-prompt{position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:881;',
      'background:rgba(12,20,32,.85);color:#fff;padding:9px 16px;border-radius:10px;font-size:14px;',
      'border:1px solid rgba(255,205,120,.5);display:none;pointer-events:none;backdrop-filter:blur(4px)}',
      '#wd-prompt b{color:#ffd97f;margin-right:8px}',
      '#wd-toast{position:fixed;left:50%;top:20%;transform:translateX(-50%);z-index:886;',
      'background:rgba(20,30,45,.95);color:#e8eef8;padding:10px 16px;border-radius:10px;',
      'border:1px solid rgba(120,180,255,.4);display:none;max-width:70vw;font-size:13px}',
    ].join('');
    document.head.appendChild(style);

    promptEl = document.createElement('div');
    promptEl.id = 'wd-prompt';
    document.body.appendChild(promptEl);

    toastEl = document.createElement('div');
    toastEl.id = 'wd-toast';
    document.body.appendChild(toastEl);
  }

  function toast(html, ms) {
    if (!toastEl) return;
    toastEl.innerHTML = html;
    toastEl.style.display = 'block';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.style.display = 'none'; }, ms || 3600);
  }

  // ── 识别门节点 ───────────────────────────────────────────────────────
  function hasMeshBelow(node) {
    let found = false;
    node.traverse((o) => { if (o.isMesh) found = true; });
    return found;
  }

  /**
   * 【2026-10-29 修复"开关门模型闪"】Polyfork 等低模的门材质是单面（doubleSided=false），
   * 门转 90° 后玩家看到的是背面 → 背面剔除让它整块消失，看起来"闪一下又回来"。
   * 修法：门子树材质 clone 一份并设 DoubleSide（必须 clone：门与车身共用材质，
   * 就地改会让整辆车变双面）。门只有 1~2 个网格，性能影响可忽略。
   */
  function ensureDoubleSided(node) {
    const THREE = T();
    if (!THREE) return 0;
    let changed = 0;
    node.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = mats.map((m) => {
        if (!m) return m;
        if (m.side === THREE.DoubleSide) return m;
        const c = m.clone();
        c.side = THREE.DoubleSide;
        c.needsUpdate = true;
        changed++;
        return c;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
    });
    return changed;
  }

  function detectDoors(entry) {
    const THREE = T();
    if (!THREE || !entry || !entry.model) return [];
    const model = entry.model;
    model.updateWorldMatrix(true, true);

    const candidates = [];
    model.traverse((o) => {
      if (!o.name || !DOOR_RE.test(o.name)) return;
      if (FIXTURE_RE.test(o.name)) return;
      if (!hasMeshBelow(o)) return;
      candidates.push(o);
    });
    if (!candidates.length) return [];

    // 只保留最外层（door 与 door-leaf 同时命中时用 door；否则会双层旋转）
    const top = candidates.filter((o) => {
      let cur = o.parent;
      while (cur) {
        if (candidates.indexOf(cur) >= 0) return false;
        cur = cur.parent;
      }
      return true;
    });

    // 整栋房子的包围盒：既用于"玩家是否站在模型上"（决定要不要推迟刷碰撞），
    // 也用于开门方向（门应朝远离房屋主体的方向开，避免打进墙里穿模）
    const modelBox = new THREE.Box3().setFromObject(model);

    const doors = [];
    top.forEach((node) => {
      const box = new THREE.Box3().setFromObject(node);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        const h = size.y;
        const maxSide = Math.max(size.x, size.z);
        const minSide = Math.min(size.x, size.z);
        // 尺寸像门才收：高 0.8~8m、面宽 0.3~8m、厚度 ≤1.2m
        if (h < 0.8 || h > 8 || maxSide < 0.3 || maxSide > 8 || minSide > 1.2) return;
      }
      ensureDoubleSided(node);
      doors.push({
        objectId: entry.id || entry.data.id,
        id: node.name,           // 服务端持久化键（doorId）
        node,
        baseY: node.rotation.y,
        openAngle: -OPEN_ANGLE,
        open: false,
        animating: false,
        modelBox: modelBox,
        modelCenter: modelBox.isEmpty() ? null : modelBox.getCenter(new THREE.Vector3()),
      });
    });
    return doors;
  }

  function applySavedState(entry, doors) {
    if (!doors.length) return;
    let cfg = entry && entry.data && entry.data.custom_config;
    if (typeof cfg === 'string') {
      try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; }
    }
    const saved = (cfg && cfg.doors) || {};
    doors.forEach((d) => {
      const st = saved[d.id];
      if (st && st.open === true) {
        d.open = true;
        d.node.rotation.y = d.baseY + d.openAngle;
      }
    });
  }

  // ── 扫描注册 ─────────────────────────────────────────────────────────
  function scan() {
    const gb = window.gameWorld && window.gameWorld.generatedBuildings;
    if (!gb || !gb.forEach) return;

    const alive = new Set();
    gb.forEach((entry, id) => {
      if (!entry || entry.isPlaceholder || !entry.model) return;
      alive.add(id);
      const rec = state.registry.get(id);
      if (rec && rec.model === entry.model) return;      // 已处理且模型没换
      if (rec) state.registry.delete(id);                 // 模型被卸载重建 → 重新识别

      const doors = detectDoors(entry);
      if (!doors.length) return;

      // 带门的模型禁止合批（同 URL ≥6 实例时会被实例化成 InstancedMesh，门就转不动）
      try { entry.model.userData.__excludeFromMerge = true; } catch (e) { /* 忽略 */ }

      applySavedState(entry, doors);
      state.registry.set(id, { model: entry.model, doors });
      console.info('[WorldDoors] 识别到 ' + doors.length + ' 扇门（对象 ' + id + '：' +
        doors.map((d) => d.id).join(',') + '）');
    });

    // 清理已卸载对象
    Array.from(state.registry.keys()).forEach((id) => {
      if (!alive.has(id)) state.registry.delete(id);
    });
  }

  // ── 距离 + 提示 ───────────────────────────────────────────────────────
  function allDoors() {
    const out = [];
    state.registry.forEach((rec) => { rec.doors.forEach((d) => out.push(d)); });
    return out;
  }

  function updatePrompt() {
    if (!promptEl) return;
    const p = playerPos();
    if (!p) { promptEl.style.display = 'none'; state.nearest = null; return; }
    const THREE = T();
    if (!THREE) return;

    let best = null, bestD = Infinity;
    const wp = new THREE.Vector3();
    allDoors().forEach((d) => {
      d.node.getWorldPosition(wp);
      const dist = Math.hypot(p.x - wp.x, p.z - wp.z);
      const dy = Math.abs((p.y + 1.0) - (wp.y + 1.2));
      if (dist <= PROMPT_RADIUS && dy <= 3.5 && dist < bestD) { best = d; bestD = dist; }
    });

    state.nearest = best ? { door: best, dist: bestD } : null;
    if (!best) { promptEl.style.display = 'none'; return; }
    promptEl.innerHTML = '<b>F</b>' + (best.open ? '关门' : '开门') +
      ' <span style="opacity:.6">(' + bestD.toFixed(1) + 'm)</span>';
    promptEl.style.display = 'block';
  }

  // ── 开关动作 ─────────────────────────────────────────────────────────
  /**
   * 【2026-10-29 修复"开门打到角色"】旧实现按"门本地 +Z"判玩家在哪一侧，与门板实际
   * 延伸方向无关 → 会把门朝玩家方向转，门板扫过角色（看着像被切一下 / 角色一闪）。
   * 新算法（物理语义）：门板从关闭姿态转到目标姿态会扫过 90° 扇形，
   *   ① 优先选扫掠扇形**不包含玩家**的方向；
   *   ② 两个方向都安全时，选门板端点**离房屋主体更远**的（避免往墙里打、穿模闪烁）。
   */
  function computeOpenAngle(door) {
    const THREE = T();
    if (!THREE) return -OPEN_ANGLE;
    const node = door.node;
    const hinge = new THREE.Vector3();
    node.getWorldPosition(hinge);
    const box = new THREE.Box3().setFromObject(node);
    const center = box.isEmpty() ? hinge.clone() : box.getCenter(new THREE.Vector3());
    const arm = new THREE.Vector3(center.x - hinge.x, 0, center.z - hinge.z);
    if (arm.lengthSq() < 1e-6) return -OPEN_ANGLE;

    const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const angOf = (x, z) => Math.atan2(x, z);
    const axis = new THREE.Vector3(0, 1, 0);
    const p = playerPos();
    const mc = door.modelCenter;

    const pv = p ? { x: p.x - hinge.x, z: p.z - hinge.z } : null;
    const playerDist = pv ? Math.hypot(pv.x, pv.z) : Infinity;
    const playerAng = pv ? angOf(pv.x, pv.z) : 0;
    const armAng = angOf(arm.x, arm.z);

    // 该方向下门板扫过的扇形是否包含玩家（容差 8°）
    const swept = (sign) => {
      if (!pv || playerDist > 12) return false;
      let d = norm(playerAng - armAng);
      if (sign < 0) d = -d;
      d = (d + 2 * Math.PI) % (2 * Math.PI);
      return d <= OPEN_ANGLE + 0.14;
    };

    const candidates = [OPEN_ANGLE, -OPEN_ANGLE];
    const safe = candidates.filter((s) => !swept(s));
    if (safe.length === 1) return safe[0];
    const pick = safe.length ? safe : candidates;
    if (!mc) return pick[0];

    const score = (sign) => {
      const c = arm.clone().applyAxisAngle(axis, sign).add(hinge);
      return Math.hypot(c.x - mc.x, c.z - mc.z);
    };
    if (pick.length === 1) return pick[0];
    return score(pick[0]) >= score(pick[1]) ? pick[0] : pick[1];
  }

  function animateTo(door, targetY, immediate, onDone) {
    if (immediate) {
      door.node.rotation.y = targetY;
      door.animating = false;
      if (onDone) onDone();
      return;
    }
    // 同一扇门重复触发 → 覆盖旧动画
    for (let i = anims.length - 1; i >= 0; i--) {
      if (anims[i].door === door) anims.splice(i, 1);
    }
    door.animating = true;
    anims.push({ door, from: door.node.rotation.y, to: targetY, start: performance.now(), done: onDone });
  }

  function refreshCollision(objectId) {
    try {
      const C = window.CapsuleCollision;
      if (C && typeof C.refresh === 'function') C.refresh(objectId);
    } catch (e) { /* 碰撞未启用或模型超限，静默 */ }
  }

  /**
   * 【2026-10-29 修复"开关门角色跳一下"】CapsuleCollision.refresh 是**整模型**级：
   * 它会先把该模型全部网格的 BVH 释放、再分帧重建，这期间模型表面碰撞是空的。
   * 玩家如果正站在这个模型上（房子地板/车顶），脚下会瞬间失去支撑 → 掉一下、建好后被顶回。
   * 对策：玩家在该模型包围盒内时推迟到离开包围盒（或 3s 兜底）再刷。
   */
  const pendingRefresh = new Map();   // objectId -> { at, deadline }

  function scheduleCollisionRefresh(door) {
    const THREE = T();
    const p = playerPos();
    let inside = false;
    if (THREE && p && door.modelBox && !door.modelBox.isEmpty()) {
      const v = new THREE.Vector3(p.x, p.y, p.z);
      inside = door.modelBox.clone().expandByScalar(0.6).containsPoint(v);
    }
    if (!inside) { refreshCollision(door.objectId); return; }
    pendingRefresh.set(door.objectId, { at: performance.now(), deadline: performance.now() + 3000 });
  }

  function flushPendingRefresh(now) {
    if (!pendingRefresh.size) return;
    const THREE = T();
    const p = playerPos();
    Array.from(pendingRefresh.entries()).forEach(([objectId, rec]) => {
      let inside = false;
      const doorRec = state.registry.get(objectId) || state.registry.get(String(objectId));
      const box = doorRec && doorRec.doors[0] && doorRec.doors[0].modelBox;
      if (THREE && p && box && !box.isEmpty()) {
        inside = box.clone().expandByScalar(0.6).containsPoint(new THREE.Vector3(p.x, p.y, p.z));
      }
      if (!inside || now >= rec.deadline) {
        refreshCollision(objectId);
        pendingRefresh.delete(objectId);
      }
    });
  }

  function setDoor(door, open, opts) {
    const immediate = !!(opts && opts.immediate);
    if (open) door.openAngle = computeOpenAngle(door);
    door.open = open;
    const targetY = open ? (door.baseY + door.openAngle) : door.baseY;
    animateTo(door, targetY, immediate, () => {
      if (!(opts && opts.skipCollision)) scheduleCollisionRefresh(door);
    });
  }

  async function toggleDoor(door) {
    if (!door || state.busy) return;
    const target = !door.open;
    if (!token()) {
      toast('⚠️ 请先登录后再开关门（游客只能看）');
      return;
    }
    const cid = characterId();
    if (!cid) { toast('⚠️ 未找到角色信息，请重新进入世界'); return; }

    state.busy = true;
    const prevOpen = door.open;
    setDoor(door, target);   // 乐观播放
    try {
      const r = await fetch('/api/world-doors/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        body: JSON.stringify({ objectId: door.objectId, doorId: door.id, open: target, characterId: cid }),
      });
      let j = {};
      try { j = await r.json(); } catch (e) { /* 空 body */ }
      if (!r.ok || j.success === false) {
        setDoor(door, prevOpen);   // 回滚
        toast('❌ ' + esc(j.error || ('开门失败（HTTP ' + r.status + '）')));
      }
    } catch (e) {
      setDoor(door, prevOpen);
      toast('❌ 网络异常，开门失败');
    } finally {
      state.busy = false;
    }
  }

  // ── 多人同步 ─────────────────────────────────────────────────────────
  function onRemoteState(payload) {
    if (!payload) return;
    const rec = state.registry.get(payload.objectId);
    if (!rec) return;   // 模型还没加载，走 custom_config 恢复即可
    const door = rec.doors.find((d) => d.id === payload.doorId);
    if (!door) return;
    const want = payload.open === true;
    if (door.open === want) return;
    state.remoteApplied++;
    setDoor(door, want);
  }

  /** 包装 WSClient.handleMessage 接 DOOR_STATE（不改 websocket.js） */
  function patchWs() {
    const W = window.WSClient;
    if (!W || typeof W.handleMessage !== 'function' || W.__worldDoorsPatched) return;
    const orig = W.handleMessage;
    W.handleMessage = function (data) {
      try {
        if (data && data.type === 'DOOR_STATE') onRemoteState(data.payload);
      } catch (e) { /* 不影响主流程 */ }
      return orig.apply(this, arguments);
    };
    W.__worldDoorsPatched = true;
    state.patched = true;
  }

  // ── 键盘 ─────────────────────────────────────────────────────────────
  // 2026-10-29 用户指定：开门/关门用 **F**（操作指南里 F 本来就写的是「交互」）。
  // F 的原功能是"开启/静音附近视频声音"(main.js)，两者共用：门在 5m 内时先开门并吞掉
  // 事件（capture 阶段 stopPropagation，main.js 的冒泡监听收不到）；门不在范围内则照旧放行。
  function isTyping(e) {
    const t = e.target && e.target.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || (e.target && e.target.isContentEditable);
  }

  function onKeyDown(e) {
    if (e.key !== 'f' && e.key !== 'F') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e)) return;
    if (!state.nearest || !state.nearest.door) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    toggleDoor(state.nearest.door);
  }

  // ── 主循环 ───────────────────────────────────────────────────────────
  function stepAnims(now) {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      const k = Math.min(1, (now - a.start) / ANIM_MS);
      const e = 1 - Math.pow(1 - k, 3);  // ease-out cubic
      a.door.node.rotation.y = a.from + (a.to - a.from) * e;
      if (k >= 1) {
        a.door.node.rotation.y = a.to;
        a.door.animating = false;
        anims.splice(i, 1);
        if (typeof a.done === 'function') { try { a.done(); } catch (er) { /* 忽略 */ } }
      }
    }
  }

  function tick(now) {
    try {
      if (now - state.lastScanAt >= SCAN_MS) { state.lastScanAt = now; scan(); }
      if (now - state.lastPromptAt >= PROMPT_TICK_MS) {
        state.lastPromptAt = now;
        if (!state.patched) patchWs();
        updatePrompt();
      }
      stepAnims(now);
      flushPendingRefresh(now);
    } catch (e) {
      state.lastError = String((e && e.message) || e);
    }
    requestAnimationFrame(tick);
  }

  function start() {
    ensureDom();
    document.addEventListener('keydown', onKeyDown, true);
    patchWs();
    requestAnimationFrame(tick);
    console.info('[WorldDoors] ' + VERSION + ' 已启动（按 F 开关门）');
  }

  // ── 对外 ─────────────────────────────────────────────────────────────
  window.WorldDoors = {
    version: VERSION,
    toggle: function (objectId, doorId, open) {
      const rec = state.registry.get(Number(objectId)) || state.registry.get(objectId);
      if (!rec) return false;
      const door = rec.doors.find((d) => d.id === doorId) || rec.doors[0];
      if (!door) return false;
      setDoor(door, open === undefined ? !door.open : !!open);
      return true;
    },
    list: function () {
      return allDoors().map((d) => ({
        objectId: d.objectId, id: d.id, open: d.open,
        angle: +d.node.rotation.y.toFixed(3), baseY: +d.baseY.toFixed(3),
      }));
    },
    _diag: function () {
      return {
        version: VERSION,
        objects: state.registry.size,
        doors: allDoors().length,
        nearest: state.nearest ? { objectId: state.nearest.door.objectId, id: state.nearest.door.id, dist: +state.nearest.dist.toFixed(2) } : null,
        animating: anims.length,
        remoteApplied: state.remoteApplied,
        wsPatched: state.patched,
        lastError: state.lastError,
      };
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
