-- 迁移：AI Agent 会话表（P1）
-- agent_sessions：短期会话（jti 防重放），Agent JWT 每次签发落一行
-- 幂等脚本，可安全重复执行
CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  world_id TEXT,
  jti VARCHAR(64) NOT NULL UNIQUE,                        -- JWT ID，吊销/防重放的权威依据
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ,
  current_position JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'active',           -- active | revoked | expired
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_expires ON agent_sessions(expires_at);
