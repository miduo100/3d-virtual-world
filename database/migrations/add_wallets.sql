-- add_wallets.sql —— Phase 6 · 货币体系（§Phase 6 前置#1 + §H.8 缺陷 5）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- 幂等：可重复执行
-- ★ 原子性：wallets.balance 带 CHECK (balance >= 0)，扣款走
--   "UPDATE ... SET balance = balance - $n WHERE balance >= $n RETURNING" —— 数据库层面不可能扣成负数。
-- ★ 幂等键：wallet_transactions.idempotency_key UNIQUE —— 重复请求/重试不重复扣款。
CREATE TABLE IF NOT EXISTS wallets (
  owner_type  VARCHAR(10) NOT NULL DEFAULT 'user',
  owner_id    UUID NOT NULL,
  currency    VARCHAR(20) NOT NULL DEFAULT 'coin',
  balance     BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_type, owner_id, currency)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              BIGSERIAL PRIMARY KEY,
  owner_type      VARCHAR(10) NOT NULL,
  owner_id        UUID NOT NULL,
  currency        VARCHAR(20) NOT NULL DEFAULT 'coin',
  amount          BIGINT NOT NULL,            -- 正 = 入账，负 = 扣款
  balance_after   BIGINT NOT NULL,
  kind            VARCHAR(40) NOT NULL,       -- purchase | reward | refund | admin_topup
  idempotency_key VARCHAR(100),
  ref_type        VARCHAR(40),
  ref_id          VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_wallet_tx_idem UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_owner ON wallet_transactions(owner_type, owner_id, created_at);

-- AI 创建商店（create_shop）没有 users 行可当 merchant（红线：不建本地用户）：
-- 放开 merchant_id 非空约束（纯放宽，不影响既有行与既有写入路径）。
ALTER TABLE shops ALTER COLUMN merchant_id DROP NOT NULL;
