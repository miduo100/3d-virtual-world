-- ============================================================
-- AI 音效生成服务商（provider_type = 'sfx'）—— 第二条链路：ElevenLabs SFX
--
-- 为什么加这一条：
--   豆包 Seed-Audio 1.0 的定位是「影视级声音场景」——一条 prompt 出来的是
--   人声 + 音乐 + 音效混在一起的成品音轨。做「一段环境铺底」很合适，
--   做「一条干净的脚步声/开门声」需要后期剪。
--   ElevenLabs SFX 是**专门的音效模型**：duration 0.5–30s、loop 无缝循环、
--   output_format 直接支持 mp3_22050_32（3 秒约 12KB，体积天然就小）。
--   两条并存，哪条好用走哪条（resolver 按 is_default / is_enabled 选，
--   也能在后台手动切）。
--
-- ⚠️ 商用授权：ElevenLabs **免费档输出需署名且不可商用**，
--   Starter ($5/月) 及以上才可商用。本项目要做订阅产品，必须确认走的是付费档。
--
-- 用法：迁移后到后台「AI 服务商 → 文字转音效」找到「ElevenLabs 音效生成」，
--      填 API Key（https://elevenlabs.io/app/settings/api-keys），启用即可。
-- ============================================================

INSERT INTO ai_providers
  (provider_name, display_name, provider_type, is_enabled, is_default, config_schema, description)
VALUES
  ('elevenlabs_sfx', 'ElevenLabs 音效生成', 'sfx', false, false,
   '{"fields": [
      {"key": "api_key", "label": "API Key", "type": "password", "required": true, "sensitive": true,
       "placeholder": "在 elevenlabs.io/app/settings/api-keys 获取"},
      {"key": "base_url", "label": "API地址", "type": "text", "required": false, "sensitive": false,
       "default": "https://api.elevenlabs.io/v1",
       "placeholder": "https://api.elevenlabs.io/v1"},
      {"key": "api_path", "label": "接口路径", "type": "text", "required": false, "sensitive": false,
       "default": "/sound-generation",
       "placeholder": "/sound-generation"},
      {"key": "auth_mode", "label": "鉴权方式", "type": "select", "required": false, "sensitive": false,
       "options": ["xi-api-key", "x-api-key", "bearer"], "default": "xi-api-key"},
      {"key": "model_id", "label": "模型", "type": "select", "required": false, "sensitive": false,
       "options": ["eleven_text_to_sound_v2", "eleven_text_to_sound_v3"],
       "default": "eleven_text_to_sound_v3"},
      {"key": "output_format", "label": "输出格式", "type": "select", "required": false, "sensitive": false,
       "options": ["mp3_22050_32", "mp3_44100_32", "mp3_44100_64", "mp3_44100_128", "pcm_44100"],
       "default": "mp3_22050_32",
       "description": "mp3_22050_32 体积最小（3 秒约 12KB），mp3_44100_128 音质最好但体积大 4 倍"}
    ]}'::jsonb,
   'ElevenLabs 音效生成模型：专注文生短音效，支持 0.5-30 秒时长控制、无缝循环开关、可指定低码率输出。音质公认第一档。注意免费档输出需署名且不可商用，商用需 Starter 及以上订阅。')
ON CONFLICT (provider_name) DO UPDATE
  SET config_schema = EXCLUDED.config_schema;
-- ⚠️ 只更新 config_schema（字段声明），**不碰** ai_provider_configs 里的密钥。
