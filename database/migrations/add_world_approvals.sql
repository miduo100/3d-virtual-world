-- world_approvals —— 人工审批（Plan 级 + Tool 级共用）（AI World Brain · Phase 3 · §C.3⑥）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
CREATE TABLE IF NOT EXISTS world_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      VARCHAR(100) NOT NULL,
  target_type   VARCHAR(20) NOT NULL,
  target_id     UUID NOT NULL,
  risk_tier     VARCHAR(10) NOT NULL,
  payload       JSONB,
  decision      VARCHAR(20),
  decided_by    INTEGER REFERENCES admin_users(id),
  decided_at    TIMESTAMPTZ,
  comment       TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_world_approvals_target ON world_approvals(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_world_approvals_pending ON world_approvals(world_id, decision);
