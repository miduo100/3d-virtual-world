-- add_world_entities.sql —— Phase 5 · world_entities + world_entity_parts（§C.3 ⑦⑧）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- 幂等：可重复执行
-- ★ world_interactions 已在 Phase 3.5-1 建表（add_world_interactions.sql），此处只补
--   entity_id 的 FK（当时刻意留空等本表）。本表建不出来时该 ALTER 同样失败并跳过——
--   因此 FK 放在文件末尾，且用 DO 块吞掉失败（world_interactions.entity_id 保持无 FK 也完全可用）。
-- ★ region_key / spec_hash 为 §C.3⑦ 未列出但装配与幂等必需（规格偏差已在 §J.3 声明）。
CREATE TABLE IF NOT EXISTS world_entities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id      VARCHAR(100) NOT NULL,
  entity_type   VARCHAR(40) NOT NULL,   -- building|prop|npc_host|quest_board|shop|zone|decor
  name          VARCHAR(120) NOT NULL,
  purpose       VARCHAR(40),
  region_key    VARCHAR(60),
  -- ① Visual
  visual        JSONB NOT NULL,         -- {mode:'asset'|'components'|'composite', ...}
  -- ② Physical
  physical      JSONB NOT NULL,         -- {hasCollision, footprint, height, bounds, anchorOffsetY}
  -- ④ NPC
  npc_refs      JSONB NOT NULL DEFAULT '[]',
  -- ⑤ Gameplay
  gameplay      JSONB NOT NULL DEFAULT '{}',
  -- ⑥ Data
  origin        VARCHAR(20) NOT NULL DEFAULT 'ai',
  created_by    VARCHAR(64),
  spec          JSONB,
  spec_hash     TEXT,
  state         JSONB NOT NULL DEFAULT '{"active":true,"phase":"building"}',
  entity_state  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_world_entities_spec UNIQUE (world_id, spec_hash)
);
CREATE INDEX IF NOT EXISTS idx_world_entities_world ON world_entities(world_id);
CREATE INDEX IF NOT EXISTS idx_world_entities_region ON world_entities(region_key);

CREATE TABLE IF NOT EXISTS world_entity_parts (
  id              BIGSERIAL PRIMARY KEY,
  entity_id       UUID NOT NULL REFERENCES world_entities(id) ON DELETE CASCADE,
  world_object_id INTEGER REFERENCES world_objects(id) ON DELETE CASCADE,
  part_key        VARCHAR(60) NOT NULL,
  part_role       VARCHAR(40) NOT NULL,
  asset_ref       JSONB,
  local_transform JSONB,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_world_entity_parts UNIQUE (entity_id, part_key)
);
CREATE INDEX IF NOT EXISTS idx_world_entity_parts_entity ON world_entity_parts(entity_id);
CREATE INDEX IF NOT EXISTS idx_world_entity_parts_object ON world_entity_parts(world_object_id);

-- 3.5 的 world_interactions 补 FK（失败静默：无 FK 不影响任何功能）
DO $$
BEGIN
  ALTER TABLE world_interactions
    ADD CONSTRAINT fk_world_interactions_entity
    FOREIGN KEY (entity_id) REFERENCES world_entities(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL;
END $$;
