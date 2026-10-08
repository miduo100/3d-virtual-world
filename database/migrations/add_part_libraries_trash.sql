-- 零件库回收站（软删除 → 恢复 / 清空）
-- 背景：删库是不可逆操作，直接真删太危险；但只软删又会留下大量占空间的模型文件。
-- 方案：status='deleted' 进回收站（磁盘文件保留，可恢复）→ 「清空回收站」才真删 + 删磁盘。
-- 幂等：可重复执行

ALTER TABLE part_libraries ADD COLUMN IF NOT EXISTS prev_status VARCHAR(20);
ALTER TABLE part_libraries ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_part_libraries_deleted ON part_libraries(deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN part_libraries.status     IS 'pending_review（AI 隐身）| active | archived | rejected | deleted（回收站，可恢复；清空后不可恢复）';
COMMENT ON COLUMN part_libraries.prev_status IS '软删除前的状态；恢复时回填（NULL=恢复为 active）';
COMMENT ON COLUMN part_libraries.deleted_at  IS '进入回收站的时间；非 NULL 即在回收站内';
