-- ====================================
-- 管理后台独立认证系统 - 数据库初始化脚本
-- ====================================

-- 1. 创建管理员用户表
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
);

-- 2. 创建管理员会话表
CREATE TABLE IF NOT EXISTS admin_sessions (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  ip_address VARCHAR(50),
  user_agent TEXT,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. 创建管理员操作日志表
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

-- 4. 创建索引
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_user_id ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_admin_user_id ON admin_action_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_created_at ON admin_action_logs(created_at);

-- 5. 插入默认管理员账号
-- 默认账号: admin
-- 默认密码: admin123456
-- 密码哈希使用 bcryptjs，轮数为10
-- 注意：下面的哈希值需要在运行初始化脚本时生成
-- 临时使用的哈希（密码：admin123456）
INSERT INTO admin_users (username, password_hash, email, full_name)
VALUES (
  'admin',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',  -- admin123456
  'admin@virtualworld.com',
  '系统管理员'
) ON CONFLICT (username) DO NOTHING;

-- 6. 验证插入
SELECT id, username, email, full_name, is_active, created_at 
FROM admin_users 
WHERE username = 'admin';

-- ====================================
-- 初始化完成
-- ====================================

-- 默认管理员登录信息：
-- 用户名：admin
-- 密码：admin123456
-- 
-- ⚠️ 重要：请在首次登录后立即修改密码！
--
-- 登录地址：http://localhost:3000/admin_login.html
