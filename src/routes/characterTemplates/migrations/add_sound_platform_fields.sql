-- 迁移：为 animation_library 表添加缺失的字段
-- 支持多平台动作库和音效功能

-- 添加平台相关字段
ALTER TABLE animation_library ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'mixamo';
ALTER TABLE animation_library ADD COLUMN IF NOT EXISTS platform_name VARCHAR(100);

-- 添加音效相关字段
ALTER TABLE animation_library ADD COLUMN IF NOT EXISTS sound_url TEXT DEFAULT NULL;
ALTER TABLE animation_library ADD COLUMN IF NOT EXISTS sound_name VARCHAR(255) DEFAULT NULL;

-- 设置默认值
UPDATE animation_library SET platform = 'mixamo' WHERE platform IS NULL;
UPDATE animation_library SET platform_name = 'Mixamo' WHERE platform_name IS NULL AND platform = 'mixamo';
UPDATE animation_library SET platform_name = '腾讯混元3D' WHERE platform_name IS NULL AND platform = 'hunyuan3d';
UPDATE animation_library SET platform_name = 'MakeHuman' WHERE platform_name IS NULL AND platform = 'makehuman';
UPDATE animation_library SET platform_name = '其他平台' WHERE platform_name IS NULL AND platform = 'other';

-- 添加非空约束（对于已有数据）
ALTER TABLE animation_library ALTER COLUMN platform SET NOT NULL;
ALTER TABLE animation_library ALTER COLUMN platform_name SET NOT NULL;

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_animation_library_platform ON animation_library(platform);
CREATE INDEX IF NOT EXISTS idx_animation_library_anim_key ON animation_library(anim_key);
CREATE INDEX IF NOT EXISTS idx_animation_library_is_active ON animation_library(is_active);
