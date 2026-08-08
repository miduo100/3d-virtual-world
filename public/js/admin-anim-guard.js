/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 管理后台 - 动画守卫/自包含角色包配置扩展
 *
 * 说明：
 *   本文件扩展 admin.html 的"远程模型守卫配置"页面，新增：
 *     1. 角色动画模式选择（retarget / self_contained）
 *     2. 动画守卫开关与阈值配置
 *
 *   实现方式：
 *     - 在 DOM 中注入 UI
 *     - 包装原有的 loadModelGuardConfig / saveModelGuardConfig 函数
 *     - 不修改 admin.html 主体逻辑
 */
(function() {
  'use strict';

  var CONTAINER_ID = 'mg-anim-guard-container';
  var BUNDLE_CARD_ID = 'mg-bundle-mode-card';

  var FIELDS = [
    { key: 'anim_max_file_size', label: '📦 单动画文件大小', unit: 'MB', min: 1, max: 500, step: 1 },
    { key: 'anim_max_tracks', label: '🎼 单动画轨道数', unit: '条', min: 10, max: 5000, step: 10 },
    { key: 'anim_max_keyframes', label: '⏱️ 单动画关键帧数', unit: '个', min: 100, max: 1000000, step: 100 },
    { key: 'anim_max_duration', label: '⏳ 单动画时长', unit: '秒', min: 1, max: 600, step: 1 },
    { key: 'anim_max_meshes', label: '🔷 动画GLB内嵌网格数', unit: '个', min: 0, max: 500, step: 1 },
    { key: 'anim_total_max_size', label: '📊 单角色动画累计预算', unit: 'MB', min: 1, max: 500, step: 1 }
  ];

  function _id(key, suffix) {
    return 'mg-ag-' + key + (suffix ? '-' + suffix : '');
  }

  function _el(id) {
    return document.getElementById(id);
  }

  function injectBundleModeUI() {
    var subPage = _el('world-sub-model-guard');
    if (!subPage) {
      console.warn('[AdminAnimGuard] 子页 #world-sub-model-guard 不存在，未注入角色动画模式 UI');
      return;
    }
    if (_el(BUNDLE_CARD_ID)) return;

    var firstCard = subPage.querySelector('.card');
    if (!firstCard) {
      console.warn('[AdminAnimGuard] 未找到模型守卫卡片，未注入角色动画模式 UI');
      return;
    }

    var card = document.createElement('div');
    card.className = 'card';
    card.id = BUNDLE_CARD_ID;

    var html = '<div class="card-header">';
    html += '<div class="card-title">🎭 角色动画模式</div>';
    html += '<div style="font-size:12px;color:var(--muted);margin-top:4px">';
    html += '控制跨世界来访角色动画的播放方式。此设置<strong>独立于模型守卫与动画守卫开关</strong>，关闭守卫后仍然生效。';
    html += '</div>';
    html += '</div>';

    html += '<div style="display:flex;gap:12px;margin-bottom:14px">';
    html += '<div id="' + _id('bundle-card-retarget') + '" class="mg-bundle-card" data-mode="retarget" style="flex:1;border:2px solid var(--border);border-radius:10px;padding:16px;cursor:pointer;transition:.2s;background:var(--card-bg);position:relative">';
    html += '<div style="font-size:22px;margin-bottom:8px">🔄</div>';
    html += '<div style="font-weight:600;font-size:14px;margin-bottom:6px">重定向模式</div>';
    html += '<div style="font-size:12px;color:var(--muted);line-height:1.45">省资源，跨世界角色动画按骨骼映射重定向。</div>';
    html += '<div class="mg-bundle-check" style="position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;color:#000;font-size:12px;opacity:0.4">✓</div>';
    html += '</div>';
    html += '<div id="' + _id('bundle-card-self_contained') + '" class="mg-bundle-card" data-mode="self_contained" style="flex:1;border:2px solid var(--border);border-radius:10px;padding:16px;cursor:pointer;transition:.2s;background:var(--card-bg);position:relative">';
    html += '<div style="font-size:22px;margin-bottom:8px">📦</div>';
    html += '<div style="font-weight:600;font-size:14px;margin-bottom:6px">自包含模式</div>';
    html += '<div style="font-size:12px;color:var(--muted);line-height:1.45">高保真原样播放跨世界自定义角色，需要较好的性能。</div>';
    html += '<div class="mg-bundle-check" style="position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;color:#000;font-size:12px;opacity:0.4">✓</div>';
    html += '</div>';
    html += '</div>';

    html += '<input type="hidden" id="' + _id('bundle-mode') + '" value="retarget">';

    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">';
    html += '<button id="' + _id('save-bundle') + '" type="button" style="padding:8px 16px;background:var(--blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500">💾 保存当前模式</button>';
    html += '<span id="' + _id('bundle-status') + '" style="font-size:12px;min-height:18px"></span>';
    html += '</div>';

    html += '<div style="font-size:11px;color:var(--muted)">💡 点击卡片选中模式，再点「保存当前模式」立即生效。</div>';

    card.innerHTML = html;
    subPage.insertBefore(card, firstCard);

    var modeCards = card.querySelectorAll('.mg-bundle-card');
    modeCards.forEach(function(c) {
      c.addEventListener('click', function() {
        selectBundleMode(c.dataset.mode);
      });
    });

    var saveBtn = _el(_id('save-bundle'));
    if (saveBtn) saveBtn.addEventListener('click', saveBundleMode);
  }

  function injectUI() {
    var container = _el(CONTAINER_ID);
    if (!container) {
      console.warn('[AdminAnimGuard] 容器 #' + CONTAINER_ID + ' 不存在，未注入 UI');
      return;
    }
    if (container.dataset.injected === 'true') return;

    var html = '<div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--border)">';

    // ===== 动画守卫总开关 =====
    html += '<div style="background:rgba(0,170,255,0.05);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between">';
    html += '<div>';
    html += '<label style="font-size:14px;font-weight:600">🎬 启用动画守卫</label>';
    html += '<p style="font-size:11px;color:var(--muted);margin-top:4px">拦截来自其他世界的大文件/特效烘焙动画，保护当前世界客户端性能</p>';
    html += '</div>';
    html += '<label style="position:relative;width:48px;height:26px;cursor:pointer">';
    html += '<input type="checkbox" id="' + _id('enabled') + '" checked style="display:none">';
    html += '<span id="' + _id('enabled-toggle') + '" style="position:absolute;top:0;left:0;right:0;bottom:0;background:#00ff00;border-radius:13px;transition:.3s"></span>';
    html += '<span id="' + _id('enabled-knob') + '" style="position:absolute;top:2px;right:2px;width:22px;height:22px;background:#000;border-radius:50%;transition:.3s"></span>';
    html += '</label>';
    html += '</div>';

    // 仅拦跨域开关
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;font-size:13px">';
    html += '<input type="checkbox" id="' + _id('remote-only') + '" checked style="accent-color:var(--blue);width:16px;height:16px">';
    html += '<label for="' + _id('remote-only') + '" style="cursor:pointer">只拦截跨世界（远端）动画，本世界上传动画放行</label>';
    html += '</div>';

    // ===== 动画守卫阈值滑块 =====
    html += '<div id="' + _id('slots') + '">';
    FIELDS.forEach(function(f) {
      html += '<div class="form-row" style="margin-bottom:14px">';
      html += '<div class="form-group" style="flex:1">';
      html += '<label>' + f.label + ': <strong id="' + _id(f.key, 'val') + '" style="color:var(--blue)"></strong></label>';
      html += '<input type="range" id="' + _id(f.key) + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + _defaultValue(f.key) + '"';
      html += ' oninput="document.getElementById(\'' + _id(f.key, 'val') + '\').textContent=this.value+' + "'" + f.unit + "'" + '"';
      html += ' style="width:100%;accent-color:var(--blue)">';
      html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)">';
      html += '<span>' + f.min + f.unit + '</span><span>' + f.max + f.unit + '</span>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';

    // 提示
    html += '<div style="background:rgba(255,215,0,0.07);border:1px solid rgba(255,215,0,0.2);border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;color:var(--muted)">';
    html += '💡 <strong style="color:var(--yellow)">提示：</strong>动画守卫只影响其他世界来访的远端玩家动画。被拦截的动画会跳过播放，不会导致角色消失。';
    html += '</div>';

    html += '</div>';

    container.innerHTML = html;
    container.dataset.injected = 'true';

    // 绑定总开关 UI
    _el(_id('enabled')).addEventListener('change', updateEnabledToggleUI);
  }

  function _defaultValue(key) {
    var defaults = {
      anim_max_file_size: 5,
      anim_max_tracks: 200,
      anim_max_keyframes: 20000,
      anim_max_duration: 30,
      anim_max_meshes: 10,
      anim_total_max_size: 30
    };
    return defaults[key];
  }

  function updateEnabledToggleUI() {
    var enabled = _el(_id('enabled')).checked;
    var toggle = _el(_id('enabled-toggle'));
    var knob = _el(_id('enabled-knob'));
    var slots = _el(_id('slots'));
    if (toggle) toggle.style.background = enabled ? '#00ff00' : 'rgba(136,136,136,0.4)';
    if (knob) {
      knob.style.right = enabled ? '2px' : 'auto';
      knob.style.left = enabled ? 'auto' : '2px';
    }
    if (slots) {
      slots.style.opacity = enabled ? '1' : '0.4';
      slots.style.pointerEvents = enabled ? 'auto' : 'none';
    }
  }

  function selectBundleMode(mode) {
    var hidden = _el(_id('bundle-mode'));
    if (hidden) hidden.value = mode;

    ['retarget', 'self_contained'].forEach(function(m) {
      var card = _el(_id('bundle-card-' + m));
      var check = card ? card.querySelector('.mg-bundle-check') : null;
      if (!card) return;
      if (m === mode) {
        card.style.borderColor = 'var(--blue)';
        card.style.background = 'rgba(0,170,255,0.08)';
        if (check) {
          check.style.background = 'var(--blue)';
          check.style.color = '#fff';
          check.style.opacity = '1';
        }
      } else {
        card.style.borderColor = 'var(--border)';
        card.style.background = 'var(--card-bg)';
        if (check) {
          check.style.background = 'var(--border)';
          check.style.color = '#000';
          check.style.opacity = '0.4';
        }
      }
    });
  }

  async function saveBundleMode() {
    var hidden = _el(_id('bundle-mode'));
    var mode = hidden ? hidden.value : 'retarget';
    var statusEl = _el(_id('bundle-status'));
    if (statusEl) {
      statusEl.textContent = '⏳ 保存中...';
      statusEl.style.color = 'var(--yellow)';
    }

    try {
      var token = localStorage.getItem('adminToken');
      if (!token) throw new Error('未登录');

      var cfg = {};
      try {
        var getResp = await fetch('/api/model-guard/config', { cache: 'no-store' });
        var getData = await getResp.json();
        if (getData.success && getData.config) cfg = getData.config;
      } catch (e) {
        console.warn('[AdminAnimGuard] 读取当前配置失败，将用空配置保存模式:', e);
      }

      cfg.character_bundle_mode = mode;

      var resp = await fetch('/api/admin/model-guard/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ config: cfg })
      });

      var data = await resp.json();

      if (data.success) {
        if (statusEl) {
          statusEl.textContent = '✅ 已保存';
          statusEl.style.color = 'var(--green)';
        }
        if (typeof window.showToast === 'function') {
          window.showToast('✅ 角色动画模式已保存为：' + (mode === 'self_contained' ? '自包含模式' : '重定向模式'));
        }
        if (window.SelfContainedChar && window.SelfContainedChar.refreshWorldMode) {
          window.SelfContainedChar.refreshWorldMode();
        }
      } else {
        throw new Error(data.error || '保存失败');
      }
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = '❌ 失败';
        statusEl.style.color = 'var(--red)';
      }
      if (typeof window.showToast === 'function') window.showToast('❌ 保存失败: ' + e.message, 'error');
      console.error('[AdminAnimGuard] 保存模式失败:', e);
    }
  }

  function loadValues(config) {
    if (!config) return;

    // 角色动画模式
    var mode = config.character_bundle_mode === 'self_contained' ? 'self_contained' : 'retarget';
    selectBundleMode(mode);

    // 动画守卫开关
    var enabled = config.anim_guard_enabled !== false;
    var enabledEl = _el(_id('enabled'));
    if (enabledEl) {
      enabledEl.checked = enabled;
      updateEnabledToggleUI();
    }

    // 仅拦跨域
    var remoteOnlyEl = _el(_id('remote-only'));
    if (remoteOnlyEl) remoteOnlyEl.checked = config.anim_guard_remote_only !== false;

    // 阈值
    FIELDS.forEach(function(f) {
      var input = _el(_id(f.key));
      var valLabel = _el(_id(f.key, 'val'));
      if (!input) return;
      var v = config[f.key];
      if (v === undefined || v === null || v === '') v = _defaultValue(f.key);
      input.value = v;
      if (valLabel) valLabel.textContent = v + f.unit;
    });
  }

  function collectValues(baseConfig) {
    var modeEl = _el(_id('bundle-mode'));
    if (modeEl) baseConfig.character_bundle_mode = modeEl.value;

    var enabledEl = _el(_id('enabled'));
    if (enabledEl) baseConfig.anim_guard_enabled = enabledEl.checked;

    var remoteOnlyEl = _el(_id('remote-only'));
    if (remoteOnlyEl) baseConfig.anim_guard_remote_only = remoteOnlyEl.checked;

    FIELDS.forEach(function(f) {
      var input = _el(_id(f.key));
      if (input) baseConfig[f.key] = parseInt(input.value, 10);
    });

    return baseConfig;
  }

  // 包装原有函数
  function wrapFunctions() {
    if (typeof window.loadModelGuardConfig === 'function') {
      var origLoad = window.loadModelGuardConfig;
      window.loadModelGuardConfig = async function() {
        await origLoad.apply(this, arguments);
        // 从 RemoteModelGuard 拿最新配置（loadModelGuardConfig 已刷新过）
        var cfg = {};
        try {
          var resp = await fetch('/api/model-guard/config', { cache: 'no-store' });
          var data = await resp.json();
          if (data.success && data.config) cfg = data.config;
        } catch (e) {
          console.warn('[AdminAnimGuard] 读取扩展配置失败:', e);
        }
        injectBundleModeUI();
        injectUI();
        loadValues(cfg);
      };
    }

    if (typeof window.saveModelGuardConfig === 'function') {
      var origSave = window.saveModelGuardConfig;
      window.saveModelGuardConfig = async function() {
        injectBundleModeUI();
        injectUI();
        // 复用原有函数收集基础配置 + 提交
        // 由于原函数会重新构造 config 对象并 PUT，这里先调用一次假的收集逻辑
        var baseConfig = {
          enabled: document.getElementById('mg-enabled').checked,
          max_file_size: parseInt(document.getElementById('mg-max-file-size').value, 10),
          max_triangles: parseInt(document.getElementById('mg-max-tri').value, 10),
          max_vertices: parseInt(document.getElementById('mg-max-vert').value, 10),
          max_mesh_count: parseInt(document.getElementById('mg-max-mesh').value, 10),
          placeholder_style: document.getElementById('mg-placeholder-style').value
        };
        collectValues(baseConfig);

        var statusEl = document.getElementById('mg-save-status');
        statusEl.textContent = '⏳ 保存中...';
        statusEl.style.color = 'var(--yellow)';

        try {
          var token = localStorage.getItem('adminToken');
          if (!token) throw new Error('未登录');

          var resp = await fetch('/api/admin/model-guard/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ config: baseConfig })
          });

          var data = await resp.json();

          if (data.success) {
            statusEl.textContent = '✅ 已保存';
            statusEl.style.color = 'var(--green)';
            if (typeof window.showToast === 'function') window.showToast('✅ 模型守卫配置已保存，立即生效');

            if (window.RemoteModelGuard && window.RemoteModelGuard.forceRefreshConfig) {
              window.RemoteModelGuard.forceRefreshConfig();
            }
            if (window.RemoteAnimGuard && window.RemoteAnimGuard.forceRefresh) {
              window.RemoteAnimGuard.forceRefresh();
            }
            if (window.SelfContainedChar && window.SelfContainedChar.refreshWorldMode) {
              window.SelfContainedChar.refreshWorldMode();
            }
          } else {
            throw new Error(data.error || '保存失败');
          }
        } catch (e) {
          statusEl.textContent = '❌ 失败';
          statusEl.style.color = 'var(--red)';
          if (typeof window.showToast === 'function') window.showToast('❌ 保存失败: ' + e.message, 'error');
          console.error('[AdminAnimGuard] 保存失败:', e);
        }
      };
    }
  }

  // 如果页面已经加载完成，立即执行；否则等待 DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      injectBundleModeUI();
      injectUI();
      wrapFunctions();
    });
  } else {
    injectBundleModeUI();
    injectUI();
    wrapFunctions();
  }

  window.AdminAnimGuard = {
    injectUI: injectUI,
    injectBundleModeUI: injectBundleModeUI,
    loadValues: loadValues,
    collectValues: collectValues
  };

  console.log('[admin-anim-guard.js] 动画守卫后台扩展已加载');
})();
