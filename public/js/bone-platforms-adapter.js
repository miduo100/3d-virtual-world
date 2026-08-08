/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 骨骼平台适配器 - 运行时逻辑
 * 
 * 提供：检测、映射生成、动画重定向、平台配置应用等功能
 * 
 * 使用方式：
 *   <script src="js/bone-platforms-config.js"></script>
 *   <script src="js/bone-platforms-adapter.js"></script>
 */

(function() {
  'use strict';

  // ===== 内部辅助函数 =====

  /**
   * 从轨道名称中提取节点名（如 "mixamorigHips.quaternion" → "mixamorigHips"）
   */
  function _extractTrackNodeName(trackName) {
    if (!trackName) return '';
    const dotIndex = trackName.indexOf('.');
    return dotIndex > 0 ? trackName.substring(0, dotIndex) : trackName;
  }

  /**
   * 从模型中提取所有骨骼名称
   */
  function extractBoneNames(model) {
    const bones = [];
    if (!model) return bones;
    model.traverse(node => {
      if (node.isBone) bones.push(node.name);
    });
    return bones;
  }

  /**
   * 获取平台配置信息
   */
  function getPlatformConfig(platformId) {
    if (!window.PLATFORM_BONE_MAPS || !window.SUPPORTED_PLATFORMS) {
      console.warn('[bone-adapter] 配置文件未加载');
      return null;
    }

    const config = window.PLATFORM_BONE_MAPS[platformId];
    const meta = window.SUPPORTED_PLATFORMS.find(p => p.id === platformId);

    if (!config) {
      console.warn('[bone-adapter] 未知平台:', platformId);
      return null;
    }

    return {
      id: platformId,
      ...meta,
      boneMap: config,
      systemBones: config._system || {},
      defaults: config._defaults || {},
    };
  }

  /**
   * 获取支持的所有平台列表（用于前端下拉框）
   */
  function getSupportedPlatforms() {
    if (!window.SUPPORTED_PLATFORMS) return [];
    return window.SUPPORTED_PLATFORMS.map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      description: p.description,
      popular: p.popular,
    }));
  }

  /**
   * 自动检测模型来源平台
   * @param {THREE.Object3D} model - GLTF加载后的model对象
   * @returns {Array<{platform: string, confidence: number, tip: string}>} 按置信度排序的结果
   */
  function detectModelPlatform(model) {
    if (!window.PLATFORM_SIGNATURES) {
      console.warn('[bone-adapter] 平台特征库未加载');
      return [{ platform: 'unknown', confidence: 0, tip: '' }];
    }

    const boneNames = extractBoneNames(model);

    if (boneNames.length === 0) {
      console.warn('[bone-adapter] 未找到任何骨骼');
      return [{ platform: 'unknown', confidence: 0, tip: '模型中未检测到骨骼结构' }];
    }

    const results = [];

    for (const [platformId, signature] of Object.entries(window.PLATFORM_SIGNATURES)) {
      try {
        if (signature.test(boneNames)) {
          results.push({
            platform: platformId,
            confidence: signature.confidence,
            tip: signature.tip || '',
          });
        }
      } catch (e) {
        console.warn('[bone-adapter] 检测平台 ' + platformId + ' 时出错:', e.message);
      }
    }

    // 按置信度排序
    results.sort((a, b) => b.confidence - a.confidence);

    if (results.length === 0) {
      results.push({ platform: 'unknown', confidence: 0, tip: '无法识别该平台的骨骼命名格式' });
    }

    console.log('[bone-adapter] 平台检测结果:', results);
    console.log('[bone-adapter] 模型骨骼列表:', boneNames.slice(0, 15).join(', '), boneNames.length > 15 ? '...' : '');

    return results;
  }

  /**
   * 检测动画文件的来源平台
   */
  function detectAnimSourcePlatform(clip) {
    if (!window.ANIM_SIGNATURES || !clip || !clip.tracks) return 'unknown';

    const boneNames = [];
    clip.tracks.forEach(track => {
      const nodeName = _extractTrackNodeName(track.name);
      if (nodeName && !boneNames.includes(nodeName)) {
        boneNames.push(nodeName);
      }
    });

    if (boneNames.length === 0) return 'unknown';

    const results = [];
    for (const [platformId, signature] of Object.entries(window.ANIM_SIGNATURES)) {
      if (signature.test(boneNames)) {
        results.push({ platform: platformId, confidence: signature.confidence });
      }
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return results.length > 0 ? results[0].platform : 'unknown';
  }

  /**
   * 构建反向映射：从标准骨骼名 → 模型中的实际骨骼名
   * 用于动画重定向
   */
  function buildReverseMapping(platformConfig, modelBoneNames) {
    if (!platformConfig || !platformConfig.boneMap || !modelBoneNames) return {};

    const reverseMap = {};
    const boneMap = platformConfig.boneMap;

    for (const [standardName, actualName] of Object.entries(boneMap)) {
      if (standardName.startsWith('_')) continue; // 跳过系统字段
      if (!actualName) continue; // 跳过null值

      if (modelBoneNames.includes(actualName)) {
        reverseMap[standardName] = actualName;
      } else {
        // 尝试模糊匹配（忽略大小写）
        const fuzzyMatch = modelBoneNames.find(function(b) {
          return b.toLowerCase() === actualName.toLowerCase() ||
            b.replace(/\./g, '_') === actualName ||
            actualName.replace(/\./g, '_') === b ||
            b.replace(/\s/g, '') === actualName.replace(/\s/g, '');
        });
        if (fuzzyMatch) {
          reverseMap[standardName] = fuzzyMatch;
          console.log('[bone-adapter] 模糊匹配:', standardName, '->', fuzzyMatch);
        }
      }
    }

    return reverseMap;
  }

  /**
   * 生成系统用的精简 boneMap（用于保存到数据库）
   */
  function generateSystemBoneMap(platformId) {
    const config = getPlatformConfig(platformId);
    if (!config) return {};

    return {
      platform: platformId,
      rightHand: config.systemBones.rightHand || null,
      camera: config.systemBones.camera || null,
      rootBone: config.systemBones.rootBone || null,
      fullMap: config.boneMap,
      defaults: config.defaults,
    };
  }

  /**
   * 动画Clip重定向
   * 将源平台动画的骨骼名转换为目标模型的骨骼名
   */
  function retargetAnimationClip(clip, sourcePlatformId, targetModel) {
    if (!clip || !clip.tracks || clip.tracks.length === 0) return clip;

    const sourceConfig = getPlatformConfig(sourcePlatformId);
    if (!sourceConfig) {
      console.warn('[bone-adapter] 无法获取源平台配置:', sourcePlatformId);
      return clip;
    }

    const targetBoneNames = extractBoneNames(targetModel);
    const reverseMap = buildReverseMapping(sourceConfig, targetBoneNames);

    // 构建重定向表：源骨骼名 -> 目标骨骼名
    const remapTable = {};
    for (const [stdName, targetActualName] of Object.entries(reverseMap)) {
      const sourceActualName = sourceConfig.boneMap[stdName];
      if (sourceActualName && targetActualName && sourceActualName !== targetActualName) {
        remapTable[sourceActualName] = targetActualName;
      }
    }

    if (Object.keys(remapTable).length === 0) {
      console.log('[bone-adapter] 无需重定向，骨骼名称已匹配');
      return clip;
    }

    // 重写tracks
    var changedCount = 0;
    var newTracks = clip.tracks.map(function(track) {
      var nodeName = _extractTrackNodeName(track.name);
      var mappedName = remapTable[nodeName];

      if (mappedName && mappedName !== nodeName) {
        changedCount++;
        var newName = track.name.replace(nodeName, mappedName);
        var newTrack = track.clone();
        newTrack.name = newName;
        return newTrack;
      }

      return track;
    });

    if (changedCount > 0) {
      var newClip = clip.clone();
      newClip.tracks = newTracks;
      console.log('[bone-adapter] 动画重定向完成:', changedCount, '/', newTracks.length, '条轨道已转换');
      return newClip;
    }

    return clip;
  }

  /**
   * 应用平台适配器（主要入口函数）
   * 在 world.js 中调用此函数来应用平台配置
   * 
   * @param {THREE.Object3D} model - 加载的3D模型
   * @param {Object} characterGroup - 角色组对象
   * @param {Object} options - 可选参数
   * @returns {Object} 适配结果 { boneMap, calibrationData, platform }
   */
  function applyBonePlatformAdapter(model, characterGroup, options) {
    var result = {
      boneMap: null,
      calibrationData: null,
      platform: null,
      detected: false,
    };

    // 1. 尝试从 characterGroup.userData 获取已保存的平台信息
    var platformId = null;
    var platformConfig = null;

    if (characterGroup && characterGroup.userData) {
      var td = characterGroup.userData.templateData;
      if (td && td.model_source_platform && td.bone_mapping_config) {
        platformId = td.model_source_platform;
        try {
          var bm = typeof td.bone_mapping_config === 'string'
            ? JSON.parse(td.bone_mapping_config)
            : td.bone_mapping_config;
          platformConfig = {
            platform: td.model_source_platform,
            systemBones: { rightHand: bm.rightHand, camera: bm.camera, rootBone: bm.rootBone },
            defaults: bm.defaults || {},
            boneMap: bm.fullMap || {},
          };
        } catch (e) {
          console.warn('[bone-adapter] 解析 bone_mapping_config 失败');
        }
      }
    }

    // 2. 如果没有保存的平台信息，尝试自动检测
    if (!platformConfig || !platformConfig.systemBones.rightHand) {
      var detections = detectModelPlatform(model);
      if (detections.length > 0 && detections[0].confidence > 0.6) {
        platformId = detections[0].platform;
        platformConfig = getPlatformConfig(platformId);
        result.detected = true;
        console.log('[bone-adapter] 自动检测到平台:', platformId, '置信度:', detections[0].confidence);
      }
    }

    if (!platformConfig) {
      console.log('[bone-adapter] 无法确定平台配置，使用默认骨骼查找');
      return result;
    }

    result.platform = platformId;

    // 3. 提取模型实际的骨骼名称
    var modelBoneNames = extractBoneNames(model);

    // 4. 构建实际可用的 boneMap
    var actualBoneMap = {};

    if (platformConfig.systemBones.rightHand) {
      var boneName = platformConfig.systemBones.rightHand;
      if (modelBoneNames.indexOf(boneName) !== -1) {
        actualBoneMap.rightHand = boneName;
      } else {
        var match = modelBoneNames.find(function(b) { return b.toLowerCase() === boneName.toLowerCase(); });
        if (match) actualBoneMap.rightHand = match;
      }
    }

    if (platformConfig.systemBones.camera) {
      var camBoneName = platformConfig.systemBones.camera;
      if (modelBoneNames.indexOf(camBoneName) !== -1) {
        actualBoneMap.camera = camBoneName;
      } else {
        var camMatch = modelBoneNames.find(function(b) { return b.toLowerCase() === camBoneName.toLowerCase(); });
        if (camMatch) actualBoneMap.camera = camMatch;
      }
    }

    if (platformConfig.systemBones.rootBone) {
      var rootBoneName = platformConfig.systemBones.rootBone;
      if (modelBoneNames.indexOf(rootBoneName) !== -1) {
        actualBoneMap.rootBone = rootBoneName;
      } else {
        var rootMatch = modelBoneNames.find(function(b) { return b.toLowerCase() === rootBoneName.toLowerCase(); });
        if (rootMatch) actualBoneMap.rootBone = rootMatch;
      }
    }

    result.boneMap = actualBoneMap;

    // 5. 生成校准数据
    result.calibrationData = {
      scale: platformConfig.defaults.scale || 1.0,
      poseType: platformConfig.defaults.poseType || 'unknown',
      unit: platformConfig.defaults.unit || 'm',
      needsManualCalibration: platformConfig.defaults.needsManualCalibration || false,
    };

    console.log('[bone-adapter] 应用平台配置:', platformId, result);

    return result;
  }

  /**
   * 验证骨骼映射是否完整
   */
  function validateBoneMapping(boneMap, requiredBones) {
    if (requiredBones === undefined) requiredBones = ['rightHand', 'camera'];
    var missing = [];
    for (var i = 0; i < requiredBones.length; i++) {
      var bone = requiredBones[i];
      if (!boneMap || !boneMap[bone]) {
        missing.push(bone);
      }
    }
    return {
      valid: missing.length === 0,
      missing: missing,
      message: missing.length === 0
        ? '骨骼映射完整'
        : '缺少关键骨骼: ' + missing.join(', '),
    };
  }

  /**
   * 获取平台的默认校准参数（用于预填充校准表单）
   */
  function getPlatformCalibrationDefaults(platformId) {
    var config = getPlatformConfig(platformId);
    if (!config || !config.defaults) return {};

    return {
      scale: config.defaults.scale || 1.0,
      poseType: config.defaults.poseType || 'unknown',
      groundOffsetAutoDetect: config.defaults.groundOffsetAutoDetect || true,
      needsManualCalibration: config.defaults.needsManualCalibration || false,
    };
  }

  // ===== 导出到全局 =====

  window.BoneAdapter = {
    // 核心函数
    extractBoneNames: extractBoneNames,
    getPlatformConfig: getPlatformConfig,
    getSupportedPlatforms: getSupportedPlatforms,
    detectModelPlatform: detectModelPlatform,
    detectAnimSourcePlatform: detectAnimSourcePlatform,
    buildReverseMapping: buildReverseMapping,
    generateSystemBoneMap: generateSystemBoneMap,
    retargetAnimationClip: retargetAnimationClip,
    applyBonePlatformAdapter: applyBonePlatformAdapter,
    validateBoneMapping: validateBoneMapping,
    getPlatformCalibrationDefaults: getPlatformCalibrationDefaults,

    // 快捷别名（供 world.js 使用）
    applyPlatformAdapter: applyBonePlatformAdapter,
  };

  // 兼容旧名称
  window.detectModelPlatform = detectModelPlatform;
  window.getSupportedPlatforms = getSupportedPlatforms;
  window.getPlatformConfig = getPlatformConfig;
  window.generateSystemBoneMap = generateSystemBoneMap;
  window.retargetAnimationClip = retargetAnimationClip;
  window.applyBonePlatformAdapter = applyBonePlatformAdapter;

})();
