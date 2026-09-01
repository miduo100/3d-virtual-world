/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 角色模板 GLB 纹理压缩服务
 *
 * 背景：
 *   角色模板上传（characterTemplates 路由）原本不走纹理压缩，与 uploadedModels 不一致，
 *   导致 4K 贴图原样入库。例如「没穿衣服」模板 37.6MB，其中 34MB 是
 *   2 张 4096×4096 PNG（baseColor 12MB + normal 22MB）。
 *
 * 危害链：
 *   浏览器侧 GLTFLoader 用 ImageBitmapLoader 以 fetch(blobUrl) 加载每张内嵌贴图，
 *   单张 22MB blob 解码后占 64MB 显存（2 张 128MB）；
 *   再叠加 admin.html 骨骼编辑器反复点开时的 WebGL renderer 泄漏，
 *   最终触发 TypeError: Failed to fetch（[BoneEditor] GLB 解析失败）。
 *
 * 方案：
 *   复用 uploadedModels 同款的 compressTextures，把角色模型贴图压到 2K。
 *   压缩失败一律跳过，绝不阻断上传（与 uploadedModels 行为一致）。
 */

const fsSync = require('fs');
const path = require('path');
const { compressTextures } = require('../../services/textureCompress');

// 角色模型：baseColor / metallicRoughness 降到 2K 足够；
// 法线/occlusion 由 compressTextures 内部保持原分辨率（保凹凸细节）
const CHAR_TEX_MAX_SIZE = 2048;

/**
 * 压缩角色模板 GLB 的内嵌纹理（原地改写文件）
 * @param {string} fileAbsPath GLB 绝对路径
 * @param {string} [contextLabel] 日志前缀
 * @returns {Promise<{compressed:boolean, originalSize:number, newSize:number, reason:string}>}
 */
async function compressCharGlb(fileAbsPath, contextLabel) {
  const label = contextLabel || 'char-template';
  const miss = { compressed: false, originalSize: 0, newSize: 0, reason: 'file-missing' };
  if (!fileAbsPath || !fsSync.existsSync(fileAbsPath)) return miss;

  // 只有 GLB/GLTF 有内嵌纹理；缩略图（png/jpg）不在这里处理
  const ext = path.extname(fileAbsPath).toLowerCase();
  if (ext !== '.glb' && ext !== '.gltf') {
    const size = fsSync.statSync(fileAbsPath).size;
    return { compressed: false, originalSize: size, newSize: size, reason: 'not-glb' };
  }

  const before = fsSync.statSync(fileAbsPath).size;
  try {
    const r = await compressTextures(fileAbsPath, { maxSize: CHAR_TEX_MAX_SIZE });
    if (r && r.compressed) {
      console.log(
        `[${label}] 纹理压缩: ${(before / 1048576).toFixed(1)}MB -> ${(r.newSize / 1048576).toFixed(1)}MB`
      );
      return {
        compressed: true,
        originalSize: before,
        newSize: r.newSize,
        reason: r.reason || 'compressed',
      };
    }
    return {
      compressed: false,
      originalSize: before,
      newSize: before,
      reason: (r && r.reason) || 'skipped',
    };
  } catch (e) {
    // 压缩失败绝不阻断上传
    console.warn(`[${label}] 纹理压缩失败，跳过（不影响上传）:`, (e && e.message) || e);
    return {
      compressed: false,
      originalSize: before,
      newSize: before,
      reason: 'error: ' + ((e && e.message) || e),
    };
  }
}

module.exports = { compressCharGlb, CHAR_TEX_MAX_SIZE };
