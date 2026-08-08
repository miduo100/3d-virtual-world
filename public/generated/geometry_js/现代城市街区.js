function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 1. 地面与街道
  // 主地面（人行道区域）
  const groundGeom = new THREE.BoxGeometry(20 * scale, 0.1 * scale, 20 * scale);
  const ground = new THREE.Mesh(
    groundGeom,
    new THREE.MeshLambertMaterial({ color: 0xaaaaaa })
  );
  ground.receiveShadow = true;
  group.add(ground);
  
  // 中央道路
  const roadGeom = new THREE.BoxGeometry(18 * scale, 0.12 * scale, 4 * scale);
  const road = new THREE.Mesh(
    roadGeom,
    new THREE.MeshLambertMaterial({ color: 0x333333 })
  );
  road.position.y = 0.01 * scale; // 略高于地面
  road.receiveShadow = true;
  group.add(road);
  
  // 2. 高楼大厦
  // 左侧玻璃幕墙建筑
  const building1 = new THREE.Mesh(
    new THREE.BoxGeometry(2 * scale, 6 * scale, 2 * scale),
    new THREE.MeshLambertMaterial({ color: 0x336699 })
  );
  building1.position.set(-7 * scale, 3 * scale, 6 * scale);
  building1.castShadow = true;
  group.add(building1);
  
  // 右侧高层玻璃建筑
  const building2 = new THREE.Mesh(
    new THREE.BoxGeometry(1.8 * scale, 8 * scale, 1.8 * scale),
    new THREE.MeshLambertMaterial({ color: 0x225588 })
  );
  building2.position.set(7 * scale, 4 * scale, 5 * scale);
  building2.castShadow = true;
  group.add(building2);
  
  // 前方混凝土建筑
  const building3 = new THREE.Mesh(
    new THREE.BoxGeometry(2.5 * scale, 5 * scale, 2.5 * scale),
    new THREE.MeshLambertMaterial({ color: 0x888888 })
  );
  building3.position.set(0, 2.5 * scale, -7 * scale);
  building3.castShadow = true;
  group.add(building3);
  
  // 3. 公园区域
  // 绿色草坪
  const parkGeom = new THREE.BoxGeometry(6 * scale, 0.11 * scale, 6 * scale);
  const park = new THREE.Mesh(
    parkGeom,
    new THREE.MeshLambertMaterial({ color: 0x44aa55 })
  );
  park.position.set(-7 * scale, 0.02 * scale, -7 * scale);
  park.receiveShadow = true;
  group.add(park);
  
  // 公园树木1（球形树冠）
  const tree1Trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15 * scale, 0.15 * scale, 1 * scale),
    new THREE.MeshLambertMaterial({ color: 0x885522 })
  );
  tree1Trunk.position.set(-9 * scale, 0.5 * scale, -9 * scale);
  const tree1Top = new THREE.Mesh(
    new THREE.SphereGeometry(0.6 * scale, 16, 16),
    new THREE.MeshLambertMaterial({ color: 0x228833 })
  );
  tree1Top.position.set(-9 * scale, 1.1 * scale, -9 * scale);
  group.add(tree1Trunk, tree1Top);
  
  // 公园树木2（锥形树冠）
  const tree2Trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * scale, 0.12 * scale, 0.8 * scale),
    new THREE.MeshLambertMaterial({ color: 0x885522 })
  );
  tree2Trunk.position.set(-5 * scale, 0.4 * scale, -5 * scale);
  const tree2Top = new THREE.Mesh(
    new THREE.ConeGeometry(0.5 * scale, 1 * scale, 16),
    new THREE.MeshLambertMaterial({ color: 0x228833 })
  );
  tree2Top.position.set(-5 * scale, 0.9 * scale, -5 * scale);
  group.add(tree2Trunk, tree2Top);
  
  // 4. 道路车辆
  // 轮子材质
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const wheelGeom = new THREE.CylinderGeometry(0.15 * scale, 0.15 * scale, 0.3 * scale, 8);
  wheelGeom.rotateZ(Math.PI / 2); // 旋转轮子为横向
  
  // 红色汽车
  const car1 = new THREE.Group();
  const car1Body = new THREE.Mesh(
    new THREE.BoxGeometry(1 * scale, 0.4 * scale, 2 * scale),
    new THREE.MeshLambertMaterial({ color: 0xff3333 })
  );
  car1Body.position.y = 0.2 * scale;
  const car1Wheel1 = new THREE.Mesh(wheelGeom, wheelMat);
  car1Wheel1.position.set(0.4 * scale, 0.15 * scale, 0.8 * scale);
  const car1Wheel2 = new THREE.Mesh(wheelGeom, wheelMat);
  car1Wheel2.position.set(-0.4 * scale, 0.15 * scale, 0.8 * scale);
  const car1Wheel3 = new THREE.Mesh(wheelGeom, wheelMat);
  car1Wheel3.position.set(0.4 * scale, 0.15 * scale, -0.8 * scale);
  const car1Wheel4 = new THREE.Mesh(wheelGeom, wheelMat);
  car1Wheel4.position.set(-0.4 * scale, 0.15 * scale, -0.8 * scale);
  car1.add(car1Body, car1Wheel1, car1Wheel2, car1Wheel3, car1Wheel4);
  car1.position.set(-5 * scale, 0.13 * scale, 0);
  car1.castShadow = true;
  group.add(car1);
  
  // 蓝色汽车（反向行驶）
  const car2 = new THREE.Group();
  const car2Body = new THREE.Mesh(
    new THREE.BoxGeometry(0.9 * scale, 0.35 * scale, 1.8 * scale),
    new THREE.MeshLambertMaterial({ color: 0x3366ff })
  );
  car2Body.position.y = 0.175 * scale;
  const car2Wheel1 = new THREE.Mesh(wheelGeom, wheelMat);
  car2Wheel1.position.set(0.35 * scale, 0.15 * scale, 0.7 * scale);
  const car2Wheel2 = new THREE.Mesh(wheelGeom, wheelMat);
  car2Wheel2.position.set(-0.35 * scale, 0.15 * scale, 0.7 * scale);
  const car2Wheel3 = new THREE.Mesh(wheelGeom, wheelMat);
  car2Wheel3.position.set(0.35 * scale, 0.15 * scale, -0.7 * scale);
  const car2Wheel4 = new THREE.Mesh(wheelGeom, wheelMat);
  car2Wheel4.position.set(-0.35 * scale, 0.15 * scale, -0.7 * scale);
  car2.add(car2Body, car2Wheel1, car2Wheel2, car2Wheel3, car2Wheel4);
  car2.position.set(4 * scale, 0.13 * scale, 0);
  car2.rotation.y = Math.PI;
  car2.castShadow = true;
  group.add(car2);
  
  return group;
}