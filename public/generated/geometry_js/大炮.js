function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 炮身子组（包含炮管和炮膛）
  const barrelGroup = new THREE.Group();
  
  // 炮管
  const barrelGeom = new THREE.CylinderGeometry(0.1*scale, 0.1*scale, 2*scale, 16);
  const barrel = new THREE.Mesh(
    barrelGeom,
    new THREE.MeshLambertMaterial({ color: 0x666666 })
  );
  barrel.position.z = 0.75*scale;
  barrel.castShadow = true;
  barrelGroup.add(barrel);
  
  // 炮膛（炮管后端粗部）
  const chamberGeom = new THREE.CylinderGeometry(0.2*scale, 0.2*scale, 0.5*scale, 16);
  const chamber = new THREE.Mesh(
    chamberGeom,
    new THREE.MeshLambertMaterial({ color: 0x555555 })
  );
  chamber.position.z = -0.25*scale;
  chamber.castShadow = true;
  barrelGroup.add(chamber);
  
  // 调整炮身倾斜角度
  barrelGroup.rotation.x = -Math.PI/8;
  barrelGroup.position.y = 0.8*scale;
  barrelGroup.position.z = 0.3*scale;
  group.add(barrelGroup);
  
  // 炮架 - 左侧支架
  const leftStandGeom = new THREE.BoxGeometry(0.2*scale, 1.2*scale, 0.1*scale);
  const leftStand = new THREE.Mesh(
    leftStandGeom,
    new THREE.MeshLambertMaterial({ color: 0x777777 })
  );
  leftStand.position.set(-0.5*scale, 0.6*scale, -0.4*scale);
  leftStand.castShadow = true;
  leftStand.receiveShadow = true;
  group.add(leftStand);
  
  // 炮架 - 右侧支架
  const rightStandGeom = new THREE.BoxGeometry(0.2*scale, 1.2*scale, 0.1*scale);
  const rightStand = new THREE.Mesh(
    rightStandGeom,
    new THREE.MeshLambertMaterial({ color: 0x777777 })
  );
  rightStand.position.set(0.5*scale, 0.6*scale, -0.4*scale);
  rightStand.castShadow = true;
  rightStand.receiveShadow = true;
  group.add(rightStand);
  
  // 支架连接横梁
  const beamGeom = new THREE.BoxGeometry(1.2*scale, 0.1*scale, 0.1*scale);
  const beam = new THREE.Mesh(
    beamGeom,
    new THREE.MeshLambertMaterial({ color: 0x666666 })
  );
  beam.position.set(0, 0.1*scale, -0.4*scale);
  beam.castShadow = true;
  beam.receiveShadow = true;
  group.add(beam);
  
  // 左侧轮子
  const leftWheelTireGeom = new THREE.TorusGeometry(0.4*scale, 0.1*scale, 16, 32);
  const leftWheel = new THREE.Mesh(
    leftWheelTireGeom,
    new THREE.MeshLambertMaterial({ color: 0x333333 })
  );
  leftWheel.rotation.y = Math.PI/2;
  leftWheel.position.set(-0.5*scale, 0.2*scale, -0.9*scale);
  leftWheel.castShadow = true;
  group.add(leftWheel);
  
  // 右侧轮子
  const rightWheelTireGeom = new THREE.TorusGeometry(0.4*scale, 0.1*scale, 16, 32);
  const rightWheel = new THREE.Mesh(
    rightWheelTireGeom,
    new THREE.MeshLambertMaterial({ color: 0x333333 })
  );
  rightWheel.rotation.y = Math.PI/2;
  rightWheel.position.set(0.5*scale, 0.2*scale, -0.9*scale);
  rightWheel.castShadow = true;
  group.add(rightWheel);
  
  // 轮子连接轴
  const axleGeom = new THREE.CylinderGeometry(0.05*scale, 0.05*scale, 1.1*scale, 16);
  const axle = new THREE.Mesh(
    axleGeom,
    new THREE.MeshLambertMaterial({ color: 0x555555 })
  );
  axle.rotation.y = Math.PI/2;
  axle.position.set(0, 0.2*scale, -0.9*scale);
  axle.castShadow = true;
  group.add(axle);
  
  return group;
}