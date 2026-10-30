-- 把「操作人」字段从 UUID 纠正为 INTEGER
--
-- 背景（2026-10-30 新服务器实测）：
--   init.sql 里下列列被定义为 UUID REFERENCES users(id)：
--     ui_controls.created_by / ui_controls.updated_by
--     portals.created_by
--     ai_provider_configs.updated_by
--     ai_provider_audit_log.changed_by
--   但业务代码写入的是 req.adminUser.id（admin_users.id 是 INTEGER），
--   现网/本地库这些列也都是 INTEGER（历史结构）。
--   → 用 init.sql 新建的库会因为类型不符直接报：
--       invalid input syntax for type uuid: "1"
--     表现为「UI 控件批量保存失败」「门户创建失败」等。
--
-- 本迁移把已存在的 uuid 列安全转成 INTEGER：
--   1) 先摘掉指向 users(id) 的外键约束（否则类型变更会失败）
--   2) ALTER COLUMN ... TYPE INTEGER USING NULL（uuid 无法转整数，历史值置空；
--      这些列此前根本写不进去，实际值本就为 NULL）
-- 幂等：列不存在或已是 integer 时完全跳过。

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('ui_controls',            'created_by'),
      ('ui_controls',            'updated_by'),
      ('portals',                'created_by'),
      ('ai_provider_configs',    'updated_by'),
      ('ai_provider_audit_log',  'changed_by')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = r.tbl
         AND column_name  = r.col
         AND data_type    = 'uuid'
    ) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
                     r.tbl, r.tbl || '_' || r.col || '_fkey');
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE INTEGER USING NULL', r.tbl, r.col);
      RAISE NOTICE '[actor-id] %.% 已由 uuid 转为 integer', r.tbl, r.col;
    END IF;
  END LOOP;
END
$$;
