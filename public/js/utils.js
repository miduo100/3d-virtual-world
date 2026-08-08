/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 辅助函数

// 通知函数
function showNotif(msg) {
  const el = document.createElement('div'); el.className = 'notif'; el.textContent = msg; document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// 更新HUD
function updateHUD() {
  document.getElementById('hud-tmpl').textContent = (cfg.templateName || '方块人').slice(0, 8);
  document.getElementById('hud-weapon').textContent = { none: '无', lightsaber: '光剑', staff: '法杖', bow: '弓箭' }[cfg.weapon] || cfg.weapon;
  document.getElementById('hud-skills').textContent = cfg.skills.length;
}

// 同步UI
function syncUI() {
  document.getElementById('charScale').value = cfg.character.scale;
  document.getElementById('charScaleV').textContent = parseFloat(cfg.character.scale).toFixed(1) + '×';
  const th = cfg.glbTargetHeight || 1.8;
  document.getElementById('glbTargetHeight').value = th;
  document.getElementById('glbTargetHeightV').textContent = parseFloat(th).toFixed(1) + 'u';
  document.getElementById('atkSpeed').value = cfg.attack.duration;
  document.getElementById('atkSpeedV').textContent = cfg.attack.duration + 'ms';
  document.getElementById('walkSwing').value = cfg.attack.walkSwing;
  document.getElementById('walkSwingV').textContent = parseFloat(cfg.attack.walkSwing).toFixed(1);
  document.getElementById('bladeLen').value = cfg.sword.bladeLength;
  document.getElementById('bladeLenV').textContent = parseFloat(cfg.sword.bladeLength).toFixed(1);
  document.getElementById('glowInt').value = cfg.sword.glowIntensity;
  document.getElementById('glowIntV').textContent = parseFloat(cfg.sword.glowIntensity).toFixed(1);
  ['swPosX', 'swPosY', 'swPosZ'].forEach((id, i) => {
    const keys = ['x', 'y', 'z']; document.getElementById(id).value = cfg.sword.position[keys[i]] || 0;
    document.getElementById(id + 'V').textContent = (cfg.sword.position[keys[i]] || 0).toFixed(2);
  });
  document.getElementById('swRotZ').value = cfg.sword.rotation.z || 0;
  document.getElementById('swRotZV').textContent = (cfg.sword.rotation.z || 0) + '°';
}

// 保存到本地存储
function saveToStorage() { localStorage.setItem('charEditorConfig', JSON.stringify(cfg)); }

// 从本地存储加载
function loadFromStorage() { try { const s = localStorage.getItem('charEditorConfig'); if (s) Object.assign(cfg, JSON.parse(s)); } catch (e) { } }

// 应用到游戏
function applyToGame() {
  localStorage.setItem('selectedTemplateId', cfg.templateId || '');
  localStorage.setItem('selectedTemplateGlbUrl', cfg.glbUrl || '');
  localStorage.setItem('selectedTemplateName', cfg.templateName || '');
  localStorage.setItem('selectedTemplateHeight', cfg.glbTargetHeight || 1.8);
  // 保存所有MVP动画URL
  ANIM_KEYS.forEach(k => { localStorage.setItem('selectedTemplateAnim_' + k, tmplAnimUrls[k] || ''); });
  // 兼容旧接口
  localStorage.setItem('selectedTemplateWalkUrl', tmplAnimUrls.walk || '');
  localStorage.setItem('selectedTemplateRunUrl', tmplAnimUrls.run || '');
  // 保存骨骼映射、武器插槽、校准配置（供虚拟世界读取）
  localStorage.setItem('selectedTemplateBoneMap', JSON.stringify(cfg.boneMappingConfig || {}));
  localStorage.setItem('selectedTemplateWeaponSocket', JSON.stringify(cfg.weaponSocketConfig || {}));
  localStorage.setItem('selectedTemplateCalibration', JSON.stringify(cfg.calibrationConfig || {}));
  localStorage.setItem('selectedTemplateFitConfig', JSON.stringify(cfg.fitConfig || {}));
  localStorage.setItem('charEditorConfig', JSON.stringify(cfg));
  showNotif('🎮 已应用到游戏，进入世界时生效');
}

// 保存到服务器
async function saveToServer() {
  try {
    const token = localStorage.getItem('adminToken') || localStorage.getItem('token') || '';
    const res = await fetch(`${API_BASE}/config/character-editor`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ config_key: 'character_editor_config', config_value: JSON.stringify(cfg) }) });
    if (res.ok) showNotif('☁️ 已保存到服务器'); else showNotif('❌ 保存失败:' + res.status);
  } catch (e) { showNotif('❌ ' + e.message); }
  saveToStorage();
}

