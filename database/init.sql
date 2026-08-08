-- =====================================================================
-- Docker PostgreSQL 首次初始化入口
-- 此文件在数据库首次创建时自动执行（docker-entrypoint-initdb.d）
-- 内容与 src/database/migrations.sql 保持同步
-- =====================================================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================================
-- 第一部分：核心游戏表（UUID 主键）
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'user',
  federation_user BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100),
  level INT DEFAULT 1,
  health INT DEFAULT 100,
  max_health INT DEFAULT 100,
  attack_power INT DEFAULT 10,
  defense INT DEFAULT 5,
  experience INT DEFAULT 0,
  position JSONB DEFAULT '{"x": 0, "y": 0, "z": 0}',
  respawn_point JSONB DEFAULT '{"x": 0, "y": 0, "z": 0}',
  last_position JSONB,
  realname VARCHAR(100),
  bio TEXT,
  last_online TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS character_appearance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  face_brows VARCHAR(255),
  face_glasses VARCHAR(255),
  face_nose VARCHAR(255),
  face_skin VARCHAR(255),
  face_ears VARCHAR(255),
  face_mouth VARCHAR(255),
  face_beard VARCHAR(255),
  face_jaw VARCHAR(255),
  hair VARCHAR(255),
  top_wear VARCHAR(255),
  bottom_wear VARCHAR(255),
  shoes VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  equipment_type VARCHAR(50),
  equipment_name VARCHAR(100),
  model_url VARCHAR(255),
  glow BOOLEAN DEFAULT FALSE,
  stats JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill_name VARCHAR(100),
  trigger_text VARCHAR(255),
  effect_type VARCHAR(50),
  effect_duration INT,
  effect_power INT,
  range_distance INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position JSONB NOT NULL,
  size JSONB DEFAULT '{"width": 10, "depth": 10}',
  buildings JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_id UUID NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
  building_name VARCHAR(100),
  model_url VARCHAR(255),
  model_path TEXT,
  model_type VARCHAR(50),
  position JSONB,
  rotation JSONB,
  scale JSONB DEFAULT '{"x": 1, "y": 1, "z": 1}',
  assets JSONB DEFAULT '[]',
  tags TEXT[] DEFAULT '{}',
  category VARCHAR(50) DEFAULT 'ai_generated',
  auto_tags JSONB DEFAULT '{}',
  task_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'processing',
  ai_provider VARCHAR(50),
  thumbnail_url TEXT,
  image_path VARCHAR(500),
  prompt TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_name VARCHAR(100),
  position JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shop_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  item_name VARCHAR(100),
  description TEXT,
  price DECIMAL(10, 2),
  quantity INT DEFAULT 0,
  model_url VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_item_id UUID NOT NULL REFERENCES shop_items(id),
  quantity INT DEFAULT 1,
  total_price DECIMAL(10, 2),
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS monsters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monster_type VARCHAR(50),
  spawn_position JSONB NOT NULL,
  health INT DEFAULT 50,
  max_health INT DEFAULT 50,
  attack_power INT DEFAULT 8,
  defense INT DEFAULT 0,
  reward_exp INT DEFAULT 10,
  drop_rate FLOAT DEFAULT 0.3,
  drop_expire_seconds INT DEFAULT 120,
  drop_pool_id UUID,
  drop_max_per_user INT DEFAULT 1,
  geometry_type VARCHAR(50) DEFAULT 'slime',
  geometry_color VARCHAR(20) DEFAULT '#44ff88',
  level INT DEFAULT 1,
  move_speed FLOAT DEFAULT 2.0,
  aggro_range FLOAT DEFAULT 10.0,
  attack_range FLOAT DEFAULT 1.5,
  respawn_seconds INT DEFAULT 60,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS monster_drops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name VARCHAR(100),
  rarity VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  source_position JSONB NOT NULL,
  target_position JSONB,
  target_world_url VARCHAR(255),
  target_world_name VARCHAR(100),
  portal_type VARCHAR(50) DEFAULT 'local',
  is_bidirectional BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  cooldown_seconds INT DEFAULT 0,
  required_level INT DEFAULT 1,
  required_role VARCHAR(20) DEFAULT 'user',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id UUID NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS geometry_buildings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  template_id VARCHAR(100) NOT NULL,
  geometry_data JSONB NOT NULL,
  building_type VARCHAR(50),
  geometry_type VARCHAR(50),
  position_x FLOAT DEFAULT 0,
  position_y FLOAT DEFAULT 0,
  position_z FLOAT DEFAULT 0,
  rotation_x FLOAT DEFAULT 0,
  rotation_y FLOAT DEFAULT 0,
  rotation_z FLOAT DEFAULT 0,
  scale_x FLOAT DEFAULT 1,
  scale_y FLOAT DEFAULT 1,
  scale_z FLOAT DEFAULT 1,
  color VARCHAR(20),
  tags TEXT[] DEFAULT '{}',
  category VARCHAR(50) DEFAULT 'building',
  description TEXT,
  auto_tags JSONB DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS uploaded_models (
  id SERIAL PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  saved_file_name VARCHAR(255) NOT NULL,
  path VARCHAR(500) NOT NULL,
  file_type VARCHAR(10) NOT NULL,
  file_size BIGINT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  category VARCHAR(50) DEFAULT 'uploaded',
  description TEXT,
  auto_tags JSONB DEFAULT '{}',
  thumbnail_path TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS generated_buildings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  image_path VARCHAR(500),
  prompt TEXT,
  task_id VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'processing',
  model_url TEXT,
  thumbnail_url TEXT,
  local_path VARCHAR(500),
  tags TEXT[] DEFAULT '{}',
  category VARCHAR(50) DEFAULT 'ai_generated',
  auto_tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(255) UNIQUE NOT NULL,
  config_value TEXT,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(255) UNIQUE NOT NULL,
  config_value TEXT,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ad_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  renter_name VARCHAR(200),
  position JSONB NOT NULL DEFAULT '{"x":0,"y":0,"z":0}',
  rotation JSONB NOT NULL DEFAULT '{"x":0,"y":0,"z":0}',
  scale JSONB NOT NULL DEFAULT '{"x":1,"y":1,"z":1}',
  model_url VARCHAR(500),
  trigger_type VARCHAR(20) NOT NULL DEFAULT 'link',
  portal_type VARCHAR(20) DEFAULT 'link',
  target_world_id VARCHAR(255),
  deep_link TEXT,
  target_url VARCHAR(500),
  target_world_url VARCHAR(500),
  target_world_name VARCHAR(200),
  rent_start TIMESTAMP,
  rent_end TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reward_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_name VARCHAR(200) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reward_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES reward_pools(id) ON DELETE CASCADE,
  code VARCHAR(500) NOT NULL,
  reward_name VARCHAR(200) NOT NULL,
  reward_desc TEXT,
  platform_url VARCHAR(500),
  is_claimed BOOLEAN DEFAULT FALSE,
  claimed_by UUID REFERENCES users(id),
  claimed_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS world_drops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id UUID NOT NULL REFERENCES reward_codes(id) ON DELETE CASCADE,
  monster_id UUID REFERENCES monsters(id) ON DELETE SET NULL,
  position JSONB NOT NULL DEFAULT '{"x":0,"y":0,"z":0}',
  dropped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  is_picked BOOLEAN DEFAULT FALSE,
  picked_by UUID REFERENCES users(id),
  picked_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS player_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_id UUID NOT NULL REFERENCES reward_codes(id) ON DELETE CASCADE,
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP,
  UNIQUE(user_id, code_id)
);

