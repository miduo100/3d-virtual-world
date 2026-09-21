/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * buildingCollisionToggle.js — 前台管理员模式的"模型级碰撞开关"
 *
 * 背景：world_objects.has_collision 字段与碰撞管线（capsuleCollision.js 的 BVH 胶囊碰撞 +
 *      AABB 兜底盒）早已存在，但只有"世界编辑器"页有开关，游戏内前台管理员模式没有，
 *      管理员在游戏里选中模型后无法单独开关碰撞。
 *
 * 本模块在 buildingManager 的"已选中对象"面板底部注入一个滑块开关：
 *  - 状态清晰可见：滑块 + 文案（绿=开启 / 灰=关闭 / 置灰=该对象不支持）；
 *  - 每个模型独立：读写的都是该对象在 world_objects.has_collision 上的值；
 *  - 切换即时生效：不等 capsuleCollision 的 2s sweep，直接注册/注销碰撞体。
 *
 * 与 buildingManager 的唯一耦合是两个调用：
 *   BuildingCollisionToggle.mount(bm)   —— 面板创建后注入 UI
 *   BuildingCollisionToggle.sync(bm)    —— 每帧/每次选中变化时回填状态（内部做变化检测）
 */
(function () {
  'use strict';

  var bm = null;
  var els = null;          // { block, input, track, knob, text, label }
  var lastKey = null;      // 变化检测键：'null' | 'true' | 'false'
  var busy = false;

  // ---------------- 状态读取 ----------------

  /** 取当前选中对象的碰撞状态：true/false，null 表示该对象不支持碰撞设置 */
  function readState(manager) {
    var obj = manager && manager.selectedObject;
    if (!obj) return null;
    var id = obj.userData && obj.userData.worldObjectId;
    if (!id) return null;
    var world = manager.world;
    var entry = world && world.generatedBuildings ? world.generatedBuildings.get(id) : null;
    if (!entry || !entry.data) return null;
    // has_collision 为布尔或 null（历史数据）才认为该行可设置；非 world_objects 行（如 pure portal）没有此字段
    var v = entry.data.has_collision;
    if (v !== true && v !== false && v !== null) return null;
    return v === true;
  }

  // ---------------- UI ----------------

  function buildDom() {
    var block = document.createElement('div');
    block.id = 'collision-toggle-block';
    block.style.cssText = 'margin-top:10px; padding:8px; background: rgba(0,0,0,0.5); border:1px solid #444; border-radius:4px;';
    block.innerHTML = ''
      + '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">'
      + '  <span style="color:#aaa; font-size:11px;">🧱 模型碰撞</span>'
      + '  <label id="collision-switch-label" title="开启后玩家会被该模型挡住，并可站上其表面" '
      + '         style="position:relative; display:inline-block; width:42px; height:20px; cursor:pointer; flex:0 0 auto;">'
      + '    <input type="checkbox" id="object-collision-toggle" style="position:absolute; opacity:0; width:0; height:0;">'
      + '    <span id="collision-switch-track" style="position:absolute; inset:0; background:#555; border-radius:20px; transition:background .2s;"></span>'
      + '    <span id="collision-switch-knob" style="position:absolute; top:2px; left:2px; width:16px; height:16px; background:#fff; border-radius:50%; transition:transform .2s;"></span>'
      + '  </label>'
      + '</div>'
      + '<div id="collision-state-text" style="font-size:10px; margin-top:5px; color:#888;">—</div>';

    els = {
      block: block,
      label: block.querySelector('#collision-switch-label'),
      input: block.querySelector('#object-collision-toggle'),
      track: block.querySelector('#collision-switch-track'),
      knob: block.querySelector('#collision-switch-knob'),
      text: block.querySelector('#collision-state-text')
    };

    els.input.addEventListener('change', function () {
      applyToggle(this.checked);
    });
    return block;
  }

  function paint(state, disabled) {
    if (!els) return;
    if (disabled) {
      els.label.style.opacity = '0.4';
      els.label.style.pointerEvents = 'none';
      els.input.disabled = true;
      els.input.checked = false;
      els.track.style.background = '#444';
      els.knob.style.transform = 'translateX(0)';
      els.text.style.color = '#888';
      els.text.textContent = '该对象不支持碰撞设置';
      return;
    }
    els.label.style.opacity = '1';
    els.label.style.pointerEvents = 'auto';
    els.input.disabled = busy;
    els.input.checked = state;
    els.track.style.background = state ? '#4CAF50' : '#555';
    els.knob.style.transform = state ? 'translateX(22px)' : 'translateX(0)';
    els.text.style.color = state ? '#4CAF50' : '#888';
    els.text.textContent = state
      ? '已开启：玩家无法穿过（可站上表面）'
      : '已关闭：玩家可穿过该模型';
  }

  // ---------------- 即时生效 ----------------

  function applyCollisionNow(id, enabled) {
    var CC = window.CapsuleCollision;
    if (!CC || !bm || !bm.world) return;
    try {
      if (enabled) {
        // refresh 内部：先注销再按新 has_collision 注册（本地 data 已更新）
        if (typeof CC.refresh === 'function') CC.refresh(id);
      } else {
        if (typeof CC.unregisterModel === 'function') CC.unregisterModel(id);
        // 清掉该对象的 AABB 兜底盒（rebuildAabb 在 has_collision!==true 时只做清理）
        if (typeof CC.rebuildAabb === 'function') CC.rebuildAabb(bm.world, id);
      }
    } catch (e) {
      console.warn('[CollisionToggle] 碰撞体即时更新失败（2s 后 sweep 仍会自愈）:', e && e.message);
    }
  }

  async function applyToggle(enabled) {
    if (!bm || !bm.selectedObject || busy) return;
    var obj = bm.selectedObject;
    var id = obj.userData && obj.userData.worldObjectId;
    var entry = bm.world && bm.world.generatedBuildings ? bm.world.generatedBuildings.get(id) : null;
    if (!id || !entry || !entry.data) return;

    var prev = entry.data.has_collision === true;
    busy = true;
    paint(enabled, false);

    try {
      var resp = await fetch('/api/world/objects/' + id, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token')
        },
        body: JSON.stringify({ has_collision: enabled })
      });
      var data = await resp.json();
      if (!data || !data.success) throw new Error((data && data.error) || '保存失败');

      entry.data.has_collision = enabled;
      applyCollisionNow(id, enabled);
      lastKey = String(enabled);
      if (window.UI && UI.showNotification) {
        UI.showNotification('🧱 碰撞' + (enabled ? '已开启' : '已关闭'),
          entry.data.name || '', 2000);
      }
    } catch (e) {
      // 失败回滚：DB 没改成功，本地也不能改
      entry.data.has_collision = prev;
      lastKey = String(prev);
      paint(prev, false);
      if (window.UI && UI.showNotification) {
        UI.showNotification('❌ 碰撞设置失败', e.message || '未知错误', 3000);
      } else {
        console.error('[CollisionToggle]', e);
      }
    } finally {
      busy = false;
      // 必须解除 disabled 并按真实状态重绘：paint() 在 busy 期间会禁用 input，
      // 若不在结束时恢复，开关会一直卡在 disabled，第二次点击不触发 change。
      if (els) {
        var cur = readState(bm);
        if (cur !== null) {
          lastKey = String(cur);
          paint(cur, false);
        }
      }
    }
  }

  // ---------------- 对外 ----------------

  function mount(manager) {
    bm = manager;
    var host = document.getElementById('selected-object-info');
    if (!host) {
      console.warn('[CollisionToggle] 未找到 #selected-object-info，跳过注入');
      return false;
    }
    if (document.getElementById('collision-toggle-block')) return true;
    var block = buildDom();
    // 放到面板底部（"取消选中"之前）
    var deselect = document.getElementById('deselect-btn');
    if (deselect) host.insertBefore(block, deselect);
    else host.appendChild(block);
    return true;
  }

  /** 状态回填：只在状态变化时写 DOM，可安全地每帧调用 */
  function sync(manager) {
    bm = manager || bm;
    if (!els) return;
    var state = readState(bm);
    if (state === null) {
      if (lastKey !== 'null') { lastKey = 'null'; paint(false, true); }
      return;
    }
    var key = String(state);
    if (key !== lastKey) {
      lastKey = key;
      paint(state, false);
    }
  }

  window.BuildingCollisionToggle = { mount: mount, sync: sync, _readState: readState };
})();
