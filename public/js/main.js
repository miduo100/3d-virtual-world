/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// Main application
let gameWorld = null;
let player = null;
let voiceManager = null;
let skillsManager = null;
let lastTime = Date.now();
let debugUpdateCounter = 0;
let _currentTmplData = null; // 存储当前角色的模板数据（含音效配置）

// Make gameWorld accessible globally for name updates
window.gameWorld = null;
window.player = null;  // Make player accessible globally

// i18n translation helper for dynamically created UI
function _t(key, params) {
  try {
    if (window.i18n && typeof window.i18n.t === 'function') {
      return window.i18n.t(key, params);
    }
  } catch (e) {}
  return key;
}

// Mouse and keyboard state
const MOUSE = {
  isDragging: false,
  lastX: 0,
  lastY: 0,
  rotationX: 0,
  rotationY: 0,
  targetRotationX: 0,
  targetRotationY: 0,
  sensitivity: 0.005,
  smoothness: 0.1
};

const KEYS = {
  w: false,
  a: false,
  s: false,
  d: false,
  space: false,
  shift: false
};

// Game state
const GAME_STATE = {
  userId: null,
  characterId: null,
  characterData: null,
  isLoggedIn: false,
  cameraMode: 'third-person',
  isInVR: false
};

// 暴露到全局作用域
if (typeof window !== 'undefined') {
  window.MOUSE = MOUSE;
  window.KEYS = KEYS;
  window.GAME_STATE = GAME_STATE;
}

// Update debug panel every 100ms
setInterval(() => {
  updateDebugPanel();
  debugUpdateCounter++;
}, 100);

window.addEventListener('load', async () => {
  try {
    // 优先检测跨世界传送参数
    const urlParams = new URLSearchParams(window.location.search);
    const isTeleport = urlParams.get('teleport') === 'true';
    const teleportToken = urlParams.get('token');

    if (isTeleport && teleportToken) {
      // 有传送Token，直接验证并登录，不显示登录页
      await handleTeleportArrival(teleportToken);
      return;
    }

    // Check if user is logged in
    const token = localStorage.getItem('token');
    if (!token) {
      // 游客模式：直接进入世界浏览，持续提示注册
      initializeGameAsGuest();
      return;
    }

    // Initialize game
    await initializeGame();
  } catch (error) {
    console.error('Initialization error:', error);
    UI.showNotification('错误', '初始化失败：' + error.message);
  }
});

// 处理从其他世界传送过来的到达流程
async function handleTeleportArrival(teleportToken) {
  // 显示加载画面
  const loadingScreen = document.getElementById('loadingScreen');
  if (loadingScreen) {
    loadingScreen.style.display = 'flex';
    const loadingText = loadingScreen.querySelector('.loading-text') || loadingScreen.querySelector('p');
    if (loadingText) loadingText.textContent = '正在验证传送...';
  }

  try {
    const response = await fetch('/api/federation/teleport/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teleportToken })
    });
    const data = await response.json();

    if (data.success) {
      // 保存登录信息
      localStorage.setItem('token', data.token);
      localStorage.setItem('userId', data.user?.id || '');
      localStorage.setItem('characterId', data.user?.characterId || '');
      localStorage.setItem('userInfo', JSON.stringify(data.user));

      // ── 写入源世界角色配置（绝对URL，GLB/动画/武器直接跨域加载）──
      const cc = data.characterConfig;
      if (cc) {
        const ANIM_KEYS = ['idle','walk','run','jump','attack1','attack2','attack3','hit','death',
          'turn_left','turn_right','attack_stab','attack_slash','attack_swing','attack_uppercut','draw_sword','sheath'];
        // 清除目标世界本地旧模板缓存，避免污染
        ANIM_KEYS.forEach(k => localStorage.removeItem('selectedTemplateAnim_' + k));
        localStorage.removeItem('selectedTemplateId');
        localStorage.removeItem('selectedTemplateSkillAnims');
        // 写入源世界角色配置
        if (cc.glbUrl)             localStorage.setItem('selectedTemplateGlbUrl',       cc.glbUrl);
        if (cc.templateName)       localStorage.setItem('selectedTemplateName',         cc.templateName);
        if (cc.modelHeight)        localStorage.setItem('selectedTemplateHeight',       cc.modelHeight);
        if (cc.boneMapConfig)      localStorage.setItem('selectedTemplateBoneMap',      JSON.stringify(cc.boneMapConfig));
        if (cc.weaponSocketConfig) localStorage.setItem('selectedTemplateWeaponSocket', JSON.stringify(cc.weaponSocketConfig));
        if (cc.calibrationConfig)  localStorage.setItem('selectedTemplateCalibration',  JSON.stringify(cc.calibrationConfig));
        if (cc.weaponConfig)       localStorage.setItem('selectedTemplateWeaponConfig', JSON.stringify(cc.weaponConfig));
        if (cc.animUrls) {
          ANIM_KEYS.forEach(k => {
            if (cc.animUrls[k]) localStorage.setItem('selectedTemplateAnim_' + k, cc.animUrls[k]);
          });
        }
        if (window.SelfContainedChar) window.SelfContainedChar.applyReceived(cc);
        console.log('✅ [Teleport] 角色配置已从源世界同步:', cc.sourceWorldUrl, '| GLB:', cc.glbUrl);
      }

      // ── 写入源世界背包API信息（目标世界背包将直接读取源世界数据）──
      const inv = data.inventoryInfo;
      if (inv && inv.apiBaseUrl && inv.userId) {
        localStorage.setItem('federatedInventoryApiUrl', inv.apiBaseUrl);
        localStorage.setItem('federatedUserId',          inv.userId);
        localStorage.setItem('federatedToken',           inv.token || '');
        console.log('✅ [Teleport] 背包API已指向源世界:', inv.apiBaseUrl);

        // ── 家园世界模式：homeWorld* 只在第一次（没有时）写入，多跳时永远不覆盖 ──
        // homeWorldApiUrl 存的是玩家注册的那个"家园世界"，不随多跳而改变
        if (!localStorage.getItem('homeWorldApiUrl') && inv.homeWorldApiUrl) {
          localStorage.setItem('homeWorldApiUrl',  inv.homeWorldApiUrl);
          localStorage.setItem('homeWorldUserId',  inv.homeWorldUserId || inv.userId);
          localStorage.setItem('homeWorldToken',   inv.homeWorldToken  || inv.token || '');
          console.log('✅ [Teleport] 家园世界已锁定:', inv.homeWorldApiUrl);
        } else if (localStorage.getItem('homeWorldApiUrl')) {
          console.log('✅ [Teleport] 家园世界保持不变:', localStorage.getItem('homeWorldApiUrl'));
        }
      } else {
        localStorage.removeItem('federatedInventoryApiUrl');
        localStorage.removeItem('federatedUserId');
        localStorage.removeItem('federatedToken');
        // 离开联邦模式（回到家园世界）时清除 homeWorld* 记录
        localStorage.removeItem('homeWorldApiUrl');
        localStorage.removeItem('homeWorldUserId');
        localStorage.removeItem('homeWorldToken');
      }

      // 清除URL参数后初始化游戏
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);

      await initializeGame();

      // 游戏初始化后显示欢迎消息
      setTimeout(() => {
        UI.showNotification('🌀 传送成功', data.message || '欢迎来到新世界！', 4000);
      }, 2000);
    } else {
      // 传送验证失败，显示登录页
      console.warn('传送验证失败:', data.error);
      // 清除URL参数
      window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
      showLoginScreen();
      setTimeout(() => {
        UI.showNotification('⚠️ 传送失败', data.error || '传送验证失败，请手动登录', 4000);
      }, 500);
    }
  } catch (error) {
    console.error('传送到达处理失败:', error);
    window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
    showLoginScreen();
  }
}

// ── 游客模式：无需登录即可浏览世界 ──
async function initializeGameAsGuest() {
  try {
    // 使用 sessionStorage 保持同一标签页内游客ID一致（刷新不变化）
    let guestId = sessionStorage.getItem('guestId');
    if (!guestId) {
      guestId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      sessionStorage.setItem('guestId', guestId);
    }

    GAME_STATE.userId = null;
    GAME_STATE.characterId = guestId;
    GAME_STATE.characterData = null;
    GAME_STATE.isLoggedIn = false;
    GAME_STATE.isGuest = true;

    MOUSE.targetRotationX = MOUSE.rotationX;
    MOUSE.targetRotationY = MOUSE.rotationY;

    // 创建3D世界
    const canvas = document.getElementById('canvas');
    gameWorld = new World(canvas);
    window.gameWorld = gameWorld;

    // 获取出生点
    const spawnPosition = gameWorld.getSpawnPosition();
    console.log('🎮 游客初始化位置:', spawnPosition);

    // 创建游客玩家（无角色数据，无GLB模板）
    player = new Player(gameWorld, guestId, null, null);
    player.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
    window.player = player;

    // 初始化画廊系统（虚拟世界中显示照片/视频）
    if (typeof window.initGallerySystem === 'function') {
      window.initGallerySystem(gameWorld.scene, gameWorld.camera, player.characterGroup);
    }

    // 连接WebSocket
    await WSClient.connect(CONFIG.WS_URL);

    // 发送游客加入消息（标记isGuest=true）
    WSClient.send({
      type: 'PLAYER_JOIN',
      payload: {
        characterId: guestId,
        characterName: '游客',
        position: spawnPosition,
        glbUrl: null,
        animUrls: null,
        weaponConfig: null,
        boneMapConfig: null,
        weaponSocketConfig: null,
        calibrationConfig: null,
        isGuest: true,
      },
    });

    // 加载世界实体
    await loadWorldEntities();

    // Building Manager
    if (typeof BuildingManager !== 'undefined') {
      const buildingManager = new BuildingManager(gameWorld, gameWorld.camera, gameWorld.renderer);
      gameWorld.buildingManager = buildingManager;
      console.log('✅ Building Manager initialized');
    }

    // 启动UI更新
    startUIUpdates();

    // 隐藏加载画面
    UI.hideLoadingScreen();

    // 游客欢迎消息
    UI.addChatMessage('系统', '🌟 游览模式 - 您可以自由浏览世界');
    UI.showNotification('游览模式', '点击游戏区域启用控制 | 注册登录获得完整身份', 3500);

    // 设置快捷键
    setupKeyboardShortcuts();

    // VR支持
    if (CONFIG.ENABLE_VR) {
      setupVRSupport();
    }

    // 启动游戏循环
    console.log('Starting game loop (guest mode)...');
    gameLoop();

    // 初始化坐标复制按钮
    setTimeout(() => {
      initializeCopyCoordinates();
    }, 500);

    // 显示游客提示条（常驻顶部）
    showGuestBanner();
  } catch (error) {
    console.error('游客初始化失败:', error);
    UI.showNotification('错误', '初始化失败：' + error.message);
  }
}

