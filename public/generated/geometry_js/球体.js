function createGeometry(properties = {}) {
  const radius = properties.radius || 1;
  const color = properties.color || 0x4488ff;
  
  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  const material = new THREE.MeshLambertMaterial({ color: color });
  const mesh = new THREE.Mesh(geometry, material);
  
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  
  return mesh;
}