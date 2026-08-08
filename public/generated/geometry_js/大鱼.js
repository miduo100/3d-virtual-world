function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 主材质定义
  const bodyColor = properties.bodyColor || 0x4a90e2;
  const finColor = properties.finColor || 0x3a70c2;
  const eyeColor = properties.eyeColor || 0x000000;
  
  // 身体（拉伸球体）
  const bodyGeom = new THREE.SphereGeometry(1 * scale, 24, 24);
  bodyGeom.scale(3, 1, 0.8); // 拉伸成长条形
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  
  // 鱼头
  const headGeom = new THREE.SphereGeometry(0.7 * scale, 16, 16);
  const head = new THREE.Mesh(headGeom, bodyMat);
  head.position.x = 2.8 * scale; // 与身体前端衔接
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);
  
  // 眼睛
  const eyeGeom = new THREE.SphereGeometry(0.15 * scale, 8, 8);
  const eyeMat = new THREE.MeshLambertMaterial({ color: eyeColor });
  const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
  leftEye.position.set(3.2 * scale, 0.3 * scale, 0.6 * scale);
  const rightEye = leftEye.clone();
  rightEye.position.z = -0.6 * scale;
  group.add(leftEye, rightEye);
  
  // 背鳍
  const finMat = new THREE.MeshLambertMaterial({ color: finColor, side: THREE.DoubleSide });
  const dorsalFinGeom = new THREE.PlaneGeometry(2 * scale, 0.8 * scale);
  const dorsalFin = new THREE.Mesh(dorsalFinGeom, finMat);
  dorsalFin.position.set(0, (1 + 0.4) * scale, 0.8 * scale); // 背部位置
  dorsalFin.rotation.x = Math.PI / 2; // 垂直于身体
  dorsalFin.rotation.z = Math.PI / 12; // 轻微倾斜
  dorsalFin.castShadow = true;
  group.add(dorsalFin);
  
  // 胸鳍（左右）
  const pectoralFinGeom = new THREE.BoxGeometry(1 * scale, 0.5 * scale, 0.1 * scale);
  const leftPectoral = new THREE.Mesh(pectoralFinGeom, finMat);
  leftPectoral.position.set(0.5 * scale, -0.5 * scale, (0.8 + 0.1) * scale);
  leftPectoral.rotation.x = Math.PI / 6;
  leftPectoral.rotation.z = -Math.PI / 3;
  leftPectoral.castShadow = true;
  group.add(leftPectoral);
  
  const rightPectoral = leftPectoral.clone();
  rightPectoral.position.z = -(0.8 + 0.1) * scale;
  rightPectoral.rotation.z = Math.PI / 3;
  group.add(rightPectoral);
  
  // 尾巴组合
  const tailGroup = new THREE.Group();
  tailGroup.position.x = -3 * scale; // 身体后端位置
  
  // 主尾鳍
  const tailMainGeom = new THREE.ConeGeometry(0.8 * scale, 2 * scale, 8);
  tailMainGeom.scale(0.6, 1, 1); // 扁平化
  const tailMain = new THREE.Mesh(tailMainGeom, finMat);
  tailMain.position.x = -1 * scale; // 尾巴中心在身体后端延伸1scale
  tailMain.rotation.y = Math.PI / 2; // 朝向后方
  tailMain.castShadow = true;
  tailGroup.add(tailMain);
  
  // 辅助尾鳍
  const tailSideGeom = new THREE.PlaneGeometry(1.2 * scale, 1.5 * scale);
  const tailSide1 = new THREE.Mesh(tailSideGeom, finMat);
  tailSide1.position.x = -0.5 * scale;
  tailSide1.rotation.x = Math.PI / 2;
  tailSide1.rotation.z = Math.PI / 6;
  tailGroup.add(tailSide1);
  
  const tailSide2 = tailSide1.clone();
  tailSide2.rotation.z = -Math.PI / 6;
  tailGroup.add(tailSide2);
  
  group.add(tailGroup);
  
  return group;
}