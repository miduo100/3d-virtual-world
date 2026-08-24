/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { pool } = require('../database/db');
const AdmZip = require('adm-zip');
const { compressIfNeeded } = require('../services/modelAutoCompress');
const { compressTextures } = require('../services/textureCompress');
const { decimateIfNeeded } = require('../services/modelDecimate');

// 配置文件上传
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/models/uploaded');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'model-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { 
    fileSize: 100 * 1024 * 1024, // 单个文件100MB
    files: 20 // 最多20个文件
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /glb|gltf|obj|mtl|zip/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    
    if (extname) {
      return cb(null, true);
    }
    cb(new Error('只支持 GLB, GLTF, OBJ, MTL, ZIP 格式'));
  }
});

/**
 * POST /api/upload-model
 * 上传3D模型文件（支持ZIP压缩包）
 */
router.post('/upload-model', upload.single('model'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const fileName = req.file.originalname;
    let savedFileName = req.file.filename;
    let fileSize = req.file.size;
    const fileType = path.extname(fileName).toLowerCase().replace('.', '');
    let filePath = `/models/uploaded/${savedFileName}`;

    console.log('📤 上传模型文件:', {
      originalName: fileName,
      savedName: savedFileName,
      size: fileSize,
      type: fileType
    });

    // 如果是ZIP文件，解压并查找OBJ主文件
    if (fileType === 'zip') {
      const zipPath = path.join(__dirname, '../../public/models/uploaded', savedFileName);
      const extractDir = path.join(__dirname, '../../public/models/uploaded', savedFileName.replace('.zip', ''));
      
      try {
        // 解压ZIP
        const zip = new AdmZip(zipPath);
        await fs.mkdir(extractDir, { recursive: true });
        zip.extractAllTo(extractDir, true);
        
        console.log('📦 ZIP已解压到:', extractDir);

        // 查找主OBJ文件
        const files = await fs.readdir(extractDir);
        const objFile = files.find(f => f.toLowerCase().endsWith('.obj'));
        
        if (!objFile) {
          // 如果没找到OBJ，删除解压的文件
          await fs.rm(extractDir, { recursive: true, force: true });
          await fs.unlink(zipPath);
          return res.status(400).json({ error: 'ZIP中未找到OBJ文件' });
        }

        // 更新文件路径为OBJ文件路径
        filePath = `/models/uploaded/${savedFileName.replace('.zip', '')}/${objFile}`;
        
        // 删除原始ZIP文件
        await fs.unlink(zipPath);
        
        console.log('✅ 找到OBJ主文件:', objFile);
        console.log('📍 模型路径:', filePath);
        
      } catch (zipError) {
        console.error('❌ 解压ZIP失败:', zipError);
        return res.status(500).json({ 
          error: '解压失败', 
          details: zipError.message 
        });
      }
    }

    // 减面：默认自动（>15万面才减），用户上传时可选择 off 跳过
    const decimateMode = req.body.decimate || 'auto';
    let decimation = null;
    if (fileType === 'glb') {
      decimation = await decimateIfNeeded(req.file.path, { mode: decimateMode });
      if (decimation.decimated) {
        savedFileName = path.basename(decimation.decimatedPath);
        filePath = `/models/uploaded/${savedFileName}`;
        fileSize = (await fs.stat(decimation.decimatedPath)).size;
      }
    }

    // 用户自定义名称（可选）
    const displayName = req.body.display_name || null;

    // 保存到数据库
    const insertQuery = `
      INSERT INTO uploaded_models 
      (file_name, saved_file_name, path, file_type, file_size, display_name, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [
      fileName,
      savedFileName,
      filePath,
      fileType,
      fileSize,
      displayName
    ]);

    console.log('✅ 模型已保存到数据库:', result.rows[0]);

    // 自动压缩：大尺寸 GLB 用 gltfpack 压缩 + 纹理二级压缩（失败自动跳过，不阻断上传）
    if (fileType === 'glb') {
      // 压缩目标是实际生效的文件（减面版则压缩减面版，原始 .glb 保留原质量供还原）
      const modelAbs = decimation && decimation.decimated ? decimation.decimatedPath : req.file.path;
      const compression = await compressIfNeeded(modelAbs, fileSize);
      let finalSize = compression.compressed ? compression.compressedSize : fileSize;
      const texture = await compressTextures(modelAbs, { maxSize: 2048 });
      if (texture.compressed) finalSize = texture.newSize;
      if (finalSize !== fileSize) {
        await pool.query('UPDATE uploaded_models SET file_size = $1 WHERE id = $2',
          [finalSize, result.rows[0].id]);
        result.rows[0].file_size = finalSize;
      }
      result.rows[0].compression = compression;
      result.rows[0].textureCompression = { compressed: texture.compressed, reason: texture.reason, originalSize: texture.originalSize, newSize: texture.newSize };
    }
    result.rows[0].decimation = decimation;

    res.json({
      success: true,
      message: '模型上传成功',
      model: result.rows[0]
    });

  } catch (error) {
    console.error('❌ 上传模型失败:', error);
    res.status(500).json({
      error: '上传失败',
      details: error.message
    });
  }
});

/**
 * POST /api/upload-models-batch
 * 批量上传3D模型文件（最多20个）
 */
router.post('/upload-models-batch', upload.array('models', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请上传文件' });
    }

    console.log(`📤 批量上传 ${req.files.length} 个模型文件`);

    const results = [];
    const errors = [];

    // 处理每个文件
    for (const file of req.files) {
      try {
        const fileName = file.originalname;
        let savedFileName = file.filename;
        let fileSize = file.size;
        const fileType = path.extname(fileName).toLowerCase().replace('.', '');
        let filePath = `/models/uploaded/${savedFileName}`;

        console.log('📤 处理文件:', fileName);

        // 如果是ZIP文件，解压并查找OBJ主文件
        if (fileType === 'zip') {
          const zipPath = path.join(__dirname, '../../public/models/uploaded', savedFileName);
          const extractDir = path.join(__dirname, '../../public/models/uploaded', savedFileName.replace('.zip', ''));
          
          try {
            // 解压ZIP
            const zip = new AdmZip(zipPath);
            await fs.mkdir(extractDir, { recursive: true });
            zip.extractAllTo(extractDir, true);
            
            console.log('📦 ZIP已解压到:', extractDir);

            // 查找主OBJ文件
            const files = await fs.readdir(extractDir);
            const objFile = files.find(f => f.toLowerCase().endsWith('.obj'));
            
            if (!objFile) {
              // 如果没找到OBJ，删除解压的文件
              await fs.rm(extractDir, { recursive: true, force: true });
              await fs.unlink(zipPath);
              throw new Error('ZIP中未找到OBJ文件');
            }

            // 更新文件路径为OBJ文件路径
            filePath = `/models/uploaded/${savedFileName.replace('.zip', '')}/${objFile}`;
            
            // 删除原始ZIP文件
            await fs.unlink(zipPath);
            
            console.log('✅ 找到OBJ主文件:', objFile);
            
          } catch (zipError) {
            console.error('❌ 解压ZIP失败:', zipError);
            throw new Error(`解压失败: ${zipError.message}`);
          }
        }

        // 减面：默认自动（>15万面才减），用户上传时可选择 off 跳过（批量统一模式）
        const decimateMode = req.body.decimate || 'auto';
        let decimation = null;
        if (fileType === 'glb') {
          decimation = await decimateIfNeeded(file.path, { mode: decimateMode });
          if (decimation.decimated) {
            savedFileName = path.basename(decimation.decimatedPath);
            filePath = `/models/uploaded/${savedFileName}`;
            fileSize = (await fs.stat(decimation.decimatedPath)).size;
          }
        }

        // 批量上传时的 display_name（通过 req.body.display_names JSON数组传入）
        let displayName = null;
        if (req.body.display_names) {
          try {
            const names = JSON.parse(req.body.display_names);
            const idx = req.files.indexOf(file);
            if (Array.isArray(names) && names[idx]) displayName = names[idx];
          } catch(e) { /* ignore parse error */ }
        }

        // 保存到数据库
        const insertQuery = `
          INSERT INTO uploaded_models 
          (file_name, saved_file_name, path, file_type, file_size, display_name, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          RETURNING *
        `;
        
        const result = await pool.query(insertQuery, [
          fileName,
          savedFileName,
          filePath,
          fileType,
          fileSize,
          displayName
        ]);

        console.log('✅ 模型已保存到数据库:', result.rows[0].id);

        // 自动压缩：大尺寸 GLB 用 gltfpack 压缩 + 纹理二级压缩（失败自动跳过，不阻断上传）
        let compression = null;
        let textureCompression = null;
        if (fileType === 'glb') {
          // 压缩目标是实际生效的文件（减面版则压缩减面版，原始 .glb 保留原质量供还原）
          const modelAbs = decimation && decimation.decimated ? decimation.decimatedPath : file.path;
          compression = await compressIfNeeded(modelAbs, fileSize);
          let finalSize = compression.compressed ? compression.compressedSize : fileSize;
          textureCompression = await compressTextures(modelAbs, { maxSize: 2048 });
          if (textureCompression.compressed) finalSize = textureCompression.newSize;
          if (finalSize !== fileSize) {
            await pool.query('UPDATE uploaded_models SET file_size = $1 WHERE id = $2',
              [finalSize, result.rows[0].id]);
            result.rows[0].file_size = finalSize;
          }
        }
        result.rows[0].decimation = decimation;

        results.push({
          success: true,
          fileName: fileName,
          model: result.rows[0],
          compression: compression,
          textureCompression: textureCompression ? { compressed: textureCompression.compressed, reason: textureCompression.reason, originalSize: textureCompression.originalSize, newSize: textureCompression.newSize } : null
        });

      } catch (fileError) {
        console.error('❌ 处理文件失败:', file.originalname, fileError);
        errors.push({
          fileName: file.originalname,
          error: fileError.message
        });
      }
    }

    // 返回结果
    const response = {
      success: results.length > 0,
      message: `成功上传 ${results.length} 个，失败 ${errors.length} 个`,
      total: req.files.length,
      successCount: results.length,
      errorCount: errors.length,
      results: results,
      errors: errors
    };

    console.log('✅ 批量上传完成:', response.message);

    res.json(response);

  } catch (error) {
    console.error('❌ 批量上传失败:', error);
    res.status(500).json({
      error: '批量上传失败',
      details: error.message
    });
  }
});

/**
 * GET /api/uploaded-models
 * 获取已上传的模型列表
 */
router.get('/uploaded-models', async (req, res) => {
  try {
    const query = `
      SELECT * FROM uploaded_models 
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query);

    // 补充磁盘实际大小（压缩后文件在磁盘上的真实字节数）+ 减面状态派生字段
    for (const row of result.rows) {
      try {
        const filePath = path.join(__dirname, '../../public', row.path || '');
        const stat = await fs.stat(filePath);
        row.disk_size = stat.size;
      } catch (e) {
        row.disk_size = null;
      }
      const p = String(row.path || '');
      row.is_decimated = p.endsWith('_dec.glb');
      row.original_path = row.is_decimated ? p.replace('_dec.glb', '.glb') : null;
      row.original_file_name = row.is_decimated ? String(row.saved_file_name || '').replace('_dec.glb', '.glb') : null;
    }

    res.json({
      success: true,
      models: result.rows
    });

  } catch (error) {
    console.error('❌ 获取模型列表失败:', error);
    res.status(500).json({
      error: '获取列表失败',
      details: error.message
    });
  }
});

