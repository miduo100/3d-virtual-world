/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 武器相关功能

// 构建武器
function buildWeapon(type) {
  if (weaponGroup) { if (rightElbow) rightElbow.remove(weaponGroup); else if (charGroup) charGroup.remove(weaponGroup); weaponGroup = null; }
  if (type === 'none') return;
  weaponGroup = new THREE.Group();
  if (type === 'lightsaber') {
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8), new THREE.MeshStandardMaterial({ color: cfg.sword.hiltColor, metalness: 0.9, roughness: 0.1 }));
    hilt.rotation.x = Math.PI / 2; hilt.position.z = 0.1;
    weaponGroup.add(hilt); weaponGroup.userData.hilt = hilt;
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, cfg.sword.bladeLength, 8), new THREE.MeshStandardMaterial({ color: cfg.sword.bladeColor, emissive: cfg.sword.bladeColor, emissiveIntensity: cfg.sword.glowIntensity, transparent: true, opacity: 0.9 }));
    blade.rotation.x = Math.PI / 2; blade.position.z = -(0.1 + cfg.sword.bladeLength / 2); weaponGroup.add(blade); weaponGroup.userData.blade = blade;
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, cfg.sword.bladeLength, 8), new THREE.MeshBasicMaterial({ color: cfg.sword.bladeColor, transparent: true, opacity: 0.25 }));
    glow.rotation.x = Math.PI / 2; glow.position.z = -(0.1 + cfg.sword.bladeLength / 2); weaponGroup.add(glow); weaponGroup.userData.glow = glow;
    const light = new THREE.PointLight(cfg.sword.bladeColor, 1.5, 3); light.position.z = -(0.5 + cfg.sword.bladeLength / 2); weaponGroup.add(light); weaponGroup.userData.bladeLight = light;
    weaponGroup.position.set(cfg.sword.position.x, cfg.sword.position.y, cfg.sword.position.z);
    weaponGroup.rotation.set(cfg.sword.rotation.x * Math.PI / 180, cfg.sword.rotation.y * Math.PI / 180, cfg.sword.rotation.z * Math.PI / 180);
  } else if (type === 'staff') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, cfg.staff.length, 8), new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.7 }));
    shaft.position.y = cfg.staff.length / 2; weaponGroup.add(shaft);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), new THREE.MeshStandardMaterial({ color: cfg.staff.orbColor, emissive: cfg.staff.orbColor, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 }));
    orb.position.y = cfg.staff.length + 0.12; weaponGroup.add(orb); weaponGroup.userData.orb = orb;
    const ol = new THREE.PointLight(cfg.staff.orbColor, 1.2, 2.5); ol.position.copy(orb.position); weaponGroup.add(ol); weaponGroup.userData.orbLight = ol;
    weaponGroup.position.set(0.02, -0.35, 0.05); weaponGroup.rotation.set(0, 0, Math.PI / 12);
  } else if (type === 'bow') {
    const bowM = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 8, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.6 }));
    bowM.rotation.z = Math.PI / 2; bowM.rotation.x = Math.PI / 2; weaponGroup.add(bowM);
    const strP = [new THREE.Vector3(0, -0.35, 0), new THREE.Vector3(0, 0.35, 0)];
    const str = new THREE.Line(new THREE.BufferGeometry().setFromPoints(strP), new THREE.LineBasicMaterial({ color: 0xcccccc }));
    weaponGroup.add(str); weaponGroup.position.set(0.05, -0.2, 0.1); weaponGroup.rotation.set(0, -Math.PI / 6, 0);
  }
  if (rightElbow) rightElbow.add(weaponGroup);
  else if (charGroup) charGroup.add(weaponGroup);
}

