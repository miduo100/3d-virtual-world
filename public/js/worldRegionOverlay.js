/**
 * worldRegionOverlay —— 世界编辑器「AI 区域围栏」只读可视化（AI World Brain · Phase 3.5-3）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 设计约束（提示词 3 §2.1②）：
 *   - 只读渲染：只画线框 + 名牌，不改任何场景逻辑、不拦截任何编辑器事件；
 *   - 数据来自 GET /api/world-ai/regions（管理员 token，编辑器页面本来就要求管理员登录）；
 *   - 编辑器页面天然处于编辑模式 → 常显；提供左下角悬浮开关手动隐藏（状态记忆在 localStorage）；
 *   - 不改 world.js / world_editor.html 既有代码（后者只加 1 行 script 引入本文件）。
 *
 * 技术要点：
 *   - 编辑器 inline 脚本里 `let scene` 是**全局词法绑定**（非 window 属性），且本文件在它之前
 *     加载 → 直接引用会踩 TDZ。所有访问都延迟到函数内 + try/catch 兜底（含 window.scene 备选）；
 *   - 区域 bounds 口径与 regionService/boundsGuard 一致：{ x, z, width, depth }（rect）；
 *   - 颜色按自主度：managed 橙 / semi_autonomous 绿 / autonomous 蓝。
 */