/**
 * DELETE /api/uploaded-models/:id
 * 删除上传的模型
 */
router.delete('/uploaded-models/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 获取模型信息
    const modelQuery = await pool.query(
      'SELECT * FROM uploaded_models WHERE id = $1',
      [id]
    );

    if (modelQuery.rows.length === 0) {
      return res.status(404).json({ error: '模型不存在' });
    }

    const model = modelQuery.rows[0];

    // 删除文件或文件夹
    const filePath = path.join(__dirname, '../../public', model.path);
    
    try {
      // 如果是ZIP解压的OBJ，删除整个文件夹
      if (model.file_type === 'zip') {
        const folderPath = path.dirname(filePath);
        await fs.rm(folderPath, { recursive: true, force: true });
        console.log('✅ 文件夹已删除:', folderPath);
      } else {
        // 单文件直接删除
        await fs.unlink(filePath);
        console.log('✅ 文件已删除:', filePath);
      }
    } catch (err) {
      console.error('⚠️ 删除文件失败:', err);
    }

    // 删除数据库记录
    await pool.query('DELETE FROM uploaded_models WHERE id = $1', [id]);

    console.log('✅ 模型已从数据库删除:', id);

    res.json({
      success: true,
      message: '模型已删除'
    });

  } catch (error) {
    console.error('❌ 删除模型失败:', error);
    res.status(500).json({
      error: '删除失败',
      details: error.message
    });
  }
});

