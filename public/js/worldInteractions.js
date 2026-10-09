/**
 * worldInteractions —— 真人交互前端（AI World Brain · Phase 6 · 用户拍板②）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 能力（world.js 零改动，独立旁路模块）：
 *   ① 走近交互点（world_interactions）显示「按 E 互动」提示，E 键触发 POST /api/gameplay/interact
 *      —— 服务端判定口径与 Agent 完全一致（同一 findNearby + reachable）；
 *   ② 任务面板（T 键 / 右上按钮）：领取公开任务、查看我的任务进度、兑换码入背包（方案 A 闭环）；
 *   ③ 活动面板：可加入的活动（announced/running）一键加入；
 *   ④ 真人 reach_region / reach_position：移动时节流 POST /api/gameplay/tasks/evaluate，
 *      服务端从 websocket 实时位置判定（事件驱动，零 LLM）。
 * 诊断口：window.WorldInteractions._diag()
 */
(function () {
  'use strict';

  const VERSION = 'p6-1';
  const POLL_MS = 1500;
  const EVAL_MIN_GAP_MS = 4000;
  const PROMPT_RADIUS = 30;

  const state = {
    started: false, lastPollAt: 0, lastEvalAt: 0,
    nearby: [], nearest: null, tasks: [], mine: [], activities: [],
    panelOpen: false, lastResult: null, errors: 0,
  };

  // ── DOM（全注入，不改 index.html 结构）────────────────────────────────
  let promptEl = null, panelEl = null, toastEl = null;

  function ensureDom() {
    if (document.getElementById('wi-prompt')) return;
    const style = document.createElement('style');
    style.textContent = [
      '#wi-prompt{position:fixed;left:50%;bottom:18%;transform:translateX(-50%);z-index:880;',
      'background:rgba(10,18,30,.82);color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;',
      'border:1px solid rgba(120,180,255,.45);display:none;pointer-events:none;backdrop-filter:blur(4px)}',
      '#wi-prompt b{color:#7fd0ff;margin-right:8px}',
      '#wi-panel{position:fixed;top:70px;right:14px;width:340px;max-height:72vh;overflow:auto;z-index:880;',
      'background:rgba(8,14,24,.92);color:#e8eef8;border-radius:12px;border:1px solid rgba(120,180,255,.35);',
      'padding:14px;font-size:13px;display:none;box-shadow:0 8px 30px rgba(0,0,0,.45)}',
      '#wi-panel h3{margin:6px 0 8px;font-size:14px;color:#9fd4ff}',
      '#wi-panel .wi-item{border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px;margin-bottom:8px}',
      '#wi-panel button{background:#2b6cb0;border:none;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;margin-right:6px}',
      '#wi-panel button.sec{background:#374151}',
      '#wi-panel input{width:100%;box-sizing:border-box;border-radius:6px;border:1px solid #456;background:#0b1420;color:#fff;padding:5px;margin:4px 0}',
      '#wi-toast{position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:885;background:rgba(20,40,30,.95);',
      'color:#d8ffe8;padding:10px 16px;border-radius:10px;border:1px solid rgba(120,255,180,.4);display:none;max-width:70vw;font-size:13px}',
      '#wi-fab{position:fixed;top:70px;right:14px;z-index:880;background:rgba(10,20,35,.85);color:#cfe8ff;',
      'border:1px solid rgba(120,180,255,.4);border-radius:20px;padding:6px 12px;cursor:pointer;font-size:12px}',
    ].join('');
    document.head.appendChild(style);

    promptEl = document.createElement('div');
    promptEl.id = 'wi-prompt';
    document.body.appendChild(promptEl);

    toastEl = document.createElement('div');
    toastEl.id = 'wi-toast';
    document.body.appendChild(toastEl);

    const fab = document.createElement('button');
    fab.id = 'wi-fab';
    fab.textContent = '🎮 玩法 (T)';
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);

    panelEl = document.createElement('div');
    panelEl.id = 'wi-panel';
    document.body.appendChild(panelEl);
  }

  // ── 工具 ─────────────────────────────────────────────────────────────
  function token() { return localStorage.getItem('token') || ''; }
  function loggedIn() { return !!token(); }
  function myPos() {
    try {
      const p = window.player && window.player.position;
      return p ? { x: p.x, y: p.y, z: p.z } : null;
    } catch (e) { return null; }
  }

  async function api(path, method, body) {
    const opt = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
    if (token()) opt.headers['Authorization'] = 'Bearer ' + token();
    if (body) opt.body = JSON.stringify(body);
    const r = await fetch(path, opt);
    let j = {};
    try { j = await r.json(); } catch (e) { /* 空 body */ }
    return { status: r.status, ok: r.ok, data: j };
  }

  function toast(html, ms) {
    if (!toastEl) return;
    toastEl.innerHTML = html;
    toastEl.style.display = 'block';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.style.display = 'none'; }, ms || 4200);
  }

  // ── 轮询：附近交互点 / 公开任务 / 我的活动 ────────────────────────────
  async function poll() {
    if (!loggedIn() && !state.nearby.length && state.lastPollAt) return; // 游客也轮询（可看）
    const pos = myPos();
    if (!pos) return;
    state.lastPollAt = Date.now();
    try {
      const r = await api('/api/gameplay/nearby?x=' + pos.x + '&z=' + pos.z);
      if (r.ok) {
        state.nearby = (r.data.interactions || []).filter((i) => i.distance <= Math.min(i.radius, PROMPT_RADIUS));
        state.tasks = r.data.tasks || [];
        state.activities = r.data.activities || [];
      }
      if (loggedIn()) {
        const m = await api('/api/gameplay/tasks/mine');
        if (m.ok) state.mine = m.data.tasks || [];
      }
    } catch (e) { state.errors++; }
    renderPrompt();
    if (state.panelOpen) renderPanel();
  }

  function renderPrompt() {
    if (!promptEl) return;
    if (!state.nearby.length) { promptEl.style.display = 'none'; state.nearest = null; return; }
    const t = state.nearby.slice().sort((a, b) => a.distance - b.distance)[0];
    state.nearest = t;
    promptEl.innerHTML = '<b>E</b>' + esc(t.label || t.key || '互动') +
      ' <span style="opacity:.6">(' + t.distance + 'm)</span>';
    promptEl.style.display = 'block';
  }

  // ── E 键交互 ─────────────────────────────────────────────────────────
  async function doInteract() {
    const t = state.nearest;
    if (!t) return;
    const pos = myPos() || { x: 0, z: 0 };
    if (!loggedIn()) { toast('⚠️ 请先登录后再互动（右上角登录）'); return; }
    const r = await api('/api/gameplay/interact', 'POST',
      { interactionKey: t.key, x: pos.x, z: pos.z, regionKey: t.regionKey || undefined });
    state.lastResult = { at: Date.now(), kind: 'interact', data: r.data };
    if (!r.ok) { toast('❌ ' + esc((r.data && (r.data.reason || r.data.error)) || '交互失败')); return; }
    let html = '✅ 与「' + esc(t.label || t.key) + '」互动成功';
    if (r.data.reward) {
      if (r.data.reward.deduped) html += '<br>🎁 该奖励已领取过（幂等，不重复发）';
      else if (r.data.reward.code) html += '<br>🎁 获得兑换码：<b style="color:#ffd97f">' + esc(r.data.reward.code) + '</b>（可在玩法面板兑换进背包，或送给朋友）';
      else html += '<br>🎁 已登记奖励';
    }
    const pr = r.data.quest && r.data.quest.progressed && r.data.quest.progressed.find((x) => x.done);
    if (pr) html += '<br>📜 任务「' + esc(pr.title) + '」已完成！';
    toast(html, 6000);
    poll();
  }

  // ── 面板 ─────────────────────────────────────────────────────────────
  function togglePanel() {
    state.panelOpen = !state.panelOpen;
    panelEl.style.display = state.panelOpen ? 'block' : 'none';
    if (state.panelOpen) { poll(); renderPanel(); }
  }

  function renderPanel() {
    const mine = state.mine.map((t) => {
      const objs = Array.isArray(t.objectives) ? t.objectives : [];
      const idx = Number(t.objective_index) || 0;
      const step = objs[idx] ? ('目标 ' + (idx + 1) + '/' + objs.length + '：' + objText(objs[idx])) : '已完成';
      return '<div class="wi-item"><b>' + esc(t.title) + '</b><br><span style="opacity:.75">' + step +
        (t.reward_granted ? ' · 🎁 已发奖' : '') + '</span></div>';
    }).join('') || '<div style="opacity:.6">还没有进行中的任务</div>';

    const pub = state.tasks.map((t) =>
      '<div class="wi-item"><b>' + esc(t.title) + '</b>' +
      '<div style="opacity:.7;margin:2px 0">' + esc(t.description || '') + '</div>' +
      '<button onclick="window.WorldInteractions.claim(\'' + t.id + '\')">领取</button></div>'
    ).join('') || '<div style="opacity:.6">暂无公开任务</div>';

    const acts = state.activities.map((a) =>
      '<div class="wi-item"><b>' + esc(a.title) + '</b> <span style="opacity:.6">(' + esc(a.status) + ')</span>' +
      '<div style="opacity:.7">' + esc(a.description || '') + '</div>' +
      '<button onclick="window.WorldInteractions.joinAct(\'' + a.id + '\')">参加</button></div>'
    ).join('') || '<div style="opacity:.6">暂无进行中的活动</div>';

    panelEl.innerHTML =
      '<h3>📜 我的任务</h3>' + mine +
      '<h3>🎯 可领取</h3>' + pub +
      '<h3>🎪 活动</h3>' + acts +
      '<h3>🎟️ 兑换码</h3>' +
      '<input id="wi-code" placeholder="粘贴兑换码（AI 赠送/活动奖励）">' +
      '<button onclick="window.WorldInteractions.redeem()">兑入背包</button>' +
      '<button class="sec" onclick="window.WorldInteractions.close()">关闭 (T)</button>';
  }

  function objText(o) {
    if (!o) return '';
    if (o.type === 'reach_region') return '到达区域 ' + o.regionKey;
    if (o.type === 'reach_position') return '到达坐标 (' + o.x + ',' + o.z + ')';
    if (o.type === 'talk_to') return '与目标对话';
    if (o.type === 'object_interact') return '交互 ' + (o.count || 1) + ' 次';
    if (o.type === 'object_exists') return '世界中有 ' + (o.min || 1) + ' 个「' + o.tag + '」';
    if (o.type === 'chat_contains') return '聊天中提到「' + (o.keywords || []).join('/') + '」';
    return o.type;
  }

  // ── 对外动作 ─────────────────────────────────────────────────────────
  async function claim(taskId) {
    const r = await api('/api/gameplay/tasks/' + taskId + '/claim', 'POST', {});
    toast(r.ok ? '✅ 已领取任务' : ('❌ ' + esc(r.data.reason || r.data.error || '领取失败')));
    poll(); renderPanel();
  }
  async function joinAct(id) {
    const r = await api('/api/gameplay/activities/' + id + '/join', 'POST', {});
    toast(r.ok ? '✅ 已加入活动' : ('❌ ' + esc(r.data.reason || r.data.error || '加入失败')));
    poll();
  }
  async function redeem() {
    const el = document.getElementById('wi-code');
    const code = el ? el.value.trim() : '';
    if (!code) { toast('⚠️ 请先粘贴兑换码'); return; }
    const r = await api('/api/inventory/redeem', 'POST', { code });
    state.lastResult = { at: Date.now(), kind: 'redeem', data: r.data };
    if (!r.ok) { toast('❌ ' + esc(r.data.error || '兑换失败')); return; }
    toast('🎉 ' + esc(r.data.message || '兑换成功') + (r.data.item ? '<br>🎁 ' + esc(r.data.item.rewardName || '') : ''), 5200);
    const el2 = document.getElementById('wi-code');
    if (el2) el2.value = '';
  }

  // ── 键盘 ─────────────────────────────────────────────────────────────
  function isTyping(e) {
    const t = e.target && e.target.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || (e.target && e.target.isContentEditable);
  }
  function onKeyDown(e) {
    if (isTyping(e)) return;
    if (e.key === 'e' || e.key === 'E') { if (state.nearest) doInteract(); }
    else if (e.key === 't' || e.key === 'T') { if (!e.ctrlKey && !e.metaKey) togglePanel(); }
  }

  // ── 主循环 ───────────────────────────────────────────────────────────
  function loop() {
    const now = Date.now();
    const pos = myPos();
    if (pos && now - state.lastPollAt >= POLL_MS) poll();
    // 真人位置评估（reach_region/reach_position）：移动时间节流
    if (pos && loggedIn() && now - state.lastEvalAt >= EVAL_MIN_GAP_MS) {
      state.lastEvalAt = now;
      api('/api/gameplay/tasks/evaluate', 'POST', {}).catch(() => {});
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function start() {
    if (state.started) return;
    ensureDom();
    document.addEventListener('keydown', onKeyDown);
    setInterval(loop, 800);
    state.started = true;
    try { console.log('[worldInteractions] 已启动 ' + VERSION); } catch (e) { /* ignore */ }
  }

  function waitWorld() {
    if (window.player && window.gameWorld) { start(); return; }
    setTimeout(waitWorld, 600);
  }
  waitWorld();

  // ── 诊断/测试口 ──────────────────────────────────────────────────────
  window.WorldInteractions = {
    version: VERSION,
    claim, joinAct, redeem,
    open: () => { if (!state.panelOpen) togglePanel(); },
    close: () => { if (state.panelOpen) togglePanel(); },
    _diag() {
      return {
        version: VERSION, started: state.started, panelOpen: state.panelOpen,
        nearest: state.nearest && state.nearest.key, nearbyCount: state.nearby.length,
        myTasks: state.mine.length, publicTasks: state.tasks.length,
        activities: state.activities.length, errors: state.errors,
        lastResult: state.lastResult, loggedIn: loggedIn(),
      };
    },
  };
})();
