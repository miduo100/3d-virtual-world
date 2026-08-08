-- AI场景保存表初始化脚本

-- 创建 ai_generated_scenes 表
CREATE TABLE IF NOT EXISTS ai_generated_scenes (
  id SERIAL PRIMARY KEY,
  scene_name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  scene_type VARCHAR(50),
  scene_config JSONB NOT NULL,
  layout_data JSONB NOT NULL,
  object_count INTEGER DEFAULT 0,
  ai_provider VARCHAR(50),
  user_id INTEGER,
  is_public BOOLEAN DEFAULT false,
  view_count INTEGER DEFAULT 0,
  thumbnail_url VARCHAR(500),
  tags TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_ai_scenes_user_id ON ai_generated_scenes(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_scenes_scene_type ON ai_generated_scenes(scene_type);
CREATE INDEX IF NOT EXISTS idx_ai_scenes_is_public ON ai_generated_scenes(is_public);
CREATE INDEX IF NOT EXISTS idx_ai_scenes_created_at ON ai_generated_scenes(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_scenes_tags ON ai_generated_scenes USING GIN(tags);

-- 创建场景收藏表
CREATE TABLE IF NOT EXISTS ai_scene_favorites (
  id SERIAL PRIMARY KEY,
  scene_id INTEGER REFERENCES ai_generated_scenes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scene_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_scene_favorites_user_id ON ai_scene_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_scene_favorites_scene_id ON ai_scene_favorites(scene_id);

-- 添加更新时间自动更新触发器
CREATE OR REPLACE FUNCTION update_ai_scenes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ai_scenes_updated_at
BEFORE UPDATE ON ai_generated_scenes
FOR EACH ROW
EXECUTE FUNCTION update_ai_scenes_updated_at();

-- 插入一些示例场景
INSERT INTO ai_generated_scenes (scene_name, description, scene_type, scene_config, layout_data, object_count, ai_provider, is_public, tags)
VALUES 
(
  '温馨小村庄',
  '一个漂亮的村子，有几座山、茅草屋、树木和小动物',
  'village',
  '{"scene_type":"village","environment":{"terrain":"hills","time":"day","weather":"clear"},"objects":[{"type":"mountain","count":3,"properties":{"size":"medium"}},{"type":"cottage","count":5,"properties":{"size":"small"}},{"type":"tree","count":10,"properties":{"size":"varied"}},{"type":"hen","count":2,"properties":{"size":"small"}},{"type":"cat","count":1,"properties":{"size":"small"}}]}'::jsonb,
  '[]'::jsonb,
  21,
  'default',
  true,
  ARRAY['村庄', '温馨', '示例']
),
(
  '现代化都市',
  '繁华的城市场景，高楼大厦林立，街道上车水马龙',
  'city',
  '{"scene_type":"city","environment":{"terrain":"flat","time":"night","weather":"clear"},"objects":[{"type":"skyscraper","count":12,"properties":{"size":"varied"}},{"type":"lamp","count":20,"properties":{"size":"small"}},{"type":"car","count":8,"properties":{"size":"small"}}]}'::jsonb,
  '[]'::jsonb,
  40,
  'default',
  true,
  ARRAY['城市', '现代', '示例']
),
(
  '魔法森林',
  '神秘的魔法森林，有发光的水晶和传送门',
  'forest',
  '{"scene_type":"forest","environment":{"terrain":"hills","time":"day","weather":"fog"},"objects":[{"type":"tree","count":30,"properties":{"size":"varied"}},{"type":"crystal","count":10,"properties":{"size":"varied"}},{"type":"portal","count":1,"properties":{"size":"large"}}]}'::jsonb,
  '[]'::jsonb,
  41,
  'default',
  true,
  ARRAY['森林', '魔法', '示例']
)
ON CONFLICT DO NOTHING;

-- 显示表结构
SELECT 
  'ai_generated_scenes' as table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'ai_generated_scenes'
ORDER BY ordinal_position;
