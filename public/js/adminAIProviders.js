/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// AI提供商管理功能

// i18n 兜底：未初始化时返回 key 本身
const _tcfg = (k) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : k;
const _tcfgp = (k, p) => (window.i18n && window.i18n.tp) ? window.i18n.tp(k, p) : k;

let aiProviders = [];

// 加载AI提供商列表
async function loadAIProviders() {
  const container = document.getElementById('ai-providers-list');
  
  try {
    const response = await fetch('/api/ai-providers/providers');
    const data = await response.json();
    
    if (data.success && data.providers) {
      aiProviders = data.providers;
      renderAIProviders(data.providers);
    } else {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #ff0000;">
          <div style="font-size: 48px; margin-bottom: 15px;">❌</div>
          <div>${_tcfg('adminSystem.loadFailed')}</div>
        </div>
      `;
    }
  } catch (error) {
    console.error('加载AI提供商失败:', error);
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #ff0000;">
        <div style="font-size: 48px; margin-bottom: 15px;">❌</div>
        <div>${_tcfgp('adminSystem.loadFailedMsg', { message: error.message })}</div>
      </div>
    `;
  }
}

// 渲染AI提供商列表
function renderAIProviders(providers) {
  const container = document.getElementById('ai-providers-list');
  
  if (!providers || providers.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #888;">
        <div style="font-size: 48px; margin-bottom: 15px;">🤖</div>
        <div>${_tcfg('adminSystem.empty')}</div>
      </div>
    `;
    return;
  }
  
  // 按类型分组（支持多类型provider_type用逗号分隔）
  const groupedProviders = {};
  providers.forEach(provider => {
    // 支持多类型，如 "chat,image_to_3d"
    const types = provider.provider_type.split(',').map(t => t.trim());
    
    types.forEach(type => {
      if (!groupedProviders[type]) {
        groupedProviders[type] = [];
      }
      // 避免重复添加
      if (!groupedProviders[type].find(p => p.id === provider.id)) {
        groupedProviders[type].push(provider);
      }
    });
  });
  
  const typeNames = {
    'chat': _tcfg('adminSystem.typeChat'),
    'image_to_3d': _tcfg('adminSystem.typeImgTo3d'),
    'text_to_3d': _tcfg('adminSystem.typeTextTo3d'),
    'tts': _tcfg('adminSystem.typeTts'),
    'stt': _tcfg('adminSystem.typeStt')
  };
  
  container.innerHTML = Object.entries(groupedProviders).map(([type, typeProviders]) => `
    <div style="margin-bottom: 30px;">
      <h4 style="color: #667eea; margin-bottom: 15px; font-size: 18px;">
        ${typeNames[type] || type}
      </h4>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
        ${typeProviders.map(provider => renderProviderCard(provider)).join('')}
      </div>
    </div>
  `).join('');
}

// 渲染单个提供商卡片
function renderProviderCard(provider) {
  const statusColor = provider.is_enabled ? '#00ff00' : '#888';
  const statusText = provider.is_enabled ? _tcfg('adminSystem.cardEnabled') : _tcfg('adminSystem.cardDisabled');
  const isDefault = provider.is_default ? `<span style="background: #ffc107; color: #000; padding: 2px 8px; border-radius: 3px; font-size: 11px; margin-left: 8px;">${_tcfg('adminSystem.cardDefault')}</span>` : '';
  
  // 多功能标签
  const types = provider.provider_type.split(',').map(t => t.trim());
  const typeLabels = {
    'chat': _tcfg('adminSystem.badgeChat'),
    'image_to_3d': _tcfg('adminSystem.badgeImgTo3d'),
    'text_to_3d': _tcfg('adminSystem.badgeTextTo3d'),
    'tts': _tcfg('adminSystem.badgeTts'),
    'stt': _tcfg('adminSystem.badgeStt')
  };
  const featureBadges = types.length > 1 
    ? `<div style="margin-top: 6px;">${types.map(t => 
        `<span style="background: rgba(102, 126, 234, 0.3); color: #667eea; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-right: 4px;">${typeLabels[t] || t}</span>`
      ).join('')}</div>` 
    : '';
  
  // 获取配置状态
  const configs = provider.configs || [];
  const configuredCount = configs.filter(c => c.has_value).length;
  const totalCount = configs.length;
  const configStatus = configuredCount === totalCount && totalCount > 0 
    ? `<span style="color: #00ff00;">${_tcfg('adminSystem.cardConfigured')}</span>` 
    : `<span style="color: #ffa500;">${_tcfgp('adminSystem.cardNotConfigured', { configured: configuredCount, total: totalCount })}</span>`;
  
  return `
    <div style="
      background: rgba(0, 0, 0, 0.4);
      border: 2px solid ${provider.is_enabled ? '#00ff00' : '#444'};
      border-radius: 8px;
      padding: 14px;
    ">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; margin-bottom: 6px;">
            <h4 style="color: #00ff00; margin: 0; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${provider.display_name}</h4>
            ${isDefault}
          </div>
          <div style="color: #888; font-size: 12px; margin-bottom: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${provider.description || ''}</div>
          ${featureBadges}
          <div style="font-size: 11px; margin-top: 6px;">
            <span style="color: ${statusColor};">${statusText}</span>
            <span style="margin-left: 10px;">${configStatus}</span>
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
          <label class="switch">
            <input type="checkbox" 
                   ${provider.is_enabled ? 'checked' : ''} 
                   onchange="toggleProvider(${provider.id}, this.checked)">
            <span class="slider"></span>
          </label>
        </div>
      </div>
      
      <div style="display: grid; gap: 8px; margin-top: 10px;">
        <button onclick="showProviderConfig(${provider.id})" style="
          padding: 8px 10px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-weight: bold;
          font-size: 13px;
        ">${_tcfg('adminSystem.cardConfigure')}</button>
        
        ${provider.is_enabled ? `
          <button onclick="testProviderConnection(${provider.id})" style="
            padding: 8px 10px;
            background: #00cc00;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            font-size: 13px;
          ">${_tcfg('adminSystem.cardTest')}</button>
        ` : ''}
        
        ${!provider.is_default ? `
          <button onclick="setDefaultProvider(${provider.id})" style="
            padding: 8px 10px;
            background: #ffc107;
            color: #000;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            font-size: 13px;
          ">${_tcfg('adminSystem.cardSetDefault')}</button>
        ` : ''}
      </div>
    </div>
  `;
}

// 启用/禁用提供商
async function toggleProvider(providerId, enabled) {
  try {
    const response = await fetch(`/api/ai-providers/providers/${providerId}/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
      },
      body: JSON.stringify({ enabled })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 刷新列表
      await loadAIProviders();
    } else {
      alert(_tcfgp('adminSystem.opFailed', { message: data.error }));
      await loadAIProviders(); // 重新加载恢复状态
    }
  } catch (error) {
    console.error('切换提供商状态失败:', error);
    alert(_tcfgp('adminSystem.opFailed', { message: error.message }));
    await loadAIProviders(); // 重新加载恢复状态
  }
}

