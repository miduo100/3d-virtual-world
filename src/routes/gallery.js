/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 画廊系统API路由
 * 
 * 坐标 (193, 1, 918) 说明：
 * 193  → 1931年，九一八事变爆发年份
 * 1    → 铭记历史，勿忘国耻
 * 918  → 9月18日，事变发生日期
 * Please remember the history: the Japanese invasion of China began on September 18, 1931.
 */

const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const path = require('path');
const fs = require('fs');
const { scanGalleryFolder } = require('../services/galleryScanner');
const { batchGetPhotoDates } = require('../services/galleryExifReader');
const { calculateLayout, getImageSize } = require('../services/galleryLayoutEngine');

// ========== 配置管理 ==========

// 获取所有配置
router.get('/configs', async (req, res) => {
    try {
        const result = await query('SELECT * FROM gallery_configs ORDER BY updated_at DESC');
        res.json({ success: true, configs: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 获取当前激活的配置
router.get('/active-config', async (req, res) => {
    try {
        const result = await query('SELECT * FROM gallery_configs WHERE is_active = true LIMIT 1');
        res.json({ success: true, config: result.rows[0] || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 保存配置
router.post('/configs', async (req, res) => {
    try {
        const { name, start_x, start_y, start_z, matrix_width, buffer_rate,
            row_spacing, col_spacing, max_photo_width, max_photo_height,
            jitter, folder_gap, is_active } = req.body;

        const result = await query(`
            INSERT INTO gallery_configs (name, start_x, start_y, start_z, matrix_width,
                buffer_rate, row_spacing, col_spacing, max_photo_width, max_photo_height,
                jitter, folder_gap, is_active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            RETURNING *`,
            [name || '默认配置', start_x || 193, start_y || 1, start_z || 918,
                matrix_width || 20, buffer_rate || 0.2, row_spacing || 4, col_spacing || 1.5,
                max_photo_width || 5, max_photo_height || 4,
                jitter || 0.3, folder_gap || 8, is_active || false]
        );

        // 如果设为激活，取消其他配置的激活状态
        if (is_active) {
            await query('UPDATE gallery_configs SET is_active = false WHERE id != $1', [result.rows[0].id]);
        }

        res.json({ success: true, config: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 更新配置
router.put('/configs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const fields = [];
        const values = [];
        let idx = 1;

        const updatableFields = ['name', 'start_x', 'start_y', 'start_z', 'matrix_width',
            'buffer_rate', 'row_spacing', 'col_spacing', 'max_photo_width', 'max_photo_height',
            'jitter', 'folder_gap', 'is_active'];

        for (const field of updatableFields) {
            if (req.body[field] !== undefined) {
                fields.push(`${field} = $${idx}`);
                values.push(req.body[field]);
                idx++;
            }
        }

        if (fields.length === 0) {
            return res.status(400).json({ error: '没有要更新的字段' });
        }

        fields.push(`updated_at = NOW()`);
        values.push(Number(id));

        const result = await query(
            `UPDATE gallery_configs SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );

        // 如果设为激活，取消其他
        if (req.body.is_active) {
            await query('UPDATE gallery_configs SET is_active = false WHERE id != $1', [id]);
        }

        res.json({ success: true, config: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 删除配置
router.delete('/configs/:id', async (req, res) => {
    try {
        await query('DELETE FROM gallery_items WHERE config_id = $1', [req.params.id]);
        await query('DELETE FROM gallery_configs WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== 扫描 ==========

// 扫描文件夹
router.post('/scan', async (req, res) => {
    try {
        const scanResult = await scanGalleryFolder();
        res.json({ success: true, ...scanResult });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== 坐标计算 ==========

// 生成布局
router.post('/generate', async (req, res) => {
    try {
        const configId = req.body.config_id;
        if (!configId) {
            return res.status(400).json({ error: '请提供config_id' });
        }

        // 获取配置
        const configResult = await query('SELECT * FROM gallery_configs WHERE id = $1', [configId]);
        if (configResult.rows.length === 0) {
            return res.status(404).json({ error: '配置不存在' });
        }
        const config = configResult.rows[0];

        // 扫描文件
        const scanResult = await scanGalleryFolder();

        // 提取所有文件（扁平化）
        let allFiles = [];
        for (const folder of scanResult.folders) {
            for (const file of folder.files) {
                allFiles.push({
                    folderName: folder.name,
                    name: file.name,
                    filePath: file.filePath,
                    relativePath: file.relativePath,
                    type: file.type,
                    extension: file.extension
                });
            }
        }

        if (allFiles.length === 0) {
            return res.json({
                success: true,
                generated: 0,
                message: 'gallery_content文件夹为空，请先放入照片'
            });
        }

        // 提取EXIF时间
        const filesWithDates = await batchGetPhotoDates(allFiles);

        // 按时间降序排序（最新在前）
        filesWithDates.sort((a, b) => b.photoDate - a.photoDate);

        // 读取每张照片的原始尺寸
        for (const file of filesWithDates) {
            const size = getImageSize(file.filePath);
            file.origWidth = size ? size.width : 2;
            file.origHeight = size ? size.height : 1.5;
        }

        // 计算布局坐标
        const layoutItems = calculateLayout(filesWithDates, {
            startPoint: { x: config.start_x, y: config.start_y, z: config.start_z },
            matrixWidth: config.matrix_width,
            bufferRate: config.buffer_rate,
            rowSpacing: config.row_spacing,
            colSpacing: config.col_spacing,
            maxPhotoWidth: config.max_photo_width,
            maxPhotoHeight: config.max_photo_height,
            jitter: config.jitter,
            folderGap: config.folder_gap
        });

        // 删除旧数据
        await query('DELETE FROM gallery_items WHERE config_id = $1', [configId]);

        // 批量插入
        for (let i = 0; i < layoutItems.length; i++) {
            const item = layoutItems[i];
            await query(`
                INSERT INTO gallery_items (config_id, folder_name, file_name, file_path,
                    file_type, photo_date, pos_x, pos_y, pos_z, width, height,
                    sort_order, is_folder_marker)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                [configId, item.folderName || '', item.name || '', item.relativePath || '',
                    item.type || 'image', item.photoDate || new Date(),
                    item.pos_x, item.pos_y, item.pos_z,
                    item.width, item.height,
                    i, item.isFolderMarker || false]
            );
        }

        // 更新配置统计
        const photoCount = layoutItems.filter(f => f.type === 'image' && !f.isFolderMarker).length;
        const videoCount = layoutItems.filter(f => f.type === 'video' && !f.isFolderMarker).length;
        await query(
            'UPDATE gallery_configs SET total_photos = $1, total_videos = $2, updated_at = NOW() WHERE id = $3',
            [photoCount, videoCount, configId]
        );

        res.json({
            success: true,
            generated: layoutItems.length,
            photos: photoCount,
            videos: videoCount
        });
    } catch (err) {
        console.error('[gallery] generate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========== 数据读取（前端用） ==========

// 获取激活配置的所有物品（分片加载）
router.get('/items', async (req, res) => {
    try {
        const configResult = await query('SELECT * FROM gallery_configs WHERE is_active = true LIMIT 1');
        if (configResult.rows.length === 0) {
            return res.json({ success: true, config: null, items: [] });
        }
        const config = configResult.rows[0];

        // 支持分片加载（按Z坐标范围）
        const zMin = parseFloat(req.query.z_min) || -Infinity;
        const zMax = parseFloat(req.query.z_max) || Infinity;
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;

        const result = await query(
            `SELECT * FROM gallery_items
             WHERE config_id = $1 AND pos_z >= $2 AND pos_z <= $3
             ORDER BY sort_order ASC
             LIMIT $4 OFFSET $5`,
            [config.id, zMin, zMax, limit, offset]
        );

        // 统计总数
        const countResult = await query(
            'SELECT COUNT(*) as total FROM gallery_items WHERE config_id = $1',
            [config.id]
        );

        res.json({
            success: true,
            config: {
                start_x: config.start_x,
                start_y: config.start_y,
                start_z: config.start_z
            },
            items: result.rows,
            total: countResult.rows[0].total
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 获取物品元数据（缩略图路径等）
router.get('/items/meta', async (req, res) => {
    try {
        const configResult = await query('SELECT id FROM gallery_configs WHERE is_active = true LIMIT 1');
        if (configResult.rows.length === 0) {
            return res.json({ success: true, items: [] });
        }

        // 只返回坐标和文件路径，不加载图片数据
        const result = await query(
            `SELECT id, folder_name, file_name, file_path, file_type,
                    pos_x, pos_y, pos_z, width, height, sort_order, is_folder_marker
             FROM gallery_items
             WHERE config_id = $1
             ORDER BY sort_order ASC`,
            [configResult.rows[0].id]
        );

        res.json({ success: true, items: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== 纪念功能 ==========
// 检查今天是否为9月18日
router.get('/memorial', (req, res) => {
    const today = new Date();
    const isSep18 = today.getMonth() === 8 && today.getDate() === 18; // JS月份从0开始
    res.json({
        success: true,
        isSep18,
        message: isSep18
            ? '铭记历史，勿忘国耻。Please remember the history: the Japanese invasion of China began on September 18, 1931.'
            : null
    });
});

// ========== 数据清理 ==========

// 清理全部画廊数据（保留配置参数）
router.post('/clear-all', async (req, res) => {
    try {
        // 1. 删除所有坐标数据
        const deleteResult = await query('DELETE FROM gallery_items');
        const deletedItems = deleteResult.rowCount;

        // 2. 重置配置表的统计数据和激活状态（保留配置参数）
        await query(`
            UPDATE gallery_configs 
            SET 
                total_photos = 0,
                total_videos = 0,
                is_active = false,
                updated_at = NOW()
        `);
        const configResult = await query('SELECT COUNT(*) FROM gallery_configs');
        const resetConfigs = configResult.rows[0].count;

        res.json({
            success: true,
            deletedItems,
            resetConfigs
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
