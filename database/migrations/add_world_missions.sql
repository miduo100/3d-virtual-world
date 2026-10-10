-- add_world_missions.sql —— AI World Brain · Phase 7b · §I.6 长期使命 Long-term Mission
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
--
-- 定位（§I.6）：world_plans 是"干一票"，长期使命是"雇一个管家管一两年"。
--   使命管方向与节奏（1~2 年不变），Plan 管单次执行；两者并存，不合并
--   （world_goals 是一次性目标，生命周期完全不同，§I.6 注意事项 8）。
--
-- 与 §I.6 数据模型的差异（规格偏差，已在 §J.3 登记）：
--   ①补 pending_statement TEXT      —— "调整方向从下一阶段起生效"需要暂存新文本
--   ②补 review_options JSONB        —— 里程碑不达标时 AI 给的 3 个调整方案
--   ③状态机含 draft（§I.6 列出了 draft 但流程未写）；finished/terminated 语义 = 只停循环
--
-- 幂等：可重复执行
CREATE TABLE IF NOT EXISTS world_missions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id          VARCHAR(100) NOT NULL,
  statement         TEXT NOT NULL,                  -- 使命文本（1~2 年不变）
  north_star        JSONB NOT NULL DEFAULT '{}',    -- 北极星指标 {metric,target,check}
  phases            JSONB NOT NULL DEFAULT '[]',    -- [{seq,title,goal,milestoneCheck,status}]
  current_phase     SMALLINT NOT NULL DEFAULT 1,
  weekly_plan       JSONB NOT NULL DEFAULT '{}',    -- 本周计划（滚动覆盖，不累积）
  last_report       JSONB,                          -- 上次月报（含 pendingQuestion）
  monthly_budget    JSONB NOT NULL DEFAULT '{}',    -- {month,limits:{tokens,objects,demolitions},used:{...}}
  pending_statement TEXT,                           -- 调整方向：从下一阶段起生效
  review_options    JSONB,                          -- 里程碑不达标 → 3 个调整方案
  status            VARCHAR(20) NOT NULL DEFAULT 'draft',
                    -- draft|running|paused|awaiting_review|finished|terminated
  paused_reason     TEXT,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 每世界同时最多 1 个 active（draft/running/paused/awaiting_review 视为占用席位）
CREATE UNIQUE INDEX IF NOT EXISTS uq_world_missions_active
  ON world_missions (world_id)
  WHERE status IN ('draft', 'running', 'paused', 'awaiting_review');

CREATE INDEX IF NOT EXISTS idx_world_missions_world ON world_missions (world_id, status);
