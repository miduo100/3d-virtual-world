/**
 * 模型灯光光晕合批场：每个场景一个 InstancedMesh，共享纹理/几何/材质。
 * 只负责视觉效果，不参与真实照明；100ms 更新位置与相机朝向。
 */
(function () {
  'use strict';

  var _texture = null;
  var _fields = new Map();
  var _rootFields = new WeakMap();
  var _timer = null;
  var _instances = 0;
  var MAX_INSTANCES = 512;

  function getTexture() {
    if (_texture) return _texture;
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    _texture = new THREE.CanvasTexture(canvas);
    _texture.colorSpace = THREE.SRGBColorSpace;
    return _texture;
  }

  function createMesh(capacity) {
    var geometry = new THREE.PlaneGeometry(1, 1);
    var material = new THREE.MeshBasicMaterial({
      map: getTexture(), transparent: true, opacity: 0.34, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexColors: true, toneMapped: false
    });
    var mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    mesh.name = 'ModelHaloField';
    mesh.userData.__modelHaloField = true;
    return mesh;
  }

  function fieldFor(scene, camera) {
    var field = _fields.get(scene);
    if (field) {
      if (camera) field.camera = camera;
      return field;
    }
    var mesh = createMesh(64);
    scene.add(mesh);
    field = { scene: scene, camera: camera, mesh: mesh, capacity: 64, roots: new Map() };
    _fields.set(scene, field);
    return field;
  }

  function register(root, config, options) {
    if (!root || !options || !options.scene || !window.ModelLighting) return;
    unregister(root);
    var field = fieldFor(options.scene, options.camera);
    field.roots.set(root, window.ModelLighting.readLights(config));
    _rootFields.set(root, field);
    start();
    // 世界加载流程在同一调用栈末尾才把模型加入场景并登记 generatedBuildings。
    // 延迟首次存活判断，避免新模型的光晕被初始化过程误清理。
    setTimeout(function () { updateField(field); }, 0);
  }

  function unregister(root) {
    if (!root) return;
    var field = _rootFields.get(root);
    if (!field) return;
    field.roots.delete(root);
    _rootFields.delete(root);
    updateField(field);
  }

  function ensureCapacity(field, needed) {
    if (needed <= field.capacity) return;
    var capacity = field.capacity;
    while (capacity < needed) capacity *= 2;
    var old = field.mesh;
    field.scene.remove(old);
    if (old.dispose) old.dispose();
    old.geometry.dispose();
    old.material.dispose();
    field.mesh = createMesh(capacity);
    field.capacity = capacity;
    field.scene.add(field.mesh);
  }

  function updateField(field) {
    var items = [];
    field.roots.forEach(function (lights, root) {
      if (!window.ModelLighting.isRootAlive(root)) {
        field.roots.delete(root);
        _rootFields.delete(root);
        return;
      }
      lights.forEach(function (light) {
        if (light.enabled && light.halo && items.length < MAX_INSTANCES) items.push({ root: root, light: light });
      });
    });
    ensureCapacity(field, Math.max(1, items.length));
    var mesh = field.mesh;
    var matrix = new THREE.Matrix4();
    var position = new THREE.Vector3();
    var scale = new THREE.Vector3();
    var worldScale = new THREE.Vector3();
    var quaternion = field.camera ? field.camera.quaternion : new THREE.Quaternion();
    var color = new THREE.Color();
    items.forEach(function (entry, index) {
      var root = entry.root;
      var light = entry.light;
      root.updateWorldMatrix(true, false);
      position.set(light.offset.x, light.offset.y, light.offset.z);
      root.localToWorld(position);
      root.getWorldScale(worldScale);
      var size = light.haloSize * 1.5 * Math.max(worldScale.x, worldScale.y, worldScale.z, 0.0001);
      scale.set(size, size, size);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      color.set(window.ModelLighting.colorHex(light.color));
      mesh.setColorAt(index, color);
    });
    mesh.count = items.length;
    mesh.visible = items.length > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    _instances += items.length;
  }

  function updateAll() {
    _instances = 0;
    _fields.forEach(updateField);
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(updateAll, 100);
  }

  function stats() {
    var count = 0;
    _fields.forEach(function (field) {
      field.roots.forEach(function (lights) {
        lights.forEach(function (light) { if (light.enabled && light.halo) count++; });
      });
    });
    return { scenes: _fields.size, instances: count, drawCallsPerScene: _fields.size ? 1 : 0 };
  }

  window.ModelHaloField = {
    register: register,
    unregister: unregister,
    update: updateAll,
    stats: stats
  };
})();
