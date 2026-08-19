-- =============================================================
-- 空间分页索引（P1：空间分页 API + 数据库索引 + 卸载真释放）
--
-- 背景：world_objects 表此前仅有 type / building_id 两个索引，
--       而 GET /api/world/objects 使用 ORDER BY created_at DESC
--       全表排序，空间查询也无索引可用（5000 行即明显变慢）。
--
-- 本迁移新增 3 个索引：
--   1. idx_world_objects_created_at   —— 分页排序（created_at DESC）
--   2. idx_world_objects_pos          —— 空间方框过滤（x/z 范围）
--   3. idx_world_objects_type_pos     —— 类型分桶 + 空间过滤复合索引
--
-- 幂等：全部使用 IF NOT EXISTS，可重复执行。
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_world_objects_created_at
  ON world_objects (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_world_objects_pos
  ON world_objects (position_x, position_z);

CREATE INDEX IF NOT EXISTS idx_world_objects_type_pos
  ON world_objects (type, position_x, position_z);
