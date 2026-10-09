/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'virtual_world',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

async function initializeDatabase() {
  // 第1步：执行 init.sql（独立 try-catch）
  try {
    // 统一使用 database/init.sql 作为唯一权威初始化文件
    // 路径相对于项目根目录：src/database/db.js -> ../../database/init.sql
    const initPath = path.join(__dirname, '..', '..', 'database', 'init.sql');
    const initSQL = await fs.readFile(initPath, 'utf-8');

    await pool.query(initSQL);
    console.log('Database initialized from database/init.sql');
  } catch (error) {
    console.error('Database initialization error:', error);
    // 不抛出错误，让服务器继续运行
  }

  // 第2步：执行迁移脚本（独立于 init.sql，即使 init.sql 失败也会执行）
  const migrations = [
    // 'add_ui_controls_alignment.sql',  // 已执行完毕，重复执行会覆盖用户配置的 h_align/v_align
    'gallery_init.sql',
    'migrations/add_ad_slot_portal_fields.sql',
    'add_security_questions.sql',
    'add_login_attempts.sql',
    'migrations/add_system_config.sql',
    'migrations/add_user_subscriptions.sql',
    'migrations/add_payment_reference.sql',
    'migrations/add_world_id_to_subscriptions.sql',
    'migrations/fix_subscription_user_id.sql',
    'migrations/add_has_collision.sql',
    'add_threejs_code_blocks.sql',
    'migrations/add_federation_trust_approval.sql',
    'migrations/add_custom_config.sql',
    'migrations/add_spatial_paging_indexes.sql',
    'migrations/add_world_objects_is_locked.sql',
    'migrations/add_agents.sql',
    'migrations/add_agent_sessions.sql',
    'migrations/add_world_chat_log.sql',
    'migrations/add_federation_nonce.sql',  // P5: 联邦传送 nonce 防重放 + transient session 表
    'migrations/add_agent_push_tier.sql',   // P8 后续: 每个 Key Agent 独立推送档 + 删除能力
    'migrations/add_world_objects_agent_description.sql',  // 🤖 AI 物体描述（observe 下发给 Agent）
    'migrations/add_part_libraries.sql',  // Phase 1: 零件库（part_libraries / part_library_items / uploaded_models+pack_id,part_category）
    'migrations/add_part_libraries_trash.sql',  // 零件库回收站（prev_status / deleted_at：软删除→恢复/清空）
    'migrations/add_part_libraries_source_path.sql',  // 撞名错开（source_path：同名不同包不混库）
    'migrations/add_ai_call_log.sql',     // Phase 0: LLM 调用账本（成本/token 限流/熔断依据）
    'migrations/add_threejs_code_blocks_meta.sql',  // Phase 0: 补 source_type/auto_fixes/import_status（原先只存在于现库，新环境会缺列）
    'migrations/add_world_ai_configs.sql',       // Phase 2a: World AI 配置（每世界一行，含 autonomy/provider_map）
    'migrations/add_world_ai_credentials.sql',    // Phase 2a: World AI 专用凭证（bcrypt + world:* scope）
    'migrations/add_world_objects_origin.sql',   // Phase 3.5-1: world_objects 归属四列（origin 默认 human = 用户红线）
    'migrations/add_world_regions.sql',          // Phase 3.5-1: 区域（矩形 bounds + autonomy 无默认值 + gridsnap）
    'migrations/add_world_build_missions.sql',   // Phase 3.5-1: 建设委托（autonomy_snapshot + provider_resolution）
    'migrations/add_world_interactions.sql',     // Phase 3.5-1: 可交互点（极简玩法 reward_grant）
    'migrations/add_world_tasks_mini.sql',       // Phase 3.5-1: 极简引导任务 + 进度
    'migrations/add_ai_call_log_refs.sql',        // Phase 3.5-1: ai_call_log 加mission_id/region_key/context_meta（委托级预算查表计数）
    'migrations/add_world_reward_grants.sql',     // Phase 3.5-2: Agent 领取记录（Agent 无 users 行 → 无法写 player_inventory，见迁移文件头）
    'migrations/add_world_goals.sql',             // Phase 3: 世界目标与愿景（hard_rules/soft_prefs）
    'migrations/add_world_plans.sql',             // Phase 3: World Plan 审批主体 + 执行步骤（draft→review→approved）
    'migrations/add_world_approvals.sql',         // Phase 3: 人工审批（Plan 级，Tool 级 Phase 4 共用）
    'migrations/add_world_memories.sql',          // Phase 3: World AI 持久记忆（P2-8；压缩/遗忘定时属 Phase 4）
    'migrations/add_world_events.sql',            // Phase 4: 全站唯一事件流（唯一写入器 perception/eventLog.js）
    'migrations/add_world_tool_executions.sql',   // Phase 4: 工具执行账本（before/after/undo + 每日预算查表口径）
    'migrations/add_world_metrics_daily.sql',      // Phase 4: 日聚合表（区域热度/参与率 6 指标）
    'migrations/add_world_entities.sql'            // Phase 5: world_entities + world_entity_parts（完整实体 = N 个 world_object + 1 Entity 索引）
  ];
  for (const migFile of migrations) {
    const migrationPath = path.join(__dirname, '..', '..', 'database', migFile);
    try {
      const migrationSQL = await fs.readFile(migrationPath, 'utf-8');
      await pool.query(migrationSQL);
      console.log('迁移脚本已执行:', migFile);
    } catch (migErr) {
      console.log('迁移脚本跳过（可能已执行或文件不存在）:', migFile, migErr.message);
    }
  }
}

async function query(text, params) {
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

module.exports = {
  query,
  pool,
  initializeDatabase,
};