// ── 游客提示条（常驻页面顶部）──
function showGuestBanner() {
  const existing = document.getElementById('guestBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'guestBanner';
  const guestBannerText = _t('guestBanner.text');
  const loginBtnText = _t('guestBanner.loginBtn');
  const registerBtnText = _t('guestBanner.registerBtn');
  banner.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 16px;">' +
      '<span style="display:flex;align-items:center;gap:6px;">' +
        '<span style="font-size:18px;">🌟</span>' +
        '<span>' + guestBannerText + '</span>' +
      '</span>' +
      '<div style="display:flex;gap:8px;">' +
        '<button id="guest-login-btn" style="padding:5px 14px;background:#00ff00;color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;font-family:\'Courier New\',monospace;">' + loginBtnText + '</button>' +
        '<button id="guest-register-btn" style="padding:5px 14px;background:rgba(0,255,0,0.2);color:#00ff00;border:1px solid #00ff00;border-radius:4px;cursor:pointer;font-size:12px;font-family:\'Courier New\',monospace;">' + registerBtnText + '</button>' +
      '</div>' +
    '</div>';
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:3000;' +
    'background:rgba(20,20,30,0.95);color:#00ff00;' +
    'border-bottom:1px solid #00ff00;' +
    'font-family:\'Courier New\',monospace;font-size:13px;';

  document.body.appendChild(banner);

  banner.querySelector('#guest-login-btn').addEventListener('click', () => showLoginScreen());
  banner.querySelector('#guest-register-btn').addEventListener('click', () => {
    const dummyLogin = document.createElement('div');
    dummyLogin.style.display = 'none';
    document.body.appendChild(dummyLogin);
    showRegisterDialog(dummyLogin);
  });
}

// Copy coordinates functionality
function initializeCopyCoordinates() {
  console.log('Initializing copy coordinates button...');
  const copyBtn = document.getElementById('copy-coords-btn');
  console.log('Copy button element:', copyBtn);
  console.log('Button computed style:', copyBtn ? window.getComputedStyle(copyBtn).pointerEvents : 'N/A');
  
  if (copyBtn) {
    console.log('Copy button found, adding click listener...');
    
    // Remove any existing listeners by cloning
    const newBtn = copyBtn.cloneNode(true);
    copyBtn.parentNode.replaceChild(newBtn, copyBtn);
    
    // Add mouseover/mouseout effects via JavaScript
    newBtn.addEventListener('mouseenter', () => {
      newBtn.style.background = 'linear-gradient(135deg, rgba(0, 255, 0, 0.4), rgba(0, 200, 0, 0.5))';
      newBtn.style.transform = 'scale(1.05)';
    });
    
    newBtn.addEventListener('mouseleave', () => {
      newBtn.style.background = 'linear-gradient(135deg, rgba(0, 255, 0, 0.2), rgba(0, 200, 0, 0.3))';
      newBtn.style.transform = 'scale(1)';
    });
    
    newBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.log('Copy button clicked!');
      console.log('Player object:', player);
      console.log('Player position:', player ? player.position : 'null');
      
      if (player && player.position) {
        const x = player.position.x.toFixed(1);
        const y = player.position.y.toFixed(1);
        const z = player.position.z.toFixed(1);
        const coords = `X:${x} Y:${y} Z:${z}`;
        
        console.log('Copying coordinates:', coords);
        
        // Try to copy to clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(coords)
            .then(() => {
              console.log('Copy successful!');
              // Success feedback
              const originalText = newBtn.innerHTML;
              newBtn.innerHTML = '✅ 已复制！';
              newBtn.style.background = 'linear-gradient(135deg, rgba(0, 255, 0, 0.6), rgba(0, 255, 0, 0.8))';
              newBtn.style.transform = 'scale(1.05)';
              
              // Show detailed notification
              UI.showNotification('📋 坐标已复制到剪贴板', `${coords}\n\n可分享此坐标给其他玩家`, 3000);
              
              // Reset button after 3 seconds
              setTimeout(() => {
                newBtn.innerHTML = originalText;
                newBtn.style.background = 'linear-gradient(135deg, rgba(0, 255, 0, 0.2), rgba(0, 200, 0, 0.3))';
                newBtn.style.transform = 'scale(1)';
              }, 3000);
            })
            .catch(err => {
              console.error('复制失败:', err);
              // Fallback: show prompt with coordinates
              prompt('📋 请手动复制坐标:', coords);
            });
        } else {
          // Fallback for older browsers
          console.log('Using fallback copy method...');
          const textarea = document.createElement('textarea');
          textarea.value = coords;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          
          try {
            document.execCommand('copy');
            console.log('Fallback copy successful!');
            const originalText = newBtn.innerHTML;
            newBtn.innerHTML = '✅ 已复制！';
            newBtn.style.background = 'linear-gradient(135deg, rgba(0, 255, 0, 0.6), rgba(0, 255, 0, 0.8))';
            UI.showNotification('📋 坐标已复制', coords, 2000);
            
            setTimeout(() => {
              newBtn.innerHTML = originalText;
              newBtn.style.background = 'linear-gradient(135deg, rgba(0, 255, 0, 0.2), rgba(0, 200, 0, 0.3))';
            }, 3000);
          } catch (err) {
            console.error('Fallback copy failed:', err);
            prompt('📋 请手动复制坐标:', coords);
          }
          
          document.body.removeChild(textarea);
        }
      } else {
        console.warn('Player or position not available');
        UI.showNotification('⚠️ 提示', '玩家位置未加载，请稍候重试', 2000);
      }
    });
    console.log('Copy button listener added successfully');
  } else {
    console.error('Copy button not found in DOM!');
  }
}

