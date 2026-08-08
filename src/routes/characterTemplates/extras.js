/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * characterTemplates 其他功能 API 模块
 * 包含：世界规则、天气、动作库、武器绑定、上传错误处理等 API
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { query } = require('../../database/db');
const { uploadAnimLib } = require('./uploads');
const { compressGlb, fileHash, extractBonesFromGlb, matchBones, STANDARD_BONES, CHAR_TEMPLATE_MAX_UPLOAD_MB } = require('./utils');

// 所有支持的动作 key 及默认 label（与前端 animLibMenu.js / multiPlatformAnimLib.js 保持一致）
const ANIM_KEY_LABELS = {
  idle:            '🧍 待机',
  walk:            '🚶 走路',
  run:             '🏃 奔跑',
  jump:            '🦘 跳跃',
  turn_left:       '↪️ 左转',
  turn_right:      '↩️ 右转',
  attack1:         '⚔️ 普攻',
  attack_stab:     '🗡️ 刺击',
  attack_slash:    '⚔️ 挥砍',
  attack_swing:    '🌀 横扫',
  attack_uppercut: '⬆️ 上勾拳',
  draw_sword:      '🗡️ 拔剑',
  sheath:          '🔙 收剑',
  hit:             '💥 受击',
  death:           '💀 死亡',
  combo_2:         '2️⃣ 连招2',
  combo_3:         '3️⃣ 连招3',
};

// ============================================================
// 世界规则 API
// ============================================================

// GET /api/character-templates/world-rules
router.get('/world-rules', async (req, res) => {
  try {
    const result = await query('SELECT * FROM world_rules ORDER BY created_at LIMIT 1');
    res.json(result.rows[0] || null);
  } catch (e) {
    console.error('Error fetching world rules:', e);
    res.status(500).json({ error: '获取世界规则失败' });
  }
});

// PUT /api/character-templates/world-rules
router.put('/world-rules', async (req, res) => {
  try {
    const {
      pvp_enabled, pve_enabled, allow_foreign_attack, damage_multiplier,
      allow_skill_types, max_foreign_level, respawn_enabled, friendly_fire, world_type,
    } = req.body;

    // world_type 联动更新 allow_skill_types
    let skillTypes = allow_skill_types;
    if (world_type === 'pvp') skillTypes = ['perform', 'build', 'attack', 'heal'];
    if (world_type === 'peaceful') skillTypes = ['perform', 'build'];
    if (world_type === 'creative') skillTypes = ['perform', 'build'];
    if (world_type === 'normal' && !allow_skill_types) skillTypes = ['perform', 'build'];

    const existing = await query('SELECT id FROM world_rules LIMIT 1');
    if (existing.rows.length) {
      await query(
        `UPDATE world_rules SET
          pvp_enabled = $1, pve_enabled = $2, allow_foreign_attack = $3,
          damage_multiplier = $4, allow_skill_types = $5, max_foreign_level = $6,
          respawn_enabled = $7, friendly_fire = $8, world_type = $9,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $10`,
        [
          pvp_enabled ?? false, pve_enabled ?? true, allow_foreign_attack ?? false,
          parseFloat(damage_multiplier) || 1.0,
          typeof skillTypes === 'string' ? skillTypes.split(',').map(s => s.trim()) : (skillTypes || ['perform', 'build']),
          parseInt(max_foreign_level) || 999,
          respawn_enabled ?? true, friendly_fire ?? false,
          world_type || 'normal',
          existing.rows[0].id,
        ]
      );
    } else {
      await query(
        `INSERT INTO world_rules (pvp_enabled, pve_enabled, allow_foreign_attack, damage_multiplier, allow_skill_types, max_foreign_level, respawn_enabled, friendly_fire, world_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          pvp_enabled ?? false, pve_enabled ?? true, allow_foreign_attack ?? false,
          parseFloat(damage_multiplier) || 1.0,
          typeof skillTypes === 'string' ? skillTypes.split(',').map(s => s.trim()) : (skillTypes || ['perform', 'build']),
          parseInt(max_foreign_level) || 999,
          respawn_enabled ?? true, friendly_fire ?? false,
          world_type || 'normal',
        ]
      );
    }
    res.json({ success: true, message: '世界规则已更新' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '更新世界规则失败: ' + e.message });
  }
});

// ============================================================
// 天气配置 API  /api/character-templates/weather
// ============================================================

// 自动建表
(async () => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS world_weather (
      id SERIAL PRIMARY KEY,
      weather_type VARCHAR(30) NOT NULL DEFAULT 'sunny',
      sky_mode VARCHAR(20) NOT NULL DEFAULT 'day',
      fog_enabled BOOLEAN NOT NULL DEFAULT false,
      fog_density FLOAT NOT NULL DEFAULT 0.01,
      rain_intensity FLOAT NOT NULL DEFAULT 0.5,
      snow_intensity FLOAT NOT NULL DEFAULT 0.5,
      wind_speed FLOAT NOT NULL DEFAULT 1.0,
      sun_angle FLOAT NOT NULL DEFAULT 45,
      day_cycle_enabled BOOLEAN NOT NULL DEFAULT false,
      day_cycle_speed FLOAT NOT NULL DEFAULT 1.0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) { console.warn('world_weather建表跳过:', e.message); }
})();

// GET /api/character-templates/weather
router.get('/weather', async (req, res) => {
  try {
    const result = await query('SELECT * FROM world_weather ORDER BY id LIMIT 1');
    res.json(result.rows[0] || null);
  } catch (e) {
    console.error('Error fetching weather:', e);
    res.status(500).json({ error: '获取天气配置失败' });
  }
});

// PUT /api/character-templates/weather
router.put('/weather', async (req, res) => {
  try {
    const {
      weather_type, sky_mode, fog_enabled, fog_density,
      rain_intensity, snow_intensity, wind_speed, sun_angle,
      day_cycle_enabled, day_cycle_speed
    } = req.body;

    const existing = await query('SELECT id FROM world_weather LIMIT 1');
    if (existing.rows.length) {
      await query(
        `UPDATE world_weather SET
          weather_type=$1, sky_mode=$2, fog_enabled=$3, fog_density=$4,
          rain_intensity=$5, snow_intensity=$6, wind_speed=$7, sun_angle=$8,
          day_cycle_enabled=$9, day_cycle_speed=$10, updated_at=CURRENT_TIMESTAMP
         WHERE id=$11`,
        [
          weather_type || 'sunny', sky_mode || 'day',
          fog_enabled ?? false, parseFloat(fog_density) || 0.01,
          parseFloat(rain_intensity) || 0.5, parseFloat(snow_intensity) || 0.5,
          parseFloat(wind_speed) || 1.0, parseFloat(sun_angle) || 45,
          day_cycle_enabled ?? false, parseFloat(day_cycle_speed) || 1.0,
          existing.rows[0].id
        ]
      );
    } else {
      await query(
        `INSERT INTO world_weather (weather_type, sky_mode, fog_enabled, fog_density,
          rain_intensity, snow_intensity, wind_speed, sun_angle, day_cycle_enabled, day_cycle_speed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          weather_type || 'sunny', sky_mode || 'day',
          fog_enabled ?? false, parseFloat(fog_density) || 0.01,
          parseFloat(rain_intensity) || 0.5, parseFloat(snow_intensity) || 0.5,
          parseFloat(wind_speed) || 1.0, parseFloat(sun_angle) || 45,
          day_cycle_enabled ?? false, parseFloat(day_cycle_speed) || 1.0
        ]
      );
    }
    res.json({ success: true, message: '天气配置已保存' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '保存天气配置失败: ' + e.message });
  }
});

