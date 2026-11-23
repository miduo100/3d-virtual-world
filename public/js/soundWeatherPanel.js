/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundWeatherPanel.js —— 天气控制页里两个声音入口的外壳
 *
 * 两个入口、两个弹窗，各弹各的（用户明确要求拆开）：
 *   🔊 天气声音   → 弹窗 A：风/雨/雪/雾/雷 五张卡 + 候选池
 *   🎵 场景背景音 → 弹窗 B：背景音那张卡（含上传）
 * 页面本身只留两行摘要（各 40 多像素），不会把下面的内容挤下去。
 *
 * 为什么单独一个文件：
 *   原来外壳和业务都塞在 soundWeather.js 里，那个文件已经卡在 500 行红线。
 *   这里只管壳（摘要行 / 遮罩 / 弹窗容器 / CSS），业务渲染仍在各自模块里。
 *
 * 对外：window.SoundWeatherPanel
 *   mountEntry(host, onConfig)  画两行摘要，点按钮触发 onConfig('weather' | 'music')
 *   setSummary / setMusicSummary  更新两行摘要的文字
 *   openModal(kind) / closeModal(kind) / isOpen(kind)
 */
(function () {
  'use strict';

  // 两类入口各自的弹窗配置：标题、说明、里面装什么
  var MODALS = {
    weather: {
      maskId: 'swp-mask', xId: 'swp-x',
      title: '🔊 天气声音',
      sub: '每种天气各有一组候选，也可以直接上传音频（落在素材库）；选完点「保存全部」，再点页面上的「立即应用并广播」',
      body: '<div class="sw-grid" id="sw-grid"></div>'
    },
    music: {
      maskId: 'smp-mask', xId: 'smp-x',
      title: '🎵 场景背景音',
      sub: '选一段进世界就播的声音，或直接上传音频文件；选完点「保存背景音」',
      body: '<div id="sm-host"></div>'
    }
  };

  var CSS = [
    '.swp-entry{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:rgba(255,255,255,0.02);flex-wrap:wrap}',
    '.swp-tt{font-size:12px;color:var(--text);flex-shrink:0}',
    '.swp-sum{font-size:11px;color:var(--muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.swp-sum b{color:var(--text);font-weight:400}',
    '.swp-sum i{color:#5DCAA5;font-style:normal}',
    '.swp-mask{position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9996;display:none;align-items:center;justify-content:center}',
    '.swp-panel{width:880px;max-width:94vw;max-height:88vh;overflow:auto;background:#12181f;border:1px solid var(--border);border-radius:10px;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,0.6)}',
    '.swp-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}',
    '.swp-hd-tt{font-size:14px;color:var(--text);font-weight:500}',
    '.swp-hd-sub{font-size:11px;color:var(--muted)}',
    '.swp-x{margin-left:auto;background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;padding:0 4px}',
    '.swp-x:hover{color:var(--red)}'
  ].join('\n');

  function $(id) { return document.getElementById(id); }

  function injectCss() {
    if (document.getElementById('swp-css')) return;
    var st = document.createElement('style');
    st.id = 'swp-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function mountEntry(host, onConfig) {
    injectCss();
    host.innerHTML =
      '<div class="swp-entry">' +
        '<span class="swp-tt">🔊 天气声音</span>' +
        '<span class="swp-sum" id="swp-sum">读取中…</span>' +
        '<button class="btn btn-secondary btn-sm" id="swp-open">配置…</button>' +
      '</div>' +
      '<div class="swp-entry" style="margin-top:6px">' +
        '<span class="swp-tt">🎵 场景背景音</span>' +
        '<span class="swp-sum" id="smp-sum">读取中…</span>' +
        '<button class="btn btn-secondary btn-sm" id="smp-open">配置…</button>' +
      '</div>';
    $('swp-open').addEventListener('click', function () { if (onConfig) onConfig('weather'); });
    $('smp-open').addEventListener('click', function () { if (onConfig) onConfig('music'); });
  }

  function setSummary(html) {
    var el = $('swp-sum');
    if (el) el.innerHTML = html;
  }

  function setMusicSummary(html) {
    var el = $('smp-sum');
    if (el) el.innerHTML = html;
  }

  /** 建好某个弹窗（已存在就复用，避免每次打开重建状态） */
  function ensureModal(kind) {
    var cfg = MODALS[kind];
    if (!cfg) return null;
    var m = $(cfg.maskId);
    if (m) return m;
    injectCss();
    m = document.createElement('div');
    m.id = cfg.maskId;
    m.className = 'swp-mask';
    m.innerHTML =
      '<div class="swp-panel">' +
        '<div class="swp-hd">' +
          '<span class="swp-hd-tt">' + cfg.title + '</span>' +
          '<span class="swp-hd-sub">' + cfg.sub + '</span>' +
          '<button class="swp-x" id="' + cfg.xId + '">✕</button>' +
        '</div>' +
        cfg.body +
      '</div>';
    document.body.appendChild(m);
    $(cfg.xId).addEventListener('click', function () { closeModal(kind); });
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(kind); });
    return m;
  }

  function openModal(kind) {
    // 开一个就把另一个收起来：两个遮罩叠着会点不准底下那个
    Object.keys(MODALS).forEach(function (k) { if (k !== kind) closeModal(k); });
    var m = ensureModal(kind);
    if (m) m.style.display = 'flex';
  }

  function closeModal(kind) {
    var cfg = MODALS[kind];
    if (!cfg) return;
    var m = $(cfg.maskId);
    if (m) m.style.display = 'none';
  }

  function isOpen(kind) {
    var cfg = MODALS[kind];
    if (!cfg) return false;
    var m = $(cfg.maskId);
    return !!m && m.style.display === 'flex';
  }

  window.SoundWeatherPanel = {
    mountEntry: mountEntry,
    setSummary: setSummary,
    setMusicSummary: setMusicSummary,
    ensureModal: ensureModal,
    openModal: openModal,
    closeModal: closeModal,
    isOpen: isOpen
  };
})();
