/**
 * adminPortalPaste.js
 * 传送门表单坐标粘贴助手：
 * 1. "📋 粘贴坐标" 按钮：读剪贴板整段坐标文本填入 X/Y/Z 三个输入框
 * 2. 直接在任一坐标输入框 Ctrl+V 整段文本（如 "X:-247.9 Y:0.4 Z:452.5"）也能识别
 * 支持格式：
 *   X:-247.9 Y:0.4 Z:452.5
 *   X=-247.9, Y=0.4, Z=452.5
 *   x：-247.9 y：0.4 z：452.5
 *   (-247.9, 0.4, 452.5)
 *   -247.9, 0.4, 452.5
 *   -247.9 0.4 452.5
 */
(function () {
  'use strict';

  function tt(key, fallback) {
    try {
      var v = window.i18n && window.i18n.t && window.i18n.t(key);
      if (v && v !== key) return v;
    } catch (e) { /* ignore */ }
    return fallback;
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    if (type === 'error') alert(msg);
    else console.log('[PortalPaste]', msg);
  }

  function parseCoords(text) {
    if (text == null) return null;
    var t = String(text).trim();
    if (!t) return null;
    // 1) 带 X/Y/Z 标签的格式
    var out = {};
    var labeled = true;
    ['x', 'y', 'z'].forEach(function (k) {
      var m = t.match(new RegExp(k + '\\s*[:=＝：]\\s*(-?\\d+(?:\\.\\d+)?)', 'i'));
      if (m) out[k] = parseFloat(m[1]);
      else labeled = false;
    });
    if (labeled) return out;
    // 2) 纯数字序列（至少 3 个，取前 3 个）
    var nums = t.match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 3) return null;
    return {
      x: parseFloat(nums[0]),
      y: parseFloat(nums[1]),
      z: parseFloat(nums[2])
    };
  }

  function applyTo(prefix, text) {
    var c = parseCoords(text);
    if (!c) return false;
    document.getElementById(prefix + '-x').value = c.x;
    document.getElementById(prefix + '-y').value = c.y;
    document.getElementById(prefix + '-z').value = c.z;
    return true;
  }

  function fallbackPrompt(cb) {
    var t = window.prompt(tt('adminFed.fedPortalPastePrompt',
      '请粘贴坐标文本（支持 X:-247.9 Y:0.4 Z:452.5 或 -247.9, 0.4, 452.5 格式）：'), '');
    if (t != null) cb(t);
  }

  function readClipboard(cb) {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(cb).catch(function () { fallbackPrompt(cb); });
    } else {
      fallbackPrompt(cb);
    }
  }

  window.AdminPortalPaste = {
    parse: parseCoords,
    pasteInto: function (prefix) {
      readClipboard(function (text) {
        if (applyTo(prefix, text)) {
          toast(tt('adminFed.fedPortalPasteOk', '坐标已填入'), 'success');
        } else {
          toast(tt('adminFed.fedPortalPasteFail',
            '无法识别坐标，请粘贴如 X:-247.9 Y:0.4 Z:452.5 或 -247.9, 0.4, 452.5 格式的文本'), 'error');
        }
      });
    }
  };

  // 在 X/Y/Z 任一输入框内 Ctrl+V 整段坐标文本时自动拆分填入
  ['portal-position', 'portal-target'].forEach(function (prefix) {
    ['x', 'y', 'z'].forEach(function (axis) {
      var el = document.getElementById(prefix + '-' + axis);
      if (!el) return;
      el.addEventListener('paste', function (e) {
        var text = e.clipboardData ? e.clipboardData.getData('text') : '';
        if (!text) return;
        if (parseCoords(text)) {
          e.preventDefault();
          if (applyTo(prefix, text)) {
            toast(tt('adminFed.fedPortalPasteOk', '坐标已填入'), 'success');
          }
        }
        // 无法识别整段坐标时不拦截，让浏览器按普通粘贴处理
      });
    });
  });
})();
