-- 迁移：创建联邦信任审批表 pending_trust_requests
-- 用途：联邦系统待审批的信任请求，federationTrustManager.js 依赖此表
-- 说明：幂等脚本，表已存在时静默跳过，可安全重复执行
CREATE TABLE IF NOT EXISTS pending_trust_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id VARCHAR(255) UNIQUE NOT NULL,
  world_name VARCHAR(255),
  world_url TEXT,
  public_key TEXT,
  source_ip VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pending_trust_status ON pending_trust_requests(status);
CREATE INDEX IF NOT EXISTS idx_pending_trust_world_id ON pending_trust_requests(world_id);
