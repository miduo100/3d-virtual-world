/**
 * adminAgentSettings.js — 管理后台「🤖 AI Agent」+「📦 聊天归档」两个子页签逻辑（P4）
 *
 * 为什么独立成文件：admin.html 已超 1 万行属黑名单文件，禁止追加新功能代码（项目红线），
 * 故卡片逻辑放独立模块，页面只保留卡片标记与入口调用（switchSubTab 懒加载钩子）。
 *
 * 依赖页面元素：
 *   AI Agent  — agent-enabled-checkbox / agent-push-default / agent-movement-push /
 *               agent-voice-relay-checkbox / max-agents / agent-save-msg /
 *               new-agent-name / new-agent-description / new-agent-glburl / agent-list-content
 *   聊天归档  — chat-log-enabled-checkbox / chat-log-retention-days /
 *               chat-log-remote-enabled-checkbox / chat-log-remote-provider /
 *               chat-log-upload-hour / chat-log-s3-endpoint|bucket|prefix|access-key|secret-key /
 *               chat-archive-save-msg / archive-run-now-btn
 * 暴露全局：window.adminAgentSettings
 * API：/api/agent/v1/admin/agents（GET/POST）、/agents/:id/{disable,enable,regenerate-key}、
 *      /admin/config（GET/PUT）、/admin/archive/run-now（POST）
 */
