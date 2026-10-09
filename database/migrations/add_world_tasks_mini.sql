-- add_world_tasks_mini.sql —— Phase 3.5-1 · world_tasks + world_task_progress（§C.3 ⑪⑫，仅 2 种 objective）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- 幂等：可重复执行
-- ★ entity_id / plan_step_id 列保留但**不建 FK**（world_entities 属 Phase 5）；region_id 指向
--   world_regions.id（本阶段该表已存在，可安全建 FK）。
-- ★ 一期仅 2 种 objective：reach_region（走进区域）/ object_interact（与交互点交互）。
--   其余 objective 类型留给 Phase 6 扩展，本期不预留实现。
CREATE TABLE IF NOT EXISTS world_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id         VARCHAR(100) NOT NULL,
  title            VARCHAR(200) NOT NULL,
  description      TEXT,
  type             VARCHAR(30) NOT NULL DEFAULT 'side',
  objectives       JSONB NOT NULL DEFAULT '[]',
  region_key       VARCHAR(60),
  region_ref       UUID REFERENCES world_regions(id) ON DELETE SET NULL,
  entity_id        UUID,
  giver            JSONB,
  status           VARCHAR(20) NOT NULL DEFAULT 'published',
  visibility       VARCHAR(20) NOT NULL DEFAULT 'agent_only',
  repeatable       BOOLEAN NOT NULL DEFAULT false,
  max_completions  INT,
  completion_count INT NOT NULL DEFAULT 0,
  reward           JSONB,
  conditions       JSONB NOT NULL DEFAULT '{}',
  origin           VARCHAR(20) NOT NULL DEFAULT 'ai',
  plan_step_id     UUID,
  world_day        INT,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_world_tasks_visibility CHECK (visibility IN ('public','agent_only','human_only'))
);
CREATE INDEX IF NOT EXISTS idx_world_tasks_world ON world_tasks(world_id);
CREATE INDEX IF NOT EXISTS idx_world_tasks_region ON world_tasks(region_key);

CREATE TABLE IF NOT EXISTS world_task_progress (
  id             BIGSERIAL PRIMARY KEY,
  task_id        UUID NOT NULL REFERENCES world_tasks(id) ON DELETE CASCADE,
  actor_type     VARCHAR(10) NOT NULL,
  actor_id       VARCHAR(100) NOT NULL,
  state          JSONB NOT NULL DEFAULT '{}',
  status         VARCHAR(20) NOT NULL DEFAULT 'active',
  reward_granted BOOLEAN NOT NULL DEFAULT false,
  claimed_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  CONSTRAINT uq_world_task_progress_actor UNIQUE (task_id, actor_id)
);