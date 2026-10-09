-- add_world_interactions.sql —— Phase 3.5-1 · world_interactions（§C.3 ⑨，极简玩法只需 reward_grant）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- 幂等：可重复执行
-- ★ entity_id 列保留但**不建 FK**：world_entities 属 Phase 4/5，届时再ALTER 补外键。
CREATE TABLE IF NOT EXISTS world_interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id         VARCHAR(100) NOT NULL,
  entity_id        UUID,
  world_object_id  INTEGER REFERENCES world_objects(id) ON DELETE SET NULL,
  region_key       VARCHAR(60),
  interaction_type VARCHAR(30) NOT NULL,
  key              VARCHAR(60) NOT NULL,
  label            VARCHAR(120),
  position         JSONB,
  radius           REAL NOT NULL DEFAULT 3.0,
  payload          JSONB NOT NULL DEFAULT '{}',
  conditions       JSONB NOT NULL DEFAULT '{}',
  grants           JSONB,
  once_per_day     BOOLEAN NOT NULL DEFAULT false,
  daily_count      INT NOT NULL DEFAULT 0,
  daily_reset_on   DATE,
  origin           VARCHAR(20) NOT NULL DEFAULT 'ai',
  enabled          BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_world_interactions_key UNIQUE (world_id, interaction_type, key)
);
CREATE INDEX IF NOT EXISTS idx_world_interactions_world ON world_interactions(world_id);
CREATE INDEX IF NOT EXISTS idx_world_interactions_region ON world_interactions(region_key);