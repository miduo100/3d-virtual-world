/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * loadingMask.js v1 — 主世界首屏加载遮罩「光之门户」（自注入）
 *
 * 为什么自注入：index.html 已超 500 行（项目红线：大文件禁止追加），本次只在其中加
 * 1 行 <script>，遮罩的 CSS 与 DOM 全部在本模块生成（项目既有惯例：adminIssueRegistry.js /
 * mediaAgentDesc.js 同样自注入 UI）。附带收益：脚本位于 <canvas> 之后、旧 #loadingScreen
 * 之前，解析到时即绘制门户，不会先闪一下旧的黑色转圈屏。
 *
 * 设计稿：H:\创世虚拟世界crm制作文案宣传用\_loading_mask_preview.html 方案 A（全屏居中）
 *
 * 进度口径（两级，模块内单调不回退）：
 *   ① window.LoadingProgress 可见时 → 读 displayPct（真实「下载 0.7 + 渲染确认 0.3」口径）
 *   ② 否则（初始化早期尚无任务集）→ 合成爬升 min(SYNTH_CAP, elapsed/SYNTH_MS*SYNTH_CAP)
 *   注：LoadingProgress 隐藏时会把自身 displayPct 归零，故必须由本模块做单调钳制。
 *
 * 撤除判定（先到先撤；.lm-hide 淡出 FADE_MS 后 display:none）：
 *   ① WorldReadyGate.isReady() → 再等 READY_GRACE_MS（给延时加载的 HDR 天空留换装窗口）
 *   ② 仅当闸门缺失/异常时：LoadingProgress 完成一代（兜底二择）
 *   ③ 【2026-10-08 线上实测新增】画布已真实出画（renderer.info.render.frame 在推进）：
 *      ①/② 只保证"数据就绪"，不保证"画面已出"。index.html 的 body 底色是 #000，
 *      而 WebGL 画布在渲染器出第一帧之前是**透明**的 → 两者脱钩时撤罩会直接露出纯黑，
 *      真机表现为"遮罩撤下后有一段黑屏，过一会儿世界才出来"。线上实测 WorldReadyGate
 *      的 12s 是纯计时兜底（撤罩时几何体仅 131/364、LoadingProgress 64%），慢网/弱机上
 *      world 甚至还没建好就已就绪 → 必须加这道"画面真的在出"的闸门。
 *   ④ 硬超时：画布已出画时 MAX_VISIBLE_MS；画布始终没出画则放宽到 MAX_VISIBLE_STALL_MS
 *      （宁可多盖一会儿品牌遮罩，也不让用户盯纯黑屏）
 *   ⑤ window.__WEBGL2_UNSUPPORTED（让位给 webgl2Guard 的全屏降级提示）
 *
 * 零侵入：不改 world.js / main.js / ui.js / loadingProgress.js，也不改 index.html 既有结构。
 * 唯一包装 = UI.hideLoadingScreen（原因见 _patchUIHide）。
 *
 * 诊断：window.LoadingMask._diag()
 */
