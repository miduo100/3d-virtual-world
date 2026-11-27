-- =====================================================================
-- 联邦受信任世界：端点键（endpoint_key）
-- 目的：把「一个物理地址 = 一个世界」固化到数据库，避免同一 URL 因对方
--       重置身份（重装/换库/reset-identity）而堆积多条信任记录。
-- 规则：endpoint_key = host[:port][/path]，**忽略 http/https 协议**
--       端口 80 / 443 一律视为默认端口丢弃（协议已忽略，无法按协议判断）。
-- 注意：唯一索引要求「同一端点只能有一行」，若库里已存在重复记录
--       （改造前产生的），这里会捕获异常并跳过唯一索引，不阻断启动；
--       请在后台「联邦与传送 → 受信任世界」删除重复项后重启服务，
--       或运行 scripts/backfill_trusted_world_endpoint_key.js 查看重复分组。
-- =====================================================================

ALTER TABLE trusted_worlds ADD COLUMN IF NOT EXISTS endpoint_key VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_trusted_worlds_endpoint
  ON trusted_worlds (endpoint_key);

DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_worlds_endpoint
      ON trusted_worlds (endpoint_key)
      WHERE endpoint_key IS NOT NULL;
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING '⚠️ trusted_worlds 存在同端点的重复记录，唯一索引 uq_trusted_worlds_endpoint 未创建；请先在后台删除重复世界后重启服务';
  END;
END $$;
