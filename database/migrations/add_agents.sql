-- 迁移：AI Agent 身份表（P1）
-- agents：Agent 主体（身份/Avatar 配置/权限预留）
-- agent_api_keys：API Key（只存 hash，key_prefix 供后台识别）
-- 幂等脚本，可安全重复执行
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',          -- active | disabled
  home_world_url TEXT,
  avatar_config JSONB DEFAULT '{}'::jsonb,                -- glbUrl/animUrls/weaponConfig/boneMapConfig/weaponSocketConfig/calibrationConfig
  can_teleport BOOLEAN NOT NULL DEFAULT FALSE,            -- 红线3：预留，默认关闭
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,                                 -- bcrypt hash（明文只在创建时返回一次）
  key_prefix VARCHAR(20) NOT NULL,                        -- 如 agk_live_ab12（后台识别用）
  status VARCHAR(20) NOT NULL DEFAULT 'active',           -- active | revoked
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent ON agent_api_keys(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_prefix ON agent_api_keys(key_prefix);
