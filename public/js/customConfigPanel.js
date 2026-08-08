/**
 * 通用自定义配置面板组件
 * 用途：在世界编辑器右侧属性面板中，根据对象类型动态渲染可调参数
 * 依赖：CustomConfigRegistry、CustomConfigApplier
 */
(function () {
  'use strict';

  const DEFAULT_CONTAINER_ID = 'custom-config-panel-body';
  let _activeContainerId = DEFAULT_CONTAINER_ID;

  function getContainer(containerId) {
    return document.getElementById(containerId || _activeContainerId);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 生成 slider 控件
  function renderSlider(field, value, index) {
    const val = value !== undefined ? value : field.default;
    return `
      <div class="right-prop-group" data-field-index="${index}">
        <div class="right-prop-label">${escapeHtml(field.label)}
          <span style="float:right;color:#667eea;font-size:11px;" id="ccf-val-${index}">${parseFloat(val).toFixed(field.step < 0.1 ? 2 : 1)}</span>
        </div>
        <input type="range"
               class="right-prop-input"
               id="ccf-input-${index}"
               min="${field.min}" max="${field.max}" step="${field.step}"
               value="${val}"
               style="width:100%;">
        ${field.help ? `<div style="font-size:10px;color:#888;margin-top:4px;">${escapeHtml(field.help)}</div>` : ''}
      </div>
    `;
  }

  // 生成 color 控件
  function renderColor(field, value, index) {
    const val = value !== undefined ? value : field.default;
    return `
      <div class="right-prop-group" data-field-index="${index}">
        <div class="right-prop-label">${escapeHtml(field.label)}</div>
        <div class="right-prop-row">
          <input type="color"
                 class="right-prop-input"
                 id="ccf-input-${index}"
                 value="${val}"
                 style="width:60px;height:32px;padding:2px;">
          <input type="text"
                 class="right-prop-input"
                 id="ccf-text-${index}"
                 value="${val}"
                 style="flex:1;margin-left:8px;">
        </div>
        ${field.help ? `<div style="font-size:10px;color:#888;margin-top:4px;">${escapeHtml(field.help)}</div>` : ''}
      </div>
    `;
  }

  // 生成 toggle 控件
  function renderToggle(field, value, index) {
    const checked = value !== undefined ? !!value : field.default;
    return `
      <div class="right-prop-switch" data-field-index="${index}">
        <span class="right-prop-switch-label">${escapeHtml(field.label)}</span>
        <label class="right-switch">
          <input type="checkbox" id="ccf-input-${index}" ${checked ? 'checked' : ''}>
          <span class="right-switch-slider"></span>
        </label>
      </div>
      ${field.help ? `<div style="font-size:10px;color:#888;margin:0 0 8px 0;">${escapeHtml(field.help)}</div>` : ''}
    `;
  }

  // 生成 number 控件
  function renderNumber(field, value, index) {
    const val = value !== undefined ? value : field.default;
    return `
      <div class="right-prop-group" data-field-index="${index}">
        <div class="right-prop-label">${escapeHtml(field.label)}</div>
        <input type="number"
               class="right-prop-input"
               id="ccf-input-${index}"
               value="${val}"
               step="${field.step || 1}"
               style="width:100%;">
        ${field.help ? `<div style="font-size:10px;color:#888;margin-top:4px;">${escapeHtml(field.help)}</div>` : ''}
      </div>
    `;
  }

  // 生成 select 控件
  function renderSelect(field, value, index) {
    const val = value !== undefined ? value : field.default;
    const options = (field.options || []).map(opt => {
      const label = typeof opt === 'object' ? opt.label : opt;
      const v = typeof opt === 'object' ? opt.value : opt;
      return `<option value="${escapeHtml(v)}" ${v === val ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    return `
      <div class="right-prop-group" data-field-index="${index}">
        <div class="right-prop-label">${escapeHtml(field.label)}</div>
        <select class="right-prop-input" id="ccf-input-${index}" style="width:100%;">
          ${options}
        </select>
        ${field.help ? `<div style="font-size:10px;color:#888;margin-top:4px;">${escapeHtml(field.help)}</div>` : ''}
      </div>
    `;
  }

  // 渲染整个面板
  function render(type, currentConfig, onChange, containerId) {
    _activeContainerId = containerId || DEFAULT_CONTAINER_ID;
    const container = getContainer();
    if (!container) {
      console.warn('[CustomConfigPanel] 找不到容器 #' + _activeContainerId);
      return null;
    }

    const def = window.CustomConfigRegistry && window.CustomConfigRegistry.get(type);
    if (!def) {
      container.innerHTML = '<div style="padding:15px;color:#999;font-size:12px;text-align:center;">该类型暂无高级参数</div>';
      return null;
    }

    let html = '';
    def.fields.forEach(function (field, index) {
      const saved = window.CustomConfigRegistry.deepGet(currentConfig || {}, field.key);
      switch (field.type) {
        case 'slider': html += renderSlider(field, saved, index); break;
        case 'color': html += renderColor(field, saved, index); break;
        case 'toggle': html += renderToggle(field, saved, index); break;
        case 'number': html += renderNumber(field, saved, index); break;
        case 'select': html += renderSelect(field, saved, index); break;
        default: html += '<div>未知字段类型: ' + escapeHtml(field.type) + '</div>';
      }
    });

    html += `
      <button class="tool-btn" id="ccf-reset-btn" style="width:100%;margin-top:12px;background:#333;color:#aaa;border-color:#555;">
        ↩ 恢复默认参数
      </button>
    `;

    container.innerHTML = html;

    // 绑定事件
    def.fields.forEach(function (field, index) {
      const input = document.getElementById('ccf-input-' + index);
      if (!input) return;

      const handler = function () {
        // slider 同步显示值
        if (field.type === 'slider') {
          document.getElementById('ccf-val-' + index).textContent =
            parseFloat(input.value).toFixed(field.step < 0.1 ? 2 : 1);
        }
        // color 同步文本框
        if (field.type === 'color') {
          const text = document.getElementById('ccf-text-' + index);
          if (text) text.value = input.value;
        }
        if (onChange) onChange(collectValues());
      };

      input.addEventListener('input', handler);
      if (field.type === 'color' || field.type === 'select' || field.type === 'toggle') {
        input.addEventListener('change', handler);
      }

      // color 文本框反向同步
      if (field.type === 'color') {
        const text = document.getElementById('ccf-text-' + index);
        if (text) {
          text.addEventListener('change', function () {
            input.value = text.value;
            handler();
          });
        }
      }
    });

    // 恢复默认
    document.getElementById('ccf-reset-btn').addEventListener('click', function () {
      const defaults = {};
      def.fields.forEach(function (field) {
        window.CustomConfigRegistry.deepSet(defaults, field.key, field.default);
      });
      if (onChange) onChange(defaults);
      // 重新渲染以显示默认值
      render(type, defaults, onChange);
    });

    return def;
  }

  // 收集当前面板值
  function collectValues() {
    const def = window.CustomConfigRegistry && window.CustomConfigRegistry.get(_currentType);
    if (!def) return {};

    const result = {};
    def.fields.forEach(function (field, index) {
      const input = document.getElementById('ccf-input-' + index);
      if (!input) return;

      let value;
      switch (field.type) {
        case 'toggle':
          value = input.checked;
          break;
        case 'slider':
        case 'number':
          value = parseFloat(input.value);
          if (isNaN(value)) value = field.default;
          break;
        case 'color':
        case 'select':
        default:
          value = input.value;
          break;
      }
      window.CustomConfigRegistry.deepSet(result, field.key, value);
    });
    return result;
  }

  let _currentType = null;

  function getCurrentType() {
    return _currentType;
  }

  function setCurrentType(type) {
    _currentType = type;
  }

  window.CustomConfigPanel = {
    render: function (type, currentConfig, onChange) {
      setCurrentType(type);
      return render(type, currentConfig, onChange);
    },
    collect: collectValues,
    getCurrentType: getCurrentType,
    hasConfig: function (type) {
      return !!(window.CustomConfigRegistry && window.CustomConfigRegistry.has(type));
    }
  };

  console.log('✅ CustomConfigPanel 已加载');
})();
