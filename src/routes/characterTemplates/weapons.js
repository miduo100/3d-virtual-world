/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * characterTemplates 武器库 API 模块
 * 包含：武器库 CRUD、武器技能管理等 API
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { query } = require('../../database/db');
const { uploadWeapon } = require('./uploads');

// GET /api/character-templates/weapons  获取武器库列表
router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM weapons WHERE is_active=TRUE ORDER BY sort_order, created_at DESC'
    );
    res.json({ weapons: result.rows });
  } catch (e) {
    res.status(500).json({ error: '获取武器库失败: ' + e.message });
  }
});

// GET /api/character-templates/weapons/:weaponId  获取单个武器（含技能）
router.get('/:weaponId', async (req, res) => {
  try {
    const { weaponId } = req.params;
    const weaponResult = await query('SELECT * FROM weapons WHERE id=$1', [weaponId]);
    if (!weaponResult.rows.length) {
      return res.status(404).json({ error: '武器不存在' });
    }
    const weapon = weaponResult.rows[0];
    const skillsResult = await query(
      'SELECT * FROM weapon_skills WHERE weapon_id=$1 ORDER BY sort_order, created_at',
      [weaponId]
    );
    res.json({ weapon: { ...weapon, skills: skillsResult.rows } });
  } catch (e) {
    res.status(500).json({ error: '获取武器详情失败: ' + e.message });
  }
});

// POST /api/character-templates/weapons  新建武器
router.post('/', uploadWeapon.single('glb_file'), async (req, res) => {
  try {
    const { name, weapon_type, config, sort_order, default_effect, skills } = req.body;
    if (!name) return res.status(400).json({ error: '武器名称不能为空' });
    const glb_url = req.file ? `/uploads/weapons/${req.file.filename}` : null;
    let configObj = {};
    try { configObj = config ? JSON.parse(config) : {}; } catch(e) {}
    const result = await query(
      `INSERT INTO weapons (name, weapon_type, glb_url, config, default_effect, sort_order, created_by_admin_id, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, weapon_type || 'builtin_lightsaber', glb_url, JSON.stringify(configObj),
       default_effect || 'none', parseInt(sort_order) || 0, req.adminUser?.id || null, req.adminUser?.username || null]
    );
    const weapon = result.rows[0];
    
    if (skills) {
      try {
        console.log('准备保存技能数据:', skills);
        const skillsData = typeof skills === 'string' ? JSON.parse(skills) : skills;
        console.log('解析后的技能数据:', skillsData);
        if (Array.isArray(skillsData)) {
          for (const skill of skillsData) {
            console.log('保存单个技能:', skill);
            await query(
              `INSERT INTO weapon_skills (weapon_id, skill_name, effect_type, trigger_type, duration, sound_url, sort_order, is_confirmed)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [weapon.id, skill.skill_name, skill.effect_type || 'none', skill.trigger_type || 'manual',
               parseInt(skill.duration) || 3000, skill.sound_url || null, parseInt(skill.sort_order) || 0, skill.is_confirmed || false]
            );
          }
        }
      } catch(e) {
        console.error('保存技能失败:', e);
      }
    }
    
    res.json({ success: true, weapon });
  } catch (e) {
    res.status(500).json({ error: '创建武器失败: ' + e.message });
  }
});

// PUT /api/character-templates/weapons/:weaponId  更新武器
router.put('/:weaponId', uploadWeapon.single('glb_file'), async (req, res) => {
  try {
    const { weaponId } = req.params;
    const existing = await query('SELECT * FROM weapons WHERE id=$1', [weaponId]);
    if (!existing.rows.length) return res.status(404).json({ error: '武器不存在' });
    const old = existing.rows[0];
    const { name, weapon_type, config, sort_order, default_effect, skills } = req.body;
    let glb_url = old.glb_url;
    if (req.file) {
      if (old.glb_url) fs.unlink(path.join(__dirname, '../../public', old.glb_url)).catch(() => {});
      glb_url = `/uploads/weapons/${req.file.filename}`;
    }
    let configObj = old.config || {};
    try { if (config) configObj = JSON.parse(config); } catch(e) {}
    const result = await query(
      `UPDATE weapons SET name=$1, weapon_type=$2, glb_url=$3, config=$4, default_effect=$5, sort_order=$6, updated_at=CURRENT_TIMESTAMP
       WHERE id=$7 RETURNING *`,
      [name || old.name, weapon_type || old.weapon_type, glb_url, JSON.stringify(configObj),
       default_effect || old.default_effect || 'none', parseInt(sort_order) ?? old.sort_order, weaponId]
    );
    const weapon = result.rows[0];
    
    if (skills !== undefined) {
      try {
        await query('DELETE FROM weapon_skills WHERE weapon_id=$1', [weaponId]);
        const skillsData = typeof skills === 'string' ? JSON.parse(skills) : skills;
        if (Array.isArray(skillsData)) {
          for (const skill of skillsData) {
            if (skill.id && !skill.id.startsWith('skill-')) {
              await query(
                `INSERT INTO weapon_skills (id, weapon_id, skill_name, effect_type, trigger_type, duration, sound_url, sort_order, is_confirmed)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [skill.id, weaponId, skill.skill_name, skill.effect_type || 'none', skill.trigger_type || 'manual',
                 parseInt(skill.duration) || 3000, skill.sound_url || null, parseInt(skill.sort_order) || 0, skill.is_confirmed || false]
              );
            } else {
              await query(
                `INSERT INTO weapon_skills (weapon_id, skill_name, effect_type, trigger_type, duration, sound_url, sort_order, is_confirmed)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [weaponId, skill.skill_name, skill.effect_type || 'none', skill.trigger_type || 'manual',
                 parseInt(skill.duration) || 3000, skill.sound_url || null, parseInt(skill.sort_order) || 0, skill.is_confirmed || false]
              );
            }
          }
        }
      } catch(e) {
        console.error('更新技能失败:', e);
      }
    }
    
    res.json({ success: true, weapon });
  } catch (e) {
    res.status(500).json({ error: '更新武器失败: ' + e.message });
  }
});

