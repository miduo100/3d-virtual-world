/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 几何体模板库
 * 用于AI场景生成系统
 */

const GeometryTemplates = {
  
  // ===== 建筑类 =====
  
  cottage: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 墙体
    const wallGeom = new THREE.BoxGeometry(3 * scale, 2 * scale, 3 * scale);
    const wall = new THREE.Mesh(
      wallGeom,
      new THREE.MeshLambertMaterial({ color: 0xd4a574 })
    );
    wall.position.y = 1 * scale;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    
    // 茅草屋顶
    const roofGeom = new THREE.ConeGeometry(2.5 * scale, 1.5 * scale, 4);
    const roof = new THREE.Mesh(
      roofGeom,
      new THREE.MeshLambertMaterial({ color: 0xdaa520 })
    );
    roof.position.y = 2.75 * scale;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);
    
    // 门
    const doorGeom = new THREE.BoxGeometry(0.8 * scale, 1.2 * scale, 0.1 * scale);
    const door = new THREE.Mesh(
      doorGeom,
      new THREE.MeshLambertMaterial({ color: 0x654321 })
    );
    door.position.set(0, 0.6 * scale, 1.51 * scale);
    group.add(door);
    
    // 窗户
    const windowGeom = new THREE.BoxGeometry(0.6 * scale, 0.6 * scale, 0.1 * scale);
    const windowMat = new THREE.MeshLambertMaterial({ color: 0x87ceeb });
    
    const leftWindow = new THREE.Mesh(windowGeom, windowMat);
    leftWindow.position.set(-0.9 * scale, 1.2 * scale, 1.51 * scale);
    group.add(leftWindow);
    
    const rightWindow = new THREE.Mesh(windowGeom, windowMat);
    rightWindow.position.set(0.9 * scale, 1.2 * scale, 1.51 * scale);
    group.add(rightWindow);
    
    return group;
  },
  
  house: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 墙体
    const wallGeom = new THREE.BoxGeometry(4 * scale, 3 * scale, 4 * scale);
    const wall = new THREE.Mesh(
      wallGeom,
      new THREE.MeshLambertMaterial({ color: 0xf5deb3 })
    );
    wall.position.y = 1.5 * scale;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    
    // 三角形屋顶
    const roofGeom = new THREE.ConeGeometry(3.5 * scale, 2 * scale, 4);
    const roof = new THREE.Mesh(
      roofGeom,
      new THREE.MeshLambertMaterial({ color: 0x8b4513 })
    );
    roof.position.y = 4 * scale;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);
    
    return group;
  },
  
  skyscraper: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    const height = 10 + Math.random() * 10;
    
    // 主体建筑
    const buildingGeom = new THREE.BoxGeometry(3 * scale, height * scale, 3 * scale);
    const building = new THREE.Mesh(
      buildingGeom,
      new THREE.MeshLambertMaterial({ 
        color: 0x808080,
        emissive: 0x202020
      })
    );
    building.position.y = height * scale / 2;
    building.castShadow = true;
    building.receiveShadow = true;
    group.add(building);
    
    // 窗户网格
    for (let y = 1; y < height; y += 1.5) {
      for (let x = -1; x <= 1; x += 1) {
        const windowGeom = new THREE.BoxGeometry(0.4 * scale, 0.8 * scale, 0.05 * scale);
        const windowMat = new THREE.MeshLambertMaterial({ 
          color: 0xffff99,
          emissive: 0xffff00,
          emissiveIntensity: 0.3
        });
        const window = new THREE.Mesh(windowGeom, windowMat);
        window.position.set(x * scale, y * scale, 1.51 * scale);
        group.add(window);
      }
    }
    
    return group;
  },
  
  castle: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 主体城堡
    const mainGeom = new THREE.BoxGeometry(8 * scale, 6 * scale, 8 * scale);
    const main = new THREE.Mesh(
      mainGeom,
      new THREE.MeshLambertMaterial({ color: 0x696969 })
    );
    main.position.y = 3 * scale;
    main.castShadow = true;
    group.add(main);
    
    // 四个塔楼
    const towerPositions = [
      [-4, 0, -4], [4, 0, -4], [-4, 0, 4], [4, 0, 4]
    ];
    
    towerPositions.forEach(pos => {
      const towerGeom = new THREE.CylinderGeometry(1 * scale, 1 * scale, 8 * scale, 8);
      const tower = new THREE.Mesh(
        towerGeom,
        new THREE.MeshLambertMaterial({ color: 0x808080 })
      );
      tower.position.set(pos[0] * scale, 4 * scale, pos[2] * scale);
      tower.castShadow = true;
      group.add(tower);
      
      // 塔顶
      const topGeom = new THREE.ConeGeometry(1.2 * scale, 2 * scale, 8);
      const top = new THREE.Mesh(
        topGeom,
        new THREE.MeshLambertMaterial({ color: 0x8b0000 })
      );
      top.position.set(pos[0] * scale, 9 * scale, pos[2] * scale);
      group.add(top);
    });
    
    return group;
  },
  
  tower: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    const towerGeom = new THREE.CylinderGeometry(1.5 * scale, 2 * scale, 10 * scale, 8);
    const tower = new THREE.Mesh(
      towerGeom,
      new THREE.MeshLambertMaterial({ color: 0xa9a9a9 })
    );
    tower.position.y = 5 * scale;
    tower.castShadow = true;
    group.add(tower);
    
    // 顶部
    const topGeom = new THREE.ConeGeometry(2 * scale, 3 * scale, 8);
    const top = new THREE.Mesh(
      topGeom,
      new THREE.MeshLambertMaterial({ color: 0xcd5c5c })
    );
    top.position.y = 11.5 * scale;
    group.add(top);
    
    return group;
  },
  
  // ===== 自然类 =====
  
  mountain: function(properties = {}) {
    const scale = properties.scale || 1.0;
    const height = 8 + Math.random() * 4;
    
    const geometry = new THREE.ConeGeometry(5 * scale, height * scale, 8);
    
    // 随机扰动顶点（自然化）
    const vertices = geometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
      vertices[i] += (Math.random() - 0.5) * 0.8;
      vertices[i + 1] += (Math.random() - 0.5) * 0.5;
      vertices[i + 2] += (Math.random() - 0.5) * 0.8;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    
    const material = new THREE.MeshLambertMaterial({ 
      color: 0x8b7355
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    return mesh;
  },
  
  hill: function(properties = {}) {
    const scale = properties.scale || 1.0;
    
    const geometry = new THREE.SphereGeometry(3 * scale, 8, 6);
    geometry.scale(1, 0.5, 1);
    
    const material = new THREE.MeshLambertMaterial({ color: 0x90ee90 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -0.5 * scale;
    mesh.receiveShadow = true;
    
    return mesh;
  },
  
  tree: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 树干
    const trunkGeom = new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 2 * scale, 8);
    const trunk = new THREE.Mesh(
      trunkGeom,
      new THREE.MeshLambertMaterial({ color: 0x8b4513 })
    );
    trunk.position.y = 1 * scale;
    trunk.castShadow = true;
    group.add(trunk);
    
    // 树冠
    const crownGeom = new THREE.SphereGeometry(1.5 * scale, 8, 8);
    const crown = new THREE.Mesh(
      crownGeom,
      new THREE.MeshLambertMaterial({ color: 0x228b22 })
    );
    crown.position.y = 2.5 * scale;
    crown.castShadow = true;
    group.add(crown);
    
    return group;
  },
  
  rock: function(properties = {}) {
    const scale = properties.scale || 1.0;
    
    const geometry = new THREE.DodecahedronGeometry(1 * scale, 0);
    
    // 随机变形
    const vertices = geometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
      vertices[i] *= 0.7 + Math.random() * 0.6;
      vertices[i + 1] *= 0.7 + Math.random() * 0.6;
      vertices[i + 2] *= 0.7 + Math.random() * 0.6;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    
    const material = new THREE.MeshLambertMaterial({ 
      color: 0x808080
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.5 * scale;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    return mesh;
  },
  
  bush: function(properties = {}) {
    const scale = properties.scale || 1.0;
    
    const geometry = new THREE.SphereGeometry(0.8 * scale, 6, 6);
    const material = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.4 * scale;
    mesh.castShadow = true;
    
    return mesh;
  },
  
  flower: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 茎
    const stemGeom = new THREE.CylinderGeometry(0.05 * scale, 0.05 * scale, 0.8 * scale);
    const stem = new THREE.Mesh(
      stemGeom,
      new THREE.MeshLambertMaterial({ color: 0x228b22 })
    );
    stem.position.y = 0.4 * scale;
    group.add(stem);
    
    // 花朵
    const flowerGeom = new THREE.SphereGeometry(0.15 * scale, 6, 6);
    const colors = [0xff69b4, 0xffd700, 0xff0000, 0xff6347, 0xda70d6];
    const flower = new THREE.Mesh(
      flowerGeom,
      new THREE.MeshLambertMaterial({ 
        color: colors[Math.floor(Math.random() * colors.length)] 
      })
    );
    flower.position.y = 0.85 * scale;
    group.add(flower);
    
    return group;
  },
  
  crystal: function(properties = {}) {
    const scale = properties.scale || 1.0;
    
    const geometry = new THREE.OctahedronGeometry(1 * scale, 0);
    const material = new THREE.MeshLambertMaterial({ 
      color: 0x00ffff,
      emissive: 0x00ffff,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.8
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 1 * scale;
    mesh.rotation.y = Math.random() * Math.PI;
    
    return mesh;
  },
  
  // ===== 动物类 =====
  
  hen: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 身体
    const bodyGeom = new THREE.SphereGeometry(0.3 * scale, 8, 8);
    bodyGeom.scale(1, 0.8, 1.2);
    const body = new THREE.Mesh(
      bodyGeom,
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    body.position.y = 0.3 * scale;
    body.castShadow = true;
    group.add(body);
    
    // 头
    const headGeom = new THREE.SphereGeometry(0.15 * scale, 8, 8);
    const head = new THREE.Mesh(
      headGeom,
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    head.position.set(0, 0.5 * scale, 0.25 * scale);
    group.add(head);
    
    // 喙
    const beakGeom = new THREE.ConeGeometry(0.05 * scale, 0.15 * scale, 4);
    const beak = new THREE.Mesh(
      beakGeom,
      new THREE.MeshLambertMaterial({ color: 0xffa500 })
    );
    beak.position.set(0, 0.5 * scale, 0.35 * scale);
    beak.rotation.x = Math.PI / 2;
    group.add(beak);
    
    // 鸡冠
    const combGeom = new THREE.BoxGeometry(0.1 * scale, 0.2 * scale, 0.05 * scale);
    const comb = new THREE.Mesh(
      combGeom,
      new THREE.MeshLambertMaterial({ color: 0xff0000 })
    );
    comb.position.set(0, 0.65 * scale, 0.2 * scale);
    group.add(comb);
    
    return group;
  },
  
  chick: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 0.5;
    
    // 身体（缩小版母鸡）
    const bodyGeom = new THREE.SphereGeometry(0.2 * scale, 6, 6);
    const body = new THREE.Mesh(
      bodyGeom,
      new THREE.MeshLambertMaterial({ color: 0xffff99 })
    );
    body.position.y = 0.2 * scale;
    body.castShadow = true;
    group.add(body);
    
    // 头
    const headGeom = new THREE.SphereGeometry(0.1 * scale, 6, 6);
    const head = new THREE.Mesh(
      headGeom,
      new THREE.MeshLambertMaterial({ color: 0xffff99 })
    );
    head.position.set(0, 0.3 * scale, 0.15 * scale);
    group.add(head);
    
    return group;
  },
  
  cat: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 身体
    const bodyGeom = new THREE.BoxGeometry(0.4 * scale, 0.3 * scale, 0.6 * scale);
    const body = new THREE.Mesh(
      bodyGeom,
      new THREE.MeshLambertMaterial({ color: 0xff8800 })
    );
    body.position.y = 0.3 * scale;
    body.castShadow = true;
    group.add(body);
    
    // 头
    const headGeom = new THREE.SphereGeometry(0.2 * scale, 8, 8);
    const head = new THREE.Mesh(
      headGeom,
      new THREE.MeshLambertMaterial({ color: 0xff8800 })
    );
    head.position.set(0, 0.4 * scale, 0.35 * scale);
    group.add(head);
    
    // 耳朵
    const earGeom = new THREE.ConeGeometry(0.08 * scale, 0.15 * scale, 4);
    const leftEar = new THREE.Mesh(
      earGeom,
      new THREE.MeshLambertMaterial({ color: 0xff8800 })
    );
    leftEar.position.set(-0.12 * scale, 0.55 * scale, 0.35 * scale);
    group.add(leftEar);
    
    const rightEar = leftEar.clone();
    rightEar.position.x = 0.12 * scale;
    group.add(rightEar);
    
    // 尾巴
    const tailGeom = new THREE.CylinderGeometry(0.05 * scale, 0.02 * scale, 0.5 * scale);
    const tail = new THREE.Mesh(
      tailGeom,
      new THREE.MeshLambertMaterial({ color: 0xff8800 })
    );
    tail.position.set(0, 0.4 * scale, -0.35 * scale);
    tail.rotation.x = Math.PI / 3;
    group.add(tail);
    
    return group;
  },
  
  dog: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 身体
    const bodyGeom = new THREE.BoxGeometry(0.5 * scale, 0.4 * scale, 0.8 * scale);
    const body = new THREE.Mesh(
      bodyGeom,
      new THREE.MeshLambertMaterial({ color: 0x8b4513 })
    );
    body.position.y = 0.4 * scale;
    body.castShadow = true;
    group.add(body);
    
    // 头
    const headGeom = new THREE.BoxGeometry(0.3 * scale, 0.3 * scale, 0.3 * scale);
    const head = new THREE.Mesh(
      headGeom,
      new THREE.MeshLambertMaterial({ color: 0x8b4513 })
    );
    head.position.set(0, 0.5 * scale, 0.5 * scale);
    group.add(head);
    
    // 腿
    const legGeom = new THREE.CylinderGeometry(0.08 * scale, 0.08 * scale, 0.4 * scale);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
    
    const legPositions = [
      [-0.15, 0.2, 0.3], [0.15, 0.2, 0.3],
      [-0.15, 0.2, -0.3], [0.15, 0.2, -0.3]
    ];
    
    legPositions.forEach(pos => {
      const leg = new THREE.Mesh(legGeom, legMat);
      leg.position.set(pos[0] * scale, pos[1] * scale, pos[2] * scale);
      group.add(leg);
    });
    
    return group;
  },
  
  bird: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 身体
    const bodyGeom = new THREE.SphereGeometry(0.15 * scale, 6, 6);
    bodyGeom.scale(1, 0.8, 1.2);
    const body = new THREE.Mesh(
      bodyGeom,
      new THREE.MeshLambertMaterial({ color: 0x4169e1 })
    );
    body.position.y = 0.2 * scale;
    group.add(body);
    
    // 头
    const headGeom = new THREE.SphereGeometry(0.08 * scale, 6, 6);
    const head = new THREE.Mesh(
      headGeom,
      new THREE.MeshLambertMaterial({ color: 0x4169e1 })
    );
    head.position.set(0, 0.3 * scale, 0.12 * scale);
    group.add(head);
    
    return group;
  },
  
  // ===== 装饰类 =====
  
  fence: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 立柱
    const postGeom = new THREE.BoxGeometry(0.1 * scale, 1 * scale, 0.1 * scale);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
    
    for (let i = 0; i < 3; i++) {
      const post = new THREE.Mesh(postGeom, postMat);
      post.position.set(i * 0.5 * scale - 0.5 * scale, 0.5 * scale, 0);
      group.add(post);
    }
    
    // 横梁
    const railGeom = new THREE.BoxGeometry(1.5 * scale, 0.08 * scale, 0.08 * scale);
    const rail1 = new THREE.Mesh(railGeom, postMat);
    rail1.position.set(0, 0.7 * scale, 0);
    group.add(rail1);
    
    const rail2 = rail1.clone();
    rail2.position.y = 0.4 * scale;
    group.add(rail2);
    
    return group;
  },
  
  lamp: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 灯柱
    const poleGeom = new THREE.CylinderGeometry(0.08 * scale, 0.08 * scale, 3 * scale);
    const pole = new THREE.Mesh(
      poleGeom,
      new THREE.MeshLambertMaterial({ color: 0x696969 })
    );
    pole.position.y = 1.5 * scale;
    group.add(pole);
    
    // 灯罩
    const lampGeom = new THREE.SphereGeometry(0.3 * scale, 8, 8);
    const lamp = new THREE.Mesh(
      lampGeom,
      new THREE.MeshLambertMaterial({ 
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 0.8
      })
    );
    lamp.position.y = 3.2 * scale;
    group.add(lamp);
    
    return group;
  },
  
  bench: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 座位
    const seatGeom = new THREE.BoxGeometry(1.5 * scale, 0.1 * scale, 0.5 * scale);
    const seat = new THREE.Mesh(
      seatGeom,
      new THREE.MeshLambertMaterial({ color: 0x8b4513 })
    );
    seat.position.y = 0.5 * scale;
    group.add(seat);
    
    // 靠背
    const backGeom = new THREE.BoxGeometry(1.5 * scale, 0.6 * scale, 0.1 * scale);
    const back = new THREE.Mesh(
      backGeom,
      new THREE.MeshLambertMaterial({ color: 0x8b4513 })
    );
    back.position.set(0, 0.8 * scale, -0.2 * scale);
    group.add(back);
    
    // 腿
    const legGeom = new THREE.CylinderGeometry(0.05 * scale, 0.05 * scale, 0.5 * scale);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x696969 });
    
    const legPositions = [
      [-0.6, 0.25, 0.15], [0.6, 0.25, 0.15],
      [-0.6, 0.25, -0.15], [0.6, 0.25, -0.15]
    ];
    
    legPositions.forEach(pos => {
      const leg = new THREE.Mesh(legGeom, legMat);
      leg.position.set(pos[0] * scale, pos[1] * scale, pos[2] * scale);
      group.add(leg);
    });
    
    return group;
  },
  
  fountain: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 基座
    const baseGeom = new THREE.CylinderGeometry(2 * scale, 2 * scale, 0.3 * scale, 16);
    const base = new THREE.Mesh(
      baseGeom,
      new THREE.MeshLambertMaterial({ color: 0xd3d3d3 })
    );
    base.position.y = 0.15 * scale;
    group.add(base);
    
    // 水池
    const poolGeom = new THREE.CylinderGeometry(1.5 * scale, 1.5 * scale, 0.2 * scale, 16);
    const pool = new THREE.Mesh(
      poolGeom,
      new THREE.MeshLambertMaterial({ 
        color: 0x87ceeb,
        transparent: true,
        opacity: 0.7
      })
    );
    pool.position.y = 0.4 * scale;
    group.add(pool);
    
    // 中心柱
    const pillarGeom = new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 1 * scale);
    const pillar = new THREE.Mesh(
      pillarGeom,
      new THREE.MeshLambertMaterial({ color: 0xd3d3d3 })
    );
    pillar.position.y = 1 * scale;
    group.add(pillar);
    
    return group;
  },
  
  statue: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 基座
    const baseGeom = new THREE.BoxGeometry(1 * scale, 0.5 * scale, 1 * scale);
    const base = new THREE.Mesh(
      baseGeom,
      new THREE.MeshLambertMaterial({ color: 0x808080 })
    );
    base.position.y = 0.25 * scale;
    group.add(base);
    
    // 雕像身体
    const bodyGeom = new THREE.CylinderGeometry(0.3 * scale, 0.4 * scale, 1.5 * scale);
    const body = new THREE.Mesh(
      bodyGeom,
      new THREE.MeshLambertMaterial({ color: 0xa9a9a9 })
    );
    body.position.y = 1.5 * scale;
    body.castShadow = true;
    group.add(body);
    
    // 头
    const headGeom = new THREE.SphereGeometry(0.3 * scale, 8, 8);
    const head = new THREE.Mesh(
      headGeom,
      new THREE.MeshLambertMaterial({ color: 0xa9a9a9 })
    );
    head.position.y = 2.5 * scale;
    group.add(head);
    
    return group;
  },
  
  portal: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 门框
    const frameGeom = new THREE.TorusGeometry(2 * scale, 0.3 * scale, 8, 16);
    const frame = new THREE.Mesh(
      frameGeom,
      new THREE.MeshLambertMaterial({ 
        color: 0x9370db,
        emissive: 0x9370db,
        emissiveIntensity: 0.3
      })
    );
    frame.rotation.y = Math.PI / 2;
    frame.position.y = 2 * scale;
    group.add(frame);
    
    // 传送门中心（移除emissive，BasicMaterial不支持）
    const portalGeom = new THREE.CircleGeometry(1.8 * scale, 32);
    const portal = new THREE.Mesh(
      portalGeom,
      new THREE.MeshBasicMaterial({ 
        color: 0x00ffff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide
      })
    );
    portal.rotation.y = Math.PI / 2;
    portal.position.y = 2 * scale;
    group.add(portal);
    
    return group;
  },
  
  // ===== 交通工具 =====
  
  car: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 车身
    const bodyGeom = new THREE.BoxGeometry(2 * scale, 0.8 * scale, 4 * scale);
    const body = new THREE.Mesh(
      bodyGeom,
      new THREE.MeshLambertMaterial({ color: 0xff0000 })
    );
    body.position.y = 0.6 * scale;
    body.castShadow = true;
    group.add(body);
    
    // 车顶
    const roofGeom = new THREE.BoxGeometry(1.6 * scale, 0.6 * scale, 2 * scale);
    const roof = new THREE.Mesh(
      roofGeom,
      new THREE.MeshLambertMaterial({ color: 0xff0000 })
    );
    roof.position.y = 1.3 * scale;
    group.add(roof);
    
    // 轮子
    const wheelGeom = new THREE.CylinderGeometry(0.3 * scale, 0.3 * scale, 0.2 * scale, 16);
    wheelGeom.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    
    const wheelPositions = [
      [-1.1, 0.3, 1.2], [1.1, 0.3, 1.2],
      [-1.1, 0.3, -1.2], [1.1, 0.3, -1.2]
    ];
    
    wheelPositions.forEach(pos => {
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.position.set(pos[0] * scale, pos[1] * scale, pos[2] * scale);
      group.add(wheel);
    });
    
    return group;
  },
  
  boat: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 船体
    const hullGeom = new THREE.BoxGeometry(2 * scale, 0.5 * scale, 4 * scale);
    hullGeom.scale(1, 1, 1);
    const hull = new THREE.Mesh(
      hullGeom,
      new THREE.MeshLambertMaterial({ color: 0x8b4513 })
    );
    hull.position.y = 0.25 * scale;
    group.add(hull);
    
    // 帆柱
    const mastGeom = new THREE.CylinderGeometry(0.1 * scale, 0.1 * scale, 3 * scale);
    const mast = new THREE.Mesh(
      mastGeom,
      new THREE.MeshLambertMaterial({ color: 0x8b4513 })
    );
    mast.position.y = 2 * scale;
    group.add(mast);
    
    // 帆
    const sailGeom = new THREE.PlaneGeometry(2 * scale, 2 * scale);
    const sail = new THREE.Mesh(
      sailGeom,
      new THREE.MeshLambertMaterial({ 
        color: 0xffffff,
        side: THREE.DoubleSide
      })
    );
    sail.position.set(0, 2 * scale, 0.5 * scale);
    group.add(sail);
    
    return group;
  },
  
  spaceship: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 主体
    const bodyGeom = new THREE.CylinderGeometry(1 * scale, 0.5 * scale, 4 * scale, 8);
    bodyGeom.rotateX(Math.PI / 2);
    const body = new THREE.Mesh(
      bodyGeom,
      new THREE.MeshLambertMaterial({ 
        color: 0xc0c0c0,
        emissive: 0x404040
      })
    );
    body.position.y = 1.5 * scale;
    body.castShadow = true;
    group.add(body);
    
    // 驾驶舱
    const cockpitGeom = new THREE.SphereGeometry(0.8 * scale, 8, 8);
    const cockpit = new THREE.Mesh(
      cockpitGeom,
      new THREE.MeshLambertMaterial({ 
        color: 0x87ceeb,
        transparent: true,
        opacity: 0.8
      })
    );
    cockpit.position.set(0, 2 * scale, 1.5 * scale);
    group.add(cockpit);
    
    // 引擎光
    const engineGeom = new THREE.CylinderGeometry(0.3 * scale, 0.3 * scale, 0.5 * scale);
    const engine = new THREE.Mesh(
      engineGeom,
      new THREE.MeshLambertMaterial({ 
        color: 0x00ffff,
        emissive: 0x00ffff
      })
    );
    engine.position.set(0, 1 * scale, -2 * scale);
    engine.rotation.x = Math.PI / 2;
    group.add(engine);
    
    return group;
  },
  
  // ===== 道具类 =====
  
  chest: function(properties = {}) {
    const group = new THREE.Group();
    const scale = properties.scale || 1.0;
    
    // 箱体
    const boxGeom = new THREE.BoxGeometry(1 * scale, 0.8 * scale, 0.6 * scale);
    const box = new THREE.Mesh(
      boxGeom,
      new THREE.MeshLambertMaterial({ color: 0x8b4513 })
    );
    box.position.y = 0.4 * scale;
    box.castShadow = true;
    group.add(box);
    
    // 盖子
    const lidGeom = new THREE.BoxGeometry(1.1 * scale, 0.2 * scale, 0.7 * scale);
    const lid = new THREE.Mesh(
      lidGeom,
      new THREE.MeshLambertMaterial({ color: 0x654321 })
    );
    lid.position.y = 0.9 * scale;
    group.add(lid);
    
    // 锁扣
    const lockGeom = new THREE.BoxGeometry(0.2 * scale, 0.15 * scale, 0.1 * scale);
    const lock = new THREE.Mesh(
      lockGeom,
      new THREE.MeshLambertMaterial({ color: 0xffd700 })
    );
    lock.position.set(0, 0.4 * scale, 0.31 * scale);
    group.add(lock);
    
    return group;
  },
  
  barrel: function(properties = {}) {
    const scale = properties.scale || 1.0;
    
    const geometry = new THREE.CylinderGeometry(0.4 * scale, 0.35 * scale, 0.8 * scale, 16);
    const material = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.4 * scale;
    mesh.castShadow = true;
    
    return mesh;
  },
  
  crate: function(properties = {}) {
    const scale = properties.scale || 1.0;
    
    const geometry = new THREE.BoxGeometry(1 * scale, 1 * scale, 1 * scale);
    const material = new THREE.MeshLambertMaterial({ color: 0xd2691e });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.5 * scale;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    return mesh;
  }
};

// 导出模板库
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeometryTemplates;
}
