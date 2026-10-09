-- add_world_tasks_p6.sql —— Phase 6 · world_tasks / world_task_progress 差量补列（§10.1/§10.2）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- 幂等：可重复执行。mini 版（Phase 3.5-1）已建两表，这里只补 Phase 6 需要的差量。
ALTER TABLE world_tasks ADD COLUMN IF NOT EXISTS giver_type      VARCHAR(20);
ALTER TABLE world_tasks ADD COLUMN IF NOT EXISTS giver_id        VARCHAR(100);
ALTER TABLE world_tasks ADD COLUMN IF NOT EXISTS source_template VARCHAR(60);
ALTER TABLE world_tasks ADD COLUMN IF NOT EXISTS gameplay_def    VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_world_tasks_status ON world_tasks(world_id, status, visibility);

-- 进度表：objective_index = 有序目标游标（§10.2 objectives 是有序数组，逐个完成）；
-- last_seq = 事件游标（objectiveEvaluator 只消费 claim 之后的事件，重复评估幂等）。
ALTER TABLE world_task_progress ADD COLUMN IF NOT EXISTS objective_index INT NOT NULL DEFAULT 0;
ALTER TABLE world_task_progress ADD COLUMN IF NOT EXISTS last_seq        BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_world_task_progress_actor ON world_task_progress(actor_type, actor_id, status);
