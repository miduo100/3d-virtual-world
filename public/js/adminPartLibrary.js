/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 📚 零件库后台 · 主模块（admin.html「零件库」页）—— 列表 / 检索 / 库详情
 * ------------------------------------------------------------------
 * 背景：admin.html 预留了导航项、按钮与检索容器，但配套的 adminPartLibrary.js
 *       从未落盘（script 标签还是 TODO 注释），导致「📁 上传文件夹 / 📂 扫描本地目录 /
 *       🔄 刷新 / 🔍 查询」四个按钮**完全没有事件绑定**，点了没反应。
 *       后端早已就绪：src/routes/partLibrary.js（管理+检索）、src/routes/assetLibrary.js
 *       （服务器目录扫描通道）、src/routes/modelBundleUpload.js（文件夹/zip 上传通道）。
 *
 * 分工：
 *   本文件        —— 库列表卡片 + 汇总、零件检索、库详情（200 零件网格）、归档/恢复
 *   adminPartLibraryImport.js —— 「上传文件夹 / 扫描本地目录」两个导入弹窗
 *
 * 库的三种"消失"语义（别混）：
 *   归档 archived  —— 只是隐藏，检索里 includeInactive 才可见，数据全留
 *   删除 deleted  —— 进回收站：列表/检索都看不见，但**零件与磁盘文件都保留**可恢复
 *   清空回收站     —— 真正删 DB + 删磁盘，释放空间，不可恢复
 *
 * 鉴权：GET 不会被 adminAuthFetch.js 注入凭证（它只处理非读方法），而
 *      /api/part-library 与 /api/asset-library 整段都挂了 authenticateAdminToken
 *      → 因此**所有请求（含 GET）都显式带 Authorization**。
 */
