-- =====================================================================
-- portals.created_by 纠正为 UUID
--
-- 背景（2026-10-31 新服务器实测）：
--   GET /api/portal 直接 500，服务端报
--     operator does not exist: integer = uuid
--   SQL 是：SELECT p.*, u.username FROM portals p LEFT JOIN users u ON p.created_by = u.id
--
-- 根因：
--   init.sql 里 portals.created_by 是 UUID REFERENCES users(id)，
--   而 migrations/fix_actor_id_cols_to_integer.sql 把它误当成「管理员操作人字段」
--   转成了 INTEGER（该迁移是给 ui_controls.created_by / ai_provider_* 用的），
--   于是 users.id(UUID) 与 portals.created_by(INTEGER) JOIN 必然报错。
--
-- 语义确认：
--   routes/portal.js 创建传送门写入的是 req.userId（= users.id，UUID），
--   所以本列必须保持 UUID。历史值此前根本写不进 INTEGER，必为 NULL，
--   因此 USING NULL 不会丢任何有效数据。
--
-- 幂等：已是 uuid（或列不存在）时完全跳过。
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'portals'
       AND column_name  = 'created_by'
       AND data_type    = 'integer'
  ) THEN
    ALTER TABLE portals DROP CONSTRAINT IF EXISTS portals_created_by_fkey;
    ALTER TABLE portals ALTER COLUMN created_by TYPE uuid USING NULL;
    RAISE NOTICE '[portals] created_by 已由 integer 改回 uuid';
  END IF;
END
$$;

COMMENT ON COLUMN portals.created_by IS '创建者 users.id（UUID；portal.js 写入 req.userId）';
