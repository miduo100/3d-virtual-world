/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 角色模板跨世界传输功能 - 前端UI
 * 实现角色模板资源引用管理和切换功能
 */

class FederationRoleTemplatesUI {
  constructor() {
    this.init();
  }

  /**
   * 初始化UI
   */
  init() {
    this.setupEventListeners();
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    // 页面加载完成后初始化
    document.addEventListener('DOMContentLoaded', () => {
      this.initRoleTemplateUI();
    });
  }

  /**
   * 初始化角色模板管理界面
   */
  initRoleTemplateUI() {
    // 查找角色模板管理相关的DOM元素
    const roleTemplateContainer = document.getElementById('federation-role-templates');
    if (roleTemplateContainer) {
      this.renderRoleTemplateUI(roleTemplateContainer);
    }
  }

  /**
   * 渲染角色模板管理界面
   */
  renderRoleTemplateUI(container) {
    container.innerHTML = `
      <div class="role-template-management">
        <h3>角色模板管理</h3>
        <div class="role-template-actions">
          <button id="btn-refresh-templates" class="btn btn-primary">刷新模板列表</button>
          <button id="btn-import-template" class="btn btn-success">导入联邦模板</button>
        </div>
        
        <div class="role-template-list-container">
          <h4>本地角色模板</h4>
          <div id="local-templates-list" class="role-template-list">
            <!-- 本地模板列表将在此渲染 -->
          </div>
        </div>
        
        <div class="role-template-list-container">
          <h4>联邦角色模板</h4>
          <div id="federated-templates-list" class="role-template-list">
            <!-- 联邦模板列表将在此渲染 -->
          </div>
        </div>
        
        <div class="active-template-info">
          <h4>当前激活的模板</h4>
          <div id="active-template-info">
            <!-- 当前激活的模板信息将在此显示 -->
          </div>
        </div>
      </div>
    `;

    // 设置按钮事件监听器
    this.setupRoleTemplateActions();
  }