async function initializeGame() {
  try {
    // 初始化鼠标目标旋转角度
    MOUSE.targetRotationX = MOUSE.rotationX;
    MOUSE.targetRotationY = MOUSE.rotationY;
    
    // Restore session data
    GAME_STATE.userId = localStorage.getItem('userId');
    GAME_STATE.characterId = localStorage.getItem('characterId');
    if (!GAME_STATE.characterId || GAME_STATE.characterId === 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('userId');
      localStorage.removeItem('characterId');
      window.location.reload();
      return;
    }

    // Create 3D world
    const canvas = document.getElementById('canvas');
    gameWorld = new World(canvas);
    window.gameWorld = gameWorld; // Make accessible globally

    // Load character data
    const characterData = await API.getCharacter(GAME_STATE.characterId);
    GAME_STATE.characterData = characterData;

    // 设置技能管理器的角色ID
    if (window.skillManager) {
      window.skillManager.setCharacterId(GAME_STATE.characterId);
    }

    // Create player controller at spawn position
    // Note: World will load spawn point asynchronously, but provides default position immediately
    const spawnPosition = gameWorld.getSpawnPosition();
    console.log('🎮 初始化玩家位置:', spawnPosition);

    // 读取已选角色模板 GLB 及所有MVP动画
    // 防御字符串 "null"（localStorage.setItem('key', null) 会存入字符串 "null"）
    const selectedGlbUrl = (() => {
      const v = localStorage.getItem('selectedTemplateGlbUrl');
      return (!v || v === 'null' || v.trim() === '') ? null : v;
    })();
    const selectedWalkUrl = localStorage.getItem('selectedTemplateWalkUrl') || null;
    const selectedRunUrl = localStorage.getItem('selectedTemplateRunUrl') || null;
    const selectedTemplateId = localStorage.getItem('selectedTemplateId') || null;
    // 读取武器配置
    let selectedWeaponConfig = null;
    try {
      const wcRaw = localStorage.getItem('selectedTemplateWeaponConfig');
      if (wcRaw) selectedWeaponConfig = JSON.parse(wcRaw);
    } catch(e) {}
    // 读取全部基础动画URL（不限制文件名白名单，支持所有新建角色模板）
    const MVP_ANIM_KEYS = ['idle','walk','run','jump','attack1','attack2','attack3','hit','death',
      'turn_left','turn_right','attack_stab','attack_slash','attack_swing','attack_uppercut','draw_sword','sheath'];
    const selectedAnimUrls = {};
    MVP_ANIM_KEYS.forEach(k => {
      const v = localStorage.getItem('selectedTemplateAnim_'+k);
      if (v && v.trim() !== '') selectedAnimUrls[k] = v;
    });
    // 兼容旧存储（walk/run）
    if (!selectedAnimUrls.walk && selectedWalkUrl) selectedAnimUrls.walk = selectedWalkUrl;
    if (!selectedAnimUrls.run  && selectedRunUrl)  selectedAnimUrls.run  = selectedRunUrl;
    // 读取扩展技能动画URL
    try {
      const skillAnimsRaw = localStorage.getItem('selectedTemplateSkillAnims');
      if (skillAnimsRaw) {
        const skillAnims = JSON.parse(skillAnimsRaw);
        skillAnims.forEach(s => {
          if (s.id && s.anim_glb_url) {
            selectedAnimUrls['skill_' + s.id] = s.anim_glb_url;
          }
        });
      }
    } catch(e) { console.warn('[main] 读取技能动画缓存失败', e); }

    if (selectedGlbUrl) {
      console.log('🎭 使用角色模板 GLB:', selectedGlbUrl,
        '| 已配置动画:', Object.keys(selectedAnimUrls).join('/'));
    }

    // 加载动画的函数（统一入口，接收实际生效的 glbUrl 参数，避免闭包旧值问题）
    const scheduleLoadAnims = (animUrls, effectiveGlbUrl) => {
      const glb = effectiveGlbUrl || selectedGlbUrl;
      if (!glb || Object.keys(animUrls).length === 0) return;
      console.log('🎬 开始加载动画，模型URL:', glb, '动画列表:', Object.keys(animUrls).join('/'));
      Object.entries(animUrls).forEach(([type, url]) => {
        if (url) gameWorld._loadPlayerAnimGlb(GAME_STATE.characterId, type, url);
      });
    };

    // 从API加载模板完整配置的函数（统一入口）
    const loadTemplateFromApi = (resolvedGlbUrlArg) => {
      return fetch('/api/public/character-templates')
        .then(r => r.json())
        .then(data => {
          const templates = data.templates || [];
          // 优先按 templateId 匹配，fallback 用 glbUrl 反查
          let tmpl = selectedTemplateId
            ? templates.find(t => String(t.id) === String(selectedTemplateId))
            : null;
          if (!tmpl) {
            const glbToMatch = resolvedGlbUrlArg || selectedGlbUrl;
            if (glbToMatch) {
              tmpl = templates.find(t => t.glb_url && (
                t.glb_url === glbToMatch ||
                glbToMatch.endsWith(t.glb_url) ||
                t.glb_url.endsWith(glbToMatch.replace(/^.*\/uploads\//, '/uploads/'))
              ));
              if (tmpl) {
                console.log('🔍 [main] 通过GLB URL反查到模板:', tmpl.name);
                localStorage.setItem('selectedTemplateId', tmpl.id);
              }
            }
          }
          if (!tmpl) {
            console.warn('🚫 API中未找到模板ID:', selectedTemplateId, '且GLB URL无法反查, glbToMatch:', resolvedGlbUrlArg || selectedGlbUrl);
            console.warn('🚫 服务器返回模板列表:', templates.map(t => t.id + '|' + t.name + '|' + t.glb_url).join(', '));
            return resolvedGlbUrlArg;
          }
          console.log('✅ API返回模板:', tmpl.name, 'GLB:', tmpl.glb_url);

          // 确定最终 GLB URL
          let finalGlbUrl = resolvedGlbUrlArg || selectedGlbUrl;
          if (!finalGlbUrl && tmpl.glb_url && tmpl.glb_url !== 'null') {
            finalGlbUrl = tmpl.glb_url;
            localStorage.setItem('selectedTemplateGlbUrl', finalGlbUrl);
            console.log('🔄 从API补全GLB URL:', finalGlbUrl);
          }

          // 补全动画URL
          MVP_ANIM_KEYS.forEach(k => {
            const url = tmpl[`anim_${k}_url`];
            if (url && url !== 'null' && !selectedAnimUrls[k]) {
              selectedAnimUrls[k] = url;
              localStorage.setItem('selectedTemplateAnim_' + k, url);
            }
          });

          // 无论如何都覆盖写入骨骼映射、校准参数、武器插槽（以服务器数据为准）
          if (tmpl.bone_mapping_config)  localStorage.setItem('selectedTemplateBoneMap',      JSON.stringify(tmpl.bone_mapping_config));
          if (tmpl.weapon_socket_config) localStorage.setItem('selectedTemplateWeaponSocket', JSON.stringify(tmpl.weapon_socket_config));
          if (tmpl.calibration_config)   localStorage.setItem('selectedTemplateCalibration',  JSON.stringify(tmpl.calibration_config));
          if (tmpl.fit_config)           localStorage.setItem('selectedTemplateFitConfig',     JSON.stringify(tmpl.fit_config));
          // 武器配置：始终以服务器数据为准（覆盖旧缓存）
          // weapon_lib_config 是武器库实际配置（服务器新旧版本均会返回），优先使用
          const _effectiveWeaponConfig = (() => {
            const base = (tmpl.weapon_config && typeof tmpl.weapon_config === 'object') ? tmpl.weapon_config : {};
            const lib  = (tmpl.weapon_lib_config && typeof tmpl.weapon_lib_config === 'object') ? tmpl.weapon_lib_config : {};
            const merged = Object.assign({}, base, lib);
            if (tmpl.weapon_id) {
              merged.weapon_id = tmpl.weapon_id;
              if (tmpl.weapon_name) merged.weapon_name = tmpl.weapon_name;
              if (tmpl.weapon_type_from_lib) merged.weapon_type = tmpl.weapon_type_from_lib;
            }
            return merged;
          })();
          console.log('[main] 模板 weapon_id:', tmpl.weapon_id, '| weapon_config:', JSON.stringify(tmpl.weapon_config), '| weapon_lib_config:', JSON.stringify(tmpl.weapon_lib_config), '| merged:', JSON.stringify(_effectiveWeaponConfig));
          if (tmpl.weapon_id && Object.keys(_effectiveWeaponConfig).length > 0) {
            localStorage.setItem('selectedTemplateWeaponConfig', JSON.stringify(_effectiveWeaponConfig));
            selectedWeaponConfig = _effectiveWeaponConfig;
            console.log('✅ [main] 武器配置已从服务器同步:', JSON.stringify(_effectiveWeaponConfig));
          } else if (!tmpl.weapon_id) {
            // 模板无武器，清空缓存
            localStorage.removeItem('selectedTemplateWeaponConfig');
            selectedWeaponConfig = null;
          }

          if (tmpl.model_height) localStorage.setItem('selectedTemplateHeight', String(tmpl.model_height));

          // 保存模板数据（含音效配置），供声音系统使用
          _currentTmplData = tmpl;

          console.log('✅ 模板配置已从API补全，GLB:', finalGlbUrl, '动画:', Object.keys(selectedAnimUrls).join('/') || '(无)');
          return finalGlbUrl;
        });
    };

    // 在创建 Player 之前，先从 API 补全模板配置（确保 weaponConfig 写入 localStorage 再创建角色）
    console.log('[main] 预加载检查 selectedTemplateId:', selectedTemplateId, '| selectedGlbUrl:', selectedGlbUrl);
    let _finalGlbUrl = selectedGlbUrl;
    const skipTemplateApi = window.SelfContainedChar &&
      window.SelfContainedChar.isActive() &&
      window.SelfContainedChar.isSelfContainedModeEnabled();
    if (skipTemplateApi) {
      console.log('[main] 自包含角色包模式：跳过本地模板 API 补全，使用源世界动画');
    }
    if (!skipTemplateApi && (selectedTemplateId || selectedGlbUrl)) {
      try {
        _finalGlbUrl = await loadTemplateFromApi(selectedGlbUrl);
        console.log('✅ [main] 模板配置预加载完成，动画:', Object.keys(selectedAnimUrls).join('/') || '(无)');
      } catch (err) {
        console.warn('🚫 [main] 模板配置预加载失败，使用缓存:', err);
      }
    } else if (!skipTemplateApi) {
      console.log('[main] 未选择角色模板，跳过预加载，将使用默认外观');
    }

    // 此时 localStorage 里的 selectedTemplateWeaponConfig 已是最新，再创建 Player
    player = new Player(gameWorld, GAME_STATE.characterId, characterData, _finalGlbUrl || selectedGlbUrl);

    // Set player initial position to spawn point
    player.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);

    window.player = player;  // Make accessible globally

    // 初始化画廊系统（虚拟世界中显示照片/视频）
    if (typeof window.initGallerySystem === 'function') {
      window.initGallerySystem(gameWorld.scene, gameWorld.camera, player.characterGroup);
    }

    // Initialize voice manager
    try {
      voiceManager = new VoiceManager(player);
      window.voiceManagerInstance = voiceManager; // 供 skillHUD 语音按钮使用
      const hasMicrophone = await voiceManager.requestMicrophonePermission();
      if (hasMicrophone) {
        voiceManager.startListening();
        UI.addChatMessage('系统', '语音识别已激活（中文）');
      }
    } catch (voiceErr) {
      console.warn('[main] 语音管理器初始化失败:', voiceErr.message);
      // 语音失败不影响游戏继续运行
    }

    // Initialize skills manager (SkillsManager not available, skip)
    // skillsManager = new SkillsManager(player);

    // Connect to WebSocket
    await WSClient.connect(CONFIG.WS_URL);

    // 加载自己的 GLB 和动画
    if (window.SelfContainedChar && player && player.characterGroup) {
      window.SelfContainedChar.markGroup(player.characterGroup, window.SelfContainedChar.isActive());
    }

    if (_finalGlbUrl) {
      const playerData = gameWorld.players.get(GAME_STATE.characterId);
      if (playerData) {
        if (!selectedGlbUrl || _finalGlbUrl !== selectedGlbUrl) {
          gameWorld._loadPlayerGlb(GAME_STATE.characterId, playerData.group, playerData.nameSprite, _finalGlbUrl);
          if (player) player.glbUrl = _finalGlbUrl;
        }
      }
      scheduleLoadAnims(selectedAnimUrls, _finalGlbUrl);
    }

    // ── 加载角色模板音效到内存 ──
    if (_currentTmplData && typeof soundManager !== 'undefined' && soundManager.loadTemplateAudio) {
      soundManager.loadTemplateAudio({
        anim_sounds: _currentTmplData.anim_sounds || {},
        weapon_sounds: _currentTmplData.weapon_sounds || {}
      });
      console.log('✅ [main] 模板音效已加载:', Object.keys(_currentTmplData.anim_sounds || {}).join('/') || '(无动作音效)', Object.keys(_currentTmplData.weapon_sounds || {}).join('/') || '(无武器音效)');
    } else {
      console.log('[main] 无模板音效可加载:', { hasTmplData: !!_currentTmplData, soundManagerLoaded: typeof soundManager !== 'undefined' });
    }

    // Send player join message with spawn position（此时 selectedAnimUrls 已被 loadTemplateFromApi 填充）
    // 读取骨骼映射、武器插槽、校准配置，用于其他玩家正确显示角色
    let _boneMapConfig = null, _weaponSocketConfig = null, _calibrationConfig = null;
    try {
      const bmRaw = localStorage.getItem('selectedTemplateBoneMap');
      if (bmRaw) _boneMapConfig = JSON.parse(bmRaw);
    } catch(e) {}
    try {
      const wsRaw = localStorage.getItem('selectedTemplateWeaponSocket');
      if (wsRaw) _weaponSocketConfig = JSON.parse(wsRaw);
    } catch(e) {}
    try {
      const calRaw = localStorage.getItem('selectedTemplateCalibration');
      if (calRaw) _calibrationConfig = JSON.parse(calRaw);
    } catch(e) {}
    WSClient.send({
      type: 'PLAYER_JOIN',
      payload: {
        characterId: GAME_STATE.characterId,
        characterName: characterData.character.name,
        position: spawnPosition,
        glbUrl: _finalGlbUrl || null,
        animUrls: Object.keys(selectedAnimUrls).length > 0 ? selectedAnimUrls : null,
        weaponConfig: selectedWeaponConfig || null,
        boneMapConfig: _boneMapConfig || null,
        weaponSocketConfig: _weaponSocketConfig || null,
        calibrationConfig: (_calibrationConfig && Object.keys(_calibrationConfig).length > 0) ? _calibrationConfig : null,
        isSelfContainedBundle: window.SelfContainedChar ? window.SelfContainedChar.isActive() : false,
      },
    });

    // Load world entities
    await loadWorldEntities();
    
    // Initialize Building Manager (for admin)
    if (typeof BuildingManager !== 'undefined') {
      const buildingManager = new BuildingManager(
        gameWorld,
        gameWorld.camera,
        gameWorld.renderer
      );
      gameWorld.buildingManager = buildingManager;
      console.log('✅ Building Manager initialized');
    }

    // Start UI updates
    startUIUpdates();

    // Hide loading screen
    UI.hideLoadingScreen();

    // Welcome message
    UI.addChatMessage('系统', `欢迎 ${characterData.character.name} 加入虚拟世界！`);
    UI.showNotification('连接成功', '虚拟世界已初始化 - 点击游戏区域启用控制', 2000);

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Setup VR support (if available)
    if (CONFIG.ENABLE_VR) {
      setupVRSupport();
    }

    // Start game loop AFTER everything is initialized
    console.log('Starting game loop...');
    gameLoop();
    
    // Initialize copy coordinates button (after game is fully loaded)
    setTimeout(() => {
      initializeCopyCoordinates();
      console.log('Copy coordinates button initialized');
    }, 500);
  } catch (error) {
    console.error('Game initialization failed:', error);
    throw error;
  }
}

async function loadWorldEntities() {
  try {
    const worldState = await API.getWorldState();

    // Load shops
    worldState.shops.forEach((shop) => {
      // Shops are visual elements in the world
      console.log('Loading shop:', shop.shop_name);
    });

    // Load monsters
    worldState.monsters.forEach((monster) => {
      let pos = monster.spawn_position;
      if (typeof pos === 'string') {
        try { pos = JSON.parse(pos); } catch(e) { pos = { x: 0, y: 0, z: 0 }; }
      }
      if (!pos || typeof pos.x === 'undefined') pos = { x: 0, y: 0, z: 0 };
      gameWorld.addMonster(monster.id, monster.monster_type, pos, monster.health || null, monster.max_health || null);
    });

    // Load other players
    worldState.characters.forEach((character) => {
      if (character.id !== GAME_STATE.characterId) {
        const glbUrl = character.glbUrl && character.glbUrl !== 'null' ? character.glbUrl : null;
        const existing = gameWorld.players.get(character.id);
        if (!existing) {
          // 本地没有该玩家，直接添加
          gameWorld.addPlayer(character.id, character.name, character.position, true, glbUrl);
        } else if (glbUrl && !existing.group.userData.glbModel && !existing.group.userData._loadingGlbUrl) {
          // 玩家已存在但还没加载模型，补充加载
          console.log('[main] REST补充加载玩家模型:', character.id, glbUrl);
          gameWorld._loadPlayerGlb(character.id, existing.group, existing.nameSprite, glbUrl);
        }
        // 已有模型或正在加载中：不覆盖，避免破坏正在进行的加载
      }
    });

    // Load portals (传送门)
    await loadPortals();
  } catch (error) {
    console.error('Failed to load world entities:', error);
  }
}

async function loadPortals() {
  try {
    const portals = await API.get('/portal');
    if (!Array.isArray(portals)) {
      console.warn('⚠️ 传送门数据格式异常:', portals);
      return;
    }
    console.log(`📋 加载了 ${portals.length} 个传送门`);
    
    portals.forEach((portal) => {
      gameWorld.addPortal(
        portal.id,
        portal.name,
        portal.source_position,
        portal.target_position,
        portal.portal_type
      );
    });
    
    UI.addChatMessage('系统', `✨ 已加载 ${portals.length} 个传送门`);
  } catch (error) {
    console.error('❌ 加载传送门失败:', error);
    UI.addChatMessage('系统', '加载传送门失败');
  }
}

function startUIUpdates() {
  // Update minimap every 500ms
  setInterval(() => {
    if (player && gameWorld) {
      UI.updateMinimap(player.position, Array.from(gameWorld.monsters.values()), []);
    }
  }, 500);
}

function setupKeyboardShortcuts() {
  // Close button for controls hint
  const closeBtn = document.getElementById('close-controls-hint');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      UI.hideControlsHint();
    });
  }

  const canvas = document.getElementById('canvas');

  // Mouse drag for camera control
  let isFirstMove = false; // 标记是否是拖动后的第一次移动
  
  canvas.addEventListener('mousedown', (e) => {
    // 修复：拖拽 TransformControls gizmo 时禁止相机旋转（否则相机抢鼠标、gizmo拖不动）
    const _bmTc = window.gameWorld && window.gameWorld.buildingManager && window.gameWorld.buildingManager.transformControls;
    if (_bmTc && _bmTc.dragging) return;
    // 左键、右键、中键都可以拖动（兼容手机触摸）
    MOUSE.isDragging = true;
    MOUSE.lastX = e.clientX;
    MOUSE.lastY = e.clientY;
    isFirstMove = true; // 标记为第一次移动
    UI.hideControlsHint();
    
    // 如果是右键，阻止菜单
    if (e.button === 2) {
      e.preventDefault();
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    MOUSE.isDragging = false;
    isFirstMove = false;
  });

  // 左键单击：拾取怪物目标（仅在非拖拽时触发）
  let _mousedownX = 0, _mousedownY = 0;
  canvas.addEventListener('mousedown', (e2) => {
    _mousedownX = e2.clientX; _mousedownY = e2.clientY;
  }, true);
  canvas.addEventListener('click', (e) => {
    // 如果鼠标移动超过5px认为是拖拽，不触发选怪
    if (Math.abs(e.clientX - _mousedownX) > 5 || Math.abs(e.clientY - _mousedownY) > 5) return;
    if (!player || !window.gameWorld || !window.gameWorld.camera) return;

    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, window.gameWorld.camera);

    // 收集所有怪物的子Mesh
    const monsterMeshes = [];
    window.gameWorld.monsters.forEach((monsterData) => {
      monsterData.group.traverse((child) => {
        if (child.isMesh) monsterMeshes.push(child);
      });
    });

    const intersects = raycaster.intersectObjects(monsterMeshes, false);
    if (intersects.length > 0) {
      const hit = intersects[0].object;
      // 找到 monsterId（自身或祖先上标记）
      let monsterId = hit.userData.monsterId;
      if (!monsterId) {
        let obj = hit.parent;
        while (obj) { if (obj.userData.monsterId) { monsterId = obj.userData.monsterId; break; } obj = obj.parent; }
      }
      if (monsterId && window.gameWorld.monsters.has(monsterId)) {
        const monsterData = window.gameWorld.monsters.get(monsterId);
        player.setTarget(monsterId, monsterData);
        console.log(`[Combat] 点击选中怪物: ${monsterId}`);
      }
    } else {
      // 点击空地，取消战斗
      if (player.combatState !== 'idle') {
        player.clearCombat();
      }
    }
  });

  canvas.addEventListener('mouseleave', () => {
    MOUSE.isDragging = false;
    isFirstMove = false;
  });
  
  // 禁用右键菜单
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  canvas.addEventListener('mousemove', (e) => {
    if (MOUSE.isDragging) {
      // 跳过第一次移动事件，避免初始跳变
      if (isFirstMove) {
        MOUSE.lastX = e.clientX;
        MOUSE.lastY = e.clientY;
        isFirstMove = false;
        return;
      }
      
      const deltaX = e.clientX - MOUSE.lastX;
      const deltaY = e.clientY - MOUSE.lastY;
      
      // 过滤异常大的跳变（防止震动）
      const maxDelta = 100; // 最大允许的单帧移动距离
      if (Math.abs(deltaX) > maxDelta || Math.abs(deltaY) > maxDelta) {
        MOUSE.lastX = e.clientX;
        MOUSE.lastY = e.clientY;
        return; // 忽略异常大的移动
      }
      
      MOUSE.lastX = e.clientX;
      MOUSE.lastY = e.clientY;
      
      // 使用配置的灵敏度
      const sensitivity = MOUSE.sensitivity || 0.005;
      
      // 更新目标旋转角度
      MOUSE.targetRotationY -= deltaX * sensitivity; // Horizontal rotation
      
      // Vertical rotation - 第一视角和第三视角方向相反
      if (GAME_STATE.cameraMode === 'first-person') {
        MOUSE.targetRotationX -= deltaY * sensitivity; // 第一视角：鼠标上移，视角上看
      } else {
        MOUSE.targetRotationX += deltaY * sensitivity; // 第三视角：鼠标上移，视角上看
      }
      
      // Clamp vertical rotation target to prevent flipping
      MOUSE.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, MOUSE.targetRotationX));
    }
  });
  
  // 添加触摸事件支持（手机端）
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      
      // 触发攻击动画
      if (window.gameWorld && GAME_STATE.characterId) {
        window.gameWorld.triggerAttackAnimation(GAME_STATE.characterId);
      }
      
      MOUSE.isDragging = true;
      MOUSE.lastX = touch.clientX;
      MOUSE.lastY = touch.clientY;
      isFirstMove = true;
      UI.hideControlsHint();
      e.preventDefault();
    }
  });
  
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && MOUSE.isDragging) {
      const touch = e.touches[0];
      
      // 跳过第一次移动事件
      if (isFirstMove) {
        MOUSE.lastX = touch.clientX;
        MOUSE.lastY = touch.clientY;
        isFirstMove = false;
        return;
      }
      
      const deltaX = touch.clientX - MOUSE.lastX;
      const deltaY = touch.clientY - MOUSE.lastY;
      
      // 过滤异常大的跳变
      const maxDelta = 100;
      if (Math.abs(deltaX) > maxDelta || Math.abs(deltaY) > maxDelta) {
        MOUSE.lastX = touch.clientX;
        MOUSE.lastY = touch.clientY;
        return;
      }
      
      MOUSE.lastX = touch.clientX;
      MOUSE.lastY = touch.clientY;
      
      // 使用配置的灵敏度
      const sensitivity = MOUSE.sensitivity || 0.005;
      
      // 更新目标旋转角度
      MOUSE.targetRotationY -= deltaX * sensitivity;
      
      if (GAME_STATE.cameraMode === 'first-person') {
        MOUSE.targetRotationX -= deltaY * sensitivity;
      } else {
        MOUSE.targetRotationX += deltaY * sensitivity;
      }
      
      MOUSE.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, MOUSE.targetRotationX));
      e.preventDefault();
    }
  });
  
  canvas.addEventListener('touchend', (e) => {
    MOUSE.isDragging = false;
    isFirstMove = false;
  });
  
  canvas.addEventListener('touchcancel', (e) => {
    MOUSE.isDragging = false;
    isFirstMove = false;
  });

  // Keyboard state management
  document.addEventListener('keydown', (e) => {
    switch(e.key.toLowerCase()) {
      case 'w':
        KEYS.w = true;
        if (player && player.combatState !== 'idle') player.clearCombat();
        break;
      case 'a':
        KEYS.a = true;
        if (player && player.combatState !== 'idle') player.clearCombat();
        break;
      case 's':
        KEYS.s = true;
        if (player && player.combatState !== 'idle') player.clearCombat();
        break;
      case 'd':
        KEYS.d = true;
        if (player && player.combatState !== 'idle') player.clearCombat();
        break;
      case ' ': // space
        KEYS.space = true;
        break;
      case 'shift':
        KEYS.shift = true;
        break;
    }
  });

  document.addEventListener('keyup', (e) => {
    switch(e.key.toLowerCase()) {
      case 'w':
        KEYS.w = false;
        break;
      case 'a':
        KEYS.a = false;
        break;
      case 's':
        KEYS.s = false;
        break;
      case 'd':
        KEYS.d = false;
        break;
      case ' ': // space
        KEYS.space = false;
        break;
      case 'shift':
        KEYS.shift = false;
        break;
    }
  });

  document.addEventListener('keydown', (e) => {
    // V key to toggle voice
    if (e.key === 'v' || e.key === 'V') {
      if (voiceManager.isListening) {
        voiceManager.stopListening();
        UI.addChatMessage('系统', '语音识别已暂停');
      } else {
        voiceManager.startListening();
        UI.addChatMessage('系统', '语音识别已启用');
      }
    }

    // C key to toggle camera mode
    if (e.key === 'c' || e.key === 'C') {
      GAME_STATE.cameraMode = GAME_STATE.cameraMode === 'first-person' ? 'third-person' : 'first-person';
      const modeText = GAME_STATE.cameraMode === 'first-person' ? '第一视角' : '第三视角';
      UI.addChatMessage('系统', `已切换到${modeText}`);
    }

    // M key for minimap
    if (e.key === 'm' || e.key === 'M') {
      const minimap = document.getElementById('minimap');
      minimap.style.display = minimap.style.display === 'none' ? 'block' : 'none';
    }

    // P key to set respawn point
    if (e.key === 'p' || e.key === 'P') {
      API.setRespawnPoint(GAME_STATE.characterId, {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      });
      UI.addChatMessage('系统', '重生点已设置');
    }

    // I key to interact with nearby shops (changed from E since E is now rotation)
    if (e.key === 'i' || e.key === 'I') {
      interactWithNearby();
    }

    // F key - 开启/静音附近视频声音
    if (e.key === 'f' || e.key === 'F') {
      if (gameWorld && gameWorld._mediaMeshes && gameWorld._mediaMeshes.size > 0) {
        const playerPos = player ? player.position : null;
        if (!playerPos) return;
        let closestId = null, closestDist = Infinity;
        gameWorld._mediaMeshes.forEach(({ mesh, type }, id) => {
          if (type !== 'video') return;
          const d = playerPos.distanceTo(mesh.position);
          if (d < 40 && d < closestDist) { closestDist = d; closestId = id; }
        });
        if (closestId) {
          const ok = gameWorld.enableVideoSpatialAudio(closestId);
          if (ok) {
            const info = gameWorld._mediaMeshes.get(closestId);
            UI.addChatMessage('系统', `🔊 视频声音已开启: ${info.obj.name || ''}`);
          }
        }
      }
    }

    // ESC key handler is in config.js (shows exit dialog)
    // ESC 同时取消怪物战斗锁定
    if ((e.key === 'Escape' || e.key === 'escape') && player && player.combatState !== 'idle') {
      player.clearCombat();
    }
  });
}

