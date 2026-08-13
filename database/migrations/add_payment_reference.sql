-- 迁移：orders 表补充 payment_reference 列
-- 用途：订单支付流水号（预留字段，当前代码暂未使用，保持迁移列表完整）
-- 说明：幂等脚本，列已存在时静默跳过，可安全重复执行
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100);
