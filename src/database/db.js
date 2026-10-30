/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;
// 与 src/server.js 保持同一口径：按文件位置定位 .env，而不是依赖 process.cwd()
// （宝塔/pm2 的工作目录未必是项目根；原来不带 path 会让 db.js 读不到 .env，
//  进而被迫使用默认值或面板注入的环境变量，排查时极易误判为"权限问题"）
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// 统一清洗配置值：Windows 记事本保存的 .env 常带 \r（CRLF），或在 = 两侧留空格，
// 会让库名/用户名/密码多出不可见字符，最终表现为「角色不存在 / 库不存在 / 密码错误」
// 这类极具误导性的报错（部署时最容易误判成权限问题）。
for (const _k of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'PORT']) {
  if (typeof process.env[_k] === 'string') process.env[_k] = process.env[_k].trim();
}

const DB_CFG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'virtual_world',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
};

/**
 * 把 PostgreSQL 原始错误码翻译成可执行的中文诊断。
 * 部署最常见的四类：库名大小写、角色不存在、密码错、连不上。
 */
function diagnoseDbError(err) {
  const code = err && err.code;
  const map = {
    '3D000': `数据库 "${DB_CFG.database}" 不存在。请确认已建库，且库名大小写完全一致`
      + `（PostgreSQL 建库不加引号会转小写，例如面板显示 Miduo200、实际库名是 miduo200）。`,
    '28000': `角色（数据库用户名）"${DB_CFG.user}" 不存在。请创建该用户或改用 postgres。`,
    '28P01': `用户 "${DB_CFG.user}" 密码错误。请让 .env 的 DB_PASSWORD 与 PostgreSQL 中该用户密码一致。`,
    'ECONNREFUSED': `连不上 PostgreSQL（${DB_CFG.host}:${DB_CFG.port}）。请确认服务已启动、端口正确、未被防火墙拦截。`,
    'ENOTFOUND': `解析不到数据库主机 "${DB_CFG.host}"。建议 DB_HOST 写 127.0.0.1（写 localhost 可能走 IPv6 被拒）。`,
  };
  return map[code] || null;
}

const pool = new Pool(DB_CFG);

// 启动时打印实际生效的连接目标（密码只报长度）：部署排障第一现场
console.log(`[DB] ${DB_CFG.user}@${DB_CFG.host}:${DB_CFG.port}/${DB_CFG.database} (pwdLen=${String(DB_CFG.password).length})`);

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
    const hint = diagnoseDbError(error);
    console.error('Database initialization error:', hint || error);
    if (hint) {
      console.error(`[DB] 当前目标：${DB_CFG.user}@${DB_CFG.host}:${DB_CFG.port}/${DB_CFG.database}`);
    }
    // 不抛出错误，让服务器继续运行
  }

  // 第2步：执行迁移脚本（独立于 init.sql，即使 init.sql 失败也会执行）
  const migrations = [
    // 'add_ui_controls_alignment.sql',  // 已执行完毕，重复执行会覆盖用户配置的 h_align/v_align
    'migrations/add_ui_controls_landscape_cols.sql',  // 补 landscape_* 横屏列（缺列会让「UI 控件」初始化静默失败、编辑器空白）
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
    'migrations/add_world_entities.sql',           // Phase 5: world_entities + world_entity_parts（完整实体 = N 个 world_object + 1 Entity 索引）
    'migrations/add_world_tasks_p6.sql',           // Phase 6: world_tasks/progress 差量补列（giver/objective_index/事件游标）
    'migrations/add_world_activities.sql',         // Phase 6: 活动 + 参与者（生命周期/排名/幂等结算）
    'migrations/add_wallets.sql',                  // Phase 6: 钱包 + 流水（原子扣减 + 幂等键）+ shops.merchant_id 放宽
    'migrations/add_ai_experiments.sql',           // Phase 7: A/B 实验（baseline 7d/实验 3d/同区域冷却 7d，自动回滚靠重放 change_steps）
    'migrations/add_world_gen3d_jobs.sql',         // Phase 8: 3D 生成任务账本（★落表，重启后仍可轮询 —— aiSceneGenerator:2310 内存 Map 的教训）
    'migrations/add_world_missions.sql',           // Phase 7b: 长期使命（§I.6；每世界同时最多 1 个 active）
    'migrations/add_terrains.sql',                 // 地形配置（一组参数 + seed，含内置"默认地形（平地）"）
    'migrations/add_terrain_zones_columns.sql',    // 地形区域化（补回丢失的 add_terrain_zones.sql 的 zone_* 兼容列）
    'migrations/add_terrain_areas.sql',            // 地形 = 地块：位置(中心 X/Z)、宽深、基准高度 base_y
    'migrations/add_maintenance_logs.sql'          // 系统维护执行日志（历史库靠运行时创建，新环境缺表 → 维护页 500）
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