// 从服务器加载配置
async function loadServerCfg() {
  try {
    const res = await fetch(`${API_BASE}/config/character-editor?key=character_editor_config`);
    if (res.ok) { const d = await res.json(); if (d.config_value) { Object.assign(cfg, JSON.parse(d.config_value)); syncUI(); } }
  } catch (e) { }
}

// 导出JSON
function exportJSON() { navigator.clipboard.writeText(JSON.stringify(cfg, null, 2)).then(() => showNotif('📋 已复制到剪贴板')); }

// 导入JSON
function importJSON() {
  const j = prompt('请粘贴JSON：'); if (!j) return;
  try { Object.assign(cfg, JSON.parse(j)); scene.remove(charGroup); buildChar(); syncUI(); if (cfg.glbUrl) loadGLB(cfg.glbUrl); selectWeapon(cfg.weapon || 'none', false); applyPreset(cfg.preset, false); renderSkills(); showNotif('✅ 已导入'); } catch (e) { showNotif('❌ JSON格式错误'); }
}

// 下载JSON
function downloadJSON() {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })); a.download = `char_cfg_${Date.now()}.json`; a.click(); showNotif('💾 已下载');
}

// 获取模型尺寸信息
function getModelSizeInfo(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  return {
    width: size.x,
    height: size.y,
    depth: size.z,
    maxDimension: Math.max(size.x, size.y, size.z),
    center: box.getCenter(new THREE.Vector3())
  };
}

