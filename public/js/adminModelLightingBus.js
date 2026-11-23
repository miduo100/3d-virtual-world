/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 管理员模式 · 灯光事件总线：变更通知、待保存通知、用户提示（2026-11-05）  v1
 * 依赖：UI（可选）
 * 不做：不持有任何编辑状态
 * 诊断：window.AdminModelLightingBus._diag()
 */
(function () {
  'use strict';
  if (window.__ADMIN_LIGHTING_OFF) return;
  if (window.AdminModelLightingBus) return;

  var changeCbs = [];
  var dirtyCbs = [];

  function onChange(cb) { if (typeof cb === 'function') changeCbs.push(cb); }
  function onDirty(cb) { if (typeof cb === 'function') dirtyCbs.push(cb); }

  function fire() {
    for (var i = 0; i < changeCbs.length; i++) {
      try { changeCbs[i](); } catch (e) { console.warn('[AdminLighting] 变更回调失败', e); }
    }
  }

  function markDirty() {
    for (var i = 0; i < dirtyCbs.length; i++) {
      try { dirtyCbs[i](); } catch (e) { console.warn('[AdminLighting] 保存回调失败', e); }
    }
  }

  function notify(text, sub) {
    if (window.UI && UI.showNotification) UI.showNotification(text, sub || '', 2200);
    else console.log('[AdminLighting]', text, sub || '');
  }

  window.AdminModelLightingBus = {
    onChange: onChange,
    onDirty: onDirty,
    fire: fire,
    markDirty: markDirty,
    notify: notify,
    _diag: function () { return { changeCbs: changeCbs.length, dirtyCbs: dirtyCbs.length }; }
  };
})();
