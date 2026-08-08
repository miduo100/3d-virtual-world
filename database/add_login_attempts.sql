-- 登录安全加固：登录尝试记录表 + 账号锁定表
-- 执行: psql -U postgres -d your_database -f add_login_attempts.sql

-- ============================================
-- 1. 登录尝试记录表
-- ============================================
CREATE TABLE IF NOT EXISTS login_attempts (
  id          SERIAL PRIMARY KEY,
  username    VARCHAR(100)   NOT NULL,
  ip_address  VARCHAR(45)    NOT NULL,
  target_type VARCHAR(20)    NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
  success     BOOLEAN        NOT NULL DEFAULT FALSE,
  reason      VARCHAR(200),                             -- 失败原因: 'invalid_password' | 'account_locked' | 'rate_limited' 等
  created_at  TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_username_created
  ON login_attempts(username, created_at);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_created
  ON login_attempts(ip_address, created_at);

-- ============================================
-- 2. 账号锁定表（手动+自动）
-- ============================================
CREATE TABLE IF NOT EXISTS account_lockouts (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100)  NOT NULL,
  target_type   VARCHAR(20)   NOT NULL DEFAULT 'user',
  locked_by     VARCHAR(20)   NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'
  reason        VARCHAR(500),
  locked_at     TIMESTAMP     NOT NULL DEFAULT NOW(),
  unlock_at     TIMESTAMP,                               -- NULL = 永久锁定(手动解锁)
  unlocked_by   VARCHAR(100),                            -- 解锁操作者
  unlocked_at   TIMESTAMP,
  ip_address    VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_account_lockouts_username
  ON account_lockouts(username, unlock_at);

-- 注：部分索引无法使用 NOW()，查询时在 WHERE 中动态过滤即可

-- ============================================
-- 3. 清理过期记录的函数（可在 crontab 中定期调用）
--    psql -U postgres -d your_database -c "SELECT cleanup_old_login_attempts();"
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_login_attempts(
  days_to_keep INTEGER DEFAULT 90
) RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM login_attempts
  WHERE created_at < NOW() - (days_to_keep || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
