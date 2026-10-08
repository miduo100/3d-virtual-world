/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 📚 零件库后台 · 导入模块（上传文件夹 / 扫描服务器本地目录）
 * ------------------------------------------------------------------
 * 配套 adminPartLibrary.js（主模块：列表 / 检索 / 库详情）。本页两个入口的数据流向
 * 完全对称，唯一区别是文件来源：
 *   上传通道：<input webkitdirectory> 或 .zip
 *             → POST /api/upload-model-bundle | /api/upload-model-zip   （target='part'）
 *   扫描通道：填**服务器**绝对目录
 *             → POST /api/asset-library/scan/preview → /api/asset-library/scan
 * 两条通道最终都走 modelBundleUpload.finalizeBundle(target='part')
 * → ingestBundle（入库 uploaded_models）+ partLibraryRegistrar.registerBundle（建库+归类）。
 *
 * 默认不压缩外置贴图：Kenney 等资源包多为共享调色图集，量化后易出色带；
 * 默认不生成 LOD 变体：零件本身面数低（<5000 面本就跳过），可选。
 */
(function () {
  'use strict';
  if (window.PartLibraryImport) return;

  const PL = () => window.PartLibrary;
  const UPLOAD_API = '/api/upload-model-bundle';
  const ZIP_API = '/api/upload-model-zip';
  const SCAN_API = '/api/asset-library';
  const PRIMARY_EXTS = ['.gltf', '.obj', '.glb'];
  const OK_EXTS = ['.gltf', '.glb', '.obj', '.bin', '.mtl', '.png', '.jpg', '.jpeg', '.webp'];
  const MAX_FILES = 800;
  const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

  // ───────────────────── 弹窗骨架 ─────────────────────
  function ensureModals() {
    if (document.getElementById('pl-upload-modal')) return;
    const mk = (id, title, inner, foot, width) => {
      const d = document.createElement('div');
      d.id = id; d.className = 'modal'; d.style.display = 'none';
      d.innerHTML = `<div class="modal-box" style="max-width:${width || 680}px">
        <div class="modal-header"><h2>${title}</h2><button class="close-btn" id="${id}-x" data-pl-close="${id}">✕</button></div>
        <div class="modal-body" style="max-height:66vh;overflow:auto">${inner}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">${foot}</div>
      </div>`;
      document.body.appendChild(d);
    };

    mk('pl-upload-modal', '📁 上传文件夹 → 零件库', `
      <div class="form-group">
        <label>导入方式</label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-sm btn-blue" id="pl-up-folder">📂 选择文件夹</button>
          <button class="btn btn-sm" id="pl-up-zip">🗜️ 选择 zip</button>
          <span id="pl-up-source" style="font-size:12px;color:var(--text-secondary)"></span>
        </div>
        <input type="file" id="pl-up-file-folder" webkitdirectory multiple style="display:none">
        <input type="file" id="pl-up-file-zip" accept=".zip" style="display:none">
        <div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">
          glTF（.gltf+.bin+贴图）与 OBJ（.obj+.mtl+贴图）都是多文件格式，请整个文件夹或整包上传；
          共享贴图只存一份。库名默认取所选文件夹（或 zip 文件）名。
        </div>
      </div>
      <div class="form-group">
        <label>入库选项</label>
        <label class="chk"><input type="checkbox" id="pl-up-variants"><span>生成 LOD 变体（零件多为低模，通常不需要）</span></label>
        <label class="chk"><input type="checkbox" id="pl-up-compress"><span>压缩外置贴图（共享图集量化易出色带，默认不勾）</span></label>
      </div>
      <div id="pl-up-tip" style="display:none;margin:10px 0 2px;padding:9px 12px;border-radius:8px;font-size:12.5px;line-height:1.7"></div>
      <div id="pl-up-preview" class="upf-list" style="display:none"></div>
      <div id="pl-up-progress" style="display:none;margin-top:12px">
        <div id="pl-up-steps" class="pl-steps">
          <span data-pl-step="1"><i>1</i>上传文件</span>
          <span class="pl-sep">▸</span>
          <span data-pl-step="2"><i>2</i>服务器建库归类</span>
          <span class="pl-sep">▸</span>
          <span data-pl-step="3"><i>3</i>完成</span>
        </div>
        <div id="pl-up-track" class="pl-track">
          <div id="pl-up-fill" style="height:100%;width:0%;background:#38bdf8;transition:width .2s"></div>
        </div>
        <div id="pl-up-text" style="margin-top:6px;font-size:12.5px;color:var(--text-secondary);line-height:1.8"></div>
      </div>
      <div id="pl-up-result" style="display:none;margin-top:10px"></div>`,
      `<button class="btn" id="pl-up-cancel" data-pl-close="pl-upload-modal">取消</button>
       <button class="btn btn-primary" id="pl-up-go" disabled>开始导入</button>`);

    mk('pl-scan-modal', '📂 扫描服务器本地目录 → 零件库', `
      <div class="form-group">
        <label>服务器绝对路径（必须是**服务器上**的目录，不是你本机）</label>
        <div style="display:flex;gap:8px">
          <input id="pl-scan-dir" class="form-input" style="flex:1" placeholder="例如 H:\\素材\\kenney 或 /data/assets/kenney">
          <button class="btn btn-sm btn-blue" id="pl-scan-preview">预检</button>
        </div>
        <div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">
          支持 .gltf/.glb/.obj + .bin/.mtl/贴图；目录下含多个资源包子目录时会逐包导入；
          递归深度 ≤ 8，单包 ≤ ${MAX_FILES} 文件 / 500MB；目录名中的空格会自动转下划线。
        </div>
      </div>
      <div class="form-group">
        <label>入库选项</label>
        <label class="chk"><input type="checkbox" id="pl-scan-variants"><span>生成 LOD 变体</span></label>
        <label class="chk"><input type="checkbox" id="pl-scan-compress"><span>压缩外置贴图（默认不勾）</span></label>
        <label class="chk"><input type="checkbox" id="pl-scan-pending"><span>导入后置为「待审核」</span></label>
        <label class="chk"><input type="checkbox" id="pl-scan-split"><span>把每个子目录当作独立资源包
          <span style="color:var(--text-secondary)">（素材库根目录场景：H:\\kenney 这类，每个 kit 目录各成一个包）</span></span></label>
      </div>
      <div id="pl-scan-tip" style="display:none;margin:10px 0 2px;padding:9px 12px;border-radius:8px;font-size:12.5px;line-height:1.7"></div>
      <div id="pl-scan-progress" style="display:none;margin-top:10px">
        <div id="pl-scan-steps" class="pl-steps">
          <span data-pl-sstep="1"><i>1</i>读取与预检</span>
          <span class="pl-sep">▸</span>
          <span data-pl-sstep="2"><i>2</i>服务器导入归类</span>
          <span class="pl-sep">▸</span>
          <span data-pl-sstep="3"><i>3</i>完成</span>
        </div>
        <div id="pl-scan-track" class="pl-track">
          <div id="pl-scan-fill" style="height:100%;width:0%;background:#38bdf8;transition:width .2s"></div>
        </div>
        <div id="pl-scan-text" style="margin-top:6px;font-size:12.5px;color:var(--text-secondary);line-height:1.8"></div>
      </div>
      <div id="pl-scan-result" style="display:none"></div>`,
      `<button class="btn" id="pl-scan-cancel" data-pl-close="pl-scan-modal">取消</button>
       <button class="btn btn-primary" id="pl-scan-go" disabled>开始导入</button>`);

    bindModals();
  }

  function bindModals() {
    const P = PL(); if (!P) return;
    const $ = P.kit.$;
    $('pl-up-folder').onclick = () => $('pl-up-file-folder').click();
    $('pl-up-zip').onclick = () => $('pl-up-file-zip').click();
    $('pl-up-file-folder').addEventListener('change', (e) => onPicked(e.target.files, true));
    $('pl-up-file-zip').addEventListener('change', (e) => onPicked(e.target.files, false));
    $('pl-up-go').onclick = doUpload;
    $('pl-scan-preview').onclick = doScanPreview;
    $('pl-scan-go').onclick = doScan;
    $('pl-scan-dir').onkeydown = (e) => { if (e.key === 'Enter') doScanPreview(); };
  }

  // ───────────────────── 弹窗内提示 ─────────────────────
  /**
   * 为什么需要它：kit.say() 写在页面级 #pl-msg（零件库页顶部），而导入弹窗是全屏
   * fixed 遮罩——弹窗打开后页面级提示**完全看不见**，用户表现为「选完文件夹没反应」。
   * 这里把所有导入相关的提示同时写进弹窗内（并保留页面级那条，切回页面仍能看到）。
   */
  const TIP_COLOR = {
    error: ['rgba(239,68,68,.14)', '#fca5a5'],
    ok: ['rgba(34,197,94,.14)', '#86efac'],
    info: ['rgba(59,130,246,.14)', '#93c5fd'],
  };
  function tip(id, html, kind) {
    const P = PL(); if (!P) return;
    const box = P.kit.$(id);
    if (!box) return;
    if (!html) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const c = TIP_COLOR[kind] || TIP_COLOR.info;
    box.style.display = 'block';
    box.style.background = c[0];
    box.style.color = c[1];
    box.innerHTML = html;
  }
  /** 超限引导文案（两个通道的同类问题共用） */
  function limitTip(n, bytes, isFiles) {
    return isFiles
      ? `所选 <b>${n}</b> 个文件，超过单包 <b>${MAX_FILES}</b> 个上限。本通道一次只能导入<b>一个资源包</b>。<br>`
        + '· 请改选<b>单个 kit 目录</b>（如 <code>H:\\kenney\\kenney_furniture-kit</code>）<br>'
        + '· 若要把整棵素材树入库，请用「📂 扫描本地目录」通道（支持按子目录自动分包）'
      : `整包 <b>${bytes}</b>，超过 <b>500MB</b> 上限。本通道一次只能导入<b>一个资源包</b>。<br>`
        + '· 请改选<b>单个 kit 目录</b>，或先移除体积过大的贴图资源<br>'
        + '· 整棵素材树请用「📂 扫描本地目录」通道（支持按子目录自动分包）';
  }

  // ───────────────────── 上传（文件夹 / zip） ─────────────────────
  let picked = null; // { mode, files, relPaths, sourceRef }

  function onPicked(fileList, isFolder) {
    const P = PL(); if (!P) return;
    const kit = P.kit, $ = kit.$;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const relPaths = files.map((f) => (isFolder ? (f.webkitRelativePath || f.name) : f.name));
    const total = files.reduce((s, f) => s + f.size, 0);
    if (files.length > MAX_FILES) {
      kit.say(`所选 ${files.length} 个文件，超过 ${MAX_FILES} 上限`, 'error');
      tip('pl-up-tip', limitTip(files.length, 0, true), 'error');
      return;
    }
    if (total > MAX_TOTAL_BYTES) {
      kit.say(`整包 ${kit.fmtSize(total)}，超过 500MB 上限`, 'error');
      tip('pl-up-tip', limitTip(files.length, kit.fmtSize(total), false), 'error');
      return;
    }
    tip('pl-up-tip', '');

    const top = isFolder ? (relPaths[0].split('/')[0] || '') : relPaths[0].replace(/\.zip$/i, '');
    picked = { mode: isFolder ? 'folder' : 'zip', files, relPaths, sourceRef: top };

    const counts = {}; let ignored = 0;
    for (const rp of relPaths) {
      const ext = rp.slice(rp.lastIndexOf('.')).toLowerCase();
      if (OK_EXTS.includes(ext)) counts[ext] = (counts[ext] || 0) + 1; else ignored++;
    }
    const primaries = relPaths.filter((r) => PRIMARY_EXTS.includes(r.slice(r.lastIndexOf('.')).toLowerCase())).length;
    const pv = $('pl-up-preview');
    if (pv) {
      pv.style.display = 'block';
      pv.innerHTML = `<div class="upf-item" style="font-weight:600">${files.length} 个文件 · ${kit.fmtSize(total)} · 库名来源：${kit.esc(top)}</div>
        <div class="upf-item"><span class="upf-sub">主模型 ${primaries} 个；构成 ${kit.esc(Object.entries(counts).map(([e, n]) => e + '×' + n).join('，'))}${ignored ? `；其他类型 ${ignored} 个（不上传）` : ''}</span></div>
        ${relPaths.slice(0, 10).map((rp) => `<div class="upf-item"><span class="upf-name">${PRIMARY_EXTS.includes(rp.slice(rp.lastIndexOf('.')).toLowerCase()) ? '🎯' : '&nbsp;&nbsp;'} ${kit.esc(rp)}</span></div>`).join('')}
        ${relPaths.length > 10 ? `<div class="upf-item"><span class="upf-sub">… 其余 ${relPaths.length - 10} 个略</span></div>` : ''}`;
    }
    const src = $('pl-up-source');
    if (src) src.textContent = `已选：${top}`;
    const go = $('pl-up-go');
    if (go) go.disabled = primaries === 0;
    if (primaries === 0) {
      kit.say('没找到 .gltf/.glb/.obj 主文件，无法导入', 'error');
      tip('pl-up-tip', `所选 ${files.length} 个文件里没有 <b>.gltf / .glb / .obj</b> 主模型，无法导入。<br>`
        + '贴图 / <code>.bin</code> / <code>.mtl</code> 单独存在不能建零件，请选择<b>包含模型文件</b>的资源包目录。', 'error');
    }
    // 清空 input.value：否则「再次选择同一个文件夹/同一个 zip」时浏览器认为值未变、
    // **不再派发 change**，表现为第二次点「选择文件夹」完全没反应。
    // picked 里已持有 File 引用，清空不影响已选内容。
    const input = isFolder ? $('pl-up-file-folder') : $('pl-up-file-zip');
    if (input) input.value = '';
  }

  /**
   * 「还在进行」的视觉语言（动态注入一次，不改 admin.html）：
   *   1) 进度条**永不显示满格绿色**——绿色满格 = "完成了"的视觉信号；
   *      上传中封顶 99%，处理中停在 99% 并叠加**流动条纹**（还在动 = 还在跑）。
   *   2) pl-track 外圈呼吸光晕（3s 周期），远看也知道进程活着。
   *   3) 三段步骤条：当前步高亮 + 脉冲，结束后打勾。
   */
  let styleInjected = false;
  function injectIndefStyle() {
    if (styleInjected || document.getElementById('pl-indef-style')) { styleInjected = true; return; }
    const st = document.createElement('style');
    st.id = 'pl-indef-style';
    st.textContent = `
      @keyframes plIndefSlide{0%{background-position:0 0}100%{background-position:32px 0}}
      @keyframes plPulse{0%,100%{box-shadow:0 0 0 0 rgba(56,189,248,.45)}50%{box-shadow:0 0 0 7px rgba(56,189,248,0)}}
      @keyframes plDotPulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.18)}}
      .pl-track{position:relative;height:10px;background:rgba(255,255,255,.08);border-radius:6px;overflow:hidden}
      .pl-track.pl-live{animation:plPulse 1.6s ease-in-out infinite}
      .pl-fill-live{background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.30) 0 8px,rgba(255,255,255,0) 8px 16px);
        background-size:32px 100%;animation:plIndefSlide .6s linear infinite}
      .pl-steps{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;color:var(--text-secondary)}
      .pl-steps span[data-pl-step]{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;
        border:1px solid rgba(255,255,255,.10);transition:all .2s}
      .pl-steps span[data-pl-step] i{font-style:normal;width:15px;height:15px;border-radius:50%;
        background:rgba(255,255,255,.14);color:#cbd5e1;font-size:10px;display:inline-flex;align-items:center;justify-content:center}
      .pl-steps .pl-sep{opacity:.35}
      .pl-steps span.on{border-color:#38bdf8;color:#bae6fd;background:rgba(56,189,248,.12)}
      .pl-steps span.on i{background:#38bdf8;color:#04283d;animation:plDotPulse 1.2s ease-in-out infinite}
      .pl-steps span.ok{border-color:#22c55e;color:#bbf7d0;background:rgba(34,197,94,.10)}
      .pl-steps span.ok i{background:#22c55e;color:#052e16}
      .pl-steps span.ok i::after{content:'✓'}
      .pl-steps span.err{border-color:#ef4444;color:#fecaca;background:rgba(239,68,68,.10)}
      .pl-steps span.err i{background:#ef4444;color:#2b0707}
      /* ── 表单修正（必须放在最后，优先级高于 admin.html 的 .form-group input{width:100%}）──
         admin.html:122 把 .form-group 下的**所有** input 都设成 width:100%，
         checkbox 也中招 → 勾选框独占整行、文字被挤到右侧换行（扫描弹窗长文案时尤其明显）。 */
      .form-group input[type="checkbox"]{width:auto!important;min-width:0;padding:0!important;
        margin:0;flex:0 0 auto;vertical-align:-1px;background:transparent}
      .form-group label.chk{display:flex!important;gap:6px!important;align-items:flex-start!important;
        font-size:13px!important;font-weight:400!important;color:var(--text-secondary)!important;
        margin-bottom:2px!important;line-height:1.6}
      .form-group label.chk > span{flex:1;min-width:0;word-break:break-word}`;
    document.head.appendChild(st);
    styleInjected = true;
  }

  /** 步骤条：n = 1|2|3|'err' */
  function setSteps(n) {
    const box = PL().kit.$('pl-up-steps');
    if (!box) return;
    box.querySelectorAll('span[data-pl-step]').forEach((el) => {
      const k = Number(el.getAttribute('data-pl-step'));
      el.className = '';
      if (n === 'err') { if (k > 3) el.className = 'err'; else el.className = 'ok'; return; }
      if (k < n) el.className = 'ok';
      else if (k === n) el.className = 'on';
    });
  }

  /** 扫描通道步骤条（data-pl-sstep，与上传通道独立） */
  function setScanSteps(n) {
    const P = PL(); if (!P) return;
    const box = P.kit.$('pl-scan-steps');
    if (!box) return;
    box.querySelectorAll('span[data-pl-sstep]').forEach((el) => {
      const k = Number(el.getAttribute('data-pl-sstep'));
      el.className = '';
      if (n === 'err') { if (k > 3) el.className = 'err'; else el.className = 'ok'; return; }
      if (k < n) el.className = 'ok';
      else if (k === n) el.className = 'on';
    });
  }

  /** 导入进行中：锁死「取消 / ✕」——用户明确要求"上传中不要取消，请耐心等待" */
  function lockClose(lock, text, which) {
    const P = PL(); if (!P) return;
    const map = which === 'scan'
      ? [['pl-scan-cancel', 'pl-scan-modal', text], ['pl-scan-modal-x', 'pl-scan-modal', '✕']]
      : [['pl-up-cancel', 'pl-upload-modal', text], ['pl-upload-modal-x', 'pl-upload-modal', '✕']];
    for (const [id, modal, label] of map) {
      const b = P.kit.$(id); if (!b) continue;
      if (lock) {
        b.removeAttribute('data-pl-close'); b.disabled = true; b.textContent = label;
        b.style.opacity = '.55'; b.style.cursor = 'not-allowed';
      } else {
        b.setAttribute('data-pl-close', modal); b.disabled = false;
        b.style.opacity = ''; b.style.cursor = '';
        b.textContent = id.indexOf('cancel') > 0 ? '取消' : '✕';
      }
    }
  }

  function doUpload() {
    const P = PL(); if (!P || !picked) return;
    const kit = P.kit, $ = kit.$;
    injectIndefStyle();
    const go = $('pl-up-go'), bar = $('pl-up-fill'), textEl = $('pl-up-text');
    const track = $('pl-up-track');
    const title0 = document.title;
    if (go) { go.disabled = true; go.textContent = '⏳ 导入中…'; }
    $('pl-up-progress').style.display = 'block';
    $('pl-up-result').style.display = 'none';
    bar.className = '';
    bar.style.width = '0%';
    if (track) track.classList.add('pl-live');
    setSteps(1);
    lockClose(true, '⏳ 请耐心等待');
    // 标签页标题同步 —— 用户切去干别的，切回来一眼就知道任务还在跑
    document.title = '⏳ 零件库导入中…请勿关闭 | ' + title0;
    // 起始态：点下按钮立刻有反馈。即便 onprogress 迟迟不来（弱网/代理缓冲/大包首字节慢），
    // 也不会出现"点了没反应"的空白感。宽度 0% → 99% → （处理中条纹）→ 完成后才 100%。
    textEl.innerHTML = '<b>⏳ ① 上传中 0%</b><span style="opacity:.75">　正在发送，请耐心等待，<b>不要点「取消」</b>…</span>';

    const totalBytes = picked.files.reduce((s, f) => s + f.size, 0);
    const opts = [];
    if ($('pl-up-variants').checked) opts.push('LOD 变体');
    if ($('pl-up-compress').checked) opts.push('贴图压缩');

    const fd = new FormData();
    if (picked.mode === 'folder') {
      for (const f of picked.files) fd.append('files', f, f.name);
      fd.append('relPaths', JSON.stringify(picked.relPaths));
    } else {
      fd.append('file', picked.files[0], picked.files[0].name);
    }
    fd.append('target', 'part');
    fd.append('sourceRef', picked.sourceRef);
    fd.append('libraryName', picked.sourceRef);
    fd.append('variants', $('pl-up-variants').checked ? 'true' : 'false');
    fd.append('compressTextures', $('pl-up-compress').checked ? 'true' : 'false');

    // 阶段2 计时器：每秒刷新"已等待 Ns"，并在大包超时前给出可操作指引
    let waitTimer = null, phase = 'upload';
    const stopWait = () => { if (waitTimer) { clearInterval(waitTimer); waitTimer = null; } };
    const enterProcessing = () => {
      if (phase !== 'upload') return;
      phase = 'processing';
      setSteps(2);
      // 关键：**停在 99% + 流动条纹**。满格 = 看起来像"已完成"，条纹 + 呼吸 = "还在跑"
      bar.style.width = '99%';
      bar.className = 'pl-fill-live';
      document.title = '⏳ 服务器建库中…已处理中，请勿关闭 | ' + title0;
      const t0 = Date.now();
      const tick = () => {
        const s = Math.round((Date.now() - t0) / 1000);
        const slow = s >= 180;
        textEl.innerHTML = `<b>⏳ ② 服务器处理中…已等待 ${s}s（仍在进行，请耐心等待）</b><br>`
          + `<span style="opacity:.85">文件已全部收到，服务器正在：解压 → 落盘 → 建库 → 零件归类 → 生成统计`
          + `${opts.length ? '（本包已勾选：' + opts.join(' / ') + '，耗时更长）' : ''}。共 ${picked.files.length} 个文件 / ${kit.fmtSize(totalBytes)}。</span><br>`
          + `<span style="color:#fcd34d">⚠️ 现在点「取消」或关页可能留下半成品库，请耐心等待它自己跑完。</span>`
          + (slow ? '<br><span style="color:#fcd34d">已超过 3 分钟：大素材包 + LOD / 贴图压缩需 5 分钟以上，仍属正常。</span>' : '');
      };
      tick();
      if (!waitTimer) waitTimer = setInterval(tick, 1000);
    };
    const endProcessing = () => {
      phase = 'done';
      stopWait();
      bar.className = '';
      if (track) track.classList.remove('pl-live');
      document.title = title0;
    };

    const xhr = new XMLHttpRequest();
    xhr.open('POST', picked.mode === 'folder' ? UPLOAD_API : ZIP_API);
    xhr.setRequestHeader('Authorization', 'Bearer ' + (localStorage.getItem('adminToken') || ''));
    // 不设客户端超时：服务器处理可能好几分钟，交给服务器与网络决定
    xhr.timeout = 0;
    xhr.upload.onprogress = (e) => {
      if (phase !== 'upload') return;
      if (!e.lengthComputable) { enterProcessing(); return; }
      const pct = Math.min(99, Math.round((e.loaded / e.total) * 100)); // 99 封顶：100% 留给「真完成」
      bar.style.width = pct + '%';
      textEl.innerHTML = `<b>⏳ ① 上传中 ${pct}%</b>（${kit.fmtSize(e.loaded)} / ${kit.fmtSize(e.total)}）`
        + '<span style="opacity:.75">　正在发送，请耐心等待，<b>不要点「取消」</b>；上传完服务器还要解压、建库与零件归类…</span>';
      if (e.loaded >= e.total) enterProcessing();
    };
    // 阶段切换的三重兜底：小文件 / localhost 下 upload 事件可能一次都不触发
    //   ① upload.onload   ② loaded>=total   ③ 兜底定时器（发送后 1.5s 仍在上传阶段就切换）
    xhr.upload.onload = enterProcessing;
    xhr.upload.onloadend = enterProcessing;
    setTimeout(() => { if (phase === 'upload') enterProcessing(); }, 1500);
    // 服务端开始回响应（HEADERS_RECEIVED）= 处理已收尾
    xhr.onreadystatechange = () => { if (xhr.readyState === 2) endProcessing(); };
    const fail = (msg) => {
      endProcessing();
      setSteps('err');
      lockClose(false);
      if (go) { go.disabled = false; go.textContent = '开始导入'; }
      bar.style.width = '0%';
      textEl.innerHTML = `<span style="color:#fca5a5"><b>${msg}</b><br>`
        + '服务器可能仍在后台处理：若几分钟后列表里没出现新库，请到「零件库」页刷新确认，避免重复导入。</span>';
      tip('pl-up-tip', '连接中断。服务器可能仍在处理中，请到<b>零件库列表页</b>刷新确认结果，避免重复导入。', 'error');
    };
    xhr.onload = () => {
      endProcessing();
      lockClose(false);
      if (go) { go.disabled = false; go.textContent = '开始导入'; }
      let j = null; try { j = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && j && j.success) {
        setSteps(3);
        bar.style.width = '100%';
        bar.style.background = '#22c55e';   // 只有真完成才是满格绿色
        if ($('pl-up-cancel')) $('pl-up-cancel').textContent = '关闭';
        textEl.innerHTML = `<b>✅ ③ 导入完成</b>：${kit.esc(j.message || '已入库')}`;
        renderImportResult(j);
        kit.say(`导入完成：${j.modelCount || 0} 个零件，库「${(j.library && j.library.displayName) || picked.sourceRef}」`, 'ok');
        P.loadLibraries();
      } else {
        endProcessing();
        setSteps('err');
        textEl.innerHTML = `<span style="color:#fca5a5"><b>导入失败（HTTP ${xhr.status}）</b><br>`
          + `${kit.esc((j && (j.error || j.details)) || String(xhr.responseText || '').slice(0, 200))}</span>`;
        tip('pl-up-tip', '导入失败（HTTP ' + xhr.status + '）。若刚才是<b>处理阶段中断</b>，'
          + '服务器可能仍在后台处理：若几分钟后列表里没出现新库，请到<b>零件库页</b>刷新确认，避免重复导入。', 'error');
      }
    };
    xhr.onerror = () => fail('连接中断（网络错误）');
    xhr.ontimeout = () => fail('连接超时');
    xhr.onabort = () => fail('已取消上传');
    xhr.send(fd);
  }

  function renderImportResult(j) {
    const P = PL(); if (!P) return;
    const kit = P.kit, lib = j.library || {};
    const roleLine = Object.entries(lib.roleCount || {}).map(([k, v]) => `${kit.ROLE_CN[k] || k} ${v}`).join('、');
    const warns = (lib.warnings || []).slice(0, 8);
    const box = kit.$('pl-up-result');
    box.style.display = 'block';
    box.innerHTML = `<div class="upf-item" style="font-weight:600">
        入库 ${kit.fmtNum(j.modelCount || 0)} 个零件 → 库「${kit.esc(lib.displayName || '')}」（${lib.created ? '新建' : '复用已有库'}，id=${lib.libraryId || '?'}）</div>
      ${roleLine ? `<div class="upf-item"><span class="upf-sub">角色分布：${kit.esc(roleLine)}</span></div>` : ''}
      ${lib.stats ? `<div class="upf-item"><span class="upf-sub">统计：${kit.fmtNum(lib.stats.partCount)} 个 / ${kit.fmtNum(lib.stats.totalTris)} 面${lib.stats.bytes ? ' / ' + kit.fmtSize(lib.stats.bytes) : ''}</span></div>` : ''}
      ${warns.length ? `<div class="upf-item"><span class="upf-sub">⚠️ ${kit.esc(warns.join('；'))}</span></div>` : ''}`;
  }

  // ───────────────────── 扫描服务器目录 ─────────────────────
  let scanState = null; // { sourceDir, mode, packs:[dirName] }
  // 扫描通道的入库目标：'part'=建零件库（零件库页）| 'model'=进 3D 资产库（3D资产页）
  // 两条通道共用同一后端端点，唯一差异就是这个 target（与后端两通道对称设计一致）。
  let scanTarget = 'part';

  async function doScanPreview() {
    const P = PL(); if (!P) return;
    const kit = P.kit, $ = kit.$;
    const dir = ($('pl-scan-dir').value || '').trim();
    if (!dir) {
      kit.say('请填写服务器上的绝对路径', 'error');
      tip('pl-scan-tip', '请填写<b>服务器上</b>的绝对路径（不是你本机磁盘）。', 'error');
      return;
    }
    tip('pl-scan-tip', '');
    const box = $('pl-scan-result');
    box.style.display = 'block';
    box.innerHTML = '<div class="loading">预检中…</div>';
    injectIndefStyle();
    $('pl-scan-progress').style.display = 'block';
    setScanSteps(1);
    const pvBar = $('pl-scan-fill'), pvTrack = $('pl-scan-track'), pvText = $('pl-scan-text');
    pvBar.className = ''; pvBar.style.width = '35%'; pvBar.style.background = '#38bdf8';
    if (pvTrack) pvTrack.classList.add('pl-live');
    pvText.innerHTML = '<b>⏳ ① 正在读取目录并预检…</b><span style="opacity:.75">　大素材树可能要几十秒，请耐心等待</span>';
    try {
      const j = await kit.apiPost(SCAN_API + '/scan/preview', { sourceDir: dir, target: scanTarget, splitSubdirs: $('pl-scan-split') ? $('pl-scan-split').checked : false });
      const multi = j.mode === 'multi-pack';
      const packs = multi ? j.packs : [j.pack || {}];
      scanState = { sourceDir: dir, mode: j.mode };
      box.innerHTML = `<div class="upf-item" style="font-weight:600">
          ${multi
            ? `识别到 ${packs.length} 个资源包 · 合计 ${kit.fmtNum(j.totalModel)} 模型 / ${kit.fmtNum(j.totalTris)} 面（可勾选要导入的包）`
            : '单包目录'}</div>` +
        packs.map((p) => `
          <div class="upf-item">
            <span class="upf-name">${multi
              ? `<input type="checkbox" data-pl-pack="${kit.esc(p.dirName)}" checked style="vertical-align:-1px"> ` : ''}${kit.esc(p.dirName)}</span>
            <span class="upf-status">${p.modelCount} 模型 · ${kit.fmtNum(p.totalTris)} 面 · ${p.textureCount} 贴图 · ${kit.fmtSize(p.bytes)}${p.overFileLimit ? ' ⚠️文件超限' : ''}${p.overSizeLimit ? ' ⚠️体积超限' : ''}</span>
          </div>` +
          (p.samples || []).slice(0, 4).map((s) => `<div class="upf-item"><span class="upf-sub">　${kit.esc(s.partKey)} · ${kit.esc(kit.ROLE_CN[s.role] || s.role)} · ${s.tris ? kit.fmtNum(s.tris) + ' 面' : '无法解析'}</span></div>`).join('')
        ).join('');
      $('pl-scan-go').disabled = false;
      // 预检完成 = 第 1 步完成，进度条停在中段（还没导入，别显示满格）
      pvBar.className = ''; pvBar.style.width = '35%';
      if (pvTrack) pvTrack.classList.remove('pl-live');
      setScanSteps(1.5);   // 1.5 = 「第 1 步已打勾、当前无人高亮」——预检完还没点开始，不能像在跑
      pvText.innerHTML = `<b>✅ ① 预检完成</b>：确认无误后点「开始导入」，服务器才会开始复制与归类`;
      kit.say('预检完成，确认后点「开始导入」', 'ok');
    } catch (e) {
      scanState = null;
      setScanSteps('err');
      pvBar.className = ''; pvBar.style.width = '0%';
      if (pvTrack) pvTrack.classList.remove('pl-live');
      pvText.innerHTML = `<span style="color:#fca5a5"><b>预检失败</b><br>${kit.esc(e.message)}</span>`;
      box.innerHTML = `<div class="upf-item"><span class="upf-sub">预检失败：${kit.esc(e.message)}</span></div>`;
      $('pl-scan-go').disabled = true;
    }
  }

  async function doScan() {
    const P = PL(); if (!P || !scanState) return;
    const kit = P.kit, $ = kit.$;
    const body = {
      sourceDir: scanState.sourceDir,
      target: scanTarget,
      variants: $('pl-scan-variants').checked,
      compressTextures: $('pl-scan-compress').checked,
      status: $('pl-scan-pending').checked ? 'pending_review' : 'active',
      splitSubdirs: $('pl-scan-split') ? $('pl-scan-split').checked : false,
    };
    // 只有多包模式才传 packs：单包时 packs 是「目录自身名」，传过去会被拼成
    // <sourceDir>/<目录名> 这个不存在的子路径 → 400「目录不存在或不可访问」。
    if (scanState.mode === 'multi-pack') {
      const chosen = Array.from(document.querySelectorAll('[data-pl-pack]'))
        .filter((c) => c.checked).map((c) => c.getAttribute('data-pl-pack'));
      if (!chosen.length) {
        kit.say('请至少勾选一个资源包', 'error');
        tip('pl-scan-tip', '请至少勾选一个资源包再点「开始导入」。', 'error');
        return;
      }
      body.packs = chosen;
    }
    const btn = $('pl-scan-go');
    injectIndefStyle();
    btn.disabled = true; btn.textContent = '⏳ 处理中…请勿重复点击';
    lockClose(true, '⏳ 请耐心等待', 'scan');   // 扫描更慢，同样禁止中途取消

    // 扫描通道与上传通道同等的"还在跑"视觉：步骤条 + 99% 流动条纹 + 呼吸轨道
    const sBar = $('pl-scan-fill'), sTrack = $('pl-scan-track'), sText = $('pl-scan-text');
    $('pl-scan-progress').style.display = 'block';
    sBar.className = ''; sBar.style.width = '0%';
    sTrack.classList.add('pl-live');
    setScanSteps(2);
    sBar.style.width = '99%';
    sBar.className = 'pl-fill-live';
    const scanT0 = Date.now();
    const scanOpts = [body.variants ? 'LOD 变体' : null, body.compressTextures ? '贴图压缩' : null].filter(Boolean);
    const renderScanTick = () => {
      const sec = Math.round((Date.now() - scanT0) / 1000);
      sText.innerHTML = `<b>⏳ 服务器处理中…已等待 ${sec}s（仍在进行，请耐心等待）</b><br>`
        + `<span style="opacity:.85">服务器正在：复制文件到仓库目录 → 解析模型 → 建库 → 零件归类 → 生成统计`
        + `${scanOpts.length ? '（本包已勾选：' + scanOpts.join(' / ') + '，耗时更长）' : ''}。来源：${kit.esc(scanState.sourceDir)}</span><br>`
        + `<span style="color:#fcd34d">⚠️ 现在点「取消」或关页可能留下半成品库，请耐心等待它自己跑完。</span>`
        + (sec >= 180 ? '<br><span style="color:#fcd34d">已超过 3 分钟：大素材树 + LOD / 贴图压缩需 5 分钟以上，仍属正常。</span>' : '');
    };
    renderScanTick();   // ★立即渲染一次：否则点「开始导入」后有 1 秒文案还停在"预检完成"
    const scanTimer = setInterval(renderScanTick, 1000);
    const scanEnd = (okFlag) => {
      clearInterval(scanTimer);
      sBar.className = '';
      sTrack.classList.remove('pl-live');
      sBar.style.width = okFlag ? '100%' : '0%';
      if (okFlag) sBar.style.background = '#22c55e';   // 只有真完成才是满格绿
      setScanSteps(okFlag ? 4 : 'err');   // 4 = 三步全部打勾（3 会让最后一步停在"高亮"）
    };
    let scanOk = false;
    try {
      const j = await kit.apiPost(SCAN_API + '/scan', body);
      const ok = (j.packs || []).filter((p) => !p.skipped);
      const skip = (j.packs || []).filter((p) => p.skipped);
      scanOk = true;
      scanEnd(true);
      const secs = Math.round((Date.now() - scanT0) / 1000);
      sText.innerHTML = `<b>✅ ③ 导入完成</b>：${j.imported} 个包入库${j.skipped ? `，跳过 ${j.skipped} 个` : ''}（耗时 ${secs}s）`;
      $('pl-scan-result').innerHTML = `<div class="upf-item" style="font-weight:600">导入 ${j.imported} 个包，跳过 ${j.skipped} 个</div>`
        + ok.map((p) => `<div class="upf-item"><span class="upf-name">✅ ${kit.esc(p.dirName)}</span>
            <span class="upf-status">${p.modelCount} 零件${p.library ? ' → 库「' + kit.esc(p.finalName || p.library.displayName) + '」' : ''}${(p.warnings || []).length ? ' ⚠️' + p.warnings.length + ' 条告警' : ''}</span></div>`).join('')
        + (ok.some((p) => p.renamed)
          ? `<div class="upf-item"><span class="upf-sub">ℹ️ 有包因<b>同名</b>已自动错开为「原名_2 / _3」——`
            + `因为不同素材包的模型目录都叫 glTF 这类名字，撞名会混库。旧库保持原样未受影响。</span></div>`
          : '')
        + skip.map((p) => `<div class="upf-item"><span class="upf-sub">⏭ ${kit.esc(p.dirName)}：${kit.esc(p.skipped)}</span></div>`).join('');
      tip('pl-scan-tip', '');   // 成功必须清掉"处理中"提示（旧版遗留 bug：成功后还停在计时文案）
      kit.say(`扫描导入完成：${j.imported} 个包入库`, 'ok');
      P.loadLibraries();
    } catch (e) {
      scanEnd(false);
      sText.innerHTML = `<span style="color:#fca5a5"><b>扫描导入失败</b><br>${kit.esc(e.message)}</span>`;
      kit.say('扫描导入失败：' + e.message, 'error');
      tip('pl-scan-tip', '扫描导入失败：' + P.kit.esc(e.message)
        + '<br>服务器可能仍在处理中，请到<b>零件库列表页</b>刷新确认，避免重复导入。', 'error');
    } finally {
      clearInterval(scanTimer);
      lockClose(false, '', 'scan');
      // 成功后取消按钮变「关闭」——必须放在 lockClose 之后（它会把文字重置回「取消」）
      if ($('pl-scan-cancel')) $('pl-scan-cancel').textContent = scanOk ? '关闭' : '取消';
      btn.disabled = false; btn.textContent = '开始导入';
    }
  }

  // ───────────────────── 入口 ─────────────────────
  function openUpload() {
    const P = PL(); if (!P) return;
    const $ = P.kit.$;
    ensureModals();
    picked = null;
    $('pl-up-preview').style.display = 'none';
    $('pl-up-progress').style.display = 'none';
    $('pl-up-result').style.display = 'none';
    tip('pl-up-tip', '');
    $('pl-up-go').disabled = true;
    $('pl-up-go').textContent = '开始导入';
    $('pl-up-source').textContent = '';
    $('pl-up-file-folder').value = '';
    $('pl-up-file-zip').value = '';
    // 复位上一次导入留下的视觉/交互状态
    injectIndefStyle();
    const bar = $('pl-up-fill'), track = $('pl-up-track');
    if (bar) { bar.className = ''; bar.style.width = '0%'; bar.style.background = '#38bdf8'; }
    if (track) track.classList.remove('pl-live');
    setSteps(0);
    lockClose(false);
    if ($('pl-up-cancel')) $('pl-up-cancel').textContent = '取消';
    P.kit.showModal('pl-upload-modal');
  }

  function openScan(target) {
    const P = PL(); if (!P) return;
    const $ = P.kit.$;
    ensureModals();
    scanTarget = target === 'model' ? 'model' : 'part';
    const title = $('pl-scan-modal').querySelector('.modal-header h2');
    if (title) title.textContent = scanTarget === 'model'
      ? '📂 扫描服务器本地目录 → 3D 资产库'
      : '📂 扫描服务器本地目录 → 零件库';
    scanState = null;
    $('pl-scan-result').style.display = 'none';
    $('pl-scan-progress').style.display = 'none';
    tip('pl-scan-tip', '');
    injectIndefStyle();
    const sb = $('pl-scan-fill'), st = $('pl-scan-track'), stx = $('pl-scan-text');
    if (sb) { sb.className = ''; sb.style.width = '0%'; sb.style.background = '#38bdf8'; }
    if (st) st.classList.remove('pl-live');
    if (stx) stx.textContent = '';
    setScanSteps(0);
    lockClose(false, '', 'scan');
    if ($('pl-scan-cancel')) $('pl-scan-cancel').textContent = '取消';
    $('pl-scan-go').disabled = true;
    $('pl-scan-go').textContent = '开始导入';
    P.kit.showModal('pl-scan-modal');
  }

  function attach() {
    if (window.PartLibrary && window.PartLibrary.attachImport) {
      window.PartLibrary.attachImport({ upload: openUpload, scan: openScan });
    } else {
      setTimeout(attach, 300);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();

  window.PartLibraryImport = { openUpload, openScan, onPicked, doUpload, doScanPreview, doScan };

  /**
   * 「3D资产」页的对称入口：在上传模型那一排注入「📂 扫描目录」按钮（target='model'）。
   * 四个入口至此完全对称：零件库页 = 上传文件夹/扫描(→零件库)，3D资产页 = 上传/文件夹导入/扫描(→资产库)。
   * 自注入，不改 admin.html 的既有结构。
   */
  function injectModelScanButton() {
    const group = document.querySelector('#assets-sub-uploaded .card-header .btn-group');
    if (!group || document.getElementById('amb-scan-btn')) return !!document.getElementById('amb-scan-btn');
    const btn = document.createElement('button');
    btn.id = 'amb-scan-btn';
    btn.className = 'btn btn-sm btn-blue';
    btn.textContent = '📂 扫描目录';
    btn.title = '扫描服务器本地目录并导入到 3D 资产库（不进零件库）';
    btn.onclick = () => openScan('model');
    group.insertBefore(btn, group.firstChild);
    return true;
  }

  let injectTries = 0;
  const injectTimer = setInterval(() => {
    if (injectModelScanButton() || ++injectTries > 20) clearInterval(injectTimer);
  }, 600);
})();
