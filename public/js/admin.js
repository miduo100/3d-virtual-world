/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 管理后台 JavaScript

const API_BASE = '/api';
let currentPortalId = null;

// 检查管理员登录状态
function checkAuth() {
  const token = localStorage.getItem('adminToken');
  if (!token) {
    window.location.href = '/admin_login.html';
    return false;
  }
  return true;
}

// API请求封装 - 使用管理员token
async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('adminToken');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...options.headers
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401 || response.status === 403) {
    alert('管理员权限不足或登录已过期，请重新登录');
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    window.location.href = '/admin_login.html';
    throw new Error('Unauthorized');
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

// HTML 转义工具：防止联邦握手字段进入 innerHTML 造成 XSS
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 初始化
window.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return;
  
  // 优先加载关键数据，避免同时发起过多请求
  try {
    await loadStats();
  } catch (e) {
    console.error('加载统计失败:', e);
  }
  
  // 其他数据延迟加载
  setTimeout(() => {
    try {
      loadUsers();
    } catch (e) {}
  }, 100);
  
  setTimeout(() => {
    try {
      loadPortals();
    } catch (e) {}
  }, 200);
  
  setTimeout(() => {
    try {
      loadWorlds();
    } catch (e) {}
  }, 300);
  
  // 日志最后加载或按需加载
});

// 切换标签页
function switchTab(tab) {
  // 更新标签按钮
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');

  // 更新内容
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  
  // 如果切换到配置页面，加载配置
  if (tab === 'config' && typeof loadSystemConfig === 'function') {
    loadSystemConfig();
  }
  
  // 如果切换到建筑管理页面，加载建筑
  if (tab === 'buildings' && typeof loadBuildings === 'function') {
    loadBuildings();
  }
  
  // 如果切换到联邦页面，加载统计数据
  if (tab === 'federation' && typeof loadWorldStats === 'function') {
    loadWorldStats();
  }
}
// switchSubTab 已在 admin.html 内联脚本中定义，此处不重复覆盖

// ==================== 统计信息 ====================

async function loadStats() {
  try {
    const stats = await apiRequest('/admin/stats');
    document.getElementById('stat-users').textContent = stats.users.count;
    document.getElementById('stat-characters').textContent = stats.characters.count;
    document.getElementById('stat-buildings').textContent = stats.buildings.count;
    document.getElementById('stat-portals').textContent = stats.portals.count;
    document.getElementById('stat-worlds').textContent = stats.remoteWorlds.count;
    document.getElementById('stat-teleports').textContent = stats.totalTeleports.count;
    document.getElementById('stat-today').textContent = stats.todayTeleports.count;
  } catch (error) {
    console.error('加载统计失败:', error);
  }
}

// ==================== 传送门管理 ====================

async function loadPortals() {
  try {
    const portals = await apiRequest('/admin/portals');
    renderPortals(portals);
  } catch (error) {
    document.getElementById('portals-content').innerHTML = 
      `<div class="empty">加载失败: ${error.message}</div>`;
  }
}

function renderPortals(portals) {
  const container = document.getElementById('portals-content');
  
  if (portals.length === 0) {
    container.innerHTML = '<div class="empty">暂无传送门</div>';
    return;
  }

  const html = `
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>名称</th>
          <th>类型</th>
          <th>位置</th>
          <th>目标</th>
          <th>等级要求</th>
          <th>使用次数</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${portals.map(p => `
          <tr>
            <td>${p.id}</td>
            <td>${p.name}</td>
            <td><span class="badge badge-${p.portal_type}">${p.portal_type === 'local' ? '本地' : '跨服'}</span></td>
            <td>${formatPosition(p.source_position)}</td>
            <td>${p.portal_type === 'local' ? formatPosition(p.target_position) : (p.target_world_name || p.target_world_url)}</td>
            <td>${p.required_level}</td>
            <td>${p.usage_count}</td>
            <td><span class="badge badge-${p.is_active ? 'active' : 'inactive'}">${p.is_active ? '激活' : '未激活'}</span></td>
            <td>
              <div class="action-btns">
                <button class="btn" onclick="editPortal('${p.id}')">编辑</button>
                <button class="btn btn-danger" onclick="deletePortal('${p.id}')">删除</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  container.innerHTML = html;
}

