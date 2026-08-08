-- 动作库多平台支持迁移脚本
-- 为 animation_library 表添加平台分类字段

-- 1. 添加平台字段
ALTER TABLE animation_library 
ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'mixamo',
ADD COLUMN IF NOT EXISTS platform_name VARCHAR(100) DEFAULT 'Mixamo';

-- 2. 创建索引
CREATE INDEX IF NOT EXISTS idx_anim_lib_platform ON animation_library(platform);

-- 3. 更新现有数据为 Mixamo 平台
UPDATE animation_library SET platform = 'mixamo', platform_name = 'Mixamo' WHERE platform IS NULL OR platform = '';

-- 4. 预置平台数据（用于平台管理功能）
CREATE TABLE IF NOT EXISTS animation_platforms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  logo VARCHAR(50) DEFAULT '🎬',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. 插入默认平台
INSERT INTO animation_platforms (platform, display_name, description, logo, sort_order) VALUES
  ('mixamo', 'Mixamo 动作库', 'Adobe Mixamo 动作库，使用 Mixamo Rig骨骼绑定', '🎬', 10),
  ('hunyuan3d', '腾讯混元3D 动作库', '腾讯混元3D 生成的角色动作库', '🤖', 20),
  ('makehuman', 'MakeHuman 动作库', 'MakeHuman 角色的动作库', '🎭', 30),
  ('other', '其他平台动作库', '其他平台或自定义的动作库', '➕', 100)
ON CONFLICT (platform) DO NOTHING;

-- 6. 预置 Mixamo 动作库示例数据（需要手动上传实际文件）
-- 注意：实际使用时，需要先上传 FBX/GLB 文件到 uploads/anim-library/ 目录
-- 然后再运行以下 SQL 更新 glb_url 字段

-- 示例：更新 Mixamo 待机动作
-- UPDATE animation_library SET glb_url = '/uploads/anim-library/mixamo_idle.fbx' WHERE anim_key = 'idle' AND platform = 'mixamo';

SELECT '✅ 动作库多平台迁移完成！' as status;
