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
    'migrations/add_world_objects_is_locked.sql'
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