function interactWithNearby() {
  // Check for nearby shops
  API.getShops()
    .then((result) => {
      result.shops.forEach((shop) => {
        const distance = player.position.distanceTo(
          new THREE.Vector3(shop.position.x, shop.position.y, shop.position.z)
        );

        if (distance < 10) {
          // Show shop UI
          API.getShop(shop.id).then((shopData) => {
            UI.showShopUI(shopData.shop);
          });
        }
      });
    })
    .catch((error) => console.error('Failed to fetch shops:', error));
}

function setupVRSupport() {
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      if (supported) {
        console.log('VR is supported');
        // Add VR button to UI
        const vrButton = document.createElement('button');
        vrButton.textContent = 'Enter VR';
        vrButton.style.cssText = `
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 10px 20px;
          background: #00ff00;
          color: #000;
          border: none;
          cursor: pointer;
          font-weight: bold;
        `;

        vrButton.addEventListener('click', () => {
          enterVRMode();
        });

        document.body.appendChild(vrButton);
      }
    });
  }
}

function enterVRMode() {
  GAME_STATE.isInVR = true;
  UI.addChatMessage('系统', 'VR模式已启用');
}

function showLoginScreen() {
  // Hide loading screen
  const loadingScreen = document.getElementById('loadingScreen');
  if (loadingScreen) {
    loadingScreen.style.display = 'none';
  }
  
  const loginScreen = document.createElement('div');
  loginScreen.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 2000;
  `;

  // Pre-compute translated strings for login screen
  var loginTitle = _t('login.title');
  var loginSubtitle = _t('login.subtitle');
  var loginNoHint = _t('login.noHint');
  var loginUsernamePh = _t('login.usernamePlaceholder');
  var loginPasswordPh = _t('login.passwordPlaceholder');
  var loginLoginBtn = _t('login.loginBtn');
  var loginRegisterBtn = _t('login.registerBtn');
  var loginForgotPwdBtn = _t('login.forgotPwdBtn');
  var loginGuestSkipBtn = _t('login.guestSkipBtn');
  var loginTipTitle = _t('login.tipTitle');
  var loginTipLine1 = _t('login.tipLine1');
  var loginTipLine2 = _t('login.tipLine2');

  loginScreen.innerHTML = `
    <div style="
      background: rgba(0, 0, 0, 0.8);
      border: 3px solid #00ff00;
      padding: 40px;
      border-radius: 10px;
      width: 350px;
      text-align: center;
      font-family: 'Courier New', monospace;
    ">
      <h1 style="color: #00ff00; margin-bottom: 10px; font-size: 32px;">${loginTitle}</h1>
      <p style="color: #88ff88; font-size: 12px; margin-bottom: 10px;">${loginSubtitle}</p>
      <p style="color: #ff6666; font-size: 11px; margin-bottom: 20px;">${loginNoHint}</p>
      
      <input type="text" id="username" placeholder="${loginUsernamePh}" autocomplete="username" style="
        width: 100%;
        padding: 12px;
        margin: 10px 0;
        background: rgba(0, 100, 0, 0.3);
        border: 2px solid #00ff00;
        border-radius: 5px;
        color: #00ff00;
        font-family: 'Courier New', monospace;
        font-size: 14px;
      ">
      
      <input type="password" id="password" placeholder="${loginPasswordPh}" autocomplete="current-password" style="
        width: 100%;
        padding: 12px;
        margin: 10px 0;
        background: rgba(0, 100, 0, 0.3);
        border: 2px solid #00ff00;
        border-radius: 5px;
        color: #00ff00;
        font-family: 'Courier New', monospace;
        font-size: 14px;
      ">
      
      <button id="loginBtn" style="
        width: 100%;
        padding: 12px;
        margin: 15px 0 10px 0;
        background: #00ff00;
        color: #000;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-weight: bold;
        font-size: 16px;
        font-family: 'Courier New', monospace;
      ">${loginLoginBtn}</button>
      
      <button id="registerBtn" style="
        width: 100%;
        padding: 12px;
        margin: 5px 0;
        background: rgba(0, 100, 0, 0.5);
        color: #00ff00;
        border: 2px solid #00ff00;
        border-radius: 5px;
        cursor: pointer;
        font-family: 'Courier New', monospace;
        font-size: 14px;
      ">${loginRegisterBtn}</button>
      
      <button id="forgotPwdBtn" style="
        width: 100%;
        padding: 8px;
        margin: 5px 0;
        background: transparent;
        color: #888;
        border: 1px solid #444;
        border-radius: 5px;
        cursor: pointer;
        font-family: 'Courier New', monospace;
        font-size: 12px;
      ">${loginForgotPwdBtn}</button>
      
      <button id="guestSkipBtn" style="
        width: 100%;
        padding: 8px;
        margin: 5px 0;
        background: transparent;
        color: #888;
        border: 1px solid #444;
        border-radius: 5px;
        cursor: pointer;
        font-family: 'Courier New', monospace;
        font-size: 12px;
      ">${loginGuestSkipBtn}</button>
      
      <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #00ff00;">
        <div style="color: #ffff00; font-size: 11px; margin-bottom: 5px;">${loginTipTitle}</div>
        <div style="color: #88ff88; font-size: 10px; line-height: 1.4;">
          ${loginTipLine1}<br>
          ${loginTipLine2}
        </div>
      </div>

      <div id="loginStatusMsg" style="margin-top: 12px; color: #ff6644; font-size: 12px; min-height: 18px;"></div>
    </div>
  `;

  document.body.appendChild(loginScreen);

  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const guestSkipBtn = document.getElementById('guestSkipBtn');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginStatusMsg = document.getElementById('loginStatusMsg');
  let loginLockTimer = null;

  function resetLoginBtn() {
    if (loginLockTimer) { clearInterval(loginLockTimer); loginLockTimer = null; }
    loginBtn.disabled = false;
    loginBtn.textContent = _t('login.loginBtn');
    loginBtn.style.opacity = '1';
    if (loginStatusMsg) loginStatusMsg.textContent = '';
  }

  function startLoginLockCountdown(seconds, msg) {
    if (loginLockTimer) clearInterval(loginLockTimer);
    let remaining = Math.ceil(seconds);
    if (remaining <= 0) { resetLoginBtn(); return; }
    var minUnit = _t('time.minute');
    var secUnit = _t('time.second');
    var waitRetry = _t('login.waitRetry');

    function tick() {
      if (remaining <= 0) { resetLoginBtn(); return; }
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      const timeStr = mins > 0 ? mins + minUnit + secs + secUnit : secs + secUnit;
      loginBtn.textContent = '⏳ ' + timeStr;
      loginBtn.disabled = true;
      loginBtn.style.opacity = '0.6';
      if (loginStatusMsg) loginStatusMsg.textContent = msg + '（' + timeStr + waitRetry + '）';
      remaining--;
    }
    tick();
    loginLockTimer = setInterval(tick, 1000);
  }

  // 清理定时器（弹窗关闭时）
  const observer = new MutationObserver(function() {
    if (!document.body.contains(loginScreen) && loginLockTimer) {
      clearInterval(loginLockTimer);
      loginLockTimer = null;
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  // 跳过登录按钮（关闭弹窗回到游客模式）
  if (guestSkipBtn) {
    guestSkipBtn.addEventListener('click', () => {
      loginScreen.remove();
    });
  }

  // Enter key support
  [usernameInput, passwordInput].forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        loginBtn.click();
      }
    });
  });

  loginBtn.addEventListener('click', async () => {
    const username = usernameInput.value;
    const password = passwordInput.value;

    if (!username || !password) {
      UI.showNotification('⚠️ ' + _t('login.tipTitle'), _t('login.emptyCredentials'), 2000);
      return;
    }

    // Show loading state
    loginBtn.disabled = true;
    loginBtn.textContent = _t('login.logging');
    loginBtn.style.opacity = '0.6';

    try {
      const result = await API.login(username, password);
      localStorage.setItem('token', result.token);
      localStorage.setItem('userId', result.userId);
      localStorage.setItem('characterId', result.characterId);
      GAME_STATE.isLoggedIn = true;

      // 游客模式登录成功后刷新页面，走完整初始化流程
      if (GAME_STATE.isGuest) {
        window.location.reload();
        return;
      }

      loginScreen.remove();
      initializeGame();
    } catch (error) {
      console.error('Login error:', error);

      // 账号锁定 (423)
      if (error.status === 423) {
        UI.showNotification('🔒 ' + _t('login.accountLocked'), error.message, 5000);
        if (error.retryAfter) {
          startLoginLockCountdown(error.retryAfter, _t('login.accountLocked'));
        } else {
          resetLoginBtn();
        }
        return;
      }

      // 频率限制 (429)
      if (error.status === 429) {
        UI.showNotification('⏳ ' + _t('login.requestFrequent'), error.message, 5000);
        if (error.retryAfter) {
          startLoginLockCountdown(error.retryAfter, _t('login.pleaseWait'));
        } else {
          resetLoginBtn();
        }
        return;
      }

      resetLoginBtn();

      // 常规错误
      if (error.status === 401 || error.message.includes('401')) {
        UI.showNotification('❌ ' + _t('login.loginError'), _t('login.invalidCredentials'), 3000);
      } else if (error.message.includes('Network') || error.message.includes('Failed to fetch')) {
        UI.showNotification('❌ ' + _t('login.networkError'), _t('login.networkError'), 4000);
      } else {
        UI.showNotification('❌ ' + _t('login.loginError'), error.message, 3000);
      }
    }
  });

  registerBtn.addEventListener('click', () => {
    showRegisterDialog(loginScreen);
  });

  const forgotPwdBtn = document.getElementById('forgotPwdBtn');
  if (forgotPwdBtn) {
    forgotPwdBtn.addEventListener('click', () => {
      showForgotPasswordDialog(loginScreen);
    });
  }
}

/**
 * 显示注册失败/规则提示弹窗
 * @param {Object} error - 后端返回的错误对象
 */
function showRegisterRejectDialog(error) {
  // 如果已经存在则先移除
  const existing = document.getElementById('register-reject-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'register-reject-dialog';
  dialog.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.88);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 3200;
    font-family: 'Courier New', monospace;
  `;

  var rejectTitle = _t('registerReject.titleFailed');
  var message = error.detail || error.message || _t('registerReject.titleFailed');
  var tips = [];

  if (error.code === 'SUSPICIOUS_USERNAME') {
    rejectTitle = _t('registerReject.titleSuspicious');
    tips = [
      _t('registerRules.rule1'),
      _t('registerRules.rule2') + ' (' + _t('registerRules.rule6') + ')',
      _t('registerRules.rule3') + ' (test123, admin001, bot999)',
      _t('registerRules.rule4'),
      _t('registerRules.rule6') + ' (miduo2026)'
    ];
  } else if (error.status === 429) {
    rejectTitle = _t('registerReject.titleTooFrequent');
    if (error.code === 'EMAIL_RECENTLY_USED') {
      tips = [_t('registerRules.rate1')];
    } else if (error.code === 'REGISTER_RATE_LIMITED_HOUR') {
      tips = [_t('registerRules.rate3'), _t('registerRules.confirmBtn')];
    } else {
      tips = [
        _t('registerRules.rate2'),
        _t('registerRules.rate3'),
        _t('registerReject.retryLater')
      ];
    }
  } else if (error.status === 409) {
    rejectTitle = _t('registerReject.titleAccountExists');
    message = _t('registerReject.accountExistsMsg');
    tips = [_t('registerReject.accountExistsTip1'), _t('registerReject.accountExistsTip2')];
  } else {
    tips = [_t('registerReject.checkNetwork'), _t('registerReject.retryLater')];
  }

  var okBtnText = _t('registerReject.okBtn');

  dialog.innerHTML = `
    <div style="
      background: rgba(0, 20, 0, 0.95);
      border: 2px solid #00ff00;
      border-radius: 12px;
      padding: 28px 32px;
      max-width: 420px;
      width: 90%;
      color: #00ff00;
      box-shadow: 0 0 30px rgba(0, 255, 0, 0.3);
    ">
      <h3 style="margin: 0 0 14px 0; font-size: 18px; color: #00ff00;">${rejectTitle}</h3>
      <p style="margin: 0 0 16px 0; color: #ff6666; font-size: 14px; line-height: 1.5;">${message}</p>
      ${tips.length > 0 ? `
        <div style="margin-bottom: 18px;">
          <div style="font-size: 12px; color: #88ff88; margin-bottom: 8px;">${_t('login.tipTitle')}：</div>
          <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #aaffaa; line-height: 1.7;">
            ${tips.map(t => `<li>${t}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      <button id="registerRejectOkBtn" style="
        width: 100%;
        padding: 12px;
        background: #00ff00;
        color: #000;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: bold;
        font-size: 15px;
        font-family: 'Courier New', monospace;
      ">${okBtnText}</button>
    </div>
  `;

  document.body.appendChild(dialog);
  dialog.querySelector('#registerRejectOkBtn').addEventListener('click', () => {
    dialog.remove();
  });
}

function showRegisterRulesDialog(onConfirm) {
  const existing = document.getElementById('register-rules-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'register-rules-dialog';
  dialog.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.92);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 3300;
    font-family: 'Courier New', monospace;
  `;

  dialog.innerHTML = `
    <div style="
      background: rgba(0, 20, 0, 0.95);
      border: 2px solid #00ff00;
      border-radius: 12px;
      padding: 24px 28px;
      max-width: 480px;
      width: 90%;
      color: #00ff00;
      box-shadow: 0 0 30px rgba(0, 255, 0, 0.3);
    ">
      <h3 style="margin: 0 0 14px 0; font-size: 20px; color: #00ff00; text-align: center;">
        ${_t('registerRules.title')}
      </h3>
      <p style="margin: 0 0 16px 0; color: #88ff88; font-size: 13px; line-height: 1.5;">
        ${_t('registerRules.intro')}
      </p>

      <div style="margin-bottom: 14px;">
        <div style="font-size: 13px; color: #aaffaa; margin-bottom: 8px; font-weight: bold;">
          ${_t('registerRules.usernameRulesTitle')}
        </div>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #aaffaa; line-height: 1.8;">
          <li>${_t('registerRules.rule1')}</li>
          <li>${_t('registerRules.rule2')} (<span style="color:#ff6666;">2222</span>, <span style="color:#ff6666;">aaaa</span>)</li>
          <li>${_t('registerRules.rule3')} (<span style="color:#ff6666;">test123</span>, <span style="color:#ff6666;">admin001</span>, <span style="color:#ff6666;">bot999</span>)</li>
          <li>${_t('registerRules.rule4')}</li>
          <li>${_t('registerRules.rule5')} (<span style="color:#ff6666;">asdk1234</span>)</li>
          <li>${_t('registerRules.rule6')} (<span style="color:#88ff88;">miduo2026</span>)</li>
        </ul>
      </div>

      <div style="margin-bottom: 20px;">
        <div style="font-size: 13px; color: #aaffaa; margin-bottom: 8px; font-weight: bold;">
          ${_t('registerRules.rateLimitTitle')}
        </div>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #aaffaa; line-height: 1.8;">
          <li>${_t('registerRules.rate1')}</li>
          <li>${_t('registerRules.rate2')}</li>
          <li>${_t('registerRules.rate3')}</li>
        </ul>
      </div>

      <button id="registerRulesConfirmBtn" style="
        width: 100%;
        padding: 12px;
        background: #00ff00;
        color: #000;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: bold;
        font-size: 15px;
        font-family: 'Courier New', monospace;
      ">${_t('registerRules.confirmBtn')}</button>
    </div>
  `;

  document.body.appendChild(dialog);
  dialog.querySelector('#registerRulesConfirmBtn').addEventListener('click', () => {
    dialog.remove();
    if (typeof onConfirm === 'function') onConfirm();
  });
}

function showRegisterDialog(loginScreen) {
  showRegisterRulesDialog(() => {
  // Create register dialog
  const registerDialog = document.createElement('div');
  registerDialog.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 2100;
  `;

  // Pre-compute translated strings for register dialog
  var regTitle = _t('register.title');
  var regSubtitle = _t('register.subtitle');
  var regUsernameLabel = _t('register.usernameLabel');
  var regUsernamePh = _t('register.usernamePlaceholder');
  var regUsernameHint = _t('register.usernameHint');
  var regEmailLabel = _t('register.emailLabel');
  var regEmailPh = _t('register.emailPlaceholder');
  var regEmailHint = _t('register.emailHint');
  var regPasswordLabel = _t('register.passwordLabel');
  var regPasswordPh = _t('register.passwordPlaceholder');
  var regPasswordHint = _t('register.passwordHint');
  var regConfirmPwdLabel = _t('register.confirmPasswordLabel');
  var regConfirmPwdPh = _t('register.confirmPasswordPlaceholder');
  var regSecQuestionLabel = _t('register.securityQuestionLabel');
  var regSecQuestionDefault = _t('register.securityQuestionDefault');
  var regSecAnswerLabel = _t('register.securityAnswerLabel');
  var regSecAnswerPh = _t('register.securityAnswerPlaceholder');
  var regSecAnswerHint = _t('register.securityAnswerHint');
  var regConfirmBtn = _t('register.confirmBtn');
  var regCancelBtn = _t('register.cancelBtn');

  registerDialog.innerHTML = `
    <div style="
      background: rgba(0, 0, 0, 0.95);
      border: 3px solid #00ff00;
      padding: 40px;
      border-radius: 15px;
      width: 400px;
      text-align: center;
      font-family: 'Courier New', monospace;
      box-shadow: 0 0 30px rgba(0, 255, 0, 0.5);
    ">
      <h2 style="color: #00ff00; margin-bottom: 10px; font-size: 28px;">${regTitle}</h2>
      <p style="color: #88ff88; font-size: 12px; margin-bottom: 25px;">${regSubtitle}</p>
      
      <div style="text-align: left; margin-bottom: 15px;">
        <label style="color: #00ff00; font-size: 13px; display: block; margin-bottom: 5px;">
          ${regUsernameLabel}
        </label>
        <input type="text" id="reg-username" placeholder="${regUsernamePh}" maxlength="20" style="
          width: 100%;
          padding: 12px;
          background: rgba(0, 100, 0, 0.2);
          border: 2px solid #00ff00;
          border-radius: 5px;
          color: #00ff00;
          font-family: 'Courier New', monospace;
          font-size: 14px;
        ">
        <div style="color: #88ff88; font-size: 11px; margin-top: 3px;">
          ${regUsernameHint}
        </div>
      </div>
      
      <div style="text-align: left; margin-bottom: 15px;">
        <label style="color: #00ff00; font-size: 13px; display: block; margin-bottom: 5px;">
          ${regEmailLabel}
        </label>
        <input type="email" id="reg-email" placeholder="${regEmailPh}" style="
          width: 100%;
          padding: 12px;
          background: rgba(0, 100, 0, 0.2);
          border: 2px solid #00ff00;
          border-radius: 5px;
          color: #00ff00;
          font-family: 'Courier New', monospace;
          font-size: 14px;
        ">
        <div style="color: #88ff88; font-size: 11px; margin-top: 3px;">
          ${regEmailHint}
        </div>
      </div>
      
      <div style="text-align: left; margin-bottom: 15px;">
        <label style="color: #00ff00; font-size: 13px; display: block; margin-bottom: 5px;">
          ${regPasswordLabel}
        </label>
        <input type="password" id="reg-password" placeholder="${regPasswordPh}" style="
          width: 100%;
          padding: 12px;
          background: rgba(0, 100, 0, 0.2);
          border: 2px solid #00ff00;
          border-radius: 5px;
          color: #00ff00;
          font-family: 'Courier New', monospace;
          font-size: 14px;
        ">
        <div style="color: #88ff88; font-size: 11px; margin-top: 3px;">
          ${regPasswordHint}
        </div>
      </div>
      
      <div style="text-align: left; margin-bottom: 25px;">
        <label style="color: #00ff00; font-size: 13px; display: block; margin-bottom: 5px;">
          ${regConfirmPwdLabel}
        </label>
        <input type="password" id="reg-password-confirm" placeholder="${regConfirmPwdPh}" style="
          width: 100%;
          padding: 12px;
          background: rgba(0, 100, 0, 0.2);
          border: 2px solid #00ff00;
          border-radius: 5px;
          color: #00ff00;
          font-family: 'Courier New', monospace;
          font-size: 14px;
        ">
      </div>
      
      <div style="text-align: left; margin-bottom: 15px;">
        <label style="color: #00ff00; font-size: 13px; display: block; margin-bottom: 5px;">
          ${regSecQuestionLabel}
        </label>
        <select id="reg-security-question" style="
          width: 100%;
          padding: 12px;
          background: rgba(0, 100, 0, 0.2);
          border: 2px solid #00ff00;
          border-radius: 5px;
          color: #00ff00;
          font-family: 'Courier New', monospace;
          font-size: 14px;
        ">
          <option value="">${regSecQuestionDefault}</option>
        </select>
      </div>
      
      <div style="text-align: left; margin-bottom: 25px;">
        <label style="color: #00ff00; font-size: 13px; display: block; margin-bottom: 5px;">
          ${regSecAnswerLabel}
        </label>
        <input type="text" id="reg-security-answer" placeholder="${regSecAnswerPh}" style="
          width: 100%;
          padding: 12px;
          background: rgba(0, 100, 0, 0.2);
          border: 2px solid #00ff00;
          border-radius: 5px;
          color: #00ff00;
          font-family: 'Courier New', monospace;
          font-size: 14px;
        ">
        <div style="color: #88ff88; font-size: 11px; margin-top: 3px;">
          ${regSecAnswerHint}
        </div>
      </div>
      
      <div id="register-error" style="
        color: #ff0000;
        font-size: 12px;
        margin-bottom: 15px;
        min-height: 20px;
      "></div>
      
      <button id="confirmRegisterBtn" style="
        width: 100%;
        padding: 12px;
        margin: 5px 0;
        background: #00ff00;
        color: #000;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-weight: bold;
        font-size: 16px;
        font-family: 'Courier New', monospace;
      ">${regConfirmBtn}</button>
      
      <button id="cancelRegisterBtn" style="
        width: 100%;
        padding: 12px;
        margin: 5px 0;
        background: transparent;
        color: #00ff00;
        border: 2px solid #00ff00;
        border-radius: 5px;
        cursor: pointer;
        font-family: 'Courier New', monospace;
        font-size: 14px;
      ">${regCancelBtn}</button>
    </div>
  `;

  document.body.appendChild(registerDialog);

  // Get form elements
  const regUsername = document.getElementById('reg-username');
  const regEmail = document.getElementById('reg-email');
  const regPassword = document.getElementById('reg-password');
  const regPasswordConfirm = document.getElementById('reg-password-confirm');
  const regSecurityQuestion = document.getElementById('reg-security-question');
  const regSecurityAnswer = document.getElementById('reg-security-answer');
  const errorDiv = document.getElementById('register-error');
  const confirmBtn = document.getElementById('confirmRegisterBtn');
  const cancelBtn = document.getElementById('cancelRegisterBtn');

  // 加载安全问题选项列表
  (async function loadSecurityQuestions() {
    try {
      const result = await API.getSecurityQuestions();
      const questions = result.questions || [];
      if (questions.length > 0 && regSecurityQuestion) {
        questions.forEach(q => {
          const opt = document.createElement('option');
          opt.value = q.id;
          opt.textContent = q.question_text;
          regSecurityQuestion.appendChild(opt);
        });
      }
    } catch (e) {
      console.warn('加载安全问题列表失败，使用默认选项:', e);
    }
  })();

  let registerCountdownTimer = null;

  // 清理倒计时（弹窗关闭时）
  function clearRegisterCountdown() {
    if (registerCountdownTimer) {
      clearInterval(registerCountdownTimer);
      registerCountdownTimer = null;
    }
  }

  function resetRegisterBtn() {
    clearRegisterCountdown();
    confirmBtn.disabled = false;
    confirmBtn.textContent = _t('register.confirmBtn');
    confirmBtn.style.opacity = '1';
  }

  function startRegisterCountdown(seconds, errorMsg) {
    clearRegisterCountdown();
    let remaining = Math.ceil(seconds);
    if (remaining <= 0) { resetRegisterBtn(); return; }
    var minUnit = _t('time.minute');
    var secUnit = _t('time.second');
    var waitRetry = _t('login.waitRetry');

    function tick() {
      if (remaining <= 0) { resetRegisterBtn(); return; }
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      const timeStr = mins > 0 ? mins + minUnit + secs + secUnit : secs + secUnit;
      confirmBtn.textContent = '⏳ ' + timeStr;
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.6';
      if (errorDiv) {
        errorDiv.style.color = '#ffaa00';
        errorDiv.textContent = errorMsg + '（' + timeStr + waitRetry + '）';
      }
      remaining--;
    }
    tick();
    registerCountdownTimer = setInterval(tick, 1000);
  }

  // Cancel button
  cancelBtn.addEventListener('click', () => {
    clearRegisterCountdown();
    registerDialog.remove();
  });

  // Confirm register button
  confirmBtn.addEventListener('click', async () => {
    const username = regUsername.value.trim();
    const email = regEmail.value.trim();
    const password = regPassword.value;
    const passwordConfirm = regPasswordConfirm.value;

    // Validation
    errorDiv.style.color = '#ff0000';
    errorDiv.textContent = '';

    if (!username || !email || !password || !passwordConfirm) {
      errorDiv.textContent = _t('register.errorAllFields');
      return;
    }

    if (username.length < 3 || username.length > 20) {
      errorDiv.textContent = _t('register.errorUsernameLength');
      return;
    }

    if (password.length < 6) {
      errorDiv.textContent = _t('register.errorPasswordLength');
      return;
    }

    if (password !== passwordConfirm) {
      errorDiv.textContent = _t('register.errorPasswordMismatch');
      return;
    }

    const securityQuestionId = regSecurityQuestion ? regSecurityQuestion.value : '';
    const securityAnswer = regSecurityAnswer ? regSecurityAnswer.value.trim() : '';

    if (!securityQuestionId) {
      errorDiv.textContent = _t('register.errorNeedSecurityQuestion');
      return;
    }

    if (!securityAnswer) {
      errorDiv.textContent = _t('register.errorNeedSecurityAnswer');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errorDiv.textContent = _t('register.errorInvalidEmail');
      return;
    }

    // Disable button during registration
    clearRegisterCountdown();
    confirmBtn.disabled = true;
    confirmBtn.textContent = _t('register.registering');
    confirmBtn.style.opacity = '0.6';

    try {
      const result = await API.register(username, email, password, securityQuestionId, securityAnswer);
      localStorage.setItem('token', result.token);
      localStorage.setItem('userId', result.userId);
      localStorage.setItem('characterId', result.characterId);
      GAME_STATE.isLoggedIn = true;

      // Show success message
      errorDiv.style.color = '#00ff00';
      errorDiv.textContent = _t('register.success');

      // 游客模式注册成功后刷新页面（如果loginScreen已被移除则直接刷新）
      if (GAME_STATE.isGuest) {
        setTimeout(() => { window.location.reload(); }, 1500);
        return;
      }

      setTimeout(() => {
        registerDialog.remove();
        loginScreen.remove();
        initializeGame();
      }, 1500);
    } catch (error) {
      errorDiv.style.color = '#ff0000';

      // 频率限制 (429)
      if (error.status === 429) {
        if (error.code === 'EMAIL_RECENTLY_USED') {
          errorDiv.textContent = '⚠️ ' + (error.message || _t('login.pleaseWait'));
          showRegisterRejectDialog(error);
          if (error.retryAfter) {
            startRegisterCountdown(error.retryAfter, _t('login.pleaseWait'));
          } else {
            resetRegisterBtn();
          }
          return;
        }
        if (error.code === 'REGISTER_RATE_LIMITED_HOUR') {
          errorDiv.textContent = '⚠️ ' + (error.message || _t('login.pleaseWait'));
          showRegisterRejectDialog(error);
          if (error.retryAfter) {
            startRegisterCountdown(error.retryAfter, _t('login.pleaseWait'));
          } else {
            resetRegisterBtn();
          }
          return;
        }
        // 通用频率限制
        errorDiv.textContent = '⚠️ ' + error.message;
        showRegisterRejectDialog(error);
        if (error.retryAfter) {
          startRegisterCountdown(error.retryAfter, _t('login.pleaseWait'));
        } else {
          resetRegisterBtn();
        }
        return;
      }

      // 可疑用户名 (400)
      if (error.code === 'SUSPICIOUS_USERNAME') {
        errorDiv.textContent = '⚠️ ' + (error.message || _t('register.errorUsernameLength'));
        showRegisterRejectDialog(error);
        resetRegisterBtn();
        return;
      }

      // 账号已存在 (409)
      if (error.status === 409) {
        errorDiv.textContent = _t('registerReject.accountExistsMsg');
        showRegisterRejectDialog(error);
        resetRegisterBtn();
        return;
      }

      // 常规错误
      errorDiv.textContent = '❌ ' + (error.message || _t('registerReject.titleFailed'));
      resetRegisterBtn();
    }
  });

  // Enter key support
  [regUsername, regEmail, regPassword, regPasswordConfirm].forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        confirmBtn.click();
      }
    });
  });
  });
}

