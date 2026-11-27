-- =====================================================================
-- 重置为「干净世界」：清除本世界的身份、联邦关系、用户与业务内容
-- 保留：默认管理员(admin_users)、UI 控件(ui_controls=16)、模型标签(model_tags=43)、
--       AI 服务商默认行、天气预设(world_weather)、世界规则(world_rules)、
--       默认地形(terrains)、默认安全问题(security_questions)、其余 system_config 配置
--
-- 用途：产出可分发的新世界初始库（db_clean.sql）。也可在「想重新开局」的环境上执行，
--       执行后重启服务会自动生成新的 worldId 与密钥对。
--
-- 注意：不可回滚。执行前请备份数据库。
-- =====================================================================

-- 1) 世界身份（重启服务后由系统重新生成 worldId / world_name / world_url / 密钥对）
DELETE FROM world_config    WHERE key = 'federation_config';
DELETE FROM system_config   WHERE config_key IN (
  'world_id', 'world_name', 'world_url', 'world_description', 'first_deploy_date',
  -- 历史版本使用数字键存同一批配置（兼容老库）
  '147', '20', '21', '22', '148'
);

-- 2) 联邦关系
DELETE FROM trusted_worlds;
DELETE FROM pending_trust_requests;
DELETE FROM teleport_history;
DELETE FROM federation_templates;
DELETE FROM token_usage;

-- 3) 用户 / 角色 / 经济 / 内容
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- World AI：实体与活动（子表在前）
    'world_entity_parts', 'world_entities',
    'world_activity_participants', 'world_activities',
    'world_task_progress', 'world_tasks',
    'world_plan_steps', 'world_plans', 'world_approvals',
    'world_goals', 'world_missions', 'world_build_missions', 'world_regions',
    'world_interactions', 'world_memories', 'world_events',
    'world_tool_executions', 'world_metrics_daily',
    'world_ai_experiments', 'world_gen3d_jobs',
    'world_ai_credentials', 'world_ai_configs',
    -- Agent
    'agent_sessions', 'agent_transient_sessions', 'agent_api_keys', 'agents',
    -- 用户与角色
    'player_inventory', 'character_appearance', 'characters',
    'world_reward_grants', 'reward_codes', 'reward_pools',
    'wallet_transactions', 'wallets', 'orders',
    'equipment', 'user_subscriptions',
    -- 内容 / 资产
    'part_library_items', 'part_libraries',
    'template_skills', 'character_templates',
    'animation_library', 'bone_mappings',
    'weapon_skills', 'weapons', 'skills',
    'resource_references',
    'world_objects', 'uploaded_models',
    'portals', 'portal_logs',
    'npcs', 'custom_npcs', 'npc_chat_history',
    'monsters', 'monster_drops', 'world_drops',
    'buildings', 'plots', 'generated_buildings', 'geometry_buildings',
    'ad_slots', 'gallery_configs', 'gallery_items',
    'shop_items', 'shops',
    'threejs_code_blocks', 'scene_3dgs',
    'ai_generated_scenes', 'ai_scene_favorites',
    'model_bounds', 'object_transform_overrides',
    -- 日志与审计
    'world_chat_log', 'ai_call_log', 'ai_provider_audit_log', 'ai_provider_configs',
    'admin_sessions', 'admin_action_logs',
    'login_attempts', 'account_lockouts', 'password_reset_tokens',
    'config_audit_log', 'maintenance_logs',
    -- 用户表放到最后（被大量表引用）
    'users'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      BEGIN
        EXECUTE format('DELETE FROM public.%I', t);
      EXCEPTION WHEN foreign_key_violation THEN
        -- 依赖顺序导致的残留：由后序表清理后再由调用方重跑一次即可（干净库不会触发）
        RAISE NOTICE 'skip % (foreign key still referenced)', t;
      END;
    END IF;
  END LOOP;
END $$;

-- 4) 自增序列归零（避免新环境 id 从历史值开始）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS seq
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'S' AND n.nspname = 'public'
  LOOP
    BEGIN
      EXECUTE format('ALTER SEQUENCE public.%I RESTART WITH 1', r.seq);
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
END $$;

ANALYZE;
