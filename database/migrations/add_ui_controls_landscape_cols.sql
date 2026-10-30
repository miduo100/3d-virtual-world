-- UI 控件：补横屏定位字段（landscape_*）
--
-- 背景（2026-10-30 新服务器实测）：
--   src/routes/uiControls.js 的 ensureDefaultControls() 按 20 列 INSERT，
--   其中包含 landscape_position_x / landscape_position_y / landscape_width / landscape_height。
--   这四个列历史上由 database/add_ui_controls_alignment.sql 添加，而该文件已不存在，
--   db.js 里对应的一行也被注释掉了（注释理由：重复执行会覆盖用户配置的 h_align/v_align）。
--   结果是：新环境（旧结构库）缺这 4 列 → 每条 INSERT 报 42703
--   `column "landscape_position_x" does not exist` → 被 catch 吞掉 →
--   ui_controls 永远 0 行 → 「UI 控件」编辑器页面空白。
--
-- 说明：本迁移只补列、不写数据，不会覆盖任何已有配置（h_align/v_align 一律不动）。
-- 幂等：可重复执行。

ALTER TABLE ui_controls ADD COLUMN IF NOT EXISTS landscape_position_x VARCHAR;
ALTER TABLE ui_controls ADD COLUMN IF NOT EXISTS landscape_position_y VARCHAR;
ALTER TABLE ui_controls ADD COLUMN IF NOT EXISTS landscape_width      VARCHAR;
ALTER TABLE ui_controls ADD COLUMN IF NOT EXISTS landscape_height     VARCHAR;
