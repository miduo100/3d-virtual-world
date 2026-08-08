-- 创建系统配置表
CREATE TABLE IF NOT EXISTS system_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(255) UNIQUE NOT NULL,
  config_value TEXT,
  description TEXT,
  is_sensitive BOOLEAN DEFAULT FALSE,
  updated_by INTEGER,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config(config_key);

-- 插入默认配置项
INSERT INTO system_config (config_key, config_value, description, is_sensitive)
VALUES 
  ('TENCENT_SECRET_ID', '', '腾讯云 SecretId', true),
  ('TENCENT_SECRET_KEY', '', '腾讯云 SecretKey', true),
  ('TENCENT_REGION', 'ap-guangzhou', '腾讯云地域', false),
  ('HUNYUAN3D_ENABLED', 'false', '是否启用混元3D功能', false),
  ('HUNYUAN3D_DEFAULT_QUALITY', 'medium', '默认模型质量 (low/medium/high)', false),
  ('HUNYUAN3D_MAX_TASKS', '10', '最大并发任务数', false),
  ('subscription_price_cents', '300', '订阅单价（分）', false),
  ('subscription_first_auth_cents', '6000', '首次授权费（分）', false),
  ('subscription_first_auth_months', '2', '首次授权包含月数', false),
  ('subscription_reauth_after_months', '12', '断订多少个月后需重新授权', false)
ON CONFLICT (config_key) DO NOTHING;

-- 创建配置更新日志表
CREATE TABLE IF NOT EXISTS config_audit_log (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(255) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by INTEGER,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_config_audit_key ON config_audit_log(config_key);
CREATE INDEX IF NOT EXISTS idx_config_audit_time ON config_audit_log(changed_at DESC);
