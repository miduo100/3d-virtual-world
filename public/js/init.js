/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 初始化函数
async function init() {
  try {
    loadFromStorage();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1e);
    scene.fog = new THREE.Fog(0x0a0a1e, 14, 60);

    // 兜底：窗口过窄时 width 变成负数会导致 WebGL 初始化失败
    let W, H;
    if (window.innerWidth <= 768) {
      W = Math.max(320, window.innerWidth);
    } else {
      const sidebarWidth = window.innerWidth <= 1024 ? 380 : 440;
      W = Math.max(320, window.innerWidth - sidebarWidth);
    }
    H = window.innerHeight;
    
    camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 1000);
    camera.position.set(2.5, 2, 3);
    const canvas = document.getElementById('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.06; controls.target.set(0, 1, 0);
    gltfLoader = new THREE.GLTFLoader();
    
    // 灯光设置
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(5, 10, 5); dl.castShadow = true; scene.add(dl);
    scene.add(new THREE.HemisphereLight(0x4488ff, 0x224411, 0.3));
    
    // 地面和网格
    const gnd = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x1c2a3a, roughness: 0.9 }));
    gnd.rotation.x = -Math.PI / 2; gnd.receiveShadow = true; scene.add(gnd);
    scene.add(new THREE.GridHelper(60, 60, 0x004422, 0x002211));
    
    // 装饰环
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.025, 8, 80), new THREE.MeshBasicMaterial({ color: 0x004400, transparent: true, opacity: 0.5 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; scene.add(ring);
    
    buildChar();
    applyPreset(cfg.preset, false);
    if (cfg.weapon !== 'none') buildWeapon(cfg.weapon);
    syncUI();
    animate();
    
    // 窗口大小调整
    window.addEventListener('resize', () => {
      let W2;
      if (window.innerWidth <= 768) {
        // 移动端：侧边栏在顶部，画布占满宽度
        W2 = window.innerWidth;
      } else {
        // 桌面端：侧边栏固定宽度
        const sidebarWidth = window.innerWidth <= 1024 ? 380 : 440;
        W2 = Math.max(320, window.innerWidth - sidebarWidth);
      }
      camera.aspect = W2 / window.innerHeight; camera.updateProjectionMatrix();
      renderer.setSize(W2, window.innerHeight);
    });
    
    await loadTemplates();
    await loadServerCfg();
    showNotif('✅ 编辑器就绪');
  } catch (e) {
    console.error('[character_editor] init failed:', e);
    const loading = document.getElementById('tmpl-loading');
    if (loading) loading.textContent = '❌ 初始化失败：' + (e?.message || e);
    try { showNotif('❌ 初始化失败：' + (e?.message || e)); } catch {}
  }
}

// 构建方块人
function buildChar() {
  if (charGroup) scene.remove(charGroup);
  if (glbMixer) { glbMixer.stopAllAction(); glbMixer = null; }
  glbAnimations = []; glbCurrentAction = null; weaponGroup = null; rightElbow = null;
  charGroup = new THREE.Group();
  const mArm = new THREE.MeshStandardMaterial({ color: 0xffaa99 });
  const mBody = new THREE.MeshStandardMaterial({ color: cfg.character.bodyColor });
  const mHead = new THREE.MeshStandardMaterial({ color: cfg.character.headColor });
  const mLeg = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
  const bodyM = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.3), mBody); bodyM.position.y = 0.3; bodyM.castShadow = true; charGroup.add(bodyM); charGroup.userData.body = bodyM;
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), mHead); headM.position.y = 1.2; headM.castShadow = true; charGroup.add(headM); charGroup.userData.head = headM;
  // 左臂
  const lA = new THREE.Group(); lA.position.set(0.38, 0.8, 0);
  const lU = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8), mArm); lU.position.y = -0.25; lA.add(lU);
  const lE = new THREE.Group(); lE.position.set(0, -0.5, 0);
  const lF = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), mArm); lF.position.y = -0.25; lE.add(lF);
  lA.add(lE); charGroup.add(lA); charGroup.userData.leftArm = lA; charGroup.userData.leftElbow = lE;
  // 右臂
  const rA = new THREE.Group(); rA.position.set(-0.38, 0.8, 0);
  const rU = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8), mArm); rU.position.y = -0.25; rA.add(rU);
  const rE = new THREE.Group(); rE.position.set(0, -0.5, 0);
  const rF = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), mArm); rF.position.y = -0.25; rE.add(rF);
  rA.add(rE); charGroup.add(rA); charGroup.userData.rightArm = rA; charGroup.userData.rightElbow = rE; rightElbow = rE;
  // 左腿
  const lLG = new THREE.Group(); lLG.position.set(-0.18, -0.3, 0);
  const lTh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 6), mLeg); lTh.position.y = -0.3; lLG.add(lTh);
  const lK = new THREE.Group(); lK.position.set(0, -0.6, 0);
  const lCa = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 6), mLeg); lCa.position.y = -0.3; lK.add(lCa);
  lLG.add(lK); charGroup.add(lLG); charGroup.userData.leftLeg = lLG; charGroup.userData.leftKnee = lK;
  // 右腿
  const rLG = new THREE.Group(); rLG.position.set(0.18, -0.3, 0);
  const rTh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 6), mLeg); rTh.position.y = -0.3; rLG.add(rTh);
  const rK = new THREE.Group(); rK.position.set(0, -0.6, 0);
  const rCa = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 6), mLeg); rCa.position.y = -0.3; rK.add(rCa);
  rLG.add(rK); charGroup.add(rLG); charGroup.userData.rightLeg = rLG; charGroup.userData.rightKnee = rK;
  charGroup.scale.setScalar(cfg.character.scale);
  charGroup.position.y = 1.5;
  scene.add(charGroup);
  document.getElementById('blockman-colors').style.display = 'block';
  updateHUD();
}

