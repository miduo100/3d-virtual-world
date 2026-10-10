-- world_gen3d_jobs —— 3D 生成任务账本（AI World Brain · Phase 8 · §F.2 路径 4 / Gen3D）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- ------------------------------------------------------------------
-- ★ 任务状态必须落表，绝不用内存 Map —— aiSceneGenerator:2310 的教训：
--   进程重启后必须仍能按 id 轮询到同一条任务（P7-8 的硬判据）。
-- 状态机：queued → running → succeeded | failed | cancelled
-- 本表只记录"生成任务"；生成产物入世界必须再过 AssetValidator + executor（唯一写库路径）。

CREATE TABLE IF NOT EXISTS world_gen3d_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id         VARCHAR(100) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'queued',
  provider         VARCHAR(40)  NOT NULL DEFAULT 'tripo',
  provider_task_id VARCHAR(200),
  idempotency_key  VARCHAR(200),
  prompt           TEXT,
  spec             JSONB NOT NULL DEFAULT '{}'::jsonb,
  params           JSONB NOT NULL DEFAULT '{}'::jsonb,
  result           JSONB,
  error            TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  created_by       VARCHAR(120),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 幂等键：同一 key 重复提交只落一条（Builder Agent / Runtime 重跑安全）
CREATE UNIQUE INDEX IF NOT EXISTS idx_gen3d_jobs_idem
  ON world_gen3d_jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gen3d_jobs_world
  ON world_gen3d_jobs (world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gen3d_jobs_status
  ON world_gen3d_jobs (status, updated_at DESC);
