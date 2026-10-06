-- LLM 调用账本（AI World Brain · Phase 0）
-- 用途：成本核算 / 按 token 限流 / 熔断依据 / 事后归因
-- 幂等：可重复执行
--
-- 设计要点：
--   1. 不存任何密钥或 prompt 全文（prompt 可能含用户数据）→ 只存用途/模型/token/耗时/成败
--   2. provider_id 不加外键：provider 可被删除，账本要留住历史
--   3. 便于聚合的索引：按用途+时间、按 provider+时间、成功/失败
--   4. created_at 用 TIMESTAMPTZ，与项目其它表一致

CREATE TABLE IF NOT EXISTS ai_call_log (
  id              BIGSERIAL PRIMARY KEY,
  purpose         VARCHAR(40),          -- plan | tool_select | summary | tag | image | ping | custom
  provider_id     INTEGER,              -- 不加 FK：provider 被删后账本仍留史
  provider_name   VARCHAR(100),
  adapter         VARCHAR(30),          -- openai-compatible | anthropic | gemini | dashscope-legacy
  model           VARCHAR(160),
  caller          VARCHAR(120),         -- 调用方标识（如 autoTagService.batchTagModels）
  ok              BOOLEAN NOT NULL DEFAULT TRUE,
  error_code      VARCHAR(60),
  error_message   VARCHAR(400),
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  attempts        SMALLINT    NOT NULL DEFAULT 1,   -- 含重试次数
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_purpose_time ON ai_call_log(purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_provider_time ON ai_call_log(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_fail ON ai_call_log(created_at DESC) WHERE ok = FALSE;

COMMENT ON TABLE  ai_call_log IS 'LLM 调用账本（只存元数据与 token 数，绝不存密钥与 prompt 全文）';
COMMENT ON COLUMN ai_call_log.purpose IS '调用用途，决定预算与降级策略';
COMMENT ON COLUMN ai_call_log.attempts IS '实际发出的请求次数（429/5xx 会 >1）';
COMMENT ON COLUMN ai_call_log.adapter IS 'wire format 适配器名，决定报文结构';
