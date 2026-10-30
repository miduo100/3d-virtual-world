-- 地形区域（旧版 zone_* 列）—— 本文件补回历史丢失的 add_terrain_zones.sql 的列部分
-- 背景：src/routes/terrain.js 的 TERRAIN_COLS 仍 SELECT zone_enabled/zone_x/zone_z/zone_size/zone_priority，
--       历史库靠运行时创建过这些列，但迁移链里引用的 add_terrain_zones.sql 已不存在
--       → 新环境（空库首启）缺列，/api/terrain/world 报 column "zone_enabled" does not exist (500)。
-- 说明：区域语义已由 pos_x/pos_z/width/depth 承接，zone_* 仅保留兼容读取，默认不启用。
-- 幂等：可重复执行。

ALTER TABLE terrains ADD COLUMN IF NOT EXISTS zone_enabled  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS zone_x        DOUBLE PRECISION;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS zone_z        DOUBLE PRECISION;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS zone_size     DOUBLE PRECISION;
ALTER TABLE terrains ADD COLUMN IF NOT EXISTS zone_priority INTEGER NOT NULL DEFAULT 0;
