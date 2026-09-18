-- P4: 世界聊天记录（人类 + Agent 共用）
-- 写入点：src/websocket/wsServer.js CHAT 分支异步 INSERT（不阻塞广播）
-- 红线 13：语音只存元数据 "[语音 N秒]"，永不存 base64 音频本体
-- 保留期由 chat_log_retention_days 配置，归档成功前本地永不删除

CREATE TABLE IF NOT EXISTS world_chat_log (
  id BIGSERIAL PRIMARY KEY,
  sender_type VARCHAR(10) NOT NULL,          -- human | agent
  sender_id VARCHAR(80),                     -- characterId 或 agent:<uuid>
  sender_name VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  position JSONB,                            -- {x,y,z}，供 Agent 距离过滤
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_chat_log_created_at ON world_chat_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_world_chat_log_sender ON world_chat_log (sender_type, created_at DESC);
