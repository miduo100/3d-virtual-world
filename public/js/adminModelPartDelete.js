/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 管理员模式 · 部件删除（2026-11-25）  v1
 * 依赖：AdminModelLightingTool（root / getConfig / setConfig / saveConfig）
 *       AdminModelSurfacePick（raycastAt / cancel）
 *       ModelSurface（makeTarget → path 口径，和部件发光共用同一套部件 ID）
 *
 * 做什么：点模型表面 → 选中那个部件 → 隐藏 → 写 world_objects.custom_config.hiddenParts
 *
 * 不做：不改模型文件（GLB 一个字都不动）
 *
 * 两个容易踩的点（本文件的设计依据）：
 *  1. 编辑期只设 visible=false，不摘节点 —— 摘节点会让后面兄弟的 children 索引前移，
 *     已存的 path 立刻失效，撤销就没法做了。
 *  2. 加载期必须摘节点（CustomConfigApplier.applyHiddenParts），不能只设不可见 ——
 *     three r185 的 Box3.setFromObject 会把 visible=false 的对象也算进包围盒，
 *     只设不可见会变成「看不见但撞得到」。
 *
 * 诊断：window.AdminModelPartDelete._diag()
 */
(function () {
  'use strict';
  if (window.__ADMIN_LIGHTING_OFF) return;
  if (window.AdminModelPartDelete) return;

  var active = false;
  var listeners = [];
  var saveTimer = null;

  function Tool() { return window.AdminModelLightingTool; }
  function Pick() { return window.AdminModelSurfacePick; }

  function notify(text, sub) {
    if (window.UI && UI.showNotification) UI.showNotification(text, sub || '', 2200);
  }

  function fire() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { console.warn('[PartDelete] 回调失败', e); }
    }
  }

  function onChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  // ---------------- 配置读写 ----------------
  // 存在 custom_config.hiddenParts，和 lighting / emissive 平级，互不覆盖。
  // 兼容两种形态：{ version, items:[] } 或裸数组（旧数据/手写配置）。

  function readHidden(cfg) {
    var hp = cfg && cfg.hiddenParts;
    if (!hp) return [];
    if (Array.isArray(hp)) return hp;
    return Array.isArray(hp.items) ? hp.items : [];
  }

  function writeHidden(cfg, items) {
    cfg.hiddenParts = { version: 1, items: items };
    return cfg;
  }

  // ---------------- 部件定位 ----------------

  /** "12/0" → 从 root 逐级 children[idx]，取不到返回 null */
  function resolve(root, path) {
    if (!root || !path) return null;
    var parts = String(path).split('/');
    var cur = root;
    for (var i = 0; i < parts.length; i++) {
      var k = parseInt(parts[i], 10);
      if (isNaN(k) || !cur.children || !cur.children[k]) return null;
      cur = cur.children[k];
    }
    return cur;
  }

  /** 稳定 ID（和 ModelSurface 的 path 同一口径，不依赖 mesh 名字） */
  function pathOf(root, mesh) {
    if (!window.ModelSurface || !window.ModelSurface.makeTarget) return '';
    try {
      return window.ModelSurface.makeTarget(root, mesh, 0).path || '';
    } catch (e) {
      return '';
    }
  }

  /** 可读标签：#序号 · 父节点名（减面后 mesh 名被 gltfpack 抹了，父节点名还在） */
  function labelOf(root, mesh) {
    var idx = -1;
    var n = 0;
    root.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData && (o.userData.isPickProxy || o.userData.__modelLightingHandle)) return;
      if (o === mesh) idx = n;
      n++;
    });
    var pname = (mesh.parent && mesh.parent.name) || '';
    return '#' + (idx < 0 ? '?' : idx) + (pname ? ' · ' + pname : '');
  }

  function trisOf(mesh) {
    var g = mesh && mesh.geometry;
    if (!g) return 0;
    if (g.index) return Math.round(g.index.count / 3);
    var pa = g.attributes && g.attributes.position;
    return pa ? Math.round(pa.count / 3) : 0;
  }

  // ---------------- 模式开关 ----------------

  function begin() {
    var t = Tool();
    if (!t || !t.hasTarget()) {
      notify('⚠️ 请先选中一个上传模型', '');
      return false;
    }
    // 三种模式互斥：删除 / 选部件发光 / 放灯
    if (window.AdminModelSurfacePick) window.AdminModelSurfacePick.cancel();
    if (t.isPlacing()) t.cancelPlace();
    active = true;
    fire();
    return true;
  }

  function cancel() {
    if (!active) return;
    active = false;
    fire();
  }

  function isActive() { return active; }

  // ---------------- 隐藏 / 恢复 ----------------

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var t = Tool();
      if (t && t.saveConfig) {
        t.saveConfig().catch(function (err) {
          notify('❌ 部件配置保存失败', err.message);
        });
      }
    }, 400);
  }

  function hideMesh(mesh) {
    var t = Tool();
    var root = t && t.getRoot();
    if (!root || !mesh) return false;

    var path = pathOf(root, mesh);
    if (!path) {
      notify('⚠️ 取不到部件路径', '请刷新页面后重试');
      return false;
    }

    var cfg = t.getConfig() || {};
    var items = readHidden(cfg);
    for (var i = 0; i < items.length; i++) {
      if (items[i].path === path) {
        notify('这个部件已经隐藏了', '');
        return false;
      }
    }

    var item = { path: path, label: labelOf(root, mesh), tris: trisOf(mesh) };
    items.push(item);
    writeHidden(cfg, items);

    mesh.visible = false;                    // 编辑期只关可见性，树结构不动
    if (mesh.userData) mesh.userData.__hiddenPart = true;

    t.setConfig(cfg);
    save();
    notify('已隐藏 ' + item.label, '正在自动保存…');
    fire();
    return true;
  }

  function restore(path) {
    var t = Tool();
    var root = t && t.getRoot();
    if (!t || !root || !path) return false;

    var node = resolve(root, path);
    if (node) {
      node.visible = true;
      if (node.userData) delete node.userData.__hiddenPart;
    }

    var cfg = t.getConfig() || {};
    var items = readHidden(cfg).filter(function (x) { return x.path !== path; });
    writeHidden(cfg, items);
    t.setConfig(cfg);
    save();
    fire();
    return true;
  }

  function restoreAll() {
    var t = Tool();
    var root = t && t.getRoot();
    if (!t || !root) return false;

    var items = readHidden(t.getConfig() || {});
    items.forEach(function (it) {
      var node = resolve(root, it.path);
      if (node) {
        node.visible = true;
        if (node.userData) delete node.userData.__hiddenPart;
      }
    });

    var cfg = t.getConfig() || {};
    writeHidden(cfg, []);
    t.setConfig(cfg);
    save();
    notify('已恢复全部部件', '共 ' + items.length + ' 个');
    fire();
    return true;
  }

  /** 已隐藏清单（面板展示用） */
  function list() {
    var t = Tool();
    if (!t || !t.getConfig) return [];
    return readHidden(t.getConfig());
  }

  /** 由 Tool 的 canvas 点击分发转进来 */
  function pick(event) {
    var p = Pick();
    if (!p || typeof p.raycastAt !== 'function') return;
    var hit = p.raycastAt(event);
    if (!hit) {
      notify('⚠️ 请点击模型的真实表面', '');
      return;
    }
    hideMesh(hit.mesh);
  }

  window.AdminModelPartDelete = {
    begin: begin,
    cancel: cancel,
    isActive: isActive,
    pick: pick,
    hideMesh: hideMesh,
    restore: restore,
    restoreAll: restoreAll,
    list: list,
    onChange: onChange,
    _diag: function () {
      return {
        active: active,
        hasTarget: !!(Tool() && Tool().hasTarget()),
        hidden: list().length
      };
    }
  };
})();
