/**
 * adminRuntimePanel —— World AI 运行状态面板（AI World Brain · Phase 7 · 自注入）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 自注入浮动按钮「⏱ 运行状态」+ 弹窗（admin.html 只加 1 行 script，§K 文件边界）。
 * 数据源只有一个：GET /api/world-ai/runtime（Phase 7 起含 scheduler 四类 tick 快照）。
 * 操作按钮直接复用既有状态机端点（start/pause/resume/stop/restart/tick）——面板不改状态机语义，
 * 中断 = pause（走完当前轮就停，§I.2）。
 * 凭证：**GET 也必须自带 Authorization** —— adminAuthFetch 只给非读请求注入，
 *   而 GET /api/world-ai/runtime 是管理员门禁（照 adminWorldBrain.jreq 的同款口径）。
 * 诊断口：window.__worldAiRuntimePanel._diag()（验收脚本断言用）。
 */
(function () {
  'use strict';
  if (window.__worldAiRuntimePanel && window.__worldAiRuntimePanel.installed) return;

  var POLL_MS = 2500;
  var timer = null;
  var lastData = null;
  var KIND_LABEL = { observe: '观察', plan: '规划', optimize: '优化', idle: '空闲维护' };

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k]) n.setAttribute(k, attrs[k]); });
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function adminToken() {
    try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; }
  }

  function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
    const t = adminToken();
    if (t) headers['Authorization'] = 'Bearer ' + t;   // GET/POST 都带（管理员门禁端点）
    return fetch(path, Object.assign({ headers: headers }, o, { headers: headers }))
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); });
  }

  function fmtTime(s) {
    if (!s) return '—';
    var d = new Date(s);
    return isNaN(d.getTime()) ? String(s).slice(0, 19) : d.toLocaleString();
  }

  function fmtInterval(ms) {
    var m = Math.round((Number(ms) || 0) / 60000);
    if (m < 60) return m + ' 分钟';
    if (m < 60 * 24) return (m / 60).toFixed(1) + ' 小时';
    return (m / 1440).toFixed(1) + ' 天';
  }

  function brief(r) {
    if (!r) return '—';
    var s = r.action || r.code || 'ok';
    if (r.reason) s += '：' + String(r.reason).slice(0, 60);
    if (r.evaluated) s += '｜A/B 判定 ' + r.evaluated.evaluated + ' 条';
    if (r.rule_hits) s += '｜命中 ' + r.rule_hits.length + ' 信号';
    return String(s).slice(0, 120);
  }

  function render(box, data) {
    lastData = data;
    box.innerHTML = '';
    if (!data) { box.appendChild(el('div', { class: 'arp-note' }, '读取运行状态失败（需管理员 token）')); return; }
    var head = el('div', { class: 'arp-head' });
    var st = data.runtimeState || 'unknown';
    head.appendChild(el('span', { class: 'arp-dot ' + (data.enabled ? (st === 'running' ? 'ok' : 'warn') : 'off') }));
    head.appendChild(el('b', null, 'runtime_state = ' + st + '｜总闸 ' + (data.enabled ? '开' : '关')));
    head.appendChild(el('span', { class: 'arp-muted' }, '心跳 ' + fmtTime(data.lastHeartbeatAt)));
    box.appendChild(head);
    if (data.lastError) box.appendChild(el('div', { class: 'arp-err' }, 'last_error：' + String(data.lastError).slice(0, 160)));

    var sch = data.scheduler || { kinds: {} };
    var table = el('div', { class: 'arp-kinds' });
    Object.keys(sch.kinds || {}).forEach(function (kind) {
      var k = sch.kinds[kind];
      var row = el('div', { class: 'arp-kind' });
      row.appendChild(el('span', { class: 'arp-kname' }, (KIND_LABEL[kind] || kind) + '（' + kind + '）'));
      row.appendChild(el('span', { class: k.enabled ? 'arp-kon' : 'arp-koff' }, k.enabled ? '开 ' + fmtInterval(k.intervalMs) : '关'));
      row.appendChild(el('span', { class: 'arp-muted' }, '上次 ' + fmtTime(k.lastRunAt) + '｜' + brief(k.lastResult)));
      table.appendChild(row);
    });
    box.appendChild(table);

    var acts = el('div', { class: 'arp-actions' });
    [['start', '启动'], ['pause', '中断(暂停)'], ['resume', '恢复'], ['tick', '手动跑一轮'], ['stop', '停止'], ['restart', '重启']].forEach(function (pair) {
      var b = el('button', { class: 'arp-btn', type: 'button' }, pair[1]);
      b.addEventListener('click', function () {
        b.disabled = true;
        api('/api/world-ai/runtime/' + pair[0], { method: 'POST', body: '{}' })
          .then(function (res) {
            // ★ 失败必须可见：此前 400 响应体被静默丢弃，用户点 N 次只看到控制台红字（队列14 实测反馈）
            if (res && (res.status >= 400 || (res.j && res.j.success === false))) {
              var reason = res.j && (res.j.reason || res.j.error || res.j.code);
              box.appendChild(el('div', { class: 'arp-err' }, '「' + pair[1] + '」失败：' + (reason || ('HTTP ' + res.status))));
            }
            return refresh(box);
          })
          .catch(function (e) { box.appendChild(el('div', { class: 'arp-err' }, '「' + pair[1] + '」请求失败：' + (e && e.message || e))); })
          .then(function () { b.disabled = false; });
      });
      acts.appendChild(b);
    });
    box.appendChild(acts);
  }

  function refresh(box) {
    return api('/api/world-ai/runtime').then(function (r) {
      render(box, r && r.status === 200 ? r.j.runtime : null);
      return lastData;
    }).catch(function () { render(box, null); });
  }

  function startPolling(b) { stopPolling(); timer = setInterval(function () { refresh(b); }, POLL_MS); }
  function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }
