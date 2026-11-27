-- world_sfx_jobs —— AI 音效生成任务账本
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- ------------------------------------------------------------------
-- ★ 任务状态必须落表，绝不用内存 Map —— 照 world_gen3d_jobs 的规矩来：
--   进程重启后必须仍能按 id 查到同一条任务、拿到同一个试听地址。
--
-- 状态机：queued → running → succeeded | failed | cancelled
--   succeeded 且 imported=false → 生成了但用户还没入库（试听文件在临时目录）
--   succeeded 且 imported=true  → 已写入 public/uploads/character-templates/sounds/，asset_url 有效
--
-- 为什么单独一张表而不是复用 ai_call_log：
--   ai_call_log 是「调用账本」，按次记、字段是 token/延迟；
--   这里要记的是「产物」——提示词、时长、生成的音频放哪、入库没有。
--
-- 临时产物目录（未入库的生成结果）：
--   public/uploads/character-templates/sounds/.tmp/  ← 不在扫描白名单里，不会被资产清单列出来
--   试听时通过 /api/sound-scenes/sfx/preview/:id 取，入库后删除。

CREATE TABLE IF NOT EXISTS world_sfx_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status            VARCHAR(20) NOT NULL DEFAULT 'queued',
  provider          VARCHAR(60)  NOT NULL DEFAULT 'doubao_seed_audio',
  model             VARCHAR(80),
  prompt            TEXT NOT NULL,
  prompt_en         TEXT,
  duration_sec      NUMERIC(6,2),
  sample_rate       INTEGER NOT NULL DEFAULT 44100,
  format            VARCHAR(16) NOT NULL DEFAULT 'mp3',
  -- 生成结果（未入库）：临时文件路径 + 体积
  preview_path      TEXT,
  preview_url       TEXT,
  size_bytes        INTEGER,
  actual_duration   NUMERIC(8,2),
  -- 入库后：正式资产 URL（文件名即引用键）
  imported          BOOLEAN NOT NULL DEFAULT false,
  asset_url         TEXT,
  asset_name        TEXT,
  asset_size        INTEGER,
  compress_ratio    NUMERIC(6,2),
  params            JSONB NOT NULL DEFAULT '{}'::jsonb,
  error             TEXT,
  error_hint        TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  latency_ms        INTEGER,
  created_by        VARCHAR(120),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 常用查询：最近生成的（时间倒序）
CREATE INDEX IF NOT EXISTS idx_sfx_jobs_created
  ON world_sfx_jobs (created_at DESC);
-- 按状态捞待处理任务
CREATE INDEX IF NOT EXISTS idx_sfx_jobs_status
  ON world_sfx_jobs (status, updated_at DESC);
-- 查未入库的（后台可以清理过期临时文件）
CREATE INDEX IF NOT EXISTS idx_sfx_jobs_imported
  ON world_sfx_jobs (imported, created_at DESC);