CREATE TABLE IF NOT EXISTS npcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  model_url VARCHAR(500),
  model_type VARCHAR(20) DEFAULT 'glb',
  avatar_emoji VARCHAR(10) DEFAULT '🧑',
  shape_code TEXT,
  shape_desc TEXT,
  position JSONB DEFAULT '{"x":0,"y":0,"z":0}',
  rotation JSONB DEFAULT '{"x":0,"y":0,"z":0}',
  scale FLOAT DEFAULT 1.0,
  ai_provider VARCHAR(50) DEFAULT 'qwen',
  ai_model VARCHAR(100),
  system_prompt TEXT,
  personality JSONB DEFAULT '{"tags":[],"greeting":"","farewell":""}',
  behavior JSONB DEFAULT '{
    "detection_radius": 8,
    "approach_player": true,
    "approach_distance": 2.5,
    "auto_greet": true,
    "greet_cooldown": 30,
    "idle_animation": "idle",
    "walk_animation": "walk",
    "talk_animation": "talk",
    "patrol_points": [],
    "patrol_enabled": false
  }',
  memory_config JSONB DEFAULT '{"remember_players":true,"context_turns":8}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS npc_chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  npc_id UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  player_id VARCHAR(100),
  player_name VARCHAR(100),
  role VARCHAR(10) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teleport_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_world_id VARCHAR(100) NOT NULL,
  source_world_name VARCHAR(200) NOT NULL,
  target_world_id VARCHAR(100) NOT NULL,
  target_world_name VARCHAR(200) NOT NULL,
  context JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trusted_worlds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id VARCHAR(100) UNIQUE NOT NULL,
  world_name VARCHAR(200) NOT NULL,
  world_url VARCHAR(500) NOT NULL,
  public_key TEXT NOT NULL,
  is_central BOOLEAN DEFAULT false,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS world_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) UNIQUE NOT NULL,
  value JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 第二部分：AI 系统表
-- =====================================================================

CREATE TABLE IF NOT EXISTS ai_providers (
  id SERIAL PRIMARY KEY,
  provider_name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(200) NOT NULL,
  provider_type VARCHAR(50) NOT NULL,
  is_enabled BOOLEAN DEFAULT false,
  is_default BOOLEAN DEFAULT false,
  config_schema JSONB,
  icon_url TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER REFERENCES ai_providers(id) ON DELETE CASCADE,
  config_key VARCHAR(200) NOT NULL,
  config_value TEXT,
  is_sensitive BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider_id, config_key)
);

