/**
 * adminTerrainForm —— 地形「新建 / 编辑」弹窗（位置与范围 + 参数 + 俯视预览 + 预估）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * ★ 概念：「地形 = 地块」。一块地形 = 位置(中心 X/Z) + 面积(宽×深) + 基准高度 Y + 生成参数。
 *   后台「3D资产 → 🗺️ 地形」与 world_editor 的「🗺️ 地形设置」写的是同一份数据。
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const API = '/api/terrain';

  const FIELDS = [
    // 地形形状
    { g: 'shape', k: 'heightScale', label: '起伏高度 (m)', min: 0, max: 300, step: 1, hint: '0 = 纯平' },
    { g: 'shape', k: 'roughness', label: '起伏粗糙度', min: 0, max: 1, step: 0.05 },
    { g: 'shape', k: 'ridge', label: '山脊强度', min: 0, max: 1, step: 0.05 },
    { g: 'shape', k: 'flatRadius', label: '中心压平半径 (m)', min: 0, max: 500, step: 10, hint: '0 = 不压平' },
    // 生态
    { g: 'eco', k: 'waterLevel', label: '水面高度 (m)', min: -50, max: 50, step: 0.5 },
    { g: 'eco', k: 'snowLine', label: '雪线 (m)', min: 0, max: 400, step: 5 },
    { g: 'eco', k: 'treeLine', label: '树线 (m)', min: 0, max: 400, step: 5 },
    { g: 'eco', k: 'forestScale', label: '森林斑块尺度 (m)', min: 40, max: 800, step: 10 },
    { g: 'eco', k: 'forestCover', label: '森林覆盖率', min: 0, max: 1, step: 0.01 },
    { g: 'eco', k: 'slopeTreeMax', label: '长树最大坡度 (°)', min: 5, max: 80, step: 1 },
    { g: 'eco', k: 'slopeRockMin', label: '露岩最小坡度 (°)', min: 5, max: 89, step: 1 },
    { g: 'eco', k: 'grassDensity', label: '草密度 (株/m²)', min: 0, max: 3, step: 0.05 },
    // 性能
    { g: 'perf', k: 'chunkSize', label: '瓦片边长 (m)', enum: [[32, '32'], [48, '48'], [64, '64'], [96, '96'], [128, '128'], [192, '192'], [256, '256']] },
    { g: 'perf', k: 'viewDistance', label: '地形视距 (m)', min: 96, max: 1024, step: 8, hint: '越大看得越远，也越吃性能' },
    { g: 'perf', k: 'cullDistance', label: '渲染距离 (m)', min: 64, max: 4000, step: 16, hint: '离这块地形边缘超过它 → 整块不渲染（0 资源）' },
    { g: 'perf', k: 'grassRadius', label: '草生成半径 (m)', min: 0, max: 120, step: 4 },
    { g: 'perf', k: 'treeRadius', label: '树生成半径 (m)', min: 0, max: 600, step: 10 }
  ];

  const LOD_PRESETS = { low: [24, 12, 6, 4], mid: [48, 24, 12, 6], high: [64, 32, 16, 8] };
  const state = { opts: null, params: null, area: null, seed: 1, cb: null, timer: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function numOr(id, dflt) {
    const el = $(id);
    const n = el ? Number(el.value) : NaN;
    return Number.isFinite(n) ? n : dflt;
  }

  function loadScript(src, cb) {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => cb(null);
    s.onerror = () => cb(new Error('load fail ' + src));
    document.head.appendChild(s);
  }
  function ensureLibs(cb) {
    if (window.TerrainHeight && window.TerrainNoise) return cb();
    loadScript('js/terrain/terrainNoise.js?v=2', (e1) => {
      if (e1) return cb(e1);
      loadScript('js/terrain/terrainHeight.js?v=4', (e2) => cb(e2));
    });
  }

  function fieldHtml(f, val) {
    const id = 'atf-' + f.k;
    let input;
    if (f.enum) {
      input = '<select id="' + id + '" data-k="' + f.k + '" style="width:100%;padding:6px 8px;">' +
        f.enum.map((o) => '<option value="' + esc(o[0]) + '"' + (String(val) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') +
        '</select>';
    } else {
      input = '<input type="number" id="' + id + '" data-k="' + f.k + '" value="' + esc(val) + '"' +
        ' min="' + (f.min == null ? '' : f.min) + '" max="' + (f.max == null ? '' : f.max) + '"' +
        ' step="' + (f.step == null ? 'any' : f.step) + '" style="width:100%;padding:6px 8px;">';
    }
    return '<div style="margin-bottom:8px;">' +
      '<label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:3px;">' +
      esc(f.label) + (f.hint ? ' <span style="opacity:.7;">（' + esc(f.hint) + '）</span>' : '') + '</label>' +
      input + '</div>';
  }

  function groupHtml(title, open, fields, params) {
    return '<details ' + (open ? 'open' : '') + ' style="margin:10px 0;border:1px solid var(--border);border-radius:8px;padding:10px 12px;">' +
      '<summary style="cursor:pointer;font-weight:600;font-size:13px;">' + title + '</summary>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;margin-top:10px;">' +
      fields.map((f) => fieldHtml(f, params[f.k])).join('') +
      '</div></details>';
  }

  /** 位置与范围（= 编辑器的「地块」） */
  function areaHtml(a) {
    const v = a || {};
    const row = (id, label, val, step, hint) =>
      '<div style="margin-bottom:8px;"><label style="display:block;font-size:12px;color:var(--text-secondary);">' +
      label + (hint ? ' <span style="opacity:.7;">（' + hint + '）</span>' : '') + '</label>' +
      '<input id="' + id + '" type="number" step="' + step + '" value="' + esc(val) + '" style="width:100%;padding:6px 8px;"></div>';
    return '<details open style="margin:10px 0;border:1px solid var(--border);border-radius:8px;padding:10px 12px;">' +
      '<summary style="cursor:pointer;font-weight:600;font-size:13px;">📍 位置与范围（这块地形放在世界哪里）</summary>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;margin-top:10px;">' +
        row('atf-area-x', '中心 X (m)', v.x == null ? 0 : v.x, 10) +
        row('atf-area-z', '中心 Z (m)', v.z == null ? 0 : v.z, 10) +
        row('atf-area-width', '宽度 (m)', v.width == null ? 2000 : v.width, 100) +
        row('atf-area-depth', '深度 (m)', v.depth == null ? 2000 : v.depth, 100) +
        row('atf-area-baseY', '基准高度 Y (m)', v.baseY == null ? 0 : v.baseY, 10, '0 = 地面；10000 = 一万米高的浮空地形') +
        row('atf-area-priority', '优先级', v.priority == null ? 0 : v.priority, 1, '重叠时数字大的生效') +
        row('atf-area-grid', '网格数量', v.gridSize == null ? 100 : v.gridSize, 10, '仅编辑器显示用的参考网格') +
        '<div style="margin-bottom:8px;"><label style="display:block;font-size:12px;color:var(--text-secondary);">地块颜色</label>' +
          '<input id="atf-area-color" type="color" value="' + esc(v.color || '#2d5016') + '" style="width:100%;height:34px;padding:2px;"></div>' +
      '</div>' +
      '<div id="atf-area-range" style="font-size:12px;color:var(--text-secondary);margin-top:4px;"></div>' +
      '<div style="font-size:11px;color:var(--text-secondary);margin-top:6px;line-height:1.7;">' +
        '· 地形之间是<b>硬接</b>，边界直接切换。<br>' +
        '· 地形范围之外没有地面：玩家走过去会按 -Y 一直下落。</div>' +
    '</details>';
  }

  function collectArea() {
    const base = state.area || {};
    return {
      x: numOr('atf-area-x', base.x || 0),
      z: numOr('atf-area-z', base.z || 0),
      width: Math.max(100, numOr('atf-area-width', base.width || 2000)),
      depth: Math.max(100, numOr('atf-area-depth', base.depth || 2000)),
      baseY: numOr('atf-area-baseY', base.baseY || 0),
      priority: numOr('atf-area-priority', base.priority || 0),
      gridSize: Math.max(1, numOr('atf-area-grid', base.gridSize || 100)),
      color: ($('atf-area-color') || {}).value || '#2d5016'
    };
  }

  function collectParams() {
    const p = Object.assign({}, state.params);
    FIELDS.forEach((f) => {
      const el = $('atf-' + f.k);
      if (!el) return;
      p[f.k] = f.enum ? el.value : (el.value === '' ? p[f.k] : Number(el.value));
    });
    if (p.chunkSize != null && !isNaN(Number(p.chunkSize))) p.chunkSize = Number(p.chunkSize);
    return p;
  }

  function updateAreaRange() {
    const el = $('atf-area-range');
    if (!el) return;
    const a = collectArea();
    el.innerHTML = '覆盖范围：X <b>' + (a.x - a.width / 2).toFixed(0) + '</b> ~ <b>' + (a.x + a.width / 2).toFixed(0) + '</b>' +
      ' ｜ Z <b>' + (a.z - a.depth / 2).toFixed(0) + '</b> ~ <b>' + (a.z + a.depth / 2).toFixed(0) + '</b>' +
      ' ｜ 基准 Y <b>' + a.baseY + '</b>';
  }

  function open(opts, cb) {
    state.opts = opts || { mode: 'create' };
    state.cb = cb || function () {};
    const t = state.opts.terrain;
    const base = (window.adminTerrain && window.adminTerrain.defaults) || {};
    state.params = Object.assign({}, base, t ? t.params : {});
    state.area = (t && t.area) ? Object.assign({}, t.area)
      : { x: 0, z: 0, width: 2000, depth: 2000, baseY: 0, priority: 0, color: '#2d5016', gridSize: 100 };
    state.seed = t ? t.seed : Math.floor(Math.random() * 2000000000) + 1;

    ensureLibs((err) => {
      if (err) { alert('地形预览脚本加载失败：' + err.message); return; }
      renderDialog();
    });
  }

  function closeDialog() {
    const m = $('atf-mask');
    if (m) m.remove();
  }

  function renderDialog() {
    closeDialog();
    const isEdit = state.opts.mode === 'edit';
    const view = document.createElement('div');
    view.id = 'atf-mask';
    view.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:99999;overflow:auto;padding:24px;';
    view.innerHTML =
      '<div style="max-width:1060px;margin:0 auto;background:var(--card-bg,#1b1f27);border:1px solid var(--border);border-radius:12px;padding:18px;">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<strong style="font-size:16px;">' + (isEdit ? '编辑地形' : '新建地形') + '</strong>' +
          '<span style="font-size:12px;color:var(--text-secondary);">与 world_editor 的「🗺️ 地形设置」是同一份数据</span>' +
          '<span style="flex:1"></span>' +
          '<button class="btn btn-sm" id="atf-x">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 320px;gap:18px;margin-top:14px;">' +
          '<div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;">' +
              '<div style="margin-bottom:8px;"><label style="display:block;font-size:12px;color:var(--text-secondary);">名称 *</label>' +
                '<input id="atf-name" type="text" maxlength="80" value="' + esc(state.opts.terrain ? state.opts.terrain.name : '') + '" style="width:100%;padding:6px 8px;"></div>' +
              '<div style="margin-bottom:8px;"><label style="display:block;font-size:12px;color:var(--text-secondary);">备注</label>' +
                '<input id="atf-note" type="text" maxlength="200" value="' + esc(state.opts.terrain ? state.opts.terrain.note : '') + '" style="width:100%;padding:6px 8px;"></div>' +
            '</div>' +
            areaHtml(state.area) +
            (isEdit ? '' :
              '<div style="margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr;gap:0 14px;">' +
                '<div><label style="display:block;font-size:12px;color:var(--text-secondary);">模板来源（复制参数）</label>' +
                  '<select id="atf-from" style="width:100%;padding:6px 8px;"><option value="default">默认地形（平地）</option>' +
                  ((window.adminTerrain && window.adminTerrain.terrains) || []).filter((x) => !x.builtin)
                    .map((x) => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('') +
                  '</select></div>' +
                '<div><label style="display:block;font-size:12px;color:var(--text-secondary);">画质预设（LOD 分段）</label>' +
                  '<select id="atf-preset" style="width:100%;padding:6px 8px;"><option value="mid">中（48/24/12/6）</option>' +
                  '<option value="low">低（24/12/6/4）</option><option value="high">高（64/32/16/8）</option></select></div>' +
              '</div>') +
            '<div style="margin-bottom:8px;">' +
              '<label style="display:block;font-size:12px;color:var(--text-secondary);">世界种子 seed（同 seed = 同一地形，可分享）</label>' +
              '<div style="display:flex;gap:8px;">' +
                '<input id="atf-seed" type="number" min="1" max="2147483647" value="' + esc(state.seed) + '" style="flex:1;padding:6px 8px;">' +
                '<button class="btn btn-sm" id="atf-roll">🎲 随机</button>' +
              '</div></div>' +
            groupHtml('② 地形形状', true, FIELDS.filter((f) => f.g === 'shape'), state.params) +
            groupHtml('③ 生态与植被', false, FIELDS.filter((f) => f.g === 'eco'), state.params) +
            groupHtml('④ 性能', false, FIELDS.filter((f) => f.g === 'perf'), state.params) +
          '</div>' +
          '<div>' +
            '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">俯视预览（整块地形范围）</div>' +
            '<canvas id="atf-preview" width="300" height="300" style="width:100%;border-radius:8px;border:1px solid var(--border);background:#111;"></canvas>' +
            '<div id="atf-legend" style="font-size:11px;color:var(--text-secondary);margin-top:6px;line-height:1.7;"></div>' +
            '<div id="atf-est" style="font-size:12px;color:var(--text-secondary);margin-top:10px;line-height:1.9;background:rgba(255,255,255,.03);padding:8px;border-radius:8px;"></div>' +
          '</div>' +
        '</div>' +
        '<div id="atf-msg" style="margin-top:10px;font-size:13px;"></div>' +
        '<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;">' +
          '<button class="btn" id="atf-cancel">取消</button>' +
          '<button class="btn" id="atf-save">仅保存</button>' +
          '<button class="btn btn-primary" id="atf-save-act">保存并启用</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(view);

    $('atf-x').onclick = closeDialog;
    $('atf-cancel').onclick = closeDialog;
    $('atf-roll').onclick = () => { $('atf-seed').value = Math.floor(Math.random() * 2000000000) + 1; schedulePreview(); };
    $('atf-save').onclick = () => submit(false);
    $('atf-save-act').onclick = () => submit(true);
    const preset = $('atf-preset');
    if (preset) preset.onchange = () => { state.params.lodSegments = LOD_PRESETS[preset.value].slice(); schedulePreview(); };

    view.addEventListener('input', (e) => {
      const id = (e.target && e.target.id) || '';
      if (id.indexOf('atf-area') === 0) { updateAreaRange(); return; }
      if (id === 'atf-seed') schedulePreview();
      else if (e.target && e.target.getAttribute && e.target.getAttribute('data-k')) schedulePreview();
    });
    view.addEventListener('change', (e) => {
      const id = (e.target && e.target.id) || '';
      if (id.indexOf('atf-area') === 0) { updateAreaRange(); schedulePreview(); return; }
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-k')) schedulePreview();
    });

    updateAreaRange();
    drawPreview();
  }

  function schedulePreview() {
    clearTimeout(state.timer);
    state.timer = setTimeout(drawPreview, 220);
  }

  /** 俯视预览：与游戏内同一套高度函数，按地块范围采样 */
  function drawPreview() {
    const canvas = $('atf-preview');
    if (!canvas || !window.TerrainHeight) return;
    const p = collectParams();
    const a = collectArea();
    const seed = Math.max(1, Number($('atf-seed').value) || 1);
    state.params = Object.assign({}, p);
    state.area = Object.assign({}, a);
    state.seed = seed;

    const sampler = window.TerrainHeight.createSampler(p, seed);
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const img = ctx.createImageData(W, H);

    const spanX = Math.max(100, a.width) * 1.05;
    const spanZ = Math.max(100, a.depth) * 1.05;
    const stepX = spanX / W, stepZ = spanZ / H;
    const x0 = a.x - spanX / 2, z0 = a.z - spanZ / 2;

    const hs = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const z = z0 + j * stepZ;
      for (let i = 0; i < W; i++) hs[j * W + i] = sampler.heightAt(x0 + i * stepX, z);
    }

    const water = Number(p.waterLevel || -1.5);
    const snow = Number(p.snowLine || 95);
    const treeLine = Number(p.treeLine || 80);
    const rockSlope = Number(p.slopeRockMin || 45);
    const forestCover = Number(p.forestCover || 0.52);
    const amp = Number(p.heightScale || 0);

    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const idx = j * W + i;
        const h = hs[idx];
        const hL = hs[idx - 1], hR = hs[idx + 1], hD = hs[idx - W], hU = hs[idx + W];
        const grad = Math.hypot(
          (Number.isFinite(hL) && Number.isFinite(hR) ? hR - hL : 0),
          (Number.isFinite(hD) && Number.isFinite(hU) ? hU - hD : 0)
        ) / (2 * Math.max(stepX, stepZ));
        const slope = Math.atan(grad) * 180 / Math.PI;

        let r, g, b;
        if (h <= water) { r = 26; g = 58; b = 82; }
        else if (h <= water + Math.max(1.2, Number(p.shoreWidth || 2))) { r = 196; g = 180; b = 124; }
        else if (h >= snow) { r = 235; g = 240; b = 246; }
        else if (slope >= rockSlope || h >= treeLine + 40) { r = 132; g = 128; b = 122; }
        else {
          const n = window.TerrainNoise.fbm2(i * 0.12, j * 0.12, seed + 55, 4, 2.0, 0.5);
          const forest = amp > 0 && n > (1 - forestCover * 2);
          if (forest) { r = 34; g = 74; b = 40; } else { r = 84; g = 120; b = 58; }
        }
        const o = idx * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const legend = $('atf-legend');
    if (legend) {
      legend.innerHTML = Math.round(spanX) + '×' + Math.round(spanZ) + 'm ｜ ' +
        '<span style="color:#1a3a52;">■</span>水 <span style="color:#54783a;">■</span>草 ' +
        '<span style="color:#224a28;">■</span>林 <span style="color:#84807a;">■</span>岩 ' +
        '<span style="color:#ebf0f6;">■</span>雪';
    }
    updateEstimate(p, a);
  }

  function updateEstimate(p, a) {
    const chunk = Math.max(16, Number(p.chunkSize) || 64);
    const vd = Math.max(64, Number(p.viewDistance) || 256);
    const segs = Array.isArray(p.lodSegments) ? p.lodSegments : [64, 32, 16, 8];
    const areaVisible = Math.min(vd * 2, Math.max(a.width, a.depth));
    const tiles = Math.ceil(Math.PI * (areaVisible / chunk) * (areaVisible / chunk) * 0.5);
    const avgSeg = (Number(segs[0]) * 1 + Number(segs[1]) * 3 + Number(segs[2]) * 6 + Number(segs[3]) * 10) / 20;
    const tris = Math.round(tiles * avgSeg * avgSeg * 2);
    const est = $('atf-est');
    if (!est) return;
    const over = tris > 150000;
    est.innerHTML = '<b>预估（粗略）</b><br>' +
      '位置 (' + a.x + ', ' + a.z + ') · 面积 ' + a.width + '×' + a.depth + 'm · 基准 Y ' + a.baseY + '<br>' +
      '瓦片 ≈ ' + tiles + ' 块 · 三角 ≈ ' + (tris / 1000).toFixed(0) + 'k<br>' +
      (over ? '<span style="color:#f87171;">三角偏高，建议降低视距或画质预设</span>' : '<span style="color:var(--green);">在预算内</span>');
  }

  function validate(p, name, a) {
    if (!name) return '名称不能为空';
    if (!(a.width >= 100) || !(a.depth >= 100)) return '宽度/深度至少 100m';
    if (Number(p.treeLine) > Number(p.snowLine)) return '树线不能高于雪线';
    return null;
  }

  async function submit(activate) {
    const name = (($('atf-name') || {}).value || '').trim();
    const p = collectParams();
    const a = collectArea();
    const err = validate(p, name, a);
    const msgEl = $('atf-msg');
    if (err) { if (msgEl) { msgEl.textContent = err; msgEl.style.color = '#f87171'; } return; }

    const btn = $('atf-save-act');
    if (btn) btn.disabled = true;
    try {
      const body = {
        name: name,
        note: ($('atf-note') || {}).value || '',
        seed: Number($('atf-seed').value) || 1,
        params: p,
        area: a
      };
      let terrain;
      if (state.opts.mode === 'edit') {
        const r = await jreq('PUT', API + '/' + state.opts.terrain.id, body);
        terrain = r.terrain;
      } else {
        const from = $('atf-from');
        if (from && from.value) body.from = from.value;
        const r = await jreq('POST', API, body);
        terrain = r.terrain;
      }
      if (activate) await jreq('POST', API + '/' + terrain.id + '/activate');
      closeDialog();
      state.cb(terrain, !!activate);
    } catch (e) {
      if (msgEl) { msgEl.textContent = '保存失败：' + e.message; msgEl.style.color = '#f87171'; }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function jreq(method, url, body) {
    const tk = localStorage.getItem('adminToken');
    const res = await fetch(url, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, tk ? { Authorization: 'Bearer ' + tk } : {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let j = null; try { j = await res.json(); } catch (e) { j = {}; }
    if (!res.ok || j.success === false) throw new Error(j.error || ('HTTP ' + res.status));
    return j;
  }

  window.adminTerrainForm = { open: open, close: closeDialog, _fields: FIELDS };
})();
