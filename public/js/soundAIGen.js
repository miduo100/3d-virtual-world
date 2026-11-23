/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundAIGen.js —— 音效库 ④ AI 生成声音（文生音效 + 入库）
 *
 * 流程：填提示词 → 生成（可一次出多个变体）→ 试听挑选 → 入库
 *
 * 为什么「生成」和「入库」分两步：
 *   sounds 目录是全局共享素材池，文件名即引用键。生成就直接入库的话，
 *   一轮 4 个变体会往目录里塞 4 个文件，其中 3 个是废的，还会被资产清单全列出来。
 *   所以生成结果先落在 .tmp/ 临时目录（不在扫描白名单里），入库时才写正式目录。
 *
 * 提示词怎么写才出好效果（六段式，见下方示例）：
 *   来源 + 动作 + 材质 + 空间 + 时长 + 视角
 *   ❌ "爆炸"     ✅ "金属门猛地关上，铁铰链刺耳尖响，在长石廊里回荡，3 秒，近距离收音"
 */
(function () {
  'use strict';

  var S = { mounted: false, jobs: [], generating: false, playing: null };

  function token() { try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(id) { return document.getElementById(id); }

  var CSS = [
    '.sg-wrap{max-width:900px}',
    '.sg-form{display:flex;flex-direction:column;gap:9px;margin-bottom:12px}',
    '.sg-lbl{font-size:11px;color:var(--muted)}',
    '.sg-ta{background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:8px 10px;font-size:12px;line-height:1.6;resize:vertical;min-height:64px;font-family:inherit;width:100%;box-sizing:border-box}',
    '.sg-ta:focus{outline:none;border-color:var(--green)}',
    '.sg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.sg-row select,.sg-row input{background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:4px 7px;font-size:12px}',
    '.sg-row input[type=number]{width:74px}',
    '.sg-hint{font-size:11px;color:var(--muted);line-height:1.7;margin:2px 0 10px}',
    '.sg-ex{font-size:11px;color:var(--muted);line-height:1.8;margin-bottom:12px;border-left:2px solid var(--green);padding-left:9px}',
    '.sg-ex b{color:var(--text);font-weight:500}',
    '.sg-list{border-top:1px solid var(--border)}',
    '.sg-job{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.05);flex-wrap:wrap}',
    '.sg-job:hover{background:rgba(255,255,255,0.03)}',
    '.sg-prompt{flex:1;min-width:200px;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sg-meta{font-size:11px;color:var(--muted);white-space:nowrap}',
    '.sg-status{font-size:11px;padding:1px 7px;border-radius:3px;border:1px solid;white-space:nowrap}',
    '.sg-btn{background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:4px 10px;font-size:12px;cursor:pointer}',
    '.sg-btn:hover:not(:disabled){background:rgba(255,255,255,0.12)}',
    '.sg-btn:disabled{opacity:0.45;cursor:not-allowed}',
    '.sg-btn-pri{background:rgba(0,255,0,0.12);border-color:rgba(0,255,0,0.4);color:var(--green)}',
    '.sg-err{font-size:12px;color:#ff6b6b;padding:8px 10px;border-left:3px solid #ff6b6b;background:rgba(255,107,107,0.08);border-radius:4px;margin-bottom:10px;line-height:1.7}',
    '.sg-err-hint{font-size:11px;color:var(--muted);margin-top:4px}',
    '.sg-empty{padding:22px;text-align:center;color:var(--muted);font-size:12px}',
    '.sg-loading{display:inline-block;width:11px;height:11px;border:2px solid var(--green);border-right-color:transparent;border-radius:50%;animation:sgspin .7s linear infinite;vertical-align:-1px;margin-right:6px}',
    '@keyframes sgspin{to{transform:rotate(360deg)}}'
  ].join('\n');

  async function api(path, opt) {
    var r = await fetch(path, Object.assign({
      headers: { 'Authorization': 'Bearer ' + token() }
    }, opt || {}));
    var b = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status));
    return b;
  }

  function kb(n) {
    if (n == null) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function toast(msg, isErr) {
    var t = document.createElement('div');
    t.textContent = (isErr ? '❌ ' : '✅ ') + msg;
    t.style.cssText = 'position:fixed;top:18px;right:18px;background:' + (isErr ? 'rgba(255,80,80,0.16)' : 'rgba(0,255,0,0.15)') +
      ';border:1px solid ' + (isErr ? '#ff5050' : '#00ff00') + ';color:' + (isErr ? '#ff8080' : '#00ff00') +
      ';padding:7px 12px;border-radius:6px;font-size:12px;z-index:9999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, isErr ? 5000 : 2400);
  }

  // ─── 试听 ────────────────────────────────────────────────────

  function stopPlay() {
    if (S.playing) { try { S.playing.pause(); } catch (e) {} }
    S.playing = null;
    document.querySelectorAll('.sg-btn[data-act="play"]').forEach(function (b) { b.textContent = '▶ 试听'; });
  }

  function play(url, btn) {
    stopPlay();
    var a = new Audio(url);
    a.play().then(function () {
      S.playing = a;
      if (btn) btn.textContent = '■ 停止';
      a.onended = function () { stopPlay(); };
    }).catch(function (e) {
      toast('播放失败：' + e.message, true);
    });
  }

  // ─── 渲染 ────────────────────────────────────────────────────

  function statusTag(j) {
    if (j.status === 'succeeded') {
      return '<span class="sg-status" style="color:#5DCAA5;border-color:#5DCAA555;background:#5DCAA512">已生成</span>';
    }
    if (j.status === 'failed') {
      return '<span class="sg-status" style="color:#ff8080;border-color:#ff808055;background:#ff808012">失败</span>';
    }
    return '<span class="sg-status" style="color:#EF9F27;border-color:#EF9F2755;background:#EF9F2712">' + esc(j.status) + '</span>';
  }

  function jobRow(j) {
    var h = '<div class="sg-job">';
    h += statusTag(j);
    h += '<span class="sg-prompt" title="' + esc(j.prompt) + '">' + esc(j.prompt) + '</span>';
    h += '<span class="sg-meta">' + kb(j.sizeBytes) +
      (j.actualDuration ? ' · ' + Number(j.actualDuration).toFixed(1) + 's' : '') +
      (j.latencyMs ? ' · ' + (j.latencyMs / 1000).toFixed(1) + 's 生成' : '') + '</span>';

    if (j.status === 'succeeded' && j.previewUrl) {
      h += '<button class="sg-btn" data-act="play" data-url="' + esc(j.previewUrl) + '">▶ 试听</button>';
      if (j.imported) {
        h += '<span class="sg-meta" style="color:var(--green)">已入库</span>';
      } else {
        h += '<button class="sg-btn sg-btn-pri" data-act="import" data-id="' + esc(j.id) + '">入库</button>';
        h += '<button class="sg-btn" data-act="discard" data-id="' + esc(j.id) + '">丢弃</button>';
      }
    }
    h += '</div>';
    return h;
  }

  function render() {
    var box = $('sg-list');
    if (!box) return;
    if (!S.jobs.length) {
      box.innerHTML = '<div class="sg-empty">还没有生成记录。填上面的提示词，点「生成」试试。</div>';
      return;
    }
    box.innerHTML = S.jobs.map(jobRow).join('');
  }

  function bindList() {
    var box = $('sg-list');
    if (!box || box._bound) return;
    box._bound = true;
    box.addEventListener('click', async function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');

      if (act === 'play') {
        var url = btn.getAttribute('data-url');
        if (S.playing && btn.textContent === '■ 停止') { stopPlay(); return; }
        play(url, btn);
        return;
      }

      if (act === 'import') {
        btn.disabled = true;
        var name = prompt('素材名称（留空则用提示词自动命名）', '');
        if (name === null) { btn.disabled = false; return; }
        try {
          var d = await api('/api/sound-scenes/sfx/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
            body: JSON.stringify({ jobId: id, name: name || '' })
          });
          var msg = '已入库：' + d.name + '（' + kb(d.size) + '）';
          if (d.compressRatio) msg += '，体积降到 1/' + d.compressRatio;
          toast(msg);
          await loadJobs();
        } catch (err) {
          toast('入库失败：' + err.message, true);
          btn.disabled = false;
        }
        return;
      }

      if (act === 'discard') {
        btn.disabled = true;
        try {
          await api('/api/sound-scenes/sfx/jobs/' + encodeURIComponent(id), { method: 'DELETE' });
          toast('已丢弃');
          await loadJobs();
        } catch (err) {
          toast('丢弃失败：' + err.message, true);
          btn.disabled = false;
        }
      }
    });
  }

  async function loadJobs() {
    try {
      var d = await api('/api/sound-scenes/sfx/jobs?limit=30');
      S.jobs = d.jobs || [];
    } catch (e) {
      S.jobs = [];
    }
    render();
  }

  // ─── 生成 ────────────────────────────────────────────────────

  async function doGenerate() {
    if (S.generating) return;
    var prompt = ($('sg-prompt') && $('sg-prompt').value || '').trim();
    if (!prompt) { toast('请先填提示词', true); return; }

    var dur = parseFloat($('sg-dur') && $('sg-dur').value) || 0;
    var count = parseInt(($('sg-count') && $('sg-count').value) || '1', 10);
    var btn = $('sg-go');
    S.generating = true;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="sg-loading"></span>生成中…'; }

    var errBox = $('sg-err');
    if (errBox) errBox.style.display = 'none';

    try {
      var d = await api('/api/sound-scenes/sfx/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        body: JSON.stringify({
          prompt: prompt,
          durationSec: dur || undefined,
          count: count || 1
        })
      });
      await loadJobs();
      if (d.failed && d.failed.length) {
        var f = d.failed[0];
        if (errBox) {
          errBox.style.display = 'block';
          errBox.innerHTML = esc(f.error || '生成失败') +
            (f.hint ? '<div class="sg-err-hint">' + esc(f.hint) + '</div>' : '');
        }
        toast('生成失败', true);
      } else {
        toast('生成完成，共 ' + (d.jobs || []).length + ' 条');
      }
    } catch (e) {
      if (errBox) {
        errBox.style.display = 'block';
        errBox.innerHTML = esc(e.message);
      }
      toast('生成失败：' + e.message, true);
    } finally {
      S.generating = false;
      if (btn) { btn.disabled = false; btn.textContent = '生成'; }
    }
  }

  // ─── 挂载 ────────────────────────────────────────────────────

  function mount(container) {
    if (!container) return;
    if (!S.mounted) {
      var st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      S.mounted = true;
    }

    container.innerHTML =
      '<div class="sg-wrap">' +
        '<div class="sg-form">' +
          '<label class="sg-lbl" for="sg-prompt">提示词（描述你想要的声音）</label>' +
          '<textarea id="sg-prompt" class="sg-ta" placeholder="例：金属门猛地关上，铁铰链刺耳尖响，在长石廊里回荡，3 秒，近距离收音"></textarea>' +
          '<div class="sg-row">' +
            '<label class="sg-lbl" for="sg-dur">时长(秒)</label>' +
            '<input id="sg-dur" type="number" min="0" max="120" placeholder="留空自动" />' +
            '<label class="sg-lbl" for="sg-count">变体数</label>' +
            '<select id="sg-count">' +
              '<option value="1">1</option><option value="2">2</option>' +
              '<option value="3">3</option><option value="4">4</option>' +
            '</select>' +
            '<span style="flex:1"></span>' +
            '<button class="sg-btn sg-btn-pri" id="sg-go">生成</button>' +
          '</div>' +
        '</div>' +
        '<div class="sg-err" id="sg-err" style="display:none"></div>' +
        '<div class="sg-ex">' +
          '<b>怎么写提示词才出好效果</b>：六段式 —— 来源 + 动作 + 材质 + 空间 + 时长 + 视角。<br />' +
          '❌ <span style="color:#ff8080">爆炸</span>　✅ <span style="color:#5DCAA5">重型油桶爆炸，金属桶身撕裂飞散，碎片弹到混凝土地面，在空旷仓库里轰鸣，2 秒，近距离</span><br />' +
          '一次多生成几个变体再挑，比反复改提示词快得多。' +
        '</div>' +
        '<div class="sg-list" id="sg-list"></div>' +
      '</div>';

    var go = $('sg-go');
    if (go) go.addEventListener('click', doGenerate);
    var ta = $('sg-prompt');
    if (ta) {
      ta.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doGenerate(); }
      });
    }
    bindList();
    loadJobs();
  }

  window.SoundAIGen = { mount: mount };
})();
