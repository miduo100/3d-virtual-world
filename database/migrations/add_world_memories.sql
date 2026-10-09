-- world_memories —— World AI 持久记忆（AI World Brain · Phase 3 · §C.3⑯）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- ★ 规格偏差说明：§Phase 3 迁移清单只列 3 个（goals/plans/approvals），但 P2-8 判据要求
--   memoryService 在本阶段落地（"generate 后产生 world 记忆；restart 后 recall 能取回"），
--   故补本迁移（表结构照 §C.3⑯ 原文）。压缩/遗忘的定时任务属 Phase 4（世界事件流一起做）。
CREATE TABLE IF NOT EXISTS world_memories (
  id            BIGSERIAL PRIMARY KEY,
  world_id      VARCHAR(100) NOT NULL,
  scope         VARCHAR(20) NOT NULL,
  subject_id    VARCHAR(128),
  kind          VARCHAR(20) NOT NULL,
  content       TEXT NOT NULL,
  importance    SMALLINT NOT NULL DEFAULT 3,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  source        VARCHAR(20) NOT NULL DEFAULT 'operator',
  plan_id       UUID,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_world_memories_recall ON world_memories(world_id, scope, kind, importance DESC);
