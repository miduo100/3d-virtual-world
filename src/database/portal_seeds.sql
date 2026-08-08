-- 传送门测试数据
-- 在数据库初始化完成后运行此脚本，插入一些示例传送门

-- 1. 出生点到高台的传送门
INSERT INTO portals (name, description, source_position, target_position, portal_type, is_bidirectional, cooldown_seconds, required_level)
VALUES (
  '高台传送门',
  '从出生点传送到楼梯顶端的高台',
  '{"x": -10, "y": 2, "z": 0}',
  '{"x": 20, "y": 7, "z": 25}',
  'local',
  true,
  0,
  1
);

-- 2. 高台返回出生点的传送门（由双向传送自动创建，这里是示例）
-- INSERT INTO portals (name, description, source_position, target_position, portal_type, is_bidirectional, cooldown_seconds, required_level)
-- VALUES (
--   '高台传送门 (返回)',
--   '从高台返回到出生点',
--   '{"x": 20, "y": 7, "z": 25}',
--   '{"x": -10, "y": 2, "z": 0}',
--   'local',
--   true,
--   0,
--   1
-- );

-- 3. 商店区域传送门
INSERT INTO portals (name, description, source_position, target_position, portal_type, is_bidirectional, cooldown_seconds, required_level)
VALUES (
  '商店传送门',
  '快速前往商店区域',
  '{"x": 10, "y": 2, "z": 0}',
  '{"x": 0, "y": 2, "z": -50}',
  'local',
  true,
  5,
  1
);

-- 4. 远程探索区域传送门（需要冷却）
INSERT INTO portals (name, description, source_position, target_position, portal_type, is_bidirectional, cooldown_seconds, required_level)
VALUES (
  '远方探索',
  '传送到远离出生点的探索区域',
  '{"x": 0, "y": 2, "z": 10}',
  '{"x": 100, "y": 2, "z": 100}',
  'local',
  true,
  10,
  5
);

-- 5. 跨服传送门示例（需要配置target_world_url）
-- INSERT INTO portals (name, description, source_position, target_position, target_world_url, portal_type, is_bidirectional, cooldown_seconds, required_level)
-- VALUES (
--   '米多虚拟世界2号服务器',
--   '传送到另一个服务器的虚拟世界',
--   '{"x": -20, "y": 2, "z": 0}',
--   '{"x": 0, "y": 2, "z": 0}',
--   'http://server2.example.com:3000',
--   'remote',
--   false,
--   30,
--   10
-- );

-- 查询所有传送门
-- SELECT id, name, portal_type, is_active, source_position, target_position FROM portals;
