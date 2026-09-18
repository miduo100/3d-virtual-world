-- 迁移：world_objects 表补充 agent_description 列（🤖 AI 描述）
-- 用途：管理员在编辑器给物体填写的说明，仅供 AI/Agent 通过 observe 读取，
--       玩家端不展示。AI 不下载 3D 模型，靠 name + 该描述认识物体。
-- 说明：幂等脚本，列已存在时静默跳过；存量物体为 NULL（无描述），可随时在编辑器补填。
-- 安全：所有 Agent（含公开游客）observe 都能读到，勿写敏感信息。
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS agent_description TEXT;
