-- 迁移：world_objects 补充渲染开关三列（visible / cast_shadow / receive_shadow）
-- 用途：
--   1. 右侧属性面板「可见性 / 投射阴影 / 接收阴影」三个开关原先只改了内存 mesh，
--      前端 saveObjectToDatabase 虽把三个值发到 PUT /api/world/objects/:id，
--      但后端普通对象分支没有对应列可写 → 刷新即回默认值（假保存）。
--   2. 多选批量面板要批量改这三项，必须有持久化列。
-- 说明：幂等脚本，列已存在时静默跳过，可安全重复执行。
-- 默认值取 true：保持历史行为（旧对象一律可见、投/接收阴影），不改变现有世界观感。
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS visible BOOLEAN DEFAULT TRUE;
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS cast_shadow BOOLEAN DEFAULT TRUE;
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS receive_shadow BOOLEAN DEFAULT TRUE;
