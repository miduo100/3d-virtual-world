-- 更新通义千问模型列表，添加更多模型选项
-- 执行方法: 在数据库中直接运行此SQL

UPDATE ai_providers 
SET config_schema = '{
  "fields": [
    {
      "key": "api_key",
      "label": "API Key",
      "type": "password",
      "required": true,
      "sensitive": true,
      "placeholder": "sk-xxxxxxxxxxxxxxxx"
    },
    {
      "key": "endpoint",
      "label": "API地址",
      "type": "text",
      "required": true,
      "sensitive": false,
      "default": "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
    },
    {
      "key": "model",
      "label": "模型",
      "type": "select",
      "required": true,
      "sensitive": false,
      "options": [
        "qwen-max",
        "qwen-max-0428",
        "qwen-max-0403",
        "qwen-max-0107",
        "qwen-max-longcontext",
        "qwen-plus",
        "qwen-plus-latest",
        "qwen-plus-0806",
        "qwen-turbo",
        "qwen-turbo-latest",
        "qwen-long",
        "qwen-vl-max",
        "qwen-vl-plus",
        "qwen-math-plus",
        "qwen-math-turbo",
        "qwen-coder-turbo",
        "qwen2.5-72b-instruct",
        "qwen2.5-32b-instruct",
        "qwen2.5-14b-instruct",
        "qwen2.5-7b-instruct"
      ],
      "default": "qwen-plus"
    }
  ]
}'::jsonb
WHERE provider_name = 'aliyun_qianwen';

-- 验证更新
SELECT 
  provider_name,
  display_name,
  (config_schema->'fields'->2->>'options')::jsonb AS model_options
FROM ai_providers
WHERE provider_name = 'aliyun_qianwen';
