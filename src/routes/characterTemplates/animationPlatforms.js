/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 多平台动作库管理 API
 * 路径：/api/character-templates/anim-library
 */

const express = require('express');
const router = express.Router();
const { query } = require('../../database/db');
const { uploadAnimLib, uploadSound } = require('./uploads');
const multer = require('multer');
const path = require('path');
const { fixAnimUpAxis } = require('./fixAnimUpAxis');

// 创建支持多种文件类型的上传中间件（用于编辑）
const fs = require('fs');
const animLibEditStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    let dir;
    if (/glb|gltf|fbx/i.test(path.extname(file.originalname))) {
      dir = path.join(__dirname, '../../../public/uploads/anim-library');
    } else if (/mp3|ogg|wav|aac|m4a/i.test(path.extname(file.originalname))) {
      dir = path.join(__dirname, '../../../public/uploads/character-templates/sounds');
    } else {
      return cb(new Error('不支持的文件类型'));
    }
    try { await fs.mkdir(dir, { recursive: true }); cb(null, dir); }
    catch (e) { cb(e); }
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'anim-' + suffix + ext);
  },
});
const uploadAnimLibEdit = multer({
  storage: animLibEditStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = /glb|gltf|fbx|mp3|ogg|wav|aac|m4a/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('只允许上传 GLB/GLTF/FBX/音频 文件'));
  },
});

// ===== 动作库 CRUD =====

/**
 * GET /api/character-templates/anim-library
 * 获取所有动作库（支持平台筛选）
 * Query: ?platform=mixamo
 */
router.get('/anim-library', async (req, res) => {
  try {
    const { platform } = req.query;
    
    let sql = 'SELECT * FROM animation_library WHERE is_active = TRUE';
    const params = [];
    
    if (platform) {
      sql += ' AND platform = $1';
      params.push(platform);
    }
    
    sql += ' ORDER BY platform, anim_key, sort_order, created_at DESC';
    
    const result = await query(sql, params);
    res.json({ animations: result.rows });
  } catch (e) {
    console.error('[anim-library GET]', e.message);
    res.status(500).json({ error: '获取动作库失败: ' + e.message });
  }
});

/**
 * GET /api/character-templates/anim-library/platforms
 * 获取所有平台列表
 */