  /**
   * 设置角色模板操作按钮事件
   */
  setupRoleTemplateActions() {
    // 刷新按钮
    const refreshBtn = document.getElementById('btn-refresh-templates');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshTemplates());
    }

    // 导入按钮
    const importBtn = document.getElementById('btn-import-template');
    if (importBtn) {
      importBtn.addEventListener('click', () => this.importFederatedTemplate());
    }
  }

  /**
   * 刷新角色模板列表
   */
  async refreshTemplates() {
    try {
      const userId = this.getCurrentUserId();
      if (!userId) {
        throw new Error('用户未登录');
      }

      // 获取本地模板列表
      const localTemplates = await this.fetchLocalRoleTemplates();
      this.renderLocalTemplates(localTemplates);

      // 获取联邦模板列表
      const federatedTemplates = await this.fetchFederatedRoleTemplates(userId);
      this.renderFederatedTemplates(federatedTemplates);

      // 获取当前激活的模板
      const activeTemplate = await this.fetchActiveTemplate(userId);
      this.renderActiveTemplateInfo(activeTemplate);

      console.log('角色模板列表刷新成功');
    } catch (error) {
      console.error('刷新角色模板列表失败:', error);
      alert(`刷新角色模板列表失败: ${error.message}`);
    }
  }

  /**
   * 获取本地角色模板列表
   */
  async fetchLocalRoleTemplates() {
    try {
      const response = await fetch('/api/character-templates');
      const data = await response.json();
      
      if (data.success) {
        return data.templates || [];
      } else {
        throw new Error(data.error || '获取角色模板失败');
      }
    } catch (error) {
      console.error('获取本地角色模板失败:', error);
      return [];
    }
  }

  /**
   * 获取联邦角色模板列表
   */
  async fetchFederatedRoleTemplates(userId) {
    try {
      const response = await fetch(`/api/federation/character-templates/user/${userId}`);
      const data = await response.json();
      
      if (data.success) {
        return data.templates || [];
      } else {
        throw new Error(data.error || '获取联邦角色模板失败');
      }
    } catch (error) {
      console.error('获取联邦角色模板失败:', error);
      return [];
    }
  }

  /**
   * 获取当前激活的模板
   */
  async fetchActiveTemplate(userId) {
    try {
      const response = await fetch(`/api/federation/character-templates/user/${userId}`);
      const data = await response.json();
      
      if (data.success) {
        const activeTemplate = data.templates.find(template => template.is_active);
        return activeTemplate || null;
      } else {
        throw new Error(data.error || '获取激活模板失败');
      }
    } catch (error) {
      console.error('获取激活模板失败:', error);
      return null;
    }
  }

  /**
   * 渲染本地角色模板列表
   */
  renderLocalTemplates(templates) {
    const container = document.getElementById('local-templates-list');
    if (container) {
      if (templates.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无本地角色模板</div>';
        return;
      }

      container.innerHTML = `
        <div class="template-list">
          ${templates.map(template => this.renderTemplateItem(template, 'local')).join('')}
        </div>
      `;

      // 设置切换按钮事件
      templates.forEach(template => {
        const switchBtn = document.getElementById(`switch-template-${template.id}`);
        if (switchBtn) {
          switchBtn.addEventListener('click', () => this.switchToTemplate(template.id, 'local'));
        }
      });
    }
  }

  /**
   * 渲染联邦角色模板列表
   */
  renderFederatedTemplates(templates) {
    const container = document.getElementById('federated-templates-list');
    if (container) {
      if (templates.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无联邦角色模板</div>';
        return;
      }

      container.innerHTML = `
        <div class="template-list">
          ${templates.map(template => this.renderTemplateItem(template, 'federated')).join('')}
        </div>
      `;

      // 设置切换按钮事件
      templates.forEach(template => {
        const switchBtn = document.getElementById(`switch-template-${template.local_template_id}`);
        if (switchBtn) {
          switchBtn.addEventListener('click', () => this.switchToTemplate(template.local_template_id, 'federated'));
        }

        // 设置删除按钮事件
        const deleteBtn = document.getElementById(`delete-template-${template.id}`);
        if (deleteBtn) {
          deleteBtn.addEventListener('click', () => this.deleteFederatedTemplate(template.id));
        }

        // 设置查看详细按钮事件
        const viewBtn = document.getElementById(`view-template-${template.id}`);
        if (viewBtn) {
          viewBtn.addEventListener('click', () => this.viewTemplateDetails(template));
        }
      });
    }
  }

  /**
   * 渲染单个模板项
   */
  renderTemplateItem(template, templateSource) {
    const isActive = template.is_active;
    
    return `
      <div class="role-template-item ${isActive ? 'active' : ''}">
        <div class="template-info">
          <h5>${template.template_name || template.name || '未命名模板'}</h5>
          <div class="template-meta">
            <span class="template-id">ID: ${template.id}</span>
            <span class="template-source">
              ${templateSource === 'local' ? '本地模板' : '联邦模板'}
              ${templateSource === 'federated' ? ` (来自: ${template.source_world_name || '未知世界'})` : ''}
            </span>
            ${isActive ? '<span class="template-active">当前激活</span>' : ''}
          </div>
        </div>
        
        <div class="template-actions">
          ${!isActive ? `
            <button id="switch-template-${templateSource === 'federated' ? template.local_template_id : template.id}" 
                    class="btn btn-primary btn-sm">
              切换到此模板
            </button>
          ` : ''}
          
          ${templateSource === 'federated' ? `
            <button id="view-template-${template.id}" class="btn btn-info btn-sm">
              查看详细
            </button>
            <button id="delete-template-${template.id}" class="btn btn-danger btn-sm">
              删除
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * 渲染当前激活的模板信息
   */
  renderActiveTemplateInfo(template) {
    const container = document.getElementById('active-template-info');
    if (container) {
      if (!template) {
        container.innerHTML = '<div class="empty-state">未激活任何角色模板，使用默认角色</div>';
        return;
      }

      container.innerHTML = `
        <div class="active-template-info">
          <h5>${template.template_name || '未命名模板'}</h5>
          <div class="template-meta">
            <span class="template-id">模板ID: ${template.id}</span>
            <span class="template-source">
              ${template.is_federated ? '联邦模板' : '本地模板'}
              ${template.is_federated ? ` (来自: ${template.source_world_name || '未知世界'})` : ''}
            </span>
            <span class="template-status">已激活</span>
          </div>
          <div class="template-details">
            ${template.source_world_id ? `源世界ID: ${template.source_world_id}` : ''}
            ${template.source_template_id ? `源模板ID: ${template.source_template_id}` : ''}
          </div>
        </div>
      `;
    }
  }

  /**
   * 切换角色模板
   */
  async switchToTemplate(templateId, templateSource) {
    try {
      const userId = this.getCurrentUserId();
      if (!userId) {
        throw new Error('用户未登录');
      }

      const response = await fetch('/api/federation/character-templates/switch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          templateId,
          templateSource
        })
      });

      const data = await response.json();

      if (data.success) {
        alert('角色模板切换成功！');
        this.refreshTemplates();
      } else {
        throw new Error(data.error || '切换模板失败');
      }
    } catch (error) {
      console.error('切换角色模板失败:', error);
      alert(`切换角色模板失败: ${error.message}`);
    }
  }

  /**
   * 删除联邦角色模板
   */
  async deleteFederatedTemplate(templateId) {
    if (!confirm('确定要删除这个联邦角色模板引用吗？')) {
      return;
    }

    try {
      const response = await fetch(`/api/federation/character-templates/federated/${templateId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        alert('联邦角色模板引用已删除！');
        this.refreshTemplates();
      } else {
        throw new Error(data.error || '删除联邦角色模板失败');
      }
    } catch (error) {
      console.error('删除联邦角色模板失败:', error);
      alert(`删除联邦角色模板失败: ${error.message}`);
    }
  }

  /**
   * 查看角色模板详细信息
   */
  async viewTemplateDetails(template) {
    try {
      const response = await fetch(`/api/federation/character-templates/federated/${template.id}`);
      const data = await response.json();

      if (data.success) {
        this.showTemplateDetailsModal(data.template);
      } else {
        throw new Error(data.error || '获取角色模板详细信息失败');
      }
    } catch (error) {
      console.error('获取角色模板详细信息失败:', error);
      alert(`获取角色模板详细信息失败: ${error.message}`);
    }
  }

  /**
   * 显示角色模板详细信息模态框
   */
  showTemplateDetailsModal(template) {
    const modal = document.createElement('div');
    modal.className = 'template-details-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h4>角色模板详细信息</h4>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="template-details">
            <div class="detail-section">
              <h5>基本信息</h5>
              <p><strong>模板名称:</strong> ${template.template_name || '未命名'}</p>
              <p><strong>模板ID:</strong> ${template.id}</p>
              <p><strong>源世界ID:</strong> ${template.source_world_id || 'N/A'}</p>
              <p><strong>源模板ID:</strong> ${template.source_template_id || 'N/A'}</p>
              <p><strong>创建时间:</strong> ${new Date(template.created_at).toLocaleString()}</p>
              <p><strong>更新时间:</strong> ${new Date(template.updated_at).toLocaleString()}</p>
            </div>

            <div class="detail-section">
              <h5>资源引用</h5>
              <pre class="resource-urls">${JSON.stringify(template.resource_urls, null, 2)}</pre>
            </div>

            ${template.bone_map ? `
              <div class="detail-section">
                <h5>骨骼映射</h5>
                <pre class="bone-map">${JSON.stringify(template.bone_map, null, 2)}</pre>
              </div>
            ` : ''}

            ${template.anim_adapt ? `
              <div class="detail-section">
                <h5>动画适配</h5>
                <pre class="anim-adapt">${JSON.stringify(template.anim_adapt, null, 2)}</pre>
              </div>
            ` : ''}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary modal-close">关闭</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 设置关闭按钮事件
    const closeButtons = modal.querySelectorAll('.modal-close');
    closeButtons.forEach(button => {
      button.addEventListener('click', () => {
        modal.remove();
      });
    });

    // 点击模态框外部关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  /**
   * 导入联邦角色模板
   */
  importFederatedTemplate() {
    // 这里可以添加导入联邦角色模板的逻辑
    // 例如：显示一个对话框让用户输入模板配置信息
    const templateConfig = prompt('请输入联邦角色模板配置信息（JSON格式）：');
    if (templateConfig) {
      try {
        const config = JSON.parse(templateConfig);
        this.importTemplateFromConfig(config);
      } catch (error) {
        alert('配置信息格式错误');
        console.error('配置信息解析失败:', error);
      }
    }
  }

  /**
   * 从配置导入角色模板
   */
  async importTemplateFromConfig(config) {
    try {
      const response = await fetch('/api/federation/character-templates/import-references', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config)
      });

      const data = await response.json();

      if (data.success) {
        alert(`角色模板导入成功！模板ID: ${data.localTemplateId}`);
        this.refreshTemplates();
      } else {
        throw new Error(data.error || '导入角色模板失败');
      }
    } catch (error) {
      console.error('导入角色模板失败:', error);
      alert(`导入角色模板失败: ${error.message}`);
    }
  }

  /**
   * 获取当前用户ID
   */
  getCurrentUserId() {
    // 这里可以从用户登录信息中获取用户ID
    const currentUser = window.currentUser || this.getCurrentUserFromCookie();
    return currentUser?.id;
  }

  /**
   * 从Cookie获取当前用户信息
   */
  getCurrentUserFromCookie() {
    try {
      const userCookie = document.cookie.match(/user=(.*?);/);
      if (userCookie) {
        return JSON.parse(decodeURIComponent(userCookie[1]));
      }
    } catch (error) {
      console.error('解析用户Cookie失败:', error);
    }
    return null;
  }
}

/**
 * 角色模板管理界面样式
 */
const roleTemplateCSS = `
.role-template-management {
  padding: 20px;
}

.role-template-actions {
  margin-bottom: 20px;
}

.role-template-list-container {
  margin-bottom: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 15px;
  background: var(--card-bg);
}

.role-template-list-container h4 {
  margin-top: 0;
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.role-template-list {
  min-height: 100px;
}

.template-list {
  display: grid;
  gap: 10px;
}

.role-template-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  transition: all 0.2s;
}

.role-template-item:hover {
  border-color: var(--green);
  background: var(--green-dim);
}

.role-template-item.active {
  border-color: var(--blue);
  background: rgba(88, 166, 255, 0.1);
  box-shadow: 0 0 10px rgba(88, 166, 255, 0.2);
}

.template-info h5 {
  margin: 0;
  font-size: 16px;
  color: var(--text);
}

.template-meta {
  display: flex;
  gap: 10px;
  margin-top: 5px;
  font-size: 12px;
  color: var(--muted);
}

.template-id {
  font-family: 'Courier New', monospace;
  background: rgba(0, 0, 0, 0.5);
  padding: 2px 6px;
  border-radius: 3px;
}

.template-source {
  background: rgba(0, 255, 0, 0.1);
  color: var(--green);
  padding: 2px 6px;
  border-radius: 3px;
}

.template-active {
  background: rgba(88, 166, 255, 0.2);
  color: var(--blue);
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: bold;
}

.template-status {
  background: rgba(88, 166, 255, 0.2);
  color: var(--blue);
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: bold;
}

.template-actions {
  display: flex;
  gap: 8px;
}

.template-actions .btn {
  font-size: 12px;
  padding: 5px 12px;
}

.active-template-info {
  margin-top: 30px;
  padding: 20px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.active-template-info h4 {
  margin-top: 0;
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--muted);
  font-style: italic;
}

/* 模态框样式 */
.template-details-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 80%;
  max-width: 800px;
  max-height: 80vh;
  overflow: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--sidebar-bg);
  border-radius: 8px 8px 0 0;
}

.modal-header h4 {
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  color: var(--text);
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s;
}

.modal-close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.modal-body {
  padding: 20px;
}

.modal-footer {
  padding: 15px 20px;
  border-top: 1px solid var(--border);
  text-align: right;
}

.detail-section {
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--border);
}

.detail-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.detail-section h5 {
  margin: 0 0 10px 0;
}

.detail-section p {
  margin: 5px 0;
  line-height: 1.4;
}

.pre {
  background: rgba(0, 0, 0, 0.3);
  padding: 10px;
  border-radius: 4px;
  overflow-x: auto;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.4;
}

.resource-urls, .bone-map, .anim-adapt {
  background: rgba(0, 0, 0, 0.3);
  padding: 10px;
  border-radius: 4px;
  overflow-x: auto;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.4;
}
`;

// 添加样式到页面
if (!document.querySelector('style[data-role-templates]')) {
  const styleElement = document.createElement('style');
  styleElement.setAttribute('data-role-templates', 'true');
  styleElement.textContent = roleTemplateCSS;
  document.head.appendChild(styleElement);
}

// 实例化角色模板UI
document.addEventListener('DOMContentLoaded', () => {
  if (window.federationRoleTemplatesUI) {
    console.warn('角色模板管理UI已实例化');
    return;
  }
  window.federationRoleTemplatesUI = new FederationRoleTemplatesUI();
  console.log('角色模板管理UI初始化完成');
});