// 加载 GLB（静态角色，无初始动画）
function loadGLB(url) {
  const fullUrl = url.startsWith('http') ? url : SERVER_BASE + url;
  console.log('[loadGLB] 开始加载:', fullUrl);
  // 清理旧状态
  if (glbMixer) { glbMixer.stopAllAction(); glbMixer = null; }
  ANIM_KEYS.forEach(k => { if (animMixers[k]) { animMixers[k].stopAllAction(); delete animMixers[k]; } delete animActions[k]; });
  glbAnimations = []; glbCurrentAction = null;
  if (charGroup) scene.remove(charGroup);
  charGroup = new THREE.Group(); charGroup.position.y = 0; scene.add(charGroup);
  // 加载中占位块
  const ph = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 1.6, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x00ff44, transparent: true, opacity: 0.35, wireframe: true })
  );
  ph.position.y = 0.8; charGroup.add(ph); charGroup.userData.ph = ph;
  showNotif('⏳ 正在加载角色模型...');

  gltfLoader.load(fullUrl, (gltf) => {
    if (charGroup.userData.ph) charGroup.remove(charGroup.userData.ph);
    weaponGroup = null; rightElbow = null;
    const model = gltf.scene;
    model.position.set(0, 0, 0);
    // 不清零旋转！保留GLB内置的Armature旋转（Blender导出的X轴90°修正）
    model.scale.set(1, 1, 1);
    charGroup.add(model);
    charGroup.userData.glbModel = model;
    charGroup.scale.set(1, 1, 1); // charGroup 不参与缩放，scale 全部由 model 控制

    // 保存GLB内置动画（如有）但不自动播放，角色静止站立
    glbAnimations = gltf.animations || [];
    if (glbAnimations.length > 0) {
      glbMixer = new THREE.AnimationMixer(model);
      glbMixer.update(0);
    }

    // 等1帧后用 _refit 统一计算（会在根节点临时挂载，完全避免 charGroup 干扰）
    requestAnimationFrame(() => {
      _refit(model, cfg.glbTargetHeight || 1.8, cfg.character.scale || 1);
      model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      document.getElementById('blockman-colors').style.display = 'none';
      if (cfg.weapon !== 'none') buildWeapon(cfg.weapon);
      buildGLBAnimList();
      updateHUD();
      showNotif(`✅ 角色模型加载完成${glbAnimations.length > 0 ? '，GLB含' + glbAnimations.length + '个内置动画' : ''}`);
      // 预加载所有已配置的动画（包括扩展技能）
      const tryPreloadAnims = () => {
        const keys = ANIM_KEYS.filter(k => tmplAnimUrls[k]);
        if (keys.length > 0) {
          console.log('[loadGLB] 开始预加载动画:', keys.join('/'));
          keys.forEach(k => preloadAnim(k, tmplAnimUrls[k]));
        } else {
          console.log('[loadGLB] tmplAnimUrls 为空，等待 selectTemplate 的 fetch 回调填充...');
        }
      };
      tryPreloadAnims();
      // 如果 tmplAnimUrls 为空，轮询等待 fetch 回调填充（最多等3秒）
      let pollCount = 0;
      const pollId = setInterval(() => {
        pollCount++;
        const keys = ANIM_KEYS.filter(k => tmplAnimUrls[k]);
        if (keys.length > 0) {
          console.log('[loadGLB] 检测到 tmplAnimUrls 已填充(第' + pollCount + '次轮询):', keys.join('/'));
          clearInterval(pollId);
          keys.forEach(k => preloadAnim(k, tmplAnimUrls[k]));
        } else if (pollCount > 30) {
          console.warn('[loadGLB] 等待超时(3s)，tmplAnimUrls 仍为空，放弃预加载');
          clearInterval(pollId);
        }
      }, 100);
    });
  }, (xhr) => {
    if (xhr.total > 0) document.getElementById('hud-anim').textContent = '加载' + Math.round(xhr.loaded / xhr.total * 100) + '%';
  }, (err) => {
    console.error('[GLB加载失败]', err, '\nURL:', fullUrl);
    showNotif('❌ GLB加载失败: ' + (err.message || err));
    buildChar(); applyPreset(cfg.preset, false);
  });
}