CREATE TABLE IF NOT EXISTS ai_provider_audit_log (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER REFERENCES ai_providers(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  config_key VARCHAR(200),
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES users(id),
  ip_address INET,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 第三部分：管理后台表
-- =====================================================================

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(100),
  full_name VARCHAR(100),
  role VARCHAR(20) DEFAULT 'admin',
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMP,
  last_login_ip VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  ip_address VARCHAR(50),
  user_agent TEXT,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_action_logs (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(100),
  resource_id VARCHAR(100),
  details TEXT,
  ip_address VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 第四部分：角色模板与武器库
-- =====================================================================

CREATE TABLE IF NOT EXISTS character_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  glb_url TEXT,
  glb_hash TEXT,
  thumbnail_url TEXT,
  access_level VARCHAR(20) DEFAULT 'public',
  character_role VARCHAR(20) DEFAULT 'player',
  is_active BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,
  is_federated BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0,
  created_by_admin_id INTEGER,
  created_by_name VARCHAR(100),
  weapon_id UUID,
  weapon_config JSONB DEFAULT '{}'::jsonb,
  bone_map JSONB DEFAULT '{}'::jsonb,
  fit_config JSONB DEFAULT '{}'::jsonb,
  calibration_config JSONB DEFAULT '{}'::jsonb,
  weapon_socket_config JSONB DEFAULT '{}'::jsonb,
  bone_mapping_config JSONB DEFAULT '{}'::jsonb,
  is_calibrated BOOLEAN DEFAULT FALSE,
  calibrated_at TIMESTAMP,
  calibration_version INTEGER DEFAULT 1,
  anim_sounds JSONB DEFAULT '{}'::jsonb,
  weapon_sounds JSONB DEFAULT '{}'::jsonb,
  anim_set JSONB DEFAULT '{}'::jsonb,
  anim_idle_url TEXT,
  anim_walk_url TEXT,
  anim_run_url TEXT,
  anim_jump_url TEXT,
  anim_attack1_url TEXT,
  anim_attack2_url TEXT,
  anim_attack3_url TEXT,
  anim_hit_url TEXT,
  anim_death_url TEXT,
  anim_turn_left_url TEXT,
  anim_turn_right_url TEXT,
  anim_attack_stab_url TEXT,
  anim_attack_slash_url TEXT,
  anim_attack_swing_url TEXT,
  anim_attack_uppercut_url TEXT,
  anim_sheath_url TEXT,
  anim_draw_sword_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS weapons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  weapon_type VARCHAR(30) DEFAULT 'builtin_lightsaber',
  glb_url TEXT,
  config JSONB DEFAULT '{}'::jsonb,
  icon_emoji VARCHAR(10),
  default_effect VARCHAR(30) DEFAULT 'none',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_by_admin_id INTEGER,
  created_by_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS weapon_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weapon_id UUID NOT NULL REFERENCES weapons(id) ON DELETE CASCADE,
  skill_name VARCHAR(100) NOT NULL,
  effect_type VARCHAR(30) DEFAULT 'none',
  trigger_type VARCHAR(30) DEFAULT 'manual',
  duration INT DEFAULT 3000,
  sound_url TEXT,
  sort_order INT DEFAULT 0,
  is_confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS template_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES character_templates(id) ON DELETE CASCADE,
  skill_name VARCHAR(100) NOT NULL,
  trigger_text VARCHAR(255),
  skill_type VARCHAR(30) DEFAULT 'attack',
  skill_scope VARCHAR(20) DEFAULT 'portable',
  animation_clip VARCHAR(100),
  anim_glb_url TEXT,
  effect_type VARCHAR(50) DEFAULT 'AOE_DAMAGE',
  effect_power INT DEFAULT 0,
  range_distance INT DEFAULT 5,
  effect_duration INT DEFAULT 1000,
  cooldown INT DEFAULT 3000,
  particle_effect VARCHAR(100),
  icon_emoji VARCHAR(10) DEFAULT '⚡',
  sort_order INT DEFAULT 0,
  fx_preset VARCHAR(30) DEFAULT 'none',
  fx_color VARCHAR(20) DEFAULT NULL,
  fx_glow FLOAT DEFAULT NULL,
  fx_particle VARCHAR(30) DEFAULT NULL,
  fx_duration INT DEFAULT 2000,
  fx_blade_color VARCHAR(20) DEFAULT NULL,
  fx_glow_intensity FLOAT DEFAULT NULL,
  fx_particle_type VARCHAR(30) DEFAULT 'none',
  fx_duration_legacy INT DEFAULT 2000,
  fx_sound_url TEXT DEFAULT NULL,
  fx_sound_volume FLOAT DEFAULT 0.8,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 第五部分：世界配置扩展表
-- =====================================================================

CREATE TABLE IF NOT EXISTS world_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pvp_enabled BOOLEAN DEFAULT FALSE,
  pve_enabled BOOLEAN DEFAULT TRUE,
  allow_foreign_attack BOOLEAN DEFAULT FALSE,
  damage_multiplier FLOAT DEFAULT 1.0,
  allow_skill_types TEXT[] DEFAULT ARRAY['perform','build'],
  max_foreign_level INT DEFAULT 999,
  respawn_enabled BOOLEAN DEFAULT TRUE,
  friendly_fire BOOLEAN DEFAULT FALSE,
  world_type VARCHAR(30) DEFAULT 'normal',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS custom_npcs (
  id SERIAL PRIMARY KEY,
  npc_id VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  appearance JSONB,
  dialog JSONB,
  quests JSONB,
  position_x FLOAT DEFAULT 0,
  position_y FLOAT DEFAULT 0,
  position_z FLOAT DEFAULT 0,
  rotation_y FLOAT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS world_weather (
  id SERIAL PRIMARY KEY,
  weather_type VARCHAR(50) NOT NULL,
  sky_mode VARCHAR(50) DEFAULT 'default',
  fog_enabled BOOLEAN DEFAULT false,
  fog_density FLOAT DEFAULT 0.5,
  fog_color VARCHAR(20) DEFAULT '#cccccc',
  intensity FLOAT DEFAULT 1.0,
  duration INTEGER DEFAULT 0,
  start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS animation_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  anim_key VARCHAR(50) NOT NULL,
  glb_url TEXT NOT NULL,
  glb_hash TEXT,
  label VARCHAR(100),
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_by_admin_id INTEGER,
  created_by_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS federation_templates (
  id SERIAL PRIMARY KEY,
  template_id VARCHAR(100) NOT NULL UNIQUE,
  template_name VARCHAR(255) NOT NULL,
  source_world_id VARCHAR(100),
  source_template_id VARCHAR(100),
  local_template_id VARCHAR(100),
  description TEXT,
  category VARCHAR(50),
  bones JSONB,
  skills JSONB,
  is_public BOOLEAN DEFAULT false,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS resource_references (
  id SERIAL PRIMARY KEY,
  template_id VARCHAR(100),
  resource_type VARCHAR(50) NOT NULL,
  resource_url VARCHAR(500) NOT NULL,
  resource_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bone_mappings (
  id SERIAL PRIMARY KEY,
  source_skeleton VARCHAR(100),
  target_skeleton VARCHAR(100),
  mapping JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config_audit_log (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER,
  action VARCHAR(50) NOT NULL,
  config_key VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  ip_address VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 第六部分：场景与模型扩展表
-- =====================================================================

CREATE TABLE IF NOT EXISTS ai_generated_scenes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  scene_name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  scene_type VARCHAR(50),
  scene_config JSONB NOT NULL,
  layout_data JSONB NOT NULL,
  object_count INTEGER DEFAULT 0,
  ai_provider VARCHAR(50),
  prompt TEXT,
  status VARCHAR(50) DEFAULT 'processing',
  thumbnail_url VARCHAR(500),
  tags TEXT[],
  view_count INTEGER DEFAULT 0,
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_scene_favorites (
  id SERIAL PRIMARY KEY,
  scene_id INTEGER REFERENCES ai_generated_scenes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scene_id, user_id)
);

CREATE TABLE IF NOT EXISTS world_objects (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  model_path VARCHAR(500),
  model_type VARCHAR(50),
  position_x FLOAT DEFAULT 0,
  position_y FLOAT DEFAULT 0,
  position_z FLOAT DEFAULT 0,
  rotation_x FLOAT DEFAULT 0,
  rotation_y FLOAT DEFAULT 0,
  rotation_z FLOAT DEFAULT 0,
  scale_x FLOAT DEFAULT 1,
  scale_y FLOAT DEFAULT 1,
  scale_z FLOAT DEFAULT 1,
  building_id INTEGER REFERENCES generated_buildings(id) ON DELETE CASCADE,
  threejs_code TEXT,
  world_id VARCHAR(100),
  video_props JSONB DEFAULT '{"autoplay":false,"muted":true,"loop":false}',
  custom_config JSONB DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- 第七部分：标签系统与 UI 控件
-- =====================================================================

CREATE TABLE IF NOT EXISTS model_tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  parent_tag_id INTEGER REFERENCES model_tags(id),
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ui_controls (
  id SERIAL PRIMARY KEY,
  control_id VARCHAR(100) NOT NULL UNIQUE,
  control_name VARCHAR(200) NOT NULL,
  control_type VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  position_x VARCHAR(20) DEFAULT '0',
  position_y VARCHAR(20) DEFAULT '0',
  width VARCHAR(20) DEFAULT 'auto',
  height VARCHAR(20) DEFAULT 'auto',
  position_type VARCHAR(20) DEFAULT 'fixed',
  h_align VARCHAR(10) DEFAULT 'left',
  v_align VARCHAR(10) DEFAULT 'top',
  mobile_position_x VARCHAR(20),
  mobile_position_y VARCHAR(20),
  mobile_width VARCHAR(20),
  mobile_height VARCHAR(20),
  style_config JSONB DEFAULT '{}',
  is_visible BOOLEAN DEFAULT true,
  is_enabled BOOLEAN DEFAULT true,
  z_index INTEGER DEFAULT 1000,
  related_module VARCHAR(100),
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

-- =====================================================================
-- =====================================================================
-- 前置兼容：为旧表添加缺失的列（ADD COLUMN IF NOT EXISTS 是幂等安全的）
-- 放在所有 CREATE TABLE 之后、CREATE INDEX 之前，确保表已存在
-- =====================================================================
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'ai_generated';
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS auto_tags JSONB DEFAULT '{}';
ALTER TABLE geometry_buildings ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'building';
ALTER TABLE geometry_buildings ADD COLUMN IF NOT EXISTS auto_tags JSONB DEFAULT '{}';
ALTER TABLE uploaded_models ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'uploaded';
ALTER TABLE uploaded_models ADD COLUMN IF NOT EXISTS auto_tags JSONB DEFAULT '{}';
ALTER TABLE federation_templates ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE model_tags ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'general';
ALTER TABLE ui_controls ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'general';
ALTER TABLE custom_npcs ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);

-- 补充旧表可能缺失的 updated_at 列（v_all_models 视图依赖）
ALTER TABLE geometry_buildings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE uploaded_models ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE generated_buildings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 补充 admin_users 旧表可能缺失的列
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'admin';
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(50);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 补充 world_weather 旧表可能缺失的列
ALTER TABLE world_weather ADD COLUMN IF NOT EXISTS sky_mode VARCHAR(50) DEFAULT 'default';
ALTER TABLE world_weather ADD COLUMN IF NOT EXISTS fog_enabled BOOLEAN DEFAULT false;
ALTER TABLE world_weather ADD COLUMN IF NOT EXISTS fog_density FLOAT DEFAULT 0.5;
ALTER TABLE world_weather ADD COLUMN IF NOT EXISTS fog_color VARCHAR(20) DEFAULT '#cccccc';
ALTER TABLE world_weather ADD COLUMN IF NOT EXISTS intensity FLOAT DEFAULT 1.0;
ALTER TABLE world_weather ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 0;
ALTER TABLE world_weather ADD COLUMN IF NOT EXISTS start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE world_weather ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;
ALTER TABLE world_weather ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- =====================================================================
-- 第八部分：索引
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_plots_owner_id ON plots(owner_id);
CREATE INDEX IF NOT EXISTS idx_shops_merchant_id ON shops(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_monsters_active ON monsters(is_active);
CREATE INDEX IF NOT EXISTS idx_portals_active ON portals(is_active);
CREATE INDEX IF NOT EXISTS idx_portal_logs_character ON portal_logs(character_id);
CREATE INDEX IF NOT EXISTS idx_geometry_buildings_user_id ON geometry_buildings(user_id);
CREATE INDEX IF NOT EXISTS idx_geometry_buildings_template_id ON geometry_buildings(template_id);
CREATE INDEX IF NOT EXISTS idx_geometry_buildings_created_at ON geometry_buildings(created_at);
CREATE INDEX IF NOT EXISTS idx_geometry_buildings_tags ON geometry_buildings USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_geometry_category ON geometry_buildings(category);
CREATE INDEX IF NOT EXISTS idx_uploaded_models_file_type ON uploaded_models(file_type);
CREATE INDEX IF NOT EXISTS idx_uploaded_models_created_at ON uploaded_models(created_at);
CREATE INDEX IF NOT EXISTS idx_uploaded_models_tags ON uploaded_models USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_uploaded_category ON uploaded_models(category);
CREATE INDEX IF NOT EXISTS idx_generated_buildings_status ON generated_buildings(status);
CREATE INDEX IF NOT EXISTS idx_generated_buildings_tags ON generated_buildings USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_buildings_tags ON buildings USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_buildings_category ON buildings(category);
CREATE INDEX IF NOT EXISTS idx_ai_providers_type ON ai_providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_ai_providers_enabled ON ai_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_provider ON ai_provider_configs(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_provider_audit_log_provider ON ai_provider_audit_log(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_provider_audit_log_time ON ai_provider_audit_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_config_key ON game_config(config_key);
CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config(config_key);
CREATE INDEX IF NOT EXISTS idx_ad_slots_active ON ad_slots(is_active);
CREATE INDEX IF NOT EXISTS idx_ad_slots_rent_end ON ad_slots(rent_end);
CREATE INDEX IF NOT EXISTS idx_reward_codes_pool ON reward_codes(pool_id);
CREATE INDEX IF NOT EXISTS idx_reward_codes_claimed ON reward_codes(is_claimed);
CREATE INDEX IF NOT EXISTS idx_world_drops_active ON world_drops(is_picked, expires_at);
CREATE INDEX IF NOT EXISTS idx_player_inventory_user ON player_inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_player_inventory_unread ON player_inventory(user_id, is_used);
CREATE INDEX IF NOT EXISTS idx_npcs_active ON npcs(is_active);
CREATE INDEX IF NOT EXISTS idx_npc_chat_npc ON npc_chat_history(npc_id, player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_teleport_history_user ON teleport_history(user_id);
CREATE INDEX IF NOT EXISTS idx_teleport_history_time ON teleport_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trusted_worlds_enabled ON trusted_worlds(enabled);
CREATE INDEX IF NOT EXISTS idx_ai_scenes_user_id ON ai_generated_scenes(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_scenes_scene_type ON ai_generated_scenes(scene_type);
CREATE INDEX IF NOT EXISTS idx_ai_scenes_is_public ON ai_generated_scenes(is_public);
CREATE INDEX IF NOT EXISTS idx_ai_scenes_created_at ON ai_generated_scenes(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_scenes_tags ON ai_generated_scenes USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_ai_scene_favorites_user_id ON ai_scene_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_scene_favorites_scene_id ON ai_scene_favorites(scene_id);
CREATE INDEX IF NOT EXISTS idx_world_objects_type ON world_objects(type);
CREATE INDEX IF NOT EXISTS idx_world_objects_building_id ON world_objects(building_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_user_id ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_admin_user_id ON admin_action_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_created_at ON admin_action_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_federation_templates_category ON federation_templates(category);
CREATE INDEX IF NOT EXISTS idx_custom_npcs_created_by ON custom_npcs(created_by);
CREATE INDEX IF NOT EXISTS idx_model_tags_category ON model_tags(category);
CREATE INDEX IF NOT EXISTS idx_model_tags_name ON model_tags(name);
CREATE INDEX IF NOT EXISTS idx_ui_controls_category ON ui_controls(category);
CREATE INDEX IF NOT EXISTS idx_ui_controls_type ON ui_controls(control_type);
CREATE INDEX IF NOT EXISTS idx_ui_controls_visible ON ui_controls(is_visible);

-- =====================================================================
-- 第九部分：视图、函数、触发器
-- =====================================================================

-- 先删除旧视图再重建：列类型变更时 CREATE OR REPLACE VIEW 会失败
DROP VIEW IF EXISTS v_all_models CASCADE;

CREATE OR REPLACE VIEW v_all_models AS
SELECT
  'geometry' as source,
  id::text as model_id,
  name,
  description,
  template_id as model_type,
  NULL as model_path,
  tags,
  category,
  auto_tags,
  created_at,
  updated_at
FROM geometry_buildings
UNION ALL
SELECT
  'uploaded' as source,
  id::text as model_id,
  file_name as name,
  description,
  file_type as model_type,
  path as model_path,
  tags,
  category,
  auto_tags,
  created_at,
  updated_at
FROM uploaded_models
UNION ALL
SELECT
  'ai_building' as source,
  id::text as model_id,
  name,
  COALESCE(description, prompt) as description,
  'ai_generated' as model_type,
  COALESCE(model_url, local_path) as model_path,
  tags,
  'ai_generated' as category,
  '{}'::jsonb as auto_tags,
  created_at,
  updated_at
FROM generated_buildings
WHERE status = 'completed' AND (model_url IS NOT NULL OR local_path IS NOT NULL);

CREATE OR REPLACE FUNCTION search_models_by_tags(
  search_tags TEXT[],
  search_category VARCHAR DEFAULT NULL,
  limit_count INTEGER DEFAULT 20
)
RETURNS TABLE (
  source VARCHAR,
  model_id TEXT,
  name VARCHAR,
  description TEXT,
  tags TEXT[],
  category VARCHAR,
  match_score INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.source,
    v.model_id,
    v.name,
    v.description,
    v.tags,
    v.category,
    (SELECT COUNT(*) FROM unnest(v.tags) tag WHERE tag = ANY(search_tags))::INTEGER as match_score
  FROM v_all_models v
  WHERE
    (search_category IS NULL OR v.category = search_category)
    AND v.tags && search_tags
  ORDER BY match_score DESC, v.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_tag_usage_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE model_tags
    SET usage_count = usage_count + 1
    WHERE name = ANY(NEW.tags);
  END IF;

  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    UPDATE model_tags
    SET usage_count = GREATEST(0, usage_count - 1)
    WHERE name = ANY(OLD.tags);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_ui_controls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_ai_scenes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_geometry_tags_usage ON geometry_buildings;
CREATE TRIGGER trg_geometry_tags_usage
  AFTER INSERT OR UPDATE OF tags OR DELETE ON geometry_buildings
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

DROP TRIGGER IF EXISTS trg_uploaded_tags_usage ON uploaded_models;
CREATE TRIGGER trg_uploaded_tags_usage
  AFTER INSERT OR UPDATE OF tags OR DELETE ON uploaded_models
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

DROP TRIGGER IF EXISTS trg_buildings_tags_usage ON buildings;
CREATE TRIGGER trg_buildings_tags_usage
  AFTER INSERT OR UPDATE OF tags OR DELETE ON buildings
  FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

DROP TRIGGER IF EXISTS trigger_ui_controls_updated_at ON ui_controls;
CREATE TRIGGER trigger_ui_controls_updated_at
    BEFORE UPDATE ON ui_controls
    FOR EACH ROW
    EXECUTE FUNCTION update_ui_controls_updated_at();

DROP TRIGGER IF EXISTS trigger_update_ai_scenes_updated_at ON ai_generated_scenes;
CREATE TRIGGER trigger_update_ai_scenes_updated_at
    BEFORE UPDATE ON ai_generated_scenes
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_scenes_updated_at();

-- =====================================================================
-- 第十部分：种子数据
-- =====================================================================

INSERT INTO admin_users (username, password_hash, email, full_name, role) VALUES
('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMye/pKq3g.zhCdPMKdYH5B4M5HJq3VXQW', 'admin@example.com', '系统管理员', 'super_admin')
ON CONFLICT (username) DO NOTHING;

INSERT INTO ai_providers (provider_name, display_name, provider_type, is_enabled, is_default, config_schema, description) VALUES
('tencent_hunyuan', '腾讯混元（对话+3D）', 'chat,image_to_3d', true, true,
 '{"fields": [
    {"key": "secret_id", "label": "Secret ID", "type": "text", "required": true, "sensitive": true, "placeholder": "AKID开头的字符串"},
    {"key": "secret_key", "label": "Secret Key", "type": "password", "required": true, "sensitive": true, "placeholder": "32位字符串"},
    {"key": "region", "label": "地域", "type": "select", "required": true, "sensitive": false, "options": ["ap-guangzhou", "ap-shanghai", "ap-beijing"], "default": "ap-guangzhou"},
    {"key": "enable_chat", "label": "启用对话功能", "type": "checkbox", "required": false, "sensitive": false, "default": true},
    {"key": "enable_3d", "label": "启用3D生成功能", "type": "checkbox", "required": false, "sensitive": false, "default": true}
  ], "features": ["chat", "image_to_3d", "text_to_3d"]}'::jsonb,
 '腾讯混元大模型，支持AI对话、图片生3D模型、文字生成3D等多种功能'
),
('aliyun_qianwen', '阿里通义千问', 'chat', false, false,
 '{"fields": [
    {"key": "api_key", "label": "API Key", "type": "password", "required": true, "sensitive": true, "placeholder": "sk-开头的密钥"},
    {"key": "base_url", "label": "API地址", "type": "text", "required": false, "sensitive": false, "default": "https://dashscope.aliyuncs.com/api/v1", "placeholder": "https://dashscope.aliyuncs.com/api/v1"},
    {"key": "model", "label": "模型", "type": "select", "required": true, "sensitive": false, "options": ["qwen-max", "qwen-plus", "qwen-turbo"], "default": "qwen-plus"}
  ]}'::jsonb,
 '阿里云通义千问大模型，支持对话、文本生成等'
),
('bytedance_doubao', '字节豆包', 'chat', false, false,
 '{"fields": [
    {"key": "api_key", "label": "API Key", "type": "password", "required": true, "sensitive": true, "placeholder": "输入豆包API密钥"},
    {"key": "endpoint_id", "label": "接入点ID", "type": "text", "required": true, "sensitive": false, "placeholder": "ep-开头的ID"},
    {"key": "base_url", "label": "API地址", "type": "text", "required": false, "sensitive": false, "default": "https://ark.cn-beijing.volces.com/api/v3", "placeholder": "https://ark.cn-beijing.volces.com/api/v3"}
  ]}'::jsonb,
 '字节跳动豆包大模型，支持对话、文本生成等'
),
('tencent_hunyuan3d', '腾讯混元3D', 'image_to_3d,text_to_3d', false, false,
 '{"fields": [
    {"key": "secret_id", "label": "Secret ID", "type": "text", "required": true, "sensitive": true, "placeholder": "AKID开头的字符串"},
    {"key": "secret_key", "label": "Secret Key", "type": "password", "required": true, "sensitive": true, "placeholder": "32位字符串"},
    {"key": "region", "label": "地域", "type": "select", "required": true, "sensitive": false, "options": ["ap-guangzhou", "ap-shanghai", "ap-beijing"], "default": "ap-guangzhou"}
  ]}'::jsonb,
 '腾讯混元3D，支持图片转3D模型、文字生成3D等'
),
('tripo_ai', 'Tripo AI', 'image_to_3d,text_to_3d', false, false,
 '{"fields": [
    {"key": "api_token", "label": "API Token", "type": "password", "required": true, "sensitive": true, "placeholder": "Tripo AI API Token"}
  ]}'::jsonb,
 'Tripo AI，支持图片转3D模型、文字生成3D等'
)
ON CONFLICT (provider_name) DO NOTHING;

INSERT INTO ui_controls (control_id, control_name, control_type, category, position_x, position_y, width, height, mobile_position_x, mobile_position_y, mobile_width, mobile_height, related_module, description) VALUES
('mobile_joystick', '移动摇杆', 'joystick', 'mobile', '24px', 'auto', '150px', '150px', '24px', '100px', '150px', '150px', 'mobileControls.js', '左下角虚拟摇杆，控制角色移动'),
('mobile_jump_btn', '跳跃按钮', 'button', 'mobile', 'auto', '24px', '70px', '70px', 'auto', '24px', '70px', '70px', 'mobileControls.js', '右下角跳跃按钮'),
('mobile_sprint_btn', '冲刺按钮', 'button', 'mobile', 'auto', '24px', '60px', '60px', 'auto', '24px', '60px', '60px', 'mobileControls.js', '冲刺/加速按钮'),
('mobile_camera_toggle_btn', '视角切换按钮', 'button', 'mobile', 'auto', '24px', '60px', '60px', 'auto', '24px', '60px', '60px', 'mobileControls.js', '第一/第三人称视角切换'),
('btn_profile', '个人资料', 'button', 'desktop', '95%', '2%', '48px', '48px', '95%', '2%', '48px', '48px', 'ui.js', '右上角个人资料按钮'),
('btn_inventory', '物品管理', 'button', 'desktop', '95%', '8%', '48px', '48px', '95%', '8%', '48px', '48px', 'ui.js', '右上角物品管理按钮'),
('skill_hud', '技能栏', 'panel', 'general', 'auto', '90%', 'auto', '58px', 'auto', '85%', 'auto', '58px', 'skillHUD.js', '屏幕底部技能栏'),
('skill_voice_btn', '语音按钮', 'button', 'general', 'auto', '90%', '58px', '58px', 'auto', '85%', '58px', '58px', 'skillHUD.js', '语音输入按钮'),
('health_bar', '血条', 'healthbar', 'general', '20px', '20px', '300px', '30px', '10px', '10px', '200px', '25px', 'ui.js', '左上角生命值显示'),
('minimap', '小地图', 'minimap', 'general', 'auto', '20px', '200px', '200px', 'auto', '10px', '120px', '120px', 'ui.js', '右上角小地图'),
('portal_btn', '世界传送门按钮', 'button', 'general', '20px', '60px', 'auto', 'auto', '10px', '50px', 'auto', 'auto', 'portalManager.js', '打开传送门界面'),
('federation_portal_btn', '联邦传送门按钮', 'button', 'general', '20px', '200px', 'auto', 'auto', '10px', '100px', 'auto', 'auto', 'federationUI.js', '打开联邦世界传送界面'),
('performance_monitor', '性能监控面板', 'panel', 'general', 'auto', 'auto', '200px', '120px', 'auto', 'auto', '150px', '100px', 'performance-optimization.js', '显示FPS和性能指标')
ON CONFLICT (control_id) DO NOTHING;

INSERT INTO model_tags (name, category, description) VALUES
('建筑物', 'type', '各类建筑结构'),
('自然景观', 'type', '山川、树木等自然元素'),
('交通工具', 'type', '车辆、船只等'),
('装饰物', 'type', '装饰性物品'),
('动物', 'type', '各类动物模型'),
('植物', 'type', '花草树木'),
('道具', 'type', '游戏道具、物品'),
('家具', 'type', '室内外家具'),
('现代', 'style', '现代风格'),
('古典', 'style', '古典传统风格'),
('科幻', 'style', '科幻未来风格'),
('魔幻', 'style', '魔幻奇幻风格'),
('中式', 'style', '中国传统风格'),
('欧式', 'style', '欧洲风格'),
('日式', 'style', '日本风格'),
('卡通', 'style', '卡通风格'),
('微型', 'size', '非常小的物体'),
('小型', 'size', '小型物体'),
('中型', 'size', '中等大小'),
('大型', 'size', '大型物体'),
('巨型', 'size', '超大型物体'),
('城市', 'theme', '城市场景相关'),
('乡村', 'theme', '乡村场景相关'),
('森林', 'theme', '森林场景'),
('沙漠', 'theme', '沙漠场景'),
('雪地', 'theme', '雪地冰川'),
('海洋', 'theme', '海洋海滩'),
('太空', 'theme', '太空场景'),
('地下城', 'theme', '地下城场景'),
('废墟', 'theme', '废弃场景'),
('住宅', 'function', '居住类建筑'),
('商业', 'function', '商业建筑'),
('工业', 'function', '工业建筑'),
('娱乐', 'function', '娱乐设施'),
('军事', 'function', '军事设施'),
('宗教', 'function', '宗教建筑'),
('交通', 'function', '交通设施'),
('可交互', 'attribute', '可以交互的物体'),
('动态', 'attribute', '有动画的物体'),
('发光', 'attribute', '自发光物体'),
('透明', 'attribute', '透明或半透明'),
('高精度', 'attribute', '高精度模型'),
('低多边形', 'attribute', '低多边形风格')
ON CONFLICT (name) DO NOTHING;

INSERT INTO world_weather (weather_type, sky_mode, fog_enabled, fog_density, intensity) VALUES
('sunny', 'default', false, 0.0, 1.0),
('rainy', 'cloudy', true, 0.3, 0.5),
('cloudy', 'cloudy', false, 0.0, 0.8),
('snowy', 'foggy', true, 0.5, 0.6),
('foggy', 'foggy', true, 0.8, 0.4)
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM world_rules LIMIT 1) THEN
    INSERT INTO world_rules (world_type, pvp_enabled, pve_enabled, allow_foreign_attack, damage_multiplier, allow_skill_types)
    VALUES ('normal', FALSE, TRUE, FALSE, 1.0, ARRAY['perform','build']);
  END IF;
END $$;

-- =====================================================================
-- 初始化完成
-- =====================================================================
DO $$ BEGIN
    RAISE NOTICE '数据库初始化完成：所有表、索引、视图、触发器、种子数据已就绪';
END $$;

-- =====================================================================
-- 3DGS 场景管理表（Spark 2.0 高斯溅射场景）
-- =====================================================================
CREATE TABLE IF NOT EXISTS scene_3dgs (
  id SERIAL PRIMARY KEY,
  scene_name VARCHAR(255) NOT NULL,
  description TEXT,
  scene_type VARCHAR(50) DEFAULT 'outdoor',
  source_type VARCHAR(50) DEFAULT 'upload',
  rad_file_path VARCHAR(500),
  rad_file_url VARCHAR(500),
  file_size BIGINT DEFAULT 0,
  thumbnail_url VARCHAR(500),
  splat_count INTEGER DEFAULT 0,
  lod_levels INTEGER DEFAULT 8,
  is_public BOOLEAN DEFAULT true,
  view_count INTEGER DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION update_scene_3dgs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scene_3dgs_updated_at ON scene_3dgs;
CREATE TRIGGER trg_scene_3dgs_updated_at
  BEFORE UPDATE ON scene_3dgs
  FOR EACH ROW EXECUTE FUNCTION update_scene_3dgs_updated_at();

CREATE INDEX IF NOT EXISTS idx_scene_3dgs_source_type ON scene_3dgs(source_type);
CREATE INDEX IF NOT EXISTS idx_scene_3dgs_scene_type  ON scene_3dgs(scene_type);
CREATE INDEX IF NOT EXISTS idx_scene_3dgs_is_public   ON scene_3dgs(is_public);
CREATE INDEX IF NOT EXISTS idx_scene_3dgs_created_at  ON scene_3dgs(created_at DESC);

