/**
 * 济宁米多信息科技有限公司 版权所有
 * Three.js 问题库 · 后台可视化维护面板（2026-09-24）
 *
 * 设计：完全自注入（浮动按钮 + 弹窗），不侵入 admin.html 的既有结构——
 * admin.html 只需多引一行 script 即可。
 *
 * 能做什么（不懂代码也能改）：
 *   1. 清单增删：内置加载器白名单 / 已删除 API 清单 / 灯光类名 / 允许的外链域名
 *   2. 阈值调整：大几何阈值、世界自动缩小尺寸、定时器数量阈值
 *   3. 规则启停：临时停用某条规则（如误报时）
 *   4. 总览：全部条目（编号/标题/作用域/动作/首次发现/案例）
 *
 * 保存后写入 system_config('threejs_issue_config')，前端世界/预览与离线体检 CLI 立即生效。
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  function R() { return window.ThreeJSIssueRegistry; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function arrToText(a) { return (a || []).join('\n'); }
  function textToArr(t) {
    return String(t || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  const ID = 'issue-registry-panel';
  let modalEl = null;

  function currentDraft() {
    const cfg = R() ? R().getConfig() : {};
    return JSON.parse(JSON.stringify(cfg));
  }

  function readForm() {
    const draft = {
      loaders: textToArr(document.getElementById('ir-loaders').value),
      deadApi: textToArr(document.getElementById('ir-deadApi').value),
      lights: textToArr(document.getElementById('ir-lights').value),
      externalHostsAllow: textToArr(document.getElementById('ir-hosts').value),
      thresholds: {
        bigGeometry: Number(document.getElementById('ir-th-big').value) || undefined,
        bigDimension: Number(document.getElementById('ir-th-dim').value) || undefined,
        minObjectDim: Number(document.getElementById('ir-th-min').value) || undefined,
        timers: Number(document.getElementById('ir-th-timer').value) || undefined
      },
      rulesDisabled: Array.prototype.slice.call(document.querySelectorAll('.ir-rule-off:checked')).map(function (c) { return c.value; }),
      notes: document.getElementById('ir-notes').value
    };
    Object.keys(draft.thresholds).forEach(function (k) { if (draft.thresholds[k] === undefined) delete draft.thresholds[k]; });
    return draft;
  }

  function fillForm(cfg) {
    document.getElementById('ir-loaders').value = arrToText(cfg.loaders);
    document.getElementById('ir-deadApi').value = arrToText(cfg.deadApi);
    document.getElementById('ir-lights').value = arrToText(cfg.lights);
    document.getElementById('ir-hosts').value = arrToText(cfg.externalHostsAllow);
    document.getElementById('ir-th-big').value = cfg.thresholds.bigGeometry;
    document.getElementById('ir-th-dim').value = cfg.thresholds.bigDimension;
    document.getElementById('ir-th-min').value = cfg.thresholds.minObjectDim;
    document.getElementById('ir-th-timer').value = cfg.thresholds.timers;
    document.getElementById('ir-notes').value = cfg.notes || '';
    document.querySelectorAll('.ir-rule-off').forEach(function (c) {
      c.checked = (cfg.rulesDisabled || []).indexOf(c.value) >= 0;
    });
  }

  function entriesTableHtml() {
    if (!R()) return '';
    const rows = R().list().map(function (e) {
      return '<tr>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #2a3050;">' + esc(e.id) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #2a3050;">' + esc(e.title) +
        (e.samples && e.samples.length ? '<div style="color:#7e8bb6;font-size:11px;">案例: ' + esc(e.samples.join('、')) + '</div>' : '') + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #2a3050;">' + esc(e.scope) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #2a3050;">' + esc(e.action) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid #2a3050;">' + esc(e.firstSeen || '') + '</td>' +
        '</tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
      '<thead><tr style="color:#9fb0e0;text-align:left;">' +
      '<th style="padding:4px 8px;">编号</th><th style="padding:4px 8px;">问题</th>' +
      '<th style="padding:4px 8px;">作用域</th><th style="padding:4px 8px;">动作</th>' +
      '<th style="padding:4px 8px;">首次发现</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function rulesToggleHtml() {
    if (!R()) return '';
    return R().list().map(function (e) {
      const off = R().isDisabled(e.id);
      return '<label style="display:inline-block;width:46%;margin:3px 0;font-size:12px;color:' + (off ? '#ff9966' : '#c8d3f5') + ';">' +
        '<input type="checkbox" class="ir-rule-off" value="' + esc(e.id) + '"' + (off ? ' checked' : '') + '> ' +
        esc(e.id) + ' ' + esc(e.title) + '</label>';
    }).join('');
  }

  function statsHtml() {
    if (!R()) return '';
    const rep = R().report();
    const st = R().stats();
    const hits = Object.keys(rep.sessionHits).sort().map(function (k) { return k + '×' + rep.sessionHits[k]; }).join('、') || '无';
    const meta = R().getConfigMeta();
    return '<div style="font-size:12px;color:#9fb0e0;line-height:1.8;">' +
      '知识库版本 ' + esc(R().version) + '｜条目 ' + st.total + ' 条' +
      '（code ' + (st.byScope.code || 0) + ' / scene ' + (st.byScope.scene || 0) + '）<br>' +
      '配置来源: ' + esc(meta.source) + (meta.updatedAt ? '｜更新于 ' + esc(String(meta.updatedAt).replace('T', ' ').slice(0, 19)) : '') + '<br>' +
      '本会话命中: ' + esc(hits) + '</div>';
  }

  // 面板样式（深色主题，与后台一致；只作用于面板内部）
  function ensureStyle() {
    if (document.getElementById('issue-registry-style')) return;
    const st = document.createElement('style');
    st.id = 'issue-registry-style';
    st.textContent =
      '#issue-registry-panel textarea,#issue-registry-panel input{background:#0d1220;color:#e6ecff;' +
      'border:1px solid #2a3050;border-radius:6px;padding:6px 8px;font-size:12px;font-family:inherit;box-sizing:border-box;}' +
      '#issue-registry-panel textarea{resize:vertical;line-height:1.5;}' +
      '#issue-registry-panel textarea:focus,#issue-registry-panel input:focus{outline:1px solid #3b6cff;border-color:#3b6cff;}' +
      '#issue-registry-panel button{background:#1f2a4a;color:#dbe4ff;border:1px solid #3b4a7a;border-radius:6px;' +
      'padding:6px 14px;font-size:12px;cursor:pointer;}' +
      '#issue-registry-panel button:hover{background:#26345c;}' +
      '#issue-registry-panel label{cursor:pointer;}' +
      '#issue-registry-panel input[type="checkbox"]{width:auto;vertical-align:-2px;margin-right:4px;}' +
      '#issue-registry-panel table{border-collapse:collapse;}' +
      '#issue-registry-panel ::-webkit-scrollbar{width:10px;height:10px;}' +
      '#issue-registry-panel ::-webkit-scrollbar-thumb{background:#2a3050;border-radius:5px;}';
    document.head.appendChild(st);
  }

  function buildModal() {
    ensureStyle();
    const el = document.createElement('div');
    el.id = ID;
    el.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,20,.72);z-index:99999;display:none;align-items:center;justify-content:center;';
    el.innerHTML =
      '<div style="width:min(980px,94vw);max-height:90vh;overflow:auto;background:#141a2e;border:1px solid #2a3050;border-radius:10px;padding:18px 20px;color:#e6ecff;font-family:system-ui,Segoe UI,sans-serif;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<div style="font-size:17px;font-weight:600;">🧠 Three.js 问题库</div>' +
      '<div><button id="ir-close" style="margin-right:8px;">关闭</button></div></div>' +
      '<div id="ir-stats" style="margin-bottom:12px;">' + statsHtml() + '</div>' +
      '<div style="background:#101527;border:1px solid #2a3050;border-radius:8px;padding:12px;margin-bottom:12px;">' +
      '<div style="font-size:13px;color:#9fb0e0;margin-bottom:6px;">词条清单（一行一条，保存后立即对预览与世界生效；无需改代码）</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
      '<div><div style="font-size:12px;color:#7e8bb6;">内置加载器白名单（不在名单内的 Loader 会告警）</div><textarea id="ir-loaders" rows="6" style="width:100%;"></textarea></div>' +
      '<div><div style="font-size:12px;color:#7e8bb6;">已删除 API 清单（命中即报致命）</div><textarea id="ir-deadApi" rows="6" style="width:100%;"></textarea></div>' +
      '<div><div style="font-size:12px;color:#7e8bb6;">灯光类名（代码自建灯光会被世界移除）</div><textarea id="ir-lights" rows="4" style="width:100%;"></textarea></div>' +
      '<div><div style="font-size:12px;color:#7e8bb6;">允许的外链域名（放行后不再告警）</div><textarea id="ir-hosts" rows="4" style="width:100%;"></textarea></div>' +
      '</div>' +
      '<div style="margin-top:10px;display:flex;gap:16px;font-size:12px;color:#c8d3f5;align-items:center;">' +
      '大几何阈值 <input id="ir-th-big" type="number" style="width:90px;"> &nbsp;' +
      '世界自动缩小尺寸(m) <input id="ir-th-dim" type="number" style="width:80px;"> &nbsp;' +
      '最小可见尺寸(m) <input id="ir-th-min" type="number" step="0.1" style="width:80px;"> &nbsp;' +
      '定时器阈值 <input id="ir-th-timer" type="number" style="width:70px;">' +
      '</div>' +
      '<div style="margin-top:8px;"><div style="font-size:12px;color:#7e8bb6;">备注</div>' +
      '<input id="ir-notes" style="width:100%;" placeholder="例：2026-09-24 新增 VOXLoader 放行"></div>' +
      '</div>' +
      '<div style="background:#101527;border:1px solid #2a3050;border-radius:8px;padding:12px;margin-bottom:12px;">' +
      '<div style="font-size:13px;color:#9fb0e0;margin-bottom:6px;">规则启停（勾选=停用该规则，用于误报时临时关闭）</div>' +
      '<div>' + rulesToggleHtml() + '</div></div>' +
      '<div style="background:#101527;border:1px solid #2a3050;border-radius:8px;padding:12px;margin-bottom:12px;">' +
      '<div style="font-size:13px;color:#9fb0e0;margin-bottom:6px;">条目总览（新增机制型规则的请交给开发同学追加）</div>' +
      entriesTableHtml() + '</div>' +
      '<div style="display:flex;gap:10px;align-items:center;">' +
      '<button id="ir-save" style="background:#3b6cff;color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;">保存词条</button>' +
      '<button id="ir-reload">重新拉取</button>' +
      '<button id="ir-reset">重置为默认（不保存）</button>' +
      '<span id="ir-msg" style="font-size:12px;"></span>' +
      '</div>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector('#ir-close').addEventListener('click', function () { el.style.display = 'none'; });
    el.addEventListener('click', function (e) { if (e.target === el) el.style.display = 'none'; });
    el.querySelector('#ir-reload').addEventListener('click', function () {
      if (!R()) return;
      R().loadConfig({ bust: true }).then(function () { fillForm(currentDraft()); el.querySelector('#ir-stats').innerHTML = statsHtml(); msg('已重新拉取'); });
    });
    el.querySelector('#ir-reset').addEventListener('click', function () {
      if (!R()) return;
      fillForm(JSON.parse(JSON.stringify(R().DEFAULT_CONFIG)));
      msg('已填入默认值（需点保存才生效）', '#ffd966');
    });
    el.querySelector('#ir-save').addEventListener('click', function () {
      const token = localStorage.getItem('adminToken') || '';
      if (!token) { msg('未检测到管理员登录态，请重新登录后台', '#ff6666'); return; }
      msg('保存中…');
      fetch('/api/threejs-issues/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ config: readForm() })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.success) {
          R().applyConfig(d.config);
          R().loadConfig({ bust: true });
          el.querySelector('#ir-stats').innerHTML = statsHtml();
          msg('已保存并生效' + (d.dropped && d.dropped.length ? '（忽略未知键: ' + d.dropped.join(',') + '）' : ''), '#66ff66');
        } else {
          msg('保存失败: ' + ((d && d.error) || '未知错误'), '#ff6666');
        }
      }).catch(function (e) { msg('保存失败: ' + e.message, '#ff6666'); });
    });

    function msg(text, color) {
      const m = el.querySelector('#ir-msg');
      m.style.color = color || '#9fb0e0';
      m.textContent = text;
    }
    return el;
  }

  function openPanel() {
    if (!window.ThreeJSIssueRegistry) { alert('问题库脚本未加载（threejsIssueRegistry.js）'); return; }
    if (!modalEl) modalEl = buildModal();
    fillForm(currentDraft());
    modalEl.querySelector('#ir-stats').innerHTML = statsHtml();
    modalEl.querySelector('#ir-msg').textContent = '';
    modalEl.style.display = 'flex';
    // 打开时刷新一次服务端配置
    R().loadConfig({ bust: true }).then(function () { fillForm(currentDraft()); modalEl.querySelector('#ir-stats').innerHTML = statsHtml(); });
  }

  // 入口按钮放在「Three.js 代码库」页的 ➕新增代码块 旁边（结构变化时兜底为右下角浮动）
  function injectButton() {
    if (document.getElementById('issue-registry-btn')) return;
    const b = document.createElement('button');
    b.id = 'issue-registry-btn';
    b.type = 'button';
    b.textContent = '🧠 问题库';
    b.title = 'Three.js 问题库：查看条目、维护词条清单与规则启停';
    b.setAttribute('data-issue-registry', '1');
    b.addEventListener('click', openPanel);

    let anchor = document.querySelector('#page-threejs-blocks button[onclick*="openThreejsBlockEditor"]');
    if (!anchor) anchor = document.querySelector('button[data-i18n="adminThreejs.newBlock"]');

    if (anchor && anchor.parentNode) {
      // 与 ➕新增代码块 同款样式，并包进同一按钮组——
      // 父容器是 space-between 布局，直接插同级会被推到很远，必须成组
      b.className = anchor.className || 'btn btn-sm';
      b.style.cssText = 'background:#243055;color:#dbe4ff;border:1px solid #3b4a7a;font-weight:700;';
      const group = document.createElement('div');
      group.id = 'threejs-block-actions';
      group.style.cssText = 'display:flex;align-items:center;gap:8px;';
      anchor.parentNode.insertBefore(group, anchor);
      group.appendChild(anchor);
      group.appendChild(b);
      return;
    }

    // 兜底：页面结构变化时仍可打开
    b.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9998;background:#1f2a4a;color:#dbe4ff;border:1px solid #3b4a7a;' +
      'border-radius:20px;padding:8px 16px;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35);';
    document.body.appendChild(b);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }

  window.AdminIssueRegistry = { open: openPanel, refresh: function () { if (R()) R().loadConfig({ bust: true }); } };
})();
