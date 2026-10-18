/**
 * adminTerrain —— 后台「3D资产 → 🗺️ 地形」页签
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 概念：「地形 = 地块」。这里管的就是 world_editor 的「🗺️ 地形设置」那份数据。
 *   一块地形 = 位置(中心 X/Z) + 面积(宽×深) + 基准高度 Y + 生成参数(seed/起伏/…)
 *   多块可同时生效，各自占一块区域；地形之外没有地面（玩家会一直下落）。
 *
 * 零结构侵入：sub-tab 按钮与容器全部由本文件自注入，admin.html 只加 1 行 script。
 */
(function () {
  'use strict';
  const API = '/api/terrain';
  let built = false;
  let loaded = false;
  let terrains = [];
  let defaults = null;

  const $ = (id) => document.getElementById(id);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

  async function jreq(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const tk = localStorage.getItem('adminToken');
    if (tk) opt.headers.Authorization = 'Bearer ' + tk;
    const res = await fetch(url, opt);
    let j = null; try { j = await res.json(); } catch (e) { j = {}; }
    if (!res.ok || j.success === false) throw new Error((j && (j.error || j.reason || j.message)) || ('HTTP ' + res.status));
    return j;
  }

  function msg(text, ok) {
    const el = $('at-msg');
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? 'var(--green)' : 'var(--red)';
    setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 7000);
  }

  function build() {
    if (built) return true;
    const page = $('page-assets');
    if (!page) return false;
    const bar = page.querySelector('div[style*="border-bottom"]');
    if (!bar) return false;

    bar.insertAdjacentHTML('beforeend',
      '<button class="sub-tab" id="at-tab" onclick="window.adminTerrain.show()">🗺️ 地形</button>');

    const wrap = document.createElement('div');
    wrap.id = 'assets-sub-terrain';
    wrap.className = 'sub-page';
    wrap.style.display = 'none';
    wrap.innerHTML =
      '<div class="card" style="margin-bottom:14px;">' +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
          '<strong>🗺️ 地形</strong>' +
          '<span style="font-size:12px;color:var(--text-secondary);">' +
            '与 world_editor 的「🗺️ 地形设置」是同一份数据（原来的"地块"概念已并入地形）' +
          '</span>' +
          '<span style="flex:1"></span>' +
          '<button class="btn btn-primary" id="at-new">＋ 新建地形</button>' +
          '<button class="btn" id="at-refresh">🔄 刷新</button>' +
        '</div>' +
        '<div id="at-active-bar" style="margin-top:10px;font-size:13px;color:var(--text-secondary);"></div>' +
        '<div id="at-msg" style="margin-top:8px;font-size:13px;"></div>' +
      '</div>' +
      '<div id="at-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;">' +
        '<div class="loading">加载中…</div>' +
      '</div>' +
      '<div class="card" style="margin-top:14px;font-size:12px;line-height:1.8;color:var(--text-secondary);">' +
        '<b>规则</b><br>' +
        '· 一块地形占据一块矩形：中心 (X, Z) + 宽度/深度；多块可同时生效，交界处<b>硬接</b>。<br>' +
        '· 地形范围之外<b>没有地面</b>：玩家会按重力一直下落（符合"离散地块"的设计）。<br>' +
        '· 「基准高度 Y」可以让地形浮在空中（例如 Y=10000 就是一万米高的浮空陆地）。<br>' +
        '· 「默认地形（平地）」是内置原点地块：不可改不可删，但可以被优先级更高的新地形覆盖。' +
      '</div>';

    page.appendChild(wrap);
    $('at-new').onclick = () => openForm({ mode: 'create' });
    $('at-refresh').onclick = () => load(true);

    built = true;
    return true;
  }

  function show() {
    if (!build()) return;
    const page = $('page-assets');
    page.querySelectorAll('[id^="assets-sub-"]').forEach((el) => { el.style.display = 'none'; });
    page.querySelectorAll('.sub-tab').forEach((el) => el.classList.remove('active'));
    $('assets-sub-terrain').style.display = 'block';
    const tab = $('at-tab');
    if (tab) tab.classList.add('active');
    load(false);
  }

  function cardHtml(t) {
    const p = t.params || {};
    const a = t.area || {};
    const activeBadge = t.active ? '<span class="badge badge-green" style="margin-left:6px;">生效中</span>' : '';
    const builtinBadge = t.builtin ? '<span class="badge" style="margin-left:6px;background:#3b4252;color:#cbd5e1;">内置只读</span>' : '';
    const baseY = num(a.baseY, 0);

    return '' +
      '<div class="card" style="padding:14px;" data-id="' + t.id + '">' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
          '<strong style="font-size:15px;">' + esc(t.name) + '</strong>' + activeBadge + builtinBadge +
        '</div>' +
        '<div style="margin-top:8px;font-size:12px;line-height:1.9;color:var(--text-secondary);">' +
          '📍 位置 <b>(' + num(a.x, 0) + ', ' + num(a.z, 0) + ')</b>' +
          (baseY !== 0 ? ' · 高度 <b style="color:#fbbf24;">Y=' + baseY + '</b>' : '') + '<br>' +
          '📐 面积 <b>' + num(a.width, 0) + ' × ' + num(a.depth, 0) + ' m</b><br>' +
          '⛰ 起伏 <b>' + num(p.heightScale, 0) + 'm</b> · 雪线 ' + num(p.snowLine, 95) + ' · 树线 ' + num(p.treeLine, 80) + '<br>' +
          '⚙ 优先级 <b>' + num(a.priority, 0) + '</b> · 视距 ' + num(p.viewDistance, 256) + 'm · 瓦片 ' + num(p.chunkSize, 64) + 'm<br>' +
          'seed <b>' + num(t.seed, 1) + '</b>' +
          (t.note ? '<br><span style="opacity:.8;">' + esc(t.note) + '</span>' : '') +
        '</div>' +
        '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">' +
          (t.active
            ? '<button class="btn btn-sm" data-act="deactivate">停用</button>'
            : '<button class="btn btn-sm btn-primary" data-act="activate">启用</button>') +
          (t.builtin ? '' : '<button class="btn btn-sm" data-act="edit">编辑</button>') +
          '<button class="btn btn-sm" data-act="copy">复制</button>' +
          (t.builtin || t.active ? '' : '<button class="btn btn-sm" data-act="del" style="color:#f87171;">删除</button>') +
        '</div>' +
      '</div>';
  }

  function render() {
    const box = $('at-list');
    if (!box) return;
    if (!terrains.length) { box.innerHTML = '<div class="loading">暂无地形</div>'; return; }
    box.innerHTML = terrains.map(cardHtml).join('');
    box.querySelectorAll('[data-act]').forEach((btn) => {
      const id = Number(btn.closest('[data-id]').getAttribute('data-id'));
      btn.onclick = () => actOn(btn.getAttribute('data-act'), id, btn);
    });
    const on = terrains.filter((t) => t.active);
    const bar = $('at-active-bar');
    if (bar) {
      bar.innerHTML = '共 <b>' + terrains.length + '</b> 块 · 生效 <b style="color:var(--green);">' + on.length + '</b> 块' +
        (on.length ? '（' + on.map((t) => esc(t.name) + ' ' + num(t.area && t.area.width, 0) + '×' + num(t.area && t.area.depth, 0)).join('、') + '）' : '');
    }
  }

  async function load(showToast) {
    try {
      const j = await jreq('GET', API + '/list');
      terrains = j.terrains || [];
      defaults = j.defaults || defaults;
      loaded = true;
      render();
      if (showToast) msg('已刷新（' + terrains.length + ' 块）', true);
    } catch (e) {
      const box = $('at-list');
      if (box) box.innerHTML = '<div class="loading" style="color:#f87171;">读取失败：' + esc(e.message) + '</div>';
    }
  }

  async function actOn(act, id, btn) {
    const t = terrains.find((x) => x.id === id);
    if (!t) return;
    btn.disabled = true;
    try {
      if (act === 'activate') {
        await jreq('POST', API + '/' + id + '/activate');
        await load(false);
        msg('地形已生效：「' + t.name + '」——游戏内 60 秒内自动跟上，刷新页面立即生效', true);
      } else if (act === 'deactivate') {
        await jreq('POST', API + '/' + id + '/deactivate');
        await load(false);
        msg('已停用「' + t.name + '」（该区域不再有地面，玩家会掉下去）', true);
      } else if (act === 'edit') {
        openForm({ mode: 'edit', terrain: t });
      } else if (act === 'copy') {
        const name = prompt('新地形名称（以当前地形为模板复制）', t.name + ' 副本');
        if (!name) return;
        const j = await jreq('POST', API, {
          name: name, note: (t.note || '') + '（复制）', from: id,
          seed: t.seed, params: t.params, area: t.area
        });
        await load(false);
        msg('已复制为「' + j.terrain.name + '」（未生效）', true);
      } else if (act === 'del') {
        if (!confirm('确定删除地形「' + t.name + '」？此操作不可撤销')) return;
        await jreq('DELETE', API + '/' + id);
        await load(false);
        msg('已删除「' + t.name + '」', true);
      }
    } catch (e) {
      msg('操作失败：' + e.message, false);
    } finally {
      btn.disabled = false;
    }
  }

  function openForm(opts) {
    if (window.adminTerrainForm && window.adminTerrainForm.open) {
      window.adminTerrainForm.open(opts, (saved, activated) => {
        load(false);
        if (saved) msg(activated ? ('已保存并启用「' + saved.name + '」') : ('已保存「' + saved.name + '」（未启用）'), true);
      });
    } else {
      alert('地形表单模块未加载（adminTerrainForm.js）');
    }
  }

  let tries = 0;
  function boot() {
    try {
      if (build()) return;
    } catch (e) {
      console.warn('[adminTerrain] build 异常，将重试', e);
      built = false;
    }
    if (tries++ < 120) setTimeout(boot, 500);
  }

  window.adminTerrain = {
    show: show,
    load: load,
    openForm: openForm,
    get terrains() { return terrains; },
    get defaults() { return defaults; },
    _built: () => built,
    _loaded: () => loaded
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
