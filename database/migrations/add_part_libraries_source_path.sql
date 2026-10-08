-- 零件库撞名错开：记录来源目录（绝对路径），用于区分"同一个包重复导入"与"不同包同名"
-- 背景：扫描通道拿路径末段当库名，而每套素材包的模型目录都叫 glTF / GLB format
--       → pack_key 撞车，不同素材包的零件会混进同一个库。
-- 方案：pack_key 撞名时追加 _2 / _3 错开；仅当 source_path 相同才复用（保住重复导入的幂等）。
ALTER TABLE part_libraries ADD COLUMN IF NOT EXISTS source_path TEXT;

CREATE INDEX IF NOT EXISTS idx_part_libraries_source_path ON part_libraries(source_path)
  WHERE source_path IS NOT NULL;

COMMENT ON COLUMN part_libraries.source_path IS '来源目录绝对路径（扫描通道填写）；与 pack_key 一起判定"同一个包"，避免同名不同包混库。NULL=早期数据';

