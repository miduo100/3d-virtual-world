-- world_goals —— 世界目标与愿景（AI World Brain · Phase 3 · §C.3②）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
CREATE TABLE IF NOT EXISTS world_goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      VARCHAR(100) NOT NULL,
  title         VARCHAR(200) NOT NULL,
  vision        TEXT,
  hard_rules    TEXT[] NOT NULL DEFAULT '{}',
  soft_prefs    TEXT[] NOT NULL DEFAULT '{}',
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  source        VARCHAR(20) NOT NULL DEFAULT 'human',
  approved_by   INTEGER REFERENCES admin_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_world_goals_world ON world_goals(world_id);
