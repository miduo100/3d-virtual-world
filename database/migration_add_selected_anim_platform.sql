-- migration_add_selected_anim_platform.sql
-- 为 character_templates 表添加 selected_anim_platform 字段
-- 用途：记录模板编辑时选择了哪个动作库平台（mixamo/hunyuan3d/makehuman/other），NULL 表示使用自定义动作

-- 添加字段：selected_anim_platform (动作库平台)
ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS selected_anim_platform VARCHAR(50) DEFAULT NULL;

-- 添加字段：anim_mode (动作模式: 'platform' 或 'custom')
ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS anim_mode VARCHAR(20) DEFAULT 'custom';

-- 可选：添加注释说明字段用途
COMMENT ON COLUMN character_templates.selected_anim_platform IS '模板选择的动作库平台: mixamo/hunyuan3d/makehuman/other/NULL';
COMMENT ON COLUMN character_templates.anim_mode IS '动作模式: platform(使用平台动作) 或 custom(使用自定义动作)';
