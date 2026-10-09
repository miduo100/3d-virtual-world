/**
 * adminWorldPlan —— 后台「🧠 AI 世界大脑 → 📋 世界规划」（AI World Brain · Phase 3）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 目标 CRUD → 生成 5 阶段规划（draft）→ 人工编辑（revision+1 回 draft）→ 提交 → 批/驳。
 * ★ Phase 3 铁律：approve 之前 AI 不能改世界；执行尝试在 Phase 4 工具注册后才有意义
 *   （现在批了会明确报 TOOL_NOT_REGISTERED——这是设计内行为，不是故障）。
 * 零结构侵入：sub-tab 与容器自注入，admin.html 只加 1 行 script；暴露 window.adminWorldPlan。
 */
(function () {
  'use strict';
  const API = '/api/world-ai';
  const $ = (id) => document.getElementById(id);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function msg(t, ok) {
    const el = $('awp-msg');
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
    if (!res.ok || j.success === false) throw new Error((j && (j.error || j.reason || j.message)) || ('HTTP ' + res.status));
    return j;
  }
  const ST_COLORS = { draft: '#888', review: '#c80', approved: '#2a2', rejected: '#c33', executing: '#26c', paused: '#a60', completed: '#080', superseded: '#999' };

  let built = false;
  function build() {
    if (built) return;
    const page = $('page-ai-world-brain');
    if (!page) return;
    const bar = page.querySelector('div[style*="border-bottom"]');
    if (!bar) return;
    built = true;
    bar.insertAdjacentHTML('beforeend',
      '<button class="sub-tab" id="awp-tab" onclick="switchSubTab(\'ai-world-brain\',\'awb-plan\',this)">📋 世界规划</button>');
    const wrap = document.createElement('div');
    wrap.id = 'ai-world-brain-sub-awb-plan';
    wrap.className = 'sub-page';
    wrap.style.display = 'none';
    wrap.innerHTML =
      '<div class="awb-panel" style="margin-bottom:12px;"><h3>🎯 世界目标</h3>' +
        '<div class="awb-field"><label>目标标题</label><input type="text" id="awp-gtitle" maxlength="200" style="width:100%;" placeholder="例如：把出生点附近做成有生活气息的小镇"></div>' +
        '<div class="awb-field"><label>愿景（长文本，AI 规划的输入）</label><textarea id="awp-gvision" rows="3" style="width:100%;" placeholder="描述你想要的世界样子……"></textarea></div>' +
        '<div class="awb-field"><label>硬性规则（每行一条，AI 不可违反）</label><textarea id="awp-ghard" rows="2" style="width:100%;" placeholder="不能破坏管理员手建的资产&#10;新建筑必须贴地"></textarea></div>' +
        '<div class="awb-field"><label>偏好（每行一条）</label><textarea id="awp-gsoft" rows="2" style="width:100%;" placeholder="多建社交聚集点"></textarea></div>' +
        '<label style="display:block;margin:6px 0;"><input type="checkbox" id="awp-gprimary"> 设为主目标（同时只一个）</label>' +
        '<button id="awp-gcreate" style="background:var(--green);color:#08130c;font-weight:600;border:none;border-radius:8px;padding:7px 16px;cursor:pointer;">✔ 保存目标</button>' +
        '<div id="awp-goals" style="margin-top:10px;"></div>' +
      '</div>' +
      '<div class="awb-panel" style="margin-bottom:12px;"><h3>🗺️ 规划（5 阶段 · draft → review → approved）</h3>' +
        '<div class="awb-redline">Phase 3 结束时 AI <b>仍不能改世界</b>：approve 后执行会因工具未注册明确失败（Phase 4 注册工具后生效）——这是设计内行为，不是故障。</div>' +
        '<div class="awb-inline" style="margin:8px 0;">用目标 <select id="awp-gsel" style="max-width:340px;"></select>' +
        ' <button id="awp-gen" style="border:none;border-radius:8px;padding:7px 14px;cursor:pointer;background:#2b6cb0;color:#fff;">✨ 生成规划</button></div>' +
        '<div id="awp-msg" class="awb-msg"></div>' +
        '<div id="awp-plans"></div>' +
        '<div id="awp-detail"></div>' +
      '</div>';
    page.appendChild(wrap);
    $('awp-gcreate').onclick = createGoal;
    $('awp-gen').onclick = generate;
    loadGoals();
    loadPlans();
  }

  const lines = (id) => String($(id).value || '').split('\n').map((s) => s.trim()).filter(Boolean);
  async function createGoal() {
    try {
      await jreq('POST', API + '/goals', {
        title: $('awp-gtitle').value, vision: $('awp-gvision').value,
        hardRules: lines('awp-ghard'), softPrefs: lines('awp-gsoft'), isPrimary: $('awp-gprimary').checked,
      });
      msg('目标已保存', true);
      loadGoals();
    } catch (e) { msg('保存失败：' + e.message, false); }
  }
  async function loadGoals() {
    try {
      const j = await jreq('GET', API + '/goals');
      $('awp-goals').innerHTML = (j.goals || []).map((g) =>
        '<div style="padding:6px 10px;border-left:3px solid ' + (g.is_primary ? 'var(--green)' : '#3a4a66') + ';margin:4px 0;background:rgba(255,255,255,.04);">' +
        '<b>' + esc(g.title) + '</b>' + (g.is_primary ? ' <span style="color:var(--green)">★主目标</span>' : '') +
        '<div style="color:#9ab;font-size:12px;">' + esc((g.vision || '').slice(0, 120)) + '</div>' +
        '<div style="color:#789;font-size:11px;">硬规则 ' + (g.hard_rules || []).length + ' 条 · 偏好 ' + (g.soft_prefs || []).length + ' 条</div></div>'
      ).join('') || '<div style="color:#889;">还没有目标——先写一个。</div>';
      $('awp-gsel').innerHTML = (j.goals || []).map((g) => '<option value="' + g.id + '">' + esc(g.title) + (g.is_primary ? ' ★' : '') + '</option>').join('');
    } catch (e) { /* 静默：面板未打开时 */ }
  }
  async function generate() {
    const goalId = $('awp-gsel').value;
    if (!goalId) { msg('先选一个目标', false); return; }
    try {
      const j = await jreq('POST', API + '/plans/generate', { goalId: goalId });
      msg('已生成规划「' + j.plan.title + '」v' + j.plan.version + '（draft，' + (j.stats ? j.stats.steps : '?') + ' 步）——请人工审阅', true);
      loadPlans();
    } catch (e) { msg('生成失败：' + e.message, false); }
  }
  async function loadPlans() {
    try {
      const j = await jreq('GET', API + '/plans');
      $('awp-plans').innerHTML = (j.plans || []).map((p) => {
        const c = ST_COLORS[p.status] || '#888';
        return '<div style="padding:8px 10px;border-left:3px solid ' + c + ';margin:6px 0;background:rgba(255,255,255,.04);cursor:pointer;" onclick="adminWorldPlan.open(\'' + p.id + '\')">' +
          '<b>' + esc(p.title) + '</b> <span style="color:' + c + '">[' + p.status + ']</span> v' + p.version + ' rev' + p.revision +
          ' <span style="color:#9ab;font-size:12px;">' + (p.step_count || 0) + ' 步</span>' +
          '<div style="color:#789;font-size:11px;">' + esc((p.summary || '').slice(0, 140)) + '</div></div>';
      }).join('') || '<div style="color:#889;">还没有规划。</div>';
    } catch (e) { /* 静默 */ }
  }
  async function open(id) {
    try {
      const j = await jreq('GET', API + '/plans/' + id);
      const p = j.plan;
      const byPhase = {};
      (j.steps || []).forEach((s) => { (byPhase[s.phase_no] = byPhase[s.phase_no] || []).push(s); });
      const phasesHtml = (p.phases || []).map((ph) => {
        const steps = (byPhase[ph.no] || []).map((s) => {
          const riskColor = s.risk_tier === 'high' ? '#c33' : (s.risk_tier === 'medium' ? '#c80' : '#2a2');
          const lock = s.human_risk_locked ? ' 🔒' : '';
          return '<tr><td style="padding:2px 6px;">' + s.seq + '</td>' +
            '<td style="padding:2px 6px;"><code>' + esc(s.tool_name) + '</code></td>' +
            '<td style="padding:2px 6px;color:' + riskColor + ';">' + s.risk_tier + lock + '</td>' +
            '<td style="padding:2px 6px;color:#9ab;">' + esc(s.rationale || '') + '</td>' +
            '<td style="padding:2px 6px;">' + esc(s.status) + '</td>' +
            '<td style="padding:2px 6px;"><select onchange="adminWorldPlan.setRisk(\'' + s.id + '\', this.value)">' +
              ['low', 'medium', 'high'].map((r) => '<option ' + (r === s.risk_tier ? 'selected' : '') + '>' + r + '</option>').join('') +
            '</select></td>' +
            '<td style="padding:2px 6px;"><button onclick="adminWorldPlan.delStep(\'' + s.id + '\')" style="cursor:pointer;">🗑</button></td></tr>';
        }).join('');
        return '<details ' + (ph.no === 1 ? 'open' : '') + ' style="margin:6px 0;"><summary>阶段 ' + ph.no + '：' + esc(ph.title) +
          ' <span style="color:#9ab;font-size:12px;">[' + esc(ph.purpose) + ']</span>（' + (byPhase[ph.no] || []).length + ' 步）</summary>' +
          '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
          '<tr style="color:#789;"><th>#</th><th>工具</th><th>风险</th><th>理由</th><th>状态</th><th>改风险</th><th></th></tr>' + steps + '</table>' +
          '<button onclick="adminWorldPlan.delPhase(\'' + p.id + '\',' + ph.no + ')" style="margin-top:4px;cursor:pointer;">🗑 删除整个阶段 ' + ph.no + '</button></details>';
      }).join('');
      const canDecide = p.status === 'review';
      $('awp-detail').innerHTML =
        '<div class="awb-panel" style="margin-top:10px;"><h3>' + esc(p.title) + ' <span style="color:' + (ST_COLORS[p.status] || '#888') + '">[' + p.status + ']</span> v' + p.version + ' rev' + p.revision + '</h3>' +
        '<div style="color:#abc;margin:6px 0;">' + esc(p.summary || p.overview || '') + '</div>' +
        '<div style="margin:8px 0;">' +
          '<button onclick="adminWorldPlan.act(\'' + p.id + '\',\'submit\')">📨 提交审核</button> ' +
          '<button ' + (canDecide ? '' : 'disabled') + ' onclick="adminWorldPlan.act(\'' + p.id + '\',\'approve\')" style="background:var(--green);color:#08130c;font-weight:600;">✔ 批准</button> ' +
          '<button ' + (canDecide ? '' : 'disabled') + ' onclick="adminWorldPlan.act(\'' + p.id + '\',\'reject\')" style="background:#c33;color:#fff;">✘ 驳回</button> ' +
          '<button onclick="adminWorldPlan.act(\'' + p.id + '\',\'pause\')">⏸ 暂停</button> ' +
          '<button onclick="adminWorldPlan.act(\'' + p.id + '\',\'resume\')">▶ 继续</button> ' +
          '<button onclick="adminWorldPlan.reload()">↻ 刷新</button></div>' +
        '<div>' + phasesHtml + '</div></div>';
    } catch (e) { msg('加载失败：' + e.message, false); }
  }
  async function act(id, action) {
    try {
      let body = {};
      if (action === 'reject') {
        const reason = prompt('驳回原因（必填，AI 据此重规划）：');
        if (!reason || !reason.trim()) { msg('必须写驳回原因', false); return; }
        body.reason = reason;
      }
      if (action === 'approve' && !confirm('批准后 Runtime 会开始尝试执行（Phase 3 无工具，会明确报 TOOL_NOT_REGISTERED）。确认批准？')) return;
      await jreq('POST', API + '/plans/' + id + '/' + action, body);
      msg('已' + ({ submit: '提交审核', approve: '批准', reject: '驳回', pause: '暂停', resume: '继续' }[action] || action), true);
      open(id); loadPlans();
    } catch (e) { msg('操作失败：' + e.message, false); }
  }
  async function setRisk(stepId, risk) {
    try {
      await jreq('PUT', API + '/steps/' + stepId, { risk_tier: risk });
      msg('风险等级已改为 ' + risk + '（人工设定🔒，AI 不得降级；规划已回 draft）', true);
    } catch (e) { msg('修改失败：' + e.message, false); }
  }
  async function delStep(stepId) {
    if (!confirm('删除这个步骤？（规划回 draft）')) return;
    try { await jreq('PUT', API + '/steps/' + stepId, { deleted: true }); msg('步骤已删除', true); } catch (e) { msg('删除失败：' + e.message, false); }
  }
  async function delPhase(planId, no) {
    if (!confirm('删除阶段 ' + no + ' 及其全部步骤？（规划回 draft）')) return;
    try { await jreq('PUT', API + '/plans/' + planId, { removePhaseNo: no }); msg('阶段已删除', true); open(planId); } catch (e) { msg('删除失败：' + e.message, false); }
  }

  function start() {
    if (window.adminWorldPlan) return;
    window.adminWorldPlan = { open, act, setRisk, delStep, delPhase, reload: () => { loadGoals(); loadPlans(); } };
    let tries = 0;
    const iv = setInterval(() => {
      try { build(); } catch (e) { /* 引导链抗抛错：继续轮询 */ }
      if (built || ++tries > 100) clearInterval(iv);
    }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
