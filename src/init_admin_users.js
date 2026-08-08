/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const bcrypt = require('bcryptjs');
const { query } = require('./database/db');

async function initAdminUsers() {
  try {
    console.log('开始初始化管理员用户表...');
    console.log('');

    // 1. 创建 admin_users 表
    console.log('1️⃣ 创建 admin_users 表...');
    await query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(100),
        full_name VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        last_login_at TIMESTAMP,
        last_login_ip VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ admin_users 表创建成功');

    // 2. 创建 admin_sessions 表
    console.log('2️⃣ 创建 admin_sessions 表...');
    await query(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id SERIAL PRIMARY KEY,
        admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        ip_address VARCHAR(50),
        user_agent TEXT,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ admin_sessions 表创建成功');

    // 3. 创建 admin_action_logs 表
    console.log('3️⃣ 创建 admin_action_logs 表...');
    await query(`
      CREATE TABLE IF NOT EXISTS admin_action_logs (
        id SERIAL PRIMARY KEY,
        admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        resource VARCHAR(100),
        resource_id VARCHAR(100),
        details TEXT,
        ip_address VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ admin_action_logs 表创建成功');

    // 4. 创建索引
    console.log('4️⃣ 创建索引...');
    await query(`
      CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_user_id ON admin_sessions(admin_user_id)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_admin_action_logs_admin_user_id ON admin_action_logs(admin_user_id)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_admin_action_logs_created_at ON admin_action_logs(created_at)
    `);
    console.log('✅ 索引创建成功');

    // 5. 生成默认管理员密码哈希
    console.log('5️⃣ 创建默认管理员账号...');
    const defaultPassword = 'admin123456';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    // 6. 插入默认管理员
    await query(`
      INSERT INTO admin_users (username, password_hash, email, full_name)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (username) DO NOTHING
    `, ['admin', passwordHash, 'admin@virtualworld.com', '系统管理员']);

    // 7. 验证管理员是否存在
    const result = await query(`
      SELECT id, username, email, full_name, is_active 
      FROM admin_users 
      WHERE username = 'admin'
    `);

    if (result.rows.length > 0) {
      console.log('✅ 默认管理员账号创建成功');
      console.log('');
      console.log('========================================');
      console.log('✅ 管理员用户表初始化完成！');
      console.log('========================================');
      console.log('');
      console.log('📋 默认管理员账号信息：');
      console.log('   用户名: admin');
      console.log('   密码: admin123456');
      console.log('   邮箱: admin@virtualworld.com');
      console.log('');
      console.log('🌐 管理后台登录地址：');
      console.log('   http://localhost:3000/admin_login.html');
      console.log('');
      console.log('⚠️  重要提示：');
      console.log('   1. 请立即登录并修改默认密码');
      console.log('   2. 该账号独立于虚拟世界用户系统');
      console.log('   3. 普通用户无法访问管理后台');
      console.log('========================================');
      console.log('');
    } else {
      console.log('⚠️  管理员账号可能已存在');
    }

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('========================================');
    console.error('❌ 初始化失败');
    console.error('========================================');
    console.error('错误信息:', error.message);
    console.error('');
    
    if (error.message.includes('password authentication failed')) {
      console.error('💡 解决方法：');
      console.error('   检查 .env 文件中的数据库密码是否正确');
      console.error('   DB_PASSWORD=你的数据库密码');
    } else if (error.message.includes('connection')) {
      console.error('💡 解决方法：');
      console.error('   1. 确认 PostgreSQL 服务是否运行');
      console.error('   2. 检查 .env 文件中的数据库配置');
      console.error('   3. 确认数据库 virtual_world 已创建');
    }
    
    console.error('');
    process.exit(1);
  }
}

initAdminUsers();