/**
 * POST /api/uploaded-models/:id/decimate
 * 对已上传模型执行减面（当初上传时选了不减面，现在想减）
 * 输出 xxx_dec.glb 新文件，原始文件保留；并同步更新场景中所有引用该模型的 world_objects
 */
router.post('/uploaded-models/:id/decimate', async (req, res) => {
  try {
    const { id } = req.params;
    const modelQuery = await pool.query('SELECT * FROM uploaded_models WHERE id = $1', [id]);
    if (modelQuery.rows.length === 0) {
      return res.status(404).json({ success: false, error: '模型不存在' });
    }
    const model = modelQuery.rows[0];

    if (model.file_type !== 'glb') {
      return res.status(400).json({ success: false, error: '仅 GLB 模型支持减面' });
    }
    if (String(model.path).endsWith('_dec.glb')) {
      return res.json({ success: true, message: '该模型已是减面版', model, skipped: 'already' });
    }

    const absPath = path.join(__dirname, '../../public', model.path);
    const dec = await decimateIfNeeded(absPath, { mode: 'on' }); // 手动触发，小模型也强制减（无效自动回退）

    if (!dec.decimated) {
      const reasonMsg = {
        'low-poly': '该模型面数较少，无需减面',
        'not-reduced': '减面未生效（输出面数未减少），已保留原文件',
        'no-output': '减面失败（无输出），已保留原文件',
        'error': '减面失败，已保留原文件'
      }[dec.reason] || '减面跳过';
      return res.json({ success: true, message: reasonMsg, decimated: false, reason: dec.reason });
    }

    const decStat = await fs.stat(dec.decimatedPath);
    const newSavedName = path.basename(dec.decimatedPath);
    const newFilePath = `/models/uploaded/${newSavedName}`;

    await pool.query(
      `UPDATE uploaded_models SET saved_file_name = $1, path = $2, file_size = $3, updated_at = NOW() WHERE id = $4`,
      [newSavedName, newFilePath, decStat.size, id]
    );
    // 同步场景中所有已放置的该模型对象指向减面版
    await pool.query('UPDATE world_objects SET model_path = $1 WHERE model_path = $2', [newFilePath, model.path]);

    const updated = (await pool.query('SELECT * FROM uploaded_models WHERE id = $1', [id])).rows[0];
    console.log(`✂️ 模型减面成功: ID ${id}, ${dec.origTris} → ${dec.newTris} 面`);
    res.json({
      success: true,
      message: `减面成功: ${dec.origTris.toLocaleString()} → ${dec.newTris.toLocaleString()} 面`,
      model: updated,
      decimated: true
    });
  } catch (error) {
    console.error('❌ 减面失败:', error);
    res.status(500).json({ success: false, error: '减面失败', details: error.message });
  }
});

