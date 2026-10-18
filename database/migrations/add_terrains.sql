-- 地形配置表（重建版）
-- 一条地形 = 一组参数 + 一个 seed（不含任何模型/贴图文件，运行时程序化生成）
-- 位置/面积/基准高度等列见 add_terrain_zones.sql 与 add_terrain_areas.sql
-- 幂等：可重复执行

CREATE TABLE IF NOT EXISTS terrains (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL,
  note        VARCHAR(200) NOT NULL DEFAULT '',
  is_builtin  BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN      NOT NULL DEFAULT FALSE,
  seed        BIGINT       NOT NULL DEFAULT 1,
  params      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS terrains_name_uq ON terrains (lower(name));

-- 内置默认地形（原点 2000×2000、纯平），由 add_terrain_areas.sql 补位置与面积
INSERT INTO terrains (name, note, is_builtin, is_active, seed, params)
SELECT
  '默认地形（平地）',
  '内置基线：原点 (0,0) 2000×2000，起伏 0（纯平）；不可修改、不可删除，可被新地形覆盖',
  TRUE,
  TRUE,
  1,
  '{
    "version": 1,
    "mode": "bounded",
    "worldRadius": 4000,
    "edgeWidth": 400,
    "edgeMode": "none",
    "heightScale": 0,
    "roughness": 0.45,
    "ridge": 0.3,
    "lakeCount": 0,
    "lakeSize": "medium",
    "flatRadius": 0,
    "waterLevel": -1.5,
    "shoreWidth": 2,
    "snowLine": 95,
    "treeLine": 80,
    "forestScale": 220,
    "forestCover": 0.52,
    "slopeTreeMax": 33,
    "slopeRockMin": 45,
    "grassDensity": 0.35,
    "treeDensity": 0.6,
    "chunkSize": 64,
    "viewDistance": 512,
    "lodSegments": [64, 32, 16, 8],
    "grassRadius": 48,
    "treeRadius": 200,
    "materials": { "grass": "", "dirt": "", "rock": "", "snow": "" }
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM terrains WHERE is_builtin = TRUE);
