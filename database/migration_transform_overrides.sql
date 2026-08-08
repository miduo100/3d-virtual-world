-- 对象位置覆盖表：存储任意ID（整数或UUID）对象的位置/旋转/缩放覆盖
-- 用于"记忆空间"等不在 world_objects 表中的对象的持久化
CREATE TABLE IF NOT EXISTS object_transform_overrides (
  object_id VARCHAR(100) PRIMARY KEY,
  position_x FLOAT DEFAULT 0,
  position_y FLOAT DEFAULT 0,
  position_z FLOAT DEFAULT 0,
  rotation_x FLOAT DEFAULT 0,
  rotation_y FLOAT DEFAULT 0,
  rotation_z FLOAT DEFAULT 0,
  scale_x FLOAT DEFAULT 1,
  scale_y FLOAT DEFAULT 1,
  scale_z FLOAT DEFAULT 1,
  object_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transform_overrides_object_id ON object_transform_overrides(object_id);
