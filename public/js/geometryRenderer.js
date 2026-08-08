/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 几何体渲染器
 * 将AI生成的场景中的几何体对象渲染到虚拟世界中
 */

class GeometryRenderer {
  /**
   * 从world_object数据加载几何体对象
   * @param {Object} worldObject - 世界对象数据
   * @param {THREE} THREE - Three.js库
   * @returns {THREE.Group|null} - 创建的3D对象组
   */
  static loadFromWorldObject(worldObject, THREE) {
    try {
      // 安全检查：model_path 不能为空
      if (!worldObject || !worldObject.model_path) {
        console.warn('⚠️  worldObject 或 model_path 为空:', worldObject?.name);
        return this.createPlaceholder(worldObject, THREE);
      }
      
      // 解析model_path获取几何体类型
      // 格式: "geometry:cottage" 或 "geometry:tree" 或 "geometry_building:123"
      let geometryType;
      if (worldObject.model_path.startsWith('geometry_building:')) {
        geometryType = worldObject.model_path.replace('geometry_building:', '');
      } else {
        geometryType = worldObject.model_path.replace('geometry:', '');
      }
      
      console.log('🎨 创建几何体:', geometryType, worldObject);
      
      // 确保GeometryTemplates已加载
      if (typeof GeometryTemplates === 'undefined') {
        console.error('❌ GeometryTemplates未加载！');
        return null;
      }
      
      // 获取几何体模板
      const template = GeometryTemplates[geometryType];
      
      if (!template) {
        console.warn(`⚠️  未找到几何体模板: ${geometryType}`);
        return this.createPlaceholder(worldObject, THREE);
      }
      
      // 使用模板创建几何体
      const properties = worldObject.properties || {};
      const geometryObject = template(properties);
      
      if (!geometryObject) {
        console.error(`❌ 几何体模板返回null: ${geometryType}`);
        return this.createPlaceholder(worldObject, THREE);
      }
      
      // 创建一个Group来包装对象（便于统一管理）
      const group = new THREE.Group();
      
      // 如果是Mesh或Group，直接添加
      if (geometryObject.isMesh || geometryObject.isGroup) {
        group.add(geometryObject);
      } else {
        console.warn('⚠️  几何体类型未知，尝试直接添加');
        group.add(geometryObject);
      }
      
      // 设置位置
      group.position.set(
        worldObject.position_x,
        worldObject.position_y,
        worldObject.position_z
      );
      
      // 设置旋转
      group.rotation.set(
        worldObject.rotation_x,
        worldObject.rotation_y,
        worldObject.rotation_z
      );
      
      // 设置缩放
      group.scale.set(
        worldObject.scale_x,
        worldObject.scale_y,
        worldObject.scale_z
      );
      
      // 添加用户数据
      group.userData = {
        worldObjectId: worldObject.id,
        geometryType: geometryType,
        name: worldObject.name,
        type: worldObject.type,
        isGeometry: true
      };
      
      // 启用阴影
      group.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      
      console.log('✅ 几何体创建成功:', geometryType);
      return group;
      
    } catch (error) {
      console.error('❌ 创建几何体失败:', error);
      return this.createPlaceholder(worldObject, THREE);
    }
  }
  
  /**
   * 创建占位符对象（当几何体创建失败时）
   */
  static createPlaceholder(worldObject, THREE) {
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0x660000,
      transparent: true,
      opacity: 0.5
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    
    const group = new THREE.Group();
    group.add(mesh);
    
    group.position.set(
      worldObject.position_x,
      worldObject.position_y + 1,
      worldObject.position_z
    );
    
    group.userData = {
      worldObjectId: worldObject.id,
      name: worldObject.name + ' (ERROR)',
      isPlaceholder: true
    };
    
    console.warn('⚠️  使用占位符替代失败的几何体:', worldObject.name);
    return group;
  }
  
  /**
   * 通用组件渲染器：从 components[] 数组创建 Three.js 对象
   * 支持 type: box / sphere / cylinder / cone
   * @param {Array} components - 组件描述数组 [{type, width, height, depth, radius, color, position, ...}, ...]
   * @param {THREE} THREE - Three.js 库
   * @returns {THREE.Group}
   */
  static renderFromComponents(components, THREE) {
    const group = new THREE.Group();

    for (const comp of components) {
      let geometry;

      switch (comp.type) {
        case 'box':
          geometry = new THREE.BoxGeometry(
            comp.width || 1,
            comp.height || 1,
            comp.depth || 1
          );
          break;
        case 'sphere':
          geometry = new THREE.SphereGeometry(
            comp.radius || 1,
            comp.widthSegments || 12,
            comp.heightSegments || 8
          );
          break;
        case 'cylinder':
          geometry = new THREE.CylinderGeometry(
            comp.radiusTop !== undefined ? comp.radiusTop : comp.radius || 1,
            comp.radiusBottom !== undefined ? comp.radiusBottom : comp.radius || 1,
            comp.height || 1,
            comp.radialSegments || 16
          );
          break;
        case 'cone':
          geometry = new THREE.ConeGeometry(
            comp.radius || 1,
            comp.height || 2,
            comp.radialSegments || 8
          );
          break;
        default:
          console.warn('⚠️ renderFromComponents 未知类型:', comp.type);
          continue;
      }

      const matOpts = { color: comp.color || 0xcccccc };
      if (comp.emissive) matOpts.emissive = comp.emissive;
      if (comp.emissiveIntensity !== undefined) matOpts.emissiveIntensity = comp.emissiveIntensity;
      if (comp.transparent) matOpts.transparent = true;
      if (comp.opacity !== undefined) matOpts.opacity = comp.opacity;

      const material = new THREE.MeshStandardMaterial(matOpts);
      const mesh = new THREE.Mesh(geometry, material);

      if (comp.position) {
        mesh.position.set(
          comp.position.x || 0,
          comp.position.y || 0,
          comp.position.z || 0
        );
      }
      if (comp.rotation) {
        mesh.rotation.set(
          comp.rotation.x || 0,
          comp.rotation.y || 0,
          comp.rotation.z || 0
        );
      }
      if (comp.scale) {
        mesh.scale.set(
          comp.scale.x || 1,
          comp.scale.y || 1,
          comp.scale.z || 1
        );
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    return group;
  }

  /**
   * 批量加载多个几何体对象
   */
  static loadMultiple(worldObjects, THREE) {
    const loadedObjects = [];
    
    for (const worldObject of worldObjects) {
      const obj = this.loadFromWorldObject(worldObject, THREE);
      if (obj) {
        loadedObjects.push(obj);
      }
    }
    
    console.log(`✅ 批量加载完成: ${loadedObjects.length}/${worldObjects.length} 个对象`);
    return loadedObjects;
  }
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.GeometryRenderer = GeometryRenderer;
}
