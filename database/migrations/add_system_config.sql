-- 迁移：确保 system_config 表存在并补充管理字段
-- 用途：系统配置中心，支持敏感配置标记（is_sensitive）与操作审计（updated_by）
-- 说明：幂等脚本，表已存在时静默跳过，可安全重复执行
CREATE TABLE IF NOT EXISTS system_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(255) UNIQUE NOT NULL,
  config_value TEXT,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE system_config ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN DEFAULT FALSE;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS updated_by INTEGER;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
