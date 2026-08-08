/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 多平台动作库功能模块（角色模板集成版）
 * 功能：在角色模板 Modal 中选择平台，自动关联动作
 * 互斥模式：要么使用平台动作库，要么自己上传动作（二选一）
 */

const MultiPlatformAnimLib = (() => {
  const API_BASE = '/api/character-templates';
  
  const ANIM_KEY_LABELS = {
    idle: '🧍 待机',
    walk: '🚶 走路',
    run: '🏃 奔跑',
    jump: '🦘 跳跃',
    turn_left: '↪️ 左转',
    turn_right: '↩️ 右转',
    attack1: '👊 拳击',
    attack_stab: '🗡️ 刺击',
    attack_slash: '⚔️ 挥砍',
    attack_swing: '🗡️ 横扫',
    attack_uppercut: '👆 上勾拳',
    draw_sword: '🗡️ 拔剑',
    sheath: '🔙 收剑',
    hit: '💥 受击',
    death: '💀 死亡',
    combo_2: '2️⃣ 连招2',
    combo_3: '3️⃣ 连招3'
  };
  
  const PLATFORMS = [
    { key: 'mixamo', name: '🎬 Mixamo', desc: 'Adobe Mixamo 动作库' },
    { key: 'hunyuan3d', name: '🤖 混元3D', desc: '腾讯混元3D 动作库' },
    { key: 'makehuman', name: '🎭 MakeHuman', desc: 'MakeHuman 动作库' },
    { key: 'other', name: '➕ 其他', desc: '其他平台动作库' }
  ];
  
  let _currentPlatform = 'mixamo';
  let _animLibCache = [];
  let _isInitialized = false;
  
  // 互斥模式状态：'platform' = 使用平台, 'custom' = 自定义上传, 'none' = 未选择
  let _mode = 'none';
  
  // 自定义上传的动作数量
  let _customAnimCount = 0;
  
  /**
   * 初始化：在角色模板 Modal 中渲染平台选择
   */
  function init() {
    if (_isInitialized) return;
    
    // 等待 DOM 完全加载
    setTimeout(() => {
      initInTemplateModal();
      _isInitialized = true;
    }, 500);
  }
  
  /**
   * 在模板 Modal 的动作配置区域插入平台选择
   */
  function initInTemplateModal() {
    // 找到"动作配置"Tab 的内容区域
    const animTab = document.getElementById('tmpl-sub-anims');
    if (!animTab) {
      console.log('⚠️ 未找到动作配置 Tab，跳过初始化');
      return;
    }
    
    // 检查是否已经初始化过
    if (document.getElementById('mpl-platform-section')) {
      return;
    }
    
    // 创建平台选择区域
    const platformSection = createPlatformSection();
    
    // 插入到动作配置 Tab 的顶部
    animTab.insertBefore(platformSection, animTab.firstChild);
    
    console.log('✅ 多平台动作库选择器已初始化（互斥模式）');
    
    // 加载动作库
    loadAnimLibByPlatform(_currentPlatform);
  }
  
  /**
   * 创建平台选择区域 DOM
   */
  function createPlatformSection() {
    const div = document.createElement('div');
    div.id = 'mpl-platform-section';
    div.className = 'platform-selector-section';
    div.style.cssText = `
      margin-bottom: 16px;
      padding: 14px;
      border: 1px solid rgba(0, 255, 0, 0.2);
      border-radius: 8px;
      background: rgba(0, 255, 0, 0.03);
    `;
    
    div.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--green);">
          🎬 动作配置模式选择
        </div>
        <button class="btn btn-sm btn-secondary" onclick="MultiPlatformAnimLib.refresh()" style="font-size: 10px; padding: 3px 8px;">
          🔄 刷新
        </button>
      </div>
      
      <!-- 模式选择：两个互斥按钮 -->
      <div style="display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
        <button id="mpl-mode-platform" class="btn btn-sm" onclick="MultiPlatformAnimLib.setMode('platform')" 
                style="flex: 1; min-width: 140px; padding: 8px 12px; font-size: 11px;">
          📚 使用动作库平台
        </button>
        <button id="mpl-mode-custom" class="btn btn-sm" onclick="MultiPlatformAnimLib.setMode('custom')" 
                style="flex: 1; min-width: 140px; padding: 8px 12px; font-size: 11px;">
          📤 自定义上传动作
        </button>
      </div>
      
      <!-- 平台选择区域（选中"使用平台"时显示） -->
      <div id="mpl-platform-area" style="display: none;">
        <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">选择平台：</div>
        <div id="mpl-platform-buttons" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
          ${PLATFORMS.map(p => `
            <button class="btn btn-sm ${_currentPlatform === p.key ? 'btn-active' : ''}" 
                    onclick="MultiPlatformAnimLib.switchPlatform('${p.key}', this)"
                    title="${p.desc}"
                    style="font-size: 11px; padding: 5px 12px;">
              ${p.name}
            </button>
          `).join('')}
        </div>
        
        <div id="mpl-anim-preview" style="font-size: 11px; color: var(--muted);">
          加载中...
        </div>
        
        <div style="margin-top: 12px;">
          <button id="mpl-confirm-btn" class="btn btn-sm" onclick="MultiPlatformAnimLib.confirmPlatformAnims()"
                  style="background: var(--green); color: #000; font-weight: 600;">
            ✅ 确认使用平台动作
          </button>
        </div>
      </div>
      
      <!-- 自定义上传提示区域（选中"自定义"时显示） -->
      <div id="mpl-custom-area" style="display: none;">
        <div style="padding: 12px; background: rgba(0, 255, 0, 0.05); border: 1px solid rgba(0, 255, 0, 0.15); border-radius: 6px; text-align: center;">
          <div style="font-size: 12px; color: var(--green); margin-bottom: 6px;">📤 自定义上传模式</div>
          <div style="font-size: 10px; color: var(--muted); line-height: 1.5;">
            请在下方「上传动作」按钮上传动作文件。<br>
            ⚠️ <strong style="color: var(--orange);">必须上传至少 1 个动作才能保存</strong>
          </div>
          <div id="mpl-custom-count" style="margin-top: 8px; font-size: 11px; color: var(--muted);">
            已上传：0 个动作
          </div>
        </div>
      </div>
      
      <!-- 当前状态提示 -->
      <div id="mpl-status" style="display: none; margin-top: 12px; padding: 10px; border-radius: 6px; font-size: 11px; text-align: center;">
      </div>
    `;
    
    return div;
  }
  
  /**
   * 设置模式
   */
  function setMode(mode) {
    _mode = mode;
    
    const platformArea = document.getElementById('mpl-platform-area');
    const customArea = document.getElementById('mpl-custom-area');
    const modeBtnP = document.getElementById('mpl-mode-platform');
    const modeBtnC = document.getElementById('mpl-mode-custom');
    
    if (mode === 'platform') {
      // 显示平台选择区域
      if (platformArea) platformArea.style.display = 'block';
      if (customArea) customArea.style.display = 'none';
      if (modeBtnP) { modeBtnP.classList.add('btn-active'); modeBtnP.style.background = 'var(--green)'; }
      if (modeBtnC) modeBtnC.classList.remove('btn-active');
      renderAnimPreview();
    } else if (mode === 'custom') {
      // 显示自定义上传区域
      if (platformArea) platformArea.style.display = 'none';
      if (customArea) customArea.style.display = 'block';
      if (modeBtnC) { modeBtnC.classList.add('btn-active'); modeBtnC.style.background = 'var(--green)'; }
      if (modeBtnP) modeBtnP.classList.remove('btn-active');
    }
    
    // 通知角色编辑器更新保存按钮状态
    notifySaveState();
  }
  
  /**
   * 切换模式（从外部调用，用于切换到自定义模式）
   */
  function switchToCustomMode() {
    setMode('custom');
  }
  
  /**
   * 更新自定义上传数量
   */
  function updateCustomAnimCount(count) {
    _customAnimCount = count;
    const countEl = document.getElementById('mpl-custom-count');
    if (countEl) {
      countEl.innerHTML = `已上传：<strong style="color: ${count > 0 ? 'var(--green)' : 'var(--orange)'}">${count}</strong> 个动作`;
      if (count === 0) {
        countEl.innerHTML += ' <span style="color: var(--orange);">⚠️ 必须上传至少1个</span>';
      }
    }
    notifySaveState();
  }
  
  /**
   * 确认使用平台动作
   */
  function confirmPlatformAnims() {
    if (_animLibCache.length === 0) {
      showToast('该平台暂无动作，请先在「动作库」上传动作', 'error');
      return;
    }
    
    // 更新状态
    const statusEl = document.getElementById('mpl-status');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(0, 255, 0, 0.1)';
      statusEl.style.border = '1px solid rgba(0, 255, 0, 0.3)';
      statusEl.style.color = 'var(--green)';
      statusEl.innerHTML = `
        ✅ 已选择 <strong>${PLATFORMS.find(p => p.key === _currentPlatform)?.name || _currentPlatform}</strong> 平台，共 ${_animLibCache.length} 个动作
        <button onclick="MultiPlatformAnimLib.cancelPlatformChoice()" 
                style="margin-left: 10px; padding: 2px 8px; font-size: 10px; background: rgba(255,60,60,0.15); color: #ff6b6b; border: 1px solid rgba(255,60,60,0.3); border-radius: 4px; cursor: pointer;">
          ✕ 取消选择
        </button>
      `;
    }
    
    // 禁用确认按钮
    const confirmBtn = document.getElementById('mpl-confirm-btn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.6';
      confirmBtn.textContent = '✅ 已确认';
    }
    
    // 自动持久化到数据库
    const tmplId = (typeof _currentTmplId !== 'undefined') ? _currentTmplId : 
                   (window._currentTmplId || null);
    if (tmplId) {
      console.log('[confirmPlatformAnims] 自动保存平台选择: tmplId=' + tmplId + ', platform=' + _currentPlatform);
      attachPlatformToTemplate(tmplId).then(success => {
        if (success) {
          console.log('[confirmPlatformAnims] ✅ 平台选择已自动保存');
        } else {
          console.log('[confirmPlatformAnims] ⚠️ 自动保存失败，请手动点击保存');
        }
      });
    } else {
      console.log('[confirmPlatformAnims] ⚠️ 无模板ID，跳过自动保存（新建模板需先保存基本信息）');
    }
    
    showToast(`已确认使用平台动作，共 ${_animLibCache.length} 个`);
    notifySaveState();
  }
  
  /**
   * 通知保存状态变化
   */
  function notifySaveState() {
    // 触发自定义事件，让角色编辑器可以监听
    const event = new CustomEvent('mpl-save-state-changed', {
      detail: { canSave: canSave() }
    });
    document.dispatchEvent(event);
  }
  
  /**
   * 检查是否可以保存
   */
  function canSave() {
    if (_mode === 'platform') {
      // 平台模式：检查是否已确认
      const confirmBtn = document.getElementById('mpl-confirm-btn');
      return confirmBtn && confirmBtn.disabled && confirmBtn.textContent.includes('已确认');
    } else if (_mode === 'custom') {
      // 自定义模式：检查是否至少上传了1个动作
      return _customAnimCount >= 1;
    }
    return false;
  }
  
  /**
   * 获取保存状态信息
   */
  function getSaveStatus() {
    if (_mode === 'platform') {
      if (_animLibCache.length === 0) {
        return { canSave: false, message: '该平台暂无动作' };
      }
      const confirmBtn = document.getElementById('mpl-confirm-btn');
      if (confirmBtn && confirmBtn.disabled) {
        return { canSave: true, message: `使用 ${PLATFORMS.find(p => p.key === _currentPlatform)?.name} 平台动作 (${_animLibCache.length}个)` };
      }
      return { canSave: false, message: '请点击"确认使用平台动作"' };
    } else if (_mode === 'custom') {
      if (_customAnimCount >= 1) {
        return { canSave: true, message: `自定义动作 (${_customAnimCount}个)` };
      }
      return { canSave: false, message: `请上传至少1个动作 (还需${1 - _customAnimCount}个)` };
    }
    return { canSave: false, message: '请选择动作配置模式' };
  }
  
  /**
   * 切换平台
   */
  function switchPlatform(platform, btn) {
    _currentPlatform = platform;
    
    // 更新按钮样式
    document.querySelectorAll('#mpl-platform-buttons .btn').forEach(b => {
      b.classList.remove('btn-active');
    });
    if (btn) {
      btn.classList.add('btn-active');
    }
    
    // 重置确认状态
    const confirmBtn = document.getElementById('mpl-confirm-btn');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
      confirmBtn.textContent = '✅ 确认使用平台动作';
    }
    
    // 加载该平台的动作
    loadAnimLibByPlatform(platform);
  }
  
  /**
   * 刷新
   */
  function refresh() {
    loadAnimLibByPlatform(_currentPlatform);
  }
  
  /**
   * 按平台加载动作库
   */
  async function loadAnimLibByPlatform(platform) {
    const container = document.getElementById('mpl-anim-preview');
    if (!container) return;
    
    container.innerHTML = '<span style="color: var(--muted);">⏳ 加载中...</span>';
    
    const token = localStorage.getItem('adminToken');
    
    try {
      const r = await fetch(API_BASE + '/anim-library?platform=' + platform, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      
      if (!r.ok) {
        throw new Error('获取数据失败');
      }
      
      const data = await r.json();
      _animLibCache = data.animations || [];
      
      // 渲染动作预览
      renderAnimPreview();
    } catch (e) {
      console.error('加载平台动作失败:', e);
      container.innerHTML = '<span style="color: #ff6b6b;">❌ 加载失败: ' + e.message + '</span>';
    }
  }
  
  /**
   * 渲染动作预览
   */
  function renderAnimPreview() {
    const container = document.getElementById('mpl-anim-preview');
    if (!container) return;
    
    if (_animLibCache.length === 0) {
      container.innerHTML = `
        <div style="padding: 12px; text-align: center; color: var(--muted); background: rgba(0,0,0,0.2); border-radius: 6px;">
          <div style="font-size: 20px; margin-bottom: 6px;">📭</div>
          <div style="font-size: 11px;">该平台暂无动作</div>
          <div style="font-size: 10px; margin-top: 4px;">请先在「动作库」菜单中上传动作</div>
        </div>
      `;
      return;
    }
    
    // 按 anim_key 分组
    const grouped = {};
    _animLibCache.forEach(anim => {
      if (!grouped[anim.anim_key]) grouped[anim.anim_key] = [];
      grouped[anim.anim_key].push(anim);
    });
    
    container.innerHTML = `
      <div style="margin-bottom: 10px; padding: 8px; background: rgba(0, 255, 0, 0.05); border: 1px solid rgba(0, 255, 0, 0.15); border-radius: 6px;">
        <div style="font-size: 11px; color: var(--green); margin-bottom: 8px;">
          ✅ 该平台有 ${_animLibCache.length} 个动作：
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 6px;">
          ${Object.entries(grouped).map(([key, anims]) => `
            <div style="padding: 6px 8px; background: rgba(0, 255, 0, 0.05); border: 1px solid rgba(0, 255, 0, 0.15); border-radius: 4px; text-align: center;">
              <div style="font-size: 10px; color: var(--green); font-weight: 600;">
                ${ANIM_KEY_LABELS[key] || key}
              </div>
              <div style="font-size: 9px; color: var(--muted); margin-top: 2px;">
                ${anims.length} 个版本 ${anims[0].sound_url ? '🔊' : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div style="font-size: 10px; color: var(--muted); line-height: 1.5;">
        💡 点击「确认使用平台动作」将以上动作绑定到角色
      </div>
    `;
  }
  
  /**
   * 关联平台动作到模板
   * @param {string} templateId - 模板 ID
   * @returns {Promise<boolean>} 是否成功
   */
  async function attachPlatformToTemplate(templateId) {
    if (!templateId) {
      console.error('⚠️ 模板 ID 为空，无法关联动作');
      return false;
    }
    
    if (_animLibCache.length === 0) {
      console.log('⚠️ 当前平台没有动作，无需关联');
      return true;
    }
    
    const token = localStorage.getItem('adminToken');
    
    try {
      const r = await fetch(API_BASE + '/anim-library/attach-platform', {
        method: 'POST',
        headers: { 
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          template_id: templateId,
          platform: _currentPlatform
        })
      });
      
      const data = await r.json();
      
      if (data.success) {
        const platformName = PLATFORMS.find(p => p.key === _currentPlatform)?.name || _currentPlatform;
        showToast('✅ 已关联 ' + platformName + ' 的 ' + data.attached_count + ' 个动作');
        return true;
      } else {
        showToast('❌ 关联失败: ' + (data.error || '未知错误'), 'error');
        return false;
      }
    } catch (e) {
      console.error('关联动作库失败:', e);
      showToast('❌ 关联失败: ' + e.message, 'error');
      return false;
    }
  }
  
  /**
   * 获取当前模式
   */
  function getMode() {
    return _mode;
  }
  
  /**
   * 获取当前平台
   */
  function getCurrentPlatform() {
    return _currentPlatform;
  }
  
  /**
   * 获取当前平台的动作数量
   */
  function getAnimCount() {
    return _animLibCache.length;
  }
  
  /**
   * 取消平台动作选择
   */
  async function cancelPlatformChoice() {
    console.log('[cancelPlatformChoice] 取消平台动作选择');

    // 调用 reset 重置状态
    reset();

    // 清除状态显示
    const statusEl = document.getElementById('mpl-status');
    if (statusEl) {
      statusEl.style.display = 'none';
    }

    // 取消平台选择后，自动切换到自定义上传模式
    setMode('custom');

    showToast('已取消平台动作，已切换到自定义上传模式');

    // 持久化清除数据库中的平台绑定
    const tmplId = (typeof _currentTmplId !== 'undefined') ? _currentTmplId :
                   (window._currentTmplId || null);
    if (tmplId) {
      const token = localStorage.getItem('adminToken');
      try {
        const r = await fetch(API_BASE + '/anim-library/detach-platform', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ template_id: tmplId })
        });
        const data = await r.json();
        console.log('[cancelPlatformChoice] 数据库清除结果:', data);
      } catch (e) {
        console.error('[cancelPlatformChoice] 清除数据库绑定失败:', e);
      }
    }
  }

  /**
   * 重置状态
   */
  function reset() {
    _mode = 'none';
    _customAnimCount = 0;
    
    // 重置 UI
    const platformArea = document.getElementById('mpl-platform-area');
    const customArea = document.getElementById('mpl-custom-area');
    const modeBtnP = document.getElementById('mpl-mode-platform');
    const modeBtnC = document.getElementById('mpl-mode-custom');
    const statusEl = document.getElementById('mpl-status');
    const confirmBtn = document.getElementById('mpl-confirm-btn');
    const countEl = document.getElementById('mpl-custom-count');
    
    if (platformArea) platformArea.style.display = 'none';
    if (customArea) customArea.style.display = 'none';
    if (modeBtnP) { modeBtnP.classList.remove('btn-active'); modeBtnP.style.background = ''; }
    if (modeBtnC) { modeBtnC.classList.remove('btn-active'); modeBtnC.style.background = ''; }
    if (statusEl) { statusEl.style.display = 'none'; }
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
      confirmBtn.textContent = '✅ 确认使用平台动作';
    }
    if (countEl) countEl.textContent = '已上传：0 个动作';
  }

  /**
   * 从模板数据恢复动作库平台状态
   * @param {string} platform - 平台名称 (mixamo/hunyuan3d/makehuman/other)
   * @param {string} mode - 模式 ('platform' 或 'custom')
   */
  function _restoreState(platform, mode) {
    if (!platform || !mode) {
      console.log('[_restoreState] ⚠️ 无平台状态需要恢复 (platform=', platform, ', mode=', mode, ')');
      return;
    }

    // 检查 DOM 是否已初始化，如果未就绪则等待重试
    const platformSection = document.getElementById('mpl-platform-section');
    if (!platformSection) {
      console.log('[_restoreState] ⚠️ DOM 尚未初始化（mpl-platform-section 不存在），200ms 后重试...');
      setTimeout(() => _restoreState(platform, mode), 200);
      return;
    }

    console.log('[_restoreState] 开始恢复状态: platform=' + platform + ', mode=' + mode);
    
    _mode = mode;
    _currentPlatform = platform;
    
    // 更新模式按钮
    const modeBtnP = document.getElementById('mpl-mode-platform');
    const modeBtnC = document.getElementById('mpl-mode-custom');
    
    if (mode === 'platform') {
      // 显示平台区域
      const platformArea = document.getElementById('mpl-platform-area');
      const customArea = document.getElementById('mpl-custom-area');
      if (platformArea) platformArea.style.display = 'block';
      if (customArea) customArea.style.display = 'none';
      if (modeBtnP) { modeBtnP.classList.add('btn-active'); modeBtnP.style.background = 'var(--green)'; }
      if (modeBtnC) { modeBtnC.classList.remove('btn-active'); modeBtnC.style.background = ''; }
      
      // 选中对应平台按钮
      document.querySelectorAll('#mpl-platform-buttons .btn').forEach(b => {
        b.classList.remove('btn-active');
        if (b.dataset.platform === platform) {
          b.classList.add('btn-active');
        }
      });
      
      // 显示"已确认"状态
      const statusEl = document.getElementById('mpl-status');
      const confirmBtn = document.getElementById('mpl-confirm-btn');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(0, 255, 0, 0.1)';
        statusEl.style.border = '1px solid rgba(0, 255, 0, 0.3)';
        statusEl.style.color = 'var(--green)';
        statusEl.innerHTML = `
          ✅ 已选择 <strong>${PLATFORMS.find(p => p.key === platform)?.name || platform}</strong> 平台，共 ${_animLibCache.length} 个动作
          <button onclick="MultiPlatformAnimLib.cancelPlatformChoice()"
                  style="margin-left: 10px; padding: 2px 8px; font-size: 10px; background: rgba(255,60,60,0.15); color: #ff6b6b; border: 1px solid rgba(255,60,60,0.3); border-radius: 4px; cursor: pointer;">
            ✕ 取消选择
          </button>
        `;
      }
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
        confirmBtn.textContent = '✅ 已确认使用平台动作';
      }
      
      // 加载平台动作
      loadAnimLibByPlatform(platform);
      
      console.log('[_restoreState] ✅ 已恢复平台动作状态: ' + platform + ', mode=' + mode + ', anims=' + _animLibCache.length);
    } else {
      // 自定义模式
      switchToCustomMode();
    }
  }
  
  // 在 DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // 导出到全局
  return {
    init,
    setMode,
    switchToCustomMode,
    switchPlatform,
    refresh,
    confirmPlatformAnims,
    cancelPlatformChoice,  // 取消选择平台动作
    updateCustomAnimCount,
    loadAnimLibByPlatform,
    attachPlatformToTemplate,
    getMode,
    getCurrentPlatform,
    getAnimCount,
    getSaveStatus,
    canSave,
    reset,
    _restoreState  // 内部方法：恢复模板状态
  };
})();

// 导出到全局（兼容方式）
window.MultiPlatformAnimLib = MultiPlatformAnimLib;
