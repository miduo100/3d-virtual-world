-- 迁移：ad_slots 表补充传送门/广告位相关字段
-- 用途：广告位支持跨世界传送门、深链、外部 URL 跳转
-- 说明：幂等脚本，列已存在时静默跳过，可安全重复执行
ALTER TABLE ad_slots ADD COLUMN IF NOT EXISTS portal_type VARCHAR(20) DEFAULT 'link';
ALTER TABLE ad_slots ADD COLUMN IF NOT EXISTS target_world_id VARCHAR(255);
ALTER TABLE ad_slots ADD COLUMN IF NOT EXISTS deep_link TEXT;
ALTER TABLE ad_slots ADD COLUMN IF NOT EXISTS target_url VARCHAR(500);
ALTER TABLE ad_slots ADD COLUMN IF NOT EXISTS target_world_url VARCHAR(500);
ALTER TABLE ad_slots ADD COLUMN IF NOT EXISTS target_world_name VARCHAR(200);