// 武器选择
function selectWeapon(type, notify = true) {
  cfg.weapon = type;
  document.querySelectorAll('.wo').forEach(e => e.classList.remove('active'));
  document.getElementById('weapon-' + type)?.classList.add('active');
  document.getElementById('lightsaber-config').style.display = type === 'lightsaber' ? 'block' : 'none';
  document.getElementById('staff-config').style.display = type === 'staff' ? 'block' : 'none';
  buildWeapon(type);
  

  
  const wn = { none: '无', lightsaber: '光剑', staff: '法杖', bow: '弓箭' };
  document.getElementById('hud-weapon').textContent = wn[type] || type;
  if (notify) showNotif(`⚔️ 武器：${wn[type] || type}`);
}

// 武器特效状态
let weaponEffects = {
  activeEffects: [],
  cooldowns: {}
};

// 武器特效配置
let weaponEffectConfigs = {
  lightsaber: [],
  staff: [],
  bow: []
};

// 获取当前武器
function getCurrentWeapon() {
  if (cfg.weapon === 'none') return null;
  return {
    id: 'current',
    group: weaponGroup,
    damage: 10,
    attackSpeed: 1,
    range: 5,
    effects: weaponEffectConfigs[cfg.weapon] || []
  };
}

// 检查武器特效触发
function checkWeaponEffectTrigger(triggerType) {
  const weapon = getCurrentWeapon();
  if (!weapon || !weapon.effects) return;
  
  // 检查所有特效
  weapon.effects.forEach(effect => {
    // 检查触发条件是否匹配
    if (effect.triggerType !== triggerType) return;
    
    // 检查冷却时间
    const now = Date.now();
    const cooldownKey = `weapon_${weapon.id}_effect_${effect.id}_${triggerType}`;
    const lastTrigger = weaponEffects.cooldowns[cooldownKey];
    
    if (lastTrigger && (now - lastTrigger) < (effect.cooldown * 1000)) {
      return; // 冷却中
    }
    
    // 触发特效
    triggerWeaponEffect(weapon, effect, triggerType);
  });
}

// 触发武器特效
function triggerWeaponEffect(weapon, effect, triggerType) {
  // 记录触发时间
  const cooldownKey = `weapon_${weapon.id}_effect_${effect.id}_${triggerType}`;
  weaponEffects.cooldowns[cooldownKey] = Date.now();
  
  // 应用效果
  applyWeaponEffect(weapon, effect);
  
  // 调用skillManager触发特效（动画、视觉效果、声音）
  if (window.skillManager) {
    window.skillManager.triggerEffect(effect);
  }
  
  // 设置效果结束定时器
  setTimeout(() => {
    removeWeaponEffect(weapon, effect);
  }, effect.duration * 1000);
}

// 应用武器效果
function applyWeaponEffect(weapon, effect) {
  // 创建效果对象
  const effectObj = {
    id: `effect_${Date.now()}`,
    weaponId: weapon.id,
    effectId: effect.id,
    type: effect.type,
    value: effect.value,
    startTime: Date.now(),
    duration: effect.duration * 1000
  };
  
  // 添加到活跃效果列表
  weaponEffects.activeEffects.push(effectObj);
  
  // 根据效果类型应用不同效果
  switch (effect.type) {
    case 'damage':
      // 增加伤害
      cfg.weaponDamageBonus = effect.value / 100;
      break;
    case 'defense':
      // 增加防御
      cfg.weaponDefenseBonus = effect.value / 100;
      break;
    case 'speed':
      // 增加速度
      cfg.weaponSpeedBonus = effect.value / 100;
      break;
    case 'heal':
      // 生命恢复
      if (typeof healCharacter === 'function') {
        healCharacter(effect.value);
      }
      break;
  }
  
  // 显示效果激活提示
  showNotif(`⚡ 武器特效激活：${getEffectName(effect.type)} +${effect.value}%`);
}

