function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 红色立方体
  const redCube = new THREE.Mesh(
    new THREE.BoxGeometry(1 * scale, 1 * scale, 1 * scale),
    new THREE.MeshLambertMaterial({ color: 0xff0000 })
  );
  redCube.position.set(-1.5 * scale, 0.5 * scale, 0);
  redCube.castShadow = true;
  redCube.receiveShadow = true;
  group.add(redCube);
  
  // 蓝色立方体
  const blueCube = new THREE.Mesh(
    new THREE.BoxGeometry(0.8 * scale, 1.2 * scale, 0.8 * scale),
    new THREE.MeshLambertMaterial({ color: 0x0000ff })
  );
  blueCube.position.set(0, 0.6 * scale, 0);
  blueCube.castShadow = true;
  blueCube.receiveShadow = true;
  group.add(blueCube);
  
  // 黄色立方体
  const yellowCube = new THREE.Mesh(
    new THREE.BoxGeometry(1.2 * scale, 0.8 * scale, 1.2 * scale),
    new THREE.MeshLambertMaterial({ color: 0xffff00 })
  );
  yellowCube.position.set(1.5 * scale, 0.4 * scale, 0);
  yellowCube.castShadow = true;
  yellowCube.receiveShadow = true;
  group.add(yellowCube);
  
  return group;
}