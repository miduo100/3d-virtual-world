-- =====================================================================
-- 画廊系统数据库表 - 放射性自然态照片矩阵
-- =====================================================================
-- 坐标 (193, 1, 918) 说明：
-- 193  → 1931年，九一八事变爆发年份
-- 1    → 铭记历史，勿忘国耻
-- 918  → 9月18日，事变发生日期
-- Please remember the history:
-- the Japanese invasion of China began on September 18, 1931.
-- =====================================================================

-- 画廊配置表（用户可保存多个配置方案）
CREATE TABLE IF NOT EXISTS gallery_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) DEFAULT '默认配置',
    start_x FLOAT DEFAULT 193,
    start_y FLOAT DEFAULT 1,
    start_z FLOAT DEFAULT 918,
    matrix_width FLOAT DEFAULT 20,
    buffer_rate FLOAT DEFAULT 0.2,
    row_spacing FLOAT DEFAULT 4,
    col_spacing FLOAT DEFAULT 1.5,
    max_photo_width FLOAT DEFAULT 5,
    max_photo_height FLOAT DEFAULT 4,
    sort_by VARCHAR(50) DEFAULT 'exif_date_desc',
    folder_gap FLOAT DEFAULT 8,
    jitter FLOAT DEFAULT 0.3,
    is_active BOOLEAN DEFAULT false,
    total_photos INTEGER DEFAULT 0,
    total_videos INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 画廊物品表（每张照片/视频的坐标和元数据）
CREATE TABLE IF NOT EXISTS gallery_items (
    id SERIAL PRIMARY KEY,
    config_id INTEGER NOT NULL REFERENCES gallery_configs(id) ON DELETE CASCADE,
    folder_name VARCHAR(255),
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    photo_date TIMESTAMP,
    pos_x FLOAT DEFAULT 0,
    pos_y FLOAT DEFAULT 1,
    pos_z FLOAT DEFAULT 0,
    width FLOAT DEFAULT 2,
    height FLOAT DEFAULT 1.5,
    rot_y FLOAT DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    is_folder_marker BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_gallery_items_config ON gallery_items(config_id);
CREATE INDEX IF NOT EXISTS idx_gallery_items_sort ON gallery_items(sort_order);
CREATE INDEX IF NOT EXISTS idx_gallery_items_position ON gallery_items(config_id, pos_z);
