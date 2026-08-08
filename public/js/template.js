/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 模板管理功能

// 存储所有模板，用于筛选
let allTemplates = [];

// 预览功能相关变量
let previewState = {
  isPlaying: false,
  isLooping: false,
  currentSpeed: 1.0,
  currentVolume: 0.7,
  currentAnimIndex: 0,
  animQueue: [],
  soundQueue: []
};

// 预览功能初始化
function initPreview() {
  // 初始化预览速度和音量显示
  document.getElementById('preview-speed-v').textContent = '1.0x';
  document.getElementById('preview-volume-v').textContent = '70%';
  
  // 初始化角色缩放
  initCharacterScale();
  
  // 加载角色模板时更新预览信息
  updatePreviewInfo();
}

// 更新预览信息
function updatePreviewInfo() {
  const infoDiv = document.getElementById('preview-info');
  if (cfg.templateId) {
    infoDiv.innerHTML = `当前模板：${cfg.templateName}<br>
    ${cfg.glbUrl ? 'GLB模型已加载' : '使用默认方块人模型'}<br>
    动作数量：${Object.keys(tmplAnimUrls).filter(k => tmplAnimUrls[k]).length}<br>
    声音数量：${getTemplateSoundCount()}`;
  } else {
    infoDiv.textContent = '请选择角色模板开始预览';
  }
}

// 获取模板声音数量
function getTemplateSoundCount() {
  // 从配置中获取角色模板的声音信息
  if (!cfg.animSounds) return 0;
  
  // 计算anim_sounds对象中的属性数量
  return Object.keys(cfg.animSounds).length;
}