// 显示提供商配置对话框
async function showProviderConfig(providerId) {
  try {
    const response = await fetch(`/api/ai-providers/providers/${providerId}?include_sensitive=true`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
      }
    });
    
    const data = await response.json();
    
    if (!data.success || !data.provider) {
      alert(_tcfg('adminSystem.getConfigFailed'));
      return;
    }
    
    const provider = data.provider;
    const schema = provider.config_schema?.fields || [];
    
    // 创建配置对话框
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
          <h2>${_tcfgp('adminSystem.modalConfigTitle', { name: provider.display_name })}</h2>
          <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
        </div>
        
        <div style="margin-bottom: 20px; padding: 15px; background: rgba(102, 126, 234, 0.1); border-left: 4px solid #667eea; border-radius: 5px;">
          <div style="color: #667eea; font-weight: bold; margin-bottom: 5px;">${_tcfg('adminSystem.modalConfigHint')}</div>
          <div style="color: #ccc; font-size: 13px;">
            ${provider.description || _tcfg('adminSystem.modalHintDefault')}
          </div>
        </div>
        
        <form id="provider-config-form" onsubmit="saveProviderConfig(event, ${providerId})">
          ${schema.map(field => renderConfigField(field, provider)).join('')}
          
          <div class="action-btns" style="margin-top: 25px;">
            <button type="submit" class="btn" style="background: linear-gradient(135deg, #00ff00 0%, #00cc00 100%);">
              ${_tcfg('adminSystem.modalSave')}
            </button>
            <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">
              ${_tcfg('adminSystem.cancel')}
            </button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(modal);
  } catch (error) {
    console.error('加载配置失败:', error);
    alert(_tcfgp('adminSystem.loadConfigFailed', { message: error.message }));
  }
}

