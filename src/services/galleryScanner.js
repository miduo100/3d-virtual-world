/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 画廊文件夹扫描服务
 * 扫描 public/gallery_content/ 目录，识别所有子文件夹、照片和视频文件
 * 
 * 支持的图片格式: jpg, jpeg, png, webp, gif, bmp, svg, tiff
 * 支持的视频格式: mp4, webm, mov, avi, mkv, flv
 */

const fs = require('fs');
const path = require('path');

// 相对路径：从项目根目录到 gallery_content
const GALLERY_ROOT = path.join(__dirname, '..', '..', 'public', 'gallery_content');

// 支持的媒体类型
const IMAGE_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg', '.tiff', '.tif', '.heic', '.heif'
]);

const VIDEO_EXTENSIONS = new Set([
    '.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v'
]);

/**
 * 扫描 gallery_content 文件夹
 * @returns {Promise<Object>} { folders: [{name, files: [...]}], totalPhotos, totalVideos }
 */
async function scanGalleryFolder() {
    // 确保文件夹存在
    if (!fs.existsSync(GALLERY_ROOT)) {
        fs.mkdirSync(GALLERY_ROOT, { recursive: true });
        console.log('[galleryScanner] 已创建 gallery_content 文件夹:', GALLERY_ROOT);
        return { folders: [], totalPhotos: 0, totalVideos: 0, rootPath: GALLERY_ROOT };
    }

    const entries = fs.readdirSync(GALLERY_ROOT, { withFileTypes: true });
    const folders = [];
    let totalPhotos = 0;
    let totalVideos = 0;

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const folderPath = path.join(GALLERY_ROOT, entry.name);
        const files = await scanFolder(folderPath, entry.name);

        if (files.length > 0) {
            // 统计
            const photos = files.filter(f => f.type === 'image');
            const videos = files.filter(f => f.type === 'video');

            folders.push({
                name: entry.name,
                path: folderPath,
                files: files,
                photoCount: photos.length,
                videoCount: videos.length
            });

            totalPhotos += photos.length;
            totalVideos += videos.length;

            console.log(`[galleryScanner] 文件夹 "${entry.name}": ${photos.length}张照片, ${videos.length}个视频`);
        }
    }

    console.log(`[galleryScanner] 扫描完成: ${folders.length}个文件夹, ${totalPhotos}张照片, ${totalVideos}个视频`);

    return {
        folders,
        totalPhotos,
        totalVideos,
        rootPath: GALLERY_ROOT
    };
}

/**
 * 扫描单个文件夹内的媒体文件
 */
async function scanFolder(folderPath, folderName) {
    const files = [];

    try {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isFile()) continue;

            const ext = path.extname(entry.name).toLowerCase();
            const filePath = path.join(folderPath, entry.name);
            // 转为相对路径用于前端访问
            const relativePath = `/gallery_content/${folderName}/${entry.name}`;

            if (IMAGE_EXTENSIONS.has(ext)) {
                files.push({
                    name: entry.name,
                    folderName: folderName,
                    filePath: filePath,
                    relativePath: relativePath,
                    type: 'image',
                    extension: ext
                });
            } else if (VIDEO_EXTENSIONS.has(ext)) {
                files.push({
                    name: entry.name,
                    folderName: folderName,
                    filePath: filePath,
                    relativePath: relativePath,
                    type: 'video',
                    extension: ext
                });
            }
        }
    } catch (err) {
        console.warn(`[galleryScanner] 无法扫描文件夹: ${folderPath}`, err.message);
    }

    return files;
}

/**
 * 获取图片的原始宽高比
 * 使用 image-size 库快速读取（不加载完整图片）
 */
let sizeOf = null;
try {
    sizeOf = require('image-size');
} catch (e) {
    // 未安装，将返回默认比例
}

function getImageDimensions(filePath) {
    if (sizeOf) {
        try {
            const dimensions = sizeOf(filePath);
            return { width: dimensions.width, height: dimensions.height };
        } catch (e) {
            // 获取失败
        }
    }
    return null;
}

module.exports = { scanGalleryFolder, getImageDimensions, GALLERY_ROOT };
