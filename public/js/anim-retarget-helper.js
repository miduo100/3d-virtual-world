/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 动画重定向辅助模块
 * 
 * 功能：处理"含有皮肤"的动画文件，自动重定向骨骼名称
 * 
 * 问题场景：
 * - 用户上传的动画GLB文件包含SkinnedMesh（带骨骼的模型）和动画数据
 * - 动画中的骨骼名称（如 mixamorigHips）与角色模型的骨骼名称（如 Hips）不匹配
 * - 导致动画无法正确驱动角色模型
 * 
 * 解决方案：
 * - 检测动画来源平台和目标模型平台
 * - 调用 BoneAdapter.retargetAnimationClip 进行骨骼名称重映射
 * 
 * 使用方式：
 *   clip = window.AnimRetargetHelper.processAnimClip(clip, model, type);
 */

(function() {
  'use strict';

  /**
   * 处理动画clip，进行骨骼重定向
   * 
   * @param {THREE.AnimationClip} clip - 动作文件的动画clip
   * @param {THREE.Object3D} targetModel - 目标角色模型
   * @param {string} type - 动画类型（idle/walk/run等）
   * @returns {THREE.AnimationClip} 处理后的clip（可能已被重定向）
   */
  function processAnimClip(clip, targetModel, type) {
    // 参数验证
    if (!clip) {
      console.warn('[AnimRetarget] clip为空，跳过处理');
      return clip;
    }

    if (!targetModel) {
      console.warn('[AnimRetarget] targetModel为空，跳过重定向');
      return clip;
    }

    // 检查 BoneAdapter 是否可用
    if (!window.BoneAdapter) {
      console.warn('[AnimRetarget] BoneAdapter 未加载，跳过重定向');
      return clip;
    }

    try {
      // 检测动画来源平台（根据骨骼命名格式）
      const sourcePlatform = window.BoneAdapter.detectAnimSourcePlatform(clip);
      
      // 检测目标模型平台（根据骨骼命名格式）
      const targetPlatform = window.BoneAdapter.detectModelPlatform(targetModel);

      // 如果无法识别来源平台，跳过重定向
      if (sourcePlatform === 'unknown') {
        console.log(`[AnimRetarget] ${type}: 无法识别动画来源平台，保持原始骨骼名称`);
        return clip;
      }

      // 如果无法识别目标平台，跳过重定向
      if (!targetPlatform || targetPlatform.length === 0) {
        console.log(`[AnimRetarget] ${type}: 无法识别目标模型平台，保持原始骨骼名称`);
        return clip;
      }

      const targetPlatformId = targetPlatform[0].platform;

      // 如果平台相同，无需重定向
      if (sourcePlatform === targetPlatformId) {
        console.log(`[AnimRetarget] ${type}: 动画与目标模型骨骼格式相同（同为 ${sourcePlatform}），无需重定向`);
        return clip;
      }

      // 平台不同，需要重定向
      console.log(`[AnimRetarget] ${type}: 检测到骨骼平台不匹配，准备重定向`);
      console.log(`  来源平台: ${sourcePlatform}`);
      console.log(`  目标平台: ${targetPlatformId}`);

      // 调用 BoneAdapter 进行动画重定向
      const remappedClip = window.BoneAdapter.retargetAnimationClip(
        clip,
        sourcePlatform,
        targetModel
      );

      // 如果重定向成功（返回了新的clip）
      if (remappedClip && remappedClip !== clip) {
        console.log(`✅ [AnimRetarget] ${type} 动画重定向成功: ${sourcePlatform} → ${targetPlatformId}`);
        return remappedClip;
      } else {
        console.log(`[AnimRetarget] ${type}: 重定向返回相同clip，保持原始`);
        return clip;
      }

    } catch (e) {
      // 重定向失败，使用原始clip（不阻塞功能）
      console.warn(`⚠️ [AnimRetarget] ${type} 重定向过程中出错，使用原始动画:`, e.message);
      return clip;
    }
  }

  /**
   * 获取骨骼重定向的调试信息
   * 
   * @param {THREE.AnimationClip} clip - 动画clip
   * @param {THREE.Object3D} model - 角色模型
   * @returns {Object} 调试信息
   */
  function getDebugInfo(clip, model) {
    const info = {
      clipName: clip ? clip.name : 'N/A',
      trackCount: clip ? clip.tracks.length : 0,
      sourcePlatform: 'unknown',
      targetPlatform: 'unknown',
      needsRetarget: false
    };

    if (!clip || !model || !window.BoneAdapter) {
      return info;
    }

    try {
      info.sourcePlatform = window.BoneAdapter.detectAnimSourcePlatform(clip);
      const targetPlatform = window.BoneAdapter.detectModelPlatform(model);
      info.targetPlatform = targetPlatform && targetPlatform.length > 0 
        ? targetPlatform[0].platform 
        : 'unknown';
      info.needsRetarget = info.sourcePlatform !== 'unknown' && 
                           info.sourcePlatform !== info.targetPlatform;
    } catch (e) {
      console.warn('[AnimRetarget] 获取调试信息失败:', e);
    }

    return info;
  }

  // 导出到全局
  window.AnimRetargetHelper = {
    processAnimClip: processAnimClip,
    getDebugInfo: getDebugInfo
  };

  console.log('✅ [AnimRetarget] 动画重定向辅助模块已加载');
})();