// 渲染配置字段
function renderConfigField(field, provider) {
  // 获取当前值
  const currentConfig = (provider.configs || []).find(c => c.key === field.key);
  const currentValue = currentConfig ? currentConfig.value : (field.default || '');
  
  const required = field.required ? 'required' : '';
  const placeholder = field.placeholder || '';
  
  // 先算好提示文本（避免嵌套模板字符串）
  const optCount = (field.options || []).length;
  const selectHintText = _tcfg('adminSystem.selectHint') + (optCount > 0 ? _tcfgp('adminSystem.selectOptions', { count: optCount }) : '');
  
  if (field.type === 'select') {
    // 对于模型字段或选项超过5个的，使用可搜索的input+datalist
    const isModelField = field.key === 'model' || field.label.includes('模型');
    const useDatalist = isModelField || (field.options || []).length > 5;
    
    if (useDatalist) {
      const datalistId = `datalist-${field.key}-${Date.now()}`;
      return `
        <div class="form-group">
          <label>${field.label} ${field.required ? '*' : ''}</label>
          <input 
            type="text" 
            name="${field.key}" 
            list="${datalistId}"
            value="${currentValue}"
            placeholder="${_tcfgp('adminSystem.inputOrSelect', { label: field.label })}"
            ${required}
            style="
              width: 100%;
              padding: 12px;
              background: rgba(0, 0, 0, 0.5);
              border: 2px solid #00ff00;
              color: #fff;
              border-radius: 5px;
              font-family: 'Courier New', monospace;
            ">
          <datalist id="${datalistId}">
            ${(field.options || []).map(opt => `
              <option value="${opt}">${opt}</option>
            `).join('')}
          </datalist>
          <div style="color: #888; font-size: 11px; margin-top: 5px;">
            ${selectHintText}
          </div>
        </div>
      `;
    } else {
      return `
        <div class="form-group">
          <label>${field.label} ${field.required ? '*' : ''}</label>
          <select name="${field.key}" ${required} style="
            width: 100%;
            padding: 12px;
            background: rgba(0, 0, 0, 0.5);
            border: 2px solid #00ff00;
            color: #fff;
            border-radius: 5px;
          ">
            ${(field.options || []).map(opt => `
              <option value="${opt}" ${currentValue === opt ? 'selected' : ''}>${opt}</option>
            `).join('')}
          </select>
        </div>
      `;
    }
  } else if (field.type === 'password') {
    return `
      <div class="form-group">
        <label>${field.label} ${field.required ? '*' : ''}</label>
        <input type="password" 
               name="${field.key}" 
               placeholder="${placeholder}"
               value="${currentValue}"
               ${required}
               style="
                 width: 100%;
                 padding: 12px;
                 background: rgba(0, 0, 0, 0.5);
                 border: 2px solid #00ff00;
                 color: #fff;
                 border-radius: 5px;
                 font-family: 'Courier New', monospace;
               ">
        <div style="display: flex; align-items: center; margin-top: 8px;">
          <input type="checkbox" id="show-${field.key}" onchange="togglePasswordVisibility('${field.key}')" style="margin-right: 8px;">
          <label for="show-${field.key}" style="color: #888; font-size: 12px; cursor: pointer; margin: 0;">${_tcfg('adminSystem.showKey')}</label>
        </div>
      </div>
    `;
  } else {
    return `
      <div class="form-group">
        <label>${field.label} ${field.required ? '*' : ''}</label>
        <input type="text" 
               name="${field.key}" 
               placeholder="${placeholder}"
               value="${currentValue}"
               ${required}
               style="
                 width: 100%;
                 padding: 12px;
                 background: rgba(0, 0, 0, 0.5);
                 border: 2px solid #00ff00;
                 color: #fff;
                 border-radius: 5px;
                 font-family: 'Courier New', monospace;
               ">
      </div>
    `;
  }
}