// Main game loop - 玩家更新逻辑已移至 world.js animate() 中统一执行
// 鼠标旋转 + player.update + skillsManager.update + buildingManager.update
// 现在全部在 animate() 中与 renderer.render() 同一帧执行，消除双 rAF 竞争
const targetFPS = 60;
const targetFrameTime = 1000 / targetFPS;
let frameAccumulator = 0;

function gameLoop() {
  // 主游戏循环已合并至 world.js animate()，本函数保留为空兼容旧调用
}

function updateDebugPanel() {
  if (!player) return;
  if (typeof window.updateCoordDisplay === 'function') {
    window.updateCoordDisplay(player.position);
    return;
  }
  const posEl = document.getElementById('debug-pos');
  if (posEl) {
    posEl.textContent = `X:${player.position.x.toFixed(1)} Y:${player.position.y.toFixed(1)} Z:${player.position.z.toFixed(1)}`;
  }
}

// Game loop will be started in initializeGame() after all components are ready

// ============================================
// 用户快捷按钮功能 - 个人资料 & 我的物品
// ============================================

/**
 * 初始化用户快捷按钮
 * 在右上角显示个人资料和物品栏入口
 */
function initializeUserQuickActions() {
  console.log('[UserActions] 初始化用户快捷按钮...');

  // 个人资料按钮
  const profileBtn = document.getElementById('btn-profile');
  if (profileBtn) {
    profileBtn.addEventListener('click', () => {
      console.log('[UserActions] 打开个人资料面板');
      openProfilePage();
    });
  }

  // 我的物品按钮
  const inventoryBtn = document.getElementById('btn-inventory');
  if (inventoryBtn) {
    inventoryBtn.addEventListener('click', () => {
      console.log('[UserActions] 打开物品栏面板');
      openInventoryPage();
    });
  }

  console.log('[UserActions] 用户快捷按钮初始化完成');
}

