/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../database/db');
const autoTagService = require('../services/autoTagService');

// ===== 标签库管理 =====

// 获取所有标签（简单列表）
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, category, description, usage_count, created_at
      FROM model_tags
      ORDER BY category, name
    `);

    res.json({
      success: true,
      tags: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('❌ 获取标签列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 1. 获取标签库（按分类）
router.get('/library', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT name, category, description, usage_count
      FROM model_tags
      ORDER BY category, usage_count DESC, name
    `);

    // 按分类分组
    const tagsByCategory = result.rows.reduce((acc, tag) => {
      if (!acc[tag.category]) {
        acc[tag.category] = [];
      }
      acc[tag.category].push({
        name: tag.name,
        description: tag.description,
        usage_count: tag.usage_count
      });
      return acc;
    }, {});

    res.json({
      success: true,
      tags: tagsByCategory,
      total: result.rows.length
    });

  } catch (error) {
    console.error('❌ 获取标签库失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 2. 获取标签统计信息
router.get('/stats', async (req, res) => {
  try {
    // 按分类统计标签数量
    const categoryStatsResult = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM model_tags
      GROUP BY category
      ORDER BY category
    `);

    // 总标签数
    const totalTagsResult = await pool.query(
      'SELECT COUNT(*) as count FROM model_tags'
    );

    // 几何体已标签数
    const geometryResult = await pool.query(
      'SELECT COUNT(*) as count FROM geometry_buildings WHERE tags IS NOT NULL AND array_length(tags, 1) > 0'
    );

    // 上传模型已标签数
    const uploadedResult = await pool.query(
      'SELECT COUNT(*) as count FROM uploaded_models WHERE tags IS NOT NULL AND array_length(tags, 1) > 0'
    ).catch(() => ({ rows: [{ count: 0 }] }));

    // AI建筑已标签数
    const buildingResult = await pool.query(
      'SELECT COUNT(*) as count FROM generated_buildings WHERE tags IS NOT NULL AND array_length(tags, 1) > 0'
    ).catch(() => ({ rows: [{ count: 0 }] }));

    res.json({
      success: true,
      stats: categoryStatsResult.rows,
      summary: {
        total_tags: parseInt(totalTagsResult.rows[0].count),
        geometry_tagged: parseInt(geometryResult.rows[0].count),
        uploaded_tagged: parseInt(uploadedResult.rows[0].count),
        building_tagged: parseInt(buildingResult.rows[0].count)
      }
    });

  } catch (error) {
    console.error('❌ 获取标签统计失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 3. 获取最近打标签的模型
router.get('/recent-models', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 12;

    const result = await pool.query(`
      SELECT 
        source,
        model_id,
        name,
        tags,
        auto_tags,
        created_at
      FROM v_all_models
      WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
      ORDER BY updated_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);

    res.json({
      success: true,
      models: result.rows
    });

  } catch (error) {
    console.error('❌ 获取最近打标签模型失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 4. 根据标签搜索模型
router.post('/search', async (req, res) => {
  try {
    const { tags, category, limit = 20 } = req.body;

    if (!tags || !Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请提供标签数组'
      });
    }

    const result = await pool.query(
      'SELECT * FROM search_models_by_tags($1, $2, $3)',
      [tags, category || null, limit]
    );

    res.json({
      success: true,
      models: result.rows,
      search_tags: tags,
      total: result.rows.length
    });

  } catch (error) {
    console.error('❌ 标签搜索失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== 自动标签功能 =====

// 5. 为单个模型自动标签
router.post('/auto-tag', async (req, res) => {
  try {
    const { modelType, modelId } = req.body;

    if (!modelType || !modelId) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: modelType, modelId'
      });
    }

    const result = await autoTagService.batchTagModels(modelType, [modelId]);

    res.json({
      success: result.success > 0,
      message: result.success > 0 ? '标签生成成功' : '标签生成失败',
      result
    });

  } catch (error) {
    console.error('❌ 自动标签失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 6. 批量自动标签
router.post('/auto-tag-batch', async (req, res) => {
  try {
    const { modelType, modelIds } = req.body;

    if (!modelType || !Array.isArray(modelIds)) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: modelType, modelIds[]'
      });
    }

    const result = await autoTagService.batchTagModels(modelType, modelIds);

    res.json({
      success: true,
      message: `批量标签完成: 成功 ${result.success}, 失败 ${result.failed}`,
      result
    });

  } catch (error) {
    console.error('❌ 批量自动标签失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 7. 自动标签所有模型
router.post('/auto-tag-all', async (req, res) => {
  try {
    console.log('🤖 开始自动标签所有模型...');

    const results = await autoTagService.autoTagAllModels();

    res.json({
      success: true,
      message: '自动标签完成',
      results
    });

  } catch (error) {
    console.error('❌ 自动标签所有模型失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== 标签管理 =====

// 8. 添加新标签
router.post('/create', async (req, res) => {
  try {
    const { name, category, description, parent_tag_id } = req.body;

    if (!name || !category) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: name, category'
      });
    }

    const result = await pool.query(`
      INSERT INTO model_tags (name, category, description, parent_tag_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, category, description || null, parent_tag_id || null]);

    res.json({
      success: true,
      message: '标签创建成功',
      tag: result.rows[0]
    });

  } catch (error) {
    if (error.code === '23505') { // 唯一约束冲突
      return res.status(409).json({
        success: false,
        error: '标签已存在'
      });
    }

    console.error('❌ 创建标签失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 9. 更新标签
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, description } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (name) {
      updates.push(`name = $${paramIndex++}`);
      params.push(name);
    }
    if (category) {
      updates.push(`category = $${paramIndex++}`);
      params.push(category);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(description);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有要更新的字段'
      });
    }

    params.push(id);
    const result = await pool.query(`
      UPDATE model_tags
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '标签不存在'
      });
    }

    res.json({
      success: true,
      message: '标签更新成功',
      tag: result.rows[0]
    });

  } catch (error) {
    console.error('❌ 更新标签失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 10. 删除标签
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM model_tags WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '标签不存在'
      });
    }

    res.json({
      success: true,
      message: '标签删除成功',
      tag: result.rows[0]
    });

  } catch (error) {
    console.error('❌ 删除标签失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== 模型标签更新 =====

// 11. 更新模型标签
router.put('/model/:modelType/:modelId', async (req, res) => {
  try {
    const { modelType, modelId } = req.params;
    const { tags } = req.body;

    if (!Array.isArray(tags)) {
      return res.status(400).json({
        success: false,
        error: '标签必须是数组'
      });
    }

    let tableName;
    let idColumn = 'id';

    switch (modelType) {
      case 'geometry':
        tableName = 'geometry_buildings';
        break;
      case 'uploaded':
        tableName = 'uploaded_models';
        break;
      case 'building':
        tableName = 'generated_buildings';
        break;
      default:
        return res.status(400).json({
          success: false,
          error: '无效的模型类型'
        });
    }

    const result = await pool.query(`
      UPDATE ${tableName}
      SET tags = $1, updated_at = CURRENT_TIMESTAMP
      WHERE ${idColumn} = $2
      RETURNING *
    `, [tags, modelId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '模型不存在'
      });
    }

    res.json({
      success: true,
      message: '模型标签更新成功',
      model: result.rows[0]
    });

  } catch (error) {
    console.error('❌ 更新模型标签失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