// 切换密码可见性
function togglePasswordVisibility(fieldKey) {
  const checkbox = document.getElementById(`show-${fieldKey}`);
  const input = document.querySelector(`input[name="${fieldKey}"]`);
  
  if (checkbox && input) {
    input.type = checkbox.checked ? 'text' : 'password';
  }
}

// 保存提供商配置
async function saveProviderConfig(event, providerId) {
  event.preventDefault();
  
  const form = event.target;
  const formData = new FormData(form);
  const configs = {};
  
  for (let [key, value] of formData.entries()) {
    configs[key] = value;
  }
  
  try {
    const response = await fetch(`/api/ai-providers/providers/${providerId}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
      },
      body: JSON.stringify({ configs })
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert(_tcfg('adminSystem.saveSuccess'));
      // 关闭对话框
      form.closest('.modal').remove();
      // 刷新列表
      await loadAIProviders();
    } else {
      alert(_tcfgp('adminSystem.saveFailed', { message: data.message }));
    }
  } catch (error) {
    console.error('保存配置失败:', error);
    alert(_tcfgp('adminSystem.saveFailed', { message: error.message }));
  }
}

// 测试提供商连接
async function testProviderConnection(providerId) {
  try {
    const btn = event.target;
    const originalText = btn.innerHTML;
    btn.innerHTML = _tcfg('adminSystem.testing');
    btn.disabled = true;
    
    const response = await fetch(`/api/ai-providers/providers/${providerId}/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
      }
    });
    
    const data = await response.json();
    
    btn.innerHTML = originalText;
    btn.disabled = false;
    
    if (data.success) {
      alert(_tcfg('adminSystem.testSuccess') + '\n\n' + data.message);
    } else {
      alert(_tcfg('adminSystem.testFailed') + '\n\n' + data.message);
    }
  } catch (error) {
    console.error('测试连接失败:', error);
    alert(_tcfgp('adminSystem.testFailedMsg', { message: error.message }));
    event.target.innerHTML = originalText;
    event.target.disabled = false;
  }
}

// 设置默认提供商
async function setDefaultProvider(providerId) {
  if (!confirm(_tcfg('adminSystem.setDefaultConfirm'))) {
    return;
  }
  
  try {
    const response = await fetch(`/api/ai-providers/providers/${providerId}/set-default`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
      }
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert(_tcfg('adminSystem.setDefaultSuccess'));
      await loadAIProviders();
    } else {
      alert(_tcfgp('adminSystem.setDefaultFailed', { message: data.error }));
    }
  } catch (error) {
    console.error('设置默认提供商失败:', error);
    alert(_tcfgp('adminSystem.setDefaultFailed', { message: error.message }));
  }
}

// 显示添加自定义提供商对话框
function showAddProviderDialog() {
  alert(_tcfg('adminSystem.addProviderSoon'));
}

// 导出函数供admin.html使用
window.loadAIProviders = loadAIProviders;
window.toggleProvider = toggleProvider;
window.showProviderConfig = showProviderConfig;
window.saveProviderConfig = saveProviderConfig;
window.testProviderConnection = testProviderConnection;
window.setDefaultProvider = setDefaultProvider;
window.showAddProviderDialog = showAddProviderDialog;
