-- P5: Agent 跨世界联邦传送
-- ① token_usage：nonce 一次性消费（顺带补 P0 审计发现的"生成但不校验"防重放缺口，
--    人类联邦传送与 Agent 联邦传送共用同一张表，principal_type 区分）
-- ② agent_transient_sessions：跨世界 transient session
--    独立于 agent_sessions —— agent_sessions.agent_id 有 REFERENCES agents(id) 外键，
--    而跨世界 Agent 在目标世界根本没有 agents 行，必须用无外键的独立表

CREATE TABLE IF NOT EXISTS token_usage (
  nonce VARCHAR(64) PRIMARY KEY,
  principal_type VARCHAR(16) NOT NULL,       -- human | agent
  subject_id VARCHAR(255),                   -- userId 或 agentId
  source_world_id VARCHAR(64),
  target_world_id VARCHAR(64),
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_usage_used_at ON token_usage (used_at);

CREATE TABLE IF NOT EXISTS agent_transient_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jti VARCHAR(64) NOT NULL UNIQUE,
  source_world_id VARCHAR(64) NOT NULL,
  source_world_name VARCHAR(255),
  source_world_url TEXT,
  agent_id VARCHAR(64) NOT NULL,             -- 源世界 Agent 合成 ID（agent:<uuid>）
  agent_name VARCHAR(100) NOT NULL,
  avatar_config JSONB DEFAULT '{}'::jsonb,
  home_world_url TEXT,
  initial_position JSONB,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ,
  current_position JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'active',   -- active | revoked | expired
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_transient_sessions_agent ON agent_transient_sessions (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_transient_sessions_expires ON agent_transient_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_transient_sessions_jti ON agent_transient_sessions (jti);