// 获取角色模板的完整数据（包括声音信息）
async function getFullTemplateData(templateId) {
  try {
    const token = localStorage.getItem('adminToken') || '';
    const response = await fetch(`/api/character-templates/${templateId}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (response.ok) {
      const data = await response.json();
      return data.template;
    }
  } catch (error) {
    console.error('[Template] 获取完整模板数据失败:', error);
  }
  return null;
}

// 播放预览
function playPreview() {
  if (!cfg.templateId) {
    showNotif('⚠️ 请先选择角色模板');
    return;
  }
  
  previewState.isPlaying = true;
  previewState.animQueue = getAvailableAnimations();
  previewState.soundQueue = getAvailableSounds();
  
  if (previewState.animQueue.length === 0) {
    showNotif('⚠️ 该模板没有可用的动作');
    return;
  }
  
  previewState.currentAnimIndex = 0;
  playNextPreviewAnimation();
  updatePreviewControls();
}

// 停止预览
function stopPreview() {
  previewState.isPlaying = false;
  previewState.isLooping = false;
  previewState.animQueue = [];
  previewState.soundQueue = [];
  previewState.currentAnimIndex = 0;
  
  stopAnim(); // 停止当前动画
  updatePreviewControls();
}

// 循环预览
function loopPreview() {
  previewState.isLooping = !previewState.isLooping;
  if (previewState.isLooping) {
    showNotif('✅ 已启用循环预览');
  } else {
    showNotif('✅ 已禁用循环预览');
  }
}

// 播放下一个预览动画
function playNextPreviewAnimation() {
  if (!previewState.isPlaying) return;
  
  const animKey = previewState.animQueue[previewState.currentAnimIndex];
  if (!animKey) {
    if (previewState.isLooping) {
      previewState.currentAnimIndex = 0;
      playNextPreviewAnimation();
    } else {
      stopPreview();
    }
    return;
  }
  
  // 播放动画
  testAnim(animKey);
  
  // 播放对应的声音
  playPreviewSound(animKey);
  
  // 计算动画持续时间（假设每个动画平均持续3秒）
  const duration = 3000 / previewState.currentSpeed;
  
  // 设置定时器播放下一个动画
  previewState.currentAnimIndex++;
  setTimeout(() => {
    if (previewState.isPlaying) {
      playNextPreviewAnimation();
    }
  }, duration);
}

// 播放预览声音
function playPreviewSound(animKey) {
  // 这里需要根据实际的数据结构来获取并播放声音
  // 目前假设角色模板有anim_sounds字段
  // 需要从服务器获取完整的角色模板数据
  
  // 临时实现：假设每个动画对应一个声音文件
  // 实际应该从角色模板的anim_sounds字段中获取
  const soundUrl = getSoundUrlForAnimKey(animKey);
  
  if (soundUrl && window.soundManager) {
    window.soundManager.play(soundUrl, previewState.currentVolume);
  } else {
    console.log(`[Preview] 动作 ${animKey} 没有对应的声音`);
  }
}

// 根据动画键获取声音URL
function getSoundUrlForAnimKey(animKey) {
  // 从配置中获取角色模板的声音信息
  if (!cfg.animSounds) return null;
  
  // 从角色模板的anim_sounds字段中获取声音URL
  const soundUrl = cfg.animSounds[animKey];
  return soundUrl || null;
}

// 获取可用的动画列表
function getAvailableAnimations() {
  return Object.keys(tmplAnimUrls).filter(k => tmplAnimUrls[k]);
}

// 获取可用的声音列表
function getAvailableSounds() {
  // 从配置中获取角色模板的声音信息
  if (!cfg.animSounds) return [];
  
  // 返回anim_sounds对象中的所有属性作为声音列表
  return Object.keys(cfg.animSounds);
}

// 更新预览控制按钮状态
function updatePreviewControls() {
  const playBtn = Array.from(document.querySelectorAll('.btn')).find(btn => btn.textContent === '播放预览');
  const stopBtn = Array.from(document.querySelectorAll('.btn')).find(btn => btn.textContent === '停止预览');
  const loopBtn = Array.from(document.querySelectorAll('.btn')).find(btn => btn.textContent === '循环预览');
  
  if (previewState.isPlaying) {
    playBtn.textContent = '暂停预览';
    playBtn.className = 'btn btn-s';
  } else {
    playBtn.textContent = '播放预览';
    playBtn.className = 'btn btn-p';
  }
  
  loopBtn.className = previewState.isLooping ? 'btn btn-p' : 'btn btn-w';
}

// 预览速度控制
function onPreviewSpeed(value) {
  previewState.currentSpeed = parseFloat(value);
  document.getElementById('preview-speed-v').textContent = `${value}x`;
}

// 预览音量控制
function onPreviewVolume(value) {
  previewState.currentVolume = parseFloat(value);
  const percentage = Math.round(value * 100);
  document.getElementById('preview-volume-v').textContent = `${percentage}%`;
  
  // 这里需要更新音频引擎的音量
  if (window.soundManager) {
    window.soundManager.setMasterVolume(value);
  }
}

// 动态生成预览动作列表
function generatePreviewAnimList() {
  const animListDiv = document.getElementById('preview-anim-list');
  const availableAnims = getAvailableAnimations();
  
  animListDiv.innerHTML = '';
  
  availableAnims.forEach(animKey => {
    const animItem = document.createElement('div');
    animItem.className = 'ab';
    animItem.textContent = getAnimDisplayName(animKey);
    animItem.onclick = () => {
      previewState.isPlaying = false; // 停止自动播放
      testAnim(animKey);
      playPreviewSound(animKey);
    };
    animListDiv.appendChild(animItem);
  });
  
  if (availableAnims.length === 0) {
    animListDiv.innerHTML = '<div style="text-align:center;color:#555;font-size:10px;">该模板没有可用的动作</div>';
  }
}

// 动态生成预览声音列表
function generatePreviewSoundList() {
  const soundListDiv = document.getElementById('preview-sound-list');
  const availableSounds = getAvailableSounds();
  
  soundListDiv.innerHTML = '';
  
  availableSounds.forEach(soundKey => {
    const soundItem = document.createElement('div');
    soundItem.style.padding = '3px 5px';
    soundItem.style.borderBottom = '1px solid rgba(0,255,0,0.2)';
    soundItem.style.cursor = 'pointer';
    soundItem.textContent = getSoundDisplayName(soundKey);
    soundItem.onclick = () => {
      playPreviewSound(soundKey);
    };
    soundListDiv.appendChild(soundItem);
  });
  
  if (availableSounds.length === 0) {
    soundListDiv.innerHTML = '<div style="text-align:center;color:#555;font-size:10px;">该模板没有可用的声音</div>';
  }
}

// 初始化预览功能（页面加载时调用）
document.addEventListener('DOMContentLoaded', function() {
  initPreview();
});

// 获取动画显示名称
function getAnimDisplayName(animKey) {
  const animNames = {
    idle: '待机',
    walk: '行走',
    run: '奔跑',
    jump: '跳跃',
    attack1: '普攻',
    attack2: '连击2',
    attack3: '连击3',
    hit: '受击',
    death: '死亡',
    turn_left: '左转',
    turn_right: '右转',
    attack_stab: '刺击',
    attack_slash: '挥砍',
    attack_swing: '横扫',
    attack_uppercut: '上勾',
    sheath: '收剑',
    draw_sword: '拔剑'
  };
  
  return animNames[animKey] || animKey;
}

// 获取声音显示名称
function getSoundDisplayName(soundKey) {
  // 这里需要根据实际的数据结构来获取声音显示名称
  // 目前假设声音键与动画键相同
  return getAnimDisplayName(soundKey);
}

// 加载模板列表
async function loadTemplates() {
  const grid = document.getElementById('tmpl-grid'), loading = document.getElementById('tmpl-loading');
  try {
    const res = await fetch(`${API_BASE}/public/character-templates`);
    const data = await res.json();
    allTemplates = data.templates || [];
    loading.style.display = 'none'; grid.style.display = 'grid';
    
    // 更新分类下拉菜单
    updateCategoryDropdown();
    
    // 应用筛选
    filterTemplates();
  } catch (e) { loading.textContent = '❌ 加载失败'; }
}

// 更新分类下拉菜单
function updateCategoryDropdown() {
  const select = document.getElementById('tmpl-category');
  const categories = new Set();
  
  // 收集所有模板的分类
  allTemplates.forEach(t => {
    if (t.category) {
      categories.add(t.category);
    }
  });
  
  // 清空除了第一个选项外的所有选项
  while (select.options.length > 1) {
    select.remove(1);
  }
  
  // 添加分类选项
  Array.from(categories).sort().forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });
}

// 筛选模板
function filterTemplates() {
  const searchTerm = document.getElementById('tmpl-search').value.toLowerCase();
  const category = document.getElementById('tmpl-category').value;
  const grid = document.getElementById('tmpl-grid');
  
  grid.innerHTML = '';
  
  // 检查是否存在"默认方块人"模板（有GLB）
  const bmTmpl = allTemplates.find(t => t.name === '默认方块人');
  // 方块人卡（始终显示，点击效果取决于是否有GLB模板）
  grid.appendChild(mkTmplCard(bmTmpl || null, '🧱 方块人', '', cfg.templateId === null || (bmTmpl && cfg.templateId === bmTmpl.id)));
  
  // 筛选模板
  const filteredTemplates = allTemplates.filter(t => {
    if (t.name === '默认方块人') return false; // 已经单独处理
    
    // 搜索筛选
    const matchesSearch = t.name.toLowerCase().includes(searchTerm);
    
    // 分类筛选
    const matchesCategory = !category || t.category === category;
    
    return matchesSearch && matchesCategory;
  });
  
  // 显示筛选结果
  filteredTemplates.forEach(t => {
    grid.appendChild(mkTmplCard(t, t.name, t.thumbnail_url, cfg.templateId === t.id));
  });
  
  // 更新标签
  updateTmplLabel();
}

// 创建模板卡片
function mkTmplCard(tmpl, name, thumb, sel) {
  const c = document.createElement('div');
  c.className = 'tc' + (sel ? ' selected' : '');
  if (tmpl) c.dataset.id = tmpl.id;
  const hasGlb = tmpl && tmpl.glb_url;
  const img = thumb ? `<img src="${thumb}" style="width:100%;height:58px;object-fit:cover;border-radius:4px;margin-bottom:3px;">` : `<div class="tc-thumb">${name.includes('方块') ? '🧱' : '🎭'}</div>`;
  const badge = hasGlb ? '<div style="position:absolute;bottom:22px;left:3px;background:rgba(0,255,0,0.7);color:#000;font-size:8px;padding:1px 3px;border-radius:2px;">GLB</div>' : '<div style="position:absolute;bottom:22px;left:3px;background:rgba(100,100,100,0.7);color:#ccc;font-size:8px;padding:1px 3px;border-radius:2px;">方块</div>';
  c.innerHTML = `${img}${badge}<div class="tc-name">${name}</div>${sel ? '<div class="tc-chk">✓</div>' : ''}`;
  c.addEventListener('click', () => selectTemplate(tmpl));
  return c;
}

// 选择模板
function selectTemplate(tmpl) {
  document.querySelectorAll('.tc').forEach(c => { c.classList.remove('selected'); const chk = c.querySelector('.tc-chk'); if (chk) chk.remove(); });
  const tid = tmpl ? tmpl.id : null;
  document.querySelectorAll('.tc').forEach(c => {
    if ((c.dataset.id || null) == tid) { c.classList.add('selected'); const chk = document.createElement('div'); chk.className = 'tc-chk'; chk.textContent = '✓'; c.appendChild(chk); }
  });
  cfg.templateId = tmpl ? tmpl.id : null; cfg.templateName = tmpl ? tmpl.name : '默认方块人'; cfg.glbUrl = tmpl ? (tmpl.glb_url || null) : null;
  // 保存角色模板的声音信息
  cfg.animSounds = tmpl ? (tmpl.anim_sounds || {}) : null;
  cfg.weaponSounds = tmpl ? (tmpl.weapon_sounds || {}) : null;
  // 保存角色模板的校准参数
  cfg.calibrationConfig = tmpl ? (tmpl.calibration_config || {}) : null;
  cfg.weaponSocketConfig = tmpl ? (tmpl.weapon_socket_config || {}) : null;
  cfg.boneMappingConfig = tmpl ? (tmpl.bone_mapping_config || {}) : null;
  cfg.fitConfig = tmpl ? (tmpl.fit_config || {}) : null;
  cfg.isCalibrated = tmpl ? (tmpl.is_calibrated || false) : false;
  cfg.calibratedAt = tmpl ? (tmpl.calibrated_at || null) : null;
  cfg.calibrationVersion = tmpl ? (tmpl.calibration_version || 1) : 1;
  // 清空旧动画URL
  ANIM_KEYS_BASE.forEach(k => { tmplAnimUrls[k] = null; });
  // 优先从 anim_set（新动作库架构）解析动画URL，兼容旧 anim_xxx_url 字段
  if (tmpl && tmpl.id) {
    const token = localStorage.getItem('adminToken') || '';
    // 异步获取解析后的动画URL
    fetch(`/api/character-templates/${tmpl.id}/anim-resolved`, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => r.json()).then(data => {
      const resolved = data.resolved || {};
      let hasNew = false;
      ANIM_KEYS_BASE.forEach(k => {
        if (resolved[k]) { tmplAnimUrls[k] = resolved[k].url; hasNew = true; }
      });
      // 兼容：若新架构没配置，fallback 到旧字段
      if (!hasNew) {
        ANIM_KEYS_BASE.forEach(k => { tmplAnimUrls[k] = tmpl['anim_' + k + '_url'] || null; });
      }
      updateAnimStatusGrid();
      const resolvedKeys = Object.entries(tmplAnimUrls).filter(([, v]) => v).map(([k]) => k);
      console.log('[selectTemplate] anims resolved:', resolvedKeys.join('/') || '(无)');
      // 预加载所有新解析的动画（preloadAnim内部会检查model是否存在）
      resolvedKeys.forEach(k => {
        console.log(`[selectTemplate] 发起预加载: ${k} -> ${tmplAnimUrls[k]}`);
        preloadAnim(k, tmplAnimUrls[k]);
      });
    }).catch(() => {
      // fallback 到旧字段
      ANIM_KEYS_BASE.forEach(k => { tmplAnimUrls[k] = tmpl['anim_' + k + '_url'] || null; });
      updateAnimStatusGrid();
    });
  }
  // 方块人上传区：选中"方块人"卡（含null或name==='默认方块人'）时显示
  const isBlockman = (tmpl === null || (tmpl && tmpl.name === '默认方块人'));
  document.getElementById('blockman-upload-section').style.display = isBlockman ? 'block' : 'none';
  if (isBlockman && tmpl && tmpl.glb_url) {
    document.getElementById('bm-glb-current').textContent = '当前：' + tmpl.glb_url.split('/').pop();
  }
  // 兼容旧变量（walk/run）供其他地方使用
  updateAnimStatusGrid();
  console.log('[selectTemplate]', cfg.templateName, 'glb_url:', cfg.glbUrl, 'anims:', Object.entries(tmplAnimUrls).filter(([, v]) => v).map(([k]) => k).join('/'));
  if (cfg.glbUrl) {
    loadGLB(cfg.glbUrl);
    document.getElementById('glb-anim-section').style.display = 'block';
  } else {
    buildChar(); applyPreset(cfg.preset, false); if (cfg.weapon !== 'none') buildWeapon(cfg.weapon);
    document.getElementById('glb-anim-section').style.display = 'none';
    if (tmpl && !tmpl.glb_url) showNotif('⚠️ 该模板暂无GLB文件，显示方块人代替');
  }
  updateTmplLabel(); updateHUD(); showNotif(`✅ 已切换：${cfg.templateName}`);
  // 更新预览信息和列表
  updatePreviewInfo();
  generatePreviewAnimList();
  generatePreviewSoundList();
}

// 更新模板标签
function updateTmplLabel() {
  document.getElementById('tmpl-label').textContent = `当前：${cfg.templateName}${cfg.glbUrl ? ' (GLB)' : ' (方块人)'}`;
  document.getElementById('hud-tmpl').textContent = cfg.templateName.slice(0, 8);
}

// 方块人GLB上传
// 先查找或创建"默认方块人"模板，然后上传GLB
async function _getOrCreateBlockmanTemplate() {
  const token = localStorage.getItem('adminToken');
  // 查找名称为"默认方块人"的模板
  const res = await fetch(`${API_BASE}/character-templates`, { headers: { 'Authorization': 'Bearer ' + token } });
  if (!res.ok) throw new Error('需要管理员登录后台才能上传');
  const data = await res.json();
  const exist = (data.templates || []).find(t => t.name === '默认方块人');
  if (exist) return exist.id;
  // 不存在则创建
  const fd = new FormData();
  fd.append('name', '默认方块人');
  fd.append('description', '内置默认方块人角色模板');
  fd.append('access_level', 'public');
  fd.append('character_role', 'player');
  fd.append('is_default', 'true');
  const cr = await fetch(`${API_BASE}/character-templates`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
  if (!cr.ok) throw new Error('创建模板失败');
  const cd = await cr.json();
  return cd.template.id;
}

// 上传方块人GLB
async function uploadBlockmanGlb() {
  const statusEl = document.getElementById('bm-upload-status');
  const glbFile = document.getElementById('bm-glb-file').files[0];
  const thumbFile = document.getElementById('bm-thumb').files[0];
  if (!glbFile) { showNotif('⚠️ 请先选择GLB文件'); return; }
  statusEl.style.display = 'block'; statusEl.textContent = '⏳ 上传中...';
  try {
    const token = localStorage.getItem('adminToken');
    if (!token) { showNotif('⚠️ 请先在管理后台登录'); statusEl.textContent = '❌ 未登录'; return; }
    const tmplId = await _getOrCreateBlockmanTemplate();
    const fd = new FormData();
    fd.append('name', '默认方块人');
    fd.append('glb_file', glbFile);
    if (thumbFile) fd.append('thumbnail', thumbFile);
    const res = await fetch(`${API_BASE}/character-templates/${tmplId}`, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    statusEl.textContent = '✅ 上传成功！';
    // 预览新模型
    cfg.glbUrl = data.template.glb_url;
    cfg.templateId = tmplId;
    cfg.templateName = '默认方块人';
    document.getElementById('bm-glb-current').textContent = '当前：' + data.template.glb_url.split('/').pop();
    loadGLB(cfg.glbUrl);
    showNotif('✅ 方块人GLB上传成功，已预览');
    // 刷新模板列表
    loadTemplates();
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
    showNotif('❌ 上传失败: ' + e.message);
  }
}

// 恢复默认方块人
async function clearBlockmanGlb() {
  // 恢复原生方块人（选中 null 模板）
  cfg.glbUrl = null; cfg.templateId = null; cfg.templateName = '默认方块人';
  buildChar(); applyPreset(cfg.preset, false); if (cfg.weapon !== 'none') buildWeapon(cfg.weapon);
  document.getElementById('bm-glb-current').textContent = '';
  document.getElementById('bm-upload-status').style.display = 'none';
  ANIM_KEYS.forEach(k => tmplAnimUrls[k] = null);
  // 重置扩展技能
  ANIM_KEYS = ([...ANIM_KEYS_BASE]);
  Object.keys(ANIM_LABELS_EXT).forEach(k => delete ANIM_LABELS_EXT[k]);
  cfg.skills = [];
  updateAnimStatusGrid();
  updateTestAnimButtons();
  showNotif('🧱 已恢复内置方块人');
}

// 批量上传功能
// 监听文件选择
function initBatchUpload() {
  document.getElementById('batch-glb-files').addEventListener('change', function(e) {
    const files = e.target.files;
    const fileList = document.getElementById('batch-file-list');
    if (files.length > 0) {
      let html = '';
      for (let i = 0; i < files.length; i++) {
        html += `${i + 1}. ${files[i].name} (${(files[i].size / 1024 / 1024).toFixed(2)}MB)<br>`;
      }
      fileList.innerHTML = html;
    } else {
      fileList.innerHTML = '';
    }
  });
}

// 批量上传模板
async function batchUploadTemplates() {
  const files = document.getElementById('batch-glb-files').files;
  const category = document.getElementById('batch-category').value.trim();
  const statusEl = document.getElementById('batch-upload-status');
  
  if (files.length === 0) {
    showNotif('⚠️ 请选择要上传的文件');
    return;
  }
  
  const token = localStorage.getItem('adminToken');
  if (!token) {
    showNotif('⚠️ 请先在管理后台登录');
    statusEl.textContent = '❌ 未登录';
    statusEl.style.display = 'block';
    return;
  }
  
  statusEl.textContent = '⏳ 上传中...';
  statusEl.style.display = 'block';
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileName = file.name.replace(/\.glb$|\.gltf$/i, '');
    
    try {
      const formData = new FormData();
      formData.append('name', fileName);
      formData.append('glb_file', file);
      formData.append('description', `批量上传的模板: ${fileName}`);
      formData.append('access_level', 'public');
      formData.append('character_role', 'player');
      
      if (category) {
        formData.append('category', category);
      }
      
      const res = await fetch(`${API_BASE}/character-templates`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token
        },
        body: formData
      });
      
      if (res.ok) {
        successCount++;
      } else {
        failCount++;
        console.warn('上传失败:', await res.text());
      }
    } catch (e) {
      failCount++;
      console.error('上传错误:', e);
    }
  }
  
  statusEl.textContent = `✅ 上传完成：成功 ${successCount}，失败 ${failCount}`;
  showNotif(`📥 批量上传完成：成功 ${successCount}，失败 ${failCount}`);
  
  // 刷新模板列表
  loadTemplates();
  
  // 清空文件选择
  clearBatchUpload();
}

// 清空批量上传
function clearBatchUpload() {
  document.getElementById('batch-glb-files').value = '';
  document.getElementById('batch-file-list').innerHTML = '';
  document.getElementById('batch-category').value = '';
  document.getElementById('batch-upload-status').style.display = 'none';
}

// 上传方块人动画
async function uploadBlockmanAnims() {
  const token = localStorage.getItem('adminToken');
  if (!token) { showNotif('⚠️ 请先在管理后台登录'); return; }
  const animKeys = ['idle', 'walk', 'run', 'jump', 'attack1', 'attack2', 'attack3', 'hit', 'death'];
  const files = {};
  let hasAny = false;
  animKeys.forEach(k => {
    const f = document.getElementById('bm-anim-' + k)?.files[0];
    if (f) { files[k] = f; hasAny = true; }
  });
  if (!hasAny) { showNotif('⚠️ 请至少选择一个动画文件'); return; }
  showNotif('⏳ 上传动画中...');
  try {
    const tmplId = await _getOrCreateBlockmanTemplate();
    const fd = new FormData();
    fd.append('name', '默认方块人');
    for (const [k, f] of Object.entries(files)) fd.append('anim_' + k, f);
    const res = await fetch(`${API_BASE}/character-templates/${tmplId}`, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    // 更新本地 tmplAnimUrls 并预加载
    ANIM_KEYS_BASE.forEach(k => { tmplAnimUrls[k] = data.template['anim_' + k + '_url'] || tmplAnimUrls[k] || null; });
    updateAnimStatusGrid();
    // 预加载已上传的动画
    animKeys.forEach(k => { if (files[k] && tmplAnimUrls[k]) preloadAnim(k, tmplAnimUrls[k]); });
    showNotif('✅ 动画上传成功');
  } catch (e) {
    showNotif('❌ 动画上传失败: ' + e.message);
  }
}

// 更新角色缩放
function updateCharacterScale(scale) {
  // 更新配置
  cfg.character.scale = scale;
  
  // 更新角色组缩放
  if (charGroup) {
    charGroup.scale.setScalar(scale);
    
    // 如果是GLB模型，还需要调整模型本身的缩放以保持比例
    const model = charGroup.userData.glbModel;
    if (model) {
      // 重新计算模型缩放，保持目标高度
      const targetHeight = cfg.glbTargetHeight || 1.8;
      const realHeight = _computeModelHeight(model);
      if (realHeight > 0) {
        const modelScale = (targetHeight / realHeight) * scale;
        model.scale.setScalar(modelScale);
        
        // 重新定位模型以保持在地面上
        const boundingBox = new THREE.Box3().setFromObject(model);
        const height = boundingBox.max.y - boundingBox.min.y;
        model.position.y = -boundingBox.min.y;
      }
    }
  }
  
  // 更新UI显示
  document.getElementById('scale-value').textContent = scale.toFixed(1);
}

// 计算模型高度
function _computeModelHeight(model) {
  const boundingBox = new THREE.Box3().setFromObject(model);
  return boundingBox.max.y - boundingBox.min.y;
}

// 初始化角色缩放
function initCharacterScale() {
  const initialScale = cfg.character.scale || 1;
  document.getElementById('scale-value').textContent = initialScale.toFixed(1);
  document.getElementById('scale').value = initialScale;
  updateCharacterScale(initialScale);
}

// 确保updateCharacterScale函数在全局范围内可用
window.updateCharacterScale = updateCharacterScale;
