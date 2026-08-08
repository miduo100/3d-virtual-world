/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const { pool } = require('./database/db');
const fs = require('fs');
const path = require('path');

async function initSystemConfig() {
  try {
    console.log('开始初始化系统配置表...');
    
    const sqlPath = path.join(__dirname, 'database', 'init_system_config.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ 系统配置表初始化成功！');
    console.log('已创建以下表：');
    console.log('  - system_config (系统配置)');
    console.log('  - config_audit_log (配置审计日志)');
    console.log('\n默认配置项：');
    console.log('  - TENCENT_SECRET_ID (腾讯云SecretId)');
    console.log('  - TENCENT_SECRET_KEY (腾讯云SecretKey)');
    console.log('  - TENCENT_REGION (腾讯云地域)');
    console.log('  - HUNYUAN3D_ENABLED (是否启用混元3D)');
    console.log('  - HUNYUAN3D_DEFAULT_QUALITY (默认模型质量)');
    console.log('  - HUNYUAN3D_MAX_TASKS (最大并发任务数)');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ 初始化失败:', error.message);
    process.exit(1);
  }
}

initSystemConfig();
