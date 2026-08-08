-- 将旧的 system_config 表中的腾讯混元配置迁移到新的 ai_providers 系统
-- 2025-02-13

BEGIN;

-- 1. 确保腾讯混元提供商存在
INSERT INTO ai_providers (
  provider_name, 
  display_name, 
  provider_type, 
  is_enabled, 
  is_default, 
  config_schema, 
  description
) VALUES (
  'tencent_hunyuan',
  '腾讯混元（对话+3D）',
  'chat,image_to_3d',
  true,
  true,
  '{
    "fields": [
      {"key": "secret_id", "label": "Secret ID", "type": "text", "required": true, "sensitive": true, "placeholder": "AKID开头的字符串"},
      {"key": "secret_key", "label": "Secret Key", "type": "password", "required": true, "sensitive": true, "placeholder": "32位字符串"},
      {"key": "region", "label": "地域", "type": "select", "required": true, "sensitive": false, "options": ["ap-guangzhou", "ap-shanghai", "ap-beijing"], "default": "ap-guangzhou"},
      {"key": "enable_chat", "label": "启用对话功能", "type": "checkbox", "required": false, "sensitive": false, "default": true},
      {"key": "enable_3d", "label": "启用3D生成功能", "type": "checkbox", "required": false, "sensitive": false, "default": true}
    ],
    "features": ["chat", "image_to_3d", "text_to_3d"]
  }'::jsonb,
  '腾讯混元大模型，支持AI对话、图片生3D模型、文字生成3D等多种功能'
)
ON CONFLICT (provider_name) 
DO UPDATE SET 
  display_name = EXCLUDED.display_name,
  provider_type = EXCLUDED.provider_type,
  config_schema = EXCLUDED.config_schema,
  description = EXCLUDED.description,
  updated_at = CURRENT_TIMESTAMP;

-- 2. 迁移 TENCENT_SECRET_ID
INSERT INTO ai_provider_configs (provider_id, config_key, config_value, is_sensitive)
SELECT 
  (SELECT id FROM ai_providers WHERE provider_name = 'tencent_hunyuan'),
  'secret_id',
  config_value,
  true
FROM system_config 
WHERE config_key = 'TENCENT_SECRET_ID' AND config_value IS NOT NULL
ON CONFLICT (provider_id, config_key) 
DO UPDATE SET 
  config_value = EXCLUDED.config_value,
  updated_at = CURRENT_TIMESTAMP;

-- 3. 迁移 TENCENT_SECRET_KEY
INSERT INTO ai_provider_configs (provider_id, config_key, config_value, is_sensitive)
SELECT 
  (SELECT id FROM ai_providers WHERE provider_name = 'tencent_hunyuan'),
  'secret_key',
  config_value,
  true
FROM system_config 
WHERE config_key = 'TENCENT_SECRET_KEY' AND config_value IS NOT NULL
ON CONFLICT (provider_id, config_key) 
DO UPDATE SET 
  config_value = EXCLUDED.config_value,
  updated_at = CURRENT_TIMESTAMP;

-- 4. 迁移 TENCENT_REGION（如果有）
INSERT INTO ai_provider_configs (provider_id, config_key, config_value, is_sensitive)
SELECT 
  (SELECT id FROM ai_providers WHERE provider_name = 'tencent_hunyuan'),
  'region',
  COALESCE(config_value, 'ap-guangzhou'),
  false
FROM system_config 
WHERE config_key = 'TENCENT_REGION'
ON CONFLICT (provider_id, config_key) 
DO UPDATE SET 
  config_value = EXCLUDED.config_value,
  updated_at = CURRENT_TIMESTAMP;

-- 如果没有 TENCENT_REGION，使用默认值
INSERT INTO ai_provider_configs (provider_id, config_key, config_value, is_sensitive)
SELECT 
  (SELECT id FROM ai_providers WHERE provider_name = 'tencent_hunyuan'),
  'region',
  'ap-guangzhou',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM system_config WHERE config_key = 'TENCENT_REGION'
)
ON CONFLICT (provider_id, config_key) DO NOTHING;

-- 5. 设置默认功能开关（都启用）
INSERT INTO ai_provider_configs (provider_id, config_key, config_value, is_sensitive)
VALUES 
  ((SELECT id FROM ai_providers WHERE provider_name = 'tencent_hunyuan'), 'enable_chat', 'true', false),
  ((SELECT id FROM ai_providers WHERE provider_name = 'tencent_hunyuan'), 'enable_3d', 'true', false)
ON CONFLICT (provider_id, config_key) DO NOTHING;

-- 6. 删除独立的混元3D（如果之前创建过）
DELETE FROM ai_providers WHERE provider_name = 'tencent_hunyuan3d';

COMMIT;

-- 查看迁移结果
SELECT 
  p.id,
  p.provider_name,
  p.display_name,
  p.is_enabled,
  c.config_key,
  CASE 
    WHEN c.is_sensitive THEN '******** (已加密)'
    ELSE c.config_value 
  END as config_value
FROM ai_providers p
LEFT JOIN ai_provider_configs c ON p.id = c.provider_id
WHERE p.provider_name = 'tencent_hunyuan'
ORDER BY p.id, c.config_key;
