/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 副本原地加载器（管理员模式"复制对象"用）
 *
 * 背景：buildingManager.copyObject() 原实现在复制成功后会 setTimeout 2s 执行
 *      window.location.reload()，等于整页重载整个世界（重下几百个模型、丢失视角与未保存编辑），
 *      管理员在编辑器里点一次"复制"就被强制刷新一次。
 *
 * 本模块负责把后端 POST /api/world/objects/:id/copy 返回的副本行（world_objects 行，snake_case 字段）
 * 按 type 分派到 world 上对应的加载方法，在当前位置直接上屏，避免刷新页面。
 * 分派口径与 world.js loadGeneratedBuildings / processLoadingQueue 的 type→loadMethod 映射完全一致。
 *
 * 用法：window.BuildingCopyLoader.loadIntoScene(world, newObjectRow, sourceData)
 *   返回值：true 表示副本已原地加载；false 表示不支持/失败，调用方应提示用户手动刷新。
 */
(function () {
  'use strict';

  // type → world 上的加载方法名
  const METHOD_BY_TYPE = {
    uploaded_model: 'addUploadedModel',
    generated_building: 'addGeneratedBuilding',
    threejs_code: 'addThreeJSModel',
    ad_slot: 'addAdSlotPortal',
    gaussian_splat: 'addGaussianSplat',
    media_image: 'loadMediaObject',
    media_video: 'loadMediaObject'
  };

  /**
   * 解析对象类型对应的加载方法名（geometry_* 前缀统一走 addGeometryBuilding）
   */
  function resolveMethod(type) {
    if (!type || typeof type !== 'string') return null;
    if (METHOD_BY_TYPE[type]) return METHOD_BY_TYPE[type];
    if (type.indexOf('geometry_') === 0) return 'addGeometryBuilding';
    return null;
  }

  /**
   * 组装加载入参：后端返回的行字段与各 addXxx 入参口径一致（snake_case），
   * 仅需补 file_size —— 缺失时加载进度会因 totalBytes=0 卡在 0%（占位符/进度条依赖它）。
   */
  function buildPayload(row, source) {
    const payload = Object.assign({}, row);
    if (!payload.file_size) {
      const fromSource = source && (source.file_size || (source.data && source.data.file_size));
      if (fromSource) payload.file_size = fromSource;
    }
    return payload;
  }

  async function loadIntoScene(world, row, source) {
    if (!world || !row) return false;

    const method = resolveMethod(row.type);
    if (!method || typeof world[method] !== 'function') {
      console.warn('[CopyLoader] 不支持原地加载的对象类型，回退为手动刷新:', row.type);
      return false;
    }

    try {
      await world[method](buildPayload(row, source));
      console.log(`[CopyLoader] 副本已原地加载: id=${row.id} type=${row.type} via ${method}`);
      return true;
    } catch (e) {
      console.warn('[CopyLoader] 副本原地加载失败，请手动刷新页面:', e && e.message);
      return false;
    }
  }

  window.BuildingCopyLoader = { loadIntoScene: loadIntoScene, resolveMethod: resolveMethod };
})();
