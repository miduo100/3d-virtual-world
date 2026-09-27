/**
 * 📦 多文件资源包导入（glTF/OBJ bundle）—— admin.html 自注入模块
 *
 * 功能：在「3D资产 → 上传模型」旁注入「📁 文件夹导入」按钮 + 弹窗。
 * 支持两种方式：
 *   1. 文件夹导入（webkitdirectory，保留相对路径）；
 *   2. zip 压缩包（服务器解压）。
 * 上传端点：POST /api/upload-model-bundle（files[] + relPaths JSON）
 *           POST /api/upload-model-zip（file）
 * 零侵入：不修改 admin.html 任何既有函数，只追加 DOM 与独立逻辑。
 * 后端逻辑见 src/routes/modelBundleUpload.js（入库/变体/纹理压缩均由服务器完成）。
 */
(function () {
  'use strict';
  if (window.AdminModelBundle) return; // 幂等

  const BUNDLE_API = '/api/upload-model-bundle';
  const ZIP_API = '/api/upload-model-zip';
  const PRIMARY_EXTS = ['.gltf', '.obj', '.glb'];

  // ---------- 注入按钮 ----------
  function injectButton() {
    const group = document.querySelector('#assets-sub-uploaded .card-header .btn-group');
    if (!group || document.getElementById('amb-open-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'amb-open-btn';
    btn.className = 'btn btn-sm btn-purple';
    btn.textContent = '📁 文件夹导入';
    btn.onclick = open;
    group.insertBefore(btn, group.firstChild);
  }

  // ---------- 弹窗 DOM ----------
  function ensureModal() {
    if (document.getElementById('amb-modal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'amb-modal';
    wrap.className = 'modal';
    wrap.style.display = 'none';
    wrap.innerHTML = `
      <div class="modal-box" style="max-width:640px">
        <div class="modal-header">
          <h2>📁 文件夹导入（glTF / OBJ 多文件）</h2>
          <button class="close-btn" id="amb-close">✕</button>
        </div>
        <div class="form-group">
          <label>导入方式</label>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-sm btn-blue" id="amb-pick-folder">📂 选择文件夹</button>
            <button class="btn btn-sm" id="amb-pick-zip">🗜️ 选择 zip 包</button>
            <span id="amb-source" style="font-size:12px;color:#888"></span>
          </div>
          <input type="file" id="amb-file-folder" webkitdirectory multiple style="display:none">
          <input type="file" id="amb-file-zip" accept=".zip" style="display:none">
          <div style="margin-top:6px;font-size:12px;color:#888">
            glTF（.gltf+.bin+贴图）与 OBJ（.obj+.mtl+贴图）均为多文件格式，请整个文件夹或整包上传；
            共享贴图只存一份。glTF 自动生成中/低模变体并压缩贴图；OBJ 变体功能二期提供。
          </div>
        </div>
        <div id="amb-preview" class="upf-list" style="display:none"></div>
        <div id="amb-progress" style="display:none;margin-top:12px">
          <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden">
            <div id="amb-fill" style="height:100%;width:0%;background:#22c55e;transition:width .2s"></div>
          </div>
          <div id="amb-text" style="margin-top:4px;font-size:12px;color:var(--muted)"></div>
        </div>
        <div id="amb-result" style="display:none;margin-top:10px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-secondary" id="amb-cancel">取消</button>
          <button class="btn" id="amb-upload" disabled>上传</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    document.getElementById('amb-close').onclick = close;
    document.getElementById('amb-cancel').onclick = close;
    document.getElementById('amb-pick-folder').onclick = () => document.getElementById('amb-file-folder').click();
    document.getElementById('amb-pick-zip').onclick = () => document.getElementById('amb-file-zip').click();
    document.getElementById('amb-file-folder').addEventListener('change', (e) => onPicked(e.target.files, true));
    document.getElementById('amb-file-zip').addEventListener('change', (e) => onPicked(e.target.files, false));
    document.getElementById('amb-upload').onclick = doUpload;
  }

  // ---------- 状态 ----------
  let picked = null; // { mode:'folder'|'zip', files:[File], relPaths:[string] }

  function onPicked(fileList, isFolder) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const relPaths = files.map((f) => (isFolder ? (f.webkitRelativePath || f.name) : f.name));
    picked = { mode: isFolder ? 'folder' : 'zip', files, relPaths };
    renderPreview();
    document.getElementById('amb-upload').disabled = false;
  }

  function renderPreview() {
    const box = document.getElementById('amb-preview');
    box.style.display = 'block';
    if (picked.mode === 'zip') {
      const f = picked.files[0];
      box.innerHTML = `<div class="upf-item"><span class="upf-name">🗜️ ${esc(f.name)}</span>
        <span class="upf-status">${fmtSize(f.size)} · 服务器解压后自动识别模型</span></div>`;
      return;
    }
    const total = picked.files.reduce((s, f) => s + f.size, 0);
    const counts = {};
    let ignored = 0;
    for (const rp of picked.relPaths) {
      const ext = rp.slice(rp.lastIndexOf('.')).toLowerCase();
      if (PRIMARY_EXTS.includes(ext)) counts[ext] = (counts[ext] || 0) + 1;
      else if (['.bin', '.mtl', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) counts[ext] = (counts[ext] || 0) + 1;
      else ignored++;
    }
    const summary = Object.entries(counts).map(([e, n]) => `${e}×${n}`).join('，');
    const topFolders = new Set(picked.relPaths.map((r) => r.split('/')[0]));
    const rows = picked.files.slice(0, 12).map((f, i) => {
      const rp = picked.relPaths[i];
      const isPrimary = PRIMARY_EXTS.includes(rp.slice(rp.lastIndexOf('.')).toLowerCase());
      return `<div class="upf-item"><span class="upf-name">${isPrimary ? '🎯' : '&nbsp;&nbsp;'} ${esc(rp)}</span>
        <span class="upf-status">${fmtSize(f.size)}</span></div>`;
    }).join('');
    box.innerHTML = `
      <div class="upf-item" style="font-weight:600"><span>共 ${picked.files.length} 个文件 · ${fmtSize(total)} · 来源文件夹：${esc([...topFolders].join(', '))}</span></div>
      <div class="upf-item"><span class="upf-sub">构成：${summary}${ignored ? `；其他类型 ${ignored} 个（不上传）` : ''}</span></div>
      ${rows}
      ${picked.files.length > 12 ? `<div class="upf-item"><span class="upf-sub">… 其余 ${picked.files.length - 12} 个略</span></div>` : ''}`;
  }

  // ---------- 上传 ----------
  function doUpload() {
    if (!picked) return;
    const fill = document.getElementById('amb-fill');
    const text = document.getElementById('amb-text');
    document.getElementById('amb-progress').style.display = 'block';
    document.getElementById('amb-upload').disabled = true;
    document.getElementById('amb-result').style.display = 'none';

    const fd = new FormData();
    if (picked.mode === 'folder') {
      for (const f of picked.files) fd.append('files', f, f.name);
      fd.append('relPaths', JSON.stringify(picked.relPaths));
    } else {
      fd.append('file', picked.files[0], picked.files[0].name);
    }
    const url = picked.mode === 'folder' ? BUNDLE_API : ZIP_API;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      fill.style.width = pct + '%';
      text.textContent = `上传中 ${pct}%（服务器随后自动生成变体并压缩贴图…）`;
    };
    xhr.onload = () => {
      document.getElementById('amb-upload').disabled = false;
      let j = null;
      try { j = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && j && j.success) {
        fill.style.width = '100%';
        text.textContent = j.message || '导入完成';
        renderResult(j);
        if (typeof window.loadUploadedModels === 'function') { try { window.loadUploadedModels(); } catch { /* ignore */ } }
      } else {
        text.textContent = `上传失败（HTTP ${xhr.status}）：${(j && (j.error || j.details)) || xhr.responseText.slice(0, 120)}`;
      }
    };
    xhr.onerror = () => {
      document.getElementById('amb-upload').disabled = false;
      text.textContent = '网络错误，上传失败';
    };
    xhr.send(fd);
  }

  function renderResult(j) {
    const box = document.getElementById('amb-result');
    box.style.display = 'block';
    const rows = (j.models || []).map((m) => {
      const v = m.variants || {};
      let lod = '—';
      if (v.skipped) lod = `跳过（${reasonText(v.reason)}）`;
      else if (v.mid) {
        const midS = stText(v.mid.status) + (v.mid.tris ? ` ${v.mid.tris}面` : '');
        const lowS = v.low ? stText(v.low.status) + (v.low.tris ? ` ${v.low.tris}面` : '') : '—';
        lod = `中模 ${midS} / 低模 ${lowS}`;
      }
      const warn = (m.warnings && m.warnings.length) ? ` ⚠️ ${esc(m.warnings.join(';'))}` : '';
      return `<div class="upf-item"><span class="upf-name">✅ ${esc(m.name)}（${m.fileType}）</span>
        <span class="upf-status">${lod}${warn}</span></div>`;
    }).join('');
    const tc = j.textureCompression || {};
    const texLine = tc.processed !== undefined
      ? `纹理压缩：${tc.processed} 张，节省 ${fmtSize(tc.savedBytes || 0)}` + (tc.skippedCount ? `，跳过 ${tc.skippedCount}` : '')
      : (tc.error ? `纹理压缩失败：${esc(tc.error)}` : '');
    box.innerHTML = `
      <div class="upf-item" style="font-weight:600"><span>入库 ${j.modelCount} 个模型${texLine ? ' · ' + texLine : ''}</span></div>
      ${rows || '<div class="upf-item"><span class="upf-sub">没有识别到主模型文件（.gltf/.obj/.glb）</span></div>'}
      ${(j.skippedOther && j.skippedOther.length) ? `<div class="upf-item"><span class="upf-sub">已忽略不支持的文件：${esc(j.skippedOther.slice(0, 5).join(', '))}${j.skippedOther.length > 5 ? ' 等' : ''}</span></div>` : ''}`;
  }

  function stText(s) { return s === 'generated' ? '✅' : (s === 'exists' ? '已有' : '❌'); }
  function reasonText(r) {
    return { 'low-poly': '低多边形无需变体', 'obj-phase2': 'OBJ 变体二期提供', 'is-variant': '变体文件', 'format': '格式' }[r] || r;
  }
  function fmtSize(n) {
    if (!n && n !== 0) return '';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + 'KB';
    return n + 'B';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 开关 ----------
  function open() {
    ensureModal();
    picked = null;
    document.getElementById('amb-preview').style.display = 'none';
    document.getElementById('amb-progress').style.display = 'none';
    document.getElementById('amb-result').style.display = 'none';
    document.getElementById('amb-upload').disabled = true;
    document.getElementById('amb-source').textContent = '';
    document.getElementById('amb-file-folder').value = '';
    document.getElementById('amb-file-zip').value = '';
    document.getElementById('amb-modal').style.display = 'flex';
  }
  function close() { const m = document.getElementById('amb-modal'); if (m) m.style.display = 'none'; }

  // ---------- 启动 ----------
  function boot() {
    injectButton();
    // 3D资产页签是静态 DOM，正常注入一次即可；兜底再试几次防时序问题
    let tries = 0;
    const t = setInterval(() => {
      if (document.getElementById('amb-open-btn') || ++tries > 10) clearInterval(t);
      else injectButton();
    }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 供测试/调试
  window.AdminModelBundle = { open, close, upload: doUpload, onPicked };
})();