// 辅助：把 model 临时挂到根节点（scale=1, pos=0），用纯净包围盒计算 scale，再放回父节点
function _refit(model, targetH, extraScale, fitConfig) {
  if (!model) return;
  fitConfig = fitConfig || {
    strategy: 'mixed',
    offset: { x: 0, y: 0, z: 0 },
    scale: 1.0,
    rotation: { x: 0, y: 0, z: 0 },
    maxDimension: 5.0,
    autoScale: true,
    cameraDistance: 5.0,
    targetHeight: 1.8
  };

  const savedParent = model.parent;
  const tempRoot = new THREE.Object3D();
  scene.add(tempRoot); // 必须加入scene，updateMatrixWorld才能正确计算
  tempRoot.add(model);
  model.position.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  tempRoot.updateMatrixWorld(true);

  // 1. 识别根骨骼/髋骨 (优先使用 Hips/mixamorigHips)
  let rootBone = null;
  model.traverse(obj => {
    if (obj.isBone && /hips|mixamorigHips|Armature|Root|root/i.test(obj.name)) {
      if (!rootBone || obj.parent === model) {
        rootBone = obj;
      }
    }
  });

  // 2. 智能尺寸检测与缩放（处理大模型问题）
  let sizeInfo = getModelSizeInfo(model);
  if (fitConfig.autoScale && sizeInfo.maxDimension > fitConfig.maxDimension) { // 如果模型最大维度超过设定值
    console.log('[_refit] 检测到超大模型，尺寸:', sizeInfo.maxDimension.toFixed(2) + 'm');
    // 自动调整目标高度，防止模型过大
    let scaleFactor = Math.min(1.0, fitConfig.maxDimension / sizeInfo.maxDimension);
    targetH = Math.max(0.5, (targetH || fitConfig.targetHeight) * scaleFactor);
    console.log('[_refit] 自动调整目标高度为:', targetH.toFixed(2) + 'm');
  }

  // 不做任何旋转修正：统一标准要求GLB导出时就是站立的（Y轴朝上）
  // Blender导出设置：Import FBX时Forward=-Z Up=Y，Export GLB时勾选+Y向上
  model.scale.set(1, 1, 1);
  tempRoot.updateMatrixWorld(true);

  // 逐mesh累加真实包围盒
  const box = new THREE.Box3().setFromObject(model);
  const sz = new THREE.Vector3(); box.getSize(sz);
  let maxDim = Math.max(sz.x, sz.y, sz.z);

  // 单位自动修正：
  // >50     → 厘米单位 (Mixamo FBX→GLB)，直接除100换算成米
  // 0.1~50  → 正常米单位
  // <0.1    → 毫米/异常单位，乘以1000换算
  let unitFix = 1;
  if (maxDim > 50) { unitFix = 0.01; console.log('[_refit] 检测到厘米单位，unitFix=0.01'); }
  else if (maxDim < 0.1 && maxDim > 0) { unitFix = 100; console.log('[_refit] 检测到毫米/异常单位，unitFix=100'); }
  const realH = maxDim * unitFix; // 换算成米后的高度
  // 注意：unitFix 已经体现在 realH 里，不能再乘一遍
  const finalScale = ((targetH || 1.8) / (realH > 0.001 ? realH : 1)) * (extraScale || 1) * fitConfig.scale;

  console.log('[_refit] maxDim=' + maxDim.toFixed(4) + ' unitFix=' + unitFix + ' realH=' + realH.toFixed(3) + 'm finalScale=' + finalScale.toFixed(4));

  model.scale.setScalar(finalScale);
  tempRoot.updateMatrixWorld(true);

  // 3. 计算定位偏移
  let ox, oy, oz;
  
  if (fitConfig.strategy === 'bone' && rootBone) {
    // 骨骼策略：使用 Hips 骨骼作为定位参考
    console.log('[_refit] 使用骨骼策略定位，根骨骼:', rootBone.name);
    const bonePosition = new THREE.Vector3();
    rootBone.getWorldPosition(bonePosition);
    
    // 计算模型中心偏移
    ox = -bonePosition.x;
    oy = -bonePosition.y;
    oz = -bonePosition.z;
  } else if (fitConfig.strategy === 'mixed' && rootBone) {
    // 混合策略：结合骨骼和包围盒
    console.log('[_refit] 使用混合策略定位，根骨骼:', rootBone.name);
    const bonePosition = new THREE.Vector3();
    rootBone.getWorldPosition(bonePosition);
    
    const nb = new THREE.Box3().setFromObject(model);
    const boxOx = -((nb.min.x + nb.max.x) / 2);
    const boxOy = -nb.min.y;
    const boxOz = -((nb.min.z + nb.max.z) / 2);
    
    // 骨骼和包围盒权重混合（骨骼更重要）
    ox = bonePosition.x * 0.7 + boxOx * 0.3;
    oy = bonePosition.y * 0.7 + boxOy * 0.3;
    oz = bonePosition.z * 0.7 + boxOz * 0.3;
  } else {
    // 包围盒策略：使用原始方法
    const nb = new THREE.Box3().setFromObject(model);
    ox = -((nb.min.x + nb.max.x) / 2);
    oy = -nb.min.y;
    oz = -((nb.min.z + nb.max.z) / 2);
  }

  // 应用用户配置的偏移量
  ox += fitConfig.offset.x;
  oy += fitConfig.offset.y;
  oz += fitConfig.offset.z;

  scene.remove(tempRoot); // 清理临时容器
  if (savedParent) savedParent.add(model); else if (charGroup) charGroup.add(model);
  model.position.set(ox, oy, oz);
  model.rotation.set(fitConfig.rotation.x, fitConfig.rotation.y, fitConfig.rotation.z);
  
  const finalBox = new THREE.Box3().setFromObject(model);
  console.log('[_refit] done box=(' + finalBox.min.x.toFixed(2) + ',' + finalBox.min.y.toFixed(2) + ',' + finalBox.min.z.toFixed(2) + ')~(' + finalBox.max.x.toFixed(2) + ',' + finalBox.max.y.toFixed(2) + ',' + finalBox.max.z.toFixed(2) + ') offset=(' + ox.toFixed(3) + ',' + oy.toFixed(3) + ',' + oz.toFixed(3) + ')');
  
  return {
    scale: finalScale,
    offset: { x: ox, y: oy, z: oz },
    rotation: fitConfig.rotation,
    strategy: fitConfig.strategy,
    size: getModelSizeInfo(model)
  };
}

