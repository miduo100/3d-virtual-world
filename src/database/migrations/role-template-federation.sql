-- 角色模板跨世界传输功能数据库迁移脚本
-- 版本: 1.0
-- 日期: 2024-01-01
-- 描述: 添加角色模板资源引用、骨骼映射和动画适配相关的字段和表

-- 1. 增强角色模板表，添加联邦引用相关字段
ALTER TABLE character_templates 
ADD COLUMN IF NOT EXISTS is_federated BOOLEAN DEFAULT FALSE; -- 是否是联邦引用的模板
ALTER TABLE character_templates 
ADD COLUMN IF NOT EXISTS source_world_id VARCHAR(100); -- 源世界ID
ALTER TABLE character_templates 
ADD COLUMN IF NOT EXISTS source_template_id VARCHAR(100); -- 源世界模板ID
ALTER TABLE character_templates 
ADD COLUMN IF NOT EXISTS resource_urls JSONB DEFAULT '{}'::jsonb; -- 资源URL引用
ALTER TABLE character_templates 
ADD COLUMN IF NOT EXISTS bone_map JSONB DEFAULT '{}'::jsonb; -- 骨骼映射
ALTER TABLE character_templates 
ADD COLUMN IF NOT EXISTS anim_adapt JSONB DEFAULT '{}'::jsonb; -- 动画适配
ALTER TABLE character_templates 
ADD COLUMN IF NOT EXISTS last_sync_time TIMESTAMP; -- 最后同步时间

-- 2. 新增联邦模板管理表
CREATE TABLE IF NOT EXISTS federation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- 允许为null
  source_world_id VARCHAR(100) NOT NULL,
  source_template_id VARCHAR(100) NOT NULL,
  local_template_id VARCHAR(100) NOT NULL, -- B世界中的本地模板ID
  template_data JSONB, -- 角色模板配置数据
  resource_urls JSONB DEFAULT '{}'::jsonb, -- 资源URL引用
  bone_map JSONB DEFAULT '{}'::jsonb, -- 骨骼映射
  anim_adapt JSONB DEFAULT '{}'::jsonb, -- 动画适配
  is_active BOOLEAN DEFAULT FALSE, -- 是否是当前激活的模板
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, source_world_id, source_template_id)
);

-- 3. 新增资源引用管理表
CREATE TABLE IF NOT EXISTS resource_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL, -- model, animation, sound, texture
  resource_url TEXT NOT NULL, -- 资源访问URL
  resource_hash VARCHAR(64), -- 资源哈希值（用于验证）
  file_size INT, -- 文件大小（估算）
  format VARCHAR(20), -- 文件格式
  quality_level VARCHAR(20) DEFAULT 'high', -- 质量等级
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (template_id, resource_type)
);

-- 4. 新增骨骼绑定配置表
CREATE TABLE IF NOT EXISTS bone_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id VARCHAR(100) NOT NULL,
  source_bone_name VARCHAR(100) NOT NULL,
  target_bone_name VARCHAR(100) NOT NULL,
  confidence_score FLOAT DEFAULT 1.0, -- 匹配置信度
  auto_mapped BOOLEAN DEFAULT TRUE, -- 是否自动映射
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (template_id, source_bone_name)
);

-- 5. 为federation_templates表添加索引
CREATE INDEX IF NOT EXISTS idx_federation_templates_user 
ON federation_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_federation_templates_source 
ON federation_templates(source_world_id, source_template_id);
CREATE INDEX IF NOT EXISTS idx_federation_templates_active 
ON federation_templates(is_active);

-- 6. 为resource_references表添加索引
CREATE INDEX IF NOT EXISTS idx_resource_references_template 
ON resource_references(template_id);
CREATE INDEX IF NOT EXISTS idx_resource_references_type 
ON resource_references(resource_type);

-- 7. 为bone_mappings表添加索引
CREATE INDEX IF NOT EXISTS idx_bone_mappings_template 
ON bone_mappings(template_id);
CREATE INDEX IF NOT EXISTS idx_bone_mappings_source 
ON bone_mappings(template_id, source_bone_name);

-- 8. 为character_templates表添加联邦模板相关索引
CREATE INDEX IF NOT EXISTS idx_character_templates_federated 
ON character_templates(is_federated);
CREATE INDEX IF NOT EXISTS idx_character_templates_source 
ON character_templates(source_world_id, source_template_id);

-- 9. 跳过权限设置（authenticated角色不存在于当前环境）

-- 10. 插入初始数据（可选）
-- 如果需要，可以在这里插入一些默认的骨骼映射配置
-- 例如：默认的Mixamo骨骼到通用骨骼的映射

-- 迁移完成
SELECT '角色模板跨世界传输功能数据库迁移完成' AS status;
SELECT '新增字段: character_templates.is_federated, source_world_id, source_template_id, resource_urls, bone_map, anim_adapt, last_sync_time' AS changes;
SELECT '新增表: federation_templates, resource_references, bone_mappings' AS tables;
