-- Phase 2a · 队列项 1：World AI 配置表（每世界一行）
-- 设计来源：AI-World-Brain-架构审查与改造方案.md §C.3 ①
-- 纪律：API Key 永不落这张表（厂商 Key 在 ai_provider_configs 加密存储），
--       provider_id / provider_map 只存引用。
CREATE TABLE IF NOT EXISTS world_ai_configs (
  id            SERIAL PRIMARY KEY,
  world_id      VARCHAR(100) UNIQUE NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT false,      -- 总闸，默认关
  provider_id   INTEGER,                             -- → ai_providers.id（不强制 FK）
  model         VARCHAR(150),
  system_prompt TEXT,
  temperature   REAL    NOT NULL DEFAULT 0.4,
  max_tokens    INTEGER NOT NULL DEFAULT 4000,
  -- 权限与风险
  allowed_scopes   TEXT[] NOT NULL DEFAULT '{}',
  allowed_regions  UUID[],
  risk_policy      JSONB NOT NULL DEFAULT '{"low":"auto","medium":"auto","high":"approve"}',
  autonomy         VARCHAR(20) NOT NULL DEFAULT 'managed',
                   -- 枚举与区域级同名同序：managed < semi_autonomous < autonomous（§I.3）
  provider_map     JSONB NOT NULL DEFAULT '{}',
                   -- 用途级厂商映射 { plan:3, tool_select:3, summary:2 }（§H.10.2）
  context_window_tokens INTEGER,
                   -- test-llm 窗口实测缓存；NULL = 未知 → 装配按保守 16k 计（§H.9.2）
  -- 预算
  budget       JSONB NOT NULL DEFAULT '{"toolsPerRun":12,"newObjectsPerRun":20,"toolsPerDay":200,"llmCallsPerDay":60,"tokensPerDay":2000000,"wallClockSecPerRun":180}',
  -- 调度
  schedule     JSONB NOT NULL DEFAULT '{"observeMin":10,"planHours":6,"optimizeHours":24}',
  runtime_state VARCHAR(20) NOT NULL DEFAULT 'stopped',  -- running|paused|stopped|error
  last_heartbeat_at TIMESTAMPTZ,
  last_error   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
