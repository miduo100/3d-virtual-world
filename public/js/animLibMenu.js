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
    // 设置页面标题
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = '动作库管理';

    const pageSubtitle = document.getElementById('pageSubtitle');
    if (pageSubtitle) pageSubtitle.textContent = '管理多平台动作库（Mixamo、混元3D等）';

    // 渲染页面内容
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">🎬 动作库</div>
          <div class="btn-group">
            <button class="btn" onclick="AnimLibMenu.showUploadModal()">➕ 上传动作</button>
            <button class="btn btn-secondary" onclick="AnimLibMenu.loadPage()">🔄 刷新</button>
          </div>
        </div>
        
        <!-- 平台筛选 -->
        <div style="margin-bottom: 16px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px;">
          <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">🎯 选择平台：</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;" id="anim-lib-platform-filters">
            <button class="btn btn-sm btn-active" onclick="AnimLibMenu.filterByPlatform('mixamo', this)" data-platform="mixamo">🎬 Mixamo</button>
            <button class="btn btn-sm" onclick="AnimLibMenu.filterByPlatform('hunyuan3d', this)" data-platform="hunyuan3d">🤖 混元3D</button>
            <button class="btn btn-sm" onclick="AnimLibMenu.filterByPlatform('makehuman', this)" data-platform="makehuman">🎭 MakeHuman</button>
            <button class="btn btn-sm" onclick="AnimLibMenu.filterByPlatform('other', this)" data-platform="other">➕ 其他</button>
            <button class="btn btn-sm" onclick="AnimLibMenu.filterByPlatform('all', this)" data-platform="all">📋 全部</button>
          </div>
        </div>
        
        <!-- 动作列表 -->
        <div id="anim-library-list" class="loading">加载中...</div>
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
        throw new Error('获取数据失败');
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
            <div>加载失败：${error.message}</div>
            <button class="btn btn-sm" style="margin-top: 12px;" onclick="AnimLibMenu.loadPage()">重试</button>
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
          <div>该平台暂无动作</div>
          <div style="font-size: 11px; margin-top: 8px;">请点击上方"上传动作"添加</div>
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
      mixamo: '🎬 Mixamo',
      hunyuan3d: '🤖 腾讯混元3D',
      makehuman: '🎭 MakeHuman',
      other: '➕ 其他平台'
    };

    let html = '<div style="display: grid; gap: 20px;">';
    
    Object.entries(byPlatform).forEach(([platform, group]) => {
      html += `
        <div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
          <div style="padding: 10px 14px; background: rgba(0,255,0,0.05); border-bottom: 1px solid var(--border); font-weight: 700; font-size: 12px; color: var(--green);">
            ${platformNames[platform] || platform} (${Object.keys(group).length} 种动作)
          </div>
          <div style="padding: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;">
      `;
      
      Object.entries(group).forEach(([key, anims]) => {
        const anim = anims[0]; // 显示第一个
        
        // 判断是否有音效
        const hasSound = anim.sound_url;
        const soundStatus = hasSound 
          ? `<span style="color: var(--green);" title="${anim.sound_name || '已配置音效'}">🔊</span>` 
          : `<span style="color: #ffb400; font-size: 9px;">⚠️无音效</span>`;
        
        html += `
          <div style="padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 6px; position: relative;">
            <div style="font-size: 10px; color: var(--muted); margin-bottom: 4px;">${key}</div>
            <div style="font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 4px;">
              ${anim.name || ANIM_KEY_LABELS[key] || key}
            </div>
            <div style="font-size: 10px; color: var(--muted); display: flex; align-items: center; gap: 6px;">
              <span>${anims.length} 个版本</span>
              ${soundStatus}
            </div>
            <div style="position: absolute; top: 8px; right: 8px; display: flex; gap: 4px;">
              <button class="btn btn-sm" style="padding: 2px 6px; font-size: 9px;" onclick="AnimLibMenu.showEditModal('${anim.id}')">编辑</button>
              <button class="btn btn-sm" style="padding: 2px 6px; font-size: 9px; background: rgba(255,60,60,0.15); color: #ff6b6b;" onclick="AnimLibMenu.deleteAnim('${anim.id}', '${(anim.name || key).replace(/'/g, "\\'")}')">删除</button>
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
      <option value="mixamo">🎬 Mixamo</option>
      <option value="hunyuan3d">🤖 腾讯混元3D</option>
      <option value="makehuman">🎭 MakeHuman</option>
      <option value="other">➕ 其他平台</option>
    `;

    const animKeyOptions = Object.entries(ANIM_KEY_LABELS).map(([key, label]) => 
      `<option value="${key}">${label}</option>`
    ).join('');

    // 创建模态框
    const modal = document.createElement('div');
    modal.id = 'anim-upload-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-box" style="max-width: 500px;">
        <div class="modal-header">
          <h2>📤 上传动作到动作库</h2>
          <button class="close-btn" onclick="AnimLibMenu.closeUploadModal()">✕</button>
        </div>
        <div style="padding: 20px;">
          <div class="form-group">
            <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">动作平台 *</label>
            <select id="anim-upload-platform" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
              ${platformOptions}
            </select>
          </div>
          <div class="form-group">
            <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">动作类型 *</label>
            <select id="anim-upload-key" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
              <option value="">-- 选择动作类型 --</option>
              ${animKeyOptions}
            </select>
          </div>
          <div class="form-group">
            <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">动作名称（可选）</label>
            <input type="text" id="anim-upload-name" placeholder="留空则使用默认名称" 
                   style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
          </div>
          <div class="form-group">
            <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">动作文件（GLB） *</label>
            <input type="file" id="anim-upload-file" accept=".glb,.gltf,.fbx" 
                   style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
            <div style="font-size: 10px; color: var(--muted); margin-top: 4px; line-height: 1.5;">
              💡 推荐上传 Without Skin 的 FBX/GLB 文件（只包含骨骼动画，不含模型）<br>
              📌 Mixamo 导出时选择 "Without Skin" 可大幅减小文件大小
            </div>
          </div>
          <div class="form-group">
            <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">动作音效（可选）</label>
            <input type="file" id="anim-upload-sound" accept=".mp3,.ogg,.wav" 
                   style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
          </div>
          <div id="anim-upload-status" style="display: none; margin-top: 12px; padding: 10px; border-radius: 6px; font-size: 11px;"></div>
          <div class="btn-group" style="margin-top: 16px;">
            <button class="btn btn-secondary" onclick="AnimLibMenu.closeUploadModal()">取消</button>
            <button class="btn" id="anim-upload-btn" onclick="AnimLibMenu.uploadAnim()">📤 上传到动作库</button>
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
      showStatus('❌ 请选择动作类型', 'error');
      return;
    }

    if (!animFile) {
      showStatus('❌ 请选择动作文件', 'error');
      return;
    }

    // 显示上传中状态
    showStatus('⏳ 上传中...', 'loading');
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
        showStatus(`✅ ${data.message || '上传成功'}`, 'success');
        
        // 延迟关闭并刷新
        setTimeout(() => {
          closeUploadModal();
          loadPage();
        }, 1500);
      } else {
        showStatus('❌ ' + (data.error || '上传失败'), 'error');
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
    if (!confirm(`确定删除动作「${name}」？\n\n已绑定该动作的角色模板将丢失此动作配置。`)) {
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
        showToast('✅ 删除成功');
        loadPage();
      } else {
        showToast('❌ ' + (data.error || '删除失败'), 'error');
      }
    } catch (error) {
      console.error('删除失败:', error);
      showToast('❌ 删除失败', 'error');
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
        throw new Error('获取动作详情失败');
      }
      
      const data = await response.json();
      const anim = data.animation;
      
      // 检查是否已存在模态框
      const existingModal = document.getElementById('anim-edit-modal');
      if (existingModal) {
        existingModal.remove();
      }

      const platformOptions = `
        <option value="mixamo" ${anim.platform === 'mixamo' ? 'selected' : ''}>🎬 Mixamo</option>
        <option value="hunyuan3d" ${anim.platform === 'hunyuan3d' ? 'selected' : ''}>🤖 腾讯混元3D</option>
        <option value="makehuman" ${anim.platform === 'makehuman' ? 'selected' : ''}>🎭 MakeHuman</option>
        <option value="other" ${anim.platform === 'other' ? 'selected' : ''}>➕ 其他平台</option>
      `;

      const animKeyOptions = Object.entries(ANIM_KEY_LABELS).map(([key, label]) => 
        `<option value="${key}" ${anim.anim_key === key ? 'selected' : ''}>${label}</option>`
      ).join('');

      // 创建模态框
      const modal = document.createElement('div');
      modal.id = 'anim-edit-modal';
      modal.className = 'modal active';
      modal.innerHTML = `
        <div class="modal-box" style="max-width: 520px;">
          <div class="modal-header">
            <h2>✏️ 编辑动作</h2>
            <button class="close-btn" onclick="AnimLibMenu.closeEditModal()">✕</button>
          </div>
          <div style="padding: 20px;">
            <!-- 动作基本信息 -->
            <div style="background: rgba(0,255,0,0.05); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
              <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">📋 当前信息</div>
              <div style="font-size: 12px; color: var(--text);">
                动作ID: <code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">${anim.id}</code>
              </div>
            </div>
            
            <div class="form-group">
              <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">动作名称</label>
              <input type="text" id="anim-edit-name" value="${anim.name || ''}" placeholder="输入动作名称" 
                     style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">动作平台</label>
                <select id="anim-edit-platform" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
                  ${platformOptions}
                </select>
              </div>
              <div class="form-group">
                <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">动作类型</label>
                <select id="anim-edit-key" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
                  ${animKeyOptions}
                </select>
              </div>
            </div>
            
            <!-- 动作文件 -->
            <div class="form-group">
              <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">🔄 更换动作文件（可选）</label>
              <div style="margin-bottom: 6px; font-size: 11px; color: var(--green);">
                📄 当前文件: <code style="background: rgba(0,255,0,0.1); padding: 2px 6px; border-radius: 4px;">${getFileNameFromUrl(anim.glb_url)}</code>
              </div>
              <input type="file" id="anim-edit-file" accept=".glb,.gltf,.fbx" 
                     style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
              <div style="font-size: 10px; color: var(--muted); margin-top: 4px;">
                💡 如不选择新文件，将保留当前动作文件
              </div>
            </div>
            
            <!-- 音效文件 -->
            <div class="form-group">
              <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">🔊 音效文件</label>
              ${anim.sound_url ? `
                <div style="background: rgba(0,255,0,0.08); border: 1px solid rgba(0,255,0,0.2); border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="font-size: 16px;">🔊</span>
                      <div>
                        <div style="font-size: 11px; color: var(--green); font-weight: 600;">已配置音效</div>
                        <div style="font-size: 10px; color: var(--muted); margin-top: 2px;" title="${anim.sound_name || anim.sound_url}">
                          ${anim.sound_name || getFileNameFromUrl(anim.sound_url)}
                        </div>
                      </div>
                    </div>
                    <button class="btn btn-sm" style="padding: 4px 10px; font-size: 10px; background: rgba(255,60,60,0.15); color: #ff6b6b;" onclick="AnimLibMenu.deleteSound('${anim.id}')">
                      🗑️ 删除音效
                    </button>
                  </div>
                </div>
              ` : `
                <div style="background: rgba(255,180,0,0.08); border: 1px solid rgba(255,180,0,0.2); border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 16px;">⚠️</span>
                    <div>
                      <div style="font-size: 11px; color: #ffb400; font-weight: 600;">暂无音效</div>
                      <div style="font-size: 10px; color: var(--muted); margin-top: 2px;">请上传 MP3/OGG/WAV 文件</div>
                    </div>
                  </div>
                </div>
              `}
              <div class="form-group">
                <label style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: block;">${anim.sound_url ? '🔄 更换音效（可选）' : '➕ 上传音效文件'}</label>
                <input type="file" id="anim-edit-sound" accept=".mp3,.ogg,.wav" 
                       style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text);">
                <div style="font-size: 10px; color: var(--muted); margin-top: 4px;">
                  💡 支持 MP3、OGG、WAV 格式
                </div>
              </div>
            </div>
            
            <div id="anim-edit-status" style="display: none; margin-top: 12px; padding: 10px; border-radius: 6px; font-size: 11px;"></div>
            <div class="btn-group" style="margin-top: 16px;">
              <button class="btn btn-secondary" onclick="AnimLibMenu.closeEditModal()">取消</button>
              <button class="btn" id="anim-edit-btn" onclick="AnimLibMenu.editAnim('${anim.id}')">💾 保存修改</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
    } catch (error) {
      console.error('加载编辑模态框失败:', error);
      showToast('❌ 加载失败: ' + error.message, 'error');
    }
  }

  /**
   * 从 URL 获取文件名
   */
  function getFileNameFromUrl(url) {
    if (!url) return '未知文件';
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

    showStatus('⏳ 保存中...', 'loading');
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
        showStatus('✅ 保存成功', 'success');
        
        setTimeout(() => {
          closeEditModal();
          loadPage();
        }, 1500);
      } else {
        showStatus('❌ ' + (data.error || '保存失败'), 'error');
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
    if (!confirm('确定删除该动作的音效文件？')) {
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
        showToast('✅ 音效已删除');
        // 刷新编辑模态框
        closeEditModal();
        showEditModal(id);
      } else {
        showToast('❌ ' + (data.error || '删除失败'), 'error');
      }
    } catch (error) {
      console.error('删除音效失败:', error);
      showToast('❌ 删除失败', 'error');
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
