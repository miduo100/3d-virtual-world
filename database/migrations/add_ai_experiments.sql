-- add_ai_experiments.sql —— Phase 7 · A/B 实验记录（分册 §12.3 + 主文档 §I.1 OPTIMIZE）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- 幂等：可重复执行
-- ★ 口径（§12.3 原文）：
--   baseline 窗口 7 天 / 实验窗口 3 天 / 同区域冷却 7 天 / 提升≥10% 固化 / ≤-10% 自动回滚 / ±10% 继续观察；
--   样本不足 → 判「无结论」保持原状（宁可不做不做错）。
-- ★ change_steps 存"变更 step 列表"（executionId + tool + 参数摘要），自动回滚靠重放这些
--   execution 的 undo（toolJournal.rollback），**绝不存逆 SQL**（§3.4）。
-- ★ cooldown_until 落库而不是靠内存：进程重启后冷却依然有效（与 §H.10.5「预算查表不查内存」同纪律）。
CREATE TABLE IF NOT EXISTS world_ai_experiments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id         VARCHAR(100) NOT NULL,
  region_key       VARCHAR(60),
  rule             VARCHAR(10) NOT NULL,          -- R1 | R2 | R3 | R4 | R5
  hypothesis       TEXT NOT NULL,                  -- 人可读的假设（进后台面板）
  metric_key       VARCHAR(40) NOT NULL DEFAULT 'visits',
  status           VARCHAR(20) NOT NULL DEFAULT 'experimenting',
                   -- experimenting | solidified | rolled_back | inconclusive
  baseline_value   NUMERIC,
  experiment_value NUMERIC,
  delta_pct        NUMERIC,
  sample_n         INT NOT NULL DEFAULT 0,
  change_steps     JSONB NOT NULL DEFAULT '[]',   -- [{executionId, tool, params}]
  baseline_days    INT NOT NULL DEFAULT 7,
  experiment_days  INT NOT NULL DEFAULT 3,
  cooldown_until   TIMESTAMPTZ NOT NULL,
  verdict_note     TEXT,
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_world_ai_exp_status
    CHECK (status IN ('experimenting','solidified','rolled_back','inconclusive'))
);
-- 同区域冷却判定走这个索引（region_key + created_at）
CREATE INDEX IF NOT EXISTS idx_world_ai_exp_region ON world_ai_experiments(world_id, region_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_world_ai_exp_status ON world_ai_experiments(world_id, status);
CREATE INDEX IF NOT EXISTS idx_world_ai_exp_cooldown ON world_ai_experiments(cooldown_until);
-- ★ Phase 7 补列（首轮实现遗漏）：判定指标必须按区域读，实验行要记住 region_id
--   （world_metrics_daily.region_id 是 world_regions.id 的 UUID；不存就退回全局哨兵行，
--     R1/R5 这类「区域级」实验会读错区域，永远判成样本不足）。
ALTER TABLE world_ai_experiments ADD COLUMN IF NOT EXISTS region_id UUID;
CREATE INDEX IF NOT EXISTS idx_world_ai_exp_region_id ON world_ai_experiments(world_id, region_id, created_at DESC);