// ============================================================
// 动作库 API  /api/character-templates/anim-library
// ============================================================

// GET /api/character-templates/anim-library  获取所有动作
router.get('/anim-library', async (req, res) => {
  try {
    const { platform } = req.query;
    let sql = 'SELECT * FROM animation_library WHERE is_active=TRUE';
    const params = [];
    if (platform) {
      sql += ' AND platform = $1';
      params.push(platform);
    }
    sql += ' ORDER BY anim_key, sort_order, created_at DESC';
    const result = await query(sql, params);
    res.json({ animations: result.rows, anim_key_labels: ANIM_KEY_LABELS });
  } catch (e) {
    console.error('[anim-library GET]', e.message);
    res.status(500).json({ error: '获取动作库失败: ' + e.message });
  }
});

// POST /api/character-templates/anim-library  上传新动作
router.post('/anim-library', uploadAnimLib.single('glb_file'), async (req, res) => {
  try {
    const { anim_key, name, label, description, platform } = req.body;
    if (!anim_key || !ANIM_KEY_LABELS[anim_key]) {
      return res.status(400).json({ error: '无效的 anim_key，支持: ' + Object.keys(ANIM_KEY_LABELS).join(', ') });
    }
    if (!req.file) return res.status(400).json({ error: '请上传 GLB 文件' });

    const originalSize = req.file.size;

    // ===== gltfpack 自动压缩 =====
    const compressResult = await compressGlb(req.file.path);

    const glb_url = '/uploads/anim-library/' + req.file.filename;
    const glb_hash = await fileHash(req.file.path);
    const finalLabel = label || ANIM_KEY_LABELS[anim_key];
    const finalName = name || finalLabel;

    // 检查是否存在重复的动作（相同名称和动画类型）
    const existing = await query(
      'SELECT id FROM animation_library WHERE name = $1 AND anim_key = $2 AND is_active = TRUE',
      [finalName, anim_key]
    );
    if (existing.rows.length > 0) {
      // 删除上传的文件
      fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: `已存在相同名称和类型的动作: ${finalName}` });
    }

    const finalPlatform = platform || 'mixamo';
    const platformNameMap = {
      mixamo: 'Mixamo',
      hunyuan3d: '腾讯混元3D',
      makehuman: 'MakeHuman',
      other: '其他平台'
    };
    const finalPlatformName = platformNameMap[finalPlatform] || finalPlatform;

    const result = await query(
      `INSERT INTO animation_library (name, anim_key, glb_url, glb_hash, label, description, platform, platform_name, created_by_admin_id, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [finalName, anim_key, glb_url, glb_hash, finalLabel, description||null,
       finalPlatform, finalPlatformName,
       req.admin?.id||null, req.admin?.username||null]
    );

    // 提取骨骼信息并进行自动匹配
    const bones = extractBonesFromGlb(req.file.path);
    const boneMatchResult = matchBones(STANDARD_BONES, bones);
    
    // 计算匹配成功率
    const matchCount = Object.keys(boneMatchResult.matches).length;
    const matchRate = matchCount / STANDARD_BONES.length;
    
    // 返回压缩信息和骨骼匹配结果
    const respData = { 
      success: true, 
      animation: result.rows[0],
      boneMatching: {
        bones: bones,
        matches: boneMatchResult.matches,
        confidence: boneMatchResult.confidence,
        matchRate: matchRate,
        matchCount: matchCount,
        totalBones: STANDARD_BONES.length
      }
    };
    if (compressResult) {
      respData.compress = {
        original_kb: Math.round(originalSize / 1024),
        compressed_kb: Math.round(compressResult.compressedSize / 1024),
        ratio: Math.round(compressResult.ratio * 100),
        saved_kb: Math.round((originalSize - compressResult.compressedSize) / 1024),
      };
    }
    res.json(respData);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '上传动作失败: ' + e.message });
  }
});

// DELETE /api/character-templates/anim-library/:id  删除动作
router.delete('/anim-library/:id', async (req, res) => {
  try {
    const result = await query(
      'UPDATE animation_library SET is_active=FALSE WHERE id=$1 RETURNING glb_url',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: '动作不存在' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '删除动作失败' });
  }
});

// PUT /api/character-templates/:id/anim-set  更新角色模板的动作绑定
// body: { anim_set: { idle: "uuid", walk: "uuid", ... } }
router.put('/:id/anim-set', async (req, res) => {
  try {
    const { anim_set } = req.body;
    if (!anim_set || typeof anim_set !== 'object') {
      return res.status(400).json({ error: 'anim_set 必须是对象 {anim_key: animation_id}' });
    }
    // 校验所有 key 合法
    for (const k of Object.keys(anim_set)) {
      if (!ANIM_KEY_LABELS[k] && anim_set[k] !== null) {
        return res.status(400).json({ error: '无效的 anim_key: ' + k });
      }
    }
    const result = await query(
      'UPDATE character_templates SET anim_set=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id,name,anim_set',
      [JSON.stringify(anim_set), req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: '模板不存在' });
    res.json({ success: true, template: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: '更新动作绑定失败: ' + e.message });
  }
});

// GET /api/character-templates/:id/anim-resolved  获取角色模板完整动作URL（解析 anim_set）
router.get('/:id/anim-resolved', async (req, res) => {
  try {
    const tmpl = await query('SELECT id,name,glb_url,anim_set FROM character_templates WHERE id=$1', [req.params.id]);
    if (!tmpl.rows.length) return res.status(404).json({ error: '模板不存在' });
    const t = tmpl.rows[0];
    const animSet = t.anim_set || {};
    const resolved = {};
    const ids = Object.values(animSet).filter(v => v);
    if (ids.length) {
      const anims = await query('SELECT id,anim_key,glb_url,label FROM animation_library WHERE id=ANY($1) AND is_active=TRUE', [ids]);
      anims.rows.forEach(a => { resolved[a.anim_key] = { id: a.id, url: a.glb_url, label: a.label }; });
    }
    res.json({ template_id: t.id, name: t.name, glb_url: t.glb_url, anim_set: animSet, resolved });
  } catch (e) {
    res.status(500).json({ error: '获取动作失败: ' + e.message });
  }
});

// PUT /api/character-templates/:id/weapon  为角色模板绑定/解绑武器
router.put('/:id/weapon', async (req, res) => {
  try {
    const { weapon_id } = req.body; // null = 解绑
    if (weapon_id) {
      const w = await query('SELECT id FROM weapons WHERE id=$1 AND is_active=TRUE', [weapon_id]);
      if (!w.rows.length) return res.status(404).json({ error: '武器不存在' });
    }
    const result = await query(
      'UPDATE character_templates SET weapon_id=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id,name,weapon_id',
      [weapon_id || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: '模板不存在' });
    res.json({ success: true, template: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: '绑定武器失败: ' + e.message });
  }
});

// 统一处理上传错误（multer）
router.use((err, req, res, next) => {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `文件过大：单个文件最大允许 ${CHAR_TEMPLATE_MAX_UPLOAD_MB}MB` });
    }
    return res.status(400).json({ error: `上传失败：${err.code}` });
  }

  // fileFilter / 业务抛错
  if (typeof err.message === 'string' && err.message.includes('只允许上传')) {
    return res.status(400).json({ error: err.message });
  }

  console.error('[character-templates] 上传失败:', err);
  res.status(500).json({ error: '上传失败: ' + (err.message || '未知错误') });
});

module.exports = router;