(function () {
  'use strict';
  if (window.PartLibrary) return; // 幂等

  const PL_API = '/api/part-library';

  const ROLE_CN = {
    road: '道路', ground: '地面', decal: '贴花', window: '窗', awning: '雨棚',
    cornice: '檐口', railing: '栏杆', stairs: '楼梯', door: '门', column: '柱/梁',
    wall: '墙', floor: '地面板', roof: '屋顶', nature: '自然物', prop: '道具',
  };
  const STATUS_CN = {
    active: '启用中', pending_review: '待审核', archived: '已归档', rejected: '已驳回',
  };
  const STATUS_COLOR = {
    active: '#22c55e', pending_review: '#f59e0b', archived: '#94a3b8', rejected: '#ef4444',
  };

  // ───────────────────── 基础设施（同时导出给导入模块复用） ─────────────────────
  const kit = {
    ROLE_CN, STATUS_CN, PL_API,
    $(id) { return document.getElementById(id); },
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    fmtSize(n) {
      n = Number(n) || 0;
      if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
      if (n >= 1024) return (n / 1024).toFixed(0) + 'KB';
      return n + 'B';
    },
    fmtNum(n) { return (Number(n) || 0).toLocaleString('en-US'); },
    authHeaders(extra) {
      const h = Object.assign({}, extra || {});
      const t = (localStorage.getItem('adminToken') || '').trim();
      if (t) h.Authorization = 'Bearer ' + t;
      return h;
    },
    async apiGet(path) {
      const r = await fetch(path, { headers: kit.authHeaders() });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.success === false) throw new Error((j && (j.error || j.details)) || ('HTTP ' + r.status));
      return j;
    },
    async apiPost(path, body) {
      const r = await fetch(path, {
        method: 'POST',
        headers: kit.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body || {}),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.success === false) throw new Error((j && (j.error || j.details)) || ('HTTP ' + r.status));
      return j;
    },
    async apiDelete(path) {
      const r = await fetch(path, { method: 'DELETE', headers: kit.authHeaders() });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.success === false) throw new Error((j && (j.error || j.details)) || ('HTTP ' + r.status));
      return j;
    },
    say(text, kind) {
      const box = kit.$('pl-msg');
      if (!box) return;
      if (!text) { box.style.display = 'none'; box.textContent = ''; return; }
      const bg = kind === 'error' ? 'rgba(239,68,68,.14)'
        : kind === 'ok' ? 'rgba(34,197,94,.14)' : 'rgba(59,130,246,.14)';
      const fg = kind === 'error' ? '#fca5a5' : kind === 'ok' ? '#86efac' : '#93c5fd';
      box.style.display = 'block';
      box.style.background = bg;
      box.style.color = fg;
      box.textContent = text;
    },
    badge(status) {
      const c = STATUS_COLOR[status] || '#94a3b8';
      return `<span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;
        color:${c};border:1px solid ${c};background:rgba(255,255,255,.04)">${kit.esc(STATUS_CN[status] || status)}</span>`;
    },
    num3(v) { return v == null ? '?' : (Math.round(Number(v) * 100) / 100); },
    showModal(id) { const m = kit.$(id); if (m) m.style.display = 'flex'; },
    hideModal(id) { const m = kit.$(id); if (m) m.style.display = 'none'; },
  };
  const { $ } = kit;

  /** 零件卡片（检索结果与库详情共用） */
  function partCard(it) {
    const img = it.thumbnail
      ? `<img src="${kit.esc(it.thumbnail)}" loading="lazy" style="width:100%;height:96px;object-fit:contain;
           background:#0b1220;border-radius:6px" onerror="this.style.visibility='hidden'">`
      : `<div style="width:100%;height:96px;border-radius:6px;display:flex;align-items:center;justify-content:center;
           font-size:24px;background:rgba(148,163,184,.12)">🧩</div>`;
    const dims = (it.grid_w != null || it.grid_h != null)
      ? `${kit.num3(it.grid_w)}×${kit.num3(it.grid_h)}${it.grid_d != null ? '×' + kit.num3(it.grid_d) : ''}m` : '—';
    return `<div class="card" style="padding:9px" title="${kit.esc(it.model_path || '')}">
      ${img}
      <div style="font-size:12px;margin-top:7px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        title="${kit.esc(it.part_key)}">${kit.esc(it.part_key)}</div>
      <div style="font-size:11px;color:var(--text-secondary);margin-top:3px">
        ${kit.esc(kit.ROLE_CN[it.part_role] || it.part_role)}${it.part_subtype ? ' / ' + kit.esc(it.part_subtype) : ''}</div>
      <div style="font-size:11px;color:var(--text-secondary)">
        ${it.tris ? kit.fmtNum(it.tris) + ' 面 · ' : ''}${dims} · ${it.collidable ? '可碰撞' : '不碰撞'}</div>
    </div>`;
  }

  // ───────────────────── 库列表 ─────────────────────
  let lastLibraries = [];

  /**
   * 后端 GET /libraries 默认过滤掉 archived 库，而归档是本页面唯一的状态操作
   * → 不给开关的话「归档」按钮等于单程票（归档后卡片消失、无法恢复）。
   * 这里动态插入一个开关（不改编排版 HTML）：同时影响列表与检索的 inactive 过滤。
   * 回收站（deleted）同理需要「显示已删除」开关，否则恢复按钮永远看不到。
   */
  function ensureArchiveToggle() {
    if ($('pl-show-trash')) return;
    const bar = $('pl-topbar');
    if (!bar) return;

    if (!$('pl-show-archived')) {
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex;gap:5px;align-items:center;font-size:12px;color:var(--text-secondary);cursor:pointer';
      lab.innerHTML = '<input type="checkbox" id="pl-show-archived" style="vertical-align:-1px"> 显示已归档';
      lab.querySelector('input').addEventListener('change', () => { loadLibraries(); doSearch(); });
      bar.insertBefore(lab, bar.firstChild);
    }

    // 回收站开关
    const lab2 = document.createElement('label');
    lab2.style.cssText = 'display:flex;gap:5px;align-items:center;font-size:12px;color:#fca5a5;cursor:pointer';
    lab2.innerHTML = '<input type="checkbox" id="pl-show-trash" style="vertical-align:-1px"> ♻️ 显示已删除（回收站）';
    lab2.querySelector('input').addEventListener('change', () => { loadLibraries(); renderTrashBtn(); });
    bar.insertBefore(lab2, bar.firstChild);

    // 清空回收站按钮（紧挨「🔄 刷新」；无内容时禁用并说明）
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.id = 'pl-btn-purge';
    btn.style.cssText = 'color:#fca5a5;border-color:rgba(239,68,68,.45)';
    btn.textContent = '♻️ 清空回收站';
    btn.title = '彻底删除回收站里的所有库及其磁盘模型文件，释放空间；清空后无法恢复';
    btn.onclick = purgeTrash;
    const refresh = $('pl-btn-refresh');
    if (refresh && refresh.parentNode) refresh.parentNode.insertBefore(btn, refresh.nextSibling);
    else bar.appendChild(btn);
  }

  function showArchived() { const el = $('pl-show-archived'); return !!(el && el.checked); }
  function showTrash() { const el = $('pl-show-trash'); return !!(el && el.checked); }

  /** 回收站摘要（来自库列表 totals，不额外请求）→ 决定清空按钮的可用性与文案 */
  let lastTotals = {};
  function renderTrashBtn() {
    const btn = $('pl-btn-purge');
    if (!btn) return;
    const t = lastTotals || {};
    const n = t.trash_libs || 0;
    if (!showTrash() && n === 0) {
      btn.disabled = true;
      btn.textContent = '♻️ 清空回收站（空）';
      btn.title = '回收站是空的';
      return;
    }
    btn.disabled = n === 0;
    btn.textContent = n ? `♻️ 清空回收站（${n} 个库 · ${kit.fmtSize(t.trash_bytes || 0)}）` : '♻️ 清空回收站';
    btn.title = n
      ? `将彻底删除 ${n} 个库、${kit.fmtNum(t.trash_bytes || 0)} 字节的磁盘模型文件；清空后无法恢复`
      : '回收站是空的';
  }

  async function loadLibraries() {
    const grid = $('pl-library-grid');
    if (grid) grid.innerHTML = '<div class="loading">加载中…</div>';
    try {
      const q = [];
      if (showArchived()) q.push('includeArchived=1');
      if (showTrash()) q.push('includeDeleted=1');
      const j = await kit.apiGet(PL_API + '/libraries' + (q.length ? '?' + q.join('&') : ''));
      lastLibraries = j.libraries || [];
      lastTotals = j.totals || {};
      renderSummary(lastTotals);
      renderLibraries();
      renderTrashBtn();
    } catch (e) {
      if (grid) grid.innerHTML = `<div class="empty">加载失败：${kit.esc(e.message)}</div>`;
      kit.say('加载库列表失败：' + e.message, 'error');
    }
  }

  function renderSummary(t) {
    const el = $('pl-summary');
    if (!el) return;
    el.innerHTML = `启用中 ${t.active_libs || 0} 个库 · 待审核 ${t.pending_libs || 0} · 已归档 ${t.archived_libs || 0}`
      + ` · 零件总数 ${kit.fmtNum(t.total_items)} 个 · 合计 ${kit.fmtNum(t.total_tris)} 面`
      + (t.trash_libs
        ? ` · <span style="color:#fca5a5">♻️ 回收站 ${t.trash_libs} 个库（占盘 ${kit.fmtSize(t.trash_bytes || 0)}，清空后不可恢复）</span>`
        : '');
  }

  function renderLibraries() {
    const grid = $('pl-library-grid');
    if (!grid) return;
    if (!lastLibraries.length) {
      grid.innerHTML = '<div class="empty">还没有零件库。用右上角「上传文件夹」或「扫描本地目录」导入第一个资源包。</div>';
      return;
    }
    grid.innerHTML = lastLibraries.map((l) => {
      const st = l.stats || {};
      const trashed = l.status === 'deleted';
      const cover = l.cover_image
        ? `<img src="${kit.esc(l.cover_image)}" style="width:100%;height:104px;object-fit:cover;border-radius:8px;background:#111827" onerror="this.style.display='none'">`
        : `<div style="width:100%;height:104px;border-radius:8px;display:flex;align-items:center;justify-content:center;
             font-size:30px;background:linear-gradient(135deg,rgba(99,102,241,.25),rgba(34,197,94,.18))">📦</div>`;
      // 回收站里的卡片：只给「恢复」和「彻底删除」，不再提供归档/删除
      const actions = trashed
        ? `<button class="btn btn-sm btn-primary" data-pl-restore="${l.id}" data-name="${kit.esc(l.display_name)}">♻️ 恢复此库</button>
           <button class="btn btn-sm" data-pl-purge1="${l.id}" data-name="${kit.esc(l.display_name)}"
             title="跳过回收站，直接彻底删除（不可恢复）"
             style="color:#fca5a5;border-color:rgba(239,68,68,.45)">🗑 彻底删除</button>`
        : `<button class="btn btn-sm btn-primary" data-pl-open="${l.id}">查看零件</button>
           <button class="btn btn-sm" data-pl-status="${l.id}" data-st="${kit.esc(l.status)}">
             ${l.status === 'archived' ? '恢复启用' : '归档'}</button>
           <button class="btn btn-sm" data-pl-del="${l.id}" data-name="${kit.esc(l.display_name)}"
             data-n="${kit.fmtNum(l.item_count)}" title="移入回收站（可恢复；磁盘文件暂不删除）"
             style="color:#fbbf24;border-color:rgba(245,158,11,.45)">🗑 删除</button>`;
      return `<div class="card" style="padding:12px${trashed ? ';opacity:.72;border-color:rgba(239,68,68,.35)' : ''}"
        ${trashed ? 'title="在回收站中：清空回收站后不可恢复"' : ''}>
        ${cover}
        <div style="display:flex;align-items:center;gap:6px;margin-top:9px">
          <strong style="font-size:14px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${kit.esc(l.display_name)}">${kit.esc(l.display_name)}</strong>
          ${trashed ? '<span class="badge" style="font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(239,68,68,.16);color:#fca5a5">♻️ 回收站</span>' : kit.badge(l.status)}
        </div>
        <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">
          ${kit.esc(l.pack_key)}${l.style_family ? ' · ' + kit.esc(l.style_family) : ''}</div>
        <div style="font-size:12px;margin-top:7px">
          零件 ${kit.fmtNum(l.item_count)} 个${l.thumb_count ? ` · 缩略图 ${kit.fmtNum(l.thumb_count)}` : ''}
          ${st.totalTris ? ` · ${kit.fmtNum(st.totalTris)} 面` : ''}${st.bytes ? ` · ${kit.fmtSize(st.bytes)}` : ''}
          ${trashed && l.bytes ? ` · <span style="color:#fca5a5">占盘 ${kit.fmtSize(l.bytes)}</span>` : ''}</div>
        ${l.description ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:5px;overflow:hidden;
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${kit.esc(l.description)}</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:10px">${actions}</div>
      </div>`;
    }).join('');
  }

  async function toggleStatus(id, cur) {
    const next = cur === 'archived' ? 'active' : 'archived';
    if (!confirm(next === 'archived' ? '归档后该库将从检索与新建中隐藏，确定？' : '恢复启用该库？')) return;
    try {
      await kit.apiPost(`${PL_API}/libraries/${id}/status`, { status: next });
      kit.say(next === 'archived' ? '已归档该库' : '已恢复该库', 'ok');
      loadLibraries();
    } catch (e) { kit.say('操作失败：' + e.message, 'error'); }
  }

  /**
   * 移入回收站（软删除）：零件与磁盘文件都保留，可随时「恢复」。
   * 真正占空间的磁盘文件由顶栏「♻️ 清空回收站」统一释放（可反悔，所以分两步）。
   */
  async function removeLibrary(id, name, n) {
    if (!confirm(`确定把库「${name}」移入回收站？\n\n`
      + `该库及其 ${n || 0} 个零件会从列表与检索中消失，但**数据与模型文件都还在**，随时可以恢复。\n`
      + '磁盘空间要等你在顶栏点「♻️ 清空回收站」时才真正释放（那时才不可恢复）。')) return;
    try {
      const j = await kit.apiDelete(`${PL_API}/libraries/${id}`);
      kit.say(`已移入回收站：${name}（${j.partCount || 0} 个零件，可恢复；`
        + '要释放磁盘空间请点顶栏「♻️ 清空回收站」）', 'ok');
      loadLibraries();
    } catch (e) {
      kit.say('删除失败：' + e.message, 'error');
    }
  }

  /** 从回收站恢复（状态回到删除前；原本是归档的仍回到归档） */
  async function restoreLibrary(id, name) {
    try {
      const j = await kit.apiPost(`${PL_API}/libraries/${id}/restore`, {});
      kit.say(`已恢复库「${name}」${j.library && j.library.status === 'archived' ? '（回到"已归档"状态）' : ''}`, 'ok');
      loadLibraries();
    } catch (e) {
      kit.say('恢复失败：' + e.message, 'error');
    }
  }

  /** 回收站内单库彻底删除（跳过"清空"，用于只清一个库） */
  async function purgeOne(id, name) {
    if (!confirm(`彻底删除库「${name}」？\n\n会同时删除服务器磁盘上的模型文件，释放空间。\n此操作不可恢复。`)) return;
    try {
      const j = await kit.apiDelete(`${PL_API}/libraries/${id}/purge`);
      const d = j.disk || {};
      kit.say(`已彻底删除「${name}」：零件 ${(j.counts || {}).parts || 0} · 模型 ${(j.counts || {}).models || 0}`
        + `${d.removedDirs && d.removedDirs.length ? ' · 磁盘目录 ' + d.removedDirs.length + ' 个已释放' : ''}`, 'ok');
      loadLibraries();
    } catch (e) {
      kit.say('彻底删除失败：' + e.message, 'error');
    }
  }

  /** 清空回收站：真删全部已删除库 + 释放磁盘空间（不可恢复） */
  async function purgeTrash() {
    let t;
    try { t = await kit.apiGet(PL_API + '/libraries/trash'); }
    catch (e) { kit.say('读取回收站失败：' + e.message, 'error'); return; }
    const tot = t.totals || {};
    if (!tot.libs) { kit.say('回收站是空的，无需清理', 'info'); return; }

    if (!confirm(
      `清空回收站？\n\n`
      + `将**彻底删除** ${tot.libs} 个库、${kit.fmtNum(tot.parts)} 个零件，`
      + `并删除服务器磁盘上的模型文件，释放约 ${kit.fmtSize(tot.bytes)}。\n\n`
      + '⚠️ 清空后**无法恢复**。若只是想隐藏列表，请改用「归档」。')) return;

    const keepDisk = confirm(
      '第二步：磁盘文件怎么处理？\n\n'
      + '· 选「确定」：一并删除磁盘文件，**空间立即释放**（推荐，回收站的意义就在这）\n'
      + '· 选「取消」：只删数据库记录，磁盘文件保留（空间不会释放）');
    try {
      const j = await kit.apiPost(PL_API + '/libraries/purge', { dropDisk: !keepDisk });
      const p = j.purged || [], b = j.blocked || [], fl = j.failed || [];
      let msg = `回收站已清空：删除 ${p.length} 个库`
        + `${keepDisk ? `，释放 ${j.diskFreed || 0} 个磁盘目录` : '（磁盘文件已保留）'}`;
      if (b.length) msg += `；⚠️ ${b.length} 个库被跳过（零件已被摆进世界，请先在世界编辑器删除对应对象）：`
        + b.map((x) => x.name).join('、');
      if (fl.length) msg += `；${fl.length} 个库删除失败`;
      kit.say(msg, b.length || fl.length ? 'error' : 'ok');
      loadLibraries();
      if (facetsLoaded) { facetsLoaded = false; loadFacets(); }
    } catch (e) {
      kit.say('清空回收站失败：' + e.message, 'error');
    }
  }

  // ───────────────────── 检索 ─────────────────────
  let facetsLoaded = false;
  async function loadFacets() {
    if (facetsLoaded) return;
    try {
      const j = await kit.apiGet(PL_API + '/facets');
      const fill = (el, rows, key) => {
        if (!el) return;
        const keep = el.value;
        const all = el.dataset.allLabel || '全部';
        el.innerHTML = `<option value="">${kit.esc(all)}</option>` +
          (rows || []).map((r) => `<option value="${kit.esc(r[key])}">${kit.esc(r[key])}（${kit.fmtNum(r.n)}）</option>`).join('');
        el.value = keep;
      };
      fill($('pl-f-role'), (j.roles || []).map((r) => ({ part_role: r.part_role, n: r.n })), 'part_role');
      fill($('pl-f-style'), j.styles || [], 'style_family');
      facetsLoaded = true;
    } catch (e) { kit.say('筛选项加载失败：' + e.message, 'error'); }
  }

  async function doSearch() {
    const box = $('pl-results');
    const info = $('pl-search-info');
    const p = new URLSearchParams();
    const role = $('pl-f-role') && $('pl-f-role').value;
    const style = $('pl-f-style') && $('pl-f-style').value;
    const gw = $('pl-f-gridw') && $('pl-f-gridw').value;
    const q = $('pl-f-q') && $('pl-f-q').value.trim();
    if (role) p.set('role', role);
    if (style) p.set('style', style);
    if (gw) p.set('gridW', gw);
    if (q) p.set('q', q);
    if (showArchived()) p.set('includeInactive', '1');
    p.set('limit', '120');
    if (box) box.innerHTML = '<div class="loading">检索中…</div>';
    try {
      const j = await kit.apiGet(PL_API + '/search?' + p.toString());
      renderResults(j.items || []);
      if (info) {
        // ⚠ 用 total（真实命中数），不是 count（本次返回条数，被 limit 截断）。
        //   此前写成「命中 120 个」，实际库里 2,143 件 —— 数字看着对、含义错。
        const total = typeof j.total === 'number' ? j.total : j.count;
        const shown = j.items ? j.items.length : 0;
        info.textContent = `命中 ${kit.fmtNum(total)} 个零件`
          + (total > shown ? `（显示前 ${kit.fmtNum(shown)} 件，可加筛选缩小范围）` : '')
          + (role ? ` · 角色=${kit.ROLE_CN[role] || role}` : '')
          + (style ? ` · 风格=${style}` : '')
          + (gw ? ` · 模数宽≈${gw}m` : '')
          + (q ? ` · 名称含「${q}」` : '');
      }
    } catch (e) {
      if (box) box.innerHTML = '';
      if (info) info.textContent = '检索失败：' + e.message;
    }
  }

  function renderResults(items) {
    const box = $('pl-results');
    if (!box) return;
    if (!items.length) { box.innerHTML = '<div class="empty">没有命中的零件</div>'; return; }
    box.innerHTML = items.map(partCard).join('');
  }

  // ───────────────────── 库详情 ─────────────────────
  function ensureDetailModal() {
    if ($('pl-detail-modal')) return;
    const d = document.createElement('div');
    d.id = 'pl-detail-modal'; d.className = 'modal'; d.style.display = 'none';
    d.innerHTML = `<div class="modal-box" style="max-width:900px">
      <div class="modal-header"><h2>📚 库详情</h2><button class="close-btn" data-pl-close="pl-detail-modal">✕</button></div>
      <div class="modal-body" style="max-height:66vh;overflow:auto"><div id="pl-detail-body"></div></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button class="btn" data-pl-close="pl-detail-modal">关闭</button></div>
    </div>`;
    document.body.appendChild(d);
  }

  async function openLibrary(id) {
    // ⚠️ 必须先建弹窗再取 body：首次点击时 modal 还不存在，先取会得到 null，
    //    导致详情面板永远空白（只有第二次点击才正常）。
    ensureDetailModal();
    const body = $('pl-detail-body');
    if (body) body.innerHTML = '<div class="loading">加载中…</div>';
    kit.showModal('pl-detail-modal');
    try {
      const j = await kit.apiGet(`${PL_API}/libraries/${id}`);
      const lib = j.library || {};
      const roles = Object.entries(j.roleCount || {}).map(([k, v]) =>
        `<span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;
          background:rgba(99,102,241,.16);color:#c7d2fe;margin:0 5px 5px 0">${kit.esc(kit.ROLE_CN[k] || k)} ${v}</span>`).join('');
      if (body) {
        body.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong style="font-size:15px">${kit.esc(lib.display_name || '')}</strong>${kit.badge(lib.status)}
            <span style="font-size:12px;color:var(--text-secondary)">
              pack_key=${kit.esc(lib.pack_key || '')}${lib.style_family ? ' · 风格=' + kit.esc(lib.style_family) : ''}
              ${lib.license_info && lib.license_info.type ? ' · 授权=' + kit.esc(lib.license_info.type) : ''}</span>
          </div>
          <div style="margin-top:8px">${roles || '<span style="font-size:12px;color:var(--text-secondary)">无零件</span>'}</div>
          ${lib.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:6px">${kit.esc(lib.description)}</div>` : ''}
          <div style="margin-top:10px;font-size:12px;color:var(--text-secondary)">共 ${kit.fmtNum((j.items || []).length)} 个（最多显示 200）</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;margin-top:10px">
            ${(j.items || []).map(partCard).join('') || '<div class="empty">该库没有零件行</div>'}
          </div>`;
      }
    } catch (e) {
      if (body) body.innerHTML = `<div class="empty">加载失败：${kit.esc(e.message)}</div>`;
    }
  }

  // ─────────── AL-16：上传模型页顶部拆分提示（自注入，不改 admin.html）───────────
  // 语义决策（文档 F.6.9 决策 2）：「上传模型」页只显示用户自己传的模型；
  // 零件库那 N 件只在零件库页出现。此处用包装既有 renderUploadedModels 的方式
  // 插一行提示，既不改 admin.html 的 fetch，也不碰 977 行的 admin.js。
  let splitCache = null;
  async function fetchSplit() {
    if (splitCache) return splitCache;
    try {
      const r = await kit.apiGet('/api/part-library/split');
      splitCache = { model: r.model_count || 0, part: r.part_count || 0 };
    } catch (e) {
      splitCache = { model: 0, part: 0 };
    }
    return splitCache;
  }

  function ensureSplitHint() {
    if ($('pl-split-hint')) return $('pl-split-hint');
    const host = $('uploaded-models-content');
    if (!host || !host.parentNode) return null;
    const div = document.createElement('div');
    div.id = 'pl-split-hint';
    div.style.cssText = 'font-size:12px;color:var(--text-secondary);margin:0 0 8px;padding:6px 10px;border:1px solid var(--border-color,#333);border-radius:6px';
    host.parentNode.insertBefore(div, host);
    return div;
  }

  async function refreshSplitHint() {
    const el = ensureSplitHint();
    if (!el) return;
    const s = await fetchSplit();
    el.innerHTML = `你上传了 <b>${s.model}</b> 个模型 · 零件库另贡献 <b>${s.part}</b> 个（不在此显示，见 <a href="#" onclick="showPage('part-library');return false;" style="color:var(--blue)">📚 零件库</a>）`;
  }

  function hookUploadedModels() {
    if (hookUploadedModels._done) return;
    const orig = window.renderUploadedModels;
    if (typeof orig !== 'function') { setTimeout(hookUploadedModels, 600); return; }
    hookUploadedModels._done = true;
    window.renderUploadedModels = function (models) {
      const r = orig.apply(this, arguments);
      try { refreshSplitHint(); } catch (e) { /* 提示失败不影响列表 */ }
      return r;
    };
  }

  // ───────────────────── 启动 ─────────────────────
  const importHooks = { upload: null, scan: null };

  function bind() {
    if ($('pl-btn-refresh')) {
      // 「刷新」= 重新拉库卡片与统计。**空条件时不跑检索** ——
      //   此前刷新会触发一次无筛选检索，把结果区刷成 120 条（按库名字母序全是地砖），
      //   用户会以为页面坏了。有筛选条件时才顺带刷新检索结果。
      $('pl-btn-refresh').onclick = () => {
        loadFacets(); loadLibraries();
        const hasFilter = !!(
          ($('pl-f-role') && $('pl-f-role').value) ||
          ($('pl-f-style') && $('pl-f-style').value) ||
          ($('pl-f-gridw') && $('pl-f-gridw').value) ||
          ($('pl-f-q') && $('pl-f-q').value.trim())
        );
        const hadResults = !!($('pl-results') && $('pl-results').children.length);
        if (hasFilter || hadResults) doSearch();
        else kit.say('已刷新库卡片与统计（无筛选条件，未重跑零件检索）', 'ok');
      };
    }
    if ($('pl-btn-search')) $('pl-btn-search').onclick = doSearch;
    if ($('pl-f-q')) $('pl-f-q').onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
    const a = $('pl-f-role'), b = $('pl-f-style');
    if (a && !a.dataset.allLabel) a.dataset.allLabel = '全部角色';
    if (b && !b.dataset.allLabel) b.dataset.allLabel = '全部风格';
    ensureArchiveToggle();

    if (!bind._done) {
      bind._done = true;
      document.addEventListener('click', (e) => {
        const t = e.target.closest
          ? e.target.closest('[data-pl-close],[data-pl-open],[data-pl-status],[data-pl-del],[data-pl-restore],[data-pl-purge1]') : null;
        if (!t) return;
        if (t.hasAttribute('data-pl-close')) kit.hideModal(t.getAttribute('data-pl-close'));
        else if (t.hasAttribute('data-pl-open')) openLibrary(t.getAttribute('data-pl-open'));
        else if (t.hasAttribute('data-pl-del')) {
          removeLibrary(t.getAttribute('data-pl-del'), t.getAttribute('data-name'), t.getAttribute('data-n'));
        } else if (t.hasAttribute('data-pl-restore')) {
          restoreLibrary(t.getAttribute('data-pl-restore'), t.getAttribute('data-name'));
        } else if (t.hasAttribute('data-pl-purge1')) {
          purgeOne(t.getAttribute('data-pl-purge1'), t.getAttribute('data-name'));
        } else if (t.hasAttribute('data-pl-status')) {
          toggleStatus(t.getAttribute('data-pl-status'), t.getAttribute('data-st'));
        }
      });
    }
    // 导入模块（adminPartLibraryImport.js）注册进来的两个入口
    if (importHooks.upload && $('pl-btn-upload')) $('pl-btn-upload').onclick = importHooks.upload;
    if (importHooks.scan && $('pl-btn-scan')) $('pl-btn-scan').onclick = importHooks.scan;
  }

  /** 由 adminPartLibraryImport.js 调用，注册「上传文件夹 / 扫描本地目录」入口 */
  function attachImport(hooks) {
    if (hooks.upload) importHooks.upload = hooks.upload;
    if (hooks.scan) importHooks.scan = hooks.scan;
    bind();
  }

  function load() {
    bind();
    loadFacets();
    loadLibraries();
  }

  function boot() {
    hookUploadedModels();          // AL-16：上传模型页拆分提示（与零件库页无关，始终挂钩）
    if ($('pl-btn-upload')) { load(); return; }
    let tries = 0;
    const t = setInterval(() => {
      if ($('pl-btn-upload') || ++tries > 20) clearInterval(t);
      if ($('pl-btn-upload')) load();
    }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PartLibrary = {
    kit, load, attachImport, doSearch, openLibrary, loadLibraries, partCard,
    apiGet: kit.apiGet, apiPost: kit.apiPost,
    refreshSplitHint, fetchSplit,
  };
})();
