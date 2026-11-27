-- 迁移：对象编组（world_object_groups + world_objects.group_id）
-- 用途：
--   世界编辑器的「编组」原先是纯内存的 THREE.Group（worldEditorGrouping.js），
--   刷新即散、同一时刻只能有一个组、列表里也看不出层级。
--   本迁移把编组升级为场景里的常驻逻辑分组：组只存名字和成员关系，
--   不存自己的变换（成员坐标始终是世界坐标），因此刷新重建零误差。
-- 说明：幂等脚本，可安全重复执行。
CREATE TABLE IF NOT EXISTS world_object_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id    VARCHAR(100),
  name        VARCHAR(120) NOT NULL,
  color       VARCHAR(16),
  collapsed   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_world_object_groups_world ON world_object_groups(world_id);

-- 成员归属：组删除时把成员的 group_id 置空（对象本身不删）
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS group_id UUID
  REFERENCES world_object_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_world_objects_group ON world_objects(group_id);
