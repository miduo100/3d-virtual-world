-- add_world_activities.sql —— Phase 6 · world_activities + world_activity_participants（§11.1/§11.2）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- 幂等：可重复执行
CREATE TABLE IF NOT EXISTS world_activities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id             VARCHAR(100) NOT NULL,
  kind                 VARCHAR(40) NOT NULL,
  title                VARCHAR(200) NOT NULL,
  description          TEXT,
  region_key           VARCHAR(60),
  created_by           VARCHAR(60) NOT NULL DEFAULT 'world_ai',
  origin               VARCHAR(20) NOT NULL DEFAULT 'ai',
  status               VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  schedule             JSONB NOT NULL DEFAULT '{}',
  gameplay_def         VARCHAR(40),
  gameplay_params      JSONB NOT NULL DEFAULT '{}',
  rules                JSONB NOT NULL DEFAULT '{}',
  win_when             JSONB NOT NULL DEFAULT '[]',
  spawned_object_ids   JSONB NOT NULL DEFAULT '[]',
  reward               JSONB,
  participants         JSONB NOT NULL DEFAULT '[]',
  result               JSONB,
  reward_summary       JSONB,
  plan_step_id         UUID,
  scheduled_at         TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  settling_at          TIMESTAMPTZ,
  finished_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_world_activities_status
    CHECK (status IN ('scheduled','announced','running','settling','finished','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_world_activities_world ON world_activities(world_id);
CREATE INDEX IF NOT EXISTS idx_world_activities_region ON world_activities(region_key);
CREATE INDEX IF NOT EXISTS idx_world_activities_status ON world_activities(status);

CREATE TABLE IF NOT EXISTS world_activity_participants (
  id             BIGSERIAL PRIMARY KEY,
  activity_id    UUID NOT NULL REFERENCES world_activities(id) ON DELETE CASCADE,
  actor_type     VARCHAR(10) NOT NULL,
  actor_id       VARCHAR(100) NOT NULL,
  score          BIGINT NOT NULL DEFAULT 0,
  reward_granted BOOLEAN NOT NULL DEFAULT false,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_world_activity_participant UNIQUE (activity_id, actor_id)
);
CREATE INDEX IF NOT EXISTS idx_wap_activity ON world_activity_participants(activity_id);
