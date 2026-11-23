/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 管理员模式模型灯光 · 浮层外壳：样式、容器、拖动、贴边收起（2026-11-04）  v3
 * 依赖：无（纯 DOM）
 * 不做：不渲染灯光参数（由 adminModelLightingPanel 填充 body）
 * 诊断：window.AdminModelLightingFloat._diag()
 */
(function () {
  'use strict';
  if (window.__ADMIN_LIGHTING_OFF) return;
  if (window.AdminModelLightingFloat) return;

  var STORE_KEY = 'amlPanelPos';
  var WIDTH = 262;
  var COLLAPSED_W = 40;

  var CSS = [
    // 【2026-11-05 可发现性】入口按钮改为实心暖光底 + 深色字 + 外发光，和周围深色面板形成强对比；
    // 0 盏时降级为暗底描边（.empty），避免没灯的模型也在抢视线，有灯才亮。
    '#aml-entry{width:100%;margin-top:10px;padding:9px 10px;display:flex;align-items:center;gap:7px;',
    'background:linear-gradient(135deg,#ffd68a 0%,#f5a623 100%);border:1px solid #ffe4ae;border-radius:5px;',
    'color:#2b1a00;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;text-align:left;',
    'letter-spacing:.3px;box-shadow:0 2px 10px rgba(245,166,35,.35),inset 0 1px 0 rgba(255,255,255,.5);',
    'transition:filter .15s,box-shadow .15s,transform .08s}',
    '#aml-entry:hover{filter:brightness(1.07);box-shadow:0 3px 16px rgba(245,166,35,.6),inset 0 1px 0 rgba(255,255,255,.6)}',
    '#aml-entry:active{transform:translateY(1px);filter:brightness(.97)}',
    '#aml-entry .c{margin-left:auto;font-size:10px;font-weight:700;padding:1.5px 7px;border-radius:9px;',
    'background:rgba(43,26,0,.18);color:#2b1a00;letter-spacing:0}',
    '#aml-entry.empty{background:rgba(255,220,168,.1);border-color:rgba(255,220,168,.35);color:#d8bf95;',
    'font-weight:600;box-shadow:none}',
    '#aml-entry.empty:hover{background:rgba(255,220,168,.18);box-shadow:none}',
    '#aml-entry.empty .c{background:rgba(255,220,168,.12);color:#d8bf95}',
    '#aml-pop{position:fixed;right:274px;top:12px;width:262px;z-index:10050;padding:10px;',
    'background:rgba(18,18,22,.94);border:1px solid rgba(255,220,168,.3);border-radius:8px;',
    'box-shadow:0 16px 44px rgba(0,0,0,.7);backdrop-filter:blur(12px);color:#e8e8ec;',
    'font-family:-apple-system,"Microsoft YaHei",sans-serif;font-size:11px;display:none}',
    '#aml-pop.open{display:block}',
    '#aml-pop.collapsed{width:40px;padding:8px 0;overflow:hidden;cursor:pointer;text-align:center}',
    '#aml-pop.collapsed #aml-head,#aml-pop.collapsed #aml-body{display:none}',
    '#aml-pop .cf{display:none;font-size:12px;line-height:1.9;color:#ffdca8}',
    '#aml-pop.collapsed .cf{display:block}',
    '#aml-head{display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:move;user-select:none}',
    '#aml-body{max-height:calc(100vh - 110px);overflow-y:auto;overflow-x:hidden;padding-right:2px}',
    '#aml-body::-webkit-scrollbar{width:5px}',
    '#aml-body::-webkit-scrollbar-thumb{background:rgba(255,220,168,.25);border-radius:3px}',
    '#aml-head .t{font-weight:600;font-size:12px;color:#ffdca8}',
    '#aml-head .c{margin-left:auto;font-size:10px;color:#8a8a95;font-weight:400}',
    '#aml-close{margin-left:6px;color:#7d7d88;cursor:pointer;font-size:13px;line-height:1}',
    '#aml-close:hover{color:#fff}',
    '.aml-btn{width:100%;padding:7px;border:0;border-radius:5px;font-family:inherit;font-size:11px;',
    'cursor:pointer;background:#2c2c34;color:#d8d8e0}',
    '.aml-btn:hover{filter:brightness(1.2)}',
    '.aml-btn.warm{background:rgba(255,220,168,.15);color:#ffdca8;border:1px solid rgba(255,220,168,.45)}',
    '.aml-btn.red{background:#a43d4a;color:#fff}',
    '.aml-btn.green{background:#23a55a;color:#fff}',
    '.aml-chips{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0}',
    '.aml-chip{padding:3px 7px;border-radius:4px;background:#22222a;border:1px solid #33333c;',
    'color:#a8a8b2;font-size:10px;cursor:pointer;display:flex;align-items:center;gap:4px}',
    '.aml-chip.sel{border-color:rgba(255,220,168,.6);background:rgba(255,220,168,.14);color:#ffdca8}',
    '.aml-chip i{width:5px;height:5px;border-radius:50%;background:#55555f;font-style:normal}',
    '.aml-chip.on i{background:#4caf50;box-shadow:0 0 5px #4caf50}',
    '.aml-row{display:flex;align-items:center;justify-content:space-between;margin:7px 0;font-size:10.5px;color:#9a9aa4}',
    '.aml-row output{color:#d8d8e0;font-family:Consolas,monospace}',
    '.aml-sec{font-size:9.5px;color:#8a8a95;margin:10px 0 3px;display:flex;align-items:center;gap:6px}',
    '.aml-sec:after{content:"";flex:1;height:1px;background:rgba(255,255,255,.08)}',
    '#aml-pop input[type=range]{-webkit-appearance:none;width:100%;height:3px;border-radius:3px;background:#33333c;outline:none}',
    '#aml-pop input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;',
    'border-radius:50%;background:#ffdca8;cursor:pointer;box-shadow:0 0 7px rgba(255,220,168,.7)}',
    '#aml-pop input[type=color]{width:28px;height:20px;padding:0;border:1px solid #33333c;background:none;cursor:pointer}',
    '#aml-pop input[type=checkbox]{accent-color:#ffdca8;width:12px;height:12px;vertical-align:-1px}',
    '#aml-pop select{background:#0e0e12;border:1px solid #33333c;color:#d8d8e0;font-size:10px;',
    'padding:2px 3px;border-radius:3px;font-family:inherit;width:100%}',
    '#aml-status{font-size:9.5px;color:#7d7d88;margin-top:7px;min-height:13px}',
    '.aml-tip{font-size:9.5px;color:#7d7d88;line-height:1.5;background:rgba(255,255,255,.03);',
    'border-left:2px solid rgba(255,220,168,.4);padding:5px 6px;border-radius:0 3px 3px 0;margin:6px 0}',
    '.aml-tip b{color:#ffdca8;font-weight:500}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('aml-style')) return;
    var s = document.createElement('style');
    s.id = 'aml-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function create(opts) {
    opts = opts || {};
    injectStyle();

    var el = document.createElement('div');
    el.id = 'aml-pop';
    el.innerHTML = '<div class="cf">💡<br><span class="n">0</span></div>' +
      '<div id="aml-head"><span>⠿</span><span class="t">模型灯光</span><span class="c"></span>' +
      '<span id="aml-close">✕</span></div><div id="aml-body"></div>';
    document.body.appendChild(el);

    var body = el.querySelector('#aml-body');
    var head = el.querySelector('#aml-head');
    var drag = null;

    function fixedPos() {
      if (el.dataset.fixed) return;
      var r = el.getBoundingClientRect();
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.right = 'auto';
      el.dataset.fixed = '1';
    }

    function persist() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          left: el.style.left, top: el.style.top,
          collapsed: el.classList.contains('collapsed')
        }));
      } catch (e) { /* 隐私模式忽略 */ }
    }

    /** 右侧管理员面板的左边界，浮层不能越过去 */
    function panelLeftEdge() {
      var host = document.getElementById('selected-object-info');
      if (host) {
        var r = host.getBoundingClientRect();
        if (r.width > 0) return r.left;
      }
      return window.innerWidth - 274;
    }

    /** 把浮层钳制回可视区，并避开右侧管理员面板 */
    function clampIntoView() {
      var width = el.classList.contains('collapsed') ? COLLAPSED_W : WIDTH;
      var left = parseFloat(el.style.left);
      if (!isFinite(left)) return;
      var top = parseFloat(el.style.top);
      if (!isFinite(top)) top = 12;
      var maxLeft = Math.min(window.innerWidth - width - 6, panelLeftEdge() - width - 8);
      el.style.left = Math.max(4, Math.min(maxLeft, left)) + 'px';
      el.style.top = Math.max(4, Math.min(window.innerHeight - 60, top)) + 'px';
    }

    function collapse() {
      fixedPos();
      el.classList.add('collapsed');
      var left = parseFloat(el.style.left) || 0;
      var onRight = left + WIDTH > window.innerWidth - 20;
      el.style.left = (onRight ? window.innerWidth - COLLAPSED_W - 6 : 6) + 'px';
      persist();
    }

    function expand() {
      var left = parseFloat(el.style.left) || 0;
      var onRight = left > window.innerWidth / 2;
      el.classList.remove('collapsed');
      if (onRight) el.style.left = Math.max(6, window.innerWidth - WIDTH - 6) + 'px';
      persist();
    }

    head.addEventListener('pointerdown', function (e) {
      if (e.target.id === 'aml-close' || el.classList.contains('collapsed')) return;
      fixedPos();
      var r = el.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      el.style.opacity = '0.86';
      try { head.setPointerCapture(e.pointerId); } catch (err) { /* 旧浏览器 */ }
      e.preventDefault();
    });

    head.addEventListener('pointermove', function (e) {
      if (!drag) return;
      el.style.left = Math.max(4, Math.min(window.innerWidth - 60, e.clientX - drag.dx)) + 'px';
      el.style.top = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - drag.dy)) + 'px';
    });

    head.addEventListener('pointerup', function () {
      if (!drag) return;
      drag = null;
      el.style.opacity = '1';
      var r = el.getBoundingClientRect();
      if (r.left < 34 || r.left + r.width > window.innerWidth - 20) collapse();
      else persist();
    });

    head.addEventListener('dblclick', function () {
      el.classList.remove('collapsed');
      el.style.left = '';
      el.style.right = '274px';
      el.style.top = '12px';
      delete el.dataset.fixed;
      persist();
    });

    el.querySelector('#aml-close').addEventListener('click', function () {
      el.classList.remove('open');
      if (opts.onClose) opts.onClose();
    });

    el.addEventListener('click', function (e) {
      if (!el.classList.contains('collapsed')) return;
      e.stopPropagation();
      expand();
      if (opts.onExpand) opts.onExpand();
    });

    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved && saved.left) {
        fixedPos();
        el.style.left = saved.left;
        el.style.top = saved.top;
        if (saved.collapsed) el.classList.add('collapsed');
        clampIntoView();
      }
    } catch (e) { /* 忽略 */ }

    window.addEventListener('resize', function () {
      if (el.classList.contains('open') || el.classList.contains('collapsed')) clampIntoView();
    });

    return {
      el: el,
      body: body,
      open: function () {
        el.classList.add('open');
        el.classList.remove('collapsed');
        if (!el.dataset.fixed) fixedPos();
        clampIntoView();
      },
      close: function () { el.classList.remove('open'); },
      isOpen: function () { return el.classList.contains('open'); },
      isCollapsed: function () { return el.classList.contains('collapsed'); },
      setCount: function (n) {
        var c = el.querySelector('.cf .n');
        if (c) c.textContent = n;
      },
      setHead: function (text) {
        var h = el.querySelector('#aml-head .c');
        if (h) h.textContent = text;
      },
      destroy: function () { if (el.parentNode) el.parentNode.removeChild(el); }
    };
  }

  window.AdminModelLightingFloat = {
    create: create,
    _diag: function () { return { style: !!document.getElementById('aml-style'), mounted: !!document.getElementById('aml-pop') }; }
  };
})();