/**
 * 打开个人资料面板
 * 功能：显示并加载用户个人资料信息
 */
function openProfilePage() {
  if (GAME_STATE.isGuest) {
    UI.showNotification('🔒 提示', '请先注册/登录以使用个人资料功能', 3000);
    showLoginScreen();
    return;
  }
  const profilePage = document.getElementById('profile-page');
  if (!profilePage) {
    console.error('[Profile] 个人资料面板不存在');
    return;
  }

  // 显示面板
  profilePage.style.display = 'flex';

  // 加载用户数据
  loadProfileData();

  // 暂停游戏控制（可选）
  if (typeof MOUSE !== 'undefined') {
    MOUSE.isDragging = false;
  }

  console.log('[Profile] 个人资料面板已打开');
}

/**
 * 关闭个人资料面板
 */
function closeProfilePage() {
  const profilePage = document.getElementById('profile-page');
  if (profilePage) {
    profilePage.style.display = 'none';
    console.log('[Profile] 个人资料面板已关闭');
  }
}

/**
 * 加载个人资料数据
 * 从API获取用户信息和角色模板
 */
async function loadProfileData() {
  try {
    // 获取当前用户信息
    const userId = localStorage.getItem('userId');
    const characterId = localStorage.getItem('characterId');

    if (!userId || !characterId) {
      console.warn('[Profile] 用户未登录');
      return;
    }

    // 加载角色数据
    const characterData = await API.getCharacter(characterId);
    if (characterData && characterData.character) {
      const char = characterData.character;

      // 填充表单
      document.getElementById('profile-nickname').value = char.name || '';
      document.getElementById('profile-realname').value = char.realname || '';
      document.getElementById('profile-email').value = char.user_email || '';
      document.getElementById('profile-bio').value = char.bio || '';
      document.getElementById('profile-userid').textContent = userId.substring(0, 8) + '...';
      document.getElementById('profile-level').textContent = char.level || 1;
      document.getElementById('profile-joindate').textContent = new Date(char.created_at).toLocaleDateString('zh-CN');
    }

    // 加载角色模板列表
    loadCharacterTemplates();

    console.log('[Profile] 个人资料数据加载完成');
  } catch (error) {
    console.error('[Profile] 加载个人资料失败:', error);
    UI.showNotification('错误', '加载个人资料失败', 3000);
  }
}

