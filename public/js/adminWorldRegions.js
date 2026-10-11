/**
 * adminWorldRegions —— 后台「🧠 AI 世界大脑 → 区域与建设」（Phase 3.5-2）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 一句话口径（§Phase 3.5）：画框 → 选自主度 → 下单（一句话+可选风格）→ 看预览可改 → 执行 → 不满意一键回滚。
 *
 * 设计纪律：
 *  - **零结构侵入**：sub-tab 按钮与容器全部由本文件自注入，admin.html 只加 1 行 script（§K.1 上限 3 处）；
 *  - autonomy **不预选**（§C.3⑩）：三档都不默认，必须管理员自己选；
 *  - 每个区域卡都回显「区域内已有资产（AI 不能碰这些）」，让红线在 UI 上可见（判据 P35-17）；
 *  - managed档执行必须二次确认（后端也拦，见 CONFIRM_REQUIRED）。
 *
 * API：/api/world-ai/{regions, regions/:key, regions/:key/assets, regions/:key/interactions,
 *                      regions/:key/quests, missions, missions/:id, missions/:id/{plan,run,rollback}, quests}
 * 暴露全局：window.adminWorldRegions
 */
(function () {
  'use strict';
  const API = '/api/world-ai';
  const AUTONOMIES = [
    ['managed', 'managed（只按我下的指令干活）'],
    ['semi_autonomous', 'semi_autonomous（建完可自己补绿化/细节，不许拆东西）'],
    ['autonomous', 'autonomous（可自己提改动提案；选它必须填授权理由）'],
  ];

  const $ = (id) => document.getElementById(id);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function msg(t, ok) {
    const el = $('awr-msg');
    if (!el) return;
    el.textContent = t;
    el.style.color = ok ? 'var(--green)' : 'var(--red)';
    setTimeout(() => { if (el.textContent === t) el.textContent = ''; }, 6000);
  }
  async function jreq(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const tk = localStorage.getItem('adminToken');
    opt.headers.Authorization = 'Bearer ' + (tk ? tk : '');
    const res = await fetch(url, opt);
    let j = null; try { j = await res.json(); } catch (e) { j = {}; }
    const bad = !res.ok || j.success === false;
    if (bad) throw new Error((j && (j.error || j.reason || j.message || j.code)) || ('HTTP ' + res.status));
    return j;
  }

  let built = false;
  function build() {
    if (built) return;
    const page = $('page-ai-world-brain');
    if (!page) return;
    const bar = page.querySelector('.sub-tab') ? page.querySelector('div[style*="border-bottom"]') : null;
    if (!bar) return;   // 2a 的页面还没构建完（脚本加载顺序），下次轮询再来
    built = true;

    bar.insertAdjacentHTML('beforeend',
      '<button class="sub-tab" id="awr-tab" onclick="switchSubTab(\'ai-world-brain\',\'awb-regions\',this)">🗺️ 区域与建设</button>');

    const wrap = document.createElement('div');
    wrap.id = 'ai-world-brain-sub-awb-regions';
    wrap.className = 'sub-page';
    wrap.style.display = 'none';
    wrap.innerHTML =
      '<div class="awb-panel" style="margin-bottom:12px;"><h3>🆕 新建区域（画一个矩形范围）</h3>' +
        '<div class="awb-field"><label>区域机器名 region_key（小写字母/数字/下划线，如 east_cafe_block）</label>' +
          '<input type="text" id="awr-key" maxlength="60" placeholder="east_cafe_block" style="width:100%;"></div>' +
        '<div class="awb-field"><label>区域名称</label><input type="text" id="awr-name" maxlength="120" style="width:100%;"></div>' +
        '<div class="awb-field"><label>矩形范围（轴对齐；一期不支持多边形/旋转）</label>' +
          '<div class="awb-inline">x <input type="number" id="awr-x" value="3000" step="1">' +
          ' z <input type="number" id="awr-z" value="3000" step="1">' +
          ' 宽 <input type="number" id="awr-w" value="60" min="1" step="1">' +
          ' 深 <input type="number" id="awr-d" value="60" min="1" step="1">（米）</div></div>' +
        '<div class="awb-field"><label>自主度（<b>不预选</b>：每块地的松紧必须你自己决定）</label>' +
          '<select id="awr-autonomy" style="width:100%;"><option value="">— 请选择 —</option>' +
          AUTONOMIES.map((a) => '<option value="' + a[0] + '">' + a[1] + '</option>').join('') + '</select></div>' +
        '<div class="awb-field"><label>授权理由（选 autonomous 时【必填】，写清授权范围，审计用；managed/semi_autonomous 可留空）</label>' +
          '<input type="text" id="awr-notes" maxlength="400" style="width:100%;"></div>' +
        '<div class="awb-field"><label>网格对齐（留空=按零件自身 grid 尺寸；填 [1,0.63,1] 之类模数）</label>' +
          '<input type="text" id="awr-grid" placeholder="例如 1,0.63,1" style="width:220px;"></div>' +
        '<div class="awb-field"><label>预算（可留空用推荐值）</label>' +
          '<div class="awb-inline">最多物体 <input type="number" id="awr-maxobj" value="60" min="1">' +
          ' 面数上限 <input type="number" id="awr-maxtris" value="40000" min="0" step="1000">' +
          ' 限高 <input type="number" id="awr-maxh" value="12" min="0" step="1">（米）</div></div>' +
        '<button id="awr-create" style="background:var(--green);color:#08130c;font-weight:600;border:none;border-radius:8px;padding:7px 16px;cursor:pointer;">✔ 创建区域</button>' +
        '<div id="awr-msg" class="awb-msg"></div>' +
      '</div>' +
      '<div id="awr-list"></div>' +
      '<div class="awb-panel" style="margin-top:12px;"><h3>🕹 区域玩法（一期极简）</h3>' +
        '<div class="awb-redline">一期仅 AI 游客（Agent）能完成采集点与引导任务；真人交互 UI 属 Phase 6，' +
        '服务端对真人一律不响应（这不是故障）。物品码本期<b>只登记不发放</b>（Agent 没有用户行，写不进背包）。</div>' +
        '<div id="awr-gameplay"></div>' +
      '</div>';
    page.appendChild(wrap);
    $('awr-create').onclick = createRegion;
    load();
  }
  async function createRegion() {
    const key = String($('awr-key').value || '').trim();
    const name = String($('awr-name').value || '').trim();
    const autonomy = $('awr-autonomy').value;
    if (!key) return msg('请先填区域机器名 region_key');
    if (!/^[a-z0-9_]{2,60}$/.test(key)) return msg('区域机器名只能用 2~60 位【小写】字母/数字/下划线（不能用大写、中文、空格、横杠），例如 my_forest');
    if (!name) return msg('请填区域名称（显示用，可以中文）');
    if (!autonomy) return msg('必须显式选择自主度（UI 不预选，这是刻意的）');
    if (autonomy === 'autonomous' && !String($('awr-notes').value || '').trim()) return msg('选 autonomous（全自主）必须填「授权理由」——写清楚你授权 AI 在这块地做什么（审计追溯用，如：授权在此区域自主搭建森林景观）；若只是测试建议选 managed');
    const bx = Number($('awr-x').value), bz = Number($('awr-z').value);
    const bw = Number($('awr-w').value), bd = Number($('awr-d').value);
    if (!isFinite(bx) || !isFinite(bz)) return msg('范围起点 x/z 必须是数字');
    if (!isFinite(bw) || !isFinite(bd) || bw <= 0 || bd <= 0) return msg('宽/深必须是大于 0 的数字（区域大小，米）');
    const gridRaw = String($('awr-grid').value || '').trim();
    let gridsnap = {};
    if (gridRaw) {
      const unit = gridRaw.split(',').map((x) => Number(x.trim()));
      if (unit.length < 3 || unit.some((v) => !isFinite(v) || v <= 0)) return msg('网格模数格式应为 ux,uy,uz，例如 1,0.63,1');
      gridsnap = { kind: 'modular', unit };
    }
    try {
      const r = await jreq('POST', API + '/regions', {
        regionKey: key, name,
        bounds: { kind: 'rect', x: bx, z: bz, width: bw, depth: bd },
        autonomy, notes: $('awr-notes').value,
        gridsnap,
        constraints: { maxObjects: Number($('awr-maxobj').value), maxTris: Number($('awr-maxtris').value), maxHeight: Number($('awr-maxh').value) },
      });
      msg('区域已创建：' + r.region.region_key + '（自主度 ' + r.region.autonomy + '）', true);
      $('awr-key').value = ''; $('awr-name').value = ''; $('awr-autonomy').value = ''; $('awr-notes').value = '';
      load();
    } catch (e) { msg('创建失败：' + e.message); }
  }

  async function load() {
    const box = $('awr-list');
    if (!box) return;
    try {
      const r = await jreq('GET', API + '/regions');
      const regions = r.regions || [];
      renderGameplay(regions);
      if (!regions.length) { box.innerHTML = '<div class="awb-tag">还没有区域。先在上面画一个矩形范围。</div>'; return; }
      const cards = [];
      for (const g of regions) {
        const missions = await jreq('GET', API + '/missions?regionKey=' + encodeURIComponent(g.region_key));
        cards.push(card(g, missions.missions || []));
      }
      box.innerHTML = cards.join('');
      bindCards(regions);
    } catch (e) { box.innerHTML = '<div class="awb-tag">读取失败：' + esc(e.message) + '</div>'; }
  }
  function card(g, missions) {
    const b = g.bounds || {};
    const c = g.constraints || {};
    const rows = missions.map((m) => {
      const st = m.status;
      const badge = st === 'completed' ? '<span class="awb-tag g">completed</span>'
        : st === 'failed' ? '<span class="awb-tag a">failed</span>'
          : st === 'rolled_back' ? '<span class="awb-tag">rolled_back</span>'
            : '<span class="awb-tag">' + esc(st) + '</span>';
      const stats = m.executed_stats || {};
      return '<div class="awb-inline" style="margin:6px 0;flex-wrap:wrap;">' +
        badge + '<b>' + esc(m.title) + '</b>' +
        '<span class="awb-tag">快照 ' + esc(m.autonomy_snapshot) + '</span>' +
        '<span class="awb-tag">' + esc(m.prompt).slice(0, 40) + '</span>' +
        (stats.objectsCreated !== undefined ? '<span class="awb-tag">建了 ' + stats.objectsCreated + ' 件</span>' : '') +
        (stats.skippedByCollision ? '<span class="awb-tag">换位 ' + stats.skippedByCollision + '</span>' : '') +
        '<button class="awr-btn" data-act="plan" data-region="' + esc(g.region_key) + '" data-mission="' + esc(m.id) + '">🧭 生成方案</button>' +
        '<button class="awr-btn" data-act="run" data-region="' + esc(g.region_key) + '" data-mission="' + esc(m.id) + '">▶️ 执行</button>' +
        '<button class="awr-btn" data-act="rollback" data-region="' + esc(g.region_key) + '" data-mission="' + esc(m.id) + '">↩️ 一键回滚</button>' +
        (st === 'completed' ? '<button class="awr-btn" data-act="followup" data-region="' + esc(g.region_key) + '" data-mission="' + esc(m.id) + '">➕ 再来一批</button>' : '') +
        '<span class="awr-out" data-for="' + esc(m.id) + '"></span>' +
        '</div>';
    }).join('');
    return '<div class="awb-panel" style="margin-bottom:12px;">' +
      '<h3>🗺️ ' + esc(g.name) + ' <span class="awb-tag">' + esc(g.region_key) + '</span> ' +
      '<span class="awb-tag a">自主度 ' + esc(g.autonomy) + '</span></h3>' +
      '<div class="awb-field"><label>范围</label><span class="awb-tag">x ' + num(b.x) + ' ~ ' + num2(b.x, b.width) + ' · z ' + num(b.z) + ' ~ ' + num2(b.z, b.depth) + '（' + num(b.width) + '×' + num(b.depth) + ' 米）</span></div>' +
      '<div class="awb-field"><label>预算</label><span class="awb-tag">最多 ' + num(c.maxObjects, 60) + ' 件 · 面数 ' + num(c.maxTris, 40000) + ' · 限高 ' + num(c.maxHeight, 12) + 'm</span></div>' +
      '<div class="awb-field"><label>区域内已有资产</label><span class="awr-assets" data-region="' + esc(g.region_key) + '">读取中…</span></div>' +
      '<div class="awb-field"><label>调整自主度（调严立即生效；执行中的委托按快照跑完）——当前：' + esc(g.autonomy) + '（下拉框改动后需点「应用」）</label><div class="awr-inline">' +
        '<select class="awr-newauto" data-region="' + esc(g.region_key) + '">' + AUTONOMIES.map((a) => '<option value="' + a[0] + '"' + (a[0] === g.autonomy ? ' selected' : '') + '>' + a[1] + '</option>').join('') + '</select>' +
        '<button class="awr-btn" data-act="setauto" data-region="' + esc(g.region_key) + '">应用</button>' +
        '<button class="awr-btn" data-act="assets" data-region="' + esc(g.region_key) + '">查看人工资产</button>' +
        '<button class="awr-btn" data-act="del" data-region="' + esc(g.region_key) + '">🗑 删除区域</button>' +
        '<span class="awr-out" data-for="region:' + esc(g.region_key) + '"></span>' +
      '</div></div>' +
      '<div class="awb-field"><label>下建设委托（一句话诉求；风格/排除项可留空）</label>' +
        '<div class="awr-inline">' +
          '<input type="text" class="awr-prompt" data-region="' + esc(g.region_key) + '" placeholder="例：盖一个有 6 张桌子的咖啡馆，带院子" style="flex:1;min-width:220px;">' +
          '<input type="text" class="awr-style" data-region="' + esc(g.region_key) + '" placeholder="风格 brick_urban" style="width:150px;">' +
          '<input type="number" class="awr-exclude" data-region="' + esc(g.region_key) + '" placeholder="排除 role" style="width:120px;">' +
          '<button class="awr-btn" data-act="newmission" data-region="' + esc(g.region_key) + '">＋ 新建委托</button>' +
        '</div></div>' +
      '<div>' + (rows || '<div class="awb-tag">还没有委托。</div>') + '</div>' +
      '</div>';
  }
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
  function num2(base, w) { return num(base) + num(w); }
  function out(region, text, ok) {
    const el = document.querySelector('.awr-out[data-for="region:' + CSS.escape(region) + '"]');
    if (el) { el.textContent = text; el.style.color = ok ? 'var(--green)' : 'var(--red)'; }
  }
  function outOf(missionId, text, ok) {
    const el = document.querySelector('.awr-out[data-for="' + CSS.escape(missionId) + '"]');
    if (el) { el.textContent = text; el.style.color = ok ? 'var(--green)' : 'var(--red)'; }
  }

  async function loadAssets(regionKey) {
    const cells = document.querySelectorAll('.awr-assets[data-region="' + CSS.escape(regionKey) + '"]');
    if (!cells.length) return;
    try {
      const r = await jreq('GET', API + '/regions/' + encodeURIComponent(regionKey) + '/assets');
      const a = r.assets;
      cells.forEach((el) => {
        el.innerHTML = '<span class="awb-tag g">AI 可动 ' + a.aiCount + ' 件</span> ' +
          '<span class="awb-tag a">AI 不能碰 ' + a.humanCount + ' 件（人工资产）</span> ' +
          '<span style="color:var(--muted);font-size:12px;">' + esc(a.notice) + '</span>';
      });
    } catch (e) {
      cells.forEach((el) => { el.textContent = '读取失败：' + e.message; });
    }
  }

  function bindCards(regions) {
    regions.forEach((g) => loadAssets(g.region_key));
    document.querySelectorAll('.awr-btn').forEach((btn) => {
      btn.onclick = async () => {
        const act = btn.getAttribute('data-act');
        const region = btn.getAttribute('data-region');
        const mission = btn.getAttribute('data-mission');
        btn.disabled = true;
        try {
          if (act === 'assets') {
            const r = await jreq('GET', API + '/regions/' + encodeURIComponent(region) + '/assets');
            const names = r.assets.humanAssets.slice(0, 8).map((x) => x.name + '(' + x.type + ')').join('、');
            out(region, '人工资产：' + (names || '（区域内暂无人工资产）'), true);
          } else if (act === 'setauto') {
            const sel = document.querySelector('.awr-newauto[data-region="' + CSS.escape(region) + '"]');
            const r = await jreq('PATCH', API + '/regions/' + encodeURIComponent(region), { autonomy: sel.value });
            out(region, '已调整为 ' + r.region.autonomy + '，有效自主度 ' + r.effectiveAutonomy, true);
            load();
          } else if (act === 'del') {
            if (!confirm('删除区域「' + region + '」？区域内若还有 AI 产物会被拒绝（需先回滚）。')) return;
            const r = await jreq('DELETE', API + '/regions/' + encodeURIComponent(region));
            out(region, '已删除 ' + r.deleted, true);
            load();
          } else if (act === 'newmission') {
            const prompt = String(document.querySelector('.awr-prompt[data-region="' + CSS.escape(region) + '"]').value || '').trim();
            if (!prompt) return out(region, '请先写一句话诉求', false);
            const style = String(document.querySelector('.awr-style[data-region="' + CSS.escape(region) + '"]').value || '').trim();
            const exclude = String(document.querySelector('.awr-exclude[data-region="' + CSS.escape(region) + '"]').value || '').trim();
            const constraints = {};
            if (style) constraints.style_family = style;
            if (exclude) constraints.forbid_roles = exclude.split(',').map((s) => s.trim()).filter(Boolean);
            const r = await jreq('POST', API + '/missions', { regionKey: region, title: prompt.slice(0, 30), prompt, constraints });
            out(region, '委托已建（快照 ' + r.autonomySnapshot + '）' + (r.providerResolution && r.providerResolution.reason ? ' · ' + r.providerResolution.reason : ''), true);
            load();
          } else if (act === 'plan') {
            outOf(mission, '生成中…（约 1~3 分钟，勿刷新）', true);
            const r = await jreq('POST', API + '/missions/' + mission + '/plan', {});
            const blocks = (r.plan && r.plan.blocks || []);
            const parts = blocks.reduce((s, b) => s + (b.parts || []).length, 0);
            const kinds = new Set(blocks.flatMap((b) => (b.parts || []).map((p) => p.partKey))).size;
            const gap = r.plan && r.plan.intentGap ? ' ⚠' + r.plan.intentGap : '';
            outOf(mission, '🧠 我的理解：' + ((r.plan && r.plan.summary) || '(无摘要)') + ' → ' + blocks.length + ' 块 / ' + parts + ' 件 / ' + kinds + ' 种零件' + gap + '。确认无误点「执行」；不满意改诉求再点「生成方案」', !gap);
          } else if (act === 'run') {
            const eff = await jreq('GET', API + '/regions/' + encodeURIComponent(region));
            const autonomy = (eff.region || {}).autonomy;
            if (autonomy === 'managed' && !confirm('当前区域自主度是 managed：这批由你手动点执行。确认开始建？')) return;
            outOf(mission, '执行中…', true);
            const r = await jreq('POST', API + '/missions/' + mission + '/run', { confirm: true, useSavedPlan: true });
            const s = r.stats || {};
            outOf(mission, (r.status === 'completed' ? '✅ 完成' : '⚠ ' + r.status) + '：建 ' + (s.objectsCreated || 0) + ' 件 · 换位 ' + (s.skippedByCollision || 0) + ' · 拒绝 ' + (s.denied || 0) + ' · LLM ' + (s.llmCalls || 0) + ' 次', r.status === 'completed');
            load();
          } else if (act === 'followup') {
            const addendum = prompt('补充要求（AI 会读取区域内已有资产，只补差距不重复）\n例：再加 20 棵、增加几种不同的树、靠北面补一排围栏');
            if (!addendum || !addendum.trim()) return;
            outOf(mission, '创建补充委托…', true);
            const r = await jreq('POST', API + '/missions/' + mission + '/followup', { prompt: addendum.trim() });
            const ea = (r.existingAssets || []).map((x) => x.name + '×' + x.n).join('、');
            outOf(mission, '✅ 补充委托已建（已注入现有资产清单：' + (ea || '无') + '）。对新委托点「生成方案」→「执行」', true);
            load();
          } else if (act === 'rollback') {
            if (!confirm('回滚本批 AI 产物？人工资产零影响。')) return;
            const r = await jreq('POST', API + '/missions/' + mission + '/rollback', {});
            outOf(mission, '已回滚 ' + r.rolledBack + ' 件', true);
            load();
          }
        } catch (e) {
          if (mission) outOf(mission, '失败：' + e.message, false); else out(region, '失败：' + e.message, false);
        } finally { btn.disabled = false; }
      };
    });
  }
  // ── 区域玩法（采集点 + 引导任务）────────────────────────────────────
  function renderGameplay(regions) {
    const box = $('awr-gameplay');
    if (!box) return;
    if (!regions.length) { box.innerHTML = '<div class="awb-tag">先创建区域。</div>'; return; }
    box.innerHTML = regions.map((g) => {
      const b = g.bounds || {};
      return '<div class="awr-inline" style="margin:6px 0;flex-wrap:wrap;">' +
        '<b>' + esc(g.region_key) + '</b>' +
        '<span class="awb-tag">采集点坐标 x <input class="awr-ix" data-region="' + esc(g.region_key) + '" value="' + num(b.x) + '" style="width:90px;"></span>' +
        '<span class="awb-tag">z <input class="awr-iz" data-region="' + esc(g.region_key) + '" value="' + num(b.z) + '" style="width:90px;"></span>' +
        '<input class="awr-ikey" data-region="' + esc(g.region_key) + '" value="mint" placeholder="交互点 key" style="width:110px;">' +
        '<button class="awr-btn" data-act="mkinter" data-region="' + esc(g.region_key) + '">➕ 添加采集点</button>' +
        '<button class="awr-btn" data-act="mkquest" data-region="' + esc(g.region_key) + '">➕ 生成引导任务</button>' +
        '<span class="awr-out" data-for="region:' + esc(g.region_key) + '"></span>' +
        '</div>';
    }).join('');
    document.querySelectorAll('.awr-btn[data-act="mkinter"],.awr-btn[data-act="mkquest"]').forEach((btn) => {
      btn.onclick = async () => {
        const region = btn.getAttribute('data-region');
        btn.disabled = true;
        try {
          if (btn.getAttribute('data-act') === 'mkinter') {
            const x = Number(document.querySelector('.awr-ix[data-region="' + CSS.escape(region) + '"]').value);
            const z = Number(document.querySelector('.awr-iz[data-region="' + CSS.escape(region) + '"]').value);
            const key = String(document.querySelector('.awr-ikey[data-region="' + CSS.escape(region) + '"]').value || 'mint').trim();
            await jreq('POST', API + '/regions/' + encodeURIComponent(region) + '/interactions',
              { key, interaction_type: 'reward_grant', label: '采集点 ' + key, position: { x, y: 0, z }, radius: 5, payload: { count: 1 } });
            out(region, '采集点「' + key + '」已就位（半径 5m）', true);
          } else {
            const r = await jreq('POST', API + '/regions/' + encodeURIComponent(region) + '/quests', { count: 3 });
            out(region, '引导任务已' + (r.existed ? '存在（幂等）' : '创建') + '：' + r.task.title, true);
          }
        } catch (e) { out(region, '失败：' + e.message, false); }
        finally { btn.disabled = false; }
      };
    });
  }

  // ── 启动：等 2a 把页面与sub-tab 栏建好（脚本加载顺序不保证）─────────
  function boot() {
    // ★ build() 里任何一次抛错都不能让轮询链断掉（实测：链一断，子页永远建不出来，
    //   表现为「tab 有、容器没有」的半成品状态，很难查）。
    try {
      build();
    } catch (e) {
      console.warn('[adminWorldRegions] build 异常，将重试', e);
      built = false;
    }
    // 装 switchSubTab 补丁：点子页时自动加载本子页（与手动 load() 同一条路径）
    const orig = window.switchSubTab;
    if (typeof orig === 'function' && !window.__awrPatched) {
      window.__awrPatched = true;
      window.switchSubTab = function (page, sub, el) {
        const r = orig.apply(this, arguments);
        if (sub === 'awb-regions') {
          const w = $('ai-world-brain-sub-awb-regions');
          if (w) w.style.display = '';
          load();
        }
        return r;
      };
    }
    // ★ switchSubTab 可能比本脚本更晚出现（admin.html 内联脚本顺序不保证）——
    //   没装上补丁就继续轮询，否则子页永远不会被触发加载（3.5-2 实测踩到：列表恒为空）。
    const needMore = !built || (typeof window.switchSubTab === 'function' && !window.__awrPatched);
    if (needMore) setTimeout(boot, 200);
  }

  window.adminWorldRegions = { load, loadAssets, renderGameplay, createRegion };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 1200);   // 兜底启动：脚本加载顺序异常时也能自建
})();