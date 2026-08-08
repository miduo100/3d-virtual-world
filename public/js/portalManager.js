/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// Portal Management UI
const PortalManager = {
  /**
   * 显示传送门管理界面
   */
  show() {
    const manager = document.getElementById('portal-manager');
    if (manager) {
      manager.style.display = 'block';
      this.loadPortalsList();
    }
  },

  /**
   * 隐藏传送门管理界面
   */
  hide() {
    const manager = document.getElementById('portal-manager');
    if (manager) {
      manager.style.display = 'none';
    }
  },

  /**
   * 初始化传送门管理器
   */
  init() {
    // 打开传送门管理器按钮（个人资料页面中的按钮）
    const openBtn = document.getElementById('portal-manager-btn');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        this.show();
      });
    }

    // 世界传送门按钮（主界面上的按钮）
    const worldPortalBtn = document.getElementById('world-portal-btn');
    if (worldPortalBtn) {
      worldPortalBtn.addEventListener('click', () => {
        this.show();
      });
    }

    // 关闭按钮
    const closeBtn = document.getElementById('close-portal-manager');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hide();
      });
    }

    // 坐标输入实时预览
    const coordInput = document.getElementById('coord-input');
    if (coordInput) {
      coordInput.addEventListener('input', () => {
        this.updateCoordPreview();
      });
    }

    // 使用当前位置按钮
    const useCurrentPosBtn = document.getElementById('use-current-pos-btn');
    if (useCurrentPosBtn) {
      useCurrentPosBtn.addEventListener('click', () => {
        this.useCurrentPosForCoord();
      });
    }

    // 坐标传送按钮
    const teleportCoordBtn = document.getElementById('teleport-coord-btn');
    if (teleportCoordBtn) {
      teleportCoordBtn.addEventListener('click', () => {
        this.teleportToCoord();
      });
    }
  },

  /**
   * 使用玩家当前位置
   */
  useCurrentPosition() {
    if (!player) {
      UI.addChatMessage('系统', '无法获取玩家位置');
      return;
    }

    const pos = player.position;
    document.getElementById('portal-source-x').value = Math.round(pos.x * 10) / 10;
    document.getElementById('portal-source-y').value = Math.round(pos.y * 10) / 10;
    document.getElementById('portal-source-z').value = Math.round(pos.z * 10) / 10;

    UI.addChatMessage('系统', '✅ 已使用当前位置');
  },

  /**
   * 加载传送门列表
   */
  async loadPortalsList() {
    const listContainer = document.getElementById('portals-list');
    if (!listContainer) return;

    try {
      listContainer.innerHTML = '<div style="text-align: center; padding: 10px; color: #888;">加载中...</div>';

      const portals = await API.get('/portal');
      
      if (portals.length === 0) {
        listContainer.innerHTML = '<div style="text-align: center; padding: 10px; color: #888;">暂无传送门</div>';
        return;
      }

      let html = '';
      portals.forEach((portal) => {
        const typeColor = portal.portal_type === 'remote' ? '#ff00ff' : '#00ffff';
        const typeText = portal.portal_type === 'remote' ? '跨服' : '本地';
        const sx = Math.round(portal.source_position.x);
        const sy = Math.round(portal.source_position.y);
        const sz = Math.round(portal.source_position.z);
        const tx = Math.round(portal.target_position.x);
        const ty = Math.round(portal.target_position.y);
        const tz = Math.round(portal.target_position.z);
        const tags = [
          portal.is_bidirectional ? '🔄双向' : '➡️单向',
          portal.cooldown_seconds > 0 ? `⏱️${portal.cooldown_seconds}s` : '',
          portal.required_level > 1 ? `Lv.${portal.required_level}` : ''
        ].filter(Boolean).join(' ');

        html += `
          <div style="
            background: rgba(0, 0, 0, 0.5);
            border: 2px solid ${typeColor};
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            font-family: 'Courier New', monospace;
          ">
            <!-- 第1行：名称 + 信息 + 状态 + 传送按钮 -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 10px; min-width: 0; overflow: hidden; flex: 1;">
                <span style="font-weight: bold; color: ${typeColor}; white-space: nowrap;">🌀 ${portal.name}</span>
                <span style="color: #888; font-size: 11px; white-space: nowrap;">${typeText} | ${portal.creator_name || '系统'}</span>
                ${portal.description ? `<span style="color: #aaa; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; display: inline-block; vertical-align: middle;" title="${portal.description}">${portal.description}</span>` : ''}
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <span style="
                  background: ${portal.is_active ? '#00ff00' : '#ff0000'};
                  color: #000;
                  padding: 2px 8px;
                  border-radius: 10px;
                  font-size: 10px;
                  font-weight: bold;
                ">${portal.is_active ? '✅激活' : '❌禁用'}</span>
                <button onclick="PortalManager.teleportToPortal('${portal.id}')" style="
                  padding: 5px 14px;
                  background: #006666;
                  color: #00ffff;
                  border: 1px solid #00ffff;
                  border-radius: 5px;
                  cursor: pointer;
                  font-size: 12px;
                  font-weight: bold;
                  white-space: nowrap;
                ">📍 传送</button>
              </div>
            </div>
            <!-- 第2行：源位置 → 目标位置 + 属性标签 -->
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div style="color: #ccc; font-size: 12px;">
                <span style="color: #888;">源</span> <span style="color: #00ff00;">(${sx},${sy},${sz})</span>
                <span style="color: #555; margin: 0 6px;">→</span>
                <span style="color: #888;">目标</span> <span style="color: #00ffff;">(${tx},${ty},${tz})</span>
              </div>
              <div style="color: #888; font-size: 11px; white-space: nowrap;">
                ${tags}
              </div>
            </div>
          </div>
        `;
      });

      listContainer.style.display = 'grid';
      listContainer.style.gridTemplateColumns = '1fr 1fr';
      listContainer.style.gap = '6px';
      listContainer.innerHTML = html;
    } catch (error) {
      console.error('❌ 加载传送门列表失败:', error);
      listContainer.innerHTML = '<div style="text-align: center; padding: 10px; color: #ff0000;">加载失败</div>';
    }
  },

  /**
   * 创建传送门
   */
  async createPortal() {
    try {
      const portalData = {
        name: document.getElementById('portal-name').value,
        description: document.getElementById('portal-description').value,
        source_position: {
          x: parseFloat(document.getElementById('portal-source-x').value),
          y: parseFloat(document.getElementById('portal-source-y').value),
          z: parseFloat(document.getElementById('portal-source-z').value),
        },
        target_position: {
          x: parseFloat(document.getElementById('portal-target-x').value),
          y: parseFloat(document.getElementById('portal-target-y').value),
          z: parseFloat(document.getElementById('portal-target-z').value),
        },
        portal_type: document.getElementById('portal-type').value,
        is_bidirectional: document.getElementById('portal-bidirectional').checked,
        cooldown_seconds: parseInt(document.getElementById('portal-cooldown').value),
      };

      console.log('🌀 创建传送门:', portalData);

      const response = await API.post('/portal/create', portalData);

      if (response.portal) {
        UI.addChatMessage('系统', `✨ 传送门创建成功: ${response.portal.name}`);
        
        // 在3D世界中添加传送门
        if (gameWorld) {
          gameWorld.addPortal(
            response.portal.id,
            response.portal.name,
            response.portal.source_position,
            response.portal.target_position,
            response.portal.portal_type
          );
        }

        // 重置表单
        document.getElementById('create-portal-form').reset();
        
        // 重新加载列表
        this.loadPortalsList();

        // 广播传送门创建事件
        if (WSClient.isConnected()) {
          WSClient.send({
            type: 'PORTAL_CREATE',
            payload: {
              portalId: response.portal.id,
              name: response.portal.name,
              sourcePosition: response.portal.source_position,
              targetPosition: response.portal.target_position,
              portalType: response.portal.portal_type,
            },
          });
        }
      }
    } catch (error) {
      console.error('❌ 创建传送门失败:', error);
      UI.addChatMessage('系统', `创建传送门失败: ${error.message}`);
      alert(`创建传送门失败: ${error.message}`);
    }
  },

  /**
   * 传送到传送门位置
   */
  async teleportToPortal(portalId) {
    try {
      console.log('🌀 开始传送，传送门ID:', portalId);
      console.log('角色ID:', GAME_STATE.characterId);
      
      // 检查是否为游客
      if (GAME_STATE && GAME_STATE.isGuest) {
        UI.addChatMessage('系统', '⚠️ 游客模式无法使用传送功能，请注册后使用');
        alert('⚠️ 游客模式无法使用传送功能\n\n请注册账号后使用传送门');
        return;
      }
      
      if (!player) {
        console.error('❌ 玩家对象不存在');
        UI.addChatMessage('系统', '无法获取玩家对象');
        alert('无法获取玩家对象');
        return;
      }

      if (!GAME_STATE.characterId) {
        console.error('❌ 角色ID不存在');
        UI.addChatMessage('系统', '角色ID不存在，请重新登录');
        alert('角色ID不存在，请重新登录');
        return;
      }

      console.log('正在调用传送门API...');
      const response = await API.post('/portal/use', {
        portal_id: portalId,
        character_id: GAME_STATE.characterId,
      });

      console.log('✅ API响应:', response);

      if (response.target_position) {
        // 确保 target_position 是对象而不是字符串
        let targetPos = response.target_position;
        if (typeof targetPos === 'string') {
          targetPos = JSON.parse(targetPos);
        }

        console.log('目标位置:', targetPos);
        
        player.position.set(targetPos.x, targetPos.y, targetPos.z);
        
        // 创建传送特效
        if (gameWorld) {
          gameWorld.createTeleportEffect(player.position);
        }

        UI.addChatMessage('系统', '✨ 传送成功！');
        this.hide();
      } else {
        console.error('❌ 响应中没有目标位置');
        UI.addChatMessage('系统', '传送失败：没有目标位置');
        alert('传送失败：没有目标位置');
      }
    } catch (error) {
      console.error('❌ 传送失败，详细错误:', error);
      const errorMsg = error.message || error.toString();
      UI.addChatMessage('系统', `传送失败: ${errorMsg}`);
      alert(`传送失败: ${errorMsg}\n\n请检查控制台查看详细信息`);
    }
  },

  /**
   * 切换传送门状态
   */
  async togglePortal(portalId, isActive) {
    try {
      await API.put(`/portal/${portalId}`, { is_active: isActive });
      UI.addChatMessage('系统', `传送门已${isActive ? '启用' : '禁用'}`);
      this.loadPortalsList();
    } catch (error) {
      console.error('❌ 切换传送门状态失败:', error);
      alert(`操作失败: ${error.message}`);
    }
  },

  /**
   * 删除传送门
   */
  async deletePortal(portalId) {
    if (!confirm('确定要删除这个传送门吗？此操作不可恢复。')) {
      return;
    }

    try {
      await API.delete(`/portal/${portalId}`);
      
      // 从3D世界中移除
      if (gameWorld) {
        gameWorld.removePortal(portalId);
      }

      UI.addChatMessage('系统', '✅ 传送门已删除');
      this.loadPortalsList();
    } catch (error) {
      console.error('❌ 删除传送门失败:', error);
      alert(`删除失败: ${error.message}`);
    }
  },

  /**
   * 解析坐标字符串，支持多种格式:
   *   "X:8.2 Y:1.5 Z:34.7"
   *   "8.2, 1.5, 34.7"
   *   "x=8.2 y=1.5 z=34.7"
   * 返回 { x, y, z } 或 null
   */
  parseCoordString(str) {
    if (!str || !str.trim()) return null;

    // 格式1: X:8.2 Y:1.5 Z:34.7（不区分大小写）
    const match1 = str.match(/[xX]\s*[:=]\s*(-?\d+\.?\d*)\s*[,;\s]*\s*[yY]\s*[:=]\s*(-?\d+\.?\d*)\s*[,;\s]*\s*[zZ]\s*[:=]\s*(-?\d+\.?\d*)/);
    if (match1) {
      return {
        x: parseFloat(match1[1]),
        y: parseFloat(match1[2]),
        z: parseFloat(match1[3])
      };
    }

    // 格式2: 8.2, 1.5, 34.7
    const match2 = str.match(/^(-?\d+\.?\d*)\s*[,，\s]\s*(-?\d+\.?\d*)\s*[,，\s]\s*(-?\d+\.?\d*)$/);
    if (match2) {
      return {
        x: parseFloat(match2[1]),
        y: parseFloat(match2[2]),
        z: parseFloat(match2[3])
      };
    }

    return null;
  },

  /**
   * 坐标输入框实时预览
   */
  updateCoordPreview() {
    const input = document.getElementById('coord-input');
    const preview = document.getElementById('coord-preview');

    if (!input || !preview) return;

    const coord = this.parseCoordString(input.value);

    if (coord) {
      // 同步到手动输入框
      const xInput = document.getElementById('coord-x');
      const yInput = document.getElementById('coord-y');
      const zInput = document.getElementById('coord-z');
      if (xInput) xInput.value = coord.x;
      if (yInput) yInput.value = coord.y;
      if (zInput) zInput.value = coord.z;

      preview.style.display = 'block';
      preview.innerHTML = '✅ 已识别坐标: X=' + coord.x + ' Y=' + coord.y + ' Z=' + coord.z;
      preview.style.borderColor = '#00ff00';
      preview.style.background = 'rgba(0, 255, 0, 0.1)';
    } else if (input.value.trim()) {
      preview.style.display = 'block';
      preview.innerHTML = '⚠️ 无法解析坐标，请检查格式';
      preview.style.borderColor = '#ffaa00';
      preview.style.background = 'rgba(255, 170, 0, 0.1)';
    } else {
      preview.style.display = 'none';
    }
  },

  /**
   * 从手动输入框获取最终坐标
   */
  getFinalCoord() {
    const xInput = document.getElementById('coord-x');
    const yInput = document.getElementById('coord-y');
    const zInput = document.getElementById('coord-z');

    if (!xInput || !yInput || !zInput) return null;

    const x = parseFloat(xInput.value);
    const y = parseFloat(yInput.value);
    const z = parseFloat(zInput.value);

    if (isNaN(x) || isNaN(y) || isNaN(z)) return null;

    return { x, y, z };
  },

  /**
   * 使用玩家当前位置填充坐标输入框
   */
  useCurrentPosForCoord() {
    if (!player) {
      UI.addChatMessage('系统', '无法获取玩家位置');
      return;
    }

    const pos = player.position;
    document.getElementById('coord-x').value = Math.round(pos.x * 10) / 10;
    document.getElementById('coord-y').value = Math.round(pos.y * 10) / 10;
    document.getElementById('coord-z').value = Math.round(pos.z * 10) / 10;

    UI.addChatMessage('系统', '✅ 已填入当前位置');
  },

  /**
   * 执行坐标传送
   */
  teleportToCoord() {
    // 检查是否为游客
    if (GAME_STATE && GAME_STATE.isGuest) {
      UI.addChatMessage('系统', '⚠️ 游客模式无法使用坐标传送功能，请注册后使用');
      alert('⚠️ 游客模式无法使用坐标传送功能\n\n请注册账号后使用传送功能');
      return;
    }
    
    const coord = this.getFinalCoord();

    if (!coord) {
      UI.addChatMessage('系统', '请输入有效的坐标');
      return;
    }

    if (!player) {
      UI.addChatMessage('系统', '无法获取玩家对象');
      return;
    }

    console.log('🚀 坐标传送: X=' + coord.x + ' Y=' + coord.y + ' Z=' + coord.z);
    player.position.set(coord.x, coord.y, coord.z);

    // 创建传送特效
    if (gameWorld) {
      gameWorld.createTeleportEffect(player.position);
    }

    UI.addChatMessage('系统', '✨ 已传送到 X=' + coord.x + ' Y=' + coord.y + ' Z=' + coord.z);
    this.hide();
  },
};

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    PortalManager.init();
  });
} else {
  PortalManager.init();
}
