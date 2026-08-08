-- 为现有的users表添加role字段
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='users' AND column_name='role'
    ) THEN
        ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user';
        RAISE NOTICE 'Column role added to users table';
    ELSE
        RAISE NOTICE 'Column role already exists in users table';
    END IF;
END $$;

-- 更新portals表，添加缺失的字段
DO $$ 
BEGIN
    -- 添加target_world_name字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='portals' AND column_name='target_world_name'
    ) THEN
        ALTER TABLE portals ADD COLUMN target_world_name VARCHAR(100);
    END IF;

    -- 添加required_role字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='portals' AND column_name='required_role'
    ) THEN
        ALTER TABLE portals ADD COLUMN required_role VARCHAR(20) DEFAULT 'user';
    END IF;

    -- 重命名source_position为position（如果存在）
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='portals' AND column_name='source_position'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='portals' AND column_name='position'
    ) THEN
        ALTER TABLE portals RENAME COLUMN source_position TO position;
        RAISE NOTICE 'Column source_position renamed to position';
    END IF;
    
    -- 使target_position可为null
    ALTER TABLE portals ALTER COLUMN target_position DROP NOT NULL;
END $$;

-- 创建第一个管理员账户（请修改用户名）
-- 取消注释下面的行并修改用户名来创建管理员
-- UPDATE users SET role = 'admin' WHERE username = 'your_admin_username';

RAISE NOTICE '数据库更新完成！';
