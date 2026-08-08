/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * characterTemplates 数据库初始化模块
 * 包含：数据表创建、迁移和初始化逻辑
 */

const { query } = require('../../database/db');

// ===== 初始化数据表（首次调用时自动建表）=====
async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS character_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      description TEXT,
      glb_url TEXT,
      glb_hash TEXT,
      thumbnail_url TEXT,
      anim_walk_url TEXT,
      anim_run_url TEXT,
      access_level VARCHAR(20) DEFAULT 'public',
      character_role VARCHAR(20) DEFAULT 'player',
      is_active BOOLEAN DEFAULT TRUE,
      is_default BOOLEAN DEFAULT FALSE,
      sort_order INT DEFAULT 0,
      created_by_admin_id INTEGER,
      created_by_name VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // 迁移：补充所有动画字段（MVP 9个基础动作）
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_idle_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_walk_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_run_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_jump_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_attack1_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_hit_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_death_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_attack2_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_attack3_url TEXT');
  // 迁移：扩展动画字段（转身、攻击变体、收/拔剑）
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_turn_left_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_turn_right_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_attack_stab_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_attack_slash_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_attack_swing_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_attack_uppercut_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_sheath_url TEXT');
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_draw_sword_url TEXT');
  // ===== 武器库表 =====
  await query(`
    CREATE TABLE IF NOT EXISTS weapons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      weapon_type VARCHAR(30) DEFAULT 'builtin_lightsaber',
      glb_url TEXT,
      config JSONB DEFAULT '{}'::jsonb,
      default_effect VARCHAR(30) DEFAULT 'none',
      is_active BOOLEAN DEFAULT TRUE,
      sort_order INT DEFAULT 0,
      created_by_admin_id INTEGER,
      created_by_name VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // 迁移：添加武器初始特效字段
  await query('ALTER TABLE weapons ADD COLUMN IF NOT EXISTS default_effect VARCHAR(30) DEFAULT \'none\'');
  // ===== 武器技能表 =====
  await query(`
    CREATE TABLE IF NOT EXISTS weapon_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      weapon_id UUID NOT NULL REFERENCES weapons(id) ON DELETE CASCADE,
      skill_name VARCHAR(100) NOT NULL,
      effect_type VARCHAR(30) DEFAULT 'none',
      trigger_type VARCHAR(30) DEFAULT 'manual',
      duration INT DEFAULT 3000,
      sound_url TEXT,
      sort_order INT DEFAULT 0,
      is_confirmed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // 迁移：添加技能确认状态字段
  await query('ALTER TABLE weapon_skills ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN DEFAULT FALSE');
  // character_templates 绑定武器（可为空=无武器）
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS weapon_id UUID REFERENCES weapons(id) ON DELETE SET NULL');
  // 旧的 weapon_config JSONB 字段保留兼容（不删除）
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS weapon_config JSONB DEFAULT \'{}\'::jsonb');
  // 骨骼映射：存储用户手动标记的骨骼名称，如 { root: "mixamorigHips", rightHand: "mixamorigRightHand" }
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS bone_map JSONB DEFAULT \'{}\'::jsonb');
  // 模型适配配置：存储用户配置的模型适配参数
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS fit_config JSONB DEFAULT \'{}\'::jsonb');
  // 校准配置：存储模型校准参数
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS calibration_config JSONB DEFAULT \'{}\'::jsonb');
  // 武器插槽配置：存储武器挂载点配置
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS weapon_socket_config JSONB DEFAULT \'{}\'::jsonb');
  // 骨骼映射配置：存储骨骼映射关系
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS bone_mapping_config JSONB DEFAULT \'{}\'::jsonb');
  // 校准状态：标识是否已完成校准
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS is_calibrated BOOLEAN DEFAULT FALSE');
  // 校准时间：记录校准完成时间
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS calibrated_at TIMESTAMP');
  // 校准版本：用于后续迁移
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS calibration_version INTEGER DEFAULT 1');

  await query(`
    CREATE TABLE IF NOT EXISTS template_skills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id UUID NOT NULL REFERENCES character_templates(id) ON DELETE CASCADE,
      skill_name VARCHAR(100) NOT NULL,
      trigger_text VARCHAR(255),
      skill_type VARCHAR(30) DEFAULT 'attack',
      skill_scope VARCHAR(20) DEFAULT 'portable',
      animation_clip VARCHAR(100),
      anim_glb_url TEXT,
      effect_type VARCHAR(50) DEFAULT 'AOE_DAMAGE',
      effect_power INT DEFAULT 0,
      range_distance INT DEFAULT 5,
      effect_duration INT DEFAULT 1000,
      cooldown INT DEFAULT 3000,
      particle_effect VARCHAR(100),
      icon_emoji VARCHAR(10) DEFAULT '⚡',
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // 迁移：老技能表补充 anim_glb_url 列
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS anim_glb_url TEXT');
  // 迁移：技能触发武器特效字段（新架构：预设包+自定义）
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_preset VARCHAR(30) DEFAULT \'none\'');
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_color VARCHAR(20) DEFAULT NULL');
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_glow FLOAT DEFAULT NULL');
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_particle VARCHAR(30) DEFAULT NULL');
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_duration INT DEFAULT 2000');
  // 兼容旧字段（保留，不删除）
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_blade_color VARCHAR(20) DEFAULT NULL');
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_glow_intensity FLOAT DEFAULT NULL');
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_particle_type VARCHAR(30) DEFAULT \'none\'');
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_duration_legacy INT DEFAULT 2000');
  await query(`
    CREATE TABLE IF NOT EXISTS world_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pvp_enabled BOOLEAN DEFAULT FALSE,
      pve_enabled BOOLEAN DEFAULT TRUE,
      allow_foreign_attack BOOLEAN DEFAULT FALSE,
      damage_multiplier FLOAT DEFAULT 1.0,
      allow_skill_types TEXT[] DEFAULT ARRAY['perform','build'],
      max_foreign_level INT DEFAULT 999,
      respawn_enabled BOOLEAN DEFAULT TRUE,
      friendly_fire BOOLEAN DEFAULT FALSE,
      world_type VARCHAR(30) DEFAULT 'normal',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // 动作库表
  await query(`
    CREATE TABLE IF NOT EXISTS animation_library (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      anim_key VARCHAR(50) NOT NULL,
      glb_url TEXT NOT NULL,
      glb_hash TEXT,
      label VARCHAR(100),
      description TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      sort_order INT DEFAULT 0,
      created_by_admin_id INTEGER,
      created_by_name VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // character_templates 增加 anim_set 字段（JSONB，存 {anim_key: animation_library_id}）
  await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_set JSONB DEFAULT \'{}\'::jsonb');
  // animation_library 表字段补全（兼容旧表缺列）
  const animLibCols = [
    'is_active BOOLEAN DEFAULT TRUE', 'sort_order INT DEFAULT 0',
    'label VARCHAR(100)', 'description TEXT', 'glb_hash TEXT',
    'created_by_admin_id INTEGER', 'created_by_name VARCHAR(100)',
    'platform VARCHAR(50)', 'platform_name VARCHAR(100)',
    'sound_url TEXT', 'sound_name VARCHAR(255)'
  ];
  for (const colDef of animLibCols) {
    const colName = colDef.split(' ')[0];
    await query('ALTER TABLE animation_library ADD COLUMN IF NOT EXISTS ' + colName + ' ' + colDef.slice(colName.length).trim()).catch(() => {});
  }
  // 为 platform 字段设置默认值
  await query("UPDATE animation_library SET platform = 'mixamo' WHERE platform IS NULL").catch(() => {});

  // 迁移：将旧的 created_by(UUID/INTEGER + 外键) 替换为无约束的两个新列
  try {
    const colInfo = await query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'character_templates' AND column_name IN ('created_by','created_by_admin_id')
    `);
    const cols = colInfo.rows.map(r => r.column_name);
    if (cols.includes('created_by') && !cols.includes('created_by_admin_id')) {
      // 删除外键约束
      await query('ALTER TABLE character_templates DROP CONSTRAINT IF EXISTS character_templates_created_by_fkey');
      // 添加新列
      await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS created_by_admin_id INTEGER');
      await query('ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS created_by_name VARCHAR(100)');
      // 删除旧列
      await query('ALTER TABLE character_templates DROP COLUMN IF EXISTS created_by');
      console.log('[character-templates] created_by 列迁移完成');
    }
  } catch (e) {
    console.warn('[character-templates] 迁移 created_by 列失败（可忽略）:', e.message);
  }

  // ===== 声音系统迁移 =====
  // character_templates: 动作音效 + 武器常态音效
  await query("ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_sounds JSONB DEFAULT '{}'::jsonb");
  await query("ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS weapon_sounds JSONB DEFAULT '{}'::jsonb");
  // template_skills: 技能激发音效
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_sound_url TEXT DEFAULT NULL');
  await query('ALTER TABLE template_skills ADD COLUMN IF NOT EXISTS fx_sound_volume FLOAT DEFAULT 0.8');

  // 确保有默认世界规则
  const existing = await query('SELECT id FROM world_rules LIMIT 1');
  if (existing.rows.length === 0) {
    await query(`
      INSERT INTO world_rules (world_type, pvp_enabled, pve_enabled, allow_foreign_attack, damage_multiplier, allow_skill_types)
      VALUES ('normal', FALSE, TRUE, FALSE, 1.0, ARRAY['perform','build'])
    `);
  }
}

module.exports = {
  ensureTables
};