function inject() {
    if (document.getElementById('arp-root')) return;
    var style = document.createElement('style');
    style.id = 'arp-style';
    style.textContent = [
      '#arp-root{position:fixed;right:18px;bottom:18px;z-index:9998;font-size:13px}',
      '#arp-root .arp-launch{background:#1f6feb;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer}',
      '#arp-root .arp-panel{position:fixed;right:18px;bottom:64px;width:520px;max-height:70vh;overflow:auto;background:#fff;color:#222;border:1px solid #d0d7de;border-radius:10px;padding:12px}',
      '#arp-root .arp-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '#arp-root .arp-dot{width:10px;height:10px;border-radius:50%;display:inline-block;background:#999}',
      '#arp-root .arp-dot.ok{background:#2ea043}',
      '#arp-root .arp-dot.warn{background:#d29922}',
      '#arp-root .arp-dot.off{background:#cf222e}',
      '#arp-root .arp-muted{color:#57606a;font-size:12px}',
      '#arp-root .arp-err{color:#cf222e;font-size:12px;margin:4px 0}',
      '#arp-root .arp-note{color:#57606a;padding:8px 0}',
      '#arp-root .arp-kind{display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px dashed #eee}',
      '#arp-root .arp-kname{width:120px;font-weight:600}',
      '#arp-root .arp-kon{color:#1a7f37;width:104px}',
      '#arp-root .arp-koff{color:#6e7781;width:104px}',
      '#arp-root .arp-actions{margin-top:10px;display:flex;gap:6px;flex-wrap:wrap}',
      '#arp-root .arp-btn{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:5px 10px;cursor:pointer}',
      '#arp-root .arp-btn:disabled{opacity:.5}',
    ].join('');
    document.head.appendChild(style);

    var root = el('div', { id: 'arp-root' });
    var launch = el('button', { class: 'arp-launch', type: 'button' }, '运行状态');
    var panel = el('div', { class: 'arp-panel' });
    panel.style.display = 'none';
    var box = el('div');
    panel.appendChild(box);
    var close = el('button', { class: 'arp-btn', type: 'button' }, '关闭');
    close.style.marginTop = '8px';
    close.addEventListener('click', function () { stopPolling(); panel.style.display = 'none'; });
    panel.appendChild(close);
    launch.addEventListener('click', function () {
      if (panel.style.display === 'none') { panel.style.display = 'block'; refresh(box); startPolling(box); }
      else { stopPolling(); panel.style.display = 'none'; }
    });
    root.appendChild(launch);
    root.appendChild(panel);
    document.body.appendChild(root);

    window.__worldAiRuntimePanel = {
      installed: true,
      open: function () { launch.click(); },
      close: function () { stopPolling(); panel.style.display = 'none'; },
      refresh: function () { return refresh(box); },
      _diag: function () {
        return { installed: true, polling: !!timer, panelVisible: panel.style.display !== 'none', lastData: lastData };
      },
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();