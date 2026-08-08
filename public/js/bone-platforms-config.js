/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 骨骼平台适配配置 - 多平台3D模型骨骼名称映射表
 * 
 * 使用方式：
 *   1. 用户上传模型时选择来源平台
 *   2. 或调用 detectModelPlatform() 自动检测
 *   3. 调用 getPlatformConfig(platform) 获取完整配置
 *   4. 配置自动应用到：骨骼绑定、武器挂载、校准参数、动画重定向
 * 
 * 后续新增平台：只需在此文件中添加一组映射规则
 */

// 使用 IIFE 避免变量污染全局作用域，解决重复加载问题
(function() {
  'use strict';
  
  // 调试：确认文件被加载
  console.log('[bone-platforms-config.js] 文件开始加载...');

  // ===== 支持的平台列表 =====
  // 用于前端下拉选择
  var SUPPORTED_PLATFORMS = [
  {
    id: 'mixamo',
    name: 'Mixamo (Adobe)',
    icon: '🎮',
    description: 'Adobe Mixamo 导出的GLB/FBX模型，T-Pose骨骼结构',
    url: 'https://www.mixamo.com',
    features: ['T-Pose', '厘米单位', 'mixamorig前缀'],
    popular: true,
  },
  {
    id: 'rpm',
    name: 'ReadyPlayerMe',
    icon: '🧑',
    description: 'ReadyPlayerMe 生成的角色模型，A-Pose，米为单位',
    url: 'https://readyplayer.me',
    features: ['A-Pose', '米单位', 'PascalCase命名'],
    popular: true,
  },
  {
    id: 'vroid',
    name: 'VRoid',
    icon: '🎭',
    description: 'VRoid Studio 制作的VTuber模型，J_Bip_骨骼结构',
    url: 'https://vroid.com',
    features: ['A-Pose', '厘米单位', 'J_Bip_前缀'],
    popular: true,
  },
  {
    id: 'blender',
    name: 'Blender 手工绑骨',
    icon: '🧊',
    description: 'Blender 手动绑定导出的模型，骨骼命名自由度高',
    url: '',
    features: ['自定义骨骼名', '需手动配置'],
    popular: false,
  },
  {
    id: 'hunyuan3d',
    name: '混元3D (腾讯)',
    icon: '🤖',
    description: '腾讯混元3D生成的角色模型',
    url: '',
    features: ['AI生成', 'A-Pose'],
    popular: true,
  },
  {
    id: 'tripo',
    name: 'Tripo3D (VAST)',
    icon: '🌀',
    description: 'Tripo AI 3D模型生成平台',
    url: '',
    features: ['AI生成', '自动绑定'],
    popular: false,
  },
  {
    id: 'makehuman',
    name: 'MakeHuman',
    icon: '👤',
    description: 'MakeHuman 生成的角色模型',
    url: '',
    features: ['程序生成', 'mh_前缀'],
    popular: false,
  },
  {
    id: 'manual',
    name: '⚙️ 完全手动配置',
    icon: '🔧',
    description: '不使用预设，完全自定义骨骼映射（高级用户）',
    url: '',
    features: ['高级用户', '自由配置'],
    popular: false,
  },
];

// ===== 内部标准骨骼名定义 =====
// 我们系统内部使用的统一骨骼命名标准
var STANDARD_BONES = [
  // 躯干
  'hips', 'spine', 'chest', 'upper_chest', 'neck', 'head',
  // 左臂
  'left_shoulder', 'left_upper_arm', 'left_lower_arm', 'left_hand',
  // 右臂  
  'right_shoulder', 'right_upper_arm', 'right_lower_arm', 'right_hand',
  // 左腿
  'left_thigh', 'left_calf', 'left_foot', 'left_toes',
  // 右腿
  'right_thigh', 'right_calf', 'right_foot', 'right_toes',
  // 手指（可选）
  'left_thumb', 'left_index', 'left_middle', 'left_ring', 'left_pinky',
  'right_thumb', 'right_index', 'right_middle', 'right_ring', 'right_pinky',
];

// ===== 各平台 → 标准骨骼 映射表 =====
// key = 标准骨骼名, value = 该平台实际的骨骼名
var PLATFORM_BONE_MAPS = {
  
  // ════════════════════════════════════════
  // Mixamo (Adobe)
  // 特征：所有骨骼名以 "mixamorig" 为前缀，驼峰命名
  // 注意：Mixamo的 "Hand" 实际是手腕位置！"ForeArm" 是前臂！
  // ════════════════════════════════════════
  mixamo: {
    // 躯干
    'hips':              'mixamorigHips',
    'spine':             'mixamorigSpine',
    'chest':             'mixamorigSpine1',
    'upper_chest':       'mixamorigSpine2',
    'neck':              'mixamorigNeck',
    'head':              'mixamorigHead',
    
    // 左臂
    'left_shoulder':     'mixamorigLeftShoulder',
    'left_upper_arm':    'mixamorigLeftArm',
    'left_lower_arm':    'mixamorigLeftForeArm',   // 注意！不是LeftHand
    'left_hand':         'mixamorigLeftHand',      // Mixamo的手部
    
    // 右臂
    'right_shoulder':    'mixamorigRightShoulder',
    'right_upper_arm':   'mixamorigRightArm',
    'right_lower_arm':   'mixamorigRightForeArm',  // 注意！
    'right_hand':        'mixamorigRightHand',
    
    // 左腿
    'left_thigh':        'mixamorigLeftUpLeg',
    'left_calf':         'mixamorigLeftLeg',
    'left_foot':         'mixamorigLeftFoot',
    'left_toes':         'mixamorigLeftToeBase',
    
    // 右腿
    'right_thigh':       'mixamorigRightUpLeg',
    'right_calf':        'mixamorigRightLeg',
    'right_foot':        'mixamorigRightFoot',
    'right_toes':        'mixamorigRightToeBase',
    
    // 左手指
    'left_thumb':        'mixamorigLeftThumb1',
    'left_index':        'mixamorigLeftIndex1',
    'left_middle':       'mixamorigLeftMiddle1',
    'left_ring':         'mixamorigLeftRing1',
    'left_pinky':        'mixamorigLeftPinky1',
    
    // 右手指
    'right_thumb':       'mixamorigRightThumb1',
    'right_index':       'mixamorigRightIndex1',
    'right_middle':      'mixamorigRightMiddle1',
    'right_ring':        'mixamorigRightRing1',
    'right_pinky':       'mixamorigRightPinky1',
    
    // === 系统功能骨骼映射 ===
    _system: {
      rightHand:         'mixamorigRightHand',      // 武器挂载点
      camera:            'mixamorigHead',            // 第一人称相机跟随点
      rootBone:          'mixamorigHips',           // 根骨骼
    },
    
    // === 平台默认参数 ===
    _defaults: {
      scale: 0.01,                             // Mixamo用厘米，我们用米
      unit: 'cm',
      poseType: 'T-Pose',
      yUp: true,
      groundOffsetAutoDetect: true,
    },
  },

  // ════════════════════════════════════════
  // ReadyPlayerMe (RPM)
  // 特征：PascalCase命名，A-Pose，米为单位
  // ════════════════════════════════════════
  rpm: {
    // 躯干
    'hips':              'Hips',
    'spine':             'Spine',
    'chest':             'Spine1',
    'upper_chest':       'Spine2',
    'neck':              'Neck',
    'head':              'Head',
    
    // 左臂
    'left_shoulder':     'LeftShoulder',
    'left_upper_arm':    'LeftArm',
    'left_lower_arm':    'LeftForeArm',
    'left_hand':         'LeftHand',
    
    // 右臂
    'right_shoulder':    'RightShoulder',
    'right_upper_arm':   'RightArm',
    'right_lower_arm':   'RightForeArm',
    'right_hand':        'RightHand',
    
    // 左腿
    'left_thigh':        'LeftUpLeg',
    'left_calf':         'LeftLeg',
    'left_foot':         'LeftFoot',
    'left_toes':         'LeftToeBase',
    
    // 右腿
    'right_thigh':       'RightUpLeg',
    'right_calf':        'RightLeg',
    'right_foot':        'RightFoot',
    'right_toes':        'RightToeBase',
    
    // 左手指
    'left_thumb':        'LeftThumb_Proximal',
    'left_index':        'LeftIndex_Proximal',
    'left_middle':       'LeftMiddle_Proximal',
    'left_ring':         'LeftRing_Proximal',
    'left_pinky':        'LeftPinky_Proximal',
    
    // 右手指
    'right_thumb':       'RightThumb_Proximal',
    'right_index':       'RightIndex_Proximal',
    'right_middle':      'RightMiddle_Proximal',
    'right_ring':        'RightRing_Proximal',
    'right_pinky':       'RightPinky_Proximal',
    
    _system: {
      rightHand:         'RightHand',
      camera:            'Head',
      rootBone:          'Hips',
    },
    
    _defaults: {
      scale: 1.0,                              // RPM已经是米为单位
      unit: 'm',
      poseType: 'A-Pose',
      yUp: true,
      groundOffsetAutoDetect: true,
    },
  },

  // ════════════════════════════════════════
  // VRoid
  // 特征：J_Bip_前缀，A-Pose，厘米为单位
  // ════════════════════════════════════════
  vroid: {
    // 躯干
    'hips':              'J_Bip_C_Hips',
    'spine':             'J_Bip_S_Spine',
    'chest':             'J_Bip_S_Chest',
    'upper_chest':       'J_Bip_S_UpperChest',
    'neck':              'J_Bip_C_Neck',
    'head':              'J_Bip_C_Head',
    
    // 左臂
    'left_shoulder':     'J_Bip_L_Shoulder',
    'left_upper_arm':    'J_Bip_L_UpperArm',
    'left_lower_arm':    'J_Bip_L_LowerArm',
    'left_hand':         'J_Bip_L_Hand',
    
    // 右臂
    'right_shoulder':    'J_Bip_R_Shoulder',
    'right_upper_arm':   'J_Bip_R_UpperArm',
    'right_lower_arm':   'J_Bip_R_LowerArm',
    'right_hand':        'J_Bip_R_Hand',
    
    // 左腿
    'left_thigh':        'J_Bip_L_Thigh',
    'left_calf':         'J_Bip_L_Calf',
    'left_foot':         'J_Bip_L_Foot',
    'left_toes':         'J_Bip_L_ToeBase',
    
    // 右腿
    'right_thigh':       'J_Bip_R_Thigh',
    'right_calf':        'J_Bip_R_Calf',
    'right_foot':        'J_Bip_R_Foot',
    'right_toes':        'J_Bip_R_ToeBase',
    
    _system: {
      rightHand:         'J_Bip_R_Hand',
      camera:            'J_Bip_C_Head',
      rootBone:          'J_Bip_C_Hips',
    },
    
    _defaults: {
      scale: 0.01,                              // VRoid是厘米
      unit: 'cm',
      poseType: 'A-Pose',
      yUp: true,
      groundOffsetAutoDetect: true,
    },
  },

  // ════════════════════════════════════════
  // Blender 默认导出
  // 特征：小写下划线，命名因作者而异（提供两种常见风格）
  // ════════════════════════════════════════
  blender: {
    // 风格1：简单英文（小写+下划线）
    'hips':              'hips',
    'spine':             'spine',
    'chest':             'chest',
    'upper_chest':       null,                   // Blender通常没有
    'neck':              'neck',
    'head':              'head',
    
    'left_shoulder':     'shoulder.l',
    'left_upper_arm':    'upper_arm.l',
    'left_lower_arm':    'forearm.l',
    'left_hand':         'hand.l',
    
    'right_shoulder':    'shoulder.r',
    'right_upper_arm':   'upper_arm.r',
    'right_lower_arm':   'forearm.r',
    'right_hand':        'hand.r',
    
    'left_thigh':        'thigh.l',
    'left_calf':         'shin.l',
    'left_foot':         'foot.l',
    'left_toes':         'toe.l',
    
    'right_thigh':       'thigh.r',
    'right_calf':        'shin.r',
    'right_foot':        'foot.r',
    'right_toes':        'toe.r',
    
    _system: {
      rightHand:         'hand.r',
      camera:            'head',
      rootBone:          'hips',
    },
    
    _defaults: {
      scale: 1.0,
      unit: 'm',
      poseType: 'unknown',
      yUp: true,
      groundOffsetAutoDetect: true,
      needsManualCalibration: true,              // Blender最需要手动微调
    },
  },

  // ════════════════════════════════════════
  // 混元3D (腾讯)
  // 特征：AI自动生成，骨骼命名可能变化
  // ⚠️ 暂定映射，需要实测后修正
  // ════════════════════════════════════════
  hunyuan3d: {
    'hips':              'Hips',
    'spine':             'Spine',
    'chest':             'Chest',
    'upper_chest':       null,
    'neck':              'Neck',
    'head':              'Head',
    
    'left_upper_arm':    'LeftUpperArm',
    'left_lower_arm':    'LeftLowerArm',
    'left_hand':         'LeftHand',
    
    'right_upper_arm':   'RightUpperArm',
    'right_lower_arm':   'RightLowerArm',
    'right_hand':        'RightHand',
    
    'left_thigh':        'LeftUpperLeg',
    'left_calf':         'LeftLowerLeg',
    'left_foot':         'LeftFoot',
    
    'right_thigh':       'RightUpperLeg',
    'right_calf':        'RightLowerLeg',
    'right_foot':        'RightFoot',
    
    _system: {
      rightHand:         'RightHand',
      camera:            'Head',
      rootBone:          'Hips',
    },
    
    _defaults: {
      scale: 1.0,
      unit: 'm',
      poseType: 'A-Pose',
      yUp: true,
      groundOffsetAutoDetect: true,
      __experimental: true,                      // 标记为待实测
    },
  },

  // ════════════════════════════════════════
  // Tripo3D
  // ⚠️ 暂定映射，需要实测后修正
  // ════════════════════════════════════════
  tripo: {
    'hips':              'root',
    'spine':             'spine',
    'chest':             'chest',
    'head':              'head',
    
    'right_hand':        'right_hand',
    'left_hand':         'left_hand',
    
    _system: {
      rightHand:         'right_hand',
      camera:            'head',
      rootBone:          'root',
    },
    
    _defaults: {
      scale: 1.0,
      unit: 'm',
      poseType: 'A-Pose',
      yUp: true,
      groundOffsetAutoDetect: true,
      __experimental: true,
    },
  },

  // ════════════════════════════════════════
  // MakeHuman
  // 特征：mh_前缀，程序生成
  // ════════════════════════════════════════
  makehuman: {
    'hips':              'mh_hips_01',
    'spine':             'mh_spine_01',
    'chest':             'mh_spine_02',
    'upper_chest':       null,
    'neck':              'mh_head_01',
    'head':              'mh_head_01',
    
    'left_upper_arm':    'mh_l_shoulder_01',
    'left_lower_arm':    'mh_l_forearm_01',
    'left_hand':         'mh_l_hand_01',
    
    'right_upper_arm':   'mh_r_shoulder_01',
    'right_lower_arm':   'mh_r_forearm_01',
    'right_hand':        'mh_r_hand_01',
    
    'left_thigh':        'mh_l_thigh_01',
    'left_calf':         'mh_l_shin_01',
    'left_foot':         'mh_l_foot_01',
    
    'right_thigh':       'mh_r_thigh_01',
    'right_calf':        'mh_r_shin_01',
    'right_foot':        'mh_r_foot_01',
    
    _system: {
      rightHand:         'mh_r_hand_01',
      camera:            'mh_head_01',
      rootBone:          'mh_hips_01',
    },
    
    _defaults: {
      scale: 0.01,
      unit: 'cm',
      poseType: 'A-Pose',
      yUp: true,
      groundOffsetAutoDetect: true,
    },
  },
};

// ===== 平台检测特征库 =====
// 用于自动识别模型来源平台
var PLATFORM_SIGNATURES = {
  // Mixamo特征：骨骼名包含 "mixamorig" 前缀
  mixamo: {
    test: (boneNames) => {
      const str = boneNames.join(' ').toLowerCase();
      return str.includes('mixamorig');
    },
    confidence: 0.95,
    tip: '骨骼名包含 "mixamorig" 前缀',
  },
  
  // VRoid特征：骨骼名包含 "J_Bip_" 前缀
  vroid: {
    test: (boneNames) => {
      return boneNames.some(n => n.startsWith('J_Bip_'));
    },
    confidence: 0.92,
    tip: '骨骼名包含 "J_Bip_" 前缀',
  },
  
  // RPM特征：PascalCase + 无前缀 + 有 Spine1/Spine2
  rpm: {
    test: (boneNames) => {
      if (boneNames.length < 10) return false;
      // PascalCase检测：首字母大写+驼峰
      const pascalCount = boneNames.filter(n => /^[A-Z][a-z]+[A-Z]/.test(n)).length;
      // RPM特有骨骼名
      const hasSpine1 = boneNames.some(n => /^Spine[12]$/.test(n));
      // 排除已知的前缀
      const noKnownPrefix = !boneNames.some(n => /^(mixamorig|J_Bip_|Bip_|mh_)/i.test(n));
      return (pascalCount > 5 && hasSpine1) || (pascalCount > boneNames.length * 0.7 && noKnownPrefix);
    },
    confidence: 0.80,
    tip: '骨骼名为 PascalCase 格式（如 Hips, Spine1, RightArm）',
  },
  
  // MakeHuman特征：mh_ 前缀
  makehuman: {
    test: (boneNames) => {
      return boneNames.some(n => n.startsWith('mh_'));
    },
    confidence: 0.90,
    tip: '骨骼名包含 "mh_" 前缀',
  },
  
  // Blender特征：小写 + .L/.R 后缀 或 小写+下划线
  blender: {
    test: (boneNames) => {
      const withSuffix = boneNames.filter(n => /\.(L|R)$/.test(n) || n.endsWith('_l') || n.endsWith('_r')).length;
      const allLower = boneNames.every(n => n === n.toLowerCase());
      return withSuffix >= 4 && allLower;
    },
    confidence: 0.75,
    tip: '骨骼名全小写，带 .L/.R 或 _l/_r 后缀',
  },
  
  // Tripo特征：常用 root 作为根节点
  tripo: {
    test: (boneNames) => {
      const hasRoot = boneNames.some(n => /^root$/i.test(n));
      const allShort = boneNames.every(n => n.length < 20);
      return hasRoot && boneNames.length < 30 && allShort;
    },
    confidence: 0.60,
    tip: '骨骼结构简单，包含 root 根节点',
  },
};

// ===== 动画来源平台检测 =====
// 根据动画文件的骨骼命名推断来源
var ANIM_SIGNATURES = {
  mixamo: {
    test: (boneNames) => boneNames.join(' ').toLowerCase().includes('mixamorig'),
    confidence: 0.95,
  },
  rpm: {
    test: (boneNames) => {
      const pascalCount = boneNames.filter(n => /^[A-Z][a-z]+[A-Z]/.test(n)).length;
      return pascalCount > boneNames.length * 0.5;
    },
    confidence: 0.75,
  },
  vroid: {
    test: (boneNames) => boneNames.some(n => n.startsWith('J_Bip_')),
    confidence: 0.90,
  },
  // 混元3D动画签名：骨骼名称符合 PascalCase 且包含混元3D特征骨骼
  hunyuan3d: {
    test: (boneNames) => {
      // 检测 PascalCase 命名的骨骼（首个字母大写）
      const pascalCount = boneNames.filter(n => /^[A-Z]/.test(n)).length;
      // 检测是否包含混元3D特征骨骼名
      const hasHunyuanBones = boneNames.some(n => 
        n === 'Hips' || n === 'Spine' || n === 'Chest' ||
        n === 'LeftUpperArm' || n === 'LeftLowerArm' ||
        n === 'RightUpperArm' || n === 'RightLowerArm' ||
        n === 'LeftUpperLeg' || n === 'LeftLowerLeg' ||
        n === 'RightUpperLeg' || n === 'RightLowerLeg'
      );
      // 满足：大部分是 PascalCase 且包含特征骨骼
      return pascalCount >= boneNames.length * 0.6 && hasHunyuanBones;
    },
    confidence: 0.80,
  },
};

// 导出到全局
if (typeof window !== 'undefined') {
  window.SUPPORTED_PLATFORMS = SUPPORTED_PLATFORMS;
  window.PLATFORM_BONE_MAPS = PLATFORM_BONE_MAPS;
  window.PLATFORM_SIGNATURES = PLATFORM_SIGNATURES;
  window.ANIM_SIGNATURES = ANIM_SIGNATURES;
  window.STANDARD_BONES = STANDARD_BONES;
  
  // 导出便捷查询函数
  window.getSupportedPlatforms = function() {
    return window.SUPPORTED_PLATFORMS || [];
  };
  window.getPlatformConfig = function(platformId) {
    var configs = window.PLATFORM_BONE_MAPS || {};
    return configs[platformId] || null;
  };
}

// 闭合 IIFE
})();