// 相机适配函数
function adjustCameraForModel(model, camera, controls) {
  const sizeInfo = getModelSizeInfo(model);
  
  // 根据模型尺寸调整相机位置和视角
  const distanceScale = Math.max(1.0, sizeInfo.maxDimension / 2.0);
  const cameraDistance = 5 * distanceScale;
  
  // 计算合适的相机位置
  const newPosition = new THREE.Vector3(
    cameraDistance, 
    cameraDistance * 0.8, 
    cameraDistance
  );
  
  camera.position.lerp(newPosition, 0.5);
  controls.target = sizeInfo.center;
  controls.update();
  
  console.log('[adjustCameraForModel] 相机适配完成，距离:', cameraDistance.toFixed(2));
}

// 角色参数调整
function onScale(v) {
  cfg.character.scale = parseFloat(v);
  document.getElementById('charScaleV').textContent = parseFloat(v).toFixed(1) + '×';
  // charGroup 不参与缩放；微调倍率叠加到 model.scale 上
  const model = charGroup?.userData?.glbModel;
  if (model) {
    _refit(model, cfg.glbTargetHeight || 1.8, cfg.character.scale);
  } else if (charGroup) {
    // 方块人用 charGroup.scale 微调
    charGroup.scale.setScalar(cfg.character.scale);
  }
}

function onTargetHeight(v) {
  cfg.glbTargetHeight = parseFloat(v);
  document.getElementById('glbTargetHeightV').textContent = parseFloat(v).toFixed(1) + 'u';
  document.getElementById('glbTargetHeight').value = parseFloat(v);
  const model = charGroup?.userData?.glbModel;
  if (model) {
    _refit(model, cfg.glbTargetHeight, cfg.character.scale || 1);
    showNotif(`📐 高度已设为 ${parseFloat(v).toFixed(1)} 单位`);
  }
}

function onHeadColor(v) { cfg.character.headColor = parseInt(v.replace('#', '0x')); if (charGroup?.userData?.head) charGroup.userData.head.material.color.setHex(cfg.character.headColor); }

function onBodyColor(v) { cfg.character.bodyColor = parseInt(v.replace('#', '0x')); if (charGroup?.userData?.body) charGroup.userData.body.material.color.setHex(cfg.character.bodyColor); }

function onAtkSpeed(v) { cfg.attack.duration = parseInt(v); document.getElementById('atkSpeedV').textContent = v + 'ms'; }

function onWalkSwing(v) { cfg.attack.walkSwing = parseFloat(v); document.getElementById('walkSwingV').textContent = parseFloat(v).toFixed(1); }

function onSlowRate(v) { cfg.attack.slowRate = parseFloat(v); document.getElementById('slowRateV').textContent = parseFloat(v).toFixed(1) + '×'; }

