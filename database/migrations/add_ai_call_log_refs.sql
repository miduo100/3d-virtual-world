-- add_ai_call_log_refs.sql —— Phase 3.5-1 · ai_call_log 加委托级留痕 3 列（§C.3 ⑱ / §H.10.5）
-- 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
-- 幂等：可重复执行
-- ★ 为什么必须有这三列（不是"锦上添花"）：
--   1) mission_id —— 委托级预算必须**查表计数**（P35-10）：内存计数器进程重启即清零，
--      用它判预算就等于没有预算；
--   2) region_key —— 多区域并行时按区域聚合用量与排查（P35-19）；
--   3) context_meta —— 装配留痕（§H.9.2 的 meta.tokensPerSection / dropped），
--      用于事后解释"AI 为什么没看到那栋楼"。**只存统计与摘要，绝不存 prompt 全文**。
ALTER TABLE ai_call_log ADD COLUMN IF NOT EXISTS mission_id  UUID;
ALTER TABLE ai_call_log ADD COLUMN IF NOT EXISTS region_key VARCHAR(60);
ALTER TABLE ai_call_log ADD COLUMN IF NOT EXISTS context_meta JSONB;

CREATE INDEX IF NOT EXISTS idx_ai_call_log_mission ON ai_call_log(mission_id);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_region ON ai_call_log(region_key);