function formatPosition(pos) {
  if (!pos) return '-';
  if (typeof pos === 'string') pos = JSON.parse(pos);
  return `(${pos.x}, ${pos.y}, ${pos.z})`;
}

function showCreatePortalModal() {
  currentPortalId = null;
  document.getElementById('portalModalTitle').textContent = '创建传送门';
  document.getElementById('portalForm').reset();
  document.getElementById('portal-id').value = '';
  document.getElementById('portalModal').classList.add('active');
  togglePortalTypeFields();
}

function closePortalModal() {
  document.getElementById('portalModal').classList.remove('active');
}

function togglePortalTypeFields() {
  const type = document.getElementById('portal-type').value;
  document.getElementById('local-fields').style.display = type === 'local' ? 'block' : 'none';
  document.getElementById('remote-fields').style.display = type === 'remote' ? 'block' : 'none';
}

async function editPortal(id) {
  try {
    const portals = await apiRequest('/admin/portals');
    const portal = portals.find(p => p.id === id);
    
    if (!portal) return;

    currentPortalId = id;
    document.getElementById('portalModalTitle').textContent = '编辑传送门';
    document.getElementById('portal-id').value = id;
    document.getElementById('portal-name').value = portal.name;
    document.getElementById('portal-type').value = portal.portal_type;
    document.getElementById('portal-position-x').value = portal.source_position.x;
    document.getElementById('portal-position-y').value = portal.source_position.y;
    document.getElementById('portal-position-z').value = portal.source_position.z;
    
    if (portal.portal_type === 'local' && portal.target_position) {
      document.getElementById('portal-target-x').value = portal.target_position.x;
      document.getElementById('portal-target-y').value = portal.target_position.y;
      document.getElementById('portal-target-z').value = portal.target_position.z;
    }
    
    if (portal.portal_type === 'remote') {
      document.getElementById('portal-target-url').value = portal.target_world_url || '';
      document.getElementById('portal-target-name').value = portal.target_world_name || '';
    }
    
    document.getElementById('portal-level').value = portal.required_level;
    document.getElementById('portal-cooldown').value = portal.cooldown_seconds;
    document.getElementById('portal-description').value = portal.description || '';
    document.getElementById('portal-active').value = portal.is_active ? '1' : '0';
    
    togglePortalTypeFields();
    document.getElementById('portalModal').classList.add('active');
  } catch (error) {
    alert('加载传送门信息失败: ' + error.message);
  }
}

