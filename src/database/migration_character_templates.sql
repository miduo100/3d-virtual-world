-- ============================================================
-- 角色模板系统迁移
-- 包含：character_templates、template_skills、world_rules
-- ============================================================

-- 角色模板表
CREATE TABLE IF NOT EXISTS character_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50) DEFAULT 'default', -- 模板分类
  glb_url TEXT,                          -- GLB 文件路径
  glb_hash TEXT,                         -- 用于缓存校验（sha256）
  thumbnail_url TEXT,                    -- 预览图（可选）
  access_level VARCHAR(20) DEFAULT 'public',
  -- 'creator_only' → 仅创世者/管理员本人
  -- 'admin'        → 所有管理员
  -- 'public'       → 所有注册用户可选
  character_role VARCHAR(20) DEFAULT 'player',
  -- 'creator' → 创世者专属模板
  -- 'admin'   → 管理员模板
  -- 'player'  → 普通玩家模板
  is_active BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,      -- 是否为新用户默认模板
  sort_order INT DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 模板技能表（与角色模板关联）
CREATE TABLE IF NOT EXISTS template_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES character_templates(id) ON DELETE CASCADE,
  skill_name VARCHAR(100) NOT NULL,
  trigger_text VARCHAR(255),             -- 语音触发词
  skill_type VARCHAR(30) DEFAULT 'attack',
  -- 'attack'  → 攻击类（可被 pvp 规则控制）
  -- 'heal'    → 治疗类
  -- 'build'   → 建造类
  -- 'perform' → 表演/动作类（永远允许）
  -- 'admin'   → 管理员技能（world_bound 时仅本世界有效）
  skill_scope VARCHAR(20) DEFAULT 'portable',
  -- 'portable'    → 可携带到其他世界（效果由目标世界规则决定）
  -- 'world_bound' → 仅本世界生效，外来时效果归零
  animation_clip VARCHAR(100),           -- GLB 内动画片段名
  effect_type VARCHAR(50),               -- AOE_DAMAGE / HEAL / BUFF / SPAWN_OBJECT 等
  effect_power INT DEFAULT 0,
  range_distance INT DEFAULT 5,
  effect_duration INT DEFAULT 1000,      -- ms
  cooldown INT DEFAULT 3000,             -- ms
  particle_effect VARCHAR(100),          -- 粒子特效名
  icon_emoji VARCHAR(10) DEFAULT '⚡',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- characters 表新增模板引用和角色身份字段
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES character_templates(id),
  ADD COLUMN IF NOT EXISTS character_role VARCHAR(20) DEFAULT 'player',
  ADD COLUMN IF NOT EXISTS glb_url TEXT,
  ADD COLUMN IF NOT EXISTS glb_hash TEXT,
  ADD COLUMN IF NOT EXISTS remote_user_id TEXT,   -- 外来用户标识 "https://worldY.com/users/alice"
  ADD COLUMN IF NOT EXISTS remote_world TEXT;      -- 来源世界域名

-- skills 表新增 scope、type、scope 字段（兼容已有数据）
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS skill_type VARCHAR(30) DEFAULT 'attack',
  ADD COLUMN IF NOT EXISTS skill_scope VARCHAR(20) DEFAULT 'portable',
  ADD COLUMN IF NOT EXISTS animation_clip VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cooldown INT DEFAULT 3000,
  ADD COLUMN IF NOT EXISTS particle_effect VARCHAR(100),
  ADD COLUMN IF NOT EXISTS icon_emoji VARCHAR(10) DEFAULT '⚡';

-- 武器库表
CREATE TABLE IF NOT EXISTS weapons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  weapon_type VARCHAR(30) DEFAULT 'sword',
  glb_url TEXT,
  config JSONB DEFAULT '{}',
  icon_emoji VARCHAR(10) DEFAULT '⚔️',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 世界规则表
CREATE TABLE IF NOT EXISTS world_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 战斗规则
  pvp_enabled BOOLEAN DEFAULT FALSE,
  pve_enabled BOOLEAN DEFAULT TRUE,
  allow_foreign_attack BOOLEAN DEFAULT FALSE,   -- 外来角色能否造成伤害
  damage_multiplier FLOAT DEFAULT 1.0,          -- 伤害倍率（平衡系数）
  -- 技能类型白名单（外来用户）
  -- 默认只允许 perform、build，pvp 世界再加 attack
  allow_skill_types TEXT[] DEFAULT ARRAY['perform', 'build'],
  -- 其他规则
  max_foreign_level INT DEFAULT 999,            -- 外来角色等级上限
  respawn_enabled BOOLEAN DEFAULT TRUE,
  friendly_fire BOOLEAN DEFAULT FALSE,          -- 是否允许队友伤害
  world_type VARCHAR(30) DEFAULT 'normal',
  -- 'normal'    → 普通世界
  -- 'pvp'       → PVP 世界（自动开放 attack）
  -- 'peaceful'  → 和平世界（禁止所有伤害）
  -- 'creative'  → 创意世界（只允许 build/perform）
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 初始化默认世界规则（每个服务器只有一条）
INSERT INTO world_rules (world_type, pvp_enabled, pve_enabled, allow_foreign_attack, damage_multiplier, allow_skill_types)
VALUES ('normal', FALSE, TRUE, FALSE, 1.0, ARRAY['perform', 'build'])
ON CONFLICT DO NOTHING;