(function () {
  'use strict';
  if (window.WorldRegionOverlay) return; // 幂等（热重载/重复引入保护）

  var PREF = 'worldRegionOverlay';
  var LS_KEY = 'worldRegionOverlay.visible';
  var state = { visible: localStorage.getItem(LS_KEY) !== '0', group: null, timer: null, scenePoll: null, ready: false };

  function getScene() {
    try {
      if (typeof scene !== 'undefined' && scene && scene.isScene) return scene; // 编辑器全局词法绑定
    } catch (e) { /* TDZ（inline 脚本尚未执行）属常态 */ }
    if (window.scene && window.scene.isScene) return window.scene;
    return null;
  }
  function getTHREE() { return window.THREE || null; }

  var AUTONOMY_COLORS = { managed: 0xff8c1a, semi_autonomous: 0x22bb66, autonomous: 0x2f8bff };
  function colorOf(a) { return AUTONOMY_COLORS[a] != null ? AUTONOMY_COLORS[a] : 0xaaaaaa; }
  function autonomyLabel(a) {
    return a === 'managed' ? '受管' : (a === 'semi_autonomous' ? '半自主' : (a === 'autonomous' ? '自主' : String(a || '?')));
  }

  /** 区域名牌（Canvas 纹理 Sprite：区域名 + 自主度徽标，始终朝向相机） */
  function makeLabel(text, sub, colorHex) {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 160;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(10,14,22,0.72)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#' + colorHex.toString(16).padStart(6, '0');
    ctx.lineWidth = 6; ctx.strokeRect(3, 3, cv.width - 6, cv.height - 6);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 56px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(text || '').slice(0, 18), cv.width / 2, 58);
    ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
    ctx.font = '44px "Microsoft YaHei", sans-serif';
    ctx.fillText('ⓐ ' + String(sub || ''), cv.width / 2, 118);
    var THREE = getTHREE();
    if (!THREE) return null;
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    var sp = new THREE.Sprite(mat);
    sp.scale.set(8, 2.5, 1);
    return sp;
  }

  /** 画一个区域的线框 + 名牌（纯新增，不触碰任何既有对象） */
  function drawRegion(THREE, region) {
    var g = new THREE.Group();
    g.name = '__aiRegionOverlay__' + region.region_key;
    g.userData.__aiRegionOverlay = true;
    var b = region.bounds || {};
    var x0 = Number(b.x != null ? b.x : b.minX) || 0;
    var z0 = Number(b.z != null ? b.z : b.minZ) || 0;
    var w = Number(b.width) || 0, d = Number(b.depth) || 0;
    if (w <= 0 || d <= 0) return g;
    var y = 0.25;
    var color = colorOf(region.autonomy);
    var pts = [
      new THREE.Vector3(x0, y, z0), new THREE.Vector3(x0 + w, y, z0),
      new THREE.Vector3(x0 + w, y, z0 + d), new THREE.Vector3(x0, y, z0 + d),
      new THREE.Vector3(x0, y, z0)
    ];
    var line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.9, depthTest: false })
    );
    line.renderOrder = 999;
    g.add(line);
    var label = makeLabel(region.name || region.region_key, autonomyLabel(region.autonomy) + ' · ' + region.region_key, color);
    if (label) {
      label.position.set(x0 + Math.min(w / 2, 10), y + 3.2, z0 + Math.min(d / 2, 10));
      label.renderOrder = 1000;
      g.add(label);
    }
    return g;
  }

  function clearAll(sceneObj) {
    if (!state.group || !sceneObj) return;
    for (var i = state.group.children.length - 1; i >= 0; i--) {
      var c = state.group.children[i];
      state.group.remove(c);
      c.traverse && c.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    if (state.group.parent) state.group.parent.remove(state.group);
    state.group = null;
  }

  function applyVisibility() {
    if (state.group) state.group.visible = state.visible;
    if (state.btn) state.btn.textContent = state.visible ? '🧠 AI 围栏：开' : '🧠 AI 围栏：关';
  }

  /** 拉取区域并重画（只读；失败静默——编辑器不被本模块打扰） */
  function refresh() {
    var sceneObj = getScene();
    var THREE = getTHREE();
    if (!sceneObj || !THREE) return Promise.resolve(false);
    var headers = {};
    try {
      var tk = localStorage.getItem('adminToken');
      if (tk) headers.Authorization = 'Bearer ' + tk;
    } catch (e) { /* ignore */ }
    return fetch('/api/world-ai/regions', { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        clearAll(sceneObj);
        if (!j || !j.success || !Array.isArray(j.regions) || !j.regions.length) { applyVisibility(); return true; }
        var root = new THREE.Group();
        root.name = '__aiRegionOverlayRoot__';
        root.userData.__aiRegionOverlay = true;
        j.regions.forEach(function (r) { root.add(drawRegion(THREE, r)); });
        sceneObj.add(root);
        state.group = root;
        applyVisibility();
        return true;
      })
      .catch(function () { return false; });
  }

  /** 悬浮开关（自注入，不依赖编辑器 DOM 结构） */
  function ensureButton() {
    if (state.btn || !document.body) return;
    var btn = document.createElement('button');
    btn.id = 'wro-toggle-btn';
    btn.textContent = state.visible ? '🧠 AI 围栏：开' : '🧠 AI 围栏：关';
    btn.style.cssText = 'position:fixed;left:12px;bottom:96px;z-index:1500;padding:4px 10px;font-size:12px;'
      + 'background:rgba(20,26,38,0.85);color:#cfe3ff;border:1px solid #35507a;border-radius:6px;cursor:pointer;';
    btn.onclick = function () {
      state.visible = !state.visible;
      try { localStorage.setItem(LS_KEY, state.visible ? '1' : '0'); } catch (e) { /* ignore */ }
      applyVisibility();
    };
    document.body.appendChild(btn);
    state.btn = btn;
  }

  function start() {
    if (state.ready) return;
    state.ready = true;
    ensureButton();
    window.WorldRegionOverlay = {
      refresh: refresh,
      show: function () { state.visible = true; applyVisibility(); },
      hide: function () { state.visible = false; applyVisibility(); },
      isVisible: function () { return state.visible; },
      _diag: function () { return { visible: state.visible, hasGroup: !!state.group, regions: state.group ? state.group.children.length : 0 }; }
    };
    // 编辑器场景是异步初始化的：轮询到 scene 出现再首次拉取
    state.scenePoll = setInterval(function () {
      if (!getScene()) return;
      clearInterval(state.scenePoll);
      state.scenePoll = null;
      refresh();
      state.timer = setInterval(refresh, 60000); // 后台改了围栏 60s 内跟进
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
