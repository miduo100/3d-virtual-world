-- =====================================================================
-- 安全问题系统：可配置的安全问题池 + 用户绑定
-- =====================================================================

-- 安全问题选项表（管理员可增删）
CREATE TABLE IF NOT EXISTS security_questions (
  id SERIAL PRIMARY KEY,
  question_text VARCHAR(200) NOT NULL UNIQUE,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- users 表扩展：关联安全问题
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_question_id INT REFERENCES security_questions(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_answer VARCHAR(255);

-- 初始化默认4个安全问题
INSERT INTO security_questions (question_text, sort_order) VALUES
  ('你的出生日期', 1),
  ('你的手机号', 2),
  ('你的身份证号', 3),
  ('你前女友的名字', 4)
ON CONFLICT (question_text) DO NOTHING;

-- 重置密码临时令牌表（找回密码步骤2→3用）
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, used);
CREATE INDEX IF NOT EXISTS idx_security_questions_active ON security_questions(is_active);
