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
        <div class="modal-header"><h2>${title}</h2><button class="close-btn" data-pl-close="${id}">✕</button></div>
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
        <label style="display:flex;gap:6px;align-items:center;font-size:13px">
          <input type="checkbox" id="pl-up-variants"> 生成 LOD 变体（零件多为低模，通常不需要）</label>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-top:4px">
          <input type="checkbox" id="pl-up-compress"> 压缩外置贴图（共享图集量化易出色带，默认不勾）</label>
      </div>
      <div id="pl-up-preview" class="upf-list" style="display:none"></div>
      <div id="pl-up-progress" style="display:none;margin-top:12px">
        <div style="height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden">
          <div id="pl-up-fill" style="height:100%;width:0%;background:#22c55e;transition:width .2s"></div>
        </div>
        <div id="pl-up-text" style="margin-top:4px;font-size:12px;color:var(--text-secondary)"></div>
      </div>
      <div id="pl-up-result" style="display:none;margin-top:10px"></div>`,
      `<button class="btn" data-pl-close="pl-upload-modal">取消</button>
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
        <label style="display:flex;gap:6px;align-items:center;font-size:13px">
          <input type="checkbox" id="pl-scan-variants"> 生成 LOD 变体</label>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-top:4px">
          <input type="checkbox" id="pl-scan-compress"> 压缩外置贴图（默认不勾）</label>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-top:4px">
          <input type="checkbox" id="pl-scan-pending"> 导入后置为「待审核」</label>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-top:4px">
          <input type="checkbox" id="pl-scan-split"> 把每个子目录当作独立资源包
          <span style="color:var(--text-secondary)">（素材库根目录场景：H:\\kenney 这类，每个 kit 目录各成一个包）</span></label>
      </div>
      <div id="pl-scan-result" style="display:none"></div>`,
      `<button class="btn" data-pl-close="pl-scan-modal">取消</button>
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

  // ───────────────────── 上传（文件夹 / zip） ─────────────────────
  let picked = null; // { mode, files, relPaths, sourceRef }

  function onPicked(fileList, isFolder) {
    const P = PL(); if (!P) return;
    const kit = P.kit, $ = kit.$;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const relPaths = files.map((f) => (isFolder ? (f.webkitRelativePath || f.name) : f.name));
    const total = files.reduce((s, f) => s + f.size, 0);
    if (files.length > MAX_FILES) { kit.say(`所选 ${files.length} 个文件，超过 ${MAX_FILES} 上限`, 'error'); return; }
    if (total > MAX_TOTAL_BYTES) { kit.say(`整包 ${kit.fmtSize(total)}，超过 500MB 上限`, 'error'); return; }

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
    if (primaries === 0) kit.say('没找到 .gltf/.glb/.obj 主文件，无法导入', 'error');
  }

  function doUpload() {
    const P = PL(); if (!P || !picked) return;
    const kit = P.kit, $ = kit.$;
    const go = $('pl-up-go'); if (go) go.disabled = true;
    $('pl-up-progress').style.display = 'block';
    $('pl-up-result').style.display = 'none';

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

    const xhr = new XMLHttpRequest();
    xhr.open('POST', picked.mode === 'folder' ? UPLOAD_API : ZIP_API);
    xhr.setRequestHeader('Authorization', 'Bearer ' + (localStorage.getItem('adminToken') || ''));
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      $('pl-up-fill').style.width = pct + '%';
      $('pl-up-text').textContent = `上传中 ${pct}%（随后服务器自动建库并归类零件）…`;
    };
    xhr.onload = () => {
      if (go) go.disabled = false;
      let j = null; try { j = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && j && j.success) {
        $('pl-up-fill').style.width = '100%';
        $('pl-up-text').textContent = j.message || '导入完成';
        renderImportResult(j);
        kit.say(`导入完成：${j.modelCount || 0} 个零件，库「${(j.library && j.library.displayName) || picked.sourceRef}」`, 'ok');
        P.loadLibraries();
      } else {
        $('pl-up-text').textContent =
          `导入失败（HTTP ${xhr.status}）：${(j && (j.error || j.details)) || String(xhr.responseText || '').slice(0, 140)}`;
      }
    };
    xhr.onerror = () => { if (go) go.disabled = false; $('pl-up-text').textContent = '网络错误，导入失败'; };
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
    if (!dir) { kit.say('请填写服务器上的绝对路径', 'error'); return; }
    const box = $('pl-scan-result');
    box.style.display = 'block';
    box.innerHTML = '<div class="loading">预检中…</div>';
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
      kit.say('预检完成，确认后点「开始导入」', 'ok');
    } catch (e) {
      scanState = null;
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
      if (!chosen.length) { kit.say('请至少勾选一个资源包', 'error'); return; }
      body.packs = chosen;
    }
    const btn = $('pl-scan-go');
    btn.disabled = true; btn.textContent = '导入中…（复制 + 归类，请勿关页）';
    try {
      const j = await kit.apiPost(SCAN_API + '/scan', body);
      const ok = (j.packs || []).filter((p) => !p.skipped);
      const skip = (j.packs || []).filter((p) => p.skipped);
      $('pl-scan-result').innerHTML = `<div class="upf-item" style="font-weight:600">导入 ${j.imported} 个包，跳过 ${j.skipped} 个</div>`
        + ok.map((p) => `<div class="upf-item"><span class="upf-name">✅ ${kit.esc(p.dirName)}</span>
            <span class="upf-status">${p.modelCount} 零件${p.library ? ' → 库「' + kit.esc(p.library.displayName) + '」' : ''}${(p.warnings || []).length ? ' ⚠️' + p.warnings.length + ' 条告警' : ''}</span></div>`).join('')
        + skip.map((p) => `<div class="upf-item"><span class="upf-sub">⏭ ${kit.esc(p.dirName)}：${kit.esc(p.skipped)}</span></div>`).join('');
      kit.say(`扫描导入完成：${j.imported} 个包入库`, 'ok');
      P.loadLibraries();
    } catch (e) {
      kit.say('扫描导入失败：' + e.message, 'error');
    } finally {
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
    $('pl-up-go').disabled = true;
    $('pl-up-source').textContent = '';
    $('pl-up-file-folder').value = '';
    $('pl-up-file-zip').value = '';
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
    $('pl-scan-go').disabled = true;
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
