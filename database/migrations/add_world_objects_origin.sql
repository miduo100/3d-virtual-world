-- add_world_objects_origin.sql —— Phase 3.5-1 · world_objects 的 4 个新列（§C.2）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
--
-- ★ 用户红线的物理载体（2026-10-08：「用户搭建放置的模型不能随意删除」）：
--   origin 语义见 §C.2 四级所有权表。默认值 human 本身就是保护——
--   既有代码（world.js 的 INSERT）不带这几列，全部自动按人类资产对待，零改动。
-- 幂等：可重复执行。
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS origin     VARCHAR(20) DEFAULT 'human';
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS created_by VARCHAR(64);
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS entity_id  UUID;
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS region_id  VARCHAR(60);

-- origin 显式回填（DEFAULT 已覆盖；这里只为历史行语义可读、且将来 DROP DEFAULT 仍安全）
UPDATE world_objects SET origin = 'human' WHERE origin IS NULL;

-- 围栏校验（P35-7）与「本区域人工资产清单」（P35-17）都按 region_id 过滤
CREATE INDEX IF NOT EXISTS idx_world_objects_entity ON world_objects(entity_id);
CREATE INDEX IF NOT EXISTS idx_world_objects_origin ON world_objects(origin);
CREATE INDEX IF NOT EXISTS idx_world_objects_region ON world_objects(region_id);