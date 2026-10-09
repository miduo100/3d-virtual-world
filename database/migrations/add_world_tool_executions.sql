-- world_tool_executions —— 工具执行账本（AI World Brain · Phase 4 · §C.3⑤）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- ★ 每次工具执行一行（含被拒的）：before/after 快照 + undo_payload 是回滚的基础（判据 P3-4）。
-- ★ 每日预算查本表当日计数（§H.10.5 重启安全：进程重启清内存 = 没有预算）。
CREATE TABLE IF NOT EXISTS world_tool_executions (
  id            BIGSERIAL PRIMARY KEY,
  world_id      VARCHAR(100) NOT NULL,
  plan_id       UUID,
  plan_step_id  UUID,
  tool_name     VARCHAR(60) NOT NULL,
  params        JSONB NOT NULL,
  risk_tier     VARCHAR(10) NOT NULL,
  status        VARCHAR(20) NOT NULL,
  -- proposed | approved | executing | succeeded | failed | rolled_back | denied
  before_state  JSONB,                    -- 目标实体的完整前置快照（新建类 = null）
  after_state   JSONB,                    -- 执行后快照
  undo_payload  JSONB,                    -- 逆操作描述（§H.5：结构化，不是 SQL）
  undoable      BOOLEAN NOT NULL DEFAULT false,
  approval_id   UUID,
  actor         VARCHAR(64) NOT NULL,     -- world_ai:<configId> | admin:<username>
  reason        TEXT,
  error         TEXT,
  result        JSONB,
  latency_ms    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_world_tool_exec_world_time ON world_tool_executions(world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_world_tool_exec_plan  ON world_tool_executions(plan_id);
CREATE INDEX IF NOT EXISTS idx_world_tool_exec_step  ON world_tool_executions(plan_step_id);
CREATE INDEX IF NOT EXISTS idx_world_tool_exec_tool  ON world_tool_executions(tool_name, status);
