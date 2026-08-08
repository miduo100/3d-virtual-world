-- Three.js 代码库表
-- 存放用户粘贴/导入的 Three.js 源代码（含 AI 生成、shader 艺术、程序化场景等）
-- 在世界编辑器中被当作可复用"代码块"拖入场景。

CREATE TABLE IF NOT EXISTS threejs_code_blocks (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  code TEXT NOT NULL,                 -- 清洗/规范化后的代码（用于渲染）
  raw_code TEXT,                      -- 用户原始粘贴（便于回看/调试）
  clean_options JSONB DEFAULT '{}'::jsonb, -- 清洗开关记录
  tags TEXT[] DEFAULT '{}',
  thumbnail_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_threejs_blocks_tags ON threejs_code_blocks USING GIN (tags);
