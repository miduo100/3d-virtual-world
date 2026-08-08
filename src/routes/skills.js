/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');

// Add skill to character
router.post('/add', async (req, res) => {
  try {
    const { characterId, skillName, triggerText, effectType, effectDuration, effectPower, rangeDistance } = req.body;

    const skillId = uuidv4();
    await query(
      `INSERT INTO skills (id, character_id, skill_name, trigger_text, effect_type, effect_duration, effect_power, range_distance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [skillId, characterId, skillName, triggerText, effectType, effectDuration, effectPower, rangeDistance]
    );

    res.json({ message: 'Skill added', skillId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add skill' });
  }
});

// Get character skills
router.get('/character/:characterId', async (req, res) => {
  try {
    const { characterId } = req.params;

    const result = await query(
      'SELECT * FROM skills WHERE character_id = $1',
      [characterId]
    );

    res.json({ skills: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// Trigger skill (voice input matched)
router.post('/trigger', async (req, res) => {
  try {
    const { characterId, triggerText } = req.body;

    // Find matching skill
    const result = await query(
      `SELECT * FROM skills 
       WHERE character_id = $1 AND trigger_text = $2`,
      [characterId, triggerText]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ error: 'Skill not found', message: 'No matching skill found for trigger text' });
    }

    const skill = result.rows[0];

    // Apply skill effect
    const effect = {
      skillId: skill.id,
      effectType: skill.effect_type,
      effectPower: skill.effect_power,
      duration: skill.effect_duration,
      range: skill.range_distance,
      triggeredAt: new Date(),
    };

    res.json({
      message: 'Skill triggered',
      effect,
      skill,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to trigger skill' });
  }
});

// Delete skill
router.delete('/:skillId', async (req, res) => {
  try {
    const { skillId } = req.params;
    const result = await query('DELETE FROM skills WHERE id = $1 RETURNING id', [skillId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json({ success: true, message: 'Skill deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

module.exports = router;