document.getElementById('portalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  try {
    const type = document.getElementById('portal-type').value;
    const position = {
      x: parseFloat(document.getElementById('portal-position-x').value),
      y: parseFloat(document.getElementById('portal-position-y').value),
      z: parseFloat(document.getElementById('portal-position-z').value)
    };
    
    const data = {
      name: document.getElementById('portal-name').value,
      portal_type: type,
      position: position,
      required_level: parseInt(document.getElementById('portal-level').value),
      cooldown_seconds: parseInt(document.getElementById('portal-cooldown').value),
      description: document.getElementById('portal-description').value,
      is_active: document.getElementById('portal-active').value === '1'
    };

    if (type === 'local') {
      data.target_position = {
        x: parseFloat(document.getElementById('portal-target-x').value),
        y: parseFloat(document.getElementById('portal-target-y').value),
        z: parseFloat(document.getElementById('portal-target-z').value)
      };
    } else {
      data.target_world_url = document.getElementById('portal-target-url').value;
      data.target_world_name = document.getElementById('portal-target-name').value;
    }

    const portalId = document.getElementById('portal-id').value;
    if (portalId) {
      await apiRequest(`/admin/portals/${portalId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      alert('传送门更新成功！');
    } else {
      await apiRequest('/admin/portals', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      alert('传送门创建成功！');
    }

    closePortalModal();
    loadPortals();
    loadStats();
  } catch (error) {
    alert('保存失败: ' + error.message);
  }
});

function parsePosition(str) {
  const parts = str.split(',').map(s => parseFloat(s.trim()));
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error('位置格式错误，应为: x, y, z');
  }
  return { x: parts[0], y: parts[1], z: parts[2] };
}

async function deletePortal(id) {
  if (!confirm('确定要删除这个传送门吗？')) return;
  
  try {
    await apiRequest(`/admin/portals/${id}`, { method: 'DELETE' });
    alert('传送门删除成功！');
    loadPortals();
    loadStats();
  } catch (error) {
    alert('删除失败: ' + error.message);
  }
}

// ==================== 用户管理 ====================

async function loadUsers() {
  try {
    const users = await apiRequest('/admin/users');
    renderUsers(users);
  } catch (error) {
    const msg = window.i18n ? window.i18n.tp('admin.usersLoadFailed', { message: error.message }) : `加载失败: ${error.message}`;
    document.getElementById('users-content').innerHTML = 
      `<div class="empty">${msg}</div>`;
  }
}

function renderUsers(users) {
  const container = document.getElementById('users-content');
  
  const userList = Array.isArray(users) ? users : (Array.isArray(users?.users) ? users.users : []);

  const t = (key) => window.i18n ? window.i18n.t(key) : key;
  const tp = (key, params) => window.i18n ? window.i18n.tp(key, params) : key;
  
  if (userList.length === 0) {
    container.innerHTML = `<div class="empty">${t('admin.usersNoUsers')}</div>`;
    return;
  }

  const html = `
    <table>
      <thead>
        <tr>
          <th>${t('admin.usersColId')}</th>
          <th>${t('admin.usersColUsername')}</th>
          <th>${t('admin.usersColEmail')}</th>
          <th>${t('admin.usersColCharacterName')}</th>
          <th>${t('admin.usersColLevel')}</th>
          <th>${t('admin.usersColRole')}</th>
          <th>${t('admin.usersColRegistered')}</th>
          <th>${t('admin.usersColActions')}</th>
        </tr>
      </thead>
      <tbody>
        ${userList.map(u => {
          const roleBadge = u.role === 'admin' ? t('admin.usersAdminBadge') : t('admin.usersUserBadge');
          const toggleBtn = u.role === 'admin' ? t('admin.usersSetAsUser') : t('admin.usersSetAsAdmin');
          return `
          <tr>
            <td>${u.id}</td>
            <td>${u.username}</td>
            <td>${u.email}</td>
            <td>${u.character_name || '-'}</td>
            <td>${u.level || '-'}</td>
            <td><span class="badge badge-${u.role}">${roleBadge}</span></td>
            <td>${new Date(u.created_at).toLocaleDateString()}</td>
            <td>
              <div class="action-btns">
                <button class="btn" onclick="toggleUserRole('${u.id}', '${u.role}')">${toggleBtn}</button>
                <button class="btn btn-danger" onclick="deleteUser('${u.id}')">${t('admin.usersDelete')}</button>
              </div>
            </td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;
  
  container.innerHTML = html;
}

async function toggleUserRole(userId, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  const roleName = newRole === 'admin' 
    ? (window.i18n ? window.i18n.t('admin.usersAdminRole') : '管理员')
    : (window.i18n ? window.i18n.t('admin.usersNormalUser') : '普通用户');
  
  const confirmMsg = window.i18n 
    ? window.i18n.tp('admin.usersRoleChangeConfirm', { role: roleName })
    : `确定要将用户角色改为 ${roleName} 吗？`;
  if (!confirm(confirmMsg)) return;
  
  try {
    await apiRequest(`/admin/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole })
    });
    alert(window.i18n ? window.i18n.t('admin.usersRoleUpdated') : '角色更新成功！');
    loadUsers();
  } catch (error) {
    alert(window.i18n ? window.i18n.tp('admin.usersUpdateFailed', { message: error.message }) : '更新失败: ' + error.message);
  }
}

