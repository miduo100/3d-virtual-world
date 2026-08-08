-- ============================================================
-- 迁移脚本：添加 model_source_platform 字段
-- 用途：记录角色模板模型的来源平台，用于骨骼适配
-- 日期：2026-05-15
-- ============================================================

-- 检查字段是否已存在
DO $$
BEGIN
    -- 尝试添加字段（PostgreSQL 11+ 支持 IF NOT EXISTS）
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'character_templates' 
        AND column_name = 'model_source_platform'
    ) THEN
        ALTER TABLE character_templates 
        ADD COLUMN model_source_platform VARCHAR(30) DEFAULT NULL
        COMMENT '模型来源平台(mixamo/rpm/vroid/blender/hunyuan3d/tripo/makehuman/manual)';
        
        RAISE NOTICE '字段 model_source_platform 已成功添加';
    ELSE
        RAISE NOTICE '字段 model_source_platform 已存在，跳过添加';
    END IF;
END $$;

-- ============================================================
-- 可选：为现有模板设置默认值（基于骨骼名称猜测平台）
-- 注意：此查询会尝试根据现有模型的 bone_mapping_config 内容推断平台
-- ============================================================

-- 尝试为已有模板填充平台信息（基于 bone_mapping_config 中的骨骼名特征）
UPDATE character_templates 
SET model_source_platform = 
    CASE 
        -- Mixamo 骨骼名包含 mixamorig
        WHEN bone_mapping_config::text LIKE '%mixamorig%' THEN 'mixamo'
        -- VRoid 骨骼名包含 J_Bip_
        WHEN bone_mapping_config::text LIKE '%J_Bip_%' THEN 'vroid'
        -- ReadyPlayerMe 通常包含 Spine1/Spine2
        WHEN bone_mapping_config::text LIKE '%"Spine1"%' OR bone_mapping_config::text LIKE '%"Spine2"%' THEN 'rpm'
        -- MakeHuman 骨骼名包含 mh_
        WHEN bone_mapping_config::text LIKE '%mh_%' THEN 'makehuman'
        -- 其他保持 NULL，需要用户手动设置
        ELSE model_source_platform
    END
WHERE model_source_platform IS NULL 
  AND bone_mapping_config IS NOT NULL
  AND bone_mapping_config::text != '{}'
  AND bone_mapping_config::text != 'null';

-- ============================================================
-- 验证迁移结果
-- ============================================================

-- 检查表结构
SELECT 
    column_name, 
    data_type, 
    character_maximum_length, 
    column_default, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'character_templates' 
AND column_name = 'model_source_platform';

-- 统计各平台的模板数量
SELECT 
    COALESCE(model_source_platform, '(未设置)') as platform,
    COUNT(*) as template_count
FROM character_templates 
GROUP BY model_source_platform 
ORDER BY template_count DESC;