// 移除武器效果
function removeWeaponEffect(weapon, effect) {
  // 过滤掉已结束的效果
  weaponEffects.activeEffects = weaponEffects.activeEffects.filter(effectObj => {
    return effectObj.weaponId !== weapon.id || effectObj.effectId !== effect.id || (Date.now() - effectObj.startTime) < effectObj.duration;
  });
  
  // 检查是否还有相同类型的活跃效果
  const hasSameEffect = weaponEffects.activeEffects.some(effectObj => {
    return effectObj.weaponId === weapon.id && effectObj.type === effect.type;
  });
  
  // 如果没有相同类型的活跃效果，重置效果
  if (!hasSameEffect) {
    switch (effect.type) {
      case 'damage':
        cfg.weaponDamageBonus = 0;
        break;
      case 'defense':
        cfg.weaponDefenseBonus = 0;
        break;
      case 'speed':
        cfg.weaponSpeedBonus = 0;
        break;
    }
    
    // 显示效果结束提示
    showNotif(`⚡ 武器特效结束：${getEffectName(effect.type)}`);
  }
}

// 播放武器视觉特效（对接 world.js 粒子系统）
function playWeaponVisualEffect(particleType) {
  // 现在通过skillManager处理视觉特效
  console.log(`[weapon] playWeaponVisualEffect: ${particleType}`);
}

// 获取效果名称
function getEffectName(effectType) {
  const effectNames = {
    damage: '伤害增加',
    defense: '防御增加',
    speed: '速度增加',
    heal: '生命恢复'
  };
  return effectNames[effectType] || effectType;
}

// 攻击时检查武器特效
function onAttack() {
  checkWeaponEffectTrigger('attack');
}

// 被攻击时检查武器特效
function onBeingAttacked() {
  checkWeaponEffectTrigger('beingAttacked');
}

// 特定动作时检查武器特效
function onAction(actionType) {
  checkWeaponEffectTrigger('action');
}

// 手动触发武器特效
function manualTriggerWeaponEffect() {
  checkWeaponEffectTrigger('manual');
}

