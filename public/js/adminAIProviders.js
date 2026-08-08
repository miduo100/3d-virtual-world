/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// AI提供商管理功能

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
          <div>加载AI提供商失败</div>
        </div>
      `;
    }
  } catch (error) {
    console.error('加载AI提供商失败:', error);
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #ff0000;">
        <div style="font-size: 48px; margin-bottom: 15px;">❌</div>
        <div>加载失败: ${error.message}</div>
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
        <div>暂无AI提供商配置</div>
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
    'chat': '💬 对话AI',
    'image_to_3d': '🏗️ 图片转3D',
    'text_to_3d': '✍️ 文字生成3D',
    'tts': '🗣️ 文字转语音',
    'stt': '👂 语音转文字'
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
  const statusText = provider.is_enabled ? '✅ 已启用' : '⭕ 未启用';
  const isDefault = provider.is_default ? '<span style="background: #ffc107; color: #000; padding: 2px 8px; border-radius: 3px; font-size: 11px; margin-left: 8px;">默认</span>' : '';
  
  // 多功能标签
  const types = provider.provider_type.split(',').map(t => t.trim());
  const typeLabels = {
    'chat': '对话',
    'image_to_3d': '图生3D',
    'text_to_3d': '文生3D',
    'tts': 'TTS',
    'stt': 'STT'
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
    ? '<span style="color: #00ff00;">● 已配置</span>' 
    : `<span style="color: #ffa500;">● 未完成 (${configuredCount}/${totalCount})</span>`;
  
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
        ">⚙️ 配置</button>
        
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
          ">🧪 测试连接</button>
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
          ">⭐ 设为默认</button>
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
      alert('❌ 操作失败: ' + data.error);
      await loadAIProviders(); // 重新加载恢复状态
    }
  } catch (error) {
    console.error('切换提供商状态失败:', error);
    alert('❌ 操作失败: ' + error.message);
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
      alert('❌ 获取配置失败');
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
          <h2>⚙️ 配置 ${provider.display_name}</h2>
          <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
        </div>
        
        <div style="margin-bottom: 20px; padding: 15px; background: rgba(102, 126, 234, 0.1); border-left: 4px solid #667eea; border-radius: 5px;">
          <div style="color: #667eea; font-weight: bold; margin-bottom: 5px;">📝 配置说明</div>
          <div style="color: #ccc; font-size: 13px;">
            ${provider.description || '请填写以下配置信息'}
          </div>
        </div>
        
        <form id="provider-config-form" onsubmit="saveProviderConfig(event, ${providerId})">
          ${schema.map(field => renderConfigField(field, provider)).join('')}
          
          <div class="action-btns" style="margin-top: 25px;">
            <button type="submit" class="btn" style="background: linear-gradient(135deg, #00ff00 0%, #00cc00 100%);">
              💾 保存配置
            </button>
            <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">
              取消
            </button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(modal);
  } catch (error) {
    console.error('加载配置失败:', error);
    alert('❌ 加载配置失败: ' + error.message);
  }
}

// 渲染配置字段
function renderConfigField(field, provider) {
  // 获取当前值
  const currentConfig = (provider.configs || []).find(c => c.key === field.key);
  const currentValue = currentConfig ? currentConfig.value : (field.default || '');
  
  const required = field.required ? 'required' : '';
  const placeholder = field.placeholder || '';
  
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
            placeholder="输入或选择${field.label}..."
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
            💡 可以直接输入或从下拉列表中选择${(field.options || []).length > 0 ? `（共${(field.options || []).length}个选项）` : ''}
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
          <label for="show-${field.key}" style="color: #888; font-size: 12px; cursor: pointer; margin: 0;">显示密钥</label>
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
      alert('✅ 配置保存成功！');
      // 关闭对话框
      form.closest('.modal').remove();
      // 刷新列表
      await loadAIProviders();
    } else {
      alert('❌ 保存失败: ' + data.message);
    }
  } catch (error) {
    console.error('保存配置失败:', error);
    alert('❌ 保存失败: ' + error.message);
  }
}

// 测试提供商连接
async function testProviderConnection(providerId) {
  try {
    const btn = event.target;
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ 测试中...';
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
      alert('✅ 连接测试成功！\n\n' + data.message);
    } else {
      alert('❌ 连接测试失败\n\n' + data.message);
    }
  } catch (error) {
    console.error('测试连接失败:', error);
    alert('❌ 测试失败: ' + error.message);
    event.target.innerHTML = originalText;
    event.target.disabled = false;
  }
}

// 设置默认提供商
async function setDefaultProvider(providerId) {
  if (!confirm('确定要将此提供商设为默认吗？')) {
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
      alert('✅ 已设置为默认提供商！');
      await loadAIProviders();
    } else {
      alert('❌ 设置失败: ' + data.error);
    }
  } catch (error) {
    console.error('设置默认提供商失败:', error);
    alert('❌ 设置失败: ' + error.message);
  }
}

// 显示添加自定义提供商对话框
function showAddProviderDialog() {
  alert('自定义提供商功能即将推出！\n\n目前支持：\n✅ 腾讯混元\n✅ 阿里通义千问\n✅ 字节豆包\n✅ 腾讯混元3D');
}

// 导出函数供admin.html使用
window.loadAIProviders = loadAIProviders;
window.toggleProvider = toggleProvider;
window.showProviderConfig = showProviderConfig;
window.saveProviderConfig = saveProviderConfig;
window.testProviderConnection = testProviderConnection;
window.setDefaultProvider = setDefaultProvider;
window.showAddProviderDialog = showAddProviderDialog;
