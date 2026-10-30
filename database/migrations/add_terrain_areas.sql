-- 地形 = 地块（统一概念）
-- 每块地形占据一个三维范围：中心 (pos_x, pos_z)、尺寸 width × depth、基准高度 base_y
-- 重力恒定 -Y：下方有地形就落上去，没有地形就一直线往下掉（不做"无限 0 平面"兜底）
-- 幂等：可重复执行
-- 注意：本文件曾在空库首启时整段回滚（WHERE zone_enabled / zone_x 等列依赖已废弃的
--       add_terrain_zones.sql，而该文件已不存在）→ 导致 terrains 缺 pos_x 等列，
--       /api/terrain/world 直接 500。现已把 zone_* 迁移段落做存在性判断。

ALTER TABLE terrains ADD COLUMN IF NOT EXISTS pos_x      DOUBLE PRECISION;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS pos_z      DOUBLE PRECISION;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS width      DOUBLE PRECISION;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS depth      DOUBLE PRECISION;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS base_y     DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS color      VARCHAR(16) DEFAULT '#2d5016';
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS grid_size  INTEGER DEFAULT 100;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS priority   INTEGER NOT NULL DEFAULT 0;

-- 旧的"全局兜底唯一"约束不再适用（每块地形都是独立区域，可多块同时生效）
DROP INDEX IF EXISTS terrains_one_global_active;

-- 1) 内置默认地形：原点 (0,0)、2000×2000、纯平地、优先级最低（永远被其它地形覆盖）
UPDATE terrains
   SET pos_x = 0, pos_z = 0, width = 2000, depth = 2000, base_y = 0, priority = -1000
 WHERE is_builtin = TRUE;

-- 2) 以前配过"区域"的地形，把 zone_* 搬过来（列不存在时整段跳过）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='terrains' AND column_name='zone_enabled')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='terrains' AND column_name='zone_x')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='terrains' AND column_name='zone_z')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='terrains' AND column_name='zone_size') THEN
    UPDATE terrains
       SET pos_x  = COALESCE(pos_x,  zone_x),
           pos_z  = COALESCE(pos_z,  zone_z),
           width  = COALESCE(width,  zone_size),
           depth  = COALESCE(depth,  zone_size)
     WHERE zone_enabled = TRUE;
  END IF;
END
$$;

-- 3) 其余（原"全局"地形）：给一个能覆盖主城区的默认范围 6000×6000，可按需在后台改
UPDATE terrains
   SET pos_x = COALESCE(pos_x, 0),
       pos_z = COALESCE(pos_z, 0),
       width = COALESCE(width, 6000),
       depth = COALESCE(depth, 6000)
 WHERE pos_x IS NULL OR pos_z IS NULL OR width IS NULL OR depth IS NULL;

CREATE INDEX IF NOT EXISTS terrains_area_idx ON terrains (is_active, priority DESC);
