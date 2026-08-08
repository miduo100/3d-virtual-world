/**
 * debugPanelPreview.js
 * 后台 UI 控件管理器中「坐标调试面板(debug_panel)」的预览渲染。
 * 输出与真实游戏 index.html 完全一致的结构（.debug-panel-box），
 * 复用同一套 container query 样式，实现"拖拽宽高即时重排"的所见即所得。
 */
(function () {
  'use strict';

  window.DebugPanelPreview = {
    /**
     * @param {object} control  控件配置
     * @param {boolean} isSelected 是否选中
     * @returns {string} innerHTML
     */
    getHTML: function (control, isSelected) {
      return (
        '<div class="debug-panel-box preview-debug-panel' +
        (isSelected ? ' selected' : '') +
        '">' +
        '<span class="debug-label">当前坐标</span>' +
        '<span class="debug-coords">' +
        '<span class="coord-axis axis-x">X:+22.4</span>' +
        '<span class="coord-axis axis-y">Y:+11.1</span>' +
        '<span class="coord-axis axis-z">Z:+2.7</span>' +
        '</span>' +
        '<button type="button" class="debug-copy-btn">\uD83D\uDCCB \u590D\u5236</button>' +
        '</div>'
      );
    }
  };
})();
