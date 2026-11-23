/**
 * adminWorldBrainLite —— AI 世界大脑「双入口简化」界面（第 1 期：区域建设可跑通）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 零结构侵入：本文件自注入 #page-ai-world-brain，旧 4 个模块一行不改。
 * 旧界面不搬 DOM、不重写，只用一个可开关的 CSS 规则整体隐藏 → 点「高级」原样回来，
 * 避免与旧模块的轮询注入、switchSubTab 补丁产生竞态。
 *
 * 第 1 期范围：区域建设完整链路（选址 → 建区域 → 下委托 → 执行 → 回滚）。
 * 世界建设 tab 只做「干跑预览」（真实选址、不落库、不花 token）；批量执行属第 2 期。
 */
(function () {
  'use strict';
  var C = window.AWBCore;
  if (!C) { console.error('[awb-lite] 缺少 awb-lite-core.js'); return; }

  var HIDE_RULE = '#page-ai-world-brain > :not(#awb-lite-root){display:none !important;}';
  var hideStyle = null;
  var root = null;
  var lastResult = null;
  var lastOpts = null;
  var state = { tab: 'region', scale: 'medium', position: 'auto', layout: 'scatter', count: '5', busy: false };
  // 11:10 用户决定：世界建设先暂停，只开放区域建设。第 2 期改回 true 即可恢复预览与批量执行。
  var WORLD_BUILD_ENABLED = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function $(id) { return document.getElementById(id); }

  var CSS = [
    '#awb-lite-root{--awb-bg:#0e1218;--awb-surface:#161c25;--awb-surface2:#1d2530;--awb-line:#2a3543;',
    '--awb-line2:#3b4a5d;--awb-text:#e7edf6;--awb-muted:#93a2b6;--awb-dim:#64748b;',
    '--awb-green:#57d98a;--awb-green-dim:#123525;--awb-blue:#6ba8f5;--awb-blue-dim:#152a44;',
    '--awb-amber:#e8b06a;--awb-accent:var(--awb-green);--awb-accent-dim:var(--awb-green-dim);',
    'color:var(--awb-text);font:13px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}',
    '#awb-lite-root.mode-world{--awb-accent:var(--awb-blue);--awb-accent-dim:var(--awb-blue-dim)}',
    '#awb-lite-root *{box-sizing:border-box}',
    '#awb-lite-root .hd{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px}',
    '#awb-lite-root .hd h1{margin:0;font-size:19px;font-weight:500;letter-spacing:.3px}',
    '#awb-lite-root .hd .sub{color:var(--awb-dim);font-size:12px;margin-top:2px}',
    '#awb-lite-root .status{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--awb-surface);',
    'border:1px solid var(--awb-line);border-radius:8px;padding:8px 14px;font-size:11.5px;color:var(--awb-muted)}',
    '#awb-lite-root .status b{font-weight:500;color:var(--awb-text);font-variant-numeric:tabular-nums}',
    '#awb-lite-root .dot{width:7px;height:7px;border-radius:50%;background:var(--awb-amber);display:inline-block;margin-right:6px}',
    '#awb-lite-root .dot.on{background:var(--awb-green)}',
    '#awb-lite-root .sep{width:1px;height:12px;background:var(--awb-line2)}',
    '#awb-lite-root .tabs{display:flex;gap:24px;border-bottom:1px solid var(--awb-line);margin-bottom:16px}',
    '#awb-lite-root .tab{background:none;border:none;color:var(--awb-muted);font:inherit;font-size:13px;',
    'padding:0 2px 11px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}',
    '#awb-lite-root .tab:hover{color:var(--awb-text)}',
    '#awb-lite-root .tab.on{color:var(--awb-accent);border-bottom-color:var(--awb-accent);font-weight:500}',
    '#awb-lite-root .tab.ghost{margin-left:auto;color:var(--awb-dim);font-size:12px}',
    '#awb-lite-root .grid{display:grid;grid-template-columns:minmax(0,1.72fr) minmax(0,1fr);gap:16px;align-items:start}',
    '@media(max-width:900px){#awb-lite-root .grid{grid-template-columns:1fr}}',
    '#awb-lite-root .card{background:var(--awb-surface);border:1px solid var(--awb-line);border-radius:10px;padding:18px 20px;margin-bottom:16px}',
    '#awb-lite-root .card-hd{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px}',
    '#awb-lite-root .card-hd h2{margin:0;font-size:14px;font-weight:500}',
    '#awb-lite-root .hint{color:var(--awb-dim);font-size:11.5px}',
    '#awb-lite-root .lbl{font-size:11px;color:var(--awb-dim);letter-spacing:.4px;margin-bottom:7px;display:flex;justify-content:space-between}',
    '#awb-lite-root .lbl a{color:var(--awb-accent);cursor:pointer;text-decoration:none;font-size:11px}',
    '#awb-lite-root .cmd{width:100%;min-height:74px;resize:vertical;background:var(--awb-surface2);',
    'border:1px solid var(--awb-line2);border-radius:8px;color:var(--awb-text);font:inherit;font-size:13.5px;',
    'line-height:1.7;padding:12px 14px;outline:none}',
    '#awb-lite-root .cmd:focus{border-color:var(--awb-accent)}',
    '#awb-lite-root .tip{font-size:11px;color:var(--awb-dim);margin-top:7px}',
    '#awb-lite-root .opt{display:flex;align-items:flex-start;gap:12px;margin-top:14px}',
    '#awb-lite-root .opt>.k{width:52px;flex:none;font-size:11.5px;color:var(--awb-muted);padding-top:6px}',
    '#awb-lite-root .ctl{display:flex;flex-wrap:wrap;gap:6px;flex:1}',
    '#awb-lite-root .seg{background:transparent;border:1px solid var(--awb-line2);border-radius:6px;',
    'color:var(--awb-muted);font:inherit;font-size:11.5px;padding:5px 11px;cursor:pointer;line-height:1.5}',
    '#awb-lite-root .seg:hover{border-color:var(--awb-dim);color:var(--awb-text)}',
    '#awb-lite-root .seg.on{border-color:var(--awb-accent);background:var(--awb-accent-dim);color:var(--awb-accent)}',
    '#awb-lite-root .seg .s{display:block;font-size:10px;color:var(--awb-dim);margin-top:1px}',
    '#awb-lite-root .seg.on .s{color:var(--awb-accent);opacity:.8}',
    '#awb-lite-root .mini{background:var(--awb-surface2);border:1px solid var(--awb-line2);border-radius:6px;',
    'color:var(--awb-text);font:inherit;font-size:11.5px;padding:5px 9px;width:92px}',
    '#awb-lite-root .act{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:20px;padding-top:16px;border-top:1px solid var(--awb-line)}',
    '#awb-lite-root .go{background:var(--awb-accent);color:#07160e;border:none;border-radius:7px;padding:9px 22px;',
    'font:inherit;font-size:13px;font-weight:500;cursor:pointer}',
    '#awb-lite-root .go:disabled{opacity:.45;cursor:not-allowed}',
    '#awb-lite-root .est{color:var(--awb-dim);font-size:11.5px;font-variant-numeric:tabular-nums}',
    '#awb-lite-root .note{margin-top:12px;font-size:11.5px;color:var(--awb-amber);min-height:17px}',
    '#awb-lite-root .note.ok{color:var(--awb-green)}',
    '#awb-lite-root .note.bad{color:#f08a8a}',
    '#awb-lite-root .metrics{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--awb-line);',
    'border:1px solid var(--awb-line);border-radius:8px;overflow:hidden}',
    '#awb-lite-root .metric{background:var(--awb-surface2);padding:11px 13px}',
    '#awb-lite-root .metric .n{font-size:19px;font-weight:500;font-variant-numeric:tabular-nums}',
    '#awb-lite-root .metric .t{font-size:10.5px;color:var(--awb-dim);margin-top:1px}',
    '#awb-lite-root .rowline{display:flex;justify-content:space-between;gap:10px;padding:6px 0;',
    'border-bottom:1px solid var(--awb-line);font-size:12px}',
    '#awb-lite-root .rowline:last-child{border-bottom:none}',
    '#awb-lite-root .rowline span{color:var(--awb-muted)}',
    '#awb-lite-root .rowline b{font-weight:500;font-variant-numeric:tabular-nums}',
    '#awb-lite-root .links{display:flex;gap:16px;margin-top:12px}',
    '#awb-lite-root .links a{color:var(--awb-accent);font-size:11.5px;cursor:pointer;text-decoration:none}',
    '#awb-lite-root .links a.off{color:var(--awb-dim);cursor:not-allowed}',
    '#awb-lite-root .small{font-size:11.5px;color:var(--awb-dim);line-height:1.8}',
    '#awb-lite-root .preview{margin-top:16px;border-top:1px solid var(--awb-line);padding-top:16px}',
    '#awb-lite-root .pv-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}',
    '@media(max-width:640px){#awb-lite-root .pv-grid{grid-template-columns:1fr}}',
    '#awb-lite-root .map{background:var(--awb-surface2);border:1px solid var(--awb-line);border-radius:8px;padding:8px}',
    '#awb-lite-root .cost{display:flex;gap:16px;flex-wrap:wrap;background:var(--awb-surface2);',
    'border:1px solid var(--awb-line);border-radius:8px;padding:11px 14px;margin-top:12px;font-size:11.5px;',
    'color:var(--awb-muted);font-variant-numeric:tabular-nums}',
    '#awb-lite-root .cost b{color:var(--awb-text);font-weight:500}',
    '#awb-lite-root .foot{color:#4d5a6c;font-size:11px;margin-top:18px;text-align:center}',
    '#awb-lite-root .hide{display:none !important}',
    '#awb-lite-root.legacy-mode .grid,#awb-lite-root.legacy-mode .foot{display:none !important}',
    '#awb-lite-root .legacy-tip{display:none;background:var(--awb-surface2);border:1px solid var(--awb-line);',
    'border-radius:8px;padding:9px 14px;font-size:11.5px;color:var(--awb-muted);margin-bottom:14px}',
    '#awb-lite-root.legacy-mode .legacy-tip{display:block}',
    '#awb-lite-root .tab.wip{color:var(--awb-dim)}',
    '#awb-lite-root .tab.wip.on{color:var(--awb-dim);border-bottom-color:var(--awb-line2)}',
    '#awb-lite-root .wip-tag{font-size:10px;color:var(--awb-dim);border:1px solid var(--awb-line2);',
    'border-radius:4px;padding:1px 5px;margin-left:5px;font-weight:400}',
    '#page-ai-world-brain #awp-tab::after{content:" · 研发中";color:var(--awb-muted);font-size:10px}',
  ].join('\n');

  function seg(group, value, label, sub, on) {
    return '<button class="seg' + (on ? ' on' : '') + '" data-group="' + group + '" data-value="' + value + '">'
      + esc(label) + (sub ? '<span class="s">' + esc(sub) + '</span>' : '') + '</button>';
  }

  function markup() {
    return ''
      + '<div class="hd"><div><h1 data-i18n="admin.pgAi-world-brain">AI 世界大脑</h1><div class="sub" data-i18n="admin.pgAi-world-brainSub">一句话，把世界建出来</div></div>'
      + '<div class="status" id="awbl-status">状态加载中…</div></div>'
      + '<div class="tabs">'
      + '<button class="tab on" data-tab="region">区域建设</button>'
      + '<button class="tab wip" data-tab="world">世界建设 <span class="wip-tag">研发中</span></button>'
      + '<button class="tab ghost" data-tab="legacy">高级（旧界面）</button></div>'
      + '<div class="legacy-tip">当前是旧版「设置 / 区域与建设 / 世界规划」界面，功能与数据都完整保留。'
      + '其中「世界规划」「长期使命」仍在研发中，暂未开放。点上方「区域建设」回到简化入口。</div>'
      + '<div class="grid"><main>'
      + '<section class="card" id="awbl-form">'
      + '<div class="card-hd"><h2 id="awbl-title">区域建设</h2><span class="hint" id="awbl-hint">一块地，一次成型</span></div>'
      + '<div class="lbl"><span>一句话指令</span><a id="awbl-sample">填入示例</a></div>'
      + '<textarea class="cmd" id="awbl-cmd" placeholder="例如：建一个中世纪风格的小村庄，10 栋房，一条主街">'
      + '建一个中世纪风格的小村庄，10 栋房，一条主街，街边种树和花</textarea>'
      + '<div class="tip">风格直接从指令里识别，不用另选，例如「中世纪小镇」「现代街区」「工业厂房」</div>'
      + '<div class="opt" id="awbl-row-scale"><div class="k">规模</div><div class="ctl">'
      + seg('scale', 'small', '小', '3~5 栋') + seg('scale', 'medium', '中', '8~10 栋', true) + seg('scale', 'large', '大', '12~16 栋')
      + '</div></div>'
      + '<div class="opt" id="awbl-row-pos"><div class="k">位置</div><div class="ctl">'
      + seg('position', 'auto', '自动找空地', '', true) + seg('position', 'spawn', '出生点附近') + seg('position', 'manual', '手填坐标')
      + '</div></div>'
      + '<div class="opt hide" id="awbl-row-manual"><div class="k">坐标</div><div class="ctl">'
      + 'x <input class="mini" id="awbl-x" type="number" value="300">'
      + 'z <input class="mini" id="awbl-z" type="number" value="300">'
      + '<span class="tip" style="margin:0;padding-top:6px">仅限平地 ±1000m</span></div></div>'
      + '<div class="opt hide" id="awbl-row-layout"><div class="k">布局</div><div class="ctl">'
      + seg('layout', 'scatter', '散点村落', '', true) + seg('layout', 'cross', '十字街区') + seg('layout', 'ring', '环形围绕')
      + '</div></div>'
      + '<div class="opt hide" id="awbl-row-count"><div class="k">片区数</div><div class="ctl">'
      + seg('count', '3', '3 片') + seg('count', '5', '5 片', '', true) + seg('count', '8', '8 片')
      + '</div></div>'
      + '<div class="act"><button class="go" id="awbl-go">开始建</button>'
      + '<span class="est" id="awbl-est">约 1200~1500 件 · 1 轮 LLM · 约 10 秒</span></div>'
      + '<div class="note" id="awbl-note"></div>'
      + '<div class="preview hide" id="awbl-preview"></div>'
      + '</section>'
      + '<section class="card hide" id="awbl-wip">'
      + '<div class="card-hd"><h2>世界建设</h2><span class="hint" style="color:var(--awb-amber)">正在研发中</span></div>'
      + '<div class="small" style="line-height:2">这一路要把一条指令按确定性骨架铺成 N 个互不重叠的片区，'
      + '逐片串行建造、汇总总账、整批回滚。选址端点已经能一次给出互不重叠的空地，'
      + '但批量执行与整批回滚尚未实现，因此暂不开放，也不产生任何 token 消耗。<br>'
      + '当前请只使用「区域建设」。旧版「世界规划」「长期使命」同样处于研发中。</div></section>'
      + '<section class="card hide" id="awbl-result"></section>'
      + '</main><aside>'
      + '<section class="card"><div class="card-hd"><h2>运行状态</h2><span class="hint">实时</span></div>'
      + '<div class="metrics" id="awbl-metrics">'
      + '<div class="metric"><div class="n">—</div><div class="t">总闸</div></div>'
      + '<div class="metric"><div class="n">—</div><div class="t">今日调用</div></div>'
      + '<div class="metric"><div class="n">—</div><div class="t">今日 token</div></div>'
      + '<div class="metric"><div class="n">—</div><div class="t">区域总数</div></div>'
      + '</div><div class="small" style="margin-top:12px">人工资产只读，AI 不会改动或覆盖。</div></section>'
      + '<section class="card"><div class="card-hd"><h2>说明</h2></div>'
      + '<div class="small">街道、绿化、路灯与坐标由代码生成；模型只决定风格与建筑清单。'
      + '非建造类诉求会明确拒绝，不硬凑建筑。每批都可一键回滚。</div></section>'
      + '</aside></div>'
      + '<div class="foot">AI 世界大脑 · 简化入口 · 旧界面在「高级」里完整保留</div>';
  }

  function note(text, kind) {
    var el = $('awbl-note');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'note' + (kind ? ' ' + kind : '');
  }
  function busy(on) {
    state.busy = !!on;
    var b = $('awbl-go');
    if (b) { b.disabled = !!on; b.textContent = on ? '执行中…' : (state.tab === 'world' ? '预览建设方案' : '开始建'); }
  }

  function setTab(tab) {
    state.tab = tab;
    root.classList.toggle('mode-world', tab === 'world');
    [].forEach.call(root.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('on', t.getAttribute('data-tab') === tab);
    });
    if (tab === 'legacy') {
      if (hideStyle) hideStyle.textContent = '';
      root.classList.add('legacy-mode');
      return;
    }
    root.classList.remove('legacy-mode');
    if (hideStyle) hideStyle.textContent = HIDE_RULE;
    root.style.display = '';
    if (tab === 'world' && !WORLD_BUILD_ENABLED) {
      $('awbl-form').classList.add('hide');
      $('awbl-wip').classList.remove('hide');
      $('awbl-result').classList.add('hide');
      $('awbl-preview').classList.add('hide');
      note('');
      return;
    }
    $('awbl-form').classList.remove('hide');
    $('awbl-wip').classList.add('hide');
    var world = tab === 'world';
    $('awbl-title').textContent = world ? '世界建设' : '区域建设';
    $('awbl-hint').textContent = world ? '一句话，铺开 N 个片区' : '一块地，一次成型';
    $('awbl-row-scale').classList.toggle('hide', world);
    $('awbl-row-pos').classList.toggle('hide', world);
    $('awbl-row-manual').classList.add('hide');
    $('awbl-row-layout').classList.toggle('hide', !world);
    $('awbl-row-count').classList.toggle('hide', !world);
    $('awbl-preview').classList.add('hide');
    $('awbl-est').textContent = world
      ? '先出干跑预览，不落库、不花 token'
      : C.scaleOf(state.scale).estimate + ' · 1 轮 LLM · 约 10 秒';
    $('awbl-cmd').value = world
      ? '把出生点周围做成一个中世纪小镇'
      : '建一个中世纪风格的小村庄，10 栋房，一条主街，街边种树和花';
    $('awbl-go').textContent = world ? '预览建设方案' : '开始建';
    note('');
  }

  function readOpts() {
    return {
      prompt: String($('awbl-cmd').value || '').trim(),
      scale: state.scale,
      position: state.position,
      manual: { x: $('awbl-x').value, z: $('awbl-z').value },
    };
  }

  function statsOf(result) {
    var s = (result && result.stats) || {};
    return {
      status: (result && result.status) || 'unknown',
      pieces: s.objectsCreated != null ? s.objectsCreated : (s.pieces || 0),
      buildings: s.buildings || 0, roads: s.roads || 0, props: s.props || 0,
      llm: s.llmCalls || 0, ms: s.wallClockMs || 0,
      contract: (s.template && s.template.contractTokens) || 0,
      error: s.error && (s.error.code || s.error.reason) ? s.error : null,
    };
  }

  function renderResult(item) {
    var box = $('awbl-result');
    if (!item) { box.classList.add('hide'); return; }
    box.classList.remove('hide');
    var r = item.result || {};
    var s = statsOf(r);
    var ok = s.status === 'completed' && !item.error;
    var errText = item.error || (s.error ? (s.error.code + (s.error.reason ? '：' + String(s.error.reason).slice(0, 120) : '')) : '');
    var head = ok ? '完成' : ('未完成（' + esc(s.status) + '）');
    var body = ''
      + '<div class="card-hd"><h2>最近一次</h2><span class="hint" style="color:'
      + (ok ? 'var(--awb-green)' : 'var(--awb-amber)') + '">' + head + '</span></div>'
      + '<div class="rowline"><span>区域</span><b>' + esc(item.region && item.region.region_key) + '</b></div>'
      + '<div class="rowline"><span>建了</span><b>' + s.pieces + ' 件</b></div>'
      + '<div class="rowline"><span>房屋 / 街道 / 道具</span><b>' + s.buildings + ' / ' + s.roads + ' / ' + s.props + '</b></div>'
      + '<div class="rowline"><span>耗时 / LLM</span><b>' + (s.ms / 1000).toFixed(1) + ' 秒 / ' + s.llm + ' 轮</b></div>'
      + '<div class="rowline"><span>契约</span><b>' + s.contract + ' token</b></div>'
      + (errText ? '<div class="note bad">失败原因：' + esc(errText) + '</div>' : '')
      + '<div class="links">'
      + (item.mission ? '<a id="awbl-rollback">一键回滚</a>' : '<a class="off">无可回滚委托</a>')
      + '<a id="awbl-again">再建一处</a></div>';
    box.innerHTML = body;
    var rb = $('awbl-rollback');
    if (rb) rb.onclick = function () {
      if (!confirm('回滚本批 AI 产物？人工资产零影响。')) return;
      note('正在回滚…');
      C.rollback(item.mission.id).then(function (j) {
        note('已回滚 ' + (j.rolledBack || 0) + ' 件', 'ok');
        lastResult = null; renderResult(null); loadStatus();
      }).catch(function (e) { note('回滚失败：' + e.message, 'bad'); });
    };
    $('awbl-again').onclick = function () {
      var o = lastOpts || readOpts();
      doBuild(Object.assign({}, o, { label: null }));
    };
  }

  function doBuild(opts) {
    if (state.busy) return;
    if (!opts.prompt) { note('请先写一句话指令', 'bad'); return; }
    lastOpts = opts;
    busy(true);
    note('正在选址…');
    C.buildOnce(opts, function (t) { note(t); }).then(function (item) {
      busy(false);
      lastResult = item;
      renderResult(item);
      if (item.error) { note('失败：' + item.error + (item.mission ? '（可点「一键回滚」清理）' : ''), 'bad'); }
      else {
        var s = statsOf(item.result);
        note(s.status === 'completed'
          ? '完成：' + s.pieces + ' 件 / ' + s.buildings + ' 栋，' + (s.ms / 1000).toFixed(1) + ' 秒'
          : '结束但状态 ' + s.status, s.status === 'completed' ? 'ok' : 'bad');
      }
      loadStatus();
    }).catch(function (e) { busy(false); note('失败：' + e.message, 'bad'); });
  }

  function mapSvg(sites, spawn) {
    var W = 260, H = 176, PAD = 10;
    function px(v) { return PAD + (v + 1000) / 2000 * (W - 2 * PAD); }
    function pz(v) { return PAD + (v + 1000) / 2000 * (H - 2 * PAD); }
    function sx(v) { return v / 2000 * (W - 2 * PAD); }
    function sz(v) { return v / 2000 * (H - 2 * PAD); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="片区分布示意">'
      + '<rect x="8" y="8" width="244" height="160" rx="5" fill="none" stroke="#3b4a5d" stroke-width="1"/>'
      + '<text x="14" y="20" fill="#64748b" font-size="9">平地范围 2000 × 2000</text>';
    sites.forEach(function (p, i) {
      var x = px(p.x), z = pz(p.z), w = Math.max(4, sx(p.width)), d = Math.max(4, sz(p.depth));
      s += '<rect x="' + x.toFixed(1) + '" y="' + z.toFixed(1) + '" width="' + w.toFixed(1)
        + '" height="' + d.toFixed(1) + '" rx="2" fill="#152a44" stroke="#6ba8f5" stroke-width="1"/>'
        + '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (z + d / 2 + 3).toFixed(1)
        + '" fill="#6ba8f5" font-size="9" text-anchor="middle">' + (i + 1) + '</text>';
    });
    if (spawn) {
      s += '<circle cx="' + px(spawn.x).toFixed(1) + '" cy="' + pz(spawn.z).toFixed(1)
        + '" r="3.5" fill="#57d98a"/><text x="' + (px(spawn.x) + 7).toFixed(1)
        + '" y="' + (pz(spawn.z) + 3).toFixed(1) + '" fill="#93a2b6" font-size="9">出生点</text>';
    }
    return s + '</svg>';
  }

  function doPreview() {
    if (!WORLD_BUILD_ENABLED || state.busy) return;
    var text = String($('awbl-cmd').value || '').trim();
    if (!text) { note('请先写一句话指令', 'bad'); return; }
    var n = Number(state.count) || 5;
    busy(true); note('正在选址（' + n + ' 块地，纯只读、不落库）…');
    C.findSites(state.scale, 'auto', null, n).then(function (j) {
      busy(false);
      var sites = j.sites.slice(0, n);
      if (sites.length < n) note('只找到 ' + sites.length + ' 块可用空地（请求 ' + n + ' 块）', 'bad');
      else note('已找到 ' + sites.length + ' 块互不重叠的平地，尚未落库', 'ok');
      var rows = sites.map(function (p, i) {
        return '<div class="rowline"><span>' + (i + 1) + ' · ' + esc(state.layout === 'cross' ? '街区片区' : '建设片区')
          + '</span><b>' + p.x + ', ' + p.z + '</b></div>';
      }).join('');
      var pv = $('awbl-preview');
      pv.classList.remove('hide');
      pv.innerHTML = '<div class="card-hd" style="margin-bottom:10px"><h2 style="font-size:13px">建设方案预览</h2>'
        + '<span class="hint">干跑 · 尚未落库</span></div>'
        + '<div class="pv-grid"><div class="map">' + mapSvg(sites, j.spawn) + '</div>'
        + '<div class="small">' + rows + '<div style="margin-top:8px;color:var(--awb-dim)">均为平地 · 互不重叠 · 不压人工资产</div></div></div>'
        + '<div class="cost"><span>预计 <b>' + (sites.length * 1200) + '~' + (sites.length * 1500) + '</b> 件</span>'
        + '<span><b>' + sites.length + '</b> 次 LLM 调用</span><span>约 <b>' + sites.length * 10 + '</b> 秒</span>'
        + '<span>约 <b>' + sites.length * 1500 + '</b> token</span></div>'
        + '<div class="act" style="margin-top:12px;padding-top:12px">'
        + '<button class="go" disabled>确认执行</button>'
        + '<span class="est">批量建造属第 2 期；当前只做只读预览，不花 token、不写库</span></div>';
    }).catch(function (e) { busy(false); note('预览失败：' + e.message, 'bad'); });
  }

  function loadStatus() {
    C.reloadStatus().then(function (r) {
      var cfg = r.config || {}, u = r.usage || {}, t = u.today || {};
      var provider = (cfg.providerMap && (cfg.providerMap.plan || cfg.providerMap.summary)) || cfg.providerId || '跟随默认';
      var cells = [
        [cfg.enabled ? '开启' : '关闭', '总闸'],
        [t.calls != null ? t.calls : '—', '今日调用'],
        [t.tokens != null ? Number(t.tokens).toLocaleString('zh-CN') : '—', '今日 token'],
        ['—', '区域总数'],
      ];
      $('awbl-status').innerHTML = '<span><i class="dot' + (cfg.enabled ? ' on' : '') + '"></i>总闸 <b>'
        + esc(cfg.enabled ? '开启' : '关闭') + '</b></span><i class="sep"></i><span>Provider <b>'
        + esc(provider) + '</b></span><i class="sep"></i><span>今日 <b>'
        + (t.calls != null ? t.calls : '—') + '</b> 次 / <b>'
        + (t.tokens != null ? Number(t.tokens).toLocaleString('zh-CN') : '—') + '</b> token</span>';
      $('awbl-metrics').innerHTML = cells.map(function (c) {
        return '<div class="metric"><div class="n">' + esc(c[0]) + '</div><div class="t">' + esc(c[1]) + '</div></div>';
      }).join('');
      return C.jreq('GET', '/api/world-ai/regions');
    }).then(function (j) {
      var box = $('awbl-metrics');
      if (box && j && j.regions) {
        var last = box.querySelector('.metric:last-child .n');
        if (last) last.textContent = j.regions.length;
      }
    }).catch(function (e) {
      $('awbl-status').textContent = '状态读取失败：' + e.message;
    });
  }

  function bind() {
    [].forEach.call(root.querySelectorAll('.tab'), function (t) {
      t.onclick = function () { setTab(t.getAttribute('data-tab')); };
    });
    root.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.seg') : null;
      if (!b || !root.contains(b)) return;
      var g = b.getAttribute('data-group');
      [].forEach.call(root.querySelectorAll('.seg[data-group="' + g + '"]'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      state[g] = b.getAttribute('data-value');
      if (g === 'scale') {
        $('awbl-est').textContent = C.scaleOf(state.scale).estimate + ' · 1 轮 LLM · 约 10 秒';
      }
      if (g === 'position') {
        $('awbl-row-manual').classList.toggle('hide', state.position !== 'manual');
      }
    });
    $('awbl-sample').onclick = function () {
      $('awbl-cmd').value = state.tab === 'world'
        ? '把出生点周围做成一个中世纪小镇，五片居住区，街边种树和花'
        : '建一个现代街区，8 栋房，中间一条街，街边种树';
      $('awbl-cmd').focus();
    };
    $('awbl-go').onclick = function () {
      if (state.tab === 'world') { if (WORLD_BUILD_ENABLED) doPreview(); return; }
      doBuild(readOpts());
    };
  }

  function build(page) {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    hideStyle = document.createElement('style');
    hideStyle.textContent = HIDE_RULE;
    document.head.appendChild(hideStyle);
    root = document.createElement('div');
    root.id = 'awb-lite-root';
    root.innerHTML = markup();
    page.appendChild(root);
    // i18n：注入后才翻译；i18n 未就绪则保持中文兜底，稍后 admin.html 初始化会统一刷一遍
    try {
      if (window.i18n && window.i18n.initialized && typeof window.applyAdminTranslations === 'function') {
        window.applyAdminTranslations();
      }
    } catch (e) { /* ignore */ }
    bind();
    loadStatus();
  }

  function boot() {
    var page = document.getElementById('page-ai-world-brain');
    if (!page) return false;
    if (document.getElementById('awb-lite-root')) return true;
    try { build(page); } catch (e) { console.error('[awb-lite] 构建失败', e); return false; }
    return true;
  }

  var tries = 0;
  var iv = setInterval(function () {
    if (boot() || ++tries > 60) clearInterval(iv);
  }, 250);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.adminWorldBrainLite = { boot: boot, setTab: setTab };
})();
