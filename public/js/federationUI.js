/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 联邦传送系统 - 前端UI
 * 实现用户在不同虚拟世界之间传送
 */

class FederationUI {
  constructor() {
    this.connectedWorlds = [];
    this.currentWorldInfo = null;
    this.init();
  }

  /**
   * 国际化翻译辅助方法
   * @param {string} key - i18n key (无 'world.' 前缀)
   * @param {string} fallback - 降级文本（中文）
   * @returns {string}
   */
  _t(key, fallback) {
    try {
      if (window.i18n && window.i18n.initialized) {
        return window.i18n.t('world.' + key);
      }
    } catch(e) { /* ignore */ }
    return fallback || key;
  }

  /**
   * 统一错误处理
   * @param {Error} error - 错误对象
   * @param {string} contextKey - i18n上下文键
   */
  handleError(error, contextKey) {
    const contextName = this._t(contextKey, contextKey);
    console.error(`${contextName}失败:`, error);
    
    // 友好的错误信息
    let errorMessage = this._t('operationFailed', '操作失败');
    
    if (error.message) {
      errorMessage = error.message;
    } else if (error.error) {
      errorMessage = error.error;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    
    // 显示错误提示
    alert(`❌ ${contextName}失败: ${errorMessage}`);
  }

  /**
   * 显示加载状态
   * @param {string} elementId - 元素ID
   */
  showLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;"><div style="font-size: 24px; margin-bottom: 10px;">🔄</div><div>' + this._t('loading', '加载中...') + '</div></div>';
    }
  }

  /**
   * 显示错误状态
   * @param {string} elementId - 元素ID
   * @param {string} errorMessage - 错误信息
   */
  showError(elementId, errorMessage) {
    const element = document.getElementById(elementId);
    if (element) {
      element.innerHTML = `<div style="text-align: center; padding: 20px; color: #ff4444;"><div style="font-size: 24px; margin-bottom: 10px;">❌</div><div>${errorMessage}</div></div>`;
    }
  }

  async init() {
    // 获取当前世界信息
    await this.loadCurrentWorldInfo();
    
    // 获取已连接的世界列表
    await this.loadConnectedWorlds();
    
    // 创建UI
    this.createUI();
    
    // 检查是否从其他世界传送过来
    this.checkTeleportToken();
  }

  /**
   * 加载当前世界信息
   */
  async loadCurrentWorldInfo() {
    try {
      const response = await fetch('/api/federation/info');
      const data = await response.json();
      
      if (data.success) {
        this.currentWorldInfo = data.world;
        console.log('当前世界:', this.currentWorldInfo.worldName);
      } else {
        throw new Error(data.error || this._t('loadWorldInfoFailed', '加载世界信息失败'));
      }
    } catch (error) {
      this.handleError(error, 'loadingWorldInfo');
    }
  }

  /**
   * 加载已连接的世界列表
   */
  async loadConnectedWorlds() {
    try {
      const response = await fetch('/api/federation/worlds');
      const data = await response.json();
      
      if (data.success) {
        this.connectedWorlds = data.worlds;
        console.log(`已连接 ${this.connectedWorlds.length} 个世界`);
      } else {
        throw new Error(data.error || this._t('loadWorldListFailed', '加载世界列表失败'));
      }
    } catch (error) {
      this.handleError(error, 'loadingWorldList');
    }
  }

  /**
   * 创建UI界面
   */
  createUI() {
    // 创建传送门按钮
    const teleportButton = document.createElement('button');
    teleportButton.id = 'federation-teleport-btn';
    teleportButton.innerHTML = '<span style="font-size:13px;">🌍 联邦传送</span><br><span style="font-size:10px;opacity:0.7;">Federation Teleport</span>';
    teleportButton.style.cssText = `
      position: fixed;
      top: 200px;
      right: 0;
      padding: 8px 12px;
      background: var(--green);
      color: #000;
      border: none;
      border-radius: 8px 0 0 8px;
      cursor: pointer;
      font-weight: bold;
      box-shadow: 0 4px 15px rgba(0, 255, 0, 0.4);
      z-index: 999;
      transition: all 0.3s ease;
      line-height: 1.3;
    `;
    
    teleportButton.addEventListener('mouseenter', () => {
      teleportButton.style.transform = 'translateY(-2px)';
      teleportButton.style.boxShadow = '0 6px 20px rgba(0, 255, 0, 0.6)';
    });
    
    teleportButton.addEventListener('mouseleave', () => {
      teleportButton.style.transform = 'translateY(0)';
      teleportButton.style.boxShadow = '0 4px 15px rgba(0, 255, 0, 0.4)';
    });
    
    teleportButton.addEventListener('click', () => this.showTeleportMenu());
    
    document.body.appendChild(teleportButton);

    // 响应式调整：移动端缩小
    const adjustTeleportBtnSize = () => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        teleportButton.style.padding = '6px 8px';
        teleportButton.innerHTML = '<span style="font-size:11px;">🌍 联邦传送</span><br><span style="font-size:9px;opacity:0.7;">Teleport</span>';
      } else {
        teleportButton.style.padding = '8px 12px';
        teleportButton.innerHTML = '<span style="font-size:13px;">🌍 联邦传送</span><br><span style="font-size:10px;opacity:0.7;">Federation Teleport</span>';
      }
    };
    adjustTeleportBtnSize();
    window.addEventListener('resize', adjustTeleportBtnSize);

    // 创建传送菜单（隐藏）
    this.createTeleportMenu();
  }

  /**
   * 创建传送菜单
   */
  createTeleportMenu() {
    const menu = document.createElement('div');
    menu.id = 'federation-teleport-menu';
    menu.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #161b22;
      border: 1px solid rgba(0,255,0,0.2);
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 30px;
      min-width: 500px;
      max-width: 800px;
      max-height: 80vh;
      overflow-y: auto;
      z-index: 10001;
      display: none;
    `;

    menu.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0; color: var(--green);">${this._t('federationTitle', '🌍 世界传送门')}</h2>
        <div style="display: flex; align-items: center; gap: 16px;">
          <div style="text-align: right;">
            <div style="font-size: 11px; color: var(--muted); line-height: 1;">${this._t('currentWorld', '当前所在世界')}</div>
            <div style="font-size: 16px; font-weight: bold; color: var(--green); line-height: 1.3;" id="current-world-name">${this._t('loading', '加载中...')}</div>
          </div>
          <button id="close-teleport-menu" style="
            width: 32px;
            height: 32px;
            background: rgba(255,255,255,0.08);
            border: 1.5px solid rgba(255,255,255,0.35);
            border-radius: 50%;
            font-size: 18px;
            cursor: pointer;
            color: var(--muted);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
          " 
          onmouseover="this.style.background='rgba(255,255,255,0.2)';this.style.color='#fff';this.style.borderColor='rgba(255,255,255,0.6)'"
          onmouseout="this.style.background='rgba(255,255,255,0.08)';this.style.color='var(--muted)';this.style.borderColor='rgba(255,255,255,0.35)'"
          >×</button>
        </div>
      </div>

      <h3 style="color: var(--green); margin-bottom: 15px;">${this._t('availableWorlds', '可传送的世界')}</h3>
      
      <div id="worlds-list" style="margin-bottom: 20px;">
        <!-- 世界列表将动态插入这里 -->
      </div>


    `;

    document.body.appendChild(menu);

    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.id = 'federation-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: none;
    `;
    document.body.appendChild(overlay);

    // 绑定事件
    document.getElementById('close-teleport-menu').addEventListener('click', () => this.hideTeleportMenu());
    overlay.addEventListener('click', () => this.hideTeleportMenu());
  }

  /**
   * 显示传送菜单
   */
  showTeleportMenu() {
    document.getElementById('federation-teleport-menu').style.display = 'block';
    document.getElementById('federation-overlay').style.display = 'block';
    
    // 更新当前世界名称
    if (this.currentWorldInfo) {
      document.getElementById('current-world-name').textContent = this.currentWorldInfo.worldName;
    }
    
    // 更新世界列表
    this.updateWorldsList();
  }

  /**
   * 隐藏传送菜单
   */
  hideTeleportMenu() {
    document.getElementById('federation-teleport-menu').style.display = 'none';
    document.getElementById('federation-overlay').style.display = 'none';
  }

  /**
   * 更新世界列表
   */
  updateWorldsList() {
    const worldsList = document.getElementById('worlds-list');
    
    if (this.connectedWorlds.length === 0) {
      worldsList.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--muted);">
          <div style="font-size: 48px; margin-bottom: 10px;">🌐</div>
          <div>${this._t('noConnectedWorlds', '还没有连接其他世界')}</div>
          <div style="font-size: 14px; margin-top: 5px;">${this._t('connectHint', '在下方输入其他世界的URL来建立连接')}</div>
        </div>
      `;
      return;
    }

    // 获取收藏的世界列表
    const favoriteWorlds = this.getFavoriteWorlds();

    worldsList.innerHTML = this.connectedWorlds.map(world => {
      const isFavorite = favoriteWorlds.includes(world.worldId);
      return `
        <div style="
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 10px;
          transition: all 0.3s ease;
        " 
        onmouseover="this.style.borderColor='var(--green)'; this.style.transform='translateY(-2px)'"
        onmouseout="this.style.borderColor='var(--border)'; this.style.transform='translateY(0)'">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="font-size: 20px; cursor: pointer;" onclick="federationUI.toggleFavorite('${world.worldId}')">
                ${isFavorite ? '❤️' : '🤍'}
              </div>
              <div>
                <div style="font-size: 18px; font-weight: bold; color: var(--text); margin-bottom: 5px;">
                  ${world.worldName}
                </div>
                <div style="font-size: 12px; color: var(--muted);">
                  ${world.worldUrl}
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 10px;">
              <button style="
                background: var(--green);
                color: #000;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                font-weight: bold;
                cursor: pointer;
              " onclick="federationUI.previewWorld('${world.worldId}', '${world.worldName}')">
                ${this._t('preview', '预览')}
              </button>
              <button style="
                background: var(--green);
                color: #000;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                font-weight: bold;
                cursor: pointer;
              " onclick="federationUI.teleportToWorld('${world.worldId}', '${world.worldName}')">
                ${this._t('teleportToWorld', '传送 →')}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * 获取收藏的世界列表
   */
  getFavoriteWorlds() {
    try {
      const favorites = localStorage.getItem('favoriteWorlds');
      return favorites ? JSON.parse(favorites) : [];
    } catch (error) {
      console.error('获取收藏世界失败:', error);
      return [];
    }
  }

  /**
   * 切换世界收藏状态
   */
  toggleFavorite(worldId) {
    const favorites = this.getFavoriteWorlds();
    const index = favorites.indexOf(worldId);
    
    if (index > -1) {
      // 取消收藏
      favorites.splice(index, 1);
    } else {
      // 添加收藏
      favorites.push(worldId);
    }
    
    // 保存到localStorage
    localStorage.setItem('favoriteWorlds', JSON.stringify(favorites));
    
    // 更新世界列表
    this.updateWorldsList();
  }

  /**
   * 预览世界信息
   */
  async previewWorld(worldId, worldName) {
    try {
      // 创建预览模态框
      const modal = document.createElement('div');
      modal.id = 'world-preview-modal';
      modal.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #161b22;
        border: 1px solid rgba(0,255,0,0.2);
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        padding: 30px;
        min-width: 400px;
        max-width: 600px;
        max-height: 80vh;
        overflow-y: auto;
        z-index: 10002;
      `;

      // 显示加载中状态
      modal.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="margin: 0; color: var(--green);">${this._t('worldPreview', '🌍 世界预览')}: ${worldName}</h2>
          <button id="close-preview-modal" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: var(--muted);
          ">×</button>
        </div>
        <div style="text-align: center; padding: 40px; color: var(--muted);">
          <div style="font-size: 32px; margin-bottom: 10px;">🔄</div>
          <div>${this._t('loading', '加载中...')}</div>
        </div>
      `;

      document.body.appendChild(modal);

      // 创建遮罩层
      const overlay = document.createElement('div');
      overlay.id = 'preview-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 10001;
      `;
      document.body.appendChild(overlay);

      // 绑定关闭事件
      document.getElementById('close-preview-modal').addEventListener('click', () => this.closePreviewModal());
      overlay.addEventListener('click', () => this.closePreviewModal());

      // 获取世界信息
      const response = await fetch(`/api/federation/worlds/${worldId}`);
      const data = await response.json();

      if (data.success) {
        const worldInfo = data.world;
        
        // 更新模态框内容
        modal.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin: 0; color: var(--green);">${this._t('worldPreview', '🌍 世界预览')}: ${worldInfo.worldName}</h2>
            <button id="close-preview-modal" style="
              background: none;
              border: none;
              font-size: 24px;
              cursor: pointer;
              color: var(--muted);
            ">×</button>
          </div>
          
          <div style="background: var(--green); padding: 20px; border-radius: 12px; margin-bottom: 20px; color: #000;">
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 5px;">${this._t('worldInfo', '世界信息')}</div>
            <div style="font-size: 24px; font-weight: bold; margin-bottom: 10px;">${worldInfo.worldName}</div>
            <div style="font-size: 14px; opacity: 0.9;">${worldInfo.worldDescription || this._t('noDescription', '暂无描述')}</div>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px;">
            <div style="background: rgba(0,0,0,0.3); padding: 15px; border: 1px solid var(--border); border-radius: 8px; text-align: center;">
              <div style="font-size: 12px; color: var(--muted); margin-bottom: 5px;">${this._t('onlineUsers', '在线人数')}</div>
              <div style="font-size: 20px; font-weight: bold; color: var(--text);">${worldInfo.onlineUsers || 0}</div>
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 15px; border: 1px solid var(--border); border-radius: 8px; text-align: center;">
              <div style="font-size: 12px; color: var(--muted); margin-bottom: 5px;">${this._t('portalCount', '传送门数量')}</div>
              <div style="font-size: 20px; font-weight: bold; color: var(--text);">${worldInfo.portalCount || 0}</div>
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 15px; border: 1px solid var(--border); border-radius: 8px; text-align: center;">
              <div style="font-size: 12px; color: var(--muted); margin-bottom: 5px;">${this._t('connectionStatus', '连接状态')}</div>
              <div style="font-size: 20px; font-weight: bold; color: ${worldInfo.status === 'online' ? 'var(--green)' : 'var(--red)'};">
                ${worldInfo.status === 'online' ? this._t('online', '在线') : this._t('offline', '离线')}
              </div>
            </div>
          </div>
          
          <div style="margin-bottom: 20px;">
            <h3 style="color: var(--green); margin-bottom: 10px;">${this._t('worldLink', '🌐 世界链接')}</h3>
            <div style="background: rgba(0,0,0,0.3); padding: 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px; word-break: break-all; color: var(--text);">
              ${worldInfo.worldUrl}
            </div>
          </div>
          
          <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button style="
              padding: 10px 20px;
              background: var(--green);
              color: #000;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-weight: bold;
            " onclick="federationUI.teleportToWorld('${worldId}', '${worldName}')">
              ${this._t('teleportToThisWorld', '传送到此世界')}
            </button>
          </div>
        `;

        // 重新绑定关闭事件
        document.getElementById('close-preview-modal').addEventListener('click', () => this.closePreviewModal());
      } else {
        // 加载失败
        throw new Error(data.error || this._t('loadWorldInfoFailed', '加载世界信息失败'));
      }
    } catch (error) {
      this.handleError(error, 'previewingWorld');
      
      // 显示错误信息
      const modal = document.getElementById('world-preview-modal');
      if (modal) {
        modal.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin: 0; color: var(--green);">${this._t('worldPreview', '🌍 世界预览')}</h2>
            <button id="close-preview-modal" style="
              background: none;
              border: none;
              font-size: 24px;
              cursor: pointer;
              color: var(--muted);
            ">×</button>
          </div>
          <div style="text-align: center; padding: 40px; color: var(--red);">
            <div style="font-size: 32px; margin-bottom: 10px;">❌</div>
            <div>${this._t('previewFailed', '预览失败')}</div>
            <div style="font-size: 14px; margin-top: 10px;">${error.message}</div>
          </div>
        `;

        // 绑定关闭事件
        document.getElementById('close-preview-modal').addEventListener('click', () => this.closePreviewModal());
      }
    }
  }

  /**
   * 关闭预览模态框
   */
  closePreviewModal() {
    const modal = document.getElementById('world-preview-modal');
    const overlay = document.getElementById('preview-overlay');
    
    if (modal) {
      document.body.removeChild(modal);
    }
    
    if (overlay) {
      document.body.removeChild(overlay);
    }
  }


  /**
   * 传送到其他世界
   */
  async teleportToWorld(targetWorldId, targetWorldName) {
    var confirmText = this._t('confirmTeleport', '确定要传送到 "{name}" 吗？\\n\\n你的身份信息将自动同步到目标世界。');
    confirmText = confirmText.replace('{name}', targetWorldName);
    if (!confirm(confirmText)) {
      return;
    }

    try {
      // 获取当前用户的Token
      const token = localStorage.getItem('token');
      if (!token) {
        alert(this._t('pleaseLogin', '请先登录'));
        return;
      }

      // 获取当前玩家位置
      const playerPosition = typeof gameWorld !== 'undefined' && gameWorld?.player?.position ? gameWorld.player.position : { x: 0, y: 0, z: 0 };

      // 显示传送开始动画
      if (typeof gameWorld !== 'undefined' && gameWorld && gameWorld.world) {
        gameWorld.world.startTeleportAnimation(playerPosition, async () => {
          // 动画完成后执行传送逻辑
          await this.performTeleport(targetWorldId, targetWorldName, playerPosition, token);
        });
      } else {
        // 如果没有gameWorld实例，直接执行传送
        await this.performTeleport(targetWorldId, targetWorldName, playerPosition, token);
      }
    } catch (error) {
      this.handleError(error, 'teleporting');
    }
  }

  /**
   * 执行实际的传送逻辑
   */
  async performTeleport(targetWorldId, targetWorldName, playerPosition, token) {
    try {
      // ── 收集角色完整配置（转绝对URL，供目标世界跨域加载）──
      const MVP_ANIM_KEYS = ['idle','walk','run','jump','attack1','attack2','attack3','hit','death',
        'turn_left','turn_right','attack_stab','attack_slash','attack_swing','attack_uppercut','draw_sword','sheath'];
      const animUrls = {};
      MVP_ANIM_KEYS.forEach(k => {
        const v = localStorage.getItem('selectedTemplateAnim_' + k);
        if (v && v.trim() && v !== 'null') {
          animUrls[k] = v.startsWith('http') ? v : (window.location.origin + v);
        }
      });
      const rawGlb = localStorage.getItem('selectedTemplateGlbUrl') || '';
      const glbUrl = (rawGlb && rawGlb !== 'null')
        ? (rawGlb.startsWith('http') ? rawGlb : window.location.origin + rawGlb)
        : null;
      let weaponConfig = null;
      try { weaponConfig = JSON.parse(localStorage.getItem('selectedTemplateWeaponConfig') || 'null'); } catch(e) {}
      let boneMapConfig = null;
      try { boneMapConfig = JSON.parse(localStorage.getItem('selectedTemplateBoneMap') || 'null'); } catch(e) {}
      let weaponSocketConfig = null;
      try { weaponSocketConfig = JSON.parse(localStorage.getItem('selectedTemplateWeaponSocket') || 'null'); } catch(e) {}
      let calibrationConfig = null;
      try { calibrationConfig = JSON.parse(localStorage.getItem('selectedTemplateCalibration') || 'null'); } catch(e) {}

      // 生成传送Token
      const response = await fetch('/api/federation/teleport/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          targetWorldId,
          context: {
            position: playerPosition,
            // ── 角色配置（目标世界用绝对URL远程加载）──
            characterConfig: {
              glbUrl,
              animUrls,
              weaponConfig,
              boneMapConfig,
              weaponSocketConfig,
              calibrationConfig,
              templateName:   localStorage.getItem('selectedTemplateName') || '',
              modelHeight:    localStorage.getItem('selectedTemplateHeight') || '1.8',
              sourceWorldUrl: window.location.origin,
              ...(window.SelfContainedChar ? window.SelfContainedChar.buildSendExtra() : {})
            },
            // ── 背包信息（家园世界模式：奖励始终回写到玩家注册的家园世界）──
            inventoryInfo: {
              apiBaseUrl: window.location.origin,
              userId:     localStorage.getItem('userId'),
              token:      token,
              // 家园世界信息：若当前世界本身就是家园世界则用当前值；
              // 若已是多跳（本世界已有 homeWorld 记录），则透传家园世界信息
              homeWorldApiUrl:  localStorage.getItem('homeWorldApiUrl')  || window.location.origin,
              homeWorldUserId:  localStorage.getItem('homeWorldUserId')  || localStorage.getItem('userId'),
              homeWorldToken:   localStorage.getItem('homeWorldToken')   || token
            }
          }
        })
      });

      const data = await response.json();

      if (data.success) {
        // 通过URL参数传递传送Token（sessionStorage不跨域）
        const targetUrl = data.targetUrl.replace(/\/+$/, '');
        window.location.href = `${targetUrl}?teleport=true&token=${encodeURIComponent(data.teleportToken)}`;
      } else {
        throw new Error(data.error || this._t('teleportFailed', '传送失败'));
      }
    } catch (error) {
      this.handleError(error, 'executingTeleport');
    }
  }

  /**
   * 检查是否从其他世界传送过来
   */
  async checkTeleportToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const isTeleport = urlParams.get('teleport') === 'true';
    
    if (!isTeleport) {
      return;
    }

    // 优先从URL参数读取token（跨域传送），其次从sessionStorage读取（同域备用）
    const teleportToken = urlParams.get('token') || sessionStorage.getItem('teleport_token');
    
    if (!teleportToken) {
      console.log('未找到传送Token');
      return;
    }

    try {
      // 验证传送Token并登录
      const response = await fetch('/api/federation/teleport/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teleportToken })
      });

      const data = await response.json();

      if (data.success) {
        // 保存本地Token
        localStorage.setItem('token', data.token);
        localStorage.setItem('userInfo', JSON.stringify(data.user));
        
        // ── 保存跨世界传送带的角色配置（glbUrl/武器/骨骼/动画/校准）──
        // 修复：传送刷新后 selectedTemplateGlbUrl 丢失导致其他玩家看不到模型
        const charCfg = data.characterConfig || data.context?.characterConfig || null;
        if (charCfg) {
          console.log('[Federation] 保存跨世界角色配置:', JSON.stringify(charCfg).substring(0, 200));
          if (charCfg.glbUrl) {
            localStorage.setItem('selectedTemplateGlbUrl', charCfg.glbUrl);
          }
          if (charCfg.templateName) {
            localStorage.setItem('selectedTemplateName', charCfg.templateName);
          }
          if (charCfg.modelHeight) {
            localStorage.setItem('selectedTemplateHeight', String(charCfg.modelHeight));
          }
          // 武器配置
          if (charCfg.weaponConfig && Object.keys(charCfg.weaponConfig).length > 0) {
            localStorage.setItem('selectedTemplateWeaponConfig', JSON.stringify(charCfg.weaponConfig));
          }
          // 骨骼映射
          if (charCfg.boneMapConfig && Object.keys(charCfg.boneMapConfig).length > 0) {
            localStorage.setItem('selectedTemplateBoneMap', JSON.stringify(charCfg.boneMapConfig));
          }
          // 武器插槽
          if (charCfg.weaponSocketConfig && Object.keys(charCfg.weaponSocketConfig).length > 0) {
            localStorage.setItem('selectedTemplateWeaponSocket', JSON.stringify(charCfg.weaponSocketConfig));
          }
          // 校准参数
          if (charCfg.calibrationConfig && Object.keys(charCfg.calibrationConfig).length > 0) {
            localStorage.setItem('selectedTemplateCalibration', JSON.stringify(charCfg.calibrationConfig));
          }
          // 动画URL
          if (charCfg.animUrls && typeof charCfg.animUrls === 'object') {
            Object.entries(charCfg.animUrls).forEach(([key, url]) => {
              if (url && url !== 'null' && url.trim() !== '') {
                localStorage.setItem('selectedTemplateAnim_' + key, url);
              }
            });
          }
        }
        
        // 清除传送Token
        sessionStorage.removeItem('teleport_token');
        
        // 显示欢迎消息
        alert(`${data.message}\n\n${this._t('welcomeNewWorld', '欢迎来到新世界！')}`);
        
        // 刷新页面（移除URL参数）
        const newUrl = window.location.origin + window.location.pathname;
        
        // 检查是否有gameWorld实例，如果有则显示传送结束动画
        if (typeof gameWorld !== 'undefined' && gameWorld && gameWorld.world) {
          // 显示传送结束动画
          gameWorld.world.endTeleportAnimation({ x: 0, y: 0, z: 0 });
          
          // 延迟刷新页面，让动画有时间播放
          setTimeout(() => {
            window.location.href = newUrl;
          }, 1000);
        } else {
          // 直接刷新页面
          window.location.href = newUrl;
        }
      } else {
        throw new Error(data.error || this._t('teleportVerifyFailed', '传送验证失败'));
      }
    } catch (error) {
      this.handleError(error, 'teleportVerify');
      sessionStorage.removeItem('teleport_token');
    }
  }
}

// 全局实例
let federationUI;

// 在页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    federationUI = new FederationUI();
  });
} else {
  federationUI = new FederationUI();
}
