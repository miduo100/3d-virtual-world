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

  /* 【2026-11-16 天空跟随天气】
     _link     : 是否开启联动（true 时按下面五个槽位自动切天空）
     _skyMap   : { clear: { id, env }, rain: {...}, ... }
                 env 覆盖天空记录自带的 use_env —— 同一条天空可以在晴天当光源、在雨天只当背景。 */
  let _link = false;
  let _skyMap = {};

  const WEATHER_ROWS = [
    { key: 'clear', label: '☀ 晴' },
    { key: 'rain',  label: '🌧 雨' },
    { key: 'snow',  label: '❄ 雪' },
    { key: 'fog',   label: '🌫 雾' },
    { key: 'storm', label: '⛈ 暴风雨' }
  ];

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

  function fmtSize(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  /**
   * 补齐文件体积：后端下发 size 就直接用；没有就 HEAD 拿 Content-Length。
   * 目的是让管理员一眼看出哪个天空吃空间（HDR 动辄十几 MB），方便清理。
   */
  async function fillSizes(skies) {
    const todo = skies.filter(function (s) {
      return s.url && typeof s.size !== 'number';
    });
    if (!todo.length) return false;
    await Promise.all(todo.map(async function (s) {
      try {
        const r = await fetch(s.url, { method: 'HEAD', cache: 'no-store' });
        const len = r.headers.get('content-length');
        if (len) s.size = parseInt(len, 10);
      } catch (_) { /* 拿不到就不显示 */ }
    }));
    return true;
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
      sky_id: _activeId,
      // 所有保存都必须带上联动配置：否则点一次天空卡片就会把联动滑回关闭状态
      // （后端 PUT 收到 undefined 的 sky_link 会按 false 处理，并把 sky_map 清空）
      sky_link: _link,
      sky_map: _skyMap
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
      if (await fillSizes(_skies)) render();   // 体积到齐后重绘一次
      renderLinkBox();   // 联动配置依赖 _skies 的下拉选项，必须在 render 之后
    } catch (e) {
      box.innerHTML = '<span style="font-size:12px;color:var(--red)">' +
        esc(t('adminSky.loadFailed', '天空库加载失败')) + '：' + esc(e.message) + '</span>';
    }
  }

  function thumbHtml(sky) {
    // 内置程序化预设：按后端下发的天地配色画渐变近似（不真渲染，0 成本）
    if (sky.kind === 'procedural') {
      const top = esc(sky.top || '#2e6bc4');
      const bottom = esc(sky.bottom || '#c8e4f2');
      return '<div style="height:56px;border-radius:6px;background:linear-gradient(180deg,' + top +
        ' 0%,' + bottom + ' 66%,#4e5b66 100%);display:flex;align-items:flex-end;justify-content:center;' +
        'font-size:10px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.65);padding-bottom:3px">⚡ 0KB</div>';
    }
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
      const dims = (sky.width && sky.height)
        ? (sky.width + '×' + sky.height)
        : (sky.kind === 'procedural' ? t('adminSky.procedural', '程序生成') : '');
      const bytes = (typeof sky.size === 'number' && sky.size > 0) ? fmtSize(sky.size) : '';
      const meta = [dims, bytes].filter(Boolean).join(' · ');
      const envRow = sky.builtin ? '' :
        '<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);cursor:pointer;margin-top:6px" onclick="event.stopPropagation()">' +
        '<input type="checkbox" ' + (sky.use_env ? 'checked' : '') +
        ' onchange="adminSkyToggleEnv(' + sky.id + ', this.checked)"> ' +
        esc(t('adminSky.useEnv', '用作环境光照')) + '</label>';
      // 删除入口：常显的实心按钮（原来是个右上角 14px 灰 ×，基本看不见）
      const delBtn = sky.builtin ? '' :
        '<button onclick="event.stopPropagation();adminSkyDelete(' + sky.id + ')" ' +
        'title="' + esc(t('adminSky.deleteHint', '删除该天空并移除服务器上的文件')) + '" ' +
        'style="margin-top:6px;width:100%;padding:3px 0;font-size:11px;line-height:1.5;color:#fff;' +
        'background:#c0392b;border:0;border-radius:4px;cursor:pointer;opacity:.9">' +
        esc(t('adminSky.delete', '删除')) + '</button>';
      return '<div onclick="adminSkySelect(\'' + sky.id + '\')" style="position:relative;width:132px;padding:8px;border:' + border +
        ';border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.03)">' +
        thumbHtml(sky) +
        '<div style="font-size:12px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(sky.name) + '">' +
        (active ? '✅ ' : '') + esc(sky.name) + '</div>' +
        '<div style="font-size:10px;color:var(--muted)">' + esc(meta) + '</div>' +
        envRow + delBtn + '</div>';
    }).join('');
  }

  // ===== 天空跟随天气：联动开关 + 五个天气槽位 =====

  /** 下拉选项：全部天空（默认 / 程序化 / 上传），程序化标注 0KB 便于挑轻的 */
  function skyOptionsHtml(selected) {
    const cur = (selected === undefined || selected === null) ? 'default' : String(selected);
    return _skies.map(function (s) {
      const id = String(s.id);
      let hint = '';
      if (s.kind === 'procedural') {
        hint = ' · 0KB';
      } else {
        const parts = [];
        if (s.width && s.height) parts.push(s.width + '×' + s.height);
        if (typeof s.size === 'number' && s.size > 0) parts.push(fmtSize(s.size));
        if (parts.length) hint = ' · ' + parts.join(' ');
      }
      return '<option value="' + esc(id) + '"' + (id === cur ? ' selected' : '') + '>' +
        esc(s.name) + esc(hint) + '</option>';
    }).join('');
  }

  function linkInnerHtml() {
    const rows = WEATHER_ROWS.map(function (w) {
      const slot = _skyMap[w.key] || {};
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
        '<span style="width:72px;font-size:12px;flex-shrink:0">' + w.label + '</span>' +
        '<select data-skykey="' + w.key + '" style="flex:1;min-width:0;background:rgba(0,0,0,0.5);' +
          'border:1px solid var(--border);border-radius:4px;color:var(--text);padding:3px 5px;font-size:11px">' +
          skyOptionsHtml(slot.id) +
        '</select>' +
        '<label style="display:flex;align-items:center;gap:3px;font-size:11px;color:var(--muted);flex-shrink:0;cursor:pointer" ' +
          'title="' + esc(t('adminSky.envTip', '开启后这条天空会作为光源照亮场景；不同天气间状态不一致时，切换会触发一次材质重编译')) + '">' +
          '<input type="checkbox" data-skyenv="' + w.key + '"' + (slot.env ? ' checked' : '') + '> ' +
          esc(t('adminSky.useEnv', '用作环境光照')) +
        '</label>' +
      '</div>';
    }).join('');

    return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">' +
        '<input type="checkbox" id="sky-link-on"' + (_link ? ' checked' : '') + '>' +
        '<b>' + esc(t('adminSky.skyLink', '天空跟随天气')) + '</b>' +
      '</label>' +
      '<div style="font-size:10px;color:var(--muted);line-height:1.5;margin:4px 0 8px">' +
        esc(t('adminSky.skyLinkHint', '开启后天气变化时按下面配置自动切换天空；上面卡片的点选不再生效。')) +
      '</div>' +
      '<div id="sky-link-rows"' + (_link ? '' : ' style="display:none"') + '>' + rows + '</div>';
  }

  function renderLinkBox() {
    const lib = g('sky-library');
    if (!lib || !lib.parentNode) return;
    let host = g('sky-link-box');
    if (!host) {
      host = document.createElement('div');
      host.id = 'sky-link-box';
      host.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:10px;background:rgba(255,255,255,0.02)';
      lib.parentNode.insertBefore(host, lib);
    }
    host.innerHTML = linkInnerHtml();
    bindLink();
  }

  function bindLink() {
    const on = g('sky-link-on');
    if (on) {
      on.addEventListener('change', function () {
        _link = on.checked;
        const rows = g('sky-link-rows');
        if (rows) rows.style.display = _link ? '' : 'none';
        saveLink();
      });
    }
    document.querySelectorAll('[data-skykey]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const k = sel.getAttribute('data-skykey');
        if (!_skyMap[k]) _skyMap[k] = { id: 'default', env: false };
        _skyMap[k].id = sel.value;
        saveLink();
      });
    });
    document.querySelectorAll('[data-skyenv]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const k = cb.getAttribute('data-skyenv');
        if (!_skyMap[k]) _skyMap[k] = { id: 'default', env: false };
        _skyMap[k].env = cb.checked;
        saveLink();
      });
    });
  }

  async function saveLink() {
    try {
      const body = collectWeatherBody();
      body.sky_link = _link;
      body.sky_map = _skyMap;
      const r = await fetch(API_WEATHER, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));
      showToast('✅ ' + t('adminSky.skyLinkSaved', '天空联动已保存并广播'));
    } catch (e) {
      showToast('❌ ' + t('adminSky.skyLinkFailed', '天空联动保存失败') + '：' + e.message, 'error');
    }
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
    const item = _skies.filter(function (s) { return String(s.id) === String(id); })[0];
    const name = item ? item.name : ('#' + id);
    const bytes = (item && typeof item.size === 'number' && item.size > 0) ? fmtSize(item.size) : '';
    const msg = t('adminSky.deleteConfirm', '确定删除这个天空吗？删除后世界会回退到默认天空。') +
      '\n\n「' + name + '」' + (bytes ? '（' + bytes + '）' : '') +
      '\n会同时删除服务器上的文件，不可恢复。';
    if (!confirm(msg)) return;
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
    /** 天气配置加载完成后由 admin.html 回调，同步当前选中的天空 / 联动配置 */
    onWeatherLoaded: function (cfg) {
      _activeId = (cfg && cfg.sky && cfg.sky.id) ? cfg.sky.id : 'default';
      _link = !!(cfg && cfg.sky_link === true);
      _skyMap = (cfg && cfg.sky_map && typeof cfg.sky_map === 'object' && !Array.isArray(cfg.sky_map))
        ? JSON.parse(JSON.stringify(cfg.sky_map))   // 拷贝一份，避免直接改到全局 cfg
        : {};
      load();
    }
  };

  // 供 HTML 内联 onclick 使用
  window.adminSkyUpload = upload;
  window.adminSkySelect = select;
  window.adminSkyDelete = remove;
  window.adminSkyToggleEnv = toggleEnv;
})();