async function deleteUser(userId) {
  if (!confirm(window.i18n ? window.i18n.t('admin.usersDeleteConfirm') : '确定要删除这个用户吗？此操作不可恢复！')) return;
  
  try {
    await apiRequest(`/admin/users/${userId}`, { method: 'DELETE' });
    alert(window.i18n ? window.i18n.t('admin.usersUserDeleted') : '用户删除成功！');
    loadUsers();
    loadStats();
  } catch (error) {
    alert(window.i18n ? window.i18n.tp('admin.usersDeleteFailed', { message: error.message }) : '删除失败: ' + error.message);
  }
}

// ==================== 受信任世界（联邦） ====================

async function loadWorlds() {
  const container = document.getElementById('worlds-content');
  if (!container) return;
  container.innerHTML = '<div class="loading" data-i18n="adminWorld.loading">加载中...</div>';
  if (typeof applyAdminTranslations === 'function') applyAdminTranslations(container);
  try {
    const token = localStorage.getItem('adminToken');
    const keyword = (document.getElementById('worlds-search')?.value || '').trim().toLowerCase();
    const r = await fetch('/api/federation/worlds', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await r.json();
    if (!data.success) { container.innerHTML = `<div class="empty-state">${window.i18n.t('adminWorld.loadFailed').replace('{{message}}', data.error)}</div>`; return; }
    let worlds = data.worlds || [];
    if (keyword) worlds = worlds.filter(w => w.worldName?.toLowerCase().includes(keyword) || w.worldUrl?.toLowerCase().includes(keyword));
    if (!worlds.length) { container.innerHTML = '<div class="empty-state" data-i18n="adminWorld.noTrustedWorlds">暂无已信任的世界，点击右上角"➕ 添加世界"发起握手</div>'; if (typeof applyAdminTranslations === 'function') applyAdminTranslations(container); return; }
    container.innerHTML = `
      <table class="data-table">
        <thead><tr><th data-i18n="adminWorld.worldName">世界名称</th><th data-i18n="adminWorld.worldURL">世界URL</th><th data-i18n="adminWorld.worldID">世界ID</th><th data-i18n="adminWorld.colActions">操作</th></tr></thead>
        <tbody>${worlds.map(w => `
          <tr>
            <td>${escapeHtml(w.worldName) || window.i18n.t('adminWorld.unknown')}</td>
            <td><a href="${escapeHtml(w.worldUrl)}" target="_blank" style="color:var(--blue)">${escapeHtml(w.worldUrl)}</a></td>
            <td style="font-size:11px;color:var(--text-secondary)">${escapeHtml(w.worldId)}</td>
            <td><button class="btn btn-sm btn-danger" onclick="removeTrustedWorld('${escapeHtml(w.worldId)}')" data-i18n="adminWorld.remove">移除</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    if (typeof applyAdminTranslations === 'function') applyAdminTranslations(container);
  } catch(e) { container.innerHTML = `<div class="empty-state">${window.i18n.t('adminWorld.loadFailed').replace('{{message}}', e.message)}</div>`; }
}

async function removeTrustedWorld(worldId) {
  if (!confirm(window.i18n.t('adminWorld.confirmRemoveWorld'))) return;
  const token = localStorage.getItem('adminToken');
  try {
    const r = await fetch(`/api/federation/worlds/${worldId}`, {
      method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await r.json();
    if (data.success) { showToast(window.i18n.t('adminWorld.worldRemoved')); loadWorlds(); }
    else showToast(window.i18n.t('adminWorld.removeFailed').replace('{{message}}', data.error), 'error');
  } catch(e) { showToast(window.i18n.t('adminWorld.operationFailed').replace('{{message}}', e.message), 'error'); }
}

function getStatusIcon(status) {
  switch (status) {
    case 'online': return window.i18n.t('adminWorld.statusOnline');
    case 'warning': return window.i18n.t('adminWorld.statusWarning');
    case 'offline': return window.i18n.t('adminWorld.statusOffline');
    default: return window.i18n.t('adminWorld.statusUnknown');
  }
}

async function checkWorldHealth(worldId) {
  try {
    await apiRequest(`/admin/worlds/${worldId}/health`);
    alert('状态检查完成');
    loadWorlds();
  } catch (error) {
    alert('检查失败: ' + error.message);
  }
}

async function removeWorld(worldId) {
  if (!confirm('确定要移除这个世界吗？')) return;
  
  try {
    await apiRequest(`/admin/worlds/${worldId}`, { method: 'DELETE' });
    alert('世界移除成功！');
    loadWorlds();
  } catch (error) {
    alert('移除失败: ' + error.message);
  }
}

// ==================== 传送日志 ====================

async function loadLogs() {
  try {
    const searchTerm = document.getElementById('logs-search')?.value || '';
    const filter = document.getElementById('logs-filter')?.value || 'all';
    const page = document.getElementById('logs-page')?.value || 1;
    const limit = 50;
    
    const logs = await apiRequest(`/admin/portal-logs?limit=${limit}&page=${page}&search=${encodeURIComponent(searchTerm)}&filter=${filter}`);
    renderLogs(logs, page, limit);
  } catch (error) {
    document.getElementById('logs-content').innerHTML = 
      `<div class="empty">${window.i18n.t('adminWorld.loadFailed').replace('{{message}}', error.message)}</div>`;
  }
}

function renderLogs(logs, currentPage, limit) {
  const container = document.getElementById('logs-content');
  
  if (logs.length === 0) {
    container.innerHTML = '<div class="empty" data-i18n="adminWorld.logNoLogs">暂无传送日志</div>';
    if (typeof applyAdminTranslations === 'function') applyAdminTranslations(container);
    return;
  }

  const html = `
    <div style="margin-bottom: 15px;">
      <table>
        <thead>
          <tr>
            <th data-i18n="adminWorld.logTime">时间</th>
            <th data-i18n="adminWorld.logUser">用户</th>
            <th data-i18n="adminWorld.logCharacter">角色</th>
            <th data-i18n="adminWorld.logPortal">传送门</th>
            <th data-i18n="adminWorld.logType">类型</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(log => `
            <tr>
              <td>${new Date(log.used_at).toLocaleString()}</td>
              <td>${log.username}</td>
              <td>${log.character_name}</td>
              <td>${log.portal_name}</td>
              <td><span class="badge badge-${log.portal_type}">${log.portal_type === 'local' ? window.i18n.t('adminWorld.logLocal') : window.i18n.t('adminWorld.logRemote')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div style="display: flex; justify-content: center; align-items: center; gap: 10px; margin-top: 15px;">
      <button class="btn btn-sm" onclick="changePage(${parseInt(currentPage) - 1})" ${parseInt(currentPage) === 1 ? 'disabled' : ''} data-i18n="adminWorld.logPagePrev">上一页</button>
      <span>${window.i18n.t('adminWorld.logPageOf').replace('{{current}}', currentPage)}</span>
      <button class="btn btn-sm" onclick="changePage(${parseInt(currentPage) + 1})") data-i18n="adminWorld.logPageNext">下一页</button>
      <select id="logs-page" value="${currentPage}" onchange="changePage(this.value)">
        ${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${i + 1 === parseInt(currentPage) ? 'selected' : ''}>${i + 1}</option>`).join('')}
      </select>
    </div>
  `;
  
  container.innerHTML = html;
  if (typeof applyAdminTranslations === 'function') applyAdminTranslations(container);
}

function changePage(page) {
  document.getElementById('logs-page').value = page;
  loadLogs();
}

// ==================== 世界统计 ====================

async function loadWorldStats() {
  try {
    const timeRange = document.getElementById('stats-time-range').value;
    const stats = await apiRequest(`/admin/federation-stats?days=${timeRange}`);
    renderWorldStats(stats);
  } catch (error) {
    document.getElementById('world-stats-content').innerHTML = 
      `<div class="empty">${window.i18n.t('adminWorld.loadFailed').replace('{{message}}', error.message)}</div>`;
  }
}

async function renderWorldStats(stats) {
  const container = document.getElementById('world-stats-content');
  
  const html = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px;">
      <div class="stat-card">
        <div class="value">${stats.totalTeleports || 0}</div>
        <div class="label" data-i18n="adminWorld.totalTeleports">总传送次数</div>
      </div>
      <div class="stat-card">
        <div class="value">${stats.totalUsers || 0}</div>
        <div class="label" data-i18n="adminWorld.activeUsers">活跃用户</div>
      </div>
      <div class="stat-card">
        <div class="value">${stats.totalWorlds || 0}</div>
        <div class="label" data-i18n="adminWorld.connectedWorlds">连接世界</div>
      </div>
      <div class="stat-card">
        <div class="value">${stats.averageTime || '0s'}</div>
        <div class="label" data-i18n="adminWorld.averageStayTime">平均停留时间</div>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px;">
      <div class="chart-container">
        <h3 data-i18n="adminWorld.teleportTrend">传送量趋势</h3>
        <canvas id="teleport-trend-chart" height="250"></canvas>
      </div>
      <div class="chart-container">
        <h3 data-i18n="adminWorld.worldHeatRank">世界热度排行</h3>
        <canvas id="world-heat-chart" height="250"></canvas>
      </div>
    </div>
    
    <div class="chart-container">
      <h3 data-i18n="adminWorld.teleportFlowAnalysis">传送流向分析</h3>
      <canvas id="teleport-flow-chart" height="300"></canvas>
    </div>
  `;
  
  container.innerHTML = html;
  if (typeof applyAdminTranslations === 'function') applyAdminTranslations(container);
  
  // 先加载 Chart.js，再渲染图表
  if (typeof loadChartJS === 'function') {
    try {
      await loadChartJS();
    } catch (e) {
      console.error('加载 Chart.js 失败:', e);
      return;
    }
  }
  
  // 渲染图表
  renderTeleportTrendChart(stats.teleportTrend || []);
  renderWorldHeatChart(stats.worldHeat || []);
  renderTeleportFlowChart(stats.teleportFlow || []);
}

function renderTeleportTrendChart(data) {
  const ctx = document.getElementById('teleport-trend-chart').getContext('2d');
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(item => item.date),
      datasets: [{
        label: window.i18n.t('adminWorld.teleportCount'),
        data: data.map(item => item.count),
        borderColor: '#00ff00',
        backgroundColor: 'rgba(0, 255, 0, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 255, 0, 0.1)'
          },
          ticks: {
            color: '#e6edf3'
          }
        },
        x: {
          grid: {
            color: 'rgba(0, 255, 0, 0.1)'
          },
          ticks: {
            color: '#e6edf3'
          }
        }
      }
    }
  });
}

function renderWorldHeatChart(data) {
  const ctx = document.getElementById('world-heat-chart').getContext('2d');
  
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(item => item.worldName),
      datasets: [{
        label: window.i18n.t('adminWorld.visitCount'),
        data: data.map(item => item.count),
        backgroundColor: '#00ff00',
        borderColor: '#00cc00',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 255, 0, 0.1)'
          },
          ticks: {
            color: '#e6edf3'
          }
        },
        x: {
          grid: {
            color: 'rgba(0, 255, 0, 0.1)'
          },
          ticks: {
            color: '#e6edf3'
          }
        }
      }
    }
  });
}

function renderTeleportFlowChart(data) {
  const ctx = document.getElementById('teleport-flow-chart').getContext('2d');
  
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(item => item.sourceWorld),
      datasets: [{
        data: data.map(item => item.count),
        backgroundColor: [
          '#00ff00',
          '#58a6ff',
          '#bc8cff',
          '#ff4444',
          '#ff8c00',
          '#ffd700'
        ],
        borderWidth: 1,
        borderColor: '#161b22'
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#e6edf3'
          }
        }
      }
    }
  });
}














// ==================== 退出 ====================

function logout() {
  if (confirm('确定要退出管理后台吗？')) {
    localStorage.removeItem('token');
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    window.location.href = '/admin_login.html';
  }
}
