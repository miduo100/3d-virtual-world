/**
 * adminMissionPanel —— 后台「🎯 长期使命」卡（AI World Brain · Phase 7b · §I.6）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 零结构侵入：自注入到「📋 世界规划」sub-tab（#ai-world-brain-sub-awb-plan）**置顶**，
 * admin.html 只加 1 行 script。按钮：启动/暂停/恢复/终止 · 看月报（含三选回答）· 调整方向 ·
 * 里程碑评审 · 手动补跑周计划/月报。暴露 window.adminMission。
 */
(function () {
  'use strict';
  const API = '/api/world-ai';
  const $ = (id) => document.getElementById(id);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function days(iso) { return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000)) : 0; }

  async function jreq(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const tk = localStorage.getItem('adminToken');
    opt.headers.Authorization = 'Bearer ' + (tk ? tk : '');
    const res = await fetch(url, opt);
    let j = null; try { j = await res.json(); } catch (e) { j = {}; }
    if (!res.ok || j.success === false) throw new Error((j && (j.error || j.reason || j.code)) || ('HTTP ' + res.status));
    return j;
  }

  let built = false;
  let modalBuilt = false;

  function build() {
    if (built) return;
    const wrap = $('ai-world-brain-sub-awb-plan');
    if (!wrap) return;
    built = true;
    const card = document.createElement('div');
    card.className = 'awb-panel';
    card.style.cssText = 'margin-bottom:12px;border:1px solid var(--border);border-left:4px solid var(--green);';
    card.innerHTML =
      '<h3>🎯 长期使命 <span id="am-st" style="font-weight:400;font-size:12px;color:#888;"></span></h3>' +
      '<div id="am-body" style="font-size:13px;line-height:1.7;">加载中…</div>' +
      '<div class="awb-inline" style="margin-top:8px;">' +
        '<button id="am-start" class="am-btn">▶ 启动</button>' +
        '<button id="am-pause" class="am-btn">⏸ 暂停</button>' +
        '<button id="am-resume" class="am-btn">⏵ 恢复</button>' +
        '<button id="am-report" class="am-btn">📄 看月报</button>' +
        '<button id="am-adjust" class="am-btn">🧭 调整方向</button>' +
        '<button id="am-review" class="am-btn">🏁 里程碑评审</button>' +
        '<button id="am-tickw" class="am-btn">🔄 补跑周计划</button>' +
        '<button id="am-tickm" class="am-btn">🔄 补跑月报</button>' +
        '<button id="am-terminate" class="am-btn" style="color:var(--red);">⏹ 终止</button>' +
      '</div>' +
      '<div id="am-msg" class="awb-msg"></div>';
    wrap.insertBefore(card, wrap.firstChild);
    const st = document.createElement('style');
    st.textContent = '.am-btn{border:1px solid var(--border);background:var(--card-bg);border-radius:8px;padding:5px 12px;cursor:pointer;font-size:12px;margin:2px 2px 2px 0;}.am-btn:hover{border-color:var(--green);}';
    document.head.appendChild(st);
    $('am-start').onclick = () => act('start');
    $('am-pause').onclick = () => act('pause');
    $('am-resume').onclick = () => act('resume');
    $('am-finish') && 0;
    $('am-terminate').onclick = () => { if (confirm('终止使命？只停循环，不删除任何已建内容。')) act('terminate'); };
    $('am-report').onclick = showReport;
    $('am-adjust').onclick = adjust;
    $('am-review').onclick = review;
    $('am-tickw').onclick = () => tick('tick-weekly');
    $('am-tickm').onclick = () => tick('tick-monthly');
    load();
  }

  function msg(t, ok) {
    const el = $('am-msg');
    if (!el) return;
    el.textContent = t;
    el.style.color = ok ? 'var(--green)' : 'var(--red)';
    setTimeout(() => { if (el.textContent === t) el.textContent = ''; }, 6000);
  }

  async function load() {
    try {
      const j = await jreq('GET', API + '/long-missions');
      const m = j.active;
      const stEl = $('am-st');
      if (!m) {
        stEl.textContent = '（未设定）';
        $('am-body').innerHTML =
          '<div class="awb-redline">还没有长期使命。使命 = 管一两年方向的章程（阶段由它拆出）。</div>' +
          '<div class="awb-field"><label>使命文本（1~2 年不变）</label><textarea id="am-new-statement" rows="2" style="width:100%;" placeholder="例如：把这个世界经营成有烟火气的中世纪小镇，两年内日活玩家 30+"></textarea></div>' +
          '<div class="awb-field"><label>阶段拆分（可选，每行一条「标题|目标|里程碑标准(可选)」，1~8 条；留空用默认 4 阶段模板）</label><textarea id="am-new-phases" rows="4" style="width:100%;" placeholder="摸底与试点|选 1 个区域小步建设，跑通规划→审批→执行→验证闭环|区域整洁且可交互&#10;规模化建设|按北极星指标铺开内容，覆盖冷区激活&#10;活动与留存|组织周期性活动拉参与率&#10;评审交接|里程碑评审并沉淀经验"></textarea></div>' +
          '<button id="am-create" class="am-btn" style="background:var(--green);color:#08130c;font-weight:600;">✔ 设定使命</button>';
        $('am-create').onclick = create;
        return;
      }
      const phases = m.phases || [];
      const cur = phases.find((p) => Number(p.seq) === Number(m.currentPhase)) || null;
      const doneN = phases.filter((p) => p.status === 'done').length;
      stEl.textContent = '（' + m.status + (m.startedAt ? ' · 已运行 ' + days(m.startedAt) + ' 天' : '') + '）';
      const b = j.budget || {};
      $('am-body').innerHTML =
        '<div><b>使命：</b>' + esc(m.statement) + (m.pendingStatement ? ' <span style="color:var(--green);">（已提交新方向，自第 ' + (m.currentPhase + 1) + ' 阶段起生效）</span>' : '') + '</div>' +
        '<div><b>阶段进度：</b>第 ' + m.currentPhase + '/' + phases.length + ' 阶段（已完成 ' + doneN + '）</div>' +
        '<div style="background:var(--border);border-radius:6px;height:8px;margin:4px 0;"><div style="width:' + (phases.length ? Math.round(doneN / phases.length * 100) : 0) + '%;height:8px;border-radius:6px;background:var(--green);"></div></div>' +
        '<div><b>本阶段目标：</b>' + (cur ? esc(cur.title) + '：' + esc(cur.goal) : '（无）') + (m.pausedReason ? ' <span style="color:var(--red);">⏸ ' + esc(m.pausedReason) + '</span>' : '') + '</div>' +
        '<div><b>本周计划：</b>' + (m.weeklyPlan && m.weeklyPlan.title
          ? esc(m.weeklyPlan.title) + '（' + esc(m.weeklyPlan.source || '-') + (m.weeklyPlan.flagged ? ' · <span style="color:var(--red);">生成失败已降级</span>' : '') + '，' + ((m.weeklyPlan.actions || []).length) + ' 个动作）'
          : '（本周尚未生成）') + '</div>' +
        '<div><b>本月预算用量：</b>' + (b.usage
          ? 'tokens ' + b.usage.tokens + '/' + (b.limits && b.limits.tokens ? b.limits.tokens : '不限')
            + ' · objects ' + b.usage.objects + '/' + (b.limits && b.limits.objects ? b.limits.objects : '不限')
            + ' · demolitions ' + b.usage.demolitions + '/' + (b.limits && b.limits.demolitions ? b.limits.demolitions : '不限')
          : '（无）') + (b.ok === false ? ' <span style="color:var(--red);">已超限，本月不再发起新委托</span>' : '') + '</div>' +
        (m.status === 'awaiting_review' && m.reviewOptions
          ? '<div style="color:var(--red);">⏳ 里程碑未达标，等待采纳调整方案：</div>' +
            m.reviewOptions.map((o, i) => '<div>· [' + (i + 1) + '] ' + esc(o) + '</div>').join('') +
            '<div class="awb-inline">' + m.reviewOptions.map((o, i) => '<button class="am-btn" onclick="adminMission.adopt(' + i + ')">采纳 [' + (i + 1) + ']</button>').join('') + '</div>'
          : '');
    } catch (e) {
      $('am-body').textContent = '加载失败：' + e.message;
    }
  }

  async function create() {
    try {
      const statement = $('am-new-statement').value.trim();
      if (!statement) return msg('请填写使命文本', false);
      const body = { statement };
      // 阶段自定义（Phase 7b 遗留③）：每行「标题|目标|里程碑可选」，1~8 条；留空走后端默认模板
      const raw = ($('am-new-phases') && $('am-new-phases').value.trim()) || '';
      if (raw) {
        const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
        if (lines.length > 8) return msg('阶段最多 8 条（当前 ' + lines.length + ' 条）', false);
        const phases = [];
        for (let i = 0; i < lines.length; i++) {
          const parts = lines[i].split('|').map((s) => s.trim());
          if (parts.length < 2 || !parts[0] || !parts[1]) {
            return msg('第 ' + (i + 1) + ' 行格式不对：每行「标题|目标」（里程碑可选第 3 段）', false);
          }
          phases.push({ title: parts[0], goal: parts[1], milestoneCheck: parts[2] || '' });
        }
        body.phases = phases;
      }
      await jreq('POST', API + '/long-missions', body);
      msg('使命已创建（draft，' + (body.phases ? body.phases.length + ' 个自定义阶段' : '默认 4 阶段模板') + '），点「▶ 启动」开始运行', true);
      load();
    } catch (e) { msg('创建失败：' + e.message, false); }
  }

  async function act(action) {
    try {
      await jreq('POST', API + '/missions/current/' + action, {});
      msg('已执行：' + action, true);
      load();
    } catch (e) { msg('失败：' + e.message, false); }
  }

  async function tick(kind) {
    try {
      const j = await jreq('POST', API + '/missions/' + kind, {});
      if (j.result && j.result.flagged) msg('已降级处理（沿用上周/待重试）', false);
      else msg('已执行：' + kind, true);
      load();
    } catch (e) { msg('失败：' + e.message, false); }
  }

  async function adjust() {
    const cur = prompt('输入新的使命方向（自下一阶段起生效，当前阶段按原目标跑完）：');
    if (!cur) return;
    try {
      const j = await jreq('POST', API + '/missions/current/adjust', { statement: cur });
      msg('新方向已保存，自第 ' + j.effectiveFromPhase + ' 阶段起生效', true);
      load();
    } catch (e) { msg('失败：' + e.message, false); }
  }

  async function review() {
    const passed = confirm('里程碑评审：确定=达标进入下一阶段；取消=不达标（AI 给 3 个调整方案）');
    try {
      await jreq('POST', API + '/missions/current/review', { passed });
      msg(passed ? '已进入下一阶段' : '已转待评审（见卡片中的方案）', true);
      load();
    } catch (e) { msg('失败：' + e.message, false); }
  }

  async function adopt(i) {
    try {
      await jreq('POST', API + '/missions/current/review-choice', { choice: i });
      msg('已采纳方案 [' + (i + 1) + ']', true);
      load();
    } catch (e) { msg('失败：' + e.message, false); }
  }

  async function showReport() {
    try {
      const j = await jreq('GET', API + '/long-missions');
      const m = j.active;
      if (!m || !m.lastReport) return msg('还没有月报（每月一次，可点「补跑月报」）', false);
      const r = m.lastReport;
      const q = r.pendingQuestion || {};
      if (!modalBuilt) {
        modalBuilt = true;
        const md = document.createElement('div');
        md.id = 'am-report-modal';
        md.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:none;align-items:center;justify-content:center;';
        md.innerHTML = '<div style="background:var(--card-bg);color:var(--text);border-radius:12px;max-width:680px;width:92%;max-height:82vh;overflow:auto;padding:20px;border:1px solid var(--border);">' +
          '<h3 style="margin-top:0;">📄 月报 <span id="am-rp-month"></span></h3>' +
          '<div id="am-rp-body" style="font-size:13px;line-height:1.8;"></div>' +
          '<div id="am-rp-q" style="margin-top:10px;"></div>' +
          '<div style="margin-top:12px;text-align:right;"><button class="am-btn" onclick="document.getElementById(\'am-report-modal\').style.display=\'none\'">关闭</button></div>' +
        '</div>';
        document.body.appendChild(md);
        md.addEventListener('click', (e) => { if (e.target === md) md.style.display = 'none'; });
      }
      $('am-rp-month').textContent = r.month || '';
      $('am-rp-body').innerHTML =
        '<div><b>做了什么：</b>' + esc(r.did) + '</div>' +
        '<div><b>数据对比：</b>visits 本月 ' + (r.dataCompare ? r.dataCompare.visitsThisMonth : '-') + ' / 上月 ' + (r.dataCompare ? r.dataCompare.visitsLastMonth : '-') +
          '；tokens ' + (r.dataCompare ? r.dataCompare.llmTokens : '-') + '；建 ' + (r.dataCompare ? r.dataCompare.objectsBuilt : '-') + ' 拆 ' + (r.dataCompare ? r.dataCompare.demolitions : '-') + '</div>' +
        '<div><b>承诺兑现：</b>' + esc(r.promises) + '</div>' +
        '<div><b>下月打算：</b>' + esc(r.nextMonth) + '</div>';
      $('am-rp-q').innerHTML = q.question
        ? '<div class="awb-redline"><b>需要你决定：</b>' + esc(q.question) + '</div>' +
          (q.answered
            ? '<div>已回答：' + esc(q.answered.choiceText) + (q.answered.note ? '（' + esc(q.answered.note) + '）' : '') + '</div>'
            : '<div class="awb-inline">' +
              '<button class="am-btn" onclick="adminMission.answer(0)">A</button>' +
              '<button class="am-btn" onclick="adminMission.answer(1)">B</button>' +
              '<button class="am-btn" onclick="adminMission.answer(2)">听 AI 的</button>' +
              '<span style="font-size:12px;color:#888;">30 天不回答会自动暂停使命</span></div>')
        : '';
      $('am-report-modal').style.display = 'flex';
    } catch (e) { msg('月报加载失败：' + e.message, false); }
  }

  async function answer(choice) {
    const note = choice === 1 ? (prompt('调整方向说明（可空）：') || '') : '';
    try {
      await jreq('POST', API + '/missions/current/answer', { choice, note });
      msg('已回答', true);
      $('am-report-modal').style.display = 'none';
      load();
    } catch (e) { msg('失败：' + e.message, false); }
  }

  // 惰性构建：sub-tab 切到「世界规划」时卡片区已存在；轮询等待容器出现
  const timer = setInterval(() => {
    if (built) { clearInterval(timer); return; }
    try { build(); } catch (e) { /* 容器未就绪，下轮再试 */ }
  }, 1200);
  if (timer.unref) timer.unref();
  try { build(); } catch (e) { /* ignore */ }

  window.adminMission = { load, adopt, answer, build };
})();
