-- 几何体建筑表
CREATE TABLE IF NOT EXISTS geometry_buildings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  template_id VARCHAR(100) NOT NULL,
  geometry_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_geometry_buildings_user_id ON geometry_buildings(user_id);
CREATE INDEX IF NOT EXISTS idx_geometry_buildings_template_id ON geometry_buildings(template_id);
CREATE INDEX IF NOT EXISTS idx_geometry_buildings_created_at ON geometry_buildings(created_at);

-- 插入示例数据
INSERT INTO geometry_buildings (user_id, name, template_id, geometry_data)
VALUES 
  (1, '示例茅草屋', 'cottage', '{"name":"茅草屋","components":[]}'),
  (1, '示例塔楼', 'tower', '{"name":"塔楼","components":[]}')
ON CONFLICT DO NOTHING;