// DELETE /api/character-templates/weapons/:weaponId  删除武器（软删除）
router.delete('/:weaponId', async (req, res) => {
  try {
    const result = await query(
      'UPDATE weapons SET is_active=FALSE WHERE id=$1 RETURNING id',
      [req.params.weaponId]
    );
    if (!result.rows.length) return res.status(404).json({ error: '武器不存在' });
    // 解绑使用该武器的角色模板
    await query('UPDATE character_templates SET weapon_id=NULL WHERE weapon_id=$1', [req.params.weaponId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '删除武器失败: ' + e.message });
  }
});

// ===== 武器技能 API =====

// GET /api/character-templates/weapons/:weaponId/skills  获取武器的所有技能
router.get('/:weaponId/skills', async (req, res) => {
  try {
    const { weaponId } = req.params;
    console.log('获取武器技能, weaponId:', weaponId);
    const result = await query(
      'SELECT * FROM weapon_skills WHERE weapon_id=$1 ORDER BY sort_order, created_at',
      [weaponId]
    );
    console.log('从数据库获取到的技能:', result.rows);
    res.json({ skills: result.rows });
  } catch (e) {
    console.error('获取武器技能失败:', e);
    res.status(500).json({ error: '获取武器技能失败: ' + e.message });
  }
});

// POST /api/character-templates/weapons/:weaponId/skills  添加技能到武器
router.post('/:weaponId/skills', async (req, res) => {
  try {
    const { weaponId } = req.params;
    const { skill_name, effect_type, trigger_type, duration, sound_url, sort_order } = req.body;
    if (!skill_name) return res.status(400).json({ error: '技能名称不能为空' });
    
    const result = await query(
      `INSERT INTO weapon_skills (weapon_id, skill_name, effect_type, trigger_type, duration, sound_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [weaponId, skill_name, effect_type || 'none', trigger_type || 'manual',
       parseInt(duration) || 3000, sound_url || null, parseInt(sort_order) || 0]
    );
    res.json({ success: true, skill: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: '添加武器技能失败: ' + e.message });
  }
});

// PUT /api/character-templates/weapons/:weaponId/skills/:skillId  更新武器技能
router.put('/:weaponId/skills/:skillId', async (req, res) => {
  try {
    const { weaponId, skillId } = req.params;
    const existing = await query('SELECT * FROM weapon_skills WHERE id=$1 AND weapon_id=$2', [skillId, weaponId]);
    if (!existing.rows.length) return res.status(404).json({ error: '技能不存在' });
    
    const old = existing.rows[0];
    const { skill_name, effect_type, trigger_type, duration, sound_url, sort_order } = req.body;
    
    const result = await query(
      `UPDATE weapon_skills SET skill_name=$1, effect_type=$2, trigger_type=$3, duration=$4, sound_url=$5, sort_order=$6, updated_at=CURRENT_TIMESTAMP
       WHERE id=$7 RETURNING *`,
      [skill_name || old.skill_name, effect_type || old.effect_type, trigger_type || old.trigger_type,
       parseInt(duration) ?? old.duration, sound_url ?? old.sound_url, parseInt(sort_order) ?? old.sort_order, skillId]
    );
    res.json({ success: true, skill: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: '更新武器技能失败: ' + e.message });
  }
});

// DELETE /api/character-templates/weapons/:weaponId/skills/:skillId  删除武器技能
router.delete('/:weaponId/skills/:skillId', async (req, res) => {
  try {
    const { weaponId, skillId } = req.params;
    const result = await query(
      'DELETE FROM weapon_skills WHERE id=$1 AND weapon_id=$2 RETURNING id',
      [skillId, weaponId]
    );
    if (!result.rows.length) return res.status(404).json({ error: '技能不存在' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '删除武器技能失败: ' + e.message });
  }
});

// PUT /api/character-templates/weapons/:weaponId/skills/reorder  批量更新技能排序
router.put('/:weaponId/skills/reorder', async (req, res) => {
  try {
    const { weaponId } = req.params;
    const { skill_ids } = req.body;
    if (!Array.isArray(skill_ids)) {
      return res.status(400).json({ error: 'skill_ids 必须是数组' });
    }
    
    for (let i = 0; i < skill_ids.length; i++) {
      await query(
        'UPDATE weapon_skills SET sort_order=$1 WHERE id=$2 AND weapon_id=$3',
        [i, skill_ids[i], weaponId]
      );
    }
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '更新技能排序失败: ' + e.message });
  }
});

module.exports = router;
