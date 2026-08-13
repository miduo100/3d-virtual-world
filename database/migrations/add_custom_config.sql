-- 迁移：world_objects 表补充 custom_config 列
-- 用途：世界对象自定义配置（JSONB）
-- 说明：幂等脚本，列已存在时静默跳过，可安全重复执行
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS custom_config JSONB DEFAULT NULL;
