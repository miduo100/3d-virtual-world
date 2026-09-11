/**
 * adminModelLod.js — 管理后台「🗿 本世界模型设置」卡片逻辑（模型 LOD 三版方案 · 阶段 3）
 *
 * 为什么独立成文件：admin.html 已超 1 万行属黑名单文件，禁止追加新功能代码（项目红线），
 * 故卡片逻辑放独立模块，页面只保留卡片标记与一个入口调用。
 *
 * 依赖页面元素：lod-enabled-checkbox / lod-status-line / lod-save-msg /
 *              lod-progress / lod-generate-btn
 * 暴露全局：loadLodStatus / refreshLodStatus / saveLodEnabled / runLodGenerate
 */
(function () {
  'use strict';

  const API = '/api/admin/model-lod';
  const WS_API = '/api/config/world-settings';
  const BATCH_LIMIT = 3;    // 每批 3 个
  const MAX_ROUNDS = 1000;  // 死循环保护（正常远小于此值）

  let running = false;

  const $ = (id) => document.getElementById(id);
  const token = () => localStorage.getItem('adminToken') || '';

  async function jreq(method, url, body) {
    const opts = { method, headers: { 'Authorization': 'Bearer ' + token() } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    let j = null;
    try { j = await r.json(); } catch (e) { /* 非 JSON 响应 */ }
    if (!r.ok) throw new Error((j && (j.error || j.details)) || ('HTTP ' + r.status));
    return j || {};
  }

  function showMsg(text, ok) {
    const el = $('lod-save-msg');
    if (!el) return;
    el.style.display = 'block';
    el.style.background = ok ? 'rgba(0,255,0,0.08)' : 'rgba(255,68,68,0.12)';
    el.style.color = ok ? 'var(--green)' : 'var(--red)';
    el.style.border = ok ? '1px solid rgba(0,255,0,0.2)' : '1px solid rgba(255,68,68,0.3)';
    el.textContent = text;
    if (ok) setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  function setProgress(text) {
    const el = $('lod-progress');
    if (!el) return;
    if (!text) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.textContent = text;
  }

  function renderStatus(s) {
    const el = $('lod-status-line');
    const cb = $('lod-enabled-checkbox');
    if (cb && s) cb.checked = !!s.enabled;
    if (!el) return;
    if (!s) { el.textContent = '📊 状态读取失败'; return; }
    let line = `📊 模型总数 ${s.total} — 已有中模 ${s.midCount}、低模 ${s.lowCount}，待生成 ${s.pending}`;
    if (s.lowPolySkipped) line += `（另有 ${s.lowPolySkipped} 个低面数模型无需生成）`;
    el.textContent = line;
  }

  async function loadLodStatus(silent) {
    try {
      const s = await jreq('GET', API + '/status');
      renderStatus(s);
      if (!silent) showMsg('✅ 状态已刷新', true);
      return s;
    } catch (e) {
      renderStatus(null);
      if (!silent) showMsg('❌ 读取状态失败：' + e.message, false);
      return null;
    }
  }

  async function saveLodEnabled() {
    const cb = $('lod-enabled-checkbox');
    if (!cb) return;
    const enabled = !!cb.checked;
    showMsg('保存中...', true);
    try {
      // 只改开关：先取当前世界设置再整体 PUT，避免覆盖名称/URL/描述
      const cur = await jreq('GET', WS_API);
      if (!cur.world_name || !cur.world_url) {
        showMsg('❌ 请先在「🌐 世界基础设置」中填写世界名称与世界URL', false);
        return;
      }
      const r = await jreq('PUT', WS_API, {
        world_name: cur.world_name,
        world_url: cur.world_url,
        world_description: cur.world_description || '',
        lod_enabled: enabled,
      });
      if (r && r.success) {
        showMsg(enabled ? '✅ 已开启模型 LOD 分级渲染' : '✅ 已关闭模型 LOD（全部按高模渲染）', true);
      } else {
        showMsg('❌ ' + ((r && (r.error || r.details)) || '保存失败'), false);
      }
    } catch (e) {
      showMsg('❌ 保存失败：' + e.message, false);
    }
  }

  async function runLodGenerate() {
    if (running) return;
    const btn = $('lod-generate-btn');
    if (!confirm('将为所有缺少中/低模的模型批量生成 LOD 变体（每批 3 个，可中断后再次点击续做）。是否继续？')) {
      return;
    }

    running = true;
    if (btn) btn.disabled = true;
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let stopNote = '';

    try {
      const s0 = await loadLodStatus(true);
      const pending = s0 ? s0.pending : 0;
      if (!pending) {
        setProgress('');
        showMsg('✅ 所有模型都已有中低模，无需生成', true);
        return;
      }
      setProgress(`正在生成 0/${pending}：准备中...`);

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const r = await jreq('POST', API + '/generate', { limit: BATCH_LIMIT });
        if (!r || !r.processed) break;
        processed += r.processed;
        succeeded += r.succeeded || 0;
        failed += r.failed || 0;
        const list = r.results || [];
        const last = list[list.length - 1] || {};
        setProgress(`正在生成 ${Math.min(processed, pending)}/${pending}：${last.name || ''}`);
        // 整批全失败说明当前模型无法生成，继续循环只会空转 —— 停下并提示
        if ((r.succeeded || 0) === 0) {
          stopNote = '本批全部失败，已停止';
          break;
        }
        if ((r.remaining || 0) <= 0 || processed >= pending) break;
      }

      const done = await jreq('GET', API + '/status').catch(() => null);
      if (done) renderStatus(done);
      setProgress(`✅ 完成：处理 ${processed} 个，成功 ${succeeded} 个，失败 ${failed} 个；剩余待生成 ${done ? done.pending : '未知'}${stopNote ? '（' + stopNote + '）' : ''}`);
      showMsg('✅ 批量生成结束', true);
    } catch (e) {
      setProgress(`❌ 中断：已处理 ${processed} 个后出错 — ${e.message}`);
      showMsg('❌ 批量生成失败：' + e.message, false);
    } finally {
      running = false;
      if (btn) btn.disabled = false;
    }
  }

  window.loadLodStatus = loadLodStatus;
  window.refreshLodStatus = function () { return loadLodStatus(false); };
  window.saveLodEnabled = saveLodEnabled;
  window.runLodGenerate = runLodGenerate;
})();
