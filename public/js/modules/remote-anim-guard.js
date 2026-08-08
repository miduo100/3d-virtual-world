/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 远程动画守卫（Remote Animation Guard）
 *
 * 职责：在播放动画前进行三道检查，防止远端大文件/特效烘焙动画拖垮客户端
 *
 * 检查层级：
 *   1. 下载前 HEAD 预检：单文件大小 + 单角色累计预算
 *   2. 解析后播放前：轨道数 / 关键帧数 / 时长 / 内嵌网格数
 *   3. 累计预算控制：单角色全部动画累计大小
 *
 * 使用方式：
 *   world.js 在 _loadPlayerAnimGlb 加载前调用 shouldLoadAnim
 *   world.js 在 _processAnimClip 拿到 clip 后调用 validateClip
 */
(function() {
  'use strict';

  var _stats = {
    checked: 0,
    blockedByHead: 0,
    blockedByClip: 0,
    blockedByBudget: 0,
    allowed: 0
  };

  // 单角色动画累计预算 { characterId: bytes }
  var _characterBudget = {};

  // 配置缓存
  var _cfgCache = null;
  var _cfgCacheAt = 0;

  function _currentOrigin() {
    return (window.location && window.location.origin) || '';
  }

  function _isRemoteUrl(url) {
    if (!url) return false;
    if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) return false;
    return url.indexOf(_currentOrigin()) !== 0;
  }

  function _getConfig() {
    var now = Date.now();
    if (_cfgCache && (now - _cfgCacheAt) < 30000) return _cfgCache;

    var cfg = {};

    // 优先复用 RemoteModelGuard 的实时配置
    if (window.RemoteModelGuard && typeof window.RemoteModelGuard.getCurrentConfig === 'function') {
      cfg = window.RemoteModelGuard.getCurrentConfig() || {};
    }

    // 兜底默认值
    _cfgCache = {
      // 模型守卫总开关优先：enabled 未明确开启时动画守卫一律不拦截（配置未就绪同样放行，fail-open）
      anim_guard_enabled: cfg.enabled === true && cfg.anim_guard_enabled !== false,
      anim_max_file_size: _toNumber(cfg.anim_max_file_size, 5),
      anim_max_tracks: _toNumber(cfg.anim_max_tracks, 200),
      anim_max_keyframes: _toNumber(cfg.anim_max_keyframes, 20000),
      anim_max_duration: _toNumber(cfg.anim_max_duration, 30),
      anim_max_meshes: _toNumber(cfg.anim_max_meshes, 10),
      anim_total_max_size: _toNumber(cfg.anim_total_max_size, 30),
      anim_guard_remote_only: cfg.anim_guard_remote_only !== false
    };
    _cfgCacheAt = now;
    return _cfgCache;
  }

  function _toNumber(v, fallback) {
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function _bytesFromMB(mb) {
    return mb * 1024 * 1024;
  }

  function _forceRefresh() {
    _cfgCache = null;
    _cfgCacheAt = 0;
  }

  /**
   * 第一层：HEAD 预检
   * @param {string} url - 动画 URL
   * @param {object} ctx - { characterId, animType }
   * @returns {Promise<{shouldLoad: boolean, reason: string|null, contentLength: number}>}
   */
  async function shouldLoadAnim(url, ctx) {
    ctx = ctx || {};
    _stats.checked++;

    var cfg = _getConfig();
    if (!cfg.anim_guard_enabled) {
      _stats.allowed++;
      return { shouldLoad: true, reason: null, contentLength: 0 };
    }

    if (cfg.anim_guard_remote_only && !_isRemoteUrl(url)) {
      _stats.allowed++;
      return { shouldLoad: true, reason: null, contentLength: 0 };
    }

    var maxFileSize = _bytesFromMB(cfg.anim_max_file_size);
    var maxTotal = _bytesFromMB(cfg.anim_total_max_size);
    var characterId = ctx.characterId || 'self';
    var animType = ctx.animType || 'anim';

    var contentLength = 0;
    var headOk = false;

    try {
      var resp = await fetch(url, { method: 'HEAD', mode: 'cors' });
      if (resp.ok) {
        var cl = resp.headers.get('content-length');
        if (cl) contentLength = parseInt(cl, 10) || 0;
        headOk = true;
      }
    } catch (e) {
      console.warn('[RemoteAnimGuard] HEAD 预检失败，允许继续加载:', url, e.message);
      headOk = false;
    }

    // 单文件大小检查（仅在 HEAD 成功时）
    if (headOk && contentLength > 0 && contentLength > maxFileSize) {
      _stats.blockedByHead++;
      return {
        shouldLoad: false,
        reason: '动画文件 ' + _formatSize(contentLength) + ' > 上限 ' + cfg.anim_max_file_size + 'MB 已拦截',
        contentLength: contentLength
      };
    }

    // 累计预算检查
    var used = _characterBudget[characterId] || 0;
    if (headOk && contentLength > 0 && (used + contentLength) > maxTotal) {
      _stats.blockedByBudget++;
      return {
        shouldLoad: false,
        reason: '角色动画累计 ' + _formatSize(used) + ' + ' + _formatSize(contentLength) + ' 超过预算 ' + cfg.anim_total_max_size + 'MB',
        contentLength: contentLength
      };
    }

    _stats.allowed++;
    return { shouldLoad: true, reason: null, contentLength: contentLength };
  }

  /**
   * 第二层：解析后检查
   * @param {THREE.AnimationClip} clip
   * @param {object} gltf - GLTF 解析结果
   * @param {object} ctx - { characterId, animType }
   * @returns {{valid: boolean, reason: string|null}}
   */
  function validateClip(clip, gltf, ctx) {
    ctx = ctx || {};
    var cfg = _getConfig();
    if (!cfg.anim_guard_enabled) return { valid: true, reason: null };

    // 与第一层 shouldLoadAnim 保持一致：remote_only 模式下同域动画直接放行（本地动作库为可信内容）
    if (cfg.anim_guard_remote_only && ctx.url && !_isRemoteUrl(ctx.url)) {
      return { valid: true, reason: null };
    }

    if (!clip) return { valid: false, reason: 'clip 为空' };

    var characterId = ctx.characterId || 'self';

    // 轨道数
    var tracks = clip.tracks || [];
    if (tracks.length > cfg.anim_max_tracks) {
      _stats.blockedByClip++;
      return { valid: false, reason: '动画轨道数 ' + tracks.length + ' > 上限 ' + cfg.anim_max_tracks };
    }

    // 关键帧总数
    var keyframes = 0;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].times) keyframes += tracks[i].times.length;
    }
    if (keyframes > cfg.anim_max_keyframes) {
      _stats.blockedByClip++;
      return { valid: false, reason: '动画关键帧数 ' + keyframes + ' > 上限 ' + cfg.anim_max_keyframes };
    }

    // 时长
    if (clip.duration > cfg.anim_max_duration) {
      _stats.blockedByClip++;
      return { valid: false, reason: '动画时长 ' + clip.duration.toFixed(2) + 's > 上限 ' + cfg.anim_max_duration + 's' };
    }

    // 内嵌网格数（防特效烘焙进 GLB）
    var meshCount = 0;
    if (gltf && gltf.scene) {
      gltf.scene.traverse(function(node) {
        if (node.isMesh || node.isSkinnedMesh) meshCount++;
      });
    }
    if (meshCount > cfg.anim_max_meshes) {
      _stats.blockedByClip++;
      return { valid: false, reason: '动画 GLB 内嵌网格 ' + meshCount + ' > 上限 ' + cfg.anim_max_meshes + '（疑似烘焙特效）' };
    }

    return { valid: true, reason: null };
  }

  /**
   * 记录已加载动画的字节数
   */
  function recordLoaded(characterId, bytes) {
    if (!bytes || bytes <= 0) return;
    characterId = characterId || 'self';
    _characterBudget[characterId] = (_characterBudget[characterId] || 0) + bytes;
  }

  /**
   * 角色移除时释放预算
   */
  function resetCharacter(characterId) {
    if (characterId) {
      delete _characterBudget[characterId];
    }
  }

  /**
   * 重置全部预算与统计
   */
  function resetAll() {
    _characterBudget = {};
    _stats = { checked: 0, blockedByHead: 0, blockedByClip: 0, blockedByBudget: 0, allowed: 0 };
    _forceRefresh();
  }

  function getStats() {
    return {
      config: _getConfig(),
      stats: JSON.parse(JSON.stringify(_stats)),
      budgets: JSON.parse(JSON.stringify(_characterBudget))
    };
  }

  function _formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(2) + 'MB';
  }

  window.RemoteAnimGuard = {
    shouldLoadAnim: shouldLoadAnim,
    validateClip: validateClip,
    recordLoaded: recordLoaded,
    resetCharacter: resetCharacter,
    resetAll: resetAll,
    getStats: getStats,
    isRemoteUrl: _isRemoteUrl,
    forceRefresh: _forceRefresh
  };

  console.log('[remote-anim-guard.js] 远程动画守卫已加载');
})();