/**
 * POST /api/uploaded-models/:id/restore
 * 还原已上传模型的原版（觉得减面后模糊时切回完整细节）
 * 仅改引用回到原始 .glb，_dec.glb 文件保留；并同步更新场景中所有引用该模型的 world_objects
 */
router.post('/uploaded-models/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    const modelQuery = await pool.query('SELECT * FROM uploaded_models WHERE id = $1', [id]);
    if (modelQuery.rows.length === 0) {
      return res.status(404).json({ success: false, error: '模型不存在' });
    }
    const model = modelQuery.rows[0];

    if (!String(model.path).endsWith('_dec.glb')) {
      return res.json({ success: true, message: '该模型已是原版，无需还原', model, skipped: 'already' });
    }

    const originalPath = String(model.path).replace('_dec.glb', '.glb');
    const originalName = String(model.saved_file_name).replace('_dec.glb', '.glb');
    const absOriginal = path.join(__dirname, '../../public', originalPath);
    const stat = await fs.stat(absOriginal).catch(() => null);
    if (!stat) {
      return res.status(404).json({ success: false, error: '原始文件不存在，无法还原' });
    }

    await pool.query(
      `UPDATE uploaded_models SET saved_file_name = $1, path = $2, file_size = $3, updated_at = NOW() WHERE id = $4`,
      [originalName, originalPath, stat.size, id]
    );
    // 同步场景中所有已放置的该模型对象回到完整细节版
    await pool.query('UPDATE world_objects SET model_path = $1 WHERE model_path = $2', [originalPath, model.path]);

    const updated = (await pool.query('SELECT * FROM uploaded_models WHERE id = $1', [id])).rows[0];
    console.log(`🔄 模型已还原原版: ID ${id}`);
    res.json({ success: true, message: '已还原为完整细节版', model: updated, restored: true });
  } catch (error) {
    console.error('❌ 还原模型失败:', error);
    res.status(500).json({ success: false, error: '还原失败', details: error.message });
  }
});

