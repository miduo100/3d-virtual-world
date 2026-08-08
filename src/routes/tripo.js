/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const tripoService = require('../services/tripo');
const { pool } = require('../database/db');

// 配置文件上传（复用混元的配置）
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/images');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'tripo-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('只支持图片格式: JPEG, PNG, WEBP'));
  }
});

/**
 * POST /api/tripo/upload-image
 * 使用Tripo AI将图片转换为3D模型
 */
router.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传图片' });
    }

    const userId = req.body.userId;
    const buildingName = req.body.name || '未命名建筑';
    const description = req.body.description || '';
    
    // 读取图片并转换为base64
    const imagePath = req.file.path;
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const imageUrl = `data:${req.file.mimetype};base64,${base64Image}`;

    // 调用Tripo API生成模型
    const options = {
      mode: req.body.mode || 'preview', // preview(快速) 或 refine(精细)
      modelVersion: req.body.modelVersion || 'v2.0-20240919'
    };

    const result = await tripoService.imageToModel(imageUrl, options);

    console.log('Tripo imageToModel 结果:', result);

    if (!result.success) {
      console.error('❌ Tripo 3D模型生成失败:', result.error);
      return res.status(500).json({
        success: false,
        error: result.error || '模型生成失败'
      });
    }

    // 保存任务信息到数据库
    const insertResult = await pool.query(
      `INSERT INTO buildings 
       (user_id, name, description, model_path, task_id, status, ai_provider, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
       RETURNING *`,
      [userId, buildingName, description, null, result.taskId, 'generating', 'tripo']
    );

    const building = insertResult.rows[0];

    console.log('✅ Tripo任务已保存到数据库:', building.id);

    res.json({
      success: true,
      taskId: result.taskId,
      buildingId: building.id,
      message: 'Tripo任务已提交，正在生成模型',
      status: 'processing'
    });

  } catch (error) {
    console.error('❌ Tripo上传图片失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/tripo/task-status/:taskId
 * 查询Tripo任务状态
 */
router.get('/task-status/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;

    console.log(`📊 查询Tripo任务状态: ${taskId}`);

    // 查询Tripo API获取任务状态
    const result = await tripoService.queryTaskStatus(taskId);

    if (!result.success) {
      return res.status(500).json(result);
    }

    // 查询数据库中的建筑记录
    const buildingQuery = await pool.query(
      'SELECT * FROM buildings WHERE task_id = $1',
      [taskId]
    );

    if (buildingQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    const building = buildingQuery.rows[0];

    // 如果任务完成且模型URL存在，下载并保存模型
    if (result.status === 'completed' && result.modelUrl && !building.model_path) {
      console.log('📥 Tripo模型生成完成，开始下载...');

      const modelDir = path.join(__dirname, '../../public/models/generated');
      await fs.mkdir(modelDir, { recursive: true });

      const modelFileName = `tripo-${building.id}-${Date.now()}.glb`;
      const modelPath = path.join(modelDir, modelFileName);

      const downloadResult = await tripoService.downloadModel(result.modelUrl, modelPath);

      if (downloadResult.success) {
        const modelUrl = `/models/generated/${modelFileName}`;

        // 更新数据库
        await pool.query(
          'UPDATE buildings SET model_path = $1, status = $2, updated_at = NOW() WHERE id = $3',
          [modelUrl, 'completed', building.id]
        );

        building.model_path = modelUrl;
        building.status = 'completed';

        console.log('✅ Tripo模型已保存:', modelUrl);
      } else {
        console.error('❌ Tripo模型下载失败:', downloadResult.error);
      }
    }

    // 如果任务失败，更新数据库状态
    if (result.status === 'failed' && building.status !== 'failed') {
      await pool.query(
        'UPDATE buildings SET status = $1, updated_at = NOW() WHERE id = $2',
        ['failed', building.id]
      );
      building.status = 'failed';
    }

    res.json({
      success: true,
      taskId: taskId,
      status: result.status,
      progress: result.progress,
      building: building,
      tripoStatus: result.originalStatus
    });

  } catch (error) {
    console.error('❌ 查询Tripo任务状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/tripo/text-to-model
 * 使用Tripo AI将文本转换为3D模型
 */
router.post('/text-to-model', async (req, res) => {
  try {
    const { userId, prompt, name, description } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: '请提供描述文本' });
    }

    const buildingName = name || '未命名建筑';
    const options = {
      mode: req.body.mode || 'preview',
      modelVersion: req.body.modelVersion || 'v2.0-20240919'
    };

    const result = await tripoService.textToModel(prompt, options);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || '生成失败'
      });
    }

    // 保存到数据库
    const insertResult = await pool.query(
      `INSERT INTO buildings 
       (user_id, name, description, model_path, task_id, status, ai_provider, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
       RETURNING *`,
      [userId, buildingName, description || prompt, null, result.taskId, 'generating', 'tripo']
    );

    const building = insertResult.rows[0];

    res.json({
      success: true,
      taskId: result.taskId,
      buildingId: building.id,
      message: 'Tripo文本转模型任务已提交'
    });

  } catch (error) {
    console.error('❌ Tripo文本转模型失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/tripo/buildings
 * 获取所有Tripo生成的建筑
 */
router.get('/buildings', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    let query = 'SELECT * FROM buildings WHERE ai_provider = $1';
    const params = ['tripo'];
    
    if (userId) {
      query += ' AND user_id = $2';
      params.push(userId);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      buildings: result.rows
    });
    
  } catch (error) {
    console.error('❌ 获取Tripo建筑列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
