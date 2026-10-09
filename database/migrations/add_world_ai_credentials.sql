-- Phase 2a · 队列项 1：World AI 专用凭证（与 Agent Key 分离）
-- 设计来源：AI-World-Brain-架构审查与改造方案.md §C.3 ⑰
-- 不复用 agents / agent_api_keys：World AI 凭证绑定 world + 独立 world:* scope，
-- 可单独 pause/revoke，且不能升级成玩家或管理员身份。
CREATE TABLE IF NOT EXISTS world_ai_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      VARCHAR(100) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  key_hash      VARCHAR(255) NOT NULL,        -- bcrypt，同 agent_api_keys
  key_prefix    VARCHAR(40) NOT NULL,         -- 'waik_...'（明文 Key 只在创建/轮换时返回一次）
  scopes        TEXT[] NOT NULL DEFAULT '{}', -- world:observe|plan|build|gameplay|analyze|rollback|configure
  status        VARCHAR(20) NOT NULL DEFAULT 'active',  -- active|paused|revoked
  expires_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  usage_count   INT NOT NULL DEFAULT 0,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  created_by    VARCHAR(120)
);
CREATE INDEX IF NOT EXISTS idx_world_ai_credentials_world ON world_ai_credentials(world_id);
CREATE INDEX IF NOT EXISTS idx_world_ai_credentials_prefix ON world_ai_credentials(key_prefix);
