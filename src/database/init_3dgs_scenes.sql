-- 3DGS 场景管理表
CREATE TABLE IF NOT EXISTS scene_3dgs (
  id SERIAL PRIMARY KEY,
  scene_name VARCHAR(255) NOT NULL,
  description TEXT,
  scene_type VARCHAR(50) DEFAULT 'outdoor',   -- outdoor/indoor/studio
  source_type VARCHAR(50) DEFAULT 'upload',   -- upload/ai_generated
  rad_file_path VARCHAR(500),                 -- 服务器物理路径
  rad_file_url VARCHAR(500),                  -- 公开访问URL
  file_size BIGINT DEFAULT 0,                 -- 文件大小(字节)
  thumbnail_url VARCHAR(500),                 -- 缩略图
  splat_count INTEGER DEFAULT 0,              -- 高斯球数量
  lod_levels INTEGER DEFAULT 8,               -- LoD层级数
  is_public BOOLEAN DEFAULT true,             -- 是否公开
  view_count INTEGER DEFAULT 0,               -- 浏览次数
  tags TEXT[] DEFAULT '{}',                   -- 标签
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_scene_3dgs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scene_3dgs_updated_at ON scene_3dgs;
CREATE TRIGGER trg_scene_3dgs_updated_at
  BEFORE UPDATE ON scene_3dgs
  FOR EACH ROW EXECUTE FUNCTION update_scene_3dgs_updated_at();

-- 索引
CREATE INDEX IF NOT EXISTS idx_scene_3dgs_source_type ON scene_3dgs(source_type);
CREATE INDEX IF NOT EXISTS idx_scene_3dgs_scene_type ON scene_3dgs(scene_type);
CREATE INDEX IF NOT EXISTS idx_scene_3dgs_is_public ON scene_3dgs(is_public);
CREATE INDEX IF NOT EXISTS idx_scene_3dgs_created_at ON scene_3dgs(created_at DESC);