// 动作预设
const PRESETS = {
  default: { name: '默认待机', ra: { x: 0, z: 0 }, la: { x: 0, z: 0 }, by: 0 },
  combat: { name: '战斗姿势', ra: { x: -0.4, z: -0.3 }, la: { x: 0.1, z: 0.1 }, by: -0.3 },
  guard: { name: '防御姿势', ra: { x: 0.8, z: -0.5 }, la: { x: 0.3, z: 0.4 }, by: -0.1 },
  charge: { name: '蓄力姿势', ra: { x: -1.2, z: 0 }, la: { x: -0.2, z: 0 }, by: 0 },
  bow: { name: '行礼姿势', ra: { x: 0.2, z: -0.1 }, la: { x: 0.2, z: 0.1 }, bx: 0.25 },
  idle2: { name: '轻松站姿', ra: { x: 0, z: 0.4 }, la: { x: 0, z: -0.4 }, by: 0 },
};

function loadPreset(name) {
  cfg.preset = name; applyPreset(name, true);
  document.querySelectorAll('.pc').forEach(c => c.classList.remove('active'));
  document.getElementById('pc-' + name)?.classList.add('active');
  document.getElementById('hud-preset').textContent = PRESETS[name]?.name || name;
  showNotif(`📋 预设：${PRESETS[name]?.name || name}`);
}

function applyPreset(name, animated) {
  const p = PRESETS[name]; if (!p || !charGroup || !charGroup.userData.rightArm) return;
  const ud = charGroup.userData;
  if (!animated) {
    if (ud.rightArm) { ud.rightArm.rotation.x = p.ra?.x || 0; ud.rightArm.rotation.z = p.ra?.z || 0; }
    if (ud.leftArm) { ud.leftArm.rotation.x = p.la?.x || 0; ud.leftArm.rotation.z = p.la?.z || 0; }
    charGroup.rotation.x = p.bx || 0; charGroup.rotation.y = p.by || 0;
  } else { lerpPose(ud, p, 400); }
  document.querySelectorAll('.pc').forEach(c => c.classList.remove('active'));
  document.getElementById('pc-' + name)?.classList.add('active');
  document.getElementById('hud-preset').textContent = p.name;
}

function lerpPose(ud, target, dur) {
  const t0 = Date.now();
  const fromRA = ud.rightArm ? { x: ud.rightArm.rotation.x, z: ud.rightArm.rotation.z } : { x: 0, z: 0 };
  const fromLA = ud.leftArm ? { x: ud.leftArm.rotation.x, z: ud.leftArm.rotation.z } : { x: 0, z: 0 };
  const fromB = { x: charGroup.rotation.x, y: charGroup.rotation.y };
  function step() {
    const t = Math.min((Date.now() - t0) / dur, 1), e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    if (ud.rightArm) { ud.rightArm.rotation.x = fromRA.x + ((target.ra?.x || 0) - fromRA.x) * e; ud.rightArm.rotation.z = fromRA.z + ((target.ra?.z || 0) - fromRA.z) * e; }
    if (ud.leftArm) { ud.leftArm.rotation.x = fromLA.x + ((target.la?.x || 0) - fromLA.x) * e; ud.leftArm.rotation.z = fromLA.z + ((target.la?.z || 0) - fromLA.z) * e; }
    charGroup.rotation.x = fromB.x + ((target.bx || 0) - fromB.x) * e; charGroup.rotation.y = fromB.y + ((target.by || 0) - fromB.y) * e;
    if (t < 1) requestAnimationFrame(step);
  } step();
}

// 慢动作测试
function testSlowMotion() {
  cfg.attack.slowRate = 0.2; document.getElementById('slowRate').value = 0.2; document.getElementById('slowRateV').textContent = '0.2×';
  testAnim('slash1');
  setTimeout(() => { cfg.attack.slowRate = 1; document.getElementById('slowRate').value = 1; document.getElementById('slowRateV').textContent = '1.0×'; showNotif('⏱ 慢动作结束'); }, 3500);
  showNotif('🎬 慢动作测试 3.5s');
}

// Tab切换
function switchTab(id) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const map = { 't-tmpl': 0, 't-motion': 1, 't-skill': 2, 't-weapon': 3, 't-save': 4 };
  const idx = map[id]; if (idx !== undefined) document.querySelectorAll('.tab-btn')[idx]?.classList.add('active');
}
