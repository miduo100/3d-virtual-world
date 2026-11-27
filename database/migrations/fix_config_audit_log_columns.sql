-- =====================================================================
-- config_audit_log 补齐代码实际使用的列
--
-- 背景（2026-10-31 新服务器实测）：
--   init.sql 里 config_audit_log 定义的是 admin_user_id / created_at，
--   而 src/services/configService.js 写入与查询用的是 changed_by / changed_at：
--     INSERT INTO config_audit_log (config_key, old_value, new_value, changed_by, ip_address, changed_at)
--     SELECT cal.*, u.username FROM config_audit_log cal LEFT JOIN users u ON cal.changed_by = u.id
--   → 新环境缺列，后台保存配置/查看审计会报 column "changed_by" does not exist。
--   现有生产库这两个列存在（历史运行时补的），本迁移把结构对齐。
--
-- 说明：不改动 init.sql 已有的 admin_user_id / created_at（保留历史兼容），
--       仅新增缺失列；changed_by 语义同 ui_controls.created_by（admin_users.id，INTEGER）。
-- =====================================================================

ALTER TABLE config_audit_log ADD COLUMN IF NOT EXISTS changed_by INTEGER;
ALTER TABLE config_audit_log ADD COLUMN IF NOT EXISTS changed_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP;

COMMENT ON COLUMN config_audit_log.changed_by IS '操作管理员 admin_users.id（configService 写入 userId）';