router.get('/platforms', async (req, res) => {
  try {
    // 先检查 animation_platforms 表是否存在
    const tableCheck = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'animation_platforms'
      ) as exists
    `);
    
    if (tableCheck.rows[0].exists) {
      const result = await query(
        'SELECT * FROM animation_platforms WHERE is_active = TRUE ORDER BY sort_order, created_at'
      );
      res.json({ platforms: result.rows });
    } else {
      // 如果表不存在，返回默认平台列表
      res.json({ 
        platforms: [
          { platform: 'mixamo', display_name: 'Mixamo 动作库', logo: '🎬', sort_order: 10 },
          { platform: 'hunyuan3d', display_name: '腾讯混元3D 动作库', logo: '🤖', sort_order: 20 },
          { platform: 'makehuman', display_name: 'MakeHuman 动作库', logo: '🎭', sort_order: 30 },
          { platform: 'other', display_name: '其他平台动作库', logo: '➕', sort_order: 100 }
        ]
      });
    }
  } catch (e) {
    console.error('[anim-library platforms GET]', e.message);
    res.status(500).json({ error: '获取平台列表失败: ' + e.message });
  }
});

/**
 * POST /api/character-templates/anim-library
 * 上传动作到动作库（支持多平台分类）
 */
router.post('/anim-library', uploadAnimLib.fields([
  { name: 'glb_file', maxCount: 1 },
  { name: 'sound_file', maxCount: 1 }
]), async (req, res) => {
  try {
    const { anim_key, name, platform = 'mixamo' } = req.body;
    
    if (!anim_key) {
      return res.status(400).json({ error: '请选择动作类型' });
    }
    
    if (!req.files?.glb_file?.[0]) {
      return res.status(400).json({ error: '请上传动作文件' });
    }
    
    const glbFile = req.files.glb_file[0];
    const soundFile = req.files.sound_file?.[0];
    
    // 获取平台名称
    let platformName = 'Mixamo';
    try {
      const platformResult = await query(
        'SELECT display_name FROM animation_platforms WHERE platform = $1',
        [platform]
      );
      if (platformResult.rows.length > 0) {
        platformName = platformResult.rows[0].display_name;
      }
    } catch (e) {
      // 如果查询失败，使用默认值
      platformName = platform === 'hunyuan3d' ? '腾讯混元3D' : 
                    platform === 'makehuman' ? 'MakeHuman' : '其他';
    }
    
    // 动作 URL
    const glbUrl = '/uploads/anim-library/' + glbFile.filename;
    
    // 声音 URL（如果有）
    let soundUrl = null;
    let soundName = null;
    if (soundFile) {
      soundUrl = '/uploads/character-templates/sounds/' + soundFile.filename;
      soundName = soundFile.originalname;
    }
    
    // 默认动作名称
    const defaultNames = {
      idle: '待机', walk: '走路', run: '奔跑', jump: '跳跃',
      turn_left: '左转', turn_right: '右转',
      attack1: '拳击', attack_stab: '刺击', attack_slash: '挥砍',
      attack_swing: '横扫', attack_uppercut: '上勾拳',
      draw_sword: '拔剑', sheath: '收剑',
      hit: '受击', death: '死亡',
      combo_2: '连招2', combo_3: '连招3'
    };
    
    const finalName = name || `${platformName} - ${defaultNames[anim_key] || anim_key}`;
    
    // 插入数据库
    const result = await query(`
      INSERT INTO animation_library (name, anim_key, glb_url, platform, platform_name, sound_url, sound_name, is_active, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 
        (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM animation_library WHERE anim_key = $2)
      )
      RETURNING *
    `, [finalName, anim_key, glbUrl, platform, platformName, soundUrl, soundName]);
    
    res.json({ 
      success: true, 
      animation: result.rows[0],
      message: `成功上传到 ${platformName} 动作库`
    });
  } catch (e) {
    console.error('[anim-library POST]', e.message);
    res.status(500).json({ error: '上传失败: ' + e.message });
  }
});

/**
 * GET /api/character-templates/anim-library/:id
 * 获取单个动作详情
 */
router.get('/anim-library/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'SELECT * FROM animation_library WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '动作不存在' });
    }
    
    res.json({ animation: result.rows[0] });
  } catch (e) {
    console.error('[anim-library GET :id]', e.message);
    res.status(500).json({ error: '获取动作详情失败: ' + e.message });
  }
});

/**
 * PUT /api/character-templates/anim-library/:id
 * 更新动作信息（支持更换动作文件、音效、名称等）
 */
router.put('/anim-library/:id', uploadAnimLibEdit.fields([
  { name: 'glb_file', maxCount: 1 },
  { name: 'sound_file', maxCount: 1 }
]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, anim_key, platform } = req.body;
    const fs = require('fs');
    const path = require('path');
    
    // 获取现有动作信息
    const existingResult = await query(
      'SELECT * FROM animation_library WHERE id = $1',
      [id]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: '动作不存在' });
    }
    
    const existing = existingResult.rows[0];
    
    // 处理上传的文件
    const glbFile = req.files?.glb_file?.[0];
    const soundFile = req.files?.sound_file?.[0];
    
    // 处理新上传的动作文件
    let glbUrl = existing.glb_url;
    if (glbFile) {
      // 删除旧文件
      if (existing.glb_url) {
        const oldPath = path.join(__dirname, '../../../public' + existing.glb_url);
        try { fs.unlinkSync(oldPath); } catch (e) { console.error('删除旧动作文件失败:', e); }
      }
      glbUrl = '/uploads/anim-library/' + glbFile.filename;
    }
    
    // 处理新上传的音效文件
    let soundUrl = existing.sound_url;
    let soundName = existing.sound_name;
    if (soundFile) {
      // 删除旧文件
      if (existing.sound_url) {
        const oldSoundPath = path.join(__dirname, '../../../public' + existing.sound_url);
        try { fs.unlinkSync(oldSoundPath); } catch (e) { console.error('删除旧音效文件失败:', e); }
      }
      soundUrl = '/uploads/character-templates/sounds/' + soundFile.filename;
      soundName = soundFile.originalname;
    }
    
    // 构建更新 SQL
    const updates = [];
    const values = [];
    let idx = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${idx}`);
      values.push(name);
      idx++;
    }
    
    if (anim_key !== undefined) {
      updates.push(`anim_key = $${idx}`);
      values.push(anim_key);
      idx++;
    }
    
    if (platform !== undefined) {
      updates.push(`platform = $${idx}`);
      values.push(platform);
      idx++;
      const platformNameMap = {
        mixamo: 'Mixamo',
        hunyuan3d: '腾讯混元3D',
        makehuman: 'MakeHuman',
        other: '其他平台'
      };
      updates.push(`platform_name = $${idx}`);
      values.push(platformNameMap[platform] || platform);
      idx++;
    }
    
    updates.push(`glb_url = $${idx}`);
    values.push(glbUrl);
    idx++;
    
    updates.push(`sound_url = $${idx}`);
    values.push(soundUrl);
    idx++;
    
    updates.push(`sound_name = $${idx}`);
    values.push(soundName);
    idx++;
    
    values.push(id);
    
    const result = await query(
      `UPDATE animation_library SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    
    res.json({
      success: true,
      animation: result.rows[0],
      message: '更新成功'
    });
  } catch (e) {
    console.error('[anim-library PUT :id]', e.message);
    res.status(500).json({ error: '更新失败: ' + e.message });
  }
});

/**
 * DELETE /api/character-templates/anim-library/:id
 * 删除动作库中的动作
 */
router.delete('/anim-library/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 获取动作信息
    const animResult = await query(
      'SELECT * FROM animation_library WHERE id = $1',
      [id]
    );
    
    if (animResult.rows.length === 0) {
      return res.status(404).json({ error: '动作不存在' });
    }
    
    const anim = animResult.rows[0];
    
    // 删除文件
    const fs = require('fs');
    const path = require('path');
    
    if (anim.glb_url) {
      const filePath = path.join(__dirname, '../../../public' + anim.glb_url);
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('删除动作文件失败:', e);
      }
    }
    
    if (anim.sound_url) {
      const soundPath = path.join(__dirname, '../../../public' + anim.sound_url);
      try {
        fs.unlinkSync(soundPath);
      } catch (e) {
        console.error('删除声音文件失败:', e);
      }
    }
    
    // 删除数据库记录
    await query('DELETE FROM animation_library WHERE id = $1', [id]);
    
    res.json({ success: true, message: '删除成功' });
  } catch (e) {
    console.error('[anim-library DELETE]', e.message);
    res.status(500).json({ error: '删除失败: ' + e.message });
  }
});

/**
 * DELETE /api/character-templates/anim-library/:id/sound
 * 仅删除动作的音效文件（保留动作）
 */
router.delete('/anim-library/:id/sound', async (req, res) => {
  try {
    const { id } = req.params;
    const fs = require('fs');
    const path = require('path');
    
    // 获取现有动作信息
    const existingResult = await query(
      'SELECT * FROM animation_library WHERE id = $1',
      [id]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: '动作不存在' });
    }
    
    const existing = existingResult.rows[0];
    
    // 删除音效文件
    if (existing.sound_url) {
      const soundPath = path.join(__dirname, '../../../public' + existing.sound_url);
      try { fs.unlinkSync(soundPath); } catch (e) { console.error('删除音效文件失败:', e); }
    }
    
    // 更新数据库
    await query(
      'UPDATE animation_library SET sound_url = NULL, sound_name = NULL WHERE id = $1',
      [id]
    );
    
    res.json({ success: true, message: '音效已删除' });
  } catch (e) {
    console.error('[anim-library DELETE sound]', e.message);
    res.status(500).json({ error: '删除音效失败: ' + e.message });
  }
});

/**
 * POST /api/character-templates/anim-library/attach-platform
 * 关联指定平台的所有动作到模板
 */
router.post('/anim-library/attach-platform', async (req, res) => {
  try {
    const { template_id, platform } = req.body;
    
    if (!template_id || !platform) {
      return res.status(400).json({ error: '缺少 template_id 或 platform' });
    }
    
    // 验证模板存在
    const tmplResult = await query(
      'SELECT * FROM character_templates WHERE id = $1',
      [template_id]
    );
    
    if (tmplResult.rows.length === 0) {
      return res.status(404).json({ error: '模板不存在' });
    }
    
    // 获取该平台的所有动作
    const animsResult = await query(
      'SELECT * FROM animation_library WHERE platform = $1 AND is_active = TRUE',
      [platform]
    );
    
    const animations = animsResult.rows;
    
    if (animations.length === 0) {
      return res.status(400).json({ error: '该平台暂无动作' });
    }
    
    // 构建更新 SQL（仅使用 character_templates 中存在的动作列）
    const VALID_ANIM_COLUMNS = [
      'idle', 'walk', 'run', 'jump',
      'attack1', 'attack2', 'attack3',
      'hit', 'death',
      'turn_left', 'turn_right',
      'attack_stab', 'attack_slash', 'attack_swing', 'attack_uppercut',
      'sheath', 'draw_sword'
    ];
    
    const updates = [];
    const values = [template_id];
    let idx = 2;
    
    animations.forEach(anim => {
      if (!VALID_ANIM_COLUMNS.includes(anim.anim_key)) {
        console.log(`[attach-platform] 跳过不支持的 anim_key: ${anim.anim_key}`);
        return;
      }
      const field = `anim_${anim.anim_key}_url`;
      updates.push(`${field} = $${idx}`);
      values.push(anim.glb_url);
      idx++;
    });
    
    if (updates.length === 0) {
      // 仅更新平台信息，不关联动作
      await query(
        `UPDATE character_templates SET selected_anim_platform = $2, anim_mode = 'platform' WHERE id = $1`,
        [template_id, platform]
      );
    } else {
      await query(
        `UPDATE character_templates SET ${updates.join(', ')}, selected_anim_platform = $${idx}, anim_mode = 'platform' WHERE id = $1`,
        [...values, platform]
      );
    }
    
    res.json({
      success: true,
      attached_count: updates.length,
      platform: platform,
      message: `已关联 ${updates.length} 个动作 (${platform})`
    });
  } catch (e) {
    console.error('[anim-library attach-platform POST]', e.message);
    res.status(500).json({ error: '关联失败: ' + e.message });
  }
});

/**
 * POST /api/character-templates/anim-library/detach-platform
 * 取消模板与动作库平台的关联，清除 selected_anim_platform
 */
router.post('/anim-library/detach-platform', async (req, res) => {
  try {
    const { template_id } = req.body;

    if (!template_id) {
      return res.status(400).json({ error: '缺少 template_id' });
    }

    await query(
      `UPDATE character_templates SET selected_anim_platform = NULL, anim_mode = 'custom', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [template_id]
    );

    console.log(`[detach-platform] 模板 ${template_id} 已取消平台绑定`);
    res.json({ success: true, message: '已取消平台动作关联' });
  } catch (e) {
    console.error('[anim-library detach-platform POST]', e.message);
    res.status(500).json({ error: '取消关联失败: ' + e.message });
  }
});