/**
 * 加载角色模板列表
 */
async function loadCharacterTemplates() {
  try {
    const templateGrid = document.getElementById('template-grid');
    const loadingEl = document.getElementById('template-loading');

    if (loadingEl) loadingEl.style.display = 'block';

    const response = await fetch('/api/public/character-templates');
    const data = await response.json();

    if (loadingEl) loadingEl.style.display = 'none';

    if (data.templates && templateGrid) {
      templateGrid.innerHTML = '';

      data.templates.forEach(template => {
        const templateEl = document.createElement('div');
        templateEl.className = 'template-option';
        templateEl.style.cssText = `
          border: 2px solid #444;
          border-radius: 8px;
          padding: 10px;
          cursor: pointer;
          text-align: center;
          transition: all 0.3s;
        `;
        templateEl.innerHTML = `
          <div style="font-size: 32px; margin-bottom: 5px;">${template.icon || '🎭'}</div>
          <div style="font-size: 11px; color: #00ff00;">${template.name}</div>
        `;

        templateEl.addEventListener('click', (e) => {
          e.stopPropagation(); // 阻止事件冒泡，避免触发手风琴折叠
          // 弹出确认框，提醒用户需要刷新网页才能完全生效
          const shouldReload = confirm('切换角色模板需要刷新网页才能完全生效（避免显示T-pose问题）。\n\n点击"确定"立即刷新网页，切换将生效。\n点击"取消"仅选择模板，稍后可手动刷新。');

          // 移除其他选中状态
          document.querySelectorAll('.template-option').forEach(el => {
            el.style.borderColor = '#444';
            el.style.background = 'transparent';
          });
          // 添加选中状态
          templateEl.style.borderColor = '#00ff00';
          templateEl.style.background = 'rgba(0, 255, 0, 0.1)';

          // 若切换了模板，清除旧模板的动画 URL 缓存，避免污染新模板
          const _ANIM_KEYS_PROFILE = ['idle','walk','run','jump','attack1','attack2','attack3','hit','death',
            'turn_left','turn_right','attack_stab','attack_slash','attack_swing','attack_uppercut','draw_sword','sheath'];
          const oldTemplateId = localStorage.getItem('selectedTemplateId');
          if (oldTemplateId && String(oldTemplateId) !== String(template.id)) {
            _ANIM_KEYS_PROFILE.forEach(k => localStorage.removeItem('selectedTemplateAnim_' + k));
            localStorage.removeItem('selectedTemplateSkillAnims');
            if (window.SelfContainedChar) window.SelfContainedChar.clear();
            console.log('[Profile] 模板已切换，已清除旧动画缓存与自包含标记');
          }

          // 写入基础字段（过滤 null/undefined，避免存入字符串 "null"）
          localStorage.setItem('selectedTemplateId', template.id);
          const validGlbUrl = (template.glb_url && template.glb_url !== 'null') ? template.glb_url : '';
          localStorage.setItem('selectedTemplateGlbUrl', validGlbUrl);
          localStorage.setItem('selectedTemplateName', template.name || '');
          localStorage.setItem('selectedTemplateHeight', template.target_height || template.height || 1.8);

          // 写入所有动画 URL（直接从 API 数据读取，零网络开销）
          _ANIM_KEYS_PROFILE.forEach(k => {
            const url = template[`anim_${k}_url`] || '';
            localStorage.setItem('selectedTemplateAnim_' + k, url);
          });
          // 兼容旧接口
          localStorage.setItem('selectedTemplateWalkUrl', template.anim_walk_url || '');
          localStorage.setItem('selectedTemplateRunUrl',  template.anim_run_url  || '');

          // 写入骨骼映射、校准参数、武器插槽（JSON 配置）
          localStorage.setItem('selectedTemplateBoneMap',      JSON.stringify(template.bone_mapping_config  || {}));
          localStorage.setItem('selectedTemplateWeaponSocket', JSON.stringify(template.weapon_socket_config || {}));
          localStorage.setItem('selectedTemplateCalibration',  JSON.stringify(template.calibration_config   || {}));
          localStorage.setItem('selectedTemplateFitConfig',    JSON.stringify(template.fit_config           || {}));
          localStorage.setItem('selectedTemplateWeaponConfig', JSON.stringify(template.weapon_config        || {}));

          // 显示选中信息
          const infoEl = document.getElementById('template-selected-info');
          if (infoEl) {
            infoEl.textContent = `已选择: ${template.name}`;
          }

          console.log('[Profile] 选择角色模板:', template.name,
            '| GLB:', validGlbUrl || '(无)',
            '| 动画:', _ANIM_KEYS_PROFILE.filter(k => template[`anim_${k}_url`]).join('/') || '(无)');
          console.log('[Profile] weapon_id:', template.weapon_id, '| weapon_config:', JSON.stringify(template.weapon_config));

          // 立即在游戏中应用模板（不需要点保存按钮）
          if (validGlbUrl && gameWorld && GAME_STATE.characterId) {
            const playerData = gameWorld.players.get(GAME_STATE.characterId);
            if (playerData) {
              console.log('[Profile] 立即应用模板到游戏:', validGlbUrl);
              // 清除加载锁定标记，确保强制重新加载（即使 URL 相同）
              delete playerData.group.userData._loadingGlbUrl;
              gameWorld._loadPlayerGlb(GAME_STATE.characterId, playerData.group, playerData.nameSprite, validGlbUrl);
              if (player) player.glbUrl = validGlbUrl;
              // 立即广播模型更新给其他在线玩家
              WSClient.send({
                type: 'MODEL_UPDATE',
                payload: {
                  characterId: GAME_STATE.characterId,
                  glbUrl: validGlbUrl,
                  isSelfContainedBundle: window.SelfContainedChar ? window.SelfContainedChar.isActive() : false,
                },
              });
              console.log('📡 [Profile] 模板选择时广播 MODEL_UPDATE:', validGlbUrl);
              // 延迟加载动画，加载完成后广播动画数据
              setTimeout(() => {
                const broadcastAnimUrls = {};
                _ANIM_KEYS_PROFILE.forEach(k => {
                  const animUrl = template[`anim_${k}_url`];
                  if (animUrl && animUrl !== 'null' && animUrl.trim() !== '') {
                    gameWorld._loadPlayerAnimGlb(GAME_STATE.characterId, k, animUrl);
                    broadcastAnimUrls[k] = animUrl;
                  }
                });
                // 补发包含动画的 MODEL_UPDATE
                if (Object.keys(broadcastAnimUrls).length > 0) {
                  WSClient.send({
                    type: 'MODEL_UPDATE',
                    payload: {
                      characterId: GAME_STATE.characterId,
                      glbUrl: validGlbUrl,
                      animUrls: broadcastAnimUrls,
                      isSelfContainedBundle: window.SelfContainedChar ? window.SelfContainedChar.isActive() : false,
                    },
                  });
                  console.log('📡 [Profile] 动画加载完成，广播 MODEL_UPDATE（含动画）:', Object.keys(broadcastAnimUrls).join('/'));
                }
              }, 800);
            }
          }

          // 根据用户选择决定是否刷新页面
          if (shouldReload) {
            location.reload();
          }
        });

        templateGrid.appendChild(templateEl);
      });
    }
  } catch (error) {
    console.error('[Profile] 加载角色模板失败:', error);
  }
}

/**
 * 打开我的物品/背包面板
 * 功能：显示用户获得的所有奖励物品（支持跨虚拟世界）
 */
async function openInventoryPage() {
  if (GAME_STATE.isGuest) {
    UI.showNotification('🔒 提示', '请先注册/登录以使用物品栏功能', 3000);
    showLoginScreen();
    return;
  }
  const inventoryPage = document.getElementById('inventory-page');
  if (!inventoryPage) {
    console.error('[Inventory] 物品栏面板不存在');
    return;
  }

  // 显示面板
  inventoryPage.style.display = 'flex';

  // 加载背包数据
  await loadInventoryData();

  console.log('[Inventory] 物品栏面板已打开');
}

/**
 * 关闭我的物品面板
 */
function closeInventoryPage() {
  const inventoryPage = document.getElementById('inventory-page');
  if (inventoryPage) {
    inventoryPage.style.display = 'none';
    console.log('[Inventory] 物品栏面板已关闭');
  }
}

/**
 * 加载背包数据
 * 从API获取用户的所有奖励物品
 */
async function loadInventoryData() {
  try {
    // 家园世界模式：优先查家园世界背包（玩家注册的那个世界）
    const homeWorldApiUrl  = localStorage.getItem('homeWorldApiUrl');
    const homeWorldUserId  = localStorage.getItem('homeWorldUserId');
    const homeWorldToken   = localStorage.getItem('homeWorldToken');

    // 兼容旧联邦模式字段（未有 homeWorld* 时回退）
    const federatedApiUrl  = localStorage.getItem('federatedInventoryApiUrl');
    const federatedUserId  = localStorage.getItem('federatedUserId');
    const federatedToken   = localStorage.getItem('federatedToken');

    const localUserId      = localStorage.getItem('userId');

    // 优先级：家园世界 > 旧联邦 > 本地
    let apiUrl, fetchOptions, logTag;
    if (homeWorldApiUrl && homeWorldUserId) {
      apiUrl       = `${homeWorldApiUrl}/api/inventory/bag/${homeWorldUserId}`;
      fetchOptions = homeWorldToken ? { headers: { 'Authorization': `Bearer ${homeWorldToken}` } } : {};
      logTag       = `[家园世界 ${homeWorldApiUrl.replace(/https?:\/\//, '')}]`;
    } else if (federatedApiUrl && federatedUserId) {
      apiUrl       = `${federatedApiUrl}/api/inventory/bag/${federatedUserId}`;
      fetchOptions = federatedToken ? { headers: { 'Authorization': `Bearer ${federatedToken}` } } : {};
      logTag       = `[源世界 ${federatedApiUrl.replace(/https?:\/\//, '')}]`;
    } else if (localUserId) {
      apiUrl       = `/api/inventory/bag/${localUserId}`;
      fetchOptions = {};
      logTag       = '[本地]';
    } else {
      console.warn('[Inventory] 用户未登录');
      return;
    }

    // 显示加载状态
    const listEl = document.getElementById('inventory-list');
    if (listEl) {
      listEl.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px;"><div style="font-size: 32px; margin-bottom: 10px;">⏳</div><div>加载中...</div></div>';
    }

    console.log(`[Inventory] ${logTag} 查询背包: ${apiUrl}`);
    const response = await fetch(apiUrl, fetchOptions);
    const data = await response.json();

    if (data.items) {
      renderInventoryItems(data.items);
      updateInventoryStats(data.items);
    }

    console.log(`[Inventory] ${logTag} 背包加载完成: ${data.items?.length || 0} 个物品`);
  } catch (error) {
    console.error('[Inventory] 加载背包数据失败:', error);
    const listEl = document.getElementById('inventory-list');
    if (listEl) {
      listEl.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #ff4444;"><div style="font-size: 32px; margin-bottom: 10px;">❌</div><div>加载失败，请重试</div></div>';
    }
  }
}

