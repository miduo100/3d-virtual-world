/**
 * terrainZoneOverlay —— 世界编辑器「🗺️ 地形」只读可视化
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 在 world_editor.html 里画出所有地形的框（位置 + 面积 + 名称 + 基准高度），
 * 让后台填的"中心/宽深/基准 Y"能和编辑器里的实际位置对得上。
 *
 * 只读：只画线框 + 名牌，不改场景逻辑、不拦截编辑器事件；world_editor.html 只加 1 行 script。
 */
(function () {
  'use strict';
  if (window.TerrainZoneOverlay) return;

  var LS_KEY = 'terrainZoneOverlay.visible';
  var state = { visible: localStorage.getItem(LS_KEY) !== '0', group: null, btn: null, timer: null, poll: null, ready: false, count: 0, names: '' };

  function getScene() {
    try {
      if (typeof scene !== 'undefined' && scene && scene.isScene) return scene;
    } catch (e) { /* TDZ 属常态 */ }
    if (window.scene && window.scene.isScene) return window.scene;
    return null;
  }
  function getTHREE() { return window.THREE || null; }

  function makeLabel(text, sub, colorHex) {
    var THREE = getTHREE();
    if (!THREE) return null;
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 160;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(8,16,28,0.78)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#' + colorHex.toString(16).padStart(6, '0');
    ctx.lineWidth = 6; ctx.strokeRect(3, 3, cv.width - 6, cv.height - 6);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(text || '').slice(0, 16), cv.width / 2, 56);
    ctx.fillStyle = '#7db6ff';
    ctx.font = '40px "Microsoft YaHei", sans-serif';
    ctx.fillText(String(sub || ''), cv.width / 2, 116);
    var tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    var sp = new THREE.Sprite(mat);
    var wide = Math.min(120, Math.max(30, (Number(state._maxSize) || 2000) / 40));
    sp.scale.set(wide, wide * 0.31, 1);
    return sp;
  }

  function drawTerrain(THREE, t) {
    var g = new THREE.Group();
    g.name = '__terrainAreaOverlay__' + t.id;
    g.userData.__terrainAreaOverlay = true;
    var a = t.area || {};
    var w = Number(a.width) || 0, d = Number(a.depth) || 0;
    if (!(w > 0 && d > 0)) return g;
    var cx = Number(a.x) || 0, cz = Number(a.z) || 0;
    var y = (Number(a.baseY) || 0) + 0.6;   // ★ 框画在各自基准高度上
    var x0 = cx - w / 2, x1 = cx + w / 2;
    var z0 = cz - d / 2, z1 = cz + d / 2;
    var color = t.active === false ? 0x8899aa : 0x2f8bff;

    var pts = [
      new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0),
      new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1),
      new THREE.Vector3(x0, y, z0)
    ];
    var line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.95, depthTest: false })
    );
    line.renderOrder = 998;
    g.add(line);

    var diag = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z1)]),
      new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.3, depthTest: false })
    );
    diag.renderOrder = 998;
    g.add(diag);

    var sub = Math.round(w) + '×' + Math.round(d) + (a.baseY ? ' · Y=' + a.baseY : '') +
      ' @ (' + Math.round(cx) + ',' + Math.round(cz) + ')';
    var label = makeLabel(t.name || ('地形 ' + t.id), sub, color);
    if (label) {
      label.position.set(cx, y + Math.max(20, w / 40), cz);
      label.renderOrder = 1000;
      g.add(label);
    }
    return g;
  }

  function clearAll() {
    if (!state.group) return;
    for (var i = state.group.children.length - 1; i >= 0; i--) {
      var c = state.group.children[i];
      state.group.remove(c);
      if (c.traverse) {
        c.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
          }
        });
      }
    }
    if (state.group.parent) state.group.parent.remove(state.group);
    state.group = null;
  }

  function applyVisibility() {
    if (state.group) state.group.visible = state.visible;
    if (state.btn) {
      state.btn.textContent = state.visible
        ? ('🗺️ 地形框：开' + (state.count ? '（' + state.count + '）' : ''))
        : '🗺️ 地形框：关';
    }
  }

  function refresh() {
    var sceneObj = getScene();
    var THREE = getTHREE();
    if (!sceneObj || !THREE) return Promise.resolve(false);
    return fetch('/api/terrain/world', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        clearAll();
        var list = (j && Array.isArray(j.terrains)) ? j.terrains : [];
        state.count = list.length;
        state._maxSize = list.reduce(function (m, t) { return Math.max(m, Number(t.area && t.area.width) || 0); }, 0);
        if (!list.length) { applyVisibility(); return true; }
        var root = new THREE.Group();
        root.name = '__terrainAreaOverlayRoot__';
        root.userData.__terrainAreaOverlay = true;
        list.forEach(function (t) { root.add(drawTerrain(THREE, t)); });
        sceneObj.add(root);
        state.group = root;
        applyVisibility();
        if (state.btn) state.btn.title = list.map(function (t) { return t.name; }).join(' / ');
        return true;
      })
      .catch(function () { return false; });
  }

  function start() {
    if (state.ready) return;
    state.ready = true;
    // 开关统一放到「🗺️ 地形」面板里（不再自注入左下角悬浮按钮，避免与面板重复）
    window.TerrainZoneOverlay = {
      refresh: refresh,
      show: function () {
        state.visible = true;
        try { localStorage.setItem(LS_KEY, '1'); } catch (e) { /* ignore */ }
        applyVisibility();
      },
      hide: function () {
        state.visible = false;
        try { localStorage.setItem(LS_KEY, '0'); } catch (e) { /* ignore */ }
        applyVisibility();
      },
      isVisible: function () { return state.visible; },
      setVisible: function (on) { if (on) this.show(); else this.hide(); },
      _diag: function () { return { visible: state.visible, hasGroup: !!state.group, terrains: state.count }; }
    };
    state.poll = setInterval(function () {
      if (!getScene()) return;
      clearInterval(state.poll);
      state.poll = null;
      refresh();
      state.timer = setInterval(refresh, 60000);
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
