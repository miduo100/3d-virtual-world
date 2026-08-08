-- =====================================================================
-- 初始化常用几何体模型到数据库
-- 这些模型原本是硬编码在前端的，现在导入数据库以便统一管理
-- user_id = 0 表示系统内置数据（非特定用户创建）
-- template_id 使用 geometry_type 作为标识
-- =====================================================================

-- 1. 树模型
INSERT INTO geometry_buildings (user_id, name, template_id, geometry_type, geometry_data, tags, created_at)
VALUES 
(
  0,
  '🌲 松树',
  'tree_pine',
  'tree',
  '{
    "type": "tree",
    "trunkRadius": 0.3,
    "trunkHeight": 3,
    "crownRadius": 2,
    "crownHeight": 4,
    "color": "#228B22"
  }'::jsonb,
  ARRAY['自然', '植物', '树木'],
  NOW()
),
(
  0,
  '🌳 橡树',
  'tree_oak',
  'tree',
  '{
    "type": "tree",
    "trunkRadius": 0.4,
    "trunkHeight": 2.5,
    "crownRadius": 3,
    "crownHeight": 5,
    "color": "#2F4F2F"
  }'::jsonb,
  ARRAY['自然', '植物', '树木'],
  NOW()
),
(
  0,
  '🌴 棕榈树',
  'tree_palm',
  'tree',
  '{
    "type": "tree",
    "trunkRadius": 0.25,
    "trunkHeight": 5,
    "crownRadius": 2.5,
    "crownHeight": 2,
    "color": "#228B22"
  }'::jsonb,
  ARRAY['自然', '植物', '树木', '热带'],
  NOW()
);

-- 2. 山模型
INSERT INTO geometry_buildings (user_id, name, template_id, geometry_type, geometry_data, tags, created_at)
VALUES 
(
  0,
  '⛰️ 小山丘',
  'mountain_small',
  'mountain',
  '{
    "type": "mountain",
    "baseRadius": 5,
    "height": 6,
    "segments": 16,
    "color": "#8B7355"
  }'::jsonb,
  ARRAY['自然', '地形', '山脉'],
  NOW()
),
(
  0,
  '🏔️ 高山',
  'mountain_tall',
  'mountain',
  '{
    "type": "mountain",
    "baseRadius": 8,
    "height": 12,
    "segments": 20,
    "color": "#A0826D"
  }'::jsonb,
  ARRAY['自然', '地形', '山脉'],
  NOW()
),
(
  0,
  '🗻 雪山',
  'mountain_snow',
  'mountain',
  '{
    "type": "mountain",
    "baseRadius": 10,
    "height": 15,
    "segments": 24,
    "color": "#E0E0E0"
  }'::jsonb,
  ARRAY['自然', '地形', '山脉', '雪景'],
  NOW()
);

-- 3. 石头模型
INSERT INTO geometry_buildings (user_id, name, template_id, geometry_type, geometry_data, tags, created_at)
VALUES 
(
  0,
  '🪨 小石头',
  'rock_small',
  'rock',
  '{
    "type": "rock",
    "width": 1,
    "height": 0.8,
    "depth": 1.2,
    "color": "#696969"
  }'::jsonb,
  ARRAY['自然', '地形', '石头'],
  NOW()
),
(
  0,
  '🪨 巨石',
  'rock_large',
  'rock',
  '{
    "type": "rock",
    "width": 3,
    "height": 2.5,
    "depth": 3.5,
    "color": "#808080"
  }'::jsonb,
  ARRAY['自然', '地形', '石头'],
  NOW()
);

-- 4. 灌木模型
INSERT INTO geometry_buildings (user_id, name, template_id, geometry_type, geometry_data, tags, created_at)
VALUES 
(
  0,
  '🌿 灌木丛',
  'bush_large',
  'bush',
  '{
    "type": "bush",
    "radius": 1.5,
    "height": 1.2,
    "color": "#32CD32"
  }'::jsonb,
  ARRAY['自然', '植物', '灌木'],
  NOW()
),
(
  0,
  '🍃 小灌木',
  'bush_small',
  'bush',
  '{
    "type": "bush",
    "radius": 0.8,
    "height": 0.6,
    "color": "#90EE90"
  }'::jsonb,
  ARRAY['自然', '植物', '灌木'],
  NOW()
);

-- 5. 围栏模型
INSERT INTO geometry_buildings (user_id, name, template_id, geometry_type, geometry_data, tags, created_at)
VALUES 
(
  0,
  '🚧 木质围栏',
  'fence_wood',
  'fence',
  '{
    "type": "fence",
    "length": 5,
    "height": 1.5,
    "posts": 6,
    "color": "#8B4513"
  }'::jsonb,
  ARRAY['建筑', '围栏', '装饰'],
  NOW()
),
(
  0,
  '⛓️ 铁链围栏',
  'fence_chain',
  'fence',
  '{
    "type": "fence",
    "length": 5,
    "height": 1.8,
    "posts": 6,
    "color": "#696969"
  }'::jsonb,
  ARRAY['建筑', '围栏', '装饰'],
  NOW()
);

-- 6. 道路/路径
INSERT INTO geometry_buildings (user_id, name, template_id, geometry_type, geometry_data, tags, created_at)
VALUES 
(
  0,
  '🛤️ 石板路',
  'path_stone',
  'path',
  '{
    "type": "path",
    "length": 10,
    "width": 2,
    "thickness": 0.1,
    "color": "#A9A9A9"
  }'::jsonb,
  ARRAY['建筑', '道路', '装饰'],
  NOW()
),
(
  0,
  '🛣️ 宽阔道路',
  'path_wide',
  'path',
  '{
    "type": "path",
    "length": 15,
    "width": 4,
    "thickness": 0.2,
    "color": "#696969"
  }'::jsonb,
  ARRAY['建筑', '道路', '装饰'],
  NOW()
);

-- 7. 水面/池塘
INSERT INTO geometry_buildings (user_id, name, template_id, geometry_type, geometry_data, tags, created_at)
VALUES 
(
  0,
  '💧 小池塘',
  'water_pond',
  'water',
  '{
    "type": "water",
    "radius": 3,
    "depth": 0.1,
    "color": "#1E90FF"
  }'::jsonb,
  ARRAY['自然', '水体', '装饰'],
  NOW()
),
(
  0,
  '🌊 湖泊',
  'water_lake',
  'water',
  '{
    "type": "water",
    "radius": 8,
    "depth": 0.2,
    "color": "#4682B4"
  }'::jsonb,
  ARRAY['自然', '水体', '装饰'],
  NOW()
);

-- 8. 花朵/装饰植物
INSERT INTO geometry_buildings (user_id, name, template_id, geometry_type, geometry_data, tags, created_at)
VALUES 
(
  0,
  '🌸 粉色花朵',
  'flower_pink',
  'flower',
  '{
    "type": "flower",
    "petalRadius": 0.3,
    "stemHeight": 0.5,
    "color": "#FFB6C1"
  }'::jsonb,
  ARRAY['自然', '植物', '花朵', '装饰'],
  NOW()
),
(
  0,
  '🌻 向日葵',
  'flower_sunflower',
  'flower',
  '{
    "type": "flower",
    "petalRadius": 0.4,
    "stemHeight": 1,
    "color": "#FFD700"
  }'::jsonb,
  ARRAY['自然', '植物', '花朵', '装饰'],
  NOW()
);

-- 统计验证
SELECT 
  geometry_type,
  COUNT(*) as count
FROM geometry_buildings
WHERE user_id = 0
GROUP BY geometry_type
ORDER BY count DESC;
