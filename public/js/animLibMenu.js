/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 动作库菜单模块
 * 功能：在左侧菜单中动态添加"动作库"菜单项
 */

(function() {
  'use strict';

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

  // i18n 辅助函数（兼容无 i18n 环境，翻译缺失时回退中文原文或 key）
  function _alT(key, fb) {
    try {
      if (window.i18n && typeof window.i18n.t === 'function') {
        const t = window.i18n.t(key);
        if (t && t !== key) return t;
      }
    } catch (e) { /* ignore */ }
    return (fb !== undefined && fb !== null) ? fb : key;
  }
  function _alTp(key, params, fb) {
    try {
      if (window.i18n && typeof window.i18n.tp === 'function') {
        const t = window.i18n.tp(key, params);
        if (t && t !== key) return t;
      }
    } catch (e) { /* ignore */ }
    let text = (fb !== undefined && fb !== null) ? fb : key;
    if (params) {
      Object.keys(params).forEach(p => { text = String(text).split('{{' + p + '}}').join(params[p]); });
    }
    return text;
  }
  // 动作 key → i18n key（复用 adminCharacters.mplAnim* 系列）
  const ANIM_KEY_TRANSLATIONS = {
    idle: 'adminCharacters.mplAnimIdle',
    walk: 'adminCharacters.mplAnimWalk',
    run: 'adminCharacters.mplAnimRun',
    jump: 'adminCharacters.mplAnimJump',
    turn_left: 'adminCharacters.mplAnimTurnLeft',
    turn_right: 'adminCharacters.mplAnimTurnRight',
    attack1: 'adminCharacters.mplAnimAttack1',
    attack_stab: 'adminCharacters.mplAnimAttackStab',
    attack_slash: 'adminCharacters.mplAnimAttackSlash',
    attack_swing: 'adminCharacters.mplAnimAttackSwing',
    attack_uppercut: 'adminCharacters.mplAnimAttackUppercut',
    draw_sword: 'adminCharacters.mplAnimDrawSword',
    sheath: 'adminCharacters.mplAnimSheath',
    hit: 'adminCharacters.mplAnimHit',
    death: 'adminCharacters.mplAnimDeath',
    combo_2: 'adminCharacters.mplAnimCombo2',
    combo_3: 'adminCharacters.mplAnimCombo3'
  };
  // 渲染动作标签：i18n 翻译 → 回退 ANIM_KEY_LABELS 原文 → key
  function animLabel(key) {
    const i18nKey = ANIM_KEY_TRANSLATIONS[key];
    if (i18nKey) return _alT(i18nKey, ANIM_KEY_LABELS[key] || key);
    return ANIM_KEY_LABELS[key] || key;
  }

  /**
   * 初始化：现在使用 admin.html 中静态添加的菜单项
   * 此函数保留但不再动态插入菜单
   */
  function initAnimLibMenu() {
    // 动作库菜单已在 admin.html 中静态添加，此处仅初始化页面状态
    console.log('✅ 动作库模块已初始化（使用静态菜单）');
  }

  /**
   * 加载动作库页面
   */
  async function loadPage() {
    // 渲染到标准页面容器
    const container = document.getElementById('anim-library-content');
    if (container) {
      renderPage(container);
    } else {
      console.error('未找到动作库内容容器 #anim-library-content');
    }
  }

  /**
   * 渲染动作库页面
   */
  function renderPage(container) {
    // 动态渲染后由 _alT 直接输出翻译，移除静态 data-i18n 防止 applyAdminTranslations 清空内容
    if (container && container.hasAttribute('data-i18n')) container.removeAttribute('data-i18n');
    // 设置页面标题
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = _alT('adminAnimLib.pageTitle');

    const pageSubtitle = document.getElementById('pageSubtitle');
    if (pageSubtitle) pageSubtitle.textContent = _alT('adminAnimLib.pageSubtitle');

    // 渲染页面内容
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${_alT('adminAnimLib.cardTitle')}</div>
          <div class="btn-group">
            <button class="btn" onclick="AnimLibMenu.showUploadModal()">${_alT('adminAnimLib.uploadBtn')}</button>
            <button class="btn btn-secondary" onclick="AnimLibMenu.loadPage()">${_alT('adminAnimLib.refreshBtn')}</button>
          </div>
        </div>
        
        <!-- 平台筛选 -->
        <div style="margin-bottom: 16px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px;">
          <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">${_alT('adminAnimLib.selectPlatform')}</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;" id="anim-lib-platform-filters">
            <button class="btn btn-sm btn-active" onclick="AnimLibMenu.filterByPlatform('mixamo', this)" data-platform="mixamo">${_alT('adminAnimLib.platMixamo')}</button>
            <button class="btn btn-sm" onclick="AnimLibMenu.filterByPlatform('hunyuan3d', this)" data-platform="hunyuan3d">${_alT('adminAnimLib.platHunyuan3d')}</button>
            <button class="btn btn-sm" onclick="AnimLibMenu.filterByPlatform('makehuman', this)" data-platform="makehuman">${_alT('adminAnimLib.platMakehuman')}</button>
            <button class="btn btn-sm" onclick="AnimLibMenu.filterByPlatform('other', this)" data-platform="other">${_alT('adminAnimLib.platOther')}</button>
            <button class="btn btn-sm" onclick="AnimLibMenu.filterByPlatform('all', this)" data-platform="all">${_alT('adminAnimLib.platAll')}</button>
          </div>
        </div>
        
        <!-- 动作列表 -->
        <div id="anim-library-list" class="loading">${_alT('adminAnimLib.loading')}</div>
      </div>
    `;

    // 加载动作列表
    fetchAnimLibraryList('mixamo');
  }

  /**
   * 按平台筛选动作
   */
  let currentPlatformFilter = 'mixamo';
  
  function filterByPlatform(platform, btn) {
    currentPlatformFilter = platform;
    
    // 更新按钮样式
    document.querySelectorAll('#anim-lib-platform-filters .btn').forEach(b => {
      b.classList.remove('btn-active');
    });
    btn.classList.add('btn-active');
    
    // 加载该平台的动作
    fetchAnimLibraryList(platform === 'all' ? null : platform);
  }

  /**
   * 获取动作库列表
   */
  async function fetchAnimLibraryList(platform) {
    try {
      let url = '/api/character-templates/anim-library';
      if (platform) {
        url += '?platform=' + platform;
      }
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        }
      });
      
      if (!response.ok) {
        throw new Error(_alT('adminAnimLib.fetchError'));
      }
      
      const data = await response.json();
      renderAnimLibraryList(data.animations || []);
    } catch (error) {
      console.error('加载动作库失败:', error);
      const container = document.getElementById('anim-library-list');
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; padding: 40px; color: var(--red);">
            <div style="font-size: 24px; margin-bottom: 8px;">❌</div>
            <div>${_alTp('adminAnimLib.loadFailed', { msg: error.message })}</div>
            <button class="btn btn-sm" style="margin-top: 12px;" onclick="AnimLibMenu.loadPage()">${_alT('adminAnimLib.retry')}</button>
          </div>
        `;
      }
    }
  }

  /**
   * 渲染动作库列表
   */
  function renderAnimLibraryList(animations) {
    const container = document.getElementById('anim-library-list');
    if (!container) return;

    if (animations.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--muted);">
          <div style="font-size: 48px; margin-bottom: 12px;">📭</div>
          <div>${_alT('adminAnimLib.empty')}</div>
          <div style="font-size: 11px; margin-top: 8px;">${_alT('adminAnimLib.emptyHint')}</div>
        </div>
      `;
      return;
    }

    // 按 anim_key 分组
    const grouped = {};
    animations.forEach(anim => {
      if (!grouped[anim.anim_key]) {
        grouped[anim.anim_key] = [];
      }
      grouped[anim.anim_key].push(anim);
    });

    // 按平台分组显示
    const byPlatform = {};
    animations.forEach(anim => {
      const p = anim.platform || 'other';
      if (!byPlatform[p]) {
        byPlatform[p] = {};
      }
      if (!byPlatform[p][anim.anim_key]) {
        byPlatform[p][anim.anim_key] = [];
      }
      byPlatform[p][anim.anim_key].push(anim);
    });

    const platformNames = {
      mixamo: _alT('adminAnimLib.platMixamo'),
      hunyuan3d: _alT('adminAnimLib.platHunyuan3d'),
      makehuman: _alT('adminAnimLib.platMakehuman'),
      other: _alT('adminAnimLib.platOther')
    };

    let html = '<div style="display: grid; gap: 20px;">';
    
    Object.entries(byPlatform).forEach(([platform, group]) => {
      html += `
        <div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
          <div style="padding: 10px 14px; background: rgba(0,255,0,0.05); border-bottom: 1px solid var(--border); font-weight: 700; font-size: 12px; color: var(--green);">
            ${platformNames[platform] || platform} (${_alTp('adminAnimLib.animCount', { count: Object.keys(group).length })})
          </div>
          <div style="padding: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;">
      `;
      
      Object.entries(group).forEach(([key, anims]) => {
        const anim = anims[0]; // 显示第一个
        
        // 判断是否有音效
        const hasSound = anim.sound_url;
        const soundStatus = hasSound 
          ? `<span style="color: var(--green);" title="${anim.sound_name || _alT('adminAnimLib.soundConfigured')}">🔊</span>` 
          : `<span style="color: #ffb400; font-size: 9px;">${_alT('adminAnimLib.noSound')}</span>`;
        
        html += `
          <div style="padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 6px; position: relative;">
            <div style="font-size: 10px; color: var(--muted); margin-bottom: 4px;">${key}</div>
            <div style="font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 4px;">
              ${anim.name || animLabel(key)}
            </div>
            <div style="font-size: 10px; color: var(--muted); display: flex; align-items: center; gap: 6px;">
              <span>${_alTp('adminAnimLib.versionCount', { count: anims.length })}</span>
              ${soundStatus}
            </div>
            <div style="position: absolute; top: 8px; right: 8px; display: flex; gap: 4px;">
              <button class="btn btn-sm" style="padding: 2px 6px; font-size: 9px;" onclick="AnimLibMenu.showEditModal('${anim.id}')">${_alT('adminAnimLib.edit')}</button>
              <button class="btn btn-sm" style="padding: 2px 6px; font-size: 9px; background: rgba(255,60,60,0.15); color: #ff6b6b;" onclick="AnimLibMenu.deleteAnim('${anim.id}', '${(anim.name || key).replace(/'/g, "\\'")}')">${_alT('adminAnimLib.delete')}</button>
            </div>
          </div>
        `;
      });
      
      html += '</div></div>';
    });
    
    html += '</div>';
    container.innerHTML = html;
  }

  /**
   * 显示上传模态框
   */
  function showUploadModal() {
    // 检查是否已存在模态框
    const existingModal = document.getElementById('anim-upload-modal');
    if (existingModal) {
      existingModal.remove();
    }

    const platformOptions = `
      <option value="mixamo">${_alT('adminAnimLib.platMixamo')}</option>
      <option value="hunyuan3d">${_alT('adminAnimLib.platHunyuan3d')}</option>
      <option value="makehuman">${_alT('adminAnimLib.platMakehuman')}</option>
      <option value="other">${_alT('adminAnimLib.platOther')}</option>
    `;

    const animKeyOptions = Object.entries(ANIM_KEY_LABELS).map(([key]) => 
      `<option value="${key}">${animLabel(key)}</option>`
    ).join('');

    // 创建模态框
    const modal = document.createElement('div');
    modal.id = 'anim-upload-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-box" style="max-width: 500px;">
        <div class="modal-header">
          <h2>${_alT('adminAnimLib.uploadModalTitle')}</h2>
          <button class="close-btn" onclick="AnimLibMenu.closeUploadModal()">✕</button>
        </div>
        <div style="padding: 20px;">
          <div class="form-group">
            <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">${_alT('adminAnimLib.upPlatform')}</label>
            <select id="anim-upload-platform" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
              ${platformOptions}
            </select>
          </div>
          <div class="form-group">
            <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">${_alT('adminAnimLib.upType')}</label>
            <select id="anim-upload-key" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
              <option value="">${_alT('adminAnimLib.upTypePlaceholder')}</option>
              ${animKeyOptions}
            </select>
          </div>
          <div class="form-group">
            <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">${_alT('adminAnimLib.upName')}</label>
            <input type="text" id="anim-upload-name" placeholder="${_alT('adminAnimLib.upNamePlaceholder')}" 
                   style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
          </div>
          <div class="form-group">
            <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">${_alT('adminAnimLib.upFile')}</label>
            <input type="file" id="anim-upload-file" accept=".glb,.gltf,.fbx" 
                   style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
            <div style="font-size: 10px; color: var(--muted); margin-top: 4px; line-height: 1.5;">
              ${_alT('adminAnimLib.withoutSkinTip1')}<br>
              ${_alT('adminAnimLib.withoutSkinTip2')}
            </div>
          </div>
          <div class="form-group">
            <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">${_alT('adminAnimLib.upSound')}</label>
            <input type="file" id="anim-upload-sound" accept=".mp3,.ogg,.wav" 
                   style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
          </div>
          <div id="anim-upload-status" style="display: none; margin-top: 12px; padding: 10px; border-radius: 6px; font-size: 11px;"></div>
          <div class="btn-group" style="margin-top: 16px;">
            <button class="btn btn-secondary" onclick="AnimLibMenu.closeUploadModal()">${_alT('adminAnimLib.cancel')}</button>
            <button class="btn" id="anim-upload-btn" onclick="AnimLibMenu.uploadAnim()">${_alT('adminAnimLib.uploadToLib')}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  /**
   * 关闭上传模态框
   */
  function closeUploadModal() {
    const modal = document.getElementById('anim-upload-modal');
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => modal.remove(), 300);
    }
  }

  /**
   * 上传动作
   */
  async function uploadAnim() {
    const platform = document.getElementById('anim-upload-platform')?.value;
    const animKey = document.getElementById('anim-upload-key')?.value;
    const animName = document.getElementById('anim-upload-name')?.value.trim();
    const animFile = document.getElementById('anim-upload-file')?.files[0];
    const soundFile = document.getElementById('anim-upload-sound')?.files[0];
    const statusEl = document.getElementById('anim-upload-status');
    const btn = document.getElementById('anim-upload-btn');

    if (!animKey) {
      showStatus(_alT('adminAnimLib.selectTypeFirst'), 'error');
      return;
    }

    if (!animFile) {
      showStatus(_alT('adminAnimLib.selectFileFirst'), 'error');
      return;
    }

    // 显示上传中状态
    showStatus(_alT('adminAnimLib.uploading'), 'loading');
    btn.disabled = true;

    const formData = new FormData();
    formData.append('anim_key', animKey);
    formData.append('name', animName || '');
    formData.append('platform', platform || 'mixamo');
    formData.append('glb_file', animFile);
    if (soundFile) {
      formData.append('sound_file', soundFile);
    }

    try {
      const response = await fetch('/api/character-templates/anim-library', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        showStatus('✅ ' + (data.message || _alT('adminAnimLib.uploadSuccess')), 'success');
        
        // 延迟关闭并刷新
        setTimeout(() => {
          closeUploadModal();
          loadPage();
        }, 1500);
      } else {
        showStatus('❌ ' + (data.error || _alT('adminAnimLib.uploadFailed')), 'error');
        btn.disabled = false;
      }
    } catch (error) {
      console.error('上传失败:', error);
      showStatus('❌ ' + error.message, 'error');
      btn.disabled = false;
    }
  }

  /**
   * 显示状态消息
   */
  function showStatus(message, type) {
    const statusEl = document.getElementById('anim-upload-status');
    if (!statusEl) return;
    
    statusEl.style.display = 'block';
    statusEl.textContent = message;
    
    if (type === 'success') {
      statusEl.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
      statusEl.style.color = 'var(--green)';
    } else if (type === 'error') {
      statusEl.style.backgroundColor = 'rgba(255, 60, 60, 0.1)';
      statusEl.style.color = '#ff6b6b';
    } else {
      statusEl.style.backgroundColor = 'rgba(0, 255, 0, 0.05)';
      statusEl.style.color = 'var(--muted)';
    }
  }

  /**
   * 删除动作
   */
  async function deleteAnim(id, name) {
    if (!confirm(_alTp('adminAnimLib.deleteConfirm', { name: name }))) {
      return;
    }

    try {
      const response = await fetch(`/api/character-templates/anim-library/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        }
      });

      const data = await response.json();
      
      if (data.success) {
        showToast(_alT('adminAnimLib.deleted'));
        loadPage();
      } else {
        showToast('❌ ' + (data.error || _alT('adminAnimLib.deleteFailed')), 'error');
      }
    } catch (error) {
      console.error('删除失败:', error);
      showToast('❌ ' + _alT('adminAnimLib.deleteFailed'), 'error');
    }
  }

  /**
   * 显示编辑模态框
   */
  async function showEditModal(id) {
    try {
      // 获取动作详情
      const response = await fetch(`/api/character-templates/anim-library/${id}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        }
      });
      
      if (!response.ok) {
        throw new Error(_alT('adminAnimLib.fetchDetailError'));
      }
      
      const data = await response.json();
      const anim = data.animation;
      
      // 检查是否已存在模态框
      const existingModal = document.getElementById('anim-edit-modal');
      if (existingModal) {
        existingModal.remove();
      }

      const platformOptions = `
        <option value="mixamo" ${anim.platform === 'mixamo' ? 'selected' : ''}>${_alT('adminAnimLib.platMixamo')}</option>
        <option value="hunyuan3d" ${anim.platform === 'hunyuan3d' ? 'selected' : ''}>${_alT('adminAnimLib.platHunyuan3d')}</option>
        <option value="makehuman" ${anim.platform === 'makehuman' ? 'selected' : ''}>${_alT('adminAnimLib.platMakehuman')}</option>
        <option value="other" ${anim.platform === 'other' ? 'selected' : ''}>${_alT('adminAnimLib.platOther')}</option>
      `;

      const animKeyOptions = Object.entries(ANIM_KEY_LABELS).map(([key]) => 
        `<option value="${key}" ${anim.anim_key === key ? 'selected' : ''}>${animLabel(key)}</option>`
      ).join('');

      // 创建模态框
      const modal = document.createElement('div');
      modal.id = 'anim-edit-modal';
      modal.className = 'modal active';
      modal.innerHTML = `
        <div class="modal-box" style="max-width: 520px;">
          <div class="modal-header">
            <h2>${_alT('adminAnimLib.editModalTitle')}</h2>
            <button class="close-btn" onclick="AnimLibMenu.closeEditModal()">✕</button>
          </div>
          <div style="padding: 20px;">
            <!-- 动作基本信息 -->
            <div style="background: rgba(0,255,0,0.05); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
              <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">${_alT('adminAnimLib.currentInfo')}</div>
              <div style="font-size: 12px; color: var(--text);">
                ${_alT('adminAnimLib.animId')}<code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">${anim.id}</code>
              </div>
            </div>
            
            <div class="form-group">
              <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">${_alT('adminAnimLib.animName')}</label>
              <input type="text" id="anim-edit-name" value="${anim.name || ''}" placeholder="${_alT('adminAnimLib.animNamePlaceholder')}" 
                     style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">${_alT('adminAnimLib.animPlatform')}</label>
                <select id="anim-edit-platform" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
                  ${platformOptions}
                </select>
              </div>
              <div class="form-group">
                <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">${_alT('adminAnimLib.animType')}</label>
                <select id="anim-edit-key" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
                  ${animKeyOptions}
                </select>
              </div>
            </div>
            
            <!-- 动作文件 -->
            <div class="form-group">
              <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">${_alT('adminAnimLib.replaceFile')}</label>
              <div style="margin-bottom: 6px; font-size: 11px; color: var(--green);">
                ${_alT('adminAnimLib.currentFile')}<code style="background: rgba(0,255,0,0.1); padding: 2px 6px; border-radius: 4px;">${getFileNameFromUrl(anim.glb_url)}</code>
              </div>
              <input type="file" id="anim-edit-file" accept=".glb,.gltf,.fbx" 
                     style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
              <div style="font-size: 10px; color: var(--muted); margin-top: 4px;">
                ${_alT('adminAnimLib.keepFileTip')}
              </div>
            </div>
            
            <!-- 音效文件 -->
            <div class="form-group">
              <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">${_alT('adminAnimLib.soundFile')}</label>
              ${anim.sound_url ? `
                <div style="background: rgba(0,255,0,0.08); border: 1px solid rgba(0,255,0,0.2); border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="font-size: 16px;">🔊</span>
                      <div>
                        <div style="font-size: 11px; color: var(--green); font-weight: 600;">${_alT('adminAnimLib.soundConfigured')}</div>
                        <div style="font-size: 10px; color: var(--muted); margin-top: 2px;" title="${anim.sound_name || anim.sound_url}">
                          ${anim.sound_name || getFileNameFromUrl(anim.sound_url)}
                        </div>
                      </div>
                    </div>
                    <button class="btn btn-sm" style="padding: 4px 10px; font-size: 10px; background: rgba(255,60,60,0.15); color: #ff6b6b;" onclick="AnimLibMenu.deleteSound('${anim.id}')">
                      ${_alT('adminAnimLib.deleteSoundBtn')}
                    </button>
                  </div>
                </div>
              ` : `
                <div style="background: rgba(255,180,0,0.08); border: 1px solid rgba(255,180,0,0.2); border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 16px;">⚠️</span>
                    <div>
                      <div style="font-size: 11px; color: #ffb400; font-weight: 600;">${_alT('adminAnimLib.soundMissing')}</div>
                      <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">${_alT('adminAnimLib.soundUploadTip')}</div>
                    </div>
                  </div>
                </div>
              `}
              <div class="form-group">
                <label style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: block;">${anim.sound_url ? _alT('adminAnimLib.soundReplace') : _alT('adminAnimLib.soundUploadLabel')}</label>
                <input type="file" id="anim-edit-sound" accept=".mp3,.ogg,.wav" 
                       style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
                <div style="font-size: 10px; color: var(--muted); margin-top: 4px;">
                  ${_alT('adminAnimLib.soundFormats')}
                </div>
              </div>
            </div>
            
            <div id="anim-edit-status" style="display: none; margin-top: 12px; padding: 10px; border-radius: 6px; font-size: 11px;"></div>
            <div class="btn-group" style="margin-top: 16px;">
              <button class="btn btn-secondary" onclick="AnimLibMenu.closeEditModal()">${_alT('adminAnimLib.cancel')}</button>
              <button class="btn" id="anim-edit-btn" onclick="AnimLibMenu.editAnim('${anim.id}')">${_alT('adminAnimLib.saveBtn')}</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
    } catch (error) {
      console.error('加载编辑模态框失败:', error);
      showToast('❌ ' + _alTp('adminAnimLib.loadFailed', { msg: error.message }), 'error');
    }
  }

  /**
   * 从 URL 获取文件名
   */
  function getFileNameFromUrl(url) {
    if (!url) return _alT('adminAnimLib.unknownFile');
    const parts = url.split('/');
    return parts[parts.length - 1];
  }

  /**
   * 关闭编辑模态框
   */
  function closeEditModal() {
    const modal = document.getElementById('anim-edit-modal');
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => modal.remove(), 300);
    }
  }

  /**
   * 编辑动作
   */
  async function editAnim(id) {
    const name = document.getElementById('anim-edit-name')?.value.trim();
    const platform = document.getElementById('anim-edit-platform')?.value;
    const animKey = document.getElementById('anim-edit-key')?.value;
    const glbFile = document.getElementById('anim-edit-file')?.files[0];
    const soundFile = document.getElementById('anim-edit-sound')?.files[0];
    const statusEl = document.getElementById('anim-edit-status');
    const btn = document.getElementById('anim-edit-btn');

    // 显示状态
    const showStatus = (message, type) => {
      if (!statusEl) return;
      statusEl.style.display = 'block';
      statusEl.textContent = message;
      if (type === 'success') {
        statusEl.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
        statusEl.style.color = 'var(--green)';
      } else if (type === 'error') {
        statusEl.style.backgroundColor = 'rgba(255, 60, 60, 0.1)';
        statusEl.style.color = '#ff6b6b';
      } else {
        statusEl.style.backgroundColor = 'rgba(0, 255, 0, 0.05)';
        statusEl.style.color = 'var(--muted)';
      }
    };

    showStatus(_alT('adminAnimLib.saving'), 'loading');
    btn.disabled = true;

    const formData = new FormData();
    if (name) formData.append('name', name);
    formData.append('platform', platform || 'mixamo');
    formData.append('anim_key', animKey || 'idle');
    if (glbFile) formData.append('glb_file', glbFile);
    if (soundFile) formData.append('sound_file', soundFile);

    try {
      const response = await fetch(`/api/character-templates/anim-library/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        showStatus(_alT('adminAnimLib.saveSuccess'), 'success');
        
        setTimeout(() => {
          closeEditModal();
          loadPage();
        }, 1500);
      } else {
        showStatus('❌ ' + (data.error || _alT('adminAnimLib.saveFailed')), 'error');
        btn.disabled = false;
      }
    } catch (error) {
      console.error('保存失败:', error);
      showStatus('❌ ' + error.message, 'error');
      btn.disabled = false;
    }
  }

  /**
   * 删除音效
   */
  async function deleteSound(id) {
    if (!confirm(_alT('adminAnimLib.soundDeleteConfirm'))) {
      return;
    }

    try {
      const response = await fetch(`/api/character-templates/anim-library/${id}/sound`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        }
      });

      const data = await response.json();
      
      if (data.success) {
        showToast(_alT('adminAnimLib.soundDeleted'));
        // 刷新编辑模态框
        closeEditModal();
        showEditModal(id);
      } else {
        showToast('❌ ' + (data.error || _alT('adminAnimLib.deleteFailed')), 'error');
      }
    } catch (error) {
      console.error('删除音效失败:', error);
      showToast('❌ ' + _alT('adminAnimLib.deleteFailed'), 'error');
    }
  }

  // 导出到全局
  window.AnimLibMenu = {
    init: initAnimLibMenu,
    loadPage,
    filterByPlatform,
    showUploadModal,
    closeUploadModal,
    uploadAnim,
    deleteAnim,
    showEditModal,
    closeEditModal,
    editAnim,
    deleteSound
  };

  // 自动初始化
  initAnimLibMenu();

})();
