/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * UI控件管理模块
 * 用于管理后台的UI控件配置页面
 */

// ===== UI控件编辑器 i18n 辅助函数 =====
function ucT(key, fallback) {
  if (window.i18n && window.i18n.initialized) {
    const full = 'adminUIControls.' + key;
    const text = window.i18n.t(full);
    return text !== full ? text : (typeof fallback === 'string' ? fallback : key);
  }
  return typeof fallback === 'string' ? fallback : key;
}
function ucTp(key, params, fallback) {
  if (window.i18n && window.i18n.initialized) {
    const full = 'adminUIControls.' + key;
    const text = window.i18n.tp(full, params);
    return text !== full ? text : (typeof fallback === 'string' ? fallback : key);
  }
  let text = typeof fallback === 'string' ? fallback : key;
  if (params) {
    Object.keys(params).forEach(function(p) { text = String(text).split('{{' + p + '}}').join(params[p]); });
  }
  return text;
}
// 控件名称翻译（方案A）：英文语言下按 control_id 查 i18n 映射表，查不到回退数据库原名
function ucControlName(control) {
  if (!control || !control.control_name) return '';
  if (window.i18n && window.i18n.initialized && window.i18n.getCurrentLocale() === 'en-US') {
    const full = 'adminUIControls.controlNames.' + control.control_id;
    const text = window.i18n.t(full);
    return text !== full ? text : control.control_name;
  }
  return control.control_name;
}
function applyUITranslations() {
  if (!window.i18n || !window.i18n.initialized) return;
  // 静态 [data-i18n] 元素（key 为完整路径，如 adminUIControls.ucTitle）
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const text = window.i18n.t(key);
    if (el.tagName === 'TITLE') {
      document.title = text;
    } else if (text !== key) {
      el.textContent = text;
    }
  });
  // 同步语言下拉框
  const sel = document.getElementById('uiLangSelect');
  if (sel) sel.value = window.i18n.getCurrentLocale();
}