/**
 * POST /api/character-templates/anim-library/:id/fix-up-axis
 * 检测并修复自定义上传动作的"趴地"问题（Hips 朝向补偿）
 * Body: { anim_url?: string }
 *   anim_url 可选；若提供则修复该具体动画文件，否则修复模板该动作列关联的文件
 */
router.post('/anim-library/:id/fix-up-axis', async (req, res) => {
  try {
    const { id } = req.params;
    const { anim_url } = req.body || {};

    // 取模板（含模型 glb_url 与动作列）
    const tmplResult = await query(
      'SELECT * FROM character_templates WHERE id = $1',
      [id]
    );
    if (tmplResult.rows.length === 0) {
      return res.status(404).json({ error: '角色模板不存在' });
    }
    const tmpl = tmplResult.rows[0];
    if (!tmpl.glb_url) {
      return res.status(400).json({ error: '模板未配置模型文件，无法计算补偿' });
    }

    const modelPath = path.join(__dirname, '../../../public' + tmpl.glb_url);

    // 确定要修复的动画文件
    let animUrl = anim_url;
    if (!animUrl) {
      return res.status(400).json({ error: '缺少 anim_url 参数' });
    }

    const animPath = path.join(__dirname, '../../../public' + animUrl);

    const result = fixAnimUpAxis(modelPath, animPath);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    if (!result.detected) {
      return res.json({
        success: true,
        detected: false,
        fixedChannels: result.fixedChannels,
        fixedFrames: result.fixedFrames,
        message: result.note || '未检测到趴地问题，无需修复',
      });
    }

    res.json({
      success: true,
      detected: true,
      fixedChannels: result.fixedChannels,
      fixedFrames: result.fixedFrames,
      backupPath: result.backupPath,
      message: `已修复 ${result.fixedFrames} 帧，请刷新预览`,
    });
  } catch (e) {
    console.error('[anim-library fix-up-axis]', e.message);
    res.status(500).json({ error: '修复失败: ' + e.message });
  }
});

module.exports = router;
