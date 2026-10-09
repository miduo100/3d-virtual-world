-- world_events —— 全站唯一事件流（AI World Brain · Phase 4 · §C.3⑮）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- ★ 唯一写入器 = src/worldai/perception/eventLog.js；任何模块不得直插本表。
-- ★ 隐私红线（§H.6）：chat 事件 payload 只存 {len, kw}，绝不存聊天全文（判据 P3-12）。
CREATE SEQUENCE IF NOT EXISTS world_events_seq_seq;

CREATE TABLE IF NOT EXISTS world_events (
  id              BIGSERIAL PRIMARY KEY,
  seq             BIGINT NOT NULL DEFAULT nextval('world_events_seq_seq'),
  world_id        VARCHAR(100) NOT NULL,
  type            VARCHAR(40) NOT NULL,
  -- entity_enter_region|entity_exit_region|chat|object_interact
  -- |object_created|object_removed|task_progress|task_completed
  -- |activity_participant|economy|npc_talk
  actor_type      VARCHAR(10),            -- human | agent | ai | system
  actor_id        VARCHAR(100),
  region_id       UUID,
  entity_id       UUID,
  world_object_id INTEGER,
  target_id       VARCHAR(100),
  x REAL, y REAL, z REAL,
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_world_events_world_time ON world_events(world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_world_events_type_time  ON world_events(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_world_events_region_time ON world_events(region_id, created_at DESC);
