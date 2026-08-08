/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 3D建筑管理功能

let allBuildings = [];
let filteredBuildings = [];
let currentBuildingId = null;

// 加载建筑列表
async function loadBuildings() {
  try {
    const content = document.getElementById('buildings-content');
    content.innerHTML = '<div class="loading">加载中...</div>';

    // 获取所有生成的建筑
    const buildingsResponse = await fetch('/api/hunyuan3d/buildings');
    const buildingsData = await buildingsResponse.json();

    // 获取世界对象（已放置的建筑）
    const worldObjectsResponse = await fetch('/api/world/objects');
    const worldObjectsData = await worldObjectsResponse.json();

    if (!buildingsData.success || !worldObjectsData.success) {
      throw new Error('加载数据失败');
    }

    // 合并数据
    allBuildings = buildingsData.buildings.map(building => {
      const worldObjects = worldObjectsData.objects.filter(
        obj => obj.building_id === building.id && obj.type === 'generated_building'
      );
      return {
        ...building,
        worldObjects: worldObjects,
        isPlaced: worldObjects.length > 0
      };
    });

    filteredBuildings = [...allBuildings];
    renderBuildings();
  } catch (error) {
    console.error('加载建筑失败:', error);
    document.getElementById('buildings-content').innerHTML = 
      `<div class="empty">❌ 加载失败: ${error.message}</div>`;
  }
}

// 渲染建筑列表
function renderBuildings() {
  const content = document.getElementById('buildings-content');

  if (filteredBuildings.length === 0) {
    content.innerHTML = '<div class="empty">暂无建筑数据</div>';
    return;
  }

  let html = '<div style="display: grid; gap: 20px;">';

  filteredBuildings.forEach(building => {
    const statusBadge = {
      'processing': '<span style="background: #ffa500; padding: 4px 8px; border-radius: 3px; font-size: 12px;">⏳ 生成中</span>',
      'completed': '<span style="background: #00ff00; color: #000; padding: 4px 8px; border-radius: 3px; font-size: 12px;">✅ 已完成</span>',
      'failed': '<span style="background: #ff0000; padding: 4px 8px; border-radius: 3px; font-size: 12px;">❌ 失败</span>'
    }[building.status] || '';

    const placedBadge = building.isPlaced ? 
      `<span style="background: #0088ff; padding: 4px 8px; border-radius: 3px; font-size: 12px;">📍 已放置 (${building.worldObjects.length})</span>` :
      '<span style="background: #666; padding: 4px 8px; border-radius: 3px; font-size: 12px;">未放置</span>';

    // 世界对象列表
    let worldObjectsHtml = '';
    if (building.worldObjects.length > 0) {
      worldObjectsHtml = '<div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(0,255,0,0.3);">';
      worldObjectsHtml += '<h4 style="color: #00ff00; margin-bottom: 10px; font-size: 14px;">📍 放置位置:</h4>';
      building.worldObjects.forEach((obj, index) => {
        worldObjectsHtml += `
          <div style="background: rgba(0,0,0,0.3); padding: 10px; margin-bottom: 8px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
            <div style="flex: 1;">
              <div style="font-size: 12px; color: #888;">位置 ${index + 1}</div>
              <div style="margin-top: 5px;">
                <span style="color: #00ff00; margin-right: 15px;">X: ${obj.position_x.toFixed(2)}</span>
                <span style="color: #00ff00; margin-right: 15px;">Y: ${obj.position_y.toFixed(2)}</span>
                <span style="color: #00ff00;">Z: ${obj.position_z.toFixed(2)}</span>
              </div>
              <div style="margin-top: 5px; font-size: 11px; color: #666;">
                旋转: (${(obj.rotation_x * 180 / Math.PI).toFixed(0)}°, ${(obj.rotation_y * 180 / Math.PI).toFixed(0)}°, ${(obj.rotation_z * 180 / Math.PI).toFixed(0)}°) | 
                缩放: (${obj.scale_x}, ${obj.scale_y}, ${obj.scale_z})
              </div>
            </div>
            <div style="display: flex; gap: 5px;">
              <button class="btn" style="padding: 5px 10px; font-size: 12px;" onclick="editWorldObject(${obj.id}, ${building.id})">✏️ 编辑</button>
              <button class="btn" style="padding: 5px 10px; font-size: 12px; background: #ff0000;" onclick="removeWorldObject(${obj.id})">🗑️</button>
            </div>
          </div>
        `;
      });
      worldObjectsHtml += '</div>';
    }

    html += `
      <div style="background: rgba(0, 0, 0, 0.5); padding: 20px; border-radius: 10px; border: 2px solid #00ff00;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
          <div style="flex: 1;">
            <h3 style="color: #00ff00; margin-bottom: 8px; font-size: 18px;">${building.name}</h3>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px;">
              ${statusBadge}
              ${placedBadge}
            </div>
            ${building.description ? `<p style="color: #888; font-size: 13px; margin-top: 8px;">${building.description}</p>` : ''}
          </div>
          <div style="display: flex; gap: 8px;">
            ${building.status === 'completed' && !building.isPlaced ? 
              `<button class="btn" onclick="placeBuilding(${building.id})" style="padding: 8px 15px; font-size: 13px;">📍 放置到世界</button>` : ''}
            ${building.status === 'completed' ? 
              `<button class="btn" onclick="viewBuilding(${building.id})" style="padding: 8px 15px; font-size: 13px;">👁️ 查看</button>` : ''}
            ${building.status === 'completed' ? 
              `<button class="btn" onclick="editBuildingTags(${building.id}, '${building.name}')" style="padding: 8px 15px; font-size: 13px; background: #8a2be2;">🏷️ 编辑标签</button>` : ''}
            <button class="btn" style="padding: 8px 15px; font-size: 13px; background: #ff0000;" onclick="deleteBuilding(${building.id})">🗑️ 删除</button>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; font-size: 13px;">
          <div>
            <span style="color: #888;">任务ID:</span>
            <span style="color: #fff;">${building.task_id}</span>
          </div>
          <div>
            <span style="color: #888;">创建时间:</span>
            <span style="color: #fff;">${new Date(building.created_at).toLocaleString()}</span>
          </div>
          ${building.completed_at ? `
            <div>
              <span style="color: #888;">完成时间:</span>
              <span style="color: #fff;">${new Date(building.completed_at).toLocaleString()}</span>
            </div>
          ` : ''}
          ${building.model_url ? `
            <div style="grid-column: 1 / -1;">
              <span style="color: #888;">模型URL:</span>
              <a href="${building.model_url}" target="_blank" style="color: #0088ff; text-decoration: none; word-break: break-all;">${building.model_url.substring(0, 80)}...</a>
            </div>
          ` : ''}
          ${building.local_path ? `
            <div style="grid-column: 1 / -1;">
              <span style="color: #888;">本地路径:</span>
              <span style="color: #00ff00;">${building.local_path}</span>
            </div>
          ` : ''}
        </div>

        ${worldObjectsHtml}
      </div>
    `;
  });

  html += '</div>';
  content.innerHTML = html;
}

