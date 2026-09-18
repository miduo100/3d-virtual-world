-- 迁移：每个 Key Agent 可独立指定推送档（P8 后续）
--
-- push_tier 语义：
--   inherit  —— 跟随全局默认档 agent_push_default（默认，兼容既有 Agent）
--   standard —— 第 2 档：聊天 + 1s 聚合位置流
--   realtime —— 第 3 档：聊天 + 10Hz 逐条位置流
--   eco      —— 第 1 档：仅聊天（Key Agent 用不到，保留仅为后端校验完整性）
--
-- 第 1 档（公开游客 / 拉模式）不在本表：任何人通过域名即可 POST /guest/session 自动获得，
-- 无需管理员创建，因此 Key Agent 档位实际只在 standard / realtime 之间选。
--
-- 删除：agent_api_keys / agent_sessions 均有 ON DELETE CASCADE，
-- 直接 DELETE FROM agents 即级联清理 Key 与会话（在线连接由 agentWsServer 主动踢出）。
-- 幂等脚本，可安全重复执行
ALTER TABLE agents ADD COLUMN IF NOT EXISTS push_tier VARCHAR(20) NOT NULL DEFAULT 'inherit';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_push_tier_check'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_push_tier_check
      CHECK (push_tier IN ('inherit', 'eco', 'standard', 'realtime'));
  END IF;
END $$;
