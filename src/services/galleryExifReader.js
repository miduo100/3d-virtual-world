/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 画廊EXIF时间提取服务
 * 负责从照片中读取拍摄时间（EXIF DateTimeOriginal）
 * 如果EXIF不可用，则退回到文件修改时间
 * 
 * 需要安装依赖: npm install exifr
 */

const fs = require('fs');
const path = require('path');

// 尝试加载exifr，如果未安装则使用文件修改时间
let exifr = null;
try {
    exifr = require('exifr');
} catch (e) {
    console.warn('[galleryExifReader] exifr未安装，将使用文件修改时间。运行: npm install exifr');
}

/**
 * 获取单张照片的拍摄时间
 * @param {string} filePath - 文件完整路径
 * @returns {Promise<Date>} 拍摄时间
 */
async function getPhotoDate(filePath) {
    try {
        if (exifr) {
            const exifData = await exifr.parse(filePath, ['DateTimeOriginal']);
            if (exifData && exifData.DateTimeOriginal) {
                return new Date(exifData.DateTimeOriginal);
            }
        }
    } catch (err) {
        // EXIF解析失败，降级使用文件修改时间
    }

    // 降级：使用文件修改时间
    try {
        const stat = await fs.promises.stat(filePath);
        return stat.mtime;
    } catch (err) {
        return new Date(); // 最终降级
    }
}

/**
 * 批量获取照片的拍摄时间
 * @param {Array<{filePath: string}>} files - 文件列表
 * @returns {Promise<Array<{filePath: string, photoDate: Date}>>}
 */
async function batchGetPhotoDates(files) {
    const results = [];
    for (const file of files) {
        const photoDate = await getPhotoDate(file.filePath);
        results.push({
            ...file,
            photoDate
        });
    }
    return results;
}

module.exports = { getPhotoDate, batchGetPhotoDates };
