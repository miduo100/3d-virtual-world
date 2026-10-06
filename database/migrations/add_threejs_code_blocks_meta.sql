-- threejs_code_blocks 补 3 列（AI World Brain · Phase 0）
--
-- 为什么现在补：这三列**只存在于现网**（历史手工加的），既不在 init.sql 也没有迁移文件。
--   → 新环境部署 / 重建库时缺列 → Three.js 代码库的「来源类型 / 自动清洗记录 / 导入状态」
--     相关读写直接报 column does not exist。
--   现网已有数据分布（勿改默认值，否则语义漂移）：
--     source_type   = 'paste'(2) | 'html'(6) | 'js'(3)      默认 'paste'
--     auto_fixes    = JSONB 数组（清洗器施加的修改）           默认 '[]'
--     import_status = 'ok'(11)                               默认 'ok'
--
-- 幂等：IF NOT EXISTS，可重复执行；只 ADD COLUMN 不动已有列位置与类型。

ALTER TABLE threejs_code_blocks ADD COLUMN IF NOT EXISTS source_type   VARCHAR(20) DEFAULT 'paste';
ALTER TABLE threejs_code_blocks ADD COLUMN IF NOT EXISTS source_url    TEXT;
ALTER TABLE threejs_code_blocks ADD COLUMN IF NOT EXISTS auto_fixes    JSONB DEFAULT '[]'::jsonb;
ALTER TABLE threejs_code_blocks ADD COLUMN IF NOT EXISTS import_status VARCHAR(20) DEFAULT 'ok';

COMMENT ON COLUMN threejs_code_blocks.source_type   IS '来源类型：paste | html | js | url（入库渠道，决定是否需重新清洗）';
COMMENT ON COLUMN threejs_code_blocks.source_url    IS '来源 URL（source_type=url/html 时的原始地址）';
COMMENT ON COLUMN threejs_code_blocks.auto_fixes    IS '清洗器实际施加的修改列表（JSONB 数组，审计用；≠ 用户选择的 clean_options）';
COMMENT ON COLUMN threejs_code_blocks.import_status IS '导入状态：ok | pending | failed（清洗/预检未通过的代码块不参与世界加载）';
