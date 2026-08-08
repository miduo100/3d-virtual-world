function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 船体
  const hullGeom = new THREE.CylinderGeometry(1*scale, 1.2*scale, 8*scale, 16);
  const hullMat = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
  const hull = new THREE.Mesh(hullGeom, hullMat);
  hull.position.y = 4*scale;
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);
  
  // 甲板
  const deckGeom = new THREE.BoxGeometry(8*scale, 0.2*scale, 2.2*scale);
  const deckMat = new THREE.MeshLambertMaterial({ color: 0xD2B48C });
  const deck = new THREE.Mesh(deckGeom, deckMat);
  deck.position.y = 4*scale + 0.1*scale;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  
  // 主船舱
  const cabinGeom = new THREE.BoxGeometry(2*scale, 1.5*scale, 1.5*scale);
  const cabinMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const cabin = new THREE.Mesh(cabinGeom, cabinMat);
  cabin.position.set(0, 4*scale + 0.1*scale + 0.75*scale, 0);
  cabin.castShadow = true;
  group.add(cabin);
  
  // 桅杆
  const mastGeom = new THREE.CylinderGeometry(0.1*scale, 0.1*scale, 5*scale, 8);
  const mastMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
  const mast = new THREE.Mesh(mastGeom, mastMat);
  mast.position.set(0, 4*scale + 0.1*scale + 2.5*scale, 0);
  mast.castShadow = true;
  group.add(mast);
  
  // 船帆（双面平面）
  const sailGeom = new THREE.PlaneGeometry(3*scale, 4*scale);
  const sailMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const sail = new THREE.Mesh(sailGeom, sailMat);
  sail.position.set(0, 4*scale + 0.1*scale + 2.5*scale, 1.6*scale);
  sail.rotation.z = Math.PI/12;
  sail.castShadow = true;
  group.add(sail);
  
  // 船桨（左右两侧）
  const oarGeom = new THREE.CylinderGeometry(0.05*scale, 0.05*scale, 2*scale, 8);
  const oarMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
  
  const leftOar = new THREE.Mesh(oarGeom, oarMat);
  leftOar.position.set(-3*scale, 4*scale, 1.2*scale);
  leftOar.rotation.z = Math.PI/4;
  leftOar.castShadow = true;
  group.add(leftOar);
  
  const rightOar = new THREE.Mesh(oarGeom, oarMat);
  rightOar.position.set(3*scale, 4*scale, 1.2*scale);
  rightOar.rotation.z = -Math.PI/4;
  rightOar.castShadow = true;
  group.add(rightOar);
  
  return group;
}