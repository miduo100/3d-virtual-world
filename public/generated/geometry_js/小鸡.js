function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 身体（椭圆体）
  const bodyGeom = new THREE.SphereGeometry(0.8 * scale, 16, 16);
  bodyGeom.scale(1, 1.2, 0.9);
  const body = new THREE.Mesh(
    bodyGeom,
    new THREE.MeshLambertMaterial({ color: 0xffff00 })
  );
  body.position.y = 0.8 * scale;
  body.castShadow = true;
  group.add(body);
  
  // 头部
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.5 * scale, 16, 16),
    new THREE.MeshLambertMaterial({ color: 0xffff00 })
  );
  head.position.y = 1.8 * scale;
  head.castShadow = true;
  group.add(head);
  
  // 喙
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.1 * scale, 0.3 * scale, 8),
    new THREE.MeshLambertMaterial({ color: 0xff8800 })
  );
  beak.position.set(0, 1.8 * scale, 0.5 * scale);
  beak.rotation.x = Math.PI / 2;
  group.add(beak);
  
  // 眼睛
  const eyeGeom = new THREE.SphereGeometry(0.08 * scale, 8, 8);
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
  const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
  leftEye.position.set(-0.2 * scale, 1.9 * scale, 0.4 * scale);
  const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
  rightEye.position.set(0.2 * scale, 1.9 * scale, 0.4 * scale);
  group.add(leftEye, rightEye);
  
  // 腿
  const legGeom = new THREE.CylinderGeometry(0.08 * scale, 0.08 * scale, 0.5 * scale, 8);
  const legMat = new THREE.MeshLambertMaterial({ color: 0xff8800 });
  const leftLeg = new THREE.Mesh(legGeom, legMat);
  leftLeg.position.set(-0.3 * scale, 0.25 * scale, 0);
  const rightLeg = new THREE.Mesh(legGeom, legMat);
  rightLeg.position.set(0.3 * scale, 0.25 * scale, 0);
  group.add(leftLeg, rightLeg);
  
  return group;
}