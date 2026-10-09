/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 几何体建筑生成器
 * 使用Three.js基础几何体组合创建建筑，无需外部API
 */

class GeometryBuilder {
  constructor() {
    // 建筑模板库
    this.templates = {
      // 基础房屋
      simple_house: {
        name: '简易房屋',
        description: '基础立方体房屋',
        build: this.buildSimpleHouse.bind(this)
      },
      cottage: {
        name: '茅草屋',
        description: '带三角屋顶的小屋',
        build: this.buildCottage.bind(this)
      },
      tower: {
        name: '塔楼',
        description: '圆柱形高塔',
        build: this.buildTower.bind(this)
      },
      barn: {
        name: '谷仓',
        description: '长方形大型建筑',
        build: this.buildBarn.bind(this)
      },
      
      // 商业建筑
      shop: {
        name: '商店',
        description: '带招牌的商店',
        build: this.buildShop.bind(this)
      },
      market: {
        name: '市场摊位',
        description: '开放式摊位',
        build: this.buildMarket.bind(this)
      },
      
      // 功能建筑
      well: {
        name: '水井',
        description: '圆形水井',
        build: this.buildWell.bind(this)
      },
      fence: {
        name: '围栏',
        description: '木质围栏',
        build: this.buildFence.bind(this)
      },
      bridge: {
        name: '桥梁',
        description: '简易木桥',
        build: this.buildBridge.bind(this)
      },
      
      // 装饰物
      tree: {
        name: '树木',
        description: '圆锥形树',
        build: this.buildTree.bind(this)
      },
      rock: {
        name: '岩石',
        description: '随机岩石',
        build: this.buildRock.bind(this)
      },
      lamp: {
        name: '路灯',
        description: '照明路灯',
        build: this.buildLamp.bind(this)
      },
      
      // 中世纪建筑
      castle_wall: {
        name: '城墙',
        description: '石质城墙',
        build: this.buildCastleWall.bind(this)
      },
      watch_tower: {
        name: '瞭望塔',
        description: '高耸的瞭望塔',
        build: this.buildWatchTower.bind(this)
      },
      
      // 现代建筑
      apartment: {
        name: '公寓楼',
        description: '多层住宅',
        build: this.buildApartment.bind(this)
      },
      office: {
        name: '办公楼',
        description: '现代办公建筑',
        build: this.buildOffice.bind(this)
      },
      modern_house: {
        name: '现代住宅',
        description: '现代风格的独立住宅',
        build: this.buildModernHouse.bind(this)
      },
      futuristic_tower: {
        name: '未来塔楼',
        description: '未来风格的高耸塔楼',
        build: this.buildFuturisticTower.bind(this)
      },
      medieval_castle: {
        name: '中世纪城堡',
        description: '中世纪风格的城堡',
        build: this.buildMedievalCastle.bind(this)
      },
      forest: {
        name: '森林',
        description: '茂密的森林场景',
        build: this.buildForest.bind(this)
      },
      lake: {
        name: '湖泊',
        description: '宁静的湖泊场景',
        build: this.buildLake.bind(this)
      },

      // 基础几何体（可自定义尺寸 + 碰撞）
      box_primitive: {
        name: '长方体',
        description: '可自定义尺寸的长方体，支持碰撞检测',
        build: this.buildBoxPrimitive.bind(this)
      }
    };
  }

  /**
   * 获取所有可用模板
   */
  getTemplates() {
    return Object.keys(this.templates).map(key => ({
      id: key,
      name: this.templates[key].name,
      description: this.templates[key].description
    }));
  }

  /**
   * 根据模板ID生成建筑
   * @param {string} templateId - 模板ID
   * @param {object} options - 自定义选项（颜色、尺寸等）
   * @returns {object} 建筑数据（几何体描述）
   */
  generateBuilding(templateId, options = {}) {
    const template = this.templates[templateId];
    if (!template) {
      throw new Error(`未找到模板: ${templateId}`);
    }

    return template.build(options);
  }

  /**
   * 简易房屋：立方体 + 三角屋顶
   */
  buildSimpleHouse(options = {}) {
    const color = options.color || 0xd4a373;
    const roofColor = options.roofColor || 0x8b4513;
    const scale = options.scale || 1;

    return {
      name: '简易房屋',
      components: [
        // 主体
        {
          type: 'box',
          width: 4 * scale,
          height: 3 * scale,
          depth: 4 * scale,
          color: color,
          position: { x: 0, y: 1.5 * scale, z: 0 }
        },
        // 屋顶（压扁的金字塔）
        {
          type: 'cone',
          radiusBottom: 3.5 * scale,
          radiusTop: 0.5 * scale,
          height: 2 * scale,
          radialSegments: 4,
          color: roofColor,
          position: { x: 0, y: 4 * scale, z: 0 },
          rotation: { x: 0, y: Math.PI / 4, z: 0 }
        },
        // 门
        {
          type: 'box',
          width: 1 * scale,
          height: 2 * scale,
          depth: 0.2 * scale,
          color: 0x654321,
          position: { x: 0, y: 1 * scale, z: 2.1 * scale }
        },
        // 窗户
        {
          type: 'box',
          width: 0.8 * scale,
          height: 0.8 * scale,
          depth: 0.2 * scale,
          color: 0x87ceeb,
          position: { x: -1.2 * scale, y: 2 * scale, z: 2.1 * scale }
        }
      ]
    };
  }

