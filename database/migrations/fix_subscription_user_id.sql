-- 修复 user_subscriptions.user_id 类型不匹配
-- admin_users.id 是 INTEGER，但 user_subscriptions.user_id 是 UUID 引用 users 表
-- 订阅系统仅限管理员使用，应引用 admin_users
ALTER TABLE user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_user_id_fkey;
ALTER TABLE user_subscriptions ALTER COLUMN user_id TYPE VARCHAR(50);
ALTER TABLE user_subscriptions ALTER COLUMN user_id TYPE INTEGER USING NULLIF(user_id, '')::integer;
