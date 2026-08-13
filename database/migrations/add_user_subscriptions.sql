-- 迁移：创建用户订阅表 user_subscriptions
-- 用途：管理员开通的用户订阅（含微信/支付宝等支付方式）
-- 说明：幂等脚本，表已存在时静默跳过，可安全重复执行
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  months INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  payment_method VARCHAR(30) DEFAULT 'wechat',
  proof_image_url TEXT,
  note TEXT,
  started_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  txn_no VARCHAR(100),
  order_no VARCHAR(100),
  world_id VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_expires ON user_subscriptions(expires_at);
