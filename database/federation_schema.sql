-- 联邦系统数据库表

-- 世界配置表
CREATE TABLE IF NOT EXISTS world_config (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 信任的世界列表
CREATE TABLE IF NOT EXISTS trusted_worlds (
  world_id VARCHAR(255) PRIMARY KEY,
  world_name VARCHAR(255) NOT NULL,
  world_url TEXT NOT NULL,
  public_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 传送历史记录
CREATE TABLE IF NOT EXISTS teleport_history (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  source_world_id VARCHAR(255),
  source_world_name VARCHAR(255),
  target_world_id VARCHAR(255),
  target_world_name VARCHAR(255),
  context JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 在用户表中添加联邦用户标识
ALTER TABLE users ADD COLUMN IF NOT EXISTS federation_user BOOLEAN DEFAULT false;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_trusted_worlds_enabled ON trusted_worlds(enabled);
CREATE INDEX IF NOT EXISTS idx_teleport_history_user ON teleport_history(user_id);
CREATE INDEX IF NOT EXISTS idx_teleport_history_created ON teleport_history(created_at);

-- 添加注释
COMMENT ON TABLE world_config IS '世界配置表，存储当前世界的联邦配置';
COMMENT ON TABLE trusted_worlds IS '信任的其他世界列表';
COMMENT ON TABLE teleport_history IS '用户跨世界传送历史记录';