// 添加武器特效
function addWeaponEffect(weaponType, effect) {
  if (!weaponEffectConfigs[weaponType]) {
    weaponEffectConfigs[weaponType] = [];
  }
  
  // 生成唯一ID
  const effectId = `effect_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  
  // 添加特效
  weaponEffectConfigs[weaponType].push({
    id: effectId,
    name: effect.name || '新特效',
    triggerType: effect.triggerType || 'attack',
    type: effect.type || 'damage',
    value: effect.value || 20,
    duration: effect.duration || 5,
    cooldown: effect.cooldown || 10,
    particleType: effect.particleType || 'fire',
    soundUrl: effect.soundUrl || ''
  });
  
  // 保存到本地存储
  saveWeaponEffectConfigs();
  
  return effectId;
}

// 编辑武器特效
function editWeaponEffect(weaponType, effectId, updates) {
  const effects = weaponEffectConfigs[weaponType];
  if (!effects) return false;
  
  const index = effects.findIndex(e => e.id === effectId);
  if (index === -1) return false;
  
  // 更新特效
  weaponEffectConfigs[weaponType][index] = {
    ...weaponEffectConfigs[weaponType][index],
    ...updates
  };
  
  // 保存到本地存储
  saveWeaponEffectConfigs();
  
  return true;
}

// 删除武器特效
function deleteWeaponEffect(weaponType, effectId) {
  const effects = weaponEffectConfigs[weaponType];
  if (!effects) return false;
  
  const index = effects.findIndex(e => e.id === effectId);
  if (index === -1) return false;
  
  // 删除特效
  weaponEffectConfigs[weaponType].splice(index, 1);
  
  // 保存到本地存储
  saveWeaponEffectConfigs();
  
  return true;
}

// 保存武器特效配置到本地存储
function saveWeaponEffectConfigs() {
  localStorage.setItem('weaponEffectConfigs', JSON.stringify(weaponEffectConfigs));
}

// 从本地存储加载武器特效配置
function loadWeaponEffectConfigs() {
  const saved = localStorage.getItem('weaponEffectConfigs');
  if (saved) {
    try {
      weaponEffectConfigs = JSON.parse(saved);
    } catch (e) {
      console.error('加载武器特效配置失败:', e);
    }
  }
}

// 初始化武器特效配置
function initWeaponEffectConfigs() {
  loadWeaponEffectConfigs();
  
  // 确保每种武器类型都有配置
  const weaponTypes = ['lightsaber', 'staff', 'bow'];
  weaponTypes.forEach(type => {
    if (!weaponEffectConfigs[type]) {
      weaponEffectConfigs[type] = [];
    }
  });
}

// 光剑颜色设置
function setBladeColor(hex) {
  const c = parseInt(hex.replace('#', '0x'));
  cfg.sword.bladeColor = c;
  if (weaponGroup?.userData?.blade) {
    weaponGroup.userData.blade.material.color.setHex(c);
    weaponGroup.userData.blade.material.emissive.setHex(c);
    weaponGroup.userData.glow?.material.color.setHex(c);
    if (weaponGroup.userData.bladeLight) weaponGroup.userData.bladeLight.color.setHex(c);
  }
  markSwatch(hex, 0);
}

function setHiltColor(hex) {
  const c = parseInt(hex.replace('#', '0x'));
  cfg.sword.hiltColor = c;
  if (weaponGroup?.userData?.hilt) weaponGroup.userData.hilt.material.color.setHex(c);
  markSwatch(hex, 1);
}

// 法杖颜色设置
function setStaffColor(hex) {
  const c = parseInt(hex.replace('#', '0x'));
  cfg.staff.orbColor = c;
  if (weaponGroup?.userData?.orb) {
    weaponGroup.userData.orb.material.color.setHex(c);
    weaponGroup.userData.orb.material.emissive.setHex(c);
    weaponGroup.userData.orbLight?.color.setHex(c);
  }
  markSwatch(hex, 0);
}

// 色板标记
function markSwatch(hex, pi) {
  const pals = document.querySelectorAll('.cp'); if (!pals[pi]) return;
  pals[pi].querySelectorAll('.sw').forEach(s => s.classList.toggle('active', s.style.background === hex));
}

// 武器参数调整
function onBladeLen(v) {
  cfg.sword.bladeLength = parseFloat(v);
  document.getElementById('bladeLenV').textContent = parseFloat(v).toFixed(1);
  if (cfg.weapon === 'lightsaber') buildWeapon('lightsaber');
}

function onGlowInt(v) {
  cfg.sword.glowIntensity = parseFloat(v);
  document.getElementById('glowIntV').textContent = parseFloat(v).toFixed(1);
  if (weaponGroup?.userData?.blade) weaponGroup.userData.blade.material.emissiveIntensity = cfg.sword.glowIntensity;
}

function onSwordPos() {
  cfg.sword.position.x = parseFloat(document.getElementById('swPosX').value);
  cfg.sword.position.y = parseFloat(document.getElementById('swPosY').value);
  cfg.sword.position.z = parseFloat(document.getElementById('swPosZ').value);
  document.getElementById('swPosXV').textContent = cfg.sword.position.x.toFixed(2);
  document.getElementById('swPosYV').textContent = cfg.sword.position.y.toFixed(2);
  document.getElementById('swPosZV').textContent = cfg.sword.position.z.toFixed(2);
  if (weaponGroup) weaponGroup.position.set(cfg.sword.position.x, cfg.sword.position.y, cfg.sword.position.z);
}

function onSwordRot() {
  cfg.sword.rotation.z = parseFloat(document.getElementById('swRotZ').value);
  document.getElementById('swRotZV').textContent = cfg.sword.rotation.z + '°';
  if (weaponGroup) weaponGroup.rotation.z = cfg.sword.rotation.z * Math.PI / 180;
}

function onStaffLen(v) {
  cfg.staff.length = parseFloat(v);
  document.getElementById('staffLenV').textContent = parseFloat(v).toFixed(1);
  if (cfg.weapon === 'staff') buildWeapon('staff');
}

// 初始化武器特效配置
initWeaponEffectConfigs();
