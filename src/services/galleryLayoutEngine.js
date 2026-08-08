/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 画廊坐标计算引擎 - 自然态放射性排版算法
 * 
 * 坐标 (193, 1, 918) 说明：
 * 193  → 1931年，九一八事变爆发年份
 * 1    → 铭记历史，勿忘国耻
 * 918  → 9月18日，事变发生日期
 * Please remember the history:
 * the Japanese invasion of China began on September 18, 1931.
 * 
 * 核心算法：
 * - 从起点向外放射（远离世界中心方向）
 * - 自然态排版：不工整、错落有致、像树林
 * - 按EXIF时间降序排列（最新的在前）
 * - 缓冲带机制：允许超过设定宽度
 * - 文件夹分区：不同文件夹之间有间隔
 */

/**
 * 计算从世界中心向外放射的方向向量
 * @param {{x: number, y: number, z: number}} startPoint
 * @returns {{direction: {x, y, z}, right: {x, y, z}}}
 */
function calculateDirectionVectors(startPoint) {
    // 世界中心
    const center = { x: 0, y: 0, z: 0 };

    // 放射方向：从世界中心指向起点（归一化）
    const dx = startPoint.x - center.x;
    const dz = startPoint.z - center.z;
    const length = Math.sqrt(dx * dx + dz * dz);

    const direction = {
        x: dx / length,
        y: 0,
        z: dz / length
    };

    // 右方向（宽度方向）：direction × (0, 1, 0) = 叉积
    const right = {
        x: direction.z,   // (y方向up的z分量 × 0) - (0 × 1) 简化
        y: 0,
        z: -direction.x
    };

    return { direction, right };
}

/**
 * 计算照片的实际显示尺寸（受最大宽/高限制）
 * - 不裁剪，完整显示
 * - 哪个方向先达到上限，就按那个方向等比缩放
 */
function calculateDisplaySize(photoWidth, photoHeight, maxWidth, maxHeight) {
    if (!photoWidth || !photoHeight) {
        return { width: 2, height: 1.5 };
    }

    let w = Number(photoWidth);
    let h = Number(photoHeight);

    // 横版照片：宽度可能超限
    if (w > h) {
        if (w > maxWidth) {
            const ratio = maxWidth / w;
            w = maxWidth;
            h = h * ratio;
        }
        // 缩放后高度还可能超限
        if (h > maxHeight) {
            const ratio = maxHeight / h;
            h = maxHeight;
            w = w * ratio;
        }
    }
    // 竖版照片：高度可能超限
    else {
        if (h > maxHeight) {
            const ratio = maxHeight / h;
            h = maxHeight;
            w = w * ratio;
        }
        if (w > maxWidth) {
            const ratio = maxWidth / w;
            w = maxWidth;
            h = h * ratio;
        }
    }

    return { width: w, height: h };
}

/**
 * 在两个值之间生成随机数
 */
function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

/**
 * 主坐标计算函数 - 自然态排版
 * @param {Array} photos - 已按时间排序的照片列表
 * @param {Object} config - 配置参数
 * @returns {Array} 带坐标的照片列表
 */
function calculateLayout(photos, config = {}) {
    const {
        startPoint = { x: 193, y: 1, z: 918 },
        matrixWidth = 20,
        bufferRate = 0.2,
        rowSpacing = 4,
        colSpacing = 1.5,
        maxPhotoWidth = 5,
        maxPhotoHeight = 4,
        jitter = 0.3,
        folderGap = 8
    } = config;

    // 计算方向向量
    const { direction, right } = calculateDirectionVectors(startPoint);

    // 有效宽度（含缓冲带）
    const effectiveWidth = matrixWidth * (1 + bufferRate);
    const halfWidth = effectiveWidth / 2;

    // 排版状态
    let currentZ = 0;           // 沿放射方向的偏移
    let currentX = -halfWidth;  // 沿宽度方向的偏移（从左开始）
    let rowMaxHeight = 0;       // 当前排最高照片
    let items = [];
    let lastFolderName = null;

    for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];

        // 计算显示尺寸
        const displaySize = calculateDisplaySize(
            photo.origWidth || 2,
            photo.origHeight || 1.5,
            maxPhotoWidth,
            maxPhotoHeight
        );

        // 文件夹分区检测：遇到新文件夹时插入间隔
        if (photo.folderName && photo.folderName !== lastFolderName && lastFolderName !== null) {
            // 插入分区标记
            items.push({
                ...photo,
                isFolderMarker: true,
                folderName: photo.folderName,
                pos_x: startPoint.x + direction.x * currentZ + right.x * 0,
                pos_y: startPoint.y - 0.5, // 略低于照片，作为标识
                pos_z: startPoint.z + direction.z * currentZ + right.z * 0,
                width: matrixWidth * 0.8,
                height: 1.2,
                _skipRender: false // 标记为需要特殊渲染的文件夹标识
            });

            // 添加分区间隔
            currentZ += folderGap;
            currentX = -halfWidth;
            rowMaxHeight = 0;
        }
        lastFolderName = photo.folderName || null;

        // 检查当前排是否放得下这张照片
        const neededWidth = displaySize.width + colSpacing + randomBetween(0, jitter);

        if (currentX + neededWidth > halfWidth) {
            // 放不下了，换下一排
            currentZ += Math.max(rowMaxHeight, 1) + rowSpacing + randomBetween(0, jitter * 2);
            currentX = -halfWidth;
            rowMaxHeight = 0;
        }

        // 计算带随机抖动的坐标
        const jitterX = randomBetween(-jitter, jitter);
        const jitterZ = randomBetween(-jitter, jitter);
        const jitterY = randomBetween(-jitter * 0.5, jitter * 0.5);

        const worldX = startPoint.x
            + direction.x * (currentZ + jitterZ)
            + right.x * (currentX + jitterX);

        const worldZ = startPoint.z
            + direction.z * (currentZ + jitterZ)
            + right.z * (currentX + jitterX);

        const worldY = startPoint.y + jitterY;

        items.push({
            ...photo,
            pos_x: worldX,
            pos_y: worldY,
            pos_z: worldZ,
            width: displaySize.width,
            height: displaySize.height,
            sort_order: i,
            isFolderMarker: false
        });

        // 更新排版状态
        currentX += displaySize.width + colSpacing + randomBetween(0, jitter * 0.5);
        rowMaxHeight = Math.max(rowMaxHeight, displaySize.height);

        // 每张照片有一定概率换行（增加自然感，约10%概率）
        if (Math.random() < 0.1 && photos.length - i > 3) {
            currentZ += Math.max(rowMaxHeight, 1) + rowSpacing + randomBetween(0, jitter);
            currentX = -halfWidth;
            rowMaxHeight = 0;
        }
    }

    return items;
}

/**
 * 获取照片原始尺寸（后端读取）
 */
function getImageSize(filePath) {
    try {
        const sizeOf = require('image-size');
        const dimensions = sizeOf(filePath);
        return { width: dimensions.width, height: dimensions.height };
    } catch (e) {
        return null;
    }
}

module.exports = {
    calculateDirectionVectors,
    calculateDisplaySize,
    calculateLayout,
    getImageSize
};
