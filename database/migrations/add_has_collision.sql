-- 迁移：world_objects 表补充 has_collision 列
-- 用途：标记世界对象是否参与碰撞检测
-- 说明：幂等脚本，列已存在时静默跳过，可安全重复执行
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS has_collision BOOLEAN DEFAULT FALSE;