/**
 * 渲染背包物品列表
 * @param {Array} items - 物品列表
 */
function renderInventoryItems(items) {
  const listEl = document.getElementById('inventory-list');
  if (!listEl) return;

  if (!items || items.length === 0) {
    listEl.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #888;">
        <div style="font-size: 48px; margin-bottom: 15px;">📭</div>
        <div>背包空空如也</div>
        <div style="font-size: 12px; margin-top: 10px;">在虚拟世界中探索，获得丰厚奖励！</div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';

  items.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = `inventory-item ${item.is_used ? 'used' : ''}`;

    // 根据奖励类型选择图标
    let icon = '🎁';
    if (item.reward_name?.includes('金币')) icon = '🪙';
    else if (item.reward_name?.includes('装备')) icon = '⚔️';
    else if (item.reward_name?.includes('皮肤')) icon = '👕';
    else if (item.reward_name?.includes('道具')) icon = '🧪';
    else if (item.reward_name?.includes('VIP')) icon = '👑';

    itemEl.innerHTML = `
      <div class="inventory-item-icon">${icon}</div>
      <div class="inventory-item-name">${item.reward_name || '未知物品'}</div>
      <div class="inventory-item-desc">${item.is_used ? '已使用' : '未使用'}</div>
    `;

    // 点击显示详情
    itemEl.addEventListener('click', () => {
      showItemDetail(item);
    });

    listEl.appendChild(itemEl);
  });
}

/**
 * 更新背包统计信息
 * @param {Array} items - 物品列表
 */
function updateInventoryStats(items) {
  const total = items?.length || 0;
  const unused = items?.filter(i => !i.is_used).length || 0;
  const used = items?.filter(i => i.is_used).length || 0;

  const totalEl = document.getElementById('inv-total-count');
  const unusedEl = document.getElementById('inv-unused-count');
  const usedEl = document.getElementById('inv-used-count');

  if (totalEl) totalEl.textContent = total;
  if (unusedEl) unusedEl.textContent = unused;
  if (usedEl) usedEl.textContent = used;
}

/**
 * 显示物品详情弹窗
 * @param {Object} item - 物品数据
 */
function showItemDetail(item) {
  // 创建详情弹窗
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 3000;
  `;

  modal.innerHTML = `
    <div style="
      background: rgba(0, 0, 0, 0.95);
      border: 3px solid #ffc107;
      border-radius: 15px;
      padding: 30px;
      max-width: 400px;
      width: 90%;
      color: #ffc107;
      font-family: 'Courier New', monospace;
    ">
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="font-size: 48px; margin-bottom: 10px;">🎁</div>
        <div style="font-size: 20px; font-weight: bold;">${item.reward_name || '未知物品'}</div>
      </div>

      <div style="background: rgba(255, 193, 7, 0.1); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
        <div style="margin-bottom: 10px;">
          <span style="color: #888;">描述：</span>
          <span style="color: #ffeb3b;">${item.reward_desc || '暂无描述'}</span>
        </div>
        <div style="margin-bottom: 10px;">
          <span style="color: #888;">状态：</span>
          <span style="color: ${item.is_used ? '#888' : '#00ff00'};">${item.is_used ? '已使用' : '未使用'}</span>
        </div>
        <div style="margin-bottom: 10px;">
          <span style="color: #888;">获得时间：</span>
          <span>${new Date(item.acquired_at).toLocaleString('zh-CN')}</span>
        </div>
        ${item.platform_url ? `
        <div style="margin-bottom: 10px;">
          <span style="color: #888;">兑换平台：</span>
          <a href="${item.platform_url}" target="_blank" style="color: #00ffff;">点击访问</a>
        </div>
        ` : ''}
        ${item.code ? `
        <div style="margin-top: 15px; padding: 10px; background: rgba(0, 0, 0, 0.5); border-radius: 5px;">
          <div style="color: #888; font-size: 11px; margin-bottom: 5px;">兑换码：</div>
          <div style="font-size: 18px; font-weight: bold; color: #00ff00; letter-spacing: 2px;">${item.code}</div>
        </div>
        ` : ''}
      </div>

      <div style="display: flex; gap: 10px;">
        ${!item.is_used && item.code ? `
        <button id="copy-code-btn" style="
          flex: 1;
          padding: 12px;
          background: #00ff00;
          color: #000;
          border: none;
          border-radius: 5px;
          font-weight: bold;
          cursor: pointer;
          font-family: 'Courier New', monospace;
        ">📋 复制兑换码</button>
        ` : ''}
        <button id="close-detail-btn" style="
          flex: 1;
          padding: 12px;
          background: transparent;
          color: #ffc107;
          border: 2px solid #ffc107;
          border-radius: 5px;
          font-weight: bold;
          cursor: pointer;
          font-family: 'Courier New', monospace;
        ">关闭</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 复制兑换码功能
  const copyBtn = modal.querySelector('#copy-code-btn');
  if (copyBtn && item.code) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(item.code).then(() => {
        copyBtn.textContent = '✅ 已复制！';
        setTimeout(() => {
          copyBtn.textContent = '📋 复制兑换码';
        }, 2000);
      });
    });
  }

  // 关闭按钮
  const closeBtn = modal.querySelector('#close-detail-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.remove();
    });
  }

  // 点击背景关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// 在页面加载完成后初始化
window.addEventListener('load', () => {
  // 延迟初始化，确保其他组件已加载
  setTimeout(() => {
    initializeUserQuickActions();
    initializeProfilePage();
    initializeInventoryPage();
  }, 1000);
});

/**
 * 初始化个人资料面板事件
 */
function initializeProfilePage() {
  // 返回世界按钮
  const backBtn = document.getElementById('back-to-world-btn');
  if (backBtn) {
    backBtn.addEventListener('click', closeProfilePage);
  }

  // 保存按钮
  const saveBtn = document.getElementById('save-profile-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await saveProfileData();
    });
  }

  // 退出登录按钮
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.clear();
      window.location.reload();
    });
  }

  // 传送门管理按钮
  const portalBtn = document.getElementById('portal-manager-btn');
  if (portalBtn) {
    portalBtn.addEventListener('click', () => {
      closeProfilePage();
      if (typeof openPortalManager === 'function') {
        openPortalManager();
      }
    });
  }

  // 头像颜色选择
  document.querySelectorAll('.avatar-option').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('.avatar-option').forEach(opt => {
        opt.style.borderColor = 'transparent';
      });
      option.style.borderColor = '#00ff00';
      localStorage.setItem('avatarColor', option.dataset.color);
    });
  });

  // 初始化手风琴折叠面板
  initProfileAccordion();
}

/**
 * 手风琴折叠面板交互 - 同时只能展开一个区域
 */
function initProfileAccordion() {
  const headers = document.querySelectorAll('.accordion-header');
  if (!headers.length) return;

  headers.forEach(header => {
    // 移除旧事件（防止重复绑定）
    const newHeader = header.cloneNode(true);
    header.parentNode.replaceChild(newHeader, header);

    newHeader.addEventListener('click', () => {
      const section = newHeader.getAttribute('data-section');
      const content = document.querySelector('.accordion-content[data-section="' + section + '"]');
      const arrow = newHeader.querySelector('.accordion-arrow');
      const isOpen = content.style.maxHeight && content.style.maxHeight !== '0px';

      // 先关闭所有
      document.querySelectorAll('.accordion-content').forEach(c => {
        c.style.maxHeight = '0px';
        c.style.padding = '0 10px';
        const h = c.previousElementSibling;
        if (h) {
          const a = h.querySelector('.accordion-arrow');
          if (a) a.style.transform = 'rotate(0deg)';
        }
      });

      // 如果之前未打开，现在打开
      if (!isOpen) {
        content.style.maxHeight = content.scrollHeight + 'px';
        content.style.padding = '0 10px';
        if (arrow) arrow.style.transform = 'rotate(180deg)';
      }
    });
  });

  // 默认展开第一个面板
  const firstHeader = document.querySelector('.accordion-header[data-section="basic"]');
  if (firstHeader) {
    firstHeader.click();
  }
}

/**
 * 初始化物品栏面板事件
 */
function initializeInventoryPage() {
  // 关闭按钮
  const closeBtn = document.getElementById('close-inventory-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeInventoryPage);
  }

  // 刷新按钮
  const refreshBtn = document.getElementById('refresh-inventory-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.textContent = '⏳ 刷新中...';
      loadInventoryData().then(() => {
        refreshBtn.textContent = '🔄 刷新';
      });
    });
  }
}

/**
 * 保存个人资料数据
 */
async function saveProfileData() {
  try {
    const characterId = localStorage.getItem('characterId');
    if (!characterId) return;

    const nickname = document.getElementById('profile-nickname').value;
    const realname = document.getElementById('profile-realname').value;
    const email = document.getElementById('profile-email').value;
    const bio = document.getElementById('profile-bio').value;

    // 调用后端API保存个人资料
    const response = await fetch(`/api/users/character/${characterId}/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ name: nickname, realname, email, bio })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '保存失败');
    }

    UI.showNotification('成功', '个人资料已保存', 2000);
    closeProfilePage();
    // 注：角色模板已在选择时立即应用并广播 MODEL_UPDATE，保存时无需重复操作
  } catch (error) {
    console.error('[Profile] 保存失败:', error);
    UI.showNotification('错误', '保存失败：' + error.message, 3000);
  }
}

// ── 全局诊断函数：在浏览器控制台调用 debugCharacter() 可查看当前状态并强制重新加载模型 ──
window.debugCharacter = function(forceGlbUrl) {
  const glbUrl = forceGlbUrl || localStorage.getItem('selectedTemplateGlbUrl');
  const templateId = localStorage.getItem('selectedTemplateId');
  const templateName = localStorage.getItem('selectedTemplateName');
  console.group('🔍 角色模板诊断');
  console.log('templateId:', templateId, '| 模板名:', templateName);
  console.log('glbUrl (localStorage):', glbUrl);
  console.log('characterId:', GAME_STATE.characterId);
  console.log('gameWorld:', !!gameWorld);
  if (gameWorld && GAME_STATE.characterId) {
    const pd = gameWorld.players.get(GAME_STATE.characterId);
    console.log('playerData:', pd ? '存在' : '不存在！');
    if (pd) {
      console.log('glbModel:', pd.group.userData.glbModel ? '✅已加载' : '❌未加载（还是方块人）');
      console.log('_loadingGlbUrl:', pd.group.userData._loadingGlbUrl || '(无正在加载)');
    }
  }
  console.groupEnd();

  const url = forceGlbUrl || (glbUrl && glbUrl !== 'null' && glbUrl.trim() !== '' ? glbUrl : null);
  if (url && gameWorld && GAME_STATE.characterId) {
    const pd = gameWorld.players.get(GAME_STATE.characterId);
    if (pd) {
      // 清除加载锁定标记，强制重新加载
      delete pd.group.userData._loadingGlbUrl;
      console.log('🚀 强制重新加载模型:', url);
      gameWorld._loadPlayerGlb(GAME_STATE.characterId, pd.group, pd.nameSprite, url);
    } else {
      console.error('playerData 不存在，无法加载');
    }
  } else if (!url) {
    console.warn('没有有效的 GLB URL，尝试从 API 获取...');
    if (templateId) {
      fetch('/api/public/character-templates')
        .then(r => r.json())
        .then(data => {
          const tmpl = (data.templates || []).find(t => String(t.id) === String(templateId));
          if (tmpl && tmpl.glb_url) {
            console.log('API 返回 glb_url:', tmpl.glb_url);
            localStorage.setItem('selectedTemplateGlbUrl', tmpl.glb_url);
            window.debugCharacter(tmpl.glb_url);
          } else {
            console.warn('API 中也没有 GLB URL，模板数据:', tmpl);
            console.log('所有可用模板:', data.templates?.map(t => `${t.id}:${t.name}:${t.glb_url||'无GLB'}`));
          }
        });
    }
  }
};

// ── 全局快捷函数：直接按模板名加载 ──
window.loadTemplate = function(templateName) {
  fetch('/api/public/character-templates')
    .then(r => r.json())
    .then(data => {
      const tmpl = (data.templates || []).find(t => t.name === templateName || String(t.id) === String(templateName));
      if (!tmpl) { console.error('未找到模板:', templateName, '可用:', data.templates.map(t=>t.name)); return; }
      console.log('加载模板:', tmpl.name, 'GLB:', tmpl.glb_url);
      localStorage.setItem('selectedTemplateId', tmpl.id);
      if (tmpl.glb_url) {
        localStorage.setItem('selectedTemplateGlbUrl', tmpl.glb_url);
        window.debugCharacter(tmpl.glb_url);
      }
    });
};

