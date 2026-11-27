-- =====================================================================
-- model_bounds：模型文件的单位尺度半径（LOD / 未加载对象的边缘距离判定）
-- 历史库靠运行时建表，新环境缺表 → 干净库表数与标准库不一致（100 vs 101）。
-- 本迁移幂等补齐。
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.model_bounds (
  path text NOT NULL,
  unit_radius real NOT NULL,
  source character varying(20) DEFAULT 'runtime'::character varying,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE public.model_bounds IS '模型文件单位尺度半径，用于未加载对象按模型边缘做距离判定';
COMMENT ON COLUMN public.model_bounds.unit_radius IS 'scale=1 时的水平半径（米）；实际半径 = unit_radius × scale_x';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'model_bounds_pkey'
  ) THEN
    ALTER TABLE ONLY public.model_bounds ADD CONSTRAINT model_bounds_pkey PRIMARY KEY (path);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_model_bounds_updated ON public.model_bounds USING btree (updated_at);