(function () {
  'use strict';

  const API = '/api/agent/v1/admin';

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
    if (!r.ok) throw new Error((j && (j.error || j.message)) || ('HTTP ' + r.status));
    return j || {};
  }

  function showMsg(id, text, ok) {
    const el = $(id);
    if (!el) return;
    el.style.display = 'block';
    el.style.background = ok ? 'rgba(0,255,0,0.08)' : 'rgba(255,68,68,0.12)';
    el.style.color = ok ? 'var(--green)' : 'var(--red)';
    el.style.border = ok ? '1px solid rgba(0,255,0,0.2)' : '1px solid rgba(255,68,68,0.3)';
    el.textContent = text;
    if (ok) setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  // ==================== 接入设置（5.3 节） ====================

  function fillAgentConfig(cfg) {
    const setCb = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    const setVal = (id, v) => { const el = $(id); if (el && v !== undefined && v !== null) el.value = v; };
    setCb('agent-enabled-checkbox', cfg.agentEnabled);
    setVal('agent-push-default', cfg.pushDefault);
    setVal('agent-movement-push', cfg.movementPush);
    setCb('agent-voice-relay-checkbox', cfg.voiceRelay);
    setVal('max-agents', cfg.maxAgents);
  }

  function fillChatArchiveConfig(cfg) {
    const setCb = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    const setVal = (id, v) => { const el = $(id); if (el && v !== undefined && v !== null) el.value = v; };
    setCb('chat-log-enabled-checkbox', cfg.chatLogEnabled);
    setVal('chat-log-retention-days', cfg.chatLogRetentionDays);
    setCb('chat-log-remote-enabled-checkbox', cfg.chatLogRemoteEnabled);
    setVal('chat-log-remote-provider', cfg.chatLogRemoteProvider);
    setVal('chat-log-upload-hour', cfg.chatLogUploadHour);
    setVal('chat-log-s3-endpoint', cfg.chatLogS3Endpoint);
    setVal('chat-log-s3-bucket', cfg.chatLogS3Bucket);
    setVal('chat-log-s3-prefix', cfg.chatLogS3Prefix);
    setVal('chat-log-s3-access-key', cfg.chatLogS3AccessKey);
    setVal('chat-log-s3-secret-key', cfg.chatLogS3SecretKey);
  }

  async function loadAgentConfig() {
    try {
      const r = await jreq('GET', API + '/config');
      const cfg = r.config || {};
      fillAgentConfig(cfg);
      fillChatArchiveConfig(cfg);
    } catch (e) {
      showMsg('agent-save-msg', '❌ 配置读取失败：' + e.message, false);
    }
  }

  async function saveAgentConfig() {
    const maxEl = $('max-agents');
    const maxAgents = maxEl ? parseInt(maxEl.value, 10) : NaN;
    if (!Number.isFinite(maxAgents) || maxAgents < 1 || maxAgents > 500) {
      showMsg('agent-save-msg', '❌ 并发上限必须是 1~500 之间的整数', false);
      return;
    }
    const body = {
      agent_enabled: !!($('agent-enabled-checkbox') || {}).checked,
      agent_push_default: ($('agent-push-default') || {}).value,
      agent_movement_push: ($('agent-movement-push') || {}).value,
      agent_voice_relay: !!($('agent-voice-relay-checkbox') || {}).checked,
      max_agents: String(maxAgents)
    };
    showMsg('agent-save-msg', '保存中...', true);
    try {
      await jreq('PUT', API + '/config', body);
      showMsg('agent-save-msg', '✅ 已保存（配置 60s 缓存，玩家端 60s 内热跟进，无需重启）', true);
    } catch (e) {
      showMsg('agent-save-msg', '❌ 保存失败：' + e.message, false);
    }
  }

  // ==================== 聊天归档设置（5.5 节） ====================

  async function saveChatArchiveConfig() {
    const daysEl = $('chat-log-retention-days');
    const hourEl = $('chat-log-upload-hour');
    const days = daysEl ? parseInt(daysEl.value, 10) : NaN;
    const hour = hourEl ? parseInt(hourEl.value, 10) : NaN;
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      showMsg('chat-archive-save-msg', '❌ 保留天数必须是 1~365 之间的整数', false);
      return;
    }
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
      showMsg('chat-archive-save-msg', '❌ 归档时刻必须是 0~23 之间的整数', false);
      return;
    }
    const val = (id) => { const el = $(id); return el ? el.value : ''; };
    const body = {
      chat_log_enabled: !!($('chat-log-enabled-checkbox') || {}).checked,
      chat_log_retention_days: String(days),
      chat_log_remote_enabled: !!($('chat-log-remote-enabled-checkbox') || {}).checked,
      chat_log_remote_provider: val('chat-log-remote-provider'),
      chat_log_upload_hour: String(hour),
      chat_log_s3_endpoint: val('chat-log-s3-endpoint'),
      chat_log_s3_bucket: val('chat-log-s3-bucket'),
      chat_log_s3_prefix: val('chat-log-s3-prefix'),
      chat_log_s3_access_key: val('chat-log-s3-access-key'),
      chat_log_s3_secret_key: val('chat-log-s3-secret-key')
    };
    showMsg('chat-archive-save-msg', '保存中...', true);
    try {
      await jreq('PUT', API + '/config', body);
      showMsg('chat-archive-save-msg', '✅ 已保存（密钥加密存储；未成功上传的本地数据永不删除）', true);
    } catch (e) {
      showMsg('chat-archive-save-msg', '❌ 保存失败：' + e.message, false);
    }
  }

  async function runArchiveNowTest() {
    const btn = $('archive-run-now-btn');
    if (btn) btn.disabled = true;
    showMsg('chat-archive-save-msg', '归档中...（尊重 remote_enabled 开关，关闭时返回 skipped）', true);
    try {
      const r = await jreq('POST', API + '/archive/run-now', {});
      const res = r.result || {};
      const text = res.skipped
        ? '⏭️ 已跳过：' + res.skipped
        : '✅ 归档成功：' + (res.key || res.day || JSON.stringify(res));
      showMsg('chat-archive-save-msg', text, !res.skipped);
    } catch (e) {
      showMsg('chat-archive-save-msg', '❌ 归档失败：' + e.message, false);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ==================== Agent 列表 ====================

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtTime(v) {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  function renderAgents(agents) {
    const box = $('agent-list-content');
    if (!box) return;
    if (!agents.length) {
      box.className = '';
      box.textContent = '暂无 Agent，请在上方创建。';
      return;
    }
    box.className = 'table-wrap';
    const rows = agents.map((a) => {
      const badge = a.status === 'active'
        ? '<span style="color:var(--green)">● 启用</span>'
        : '<span style="color:var(--red)">● 停用</span>';
      const keyInfo = a.lastKeyPrefix ? esc(a.lastKeyPrefix) + '…' : '无';
      const actions = a.status === 'active'
        ? `<button class="btn btn-sm btn-secondary" onclick="adminAgentSettings.regenerateKey('${esc(a.id)}')">🔑 重发Key</button>
           <button class="btn btn-sm btn-danger" onclick="adminAgentSettings.disableAgent('${esc(a.id)}')">⏸ 停用</button>`
        : `<button class="btn btn-sm btn-blue" onclick="adminAgentSettings.enableAgent('${esc(a.id)}')">▶ 启用</button>`;
      return `<tr>
        <td>${esc(a.name)}</td>
        <td>${esc(a.description || '')}</td>
        <td>${badge}</td>
        <td>${a.activeKeyCount}</td>
        <td><code style="font-size:11px">${keyInfo}</code></td>
        <td>${esc(a.canTeleport ? '是' : '否')}</td>
        <td style="font-size:11px;color:var(--muted)">${fmtTime(a.createdAt)}</td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `<table>
      <thead><tr>
        <th>名称</th><th>描述</th><th>状态</th><th>有效Key</th><th>最近Key前缀</th>
        <th>可传送</th><th>创建时间</th><th>操作</th>
      </tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  async function loadAgentsList() {
    const box = $('agent-list-content');
    if (box) { box.className = 'loading'; box.textContent = '加载中...'; }
    try {
      const r = await jreq('GET', API + '/agents');
      renderAgents(r.agents || []);
    } catch (e) {
      if (box) { box.className = ''; box.textContent = '❌ 加载失败：' + e.message; }
    }
  }

  async function createAgent() {
    const nameEl = $('new-agent-name');
    const descEl = $('new-agent-description');
    const glbEl = $('new-agent-glburl');
    const name = nameEl ? nameEl.value.trim() : '';
    if (name.length < 2) {
      showMsg('agent-save-msg', '❌ 名称至少 2 个字符', false);
      return;
    }
    const glbUrl = glbEl ? glbEl.value.trim() : '';
    const body = {
      name,
      description: descEl ? descEl.value.trim() : '',
      avatarConfig: glbUrl ? { glbUrl } : {}
    };
    showMsg('agent-save-msg', '创建中...', true);
    try {
      const r = await jreq('POST', API + '/agents', body);
      if (nameEl) nameEl.value = '';
      if (descEl) descEl.value = '';
      if (glbEl) glbEl.value = '';
      // 明文 Key 仅此一次返回，必须立刻展示给管理员
      const key = r.apiKey || '';
      showMsg('agent-save-msg', '✅ 创建成功（Key 仅显示一次，请立即复制）：' + key, true);
      if (key && window.prompt) window.prompt('复制此 API Key（仅此一次显示）', key);
      await loadAgentsList();
    } catch (e) {
      showMsg('agent-save-msg', '❌ 创建失败：' + e.message, false);
    }
  }

  async function disableAgent(id) {
    if (window.confirm && !window.confirm('停用将同时吊销该 Agent 的全部 API Key 与会话，确定继续？')) return;
    try {
      await jreq('POST', API + '/agents/' + encodeURIComponent(id) + '/disable', {});
      showMsg('agent-save-msg', '✅ 已停用', true);
      await loadAgentsList();
    } catch (e) {
      showMsg('agent-save-msg', '❌ 停用失败：' + e.message, false);
    }
  }

  async function enableAgent(id) {
    try {
      const r = await jreq('POST', API + '/agents/' + encodeURIComponent(id) + '/enable', {});
      showMsg('agent-save-msg', '✅ ' + (r.note || '已启用'), true);
      await loadAgentsList();
    } catch (e) {
      showMsg('agent-save-msg', '❌ 启用失败：' + e.message, false);
    }
  }

  async function regenerateKey(id) {
    if (window.confirm && !window.confirm('重发将使该 Agent 的现有 Key 全部失效，确定继续？')) return;
    try {
      const r = await jreq('POST', API + '/agents/' + encodeURIComponent(id) + '/regenerate-key', {});
      const key = r.apiKey || '';
      showMsg('agent-save-msg', '✅ 新 Key（仅显示一次）：' + key, true);
      if (key && window.prompt) window.prompt('复制新 API Key（仅此一次显示）', key);
      await loadAgentsList();
    } catch (e) {
      showMsg('agent-save-msg', '❌ 重发 Key 失败：' + e.message, false);
    }
  }

  window.adminAgentSettings = {
    loadAgentConfig,
    saveAgentConfig,
    loadAgentsList,
    createAgent,
    disableAgent,
    enableAgent,
    regenerateKey,
    saveChatArchiveConfig,
    runArchiveNowTest
  };
})();