/**
 * PUT /api/uploaded-models/:id/tags
 * 更新上传模型的标签
 */
router.put('/uploaded-models/:id/tags', async (req, res) => {
  try {
    const { id } = req.params;
    const { tags } = req.body;

    if (!Array.isArray(tags)) {
      return res.status(400).json({
        success: false,
        error: '标签必须是数组'
      });
    }

    // 更新标签
    const updateQuery = `
      UPDATE uploaded_models
      SET tags = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [tags, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '模型不存在'
      });
    }

    console.log(`✅ 模型标签已更新: ID ${id}, 标签:`, tags);

    res.json({
      success: true,
      message: '标签更新成功',
      model: result.rows[0]
    });

  } catch (error) {
    console.error('❌ 更新标签失败:', error);
    res.status(500).json({
      success: false,
      error: '更新标签失败',
      details: error.message
    });
  }
});

/**
 * PUT /api/uploaded-models/:id/display-name
 * 更新模型的自定义名称
 */
router.put('/uploaded-models/:id/display-name', async (req, res) => {
  try {
    const { id } = req.params;
    const { display_name } = req.body;

    if (!display_name || !display_name.trim()) {
      return res.status(400).json({ success: false, error: '名称不能为空' });
    }

    const updateQuery = `
      UPDATE uploaded_models
      SET display_name = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [display_name.trim(), id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '模型不存在' });
    }

    console.log(`✅ 模型名称已更新: ID ${id} -> "${display_name.trim()}"`);

    res.json({ success: true, message: '名称更新成功', model: result.rows[0] });

  } catch (error) {
    console.error('❌ 更新模型名称失败:', error);
    res.status(500).json({ success: false, error: '更新失败', details: error.message });
  }
});

module.exports = router;