(function () {
  'use strict';

  var CFG = {
    TICK_MS: 250,           // 驱动节拍（走 BgThrottle，页面后台自动冻结）
    SYNTH_MS: 9000,         // 合成进度爬升到上限所需时间
    SYNTH_CAP: 92,          // 合成进度上限（余量留给真实进度收尾）
    READY_GRACE_MS: 800,    // 就绪后再等，让延迟天空先换上，避免"遮罩一撤就灰天"
    MAX_VISIBLE_MS: 15000,  // 硬兜底（画布已出画时）
    MAX_VISIBLE_STALL_MS: 30000, // 画布始终没出画时的兜底（防遮罩永久遮挡）
    MIN_FRAMES: 3,          // 认为"画布已出画"所需的最小帧数
    FADE_MS: 620            // 与 CSS transition 时长保持一致
  };

  /* ---------- 样式（注入 <head>） ---------- */
  var CSS = [
    '#loadingScreen{display:none !important}',                    /* 旧黑色遮罩：永久隐藏，本模块接管 */
    '#loadingMask{position:fixed;inset:0;z-index:1200;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box;',
    'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#eef2ff;',
    'background:radial-gradient(70% 90% at 50% 108%,rgba(255,179,71,.16),transparent 62%),',
    'radial-gradient(90% 70% at 50% -12%,rgba(0,229,255,.16),transparent 60%),',
    'linear-gradient(180deg,#0A0E27 0%,#141836 100%);',
    'opacity:1;visibility:visible;transition:opacity .62s ease,visibility .62s ease}',
    '#loadingMask::before{content:"";position:absolute;inset:0;pointer-events:none;',
    'background-image:radial-gradient(rgba(139,146,168,.16) 1px,transparent 1px);background-size:22px 22px;',
    '-webkit-mask-image:radial-gradient(70% 70% at 50% 50%,#000 20%,transparent 78%);',
    'mask-image:radial-gradient(70% 70% at 50% 50%,#000 20%,transparent 78%)}',
    '#loadingMask>*{position:relative;z-index:2}',
    '#loadingMask.lm-hide{opacity:0;visibility:hidden}',
    '.lm-portal{position:relative;width:150px;height:150px;margin-bottom:6px;display:flex;align-items:center;justify-content:center}',
    '.lm-ring{position:absolute;border-radius:50%;border:2px solid transparent}',
    '.lm-r1{inset:0;border-top-color:#00E5FF;border-right-color:rgba(0,229,255,.25);animation:lm-spin 2.6s linear infinite}',
    '.lm-r2{inset:16px;border-bottom-color:#FFB347;border-left-color:rgba(255,179,71,.25);animation:lm-spin 3.6s linear infinite reverse}',
    '.lm-r3{inset:32px;border-top-color:rgba(102,240,255,.7);animation:lm-spin 1.8s linear infinite}',
    '.lm-core{width:52px;height:52px;border-radius:50%;',
    'background:radial-gradient(circle,#fff 0%,#FFD699 34%,rgba(255,179,71,.35) 62%,transparent 74%);',
    'box-shadow:0 0 34px rgba(255,179,71,.7),0 0 70px rgba(0,229,255,.25);animation:lm-pulse 2.4s ease-in-out infinite}',
    '@keyframes lm-spin{to{transform:rotate(360deg)}}',
    '@keyframes lm-pulse{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.14);opacity:1}}',
    '.lm-brand{font-size:15px;font-weight:700;letter-spacing:.14em;color:#8B92A8;margin-bottom:16px;text-transform:uppercase}',
    '.lm-brand b{color:#fff;font-weight:800}',
    '.lm-title{font-size:26px;font-weight:800;letter-spacing:.03em;margin:0 0 8px;color:#eef2ff}',
    '.lm-title em{font-style:normal;color:#00E5FF}',
    '.lm-tip{color:#8B92A8;font-size:13.5px;margin:0 0 26px;letter-spacing:.02em}',
    '.lm-bar{width:280px;max-width:74%;height:4px;border-radius:99px;background:rgba(139,146,168,.2);overflow:hidden}',
    '.lm-bar>i{display:block;height:100%;width:0;border-radius:99px;',
    'background:linear-gradient(90deg,#00E5FF,#66F0FF 70%,#FFB347);box-shadow:0 0 12px rgba(0,229,255,.6);transition:width .3s ease}',
    '.lm-pct{margin-top:12px;font-size:12.5px;color:#8B92A8;font-variant-numeric:tabular-nums;letter-spacing:.06em}',
    '.lm-pct b{color:#66F0FF;font-weight:600}',
    /* 遮罩期间隐藏游客提示条：它由 main.js 创建、z-index:3000，会浮在品牌遮罩之上，
       而遮罩本身就屏蔽点击 → 上面的「登录/注册」按钮看得见却点不动（观感差） */
    'body.lm-masking #guestBanner{display:none !important}',
    '@media (max-width:768px){.lm-portal{width:104px;height:104px}.lm-core{width:36px;height:36px}',
    '.lm-title{font-size:20px}.lm-tip{font-size:12px;margin-bottom:18px}.lm-bar{width:78%;max-width:78%}}'
  ].join('');

  /* ---------- 结构（追加到 <body>） ----------
     data-lm-fallback：语言包缺该键时的兜底文案（见 _healI18n）。
     i18n.t() 在缺键时**返回 key 原文**，而 translatePage() 会把它整段写进 textContent →
     若线上语言包没同步，遮罩上会出现 "world.loadTitle" 这种字样，故必须自带兜底。 */
  var HTML = '<div class="lm-portal">' +
      '<span class="lm-ring lm-r1"></span><span class="lm-ring lm-r2"></span>' +
      '<span class="lm-ring lm-r3"></span><span class="lm-core"></span>' +
    '</div>' +
    '<div class="lm-brand">GENESIS · <b>创世</b></div>' +
    '<h3 class="lm-title"><span data-i18n="world.loadTitle" data-lm-fallback="正在开启你的">正在开启你的</span>' +
      '<em data-i18n="world.loadTitleEm" data-lm-fallback="世界">世界</em></h3>' +
    '<p class="lm-tip" data-i18n="world.loadTip" data-lm-fallback="首次进入需要加载场景资源，稍等几秒">首次进入需要加载场景资源，稍等几秒</p>' +
    '<div class="lm-bar"><i></i></div>' +
    '<div class="lm-pct"><span data-i18n="world.loadBuilding" data-lm-fallback="正在构建世界">正在构建世界</span> · <b>0%</b></div>';

  var el = null, barEl = null, pctEl = null, legacyEl = null;
  var phase = 'idle';        // idle | running | fading | done
  var lastReason = null;     // ready | timeout | webgl2 | manual
  var pct = 0;
  var startedAt = 0, readyAt = 0;
  var fadeTimer = null, uiHidePatched = false;
  var _lastHealAt = 0;

  function _injectStyle() {
    if (document.getElementById('loadingMaskStyle')) return;
    var s = document.createElement('style');
    s.id = 'loadingMaskStyle';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function _buildDom() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'loadingMask';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', '正在开启世界');
    el.innerHTML = HTML;
    (document.body || document.documentElement).appendChild(el);
    barEl = el.querySelector('.lm-bar > i');
    pctEl = el.querySelector('.lm-pct b');
  }

  // 初始化结束时 main.js 会调 UI.hideLoadingScreen() 立刻撤遮罩 —— 而那正是
  // 「灰天 + 蓝方块」露出来的时刻，与本遮罩目的相悖。保护期内吞掉该调用，
  // 真正撤下由 _finish() 决定；phase='done' 之后行为与原来完全一致（可逆）。
  function _patchUIHide() {
    if (uiHidePatched) return;
    if (!window.UI || typeof window.UI.hideLoadingScreen !== 'function') return;
    var orig = window.UI.hideLoadingScreen;
    window.UI.hideLoadingScreen = function () {
      if (phase !== 'done') return;
      return orig.apply(this, arguments);
    };
    uiHidePatched = true;
  }

  // 语言包缺键自愈：translatePage() 会把 i18n.t() 的返回值（缺键时=key 原文）写进 textContent，
  // 若线上 i18n json 未同步，遮罩会出现 "world.loadTitle" 字样 → 检测到 textContent === key
  // 就换回 data-lm-fallback 的兜底文案。i18n 初始化是异步的，故每 tick 兜一次（极廉价）。
  function _healI18n() {
    if (!el) return;
    var nodes = el.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], k = n.getAttribute('data-i18n');
      if (k && n.textContent.trim() === k) {
        n.textContent = n.getAttribute('data-lm-fallback') || '';
      }
    }
  }

  // 【黑屏硬保险】撤罩前主动同步渲染一帧。
  // 为什么需要：`alpha:false` 的 opaque 画布在"从未绘制"或"drawingBuffer 被重新分配
  // （setSize/窗口 resize）后还没重画"时，按规范就是**纯黑**——而 world.js 的绘制在
  // animate() 的最末尾，主线程被加载阻塞时可能长时间跑不到那里。此处直接借渲染器画一帧，
  // 代价=一帧渲染量（与 animate 同款操作），收益=保证遮罩移开的那一刻画布一定有内容。
  function _forceRenderOnce() {
    try {
      var gw = window.gameWorld;
      if (gw && gw.renderer && gw.scene && gw.camera) gw.renderer.render(gw.scene, gw.camera);
    } catch (e) { /* 上下文丢失等情况下忽略：至少不会影响遮罩撤除 */ }
  }

  // 遮罩期间给 body 打标记（CSS 用它隐藏游客提示条，见上面的 body.lm-masking 规则）
  function _maskingClass(on) {
    try { document.body.classList[on ? 'add' : 'remove']('lm-masking'); } catch (e) { /* ignore */ }
  }

  function _setPct(v) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    pct = Math.max(pct, Math.min(100, v));   // 单调不回退
  }

  function _render() {
    if (barEl) barEl.style.width = pct.toFixed(1) + '%';
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
  }

  function _realPct() {
    try {
      var lp = window.LoadingProgress;
      if (!lp || typeof lp._diag !== 'function') return null;
      var d = lp._diag();
      if (!d || !d.visible) return null;
      return typeof d.displayPct === 'number' ? d.displayPct : null;
    } catch (e) { return null; }
  }

  function _frames() {
    try {
      var gw = window.gameWorld;
      if (!gw || !gw.renderer || !gw.renderer.info || !gw.renderer.info.render) return null;
      return gw.renderer.info.render.frame | 0;
    } catch (e) { return null; }
  }

  // 画布是否"真的在出画"：帧号与上一 tick 相比在推进且已出过若干帧。
  // 为什么必须有这道闸门：body 底色 #000，而 WebGL 画布在渲染器出第一帧前是透明的，
  // 撤罩时若画布尚无内容 → 用户看到纯黑（线上实测的"撤罩后一段黑屏"就是这个）。
  // 注意：主线程被加载阻塞时 tick 本身也不执行，恢复后帧号会一次性跳大 → 仍判为在出画，
  // 这正是想要的语义（阻塞期结束、画面已恢复）。
  var _lastFrames = -1;
  var _aliveSeen = false;
  function _renderAlive() {
    var f = _frames();
    if (f == null) return false;
    var alive = _lastFrames >= 0 && f > _lastFrames && f >= CFG.MIN_FRAMES;
    if (alive) _aliveSeen = true;
    _lastFrames = f;
    return alive;
  }

  function _gateReady() {
    var gate = window.WorldReadyGate;
    if (gate && typeof gate.isReady === 'function') {
      try { return !!gate.isReady(); } catch (e) { return false; }
    }
    try { return ((window.LoadingProgress._diag() || {}).completedGens || 0) >= 1; }
    catch (e) { return false; }
  }

  function _finish(reason) {
    if (phase !== 'running') return;
    phase = 'fading';
    lastReason = reason;
    _forceRenderOnce();       // 淡出开始前先保证画布有内容（否则淡出过程就是看着它变黑）
    if (el) el.classList.add('lm-hide');
    console.log('[LoadingMask] 撤下遮罩 reason=' + reason +
      ' t=' + Math.round(performance.now()) + 'ms pct=' + Math.round(pct) + '%' +
      ' frames=' + _lastFrames);
    fadeTimer = setTimeout(function () {
      fadeTimer = null;
      _forceRenderOnce();     // 真正 display:none 之前再补一帧，杜绝"撤罩即纯黑"
      if (el) el.style.display = 'none';
      _maskingClass(false);   // 淡出结束才恢复游客提示条
      phase = 'done';
    }, CFG.FADE_MS);
  }

  // 外部强制关闭（showLoginScreen 直接 display:none）→ 本模块安静收工
  function _hardStop() {
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    if (el) el.classList.remove('lm-hide');
    _maskingClass(false);
    phase = 'done';
  }

  function _tick() {
    if (!el) return;
    if (Date.now() - _lastHealAt > 1000) { _lastHealAt = Date.now(); _healI18n(); }

    // 旧 #loadingScreen 的 inline display 是外部意图信号：
    //   'flex' = handleTeleportArrival（传送到达）→ 重新启用；'none' = showLoginScreen → 收工
    var legacyDisp = legacyEl ? legacyEl.style.display : '';
    if (legacyDisp === 'flex' && phase === 'done') { show(); }
    else if (legacyDisp === 'none' && phase === 'running') { _hardStop(); }
    if (phase !== 'running') return;

    var elapsed = Date.now() - startedAt;
    var real = _realPct();
    if (real != null) _setPct(real);
    else _setPct(Math.min(CFG.SYNTH_CAP, (elapsed / CFG.SYNTH_MS) * CFG.SYNTH_CAP));
    _render();

    if (window.__WEBGL2_UNSUPPORTED) { _finish('webgl2'); return; }

    var alive = _renderAlive();   // 每 tick 只探一次（内部推进 _lastFrames）

    if (_gateReady()) {
      if (!readyAt) readyAt = Date.now();
      // 就绪 + 画面已真的在出（否则会把纯黑露出来）→ 再等宽限期后撤
      if (alive && Date.now() - readyAt >= CFG.READY_GRACE_MS) { _finish('ready'); return; }
    }
    // 硬兜底：画布没出画时放宽（宁可多盖一会儿，也不让用户盯纯黑屏）
    if (elapsed >= (alive ? CFG.MAX_VISIBLE_MS : CFG.MAX_VISIBLE_STALL_MS)) _finish('timeout');
  }

  function show() {
    if (!el) return;
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    el.classList.remove('lm-hide');
    el.style.display = 'flex';
    _maskingClass(true);
    phase = 'running';
    pct = 0; startedAt = Date.now(); readyAt = 0;
    _render();
  }

  function hide() {
    if (phase === 'running') _finish('manual');
    else _hardStop();
  }

  function _start() {
    if (!el) return;                 // 未注入成功则静默停用
    _patchUIHide();
    legacyEl = document.getElementById('loadingScreen');
    _maskingClass(true);
    phase = 'running';
    startedAt = Date.now();
    _render();
    var tickFn = function () { try { _tick(); } catch (e) { /* 遮罩绝不影响主流程 */ } };
    if (window.BgThrottle) window.BgThrottle.every('loadingMask.tick', CFG.TICK_MS, tickFn);
    else setInterval(tickFn, CFG.TICK_MS);
  }

  window.LoadingMask = {
    show: show,
    hide: hide,
    isVisible: function () { return phase === 'running' || phase === 'fading'; },
    setProgress: function (v) { _setPct(v); _render(); },
    _diag: function () {
      return {
        phase: phase, pct: pct, lastReason: lastReason,
        elapsedMs: startedAt ? Date.now() - startedAt : 0,
        readyAt: readyAt || null, uiHidePatched: uiHidePatched,
        frames: _lastFrames, canvasDrewFrames: _aliveSeen   // 画布是否已真实出画（排查"撤罩后黑屏"用）
      };
    }
  };

  // —— 立即注入：此刻 #loadingScreen 尚未被解析，旧黑屏一帧都不会出现 ——
  _injectStyle();
  _buildDom();

  // —— 驱动循环在 DOMContentLoaded 启动：那时 BgThrottle / LoadingProgress / WorldReadyGate
  //    已全部就绪，且早于 main.js 的 window.load 初始化（包装 UI.hideLoadingScreen 才来得及）——
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _start);
  } else {
    _start();
  }
})();