const AdminUIControls = {
  controls: [],
  currentControl: null,
  previewMode: 'desktop', // 'desktop' | 'mobile' | 'vr'
  mobileOrientation: 'portrait', // 'portrait' | 'landscape'（手机模式下的子方向）
  isDragging: false,
  isResizing: false,
  dragTarget: null,
  resizeTarget: null,
  dragStartX: 0,
  dragStartY: 0,
  dragStartLeft: 0,
  dragStartTop: 0,
  dragStartWidth: 0,
  dragStartHeight: 0,
  hasUnsavedChanges: false,
  originalControls: null, // 用于存储原始数据以检测更改

  // 控件类型选项
  controlTypes: [
    { value: 'button', get label() { return ucT('ucTypeButton', '按钮'); }, icon: '🔘', color: 'rgba(0, 255, 0, 0.3)', borderColor: '#00ff00' },
    { value: 'panel', get label() { return ucT('ucTypePanel', '面板'); }, icon: '📋', color: 'rgba(0, 100, 255, 0.3)', borderColor: '#0066ff' },
    { value: 'joystick', get label() { return ucT('ucTypeJoystick', '摇杆'); }, icon: '🕹️', color: 'rgba(255, 255, 0, 0.3)', borderColor: '#ffff00' },
    { value: 'minimap', get label() { return ucT('ucTypeMinimap', '小地图'); }, icon: '🗺️', color: 'rgba(255, 0, 255, 0.3)', borderColor: '#ff00ff' },
    { value: 'healthbar', get label() { return ucT('ucTypeHealthbar', '血条'); }, icon: '❤️', color: 'rgba(255, 0, 0, 0.3)', borderColor: '#ff0000' },
    { value: 'chat', get label() { return ucT('ucTypeChat', '聊天框'); }, icon: '💬', color: 'rgba(0, 255, 255, 0.3)', borderColor: '#00ffff' },
    { value: 'other', get label() { return ucT('ucTypeOther', '其他'); }, icon: '📦', color: 'rgba(128, 128, 128, 0.3)', borderColor: '#808080' }
  ],

  // 控件ID到描述的映射
  controlDescriptions: {
    'btn_profile': ucT('ucDescBtnProfile', '个人资料按钮'),
    'btn_inventory': ucT('ucDescBtnInventory', '物品管理按钮'),
    'skill_voice_btn': ucT('ucDescSkillVoiceBtn', '语音按钮'),
    'skill_hud': ucT('ucDescSkillHud', '技能栏面板'),
    'mobile_joystick': ucT('ucDescMobileJoystick', '移动摇杆'),
    'mobile_jump_btn': ucT('ucDescMobileJumpBtn', '跳跃按钮'),
    'mobile_sprint_btn': ucT('ucDescMobileSprintBtn', '冲刺按钮'),
    'mobile_camera_toggle_btn': ucT('ucDescMobileCameraToggleBtn', '视角切换按钮'),
    'mobile_turn_left_btn': ucT('ucDescMobileTurnLeftBtn', '左转按钮（按住向左转向）'),
    'mobile_turn_right_btn': ucT('ucDescMobileTurnRightBtn', '右转按钮（按住向右转向）'),
    'health_bar': ucT('ucDescHealthBar', '血条'),
    'minimap': ucT('ucDescMinimap', '小地图'),
    'portal_btn': ucT('ucDescPortalBtn', '世界传送门按钮'),
    'performance_monitor': ucT('ucDescPerformanceMonitor', '性能监控面板'),
    'debug_panel': ucT('ucDescDebugPanel', '坐标调试面板')
  },

  // 分类选项
  categories: [
    { value: 'mobile', get label() { return ucT('ucCatMobile', '移动端专用'); } },
    { value: 'desktop', get label() { return ucT('ucCatDesktop', '桌面端专用'); } },
    { value: 'general', get label() { return ucT('ucCatGeneral', '通用'); } },
    { value: 'vr', get label() { return ucT('ucCatVR', 'VR端专用'); } }
  ],

  /**
   * 获取当前平台应该显示的控件
   * 桌面端: desktop + general
   * 移动端: mobile + general
   * VR端: vr + general
   */
  getFilteredControls() {
    return this.controls.filter(control => {
      if (this.previewMode === 'mobile') {
        // 移动端：显示mobile和general
        return control.category === 'mobile' || control.category === 'general';
      } else if (this.previewMode === 'desktop') {
        // 桌面端：显示desktop和general
        return control.category === 'desktop' || control.category === 'general';
      } else if (this.previewMode === 'vr') {
        // VR端：显示vr和general
        return control.category === 'vr' || control.category === 'general';
      }
      return true;
    });
  },

  /**
   * 初始化
   */
  init() {
    this.loadControls();
    this.setupEventListeners();
    this.setupGlobalEventListeners();
    this.setupBeforeUnloadListener();
  },

  /**
   * 设置页面离开前监听
   */
  setupBeforeUnloadListener() {
    window.addEventListener('beforeunload', (e) => {
      if (this.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ucT('ucUnsavedLeave', '有未保存的更改，确定要离开吗？');
        return e.returnValue;
      }
    });
  },

  /**
   * 设置事件监听（兼容admin.html和独立页面）
   */
  setupEventListeners() {
    // 平台切换按钮组（新版三选一）
    const platformBtnGroup = document.getElementById('platformBtnGroup');
    if (platformBtnGroup) {
      platformBtnGroup.querySelectorAll('.platform-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const newMode = btn.dataset.mode;
          if (newMode === this.previewMode) return;

          // 更新按钮状态
          platformBtnGroup.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          this.switchPlatform(newMode);
        });
      });
    }

    // 兼容旧版 checkbox（如果存在）
    const platformToggle = document.getElementById('platformToggle') || document.getElementById('ui-platform-toggle');
    platformToggle?.addEventListener('change', (e) => {
      const newMode = e.target.checked ? 'mobile' : 'desktop';
      this.switchPlatform(newMode);
    });

    // 添加控件按钮（兼容旧版和新版ID）
    const addBtn = document.getElementById('addControlBtn') || document.getElementById('ui-add-control-btn');
    addBtn?.addEventListener('click', () => {
      this.showAddModal();
    });

    // 批量保存按钮（兼容旧版和新版ID）
    const batchSaveBtn = document.getElementById('batchSaveBtn') || document.getElementById('ui-batch-save-btn');
    batchSaveBtn?.addEventListener('click', () => {
      this.batchSave();
    });

    // 刷新按钮（独立页面专用）
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
      this.loadControls();
    });

    // 手机模式下横竖屏切换（位于顶部工具栏，独立于预览框）
    const orientationBtnGroup = document.getElementById('orientationBtnGroup');
    if (orientationBtnGroup) {
      orientationBtnGroup.querySelectorAll('.platform-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const orientation = btn.dataset.orientation;
          if (orientation === this.mobileOrientation) return;
          orientationBtnGroup.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.mobileOrientation = orientation;
          this.renderPreview();
          this.renderEditor();
        });
      });
    }
  },

  /**
   * 切换平台模式
   */
  switchPlatform(newMode) {
    // 检查当前选中的控件在新平台是否可见
    if (this.currentControl) {
      const isVisibleInNewMode =
        (newMode === 'mobile' && (this.currentControl.category === 'mobile' || this.currentControl.category === 'general')) ||
        (newMode === 'desktop' && (this.currentControl.category === 'desktop' || this.currentControl.category === 'general')) ||
        (newMode === 'vr' && (this.currentControl.category === 'vr' || this.currentControl.category === 'general'));

      if (!isVisibleInNewMode) {
        this.currentControl = null;
      }
    }

    this.previewMode = newMode;

    // 仅手机模式显示横竖屏切换按钮组，并同步高亮状态
    const orientationBtnGroup = document.getElementById('orientationBtnGroup');
    if (orientationBtnGroup) {
      orientationBtnGroup.style.display = (newMode === 'mobile') ? 'flex' : 'none';
      if (newMode === 'mobile') {
        orientationBtnGroup.querySelectorAll('.platform-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.orientation === this.mobileOrientation);
        });
      }
    }

    this.renderControlsList();
    this.renderEditor();
    this.renderPreview();
  },

  /**
   * 设置全局事件监听（拖拽、调整大小）
   */
  setupGlobalEventListeners() {
    // 鼠标移动
    document.addEventListener('mousemove', (e) => {
      if (this.isDragging && this.dragTarget) {
        this.handleDragMove(e);
      } else if (this.isResizing && this.resizeTarget) {
        this.handleResizeMove(e);
      }
    });

    // 鼠标释放
    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.handleDragEnd();
      } else if (this.isResizing) {
        this.handleResizeEnd();
      }
    });
  },

  /**
   * 显示加载状态
   */
  showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';
  },

  /**
   * 隐藏加载状态
   */
  hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
  },

  /**
   * 加载控件列表
   */
  async loadControls() {
    this.showLoading();
    try {
      const response = await fetch('/api/ui-controls/admin/list', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        }
      });

      const data = await response.json();

      if (data.success) {
        this.controls = data.controls;
        // 保存原始数据的深拷贝，用于检测更改
        this.originalControls = JSON.stringify(this.controls);
        this.hasUnsavedChanges = false;
        this.hideUnsavedIndicator();
        this.renderControlsList();
        this.renderPreview();
      } else {
        this.showError('加载控件列表失败: ' + data.error);
      }
    } catch (error) {
      console.error('加载控件列表失败:', error);
      this.showError('加载控件列表失败，请检查网络连接或登录状态');
    } finally {
      this.hideLoading();
    }
  },

  /**
   * 标记有未保存的更改
   */
  markUnsaved() {
    this.hasUnsavedChanges = true;
    this.showUnsavedIndicator();
  },

  /**
   * 显示未保存更改指示器
   */
  showUnsavedIndicator() {
    if (document.querySelector('.ui-unsaved-indicator')) return;

    const indicator = document.createElement('div');
    indicator.className = 'ui-unsaved-indicator';
    indicator.innerHTML = `
      <span>有未保存的更改</span>
      <button class="btn btn-sm" onclick="AdminUIControls.batchSave()" style="background: #000; color: #ffc107;">立即保存</button>
    `;
    document.body.appendChild(indicator);
  },

  /**
   * 隐藏未保存更改指示器
   */
  hideUnsavedIndicator() {
    const indicator = document.querySelector('.ui-unsaved-indicator');
    if (indicator) indicator.remove();
  },

  /**
   * 渲染控件列表 - 根据当前平台筛选
   */
  renderControlsList() {
    // 兼容旧版和新版ID
    const container = document.getElementById('controlsList') || document.getElementById('ui-controls-list');
    if (!container) return;

    // 获取筛选后的控件
    const filteredControls = this.getFilteredControls();

    // 按分类分组
    const grouped = filteredControls.reduce((acc, control) => {
      if (!acc[control.category]) acc[control.category] = [];
      acc[control.category].push(control);
      return acc;
    }, {});

    let html = '';

    // 根据当前平台决定分类显示顺序和标签
    let categoryOrder, categoryLabels;

    if (this.previewMode === 'mobile') {
      categoryOrder = ['mobile', 'general'];
      categoryLabels = {
        mobile: '📱 移动端控件（仅手机显示）',
        general: '🌐 通用控件（所有平台）'
      };
    } else if (this.previewMode === 'desktop') {
      categoryOrder = ['desktop', 'general'];
      categoryLabels = {
        desktop: '💻 桌面端控件（仅电脑显示）',
        general: '🌐 通用控件（所有平台）'
      };
    } else if (this.previewMode === 'vr') {
      categoryOrder = ['vr', 'general'];
      categoryLabels = {
        vr: '🥽 VR端控件（仅VR显示）',
        general: '🌐 通用控件（所有平台）'
      };
    } else {
      categoryOrder = ['mobile', 'desktop', 'general', 'vr'];
      categoryLabels = {
        mobile: '📱 移动端控件',
        desktop: '💻 桌面端控件',
        general: '🌐 通用控件',
        vr: '🥽 VR端控件'
      };
    }

    categoryOrder.forEach(category => {
      if (grouped[category] && grouped[category].length > 0) {
        html += `
          <div class="ui-category-group">
            <div class="ui-category-header">${categoryLabels[category]}</div>
            <div class="ui-controls-grid">
              ${grouped[category].map(control => this.renderControlCard(control)).join('')}
            </div>
          </div>
        `;
      }
    });

    // 如果没有控件，显示提示
    if (html === '') {
      html = '<div class="ui-editor-placeholder">当前平台暂无控件</div>';
    }

    container.innerHTML = html;

    // 绑定卡片点击事件
    container.querySelectorAll('.ui-control-card').forEach(card => {
      card.addEventListener('click', () => {
        const controlId = card.dataset.controlId;
        this.selectControl(controlId);
      });
    });
  },

  /**
   * 渲染单个控件卡片
   */
  renderControlCard(control) {
    const typeInfo = this.controlTypes.find(t => t.value === control.control_type) || { icon: '📦', label: ucT('ucTypeOther', '其他') };
    const isSelected = this.currentControl?.control_id === control.control_id;

    // 为常用控件分配更易识别的图标
    const iconMap = {
      'mobile_joystick': '🕹️',
      'mobile_jump_btn': '⤴️',
      'mobile_sprint_btn': '⚡',
      'mobile_camera_toggle_btn': '👁️',
      'mobile_turn_left_btn': '↩️',
      'mobile_turn_right_btn': '↪️'
    };
    const icon = iconMap[control.control_id] || typeInfo.icon;

    return `
      <div class="ui-control-card ${isSelected ? 'selected' : ''} ${!control.is_visible ? 'hidden' : ''}" 
           data-control-id="${control.control_id}">
        <div class="ui-control-icon">${icon}</div>
        <div class="ui-control-info">
          <div class="ui-control-name">${ucControlName(control)}</div>
          <div class="ui-control-type">${typeInfo.label}</div>
        </div>
        <div class="ui-control-status">
          ${control.is_visible ? '👁️' : '🚫'}
        </div>
      </div>
    `;
  },

  /**
   * 获取当前编辑模式下的字段前缀
   * 返回: '' (桌面) | 'mobile_' (竖屏) | 'landscape_' (横屏)
   */
  getFieldPrefix() {
    if (this.previewMode === 'mobile') {
      return this.mobileOrientation === 'landscape' ? 'landscape_' : 'mobile_';
    }
    return '';
  },

  /**
   * 获取当前编辑模式下的位置/尺寸值
   */
  getFieldValue(control, field) {
    const prefix = this.getFieldPrefix();
    if (prefix) {
      return control[prefix + field] || control[field];
    }
    return control[field];
  },

  /**
   * 设置当前编辑模式下的位置/尺寸值
   */
  setFieldValue(control, field, value) {
    const prefix = this.getFieldPrefix();
    if (prefix) {
      control[prefix + field] = value;
    } else {
      control[field] = value;
    }
  },

  /**
   * 选择控件
   */
  selectControl(controlId) {
    const previousControl = this.currentControl;
    this.currentControl = this.controls.find(c => c.control_id === controlId);

    // 移动端模式下：如果控件没有设置移动端独立参数，自动从桌面端值初始化
    if (this.currentControl && this.previewMode === 'mobile') {
      const prefix = this.getFieldPrefix();
      if (!this.currentControl[prefix + 'position_x'] && this.currentControl.position_x) {
        this.currentControl[prefix + 'position_x'] = this.currentControl.position_x;
      }
      if (!this.currentControl[prefix + 'position_y'] && this.currentControl.position_y) {
        this.currentControl[prefix + 'position_y'] = this.currentControl.position_y;
      }
      if (!this.currentControl[prefix + 'width'] && this.currentControl.width) {
        this.currentControl[prefix + 'width'] = this.currentControl.width;
      }
      if (!this.currentControl[prefix + 'height'] && this.currentControl.height) {
        this.currentControl[prefix + 'height'] = this.currentControl.height;
      }
    }

    // 更新左侧列表选中状态
    this.renderControlsList();

    // 更新右侧编辑器
    this.renderEditor();

    // 更新预览区域的选中状态（不重新创建元素）
    const screen = document.getElementById('ui-preview-screen');
    if (screen) {
      // 移除所有控件的选中状态
      screen.querySelectorAll('.ui-preview-control').forEach(el => {
        el.classList.remove('selected');
        // 移除调整大小手柄
        const handle = el.querySelector('.resize-handle');
        if (handle) handle.remove();
      });

      // 给当前选中的控件添加选中状态
      if (this.currentControl) {
        const selectedEl = screen.querySelector(`[data-control-id="${this.currentControl.control_id}"]`);
        if (selectedEl) {
          selectedEl.classList.add('selected');
          this.addResizeHandles(selectedEl);
        }
      }
    }
  },

  /**
   * 渲染编辑器
   */
  renderEditor() {
    // 兼容旧版和新版ID
    const container = document.getElementById('editorPanel') || document.getElementById('ui-editor-panel');
    if (!container || !this.currentControl) {
      if (container) container.innerHTML = '<div class="ui-editor-placeholder">' + ucT('ucSelectPlaceholder', '请选择一个控件进行编辑') + '</div>';
      return;
    }

    const control = this.currentControl;
    const isMobile = this.previewMode === 'mobile';
    const platformLabel = this.previewMode === 'vr' ? ucT('ucPlatformVR', '🥽 VR端')
      : isMobile ? (this.mobileOrientation === 'landscape' ? ucT('ucPlatformLandscape', '📱 移动端横屏') : ucT('ucPlatformPortrait', '📱 移动端竖屏'))
      : ucT('ucPlatformDesktop', '💻 桌面端');

    container.innerHTML = `
      <div class="ui-editor-header">
        <h3>${ucTp('ucEditTitle', { name: ucControlName(control) }, '编辑: ' + ucControlName(control))}</h3>
        <span class="ui-control-id">ID: ${control.control_id}</span>
      </div>

      <div class="ui-editor-section">
        <h4>${ucT('ucEditBasic', '基本设置')}</h4>
        <div class="ui-form-row">
          <label>${ucT('ucEditName', '控件名称')}</label>
          <input type="text" id="ui-edit-name" value="${control.control_name}">
        </div>
        <div class="ui-form-row">
          <label>${ucT('ucEditType', '控件类型')}</label>
          <select id="ui-edit-type">
            ${this.controlTypes.map(t => `
              <option value="${t.value}" ${control.control_type === t.value ? 'selected' : ''}>${t.icon} ${t.label}</option>
            `).join('')}
          </select>
        </div>
        <div class="ui-form-row">
          <label>${ucT('ucEditCategory', '分类')}</label>
          <select id="ui-edit-category">
            ${this.categories.map(c => `
              <option value="${c.value}" ${control.category === c.value ? 'selected' : ''}>${c.label}</option>
            `).join('')}
          </select>
        </div>
        <div class="ui-form-row">
          <label>${ucT('ucEditModule', '关联模块')}</label>
          <input type="text" id="ui-edit-module" value="${control.related_module || ''}" placeholder="${ucT('ucEditModulePlaceholder', '例如: mobileControls.js')}">
        </div>
        <div class="ui-form-row">
          <label>${ucT('ucEditDesc', '描述')}</label>
          <textarea id="ui-edit-description" rows="2">${control.description || ''}</textarea>
        </div>
      </div>

      <div class="ui-editor-section">
        <h4>${ucTp('ucEditPosSize', { platform: platformLabel }, platformLabel + ' 位置和大小')}</h4>
        <div class="ui-form-row">
          <label id="ui-edit-pos-x-label">${ucT('ucEditPosXLeft', '距左边缘 (left)')}</label>
          <input type="text" id="ui-edit-pos-x" value="${this.getFieldValue(control, 'position_x')}" placeholder="${ucT('ucEditPosPlaceholder', '例如: 20px 或 auto')}">
        </div>
        <div class="ui-form-row">
          <label id="ui-edit-pos-y-label">${ucT('ucEditPosYTop', '距顶边缘 (top)')}</label>
          <input type="text" id="ui-edit-pos-y" value="${this.getFieldValue(control, 'position_y')}" placeholder="${ucT('ucEditPosPlaceholder', '例如: 20px 或 auto')}">
        </div>
        <div class="ui-form-row">
          <label>${ucT('ucEditHAlign', '水平对齐')}</label>
          <select id="ui-edit-h-align" onchange="window.uiAdminEditor.updatePositionLabels()">
            <option value="left" ${(control.h_align || 'left') === 'left' ? 'selected' : ''}>${ucT('ucEditHLeft', '左对齐 (left)')}</option>
            <option value="right" ${(control.h_align || 'left') === 'right' ? 'selected' : ''}>${ucT('ucEditHRight', '右对齐 (right)')}</option>
          </select>
        </div>
        <div class="ui-form-row">
          <label>${ucT('ucEditVAlign', '垂直对齐')}</label>
          <select id="ui-edit-v-align" onchange="window.uiAdminEditor.updatePositionLabels()">
            <option value="top" ${(control.v_align || 'top') === 'top' ? 'selected' : ''}>${ucT('ucEditVTop', '顶部对齐 (top)')}</option>
            <option value="bottom" ${(control.v_align || 'top') === 'bottom' ? 'selected' : ''}>${ucT('ucEditVBottom', '底部对齐 (bottom)')}</option>
          </select>
        </div>
        <div class="ui-form-row">
          <label>${ucT('ucEditWidth', '宽度')}</label>
          <input type="text" id="ui-edit-width" value="${this.getFieldValue(control, 'width')}" placeholder="${ucT('ucEditWidthPlaceholder', '例如: 100px 或 auto')}">
        </div>
        <div class="ui-form-row">
          <label>${ucT('ucEditHeight', '高度')}</label>
          <input type="text" id="ui-edit-height" value="${this.getFieldValue(control, 'height')}" placeholder="${ucT('ucEditHeightPlaceholder', '例如: 50px 或 auto')}">
        </div>
        <div class="ui-form-row">
          <label>${ucT('ucEditPositionType', '定位方式')}</label>
          <select id="ui-edit-position-type">
            <option value="fixed" ${control.position_type === 'fixed' ? 'selected' : ''}>${ucT('ucEditPosFixed', 'Fixed (固定)')}</option>
            <option value="absolute" ${control.position_type === 'absolute' ? 'selected' : ''}>${ucT('ucEditPosAbsolute', 'Absolute (绝对)')}</option>
          </select>
        </div>
        <div class="ui-form-row">
          <label>${ucT('ucEditZIndex', '层级 (z-index)')}</label>
          <input type="number" id="ui-edit-z-index" value="${control.z_index}" min="0" max="9999">
        </div>
      </div>

      <div class="ui-editor-section">
        <h4>${ucT('ucEditDisplay', '显示设置')}</h4>
        <div class="ui-form-row ui-checkbox-row">
          <label>
            <input type="checkbox" id="ui-edit-visible" ${control.is_visible ? 'checked' : ''}>
            ${ucT('ucEditVisible', '可见')}
          </label>
        </div>
        <div class="ui-form-row ui-checkbox-row">
          <label>
            <input type="checkbox" id="ui-edit-enabled" ${control.is_enabled ? 'checked' : ''}>
            ${ucT('ucEditEnabled', '启用')}
          </label>
        </div>
      </div>

      <div class="ui-editor-actions">
        <button class="btn" id="ui-save-btn">${ucT('ucEditSave', '💾 保存更改')}</button>
        <button class="btn btn-secondary" id="ui-reset-btn">${ucT('ucEditReset', '🔄 重置为默认')}</button>
        <button class="btn btn-danger" id="ui-delete-btn" onclick="AdminUIControls.deleteControl()">${ucT('ucEditDelete', '🗑️ 删除控件')}</button>
      </div>
    `;

    // 重新绑定事件
    this.bindEditorEvents();
    // 根据当前对齐方式初始化位置标签
    this.updatePositionLabels();
  },

  /**
   * 绑定编辑器事件
   */
  bindEditorEvents() {
    // 输入框变化时实时更新预览
    // 兼容旧版和新版编辑器容器ID
    const editorContainer = document.getElementById('editorPanel') || document.getElementById('ui-editor-panel');
    if (!editorContainer) return;

    const inputs = editorContainer.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      input.addEventListener('change', () => this.updatePreviewFromEditor());
      input.addEventListener('input', () => this.updatePreviewFromEditor());
    });

    const saveBtn = document.getElementById('ui-save-btn');
    const resetBtn = document.getElementById('ui-reset-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => this.saveCurrentControl());
    if (resetBtn) resetBtn.addEventListener('click', () => this.resetCurrentControl());
  },

  /**
   * 从编辑器更新预览
   */
  /**
   * 验证CSS位置/大小值是否合法
   * 合法格式: "auto" | "数字px" | "数字%" | "数字em" | "数字rem" | "数字vh" | "数字vw"
   */
  isValidCSSValue(value) {
    if (!value || typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed === 'auto') return true;
    if (trimmed === '0') return true;
    // 匹配: 数字 + 可选小数 + 单位(px, %, em, rem, vh, vw)
    return /^-?\d+(\.\d+)?(px|%|em|rem|vh|vw)$/.test(trimmed);
  },

  updatePreviewFromEditor() {
    if (!this.currentControl) return;

    // 位置和大小值（原始值）
    const rawPosX = document.getElementById('ui-edit-pos-x')?.value || '';
    const rawPosY = document.getElementById('ui-edit-pos-y')?.value || '';
    const rawWidth = document.getElementById('ui-edit-width')?.value || '';
    const rawHeight = document.getElementById('ui-edit-height')?.value || '';

    const updates = {
      control_name: document.getElementById('ui-edit-name')?.value,
      control_type: document.getElementById('ui-edit-type')?.value,
      category: document.getElementById('ui-edit-category')?.value,
      related_module: document.getElementById('ui-edit-module')?.value,
      description: document.getElementById('ui-edit-description')?.value,
      position_type: document.getElementById('ui-edit-position-type')?.value,
      h_align: document.getElementById('ui-edit-h-align')?.value || 'left',
      v_align: document.getElementById('ui-edit-v-align')?.value || 'top',
      z_index: parseInt(document.getElementById('ui-edit-z-index')?.value) || 1000,
      is_visible: document.getElementById('ui-edit-visible')?.checked,
      is_enabled: document.getElementById('ui-edit-enabled')?.checked
    };

    // 位置配置（带验证），使用字段前缀支持竖屏/横屏
    const prefix = this.getFieldPrefix();
    if (prefix) {
      updates[prefix + 'position_x'] = this.isValidCSSValue(rawPosX) ? rawPosX : this.currentControl[prefix + 'position_x'];
      updates[prefix + 'position_y'] = this.isValidCSSValue(rawPosY) ? rawPosY : this.currentControl[prefix + 'position_y'];
      updates[prefix + 'width'] = this.isValidCSSValue(rawWidth) ? rawWidth : this.currentControl[prefix + 'width'];
      updates[prefix + 'height'] = this.isValidCSSValue(rawHeight) ? rawHeight : this.currentControl[prefix + 'height'];
    } else {
      updates.position_x = this.isValidCSSValue(rawPosX) ? rawPosX : this.currentControl.position_x;
      updates.position_y = this.isValidCSSValue(rawPosY) ? rawPosY : this.currentControl.position_y;
      updates.width = this.isValidCSSValue(rawWidth) ? rawWidth : this.currentControl.width;
      updates.height = this.isValidCSSValue(rawHeight) ? rawHeight : this.currentControl.height;
    }

    // 更新当前控件
    Object.assign(this.currentControl, updates);

    // 标记有未保存的更改
    this.markUnsaved();

    // 更新预览
    this.updatePreview();
  },

  /**
   * 转换位置值：当对齐方式变化时，重新计算保持相同视觉位置
   * 例如：right对齐的 20% → left对齐的 80%
   */
  convertPositionValue(value, fromAlign, toAlign) {
    if (!value || value === 'auto' || fromAlign === toAlign) return value;
    const percentMatch = String(value).match(/^(-?\d+(?:\.\d+)?)%$/);
    if (percentMatch) {
      const pct = parseFloat(percentMatch[1]);
      return (100 - pct) + '%';
    }
    // px/em/rem 等无法在不获取父容器尺寸时精确转换，重置为 'auto'
    return 'auto';
  },

  /**
   * 根据对齐方式动态更新位置标签，并同步更新位置值
   */
  updatePositionLabels() {
    const hAlignSelect = document.getElementById('ui-edit-h-align');
    const vAlignSelect = document.getElementById('ui-edit-v-align');
    const hAlign = hAlignSelect?.value || 'left';
    const vAlign = vAlignSelect?.value || 'top';
    const xLabel = document.getElementById('ui-edit-pos-x-label');
    const yLabel = document.getElementById('ui-edit-pos-y-label');

    if (xLabel) {
      xLabel.textContent = hAlign === 'right' ? ucT('ucEditPosXRight', '距右边缘 (right)') : ucT('ucEditPosXLeft', '距左边缘 (left)');
    }
    if (yLabel) {
      yLabel.textContent = vAlign === 'bottom' ? ucT('ucEditPosYBottom', '距底边缘 (bottom)') : ucT('ucEditPosYTop', '距顶边缘 (top)');
    }

    // 【修复】当对齐方式改变时，重新计算位置值保持相同视觉位置
    if (this.currentControl) {
      const posXInput = document.getElementById('ui-edit-pos-x');
      const posYInput = document.getElementById('ui-edit-pos-y');

      if (posXInput) {
        const oldHAlign = this.currentControl.h_align || 'left';
        if (oldHAlign !== hAlign) {
          posXInput.value = this.convertPositionValue(posXInput.value, oldHAlign, hAlign);
        }
      }
      if (posYInput) {
        const oldVAlign = this.currentControl.v_align || 'top';
        if (oldVAlign !== vAlign) {
          posYInput.value = this.convertPositionValue(posYInput.value, oldVAlign, vAlign);
        }
      }
    }
  },

  /**
   * 渲染预览区域
   */
  renderPreview() {
    // 兼容旧版和新版ID
    const container = document.getElementById('previewContainer') || document.getElementById('ui-preview-container');
    if (!container) return;

    const isMobile = this.previewMode === 'mobile';
    const isVR = this.previewMode === 'vr';
    const isLandscape = this.mobileOrientation === 'landscape';

    let frameClass = 'desktop';
    let label = '💻 桌面端预览 (1920x1080)';
    if (isMobile) {
      if (isLandscape) {
        frameClass = 'mobile landscape';
        label = '📱 移动端横屏预览 (667x375)';
      } else {
        frameClass = 'mobile';
        label = '📱 移动端竖屏预览 (375x667)';
      }
    } else if (isVR) {
      frameClass = 'vr';
      label = '🥽 VR端预览 (VR控件叠加层)';
    }

    container.innerHTML = `
      <div class="ui-preview-frame ${frameClass}">
        <div class="ui-preview-screen" id="ui-preview-screen">
          <div class="ui-preview-label">${label}</div>
          <!-- 控件预览将在这里渲染 -->
        </div>
      </div>
    `;

    this.updatePreview();
  },

  /**
   * 更新预览 - 根据当前平台筛选
   */
  updatePreview() {
    const screen = document.getElementById('ui-preview-screen');
    if (!screen) return;

    // 如果正在拖拽或调整大小，不重新渲染
    if (this.isDragging || this.isResizing) return;

    // 清除旧的预览控件（保留标签）
    const existingControls = screen.querySelectorAll('.ui-preview-control');
    existingControls.forEach(el => el.remove());

    // 获取筛选后的可见控件
    const filteredControls = this.getFilteredControls().filter(c => c.is_visible);

    // 渲染筛选后的控件
    filteredControls.forEach(control => {
      const el = this.createPreviewElement(control);
      if (el) screen.appendChild(el);
    });
  },

  /**
   * 创建预览元素 - 优化版本，更接近实际UI
   */
  createPreviewElement(control) {
    const el = document.createElement('div');
    el.className = 'ui-preview-control';
    el.dataset.controlId = control.control_id;

    // 获取位置配置（使用字段前缀支持竖屏/横屏）
    let posX = this.getFieldValue(control, 'position_x');
    let posY = this.getFieldValue(control, 'position_y');
    let width = this.getFieldValue(control, 'width');
    let height = this.getFieldValue(control, 'height');

    // 为性能监控面板提供默认尺寸后备，防止数据库中尺寸异常
    if (control.control_id === 'performance_monitor') {
      const minW = isMobile ? '150px' : '200px';
      const minH = isMobile ? '100px' : '120px';
      const maxW = isMobile ? '300px' : '400px';
      const maxH = isMobile ? '200px' : '250px';
      const numW = parseFloat(width);
      const numH = parseFloat(height);
      // 尺寸为空、过小或过大时，使用合理默认值兜底
      if (!numW || numW < parseFloat(minW) || numW > parseFloat(maxW)) {
        console.warn('[AdminUIControls] performance_monitor 宽度异常:', width, '→ 使用默认值:', minW);
        width = minW;
      }
      if (!numH || numH < parseFloat(minH) || numH > parseFloat(maxH)) {
        console.warn('[AdminUIControls] performance_monitor 高度异常:', height, '→ 使用默认值:', minH);
        height = minH;
      }
    }

    // 获取控件类型样式
    const typeInfo = this.controlTypes.find(t => t.value === control.control_type) || this.controlTypes[6];

    // 根据控件类型渲染不同的预览样式
    const isSelected = this.currentControl?.control_id === control.control_id;

    // 基础样式
    let baseStyles = `
      position: absolute;
      z-index: ${control.z_index};
      cursor: move;
      user-select: none;
      box-sizing: border-box;
    `;

    // 坐标调试面板：使用共用预览渲染，保证与真实游戏结构一致（宽高自适应）
    if (control.control_id === 'debug_panel' && window.DebugPanelPreview) {
      if (!width) width = '240px';
      if (!height) height = '34px';
      el.innerHTML = window.DebugPanelPreview.getHTML(control, isSelected);
    } else
    // 根据控件类型应用特定的样式
    switch (control.control_type) {
      case 'joystick':
        el.innerHTML = this.getJoystickHTML(control, typeInfo, isSelected);
        break;
      case 'button':
        el.innerHTML = this.getButtonHTML(control, typeInfo, isSelected);
        break;
      case 'healthbar':
        el.innerHTML = this.getHealthBarHTML(control, typeInfo, isSelected);
        break;
      case 'minimap':
        el.innerHTML = this.getMinimapHTML(control, typeInfo, isSelected);
        break;
      case 'panel':
        el.innerHTML = this.getPanelHTML(control, typeInfo, isSelected);
        break;
      default:
        el.innerHTML = this.getDefaultHTML(control, typeInfo, isSelected);
    }

    // 获取对齐方式
    const hAlign = control.h_align || 'left';
    const vAlign = control.v_align || 'top';

    // 设置位置和大小
    const styles = this.calculatePositionStyles(posX, posY, width, height, hAlign, vAlign);
    el.style.cssText = baseStyles + styles;

    // 性能监控面板诊断：打印最终渲染样式
    if (control.control_id === 'performance_monitor') {
      console.log('[createPreview] performance_monitor 最终样式:', {
        previewMode: this.previewMode,
        rawWidth: isMobile ? control.mobile_width : control.width,
        rawHeight: isMobile ? control.mobile_height : control.height,
        appliedWidth: width,
        appliedHeight: height,
        posX, posY, hAlign, vAlign,
        cssText: el.style.cssText
      });
    }

    // 如果是选中状态，添加选中样式和调整大小手柄
    if (isSelected) {
      el.classList.add('selected');
      this.addResizeHandles(el);
    }

    // 添加悬停提示
    el.title = `${ucControlName(control)} (${control.control_id})\n点击选中，拖拽移动，拖拽右下角调整大小`;

    // 绑定事件
    el.addEventListener('mousedown', (e) => this.handleMouseDown(e, control, el));

    return el;
  },

  /**
   * 计算位置样式
   */
  calculatePositionStyles(posX, posY, width, height, hAlign, vAlign) {
    let styles = '';

    // 水平位置和对齐
    if (hAlign === 'right') {
      styles += `right: ${posX === 'auto' ? '24px' : posX}; left: auto;`;
    } else {
      styles += `left: ${posX === 'auto' ? '24px' : posX}; right: auto;`;
    }

    // 垂直位置和对齐
    if (vAlign === 'bottom') {
      styles += `bottom: ${posY === 'auto' ? '24px' : posY}; top: auto;`;
    } else {
      styles += `top: ${posY === 'auto' ? '24px' : posY}; bottom: auto;`;
    }

    // 大小
    if (width) styles += `width: ${width};`;
    if (height) styles += `height: ${height};`;

    return styles;
  },

  /**
   * 摇杆HTML
   */
  getJoystickHTML(control, typeInfo, isSelected) {
    return `
      <div class="preview-joystick ${isSelected ? 'selected' : ''}" style="
        width: 100%;
        height: 100%;
        background: ${typeInfo.color};
        border: ${isSelected ? '3px solid #00ff00' : '3px solid ' + typeInfo.borderColor};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        box-shadow: ${isSelected ? '0 0 20px rgba(0,255,0,0.8)' : '0 0 15px ' + typeInfo.borderColor + '80'};
      ">
        <div style="
          width: 40%;
          height: 40%;
          background: ${typeInfo.borderColor};
          border-radius: 50%;
          box-shadow: 0 0 10px ${typeInfo.borderColor};
        "></div>
        <div style="
          position: absolute;
          bottom: -25px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 11px;
          color: #00ff00;
          white-space: nowrap;
          background: rgba(0,0,0,0.8);
          padding: 2px 6px;
          border-radius: 4px;
        ">${ucControlName(control)}</div>
      </div>
    `;
  },

  /**
   * 按钮HTML
   */
  getButtonHTML(control, typeInfo, isSelected) {
    // 根据按钮ID判断具体类型
    let icon = typeInfo.icon;
    let bgColor = typeInfo.color;
    let borderColor = typeInfo.borderColor;
    let isRound = true; // 是否为圆形按钮
    let customStyle = '';

    if (control.control_id.includes('jump')) {
      icon = '⬆️';
      bgColor = 'rgba(0, 255, 0, 0.3)';
      borderColor = '#00ff00';
    } else if (control.control_id.includes('sprint')) {
      icon = '⚡';
      bgColor = 'rgba(255, 255, 0, 0.3)';
      borderColor = '#ffff00';
    } else if (control.control_id.includes('camera')) {
      icon = '📷';
      bgColor = 'rgba(0, 255, 255, 0.3)';
      borderColor = '#00ffff';
    } else if (control.control_id === 'mobile_turn_left_btn') {
      icon = '◀';
      bgColor = 'rgba(0, 255, 255, 0.25)';
      borderColor = '#00ffff';
    } else if (control.control_id === 'mobile_turn_right_btn') {
      icon = '▶';
      bgColor = 'rgba(0, 255, 255, 0.25)';
      borderColor = '#00ffff';
    } else if (control.control_id.includes('voice')) {
      icon = '🎤';
      bgColor = 'rgba(255, 0, 255, 0.3)';
      borderColor = '#ff00ff';
    } else if (control.control_id === 'btn_profile') {
      // 个人资料按钮 - 右上角绿色圆形按钮
      icon = '👤';
      bgColor = 'linear-gradient(135deg, rgba(0, 255, 0, 0.2), rgba(0, 200, 0, 0.3))';
      borderColor = '#00ff00';
      customStyle = 'box-shadow: 0 0 15px rgba(0, 255, 0, 0.3);';
    } else if (control.control_id === 'btn_inventory') {
      // 物品管理按钮 - 右上角金色圆形按钮
      icon = '🎒';
      bgColor = 'linear-gradient(135deg, rgba(255, 193, 7, 0.2), rgba(255, 160, 0, 0.3))';
      borderColor = '#ffc107';
      customStyle = 'box-shadow: 0 0 15px rgba(255, 193, 7, 0.3);';
    } else if (control.control_id === 'skill_voice_btn') {
      // 语音按钮 - 技能栏旁边的红色圆形按钮
      icon = '🎤';
      bgColor = 'linear-gradient(135deg, rgba(255, 80, 80, 0.2), rgba(255, 60, 60, 0.3))';
      borderColor = '#ff4444';
      customStyle = 'box-shadow: 0 0 15px rgba(255, 68, 68, 0.3);';
    } else if (control.control_id === 'portal_btn') {
      // 世界传送门按钮 - 青色矩形按钮
      icon = '🌀';
      bgColor = 'linear-gradient(135deg, rgba(0, 204, 255, 0.2), rgba(0, 150, 200, 0.3))';
      borderColor = '#00ccff';
      isRound = false;
      return this.getPortalButtonHTML(control, isSelected, icon, bgColor, borderColor);
    }

    const borderRadius = isRound ? '50%' : '8px';

    return `
      <div class="preview-button ${isSelected ? 'selected' : ''}" style="
        width: 100%;
        height: 100%;
        background: ${bgColor};
        border: ${isSelected ? '3px solid #00ff00' : '2px solid ' + borderColor};
        border-radius: ${borderRadius};
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
        box-shadow: ${isSelected ? '0 0 20px rgba(0,255,0,0.8)' : '0 0 15px ' + borderColor + '80'};
        font-size: 24px;
        ${customStyle}
      ">
        <span>${icon}</span>
        <div style="
          position: absolute;
          bottom: -25px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          color: #00ff00;
          white-space: nowrap;
          background: rgba(0,0,0,0.8);
          padding: 2px 6px;
          border-radius: 4px;
        ">${ucControlName(control)}</div>
      </div>
    `;
  },

  /**
   * 世界传送门按钮专用HTML
   */
  getPortalButtonHTML(control, isSelected, icon, bgColor, borderColor) {
    return `
      <div class="preview-portal-btn ${isSelected ? 'selected' : ''}" style="
        width: 100%;
        height: 100%;
        background: ${bgColor};
        border: ${isSelected ? '3px solid #00ff00' : '2px solid ' + borderColor};
        border-radius: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        box-shadow: ${isSelected ? '0 0 20px rgba(0,255,0,0.8)' : '0 0 10px rgba(0,200,255,0.3)'};
        font-family: 'Courier New', monospace;
        font-weight: bold;
        font-size: 14px;
        color: #000;
        padding: 12px 20px;
      ">
        <span style="margin-right: 6px; font-size: 16px;">${icon}</span>
        <span>传送门管理</span>
        <div style="
          position: absolute;
          bottom: -25px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          color: #00ff00;
          white-space: nowrap;
          background: rgba(0,0,0,0.8);
          padding: 2px 6px;
          border-radius: 4px;
        ">${ucControlName(control)}</div>
      </div>
    `;
  },

  /**
   * 血条HTML
   */
  getHealthBarHTML(control, typeInfo, isSelected) {
    return `
      <div class="preview-healthbar ${isSelected ? 'selected' : ''}" style="
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        border: ${isSelected ? '3px solid #00ff00' : '2px solid #00ff00'};
        position: relative;
        box-shadow: ${isSelected ? '0 0 20px rgba(0,255,0,0.8)' : 'none'};
      ">
        <div style="
          width: 75%;
          height: 100%;
          background: linear-gradient(90deg, #00ff00, #ffff00);
        "></div>
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 12px;
          color: #fff;
          font-weight: bold;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        ">HP: 75/100</div>
        <div style="
          position: absolute;
          bottom: -25px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 11px;
          color: #00ff00;
          white-space: nowrap;
          background: rgba(0,0,0,0.8);
          padding: 2px 6px;
          border-radius: 4px;
        ">${ucControlName(control)}</div>
      </div>
    `;
  },

  /**
   * 小地图HTML
   */
  getMinimapHTML(control, typeInfo, isSelected) {
    return `
      <div class="preview-minimap ${isSelected ? 'selected' : ''}" style="
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        border: ${isSelected ? '3px solid #00ff00' : '2px solid #00ff00'};
        position: relative;
        overflow: hidden;
        box-shadow: ${isSelected ? '0 0 20px rgba(0,255,0,0.8)' : 'none'};
      ">
        <!-- 地图网格 -->
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: 
            linear-gradient(rgba(0,255,0,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,0,0.1) 1px, transparent 1px);
          background-size: 20px 20px;
        "></div>
        <!-- 玩家位置 -->
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 8px;
          height: 8px;
          background: #00ff00;
          border-radius: 50%;
          box-shadow: 0 0 10px #00ff00;
        "></div>
        <div style="
          position: absolute;
          bottom: 5px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          color: #00ff00;
          background: rgba(0,0,0,0.8);
          padding: 2px 6px;
          border-radius: 4px;
        ">${ucControlName(control)}</div>
      </div>
    `;
  },

  /**
   * 面板HTML（技能栏等）
   */
  getPanelHTML(control, typeInfo, isSelected) {
    // 技能栏特殊处理
    if (control.control_id === 'skill_hud') {
      return `
        <div class="preview-skillhud ${isSelected ? 'selected' : ''}" style="
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: row;
          gap: 8px;
          align-items: flex-end;
          position: relative;
        ">
          ${[1,2,3,4,5].map(i => `
            <div style="
              width: 58px;
              height: 58px;
              border: ${isSelected ? '3px solid #00ff00' : '2px solid rgba(0,255,0,0.5)'};
              background: rgba(0,0,0,0.75);
              border-radius: 10px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 20px;
            ">${['⚔️','🛡️','🏹','⚡','💊'][i-1]}</div>
          `).join('')}
          <div style="
            position: absolute;
            bottom: -25px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 11px;
            color: #00ff00;
            white-space: nowrap;
            background: rgba(0,0,0,0.8);
            padding: 2px 6px;
            border-radius: 4px;
          ">${ucControlName(control)}</div>
        </div>
      `;
    }

    // 性能监控面板特殊处理
    if (control.control_id === 'performance_monitor') {
      return this.getPerformanceMonitorHTML(control, typeInfo, isSelected);
    }

    // 默认面板
    return `
      <div class="preview-panel ${isSelected ? 'selected' : ''}" style="
        width: 100%;
        height: 100%;
        background: ${typeInfo.color};
        border: ${isSelected ? '3px solid #00ff00' : '2px solid ' + typeInfo.borderColor};
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
        box-shadow: ${isSelected ? '0 0 20px rgba(0,255,0,0.8)' : 'none'};
      ">
        <span style="font-size: 24px;">${typeInfo.icon}</span>
        <div style="
          position: absolute;
          bottom: -25px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 11px;
          color: #00ff00;
          white-space: nowrap;
          background: rgba(0,0,0,0.8);
          padding: 2px 6px;
          border-radius: 4px;
        ">${ucControlName(control)}</div>
      </div>
    `;
  },

  /**
   * 性能监控面板HTML
   */
  getPerformanceMonitorHTML(control, typeInfo, isSelected) {
    return `
      <div class="preview-performance-monitor ${isSelected ? 'selected' : ''}" style="
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        border: ${isSelected ? '3px solid #00ff00' : '2px solid #00ff00'};
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        padding: 10px;
        position: relative;
        box-shadow: ${isSelected ? '0 0 20px rgba(0,255,0,0.8)' : '0 0 10px rgba(0,255,0,0.3)'};
        font-family: 'Courier New', monospace;
        font-size: 11px;
        color: #00ff00;
        overflow: hidden;
      ">
        <div style="font-weight: bold; margin-bottom: 6px; border-bottom: 1px solid rgba(0,255,0,0.3); padding-bottom: 4px;">
          📊 性能监控
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
          <span>FPS:</span>
          <span style="color: #ffff00;">60</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
          <span>内存:</span>
          <span style="color: #00ffff;">45.2MB</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
          <span>对象:</span>
          <span style="color: #ff8800;">12/45</span>
        </div>
        <div style="
          position: absolute;
          bottom: -25px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 11px;
          color: #00ff00;
          white-space: nowrap;
          background: rgba(0,0,0,0.8);
          padding: 2px 6px;
          border-radius: 4px;
        ">${ucControlName(control)}</div>
      </div>
    `;
  },

  /**
   * 默认HTML
   */
  getDefaultHTML(control, typeInfo, isSelected) {
    return `
      <div class="preview-default ${isSelected ? 'selected' : ''}" style="
        width: 100%;
        height: 100%;
        background: ${typeInfo.color};
        border: ${isSelected ? '3px solid #00ff00' : '2px solid ' + typeInfo.borderColor};
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
        box-shadow: ${isSelected ? '0 0 20px rgba(0,255,0,0.8)' : 'none'};
      ">
        <span style="font-size: 24px;">${typeInfo.icon}</span>
        <span style="font-size: 10px; margin-top: 4px;">${ucControlName(control)}</span>
      </div>
    `;
  },

  /**
   * 添加调整大小手柄
   */
  addResizeHandles(el) {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.style.cssText = `
      position: absolute;
      bottom: -6px;
      right: -6px;
      width: 16px;
      height: 16px;
      background: #00ff00;
      border: 2px solid #fff;
      border-radius: 50%;
      cursor: nwse-resize;
      z-index: 10000;
      box-shadow: 0 0 10px rgba(0,255,0,0.8);
    `;
    handle.title = '拖拽调整大小';
    el.appendChild(handle);
  },

  /**
   * 处理鼠标按下事件
   */
  handleMouseDown(e, control, el) {
    e.stopPropagation();
    e.preventDefault();

    // 检查是否点击了调整大小手柄
    if (e.target.classList.contains('resize-handle')) {
      this.isResizing = true;
      this.resizeTarget = el;
      this.resizeControl = control;
      this.resizeStartX = e.clientX;
      this.resizeStartY = e.clientY;
      this.resizeStartWidth = el.offsetWidth;
      this.resizeStartHeight = el.offsetHeight;
      return;
    }

    // 如果点击的不是当前选中的控件，先选中它
    if (this.currentControl?.control_id !== control.control_id) {
      this.selectControl(control.control_id);
      return;
    }

    // 开始拖拽（只有已选中的控件才能拖拽）
    this.isDragging = true;
    this.dragTarget = el;
    this.dragControl = control;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;

    // 【修复】offsetLeft/offsetTop 是相对于 offsetParent 边框的（含 padding）
    // CSS left/right/top/bottom 是相对于 offsetParent 内容区的（不含 padding）
    // 需要减去 offsetParent 的 padding 来统一坐标系
    const offsetParent = el.offsetParent;
    const cs = getComputedStyle(offsetParent);
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padTop = parseFloat(cs.paddingTop) || 0;

    this.dragPadLeft = padLeft;
    this.dragPadTop = padTop;
    this.dragStartLeft = el.offsetLeft - padLeft;
    this.dragStartTop = el.offsetTop - padTop;

    // 添加拖拽时的视觉反馈
    el.style.cursor = 'grabbing';
    el.style.zIndex = '10000';
  },

  /**
   * 处理拖拽移动
   */
  handleDragMove(e) {
    if (!this.isDragging || !this.dragTarget) return;

    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;

    // 【修复】使用内容区相对坐标（CSS left/right/top/bottom 的坐标系）
    // offsetWidth 含 padding，需扣除 padding 得到内容区宽度
    const offsetParent = this.dragTarget.offsetParent;
    const cs = getComputedStyle(offsetParent);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const contentWidth = offsetParent.offsetWidth - padL - padR;
    const contentHeight = offsetParent.offsetHeight - padT - padB;
    const targetWidth = this.dragTarget.offsetWidth;
    const targetHeight = this.dragTarget.offsetHeight;

    const hAlign = this.dragControl.h_align || 'left';
    const vAlign = this.dragControl.v_align || 'top';

    let newLeft = this.dragStartLeft + dx;
    let newTop = this.dragStartTop + dy;

    // 边界限制：基于内容区（与 CSS left/right 同坐标系）
    const maxLeft = contentWidth - targetWidth;
    const maxTop = contentHeight - targetHeight;

    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));

    // 根据对齐方式设置 CSS 属性（内容区相对值）
    if (hAlign === 'right') {
      const newRight = contentWidth - newLeft - targetWidth;
      this.dragTarget.style.right = newRight + 'px';
      this.dragTarget.style.left = 'auto';
    } else {
      this.dragTarget.style.left = newLeft + 'px';
      this.dragTarget.style.right = 'auto';
    }

    if (vAlign === 'bottom') {
      const newBottom = contentHeight - newTop - targetHeight;
      this.dragTarget.style.bottom = newBottom + 'px';
      this.dragTarget.style.top = 'auto';
    } else {
      this.dragTarget.style.top = newTop + 'px';
      this.dragTarget.style.bottom = 'auto';
    }
  },

  /**
   * 处理拖拽结束
   */
  handleDragEnd() {
    if (!this.isDragging || !this.dragTarget) return;

    // 恢复光标样式
    this.dragTarget.style.cursor = 'move';
    this.dragTarget.style.zIndex = this.dragControl.z_index;

    // 更新控件位置
    // 【修复】使用内容区相对坐标（与CSS left/right/top/bottom一致）
    const offsetParent = this.dragTarget.offsetParent;
    const cs = getComputedStyle(offsetParent);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const contentWidth = offsetParent.offsetWidth - padL - padR;
    const contentHeight = offsetParent.offsetHeight - padT - padB;

    // 获取控件当前内容区相对位置（offsetLeft 含 padding，需减去）
    const currentLeft = this.dragTarget.offsetLeft - padL;
    const currentTop = this.dragTarget.offsetTop - padT;
    const targetWidth = this.dragTarget.offsetWidth;
    const targetHeight = this.dragTarget.offsetHeight;

    // 计算控件中心点位置（用于判断对齐方式，内容区相对）
    const controlCenterX = currentLeft + targetWidth / 2;
    const controlCenterY = currentTop + targetHeight / 2;
    const parentCenterX = contentWidth / 2;
    const parentCenterY = contentHeight / 2;

    // 根据拖拽位置自动检测对齐方式
    const newHAlign = controlCenterX > parentCenterX ? 'right' : 'left';
    const newVAlign = controlCenterY > parentCenterY ? 'bottom' : 'top';

    // 根据对齐方式计算正确的位置值（内容区相对百分比）
    let newXStr, newYStr;
    if (newHAlign === 'right') {
      const rightPx = contentWidth - currentLeft - targetWidth;
      const rightPercent = Math.round(rightPx / contentWidth * 100);
      newXStr = rightPercent + '%';
    } else {
      const leftPercent = Math.round(currentLeft / contentWidth * 100);
      newXStr = leftPercent + '%';
    }
    if (newVAlign === 'bottom') {
      const bottomPx = contentHeight - currentTop - targetHeight;
      const bottomPercent = Math.round(bottomPx / contentHeight * 100);
      newYStr = bottomPercent + '%';
    } else {
      const topPercent = Math.round(currentTop / contentHeight * 100);
      newYStr = topPercent + '%';
    }

    this.dragControl.h_align = newHAlign;
    this.dragControl.v_align = newVAlign;
    this.setFieldValue(this.dragControl, 'position_x', newXStr);
    this.setFieldValue(this.dragControl, 'position_y', newYStr);

    // 更新编辑器中的值
    const posXInput = document.getElementById('ui-edit-pos-x');
    const posYInput = document.getElementById('ui-edit-pos-y');
    const hAlignInput = document.getElementById('ui-edit-h-align');
    const vAlignInput = document.getElementById('ui-edit-v-align');
    if (posXInput) posXInput.value = newXStr;
    if (posYInput) posYInput.value = newYStr;
    if (hAlignInput) hAlignInput.value = newHAlign;
    if (vAlignInput) vAlignInput.value = newVAlign;

    // 标记有未保存的更改
    this.markUnsaved();

    this.isDragging = false;
    this.dragTarget = null;
    this.dragControl = null;
    // 拖拽后更新位置标签（对齐方式可能已变化）
    this.updatePositionLabels();
  },

  /**
   * 处理调整大小移动
   */
  handleResizeMove(e) {
    if (!this.isResizing || !this.resizeTarget) return;

    const dx = e.clientX - this.resizeStartX;
    const dy = e.clientY - this.resizeStartY;

    // 性能监控面板最小尺寸限制
    const minW = (this.resizeControl && this.resizeControl.control_id === 'performance_monitor')
      ? (this.previewMode === 'mobile' ? 150 : 200) : 30;
    const minH = (this.resizeControl && this.resizeControl.control_id === 'performance_monitor')
      ? (this.previewMode === 'mobile' ? 100 : 120) : 30;

    const newWidth = Math.max(minW, this.resizeStartWidth + dx);
    const newHeight = Math.max(minH, this.resizeStartHeight + dy);

    this.resizeTarget.style.width = newWidth + 'px';
    this.resizeTarget.style.height = newHeight + 'px';
  },

  /**
   * 处理调整大小结束
   */
  handleResizeEnd() {
    if (!this.isResizing || !this.resizeTarget) return;

    // 获取新的大小
    let newWidth = this.resizeTarget.style.width;
    let newHeight = this.resizeTarget.style.height;

    const isMobile = this.previewMode === 'mobile';

    // 性能监控面板尺寸范围保护（min~max）
    if (this.resizeControl && this.resizeControl.control_id === 'performance_monitor') {
      const minWpx = isMobile ? 150 : 200;
      const minHpx = isMobile ? 100 : 120;
      const maxWpx = isMobile ? 300 : 400;
      const maxHpx = isMobile ? 200 : 250;
      const numW = parseFloat(newWidth);
      const numH = parseFloat(newHeight);
      if (isNaN(numW) || numW < minWpx) newWidth = minWpx + 'px';
      else if (numW > maxWpx) { console.warn('[AdminUIControls] 拖拽尺寸过大 width:', numW, '→', maxWpx); newWidth = maxWpx + 'px'; }
      if (isNaN(numH) || numH < minHpx) newHeight = minHpx + 'px';
      else if (numH > maxHpx) { console.warn('[AdminUIControls] 拖拽尺寸过大 height:', numH, '→', maxHpx); newHeight = maxHpx + 'px'; }
    }

    this.setFieldValue(this.resizeControl, 'width', newWidth);
    this.setFieldValue(this.resizeControl, 'height', newHeight);

    // 更新编辑器中的值
    const widthInput = document.getElementById('ui-edit-width');
    const heightInput = document.getElementById('ui-edit-height');
    if (widthInput) widthInput.value = newWidth;
    if (heightInput) heightInput.value = newHeight;

    // 标记有未保存的更改
    this.markUnsaved();

    this.isResizing = false;
    this.resizeTarget = null;
    this.resizeControl = null;
  },

  /**
   * 保存当前控件
   */
  async saveCurrentControl() {
    if (!this.currentControl) return;

    try {
      // 清理控件数据，只发送必要的字段
      const {
        id, created_at, created_by, updated_at, updated_by,
        ...controlToSave
      } = this.currentControl;

      const response = await fetch(`/api/ui-controls/admin/update/${this.currentControl.control_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: JSON.stringify(controlToSave)
      });

      const data = await response.json();

      if (data.success) {
        this.showSuccess('控件保存成功');
        // 更新本地数据
        const index = this.controls.findIndex(c => c.control_id === this.currentControl.control_id);
        if (index !== -1) {
          this.controls[index] = data.control;
        }
        // 更新原始数据快照，防止状态混乱
        this.originalControls = JSON.stringify(this.controls);
        this.hasUnsavedChanges = false;
        this.hideUnsavedIndicator();
        this.renderControlsList();
      } else {
        this.showError('保存失败: ' + data.error);
      }
    } catch (error) {
      console.error('保存控件失败:', error);
      this.showError('保存失败');
    }
  },

  /**
   * 批量保存所有更改
   */
  async batchSave() {
    try {
      // 移动端模式下：补齐所有未设移动端值的控件，防止保存时丢失尺寸
      if (this.previewMode === 'mobile') {
        const prefix = this.getFieldPrefix();
        this.controls.forEach(control => {
          if (!control[prefix + 'position_x'] && control.position_x) {
            control[prefix + 'position_x'] = control.position_x;
          }
          if (!control[prefix + 'position_y'] && control.position_y) {
            control[prefix + 'position_y'] = control.position_y;
          }
          if (!control[prefix + 'width'] && control.width) {
            control[prefix + 'width'] = control.width;
          }
          if (!control[prefix + 'height'] && control.height) {
            control[prefix + 'height'] = control.height;
          }
        });
      }

      // 性能监控面板尺寸范围保护（所有模式生效，保存前兜底：min~max）
      this.controls.forEach(control => {
        if (control.control_id === 'performance_monitor') {
          console.log('[batchSave] performance_monitor 保存前:', JSON.stringify({
            width: control.width,
            height: control.height,
            mobile_width: control.mobile_width,
            mobile_height: control.mobile_height,
            previewMode: this.previewMode
          }));
          // 桌面端：200~400 × 120~250
          const dw = parseFloat(control.width);
          const dh = parseFloat(control.height);
          if (isNaN(dw) || dw < 200) { console.warn('[batchSave] 桌面width异常:', control.width, '→ 200px'); control.width = '200px'; }
          if (dw > 400) { console.warn('[batchSave] 桌面width过大:', dw, '→ 200px'); control.width = '200px'; }
          if (isNaN(dh) || dh < 120) { console.warn('[batchSave] 桌面height异常:', control.height, '→ 120px'); control.height = '120px'; }
          if (dh > 250) { console.warn('[batchSave] 桌面height过大:', dh, '→ 120px'); control.height = '120px'; }
          // 移动端：150~300 × 100~200
          const mw = parseFloat(control.mobile_width || control.width);
          const mh = parseFloat(control.mobile_height || control.height);
          if (isNaN(mw) || mw < 150) { console.warn('[batchSave] 移动width异常:', control.mobile_width, '→ 150px'); control.mobile_width = '150px'; }
          if (mw > 300) { console.warn('[batchSave] 移动width过大:', mw, '→ 150px'); control.mobile_width = '150px'; }
          if (isNaN(mh) || mh < 100) { console.warn('[batchSave] 移动height异常:', control.mobile_height, '→ 100px'); control.mobile_height = '100px'; }
          if (mh > 200) { console.warn('[batchSave] 移动height过大:', mh, '→ 100px'); control.mobile_height = '100px'; }
          console.log('[batchSave] performance_monitor 保存后:', JSON.stringify({
            width: control.width,
            height: control.height,
            mobile_width: control.mobile_width,
            mobile_height: control.mobile_height
          }));
        }
      });

      // 清理控件数据，只发送必要的字段
      const controlsToSave = this.controls.map(control => {
        // 只提取需要更新的字段
        const {
          id, created_at, created_by, updated_at, updated_by,
          ...updatableFields
        } = control;
        return updatableFields;
      });

      const response = await fetch('/api/ui-controls/admin/batch-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: JSON.stringify({ controls: controlsToSave })
      });

      const data = await response.json();

      if (data.success) {
        this.showSuccess(`成功保存 ${data.controls.length} 个控件`);
        this.hasUnsavedChanges = false;
        this.hideUnsavedIndicator();
        this.loadControls();
      } else {
        this.showError('批量保存失败: ' + data.error);
      }
    } catch (error) {
      console.error('批量保存失败:', error);
      this.showError('批量保存失败');
    }
  },

  /**
   * 重置当前控件
   */
  async resetCurrentControl() {
    if (!this.currentControl) return;

    if (!confirm(ucTp('ucResetConfirm', { name: ucControlName(this.currentControl) }, '确定要将 "' + ucControlName(this.currentControl) + '" 重置为默认配置吗？'))) {
      return;
    }

    try {
      const response = await fetch(`/api/ui-controls/admin/reset/${this.currentControl.control_id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        }
      });

      const data = await response.json();

      if (data.success) {
        this.showSuccess(ucT('ucResetSuccess', '控件已重置为默认配置'));
        this.currentControl = data.control;
        this.loadControls();
        this.renderEditor();
      } else {
        this.showError(ucT('ucResetFail', '重置失败') + ': ' + data.error);
      }
    } catch (error) {
      console.error('重置控件失败:', error);
      this.showError(ucT('ucResetFail', '重置失败'));
    }
  },

  /**
   * 删除控件
   */
  async deleteControl() {
    if (!this.currentControl) return;

    if (!confirm(ucTp('ucDeleteConfirm', { name: ucControlName(this.currentControl) }, '确定要删除控件 "' + ucControlName(this.currentControl) + '" 吗？此操作不可恢复。'))) {
      return;
    }

    try {
      const response = await fetch(`/api/ui-controls/admin/delete/${this.currentControl.control_id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        }
      });

      const data = await response.json();

      if (data.success) {
        this.showSuccess(ucT('ucDeleteSuccess', '控件已删除'));
        this.controls = this.controls.filter(c => c.control_id !== this.currentControl.control_id);
        this.currentControl = null;
        this.renderControlsList();
        this.renderEditor();
        this.updatePreview();
      } else {
        this.showError(ucT('ucDeleteFail', '删除失败') + ': ' + data.error);
      }
    } catch (error) {
      console.error('删除控件失败:', error);
      this.showError(ucT('ucDeleteFail', '删除失败'));
    }
  },

  /**
   * 显示添加控件模态框
   */
  showAddModal() {
    const modal = document.createElement('div');
    modal.className = 'ui-modal';
    modal.innerHTML = `
      <div class="ui-modal-content">
        <div class="ui-modal-header">
          <h3>${ucT('ucAddTitle', '添加新控件')}</h3>
          <button class="ui-modal-close" onclick="this.closest('.ui-modal').remove()">&times;</button>
        </div>
        <div class="ui-modal-body">
          <div class="ui-form-row">
            <label>${ucT('ucAddIdLabel', '控件ID (唯一标识)')}</label>
            <input type="text" id="ui-new-control-id" placeholder="${ucT('ucAddIdPlaceholder', '例如: my_custom_button')}">
          </div>
          <div class="ui-form-row">
            <label>${ucT('ucEditName', '控件名称')}</label>
            <input type="text" id="ui-new-control-name" placeholder="${ucT('ucAddNamePlaceholder', '例如: 我的自定义按钮')}">
          </div>
          <div class="ui-form-row">
            <label>${ucT('ucEditType', '控件类型')}</label>
            <select id="ui-new-control-type">
              ${this.controlTypes.map(t => `<option value="${t.value}">${t.icon} ${t.label}</option>`).join('')}
            </select>
          </div>
          <div class="ui-form-row">
            <label>${ucT('ucEditCategory', '分类')}</label>
            <select id="ui-new-control-category">
              ${this.categories.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="ui-modal-footer">
          <button class="btn" onclick="AdminUIControls.createNewControl()">${ucT('ucAddCreate', '创建')}</button>
          <button class="btn btn-secondary" onclick="this.closest('.ui-modal').remove()">${ucT('ucAddCancel', '取消')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  /**
   * 创建新控件
   */
  async createNewControl() {
    const controlId = document.getElementById('ui-new-control-id')?.value?.trim();
    const controlName = document.getElementById('ui-new-control-name')?.value?.trim();
    const controlType = document.getElementById('ui-new-control-type')?.value;
    const category = document.getElementById('ui-new-control-category')?.value;

    if (!controlId || !controlName) {
      this.showError(ucT('ucErrNeedIdName', '请填写控件ID和名称'));
      return;
    }

    // 验证ID格式
    if (!/^[a-z0-9_]+$/.test(controlId)) {
      this.showError(ucT('ucErrIdFormat', '控件ID只能包含小写字母、数字和下划线'));
      return;
    }

    // 验证ID长度
    if (controlId.length < 3 || controlId.length > 50) {
      this.showError(ucT('ucErrIdLength', '控件ID长度必须在3-50个字符之间'));
      return;
    }

    // 验证名称长度
    if (controlName.length < 1 || controlName.length > 100) {
      this.showError(ucT('ucErrNameLength', '控件名称长度必须在1-100个字符之间'));
      return;
    }

    try {
      const response = await fetch('/api/ui-controls/admin/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: JSON.stringify({
          control_id: controlId,
          control_name: controlName,
          control_type: controlType,
          category: category,
          position_x: '20px',
          position_y: '20px',
          width: '100px',
          height: '50px'
        })
      });

      const data = await response.json();

      if (data.success) {
        this.showSuccess('控件创建成功');
        document.querySelector('.ui-modal')?.remove();
        this.controls.push(data.control);
        this.renderControlsList();
        this.selectControl(controlId);
      } else {
        this.showError('创建失败: ' + data.error);
      }
    } catch (error) {
      console.error('创建控件失败:', error);
      this.showError('创建失败');
    }
  },

  /**
   * 显示成功消息
   */
  showSuccess(message) {
    this.showNotification(message, 'success');
  },

  /**
   * 显示错误消息
   */
  showError(message) {
    this.showNotification(message, 'error');
  },

  /**
   * 显示通知
   */
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `ui-notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      color: white;
      font-weight: 500;
      z-index: 10000;
      animation: slideIn 0.3s ease;
      background: ${type === 'success' ? '#00aa00' : type === 'error' ? '#aa0000' : '#0066aa'};
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'uiSlideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
};

// 导出到全局
window.AdminUIControls = AdminUIControls;
