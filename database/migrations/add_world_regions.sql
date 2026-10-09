-- add_world_regions.sql —— Phase 3.5-1 · world_regions（§C.3 ⑩）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- 幂等：可重复执行
CREATE TABLE IF NOT EXISTS world_regions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_key     VARCHAR(60) UNIQUE NOT NULL,
  world_id       VARCHAR(100) NOT NULL,
  name           VARCHAR(120) NOT NULL,
  purpose        VARCHAR(40),
  bounds         JSONB NOT NULL,
  -- ★ autonomy 刻意不给 DEFAULT：UI 不预选，API 层强校验「请求体必须含且属于三档」，否则 400。
  --   给 DB 默认值会让「必须显式选择」形同虚设（DB 静默帮管理员选了 managed）。
  autonomy       VARCHAR(20) NOT NULL,
  gridsnap       JSONB NOT NULL DEFAULT '{}',
  constraints    JSONB NOT NULL DEFAULT '{}',
  gameplay       JSONB NOT NULL DEFAULT '{}',
  tags           TEXT[] NOT NULL DEFAULT '{}',
  status         VARCHAR(20) NOT NULL DEFAULT 'active',
  metrics        JSONB NOT NULL DEFAULT '{}',
  notes          TEXT,
  last_active_at TIMESTAMPTZ,
  preferred_provider_id INTEGER,
  origin         VARCHAR(20) NOT NULL DEFAULT 'ai',
  created_by     VARCHAR(64),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_world_regions_autonomy CHECK (autonomy IN ('managed','semi_autonomous','autonomous')),
  CONSTRAINT ck_world_regions_bounds_kind CHECK ((bounds->>'kind') = 'rect')
);
CREATE INDEX IF NOT EXISTS idx_world_regions_world ON world_regions(world_id);
CREATE INDEX IF NOT EXISTS idx_world_regions_status ON world_regions(status);