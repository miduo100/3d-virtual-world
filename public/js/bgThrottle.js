/**
 * bgThrottle.js —— 页面后台（标签页隐藏）时冻结全局 setInterval
 *
 * 背景：rAF 在标签页失焦时浏览器会自动节流，但 setInterval 不会
 * （尤其当页面有音频活动时，Chrome 不会做强化节流）。挂机切窗后，
 * 各常驻轮询（占位符扫场/进度条/小地图/视频检查/空间分页）仍在烧 CPU。
 *
 * 用法（各模块）：
 *   创建：  timer = BgThrottle.every('gb.sweep', 2000, fn)   // 返回 truthy key
 *           （无 BgThrottle 时各调用方自行回退 setInterval）
 *   销毁：  BgThrottle.cancel('gb.sweep')                     // 替代 clearInterval
 *
 * 行为：
 *   - document.hidden = true  → 全部注册的 interval 被 clearInterval（CPU→0）
 *   - document.hidden = false → 全部按原 fn/ms 重建
 *   - every() 对相同 key 幂等（先清旧再建新，比裸 setInterval 更安全）
 */
(function () {
  'use strict';

  var _timers = new Map(); // key -> { fn, ms, id }
  var _hidden = document.hidden === true;

  function _start(rec) {
    if (rec.id) return;
    rec.id = setInterval(rec.fn, rec.ms);
  }

  function _stop(rec) {
    if (rec.id) {
      clearInterval(rec.id);
      rec.id = null;
    }
  }

  /** 注册一个可被后台冻结的 interval，返回 truthy key（可存到模块字段做"已启动"标记） */
  function every(key, ms, fn) {
    if (typeof fn !== 'function' || !(ms > 0)) return null;
    var rec = _timers.get(key);
    if (!rec) {
      rec = { fn: fn, ms: ms, id: null };
      _timers.set(key, rec);
    } else {
      rec.fn = fn;
      rec.ms = ms;
      _stop(rec); // 同 key 幂等：先清旧
    }
    if (!_hidden) _start(rec);
    return key;
  }

  /** 注销（模块自己的 stop 函数用它替代 clearInterval） */
  function cancel(key) {
    var rec = _timers.get(key);
    if (!rec) return false;
    _stop(rec);
    _timers.delete(key);
    return true;
  }

  function _onVisibility() {
    _hidden = document.hidden === true;
    _timers.forEach(function (rec) {
      if (_hidden) {
        _stop(rec);
      } else {
        _start(rec); // 恢复：立刻按原节奏重建，fn 会补跑当前状态
      }
    });
  }

  document.addEventListener('visibilitychange', _onVisibility);

  window.BgThrottle = {
    every: every,
    cancel: cancel,
    _diag: function () {
      var arr = [];
      _timers.forEach(function (rec, key) {
        arr.push({ key: key, ms: rec.ms, running: !!rec.id });
      });
      return { hidden: _hidden, count: arr.length, timers: arr };
    }
  };
})();
