/**
 * coordFormat.js
 * 坐标格式化工具（自然宽度带符号，如 +22.4 / -8.3）
 * 挂载到 window，供 world.js / main.js / 后台预览共用
 */
(function () {
  'use strict';

  // 自然宽度带符号：整数位不补零，保留 1 位小数
  window.formatCoord = function (v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    var sign = n < 0 ? '-' : '+';
    return sign + Math.abs(n).toFixed(1);
  };

  /**
   * 将坐标写入 debug 面板的三个轴 span（拆分显示）。
   * 若页面仍是旧版单 span（#debug-pos），则回退为整体写入，保证向后兼容。
   * @param {{x:number,y:number,z:number}} pos
   */
  window.updateCoordDisplay = function (pos) {
    if (!pos) return;
    var xEl = document.getElementById('coord-x');
    var yEl = document.getElementById('coord-y');
    var zEl = document.getElementById('coord-z');
    if (xEl && yEl && zEl) {
      xEl.textContent = 'X:' + window.formatCoord(pos.x);
      yEl.textContent = 'Y:' + window.formatCoord(pos.y);
      zEl.textContent = 'Z:' + window.formatCoord(pos.z);
      return;
    }
    // 向后兼容：旧结构单 span
    var posEl = document.getElementById('debug-pos');
    if (posEl) {
      posEl.textContent =
        'X:' + pos.x.toFixed(1) +
        ' Y:' + pos.y.toFixed(1) +
        ' Z:' + pos.z.toFixed(1);
    }
  };
})();
