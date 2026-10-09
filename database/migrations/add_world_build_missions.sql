-- add_world_build_missions.sql —— Phase 3.5-1 · world_build_missions（§C.3 ㉑）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- 幂等：可重复执行
CREATE TABLE IF NOT EXISTS world_build_missions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id            VARCHAR(100) NOT NULL,
  region_key          VARCHAR(60) NOT NULL,
  title               VARCHAR(120) NOT NULL,
  prompt              TEXT NOT NULL,
  constraints         JSONB NOT NULL DEFAULT '{}',
  budget              JSONB NOT NULL DEFAULT '{}',
  -- 建委托那一刻区域的自主度快照；管理员中途降权时本批仍按快照跑完（避免半成品）
  autonomy_snapshot   VARCHAR(20) NOT NULL DEFAULT 'managed',
  status              VARCHAR(20) NOT NULL DEFAULT 'draft',
  plan                JSONB NOT NULL DEFAULT '{}',
  executed_stats      JSONB NOT NULL DEFAULT '{}',
  provider_id         INTEGER,
  -- 厂商决议留痕 { plan:3, tool_select:3, summary:2, source, decidedAt }
  provider_resolution JSONB NOT NULL DEFAULT '{}',
  origin              VARCHAR(20) NOT NULL DEFAULT 'ai',
  created_by          VARCHAR(64) NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  CONSTRAINT ck_world_build_missions_status CHECK (status IN
    ('draft','queued','running','completed','failed','rolled_back','cancelled')),
  CONSTRAINT ck_world_build_missions_autonomy CHECK (autonomy_snapshot IN
    ('managed','semi_autonomous','autonomous')),
  CONSTRAINT ck_world_build_missions_placement_policy
    CHECK (coalesce(constraints->>'placement_policy','avoid') = 'avoid')
);
CREATE INDEX IF NOT EXISTS idx_world_build_missions_world ON world_build_missions(world_id);
CREATE INDEX IF NOT EXISTS idx_world_build_missions_region ON world_build_missions(region_key);
CREATE INDEX IF NOT EXISTS idx_world_build_missions_status ON world_build_missions(status);