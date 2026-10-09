-- world_plans + world_plan_steps —— World Plan 审批主体与执行步骤（AI World Brain · Phase 3 · §C.3③④）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
CREATE TABLE IF NOT EXISTS world_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      VARCHAR(100) NOT NULL,
  goal_id       UUID REFERENCES world_goals(id),
  version       INTEGER NOT NULL DEFAULT 1,
  title         VARCHAR(200) NOT NULL,
  summary       TEXT,
  overview      TEXT,
  phases        JSONB NOT NULL DEFAULT '[]',
  risks         JSONB NOT NULL DEFAULT '[]',
  status        VARCHAR(20) NOT NULL DEFAULT 'draft',
  revision      INTEGER NOT NULL DEFAULT 1,
  reviewed_by   INTEGER REFERENCES admin_users(id),
  reviewed_at   TIMESTAMPTZ,
  approved_by   INTEGER REFERENCES admin_users(id),
  approved_at   TIMESTAMPTZ,
  rejected_reason TEXT,
  progress      JSONB NOT NULL DEFAULT '{"totalSteps":0,"doneSteps":0,"failedSteps":0,"currentStepId":null}',
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  generated_by_plan_id UUID,
  llm_call_id   BIGINT,
  prompt_digest TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(world_id, goal_id, version)
);
CREATE INDEX IF NOT EXISTS idx_world_plans_world_status ON world_plans(world_id, status);

CREATE TABLE IF NOT EXISTS world_plan_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       UUID NOT NULL REFERENCES world_plans(id) ON DELETE CASCADE,
  phase_no      INTEGER NOT NULL DEFAULT 1,
  seq           INTEGER NOT NULL,
  tool_name     VARCHAR(60) NOT NULL,
  params        JSONB NOT NULL,
  rationale     TEXT,
  expected_effect JSONB,
  verify_tool   VARCHAR(60),
  verify_params JSONB,
  risk_tier     VARCHAR(10) NOT NULL DEFAULT 'low',
  -- ★ P2-6：人工设定优先——管理员改过风险等级的 step，AI 后续生成/重规划不得降级
  human_risk_locked BOOLEAN NOT NULL DEFAULT false,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  execution_id  BIGINT,
  result        JSONB,
  error         TEXT,
  scheduled_at  TIMESTAMPTZ,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_world_plan_steps_plan ON world_plan_steps(plan_id, status);

-- 存量表补列（幂等）：本迁移早期版本漏了 updated_at，服务端步骤更新需要它
ALTER TABLE world_plan_steps ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
