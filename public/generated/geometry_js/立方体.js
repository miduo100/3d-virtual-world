function createGeometry(properties = {}) {
  const width = properties.width || 2;
  const height = properties.height || 2;
  const depth = properties.depth || 2;
  const color = properties.color || 0xcccccc;
  
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshLambertMaterial({ color: color });
  const mesh = new THREE.Mesh(geometry, material);
  
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  
  return mesh;
}