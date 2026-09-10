/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * adminSky.js — 管理后台「天气控制 → 天空」卡片
 * 天空库：默认天空（系统纯色，随天气变色）+ 用户添加的全景图/HDR，点哪个用哪个。
 * 选中后随天气配置一起保存并广播，在线玩家即时生效。
 */
(function () {
  'use strict';

  const API_LIST = '/api/sky/list';
  const API_UPLOAD = '/api/sky/upload';
  const API_WEATHER = '/api/config/weather';

  let _skies = [];
  let _activeId = 'default';

  // i18n 辅助：翻译缺失时 i18n.t 返回完整 key，据此回退中文原文
  function t(key, fallback) {
    const v = (window.i18n && window.i18n.t) ? window.i18n.t(key) : key;
    return (v && v !== key) ? v : fallback;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function token() { return localStorage.getItem('adminToken'); }

  function g(id) { return document.getElementById(id); }

  /** 收集天气面板当前值（与"立即应用并广播"口径一致） */
  function collectWeatherBody() {
    const type = (typeof _currentWeatherType !== 'undefined' && _currentWeatherType) ? _currentWeatherType : 'clear';
    const intensity = parseInt((g('weather-intensity') || {}).value, 10);
    const wind = parseInt((g('weather-wind') || {}).value, 10);
    const cycle = parseInt((g('weather-cycle-interval') || {}).value, 10);
    const autoEl = g('weather-auto-cycle');
    return {
      type: type,
      intensity: Number.isFinite(intensity) ? intensity : 50,
      wind: Number.isFinite(wind) ? wind : 20,
      auto_cycle: !!(autoEl && autoEl.checked),
      cycle_interval: Number.isFinite(cycle) ? cycle : 30,
      sky_id: _activeId
    };
  }

  async function load() {
    const box = g('sky-library');
    if (!box) return;
    box.innerHTML = '<span style="font-size:12px;color:var(--muted)">' + esc(t('adminSky.loading', '加载中...')) + '</span>';
    try {
      const r = await fetch(API_LIST, { headers: { Authorization: 'Bearer ' + token() } });
      const data = await r.json();
      _skies = (data && data.skies) ? data.skies : [];
      render();
    } catch (e) {
      box.innerHTML = '<span style="font-size:12px;color:var(--red)">' +
        esc(t('adminSky.loadFailed', '天空库加载失败')) + '：' + esc(e.message) + '</span>';
    }
  }

  function thumbHtml(sky) {
    if (sky.builtin || sky.kind === 'default') {
      return '<div style="height:56px;border-radius:6px;background:linear-gradient(180deg,#87ceeb 0%,#cfe9f7 100%);display:flex;align-items:center;justify-content:center;font-size:11px;color:#333">' +
        esc(t('adminSky.defaultBadge', '系统默认')) + '</div>';
    }
    if (sky.kind === 'hdr') {
      return '<div style="height:56px;border-radius:6px;background:linear-gradient(135deg,#1a2a4a,#5b7fb9 60%,#f0c36d);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px">HDR</div>';
    }
    return '<img src="' + esc(sky.url) + '" alt="" style="height:56px;width:100%;object-fit:cover;border-radius:6px;display:block">';
  }

  function render() {
    const box = g('sky-library');
    if (!box) return;
    box.innerHTML = _skies.map((sky) => {
      const active = String(sky.id) === String(_activeId);
      const border = active ? '2px solid var(--blue)' : '1px solid var(--border)';
      const size = (sky.width && sky.height) ? (sky.width + '×' + sky.height) : '';
      const envRow = sky.builtin ? '' :
        '<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);cursor:pointer;margin-top:6px" onclick="event.stopPropagation()">' +
        '<input type="checkbox" ' + (sky.use_env ? 'checked' : '') +
        ' onchange="adminSkyToggleEnv(' + sky.id + ', this.checked)"> ' +
        esc(t('adminSky.useEnv', '用作环境光照')) + '</label>';
      const delBtn = sky.builtin ? '' :
        '<span onclick="event.stopPropagation();adminSkyDelete(' + sky.id + ')" title="' +
        esc(t('adminSky.delete', '删除')) +
        '" style="position:absolute;top:4px;right:6px;cursor:pointer;color:var(--muted);font-size:14px">×</span>';
      return '<div onclick="adminSkySelect(\'' + sky.id + '\')" style="position:relative;width:132px;padding:8px;border:' + border +
        ';border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.03)">' +
        delBtn + thumbHtml(sky) +
        '<div style="font-size:12px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(sky.name) + '">' +
        (active ? '✅ ' : '') + esc(sky.name) + '</div>' +
        '<div style="font-size:10px;color:var(--muted)">' + esc(size) + '</div>' +
        envRow + '</div>';
    }).join('');
  }

  async function upload(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch(API_UPLOAD, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token() },
        body: fd
      });
      const data = await r.json();
      if (!data.success) throw new Error(data.error || 'upload failed');
      await load();
      await select(data.sky.id, true); // 上传即用：自动选中并广播
      if (data.warning) showToast('⚠️ ' + data.warning, 'error');
      else showToast('✅ ' + t('adminSky.uploadOk', '天空已添加并应用'));
    } catch (e) {
      showToast('❌ ' + t('adminSky.uploadFailed', '天空上传失败') + '：' + e.message, 'error');
    } finally {
      input.value = '';
    }
  }

  /** 选中并保存广播；silent=true 时由调用方自行提示 */
  async function select(id, silent) {
    _activeId = id;
    render();
    try {
      const r = await fetch(API_WEATHER, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify(collectWeatherBody())
      });
      const data = await r.json();
      if (!data.success) throw new Error(data.error || 'save failed');
      if (!silent) showToast('✅ ' + t('adminSky.selected', '天空已切换并广播'));
    } catch (e) {
      showToast('❌ ' + t('adminSky.selectFailed', '天空切换失败') + '：' + e.message, 'error');
    }
  }

  async function remove(id) {
    if (!confirm(t('adminSky.deleteConfirm', '确定删除这个天空吗？删除后世界会回退到默认天空。'))) return;
    try {
      const r = await fetch('/api/sky/' + id, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token() }
      });
      const data = await r.json();
      if (!data.success) throw new Error(data.error || 'delete failed');
      if (String(_activeId) === String(id)) _activeId = 'default';
      await load();
      if (String(_activeId) === 'default') await select('default', true);
      showToast('✅ ' + t('adminSky.deleteOk', '天空已删除'));
    } catch (e) {
      showToast('❌ ' + t('adminSky.deleteFailed', '删除失败') + '：' + e.message, 'error');
    }
  }

  async function toggleEnv(id, checked) {
    try {
      const r = await fetch('/api/sky/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify({ use_env: !!checked })
      });
      const data = await r.json();
      if (!data.success) throw new Error(data.error || 'update failed');
      await load();
      // 若该项正在使用，重新广播让客户端重建环境光照
      if (String(_activeId) === String(id)) await select(id, true);
    } catch (e) {
      showToast('❌ ' + e.message, 'error');
    }
  }

  window.adminSky = {
    load: load,
    upload: upload,
    select: select,
    remove: remove,
    toggleEnv: toggleEnv,
    currentSkyId: function () { return _activeId; },
    /** 天气配置加载完成后由 admin.html 回调，同步当前选中的天空 */
    onWeatherLoaded: function (cfg) {
      _activeId = (cfg && cfg.sky && cfg.sky.id) ? cfg.sky.id : 'default';
      load();
    }
  };

  // 供 HTML 内联 onclick 使用
  window.adminSkyUpload = upload;
  window.adminSkySelect = select;
  window.adminSkyDelete = remove;
  window.adminSkyToggleEnv = toggleEnv;
})();
