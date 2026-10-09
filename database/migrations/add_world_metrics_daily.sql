-- world_metrics_daily —— 日聚合表（AI World Brain · Phase 4 · §C.3⑮）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- ★ 聚合优先（§H.6）：区域热度/参与率从本表读，不扫原始事件轨迹。
-- ★ region_id 全零 UUID = 全局聚合行（主键列不可 NULL，用哨兵值代替）。
CREATE TABLE IF NOT EXISTS world_metrics_daily (
  day           DATE NOT NULL,
  world_id      VARCHAR(100) NOT NULL,
  region_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  metric_key    VARCHAR(40) NOT NULL,
  -- visits | dwell_sec | interactions | chat_count | economy | task_completion
  metric_value  NUMERIC NOT NULL DEFAULT 0,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(day, world_id, region_id, metric_key)
);
CREATE INDEX IF NOT EXISTS idx_world_metrics_daily_world ON world_metrics_daily(world_id, day DESC);
