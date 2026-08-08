/**
 * 联邦信任审批前端模块
 * 管理后台：受信任世界页面的审批开关与待审批请求列表
 */

(function() {
  'use strict';

  const API = {
    settings: '/api/federation/trust-settings',
    requests: '/api/federation/trust-requests'
  };

  function getToken() {
    return localStorage.getItem('adminToken');
  }

  function t(key, fallback) {
    if (window.i18n && window.i18n.t) {
      return window.i18n.t(key) || fallback;
    }
    return fallback;
  }

  // 加载审批开关
  async function loadTrustSettings() {
    const toggle = document.getElementById('trust-requires-approval');
    const statusText = document.getElementById('trust-status-text');
    if (!toggle || !statusText) return;

    try {
      const r = await fetch(API.settings, { headers: { 'Authorization': `Bearer ${getToken()}` } });
      const data = await r.json();
      if (data.success) {
        toggle.checked = data.trustRequiresApproval === true;
        updateTrustStatusText(toggle.checked);
      }
    } catch (e) {
      console.error('加载信任审批设置失败:', e);
    }
  }

  // 保存审批开关
  async function saveTrustSettings() {
    const toggle = document.getElementById('trust-requires-approval');
    if (!toggle) return;

    const btn = document.getElementById('btn-save-trust-settings');
    if (btn) {
      btn.disabled = true;
      btn.textContent = t('common.saving', '保存中...');
    }

    try {
      const r = await fetch(API.settings, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trustRequiresApproval: toggle.checked })
      });
      const data = await r.json();
      if (data.success) {
        updateTrustStatusText(data.trustRequiresApproval);
        showToast(t('federationTrust.settingsSaved', '审批设置已保存'), 'success');
        loadPendingTrustRequests();
      } else {
        showToast(t('federationTrust.settingsSaveFailed', '保存失败') + ': ' + (data.error || ''), 'error');
      }
    } catch (e) {
      showToast(t('federationTrust.settingsSaveFailed', '保存失败') + ': ' + e.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = t('common.save', '保存');
      }
    }
  }

  function updateTrustStatusText(checked) {
    const el = document.getElementById('trust-status-text');
    if (!el) return;
    el.textContent = checked
      ? t('federationTrust.approvalEnabled', '已开启：收到信任请求需手动审批')
      : t('federationTrust.approvalDisabled', '已关闭：收到信任请求自动同意');
  }

  // 加载待审批请求
  async function loadPendingTrustRequests() {
    const container = document.getElementById('pending-trust-requests-content');
    if (!container) return;

    container.innerHTML = `<div class="loading">${t('common.loading', '加载中...')}</div>`;

    try {
      const r = await fetch(API.requests, { headers: { 'Authorization': `Bearer ${getToken()}` } });
      const data = await r.json();
      if (data.success) {
        renderPendingRequests(data.requests || []);
      } else {
        container.innerHTML = `<div class="empty">${t('federationTrust.loadFailed', '加载失败')}: ${data.error || ''}</div>`;
      }
    } catch (e) {
      container.innerHTML = `<div class="empty">${t('federationTrust.loadFailed', '加载失败')}: ${e.message}</div>`;
    }
  }

  function renderPendingRequests(requests) {
    const container = document.getElementById('pending-trust-requests-content');
    if (!container) return;

    const card = document.getElementById('pending-trust-requests-card');
    if (card) {
      card.style.display = requests.length > 0 ? 'block' : 'none';
    }

    if (requests.length === 0) {
      container.innerHTML = `<div class="empty">${t('federationTrust.noPendingRequests', '暂无待审批的信任请求')}</div>`;
      return;
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t('federationTrust.worldName', '世界名称')}</th>
            <th>${t('federationTrust.worldURL', '世界URL')}</th>
            <th>${t('federationTrust.worldID', '世界ID')}</th>
            <th>${t('federationTrust.requestTime', '请求时间')}</th>
            <th>${t('admin.colActions', '操作')}</th>
          </tr>
        </thead>
        <tbody>
          ${requests.map(req => `
            <tr>
              <td>${escapeHtml(req.world_name)}</td>
              <td><a href="${escapeHtml(req.world_url)}" target="_blank" style="color:var(--blue)">${escapeHtml(req.world_url)}</a></td>
              <td style="font-size:11px;color:var(--text-secondary)">${escapeHtml(req.world_id)}</td>
              <td>${new Date(req.created_at).toLocaleString()}</td>
              <td>
                <button class="btn btn-sm" onclick="approveTrustRequest('${req.id}')">${t('federationTrust.approve', '同意')}</button>
                <button class="btn btn-sm btn-danger" onclick="rejectTrustRequest('${req.id}')">${t('federationTrust.reject', '拒绝')}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  }

  // 同意请求
  async function approveTrustRequest(requestId) {
    if (!confirm(t('federationTrust.approveConfirm', '确定同意该世界的信任请求吗？'))) return;

    try {
      const r = await fetch(`${API.requests}/${requestId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
      });
      const data = await r.json();
      if (data.success) {
        showToast(t('federationTrust.approveSuccess', '已同意信任请求'), 'success');
        loadPendingTrustRequests();
        if (typeof loadWorlds === 'function') loadWorlds();
      } else {
        showToast(t('federationTrust.approveFailed', '同意失败') + ': ' + (data.error || ''), 'error');
      }
    } catch (e) {
      showToast(t('federationTrust.approveFailed', '同意失败') + ': ' + e.message, 'error');
    }
  }

  // 拒绝请求
  async function rejectTrustRequest(requestId) {
    if (!confirm(t('federationTrust.rejectConfirm', '确定拒绝该世界的信任请求吗？'))) return;

    try {
      const r = await fetch(`${API.requests}/${requestId}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
      });
      const data = await r.json();
      if (data.success) {
        showToast(t('federationTrust.rejectSuccess', '已拒绝信任请求'), 'success');
        loadPendingTrustRequests();
      } else {
        showToast(t('federationTrust.rejectFailed', '拒绝失败') + ': ' + (data.error || ''), 'error');
      }
    } catch (e) {
      showToast(t('federationTrust.rejectFailed', '拒绝失败') + ': ' + e.message, 'error');
    }
  }

  function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 初始化（在受信任世界子标签显示时调用）
  function initFederationTrust() {
    loadTrustSettings();
    loadPendingTrustRequests();
  }

  // 暴露到全局
  window.loadTrustSettings = loadTrustSettings;
  window.saveTrustSettings = saveTrustSettings;
  window.loadPendingTrustRequests = loadPendingTrustRequests;
  window.approveTrustRequest = approveTrustRequest;
  window.rejectTrustRequest = rejectTrustRequest;
  window.initFederationTrust = initFederationTrust;
})();
