function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 树干
  const trunkHeight = 5 * scale;
  const trunkGeom = new THREE.CylinderGeometry(0.3 * scale, 0.15 * scale, trunkHeight, 16);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
  const trunk = new THREE.Mesh(trunkGeom, trunkMat);
  trunk.position.y = trunkHeight / 2; // 底部对齐y=0平面
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);
  
  // 树枝与树叶层
  const branchLevels = [1, 2, 3, 4].map(h => h * scale); // 树枝所在高度
  const branchLength = 1.2 * scale;
  const branchMat = trunkMat; // 树枝颜色与树干一致
  
  branchLevels.forEach(yLevel => {
    // 计算当前高度树干的半径
    const trunkRadiusAtY = 0.3 * scale - (0.3 - 0.15) * scale * (yLevel / trunkHeight);
    
    // 创建4个方向的树枝（前后左右）
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2; // 0, π/2, π, 3π/2 弧度
      
      // 树枝几何体
      const branchGeom = new THREE.CylinderGeometry(0.08 * scale, 0.05 * scale, branchLength, 12);
      const branch = new THREE.Mesh(branchGeom, branchMat);
      
      // 计算树枝初始位置（树干表面）
      const x = trunkRadiusAtY * Math.cos(angle);
      const z = trunkRadiusAtY * Math.sin(angle);
      branch.position.set(x, yLevel, z);
      
      // 旋转树枝使其向外伸展
      branch.rotation.x = Math.PI / 2; // 转为水平方向
      branch.rotation.y = angle; // 对齐当前方向
      
      // 调整位置让树枝一端贴紧树干
      branch.position.x += (branchLength / 2) * Math.cos(angle);
      branch.position.z += (branchLength / 2) * Math.sin(angle);
      
      branch.castShadow = true;
      group.add(branch);
      
      // 树叶簇
      const leafGeom = new THREE.SphereGeometry(0.5 * scale, 12, 12);
      leafGeom.scale(1.2, 0.8, 1.2); // 调整为扁平形状
      const leaf = new THREE.Mesh(
        leafGeom,
        new THREE.MeshLambertMaterial({ color: 0x228B22 })
      );
      
      // 树叶位置：树枝末端
      leaf.position.x = branch.position.x + (branchLength / 2) * Math.cos(angle);
      leaf.position.y = yLevel;
      leaf.position.z = branch.position.z + (branchLength / 2) * Math.sin(angle);
      
      leaf.castShadow = true;
      group.add(leaf);
    }
  });
  
  // 顶部树叶簇
  const topLeafGeom = new THREE.SphereGeometry(0.6 * scale, 16, 16);
  topLeafGeom.scale(1.3, 1, 1.3);
  const topLeaf = new THREE.Mesh(
    topLeafGeom,
    new THREE.MeshLambertMaterial({ color: 0x228B22 })
  );
  topLeaf.position.y = trunkHeight + 0.3 * scale;
  topLeaf.castShadow = true;
  group.add(topLeaf);
  
  return group;
}