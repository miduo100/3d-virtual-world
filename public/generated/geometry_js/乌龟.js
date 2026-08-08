function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 龟壳（扁球形）
  const shellGeom = new THREE.SphereGeometry(1 * scale, 16, 16);
  shellGeom.scale(1.2, 0.6, 1.2); // 拉伸成扁圆形状
  const shell = new THREE.Mesh(
    shellGeom,
    new THREE.MeshLambertMaterial({ color: 0x4a7c59 })
  );
  shell.position.y = 0.5 * scale;
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);
  
  // 身体（绿色腹部）
  const bodyGeom = new THREE.SphereGeometry(0.8 * scale, 16, 16);
  bodyGeom.scale(1.1, 0.5, 1.1);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x66bb6a });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 0.2 * scale;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  
  // 头部
  const headGeom = new THREE.SphereGeometry(0.35 * scale, 16, 16);
  const head = new THREE.Mesh(headGeom, bodyMat);
  head.position.set(1.3 * scale, 0.3 * scale, 0);
  head.castShadow = true;
  group.add(head);
  
  // 眼睛
  const eyeGeom = new THREE.SphereGeometry(0.08 * scale, 8, 8);
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
  const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
  leftEye.position.set(1.6 * scale, 0.4 * scale, 0.2 * scale);
  const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
  rightEye.position.set(1.6 * scale, 0.4 * scale, -0.2 * scale);
  group.add(leftEye, rightEye);
  
  // 四肢（圆柱体）
  const legGeom = new THREE.CylinderGeometry(0.12 * scale, 0.12 * scale, 0.8 * scale, 8);
  
  // 左前肢
  const leftFrontLeg = new THREE.Mesh(legGeom, bodyMat);
  leftFrontLeg.position.set(0.6 * scale, -0.1 * scale, 0.8 * scale);
  leftFrontLeg.rotation.z = -Math.PI / 4;
  leftFrontLeg.castShadow = true;
  group.add(leftFrontLeg);
  
  // 右前肢
  const rightFrontLeg = leftFrontLeg.clone();
  rightFrontLeg.position.z = -0.8 * scale;
  rightFrontLeg.rotation.z = Math.PI / 4;
  group.add(rightFrontLeg);
  
  // 左后肢
  const leftBackLeg = leftFrontLeg.clone();
  leftBackLeg.position.x = -0.6 * scale;
  leftBackLeg.rotation.z = Math.PI / 4;
  group.add(leftBackLeg);
  
  // 右后肢
  const rightBackLeg = leftFrontLeg.clone();
  rightBackLeg.position.set(-0.6 * scale, -0.1 * scale, -0.8 * scale);
  rightBackLeg.rotation.z = -Math.PI / 4;
  group.add(rightBackLeg);
  
  // 尾巴（圆锥体）
  const tailGeom = new THREE.ConeGeometry(0.05 * scale, 0.4 * scale, 8);
  const tail = new THREE.Mesh(tailGeom, bodyMat);
  tail.position.set(-1.2 * scale, 0.2 * scale, 0);
  tail.rotation.z = Math.PI;
  tail.castShadow = true;
  group.add(tail);
  
  return group;
}