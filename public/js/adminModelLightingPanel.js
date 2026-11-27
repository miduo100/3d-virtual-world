/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 管理员模式模型灯光 · 浮层内容：入口按钮、灯列表、参数、保存、调光辅助、整体调亮（2026-11-06）  v11
 * 依赖：AdminModelLightingTool（3D 交互与数据）、AdminModelLightingFloat（浮层外壳）、UI（通知）
 * 不做：不做 3D 拾取与手柄、不改运行时灯池
 * 诊断：window.AdminModelLightingPanel._diag()
 */
(function () {
  'use strict';
  if (window.__ADMIN_LIGHTING_OFF) return;
  if (window.AdminModelLightingPanel) return;

  var bm = null;
  var float = null;
  var saveTimer = null;
  var dimmed = [];
  var mounted = false;
  var tries = 0;
  var suppressRender = false;   // 拖部件滑块时不要重建 DOM

  function T() { return window.AdminModelLightingTool; }

  function notify(text, sub) {
    if (window.UI && UI.showNotification) UI.showNotification(text, sub || '', 2200);
    else console.log('[AdminLighting]', text, sub || '');
  }

  function entryOf() {
    var obj = bm && bm.selectedObject;
    var id = obj && obj.userData && obj.userData.worldObjectId;
    if (id === undefined || id === null) return null;
    var store = bm.world && bm.world.generatedBuildings;
    if (!store) return null;
    var e = store.get(id) || store.get(String(id)) || null;
    return e && e.data && e.data.type === 'uploaded_model' ? e : null;
  }

  function stamp() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  // ---------------- 渲染 ----------------

  function chipHtml(list, selectedId) {
    if (!list.length) return '<div class="aml-tip">还没有灯。点上面的按钮，再去点模型表面。</div>';
    var stats = window.ModelLighting && window.ModelLighting.modelLightStats
      ? window.ModelLighting.modelLightStats() : null;
    var activeIds = (stats && stats.activeIds) || [];
    var html = '<div class="aml-chips">';
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      html += '<div class="aml-chip' + (l.id === selectedId ? ' sel' : '') +
        (activeIds.indexOf(l.id) >= 0 ? ' on' : '') + '" data-id="' + l.id + '">' +
        '<i></i>灯 ' + (i + 1) + '</div>';
    }
    return html + '</div>';
  }

  function rangeHtml(label, field, value, min, max, step, unit) {
    return '<div class="aml-row"><span>' + label + '</span><output id="aml-o-' + field + '">' +
      Number(value).toFixed(step < 1 ? 1 : 0) + (unit || '') + '</output></div>' +
      '<input type="range" data-field="' + field + '" min="' + min + '" max="' + max +
      '" step="' + step + '" value="' + value + '">';
  }

  /** 只更新标题里的灯数与本模型占槽数（灯槽每 250ms 重排，面板要跟上） */
  function updateHead() {
    var t = T();
    if (!t || !float) return;
    var list = t.getLights();
    var stats = window.ModelLighting && window.ModelLighting.modelLightStats
      ? window.ModelLighting.modelLightStats() : null;
    var activeIds = (stats && stats.activeIds) || [];
    var myActive = 0;
    for (var i = 0; i < list.length; i++) {
      if (activeIds.indexOf(list[i].id) >= 0) myActive++;
    }
    var slotMax = window.ModelLighting ? (window.ModelLighting.MODEL_REAL_LIGHT_SLOTS || 2) : 2;
    float.setHead(list.length + ' 盏 · 本模型照明 ' + myActive + '/' + slotMax);
  }

  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** 已配置部件的胶囊，和灯的胶囊一个样式，可来回切换 */
  function surfaceChipsHtml(list, cur) {
    if (!list.length) return '';
    var html = '<div class="aml-chips">';
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var name = s.meshName ? s.meshName.slice(0, 10) : ('部件' + (i + 1));
      html += '<div class="aml-chip' + (cur && cur.id === s.id ? ' sel' : '') +
        (s.enabled ? ' on' : '') + '" data-sid="' + s.id + '">' +
        '<i></i>' + escapeHtml(name) + '</div>';
    }
    return html + '</div>';
  }

  /** 部件发光区：点模型表面选部件，不列表 */
  function surfaceBlockHtml() {
    var sp = window.AdminModelSurfacePick;
    if (!sp) return '';
    var all = sp.listSurfaces();
    var cur = sp.getTarget();
    var html = '<div class="aml-sec">部件发光 ' +
      '<span style="font-size:9px;opacity:.6">共 ' + all.length + ' 个</span></div>';
    html += surfaceChipsHtml(sp.recentSurfaces(8), cur);
    html += '<button class="aml-btn warm" data-act="surface-pick" style="margin-top:6px">' +
      (sp.isPicking() ? '✕ 取消选部件' : '+ 点模型上的部件（新建或切换）') + '</button>';

    if (sp.isPicking()) {
      return html + '<div class="aml-tip">点已有发光参数的部件 = 切过去调；点没配过的 = 新建一条；<b>Esc</b> 取消</div>';
    }
    if (!cur) return html;
    html += '<div class="aml-row"><span>' + escapeHtml(cur.meshName || '未命名部件') + '</span>' +
      '<span style="font-size:9px;opacity:.6;max-width:110px;overflow:hidden;text-overflow:ellipsis">' +
      escapeHtml(cur.materialName || '') + '</span></div>';
    html += '<div class="aml-row"><span>启用</span><input type="checkbox" data-sfield="enabled"' +
      (cur.enabled ? ' checked' : '') + '></div>';
    html += '<div class="aml-row"><span>颜色</span><input type="color" data-sfield="color" value="' + cur.color + '"></div>';
    html += '<div class="aml-row"><span>强度</span><output id="aml-o-sintensity">' +
      Number(cur.intensity).toFixed(2) + '</output></div>' +
      '<input type="range" data-sfield="intensity" min="0" max="5" step="0.05" value="' + cur.intensity + '">';
    html += '<div class="aml-row"><span>范围</span><select data-sfield="scope">' +
      '<option value="mesh"' + (cur.scope !== 'material' ? ' selected' : '') + '>只这个部件</option>' +
      '<option value="material"' + (cur.scope === 'material' ? ' selected' : '') + '>同材质全部</option></select></div>';
    html += '<div class="aml-row"><span>用贴图发光</span><input type="checkbox" data-sfield="useMap"' +
      (cur.useMap !== false ? ' checked' : '') + '></div>';
    html += '<button class="aml-btn red" data-act="surface-remove" style="width:100%;margin-top:6px">移除这个部件的发光</button>';
    return html;
  }

  // ---------------- 部件删除（2026-11-25） ----------------
  //
  // 与部件发光共用射线和 path 口径：点哪个部件隐藏哪个。
  // 编辑期只关 visible（树不动，path 不会失效，可随时点回来）；
  // 真正摘节点 + 碰撞盒收缩发生在下次加载（CustomConfigApplier.applyHiddenParts）。

  function partDeleteBlockHtml() {
    var pd = window.AdminModelPartDelete;
    if (!pd) return '';
    var items = pd.list();
    var html = '<div class="aml-sec">部件删除 ' +
      '<span style="font-size:9px;opacity:.6">已隐藏 ' + items.length + ' 个</span></div>';
    html += '<button class="aml-btn ' + (pd.isActive() ? 'red' : 'warm') + '" data-act="part-del-mode">' +
      (pd.isActive() ? '✕ 退出删除模式' : '🗑 点模型上的部件删除') + '</button>';
    if (pd.isActive()) {
      html += '<div class="aml-tip">点哪个部件就隐藏哪个，<b>立即生效</b>并自动保存；<b>Esc</b> 退出</div>';
    }
    if (items.length) {
      html += '<div class="aml-chips">';
      for (var i = 0; i < items.length; i++) {
        html += '<span class="aml-chip" data-hpath="' + escapeHtml(items[i].path) +
          '" title="点一下恢复">' + escapeHtml(items[i].label || items[i].path) + ' ↩</span>';
      }
      html += '</div>';
      html += '<button class="aml-btn" data-act="part-del-restore-all">↩ 恢复全部（' + items.length + '）</button>';
    }
    html += '<div class="aml-tip">只影响显示，不改模型文件。<b>碰撞要刷新页面（F5）后才会跟着消失</b>：' +
      '碰撞是加载时按模型几何建的，编辑期只摘显示。</div>';
    return html;
  }

  // ---------------- 整体调亮（整模型自发光） ----------------
  //
  // 与 world_editor.html「模型参数」面板共用同一份 custom_config：
  //   emissiveIntensity / emissiveUseMap / emissive（定义见 customConfigRegistry.js → uploaded_model）
  // 应用走 CustomConfigApplier.applyModelEmissive（主世界加载时 world.js 已调过一次），
  // 这里只负责「改了立刻看到 + 落库」，两端口径天然一致。

  var wholeTimer = null;
  var lastWholeIntensity = 0.3;   // 关掉后记住上次强度，重新打开时恢复

  /** 颜色统一成 #rrggbb（配置里可能是 'ffffff' 或数字） */
  function hexColor(v) {
    var s = String(v === undefined || v === null ? '#ffffff' : v).trim();
    if (s.charAt(0) !== '#') s = '#' + s;
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '#ffffff';
  }

  function wholeValues() {
    var e = entryOf();
    var cfg = (e && e.data && e.data.custom_config) || {};
    var inten = cfg.emissiveIntensity;
    inten = (inten === undefined || inten === null) ? 0 : Number(inten);
    if (!isFinite(inten)) inten = 0;
    inten = Math.max(0, Math.min(3, inten));
    return {
      on: inten > 0,                 // 强度 > 0 才算开启（custom_config 里没有单独开关字段）
      intensity: inten,
      useMap: cfg.emissiveUseMap !== false,
      color: hexColor(cfg.emissive)
    };
  }

  function wholeBlockHtml() {
    var v = wholeValues();
    var html = '<div class="aml-sec">整体调亮 ' +
      '<span style="font-size:9px;opacity:.6">整模型自发光</span></div>';
    // 总开关：默认关。关着不碰材质、不写 custom_config，模型照常参与实例合批
    html += '<div class="aml-row"><span>启用</span><input type="checkbox" data-mfield="emissiveEnabled"' +
      (v.on ? ' checked' : '') + '></div>';
    if (!v.on) {
      return html + '<div class="aml-tip">关着时不改模型材质，也不影响合批。打开后再调亮度。</div>';
    }
    html += '<div class="aml-row"><span>自发光强度</span><output id="aml-o-wintensity">' +
      v.intensity.toFixed(2) + '</output></div>';
    html += '<input type="range" data-mfield="emissiveIntensity" min="0" max="3" step="0.05" value="' + v.intensity + '">';
    html += '<div class="aml-row"><span>用自身贴图发光</span><input type="checkbox" data-mfield="emissiveUseMap"' +
      (v.useMap ? ' checked' : '') + '></div>';
    html += '<div class="aml-row"><span>颜色</span><input type="color" data-mfield="emissive" value="' + v.color + '"></div>';
    html += '<div class="aml-tip">建议 0.2~0.8；超过 1.2 容易发白。已单独设过发光的部件不受影响。</div>';
    return html;
  }

  /**
   * 写整体调亮字段。
   * 强度归 0 时把三个键一起删掉 —— custom_config 回到「只有 lighting」，
   * ModelLighting.canInstance 重新为 true，模型能回到实例合批/LOD，
   * 不会给一个已关闭的功能留性能账单。
   */
  function writeWhole(field, value) {
    var e = entryOf();
    if (!e || !e.data) return null;
    var cfg = e.data.custom_config;
    cfg = (cfg && typeof cfg === 'object') ? JSON.parse(JSON.stringify(cfg)) : {};

    if (field === 'emissiveIntensity') {
      var n = Number(value);
      if (!isFinite(n)) n = 0;
      cfg.emissiveIntensity = Math.max(0, Math.min(3, n));
    } else if (field === 'emissiveUseMap') {
      cfg.emissiveUseMap = !!value;
    } else if (field === 'emissive') {
      cfg.emissive = hexColor(value);
    }

    if (!(Number(cfg.emissiveIntensity) > 0)) {
      delete cfg.emissiveIntensity;
      delete cfg.emissiveUseMap;
      delete cfg.emissive;
    }
    e.data.custom_config = cfg;
    return cfg;
  }

  /** 把整体调亮落到当前模型：full 顺带把灯光/阴影对齐一次，否则只改发光（拖动时用） */
  function applyWhole(cfg, full) {
    var root = bm && bm.selectedObject;
    var A = window.CustomConfigApplier;
    if (!root || !A) return;
    var skip = (window.ModelSurface && window.ModelSurface.appliedMaterialUuids)
      ? window.ModelSurface.appliedMaterialUuids(root) : null;
    var on = !!(cfg && A.hasEmissiveConfig && A.hasEmissiveConfig(cfg));

    if (full && A.apply) {
      A.apply(root, { type: 'uploaded_model', custom_config: cfg });
    } else if (on && A.applyModelEmissive) {
      A.applyModelEmissive(root, cfg, { skip: skip });
    }
    // 关掉这项功能时把材质收到「不发光、不留发光贴图」，否则旧的 intensity/emissiveMap
    // 还挂在材质上，会出现「拉回 0 却仍然发亮」的假象
    // 【2026-11-06】收尾色必须是黑：旧值 '#ffffff' 虽然强度 0 看不见，但白色会残留在材质上，
    // 下次开"整体调亮"时（配置里没有颜色）就被当成颜色来源 → 关一次再开就全亮，刷新又全暗。
    if (!on && A.applyModelEmissive) {
      A.applyModelEmissive(root, { emissive: '#000000', emissiveIntensity: 0, emissiveUseMap: false }, { skip: skip });
    }
  }

  function onWholeField(el, field, full) {
    var value = el.type === 'checkbox' ? el.checked
      : (el.type === 'range' ? Number(el.value) : el.value);

    // 总开关：开 → 用上次的强度（没有就 0.3）恢复；关 → 强度归 0（三个键一起删）
    if (field === 'emissiveEnabled') {
      var prev = wholeValues();
      var cfgSw;
      if (value) {
        cfgSw = writeWhole('emissiveIntensity', lastWholeIntensity > 0 ? lastWholeIntensity : 0.3);
      } else {
        if (prev.intensity > 0) lastWholeIntensity = prev.intensity;
        cfgSw = writeWhole('emissiveIntensity', 0);
      }
      if (!cfgSw) return;
      if (wholeTimer) { clearTimeout(wholeTimer); wholeTimer = null; }
      render();                 // 结构变了（展开/折叠），重画
      applyWhole(cfgSw, true);
      queueSave();
      return;
    }

    var wasOn = wholeValues().intensity > 0;
    var beforeIntensity = wholeValues().intensity;
    var cfg = writeWhole(field, value);
    if (!cfg) return;

    // 滑块拉到 0 = 关掉：记住强度，折叠回「只有开关」的形态
    if (wasOn && !(Number(cfg.emissiveIntensity) > 0)) {
      lastWholeIntensity = beforeIntensity || lastWholeIntensity;
      if (wholeTimer) { clearTimeout(wholeTimer); wholeTimer = null; }
      applyWhole(cfg, true);
      render();
      queueSave();
      return;
    }
    if (Number(cfg.emissiveIntensity) > 0) lastWholeIntensity = Number(cfg.emissiveIntensity);

    if (field === 'emissiveIntensity') {
      var out = document.getElementById('aml-o-wintensity');
      if (out) out.textContent = Number(el.value).toFixed(2);
    }
    if (wholeTimer) { clearTimeout(wholeTimer); wholeTimer = null; }
    if (full) {
      applyWhole(cfg, true);
    } else {
      // 拖动中只做轻量更新：重跑 ModelLighting.apply 会重克隆材质，逐帧跑会卡
      wholeTimer = setTimeout(function () {
        wholeTimer = null;
        applyWhole(cfg, false);
      }, 80);
    }
    queueSave();
  }

  function render() {
    if (!float) return;
    var t = T();
    if (!t) return;
    var list = t.getLights();
    var l = t.getSelected();
    updateHead();

    var html = '<button class="aml-btn warm" data-act="place">' +
      (t.isPlacing() ? '✕ 取消放灯' : '+ 在模型上点选位置放灯') + '</button>';
    if (t.isPlacing()) html += '<div class="aml-tip">点模型表面 → 该部位立刻发光；<b>Esc</b> 取消</div>';
    html += chipHtml(list, t.getSelectedId());
    if (list.length) {
      html += '<div class="aml-tip" style="margin-top:2px">淡蓝圈 = 灯在模型内部（被挡住但仍照亮）</div>';
    }

    if (l) {
      var s = l.surface || {};
      html += '<div class="aml-sec">灯参数</div>';
      html += '<div class="aml-row"><span>颜色</span><input type="color" data-field="color" value="' + l.color + '"></div>';
      html += rangeHtml('亮度', 'intensity', l.intensity, 0, 200, 0.5, '');
      html += rangeHtml('范围', 'distance', l.distance, 0.5, 100, 0.5, ' m');
      html += '<div class="aml-row"><span>启用照明</span><input type="checkbox" data-field="enabled"' +
        (l.enabled ? ' checked' : '') + '></div>';
      html += '<div class="aml-row"><span>光晕（合批）</span><input type="checkbox" data-field="halo"' +
        (l.halo ? ' checked' : '') + '></div>';
      html += rangeHtml('光晕大小', 'haloSize', l.haloSize, 0.2, 3, 0.1, '');
      html += '<div style="display:flex;gap:5px;margin-top:8px">' +
        '<button class="aml-btn green" data-act="save" style="flex:1">保存</button>' +
        '<button class="aml-btn red" data-act="del" style="flex:1">删除灯光</button></div>';
    }

    html += surfaceBlockHtml();
    html += partDeleteBlockHtml();
    html += wholeBlockHtml();

    html += '<div class="aml-sec">调光辅助</div>';
    html += '<div style="display:flex;gap:5px">' +
      '<button class="aml-btn warm" data-act="dim" style="flex:1">' +
      (dimmed.length ? '恢复环境光' : '压暗环境光') + '</button></div>';
    var slotMax = window.ModelLighting ? (window.ModelLighting.MODEL_REAL_LIGHT_SLOTS || 4) : 4;
    html += '<div class="aml-tip">真实照明全场只有 <b>' + slotMax + ' 盏</b>（选中灯优先占槽），其余只有自发光 + 光晕。</div>';
    html += '<div id="aml-status">修改后自动保存</div>';

    float.body.innerHTML = html;
  }

  // ---------------- 保存 ----------------

  function setStatus(text, bad) {
    var el = document.getElementById('aml-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = bad ? '#ff7b7b' : '#7d7d88';
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    var e = entryOf();
    if (!e || !e.data) return;
    var id = e.data.id || (bm.selectedObject.userData && bm.selectedObject.userData.worldObjectId);
    setStatus('正在保存…');
    fetch('/api/world/objects/' + id, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: JSON.stringify({ custom_config: e.data.custom_config })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.success) throw new Error((res && res.error) || '保存失败');
      setStatus('已保存 ' + stamp());
    }).catch(function (err) {
      setStatus('保存失败：' + err.message, true);
      notify('❌ 灯光保存失败', err.message);
    });
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
    setStatus('有修改，等待保存…');
  }

  // ---------------- 调光辅助 ----------------

  function toggleDim() {
    var scene = bm && bm.world && bm.world.scene;
    if (!scene) return;
    if (dimmed.length) {
      for (var i = 0; i < dimmed.length; i++) dimmed[i].light.intensity = dimmed[i].i;
      dimmed = [];
    } else {
      scene.traverse(function (o) {
        if (o.isAmbientLight || o.isDirectionalLight || o.isHemisphereLight) {
          dimmed.push({ light: o, i: o.intensity });
          o.intensity = o.intensity * 0.12;
        }
      });
    }
    render();
  }

  // ---------------- 参数改动 ----------------

  function onField(el) {
    var field = el.getAttribute('data-field');
    if (!field) return;
    var t = T();
    var l = t.getSelected();
    if (!l) return;
    var next = t.getLights().map(function (x) {
      return x.id === l.id ? JSON.parse(JSON.stringify(x)) : x;
    });
    var target = null;
    for (var i = 0; i < next.length; i++) if (next[i].id === l.id) target = next[i];
    if (!target) return;

    var value = el.type === 'checkbox' ? el.checked
      : (el.type === 'range' ? Number(el.value) : el.value);

    if (field.indexOf('surface') === 0) {
      target.surface = target.surface || { enabled: false, color: l.color, intensity: 0.8, useMap: true, scope: 'mesh' };
      var key = field === 'surfaceEnabled' ? 'enabled'
        : field === 'surfaceColor' ? 'color'
        : field === 'surfaceIntensity' ? 'intensity'
        : field === 'surfaceScope' ? 'scope' : 'useMap';
      target.surface[key] = value;
    } else {
      target[field] = value;
    }

    var e = entryOf();
    if (!e || !window.ModelLighting) return;
    e.data.custom_config = window.ModelLighting.writeLights(e.data.custom_config, next);
    t.refresh();

    var out = document.getElementById('aml-o-' + field);
    if (out) out.textContent = Number(el.value).toFixed(el.step && Number(el.step) < 1 ? 1 : 0);
    queueSave();
  }

  /** 部件发光参数改动 */
  function onSurfaceField(el, field) {
    var sp = window.AdminModelSurfacePick;
    if (!sp || !sp.getTarget()) return;
    var value = el.type === 'checkbox' ? el.checked
      : (el.type === 'range' ? Number(el.value) : el.value);
    var patch = {};
    patch[field] = value;
    suppressRender = true;
    try { sp.commit(patch); } finally { suppressRender = false; }
    if (field === 'intensity') {
      var out = document.getElementById('aml-o-sintensity');
      if (out) out.textContent = Number(el.value).toFixed(2);
    }
  }

  // ---------------- 事件 ----------------

  function bindEvents() {
    float.el.addEventListener('click', function (e) {
      var hchip = e.target.closest('.aml-chip[data-hpath]');
      if (hchip) {
        var pd0 = window.AdminModelPartDelete;
        if (pd0) pd0.restore(hchip.getAttribute('data-hpath'));
        return;
      }
      var schip = e.target.closest('.aml-chip[data-sid]');
      if (schip) {
        var sp0 = window.AdminModelSurfacePick;
        if (sp0) sp0.selectById(schip.getAttribute('data-sid'));
        render();
        return;
      }
      var chip = e.target.closest('.aml-chip[data-id]');
      var act = e.target.closest('[data-act]');
      var t = T();
      var sp = window.AdminModelSurfacePick;
      if (chip) {
        if (t) { t.selectLight(chip.getAttribute('data-id')); render(); }
        return;
      }
      if (!act) return;
      var name = act.getAttribute('data-act');
      if (name === 'part-del-mode') {
        var pd = window.AdminModelPartDelete;
        if (!pd) return;
        if (pd.isActive()) pd.cancel();
        else if (pd.begin()) notify('点模型上的部件即可删除', 'Esc 退出');
        render();
      } else if (name === 'part-del-restore-all') {
        var pd2 = window.AdminModelPartDelete;
        if (pd2) pd2.restoreAll();
      } else if (name === 'surface-pick') {
        if (!sp) return;
        if (sp.isPicking()) sp.cancel();
        else if (sp.begin()) notify('点模型上的部件', '点已有=切换，点没配过=新建');
        render();
      } else if (name === 'surface-remove') {
        if (sp) sp.removeCurrent();
        render();
      } else if (!t) {
        return;
      } else if (name === 'place') {
        if (t.isPlacing()) t.cancelPlace();
        else if (!t.beginPlace()) notify('⚠️ 请先选中一个上传模型', '');
        render();
      } else if (name === 'del') {
        t.deleteSelected();
        render();
        queueSave();
      } else if (name === 'save') {
        saveNow();
      } else if (name === 'bind') {
        t.beginPlace();
        notify('点击模型表面', '新建一盏灯并绑定到该部位');
        render();
      } else if (name === 'dim') {
        toggleDim();
      }
    });

    float.el.addEventListener('input', function (e) {
      var mf = e.target.getAttribute && e.target.getAttribute('data-mfield');
      if (mf && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        onWholeField(e.target, mf, false);
        return;
      }
      var sf = e.target.getAttribute && e.target.getAttribute('data-sfield');
      if (sf && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        onSurfaceField(e.target, sf);
        return;
      }
      var f = e.target.getAttribute && e.target.getAttribute('data-field');
      if (f && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') onField(e.target);
    });

    float.el.addEventListener('change', function (e) {
      // 整体调亮：开关 / 颜色确认 / 滑块松手 → 走一次全量应用（灯光、部件发光一起对齐）
      var mf = e.target.getAttribute && e.target.getAttribute('data-mfield');
      if (mf && (e.target.type === 'checkbox' || e.target.type === 'color' || e.target.type === 'range')) {
        onWholeField(e.target, mf, true);
        return;
      }
      var sf = e.target.getAttribute && e.target.getAttribute('data-sfield');
      if (sf && (e.target.type === 'checkbox' || e.target.tagName === 'SELECT')) {
        onSurfaceField(e.target, sf);
        return;
      }
      var f = e.target.getAttribute && e.target.getAttribute('data-field');
      if (f && (e.target.type === 'checkbox' || e.target.tagName === 'SELECT')) onField(e.target);
    });
  }

  // ---------------- 生命周期 ----------------

  function createEntry() {
    var host = document.getElementById('selected-object-info');
    if (!host) return false;
    var btn = document.createElement('button');
    btn.id = 'aml-entry';
    btn.type = 'button';
    btn.innerHTML = '<span>💡</span><span>模型灯光</span><span class="c" id="aml-entry-count">0 盏</span>';
    btn.addEventListener('click', function () {
      float.open();
      render();
    });
    var deselect = document.getElementById('deselect-btn');
    if (deselect) host.insertBefore(btn, deselect);
    else host.appendChild(btn);
    return true;
  }

  function sync() {
    if (!mounted) return;
    var btn = document.getElementById('aml-entry');
    if (!btn) return;
    var visible = !!entryOf();
    btn.style.display = visible ? 'flex' : 'none';
    if (!visible) {
      float.close();
      if (dimmed.length) toggleDim();
      return;
    }
    var t = T();
    var count = t ? t.getLights().length : 0;
    // 【2026-11-05】有灯才用高亮实心态；0 盏降级为低调描边，避免空模型也抢视线
    btn.classList.toggle('empty', count === 0);
    var c = document.getElementById('aml-entry-count');
    if (c) c.textContent = count + ' 盏';
    float.setCount(count);
    if (float.isOpen() && !suppressRender) render();
  }

  function destroy() {
    if (dimmed.length) toggleDim();
    var btn = document.getElementById('aml-entry');
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    if (float) { float.destroy(); float = null; }
    mounted = false;
  }

  function boot() {
    var manager = window.gameWorld && window.gameWorld.buildingManager;
    if (!manager) return false;
    // 非管理员：等 10 秒仍没有管理面板就不再轮询
    if (manager.isAdmin === false && tries > 40) return true;
    if (!manager.renderer || !document.getElementById('selected-object-info')) return false;
    if (!window.AdminModelLightingTool || !window.AdminModelLightingFloat) return false;

    bm = manager;
    float = window.AdminModelLightingFloat.create({ onExpand: render });
    if (!createEntry()) {
      float.destroy();
      float = null;
      return false;
    }
    bindEvents();

    window.AdminModelLightingTool.attach(bm);
    window.AdminModelLightingTool.onChange(function () {
      try { sync(); } catch (e) { console.warn('[AdminLighting] 同步失败', e); }
    });
    // 放灯 / 删灯 / 松手拖灯 由 Tool 触发落库
    window.AdminModelLightingTool.onDirty(function () {
      try { queueSave(); } catch (e) { console.warn('[AdminLighting] 保存调度失败', e); }
    });
    if (window.AdminModelSurfacePick) {
      window.AdminModelSurfacePick.onChange(function () {
        try { if (float && float.isOpen() && !suppressRender) render(); } catch (e) { /* 忽略 */ }
      });
    }
    if (window.AdminModelPartDelete) {
      window.AdminModelPartDelete.onChange(function () {
        try { if (float && float.isOpen() && !suppressRender) render(); } catch (e) { /* 忽略 */ }
      });
    }
    mounted = true;
    sync();
    // 灯槽每 250ms 重排，标题里的占槽数要跟着刷新
    setInterval(function () {
      if (!mounted || !float || !float.isOpen()) return;
      try { updateHead(); } catch (e) { /* 忽略 */ }
    }, 1200);
    return true;
  }

  (function wait() {
    if (boot()) return;
    if (++tries < 240) setTimeout(wait, 250);
  })();

  window.AdminModelLightingPanel = {
    sync: sync,
    destroy: destroy,
    saveNow: saveNow,
    render: render,
    _diag: function () {
      var t = window.AdminModelLightingTool;
      return {
        mounted: mounted,
        open: !!(float && float.isOpen()),
        collapsed: !!(float && float.isCollapsed()),
        dimmed: dimmed.length,
        target: !!(mounted && entryOf()),
        whole: wholeValues(),
        tool: t ? t._diag() : null
      };
    }
  };
})();
