function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 身体（椭圆球体）
  const bodyGeom = new THREE.SphereGeometry(0.8 * scale, 16, 16);
  bodyGeom.scale(1, 1.1, 0.9);
  const body = new THREE.Mesh(
    bodyGeom,
    new THREE.MeshLambertMaterial({ color: 0xffe4b5 })
  );
  body.position.y = 0.5 * scale;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  
  // 头部
  const headGeom = new THREE.SphereGeometry(0.6 * scale, 16, 16);
  const head = new THREE.Mesh(
    headGeom,
    new THREE.MeshLambertMaterial({ color: 0xffe4b5 })
  );
  head.position.y = 1.2 * scale;
  head.castShadow = true;
  group.add(head);
  
  // 耳朵
  const earGeom = new THREE.ConeGeometry(0.2 * scale, 0.5 * scale, 8);
  const earMat = new THREE.MeshLambertMaterial({ color: 0xffdab9 });
  
  const leftEar = new THREE.Mesh(earGeom, earMat);
  leftEar.position.set(-0.5 * scale, 1.6 * scale, 0.4 * scale);
  leftEar.rotation.z = Math.PI / 6;
  leftEar.rotation.x = Math.PI / 6;
  leftEar.castShadow = true;
  
  const rightEar = new THREE.Mesh(earGeom, earMat);
  rightEar.position.set(0.5 * scale, 1.6 * scale, 0.4 * scale);
  rightEar.rotation.z = -Math.PI / 6;
  rightEar.rotation.x = Math.PI / 6;
  rightEar.castShadow = true;
  
  group.add(leftEar, rightEar);
  
  // 眼睛（黑色眼球+白色高光）
  const eyeGeom = new THREE.SphereGeometry(0.1 * scale, 8, 8);
  const blackMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  
  // 左眼
  const leftEye = new THREE.Mesh(eyeGeom, blackMat);
  leftEye.position.set(-0.2 * scale, 1.3 * scale, 0.5 * scale);
  // 左眼高光
  const leftEyeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.03 * scale, 8,8), whiteMat);
  leftEyeGlow.position.set(-0.17 * scale, 1.35 * scale, 0.55 * scale);
  group.add(leftEye, leftEyeGlow);
  
  // 右眼
  const rightEye = new THREE.Mesh(eyeGeom, blackMat);
  rightEye.position.set(0.2 * scale, 1.3 * scale, 0.5 * scale);
  // 右眼高光
  const rightEyeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.03 * scale, 8,8), whiteMat);
  rightEyeGlow.position.set(0.17 * scale, 1.35 * scale, 0.55 * scale);
  group.add(rightEye, rightEyeGlow);
  
  // 鼻子
  const noseGeom = new THREE.ConeGeometry(0.1 * scale, 0.2 * scale, 8);
  const nose = new THREE.Mesh(
    noseGeom,
    new THREE.MeshLambertMaterial({ color: 0xff69b4 })
  );
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 1.1 * scale, 0.6 * scale);
  nose.castShadow = true;
  group.add(nose);
  
  // 嘴巴线条
  const mouthGeom = new THREE.CylinderGeometry(0.02 * scale, 0.02 * scale, 0.2 * scale, 8);
  const mouthLeft = new THREE.Mesh(mouthGeom, blackMat);
  mouthLeft.rotation.z = Math.PI / 4;
  mouthLeft.position.set(-0.08 * scale, 1.0 * scale, 0.6 * scale);
  
  const mouthRight = new THREE.Mesh(mouthGeom, blackMat);
  mouthRight.rotation.z = -Math.PI / 4;
  mouthRight.position.set(0.08 * scale, 1.0 * scale, 0.6 * scale);
  group.add(mouthLeft, mouthRight);
  
  // 胡须
  const whiskerGeom = new THREE.CylinderGeometry(0.01 * scale, 0.01 * scale, 0.4 * scale, 8);
  
  // 左边胡须
  const whiskerL1 = new THREE.Mesh(whiskerGeom, blackMat);
  whiskerL1.rotation.y = Math.PI / 6;
  whiskerL1.position.set(-0.1 * scale, 1.15 * scale, 0.6 * scale);
  
  const whiskerL2 = new THREE.Mesh(whiskerGeom, blackMat);
  whiskerL2.position.set(-0.1 * scale, 1.1 * scale, 0.6 * scale);
  
  const whiskerL3 = new THREE.Mesh(whiskerGeom, blackMat);
  whiskerL3.rotation.y = -Math.PI / 6;
  whiskerL3.position.set(-0.1 * scale, 1.05 * scale, 0.6 * scale);
  
  // 右边胡须
  const whiskerR1 = new THREE.Mesh(whiskerGeom, blackMat);
  whiskerR1.rotation.y = -Math.PI / 6;
  whiskerR1.position.set(0.1 * scale, 1.15 * scale, 0.6 * scale);
  
  const whiskerR2 = new THREE.Mesh(whiskerGeom, blackMat);
  whiskerR2.position.set(0.1 * scale, 1.1 * scale, 0.6 * scale);
  
  const whiskerR3 = new THREE.Mesh(whiskerGeom, blackMat);
  whiskerR3.rotation.y = Math.PI / 6;
  whiskerR3.position.set(0.1 * scale, 1.05 * scale, 0.6 * scale);
  
  group.add(whiskerL1, whiskerL2, whiskerL3, whiskerR1, whiskerR2, whiskerR3);
  
  // 四肢
  const legGeom = new THREE.CylinderGeometry(0.15 * scale, 0.15 * scale, 0.7 * scale, 8);
  const legMat = new THREE.MeshLambertMaterial({ color: 0xffe4b5 });
  
  // 前肢
  const frontLeftLeg = new THREE.Mesh(legGeom, legMat);
  frontLeftLeg.position.set(-0.5 * scale, 0.35 * scale, 0.3 * scale);
  
  const frontRightLeg = new THREE.Mesh(legGeom, legMat);
  frontRightLeg.position.set(0.5 * scale, 0.35 * scale, 0.3 * scale);
  
  // 后肢
  const backLeftLeg = new THREE.Mesh(legGeom, legMat);
  backLeftLeg.position.set(-0.6 * scale, 0.35 * scale, -0.2 * scale);
  
  const backRightLeg = new THREE.Mesh(legGeom, legMat);
  backRightLeg.position.set(0.6 * scale, 0.35 * scale, -0.2 * scale);
  
  group.add(frontLeftLeg, frontRightLeg, backLeftLeg, backRightLeg);
  
  // 尾巴（弯曲的管状）
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.4 * scale, -0.8 * scale),
    new THREE.Vector3(0.3 * scale, 0.6 * scale, -1.2 * scale),
    new THREE.Vector3(0.5 * scale, 0.8 * scale, -1.5 * scale)
  ]);
  const tailGeom = new THREE.TubeGeometry(tailCurve, 16, 0.1 * scale, 8, false);
  const tail = new THREE.Mesh(tailGeom, legMat);
  tail.castShadow = true;
  group.add(tail);
  
  return group;
}