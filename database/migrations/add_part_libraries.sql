-- 零件库（Part Library）
-- 一个 pack = 一个风格基调包（如 kenney_modular-buildings / downtown_brick）
-- 逻辑隔离：零件本体仍住在 uploaded_models，本表只负责"库"这个层级
-- 幂等：可重复执行

CREATE TABLE IF NOT EXISTS part_libraries (
  id                SERIAL PRIMARY KEY,
  world_id          VARCHAR(100) NOT NULL DEFAULT 'default',
  pack_key          VARCHAR(60)  UNIQUE NOT NULL,
  display_name      VARCHAR(120) NOT NULL,
  style_family      VARCHAR(60),
  description       TEXT,
  source_type       VARCHAR(20)  NOT NULL DEFAULT 'external_kit',
        -- external_kit | procedural | manual | ai_generated
  source_ref        VARCHAR(500),
  license_info      JSONB,
        -- { type:'CC0', author:'...', url:'...', reviewed_at:'...' }
  cover_image       VARCHAR(500),
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending_review',
        -- pending_review（AI 检索层完全隐身） | active | archived | rejected
  reviewed_by       INTEGER,
  reviewed_at       TIMESTAMPTZ,
  priority          SMALLINT     NOT NULL DEFAULT 100,
  stats             JSONB        NOT NULL DEFAULT '{}'::jsonb,
        -- { partCount, totalTris, textureCount, diskMb, modCount }
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_part_libraries_status ON part_libraries(status);
CREATE INDEX IF NOT EXISTS idx_part_libraries_world   ON part_libraries(world_id);

-- pack_key 归一化（小写 + 非字母数字转下划线）后可能撞车
CREATE UNIQUE INDEX IF NOT EXISTS uq_part_libraries_packkey_lower ON part_libraries(LOWER(pack_key));

COMMENT ON TABLE  part_libraries IS '零件库 = 风格基调包；每个 pack 一个子目录';
COMMENT ON COLUMN part_libraries.status IS 'pending_review 时对 World AI 完全隐身（人工核验闸）';
COMMENT ON COLUMN part_libraries.license_info IS '人工核验留痕：授权类型/作者/来源';

-- ─────────────────────────────────────────────────────────────
-- 零件清单（库 ↔ 模型 关联）
-- 一件零件 = 一行。model_id 指向 uploaded_models.id（本体仍在既有表）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS part_library_items (
  id                BIGSERIAL PRIMARY KEY,
  library_id        INTEGER      NOT NULL REFERENCES part_libraries(id) ON DELETE CASCADE,
  model_id          INTEGER      NOT NULL,
  part_key          VARCHAR(80)  NOT NULL,
  part_role         VARCHAR(40)  NOT NULL,
        -- wall|window|door|column|cornice|roof|road|ground|stairs|
        -- railing|nature|awning|prop|floor
  part_subtype      VARCHAR(60),
  grid_w            REAL,
  grid_h            REAL,
  grid_d            REAL,
  collidable        BOOLEAN      NOT NULL DEFAULT TRUE,
  repeat_allowed    BOOLEAN      NOT NULL DEFAULT TRUE,
  stack_rule        VARCHAR(20)  NOT NULL DEFAULT 'none',
        -- none | vertical（Bottom/Center/Top 类可堆叠）
  lod_policy        VARCHAR(20)  NOT NULL DEFAULT 'auto',
        -- auto | never（极小件不生成变体）
  thumbnail         VARCHAR(500),
  tags              TEXT[]       NOT NULL DEFAULT '{}',
  metadata          JSONB        NOT NULL DEFAULT '{}'::jsonb,
        -- { tris, mats, textures, bbox:{w,h,d}, sourceType:'glb'|'gltf' }
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(library_id, part_key),
  UNIQUE(library_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_part_items_library ON part_library_items(library_id);
CREATE INDEX IF NOT EXISTS idx_part_items_role     ON part_library_items(part_role);
CREATE INDEX IF NOT EXISTS idx_part_items_model    ON part_library_items(model_id);
CREATE INDEX IF NOT EXISTS idx_part_items_tags     ON part_library_items USING GIN(tags);

COMMENT ON TABLE  part_library_items IS '零件清单：库 → 零件 → uploaded_models 记录';
COMMENT ON COLUMN part_library_items.grid_w IS '模数宽度（从包围盒自动填），装配时用于网格对齐校验';
COMMENT ON COLUMN part_library_items.collidable IS '是否阻挡玩家（wall/door=true，window/trim=false）';
COMMENT ON COLUMN part_library_items.lod_policy IS 'never = 不生成 LOD 变体（面数低于门槛时自动设置）';

-- ─────────────────────────────────────────────────────────────
-- 既有表加 2 列（逻辑隔离，不物理分表）
-- part_category='part' 的记录不进「上传模型」列表，只出现在零件库
-- ─────────────────────────────────────────────────────────────
ALTER TABLE uploaded_models ADD COLUMN IF NOT EXISTS pack_id       INTEGER;
ALTER TABLE uploaded_models ADD COLUMN IF NOT EXISTS part_category VARCHAR(20) NOT NULL DEFAULT 'model';

CREATE INDEX IF NOT EXISTS idx_uploaded_models_pack ON uploaded_models(pack_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_models_part ON uploaded_models(part_category);

-- 既有行全部为 'model' / pack_id=NULL → v_all_models 视图无需改动，零行为变化
COMMENT ON COLUMN uploaded_models.part_category IS 'model=用户上传（进上传模型页） | part=零件库扫描（只进零件库页）';
COMMENT ON COLUMN uploaded_models.pack_id IS '→ part_libraries.id；NULL=普通模型';

-- 注：故意不改 v_all_models 视图。
-- 原因：CREATE OR REPLACE VIEW 只能在末尾追加列且列类型必须完全一致，
--       现有视图的 created_at/updated_at 类型与重建时不一致（timestamp vs timestamptz），
--       重建会报 UNION types ... cannot be matched 并使整个迁移回滚。
-- 零件检索不需要该视图 —— part_library_items 直接 JOIN uploaded_models（见 partLibrary.js / partSearch）。
-- 若将来确需扩展视图，正确做法是 DROP VIEW IF EXISTS v_all_models CASCADE 后重建，
--   并同时重建依赖它的 search_models_by_tags() 函数。