// 筛选建筑
function filterBuildings() {
  const statusFilter = document.getElementById('filter-status').value;
  const placedFilter = document.getElementById('filter-placed').value;
  const searchText = document.getElementById('search-building').value.toLowerCase();

  filteredBuildings = allBuildings.filter(building => {
    // 状态筛选
    if (statusFilter && building.status !== statusFilter) return false;

    // 放置状态筛选
    if (placedFilter === 'placed' && !building.isPlaced) return false;
    if (placedFilter === 'notplaced' && building.isPlaced) return false;

    // 搜索筛选
    if (searchText && !building.name.toLowerCase().includes(searchText)) return false;

    return true;
  });

  renderBuildings();
}

// 刷新建筑列表
function refreshBuildings() {
  loadBuildings();
}

// 编辑世界对象
async function editWorldObject(worldObjectId, buildingId) {
  try {
    // 获取世界对象详情
    const response = await fetch(`/api/world/objects/${worldObjectId}`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    const obj = data.object;

    // 填充表单
    document.getElementById('building-id').value = buildingId;
    document.getElementById('world-object-id').value = worldObjectId;
    document.getElementById('building-name').value = obj.name;
    document.getElementById('building-pos-x').value = obj.position_x;
    document.getElementById('building-pos-y').value = obj.position_y;
    document.getElementById('building-pos-z').value = obj.position_z;
    document.getElementById('building-rot-x').value = (obj.rotation_x * 180 / Math.PI).toFixed(0);
    document.getElementById('building-rot-y').value = (obj.rotation_y * 180 / Math.PI).toFixed(0);
    document.getElementById('building-rot-z').value = (obj.rotation_z * 180 / Math.PI).toFixed(0);
    document.getElementById('building-scale-x').value = obj.scale_x;
    document.getElementById('building-scale-y').value = obj.scale_y;
    document.getElementById('building-scale-z').value = obj.scale_z;

    // 显示模态框
    document.getElementById('building-modal').classList.add('active');
  } catch (error) {
    console.error('加载建筑信息失败:', error);
    alert('❌ 加载失败: ' + error.message);
  }
}

// 保存建筑修改
async function saveBuildingChanges(event) {
  event.preventDefault();

  try {
    const worldObjectId = document.getElementById('world-object-id').value;
    const posX = parseFloat(document.getElementById('building-pos-x').value);
    const posY = parseFloat(document.getElementById('building-pos-y').value);
    const posZ = parseFloat(document.getElementById('building-pos-z').value);
    const rotX = parseFloat(document.getElementById('building-rot-x').value) * Math.PI / 180;
    const rotY = parseFloat(document.getElementById('building-rot-y').value) * Math.PI / 180;
    const rotZ = parseFloat(document.getElementById('building-rot-z').value) * Math.PI / 180;
    const scaleX = parseFloat(document.getElementById('building-scale-x').value);
    const scaleY = parseFloat(document.getElementById('building-scale-y').value);
    const scaleZ = parseFloat(document.getElementById('building-scale-z').value);

    const response = await fetch(`/api/world/objects/${worldObjectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        position_x: posX,
        position_y: posY,
        position_z: posZ,
        rotation_x: rotX,
        rotation_y: rotY,
        rotation_z: rotZ,
        scale_x: scaleX,
        scale_y: scaleY,
        scale_z: scaleZ
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    alert('✅ 修改已保存');
    closeBuildingModal();
    loadBuildings();
  } catch (error) {
    console.error('保存失败:', error);
    alert('❌ 保存失败: ' + error.message);
  }
}

// 统一缩放切换
function toggleUniformScale() {
  const isUniform = document.getElementById('building-uniform-scale').checked;
  const scaleX = document.getElementById('building-scale-x');
  const scaleY = document.getElementById('building-scale-y');
  const scaleZ = document.getElementById('building-scale-z');

  if (isUniform) {
    scaleX.addEventListener('input', syncScale);
    scaleY.addEventListener('input', syncScale);
    scaleZ.addEventListener('input', syncScale);
  } else {
    scaleX.removeEventListener('input', syncScale);
    scaleY.removeEventListener('input', syncScale);
    scaleZ.removeEventListener('input', syncScale);
  }
}

function syncScale(event) {
  const value = event.target.value;
  document.getElementById('building-scale-x').value = value;
  document.getElementById('building-scale-y').value = value;
  document.getElementById('building-scale-z').value = value;
}

// 关闭建筑模态框
function closeBuildingModal() {
  document.getElementById('building-modal').classList.remove('active');
}

// 删除世界对象
async function removeWorldObject(worldObjectId) {
  if (!confirm('确定要删除这个建筑实例吗？')) return;

  try {
    const response = await fetch(`/api/world/objects/${worldObjectId}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    alert('✅ 删除成功');
    loadBuildings();
  } catch (error) {
    console.error('删除失败:', error);
    alert('❌ 删除失败: ' + error.message);
  }
}

// 删除建筑
async function deleteBuilding(buildingId) {
  if (!confirm('确定要删除这个建筑吗？这将同时删除所有已放置的实例。')) return;

  try {
    const response = await fetch(`/api/hunyuan3d/building/${buildingId}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    alert('✅ 删除成功');
    loadBuildings();
  } catch (error) {
    console.error('删除失败:', error);
    alert('❌ 删除失败: ' + error.message);
  }
}

// 放置建筑到世界
async function placeBuilding(buildingId) {
  const posX = prompt('请输入X坐标:', '0');
  if (posX === null) return;

  const posY = prompt('请输入Y坐标:', '2');
  if (posY === null) return;

  const posZ = prompt('请输入Z坐标:', '0');
  if (posZ === null) return;

  try {
    const response = await fetch('/api/hunyuan3d/place-building', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buildingId: buildingId,
        position: {
          x: parseFloat(posX),
          y: parseFloat(posY),
          z: parseFloat(posZ)
        },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    alert('✅ 建筑已放置到世界中');
    loadBuildings();
  } catch (error) {
    console.error('放置失败:', error);
    alert('❌ 放置失败: ' + error.message);
  }
}

// 查看建筑
function viewBuilding(buildingId) {
  const building = allBuildings.find(b => b.id === buildingId);
  if (building && building.model_url) {
    window.open(building.model_url, '_blank');
  }
}

// 编辑建筑标签
function editBuildingTags(buildingId, buildingName) {
  currentBuildingId = buildingId;
  document.getElementById('building-tags-name').value = buildingName;
  document.getElementById('building-tags-input').value = '';
  document.getElementById('building-tags-modal').classList.add('active');
}

// 批量操作
function showBatchOperations() {
  alert('批量操作功能即将推出！');
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  // 如果当前在建筑管理标签页，加载数据
  if (window.location.hash === '#buildings') {
    loadBuildings();
  }
});