  /**
   * 茅草屋：带尖屋顶
   */
  buildCottage(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '茅草屋',
      components: [
        // 墙壁
        {
          type: 'box',
          width: 5 * scale,
          height: 2.5 * scale,
          depth: 4 * scale,
          color: 0xc9a270,
          position: { x: 0, y: 1.25 * scale, z: 0 }
        },
        // 茅草屋顶（前半部分）
        {
          type: 'cone',
          radiusBottom: 4 * scale,
          radiusTop: 0.3 * scale,
          height: 3 * scale,
          radialSegments: 4,
          color: 0xb8860b,
          position: { x: 0, y: 4 * scale, z: 0 },
          rotation: { x: 0, y: Math.PI / 4, z: 0 }
        },
        // 门
        {
          type: 'box',
          width: 1.2 * scale,
          height: 2 * scale,
          depth: 0.3 * scale,
          color: 0x4a2511,
          position: { x: 0, y: 1 * scale, z: 2.2 * scale }
        },
        // 烟囱
        {
          type: 'box',
          width: 0.6 * scale,
          height: 2 * scale,
          depth: 0.6 * scale,
          color: 0x696969,
          position: { x: 1.5 * scale, y: 4.5 * scale, z: 0 }
        }
      ]
    };
  }

  /**
   * 塔楼：圆柱形
   */
  buildTower(options = {}) {
    const scale = options.scale || 1;
    const height = options.height || 8;
    
    return {
      name: '塔楼',
      components: [
        // 主体圆柱
        {
          type: 'cylinder',
          radiusTop: 2 * scale,
          radiusBottom: 2.5 * scale,
          height: height * scale,
          radialSegments: 16,
          color: 0x808080,
          position: { x: 0, y: (height / 2) * scale, z: 0 }
        },
        // 塔顶
        {
          type: 'cone',
          radiusBottom: 2.5 * scale,
          radiusTop: 0.2 * scale,
          height: 3 * scale,
          radialSegments: 16,
          color: 0x8b0000,
          position: { x: 0, y: (height + 1.5) * scale, z: 0 }
        },
        // 窗户层1
        {
          type: 'box',
          width: 0.8 * scale,
          height: 1.5 * scale,
          depth: 0.3 * scale,
          color: 0xffff00,
          position: { x: 0, y: (height * 0.3) * scale, z: 2.5 * scale }
        },
        // 窗户层2
        {
          type: 'box',
          width: 0.8 * scale,
          height: 1.5 * scale,
          depth: 0.3 * scale,
          color: 0xffff00,
          position: { x: 0, y: (height * 0.6) * scale, z: 2.5 * scale }
        }
      ]
    };
  }

  /**
   * 谷仓：大型长方形建筑
   */
  buildBarn(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '谷仓',
      components: [
        // 主体
        {
          type: 'box',
          width: 6 * scale,
          height: 4 * scale,
          depth: 8 * scale,
          color: 0x8b0000,
          position: { x: 0, y: 2 * scale, z: 0 }
        },
        // 屋顶
        {
          type: 'box',
          width: 6.5 * scale,
          height: 0.5 * scale,
          depth: 9 * scale,
          color: 0x696969,
          position: { x: 0, y: 4.5 * scale, z: 0 },
          rotation: { x: 0.2, y: 0, z: 0 }
        },
        // 大门
        {
          type: 'box',
          width: 3 * scale,
          height: 3 * scale,
          depth: 0.3 * scale,
          color: 0x654321,
          position: { x: 0, y: 1.5 * scale, z: 4.2 * scale }
        }
      ]
    };
  }

  /**
   * 商店
   */
  buildShop(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '商店',
      components: [
        // 主建筑
        {
          type: 'box',
          width: 5 * scale,
          height: 3.5 * scale,
          depth: 4 * scale,
          color: 0xff6b6b,
          position: { x: 0, y: 1.75 * scale, z: 0 }
        },
        // 平屋顶
        {
          type: 'box',
          width: 5.5 * scale,
          height: 0.3 * scale,
          depth: 4.5 * scale,
          color: 0x8b0000,
          position: { x: 0, y: 3.65 * scale, z: 0 }
        },
        // 招牌
        {
          type: 'box',
          width: 3 * scale,
          height: 0.8 * scale,
          depth: 0.2 * scale,
          color: 0xffd700,
          position: { x: 0, y: 4.3 * scale, z: 0 }
        },
        // 玻璃门
        {
          type: 'box',
          width: 2 * scale,
          height: 2.5 * scale,
          depth: 0.2 * scale,
          color: 0x87ceeb,
          position: { x: 0, y: 1.25 * scale, z: 2.1 * scale }
        }
      ]
    };
  }

  /**
   * 市场摊位
   */
  buildMarket(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '市场摊位',
      components: [
        // 柱子1
        {
          type: 'cylinder',
          radiusTop: 0.15 * scale,
          radiusBottom: 0.15 * scale,
          height: 2.5 * scale,
          radialSegments: 8,
          color: 0x8b4513,
          position: { x: -1.5 * scale, y: 1.25 * scale, z: -1.5 * scale }
        },
        // 柱子2
        {
          type: 'cylinder',
          radiusTop: 0.15 * scale,
          radiusBottom: 0.15 * scale,
          height: 2.5 * scale,
          radialSegments: 8,
          color: 0x8b4513,
          position: { x: 1.5 * scale, y: 1.25 * scale, z: -1.5 * scale }
        },
        // 柱子3
        {
          type: 'cylinder',
          radiusTop: 0.15 * scale,
          radiusBottom: 0.15 * scale,
          height: 2.5 * scale,
          radialSegments: 8,
          color: 0x8b4513,
          position: { x: -1.5 * scale, y: 1.25 * scale, z: 1.5 * scale }
        },
        // 柱子4
        {
          type: 'cylinder',
          radiusTop: 0.15 * scale,
          radiusBottom: 0.15 * scale,
          height: 2.5 * scale,
          radialSegments: 8,
          color: 0x8b4513,
          position: { x: 1.5 * scale, y: 1.25 * scale, z: 1.5 * scale }
        },
        // 遮阳篷
        {
          type: 'box',
          width: 3.5 * scale,
          height: 0.2 * scale,
          depth: 3.5 * scale,
          color: 0xff6347,
          position: { x: 0, y: 2.6 * scale, z: 0 }
        },
        // 台面
        {
          type: 'box',
          width: 3 * scale,
          height: 0.2 * scale,
          depth: 2 * scale,
          color: 0xd2691e,
          position: { x: 0, y: 1 * scale, z: 0 }
        }
      ]
    };
  }

  /**
   * 水井
   */
  buildWell(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '水井',
      components: [
        // 井身
        {
          type: 'cylinder',
          radiusTop: 1.2 * scale,
          radiusBottom: 1.2 * scale,
          height: 1.5 * scale,
          radialSegments: 16,
          color: 0x808080,
          position: { x: 0, y: 0.75 * scale, z: 0 }
        },
        // 井口
        {
          type: 'torus',
          radius: 1 * scale,
          tube: 0.2 * scale,
          radialSegments: 16,
          tubularSegments: 32,
          color: 0x696969,
          position: { x: 0, y: 1.5 * scale, z: 0 },
          rotation: { x: Math.PI / 2, y: 0, z: 0 }
        },
        // 支柱1
        {
          type: 'cylinder',
          radiusTop: 0.1 * scale,
          radiusBottom: 0.1 * scale,
          height: 2 * scale,
          radialSegments: 8,
          color: 0x8b4513,
          position: { x: -1 * scale, y: 2.5 * scale, z: 0 }
        },
        // 支柱2
        {
          type: 'cylinder',
          radiusTop: 0.1 * scale,
          radiusBottom: 0.1 * scale,
          height: 2 * scale,
          radialSegments: 8,
          color: 0x8b4513,
          position: { x: 1 * scale, y: 2.5 * scale, z: 0 }
        },
        // 横梁
        {
          type: 'cylinder',
          radiusTop: 0.08 * scale,
          radiusBottom: 0.08 * scale,
          height: 2.2 * scale,
          radialSegments: 8,
          color: 0x654321,
          position: { x: 0, y: 3.5 * scale, z: 0 },
          rotation: { x: 0, y: 0, z: Math.PI / 2 }
        }
      ]
    };
  }

  /**
   * 树木
   */
  buildTree(options = {}) {
    const scale = options.scale || 1;
    const trunkColor = options.trunkColor || 0x8b4513;
    const foliageColor = options.foliageColor || 0x228b22;
    
    return {
      name: '树木',
      components: [
        // 树干
        {
          type: 'cylinder',
          radiusTop: 0.3 * scale,
          radiusBottom: 0.5 * scale,
          height: 3 * scale,
          radialSegments: 8,
          color: trunkColor,
          position: { x: 0, y: 1.5 * scale, z: 0 }
        },
        // 树冠层1
        {
          type: 'cone',
          radiusBottom: 2 * scale,
          radiusTop: 0,
          height: 2 * scale,
          radialSegments: 8,
          color: foliageColor,
          position: { x: 0, y: 4 * scale, z: 0 }
        },
        // 树冠层2
        {
          type: 'cone',
          radiusBottom: 1.5 * scale,
          radiusTop: 0,
          height: 1.5 * scale,
          radialSegments: 8,
          color: foliageColor,
          position: { x: 0, y: 5 * scale, z: 0 }
        }
      ]
    };
  }

  /**
   * 岩石
   */
  buildRock(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '岩石',
      components: [
        // 主岩石（变形球体）
        {
          type: 'sphere',
          radius: 1.5 * scale,
          widthSegments: 8,
          heightSegments: 6,
          color: 0x696969,
          position: { x: 0, y: 0.8 * scale, z: 0 },
          scale: { x: 1, y: 0.6, z: 1.2 }
        },
        // 小岩石1
        {
          type: 'sphere',
          radius: 0.6 * scale,
          widthSegments: 6,
          heightSegments: 5,
          color: 0x808080,
          position: { x: 1 * scale, y: 0.3 * scale, z: 0.5 * scale }
        },
        // 小岩石2
        {
          type: 'sphere',
          radius: 0.5 * scale,
          widthSegments: 6,
          heightSegments: 5,
          color: 0x778899,
          position: { x: -0.8 * scale, y: 0.2 * scale, z: -0.6 * scale }
        }
      ]
    };
  }

  /**
   * 路灯
   */
  buildLamp(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '路灯',
      components: [
        // 灯柱
        {
          type: 'cylinder',
          radiusTop: 0.15 * scale,
          radiusBottom: 0.2 * scale,
          height: 4 * scale,
          radialSegments: 8,
          color: 0x2f4f4f,
          position: { x: 0, y: 2 * scale, z: 0 }
        },
        // 灯罩支架
        {
          type: 'cylinder',
          radiusTop: 0.1 * scale,
          radiusBottom: 0.1 * scale,
          height: 1 * scale,
          radialSegments: 6,
          color: 0x2f4f4f,
          position: { x: 0.5 * scale, y: 4 * scale, z: 0 },
          rotation: { x: 0, y: 0, z: Math.PI / 3 }
        },
        // 灯罩
        {
          type: 'sphere',
          radius: 0.4 * scale,
          widthSegments: 16,
          heightSegments: 16,
          color: 0xffffe0,
          position: { x: 0.8 * scale, y: 4.3 * scale, z: 0 },
          emissive: 0xffff00,
          emissiveIntensity: 0.8
        }
      ]
    };
  }

  /**
   * 城墙
   */
  buildCastleWall(options = {}) {
    const scale = options.scale || 1;
    const length = options.length || 10;
    
    return {
      name: '城墙',
      components: [
        // 墙体
        {
          type: 'box',
          width: length * scale,
          height: 4 * scale,
          depth: 1 * scale,
          color: 0x808080,
          position: { x: 0, y: 2 * scale, z: 0 }
        },
        // 城垛（重复多个）
        ...this.createBattlements(length, scale)
      ]
    };
  }

  /**
   * 创建城垛
   */
  createBattlements(length, scale) {
    const battlements = [];
    const count = Math.floor(length / 1.5);
    const spacing = length / count;
    
    for (let i = 0; i < count; i++) {
      battlements.push({
        type: 'box',
        width: 0.8 * scale,
        height: 1 * scale,
        depth: 0.8 * scale,
        color: 0x696969,
        position: {
          x: (i * spacing - length / 2 + spacing / 2) * scale,
          y: 4.5 * scale,
          z: 0
        }
      });
    }
    
    return battlements;
  }

  /**
   * 瞭望塔
   */
  buildWatchTower(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '瞭望塔',
      components: [
        // 底座
        {
          type: 'box',
          width: 3 * scale,
          height: 1 * scale,
          depth: 3 * scale,
          color: 0x808080,
          position: { x: 0, y: 0.5 * scale, z: 0 }
        },
        // 主塔
        {
          type: 'cylinder',
          radiusTop: 1.2 * scale,
          radiusBottom: 1.5 * scale,
          height: 8 * scale,
          radialSegments: 8,
          color: 0x696969,
          position: { x: 0, y: 5 * scale, z: 0 }
        },
        // 顶部平台
        {
          type: 'cylinder',
          radiusTop: 1.8 * scale,
          radiusBottom: 1.8 * scale,
          height: 0.5 * scale,
          radialSegments: 8,
          color: 0x8b4513,
          position: { x: 0, y: 9.25 * scale, z: 0 }
        },
        // 屋顶
        {
          type: 'cone',
          radiusBottom: 1.5 * scale,
          radiusTop: 0.2 * scale,
          height: 2 * scale,
          radialSegments: 8,
          color: 0x8b0000,
          position: { x: 0, y: 10.5 * scale, z: 0 }
        }
      ]
    };
  }

  /**
   * 公寓楼
   */
  buildApartment(options = {}) {
    const scale = options.scale || 1;
    const floors = options.floors || 5;
    
    return {
      name: '公寓楼',
      components: [
        // 主建筑
        {
          type: 'box',
          width: 8 * scale,
          height: (floors * 3) * scale,
          depth: 6 * scale,
          color: 0xdcdcdc,
          position: { x: 0, y: (floors * 1.5) * scale, z: 0 }
        },
        // 窗户（多层）
        ...this.createApartmentWindows(floors, scale)
      ]
    };
  }

  /**
   * 创建公寓窗户
   */
  createApartmentWindows(floors, scale) {
    const windows = [];
    
    for (let floor = 0; floor < floors; floor++) {
      const y = (floor * 3 + 1.5) * scale;
      
      // 每层3个窗户
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 2.5 * scale;
        windows.push({
          type: 'box',
          width: 1.5 * scale,
          height: 1.8 * scale,
          depth: 0.2 * scale,
          color: 0x87ceeb,
          position: { x: x, y: y, z: 3.1 * scale }
        });
      }
    }
    
    return windows;
  }

  /**
   * 办公楼
   */
  buildOffice(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '办公楼',
      components: [
        // 主体
        {
          type: 'box',
          width: 10 * scale,
          height: 15 * scale,
          depth: 8 * scale,
          color: 0x4682b4,
          position: { x: 0, y: 7.5 * scale, z: 0 }
        },
        // 玻璃幕墙效果（多个蓝色窗户）
        ...this.createOfficeWindows(scale),
        // 入口
        {
          type: 'box',
          width: 3 * scale,
          height: 4 * scale,
          depth: 0.3 * scale,
          color: 0x000000,
          position: { x: 0, y: 2 * scale, z: 4.2 * scale }
        }
      ]
    };
  }

  /**
   * 创建办公楼窗户
   */
  createOfficeWindows(scale) {
    const windows = [];
    
    for (let floor = 0; floor < 5; floor++) {
      const y = (floor * 3 + 5) * scale;
      
      for (let col = 0; col < 4; col++) {
        const x = (col - 1.5) * 2.2 * scale;
        windows.push({
          type: 'box',
          width: 1.8 * scale,
          height: 2.5 * scale,
          depth: 0.2 * scale,
          color: 0x87cefa,
          position: { x: x, y: y, z: 4.1 * scale }
        });
      }
    }
    
    return windows;
  }

  /**
   * 围栏
   */
  buildFence(options = {}) {
    const scale = options.scale || 1;
    const length = options.length || 5;
    
    const components = [];
    const postCount = Math.floor(length / 1) + 1;
    
    // 栏杆柱
    for (let i = 0; i < postCount; i++) {
      components.push({
        type: 'box',
        width: 0.2 * scale,
        height: 1.5 * scale,
        depth: 0.2 * scale,
        color: 0x8b4513,
        position: { x: (i - (postCount - 1) / 2) * scale, y: 0.75 * scale, z: 0 }
      });
    }
    
    // 横杆
    components.push({
      type: 'box',
      width: length * scale,
      height: 0.15 * scale,
      depth: 0.15 * scale,
      color: 0x8b4513,
      position: { x: 0, y: 1.2 * scale, z: 0 }
    });
    
    components.push({
      type: 'box',
      width: length * scale,
      height: 0.15 * scale,
      depth: 0.15 * scale,
      color: 0x8b4513,
      position: { x: 0, y: 0.6 * scale, z: 0 }
    });
    
    return {
      name: '围栏',
      components: components
    };
  }

  /**
   * 桥梁
   */
  buildBridge(options = {}) {
    const scale = options.scale || 1;
    const length = options.length || 8;
    
    return {
      name: '桥梁',
      components: [
        // 桥面
        {
          type: 'box',
          width: length * scale,
          height: 0.3 * scale,
          depth: 3 * scale,
          color: 0x8b4513,
          position: { x: 0, y: 0.15 * scale, z: 0 }
        },
        // 左侧栏杆
        {
          type: 'box',
          width: length * scale,
          height: 0.8 * scale,
          depth: 0.2 * scale,
          color: 0x654321,
          position: { x: 0, y: 0.7 * scale, z: -1.4 * scale }
        },
        // 右侧栏杆
        {
          type: 'box',
          width: length * scale,
          height: 0.8 * scale,
          depth: 0.2 * scale,
          color: 0x654321,
          position: { x: 0, y: 0.7 * scale, z: 1.4 * scale }
        }
      ]
    };
  }

  /**
   * 现代住宅
   */
  buildModernHouse(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '现代住宅',
      components: [
        // 主体建筑
        {
          type: 'box',
          width: 6 * scale,
          height: 4 * scale,
          depth: 5 * scale,
          color: 0xffffff,
          position: { x: 0, y: 2 * scale, z: 0 }
        },
        // 平屋顶
        {
          type: 'box',
          width: 6.5 * scale,
          height: 0.3 * scale,
          depth: 5.5 * scale,
          color: 0x808080,
          position: { x: 0, y: 4.15 * scale, z: 0 }
        },
        // 窗户
        {
          type: 'box',
          width: 1.5 * scale,
          height: 1.8 * scale,
          depth: 0.2 * scale,
          color: 0x87ceeb,
          position: { x: -1.5 * scale, y: 2.5 * scale, z: 2.6 * scale }
        },
        {
          type: 'box',
          width: 1.5 * scale,
          height: 1.8 * scale,
          depth: 0.2 * scale,
          color: 0x87ceeb,
          position: { x: 1.5 * scale, y: 2.5 * scale, z: 2.6 * scale }
        },
        // 门
        {
          type: 'box',
          width: 1.2 * scale,
          height: 2.5 * scale,
          depth: 0.2 * scale,
          color: 0x8b4513,
          position: { x: 0, y: 1.25 * scale, z: 2.6 * scale }
        }
      ]
    };
  }

  /**
   * 未来塔楼
   */
  buildFuturisticTower(options = {}) {
    const scale = options.scale || 1;
    const height = options.height || 15;
    
    return {
      name: '未来塔楼',
      components: [
        // 主体
        {
          type: 'cylinder',
          radiusTop: 1.5 * scale,
          radiusBottom: 2 * scale,
          height: height * scale,
          radialSegments: 16,
          color: 0x00bfff,
          position: { x: 0, y: (height / 2) * scale, z: 0 }
        },
        // 顶部
        {
          type: 'cone',
          radiusBottom: 2 * scale,
          radiusTop: 0.5 * scale,
          height: 3 * scale,
          radialSegments: 16,
          color: 0x00ffff,
          position: { x: 0, y: (height + 1.5) * scale, z: 0 }
        },
        // 窗户
        ...this.createFuturisticWindows(height, scale)
      ]
    };
  }

  /**
   * 创建未来塔楼窗户
   */
  createFuturisticWindows(height, scale) {
    const windows = [];
    const floors = Math.floor(height / 2);
    
    for (let i = 0; i < floors; i++) {
      const y = (i * 2 + 1) * scale;
      windows.push({
        type: 'box',
        width: 0.5 * scale,
        height: 1 * scale,
        depth: 0.1 * scale,
        color: 0xffff00,
        position: { x: 0, y: y, z: 2 * scale }
      });
    }
    
    return windows;
  }

  /**
   * 中世纪城堡
   */
  buildMedievalCastle(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '中世纪城堡',
      components: [
        // 主体城堡
        {
          type: 'box',
          width: 10 * scale,
          height: 8 * scale,
          depth: 8 * scale,
          color: 0x696969,
          position: { x: 0, y: 4 * scale, z: 0 }
        },
        // 四个塔楼
        ...this.createCastleTowers(scale),
        // 城墙
        ...this.createCastleWalls(scale)
      ]
    };
  }

  /**
   * 创建城堡塔楼
   */
  createCastleTowers(scale) {
    const towers = [];
    const positions = [
      [-5, 0, -4], [5, 0, -4], [-5, 0, 4], [5, 0, 4]
    ];
    
    positions.forEach(pos => {
      // 塔楼
      towers.push({
        type: 'cylinder',
        radiusTop: 1.5 * scale,
        radiusBottom: 1.5 * scale,
        height: 10 * scale,
        radialSegments: 8,
        color: 0x808080,
        position: { x: pos[0] * scale, y: 5 * scale, z: pos[2] * scale }
      });
      // 塔顶
      towers.push({
        type: 'cone',
        radiusBottom: 2 * scale,
        radiusTop: 0.2 * scale,
        height: 3 * scale,
        radialSegments: 8,
        color: 0x8b0000,
        position: { x: pos[0] * scale, y: 11.5 * scale, z: pos[2] * scale }
      });
    });
    
    return towers;
  }

  /**
   * 创建城墙
   */
  createCastleWalls(scale) {
    const walls = [];
    // 四面墙
    walls.push({
      type: 'box',
      width: 12 * scale,
      height: 4 * scale,
      depth: 1 * scale,
      color: 0x696969,
      position: { x: 0, y: 2 * scale, z: -5 * scale }
    });
    walls.push({
      type: 'box',
      width: 12 * scale,
      height: 4 * scale,
      depth: 1 * scale,
      color: 0x696969,
      position: { x: 0, y: 2 * scale, z: 5 * scale }
    });
    walls.push({
      type: 'box',
      width: 1 * scale,
      height: 4 * scale,
      depth: 8 * scale,
      color: 0x696969,
      position: { x: -6 * scale, y: 2 * scale, z: 0 }
    });
    walls.push({
      type: 'box',
      width: 1 * scale,
      height: 4 * scale,
      depth: 8 * scale,
      color: 0x696969,
      position: { x: 6 * scale, y: 2 * scale, z: 0 }
    });
    
    return walls;
  }

  /**
   * 森林
   */
  buildForest(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '森林',
      components: [
        // 地面
        {
          type: 'box',
          width: 20 * scale,
          height: 0.1 * scale,
          depth: 20 * scale,
          color: 0x228b22,
          position: { x: 0, y: 0.05 * scale, z: 0 }
        },
        // 树木
        ...this.createForestTrees(scale)
      ]
    };
  }

  /**
   * 创建森林树木
   */
  createForestTrees(scale) {
    const trees = [];
    const treeCount = 15;
    
    for (let i = 0; i < treeCount; i++) {
      const x = (Math.random() - 0.5) * 18 * scale;
      const z = (Math.random() - 0.5) * 18 * scale;
      const height = 3 + Math.random() * 2;
      
      // 树干
      trees.push({
        type: 'cylinder',
        radiusTop: 0.3 * scale,
        radiusBottom: 0.5 * scale,
        height: height * scale,
        radialSegments: 8,
        color: 0x8b4513,
        position: { x: x, y: (height / 2) * scale, z: z }
      });
      // 树冠
      trees.push({
        type: 'sphere',
        radius: 1.5 * scale,
        widthSegments: 8,
        heightSegments: 8,
        color: 0x228b22,
        position: { x: x, y: (height + 1) * scale, z: z }
      });
    }
    
    return trees;
  }

  /**
   * 湖泊
   */
  buildLake(options = {}) {
    const scale = options.scale || 1;
    
    return {
      name: '湖泊',
      components: [
        // 湖底
        {
          type: 'box',
          width: 15 * scale,
          height: 0.5 * scale,
          depth: 10 * scale,
          color: 0x1e3a8a,
          position: { x: 0, y: -0.25 * scale, z: 0 }
        },
        // 湖面
        {
          type: 'box',
          width: 15 * scale,
          height: 0.1 * scale,
          depth: 10 * scale,
          color: 0x3b82f6,
          position: { x: 0, y: 0 * scale, z: 0 },
          transparent: true,
          opacity: 0.7
        },
        // 湖边草地
        {
          type: 'box',
          width: 17 * scale,
          height: 0.1 * scale,
          depth: 12 * scale,
          color: 0x228b22,
          position: { x: 0, y: 0.05 * scale, z: 0 }
        },
        // 湖边石头
        ...this.createLakeRocks(scale)
      ]
    };
  }

  /**
   * 创建湖边石头
   */
  createLakeRocks(scale) {
    const rocks = [];
    const rockCount = 8;
    
    for (let i = 0; i < rockCount; i++) {
      const angle = (i / rockCount) * Math.PI * 2;
      const radius = 7 * scale;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * (radius * 0.6);
      
      rocks.push({
        type: 'sphere',
        radius: 0.5 * scale,
        widthSegments: 6,
        heightSegments: 6,
        color: 0x696969,
        position: { x: x, y: 0.3 * scale, z: z },
        scale: { x: 1, y: 0.6, z: 1.2 }
      });
    }
    
    return rocks;
  }

  /**
   * 长方体：基础几何体，支持自定义尺寸和碰撞
   * @param {Object} options - 配置选项
   * @param {number} options.width - 宽度（米），默认2
   * @param {number} options.height - 高度（米），默认2
   * @param {number} options.depth - 深度（米），默认2
   * @param {number} options.color - 颜色（十六进制），默认灰色0x888888
   * @param {number} options.scale - 全局缩放比例，默认1
   */
  buildBoxPrimitive(options = {}) {
    const color = options.color || 0x888888;
    const scale = options.scale || 1;

    const width = (options.width || 2) * scale;
    const height = (options.height || 2) * scale;
    const depth = (options.depth || 2) * scale;

    return {
      name: '长方体',
      components: [
        {
          type: 'box',
          width: width,
          height: height,
          depth: depth,
          color: color,
          position: { x: 0, y: height / 2, z: 0 }
        }
      ]
    };
  }
  // ==================== Phase 5：SpecCompiler 后端（只增不改，2026-10-09）====================

  /**
   * seed 派生 PRNG（mulberry32）。确定性铁律：随机项一律走它，禁 Math.random（P4-1/P4-2）。
   */
  seededRandom(seed) {
    let a = (Math.floor(Number(seed) || 0) || 1) >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * getTemplateSchema —— 22 模板的可调参数清单（供 LLM 生成 spec.parts.templateId+params 用）。
   */
  getTemplateSchema() {
    const P = {
      scale: 'number 等比缩放(默认1)', color: 'number 主体色', roofColor: 'number 屋顶色',
      width: 'number 宽', height: 'number 高', depth: 'number 深', length: 'number 长',
      floors: 'number 层数', radius: 'number 半径', segments: 'number 分段',
    };
    const schema = {};
    for (const id of Object.keys(this.templates)) { schema[id] = { name: this.templates[id].name, params: {} }; }
    const set = (id, keys) => { keys.forEach((k) => { schema[id].params[k] = P[k]; }); };
    set('simple_house', ['color', 'roofColor', 'scale']);
    set('cottage', ['scale', 'color']);
    set('tower', ['radius', 'height', 'color', 'scale']);
    set('barn', ['width', 'height', 'depth', 'color', 'scale']);
    set('shop', ['width', 'height', 'depth', 'color', 'scale']);
    set('market', ['width', 'height', 'color', 'scale']);
    set('well', ['scale']);
    set('fence', ['length', 'height', 'color', 'scale']);
    set('bridge', ['length', 'width', 'color', 'scale']);
    set('tree', ['height', 'radius', 'scale']);
    set('rock', ['radius', 'scale']);
    set('lamp', ['height', 'color', 'scale']);
    set('castle_wall', ['length', 'height', 'color', 'scale']);
    set('watch_tower', ['radius', 'height', 'color', 'scale']);
    set('apartment', ['width', 'depth', 'floors', 'color', 'scale']);
    set('office', ['width', 'depth', 'floors', 'color', 'scale']);
    set('modern_house', ['width', 'depth', 'color', 'scale']);
    set('futuristic_tower', ['radius', 'height', 'floors', 'color', 'scale']);
    set('medieval_castle', ['scale', 'color']);
    set('forest', ['radius', 'scale']);
    set('lake', ['radius', 'scale']);
    set('box_primitive', ['width', 'height', 'depth', 'color', 'scale']);
    return schema;
  }

  /**
   * buildFromSpec —— Building Spec（withDefaults 产物）→ { name, components[] }。
   * ★ 确定性：同 seed 两次输出逐字节相同（P4-1）；seed 变 → 结果变（P4-2）。
   * 预算（maxComponents/maxTriangles）由 assetValidator 在调用侧把关，本函数只保证结构与确定性。
   */
  buildFromSpec(spec) {
    const s = spec && typeof spec === 'object' ? spec : {};
    const rnd = this.seededRandom(s.seed);
    const fp = s.footprint || { width: 6, depth: 6 };
    const style = s.style || {};
    const pal = style.palette || {};
    const op = s.openings || {};
    const comps = [];
    const push = (c) => comps.push(c);

    // ── 主体：levels 逐层逐层 box（每层 1 个 box，层间留 0.2 楼板缝）──
    let y = 0;
    const levels = Array.isArray(s.levels) && s.levels.length ? s.levels : [{ floors: 1, heightPerFloor: 3.2 }];
    const windowSpecs = [];
    for (const lv of levels) {
      const floors = Math.max(1, Math.floor(Number(lv.floors) || 1));
      const fh = Number(lv.heightPerFloor) || 3.2;
      for (let f = 0; f < floors; f++) {
        push({
          type: 'box',
          width: fp.width, height: fh - 0.2, depth: fp.depth,
          color: pal.wall,
          position: { x: 0, y: round2(y + (fh - 0.2) / 2), z: 0 },
        });
        // 窗：每层 windowsPerFloor 个，沿 +Z 面均布（ribbed=细长条）
        const winN = Math.max(0, Math.floor(Number(op.windowsPerFloor) || 0));
        for (let w = 0; w < winN; w++) {
          const step = fp.width / (winN + 1);
          const wx = -fp.width / 2 + step * (w + 1);
          const rib = String(style.glazing) === 'ribbed';
          windowSpecs.push({
            type: 'box',
            width: rib ? Number(op.windowWidth) * 0.4 : Number(op.windowWidth) || 1.2,
            height: rib ? 1.6 : (Number(op.windowWidth) || 1.2) * 0.9,
            depth: 0.15,
            color: pal.accent,
            emissive: pal.accent,
            emissiveIntensity: round2(0.25 + rnd() * 0.35),
            position: { x: round2(wx), y: round2(y + (Number(op.sillHeight) || 1.0) + 0.6), z: round2(fp.depth / 2 + 0.08) },
          });
        }
        y += fh;
      }
    }
    for (const w of windowSpecs) push(w);

    // ── 门：entrances 个，沿 +Z 面均布 ──
    const doorN = Math.max(1, Math.floor(Number(op.entrances) || 1));
    const doorStep = fp.width / (doorN + 1);
    const doorW = Number(op.doorWidth) || 1.2;
    for (let d = 0; d < doorN; d++) {
      push({
        type: 'box', width: doorW, height: 2.2, depth: 0.2,
        color: 0x654321,
        position: { x: round2(-fp.width / 2 + doorStep * (d + 1)), y: 1.1, z: round2(fp.depth / 2 + 0.1) },
      });
    }

    // ── 屋顶：roofStyle 决定形态（seed 只影响 overhang 微差）──
    const overhang = round2(0.3 + rnd() * 0.3);
    const roofStyle = String(style.roofStyle) === 'flat' ? 'flat' : String(style.roofStyle || 'pyramid');
    if (roofStyle === 'flat') {
      push({ type: 'box', width: fp.width + overhang, height: 0.4, depth: fp.depth + overhang, color: pal.roof, position: { x: 0, y: round2(y + 0.2), z: 0 } });
    } else if (roofStyle === 'dome') {
      push({ type: 'sphere', radius: Math.min(fp.width, fp.depth) / 2 + overhang, widthSegments: 16, heightSegments: 8, color: pal.roof, position: { x: 0, y: round2(y), z: 0 } });
    } else if (roofStyle === 'gable') {
      push({
        type: 'cone', radiusBottom: Math.max(fp.width, fp.depth) / 2 + overhang, radiusTop: 0.2,
        height: Math.min(fp.width, fp.depth) * 0.5, radialSegments: 4,
        color: pal.roof, position: { x: 0, y: round2(y + Math.min(fp.width, fp.depth) * 0.25), z: 0 },
        rotation: { x: 0, y: Math.PI / 4, z: 0 },
      });
    } else { // pyramid（默认）
      push({
        type: 'cone', radiusBottom: Math.max(fp.width, fp.depth) / 2 + overhang, radiusTop: 0.1,
        height: Math.min(fp.width, fp.depth) * 0.45, radialSegments: 4,
        color: pal.roof, position: { x: 0, y: round2(y + Math.min(fp.width, fp.depth) * 0.22), z: 0 },
        rotation: { x: 0, y: Math.PI / 4, z: 0 },
      });
    }

    // ── 线脚：footprint 顶边一圈薄 box（4 条，seed 交替深浅）──
    const trimH = 0.18;
    const trimAlt = rnd() > 0.5;
    const trimColor = trimAlt ? 0xf5f5f5 : 0xdddddd;
    push({ type: 'box', width: fp.width + 0.3, height: trimH, depth: 0.15, color: trimColor, position: { x: 0, y: round2(y - trimH), z: round2(fp.depth / 2) } });
    push({ type: 'box', width: fp.width + 0.3, height: trimH, depth: 0.15, color: trimColor, position: { x: 0, y: round2(y - trimH), z: round2(-fp.depth / 2) } });
    push({ type: 'box', width: 0.15, height: trimH, depth: fp.depth + 0.3, color: trimColor, position: { x: round2(fp.width / 2), y: round2(y - trimH), z: 0 } });
    push({ type: 'box', width: 0.15, height: trimH, depth: fp.depth + 0.3, color: trimColor, position: { x: round2(-fp.width / 2), y: round2(y - trimH), z: 0 } });

    return { name: s.name || String(s.buildingType || '建筑'), components: comps };
  }
}

function round2(v) { return Math.round(Number(v) * 100) / 100; }

module.exports = new GeometryBuilder();
