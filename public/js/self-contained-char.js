/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 自包含角色包管理器（Self-Contained Character Bundle）
 *
 * 职责：
 *   1. 根据当前角色骨骼平台判定是否应作为"自包含包"跨世界传输
 *   2. 在世界策略为 self_contained 时，让目标世界按源骨骼命名原样播放动画
 *   3. 与现有 Mixamo/RPM/VRoid 重定向逻辑完全并行，零侵入
 *
 * 使用方式：
 *   在 index.html 中 bone-platforms-adapter.js 之后加载本文件
 */
(function() {
  'use strict';

  var LOCAL_STORAGE_KEY = 'selectedTemplateSelfContained';
  var LOCAL_STORAGE_BONE_MAP_KEY = 'selectedTemplateBoneMap';

  // 已知平台：这些平台已经有标准骨骼映射，走现有重定向逻辑
  var KNOWN_PLATFORMS = ['mixamo', 'rpm', 'vroid', 'blender', 'hunyuan3d', 'tripo', 'makehuman'];

  // 当前世界策略缓存（由 RemoteModelGuard 提供配置）
  var _lastMode = null;
  var _lastModeAt = 0;

  function _readBoneMap() {
    try {
      var raw = localStorage.getItem(LOCAL_STORAGE_BONE_MAP_KEY);
      if (!raw || raw === 'null' || raw === 'undefined') return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[SelfContainedChar] 读取 boneMap 失败:', e);
      return null;
    }
  }

  function _isKnownPlatform(platform) {
    return platform && KNOWN_PLATFORMS.indexOf(platform) !== -1;
  }

  /**
   * 检测当前本地角色是否应标记为自包含包
   * 规则：骨骼平台未知 / manual / 空配置 → true
   *       Mixamo/RPM/VRoid/Blender/Hunyuan3D/Tripo/MakeHuman → false
   */
  function detectFromLocalStorage() {
    var boneMap = _readBoneMap();
    if (!boneMap) {
      // 没有配置骨骼映射时，认为模型和动画是源世界自己配套的
      return { isSelfContained: true, platform: 'unknown', reason: 'no-bone-map' };
    }
    var platform = boneMap.platform || (boneMap.id) || 'manual';
    if (platform === 'manual' || !_isKnownPlatform(platform)) {
      return { isSelfContained: true, platform: platform, reason: 'custom-platform' };
    }
    return { isSelfContained: false, platform: platform, reason: 'known-platform' };
  }

  /**
   * 供传送发起端（federationUI.js）使用，把自包含信息写进 characterConfig
   */
  function buildSendExtra() {
    var detected = detectFromLocalStorage();
    return {
      isSelfContainedBundle: detected.isSelfContained,
      sourceBonePlatform: detected.platform
    };
  }

  /**
   * 供传送接收端（main.js）使用，把对端带过来的标记写入 localStorage
   */
  function applyReceived(characterConfig) {
    if (!characterConfig) return;
    if (characterConfig.isSelfContainedBundle === true) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
        active: true,
        sourceBonePlatform: characterConfig.sourceBonePlatform || 'unknown',
        receivedAt: Date.now()
      }));
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }

  /**
   * 当前本地玩家是否处于自包含模式
   */
  function isActive() {
    try {
      var raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return false;
      var obj = JSON.parse(raw);
      return obj && obj.active === true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 切换模板/回家/登出时清除自包含标记
   */
  function clear() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  /**
   * 在角色 Three.js 组上打自包含标记
   */
  function markGroup(characterGroup, flag) {
    if (!characterGroup) return;
    if (!characterGroup.userData) characterGroup.userData = {};
    characterGroup.userData.isSelfContainedBundle = flag === true;
  }

  /**
   * 读取角色组上的自包含标记
   */
  function isSelfContained(characterGroup) {
    return !!(characterGroup && characterGroup.userData && characterGroup.userData.isSelfContainedBundle);
  }

  /**
   * 读取当前世界的 character_bundle_mode 策略
   * 优先从 RemoteModelGuard 的缓存配置读取，避免重复请求
   */
  function getWorldMode() {
    var now = Date.now();
    if (_lastMode && (now - _lastModeAt) < 30000) {
      return _lastMode;
    }

    var mode = 'retarget'; // 默认重定向模式

    // 1. 尝试从 RemoteModelGuard 拿实时配置
    if (window.RemoteModelGuard && typeof window.RemoteModelGuard.getCurrentConfig === 'function') {
      var cfg = window.RemoteModelGuard.getCurrentConfig();
      if (cfg && cfg.character_bundle_mode) {
        mode = cfg.character_bundle_mode;
        _lastMode = mode;
        _lastModeAt = now;
        return mode;
      }
    }

    // 2. 兜底：静态 window.CONFIG（如果后端有注入）
    if (window.CONFIG && window.CONFIG.CHARACTER_BUNDLE_MODE) {
      mode = window.CONFIG.CHARACTER_BUNDLE_MODE;
    }

    _lastMode = mode;
    _lastModeAt = now;
    return mode;
  }

  /**
   * 世界策略是否允许自包含播放
   */
  function isSelfContainedModeEnabled() {
    return getWorldMode() === 'self_contained';
  }

  /**
   * 综合判断：某个角色在当前世界是否应当走自包含播放逻辑
   */
  function shouldPlayAsSelfContained(characterGroup) {
    return isSelfContained(characterGroup) && isSelfContainedModeEnabled();
  }

  /**
   * 从模型中找到根骨骼名
   * 规则：第一个 parent 不是 Bone 的 Bone（ hips / root 等）
   */
  function findRootBoneName(model) {
    if (!model) return null;
    var root = null;
    model.traverse(function(node) {
      if (!root && node.isBone) {
        var parentIsBone = node.parent && node.parent.isBone;
        if (!parentIsBone) root = node;
      }
    });
    return root ? root.name : null;
  }

  /**
   * 处理自包含动画 clip：
   *   - 跳过重定向
   *   - 仅过滤根骨骼的 .position 轨道（防止模型整体漂移）
   *   - 其余轨道原样保留
   *
   * 若当前角色不处于自包含模式，返回 null，让 world.js 走原有逻辑
   */
  function processClip(clip, characterGroup, model) {
    if (!shouldPlayAsSelfContained(characterGroup)) return null;
    if (!clip || !clip.tracks) return null;

    var rootName = findRootBoneName(model);
    if (!rootName) {
      console.warn('[SelfContainedChar] 未找到根骨骼，原样播放动画');
      return clip;
    }

    var positionPrefix = rootName + '.position';
    var removed = 0;
    var newTracks = clip.tracks.filter(function(track) {
      if (track.name === positionPrefix) {
        removed++;
        return false;
      }
      return true;
    });

    if (removed > 0) {
      console.log('[SelfContainedChar] 已过滤根骨骼位移轨道:', rootName, '共', removed, '条');
    }

    // 不修改原始 clip，复制一份
    var newClip = clip.clone();
    newClip.tracks = newTracks;
    return newClip;
  }

  /**
   * 是否放宽模型守卫的复杂度降级
   * 自包含模式下：保留文件大小 HEAD 预检，但豁免复杂度/面数降级
   */
  function shouldRelaxModelGuard(characterGroup) {
    return isSelfContained(characterGroup) && isSelfContainedModeEnabled();
  }

  /**
   * 强制刷新世界策略缓存
   */
  function refreshWorldMode() {
    _lastMode = null;
    _lastModeAt = 0;
  }

  // 暴露到全局
  window.SelfContainedChar = {
    detectFromLocalStorage: detectFromLocalStorage,
    buildSendExtra: buildSendExtra,
    applyReceived: applyReceived,
    isActive: isActive,
    clear: clear,
    markGroup: markGroup,
    isSelfContained: isSelfContained,
    getWorldMode: getWorldMode,
    isSelfContainedModeEnabled: isSelfContainedModeEnabled,
    shouldPlayAsSelfContained: shouldPlayAsSelfContained,
    processClip: processClip,
    shouldRelaxModelGuard: shouldRelaxModelGuard,
    refreshWorldMode: refreshWorldMode,
    KNOWN_PLATFORMS: KNOWN_PLATFORMS
  };

  console.log('[self-contained-char.js] 自包含角色包管理器已加载');
})();
