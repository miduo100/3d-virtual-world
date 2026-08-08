/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 维护工具页面 JS
 * 管理后台"维护工具"菜单的前端交互逻辑
 * 
 * 负责任务：加载脚本列表、执行脚本、展示执行日志
 * 文件行数: ~400 行，符合 ≤500 行规范
 */

window.MaintenancePage = (function() {
  'use strict';

  const API_BASE = '/api/admin/maintenance';

  // 带认证的 fetch 封装（与 admin.js apiRequest 保持一致的认证逻辑）
  function authFetch(url, options = {}) {
    const token = localStorage.getItem('adminToken');
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': 'Bearer ' + token }),
        ...options.headers,
      },
    }).then(res => {
      if (res.status === 401 || res.status === 403) {
        alert('管理员权限不足或登录已过期，请重新登录');
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        window.location.href = '/admin_login.html';
        throw new Error('Unauthorized');
      }
      return res;
    });
  }

  // ==================== 脚本卡片配置 ====================

  const scriptCards = [
    {
      id: 'cleanup_invalid_model_path', label: '清理无效 model_path',
      category: 'cleanup', icon: '🧹',
      desc: '扫描并清理指向不存在文件或无效几何类型（如 geometry:village）的 model_path',
      color: '#f0a030',
    },
    {
      id: 'check_broken_references', label: '检查文件引用完整性',
      category: 'check', icon: '🔍',
      desc: '检查 buildings/characters/weapons/world_objects 中所有文件引用是否有效',
      color: '#58a6ff',
    },
    {
      id: 'cleanup_orphan_uploads', label: '清理孤立上传文件',
      category: 'cache', icon: '🗑️',
      desc: '扫描 uploads/ 目录，找出未被数据库引用的文件。先预览再确认删除',
      color: '#f85149',
    },
    {
      id: 'cleanup_orphan_objects', label: '清理孤立世界对象',
      category: 'cleanup', icon: '🪣',
      desc: '清理 world_objects 中引用不存在的 building_id/character_id 的记录',
      color: '#f0a030',
    },
    {
      id: 'refresh_geometry_buildings', label: '重新初始化基础几何体',
      category: 'repair', icon: '🔄',
      desc: '确保 14 种基础几何体建筑（box/sphere/cylinder 等）存在于 buildings 表',
      color: '#56d364',
    },
    {
      id: 'verify_db_schema', label: '数据库完整性验证',
      category: 'check', icon: '✅',
      desc: '检查关键表结构、必填字段、种子数据是否完整',
      color: '#58a6ff',
    },
  ];

  // ==================== 页面初始化 ====================

  function init() {
    const container = document.getElementById('maintenance-scripts-grid');
    if (!container) return;

    // 渲染脚本卡片
    let html = '';
    scriptCards.forEach((sc) => {
      html += `
        <div class="card maintenance-card" id="card-${sc.id}">
          <div class="card-header" style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:22px;">${sc.icon}</span>
            <div style="flex:1;">
              <div class="card-title" style="font-size:14px;">${sc.label}</div>
            </div>
            <span class="badge" style="background:${sc.color}22;color:${sc.color};font-size:11px;padding:2px 8px;border-radius:10px;">
              ${getCategoryLabel(sc.category)}
            </span>
          </div>
          <div style="padding:0 18px 8px;">
            <p style="font-size:12px;color:#aaa;margin:0 0 8px 0;line-height:1.5;">${sc.desc}</p>
            <div id="status-${sc.id}" style="font-size:11px;color:var(--muted);margin-bottom:6px;"></div>
          </div>
          <div style="padding:8px 18px 14px;display:flex;gap:8px;">
            <button class="btn btn-sm" id="btn-run-${sc.id}"
              onclick="MaintenancePage.runScript('${sc.id}')"
              style="flex:1;background:${sc.color};border-color:${sc.color};">
              ▶ 立即执行
            </button>
            <button class="btn btn-sm btn-secondary" id="btn-log-${sc.id}"
              onclick="MaintenancePage.showScriptLogs('${sc.id}')"
              style="font-size:11px;" title="查看此脚本的历史日志">
              📋 日志
            </button>
          </div>
        </div>`;
    });
    container.innerHTML = html;

    // 加载最近执行状态
    loadLastRunStatus();
    refreshLogs();
  }

  function getCategoryLabel(cat) {
    const map = { cleanup: '清理', check: '检查', cache: '缓存', repair: '修复' };
    return map[cat] || cat;
  }

  // ==================== 加载上次执行状态 ====================

  async function loadLastRunStatus() {
    try {
      const res = await authFetch(`${API_BASE}/scripts-list`);
      const data = await res.json();
      if (!data.scripts) return;

      data.scripts.forEach((s) => {
        const statusEl = document.getElementById('status-' + s.id);
        if (!statusEl) return;

        if (!s.lastRun) {
          statusEl.innerHTML = '<span style="color:var(--muted);">从未执行</span>';
          return;
        }

        const st = s.lastRun;
        const icon = st.status === 'success' ? '✅' : st.status === 'error' ? '❌' : '⏳';
        const color = st.status === 'success' ? 'var(--green)' : st.status === 'error' ? '#f85149' : 'var(--muted)';

        const time = new Date(st.started_at);
        const timeStr = time.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        statusEl.innerHTML = `<span style="color:${color}">${icon} 上次: ${timeStr}</span>
          <div style="font-size:11px;color:${color};margin-top:3px;">${escapeHtml(st.result_summary || '')}</div>`;
      });
    } catch (e) {
      console.error('加载脚本状态失败:', e);
    }
  }

  // ==================== 执行脚本 ====================

  async function runScript(scriptId) {
    const card = scriptCards.find((s) => s.id === scriptId);
    if (!card) return;

    // 危险操作需要二次确认
    const dangerous = scriptId === 'cleanup_orphan_uploads';
    if (dangerous) {
      const confirmed = confirm(
        `⚠️ 危险操作确认\n\n"${card.label}" 将删除 uploads/ 目录中的孤立文件。\n\n是否先预览模式查看？\n\n点击"确定"进入预览模式，点击"取消"放弃操作。`
      );
      if (!confirmed) return;
    }

    // 更新 UI 为执行中
    setCardRunning(scriptId, true);

    try {
      const body = dangerous ? { confirm: false } : {};
      const res = await authFetch(`${API_BASE}/${scriptId.replace(/_/g, '-')}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok) {
        alert(`✅ 执行完成\n\n${data.message || '操作成功'}`);
      } else {
        alert(`❌ 执行失败\n\n${data.error || '未知错误'}`);
      }
    } catch (e) {
      alert(`❌ 网络错误\n\n${e.message}`);
    } finally {
      setCardRunning(scriptId, false);
      loadLastRunStatus();
      refreshLogs();
    }
  }

  function setCardRunning(scriptId, isRunning) {
    const btn = document.getElementById('btn-run-' + scriptId);
    const statusEl = document.getElementById('status-' + scriptId);

    if (btn) {
      btn.disabled = isRunning;
      btn.innerHTML = isRunning ? '⏳ 执行中...' : '▶ 立即执行';
    }
    if (statusEl && isRunning) {
      statusEl.innerHTML = '<span style="color:var(--blue);">⏳ 正在执行...</span>';
    }
  }

  // ==================== 执行日志 ====================

  async function refreshLogs() {
    const container = document.getElementById('maintenance-logs');
    if (!container) return;

    try {
      const res = await authFetch(`${API_BASE}/logs?limit=30`);
      const data = await res.json();

      if (!data.logs || data.logs.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);">暂无执行记录</div>';
        return;
      }

      let html = '';
      data.logs.forEach((log) => {
        const icon = log.status === 'success' ? '✅' : log.status === 'error' ? '❌' : '⏳';
        const bgColor = log.status === 'error' ? 'rgba(248,81,73,0.06)' : 'transparent';
        const time = new Date(log.started_at);
        const timeStr = time.toLocaleString('zh-CN');

        html += `
          <div class="log-row" style="padding:10px 16px;display:flex;align-items:flex-start;gap:10px;
            border-bottom:1px solid var(--border);background:${bgColor};font-size:13px;">
            <span style="width:20px;">${icon}</span>
            <div style="flex:1;">
              <div style="font-weight:600;">${escapeHtml(log.script_label || log.script_id)}</div>
              <div style="color:var(--muted);font-size:12px;margin-top:2px;">
                ${escapeHtml(log.result_summary || (log.status === 'error' ? escapeHtml(log.error_message || '') : ''))}
              </div>
              ${log.affected_rows > 0 ? `<div style="color:var(--muted);font-size:11px;">影响: ${log.affected_rows} 条</div>` : ''}
            </div>
            <div style="font-size:11px;color:var(--muted);white-space:nowrap;">${timeStr}</div>
          </div>`;
      });
      container.innerHTML = html;
    } catch (e) {
      console.error('加载日志失败:', e);
      container.innerHTML = '<div style="text-align:center;padding:30px;color:#f85149;">加载日志失败</div>';
    }
  }

  /** 查看指定脚本的详细日志 */
  async function showScriptLogs(scriptId) {
    try {
      const res = await authFetch(`${API_BASE}/logs?script_id=${scriptId}&limit=10`);
      const data = await res.json();
      if (!data.logs || data.logs.length === 0) {
        alert('该脚本暂无执行记录');
        return;
      }

      const card = scriptCards.find((s) => s.id === scriptId);
      let msg = `📋 ${card ? card.label : scriptId} - 最近 10 条记录\n\n`;
      data.logs.forEach((log, i) => {
        const icon = log.status === 'success' ? '✅' : log.status === 'error' ? '❌' : '⏳';
        const time = new Date(log.started_at).toLocaleString('zh-CN');
        msg += `${icon} ${time}\n   ${log.result_summary || log.error_message || '无详情'}\n\n`;
      });
      alert(msg);
    } catch (e) {
      alert('获取日志失败: ' + e.message);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ==================== 导出 ====================

  return {
    init,
    runScript,
    refreshLogs,
    showScriptLogs,
  };
})();
