-- 迁移：user_subscriptions 表补充 world_id 列
-- 用途：多世界模式下标记订阅所属世界，subscription.js 有三级兼容回退
-- 说明：幂等脚本，列已存在时静默跳过，可安全重复执行
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS world_id VARCHAR(100);
