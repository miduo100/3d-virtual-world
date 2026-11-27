-- ============================================================
-- AI 音效生成服务商（provider_type = 'sfx'）
--
-- 用途：给「音效库 → AI 生成声音」分区提供文生音效能力。
--
-- 关键设计（踩过的坑，别改错）：
--   火山引擎有**两套独立服务**，密钥不能混用：
--     · 火山方舟 Ark   ark.cn-beijing.volces.com/api/v3   → 对话/文本生成
--     · 豆包语音控制台 openspeech.bytedance.com/api/v3   → 音频生成（seed-audio-1.0）
--   现有 bytedance_doubao 用的是 Ark 的 Key，拿去 openspeech 会 401
--   （错误码 45000010 Invalid X-Api-Key）。所以这里单开一条 provider。
--
-- 用法：迁移后到后台「AI 服务商」页找到「豆包音频生成」，
--      填入【豆包语音控制台】的 API Key（不是方舟的），启用即可。
--      Key 从这里拿：https://console.volcengine.com/speech/new/setting/apikeys
--      同时确认 seed-audio-1.0 权限已开通（否则 403/404）。
--
-- 密钥留空是有意的：用户自己在后台填，不写进仓库。
-- ============================================================

INSERT INTO ai_providers
  (provider_name, display_name, provider_type, is_enabled, is_default, config_schema, description)
VALUES
  ('doubao_seed_audio', '豆包音频生成', 'sfx', false, false,
   '{"fields": [
      {"key": "api_key", "label": "API Key（豆包语音控制台）", "type": "password", "required": true, "sensitive": true,
       "placeholder": "从 console.volcengine.com/speech 新版控制台获取的 Key，不是方舟的 Key"},
      {"key": "base_url", "label": "API地址", "type": "text", "required": false, "sensitive": false,
       "default": "https://openspeech.bytedance.com/api/v3",
       "placeholder": "https://openspeech.bytedance.com/api/v3"},
      {"key": "model", "label": "模型", "type": "select", "required": true, "sensitive": false,
       "options": ["seed-audio-1.0"], "default": "seed-audio-1.0"},
      {"key": "sample_rate", "label": "采样率", "type": "select", "required": false, "sensitive": false,
       "options": ["24000", "32000", "44100", "48000"], "default": "44100"},
      {"key": "format", "label": "输出格式", "type": "select", "required": false, "sensitive": false,
       "options": ["mp3", "wav", "pcm", "ogg_opus"], "default": "mp3"},
      {"key": "auth_mode", "label": "鉴权方式", "type": "select", "required": false, "sensitive": false,
       "options": ["x-api-key", "bearer"], "default": "x-api-key",
       "description": "豆包语音用 x-api-key；火山方舟用 bearer。留空则按 API 地址自动判断。"}
    ]}'::jsonb,
   '豆包音频生成模型（Seed-Audio 1.0）：按提示词生成音效/环境声/声音场景。支持文本、参考音频、参考图片输入，单次最长 120 秒。需在豆包语音控制台单独开通权限。')
ON CONFLICT (provider_name) DO UPDATE
  SET config_schema = EXCLUDED.config_schema;
-- ⚠️ 只更新 config_schema（字段声明），**不碰** ai_provider_configs 里的密钥 ——
--   用户已经填进去的 api_key 不能被迁移脚本冲掉。
