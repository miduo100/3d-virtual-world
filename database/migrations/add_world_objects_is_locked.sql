-- 迁移：world_objects 表补充 is_locked 列
-- 用途：标记世界对象是否锁定（锁定后编辑器不可选中/移动/删除，防止误触）
-- 说明：幂等脚本，列已存在时静默跳过，可安全重复执行
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
