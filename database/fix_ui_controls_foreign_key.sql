-- 修复 ui_controls 表的外键类型
-- admin_users 表的 id 是 INTEGER，但 ui_controls 表的 created_by/updated_by 是 UUID

-- 先删除外键约束（如果存在）
ALTER TABLE ui_controls 
DROP CONSTRAINT IF EXISTS ui_controls_created_by_fkey,
DROP CONSTRAINT IF EXISTS ui_controls_updated_by_fkey;

-- 删除旧字段
ALTER TABLE ui_controls 
DROP COLUMN IF EXISTS created_by,
DROP COLUMN IF EXISTS updated_by;

-- 添加新字段（INTEGER 类型，与 admin_users.id 匹配）
ALTER TABLE ui_controls 
ADD COLUMN created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
ADD COLUMN updated_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL;
