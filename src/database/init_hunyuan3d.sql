-- 创建生成建筑表
CREATE TABLE IF NOT EXISTS generated_buildings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  image_path VARCHAR(500),
  prompt TEXT,
  task_id VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'processing', -- processing, completed, failed
  model_url TEXT,
  thumbnail_url TEXT,
  local_path VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  CONSTRAINT valid_status CHECK (status IN ('processing', 'completed', 'failed'))
);

-- 创建世界对象表（如果不存在）
CREATE TABLE IF NOT EXISTS world_objects (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  model_path VARCHAR(500),
  position_x FLOAT DEFAULT 0,
  position_y FLOAT DEFAULT 0,
  position_z FLOAT DEFAULT 0,
  rotation_x FLOAT DEFAULT 0,
  rotation_y FLOAT DEFAULT 0,
  rotation_z FLOAT DEFAULT 0,
  scale_x FLOAT DEFAULT 1,
  scale_y FLOAT DEFAULT 1,
  scale_z FLOAT DEFAULT 1,
  building_id INTEGER REFERENCES generated_buildings(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_generated_buildings_user_id ON generated_buildings(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_buildings_status ON generated_buildings(status);
CREATE INDEX IF NOT EXISTS idx_generated_buildings_task_id ON generated_buildings(task_id);
CREATE INDEX IF NOT EXISTS idx_world_objects_building_id ON world_objects(building_id);
CREATE INDEX IF NOT EXISTS idx_world_objects_type ON world_objects(type);

-- 插入示例数据（可选）
INSERT INTO generated_buildings (user_id, name, description, task_id, status, created_at)
VALUES 
  (1, '示例建筑1', '这是一个测试建筑', 'test-task-1', 'completed', NOW()),
  (1, '示例建筑2', '这是另一个测试建筑', 'test-task-2', 'processing', NOW())
ON CONFLICT (task_id) DO NOTHING;
