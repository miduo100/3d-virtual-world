-- 清理重复的混元3D配置
-- 只保留统一的"腾讯混元（对话+3D）"

BEGIN;

-- 1. 删除独立的"腾讯混元3D"提供商（如果存在）
DELETE FROM ai_providers WHERE provider_name = 'tencent_hunyuan3d';

-- 2. 确保腾讯混元提供商已更新为多功能版本
UPDATE ai_providers 
SET 
  display_name = '腾讯混元（对话+3D）',
  provider_type = 'chat,image_to_3d',
  description = '腾讯混元大模型，支持AI对话、图片生3D模型、文字生成3D等多种功能',
  config_schema = '{
    "fields": [
      {"key": "secret_id", "label": "Secret ID", "type": "text", "required": true, "sensitive": true, "placeholder": "AKID开头的字符串"},
      {"key": "secret_key", "label": "Secret Key", "type": "password", "required": true, "sensitive": true, "placeholder": "32位字符串"},
      {"key": "region", "label": "地域", "type": "select", "required": true, "sensitive": false, "options": ["ap-guangzhou", "ap-shanghai", "ap-beijing"], "default": "ap-guangzhou"},
      {"key": "enable_chat", "label": "启用对话功能", "type": "checkbox", "required": false, "sensitive": false, "default": true},
      {"key": "enable_3d", "label": "启用3D生成功能", "type": "checkbox", "required": false, "sensitive": false, "default": true}
    ],
    "features": ["chat", "image_to_3d", "text_to_3d"]
  }'::jsonb,
  updated_at = CURRENT_TIMESTAMP
WHERE provider_name = 'tencent_hunyuan';

COMMIT;

-- 显示清理后的结果
SELECT 
  id,
  provider_name,
  display_name,
  provider_type,
  is_enabled
FROM ai_providers 
ORDER BY id;
