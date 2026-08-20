/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 虚拟世界建筑管理器
 * 管理员可以在游戏中直接编辑建筑和对象
 */

class BuildingManager {
  constructor(world, camera, renderer) {
    this.world = world;
    this.camera = camera;
    this.renderer = renderer;
    this.isAdminMode = false;
    this.selectedObject = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.transformControls = null;
    this.isAdmin = false;
    
    // 初始化
    this.init();
  }
  
  async init() {
    // 检查管理员权限
    await this.checkAdminPermission();
    
    if (this.isAdmin) {
      console.log('✅ 管理员权限已确认，启用建筑管理功能');
      this.setupTransformControls();
      this.setupEventListeners();
      this.createAdminUI();
    }
  }
  
  /**
   * 检查用户是否是管理员
   */
  async checkAdminPermission() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return false;
      
      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        this.isAdmin = data.user && data.user.role === 'admin';
        console.log('用户角色:', data.user?.role);
        return this.isAdmin;
      }
    } catch (error) {
      console.error('检查管理员权限失败:', error);
    }
    return false;
  }
  
  /**
   * 创建管理员UI
   */
  createAdminUI() {
    const adminPanel = document.createElement('div');
    adminPanel.id = 'admin-building-panel';
    adminPanel.style.cssText = `
      position: fixed;
      top: 150px;
      right: 10px;
      background: rgba(0, 0, 0, 0.9);
      border: 2px solid #ff9800;
      border-radius: 8px;
      padding: 15px;
      color: #fff;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      z-index: 1000;
      min-width: 250px;
      display: none;
    `;
    
    adminPanel.innerHTML = `
      <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #ff9800;">
        <h3 style="margin: 0; color: #ff9800; font-size: 14px;">🔧 管理员模式</h3>
        <button id="toggle-admin-mode" style="
          width: 100%;
          margin-top: 8px;
          padding: 6px;
          background: #4CAF50;
          border: none;
          color: white;
          border-radius: 4px;
          cursor: pointer;
          font-weight: bold;
        ">启用编辑模式</button>
      </div>
      
      <div id="selected-object-info" style="display: none;">
        <div style="margin-bottom: 10px; padding: 10px; background: rgba(255, 152, 0, 0.2); border-radius: 4px;">
          <div style="color: #ff9800; margin-bottom: 5px;">已选中:</div>
          <div id="selected-object-name" style="font-weight: bold; margin-bottom: 8px;"></div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; margin-bottom: 8px;">
            <button class="transform-btn" data-mode="translate" style="padding: 5px; background: #2196F3; border: none; color: white; border-radius: 3px; cursor: pointer;">📍 移动</button>
            <button class="transform-btn" data-mode="rotate" style="padding: 5px; background: #9C27B0; border: none; color: white; border-radius: 3px; cursor: pointer;">🔄 旋转</button>
            <button class="transform-btn" data-mode="scale" style="padding: 5px; background: #FF5722; border: none; color: white; border-radius: 3px; cursor: pointer;">📏 缩放</button>
          </div>
          
          <div style="margin-top: 10px;">
            <label style="display: block; margin-bottom: 5px; color: #aaa;">名称:</label>
            <input type="text" id="object-name-input" style="
              width: 100%;
              padding: 5px;
              background: rgba(0, 0, 0, 0.5);
              border: 1px solid #666;
              color: white;
              border-radius: 3px;
              margin-bottom: 8px;
            ">
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 10px;">
            <button id="save-changes-btn" style="padding: 8px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-weight: bold;">💾 保存</button>
            <button id="copy-object-btn" style="padding: 8px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer;">📋 复制</button>
          </div>
          
          <button id="delete-object-btn" style="width: 100%; padding: 8px; background: #f44336; border: none; color: white; border-radius: 4px; cursor: pointer; margin-top: 5px; font-weight: bold;">🗑️ 删除</button>
        </div>
        
        <div style="margin-top: 10px; padding: 8px; background: rgba(0, 0, 0, 0.5); border-radius: 4px; font-size: 10px;">
          <div style="color: #888; margin-bottom: 5px;">位置 (X, Y, Z):</div>
          <div id="position-display" style="color: #4CAF50;"></div>
          <div style="color: #888; margin-top: 5px; margin-bottom: 5px;">旋转 (X, Y, Z):</div>
          <div id="rotation-display" style="color: #9C27B0;"></div>
          <div style="color: #888; margin-top: 5px; margin-bottom: 5px;">缩放 (X, Y, Z):</div>
          <div id="scale-display" style="color: #FF5722;"></div>
        </div>
        
        <button id="deselect-btn" style="width: 100%; padding: 6px; background: #666; border: none; color: white; border-radius: 4px; cursor: pointer; margin-top: 10px;">✖ 取消选中</button>
      </div>
      
      <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #666; font-size: 10px; color: #888;">
        <div>💡 提示:</div>
        <div>• 点击建筑选中</div>
        <div>• 按 G 键移动</div>
        <div>• 按 R 键旋转</div>
        <div>• 按 S 键缩放</div>
        <div>• 按 Esc 取消选中</div>
      </div>
    `;
    
    document.body.appendChild(adminPanel);
    
    // 绑定事件
    document.getElementById('toggle-admin-mode').addEventListener('click', () => {
      this.toggleAdminMode();
    });
    
    document.querySelectorAll('.transform-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.target.dataset.mode;
        this.setTransformMode(mode);
      });
    });
    
    document.getElementById('save-changes-btn').addEventListener('click', () => {
      this.saveChanges();
    });
    
    document.getElementById('copy-object-btn').addEventListener('click', () => {
      this.copyObject();
    });
    
    document.getElementById('delete-object-btn').addEventListener('click', () => {
      this.deleteObject();
    });
    
    document.getElementById('deselect-btn').addEventListener('click', () => {
      this.deselectObject();
    });
    
    // 显示管理面板
    adminPanel.style.display = 'block';
  }
  
  /**
   * 切换管理员模式
   */
  toggleAdminMode() {
    this.isAdminMode = !this.isAdminMode;
    const btn = document.getElementById('toggle-admin-mode');
    
    if (this.isAdminMode) {
      btn.textContent = '禁用编辑模式';
      btn.style.background = '#f44336';
      this.showAllBuildingLabels(true); // 显示所有建筑标签
      UI.showNotification('🔧 管理员模式', '编辑模式已启用\n点击建筑进行编辑', 3000);
      
      // ========== 调试日志：管理员模式启用时输出完整状态 ==========
      console.group('🔍 [AdminDebug] 管理员模式已启用');
      console.log(`✅ generatedBuildings 总数: ${this.world.generatedBuildings?.size || 0}`);
      
      let stats = { hasModel: 0, noModel: 0, inScene: 0, notInScene: 0, hasWorldObjectId: 0, noWorldObjectId: 0 };
      let problemBuildings = [];
      
      if (this.world.generatedBuildings) {
        this.world.generatedBuildings.forEach((building, id) => {
          if (building.model) {
            stats.hasModel++;
            if (building.model.parent === this.world.scene) {
              stats.inScene++;
              if (building.model.userData?.worldObjectId) {
                stats.hasWorldObjectId++;
              } else {
                stats.noWorldObjectId++;
                problemBuildings.push({ id, name: building.data?.name || '未命名', reason: '缺少 worldObjectId' });
              }
            } else {
              stats.notInScene++;
              problemBuildings.push({ id, name: building.data?.name || '未命名', reason: '不在场景中' });
            }
          } else {
            stats.noModel++;
            problemBuildings.push({ id, name: building.data?.name || '未命名', reason: 'model 为空/null' });
          }
        });
        
        console.table(stats);
        console.log(`📊 可选择对象统计: ✅ 有model且在场景中: ${stats.inScene}, ⚠️ 有model但不在场景: ${stats.notInScene}, ❌ 无model对象: ${stats.noModel}`);
        console.log(`🔑 有worldObjectId: ${stats.hasWorldObjectId}, 🔒 缺少worldObjectId: ${stats.noWorldObjectId}`);
        
        if (problemBuildings.length > 0) {
          console.warn(`⚠️ 发现 ${problemBuildings.length} 个可能无法选中的建筑:`);
          console.table(problemBuildings);
        }
        
        const selectableNames = [];
        this.world.generatedBuildings.forEach((building, id) => {
          if (building.model && building.model.parent === this.world.scene) {
            selectableNames.push(`${id}: ${building.data?.name || '未命名'}`);
          }
        });
        console.log(`📋 完整可选择列表 [${selectableNames.length}个]:`, selectableNames);
      }
      console.groupEnd();
      // ========== 调试日志结束 ==========
    } else {
      btn.textContent = '启用编辑模式';
      btn.style.background = '#4CAF50';
      this.showAllBuildingLabels(false); // 隐藏所有建筑标签
      this.deselectObject();
      UI.showNotification('🔧 管理员模式', '编辑模式已禁用', 2000);
    }
  }
  
  /**
   * 显示/隐藏所有建筑标签
   */
  showAllBuildingLabels(show) {
    // 遍历所有生成的建筑
    if (this.world.generatedBuildings) {
      this.world.generatedBuildings.forEach((building) => {
        if (building.model && building.model.userData.label) {
          building.model.userData.label.visible = show;
        }
      });
    }
  }
  
  /**
   * 设置变换控制器
   */
  setupTransformControls() {
    // 检查 TransformControls 是否可用
    if (typeof THREE.TransformControls === 'undefined') {
      console.warn('TransformControls 未加载，使用基础控制');
      return;
    }
    
    this.transformControls = new THREE.TransformControls(
      this.camera,
      this.renderer.domElement
    );
    
    this.transformControls.addEventListener('change', () => {
      this.updateObjectInfo();
    });
    
    // 拖拽时禁用相机控制，拖拽结束自动保存位置
    this.transformControls.addEventListener('dragging-changed', (event) => {
      if (this.world.controls) {
        this.world.controls.enabled = !event.value;
      }
      if (!event.value && this.selectedObject) {
        this.saveChanges();
      }
    });
    
    this.world.scene.add(this.transformControls);
  }
  
  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    // 鼠标点击事件
    this.renderer.domElement.addEventListener('click', (event) => {
      if (this.isAdminMode) {
        this.onMouseClick(event);
      }
    });
    
    // 键盘快捷键
    window.addEventListener('keydown', (event) => {
      if (!this.isAdminMode || !this.selectedObject) return;
      
      switch(event.key.toLowerCase()) {
        case 'g':
          this.setTransformMode('translate');
          break;
        case 'r':
          this.setTransformMode('rotate');
          break;
        case 's':
          this.setTransformMode('scale');
          break;
        case 'escape':
          this.deselectObject();
          break;
        case 'delete':
          this.deleteObject();
          break;
      }
    });
  }
  
  /**
   * 鼠标点击处理
   */
  onMouseClick(event) {
    console.group('🖱️ [ClickDebug] 鼠标点击事件');
    
    // 计算鼠标位置
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    console.log(`📍 鼠标屏幕坐标: (${event.clientX}, ${event.clientY})`);
    console.log(`📐 归一化设备坐标: (${this.mouse.x.toFixed(3)}, ${this.mouse.y.toFixed(3)})`);
    
    // 更新射线
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // 获取所有可编辑的建筑
    const editableObjects = [];
    const skippedObjects = [];
    
    this.world.generatedBuildings.forEach((building, id) => {
      if (building.model) {
        editableObjects.push(building.model);
        const meshCount = this.countMeshes(building.model);
        console.log(`   ➕ 可选: ID=${id}, 名称="${building.data?.name || '未命名'}", Mesh=${meshCount}, worldObjectId=${building.model.userData?.worldObjectId || '❌无'}`);
      } else {
        skippedObjects.push({ id, name: building.data?.name || '未命名' });
      }
    });

    // 添加媒体对象（图片/视频）到射线检测范围
    if (this.world._mediaMeshes) {
      this.world._mediaMeshes.forEach((media, id) => {
        if (media.mesh) {
          // 补充 worldObjectId 以便射线选中后能识别
          if (!media.mesh.userData.worldObjectId) {
            media.mesh.userData.worldObjectId = id;
            media.mesh.userData.name = media.obj.name || `媒体对象_${id}`;
          }
          editableObjects.push(media.mesh);
          console.log(`   ➕ 可选(媒体): ID=${id}, 类型="${media.type}", 名称="${media.obj.name || '未命名'}"`);
        }
      });
    }

    // 添加传送门到射线检测范围（排除已在 generatedBuildings 中的广告位传送门）
    if (this.world.portals) {
      this.world.portals.forEach((portal, id) => {
        if (portal.group && !this.world.generatedBuildings.has(id)) {
          if (!portal.group.userData.worldObjectId) {
            portal.group.userData.worldObjectId = id;
            portal.group.userData.name = portal.name;
          }
          editableObjects.push(portal.group);
          console.log(`   ➕ 可选(传送门): ID=${id}, 名称="${portal.name}"`);
        }
      });
    }
    
    console.log(`📦 可选择对象总数: ${editableObjects.length}`);
    if (skippedObjects.length > 0) {
      console.warn(`⚠️ 因 model 为空而跳过的对象 (${skippedObjects.length}个):`, skippedObjects);
    }
    
    // 检测碰撞
    const intersects = this.raycaster.intersectObjects(editableObjects, true);
    
    console.log(`🎯 射线检测结果: 命中 ${intersects.length} 个对象`);
    
    if (intersects.length > 0) {
      console.log(`✅ 第一个命中对象详情:`);
      console.log(`   类型: ${intersects[0].object.type}`);
      console.log(`   名称: ${intersects[0].object.name || '(无名)'}`);
      console.log(`   距离: ${intersects[0].distance.toFixed(2)}`);
      console.log(`   点坐标: (${intersects[0].point.x.toFixed(2)}, ${intersects[0].point.y.toFixed(2)}, ${intersects[0].point.z.toFixed(2)})`);
      console.log(`   userData:`, intersects[0].object.userData);
      console.log(`   parent链:`, this.getParentChain(intersects[0].object));
      
      // 找到最顶层的建筑对象（改进版查找逻辑）
      let targetObject = intersects[0].object;
      let traversalSteps = 0;
      const maxTraversal = 20;
      
      console.log(`🔍 开始向上查找 worldObjectId...`);
      while (targetObject.parent && !targetObject.userData.worldObjectId && traversalSteps < maxTraversal) {
        console.log(`   ↗️ 第${traversalSteps + 1}步: ${targetObject.type}/${targetObject.name || '(无名)'} → 父级: ${targetObject.parent.type}/${targetObject.parent.name || '(无名)'}`);
        targetObject = targetObject.parent;
        traversalSteps++;
      }
      
      if (traversalSteps >= maxTraversal) {
        console.error(`❌ 向上查找超过${maxTraversal}步，可能存在循环引用或所有节点都缺少 worldObjectId!`);
      }
      
      console.log(`🎯 最终选中对象: type=${targetObject.type}, name=${targetObject.name || targetObject.userData?.name || '(无名)'}, worldObjectId=${targetObject.userData?.worldObjectId || '❌未找到'}, 遍历步数=${traversalSteps}`);
      
      this.selectObject(targetObject);
    } else {
      console.log(`⚠️ 未命中任何对象。可能原因:`);
      console.log(`   1. 点击的是天空/地面等非建筑对象`);
      console.log(`   2. 建筑模型尚未加载完成`);
      console.log(`   3. 射线被其他UI元素阻挡`);
      console.log(`   4. 对象不在 editableObjects 列表中`);
    }
    
    console.groupEnd();
  }
  
  /**
   * 选中对象
   */
  selectObject(object) {
    console.group('✅ [SelectDebug] 选中对象');
    console.log('目标对象:', object);
    console.log('对象类型:', object.type);
    console.log('对象名称:', object.name || object.userData?.name || '(无名)');
    console.log('userData:', object.userData);
    
    this.selectedObject = object;
    
    // 获取建筑数据
    let buildingData = Array.from(this.world.generatedBuildings.values())
      .find(b => b.model === object);
    
    console.log('匹配到的建筑数据 (===比较):', buildingData);
    
    if (!buildingData) {
      console.warn('❌ 未找到对应的建筑数据!');
      console.warn('   尝试原因: 对象可能是clone()副本、引用已被替换、generatedBuildings中存储不同引用');
      
      // 回退方案1: 通过 userData.worldObjectId 匹配
      if (object.userData?.worldObjectId) {
        console.log(`🔄 回退1: 通过 worldObjectId=${object.userData.worldObjectId} 匹配...`);
        const altMatch = Array.from(this.world.generatedBuildings.entries())
          .find(([id, b]) => b.data?.id == object.userData.worldObjectId || id == object.userData.worldObjectId);
        if (altMatch) {
          console.log(`✅ 回退1成功:`, altMatch[0], altMatch[1]);
          buildingData = altMatch[1];
        }
      }
      
      // 回退方案2: 通过对象名称匹配
      if (!buildingData && object.userData?.name) {
        console.log(`🔄 回退2: 通过名称="${object.userData.name}" 匹配...`);
        const nameMatch = Array.from(this.world.generatedBuildings.entries())
          .find(([id, b]) => b.data?.name === object.userData.name);
        if (nameMatch) {
          console.log(`✅ 回退2成功:`, nameMatch[0], nameMatch[1]);
          buildingData = nameMatch[1];
        }
      }
      
      if (!buildingData) {
        // 回退方案3: 媒体对象特殊处理 - 从 _mediaMeshes 查找
        if (object.userData?.mediaType) {
          const mediaId = object.userData.worldObjectId;
          if (this.world._mediaMeshes && this.world._mediaMeshes.has(mediaId)) {
            const mediaEntry = this.world._mediaMeshes.get(mediaId);
            console.log(`🎬 回退3: 从_mediaMeshes找到媒体对象 ID=${mediaId}`);
            buildingData = {
              model: object,
              data: {
                id: mediaId,
                name: object.userData.name || `媒体对象_${mediaId}`,
                type: object.userData.mediaType === 'video' ? 'media_video' : 'media_image',
                worldObjectId: mediaId
              },
              isGeometry: false,
              isPlaceholder: false,
              isMedia: true
            };
          }
        }
        
        // 回退方案4: 传送门特殊处理 - 从 portals 查找
        if (!buildingData && object.userData?.portalType) {
          const portalId = object.userData.worldObjectId;
          if (this.world.portals && this.world.portals.has(portalId)) {
            const portalEntry = this.world.portals.get(portalId);
            console.log(`🚪 回退4: 从portals找到传送门 ID=${portalId}`);
            buildingData = {
              model: object,
              data: {
                id: portalId,
                name: portalEntry.name || object.userData.name || `传送门_${portalId}`,
                type: 'portal',
                worldObjectId: portalId
              },
              isGeometry: false,
              isPlaceholder: false,
              isPortal: true
            };
          }
        }
      }
      
      // 回退方案5: 通用兜底 - 对于任何有 worldObjectId 的对象直接构造 buildingData
      if (!buildingData && object.userData?.worldObjectId) {
        const fallbackId = object.userData.worldObjectId;
        console.log(`🛡️ 回退5: 通用兜底 - 直接使用对象自身信息 ID=${fallbackId} 名称=${object.userData.name || '未命名'}`);
        buildingData = {
          model: object,
          data: {
            id: fallbackId,
            name: object.userData.name || `对象_${fallbackId}`,
            type: object.userData.type || 'unknown',
            worldObjectId: fallbackId
          },
          isGeometry: false,
          isPlaceholder: false,
          isFallback: true
        };
      }
      
      if (!buildingData) {
        console.error('❌ 所有匹配方案失败! 列出所有generatedBuildings条目:');
        console.table(Array.from(this.world.generatedBuildings.entries()).map(([id, b]) => ({
          id, name: b.data?.name, hasModel: !!b.model, worldObjectId: b.model?.userData?.worldObjectId
        })));
        console.groupEnd();
        return;
      }
    }
    
    console.log('✅ 建筑数据匹配成功! 数据ID:', buildingData.data?.id, '名称:', buildingData.data?.name);
    console.log('   类型:', buildingData.data?.type, 'isGeometry:', buildingData.isGeometry, 'isPlaceholder:', buildingData.isPlaceholder);
    
    // 更新UI
    document.getElementById('selected-object-info').style.display = 'block';
    document.getElementById('selected-object-name').textContent = 
      object.userData.name || '未命名建筑';
    document.getElementById('object-name-input').value = 
      object.userData.name || '';
    
    // 修复：被实例合批摘除的模型(parent=null)会导致 TransformControls 每帧 detach，先恢复独立渲染
    if (object.parent === null && window.WorldInstanceMerger && window.WorldInstanceMerger.excludeModel) {
      console.log('🔄 [合批修复] 选中对象不在场景图中(被实例合批摘除)，恢复独立渲染...');
      window.WorldInstanceMerger.excludeModel(object);
    }

    // 附加变换控制器
    if (this.transformControls) {
      this.transformControls.attach(object);
      this.setTransformMode('translate');
      console.log('✅ 变换控制器已附加');
    } else {
      console.warn('⚠️ transformControls 不存在!');
    }
    
    // 添加高亮效果
    try {
      this.addHighlight(object);
      console.log('✅ 高亮效果已添加');
    } catch (e) {
      console.error('❌ 添加高亮失败:', e);
    }
    
    this.updateObjectInfo();
    
    UI.showNotification('✅ 已选中', object.userData.name || '建筑', 2000);
    console.groupEnd();
  }
  
  /**
   * 取消选中
   */
  deselectObject() {
    if (this.selectedObject) {
      this.removeHighlight(this.selectedObject);
      
      if (this.transformControls) {
        this.transformControls.detach();
      }
      
      this.selectedObject = null;
      document.getElementById('selected-object-info').style.display = 'none';
    }
  }
  
  /**
   * 设置变换模式
   */
  setTransformMode(mode) {
    if (this.transformControls) {
      this.transformControls.setMode(mode);
      
      // 更新按钮状态
      document.querySelectorAll('.transform-btn').forEach(btn => {
        if (btn.dataset.mode === mode) {
          btn.style.opacity = '1';
          btn.style.fontWeight = 'bold';
        } else {
          btn.style.opacity = '0.6';
          btn.style.fontWeight = 'normal';
        }
      });
    }
  }
  
  /**
   * 更新对象信息显示
   */
  updateObjectInfo() {
    if (!this.selectedObject) return;
    
    const pos = this.selectedObject.position;
    const rot = this.selectedObject.rotation;
    const scale = this.selectedObject.scale;
    
    document.getElementById('position-display').textContent = 
      `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`;
    document.getElementById('rotation-display').textContent = 
      `${(rot.x * 180 / Math.PI).toFixed(0)}°, ${(rot.y * 180 / Math.PI).toFixed(0)}°, ${(rot.z * 180 / Math.PI).toFixed(0)}°`;
    document.getElementById('scale-display').textContent = 
      `${scale.x.toFixed(2)}, ${scale.y.toFixed(2)}, ${scale.z.toFixed(2)}`;
  }
  
  /**
   * 添加高亮效果
   */
  addHighlight(object) {
    object.traverse((child) => {
      if (child.isMesh) {
        child.userData.originalEmissive = child.material.emissive ? child.material.emissive.getHex() : 0x000000;
        if (child.material.emissive) {
          child.material.emissive.setHex(0x00ff00);
        }
      }
    });
  }
  
  /**
   * 移除高亮效果
   */
  removeHighlight(object) {
    object.traverse((child) => {
      if (child.isMesh && child.userData.originalEmissive !== undefined) {
        if (child.material.emissive) {
          child.material.emissive.setHex(child.userData.originalEmissive);
        }
        delete child.userData.originalEmissive;
      }
    });
  }
  
  /**
   * 保存更改
   */
  async saveChanges() {
    if (!this.selectedObject) return;
    
    try {
      const worldObjectId = this.selectedObject.userData.worldObjectId;
      const newName = document.getElementById('object-name-input').value;
      
      if (!worldObjectId) {
        UI.showNotification('❌ 错误', '无法获取对象ID', 2000);
        return;
      }

      // 【修复】媒体对象（图片/视频）的尺寸已编码在 PlaneGeometry 中，
      // 不应将 mesh.scale(1,1,1) 写回 DB 覆盖原始显示尺寸
      const isMedia = !!(this.selectedObject.userData.mediaType);
      const bodyData = {
        name: newName,
        position_x: this.selectedObject.position.x,
        position_y: this.selectedObject.position.y,
        position_z: this.selectedObject.position.z,
        rotation_x: this.selectedObject.rotation.x,
        rotation_y: this.selectedObject.rotation.y,
        rotation_z: this.selectedObject.rotation.z
      };
      if (!isMedia) {
        bodyData.scale_x = this.selectedObject.scale.x;
        bodyData.scale_y = this.selectedObject.scale.y;
        bodyData.scale_z = this.selectedObject.scale.z;
      }
      
      const response = await fetch(`/api/world/objects/${worldObjectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(bodyData)
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.selectedObject.userData.name = newName;
        document.getElementById('selected-object-name').textContent = newName;
        
        // 如果保存到transform_overrides，更新本地缓存
        if (data.source === 'transform_overrides' && this.world._transformOverrides) {
          this.world._transformOverrides[worldObjectId] = data.override;
        }
        
        UI.showNotification('✅ 保存成功', '建筑已更新', 2000);
      } else if (response.status === 404) {
        // PUT /objects/:id 返回404，说明对象不在任何已知表中，尝试transform-overrides接口
        console.log('💡 常规保存返回404，尝试transform-overrides接口...');
        try {
          const overrideBodyData = {
            object_name: newName,
            position_x: this.selectedObject.position.x,
            position_y: this.selectedObject.position.y,
            position_z: this.selectedObject.position.z,
            rotation_x: this.selectedObject.rotation.x,
            rotation_y: this.selectedObject.rotation.y,
            rotation_z: this.selectedObject.rotation.z
          };
          if (!isMedia) {
            overrideBodyData.scale_x = this.selectedObject.scale.x;
            overrideBodyData.scale_y = this.selectedObject.scale.y;
            overrideBodyData.scale_z = this.selectedObject.scale.z;
          }
          const overrideResp = await fetch(`/api/world/transform-overrides/${worldObjectId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(overrideBodyData)
          });
          const overrideData = await overrideResp.json();
          if (overrideData.success) {
            this.selectedObject.userData.name = newName;
            document.getElementById('selected-object-name').textContent = newName;
            if (this.world._transformOverrides) {
              this.world._transformOverrides[worldObjectId] = overrideData.override;
            }
            UI.showNotification('✅ 保存成功', '位置覆盖已保存', 2000);
          } else {
            UI.showNotification('❌ 保存失败', overrideData.error || '未知错误', 3000);
          }
        } catch (overrideErr) {
          console.error('transform-overrides保存失败:', overrideErr);
          UI.showNotification('❌ 保存失败', overrideErr.message, 3000);
        }
      } else {
        UI.showNotification('❌ 保存失败', data.error, 3000);
      }
    } catch (error) {
      console.error('保存失败:', error);
      UI.showNotification('❌ 保存失败', error.message, 3000);
    }
  }
  
  /**
   * 复制对象
   */
  async copyObject() {
    if (!this.selectedObject) return;
    
    try {
      const worldObjectId = this.selectedObject.userData.worldObjectId;
      
      const response = await fetch(`/api/world/objects/${worldObjectId}/copy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          offset_x: 5, // 在旁边5米处复制
          offset_y: 0,
          offset_z: 0
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        UI.showNotification('✅ 复制成功', '已创建副本，请刷新页面查看', 3000);
        // 可以选择自动重新加载建筑
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        UI.showNotification('❌ 复制失败', data.error, 3000);
      }
    } catch (error) {
      console.error('复制失败:', error);
      UI.showNotification('❌ 复制失败', error.message, 3000);
    }
  }
  
  /**
   * 删除对象
   */
  async deleteObject() {
    if (!this.selectedObject) return;
    
    const confirmed = confirm(`确定要删除 "${this.selectedObject.userData.name || '此建筑'}" 吗？\n此操作无法撤销！`);
    if (!confirmed) return;
    
    try {
      const worldObjectId = this.selectedObject.userData.worldObjectId;
      
      const response = await fetch(`/api/world/objects/${worldObjectId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 从场景中移除
        this.world.scene.remove(this.selectedObject);
        
        // 从建筑集合中移除
        this.world.generatedBuildings.delete(worldObjectId);
        
        this.deselectObject();
        
        UI.showNotification('✅ 删除成功', '建筑已移除', 2000);
      } else {
        UI.showNotification('❌ 删除失败', data.error, 3000);
      }
    } catch (error) {
      console.error('删除失败:', error);
      UI.showNotification('❌ 删除失败', error.message, 3000);
    }
  }
  
  /**
   * 设置白天模式
   */
  setDayMode() {
    if (!this.isAdminMode) {
      UI.showNotification('⚠️ 提示', '请先启用编辑模式', 2000);
      return;
    }
    
    // 查找场景中的光源
    const ambientLight = this.world.scene.children.find(obj => obj instanceof THREE.AmbientLight);
    const directionalLight = this.world.scene.children.find(obj => obj instanceof THREE.DirectionalLight);
    const hemisphereLight = this.world.scene.children.find(obj => obj instanceof THREE.HemisphereLight);
    
    // 设置白天光照
    if (ambientLight) {
      ambientLight.intensity = 0.9;
      ambientLight.color.setHex(0xffffff);
    }
    
    if (directionalLight) {
      directionalLight.intensity = 0.5;
      directionalLight.color.setHex(0xffffff);
      directionalLight.position.set(100, 100, 50);
    }
    
    if (hemisphereLight) {
      hemisphereLight.intensity = 0.4;
      hemisphereLight.color.setHex(0x87ceeb); // 天空蓝
      hemisphereLight.groundColor.setHex(0x545454);
    }
    
    // 设置场景背景
    this.world.scene.background = new THREE.Color(0x87ceeb);
    if (this.world.scene.fog) {
      this.world.scene.fog.color.setHex(0x87ceeb);
    }
    
    UI.showNotification('☀️ 白天模式', '已切换到白天光照', 2000);
  }
  
  /**
   * 设置夜晚模式
   */
  setNightMode() {
    if (!this.isAdminMode) {
      UI.showNotification('⚠️ 提示', '请先启用编辑模式', 2000);
      return;
    }
    
    // 查找场景中的光源
    const ambientLight = this.world.scene.children.find(obj => obj instanceof THREE.AmbientLight);
    const directionalLight = this.world.scene.children.find(obj => obj instanceof THREE.DirectionalLight);
    const hemisphereLight = this.world.scene.children.find(obj => obj instanceof THREE.HemisphereLight);
    
    // 设置夜晚光照（保持建筑物明亮）
    if (ambientLight) {
      ambientLight.intensity = 0.7; // 提高强度，让建筑保持明亮
      ambientLight.color.setHex(0x9999cc); // 淡蓝白色光
    }
    
    if (directionalLight) {
      directionalLight.intensity = 0.3; // 提高月光强度
      directionalLight.color.setHex(0xccddff); // 更明亮的月光
      directionalLight.position.set(-100, 50, -50); // 月光位置
    }
    
    if (hemisphereLight) {
      hemisphereLight.intensity = 0.3;
      hemisphereLight.color.setHex(0x2a2a4a); // 淡紫夜空
      hemisphereLight.groundColor.setHex(0x444444); // 提高地面光
    }
    
    // 设置场景背景为深夜色，但光照保持明亮
    this.world.scene.background = new THREE.Color(0x0a0a1e);
    if (this.world.scene.fog) {
      this.world.scene.fog.color.setHex(0x0a0a1e);
    }
    
    UI.showNotification('🌙 夜晚模式', '已切换到夜晚光照（建筑保持明亮）', 2000);
  }
  
  /**
   * 更新循环
   */
  update() {
    if (this.isAdminMode && this.selectedObject) {
      this.updateObjectInfo();
    }
  }
  
  /**
   * 辅助方法：计算对象中的 mesh 数量
   */
  countMeshes(object) {
    let count = 0;
    object.traverse(child => {
      if (child.isMesh) count++;
    });
    return count;
  }
  
  /**
   * 辅助方法：获取父级链（用于调试）
   */
  getParentChain(object) {
    const chain = [];
    let current = object;
    let depth = 0;
    while (current && depth < 10) {
      chain.push(`${current.type}${current.name ? ':' + current.name : ''}`);
      current = current.parent;
      depth++;
    }
    return chain.join(' → ');
  }
  
  /**
   * 调试方法：输出完整的建筑状态报告（可在控制台调用）
   * 使用方式: window.gameWorld.buildingManager.debugFullReport()
   */
  debugFullReport() {
    console.group('📊 [FullReport] 完整建筑状态报告');
    console.log(`=== 报告时间: ${new Date().toLocaleString()} ===\n`);
    
    console.log(`1. 基础信息:`);
    console.log(`   isAdminMode: ${this.isAdminMode}`);
    console.log(`   selectedObject: ${this.selectedObject ? this.selectedObject.userData?.name || '(匿名)' : 'null'}`);
    console.log(`   transformControls: ${this.transformControls ? '✅ 已初始化' : '❌ null'}`);
    console.log(`   generatedBuildings.size: ${this.world.generatedBuildings?.size || 0}`);
    
    console.log(`\n2. 所有建筑详情:\n`);
    if (this.world.generatedBuildings) {
      const report = [];
      this.world.generatedBuildings.forEach((building, idx) => {
        report.push({
          '序号': idx,
          'ID': building.data?.id || '?',
          '名称': building.data?.name || '(未命名)',
          '类型': building.data?.type || '?',
          'Model': building.model ? '✅ 存在' : '❌ null',
          '在场景中': building.model && building.model.parent === this.world.scene ? '✅ 是' : '❌ 否',
          'worldObjectId': building.model?.userData?.worldObjectId || '❌ 无',
          'isPlaceholder': building.isPlaceholder ? '⚠️ 是' : '否',
          'isGeometry': building.isGeometry ? '🔨 是' : '否',
          'Mesh数量': building.model ? this.countMeshes(building.model) : 0
        });
      });
      console.table(report);
      
      const problems = report.filter(r => r.Model !== '✅ 存在' || r['在场景中'] !== '✅ 是');
      if (problems.length > 0) {
        console.warn(`\n⚠️ 发现 ${problems.length} 个问题建筑:`);
        console.table(problems);
      }
    }
    
    console.log(`\n3. 场景中的直接子对象数量: ${this.world.scene?.children?.length || 0}`);
    
    console.groupEnd();
    return this;
  }
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.BuildingManager = BuildingManager;
}
