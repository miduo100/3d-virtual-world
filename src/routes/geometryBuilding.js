/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 几何体建筑生成路由
 * 不依赖外部API，使用Three.js几何体即时生成建筑
 */

const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const geometryBuilder = require('../services/geometryBuilder');

/**
 * 获取所有可用的建筑模板
 */
router.get('/templates', (req, res) => {
  try {
    const templates = geometryBuilder.getTemplates();
    res.json({
      success: true,
      templates: templates
    });
  } catch (error) {
    console.error('获取模板失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 创建几何体建筑（通用）
 * POST /api/geometry-building/create
 */
router.post('/create', async (req, res) => {
  try {
    const {
      name,
      geometry_type,
      geometry_data,
      tags = [],
      description = '',
      template_id = null
    } = req.body;

    if (!name || !geometry_type) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数：name 和 geometry_type'
      });
    }

    console.log('💾 创建几何体建筑:', name, geometry_type);

    // 插入数据库
    const insertQuery = `
      INSERT INTO geometry_buildings (
        name,
        geometry_type,
        geometry_data,
        tags,
        description,
        template_id,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `;

    const values = [
      name,
      geometry_type,
      JSON.stringify(geometry_data),
      tags,
      description,
      template_id
    ];

    const result = await pool.query(insertQuery, values);
    const building = result.rows[0];

    console.log(`✅ 建筑已创建，ID: ${building.id}`);

    res.json({
      success: true,
      message: '建筑创建成功',
      building: {
        id: building.id,
        name: building.name,
        geometry_type: building.geometry_type,
        tags: building.tags
      }
    });

  } catch (error) {
    console.error('❌ 创建建筑失败:', error);
    res.status(500).json({
      success: false,
      error: '创建失败',
      details: error.message
    });
  }
});

/**
 * 即时生成几何体建筑
 * 不需要等待，立即返回几何体描述
 */
router.post('/generate', async (req, res) => {
  try {
    const { templateId, name, options = {} } = req.body;
    
    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: '缺少模板ID'
      });
    }
    
    console.log('🔨 生成几何体建筑:', { templateId, name });
    
    // 即时生成建筑几何体描述
    const buildingData = geometryBuilder.generateBuilding(templateId, options);
    console.log('✅ 建筑数据生成完成');
    
    // 保存到数据库
    const insertQuery = `
      INSERT INTO geometry_buildings 
      (user_id, name, template_id, geometry_data, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [
      1, // 管理员ID
      name || buildingData.name,
      templateId,
      JSON.stringify(buildingData)
    ]);
    
    const building = result.rows[0];
    console.log('✅ 建筑已保存到数据库, ID:', building.id);
    
    res.json({
      success: true,
      message: `✅ "${building.name}" 已生成！可直接放置到世界`,
      building: {
        id: building.id,
        name: building.name,
        templateId: building.template_id,
        geometryData: buildingData,
        createdAt: building.created_at
      }
    });
    
  } catch (error) {
    console.error('❌ 生成建筑失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 批量生成建筑
 */
router.post('/generate-batch', async (req, res) => {
  try {
    const { buildings } = req.body; // [{ templateId, name, options }, ...]
    
    if (!Array.isArray(buildings) || buildings.length === 0) {
      return res.status(400).json({
        success: false,
        error: '无效的建筑列表'
      });
    }
    
    console.log(`🔨 批量生成 ${buildings.length} 个建筑`);
    
    const results = [];
    
    for (const buildingReq of buildings) {
      const { templateId, name, options = {} } = buildingReq;
      
      const buildingData = geometryBuilder.generateBuilding(templateId, options);
      
      const insertQuery = `
        INSERT INTO geometry_buildings 
        (user_id, name, template_id, geometry_data, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `;
      
      const result = await pool.query(insertQuery, [
        1,
        name || buildingData.name,
        templateId,
        JSON.stringify(buildingData)
      ]);
      
      results.push({
        id: result.rows[0].id,
        name: result.rows[0].name,
        templateId: templateId
      });
    }
    
    res.json({
      success: true,
      message: `✅ 成功生成 ${results.length} 个建筑！`,
      buildings: results
    });
    
  } catch (error) {
    console.error('批量生成失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取所有几何体建筑列表
 */
router.get('/list', async (req, res) => {
  try {
    console.log('📋 接收到获取建筑列表请求');
    
    const result = await pool.query(`
      SELECT 
        id,
        name,
        template_id,
        geometry_data,
        created_at
      FROM geometry_buildings
      ORDER BY created_at DESC
    `);
    
    console.log(`✅ 查询到 ${result.rows.length} 个建筑`);
    
    const buildings = result.rows.map(row => {
      let geometryData;
      try {
        // 确保 geometry_data 是有效的 JSON
        geometryData = typeof row.geometry_data === 'string' 
          ? JSON.parse(row.geometry_data) 
          : row.geometry_data;
      } catch (e) {
        console.error('解析 geometry_data 失败:', e);
        geometryData = { name: row.name, components: [] };
      }
      
      return {
        id: row.id,
        name: row.name,
        templateId: row.template_id,
        geometryData: geometryData,
        createdAt: row.created_at
      };
    });
    
    res.json({
      success: true,
      buildings: buildings
    });
    
  } catch (error) {
    console.error('❌ 获取建筑列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取单个几何体建筑详情
 * GET /api/geometry-building/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM geometry_buildings WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '建筑不存在'
      });
    }
    
    const building = result.rows[0];
    
    // 解析 geometry_data
    let geometryData;
    try {
      geometryData = typeof building.geometry_data === 'string' 
        ? JSON.parse(building.geometry_data) 
        : building.geometry_data;
    } catch (e) {
      console.error('解析 geometry_data 失败:', e);
      geometryData = { name: building.name, components: [] };
    }
    
    res.json({
      success: true,
      building: {
        id: building.id,
        name: building.name,
        template_id: building.template_id,
        geometry_data: geometryData,
        created_at: building.created_at
      }
    });
    
  } catch (error) {
    console.error('获取建筑详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 删除几何体建筑（含级联清理 world_objects 引用）
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM geometry_buildings WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '建筑不存在'
      });
    }

    // 级联清理：删除 world_objects 中引用此建筑的所有记录
    const cascadeResult = await pool.query(
      `DELETE FROM world_objects 
       WHERE type = 'geometry_building' 
         AND (model_path = $1 OR building_id::text = $2::text)
       RETURNING id`,
      [`geometry_building:${id}`, id]
    );

    console.log(`🗑️ 已删除建筑 ${id}，同步清理 ${cascadeResult.rows.length} 条 world_objects 引用`);
    
    res.json({
      success: true,
      message: `建筑已删除${cascadeResult.rows.length > 0 ? `，同步清理 ${cascadeResult.rows.length} 条世界对象引用` : ''}`,
      cleanedObjects: cascadeResult.rows.length
    });
    
  } catch (error) {
    console.error('删除建筑失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 放置几何体建筑到世界
 */
router.post('/:id/place', async (req, res) => {
  try {
    const { id } = req.params;
    const { x, y, z } = req.body;
    
    // 获取建筑数据
    const buildingResult = await pool.query(
      'SELECT * FROM geometry_buildings WHERE id = $1',
      [id]
    );
    
    if (buildingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '建筑不存在'
      });
    }
    
    const building = buildingResult.rows[0];
    
    // 插入到世界对象表
    // 注意: geometry_data 存储在 geometry_buildings 表中，通过建筑ID关联
    const insertQuery = `
      INSERT INTO world_objects 
      (type, name, position_x, position_y, position_z, 
       rotation_x, rotation_y, rotation_z,
       scale_x, scale_y, scale_z,
       model_path, has_collision, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING *
    `;
    
    const worldResult = await pool.query(insertQuery, [
      'geometry_building',
      building.name,
      x || 0,
      y || 0,
      z || 0,
      0, // rotation_x
      0, // rotation_y
      0, // rotation_z
      1, // scale_x
      1, // scale_y
      1, // scale_z
      `geometry_building:${id}`, // 使用特殊格式存储几何体建筑ID
      false  // has_collision 默认 false，用户可在编辑器中开启
    ]);
    
    res.json({
      success: true,
      message: '建筑已放置到世界',
      worldObject: worldResult.rows[0]
    });
    
  } catch (error) {
    console.error('放置建筑失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 保存生成的OBJ模型到几何体模型库
 * POST /api/geometry-building/save-obj-model
 */
router.post('/save-obj-model', async (req, res) => {
  try {
    const {
      name,
      description,
      obj_content,
      tags = [],
      category = 'building',
      geometry_type,
      properties = {}
    } = req.body;

    if (!name || !obj_content) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数：name 和 obj_content'
      });
    }

    console.log('💾 保存OBJ模型到库:', name);

    // 保存OBJ文件到磁盘
    const fs = require('fs').promises;
    const path = require('path');
    
    const fileName = `${name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')}_${Date.now()}.obj`;
    const modelsDir = path.join(__dirname, '../../public/uploaded/geometry_models');
    await fs.mkdir(modelsDir, { recursive: true });
    
    const objPath = path.join(modelsDir, fileName);
    await fs.writeFile(objPath, obj_content, 'utf8');

    console.log(`📁 OBJ文件已保存: ${fileName}`);

    // 插入数据库
    const autoTagsData = {
      tags: tags,
      category: category,
      generated_at: new Date().toISOString(),
      method: 'ai_geometry_generator'
    };

    const insertQuery = `
      INSERT INTO geometry_buildings (
        template_id,
        name,
        description,
        config,
        obj_path,
        category,
        tags,
        auto_tags,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `;

    const values = [
      geometry_type || 'custom',
      name,
      description || '',
      JSON.stringify(properties),
      `/uploaded/geometry_models/${fileName}`,
      category,
      tags,
      JSON.stringify(autoTagsData)
    ];

    const result = await pool.query(insertQuery, values);
    const savedModel = result.rows[0];

    console.log(`✅ 模型已保存到数据库，ID: ${savedModel.id}`);

    res.json({
      success: true,
      message: '模型已成功保存到库',
      model: {
        id: savedModel.id,
        name: savedModel.name,
        obj_path: savedModel.obj_path,
        tags: savedModel.tags,
        category: savedModel.category
      }
    });

  } catch (error) {
    console.error('❌ 保存OBJ模型失败:', error);
    res.status(500).json({
      success: false,
      error: '保存模型失败',
      details: error.message
    });
  }
});

module.exports = router;
